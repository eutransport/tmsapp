import logging
from datetime import date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count, Q
from apps.core.permissions import FleetPermission
from .models import Vehicle
from .serializers import VehicleSerializer

logger = logging.getLogger('accounts.security')


class VehicleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Vehicle/Fleet CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = Vehicle.objects.select_related('bedrijf').all()
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated, FleetPermission]
    search_fields = ['kenteken', 'ritnummer', 'type_wagen']
    filterset_fields = ['bedrijf', 'type_wagen']
    ordering_fields = ['kenteken', 'type_wagen', 'created_at']
    ordering = ['kenteken']
    
    def perform_create(self, serializer):
        vehicle = serializer.save()
        logger.info(
            f"Vehicle created: {vehicle.kenteken} (ID: {vehicle.id}) by {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        vehicle = serializer.save()
        logger.info(
            f"Vehicle updated: {vehicle.kenteken} (ID: {vehicle.id}) by {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        logger.warning(
            f"Vehicle deleted: {instance.kenteken} (ID: {instance.id}) by {self.request.user.email}"
        )
        instance.delete()

    @action(detail=False, methods=['get'], url_path='dropdown')
    def dropdown(self, request):
        """
        Lightweight vehicle list for dropdowns.
        Accessible by all authenticated users (including chauffeurs)
        so they can select a vehicle when registering hours.
        """
        vehicles = Vehicle.objects.filter(actief=True).select_related('bedrijf').order_by('kenteken')
        serializer = self.get_serializer(vehicles, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='vehicle_weeks_overview')
    def vehicle_weeks_overview(self, request):
        """
        Overview of worked days per vehicle vs minimum days.
        Minimum days = minimum_weken_per_jaar * 5 (working days per week).
        Only vehicles with minimum_weken_per_jaar set are included.
        """
        from apps.timetracking.models import TimeEntry, TimeEntryStatus
        
        jaar = int(request.query_params.get('jaar', date.today().year))
        
        # Get vehicles that have minimum weeks configured
        vehicles = Vehicle.objects.select_related('bedrijf').filter(
            minimum_weken_per_jaar__isnull=False
        ).order_by('kenteken')
        
        results = []
        for vehicle in vehicles:
            # Count distinct days where this vehicle's kenteken has time entries
            worked_days = TimeEntry.objects.filter(
                kenteken__iexact=vehicle.kenteken,
                datum__year=jaar,
                status=TimeEntryStatus.INGEDIEND,
            ).values('datum').distinct().count()
            
            minimum_weken = vehicle.minimum_weken_per_jaar
            minimum_dagen = minimum_weken * 5
            gemiste_dagen = max(0, minimum_dagen - worked_days)
            gewerkte_weken_decimal = round(worked_days / 5, 1)
            percentage = round((worked_days / minimum_dagen) * 100, 1) if minimum_dagen > 0 else 100
            
            results.append({
                'vehicle_id': str(vehicle.id),
                'kenteken': vehicle.kenteken,
                'type_wagen': vehicle.type_wagen,
                'ritnummer': vehicle.ritnummer,
                'bedrijf_naam': vehicle.bedrijf.naam if vehicle.bedrijf else '',
                'minimum_weken': minimum_weken,
                'minimum_dagen': minimum_dagen,
                'gewerkte_dagen': worked_days,
                'gemiste_dagen': gemiste_dagen,
                'gewerkte_weken_decimal': gewerkte_weken_decimal,
                'percentage': min(percentage, 100),
            })
        
        return Response(results)

    @action(detail=False, methods=['get'], url_path='vehicle_averages')
    def vehicle_averages(self, request):
        """
        Gemiddelden per kenteken (op basis van ingediende urenregistraties):
        - totalen (km/uren/dagen)
        - gemiddelden per dag/week/maand
        - weekoverzicht en maandoverzicht
        Filter optioneel met ?jaar=YYYY (default huidig jaar).
        """
        from collections import defaultdict
        from apps.timetracking.models import TimeEntry, TimeEntryStatus

        jaar = int(request.query_params.get('jaar', date.today().year))

        entries = TimeEntry.objects.filter(
            datum__year=jaar,
            status=TimeEntryStatus.INGEDIEND,
        ).values('kenteken', 'datum', 'totaal_km', 'totaal_uren')

        # Vehicles dict for metadata lookup
        vehicles_by_kenteken = {
            v.kenteken.upper(): v
            for v in Vehicle.objects.select_related('bedrijf').all()
        }

        # Group: kenteken -> aggregates
        per_kenteken = defaultdict(lambda: {
            'total_km': 0,
            'total_hours': 0.0,
            'days': set(),
            'weekly': defaultdict(lambda: {'km': 0, 'hours': 0.0, 'days': set()}),
            'monthly': defaultdict(lambda: {'km': 0, 'hours': 0.0, 'days': set()}),
        })

        for e in entries:
            kenteken = (e['kenteken'] or '').strip().upper()
            if not kenteken:
                continue
            datum = e['datum']
            uren = e['totaal_uren'].total_seconds() / 3600.0 if e['totaal_uren'] else 0.0
            km = e['totaal_km'] or 0

            iso_year, iso_week, _ = datum.isocalendar()
            week_key = (iso_year, iso_week)
            month_key = (datum.year, datum.month)

            bucket = per_kenteken[kenteken]
            bucket['total_km'] += km
            bucket['total_hours'] += uren
            bucket['days'].add(datum)

            w = bucket['weekly'][week_key]
            w['km'] += km
            w['hours'] += uren
            w['days'].add(datum)

            m = bucket['monthly'][month_key]
            m['km'] += km
            m['hours'] += uren
            m['days'].add(datum)

        results = []
        for kenteken, bucket in per_kenteken.items():
            v = vehicles_by_kenteken.get(kenteken)
            days_worked = len(bucket['days'])
            weeks_worked = len(bucket['weekly'])
            months_worked = len(bucket['monthly'])
            total_km = bucket['total_km']
            total_hours = round(bucket['total_hours'], 2)

            weekly_list = []
            for (yr, wk), w in sorted(bucket['weekly'].items()):
                d = len(w['days'])
                weekly_list.append({
                    'year': yr,
                    'week': wk,
                    'total_km': w['km'],
                    'total_hours': round(w['hours'], 2),
                    'days_worked': d,
                    'avg_km_per_day': round(w['km'] / d, 1) if d else 0,
                    'avg_hours_per_day': round(w['hours'] / d, 2) if d else 0,
                })

            monthly_list = []
            for (yr, mo), m in sorted(bucket['monthly'].items()):
                d = len(m['days'])
                monthly_list.append({
                    'year': yr,
                    'month': mo,
                    'total_km': m['km'],
                    'total_hours': round(m['hours'], 2),
                    'days_worked': d,
                    'avg_km_per_day': round(m['km'] / d, 1) if d else 0,
                    'avg_hours_per_day': round(m['hours'] / d, 2) if d else 0,
                })

            results.append({
                'kenteken': kenteken,
                'type_wagen': v.type_wagen if v else '',
                'ritnummer': v.ritnummer if v else '',
                'bedrijf_naam': v.bedrijf.naam if v and v.bedrijf else '',
                'jaar': jaar,
                'totals': {
                    'total_km': total_km,
                    'total_hours': total_hours,
                    'days_worked': days_worked,
                    'weeks_worked': weeks_worked,
                    'months_worked': months_worked,
                },
                'averages': {
                    'avg_km_per_day': round(total_km / days_worked, 1) if days_worked else 0,
                    'avg_hours_per_day': round(total_hours / days_worked, 2) if days_worked else 0,
                    'avg_km_per_week': round(total_km / weeks_worked, 1) if weeks_worked else 0,
                    'avg_hours_per_week': round(total_hours / weeks_worked, 2) if weeks_worked else 0,
                    'avg_km_per_month': round(total_km / months_worked, 1) if months_worked else 0,
                    'avg_hours_per_month': round(total_hours / months_worked, 2) if months_worked else 0,
                },
                'weekly': weekly_list,
                'monthly': monthly_list,
            })

        results.sort(key=lambda r: r['kenteken'])
        return Response(results)
