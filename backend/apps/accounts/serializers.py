"""
Accounts app serializers.
"""
import pyotp
import qrcode
import qrcode.image.svg
from io import BytesIO
import base64

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import VALID_MODULE_PERMISSIONS, MODULE_PERMISSION_DEPENDENCIES, UserRole

User = get_user_model()


def _resolve_permissions_with_dependencies(permissions: list) -> list:
    """Add any required dependency permissions and return the resolved list."""
    resolved = set(permissions)
    for perm in list(resolved):
        for dep in MODULE_PERMISSION_DEPENDENCIES.get(perm, []):
            resolved.add(dep)
    return sorted(resolved)


class UserSerializer(serializers.ModelSerializer):
    """Basic user serializer for listings."""
    full_name = serializers.CharField(read_only=True)
    opdrachtgever_bedrijf_naam = serializers.CharField(
        source='opdrachtgever_bedrijf.naam', read_only=True, default=None
    )
    # Het object-ID zelf hoeft de browser niet te kennen; of er een koppeling
    # is, is voldoende om de knop wel of niet aan te bieden.
    azure_gekoppeld = serializers.SerializerMethodField()

    def get_azure_gekoppeld(self, obj) -> bool:
        return bool(obj.entra_object_id)

    class Meta:
        model = User
        fields = [
            'id', 'email', 'username', 'voornaam', 'achternaam',
            'full_name', 'telefoon', 'bedrijf', 'rol',
            'opdrachtgever_bedrijf', 'opdrachtgever_bedrijf_naam',
            'module_permissions', 'nav_favorites',
            'mfa_enabled', 'mfa_required', 'is_active', 'date_joined', 'last_login',
            'azure_gekoppeld', 'entra_upn', 'entra_synced_at',
            'wachtwoord_login_uitgeschakeld',
        ]
        read_only_fields = [
            'id', 'date_joined', 'last_login',
            'azure_gekoppeld', 'entra_upn', 'entra_synced_at',
        ]


class UserDetailSerializer(serializers.ModelSerializer):
    """Detailed user serializer for profile."""
    full_name = serializers.CharField(read_only=True)
    opdrachtgever_bedrijf_naam = serializers.CharField(
        source='opdrachtgever_bedrijf.naam', read_only=True, default=None
    )
    
    class Meta:
        model = User
        fields = [
            'id', 'email', 'username', 'voornaam', 'achternaam',
            'full_name', 'telefoon', 'bedrijf', 'rol',
            'opdrachtgever_bedrijf', 'opdrachtgever_bedrijf_naam',
            'module_permissions', 'nav_favorites',
            'mfa_enabled', 'mfa_required', 'is_active', 'date_joined', 'last_login'
        ]
        read_only_fields = [
            'id', 'email', 'rol', 'opdrachtgever_bedrijf', 'is_active',
            'date_joined', 'last_login'
        ]


def _controleer_opdrachtgever_bedrijf(rol, bedrijf):
    """Een opdrachtgever zonder bedrijf ziet niets en mag niet bestaan."""
    if rol == UserRole.OPDRACHTGEVER and not bedrijf:
        raise serializers.ValidationError({
            'opdrachtgever_bedrijf': 'Kies een bedrijf voor deze opdrachtgever.'
        })
    if rol != UserRole.OPDRACHTGEVER and bedrijf:
        raise serializers.ValidationError({
            'opdrachtgever_bedrijf': 'Alleen een opdrachtgever kan aan een bedrijf gekoppeld worden.'
        })


class UserCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating new users (admin only)."""
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True, required=True)
    
    class Meta:
        model = User
        fields = [
            'email', 'username', 'password', 'password_confirm',
            'voornaam', 'achternaam', 'telefoon', 'bedrijf', 'rol', 'is_active',
            'opdrachtgever_bedrijf', 'module_permissions',
        ]
    
    def validate_module_permissions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Module rechten moeten een lijst zijn.')
        invalid = set(value) - VALID_MODULE_PERMISSIONS
        if invalid:
            raise serializers.ValidationError(
                f'Ongeldige rechten: {", ".join(invalid)}'
            )
        return _resolve_permissions_with_dependencies(value)

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Wachtwoorden komen niet overeen.'})
        return attrs
    
    def create(self, validated_data):
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        user = User(**validated_data)
        # Sync is_staff with admin role so Django permissions work correctly
        user.is_staff = (user.rol == 'admin')
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating users (admin only)."""
    
    class Meta:
        model = User
        fields = [
            'email', 'username', 'voornaam', 'achternaam',
            'telefoon', 'bedrijf', 'rol', 'is_active', 'mfa_required',
            'opdrachtgever_bedrijf', 'module_permissions',
            'wachtwoord_login_uitgeschakeld',
        ]

    def validate_wachtwoord_login_uitgeschakeld(self, value):
        """
        Alleen uitzetten als er ook echt via Microsoft ingelogd kan worden.

        Zonder deze controle sluit een beheerder met één klik een gebruiker
        buiten: geen wachtwoord meer én geen Azure-account om mee binnen te
        komen.
        """
        if value and self.instance is not None and not self.instance.entra_object_id:
            raise serializers.ValidationError(
                'Deze gebruiker is nog niet gekoppeld aan Azure. Maak eerst het '
                'Microsoft-account aan, anders kan er helemaal niet meer worden '
                'ingelogd.'
            )
        return value

    def validate_module_permissions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Module rechten moeten een lijst zijn.')
        invalid = set(value) - VALID_MODULE_PERMISSIONS
        if invalid:
            raise serializers.ValidationError(
                f'Ongeldige rechten: {", ".join(invalid)}'
            )
        return _resolve_permissions_with_dependencies(value)

    def validate(self, attrs):
        rol = attrs.get('rol', self.instance.rol if self.instance else None)
        bedrijf = attrs.get(
            'opdrachtgever_bedrijf',
            self.instance.opdrachtgever_bedrijf if self.instance else None,
        )
        _controleer_opdrachtgever_bedrijf(rol, bedrijf)
        return attrs

    def update(self, instance, validated_data):
        # Sync is_staff with admin role so Django permissions work correctly
        if 'rol' in validated_data:
            validated_data['is_staff'] = (validated_data['rol'] == 'admin')
        return super().update(instance, validated_data)


class PasswordChangeSerializer(serializers.Serializer):
    """Serializer for changing password."""
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(required=True)
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': 'Wachtwoorden komen niet overeen.'})
        return attrs


class PasswordResetSerializer(serializers.Serializer):
    """Serializer for admin password reset."""
    new_password = serializers.CharField(required=True, validators=[validate_password])


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Custom JWT serializer that includes user data and handles 2FA."""
    
    def validate(self, attrs):
        # Make email case-insensitive
        if 'email' in attrs:
            attrs['email'] = attrs['email'].lower()
        
        data = super().validate(attrs)

        # Voor sommige gebruikers is alleen inloggen via Microsoft toegestaan.
        # De controle staat bewust ná de wachtwoordcontrole: zo verraadt de
        # foutmelding niet of een wachtwoord goed of fout was.
        if self.user.wachtwoord_login_uitgeschakeld:
            raise serializers.ValidationError(
                'Voor dit account is inloggen met wachtwoord uitgeschakeld. '
                'Gebruik de knop "Inloggen met Microsoft".'
            )
        
        # Check if user has 2FA enabled
        if self.user.mfa_enabled:
            # Don't return tokens yet, require 2FA verification
            data = {
                'requires_2fa': True,
                'user_id': str(self.user.id),
            }
        elif self.user.mfa_required and not self.user.mfa_enabled:
            # User must set up 2FA first
            data = {
                'requires_2fa_setup': True,
                'user_id': str(self.user.id),
                'access': data['access'],  # Give temporary access for setup
                'refresh': data['refresh'],
                'user': UserSerializer(self.user).data,
            }
        else:
            # Add user info to response
            data['user'] = UserSerializer(self.user).data
        
        return data


class MFASetupSerializer(serializers.Serializer):
    """Serializer for setting up 2FA."""
    pass  # No input needed


class MFAVerifySerializer(serializers.Serializer):
    """Serializer for verifying 2FA code."""
    code = serializers.CharField(required=True, min_length=6, max_length=6)
    user_id = serializers.UUIDField(required=False)  # Only needed during login


class MFADisableSerializer(serializers.Serializer):
    """Serializer for disabling 2FA."""
    code = serializers.CharField(required=True, min_length=6, max_length=6)
    password = serializers.CharField(required=True)


class RegisterSerializer(serializers.ModelSerializer):
    """Serializer for user self-registration (if enabled)."""
    password = serializers.CharField(write_only=True, required=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True, required=True)
    
    class Meta:
        model = User
        fields = [
            'email', 'username', 'password', 'password_confirm',
            'voornaam', 'achternaam', 'telefoon'
        ]
    
    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({'password_confirm': 'Wachtwoorden komen niet overeen.'})
        return attrs
    
    def create(self, validated_data):
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        # Default role is Gebruiker, set by model default
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user
