"""
Accounts app views.
"""
import logging
import pyotp
import qrcode
import qrcode.image.svg
from io import BytesIO
import base64

from django.contrib.auth import get_user_model
from django.db import models
from django.core.cache import cache
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from apps.core.throttling import RegistrationRateThrottle
from apps.core.permissions import IsAdminOnly

from .serializers import (
    UserSerializer,
    UserDetailSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    PasswordChangeSerializer,
    PasswordResetSerializer,
    CustomTokenObtainPairSerializer,
    MFASetupSerializer,
    MFAVerifySerializer,
    MFADisableSerializer,
    RegisterSerializer,
)

User = get_user_model()
logger = logging.getLogger('accounts.security')

# Rate limiting settings
MAX_LOGIN_ATTEMPTS = 5
MAX_MFA_ATTEMPTS = 5
MAX_PASSWORD_ATTEMPTS = 3
LOGIN_LOCKOUT_SECONDS = 300  # 5 minutes
MFA_LOCKOUT_SECONDS = 300    # 5 minutes
PASSWORD_LOCKOUT_SECONDS = 600  # 10 minutes


def get_client_ip(request):
    """Get client IP address from request."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip


def check_rate_limit(request, identifier, max_attempts=MAX_LOGIN_ATTEMPTS, lockout_seconds=LOGIN_LOCKOUT_SECONDS):
    """Check if rate limit exceeded. Returns (is_blocked, attempts_left)."""
    cache_key = f'rate_limit:{identifier}'
    attempts = cache.get(cache_key, 0)
    
    if attempts >= max_attempts:
        return True, 0
    return False, max_attempts - attempts


def increment_rate_limit(request, identifier, lockout_seconds=LOGIN_LOCKOUT_SECONDS):
    """Increment failed attempts."""
    cache_key = f'rate_limit:{identifier}'
    attempts = cache.get(cache_key, 0)
    cache.set(cache_key, attempts + 1, lockout_seconds)


def reset_rate_limit(identifier):
    """Reset rate limit after successful action."""
    cache_key = f'rate_limit:{identifier}'
    cache.delete(cache_key)


class CustomTokenObtainPairView(TokenObtainPairView):
    """Custom login view that handles 2FA and rate limiting."""
    serializer_class = CustomTokenObtainPairSerializer
    
    def post(self, request, *args, **kwargs):
        email = request.data.get('email', '').lower()
        client_ip = get_client_ip(request)
        
        # Check rate limit by IP and email
        ip_blocked, _ = check_rate_limit(request, f'login:ip:{client_ip}')
        email_blocked, _ = check_rate_limit(request, f'login:email:{email}')
        
        if ip_blocked or email_blocked:
            logger.warning(
                f"Rate limit exceeded for login - IP: {client_ip}, Email: {email}"
            )
            return Response(
                {'error': 'Te veel mislukte pogingen. Probeer het over 5 minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        response = super().post(request, *args, **kwargs)
        
        if response.status_code == 200:
            # Successful login - reset rate limits
            reset_rate_limit(f'login:ip:{client_ip}')
            reset_rate_limit(f'login:email:{email}')
            logger.info(f"Successful login for {email} from IP {client_ip}")
        else:
            # Failed login - increment rate limits
            increment_rate_limit(request, f'login:ip:{client_ip}')
            increment_rate_limit(request, f'login:email:{email}')
            logger.warning(f"Failed login attempt for {email} from IP {client_ip}")
        
        return response


class MFAVerifyView(APIView):
    """Verify 2FA code during login."""
    permission_classes = [AllowAny]
    
    def post(self, request):
        client_ip = get_client_ip(request)
        user_id = request.data.get('user_id', 'unknown')
        rate_limit_key = f'mfa_verify:{client_ip}:{user_id}'
        
        # Check rate limit for MFA verification (prevents brute force on 6-digit codes)
        is_blocked, remaining_time = check_rate_limit(
            request, rate_limit_key, 
            max_attempts=MAX_MFA_ATTEMPTS, 
            lockout_seconds=MFA_LOCKOUT_SECONDS
        )
        
        if is_blocked:
            logger.warning(f"Rate limit exceeded for MFA verify - IP: {client_ip}, User: {user_id}")
            return Response(
                {'error': f'Te veel mislukte pogingen. Probeer het over {remaining_time // 60} minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        serializer = MFAVerifySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        user_id = serializer.validated_data.get('user_id')
        code = serializer.validated_data['code']
        
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            # Don't reveal if user exists - use generic error
            increment_rate_limit(request, rate_limit_key, MFA_LOCKOUT_SECONDS)
            return Response(
                {'error': 'Verificatie mislukt.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not user.mfa_enabled or not user.mfa_secret:
            # Don't reveal MFA status
            increment_rate_limit(request, rate_limit_key, MFA_LOCKOUT_SECONDS)
            return Response(
                {'error': 'Verificatie mislukt.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify TOTP code
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(code):
            increment_rate_limit(request, rate_limit_key, MFA_LOCKOUT_SECONDS)
            logger.warning(f"Failed MFA verification for user {user.email} from IP {client_ip}")
            return Response(
                {'error': 'Ongeldige verificatiecode.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Reset rate limit on success
        reset_rate_limit(rate_limit_key)
        logger.info(f"Successful MFA verification for user {user.email} from IP {client_ip}")
        
        # Generate tokens
        refresh = RefreshToken.for_user(user)
        
        return Response({
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'user': UserSerializer(user).data,
        })


class RegisterView(APIView):
    """User self-registration."""
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationRateThrottle]
    
    def post(self, request):
        # Check license user limit
        from apps.licensing.services import check_user_limit
        limit_check = check_user_limit()
        if not limit_check['allowed']:
            return Response(
                {'error': limit_check['message']},
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            refresh = RefreshToken.for_user(user)
            return Response({
                'refresh': str(refresh),
                'access': str(refresh.access_token),
                'user': UserSerializer(user).data,
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProfileView(APIView):
    """Current user profile management."""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        serializer = UserDetailSerializer(request.user)
        return Response(serializer.data)
    
    def patch(self, request):
        serializer = UserDetailSerializer(request.user, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PasswordChangeView(APIView):
    """Change password for current user."""
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        client_ip = get_client_ip(request)
        user = request.user
        rate_limit_key = f'password_change:{user.id}'
        
        # Check rate limit for password changes (prevents brute force on old password)
        is_blocked, remaining_time = check_rate_limit(
            request, rate_limit_key,
            max_attempts=MAX_PASSWORD_ATTEMPTS,
            lockout_seconds=PASSWORD_LOCKOUT_SECONDS
        )
        
        if is_blocked:
            logger.warning(f"Rate limit exceeded for password change - User: {user.email}, IP: {client_ip}")
            return Response(
                {'error': f'Te veel mislukte pogingen. Probeer het over {remaining_time // 60} minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        serializer = PasswordChangeSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        if not user.check_password(serializer.validated_data['old_password']):
            increment_rate_limit(request, rate_limit_key, PASSWORD_LOCKOUT_SECONDS)
            logger.warning(f"Failed password change for user {user.email} from IP {client_ip} - incorrect old password")
            return Response(
                {'old_password': 'Huidig wachtwoord is incorrect.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        user.set_password(serializer.validated_data['new_password'])
        user.save()
        
        # Reset rate limit on success
        reset_rate_limit(rate_limit_key)
        logger.info(f"Password changed successfully for user {user.email} from IP {client_ip}")
        
        return Response({'message': 'Wachtwoord succesvol gewijzigd.'})


class MFASetupView(APIView):
    """Setup 2FA for current user."""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get QR code for 2FA setup."""
        user = request.user
        
        # Generate new secret if not exists
        if not user.mfa_secret:
            user.mfa_secret = pyotp.random_base32()
            user.save()
        
        # Generate TOTP URI
        from apps.core.models import AppSettings
        app_settings = AppSettings.get_settings()
        app_name = app_settings.app_name
        
        totp = pyotp.TOTP(user.mfa_secret)
        uri = totp.provisioning_uri(name=user.email, issuer_name=app_name)
        
        # Generate QR code as base64
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        qr_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        return Response({
            'secret': user.mfa_secret,
            'qr_code': f'data:image/png;base64,{qr_base64}',
            'uri': uri,
        }, headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
        })
    
    def post(self, request):
        """Verify and enable 2FA."""
        client_ip = get_client_ip(request)
        user = request.user
        rate_limit_key = f'mfa_setup:{user.id}'
        
        # Check rate limit for MFA setup verification
        is_blocked, remaining_time = check_rate_limit(
            request, rate_limit_key,
            max_attempts=MAX_MFA_ATTEMPTS,
            lockout_seconds=MFA_LOCKOUT_SECONDS
        )
        
        if is_blocked:
            logger.warning(f"Rate limit exceeded for MFA setup - User: {user.email}, IP: {client_ip}")
            return Response(
                {'error': f'Te veel mislukte pogingen. Probeer het over {remaining_time // 60} minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        serializer = MFAVerifySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        code = serializer.validated_data['code']
        
        if not user.mfa_secret:
            return Response(
                {'error': 'Vraag eerst een QR code aan via GET.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(code):
            increment_rate_limit(request, rate_limit_key, MFA_LOCKOUT_SECONDS)
            logger.warning(f"Failed MFA setup verification for user {user.email} from IP {client_ip}")
            return Response(
                {'error': 'Ongeldige verificatiecode.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        user.mfa_enabled = True
        user.save()
        
        # Reset rate limit on success
        reset_rate_limit(rate_limit_key)
        logger.info(f"MFA enabled successfully for user {user.email} from IP {client_ip}")
        
        return Response({'message': '2FA succesvol ingeschakeld.'})


class MFADisableView(APIView):
    """Disable 2FA for current user."""
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        client_ip = get_client_ip(request)
        user = request.user
        rate_limit_key = f'mfa_disable:{user.id}'
        
        # Check rate limit for MFA disable (requires password + code)
        is_blocked, remaining_time = check_rate_limit(
            request, rate_limit_key,
            max_attempts=MAX_PASSWORD_ATTEMPTS,
            lockout_seconds=PASSWORD_LOCKOUT_SECONDS
        )
        
        if is_blocked:
            logger.warning(f"Rate limit exceeded for MFA disable - User: {user.email}, IP: {client_ip}")
            return Response(
                {'error': f'Te veel mislukte pogingen. Probeer het over {remaining_time // 60} minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        
        serializer = MFADisableSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Verify password
        if not user.check_password(serializer.validated_data['password']):
            increment_rate_limit(request, rate_limit_key, PASSWORD_LOCKOUT_SECONDS)
            logger.warning(f"Failed MFA disable for user {user.email} from IP {client_ip} - incorrect password")
            return Response(
                {'password': 'Wachtwoord is incorrect.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify TOTP code
        if user.mfa_enabled and user.mfa_secret:
            totp = pyotp.TOTP(user.mfa_secret)
            if not totp.verify(serializer.validated_data['code']):
                increment_rate_limit(request, rate_limit_key, PASSWORD_LOCKOUT_SECONDS)
                logger.warning(f"Failed MFA disable for user {user.email} from IP {client_ip} - incorrect code")
                return Response(
                    {'code': 'Ongeldige verificatiecode.'}, 
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        user.mfa_enabled = False
        user.mfa_secret = ''
        user.save()
        
        # Reset rate limit on success
        reset_rate_limit(rate_limit_key)
        logger.info(f"MFA disabled for user {user.email} from IP {client_ip}")
        
        return Response({'message': '2FA succesvol uitgeschakeld.'})


class UserViewSet(viewsets.ModelViewSet):
    """
    Admin viewset for user management.
    Full CRUD operations for admins only.
    """
    queryset = User.objects.all()
    permission_classes = [IsAdminOnly]
    
    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserSerializer
    
    def create(self, request, *args, **kwargs):
        """Create user with license user limit check."""
        from apps.licensing.services import check_user_limit
        limit_check = check_user_limit()
        if not limit_check['allowed']:
            return Response(
                {'error': limit_check['message']},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().create(request, *args, **kwargs)
    
    def get_queryset(self):
        queryset = User.objects.all()
        
        # Filter by role
        rol = self.request.query_params.get('rol')
        if rol:
            queryset = queryset.filter(rol=rol)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Search
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                models.Q(email__icontains=search) |
                models.Q(username__icontains=search) |
                models.Q(voornaam__icontains=search) |
                models.Q(achternaam__icontains=search)
            )
        
        return queryset.order_by('achternaam', 'voornaam')
    
    def destroy(self, request, *args, **kwargs):
        """Delete user with security checks."""
        user = self.get_object()
        
        # Prevent self-deletion
        if user.id == request.user.id:
            return Response(
                {'error': 'Je kunt je eigen account niet verwijderen.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Prevent deletion of last admin
        if user.rol == 'admin' or user.is_superuser:
            admin_count = User.objects.filter(
                models.Q(rol='admin') | models.Q(is_superuser=True),
                is_active=True
            ).count()
            if admin_count <= 1:
                return Response(
                    {'error': 'Er moet minimaal één actieve admin blijven.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Log the deletion
        import logging
        logger = logging.getLogger('accounts.security')
        logger.warning(
            f"User deleted: {user.email} (ID: {user.id}) by admin {request.user.email}"
        )
        
        return super().destroy(request, *args, **kwargs)
    
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """Reset password for a user (admin only)."""
        user = self.get_object()
        serializer = PasswordResetSerializer(data=request.data)
        
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        user.set_password(serializer.validated_data['new_password'])
        user.save()
        
        # Log password reset
        import logging
        logger = logging.getLogger('accounts.security')
        logger.info(
            f"Password reset for user {user.email} (ID: {user.id}) by admin {request.user.email}"
        )
        
        return Response({'message': f'Wachtwoord voor {user.full_name} succesvol gereset.'})
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Toggle user active status (block/unblock)."""
        user = self.get_object()
        
        # Prevent self-blocking
        if user.id == request.user.id:
            return Response(
                {'error': 'Je kunt je eigen account niet blokkeren.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Prevent blocking last admin
        if user.is_active and (user.rol == 'admin' or user.is_superuser):
            admin_count = User.objects.filter(
                models.Q(rol='admin') | models.Q(is_superuser=True),
                is_active=True
            ).count()
            if admin_count <= 1:
                return Response(
                    {'error': 'Er moet minimaal één actieve admin blijven.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        user.is_active = not user.is_active
        user.save()
        
        # Log status change
        import logging
        logger = logging.getLogger('accounts.security')
        status_text = 'geactiveerd' if user.is_active else 'geblokkeerd'
        logger.info(
            f"User {user.email} (ID: {user.id}) {status_text} by admin {request.user.email}"
        )
        
        return Response({
            'message': f'Gebruiker {user.full_name} is {status_text}.',
            'is_active': user.is_active,
        })
    
    @action(detail=True, methods=['post'])
    def disable_mfa(self, request, pk=None):
        """Disable 2FA for a user (admin only)."""
        user = self.get_object()
        
        if not user.mfa_enabled:
            return Response(
                {'error': '2FA is al uitgeschakeld voor deze gebruiker.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        user.mfa_enabled = False
        user.mfa_secret = ''
        user.save()
        
        # Log MFA disable
        import logging
        logger = logging.getLogger('accounts.security')
        logger.warning(
            f"2FA disabled for user {user.email} (ID: {user.id}) by admin {request.user.email}"
        )
        
        return Response({'message': f'2FA voor {user.full_name} is uitgeschakeld.'})

    @action(detail=False, methods=['get'])
    def available_permissions(self, request):
        """Return the list of available module permissions with their labels."""
        from .models import AVAILABLE_MODULE_PERMISSIONS, MODULE_PERMISSION_DEPENDENCIES
        return Response({
            'permissions': [
                {'code': code, 'label': label}
                for code, label in AVAILABLE_MODULE_PERMISSIONS
            ],
            'dependencies': MODULE_PERMISSION_DEPENDENCIES,
        })
