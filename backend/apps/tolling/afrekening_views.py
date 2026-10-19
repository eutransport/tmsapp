"""API voor de tolafrekeningen van de opdrachtgever.

Het overzicht is op te vragen per week, maand, kwartaal of jaar, of voor één
losse afrekening. Een afrekening telt mee in de periode waarin hij *begint*:
zo telt een bon die over een maandgrens heen loopt maar in één maand mee en
worden bedragen nooit dubbel geteld.
"""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdminOnly

from . import afrekening_analyse as analyse
from . import afrekening_service as service
from .afrekening_parser import MAX_BESTAND_BYTES, AfrekeningFout
from .models import TolAfrekening

logger = logging.getLogger(__name__)

WEEK = 'week'
MAAND = 'maand'
KWARTAAL = 'kwartaal'
JAAR = 'jaar'
ALLES = 'alles'
SOORTEN = (WEEK, MAAND, KWARTAAL, JAAR, ALLES)

_MAANDEN = ('januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
            'augustus', 'september', 'oktober', 'november', 'december')


def _tijd(waarde, standaard):
    """Lees een 'HH:MM' uit het verzoek; bij twijfel de standaardwaarde."""
    if not waarde:
        return standaard
    try:
        return datetime.strptime(str(waarde).strip(), '%H:%M').time()
    except ValueError:
        raise AfrekeningFout(f'Ongeldige tijd: {waarde}. Gebruik het formaat 06:00.')


def _geheel(waarde, standaard: int) -> int:
    try:
        return int(str(waarde).strip())
    except (TypeError, ValueError):
        return standaard


def periode_bereik(soort: str, jaar: int, index: int):
    """De eerste en laatste dag van de gevraagde periode."""
    if soort == JAAR:
        return date(jaar, 1, 1), date(jaar, 12, 31)
    if soort == KWARTAAL:
        maand = (index - 1) * 3 + 1
        laatste = maand + 2
        return date(jaar, maand, 1), date(jaar, laatste, calendar.monthrange(jaar, laatste)[1])
    if soort == MAAND:
        return date(jaar, index, 1), date(jaar, index, calendar.monthrange(jaar, index)[1])
    # Week: ISO-weken, dus maandag tot en met zondag.
    eerste = date.fromisocalendar(jaar, index, 1)
    return eerste, date.fromisocalendar(jaar, index, 7)


def periode_sleutel(dag: date, soort: str) -> tuple[int, int]:
    """In welke periode van deze soort valt ``dag``?"""
    if soort == JAAR:
        return dag.year, 1
    if soort == KWARTAAL:
        return dag.year, (dag.month - 1) // 3 + 1
    if soort == MAAND:
        return dag.year, dag.month
    iso = dag.isocalendar()
    return iso[0], iso[1]


def periode_label(soort: str, jaar: int, index: int) -> str:
    if soort == ALLES:
        return 'Alle afrekeningen'
    if soort == JAAR:
        return str(jaar)
    if soort == KWARTAAL:
        return f'Kwartaal {index} {jaar}'
    if soort == MAAND:
        return f'{_MAANDEN[index - 1].capitalize()} {jaar}'
    van, tot = periode_bereik(WEEK, jaar, index)
    return f'Week {index} {jaar} ({van:%d-%m} t/m {tot:%d-%m})'


def _verschuif(soort: str, jaar: int, index: int, stappen: int) -> tuple[int, int]:
    """Een aantal perioden vooruit of achteruit."""
    if soort == JAAR:
        return jaar + stappen, 1
    if soort == KWARTAAL:
        totaal = (jaar * 4 + (index - 1)) + stappen
        return totaal // 4, totaal % 4 + 1
    if soort == MAAND:
        totaal = (jaar * 12 + (index - 1)) + stappen
        return totaal // 12, totaal % 12 + 1
    van, _ = periode_bereik(WEEK, jaar, index)
    verschoven = van.toordinal() + stappen * 7
    iso = date.fromordinal(verschoven).isocalendar()
    return iso[0], iso[1]


class TolAfrekeningViewSet(viewsets.ViewSet):
    """Uploaden en vergelijken van de afrekening van de opdrachtgever."""

    # De afrekening bevat tarieven en bedragen van de opdrachtgever; dat is
    # niet zichtbaar voor niet-admins, ook niet met view_tolling.
    permission_classes = [IsAuthenticated, IsAdminOnly]

    def _alles(self):
        return (
            TolAfrekening.objects
            .filter(afsluiting__isnull=True)
            .select_related('bedrijf', 'geuploaded_door')
            .prefetch_related('regels__vehicle')
        )

    def _basis(self):
        # Bonnen in de wachtrij tellen nog niet mee; hun tol is nog niet ingelezen.
        return self._alles().exclude(status=TolAfrekening.Status.WACHTRIJ)

    def _haal_op(self, pk) -> TolAfrekening | None:
        return self._alles().filter(pk=pk).first()

    def _selectie(self, gegevens) -> tuple[list, dict]:
        """De afrekeningen die bij het gevraagde filter horen, plus filterinfo.

        Er kan gefilterd worden op één afrekening (``afrekening=<id>``) of op
        een periode. Bij een periode kijken we naar de begindatum van de bon.
        """
        losse = (gegevens.get('afrekening') or '').strip()
        if losse:
            gekozen = self._haal_op(losse)
            return ([gekozen] if gekozen else []), {
                'soort': 'afrekening', 'afrekening': losse,
                'label': f'Bon {gekozen.bonnummer}' if gekozen else 'Onbekende afrekening',
            }

        soort = (gegevens.get('periode') or MAAND).strip().lower()
        if soort not in SOORTEN:
            raise AfrekeningFout(
                f'Onbekende periode: {soort}. Kies week, maand, kwartaal, jaar of alles.')

        alle = list(self._basis().order_by('periode_van'))
        if soort == ALLES:
            return alle, {'soort': ALLES, 'label': periode_label(ALLES, 0, 0),
                          'jaar': None, 'index': None, 'van': None, 'tot': None}

        # Zonder opgave kijken we naar de periode van de nieuwste afrekening.
        laatste = alle[-1].periode_van if alle else date.today()
        standaard_jaar, standaard_index = periode_sleutel(laatste, soort)
        jaar = _geheel(gegevens.get('jaar'), standaard_jaar)
        index = _geheel(gegevens.get('index'), standaard_index)

        try:
            van, tot = periode_bereik(soort, jaar, index)
        except (ValueError, IndexError):
            raise AfrekeningFout('Die periode bestaat niet.')

        gekozen = [a for a in alle if van <= a.periode_van <= tot]
        return gekozen, {
            'soort': soort, 'jaar': jaar, 'index': index,
            'label': periode_label(soort, jaar, index), 'van': van, 'tot': tot,
        }

    def _beschikbaar(self, soort: str) -> list[dict]:
        """Welke perioden bevatten afrekeningen? Voor de sprongen in het menu."""
        if soort in (ALLES, 'afrekening'):
            return []
        geteld: dict[tuple[int, int], int] = {}
        for van in TolAfrekening.objects.filter(afsluiting__isnull=True).values_list(
                'periode_van', flat=True):
            sleutel = periode_sleutel(van, soort)
            geteld[sleutel] = geteld.get(sleutel, 0) + 1
        return [
            {'jaar': jaar, 'index': index, 'label': periode_label(soort, jaar, index),
             'aantal': aantal}
            for (jaar, index), aantal in sorted(geteld.items(), reverse=True)
        ]

    def _overzicht(self, gegevens) -> dict:
        gekozen, filterinfo = self._selectie(gegevens)
        uitkomst = analyse.analyseer_selectie(gekozen)
        soort = filterinfo['soort']
        if soort not in (ALLES, 'afrekening'):
            vorige = _verschuif(soort, filterinfo['jaar'], filterinfo['index'], -1)
            volgende = _verschuif(soort, filterinfo['jaar'], filterinfo['index'], 1)
            filterinfo['vorige'] = {'jaar': vorige[0], 'index': vorige[1]}
            filterinfo['volgende'] = {'jaar': volgende[0], 'index': volgende[1]}
        uitkomst['filter'] = filterinfo
        uitkomst['beschikbaar'] = self._beschikbaar(soort)
        return uitkomst

    def list(self, request):
        resultaat = []
        for afrekening in self._basis().all():
            regels = list(afrekening.regels.all())
            resultaat.append({
                'id': str(afrekening.id),
                'bestandsnaam': afrekening.bestandsnaam,
                'bonnummer': afrekening.bonnummer,
                'klantnummer': afrekening.klantnummer,
                'factuurdatum': afrekening.factuurdatum,
                'periode_van': afrekening.periode_van,
                'periode_tot': afrekening.periode_tot,
                'bedrijf_naam': afrekening.bedrijf.naam if afrekening.bedrijf_id else '',
                'totaal_netto': float(afrekening.totaal_netto or 0),
                'totaal_maut': float(afrekening.totaal_maut or 0),
                'voertuigen': len(regels),
                'ongekoppeld': sum(1 for r in regels if r.koppeling != 'gekoppeld'),
                'waarschuwingen': len(afrekening.waarschuwingen or []),
                'werktijd_van': afrekening.werktijd_van.strftime('%H:%M'),
                'werktijd_tot': afrekening.werktijd_tot.strftime('%H:%M'),
                'geuploaded_door': (
                    (afrekening.geuploaded_door.full_name or '').strip()
                    or afrekening.geuploaded_door.email
                ) if afrekening.geuploaded_door_id else '',
                'created_at': afrekening.created_at,
            })
        return Response(resultaat)

    @action(detail=False, methods=['get'], url_path='overzicht')
    def overzicht(self, request):
        """De vergelijking over een week, maand, kwartaal, jaar of één bon."""
        try:
            return Response(self._overzicht(request.query_params))
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)

    def retrieve(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(analyse.analyseer(afrekening))

    def create(self, request):
        bestand = request.FILES.get('bestand')
        if bestand is None:
            return Response({'detail': 'Kies een PDF-bestand om te uploaden.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if bestand.size > MAX_BESTAND_BYTES:
            return Response(
                {'detail': f'Het bestand is te groot (maximaal '
                           f'{MAX_BESTAND_BYTES // (1024 * 1024)} MB).'},
                status=status.HTTP_400_BAD_REQUEST)

        try:
            afrekening = service.importeer(
                inhoud=bestand.read(),
                bestandsnaam=bestand.name,
                gebruiker=request.user,
                werktijd_van=_tijd(request.data.get('werktijd_van'), None),
                werktijd_tot=_tijd(request.data.get('werktijd_tot'), None),
            )
        except service.AfrekeningBestaatAl as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_409_CONFLICT)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Inlezen van tolafrekening mislukt')
            return Response(
                {'detail': 'Het bestand kon niet worden gelezen. '
                           'Controleer of het de juiste afrekening is.'},
                status=status.HTTP_400_BAD_REQUEST)

        wachtrij = getattr(afrekening, 'wachtrij_wagens', [])
        return Response(
            {**analyse.analyseer(afrekening),
             'status': afrekening.status,
             'gemarkeerd': getattr(afrekening, 'gemarkeerd', 0),
             'tol_ontbreekt': getattr(afrekening, 'tol_ontbreekt', []),
             'wachtrij_wagens': wachtrij},
            status=status.HTTP_202_ACCEPTED if wachtrij else status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='wachtrij')
    def wachtrij(self, request):
        """Ingelezen bonnen die nog wachten op de bijbehorende tolgegevens."""
        return Response([
            {
                'id': str(afrekening.id),
                'bestandsnaam': afrekening.bestandsnaam,
                'bonnummer': afrekening.bonnummer,
                'periode_van': afrekening.periode_van,
                'periode_tot': afrekening.periode_tot,
                'bedrijf_naam': afrekening.bedrijf.naam if afrekening.bedrijf_id else '',
                'totaal_maut': float(afrekening.totaal_maut or 0),
                'voertuigen': afrekening.regels.count(),
                'meldingen': afrekening.waarschuwingen or [],
                'created_at': afrekening.created_at,
            }
            for afrekening in self._alles().filter(
                status=TolAfrekening.Status.WACHTRIJ)
        ])

    @action(detail=True, methods=['post'], url_path='verwerk')
    def verwerk(self, request, pk=None):
        """Een bon uit de wachtrij alsnog verwerken."""
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        uitkomst = service.verwerk_wachtrij(afrekening)
        if uitkomst['wachtrij_wagens']:
            return Response(
                {'detail': 'De tolgegevens ontbreken nog voor '
                           + ', '.join(uitkomst['wachtrij_wagens'][:5])
                           + ('...' if len(uitkomst['wachtrij_wagens']) > 5 else '')
                           + '. Importeer eerst de tolheffing.',
                 **uitkomst},
                status=status.HTTP_409_CONFLICT)
        logger.info('Tolafrekening %s uit de wachtrij verwerkt door %s',
                    afrekening.bonnummer, request.user)
        return Response(uitkomst)

    def destroy(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        bon = afrekening.bonnummer
        bestand = afrekening.bestand
        afrekening.delete()
        if bestand:
            bestand.delete(save=False)
        logger.info('Tolafrekening %s verwijderd door %s', bon, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'], url_path='werktijden')
    def werktijden(self, request):
        """Pas het werkdagvenster aan voor alle afrekeningen in de selectie."""
        try:
            gekozen, _ = self._selectie(request.data)
            van = _tijd(request.data.get('werktijd_van'), None)
            tot = _tijd(request.data.get('werktijd_tot'), None)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        if van is None or tot is None:
            return Response({'detail': 'Geef een begin- en een eindtijd op.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if van == tot:
            return Response({'detail': 'Begin- en eindtijd mogen niet gelijk zijn.'},
                            status=status.HTTP_400_BAD_REQUEST)
        for afrekening in gekozen:
            afrekening.werktijd_van = van
            afrekening.werktijd_tot = tot
            afrekening.save(update_fields=['werktijd_van', 'werktijd_tot', 'updated_at'])
        return Response(self._overzicht(request.data))

    @action(detail=False, methods=['post'], url_path='markeer-gefactureerd')
    def markeer_gefactureerd(self, request):
        try:
            gekozen, _ = self._selectie(request.data)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        gemarkeerd = sum(
            service.markeer_gefactureerd(afrekening)['gemarkeerd']
            for afrekening in gekozen
        )
        return Response({'gemarkeerd': gemarkeerd, 'analyse': self._overzicht(request.data)})

    @action(detail=False, methods=['post'], url_path='markering-ongedaan')
    def markering_ongedaan(self, request):
        try:
            gekozen, _ = self._selectie(request.data)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        teruggedraaid = sum(
            service.maak_markering_ongedaan(afrekening)['teruggedraaid']
            for afrekening in gekozen
        )
        return Response({'teruggedraaid': teruggedraaid,
                         'analyse': self._overzicht(request.data)})

    @action(detail=False, methods=['post'], url_path='herkoppel')
    def herkoppel(self, request):
        """Werk de koppeling naar de vloot bij met de huidige kentekens."""
        try:
            gekozen, _ = self._selectie(request.data)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        uitkomst = service.herkoppel(gekozen)
        uitkomst['analyse'] = self._overzicht(request.data)
        return Response(uitkomst)

    def _passages_van(self, regels, nieuwste) -> list[dict]:
        """De tolpassages van één wagen, klaar voor het scherm of de export."""
        velden = ('id', 'start_at', 'amount', 'distance_km', 'license_plate_raw',
                  'is_private', 'invoiced_at')
        rijen = analyse.events_van_groep(regels).order_by('start_at')
        return [
            {
                'id': str(rij[0]),
                'start_at': rij[1],
                'bedrag': float(rij[2] or 0),
                'km': float(rij[3] or 0),
                'kenteken': rij[4],
                'prive': rij[5],
                'gefactureerd': rij[6] is not None,
                'tijdvak': analyse.tijdvak(
                    rij[1], nieuwste.werktijd_van, nieuwste.werktijd_tot),
            }
            for rij in rijen.values_list(*velden)
        ]

    @action(detail=False, methods=['get'], url_path='passages')
    def passages(self, request):
        """De onderliggende tolpassages van één wagen binnen de selectie."""
        rit = (request.query_params.get('rit') or '').strip()
        if not rit:
            return Response({'detail': 'Geef een ritnummer op.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            gekozen, _ = self._selectie(request.query_params)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        if not gekozen:
            return Response({'regel': None, 'passages': []})

        groepen = analyse.groepeer(gekozen)
        regels = groepen.get(rit)
        if not regels:
            return Response({'detail': 'Voertuig niet gevonden in deze periode.'},
                            status=status.HTTP_404_NOT_FOUND)

        nieuwste = max(gekozen, key=lambda a: a.periode_van)
        return Response({
            'regel': {
                'ritnummer': rit,
                'voertuig_label': regels[0].voertuig_label,
                'kenteken': regels[0].kenteken,
            },
            'passages': self._passages_van(regels, nieuwste),
        })

    @action(detail=False, methods=['get'], url_path='passages-alles')
    def passages_alles(self, request):
        """Alle tolpassages van de selectie, gebundeld per wagen.

        Voor de export: elke passage staat onder het ritnummer waar hij bij
        hoort, zodat in het bestand duidelijk is om welke wagen het gaat.
        """
        try:
            gekozen, filterinfo = self._selectie(request.query_params)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        if not gekozen:
            return Response({'label': '', 'groepen': []})

        nieuwste = max(gekozen, key=lambda a: a.periode_van)
        groepen = analyse.groepeer(gekozen)
        uit = []
        for sleutel in sorted(groepen):
            regels = groepen[sleutel]
            perioden = analyse.perioden_van_groep(regels)
            uit.append({
                'ritnummer': regels[0].ritnummer,
                'voertuig_label': regels[0].voertuig_label,
                'kenteken': regels[0].kenteken,
                'periode_van': min(p[0] for p in perioden) if perioden else None,
                'periode_tot': max(p[1] for p in perioden) if perioden else None,
                'passages': self._passages_van(regels, nieuwste),
            })
        return Response({
            'label': filterinfo['label'],
            'werktijd_van': nieuwste.werktijd_van.strftime('%H:%M'),
            'werktijd_tot': nieuwste.werktijd_tot.strftime('%H:%M'),
            'groepen': uit,
        })
