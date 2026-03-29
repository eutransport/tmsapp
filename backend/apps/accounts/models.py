"""
Accounts app models - Custom User model.
"""
import uuid
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models


class UserRole(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    GEBRUIKER = 'gebruiker', 'Gebruiker'
    CHAUFFEUR = 'chauffeur', 'Chauffeur'


# Available module permissions that can be granted to individual users
AVAILABLE_MODULE_PERMISSIONS = [
    ('can_manage_leave_for_all', 'Verlof beheren voor alle medewerkers'),
    ('view_dashboard', 'Dashboard'),
    ('view_companies', 'Bedrijven'),
    ('view_drivers', 'Chauffeurs'),
    ('view_fleet', 'Vloot'),
    ('view_submitted_hours', 'Ingediende uren'),
    ('view_uren_import', 'Uren import'),
    ('view_invoices', 'Facturen'),
    ('view_invoice_templates', 'Factuur templates'),
    ('view_invoice_import', 'Factuur import'),
    ('view_banking', 'Bankkoppeling'),
    ('view_revenue', 'Omzet'),
    ('view_spreadsheets', 'Ritregistratie'),
    ('view_spreadsheet_templates', 'Spreadsheet templates'),
    ('view_maintenance', 'Onderhoud'),
    ('view_notifications', 'Notificaties'),
]

# Dependencies: enabling a permission also requires these permissions
MODULE_PERMISSION_DEPENDENCIES = {
    'view_invoices': ['view_submitted_hours'],
    'view_invoice_templates': ['view_invoices', 'view_submitted_hours'],
    'view_invoice_import': ['view_invoices', 'view_submitted_hours'],
    'view_spreadsheet_templates': ['view_spreadsheets'],
}

VALID_MODULE_PERMISSIONS = {code for code, _ in AVAILABLE_MODULE_PERMISSIONS}


class UserManager(BaseUserManager):
    """Custom user manager."""
    
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('E-mailadres is verplicht')
        email = self.normalize_email(email).lower()  # Ensure full lowercase
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user
    
    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        extra_fields.setdefault('rol', UserRole.ADMIN)
        
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser moet is_staff=True hebben.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser moet is_superuser=True hebben.')
        
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """
    Custom User model for TMS.
    Uses email as the username field.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Authentication
    email = models.EmailField(unique=True, verbose_name='E-mail')
    username = models.CharField(max_length=150, unique=True, verbose_name='Gebruikersnaam')
    
    # Personal info
    voornaam = models.CharField(max_length=100, verbose_name='Voornaam')
    achternaam = models.CharField(max_length=100, verbose_name='Achternaam')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon')
    bedrijf = models.CharField(max_length=200, blank=True, verbose_name='Bedrijf')
    
    # Role
    rol = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.GEBRUIKER,
        verbose_name='Rol'
    )
    
    # 2FA/MFA
    mfa_enabled = models.BooleanField(default=False, verbose_name='2FA Ingeschakeld')
    mfa_required = models.BooleanField(default=False, verbose_name='2FA Verplicht')
    mfa_secret = models.CharField(max_length=32, blank=True, verbose_name='2FA Secret')
    
    # Module permissions (granular per-user access on top of the base role)
    module_permissions = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Module rechten',
        help_text='Lijst van specifieke rechten voor deze gebruiker, bovenop de basisrol.'
    )

    # Status
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    is_staff = models.BooleanField(default=False, verbose_name='Staff')
    
    # Timestamps
    date_joined = models.DateTimeField(auto_now_add=True, verbose_name='Aangemaakt op')
    last_login = models.DateTimeField(null=True, blank=True, verbose_name='Laatste login')
    last_activity = models.DateTimeField(null=True, blank=True, verbose_name='Laatste activiteit')
    
    objects = UserManager()
    
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username', 'voornaam', 'achternaam']
    
    class Meta:
        verbose_name = 'Gebruiker'
        verbose_name_plural = 'Gebruikers'
        ordering = ['achternaam', 'voornaam']
    
    def __str__(self):
        return f"{self.voornaam} {self.achternaam}"
    
    @property
    def full_name(self):
        return f"{self.voornaam} {self.achternaam}"
    
    @property
    def is_admin(self):
        return self.rol == UserRole.ADMIN or self.is_superuser
    
    @property
    def is_chauffeur(self):
        return self.rol == UserRole.CHAUFFEUR

    def has_module_permission(self, permission: str) -> bool:
        """Check if this user has a specific module permission."""
        # Admins have all permissions implicitly
        if self.is_admin:
            return True
        return permission in (self.module_permissions or [])
