import logging
from datetime import timedelta
from decimal import Decimal
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db.models import Sum, Count, Q, Max

from .models import TimeEntry, TimeEntryStatus, WeeklyMinimumHours
from .serializers import TimeEntrySerializer, WeeklyMinimumHoursSerializer

logger = logging.getLogger('accounts.security')


class TimeEntryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for TimeEntry CRUD operations.
    - Users can only see/edit their own entries
    - Admins can see all entries
    - Submitted entries cannot be edited by users (only admins)
    """
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['status', 'weeknummer', 'ritnummer', 'datum']
    search_fields = ['ritnummer', 'kenteken', 'user__voornaam', 'user__achternaam', 'user__email']
    ordering_fields = ['datum', 'weeknummer', 'created_at']
    ordering = ['-datum', '-aanvang']
    
    def get_queryset(self):
        user = self.request.user
        queryset = TimeEntry.objects.select_related('user')
        
        # Admins and managers see ALL entries (including concept), others see only their own
        if user.is_superuser or user.rol in ['admin', 'gebruiker']:
            # Admins can see all entries (concept and submitted)
            # Filter by user if provided
            user_filter = self.request.query_params.get('user')
            status_filter = self.request.query_params.get('status')
            
            if user_filter:
                # If filtering by specific user, show all their entries
                queryset = queryset.filter(user_id=user_filter)
            
            # If explicit status filter, apply it
            if status_filter:
                queryset = queryset.filter(status=status_filter)
            # No default filter - admins see all statuses
        else:
            # Chauffeurs only see their own (all statuses)
            queryset = queryset.filter(user=user)
        
        # Filter by year if provided
        jaar = self.request.query_params.get('jaar')
        if jaar:
            queryset = queryset.filter(datum__year=int(jaar))
        
        # Filter by date range if provided
        datum_gte = self.request.query_params.get('datum__gte')
        datum_lte = self.request.query_params.get('datum__lte')
        if datum_gte:
            queryset = queryset.filter(datum__gte=datum_gte)
        if datum_lte:
            queryset = queryset.filter(datum__lte=datum_lte)
        
        # Filter by week number range if provided
        weeknummer_gte = self.request.query_params.get('weeknummer__gte')
        weeknummer_lte = self.request.query_params.get('weeknummer__lte')
        if weeknummer_gte:
            queryset = queryset.filter(weeknummer__gte=int(weeknummer_gte))
        if weeknummer_lte:
            queryset = queryset.filter(weeknummer__lte=int(weeknummer_lte))
        
        return queryset
    
    def perform_create(self, serializer):
        entry = serializer.save(user=self.request.user)
        logger.info(
            f"TimeEntry created: {entry.ritnummer} on {entry.datum} by {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        instance = self.get_object()
        
        # Only admins can edit submitted entries
        if instance.status == TimeEntryStatus.INGEDIEND:
            if not (self.request.user.is_superuser or self.request.user.rol == 'admin'):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Ingediende uren kunnen alleen door een admin worden aangepast.')
        
        # Users can only edit their own entries
        if instance.user != self.request.user:
            if not (self.request.user.is_superuser or self.request.user.rol in ['admin', 'gebruiker']):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Je kunt alleen je eigen uren bewerken.')
        
        entry = serializer.save()
        logger.info(
            f"TimeEntry updated: {entry.ritnummer} on {entry.datum} by {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        # Only admins can delete submitted entries
        if instance.status == TimeEntryStatus.INGEDIEND:
            if not (self.request.user.is_superuser or self.request.user.rol == 'admin'):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Ingediende uren kunnen alleen door een admin worden verwijderd.')
        
        # Users can only delete their own entries
        if instance.user != self.request.user:
            if not (self.request.user.is_superuser or self.request.user.rol in ['admin', 'gebruiker']):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Je kunt alleen je eigen uren verwijderen.')
        
        logger.warning(
            f"TimeEntry deleted: {instance.ritnummer} on {instance.datum} by {self.request.user.email}"
        )
        instance.delete()
    
    @action(detail=False, methods=['post'])
    def submit_week(self, request):
        """Submit all concept entries for a specific week."""
        weeknummer = request.data.get('weeknummer')
        jaar = request.data.get('jaar')
        
        if not weeknummer:
            return Response({'error': 'Weeknummer is verplicht.'}, status=status.HTTP_400_BAD_REQUEST)
        
        entries = TimeEntry.objects.filter(
            user=request.user,
            weeknummer=weeknummer,
            status=TimeEntryStatus.CONCEPT
        )
        
        if jaar:
            entries = entries.filter(datum__year=int(jaar))
        
        if not entries.exists():
            return Response(
                {'error': 'Geen concept uren gevonden voor deze week.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        count = entries.update(status=TimeEntryStatus.INGEDIEND)
        
        logger.info(
            f"Week {weeknummer} submitted: {count} entries by {request.user.email}"
        )
        
        # Calculate and add overtime to leave balance
        overtime_added = None
        try:
            from apps.leave.signals import update_user_overtime
            jaar_int = int(jaar) if jaar else entries.first().datum.year
            overtime = update_user_overtime(request.user, weeknummer, jaar_int)
            if overtime > 0:
                overtime_added = str(overtime)
                logger.info(f"Overtime added: {overtime}h for {request.user.email}")
        except Exception as e:
            logger.warning(f"Could not calculate overtime: {e}")
        
        response_data = {
            'message': f'{count} uren ingediend voor week {weeknummer}.',
            'count': count
        }
        if overtime_added:
            response_data['overtime_added'] = overtime_added
        
        return Response(response_data)
    
    @action(detail=False, methods=['get'])
    def week_summary(self, request):
        """Get summary for a specific week."""
        weeknummer = request.query_params.get('weeknummer')
        jaar = request.query_params.get('jaar')
        user_id = request.query_params.get('user')
        
        if not weeknummer:
            return Response({'error': 'Weeknummer is verplicht.'}, status=status.HTTP_400_BAD_REQUEST)
        
        queryset = TimeEntry.objects.filter(weeknummer=weeknummer)
        
        if jaar:
            queryset = queryset.filter(datum__year=int(jaar))
        
        # Filter by user based on permissions
        if request.user.is_superuser or request.user.rol in ['admin', 'gebruiker']:
            if user_id:
                queryset = queryset.filter(user_id=user_id)
        else:
            queryset = queryset.filter(user=request.user)
        
        # Calculate totals
        from datetime import timedelta
        entries = list(queryset)
        
        totaal_km = sum(e.totaal_km for e in entries)
        totaal_uren = sum((e.totaal_uren for e in entries), timedelta())
        
        # Format hours
        total_seconds = int(totaal_uren.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        
        concept_count = sum(1 for e in entries if e.status == TimeEntryStatus.CONCEPT)
        ingediend_count = sum(1 for e in entries if e.status == TimeEntryStatus.INGEDIEND)
        
        return Response({
            'weeknummer': weeknummer,
            'totaal_entries': len(entries),
            'concept_count': concept_count,
            'ingediend_count': ingediend_count,
            'totaal_km': totaal_km,
            'totaal_uren': f"{hours}:{minutes:02d}",
            'kan_indienen': concept_count > 0,
        })
    
    @action(detail=False, methods=['get'])
    def driver_report(self, request):
        """
        Get a driver's history report showing weeks and days with routes.
        Only accessible by admins.
        Returns a matrix of weeks x days with route information.
        """
        user = request.user
        
        # Security: Only admins can access this endpoint
        if not (user.is_superuser or user.rol == 'admin'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Alleen admins hebben toegang tot deze functie.')
        
        driver_id = request.query_params.get('driver_id')
        if not driver_id:
            return Response({'error': 'driver_id is verplicht'}, status=400)
        
        # Get driver info
        from apps.accounts.models import User
        try:
            driver = User.objects.get(id=driver_id)
        except User.DoesNotExist:
            return Response({'error': 'Chauffeur niet gevonden'}, status=404)
        
        # Get all submitted entries for this driver
        entries = TimeEntry.objects.filter(
            user_id=driver_id,
            status=TimeEntryStatus.INGEDIEND
        ).order_by('-datum')
        
        # Group by week
        weeks_data = {}
        for entry in entries:
            jaar = entry.datum.year
            week = entry.weeknummer
            weekday = entry.datum.weekday()  # 0=Monday, 4=Friday
            
            week_key = f"{jaar}-W{week:02d}"
            
            if week_key not in weeks_data:
                weeks_data[week_key] = {
                    'jaar': jaar,
                    'weeknummer': week,
                    'dagen': {
                        'ma': [],
                        'di': [],
                        'wo': [],
                        'do': [],
                        'vr': [],
                        'za': [],
                        'zo': [],
                    }
                }
            
            day_map = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
            dag = day_map[weekday]
            
            weeks_data[week_key]['dagen'][dag].append({
                'ritnummer': entry.ritnummer,
                'kenteken': entry.kenteken,
                'km': entry.totaal_km,
                'uren': str(entry.totaal_uren) if entry.totaal_uren else '0:00',
            })
        
        # Sort weeks descending
        sorted_weeks = sorted(weeks_data.values(), key=lambda x: (x['jaar'], x['weeknummer']), reverse=True)
        
        return Response({
            'driver': {
                'id': str(driver.id),
                'naam': driver.full_name,
                'email': driver.email,
            },
            'weeks': sorted_weeks,
        })
    
    @action(detail=False, methods=['get'])
    def history(self, request):
        """Get history grouped by week."""
        user = request.user
        
        queryset = TimeEntry.objects.all()
        
        # Filter based on permissions
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            # Chauffeurs see all their own entries
            queryset = queryset.filter(user=user)
        # Admins see ALL entries (including concept) - no status filter
        
        # Optional status filter
        status_filter = request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Optional user filter for admins
        user_filter = request.query_params.get('user')
        if user_filter and (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            queryset = queryset.filter(user_id=user_filter)
        
        # Optional year filter
        year_filter = request.query_params.get('jaar')
        if year_filter:
            queryset = queryset.filter(datum__year=int(year_filter))
        
        # Group by week and year
        from django.db.models.functions import ExtractYear
        weeks = queryset.annotate(
            jaar=ExtractYear('datum')
        ).values('weeknummer', 'jaar', 'user__voornaam', 'user__achternaam', 'user_id').annotate(
            totaal_km=Sum('totaal_km'),
            entries_count=Count('id'),
            concept_count=Count('id', filter=Q(status=TimeEntryStatus.CONCEPT)),
            ingediend_count=Count('id', filter=Q(status=TimeEntryStatus.INGEDIEND)),
        ).order_by('-jaar', '-weeknummer')
        
        return Response(list(weeks))

    @action(detail=False, methods=['get'], url_path='weekly_hours_overview')
    def weekly_hours_overview(self, request):
        """
        Get 4-week period hours overview for all users.
        Groups weeks into 4-week periods (1-4, 5-8, 9-12, ...).
        Shows: user, period, year, worked hours, minimum hours (weekly×4), missed hours.
        Only accessible by admins.
        """
        import math
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        jaar = request.query_params.get('jaar')
        user_filter = request.query_params.get('user')
        
        # Build driver default minimum hours lookup (via gekoppelde_gebruiker)
        # Only drivers with minimum_uren_per_week set should appear in this overview
        from apps.drivers.models import Driver
        driver_defaults = {}
        driver_qs = Driver.objects.filter(
            minimum_uren_per_week__isnull=False,
            gekoppelde_gebruiker__isnull=False,
        ).values_list('gekoppelde_gebruiker_id', 'minimum_uren_per_week')
        for user_id, min_uren in driver_qs:
            driver_defaults[str(user_id)] = float(min_uren)
        
        # Get all submitted time entries grouped by user, year, week
        # Only include users that have minimum_uren_per_week set
        queryset = TimeEntry.objects.filter(status=TimeEntryStatus.INGEDIEND)
        
        if driver_defaults:
            queryset = queryset.filter(user_id__in=[uid for uid in driver_defaults.keys()])
        else:
            # No drivers with minimum hours configured — return empty
            return Response([])
        
        if jaar:
            queryset = queryset.filter(datum__year=int(jaar))
        if user_filter:
            queryset = queryset.filter(user_id=user_filter)
        
        from django.db.models.functions import ExtractYear
        weekly_data = queryset.annotate(
            jaar=ExtractYear('datum')
        ).values(
            'user_id', 'user__voornaam', 'user__achternaam', 'user__email',
            'user__bedrijf', 'weeknummer', 'jaar'
        ).annotate(
            totaal_seconds=Sum('totaal_uren'),
            totaal_km=Sum('totaal_km'),
            entries_count=Count('id'),
        ).order_by('-jaar', '-weeknummer', 'user__achternaam')
        
        # Aggregate into 4-week periods
        # Period 1 = weeks 1-4, Period 2 = weeks 5-8, etc.
        period_data = {}  # key: "user_id-jaar-periode"
        for row in weekly_data:
            periode = math.ceil(row['weeknummer'] / 4)
            week_start = (periode - 1) * 4 + 1
            week_eind = periode * 4
            
            pkey = f"{row['user_id']}-{row['jaar']}-{periode}"
            
            if pkey not in period_data:
                period_data[pkey] = {
                    'user_id': str(row['user_id']),
                    'user_naam': f"{row['user__voornaam']} {row['user__achternaam']}",
                    'user_email': row['user__email'],
                    'user_bedrijf': row['user__bedrijf'] or '',
                    'jaar': row['jaar'],
                    'periode': periode,
                    'week_start': week_start,
                    'week_eind': week_eind,
                    'worked_seconds': 0,
                    'totaal_km': 0,
                    'entries_count': 0,
                    'weken_in_periode': set(),
                }
            
            total_duration = row['totaal_seconds']
            if total_duration and isinstance(total_duration, timedelta):
                worked_seconds = total_duration.total_seconds()
            elif total_duration:
                worked_seconds = float(total_duration)
            else:
                worked_seconds = 0
            
            period_data[pkey]['worked_seconds'] += worked_seconds
            period_data[pkey]['totaal_km'] += row['totaal_km'] or 0
            period_data[pkey]['entries_count'] += row['entries_count']
            period_data[pkey]['weken_in_periode'].add(row['weeknummer'])
        
        results = []
        for pkey, pd in period_data.items():
            worked_hours = round(pd['worked_seconds'] / 3600, 2)
            
            # Minimum hours = driver weekly minimum × 4
            weekly_min = driver_defaults.get(pd['user_id'], None)
            if weekly_min is not None:
                minimum_hours = round(weekly_min * 4, 2)
            else:
                minimum_hours = None
            
            missed_hours = None
            if minimum_hours is not None:
                missed = minimum_hours - worked_hours
                missed_hours = round(max(0, missed), 2)
            
            results.append({
                'user_id': pd['user_id'],
                'user_naam': pd['user_naam'],
                'user_email': pd['user_email'],
                'user_bedrijf': pd['user_bedrijf'],
                'jaar': pd['jaar'],
                'periode': pd['periode'],
                'week_start': pd['week_start'],
                'week_eind': pd['week_eind'],
                'gewerkte_uren': worked_hours,
                'minimum_uren': minimum_hours,
                'gemiste_uren': missed_hours,
                'totaal_km': pd['totaal_km'],
                'entries_count': pd['entries_count'],
                'minimum_uren_per_week': weekly_min,
                'weken_met_uren': len(pd['weken_in_periode']),
            })
        
        # Sort by year desc, period desc, then user name
        results.sort(key=lambda x: (-x['jaar'], -x['periode'], x['user_naam']))
        
        return Response(results)

    @action(detail=False, methods=['get'], url_path='monthly_hours_overview')
    def monthly_hours_overview(self, request):
        """
        Get monthly hours overview for all users.
        Groups by calendar month. Minimum hours = weekly minimum × number of weeks in that month.
        A month's week count is based on how many distinct ISO weeks have at least one working day
        falling in that month (using the date's month, not ISO week year).
        Only accessible by admins.
        """
        import calendar
        from django.db.models.functions import ExtractYear, ExtractMonth
        
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        jaar = request.query_params.get('jaar')
        user_filter = request.query_params.get('user')
        
        # Build driver default minimum hours lookup
        # Only drivers with minimum_uren_per_week set should appear in this overview
        from apps.drivers.models import Driver
        driver_defaults = {}
        driver_qs = Driver.objects.filter(
            minimum_uren_per_week__isnull=False,
            gekoppelde_gebruiker__isnull=False,
        ).values_list('gekoppelde_gebruiker_id', 'minimum_uren_per_week')
        for uid, min_uren in driver_qs:
            driver_defaults[str(uid)] = float(min_uren)
        
        queryset = TimeEntry.objects.filter(status=TimeEntryStatus.INGEDIEND)
        
        if driver_defaults:
            queryset = queryset.filter(user_id__in=[uid for uid in driver_defaults.keys()])
        else:
            # No drivers with minimum hours configured — return empty
            return Response([])
        
        if jaar:
            queryset = queryset.filter(datum__year=int(jaar))
        if user_filter:
            queryset = queryset.filter(user_id=user_filter)
        
        # Group by user, year, month
        monthly_data = queryset.annotate(
            jaar=ExtractYear('datum'),
            maand=ExtractMonth('datum'),
        ).values(
            'user_id', 'user__voornaam', 'user__achternaam', 'user__email',
            'user__bedrijf', 'jaar', 'maand'
        ).annotate(
            totaal_seconds=Sum('totaal_uren'),
            totaal_km=Sum('totaal_km'),
            entries_count=Count('id'),
        ).order_by('-jaar', '-maand', 'user__achternaam')
        
        # Calculate weeks per month: count Mondays in a given month
        def weeks_in_month(year, month):
            """Count how many full weeks (Mon-Fri work weeks) touch this month."""
            _, days_in_month = calendar.monthrange(year, month)
            # Count distinct ISO week numbers for all days in the month
            from datetime import date as dt_date
            week_numbers = set()
            for day in range(1, days_in_month + 1):
                d = dt_date(year, month, day)
                if d.weekday() < 5:  # Monday-Friday
                    week_numbers.add(d.isocalendar()[1])
            return len(week_numbers)
        
        MONTH_NAMES_NL = [
            '', 'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
            'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'
        ]
        
        results = []
        for row in monthly_data:
            total_duration = row['totaal_seconds']
            if total_duration and isinstance(total_duration, timedelta):
                worked_seconds = total_duration.total_seconds()
            elif total_duration:
                worked_seconds = float(total_duration)
            else:
                worked_seconds = 0
            
            worked_hours = round(worked_seconds / 3600, 2)
            
            weekly_min = driver_defaults.get(str(row['user_id']), None)
            weken = weeks_in_month(row['jaar'], row['maand'])
            
            if weekly_min is not None:
                minimum_hours = round(weekly_min * weken, 2)
            else:
                minimum_hours = None
            
            missed_hours = None
            if minimum_hours is not None:
                missed = minimum_hours - worked_hours
                missed_hours = round(max(0, missed), 2)
            
            results.append({
                'user_id': str(row['user_id']),
                'user_naam': f"{row['user__voornaam']} {row['user__achternaam']}",
                'user_email': row['user__email'],
                'user_bedrijf': row['user__bedrijf'] or '',
                'jaar': row['jaar'],
                'maand': row['maand'],
                'maand_naam': MONTH_NAMES_NL[row['maand']],
                'weken_in_maand': weken,
                'gewerkte_uren': worked_hours,
                'minimum_uren': minimum_hours,
                'gemiste_uren': missed_hours,
                'totaal_km': row['totaal_km'] or 0,
                'entries_count': row['entries_count'],
                'minimum_uren_per_week': weekly_min,
            })
        
        return Response(results)

    @action(detail=False, methods=['post'], url_path='add_missed_hours_to_invoice_monthly')
    def add_missed_hours_to_invoice_monthly(self, request):
        """
        Add missed hours for a calendar month as a line item to an existing or new invoice.
        Body: { user_id, jaar, maand, invoice_id (optional), bedrijf_id, prijs_per_uur }
        """
        import calendar
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        target_user_id = request.data.get('user_id')
        jaar = request.data.get('jaar')
        maand = request.data.get('maand')
        invoice_id = request.data.get('invoice_id')
        bedrijf_id = request.data.get('bedrijf_id')
        prijs_per_uur = request.data.get('prijs_per_uur', 0)
        
        if not all([target_user_id, jaar, maand]):
            return Response(
                {'error': 'user_id, jaar en maand zijn verplicht.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        jaar_int = int(jaar)
        maand_int = int(maand)
        
        # Calculate worked hours for this month
        entries = TimeEntry.objects.filter(
            user_id=target_user_id,
            datum__year=jaar_int,
            datum__month=maand_int,
            status=TimeEntryStatus.INGEDIEND,
        )
        
        total_duration = entries.aggregate(total=Sum('totaal_uren'))['total']
        if total_duration and isinstance(total_duration, timedelta):
            worked_hours = total_duration.total_seconds() / 3600
        else:
            worked_hours = 0
        
        # Get minimum hours: weekly default × weeks in month
        from apps.drivers.models import Driver
        try:
            driver = Driver.objects.get(
                gekoppelde_gebruiker_id=target_user_id,
                minimum_uren_per_week__isnull=False,
            )
            weekly_min = float(driver.minimum_uren_per_week)
        except Driver.DoesNotExist:
            return Response(
                {'error': 'Geen minimale uren ingesteld voor deze chauffeur.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Count weeks in month
        _, days_in_month = calendar.monthrange(jaar_int, maand_int)
        from datetime import date as dt_date
        week_numbers = set()
        for day in range(1, days_in_month + 1):
            d = dt_date(jaar_int, maand_int, day)
            if d.weekday() < 5:
                week_numbers.add(d.isocalendar()[1])
        weken = len(week_numbers)
        
        minimum_hours = weekly_min * weken
        
        MONTH_NAMES_NL = [
            '', 'januari', 'februari', 'maart', 'april', 'mei', 'juni',
            'juli', 'augustus', 'september', 'oktober', 'november', 'december'
        ]
        maand_naam = MONTH_NAMES_NL[maand_int]
        
        missed = round(minimum_hours - worked_hours, 2)
        if missed <= 0:
            return Response(
                {'error': f'Er zijn geen gemiste uren voor {maand_naam} {jaar_int}.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatus as InvStatus
        from apps.accounts.models import User
        from datetime import date
        
        target_user = User.objects.get(id=target_user_id)
        
        if invoice_id:
            try:
                invoice = Invoice.objects.get(id=invoice_id)
            except Invoice.DoesNotExist:
                return Response({'error': 'Factuur niet gevonden.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            if not bedrijf_id:
                return Response(
                    {'error': 'bedrijf_id is verplicht bij het aanmaken van een nieuwe factuur.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            today = date.today()
            prefix = f"F-{today.year}"
            
            from apps.core.models import AppSettings
            app_settings = AppSettings.objects.first()
            start_number = getattr(app_settings, 'invoice_start_number_verkoop', 1) if app_settings else 1
            
            last_invoice = Invoice.objects.filter(
                factuurnummer__startswith=prefix
            ).order_by('-factuurnummer').first()
            
            if last_invoice:
                try:
                    last_num = int(last_invoice.factuurnummer.split('-')[-1])
                    next_num = max(last_num + 1, start_number)
                except (ValueError, IndexError):
                    next_num = start_number
            else:
                next_num = start_number
            
            factuurnummer = f"{prefix}-{next_num:04d}"
            
            invoice = Invoice.objects.create(
                factuurnummer=factuurnummer,
                type='verkoop',
                status=InvStatus.CONCEPT,
                bedrijf_id=bedrijf_id,
                factuurdatum=today,
                vervaldatum=today + timedelta(days=30),
                created_by=user,
                week_year=jaar_int,
                chauffeur=target_user,
            )
        
        max_volgorde = invoice.lines.aggregate(max_v=Max('volgorde'))['max_v'] or 0
        
        line = InvoiceLine.objects.create(
            invoice=invoice,
            omschrijving=f"Gemiste werkuren {maand_naam} {jaar_int} - {target_user.full_name}",
            aantal=Decimal(str(missed)),
            eenheid='uur',
            prijs_per_eenheid=Decimal(str(prijs_per_uur)),
            extra_data={
                'type': 'missed_hours_monthly',
                'user_id': str(target_user_id),
                'jaar': jaar_int,
                'maand': maand_int,
                'maand_naam': maand_naam,
                'weken_in_maand': weken,
                'minimum_uren': minimum_hours,
                'gewerkte_uren': round(worked_hours, 2),
                'gemiste_uren': missed,
            },
            volgorde=max_volgorde + 1,
        )
        
        invoice.calculate_totals()
        
        return Response({
            'success': True,
            'invoice_id': str(invoice.id),
            'factuurnummer': invoice.factuurnummer,
            'line_id': str(line.id),
            'gemiste_uren': missed,
            'omschrijving': line.omschrijving,
            'totaal': float(line.totaal),
        })

    @action(detail=False, methods=['post'], url_path='set_minimum_hours')
    def set_minimum_hours(self, request):
        """
        Set or update minimum hours for a user for a specific week.
        Body: { user_id, jaar, weeknummer, minimum_uren }
        Only accessible by admins.
        """
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        user_id = request.data.get('user_id')
        jaar = request.data.get('jaar')
        weeknummer = request.data.get('weeknummer')
        minimum_uren = request.data.get('minimum_uren')
        
        if not all([user_id, jaar, weeknummer, minimum_uren is not None]):
            return Response(
                {'error': 'user_id, jaar, weeknummer en minimum_uren zijn verplicht.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            minimum_uren = Decimal(str(minimum_uren))
            if minimum_uren < 0:
                raise ValueError
        except (ValueError, TypeError):
            return Response(
                {'error': 'minimum_uren moet een positief getal zijn.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        obj, created = WeeklyMinimumHours.objects.update_or_create(
            user_id=user_id,
            jaar=int(jaar),
            weeknummer=int(weeknummer),
            defaults={'minimum_uren': minimum_uren}
        )
        
        serializer = WeeklyMinimumHoursSerializer(obj)
        return Response({
            'success': True,
            'created': created,
            'data': serializer.data,
        })

    @action(detail=False, methods=['post'], url_path='set_minimum_hours_bulk')
    def set_minimum_hours_bulk(self, request):
        """
        Set minimum hours for a user for ALL weeks in a year at once.
        Body: { user_id, jaar, minimum_uren }
        Only accessible by admins.
        """
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        user_id = request.data.get('user_id')
        jaar = request.data.get('jaar')
        minimum_uren = request.data.get('minimum_uren')
        
        if not all([user_id, jaar, minimum_uren is not None]):
            return Response(
                {'error': 'user_id, jaar en minimum_uren zijn verplicht.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            minimum_uren = Decimal(str(minimum_uren))
            if minimum_uren < 0:
                raise ValueError
        except (ValueError, TypeError):
            return Response(
                {'error': 'minimum_uren moet een positief getal zijn.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        jaar = int(jaar)
        
        # Get all weeks that have submitted entries for this user in this year
        weeks_with_entries = TimeEntry.objects.filter(
            user_id=user_id,
            datum__year=jaar,
            status=TimeEntryStatus.INGEDIEND,
        ).values_list('weeknummer', flat=True).distinct()
        
        updated = 0
        created_count = 0
        for week in weeks_with_entries:
            _, created = WeeklyMinimumHours.objects.update_or_create(
                user_id=user_id,
                jaar=jaar,
                weeknummer=week,
                defaults={'minimum_uren': minimum_uren}
            )
            if created:
                created_count += 1
            else:
                updated += 1
        
        return Response({
            'success': True,
            'created': created_count,
            'updated': updated,
            'total_weeks': len(weeks_with_entries),
        })

    @action(detail=False, methods=['post'], url_path='add_missed_hours_to_invoice')
    def add_missed_hours_to_invoice(self, request):
        """
        Add missed hours for a 4-week period as a line item to an existing or new invoice.
        Body: { user_id, jaar, periode, invoice_id (optional), bedrijf_id, prijs_per_uur }
        Period: 1 = weeks 1-4, 2 = weeks 5-8, etc.
        If invoice_id is given, adds a line to that invoice.
        If not, creates a new concept invoice.
        """
        import math
        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang'}, status=status.HTTP_403_FORBIDDEN)
        
        target_user_id = request.data.get('user_id')
        jaar = request.data.get('jaar')
        periode = request.data.get('periode')
        invoice_id = request.data.get('invoice_id')
        bedrijf_id = request.data.get('bedrijf_id')
        prijs_per_uur = request.data.get('prijs_per_uur', 0)
        
        if not all([target_user_id, jaar, periode]):
            return Response(
                {'error': 'user_id, jaar en periode zijn verplicht.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        periode = int(periode)
        week_start = (periode - 1) * 4 + 1
        week_eind = periode * 4
        
        # Calculate worked hours across all weeks in this period
        entries = TimeEntry.objects.filter(
            user_id=target_user_id,
            datum__year=int(jaar),
            weeknummer__gte=week_start,
            weeknummer__lte=week_eind,
            status=TimeEntryStatus.INGEDIEND,
        )
        
        total_duration = entries.aggregate(total=Sum('totaal_uren'))['total']
        if total_duration and isinstance(total_duration, timedelta):
            worked_hours = total_duration.total_seconds() / 3600
        else:
            worked_hours = 0
        
        # Get minimum hours from driver's weekly default × 4
        from apps.drivers.models import Driver
        try:
            driver = Driver.objects.get(
                gekoppelde_gebruiker_id=target_user_id,
                minimum_uren_per_week__isnull=False,
            )
            minimum_hours = float(driver.minimum_uren_per_week) * 4
        except Driver.DoesNotExist:
            return Response(
                {'error': 'Geen minimale uren ingesteld voor deze chauffeur.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        missed = round(minimum_hours - worked_hours, 2)
        if missed <= 0:
            return Response(
                {'error': 'Er zijn geen gemiste uren voor deze periode.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatus as InvStatus
        from apps.accounts.models import User
        from datetime import date
        
        target_user = User.objects.get(id=target_user_id)
        
        if invoice_id:
            # Add to existing invoice
            try:
                invoice = Invoice.objects.get(id=invoice_id)
            except Invoice.DoesNotExist:
                return Response({'error': 'Factuur niet gevonden.'}, status=status.HTTP_404_NOT_FOUND)
        else:
            # Create a new concept invoice
            if not bedrijf_id:
                return Response(
                    {'error': 'bedrijf_id is verplicht bij het aanmaken van een nieuwe factuur.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Generate invoice number
            today = date.today()
            prefix = f"F-{today.year}"
            
            from apps.core.models import AppSettings
            app_settings = AppSettings.objects.first()
            start_number = getattr(app_settings, 'invoice_start_number_verkoop', 1) if app_settings else 1
            
            last_invoice = Invoice.objects.filter(
                factuurnummer__startswith=prefix
            ).order_by('-factuurnummer').first()
            
            if last_invoice:
                try:
                    last_num = int(last_invoice.factuurnummer.split('-')[-1])
                    next_num = max(last_num + 1, start_number)
                except (ValueError, IndexError):
                    next_num = start_number
            else:
                next_num = start_number
            
            factuurnummer = f"{prefix}-{next_num:04d}"
            
            invoice = Invoice.objects.create(
                factuurnummer=factuurnummer,
                type='verkoop',
                status=InvStatus.CONCEPT,
                bedrijf_id=bedrijf_id,
                factuurdatum=today,
                vervaldatum=today + timedelta(days=30),
                created_by=user,
                week_number=week_start,
                week_year=int(jaar),
                chauffeur=target_user,
            )
        
        # Determine volgorde
        max_volgorde = invoice.lines.aggregate(max_v=Max('volgorde'))['max_v'] or 0
        
        # Add invoice line
        line = InvoiceLine.objects.create(
            invoice=invoice,
            omschrijving=f"Gemiste werkuren periode {periode} (week {week_start}-{week_eind}) - {target_user.full_name}",
            aantal=Decimal(str(missed)),
            eenheid='uur',
            prijs_per_eenheid=Decimal(str(prijs_per_uur)),
            extra_data={
                'type': 'missed_hours',
                'user_id': str(target_user_id),
                'jaar': int(jaar),
                'periode': periode,
                'week_start': week_start,
                'week_eind': week_eind,
                'minimum_uren': minimum_hours,
                'gewerkte_uren': round(worked_hours, 2),
                'gemiste_uren': missed,
            },
            volgorde=max_volgorde + 1,
        )
        
        # Recalculate invoice totals
        invoice.calculate_totals()
        
        return Response({
            'success': True,
            'invoice_id': str(invoice.id),
            'factuurnummer': invoice.factuurnummer,
            'line_id': str(line.id),
            'gemiste_uren': missed,
            'omschrijving': line.omschrijving,
            'totaal': float(line.totaal),
        })

    @action(detail=False, methods=['get'], url_path='driver_report_years')
    def driver_report_years(self, request):
        """Get available years for driver report, limited to last 5 years from current year."""
        from apps.planning.models import PlanningEntry
        from datetime import date
        
        user = request.user
        if not (user.is_superuser or user.rol == 'admin'):
            return Response(
                {'error': 'Geen toegang'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        driver_id = request.query_params.get('driver_id')
        
        # Get years from planning entries
        entries_query = PlanningEntry.objects.all()
        if driver_id:
            entries_query = entries_query.filter(chauffeur_id=driver_id)
        
        years_from_db = list(
            entries_query.values_list('planning__jaar', flat=True)
            .distinct()
            .order_by('-planning__jaar')
        )
        
        # Filter to only last 5 years from current year
        current_year = date.today().year
        min_year = current_year - 4  # Current year + 4 previous = 5 years
        
        available_years = [y for y in years_from_db if y >= min_year and y <= current_year]
        
        # Sort descending (newest first)
        available_years = sorted(set(available_years), reverse=True)
        
        return Response({
            'years': available_years
        })

    @action(detail=False, methods=['get'], url_path='driver_report')
    def driver_report(self, request):
        """Get driver report: weeks with days showing ritnummer, kenteken, km, uren from planning entries."""
        user = request.user
        
        # Only admins can access this
        if not (user.is_superuser or user.rol == 'admin'):
            return Response(
                {'error': 'Geen toegang'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        driver_id = request.query_params.get('driver_id')
        if not driver_id:
            return Response(
                {'error': 'driver_id is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get year filter (optional)
        jaar = request.query_params.get('jaar')
        
        # Get the driver
        from apps.drivers.models import Driver
        from apps.planning.models import PlanningEntry
        try:
            driver = Driver.objects.get(id=driver_id)
        except Driver.DoesNotExist:
            return Response(
                {'error': 'Chauffeur niet gevonden'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get all planning entries for this driver
        entries = PlanningEntry.objects.filter(
            chauffeur=driver
        ).select_related('planning', 'vehicle')
        
        # Apply year filter if provided
        if jaar:
            entries = entries.filter(planning__jaar=int(jaar))
        
        entries = entries.order_by('-planning__jaar', '-planning__weeknummer', 'dag')
        
        # Group by week
        from collections import defaultdict
        weeks_data = defaultdict(lambda: defaultdict(list))
        
        for entry in entries:
            week_key = f"{entry.planning.jaar}-{entry.planning.weeknummer:02d}"
            day_name = entry.dag  # Already 'ma', 'di', etc.
            
            weeks_data[week_key][day_name].append({
                'ritnummer': entry.ritnummer or entry.vehicle.ritnummer or '',
                'kenteken': entry.vehicle.kenteken or '',
                'km': 0,  # Not tracked in planning
                'uren': 0,  # Not tracked in planning
            })
        
        # Convert to list format
        weeks = []
        for week_key in sorted(weeks_data.keys(), reverse=True):
            year, week_num = week_key.split('-')
            week_entry = {
                'jaar': int(year),
                'weeknummer': int(week_num),
                'dagen': {
                    'ma': [],
                    'di': [],
                    'wo': [],
                    'do': [],
                    'vr': [],
                    'za': [],
                    'zo': [],
                }
            }
            for day in ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']:
                if day in weeks_data[week_key]:
                    week_entry['dagen'][day] = weeks_data[week_key][day]
            weeks.append(week_entry)
        
        return Response({
            'driver_id': str(driver_id),
            'driver_name': driver.naam,
            'weeks': weeks
        })

    @action(detail=False, methods=['get'], url_path='driver_report_pdf')
    def driver_report_pdf(self, request):
        """Generate PDF for driver history report."""
        import io
        from django.http import HttpResponse
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
        
        user = request.user
        
        # Only admins can access this
        if not (user.is_superuser or user.rol == 'admin'):
            return Response(
                {'error': 'Geen toegang'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        driver_id = request.query_params.get('driver_id')
        if not driver_id:
            return Response(
                {'error': 'driver_id is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get the driver
        from apps.drivers.models import Driver
        from apps.planning.models import PlanningEntry
        try:
            driver = Driver.objects.get(id=driver_id)
        except Driver.DoesNotExist:
            return Response(
                {'error': 'Chauffeur niet gevonden'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get all planning entries for this driver
        entries = PlanningEntry.objects.filter(
            chauffeur=driver
        ).select_related('planning', 'vehicle').order_by('-planning__jaar', '-planning__weeknummer', 'dag')
        
        # Group by week
        from collections import defaultdict
        weeks_data = defaultdict(lambda: defaultdict(list))
        
        for entry in entries:
            week_key = f"{entry.planning.jaar}-{entry.planning.weeknummer:02d}"
            day_name = entry.dag
            
            weeks_data[week_key][day_name].append({
                'ritnummer': entry.ritnummer or entry.vehicle.ritnummer or '',
                'kenteken': entry.vehicle.kenteken or '',
            })
        
        # Generate PDF
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(A4),
            leftMargin=1*cm,
            rightMargin=1*cm,
            topMargin=1*cm,
            bottomMargin=1*cm
        )
        
        elements = []
        styles = getSampleStyleSheet()
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            spaceAfter=12
        )
        title = Paragraph(f"Chauffeur Historie: {driver.naam}", title_style)
        elements.append(title)
        elements.append(Spacer(1, 0.5*cm))
        
        # Table header
        day_headers = ['Week', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
        table_data = [day_headers]
        
        # Sort weeks
        for week_key in sorted(weeks_data.keys(), reverse=True):
            year, week_num = week_key.split('-')
            row = [f"W{int(week_num)} '{year[-2:]}"]
            
            for day in ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']:
                day_entries = weeks_data[week_key].get(day, [])
                if day_entries:
                    cell_text = '\n'.join([f"{e['ritnummer']} ({e['kenteken']})" for e in day_entries])
                else:
                    cell_text = '-'
                row.append(cell_text)
            
            table_data.append(row)
        
        if len(table_data) == 1:
            # No data
            elements.append(Paragraph("Geen ritten gevonden voor deze chauffeur.", styles['Normal']))
        else:
            # Create table
            col_widths = [2*cm] + [3.5*cm] * 7
            table = Table(table_data, colWidths=col_widths, repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
                ('TOPPADDING', (0, 0), (-1, 0), 8),
                ('BACKGROUND', (0, 1), (-1, -1), colors.white),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
                ('TOPPADDING', (0, 1), (-1, -1), 4),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f7fa')]),
            ]))
            elements.append(table)
        
        doc.build(elements)
        buffer.seek(0)
        
        # Return PDF response
        response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
        safe_name = driver.naam.replace(' ', '_').replace('/', '-')
        filename = f"chauffeur_historie_{safe_name}.pdf"
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class ImportBatchViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for import batches and imported time entries."""
    from .serializers import ImportBatchSerializer
    serializer_class = ImportBatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        from .models import ImportBatch
        user = self.request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Geen toegang.')
        return ImportBatch.objects.select_related('geimporteerd_door').all()

    def destroy(self, request, *args, **kwargs):
        """Delete an import batch and all its entries."""
        from .models import ImportBatch
        user = request.user
        if not (user.is_superuser or user.rol == 'admin'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Alleen admins kunnen imports verwijderen.')
        instance = self.get_object()
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        """Upload and import an Excel file."""
        from .import_service import import_excel, check_duplicates_excel

        user = request.user
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            return Response({'error': 'Geen toegang.'}, status=status.HTTP_403_FORBIDDEN)

        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({'error': 'Geen bestand geüpload.'}, status=status.HTTP_400_BAD_REQUEST)

        if not file_obj.name.endswith(('.xlsx', '.xls')):
            return Response(
                {'error': 'Alleen Excel bestanden (.xlsx, .xls) zijn toegestaan.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        overwrite = request.data.get('overwrite', '').lower() in ('true', '1', 'yes')
        skip_duplicates = request.data.get('skip_duplicates', '').lower() in ('true', '1', 'yes')

        # Check for duplicates (unless user already chose to overwrite or skip)
        if not overwrite and not skip_duplicates:
            try:
                dup_count, total_rows = check_duplicates_excel(file_obj)
                # Reset file position after reading
                file_obj.seek(0)
                if dup_count > 0:
                    return Response(
                        {
                            'error': 'Dubbele regels gevonden',
                            'duplicates': dup_count,
                            'total': total_rows,
                        },
                        status=status.HTTP_409_CONFLICT
                    )
            except Exception as e:
                logger.error(f"Duplicate check failed: {e}", exc_info=True)
                file_obj.seek(0)

        try:
            batch = import_excel(file_obj, file_obj.name, user, overwrite=overwrite, skip_duplicates=skip_duplicates)
        except Exception as e:
            logger.error(f"Import failed: {e}", exc_info=True)
            return Response(
                {'error': f'Import mislukt: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        from .serializers import ImportBatchSerializer
        return Response(ImportBatchSerializer(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='entries')
    def entries(self, request, pk=None):
        """Get all imported entries for a batch."""
        from .models import ImportedTimeEntry
        from .serializers import ImportedTimeEntrySerializer

        batch = self.get_object()
        entries = ImportedTimeEntry.objects.filter(
            batch=batch
        ).select_related('user', 'gekoppeld_voertuig')

        # Optional filters
        weeknummer = request.query_params.get('weeknummer')
        user_id = request.query_params.get('user')
        kenteken = request.query_params.get('kenteken')

        if weeknummer:
            entries = entries.filter(weeknummer=int(weeknummer))
        if user_id:
            entries = entries.filter(user_id=user_id)
        if kenteken:
            entries = entries.filter(kenteken_import__icontains=kenteken)

        serializer = ImportedTimeEntrySerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='imported-entries')
    def imported_entries(self, request):
        """Get all imported entries across all batches, with filters.
        Chauffeurs can only see their own entries."""
        from .models import ImportedTimeEntry
        from .serializers import ImportedTimeEntrySerializer

        user = request.user
        entries = ImportedTimeEntry.objects.select_related(
            'user', 'gekoppeld_voertuig', 'batch'
        ).all()

        # Chauffeurs can only see their own imported entries
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            entries = entries.filter(user=user)

        weeknummer = request.query_params.get('weeknummer')
        jaar = request.query_params.get('jaar')
        user_id = request.query_params.get('user')
        kenteken = request.query_params.get('kenteken')

        if weeknummer:
            entries = entries.filter(weeknummer=int(weeknummer))
        if jaar:
            entries = entries.filter(datum__year=int(jaar))
        if user_id:
            entries = entries.filter(user_id=user_id)
        if kenteken:
            entries = entries.filter(kenteken_import__icontains=kenteken)

        serializer = ImportedTimeEntrySerializer(entries, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='week-comparison')
    def week_comparison(self, request):
        """
        Compare imported hours with chauffeur-submitted hours per week.
        Returns per-user weekly totals: imported uren_factuur vs chauffeur totaal_uren.
        Chauffeurs can only see their own comparison.
        """
        from .models import ImportedTimeEntry
        from django.db.models import Sum, F
        from django.db.models.functions import ExtractYear

        user = request.user
        jaar = request.query_params.get('jaar')
        weeknummer = request.query_params.get('weeknummer')
        user_id = request.query_params.get('user')

        # Imported hours: sum uren_factuur grouped by user, year, week
        imp_qs = ImportedTimeEntry.objects.filter(user__isnull=False)
        te_qs = TimeEntry.objects.filter(status=TimeEntryStatus.INGEDIEND)

        # Chauffeurs can only see their own data
        if not (user.is_superuser or user.rol in ['admin', 'gebruiker']):
            imp_qs = imp_qs.filter(user=user)
            te_qs = te_qs.filter(user=user)

        if jaar:
            imp_qs = imp_qs.filter(datum__year=int(jaar))
            te_qs = te_qs.filter(datum__year=int(jaar))
        if weeknummer:
            imp_qs = imp_qs.filter(weeknummer=int(weeknummer))
            te_qs = te_qs.filter(weeknummer=int(weeknummer))
        if user_id:
            imp_qs = imp_qs.filter(user_id=user_id)
            te_qs = te_qs.filter(user_id=user_id)

        imported_data = imp_qs.values(
            'user_id', 'user__voornaam', 'user__achternaam', 'weeknummer'
        ).annotate(
            jaar=ExtractYear('datum'),
            import_uren=Sum('uren_factuur'),
            import_km=Sum('km'),
        ).order_by('-jaar', '-weeknummer', 'user__achternaam')

        chauffeur_data = te_qs.values(
            'user_id', 'weeknummer'
        ).annotate(
            jaar=ExtractYear('datum'),
            chauffeur_seconds=Sum('totaal_uren'),
            chauffeur_km=Sum('totaal_km'),
        )

        # Build lookup for chauffeur data
        ch_lookup = {}
        for row in chauffeur_data:
            key = f"{row['user_id']}-{row['jaar']}-{row['weeknummer']}"
            dur = row['chauffeur_seconds']
            if dur and isinstance(dur, timedelta):
                hours = round(dur.total_seconds() / 3600, 2)
            else:
                hours = 0
            ch_lookup[key] = {
                'chauffeur_uren': hours,
                'chauffeur_km': row['chauffeur_km'] or 0,
            }

        results = []
        for row in imported_data:
            key = f"{row['user_id']}-{row['jaar']}-{row['weeknummer']}"
            ch = ch_lookup.get(key, {'chauffeur_uren': 0, 'chauffeur_km': 0})
            import_uren = float(row['import_uren'] or 0)
            chauffeur_uren = ch['chauffeur_uren']
            verschil = round(import_uren - chauffeur_uren, 2)

            results.append({
                'user_id': str(row['user_id']),
                'user_naam': f"{row['user__voornaam']} {row['user__achternaam']}",
                'jaar': row['jaar'],
                'weeknummer': row['weeknummer'],
                'import_uren': import_uren,
                'chauffeur_uren': chauffeur_uren,
                'verschil': verschil,
                'import_km': float(row['import_km'] or 0),
                'chauffeur_km': ch['chauffeur_km'],
            })

        results.sort(key=lambda x: (-x['jaar'], -x['weeknummer'], x['user_naam']))
        return Response(results)

