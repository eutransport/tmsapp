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
from apps.core.permissions import IsAdminOnly, IsAdminOrLeaveManagerReadOnly
from .azure_sync import synchroniseer_gebruiker_met_azure, werk_azure_status_bij
from .graph import GraphFout

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


class EntraConfigView(APIView):
    """
    Vertelt de inlogpagina of inloggen via Microsoft beschikbaar is.

    Bewust openbaar en bewust karig: alleen wat de browser nodig heeft om de
    inlogknop te tonen en MSAL te starten. Geen geheimen.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from . import entra

        if not entra.is_ingeschakeld():
            return Response({'enabled': False})

        from django.conf import settings

        return Response({
            'enabled': True,
            'client_id': settings.ENTRA_CLIENT_ID,
            'authority': entra.authority(),
            'tenant_type': settings.ENTRA_TENANT_TYPE,
            'tenant_name': settings.ENTRA_TENANT_NAME,
        })


class EntraLoginView(APIView):
    """
    Wisselt een id-token van Microsoft om voor een eigen JWT.

    Microsoft stelt de identiteit vast; de rol en rechten blijven van deze
    applicatie. Zo verandert er niets aan autorisatie elders in de code.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        from . import entra

        client_ip = get_client_ip(request)
        rate_limit_key = f'entra:ip:{client_ip}'

        is_blocked, _ = check_rate_limit(request, rate_limit_key)
        if is_blocked:
            logger.warning('Rate limit bereikt voor Entra-login vanaf %s', client_ip)
            return Response(
                {'detail': 'Te veel mislukte pogingen. Probeer het over 5 minuten opnieuw.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        token = request.data.get('id_token') or ''

        try:
            claims = entra.valideer_token(token)
            gebruiker = entra.zoek_of_maak_gebruiker(claims)
        except entra.EntraConfiguratieFout as exc:
            logger.error('Entra-login niet mogelijk: %s', exc)
            return Response(
                {'detail': 'Inloggen via Microsoft is niet beschikbaar.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except entra.EntraTokenFout as exc:
            increment_rate_limit(request, rate_limit_key)
            logger.warning('Entra-login geweigerd vanaf %s: %s', client_ip, exc)
            return Response({'detail': str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        reset_rate_limit(rate_limit_key)

        refresh = RefreshToken.for_user(gebruiker)
        logger.info('Entra-login geslaagd voor %s vanaf %s', gebruiker.email, client_ip)

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(gebruiker).data,
        })


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

    def get_permissions(self):
        """List/retrieve: allow leave managers read-only. All writes: admin only."""
        if self.action in ['list', 'retrieve', 'available_permissions']:
            return [IsAdminOrLeaveManagerReadOnly()]
        return [IsAdminOnly()]

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
        antwoord = super().create(request, *args, **kwargs)

        if antwoord.status_code == status.HTTP_201_CREATED:
            self._azure_automatisch(antwoord, request)

        return antwoord

    def perform_create(self, serializer):
        """Onthoudt de zojuist aangemaakte gebruiker voor de Azure-stap."""
        super().perform_create(serializer)
        self._nieuwe_gebruiker = serializer.instance

    def perform_update(self, serializer):
        """
        Houdt Azure gelijk als de actief-status hier verandert.

        Mislukt dat, dan blijft de wijziging in het TMS staan; de beheerder
        ziet de melding terug in het antwoord.
        """
        was_actief = serializer.instance.is_active
        super().perform_update(serializer)
        gebruiker = serializer.instance
        self._azure_status_waarschuwing = None
        if gebruiker.is_active != was_actief:
            try:
                werk_azure_status_bij(gebruiker, self.request.user)
            except GraphFout as fout:
                self._azure_status_waarschuwing = str(fout)

    def update(self, request, *args, **kwargs):
        antwoord = super().update(request, *args, **kwargs)
        waarschuwing = getattr(self, '_azure_status_waarschuwing', None)
        if waarschuwing and isinstance(antwoord.data, dict):
            antwoord.data['azure_waarschuwing'] = waarschuwing
        return antwoord

    def _azure_automatisch(self, antwoord, request):
        """
        Maakt meteen een Microsoft-account aan, als dat zo is ingesteld.

        Gaat dit mis, dan blijft de gebruiker gewoon bestaan: het account in
        het TMS is al aangemaakt en terugdraaien zou verwarrender zijn dan
        de beheerder vertellen dat de Azure-stap nog handmatig moet.
        """
        from apps.accounts import graph
        from apps.core.models import AppSettings

        instellingen = AppSettings.get_settings()
        if not instellingen.entra_sync_auto_create or not graph.is_ingeschakeld():
            return

        gebruiker = getattr(self, '_nieuwe_gebruiker', None)
        if gebruiker is None:
            return

        try:
            resultaat = synchroniseer_gebruiker_met_azure(gebruiker, None, request.user)
        except graph.GraphFout as fout:
            logger.error(
                'Automatisch aanmaken in Azure mislukt voor %s: %s',
                gebruiker.email,
                fout,
            )
            antwoord.data['azure'] = {'status': 'mislukt', 'reden': str(fout)}
            return

        antwoord.data['azure'] = resultaat
    
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

        # In Azure dezelfde status aanhouden; anders kan een geblokkeerde
        # gebruiker via Microsoft gewoon weer inloggen.
        azure_waarschuwing = None
        try:
            werk_azure_status_bij(user, request.user)
        except GraphFout as fout:
            azure_waarschuwing = str(fout)
        
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
            'azure_waarschuwing': azure_waarschuwing,
        })
    
    @action(detail=True, methods=['post'], url_path='azure-sync')
    def azure_sync(self, request, pk=None):
        """
        Zorgt dat deze gebruiker een account in Entra ID heeft.

        Bestaat het account al, dan wordt het alleen gekoppeld. Er wordt
        nooit iets gewijzigd aan een bestaand Azure-account.
        """
        from apps.accounts import graph

        gebruiker = self.get_object()
        inlognaam = (request.data.get('inlognaam') or '').strip().lower()

        try:
            resultaat = synchroniseer_gebruiker_met_azure(
                gebruiker, inlognaam or None, request.user
            )
        except graph.GraphNietIngesteld as fout:
            return Response({'error': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        except graph.GraphFout as fout:
            return Response({'error': str(fout)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(resultaat)

    @action(detail=False, methods=['get'], url_path='azure-overzicht')
    def azure_overzicht(self, request):
        """
        Welke gebruikers zouden worden aangemaakt, zonder iets te doen.

        Zo kan de beheerder eerst zien wat er gaat gebeuren voordat er ook
        maar één account in Azure ontstaat.
        """
        from apps.accounts import graph
        from apps.core.models import AppSettings

        instellingen = AppSettings.get_settings()
        if not graph.is_ingeschakeld():
            return Response(
                {'error': 'De koppeling met Azure staat uit of is niet volledig ingevuld.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        regels = []
        for gebruiker in self.get_queryset().filter(is_active=True):
            regel = {
                'id': str(gebruiker.id),
                'naam': gebruiker.full_name,
                'email': gebruiker.email,
                'rol': gebruiker.rol,
                'gekoppeld': bool(gebruiker.entra_object_id),
            }
            try:
                regel['voorstel'] = graph.stel_inlognaam_voor(
                    gebruiker, instellingen.entra_sync_domain
                )
            except graph.GraphFout as fout:
                regel['voorstel'] = None
                regel['probleem'] = str(fout)
            regels.append(regel)

        return Response({'gebruikers': regels})

    @action(detail=False, methods=['post'], url_path='azure-sync-alles')
    def azure_sync_alles(self, request):
        """
        Loopt alle actieve gebruikers langs en maakt ontbrekende accounts aan.

        Eén mislukking stopt de hele ronde niet; die wordt gemeld en de rest
        gaat door. Anders zou één gebruiker zonder e-mailadres de hele
        synchronisatie blokkeren.
        """
        from apps.accounts import graph

        if not graph.is_ingeschakeld():
            return Response(
                {'error': 'De koppeling met Azure staat uit of is niet volledig ingevuld.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        aangemaakt, gekoppeld, overgeslagen, mislukt = [], [], [], []
        wachtwoorden = {}

        for gebruiker in self.get_queryset().filter(is_active=True):
            if gebruiker.entra_object_id:
                overgeslagen.append(gebruiker.email)
                continue
            try:
                resultaat = synchroniseer_gebruiker_met_azure(
                    gebruiker, None, request.user
                )
            except graph.GraphFout as fout:
                mislukt.append({'email': gebruiker.email, 'reden': str(fout)})
                continue

            if resultaat['status'] == 'aangemaakt':
                aangemaakt.append(gebruiker.email)
                wachtwoorden[gebruiker.email] = resultaat['wachtwoord']
            else:
                gekoppeld.append(gebruiker.email)

        return Response({
            'aangemaakt': aangemaakt,
            'gekoppeld': gekoppeld,
            'overgeslagen': overgeslagen,
            'mislukt': mislukt,
            'wachtwoorden': wachtwoorden,
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
