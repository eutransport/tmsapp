"""
Licensing service - Ed25519 cryptographic license generation and verification.

Architecture:
- Private key: ONLY on the developer's machine (used to GENERATE licenses)
- Public key: Embedded in the application (used to VERIFY licenses)

Without the private key, nobody can create a valid license.
"""
import json
import base64
import uuid
import hashlib
import platform
import logging
from datetime import datetime, timezone as dt_timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature

logger = logging.getLogger(__name__)

# ============================================================================
# PUBLIC KEY - Embedded in the application
# This key can only VERIFY signatures, never create them.
# Replace this with your actual public key after running: python manage.py generate_license_keys
# ============================================================================
LICENSE_PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARKDDiTTAfAWZ34Ae9wfaHABttyPh3tz0S25ryhddRwg=
-----END PUBLIC KEY-----"""


def get_public_key() -> Ed25519PublicKey:
    """Load the embedded public verification key."""
    from django.conf import settings
    
    # Allow overriding via settings (useful for testing)
    pem = getattr(settings, 'LICENSE_PUBLIC_KEY_PEM', None)
    if pem:
        if isinstance(pem, str):
            pem = pem.encode()
    else:
        pem = LICENSE_PUBLIC_KEY_PEM
    
    return serialization.load_pem_public_key(pem)


def generate_keypair():
    """
    Generate a new Ed25519 keypair.
    Returns (private_key_pem, public_key_pem) as bytes.
    
    ONLY RUN THIS ONCE. Store the private key securely!
    """
    private_key = Ed25519PrivateKey.generate()
    
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    
    return private_pem, public_pem


def create_license(
    private_key_pem: bytes,
    customer_name: str,
    expires_at: datetime,
    max_users: int = 0,
    features: list | None = None,
) -> str:
    """
    Create a signed license key.
    
    Args:
        private_key_pem: The Ed25519 private key (PEM bytes)
        customer_name: Name of the customer/organization
        expires_at: When the license expires
        max_users: Maximum users (0 = unlimited)
        features: List of enabled feature flags
        
    Returns:
        License key string: base64(payload).base64(signature)
    """
    private_key = serialization.load_pem_private_key(private_key_pem, password=None)
    
    payload = {
        'license_id': str(uuid.uuid4()),
        'customer': customer_name,
        'issued_at': datetime.now(dt_timezone.utc).isoformat(),
        'expires_at': expires_at.isoformat(),
        'max_users': max_users,
        'features': features or [],
        # Anti-tampering: hash of the payload structure
        'nonce': str(uuid.uuid4()),
    }
    
    # Serialize payload deterministically
    payload_bytes = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('ascii')
    
    # Sign the payload
    signature = private_key.sign(payload_bytes)
    signature_b64 = base64.urlsafe_b64encode(signature).decode('ascii')
    
    # License key format: PAYLOAD.SIGNATURE
    license_key = f'{payload_b64}.{signature_b64}'
    
    return license_key


def verify_license(license_key: str) -> dict | None:
    """
    Verify a license key's signature and decode the payload.
    
    Args:
        license_key: The license key string (payload.signature)
        
    Returns:
        Decoded payload dict if valid, None if invalid/tampered
    """
    try:
        parts = license_key.strip().split('.')
        if len(parts) != 2:
            logger.warning('License key has invalid format (expected 2 parts)')
            return None
        
        payload_b64, signature_b64 = parts
        
        # Decode
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        signature = base64.urlsafe_b64decode(signature_b64)
        
        # Verify signature using public key
        public_key = get_public_key()
        public_key.verify(signature, payload_bytes)
        
        # Parse payload
        payload = json.loads(payload_bytes.decode('utf-8'))
        
        # Validate required fields
        required_fields = ['license_id', 'customer', 'issued_at', 'expires_at']
        if not all(field in payload for field in required_fields):
            logger.warning('License payload missing required fields')
            return None
        
        return payload
        
    except InvalidSignature:
        logger.warning('License signature verification failed - possible tampering')
        return None
    except Exception as e:
        logger.error(f'License verification error: {e}')
        return None


def generate_installation_id() -> str:
    """
    Generate a unique installation identifier.
    
    This binds a license to a specific server/installation.
    Combines hostname + random UUID + timestamp for uniqueness.
    """
    components = [
        platform.node(),  # hostname
        str(uuid.uuid4()),  # random
        datetime.now(dt_timezone.utc).isoformat(),
    ]
    raw = '|'.join(components)
    return hashlib.sha256(raw.encode()).hexdigest()


def check_license_expiry(payload: dict) -> bool:
    """Check if the license has not expired based on payload data."""
    try:
        expires_at = datetime.fromisoformat(payload['expires_at'])
        # Make timezone-aware if naive
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=dt_timezone.utc)
        return expires_at > datetime.now(dt_timezone.utc)
    except (KeyError, ValueError):
        return False


def activate_license(license_key: str) -> dict:
    """
    Full license activation flow:
    1. Verify the cryptographic signature
    2. Check expiration
    3. Check if already used (single-use)
    4. Bind to this installation
    5. Store in database
    
    Returns dict with status and details.
    """
    from .models import License
    from django.utils import timezone as dj_timezone
    
    # Step 1: Verify signature
    payload = verify_license(license_key)
    if payload is None:
        return {
            'success': False,
            'error': 'invalid_key',
            'message': 'Ongeldige licentiesleutel. De sleutel is ongeldig of gemanipuleerd.',
        }
    
    # Step 2: Check expiration
    if not check_license_expiry(payload):
        return {
            'success': False,
            'error': 'expired',
            'message': 'Deze licentie is verlopen.',
        }
    
    # Step 3: Check if already used
    existing = License.objects.filter(license_key=license_key).first()
    if existing:
        if existing.installation_id:
            return {
                'success': False,
                'error': 'already_activated',
                'message': 'Deze licentie is al geactiveerd op een andere installatie.',
            }
        # License exists but not yet bound - this shouldn't normally happen
        # but handle it by activating
    
    # Step 4: Generate installation ID and bind
    installation_id = generate_installation_id()
    
    # Step 5: Deactivate any existing licenses
    License.objects.filter(status=License.Status.ACTIVE).update(
        status=License.Status.REVOKED
    )
    
    # Step 6: Store the license
    expires_at = datetime.fromisoformat(payload['expires_at'])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt_timezone.utc)
    
    issued_at = datetime.fromisoformat(payload['issued_at'])
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=dt_timezone.utc)
    
    if existing:
        license_obj = existing
        license_obj.installation_id = installation_id
        license_obj.status = License.Status.ACTIVE
        license_obj.activated_at = dj_timezone.now()
        license_obj.save()
    else:
        license_obj = License.objects.create(
            id=payload.get('license_id', uuid.uuid4()),
            license_key=license_key,
            customer_name=payload['customer'],
            issued_at=issued_at,
            expires_at=expires_at,
            max_users=payload.get('max_users', 0),
            features=payload.get('features', []),
            installation_id=installation_id,
            status=License.Status.ACTIVE,
            activated_at=dj_timezone.now(),
        )
    
    logger.info(f'License activated for {payload["customer"]}, expires {payload["expires_at"]}')
    
    return {
        'success': True,
        'message': 'Licentie succesvol geactiveerd!',
        'license': {
            'id': str(license_obj.id),
            'customer': license_obj.customer_name,
            'expires_at': license_obj.expires_at.isoformat(),
            'max_users': license_obj.max_users,
            'features': license_obj.features,
            'days_remaining': license_obj.days_remaining,
        }
    }


def get_active_license():
    """Get the currently active license, or None."""
    from .models import License
    return License.objects.filter(status=License.Status.ACTIVE).first()


def is_license_valid() -> bool:
    """Quick check: is there a valid, non-expired, active license?"""
    license_obj = get_active_license()
    if license_obj is None:
        return False
    return license_obj.is_valid


def check_user_limit() -> dict:
    """
    Check if the current number of active users is within the license limit.
    
    Returns:
        dict with 'allowed' (bool), 'current' (int), 'max' (int), 'message' (str)
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    license_obj = get_active_license()
    if license_obj is None:
        return {
            'allowed': False,
            'current': 0,
            'max': 0,
            'message': 'Geen actieve licentie gevonden.',
        }
    
    max_users = license_obj.max_users
    if max_users == 0:  # 0 = unlimited
        return {
            'allowed': True,
            'current': User.objects.filter(is_active=True).count(),
            'max': 0,
            'message': 'Onbeperkt aantal gebruikers.',
        }
    
    current_count = User.objects.filter(is_active=True).count()
    allowed = current_count < max_users
    
    return {
        'allowed': allowed,
        'current': current_count,
        'max': max_users,
        'message': (
            f'Gebruikerslimiet bereikt ({current_count}/{max_users}). '
            'Upgrade uw licentie voor meer gebruikers.'
        ) if not allowed else f'{current_count}/{max_users} gebruikers.',
    }
