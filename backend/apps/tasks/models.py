"""
Taken-module: persoonlijke en toegewezen takenlijst met reminders.
"""
import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class TaskStatus(models.TextChoices):
    NIEUW = 'nieuw', 'Nieuw'
    IN_BEHANDELING = 'in_behandeling', 'In behandeling'
    AFGEROND = 'afgerond', 'Afgerond'


class TaskPriority(models.TextChoices):
    LAAG = 'laag', 'Laag'
    NORMAAL = 'normaal', 'Normaal'
    HOOG = 'hoog', 'Hoog'


class Task(models.Model):
    """Een taak, aangemaakt door een gebruiker en toegewezen aan (mogelijk) een ander."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    titel = models.CharField(max_length=255, verbose_name='Titel')
    omschrijving = models.TextField(blank=True, verbose_name='Omschrijving')

    status = models.CharField(
        max_length=20,
        choices=TaskStatus.choices,
        default=TaskStatus.NIEUW,
        verbose_name='Status',
    )
    prioriteit = models.CharField(
        max_length=10,
        choices=TaskPriority.choices,
        default=TaskPriority.NORMAAL,
        verbose_name='Prioriteit',
    )

    aangemaakt_door = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_tasks',
        verbose_name='Aangemaakt door',
    )
    toegewezen_aan = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='assigned_tasks',
        verbose_name='Toegewezen aan',
    )

    vervaldatum = models.DateField(null=True, blank=True, verbose_name='Vervaldatum')

    # Reminder-bookkeeping
    status_changed_at = models.DateTimeField(default=timezone.now, verbose_name='Status gewijzigd op')
    last_activity_at = models.DateTimeField(default=timezone.now, verbose_name='Laatste activiteit op')
    last_reminder_sent_at = models.DateTimeField(null=True, blank=True, verbose_name='Laatste reminder op')
    afgerond_op = models.DateTimeField(null=True, blank=True, verbose_name='Afgerond op')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Taak'
        verbose_name_plural = 'Taken'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['toegewezen_aan', 'status']),
            models.Index(fields=['aangemaakt_door', 'status']),
        ]

    def __str__(self):
        return self.titel

    @property
    def is_open(self) -> bool:
        return self.status != TaskStatus.AFGEROND

    def touch_activity(self):
        """Markeer dat er iets met de taak is gebeurd (reset de stilte-timer)."""
        self.last_activity_at = timezone.now()


class TaskNote(models.Model):
    """Notitie onder een taak (wat is er nodig om de taak uit te voeren)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='notes')
    auteur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='task_notes',
        verbose_name='Auteur',
    )
    tekst = models.TextField(verbose_name='Notitie')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Taaknotitie'
        verbose_name_plural = 'Taaknotities'
        ordering = ['created_at']

    def __str__(self):
        return f"Notitie bij {self.task_id}"


class TaskActivity(models.Model):
    """Audit-log: wie deed wat met een taak (status, toewijzing, ...)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='task_activities',
    )
    actie = models.CharField(max_length=255, verbose_name='Actie')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Taakactiviteit'
        verbose_name_plural = 'Taakactiviteiten'
        ordering = ['-created_at']

    def __str__(self):
        return self.actie


class TaskReminderSettings(models.Model):
    """Singleton met instelbare reminder-regels voor de takenmodule."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Dagelijkse herinnering voor openstaande/nieuwe taken
    daily_reminder_enabled = models.BooleanField(
        default=True, verbose_name='Dagelijkse herinnering aan'
    )
    daily_reminder_hour = models.PositiveSmallIntegerField(
        default=9, verbose_name='Uur dagelijkse herinnering (0-23)'
    )
    daily_reminder_minute = models.PositiveSmallIntegerField(
        default=0, verbose_name='Minuut dagelijkse herinnering (0-59)'
    )
    # Op welke weekdagen de dagelijkse herinnering mag versturen (0=ma ... 6=zo)
    daily_reminder_weekdays = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Weekdagen dagelijkse herinnering',
        help_text='Lijst van weekdagen (0=maandag ... 6=zondag). Leeg = elke dag.',
    )

    # "In behandeling" maar X dagen geen activiteit -> herinnering
    stale_reminder_enabled = models.BooleanField(
        default=True, verbose_name='Herinnering bij stilstand aan'
    )
    stale_after_days = models.PositiveSmallIntegerField(
        default=2, verbose_name='Aantal dagen stilstand voor herinnering'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Taken reminder-instellingen'
        verbose_name_plural = 'Taken reminder-instellingen'

    def __str__(self):
        return 'Taken reminder-instellingen'

    @classmethod
    def get_settings(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj
