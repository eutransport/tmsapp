"""Tests voor de Radius ritgeschiedenis en het archief."""
from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.tracking import radius_service
from apps.tracking.models import RadiusJourney, RadiusSyncLog
from apps.tracking.radius_archive_service import (
    get_radius_archive,
    sync_radius_journeys,
)
from apps.tracking.radius_service import RadiusError


def _rit(service_id='svc-1', start='2026-09-22T08:00:00', eind='2026-09-22T09:30:00',
         kenteken='50-BXN-5', km=120.5, duur=5400.0, chauffeur=''):
    """Bouw een rit zoals Radius die teruggeeft."""
    return {
        'serviceId': service_id,
        'startDateTime': start,
        'endDateTime': eind,
        'startLatitude': 52.0, 'startLongitude': 5.0,
        'endLatitude': 52.5, 'endLongitude': 5.5,
        'startLocation': 'Industriestraat 7, 7041 GD \'s-Heerenberg, Nederland',
        'startLocationCity': '', 'startLocationState': 'Gelderland',
        'startLocationCountry': 'Nederland',
        'endLocation': 'Brede Steeg 4, 7041 GV \'s-Heerenberg, Nederland',
        'endLocationCity': 'Ede', 'endLocationState': 'Gelderland',
        'endLocationCountry': 'Nederland',
        'milesTravelled': km,
        'journeyTime': duur,
        'vehicleRegistration': kenteken,
        'driverName': chauffeur,
    }


def _respons(ritten, pagina=0, totaal_paginas=1, totale_km=0.0):
    return {
        'summary': {
            'totalDistance': totale_km,
            'totalTravelTime': 0.0,
            'totalTripCount': len(ritten),
        },
        'journeys': ritten,
        'page': pagina,
        'pageSize': radius_service.JOURNEYS_PAGE_SIZE,
        'totalJourneys': len(ritten),
        'totalPages': totaal_paginas,
    }


class RadiusPeriodeValidatieTests(TestCase):
    """Datums komen in de URL terecht en moeten strikt gevalideerd worden."""

    def test_geldige_datum_wordt_geaccepteerd(self):
        self.assertEqual(radius_service.valideer_datum('2026-09-22', 'begindatum'),
                         date(2026, 9, 22))

    def test_date_object_wordt_geaccepteerd(self):
        self.assertEqual(radius_service.valideer_datum(date(2026, 9, 22), 'begindatum'),
                         date(2026, 9, 22))

    def test_ongeldig_formaat_wordt_geweigerd(self):
        for waarde in ['22-09-2026', '2026/09/22', '', None, 'vandaag', '2026-13-01']:
            with self.assertRaises(RadiusError):
                radius_service.valideer_datum(waarde, 'begindatum')

    def test_injectiepoging_in_datum_wordt_geweigerd(self):
        for waarde in ["2026-09-22' OR 1=1", '2026-09-22&customer=999', '2026-09-22/../x']:
            with self.assertRaises(RadiusError):
                radius_service.valideer_datum(waarde, 'begindatum')

    def test_omgekeerde_periode_wordt_geweigerd(self):
        with self.assertRaises(RadiusError):
            radius_service._valideer_periode('2026-09-22', '2026-09-01')

    def test_te_lange_periode_wordt_geweigerd(self):
        with self.assertRaises(RadiusError):
            radius_service._valideer_periode('2026-01-01', '2026-09-22')

    def test_periode_op_de_grens_mag_wel(self):
        van = date(2026, 9, 1)
        tot = van + timedelta(days=radius_service.JOURNEYS_MAX_DAGEN - 1)
        self.assertEqual(radius_service._valideer_periode(van, tot), (van, tot))


class RadiusRitNormalisatieTests(TestCase):
    """De velden van Radius moeten correct vertaald worden."""

    def test_afstand_wordt_als_kilometers_overgenomen(self):
        # Het veld heet milesTravelled maar bevat kilometers; zie de
        # verificatie tegen het Radius-portaal.
        rit = radius_service._normaliseer_rit(_rit(km=120.5))
        self.assertEqual(rit['distance_km'], 120.5)

    def test_verzonnen_chauffeursnaam_wordt_leeggelaten(self):
        rit = radius_service._normaliseer_rit(
            _rit(kenteken='06-BZF-5', chauffeur='Driver of 06-BZF-5')
        )
        self.assertEqual(rit['driver_name'], '')

    def test_echte_chauffeursnaam_blijft_staan(self):
        rit = radius_service._normaliseer_rit(_rit(chauffeur='Jan Jansen'))
        self.assertEqual(rit['driver_name'], 'Jan Jansen')

    def test_lege_plaats_valt_terug_op_provincie(self):
        rit = radius_service._normaliseer_rit(_rit())
        self.assertEqual(rit['start_city'], 'Gelderland')
        self.assertEqual(rit['end_city'], 'Ede')

    def test_tijden_worden_tijdzonebewust(self):
        rit = radius_service._normaliseer_rit(_rit())
        self.assertIsNotNone(rit['start_time'])
        self.assertTrue(timezone.is_aware(rit['start_time']))

    def test_tijden_zonder_zone_worden_als_utc_gelezen(self):
        """
        Radius levert ritdatums zonder tijdzone, maar die staan in UTC.

        Dit is bewust vastgelegd omdat het eerder fout ging: de waarden werden
        als Amsterdamse tijd gelezen, waardoor elke rit twee uur te vroeg werd
        getoond (05:59 verscheen als 03:59).
        """
        rit = radius_service._normaliseer_rit(
            _rit(start='2026-09-23T03:59:25', eind='2026-09-23T06:30:00')
        )
        self.assertEqual(rit['start_time'].utcoffset().total_seconds(), 0)
        self.assertEqual(rit['start_time'].strftime('%H:%M'), '03:59')
        # In de zomer is Nederland UTC+2, dus dit hoort 05:59 te worden.
        self.assertEqual(
            timezone.localtime(rit['start_time']).strftime('%H:%M'), '05:59'
        )

    def test_wintertijd_krijgt_een_uur_verschil(self):
        """In de winter geldt UTC+1; de omzetting moet dat zelf afhandelen."""
        rit = radius_service._normaliseer_rit(
            _rit(start='2026-12-15T04:59:00', eind='2026-12-15T09:00:00')
        )
        self.assertEqual(
            timezone.localtime(rit['start_time']).strftime('%H:%M'), '05:59'
        )

    def test_expliciete_tijdzone_wordt_gerespecteerd(self):
        """Als Radius ooit wel een offset meestuurt, moeten we die volgen."""
        rit = radius_service._normaliseer_rit(
            _rit(start='2026-09-23T05:59:25+02:00', eind='2026-09-23T08:30:00+02:00')
        )
        self.assertEqual(
            timezone.localtime(rit['start_time']).strftime('%H:%M'), '05:59'
        )


class RadiusPagineringTests(TestCase):
    """De paginering van Radius is 0-gebaseerd; dat mag niet misgaan."""

    def test_eerste_pagina_is_nul(self):
        with patch.object(radius_service, 'api_get') as mock_get:
            mock_get.return_value = _respons([_rit()])
            radius_service.get_journeys('123', '2026-09-22', '2026-09-22')
        self.assertEqual(mock_get.call_args_list[0].kwargs['params']['page'], 0)

    def test_alle_paginas_worden_opgehaald(self):
        paginas = [
            _respons([_rit(service_id=f'svc-{i}',
                           start=f'2026-09-22T0{i}:00:00')], pagina=i, totaal_paginas=3)
            for i in range(3)
        ]
        with patch.object(radius_service, 'api_get', side_effect=paginas) as mock_get:
            resultaat = radius_service.get_journeys('123', '2026-09-22', '2026-09-22')
        self.assertEqual(mock_get.call_count, 3)
        self.assertEqual(resultaat['count'], 3)

    def test_lege_pagina_stopt_de_lus(self):
        paginas = [_respons([_rit()], totaal_paginas=10), _respons([], totaal_paginas=10)]
        with patch.object(radius_service, 'api_get', side_effect=paginas) as mock_get:
            resultaat = radius_service.get_journeys('123', '2026-09-22', '2026-09-22')
        self.assertEqual(mock_get.call_count, 2)
        self.assertEqual(resultaat['count'], 1)

    def test_onverwacht_antwoord_geeft_radiuserror(self):
        with patch.object(radius_service, 'api_get', return_value=['onzin']):
            with self.assertRaises(RadiusError):
                radius_service.get_journeys('123', '2026-09-22', '2026-09-22')

    def test_rit_zonder_starttijd_wordt_overgeslagen(self):
        kapot = _rit()
        kapot['startDateTime'] = None
        with patch.object(radius_service, 'api_get', return_value=_respons([kapot, _rit()])):
            resultaat = radius_service.get_journeys('123', '2026-09-22', '2026-09-22')
        self.assertEqual(resultaat['count'], 1)


class RadiusSamenvattingTests(TestCase):
    """De samenvatting per voertuig moet optellen zoals het portaal."""

    def test_telt_per_kenteken_op(self):
        ritten = [
            _rit(service_id='a', kenteken='50-BXN-5', km=100.0, duur=3600),
            _rit(service_id='b', kenteken='50-BXN-5', km=50.5, duur=1800,
                 start='2026-09-22T12:00:00'),
            _rit(service_id='c', kenteken='BD-894-H', km=200.0, duur=7200),
        ]
        with patch.object(radius_service, 'api_get', return_value=_respons(ritten)):
            resultaat = radius_service.get_journey_summary_per_vehicle(
                '123', '2026-09-22', '2026-09-22')

        self.assertEqual(resultaat['count'], 2)
        # Gesorteerd op afstand, dus BD-894-H staat vooraan.
        self.assertEqual(resultaat['vehicles'][0]['plate_number'], 'BD-894-H')
        bxn = next(v for v in resultaat['vehicles'] if v['plate_number'] == '50-BXN-5')
        self.assertEqual(bxn['distance_km'], 150.5)
        self.assertEqual(bxn['journey_count'], 2)
        self.assertEqual(bxn['duration_seconds'], 5400)


class RadiusArchiefTests(TestCase):
    """Het archief moet idempotent gevuld worden."""

    def setUp(self):
        self.patcher = patch(
            'apps.tracking.radius_archive_service.bepaal_klant_id',
            return_value='21218375990001',
        )
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def _sync(self, ritten):
        with patch.object(radius_service, 'api_get', return_value=_respons(ritten)):
            return sync_radius_journeys('2026-09-22', '2026-09-22')

    def test_ritten_worden_opgeslagen(self):
        resultaat = self._sync([
            _rit(service_id='a', km=100.0),
            _rit(service_id='b', km=50.0, start='2026-09-22T12:00:00'),
        ])
        self.assertEqual(resultaat['journeys_created'], 2)
        self.assertEqual(RadiusJourney.objects.count(), 2)

    def test_tweede_sync_maakt_geen_duplicaten(self):
        ritten = [_rit(service_id='a')]
        self._sync(ritten)
        resultaat = self._sync(ritten)
        self.assertEqual(resultaat['journeys_created'], 0)
        self.assertEqual(resultaat['journeys_updated'], 0)
        self.assertEqual(RadiusJourney.objects.count(), 1)

    def test_gewijzigde_rit_wordt_bijgewerkt(self):
        self._sync([_rit(service_id='a', km=100.0)])
        resultaat = self._sync([_rit(service_id='a', km=125.0)])
        self.assertEqual(resultaat['journeys_created'], 0)
        self.assertEqual(resultaat['journeys_updated'], 1)
        self.assertEqual(RadiusJourney.objects.get(service_id='a').distance_km, 125.0)

    def test_synclog_wordt_bijgehouden(self):
        self._sync([_rit(service_id='a')])
        log = RadiusSyncLog.objects.get(date=date(2026, 9, 22))
        self.assertEqual(log.journeys_synced, 1)
        self.assertEqual(log.vehicles_seen, 1)

    def test_archief_vat_samen_per_dag_en_voertuig(self):
        self._sync([
            _rit(service_id='a', kenteken='50-BXN-5', km=100.0, duur=3600),
            _rit(service_id='b', kenteken='50-BXN-5', km=50.0, duur=1800,
                 start='2026-09-22T12:00:00', eind='2026-09-22T13:00:00'),
            _rit(service_id='c', kenteken='BD-894-H', km=25.0, duur=900),
        ])
        archief = get_radius_archive(date(2026, 9, 22), date(2026, 9, 22))

        self.assertEqual(archief['count'], 2)
        self.assertEqual(archief['journey_count'], 3)
        self.assertEqual(archief['total_distance_km'], 175.0)
        regel = next(r for r in archief['entries'] if r['plate_number'] == '50-BXN-5')
        self.assertEqual(regel['distance_km'], 150.0)
        self.assertEqual(regel['journey_count'], 2)
        self.assertEqual(len(regel['journeys']), 2)

    def test_archief_filtert_op_kenteken(self):
        self._sync([
            _rit(service_id='a', kenteken='50-BXN-5'),
            _rit(service_id='c', kenteken='BD-894-H'),
        ])
        archief = get_radius_archive(date(2026, 9, 22), date(2026, 9, 22),
                                     plate_number='50-BXN-5')
        self.assertEqual(archief['count'], 1)
        self.assertEqual(archief['entries'][0]['plate_number'], '50-BXN-5')

    def test_archief_buiten_periode_is_leeg(self):
        self._sync([_rit(service_id='a')])
        archief = get_radius_archive(date(2026, 9, 1), date(2026, 9, 2))
        self.assertEqual(archief['count'], 0)
        self.assertEqual(archief['total_distance_km'], 0)
