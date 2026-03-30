"""
Core app models - Application settings.
"""
import os
import uuid
import hashlib
import base64
import logging
from datetime import time
from django.db import models
from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator

logger = logging.getLogger(__name__)


class EncryptedCharField(models.CharField):
    """
    CharField that encrypts data at rest using Fernet symmetric encryption.
    Falls back to plain text storage if cryptography is not available.
    """
    description = "An encrypted CharField"
    
    def __init__(self, *args, **kwargs):
        kwargs.setdefault('max_length', 512)  # Encrypted text is longer
        super().__init__(*args, **kwargs)
    
    def _get_fernet(self):
        """Get Fernet instance for encryption/decryption."""
        try:
            from cryptography.fernet import Fernet
            # Use SECRET_KEY as base for encryption key
            key = base64.urlsafe_b64encode(
                hashlib.sha256(settings.SECRET_KEY.encode()).digest()
            )
            return Fernet(key)
        except ImportError:
            logger.warning("cryptography not installed, storing API keys unencrypted")
            return None
    
    def get_prep_value(self, value):
        """Encrypt value before saving to database."""
        if not value:
            return value
        
        # If already encrypted (starts with 'enc:'), don't re-encrypt
        if isinstance(value, str) and value.startswith('enc:'):
            return value
        
        fernet = self._get_fernet()
        if fernet:
            encrypted = fernet.encrypt(value.encode()).decode()
            return f'enc:{encrypted}'
        return value
    
    def from_db_value(self, value, expression, connection):
        """Decrypt value when reading from database."""
        if not value:
            return value
        
        # Only decrypt if it's encrypted (starts with 'enc:')
        if isinstance(value, str) and value.startswith('enc:'):
            fernet = self._get_fernet()
            if fernet:
                try:
                    encrypted_data = value[4:]  # Remove 'enc:' prefix
                    return fernet.decrypt(encrypted_data.encode()).decode()
                except Exception as e:
                    logger.error(f"Failed to decrypt field: {e}")
                    return ''
        return value
    
    def to_python(self, value):
        """Convert value to Python object."""
        if not value:
            return value
        # Handle decryption for form fields
        if isinstance(value, str) and value.startswith('enc:'):
            fernet = self._get_fernet()
            if fernet:
                try:
                    encrypted_data = value[4:]
                    return fernet.decrypt(encrypted_data.encode()).decode()
                except Exception:
                    return ''
        return value


def validate_font_file(value):
    """
    Validate font file:
    - Check file extension
    - Check file size (max 5MB)
    - Check magic bytes for font files
    """
    # Check file size (max 5MB)
    max_size = 5 * 1024 * 1024
    if value.size > max_size:
        raise ValidationError(f'Bestand is te groot. Maximum is 5MB, dit bestand is {value.size / 1024 / 1024:.1f}MB.')
    
    # Read first bytes to check magic numbers
    value.seek(0)
    header = value.read(12)
    value.seek(0)
    
    # Font magic bytes
    valid_signatures = [
        b'wOFF',           # WOFF
        b'wOF2',           # WOFF2
        b'\x00\x01\x00\x00',  # TrueType
        b'OTTO',           # OpenType
        b'true',           # TrueType
        b'typ1',           # PostScript Type 1
    ]
    
    is_valid = any(header.startswith(sig) for sig in valid_signatures)
    if not is_valid:
        raise ValidationError('Ongeldig font bestand. Alleen WOFF, WOFF2, TTF en OTF bestanden zijn toegestaan.')


def font_upload_path(instance, filename):
    """Generate secure upload path for fonts."""
    # Sanitize filename
    ext = os.path.splitext(filename)[1].lower()
    # Generate unique filename with hash
    content_hash = hashlib.md5(instance.name.encode()).hexdigest()[:8]
    safe_name = f"font_{instance.id}_{content_hash}{ext}"
    return f'fonts/{safe_name}'


class CustomFont(models.Model):
    """
    Custom font uploads for use in templates and site styling.
    """
    FONT_WEIGHTS = [
        (100, 'Thin (100)'),
        (200, 'Extra Light (200)'),
        (300, 'Light (300)'),
        (400, 'Regular (400)'),
        (500, 'Medium (500)'),
        (600, 'Semi Bold (600)'),
        (700, 'Bold (700)'),
        (800, 'Extra Bold (800)'),
        (900, 'Black (900)'),
    ]
    
    FONT_STYLES = [
        ('normal', 'Normaal'),
        ('italic', 'Cursief'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Font family name (grouping)
    family = models.CharField(
        max_length=100,
        verbose_name='Font Familie',
        help_text='Naam van de font familie (bijv. "Roboto", "Open Sans")'
    )
    
    # Display name
    name = models.CharField(
        max_length=100,
        verbose_name='Naam',
        help_text='Weergavenaam voor dit font'
    )
    
    # Font file
    font_file = models.FileField(
        upload_to=font_upload_path,
        validators=[
            FileExtensionValidator(allowed_extensions=['woff', 'woff2', 'ttf', 'otf']),
            validate_font_file,
        ],
        verbose_name='Font Bestand'
    )
    
    # Font properties
    weight = models.PositiveIntegerField(
        choices=FONT_WEIGHTS,
        default=400,
        verbose_name='Gewicht'
    )
    style = models.CharField(
        max_length=10,
        choices=FONT_STYLES,
        default='normal',
        verbose_name='Stijl'
    )
    
    # Is this a system/built-in font?
    is_system = models.BooleanField(
        default=False,
        verbose_name='Systeemfont',
        help_text='Systeemfonts kunnen niet worden verwijderd'
    )
    
    # Active state
    is_active = models.BooleanField(
        default=True,
        verbose_name='Actief'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    uploaded_by = models.ForeignKey(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name='Geüpload door'
    )
    
    class Meta:
        verbose_name = 'Custom Font'
        verbose_name_plural = 'Custom Fonts'
        ordering = ['family', 'weight', 'style']
        unique_together = ['family', 'weight', 'style']
    
    def __str__(self):
        return f"{self.family} {self.get_weight_display()} {self.get_style_display()}"
    
    @property
    def file_format(self):
        """Get the font file format."""
        if self.font_file:
            ext = os.path.splitext(self.font_file.name)[1].lower()
            return ext[1:] if ext else 'unknown'
        return 'unknown'
    
    @property
    def css_format(self):
        """Get CSS format string for @font-face."""
        format_map = {
            'woff2': 'woff2',
            'woff': 'woff',
            'ttf': 'truetype',
            'otf': 'opentype',
        }
        return format_map.get(self.file_format, 'truetype')
    
    def delete(self, *args, **kwargs):
        # Prevent deletion of system fonts
        if self.is_system:
            raise ValidationError('Systeemfonts kunnen niet worden verwijderd.')
        # Delete the file
        if self.font_file:
            self.font_file.delete(save=False)
        super().delete(*args, **kwargs)
    
    def save(self, *args, **kwargs):
        # Clear font cache
        cache.delete('custom_fonts')
        cache.delete('font_families')
        super().save(*args, **kwargs)
    
    @classmethod
    def get_font_families(cls):
        """Get distinct font families."""
        families = cache.get('font_families')
        if families is None:
            families = list(
                cls.objects.filter(is_active=True)
                .values_list('family', flat=True)
                .distinct()
                .order_by('family')
            )
            cache.set('font_families', families, 3600)
        return families


class AppSettings(models.Model):
    """
    Singleton model for application-wide settings.
    Only one instance should exist.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Branding
    app_name = models.CharField(
        max_length=100, 
        default='TMS',
        verbose_name='Applicatie Naam'
    )
    logo = models.ImageField(
        upload_to='branding/', 
        null=True, 
        blank=True,
        verbose_name='Logo'
    )
    favicon = models.ImageField(
        upload_to='branding/', 
        null=True, 
        blank=True,
        verbose_name='Favicon'
    )
    primary_color = models.CharField(
        max_length=7, 
        default='#3B82F6',
        verbose_name='Primaire Kleur'
    )
    login_background_color = models.CharField(
        max_length=7, 
        default='#F9FAFB',
        verbose_name='Login Achtergrondkleur'
    )
    
    # Company info (for invoices, etc.)
    company_name = models.CharField(
        max_length=200, 
        blank=True,
        verbose_name='Bedrijfsnaam'
    )
    company_address = models.TextField(
        blank=True,
        verbose_name='Adres'
    )
    company_phone = models.CharField(
        max_length=20, 
        blank=True,
        verbose_name='Telefoon'
    )
    company_email = models.EmailField(
        blank=True,
        verbose_name='E-mail'
    )
    company_kvk = models.CharField(
        max_length=20, 
        blank=True,
        verbose_name='KVK Nummer'
    )
    company_btw = models.CharField(
        max_length=20, 
        blank=True,
        verbose_name='BTW Nummer'
    )
    company_iban = models.CharField(
        max_length=34, 
        blank=True,
        verbose_name='IBAN'
    )
    
    # Email settings
    smtp_host = models.CharField(
        max_length=255, 
        blank=True,
        verbose_name='SMTP Host'
    )
    smtp_port = models.PositiveIntegerField(
        default=587,
        verbose_name='SMTP Poort'
    )
    smtp_username = models.CharField(
        max_length=255, 
        blank=True,
        verbose_name='SMTP Gebruikersnaam'
    )
    smtp_password = EncryptedCharField(
        max_length=512, 
        blank=True,
        verbose_name='SMTP Wachtwoord'
    )
    smtp_use_tls = models.BooleanField(
        default=True,
        verbose_name='Gebruik TLS'
    )
    smtp_from_email = models.EmailField(
        blank=True,
        verbose_name='Van E-mail'
    )
    
    # OAuth settings for Exchange Online
    oauth_enabled = models.BooleanField(
        default=False,
        verbose_name='OAuth Ingeschakeld'
    )
    oauth_client_id = models.CharField(
        max_length=255, 
        blank=True,
        verbose_name='OAuth Client ID'
    )
    oauth_client_secret = EncryptedCharField(
        max_length=512, 
        blank=True,
        verbose_name='OAuth Client Secret'
    )
    oauth_tenant_id = models.CharField(
        max_length=255, 
        blank=True,
        verbose_name='OAuth Tenant ID'
    )
    
    # Invoice settings
    invoice_payment_text = models.TextField(
        blank=True,
        default='Wij verzoeken u vriendelijk het totaalbedrag vóór de vervaldatum over te maken op bovenstaand IBAN onder vermelding van het factuurnummer.',
        verbose_name='Factuur Betalingstekst',
        help_text='Tekst die onderaan de factuur wordt getoond. Gebruik {bedrag}, {vervaldatum} en {factuurnummer} als variabelen.'
    )
    
    # Invoice numbering start values
    invoice_start_number_verkoop = models.PositiveIntegerField(
        default=1,
        verbose_name='Startnummer Verkoopfacturen',
        help_text='Nummer waarmee de telling begint voor verkoopfacturen (F-JAAR-XXXX)'
    )
    invoice_start_number_inkoop = models.PositiveIntegerField(
        default=1,
        verbose_name='Startnummer Inkoopfacturen',
        help_text='Nummer waarmee de telling begint voor inkoopfacturen (I-JAAR-XXXX)'
    )
    invoice_start_number_credit = models.PositiveIntegerField(
        default=1,
        verbose_name='Startnummer Creditfacturen',
        help_text='Nummer waarmee de telling begint voor creditfacturen (C-JAAR-XXXX)'
    )
    
    # AI Configuration for Invoice Extraction
    ai_provider = models.CharField(
        max_length=20,
        choices=[
            ('github', 'GitHub Models (Gratis)'),
            ('openai', 'OpenAI'),
            ('azure', 'Azure OpenAI'),
            ('none', 'Uitgeschakeld'),
        ],
        default='none',
        verbose_name='AI Provider',
        help_text='Kies welke AI provider gebruikt wordt voor factuur extractie'
    )
    ai_github_token = EncryptedCharField(
        max_length=512,
        blank=True,
        verbose_name='GitHub Token',
        help_text='GitHub Personal Access Token met "models" permissie (gratis)'
    )
    ai_openai_api_key = EncryptedCharField(
        max_length=512,
        blank=True,
        verbose_name='OpenAI API Key',
        help_text='OpenAI API key (betaald)'
    )
    ai_azure_endpoint = models.CharField(
        max_length=255,
        blank=True,
        verbose_name='Azure OpenAI Endpoint',
        help_text='Bijv: https://your-resource.openai.azure.com/'
    )
    ai_azure_api_key = EncryptedCharField(
        max_length=512,
        blank=True,
        verbose_name='Azure OpenAI API Key'
    )
    ai_azure_deployment = models.CharField(
        max_length=100,
        blank=True,
        default='gpt-4o-mini',
        verbose_name='Azure Deployment Name'
    )
    ai_model = models.CharField(
        max_length=50,
        default='gpt-4o-mini',
        verbose_name='AI Model',
        help_text='Model naam (bijv: gpt-4o-mini, gpt-4o)'
    )
    
    # Email signature
    email_signature = models.TextField(
        blank=True,
        default='',
        verbose_name='E-mail Handtekening',
        help_text='Handtekening die onderaan alle uitgaande e-mails wordt toegevoegd.'
    )
    
    # Reminder settings for driver document expiry
    reminder_enabled = models.BooleanField(
        default=False,
        verbose_name='Herinneringen Ingeschakeld',
        help_text='Schakel automatische herinneringen in voor verlopen chauffeursdocumenten.'
    )
    reminder_time = models.TimeField(
        default=time(8, 0),
        verbose_name='Verzendtijdstip',
        help_text='Tijdstip waarop herinneringen worden verstuurd.'
    )
    reminder_frequency = models.CharField(
        max_length=20,
        choices=[
            ('daily', 'Dagelijks'),
            ('weekdays', 'Werkdagen (ma-vr)'),
            ('weekly', 'Wekelijks'),
            ('custom', 'Aangepast'),
        ],
        default='daily',
        verbose_name='Frequentie',
        help_text='Hoe vaak herinneringen worden verstuurd.'
    )
    reminder_weekly_day = models.IntegerField(
        choices=[
            (0, 'Maandag'),
            (1, 'Dinsdag'),
            (2, 'Woensdag'),
            (3, 'Donderdag'),
            (4, 'Vrijdag'),
            (5, 'Zaterdag'),
            (6, 'Zondag'),
        ],
        default=0,
        verbose_name='Dag van de week',
        help_text='Op welke dag herinneringen worden verstuurd (bij wekelijkse frequentie).'
    )
    reminder_custom_days = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Aangepaste dagen',
        help_text='Op welke dagen herinneringen worden verstuurd (bij aangepaste frequentie).'
    )
    reminder_weeks_before = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Weken van tevoren',
        help_text='Hoeveel weken voor de verloopdatum herinneringen worden verstuurd.'
    )
    reminder_email = models.EmailField(
        blank=True,
        verbose_name='Ontvanger E-mail',
        help_text='E-mailadres waarnaar herinneringen worden verstuurd. Laat leeg voor bedrijfs-e-mail.'
    )
    reminder_signature = models.TextField(
        blank=True,
        default='',
        verbose_name='Herinnering Handtekening',
        help_text='Handtekening die onderaan herinneringsmails wordt toegevoegd.'
    )
    
    # Typography settings
    primary_font = models.ForeignKey(
        'CustomFont',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='primary_for_settings',
        verbose_name='Primair Font',
        help_text='Het hoofdfont voor de applicatie (koppen en tekst)'
    )
    secondary_font = models.ForeignKey(
        'CustomFont',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='secondary_for_settings',
        verbose_name='Secundair Font',
        help_text='Optioneel secundair font (voor accenten)'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'App Instellingen'
        verbose_name_plural = 'App Instellingen'
    
    def __str__(self):
        return self.app_name
    
    def save(self, *args, **kwargs):
        # Clear cache when settings are updated
        cache.delete('app_settings')
        super().save(*args, **kwargs)
    
    @classmethod
    def get_settings(cls):
        """
        Get the singleton settings instance.
        Uses caching for performance.
        """
        settings = cache.get('app_settings')
        if settings is None:
            settings, _ = cls.objects.get_or_create(pk=cls.get_default_pk())
            cache.set('app_settings', settings, 3600)  # Cache for 1 hour
        return settings
    
    @classmethod
    def get_default_pk(cls):
        """Get or create the default primary key for singleton."""
        return uuid.UUID('00000000-0000-0000-0000-000000000001')


class ReminderJobLog(models.Model):
    """
    Log of reminder cron job executions.
    Tracks when the job ran, status, and results.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    started_at = models.DateTimeField(auto_now_add=True, verbose_name='Gestart op')
    finished_at = models.DateTimeField(null=True, blank=True, verbose_name='Beëindigd op')
    status = models.CharField(
        max_length=20,
        choices=[
            ('success', 'Succesvol'),
            ('error', 'Fout'),
            ('warning', 'Waarschuwing'),
            ('skipped', 'Overgeslagen'),
        ],
        default='success',
        verbose_name='Status'
    )
    reminders_sent = models.IntegerField(default=0, verbose_name='Herinneringen verstuurd')
    message = models.TextField(blank=True, default='', verbose_name='Bericht')

    class Meta:
        verbose_name = 'Herinnering Job Log'
        verbose_name_plural = 'Herinnering Job Logs'
        ordering = ['-started_at']

    def __str__(self):
        return f'{self.started_at} - {self.status} ({self.reminders_sent} verstuurd)'


class ActivityType(models.TextChoices):
    """Types of activities that can be logged."""
    CREATED = 'created', 'Aangemaakt'
    UPDATED = 'updated', 'Bijgewerkt'
    DELETED = 'deleted', 'Verwijderd'
    SUBMITTED = 'submitted', 'Ingediend'
    APPROVED = 'approved', 'Goedgekeurd'
    REJECTED = 'rejected', 'Afgewezen'
    SENT = 'sent', 'Verzonden'
    LOGIN = 'login', 'Ingelogd'
    LOGOUT = 'logout', 'Uitgelogd'


class ActivityLog(models.Model):
    """
    Log of user activities in the system.
    Tracks who did what and when.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Who performed the action
    user = models.ForeignKey(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='activities',
        verbose_name='Gebruiker'
    )
    
    # What type of action
    action = models.CharField(
        max_length=20,
        choices=ActivityType.choices,
        verbose_name='Actie'
    )
    
    # What entity was affected
    entity_type = models.CharField(
        max_length=50,
        verbose_name='Entiteit type'
    )  # e.g., 'invoice', 'planning', 'user', 'leave_request'
    
    entity_id = models.CharField(
        max_length=100,
        blank=True,
        verbose_name='Entiteit ID'
    )
    
    # Human-readable description
    title = models.CharField(max_length=200, verbose_name='Titel')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    
    # Link to navigate to
    link = models.CharField(max_length=500, blank=True, verbose_name='Link')
    
    # Metadata
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP-adres')
    user_agent = models.TextField(blank=True, verbose_name='User Agent')
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Tijdstip')
    
    class Meta:
        verbose_name = 'Activiteit'
        verbose_name_plural = 'Activiteiten'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['entity_type', '-created_at']),
        ]
    
    def __str__(self):
        user_str = self.user.email if self.user else 'Systeem'
        return f"{user_str} - {self.get_action_display()} - {self.title}"
    
    @classmethod
    def log(cls, user, action, entity_type, title, description='', entity_id='', link='', request=None):
        """
        Convenience method to log an activity.
        
        Args:
            user: User who performed the action (can be None for system actions)
            action: ActivityType choice
            entity_type: Type of entity (e.g., 'invoice', 'planning')
            title: Short title for the activity
            description: Longer description
            entity_id: ID of the affected entity
            link: URL to navigate to the entity
            request: HTTP request object (to extract IP and user agent)
        """
        ip_address = None
        user_agent = ''
        
        if request:
            # Get IP address
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0].strip()
            else:
                ip_address = request.META.get('REMOTE_ADDR')
            
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        return cls.objects.create(
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else '',
            title=title,
            description=description,
            link=link,
            ip_address=ip_address,
            user_agent=user_agent,
        )
