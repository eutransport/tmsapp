"""Kaart, ritgeschiedenis en dashboardcijfers voor het opdrachtgeversportaal.

De filtering op voertuigen gebeurt hier in de backend: het portaal krijgt nooit
meer te zien dan de voertuigen die een beheerder bij het bedrijf heeft gezet.
"""
import logging
from datetime import datetime, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.companies.models import Company
from apps.core.permissions import IsOpdrachtgever
from apps.drivers.models import Driver, DriverBedrijfPeriode
from apps.timetracking.models import TimeEntry
from apps.tolling.models import TollingEvent
from apps.tracking.models import RadiusJourney

from . import portaal_ritten
from .models import Opdracht, OpdrachtStatus

logger = logging.getLogger(__name__)

MAX_HISTORIE_DAGEN = 31

# Een maand volle vloot past hierbinnen; de lijst wordt in de browser gegroepeerd.
MAX_RITTEN = 2000


def _toegestane_voertuigen(bedrijf_id):
    """Voertuigen die de beheerder voor dit bedrijf heeft vrijgegeven."""
    bedrijf = Company.objects.filter(pk=bedrijf_id).first()
    if bedrijf is None:
        return []
    return list(bedrijf.volgbare_voertuigen.all())


def _normaliseer(kenteken):
    return (kenteken or '').upper().replace('-', '').replace(' ', '')


def _pagineer(rijen, request, standaard=10):
    """Groeperingen worden in geheugen opgebouwd; DRF pagineert alleen querysets."""
    try:
        grootte = min(max(int(request.query_params.get('page_size', standaard)), 1), 100)
    except ValueError:
        grootte = standaard
    try:
        pagina = max(int(request.query_params.get('page', 1)), 1)
    except ValueError:
        pagina = 1
    start = (pagina - 1) * grootte
    return rijen[start:start + grootte], len(rijen)


class PortaalBasisView(APIView):
    permission_classes = [IsAuthenticated, IsOpdrachtgever]

    @property
    def bedrijf_id(self):
        return self.request.user.opdrachtgever_bedrijf_id


class PortaalVoertuigenView(PortaalBasisView):
    """GET /api/portaal/voertuigen/ — de wagens die dit bedrijf mag volgen."""

    def get(self, request):
        voertuigen = _toegestane_voertuigen(self.bedrijf_id)
        return Response([
            {'id': str(v.id), 'kenteken': v.kenteken, 'type_wagen': v.type_wagen}
            for v in voertuigen
        ])


class PortaalPositiesView(PortaalBasisView):
    """GET /api/portaal/posities/ — laatst bekende positie per vrijgegeven wagen."""

    def get(self, request):
        voertuigen = _toegestane_voertuigen(self.bedrijf_id)
        if not voertuigen:
            return Response({'positions': [], 'count': 0})

        toegestaan = {_normaliseer(v.kenteken): v for v in voertuigen if v.kenteken}

        from apps.tracking.tachograph_service import FMTrackError, get_vehicle_locations

        try:
            posities = get_vehicle_locations()
        except FMTrackError as fout:
            logger.warning('Portaal: GPS-posities niet beschikbaar: %s', fout)
            return Response(
                {'error': 'De volgdienst is tijdelijk niet beschikbaar.',
                 'code': 'gps_unavailable'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception:
            logger.exception('Portaal: onverwachte fout bij het ophalen van posities')
            return Response(
                {'error': 'Posities konden niet worden geladen.',
                 'code': 'gps_internal_error'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        resultaat = []
        for positie in posities:
            voertuig = toegestaan.get(_normaliseer(positie.get('plate_number')))
            if voertuig is None:
                continue
            resultaat.append({
                'kenteken': voertuig.kenteken,
                'type_wagen': voertuig.type_wagen,
                'latitude': positie.get('latitude'),
                'longitude': positie.get('longitude'),
                'speed': positie.get('speed'),
                'direction': positie.get('direction'),
                'timestamp': positie.get('timestamp') or positie.get('datetime'),
                'address': positie.get('address', ''),
                'status': positie.get('vehicle_status') or '',
            })

        return Response({'positions': resultaat, 'count': len(resultaat)})


class PortaalRittenView(PortaalBasisView):
    """GET /api/portaal/ritten/ — waar de wagen is geweest en hoe laat."""

    def get(self, request):
        voertuigen = _toegestane_voertuigen(self.bedrijf_id)
        if not voertuigen:
            return Response([])

        vandaag = timezone.localdate()
        try:
            dagen = min(int(request.query_params.get('dagen', 7)), MAX_HISTORIE_DAGEN)
        except (TypeError, ValueError):
            dagen = 7
        vanaf = vandaag - timedelta(days=max(dagen, 1) - 1)

        gevraagd = request.query_params.get('kenteken')
        kentekens = {_normaliseer(v.kenteken) for v in voertuigen if v.kenteken}
        if gevraagd:
            gevraagd_norm = _normaliseer(gevraagd)
            if gevraagd_norm not in kentekens:
                return Response([])
            kentekens = {gevraagd_norm}

        origineel = {_normaliseer(v.kenteken): v.kenteken for v in voertuigen if v.kenteken}
        gevraagde_kentekens = [origineel[k] for k in kentekens if k in origineel]

        ritten = portaal_ritten.haal_ritten(gevraagde_kentekens, vanaf, vandaag)
        return Response(ritten[:MAX_RITTEN])


class PortaalVoertuigDagView(PortaalBasisView):
    """GET /api/portaal/voertuigen/<kenteken>/dag/ — status en kilometers van één dag."""

    def get(self, request, kenteken):
        toegestaan = {
            _normaliseer(v.kenteken): v.kenteken
            for v in _toegestane_voertuigen(self.bedrijf_id) if v.kenteken
        }
        echt = toegestaan.get(_normaliseer(kenteken))
        if echt is None:
            return Response({'error': 'Onbekend voertuig.'}, status=status.HTTP_404_NOT_FOUND)

        datum = timezone.localdate()
        gevraagd = request.query_params.get('datum')
        if gevraagd:
            try:
                datum = datetime.strptime(gevraagd, '%Y-%m-%d').date()
            except ValueError:
                return Response({'error': 'Ongeldige datum.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response(portaal_ritten.dagoverzicht(echt, datum))


class PortaalDashboardView(PortaalBasisView):
    """GET /api/portaal/dashboard/ — cijfers van vandaag."""

    def get(self, request):
        vandaag = timezone.localdate()
        nu = timezone.now()
        bedrijf_id = self.bedrijf_id

        tellers = Opdracht.objects.filter(bedrijf_id=bedrijf_id).aggregate(
            totaal=Count('id'),
            open=Count('id', filter=Q(status__in=[OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART])),
            vandaag_afgeleverd=Count(
                'id',
                filter=Q(status=OpdrachtStatus.AFGELEVERD, afgeleverd_op__date=vandaag),
            ),
            vandaag_aangemaakt=Count('id', filter=Q(created_at__date=vandaag)),
        )

        return Response({
            'opdrachten_totaal': tellers['totaal'],
            'opdrachten_open': tellers['open'],
            'opdrachten_vandaag_aangemaakt': tellers['vandaag_aangemaakt'],
            'opdrachten_vandaag_afgeleverd': tellers['vandaag_afgeleverd'],
            'chauffeurs': _gps_uren_vandaag(bedrijf_id, vandaag, nu),
        })


def _gps_uren_vandaag(bedrijf_id, vandaag, nu):
    """Werktijd per chauffeur: van de eerste rit van vandaag tot nu.

    Stilstand telt mee; de klok loopt door tot de laatste rit is afgesloten.
    """
    chauffeurs = (
        Driver.objects
        .filter(bedrijf_id=bedrijf_id)
        .select_related('voertuig')
        .order_by('naam')
    )

    ritten_vandaag = list(RadiusJourney.objects.filter(date=vandaag))
    per_kenteken = {}
    for rit in ritten_vandaag:
        per_kenteken.setdefault(_normaliseer(rit.plate_number), []).append(rit)

    opdrachten = (
        Opdracht.objects
        .filter(bedrijf_id=bedrijf_id, chauffeur__in=chauffeurs)
        .filter(Q(created_at__date=vandaag) | Q(afgeleverd_op__date=vandaag))
        .values('chauffeur_id')
        .annotate(
            totaal=Count('id'),
            afgeleverd=Count(
                'id', filter=Q(status=OpdrachtStatus.AFGELEVERD, afgeleverd_op__date=vandaag)
            ),
        )
    )
    per_chauffeur = {r['chauffeur_id']: r for r in opdrachten}

    resultaat = []
    for chauffeur in chauffeurs:
        kenteken = getattr(chauffeur.voertuig, 'kenteken', '') or ''
        ritten = per_kenteken.get(_normaliseer(kenteken), [])

        uren = 0.0
        rijdt = False
        if ritten:
            eerste = min(r.start_time for r in ritten)
            eindtijden = [r.end_time for r in ritten if r.end_time]
            laatste_eind = max(eindtijden) if len(eindtijden) == len(ritten) else None
            tot = laatste_eind or nu
            rijdt = laatste_eind is None
            uren = max((tot - eerste).total_seconds() / 3600, 0)

        werk = per_chauffeur.get(chauffeur.id, {})
        resultaat.append({
            'id': str(chauffeur.id),
            'naam': chauffeur.naam,
            'kenteken': kenteken,
            'uren_vandaag': round(uren, 2),
            'rijdt': rijdt,
            'ritten_vandaag': len(ritten),
            'opdrachten_vandaag': werk.get('totaal', 0),
            'opdrachten_afgeleverd': werk.get('afgeleverd', 0),
        })

    return resultaat


def _uren_queryset(bedrijf_id):
    """Alleen uren uit de periodes dat de chauffeur bij dit bedrijf hoorde."""
    periodes = DriverBedrijfPeriode.objects.filter(
        bedrijf_id=bedrijf_id, driver__gekoppelde_gebruiker__isnull=False
    ).select_related('driver')

    voorwaarde = Q(pk__in=[])
    for periode in periodes:
        bereik = Q(user_id=periode.driver.gekoppelde_gebruiker_id, datum__gte=periode.vanaf)
        if periode.tot:
            bereik &= Q(datum__lte=periode.tot)
        voorwaarde |= bereik

    return TimeEntry.objects.filter(voorwaarde).select_related('user')


class PortaalUrenView(PortaalBasisView):
    """GET /api/portaal/uren/ — geregistreerde uren per week, alleen lezen."""

    def get(self, request):
        zoek = (request.query_params.get('search') or '').strip()
        regels = _uren_queryset(self.bedrijf_id)
        if zoek:
            regels = regels.filter(
                Q(ritnummer__icontains=zoek)
                | Q(kenteken__icontains=zoek)
                | Q(user__voornaam__icontains=zoek)
                | Q(user__achternaam__icontains=zoek)
                | Q(user__username__icontains=zoek)
                | Q(datum__icontains=zoek)
            )

        namen = {}
        weken = {}
        for regel in regels.order_by('datum', 'aanvang'):
            jaar, week, _ = regel.datum.isocalendar()
            sleutel = (regel.user_id, jaar, week)
            naam = namen.get(regel.user_id)
            if naam is None:
                naam = regel.user.full_name or regel.user.username
                namen[regel.user_id] = naam

            blok = weken.setdefault(sleutel, {
                'id': f'{regel.user_id}-{jaar}-{week}',
                'chauffeur': naam,
                'jaar': jaar,
                'week': week,
                'totaal_km': 0,
                'totaal_uren': 0.0,
                'dagen': [],
            })
            uren = regel.totaal_uren.total_seconds() / 3600 if regel.totaal_uren else 0.0
            blok['totaal_km'] += regel.totaal_km or 0
            blok['totaal_uren'] += uren
            blok['dagen'].append({
                'id': str(regel.id),
                'datum': regel.datum.isoformat(),
                'ritnummer': regel.ritnummer,
                'kenteken': regel.kenteken,
                'aanvang': regel.aanvang.strftime('%H:%M'),
                'eind': regel.eind.strftime('%H:%M'),
                'km_start': regel.km_start,
                'km_eind': regel.km_eind,
                'totaal_km': regel.totaal_km,
                'uren': round(uren, 2),
            })

        resultaat = sorted(
            weken.values(), key=lambda w: (w['jaar'], w['week'], w['chauffeur']), reverse=True
        )
        for blok in resultaat:
            blok['totaal_uren'] = round(blok['totaal_uren'], 2)
            blok['aantal_dagen'] = len(blok['dagen'])

        pagina, telling = _pagineer(resultaat, request)
        return Response({
            'count': telling,
            'results': pagina,
            'totaal_uren': round(sum(w['totaal_uren'] for w in resultaat), 2),
            'totaal_km': sum(w['totaal_km'] for w in resultaat),
        })


class PortaalTolView(PortaalBasisView):
    """GET /api/portaal/tol/ — tolpassages per week en kenteken, alleen lezen."""

    def get(self, request):
        voertuigen = _toegestane_voertuigen(self.bedrijf_id)
        toegestaan = {_normaliseer(v.kenteken): v.kenteken for v in voertuigen if v.kenteken}
        if not toegestaan:
            return Response({'count': 0, 'results': [], 'totaal_bedrag': 0, 'totaal_km': 0})

        passages = TollingEvent.objects.filter(
            license_plate_normalized__in=list(toegestaan)
        ).only('license_plate_normalized', 'start_at', 'amount', 'distance_km', 'land', 'ritnummer')

        kenteken = (request.query_params.get('kenteken') or '').strip()
        if kenteken:
            passages = passages.filter(license_plate_normalized=_normaliseer(kenteken))
        week = (request.query_params.get('week') or '').strip()
        if week.isdigit():
            passages = passages.filter(start_at__week=int(week))

        weken = {}
        for passage in passages.order_by('start_at'):
            lokaal = timezone.localtime(passage.start_at)
            jaar, weeknummer, _ = lokaal.date().isocalendar()
            plaat = toegestaan[passage.license_plate_normalized]
            blok = weken.setdefault((plaat, jaar, weeknummer), {
                'id': f'{passage.license_plate_normalized}-{jaar}-{weeknummer}',
                'kenteken': plaat,
                'jaar': jaar,
                'week': weeknummer,
                'aantal': 0,
                'totaal_bedrag': 0.0,
                'totaal_km': 0.0,
                'passages': [],
            })
            blok['aantal'] += 1
            blok['totaal_bedrag'] += float(passage.amount or 0)
            blok['totaal_km'] += float(passage.distance_km or 0)
            blok['passages'].append({
                'id': str(passage.id),
                'moment': lokaal.strftime('%d-%m-%Y %H:%M'),
                'land': passage.land or '',
                'ritnummer': passage.ritnummer or '',
                'km': round(float(passage.distance_km or 0), 1),
                'bedrag': round(float(passage.amount or 0), 2),
            })

        resultaat = sorted(
            weken.values(), key=lambda w: (w['jaar'], w['week'], w['kenteken']), reverse=True
        )
        for blok in resultaat:
            blok['totaal_bedrag'] = round(blok['totaal_bedrag'], 2)
            blok['totaal_km'] = round(blok['totaal_km'], 1)

        pagina, telling = _pagineer(resultaat, request)
        return Response({
            'count': telling,
            'results': pagina,
            'totaal_bedrag': round(sum(w['totaal_bedrag'] for w in resultaat), 2),
            'totaal_km': round(sum(w['totaal_km'] for w in resultaat), 1),
        })