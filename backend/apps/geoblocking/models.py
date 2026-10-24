"""
Datamodellen voor geo-blocking.

Het model bestaat uit vier delen:

* ``GeoBlockSettings`` - eenmalige instellingen (aan/uit, monitor of blokkeren).
* ``IPRule``           - uitzonderingen op IP/CIDR-niveau, hoogste prioriteit.
* ``GeoRule``          - regels per land en per rol.
* ``GeoAccessLog``     - wat er is toegestaan of geweigerd, voor analyse.

De volgorde van beoordelen is bewust: eerst IP-regels (zodat een vast
kantoor-IP altijd werkt), daarna land/rol-regels, en pas als niets matcht de
standaardactie.
"""
from django.conf import settings
from django.db import models


class RuleAction(models.TextChoices):
    ALLOW = 'allow', 'Toestaan'
    BLOCK = 'block', 'Blokkeren'


class EnforcementMode(models.TextChoices):
    MONITOR = 'monitor', 'Alleen loggen (niets blokkeren)'
    ENFORCE = 'enforce', 'Actief blokkeren'


# De rollen uit accounts.UserRole, aangevuld met twee bijzondere waarden.
ROLE_ANY = '*'
ROLE_ANONYMOUS = 'anonymous'

ROLE_CHOICES = [
    (ROLE_ANY, 'Alle rollen'),
    (ROLE_ANONYMOUS, 'Niet ingelogd'),
    ('admin', 'Admin'),
    ('gebruiker', 'Gebruiker'),
    ('chauffeur', 'Chauffeur'),
    ('opdrachtgever', 'Opdrachtgever'),
]

COUNTRY_ANY = '*'


class GeoBlockSettings(models.Model):
    """Globale instellingen. Er bestaat altijd precies één rij (pk=1)."""

    enabled = models.BooleanField(
        default=False,
        help_text='Geo-blocking in zijn geheel aan of uit.',
    )
    mode = models.CharField(
        max_length=16,
        choices=EnforcementMode.choices,
        default=EnforcementMode.MONITOR,
        help_text='In monitormodus wordt alleen gelogd wat er geblokkeerd zou worden.',
    )
    default_action = models.CharField(
        max_length=8,
        choices=RuleAction.choices,
        default=RuleAction.ALLOW,
        help_text='Wat te doen als geen enkele regel van toepassing is.',
    )
    block_unknown_country = models.BooleanField(
        default=False,
        help_text='Blokkeer verzoeken waarvan het land niet bepaald kan worden.',
    )
    allow_superuser_bypass = models.BooleanField(
        default=True,
        help_text='Superusers nooit blokkeren. Voorkomt dat je jezelf buitensluit.',
    )
    log_allowed = models.BooleanField(
        default=False,
        help_text='Ook toegestane verzoeken loggen. Levert veel regels op.',
    )
    log_retention_days = models.PositiveIntegerField(
        default=30,
        help_text='Logregels ouder dan dit aantal dagen worden opgeruimd.',
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='geoblock_settings_updates',
    )

    class Meta:
        verbose_name = 'Geo-blocking instelling'
        verbose_name_plural = 'Geo-blocking instellingen'

    def __str__(self):
        return f'Geo-blocking ({"aan" if self.enabled else "uit"}, {self.get_mode_display()})'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class IPRule(models.Model):
    """
    Uitzondering op IP- of CIDR-niveau.

    Wordt vóór de landregels beoordeeld, zodat een vast kantoor- of VPN-adres
    altijd binnenkomt, ongeacht welk land eraan gekoppeld is.
    """

    cidr = models.CharField(
        max_length=64,
        unique=True,
        help_text='Eén IP (203.0.113.5) of een reeks (203.0.113.0/24).',
    )
    action = models.CharField(max_length=8, choices=RuleAction.choices, default=RuleAction.ALLOW)
    label = models.CharField(max_length=120, blank=True, help_text='Bijvoorbeeld "Kantoor Ede".')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='geoblock_ip_rules',
    )

    class Meta:
        ordering = ['cidr']
        verbose_name = 'IP-regel'
        verbose_name_plural = 'IP-regels'

    def __str__(self):
        return f'{self.cidr} -> {self.get_action_display()}'


class GeoRule(models.Model):
    """
    Regel per land en rol.

    ``country_code`` is een ISO-landcode van twee letters, of ``*`` voor elk
    land. ``role`` is een rol uit accounts, ``anonymous`` voor niet-ingelogde
    bezoekers, of ``*`` voor elke rol.
    """

    country_code = models.CharField(
        max_length=8,
        help_text='ISO-landcode zoals NL, DE, BE. Gebruik * voor alle landen.',
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_ANY)
    action = models.CharField(max_length=8, choices=RuleAction.choices, default=RuleAction.ALLOW)
    priority = models.IntegerField(
        default=100,
        help_text='Lager getal wordt eerder beoordeeld.',
    )
    active = models.BooleanField(default=True)
    notes = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='geoblock_rules',
    )

    class Meta:
        ordering = ['priority', 'country_code']
        constraints = [
            models.UniqueConstraint(
                fields=['country_code', 'role'],
                name='uniek_land_rol',
            )
        ]
        verbose_name = 'Landregel'
        verbose_name_plural = 'Landregels'

    def __str__(self):
        return f'{self.country_code}/{self.role} -> {self.get_action_display()}'

    def save(self, *args, **kwargs):
        if self.country_code:
            self.country_code = self.country_code.strip().upper()
        super().save(*args, **kwargs)


class LogDecision(models.TextChoices):
    ALLOWED = 'allowed', 'Toegestaan'
    BLOCKED = 'blocked', 'Geblokkeerd'
    WOULD_BLOCK = 'would_block', 'Zou geblokkeerd zijn'


class GeoAccessLog(models.Model):
    """Registratie van beoordeelde verzoeken, voor analyse en bewijs."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    country_code = models.CharField(max_length=8, blank=True, db_index=True)
    role = models.CharField(max_length=20, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='geoblock_logs',
    )
    path = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=10, blank=True)
    decision = models.CharField(max_length=16, choices=LogDecision.choices, db_index=True)
    reason = models.CharField(max_length=200, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Toegangslog'
        verbose_name_plural = 'Toegangslogs'
        indexes = [
            models.Index(fields=['-created_at', 'decision']),
        ]

    def __str__(self):
        return f'{self.created_at:%Y-%m-%d %H:%M} {self.ip_address} {self.decision}'
