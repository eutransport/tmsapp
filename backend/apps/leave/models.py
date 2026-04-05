"""
Leave management models.
Handles employee leave balance, leave requests, public holidays, and global settings.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator


class LeaveType(models.TextChoices):
    """Types of leave that can be requested."""
    VAKANTIE = 'vakantie', 'Vakantie'
    OVERUREN = 'overuren', 'Verlof overuren'
    BIJZONDER_TANDARTS = 'bijzonder_tandarts', 'Bijzonder verlof tandarts'
    BIJZONDER_HUISARTS = 'bijzonder_huisarts', 'Bijzonder verlof huisarts'
    ZIEKTEVERZUIM = 'ziekteverzuim', 'Ziekteverzuim'


class LeaveRequestStatus(models.TextChoices):
    """Status of a leave request."""
    PENDING = 'pending', 'In afwachting'
    APPROVED = 'approved', 'Goedgekeurd'
    REJECTED = 'rejected', 'Afgewezen'
    CANCELLED = 'cancelled', 'Geannuleerd'


class GlobalLeaveSettings(models.Model):
    """
    Global settings for leave management.
    Only one record should exist (singleton pattern).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Default hours for new employees
    default_leave_hours = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=Decimal('216.00'),
        verbose_name='Standaard verlofuren nieuwe medewerker'
    )
    
    # Standard work week hours
    standard_work_week_hours = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('40.00'),
        verbose_name='Standaard werkweek uren'
    )
    
    # Percentage of overtime that can be taken as leave
    overtime_leave_percentage = models.PositiveIntegerField(
        default=50,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        verbose_name='Percentage overuren opneembaar als verlof'
    )
    
    # Maximum concurrent employees on leave before warning
    max_concurrent_leave = models.PositiveIntegerField(
        default=2,
        verbose_name='Max gelijktijdig verlof (waarschuwing)'
    )
    
    # Free special leave hours per month
    free_special_leave_hours_per_month = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal('1.00'),
        verbose_name='Gratis bijzonder verlof uren per maand'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Globale verlof instelling'
        verbose_name_plural = 'Globale verlof instellingen'
    
    def save(self, *args, **kwargs):
        # Ensure only one instance exists
        if not self.pk and GlobalLeaveSettings.objects.exists():
            raise ValueError('Er kan maar één GlobalLeaveSettings record bestaan.')
        super().save(*args, **kwargs)
    
    @classmethod
    def get_settings(cls):
        """Get or create the singleton settings instance."""
        settings_obj, _ = cls.objects.get_or_create(
            pk=cls.objects.first().pk if cls.objects.exists() else None,
            defaults={}
        )
        return settings_obj
    
    def __str__(self):
        return 'Globale Verlof Instellingen'


class LeaveBalance(models.Model):
    """
    Leave balance per employee.
    Tracks vacation hours and overtime hours.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='leave_balance',
        verbose_name='Medewerker'
    )
    
    # Vacation leave hours (can be set by admin)
    vacation_hours = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        default=Decimal('216.00'),
        verbose_name='Verlofuren'
    )
    
    # Overtime hours (calculated automatically)
    overtime_hours = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Overuren'
    )
    
    # Track special leave used per month (for the free hour calculation)
    # Format: {"2026-01": 0.5, "2026-02": 1.0}
    special_leave_used = models.JSONField(
        default=dict,
        blank=True,
        verbose_name='Bijzonder verlof gebruikt per maand'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Verlofsaldo'
        verbose_name_plural = "Verlofsaldo's"
        ordering = ['user__achternaam', 'user__voornaam']
    
    def __str__(self):
        return f"{self.user.full_name} - Verlof: {self.vacation_hours}u, Overuren: {self.overtime_hours}u"
    
    @property
    def available_overtime_for_leave(self):
        """Calculate how many overtime hours can be taken as leave."""
        settings_obj = GlobalLeaveSettings.get_settings()
        percentage = Decimal(settings_obj.overtime_leave_percentage) / Decimal('100')
        return self.overtime_hours * percentage
    
    def get_free_special_leave_remaining(self, year_month: str) -> Decimal:
        """
        Get remaining free special leave hours for a specific month.
        year_month format: "2026-01"
        """
        settings_obj = GlobalLeaveSettings.get_settings()
        free_hours = settings_obj.free_special_leave_hours_per_month
        used_hours = Decimal(str(self.special_leave_used.get(year_month, 0)))
        return max(Decimal('0'), free_hours - used_hours)
    
    def add_overtime(self, hours: Decimal):
        """Add overtime hours to balance."""
        self.overtime_hours += hours
        self.save(update_fields=['overtime_hours', 'updated_at'])
    
    def deduct_vacation(self, hours: Decimal):
        """Deduct vacation hours from balance."""
        self.vacation_hours -= hours
        self.save(update_fields=['vacation_hours', 'updated_at'])
    
    def deduct_overtime(self, hours: Decimal):
        """Deduct overtime hours from balance."""
        self.overtime_hours -= hours
        self.save(update_fields=['overtime_hours', 'updated_at'])
    
    def add_special_leave_used(self, year_month: str, hours: Decimal):
        """Track special leave usage for a month."""
        current = Decimal(str(self.special_leave_used.get(year_month, 0)))
        self.special_leave_used[year_month] = str(current + hours)
        self.save(update_fields=['special_leave_used', 'updated_at'])


class LeaveRequest(models.Model):
    """
    Leave request from an employee.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='leave_requests',
        verbose_name='Medewerker'
    )
    
    leave_type = models.CharField(
        max_length=30,
        choices=LeaveType.choices,
        verbose_name='Type verlof'
    )
    
    start_date = models.DateField(verbose_name='Startdatum')
    end_date = models.DateField(verbose_name='Einddatum')
    
    # Hours requested (calculated or entered)
    hours_requested = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        verbose_name='Uren aangevraagd'
    )
    
    # Description / reason (optional)
    reason = models.TextField(
        blank=True,
        verbose_name='Reden / opmerking'
    )
    
    status = models.CharField(
        max_length=20,
        choices=LeaveRequestStatus.choices,
        default=LeaveRequestStatus.PENDING,
        verbose_name='Status'
    )
    
    # Admin response
    admin_comment = models.TextField(
        blank=True,
        verbose_name='Admin opmerking'
    )
    
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_leave_requests',
        verbose_name='Beoordeeld door'
    )
    
    reviewed_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Beoordeeld op'
    )
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Aangevraagd op')
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Verlofaanvraag'
        verbose_name_plural = 'Verlofaanvragen'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.user.full_name} - {self.get_leave_type_display()} ({self.start_date} t/m {self.end_date})"
    
    @property
    def is_pending(self):
        return self.status == LeaveRequestStatus.PENDING
    
    @property
    def is_approved(self):
        return self.status == LeaveRequestStatus.APPROVED
    
    @property
    def is_special_leave(self):
        return self.leave_type in [LeaveType.BIJZONDER_TANDARTS, LeaveType.BIJZONDER_HUISARTS]
    
    def get_month_key(self) -> str:
        """Get the year-month key for special leave tracking."""
        return self.start_date.strftime('%Y-%m')
    
    def calculate_deductions(self):
        """
        Calculate how hours should be deducted based on leave type.
        Returns dict with 'vacation_deduct', 'overtime_deduct', 'special_free'
        
        Bijzonder verlof (tandarts/huisarts) and ziekteverzuim do NOT deduct
        hours from the employee's balance.
        """
        result = {
            'vacation_deduct': Decimal('0'),
            'overtime_deduct': Decimal('0'),
            'special_free': Decimal('0'),
        }
        
        if self.leave_type == LeaveType.VAKANTIE:
            result['vacation_deduct'] = self.hours_requested
            
        elif self.leave_type == LeaveType.OVERUREN:
            result['overtime_deduct'] = self.hours_requested
            
        elif self.is_special_leave:
            # Bijzonder verlof: no deduction from balance
            result['special_free'] = self.hours_requested
        
        # Ziekteverzuim: no deductions (result stays all zeros)
        
        return result


class PublicHoliday(models.Model):
    """
    Public holidays (feestdagen).
    Auto-generated for Dutch national holidays per year.
    These days are excluded from leave calculations.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(verbose_name='Datum', unique=True)
    name = models.CharField(max_length=100, verbose_name='Naam')
    year = models.IntegerField(verbose_name='Jaar', db_index=True)

    class Meta:
        verbose_name = 'Feestdag'
        verbose_name_plural = 'Feestdagen'
        ordering = ['date']

    def __str__(self):
        return f"{self.name} ({self.date})"

    @staticmethod
    def _easter(year):
        """Calculate Easter Sunday using the Anonymous Gregorian algorithm."""
        a = year % 19
        b, c = divmod(year, 100)
        d, e = divmod(b, 4)
        f = (b + 8) // 25
        g = (b - f + 1) // 3
        h = (19 * a + b - d - g + 15) % 30
        i, k = divmod(c, 4)
        l = (32 + 2 * e + 2 * i - h - k) % 7
        m = (a + 11 * h + 22 * l) // 451
        month = (h + l - 7 * m + 114) // 31
        day = ((h + l - 7 * m + 114) % 31) + 1
        return date(year, month, day)

    @classmethod
    def get_dutch_holidays(cls, year):
        """Return a list of (date, name) tuples for Dutch national holidays."""
        easter = cls._easter(year)
        return [
            (date(year, 1, 1), "Nieuwjaarsdag"),
            (easter - timedelta(days=2), "Goede Vrijdag"),
            (easter, "Eerste Paasdag"),
            (easter + timedelta(days=1), "Tweede Paasdag"),
            (date(year, 4, 27), "Koningsdag"),
            (date(year, 5, 5), "Bevrijdingsdag"),
            (easter + timedelta(days=39), "Hemelvaartsdag"),
            (easter + timedelta(days=49), "Eerste Pinksterdag"),
            (easter + timedelta(days=50), "Tweede Pinksterdag"),
            (date(year, 12, 25), "Eerste Kerstdag"),
            (date(year, 12, 26), "Tweede Kerstdag"),
        ]

    @classmethod
    def ensure_year(cls, year):
        """Create holiday records for a year if they don't exist yet."""
        if cls.objects.filter(year=year).exists():
            return
        holidays = cls.get_dutch_holidays(year)
        cls.objects.bulk_create([
            cls(date=d, name=name, year=year)
            for d, name in holidays
        ], ignore_conflicts=True)

    @classmethod
    def get_holiday_dates(cls, start_date, end_date):
        """Return a set of holiday dates in the given range."""
        for y in range(start_date.year, end_date.year + 1):
            cls.ensure_year(y)
        return set(
            cls.objects.filter(
                date__gte=start_date, date__lte=end_date
            ).values_list('date', flat=True)
        )

    @classmethod
    def count_work_days(cls, start_date, end_date):
        """Count work days between two dates, excluding weekends and holidays."""
        holidays = cls.get_holiday_dates(start_date, end_date)
        work_days = 0
        current = start_date
        while current <= end_date:
            if current.weekday() < 5 and current not in holidays:
                work_days += 1
            current += timedelta(days=1)
        return work_days
