import logging
from datetime import date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import SimpleRateThrottle
from django.db.models import Count, F, Q
from apps.core.permissions import FleetPermission
from . import rdw as rdw_dienst
from . import rdw_sync
from .models import Vehicle, VehicleBedrijf, VehicleRitnummer
from .serializers import (
    VehicleBedrijfSerializer,
    VehicleRitnummerSerializer,
    VehicleSerializer,
)

logger = logging.getLogger('accounts.security')


class _PerGebruikerThrottle(SimpleRateThrottle):
    """Tel per ingelogde gebruiker in plaats van per IP-adres."""

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}
        return self.get_ident(request)


class RDWOpzoekThrottle(_PerGebruikerThrottle):
    """Begrens het opzoeken van kentekens tijdens het typen.

    Zonder deze grens zou iemand met een geldig account onze server kunnen
    gebruiken om het hele kentekenregister af te struinen.
    """
    scope = 'rdw_lookup'


class RDWSyncThrottle(_PerGebruikerThrottle):
    """Begrens het bijwerken; een vlootbrede sync is vier aanvragen per wagen."""
    scope = 'rdw_sync'


class VehicleRitnummerViewSet(viewsets.ModelViewSet):
    """Beheer van de ritnummers van een wagen door de tijd heen.

    De oudste periode van een wagen heeft geen ingangsdatum en geldt dus
    'vanaf het begin'; die mag niet verwijderd worden, anders zou er een
    gat in de historie ontstaan.
    """
    queryset = VehicleRitnummer.objects.select_related('vehicle').all()
    serializer_class = VehicleRitnummerSerializer
    permission_classes = [IsAuthenticated, FleetPermission]
    filterset_fields = ['vehicle']
    ordering = ['vehicle', 'geldig_vanaf']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        vehicle = self.request.query_params.get('vehicle')
        if vehicle:
            qs = qs.filter(vehicle_id=vehicle)
        return qs.order_by('vehicle_id', F('geldig_vanaf').asc(nulls_first=True), 'created_at')

    def perform_destroy(self, instance):
        if instance.geldig_vanaf is None:
            raise ValidationError(
                'De oudste periode kan niet verwijderd worden; die geldt vanaf het begin. '
                'Pas het ritnummer aan in plaats van de periode te verwijderen.'
            )
        logger.info(
            'Ritnummerperiode verwijderd: %s vanaf %s (wagen %s) door %s',
            instance.ritnummer, instance.geldig_vanaf,
            instance.vehicle.kenteken, self.request.user.email,
        )
        instance.delete()


class VehicleBedrijfViewSet(viewsets.ModelViewSet):
    """Beheer van de bedrijven waarvoor een wagen gereden heeft.

    De oudste periode van een wagen heeft geen ingangsdatum en geldt dus
    'vanaf het begin'; die mag niet verwijderd worden, anders zou er een
    gat in de historie ontstaan.
    """
    queryset = VehicleBedrijf.objects.select_related('vehicle', 'bedrijf').all()
    serializer_class = VehicleBedrijfSerializer
    permission_classes = [IsAuthenticated, FleetPermission]
    filterset_fields = ['vehicle']
    ordering = ['vehicle', 'geldig_vanaf']
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        vehicle = self.request.query_params.get('vehicle')
        if vehicle:
            qs = qs.filter(vehicle_id=vehicle)
        return qs.order_by('vehicle_id', F('geldig_vanaf').asc(nulls_first=True), 'created_at')

    def perform_destroy(self, instance):
        if instance.geldig_vanaf is None:
            raise ValidationError(
                'De oudste periode kan niet verwijderd worden; die geldt vanaf het begin. '
                'Pas het bedrijf aan in plaats van de periode te verwijderen.'
            )
        logger.info(
            'Bedrijfsperiode verwijderd: %s vanaf %s (wagen %s) door %s',
            instance.bedrijf_id, instance.geldig_vanaf,
            instance.vehicle.kenteken, self.request.user.email,
        )
        instance.delete()


class VehicleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Vehicle/Fleet CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = (
        Vehicle.objects.select_related('bedrijf')
        .prefetch_related('ritnummer_periodes', 'bedrijf_periodes__bedrijf')
        .all()
    )
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

    @action(detail=False, methods=['get'], url_path='rdw-opzoeken',
            throttle_classes=[RDWOpzoekThrottle])
    def rdw_opzoeken(self, request):
        """Zoek een kenteken op bij de RDW zonder iets op te slaan.

        Bedoeld voor het invoerscherm: zodra er een volledig kenteken staat,
        laat de app zien welke wagen daarbij hoort. Pas bij opslaan komen de
        gegevens in de vloot terecht.
        """
        kenteken = request.query_params.get('kenteken', '')
        try:
            gegevens = rdw_dienst.haal_voertuig(kenteken)
        except rdw_dienst.KentekenFout as exc:
            # De invoer deugt niet; dat is geen storing bij de RDW.
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except rdw_dienst.RDWFout as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        if not gegevens.get('gevonden'):
            return Response({
                'gevonden': False,
                'kenteken': gegevens.get('kenteken', ''),
                'detail': 'Dit kenteken staat niet in het register van de RDW.',
            })

        # De datums moeten als tekst naar de browser; DRF serialiseert hier
        # geen model, dus dat doen we zelf.
        for sleutel, waarde in list(gegevens.items()):
            if isinstance(waarde, date):
                gegevens[sleutel] = waarde.isoformat()
        gegevens['rdw_vermogen_kw'] = (
            str(gegevens['rdw_vermogen_kw']) if gegevens.get('rdw_vermogen_kw') else None
        )
        return Response(gegevens)

    @action(detail=True, methods=['post'], url_path='rdw-verversen',
            throttle_classes=[RDWSyncThrottle])
    def rdw_verversen(self, request, pk=None):
        """Werk deze ene wagen bij met de gegevens van de RDW."""
        vehicle = self.get_object()
        resultaat = rdw_sync.werk_voertuig_bij(vehicle, gebruiker=request.user)

        if not resultaat['gelukt']:
            return Response({'detail': resultaat['melding']},
                            status=status.HTTP_502_BAD_GATEWAY)

        vehicle.refresh_from_db()
        return Response({
            'gevonden': resultaat['gevonden'],
            'melding': resultaat['melding'],
            'apk_vastgelegd': resultaat['apk_vastgelegd'],
            'voertuig': self.get_serializer(vehicle).data,
        })

    @action(detail=False, methods=['post'], url_path='rdw-verversen-alles',
            throttle_classes=[RDWSyncThrottle])
    def rdw_verversen_alles(self, request):
        """Werk meerdere wagens in een keer bij.

        Standaard alleen de wagens die nog geen gegevens hebben, zodat een
        vergissing niet meteen de hele vloot opnieuw ophaalt. Stuur
        ``alles: true`` mee om ook de al gevulde wagens te verversen.
        """
        alles = bool(request.data.get('alles'))
        alleen_actief = request.data.get('alleen_actief', True)

        wagens = Vehicle.objects.all()
        if alleen_actief:
            wagens = wagens.filter(actief=True)
        if not alles:
            wagens = wagens.filter(rdw_opgehaald_op__isnull=True)

        wagens = list(wagens.order_by('kenteken'))
        if not wagens:
            return Response({
                'bijgewerkt': 0, 'niet_gevonden': 0, 'mislukt': 0,
                'apk_records': 0, 'regels': [], 'afgebroken': False,
                'melding': 'Alle wagens hebben al gegevens van de RDW.',
            })

        uitkomst = rdw_sync.werk_vloot_bij(wagens, gebruiker=request.user)
        logger.info(
            'RDW-sync door %s: %s bijgewerkt, %s niet gevonden, %s mislukt',
            request.user.email, uitkomst['bijgewerkt'],
            uitkomst['niet_gevonden'], uitkomst['mislukt'],
        )
        return Response(uitkomst)

    @action(detail=False, methods=['get'], url_path='vehicle_weeks_overview')
    def vehicle_weeks_overview(self, request):
        """
        Overview of worked days per ritnummer vs minimum days.
        Ritnummer is leading: totals are summed across all kentekens that
        ever ran under the same ritnummer, and the current kenteken is shown.
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
        seen_ritnummers = set()
        for vehicle in vehicles:
            ritnummer = (vehicle.ritnummer or '').strip()
            # Skip duplicates: if multiple current vehicles share a ritnummer,
            # only report once (totals are per ritnummer).
            rit_key = ritnummer.upper()
            if rit_key and rit_key in seen_ritnummers:
                continue
            if rit_key:
                seen_ritnummers.add(rit_key)

            # Aggregate by ritnummer so kenteken changes don't break history.
            # Also accept the current kenteken as a fallback, so entries where
            # ritnummer was empty or mistyped (e.g. tachograph fallback to
            # kenteken) still count for this vehicle.
            if ritnummer:
                entry_q = Q(ritnummer__iexact=ritnummer) | Q(kenteken__iexact=vehicle.kenteken)
            else:
                entry_q = Q(kenteken__iexact=vehicle.kenteken)

            worked_days = TimeEntry.objects.filter(
                entry_q,
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
        Gemiddelden per ritnummer (op basis van ingediende urenregistraties):
        - totalen (km/uren/dagen)
        - gemiddelden per dag/week/maand
        - weekoverzicht en maandoverzicht
        Ritnummer is leidend; bij kentekenwijziging blijven totalen oplopen
        en wordt het huidige kenteken (uit Vehicle) getoond.
        Filter optioneel met ?jaar=YYYY (default huidig jaar).
        """
        from collections import defaultdict
        from apps.timetracking.models import TimeEntry, TimeEntryStatus

        jaar = int(request.query_params.get('jaar', date.today().year))

        entries = TimeEntry.objects.filter(
            datum__year=jaar,
            status=TimeEntryStatus.INGEDIEND,
        ).values('ritnummer', 'kenteken', 'datum', 'totaal_km', 'totaal_uren')

        # Current Vehicle per ritnummer (for metadata + current kenteken)
        vehicles_by_ritnummer = {}
        for v in Vehicle.objects.select_related('bedrijf').all():
            rit = (v.ritnummer or '').strip().upper()
            if rit:
                # Last write wins; usually one vehicle per ritnummer
                vehicles_by_ritnummer[rit] = v

        # Group: ritnummer -> aggregates
        per_ritnummer = defaultdict(lambda: {
            'total_km': 0,
            'total_hours': 0.0,
            'days': set(),
            'latest_kenteken': '',
            'latest_datum': None,
            'weekly': defaultdict(lambda: {'km': 0, 'hours': 0.0, 'days': set()}),
            'monthly': defaultdict(lambda: {'km': 0, 'hours': 0.0, 'days': set()}),
        })

        for e in entries:
            ritnummer = (e['ritnummer'] or '').strip().upper()
            if not ritnummer:
                continue
            datum = e['datum']
            uren = e['totaal_uren'].total_seconds() / 3600.0 if e['totaal_uren'] else 0.0
            km = e['totaal_km'] or 0

            iso_year, iso_week, _ = datum.isocalendar()
            week_key = (iso_year, iso_week)
            month_key = (datum.year, datum.month)

            bucket = per_ritnummer[ritnummer]
            bucket['total_km'] += km
            bucket['total_hours'] += uren
            bucket['days'].add(datum)

            # Track most recent kenteken seen for this ritnummer as fallback
            if bucket['latest_datum'] is None or datum >= bucket['latest_datum']:
                bucket['latest_datum'] = datum
                bucket['latest_kenteken'] = (e['kenteken'] or '').strip().upper()

            w = bucket['weekly'][week_key]
            w['km'] += km
            w['hours'] += uren
            w['days'].add(datum)

            m = bucket['monthly'][month_key]
            m['km'] += km
            m['hours'] += uren
            m['days'].add(datum)

        results = []
        for ritnummer, bucket in per_ritnummer.items():
            v = vehicles_by_ritnummer.get(ritnummer)
            # Prefer current Vehicle kenteken; fall back to most recent entry
            display_kenteken = v.kenteken if v else bucket['latest_kenteken']
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
                'kenteken': display_kenteken,
                'type_wagen': v.type_wagen if v else '',
                'ritnummer': v.ritnummer if v else ritnummer,
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

        results.sort(key=lambda r: (r['ritnummer'], r['kenteken']))
        return Response(results)
