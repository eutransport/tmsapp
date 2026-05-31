"""
Pakmiddelen Teruggavebonnen module.

Reads an IMAP mailbox once a day, matches mail subjects against a curated
list of fleet ritnummers and records whether a "pakmiddelen teruggavebon"
e-mail was received for each ritnummer that day. A daily report is sent to
configured recipients listing the ritnummers without a confirmation mail.
"""
import uuid
from datetime import time as dtime

from django.conf import settings
from django.db import models

from apps.core.models import EncryptedCharField


class PakmiddelenConfig(models.Model):
    """
    Singleton configuration for the pakmiddelen check.

    Exactly one row is expected; managed by `get_solo()`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Provider: classic IMAP or Microsoft Graph (OAuth2 client credentials)
    PROVIDER_IMAP = 'imap'
    PROVIDER_GRAPH = 'graph'
    PROVIDER_CHOICES = [
        (PROVIDER_IMAP, 'IMAP'),
        (PROVIDER_GRAPH, 'Microsoft Graph (OAuth2)'),
    ]
    provider = models.CharField(
        max_length=16,
        choices=PROVIDER_CHOICES,
        default=PROVIDER_IMAP,
        verbose_name='Mailprovider',
    )

    # IMAP connection
    imap_host = models.CharField(max_length=255, blank=True, verbose_name='IMAP Host')
    imap_port = models.PositiveIntegerField(default=993, verbose_name='IMAP Poort')
    imap_use_ssl = models.BooleanField(default=True, verbose_name='Gebruik SSL/TLS')
    imap_username = models.CharField(max_length=255, blank=True, verbose_name='IMAP Gebruikersnaam')
    imap_password = EncryptedCharField(max_length=512, blank=True, verbose_name='IMAP Wachtwoord')
    imap_folder = models.CharField(
        max_length=255,
        default='INBOX',
        verbose_name='IMAP Map',
        help_text='Bijvoorbeeld INBOX, INBOX/Pakmiddelen, etc.',
    )

    # Microsoft Graph (OAuth2 client credentials) — Mail.Read app permission
    graph_tenant_id = models.CharField(
        max_length=255, blank=True, verbose_name='Microsoft Tenant ID',
        help_text='Directory (tenant) ID uit Azure / Entra ID.',
    )
    graph_client_id = models.CharField(
        max_length=255, blank=True, verbose_name='Application (client) ID',
    )
    graph_client_secret = EncryptedCharField(
        max_length=1024, blank=True, verbose_name='Client Secret',
    )
    graph_client_secret_expires_at = models.DateField(
        null=True, blank=True, verbose_name='Vervaldatum client secret',
        help_text='Datum waarop het client secret verloopt. Herinneringen worden 30/14/7 dagen vooraf gestuurd.',
    )
    graph_secret_reminders_sent = models.JSONField(
        default=list, blank=True,
        verbose_name='Verzonden secret-herinneringen',
        help_text='Lijst van reeds verstuurde herinneringen (30/14/7) voor de huidige vervaldatum.',
    )
    graph_mailbox = models.CharField(
        max_length=255, blank=True, verbose_name='Mailbox (UPN of object-id)',
        help_text='Het postvak dat uitgelezen wordt (bijv. info@bedrijf.nl). Vereist Mail.Read app-permission.',
    )
    graph_folder = models.CharField(
        max_length=255, default='Inbox', blank=True, verbose_name='Mailmap',
        help_text='Naam van de well-known folder of het folder-id (Inbox, SentItems, etc.).',
    )

    # Subject matching
    subject_template = models.CharField(
        max_length=500,
        default='Pakmiddelen teruggavebon {ritnummer}',
        verbose_name='Onderwerp template',
        help_text='Gebruik {ritnummer} als placeholder voor het ritnummer.',
    )

    # Mark mails as seen after successful processing
    mark_as_read = models.BooleanField(
        default=True,
        verbose_name='Mails als gelezen markeren',
        help_text='Verwerkte mails worden in de mailbox als gelezen gemarkeerd.',
    )

    # Schedule
    enabled = models.BooleanField(default=False, verbose_name='Actief')
    schedule_time = models.TimeField(
        default=dtime(18, 0),
        verbose_name='Tijdstip dagelijkse controle',
        help_text='Tijdstip waarop de mailbox dagelijks wordt uitgelezen en de rapportmail wordt verstuurd.',
    )
    schedule_weekdays = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Actieve dagen',
        help_text=(
            'Lijst met weekdagen waarop de geplande controle mag draaien '
            '(0=maandag t/m 6=zondag). Leeg = elke dag.'
        ),
    )
    period_days = models.PositiveIntegerField(
        default=1,
        verbose_name='Periode (dagen)',
        help_text='Aantal dagen terug waarvoor mails worden uitgelezen vanaf vandaag.',
    )
    period_from_date = models.DateField(
        null=True,
        blank=True,
        verbose_name='Vanaf datum (optioneel)',
        help_text='Vaste startdatum. Indien gezet wordt deze gebruikt in plaats van Periode (dagen).',
    )

    # Notification (daily report)
    notification_recipients = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Ontvangers rapportmail',
        help_text='Lijst van e-mailadressen die het dagelijks overzicht ontvangen.',
    )
    notification_email_profile = models.ForeignKey(
        'core.EmailProfile',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='pakmiddelen_configs',
        verbose_name='Verzend-profiel (SMTP)',
        help_text='Optioneel SMTP-profiel. Standaard wordt het standaard profiel gebruikt.',
    )

    # Run tracking
    last_run_at = models.DateTimeField(null=True, blank=True, verbose_name='Laatste run')
    last_run_status = models.CharField(max_length=50, blank=True, verbose_name='Laatste status')
    last_run_message = models.TextField(blank=True, verbose_name='Laatste run melding')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
        verbose_name='Laatst gewijzigd door',
    )

    class Meta:
        verbose_name = 'Pakmiddelen Configuratie'
        verbose_name_plural = 'Pakmiddelen Configuratie'

    def __str__(self):
        return 'Pakmiddelen Configuratie'

    @classmethod
    def get_solo(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


class PakmiddelenRitnummerSelection(models.Model):
    """A ritnummer (optionally linked to a Vehicle) that should be monitored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ritnummer = models.CharField(max_length=50, verbose_name='Ritnummer')
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='pakmiddelen_selections',
        verbose_name='Voertuig',
    )
    actief = models.BooleanField(default=True, verbose_name='Actief')
    notitie = models.CharField(max_length=255, blank=True, verbose_name='Notitie')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Pakmiddelen Ritnummer'
        verbose_name_plural = 'Pakmiddelen Ritnummers'
        ordering = ['ritnummer']
        constraints = [
            models.UniqueConstraint(
                fields=['ritnummer'],
                name='unique_pakmiddelen_ritnummer',
            ),
        ]

    def __str__(self):
        return self.ritnummer


class PakmiddelenCheckResult(models.Model):
    """Result of one ritnummer-check on one date."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    check_date = models.DateField(verbose_name='Controledatum', db_index=True)
    ritnummer = models.CharField(max_length=50, verbose_name='Ritnummer', db_index=True)
    has_bon = models.BooleanField(default=False, verbose_name='Pakmiddelen teruggavebon ontvangen')
    matched_subject = models.CharField(max_length=500, blank=True, verbose_name='Onderwerp')
    mail_message_id = models.CharField(max_length=255, blank=True, verbose_name='Mail Message-ID')
    mail_received_at = models.DateTimeField(null=True, blank=True, verbose_name='Mail ontvangen op')
    notification_sent = models.BooleanField(default=False, verbose_name='Rapportmail verstuurd')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Pakmiddelen Resultaat'
        verbose_name_plural = 'Pakmiddelen Resultaten'
        ordering = ['-check_date', 'ritnummer']
        constraints = [
            models.UniqueConstraint(
                fields=['check_date', 'ritnummer'],
                name='unique_pakmiddelen_result_per_day',
            ),
        ]

    def __str__(self):
        marker = 'JA' if self.has_bon else 'NEE'
        return f'{self.check_date} {self.ritnummer} [{marker}]'


class PakmiddelenAuditLog(models.Model):
    """Audit trail for sensitive actions (config edits, manual runs, tests)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField(max_length=64, verbose_name='Actie')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Pakmiddelen Audit Log'
        verbose_name_plural = 'Pakmiddelen Audit Logs'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.created_at:%Y-%m-%d %H:%M} {self.action}'


class PakmiddelenMailLog(models.Model):
    """Audit log of every e-mail sent from the pakmiddelen module.

    Captures the recipients, subject, type of mail (daily report, overview,
    secret-expiry, test, ...) and whether the send call succeeded so the
    user can review the history of outgoing mails.
    """

    TYPE_DAILY_REPORT = 'daily_report'
    TYPE_OVERVIEW = 'overview'
    TYPE_TEST = 'test'
    TYPE_SECRET_EXPIRY = 'secret_expiry'
    TYPE_CHOICES = [
        (TYPE_DAILY_REPORT, 'Dagelijks rapport'),
        (TYPE_OVERVIEW, 'Overzicht'),
        (TYPE_TEST, 'Testmail'),
        (TYPE_SECRET_EXPIRY, 'Secret-expiratie herinnering'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sent_at = models.DateTimeField(auto_now_add=True, db_index=True, verbose_name='Verzonden op')
    mail_type = models.CharField(
        max_length=32, choices=TYPE_CHOICES, default=TYPE_DAILY_REPORT,
        db_index=True, verbose_name='Type mail',
    )
    recipients = models.JSONField(default=list, blank=True, verbose_name='Ontvangers')
    subject = models.CharField(max_length=500, blank=True, verbose_name='Onderwerp')
    success = models.BooleanField(default=False, db_index=True, verbose_name='Succesvol')
    message = models.TextField(blank=True, verbose_name='Melding / fout')
    related_date = models.DateField(null=True, blank=True, verbose_name='Gerelateerde datum')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
        verbose_name='Gestart door',
    )

    class Meta:
        verbose_name = 'Pakmiddelen Mail Log'
        verbose_name_plural = 'Pakmiddelen Mail Logs'
        ordering = ['-sent_at']

    def __str__(self):
        marker = 'OK' if self.success else 'FAIL'
        return f'{self.sent_at:%Y-%m-%d %H:%M} {self.mail_type} [{marker}]'
