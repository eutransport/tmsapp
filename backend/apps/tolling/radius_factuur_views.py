"""API om een Radius-factuur in te lezen en er tolheffing van te maken.

Twee stappen, bewust gescheiden zodat er nooit iets ongezien wordt opgeslagen:

1. POST .../analyse/   -> leest de factuur en laat zien wat er zou gebeuren
2. POST .../importeer/ -> slaat de regels op als tolheffing-events

Staat los van `views.py` van deze app, zodat de bestaande CSV-import
ongemoeid blijft.
"""
import logging
from datetime import date, datetime

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.core.permissions import IsAdminOrManagerStrict
from apps.tracking.radius_service import RadiusError

from .models import OpenstaandeTolDag
from .radius_factuur_parser import FactuurLeesFout, parse_pdf, parse_tekst
from .radius_factuur_service import STANDAARD_SPELING_MINUTEN, analyseer, importeer
from .radius_fuel_service import bouw_factuur
from .radius_ophalen import haal_ronde

logger = logging.getLogger(__name__)

# Een Radius-factuur is een paar honderd kilobyte. Ruim bemeten, maar we
# weigeren alles wat daarboven zit zodat niemand het geheugen kan opblazen.
MAX_BESTAND_BYTES = 10 * 1024 * 1024
MAX_TEKST_TEKENS = 2 * 1024 * 1024
PDF_HANDTEKENING = b'%PDF-'


class FactuurImportThrottle(SimpleRateThrottle):
    """Het parsen van een PDF kost rekentijd; begrens het per gebruiker."""
    scope = 'tolling_factuur_import'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}
        return self.get_ident(request)


def _lees_speling(request) -> int:
    """Hoeveel minuten een passage buiten de GPS-rit mag vallen."""
    try:
        waarde = int(request.data.get('speling_minuten', STANDAARD_SPELING_MINUTEN))
    except (TypeError, ValueError):
        return STANDAARD_SPELING_MINUTEN
    return max(0, min(waarde, 60))


def _lees_datum(waarde, naam) -> date | None:
    if not waarde:
        return None
    try:
        return datetime.strptime(str(waarde), '%Y-%m-%d').date()
    except ValueError:
        raise ValueError(f'Ongeldige {naam}; gebruik het formaat JJJJ-MM-DD.')


def _lees_periode(request):
    van = _lees_datum(request.data.get('date_from'), 'begindatum')
    tot = _lees_datum(request.data.get('date_to'), 'einddatum')
    if van and tot and van > tot:
        raise ValueError('De begindatum ligt na de einddatum.')
    return van, tot


def _lees_factuur(request):
    """Haal de factuur uit het verzoek: een geüpload bestand of platte tekst.

    Geeft (factuur, bestandsnaam) terug, of werpt FactuurLeesFout / ValueError.
    """
    bestand = request.FILES.get('bestand') or request.FILES.get('file')
    if bestand is not None:
        if bestand.size > MAX_BESTAND_BYTES:
            raise ValueError('Het bestand is te groot (maximaal 10 MB).')
        inhoud = bestand.read()
        if not inhoud.startswith(PDF_HANDTEKENING):
            raise ValueError('Alleen een PDF-factuur van Radius wordt geaccepteerd.')
        return parse_pdf(inhoud), (bestand.name or 'radius-factuur.pdf')

    tekst = request.data.get('tekst') or ''
    if not isinstance(tekst, str) or not tekst.strip():
        raise ValueError('Geef een PDF-bestand of de tekst van de factuur mee.')
    if len(tekst) > MAX_TEKST_TEKENS:
        raise ValueError('De tekst is te lang.')
    return parse_tekst(tekst), 'Radius factuur (tekst)'


def _regel_naar_dict(regel):
    return {
        'datum': regel.datum,
        'tijdstip': regel.tijdstip,
        'kenteken': regel.kenteken,
        'bedrag': str(regel.bedrag),
        'kaartnummer': regel.kaartnummer,
        'product': regel.product,
        'land': regel.land,
        'land_bron': regel.land_bron,
        'afstand_km': str(regel.afstand_km) if regel.afstand_km is not None else None,
        'km_bron': regel.km_bron,
        'gps_km': str(regel.gps_km) if regel.gps_km is not None else None,
        'rit_venster': regel.rit_venster,
        'voertuig_bekend': regel.voertuig_bekend,
        'ritnummer': regel.ritnummer,
        'bedrijf': regel.bedrijf,
        'bestaat_al': regel.bestaat_al,
        'opmerking': regel.opmerking,
    }


class RadiusFactuurViewSet(viewsets.ViewSet):
    """/api/tolling/radius-factuur/"""

    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [FactuurImportThrottle]

    @action(detail=False, methods=['post'])
    def analyse(self, request):
        """Lees de factuur en laat zien wat een import zou opleveren."""
        try:
            factuur, _ = _lees_factuur(request)
        except (FactuurLeesFout, ValueError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Onverwachte fout bij het lezen van een Radius-factuur')
            return Response({'detail': 'De factuur kon niet gelezen worden.'},
                            status=status.HTTP_400_BAD_REQUEST)

        analyse = analyseer(factuur, _lees_speling(request))
        return Response({
            'factuurnummer': analyse.factuurnummer,
            'factuurdatum': analyse.factuurdatum,
            'aantal_regels': len(analyse.regels),
            'totaal_bedrag': str(analyse.totaal_bedrag),
            'per_land': {
                land: {'regels': cijfers['regels'],
                       'bedrag': str(cijfers['bedrag']),
                       'km': str(cijfers['km'])}
                for land, cijfers in analyse.per_land().items()
            },
            'regels': [_regel_naar_dict(r) for r in analyse.regels],
        })

    @action(detail=False, methods=['post'])
    def importeren(self, request):
        """Sla de tolregels van de factuur op als tolheffing-events."""
        try:
            factuur, bestandsnaam = _lees_factuur(request)
        except (FactuurLeesFout, ValueError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Onverwachte fout bij het lezen van een Radius-factuur')
            return Response({'detail': 'De factuur kon niet gelezen worden.'},
                            status=status.HTTP_400_BAD_REQUEST)

        uitkomst = importeer(factuur, request.user, bestandsnaam, _lees_speling(request))
        return Response({
            'batch_id': str(uitkomst.batch.id),
            'factuurnummer': factuur.factuurnummer,
            'totaal': uitkomst.totaal,
            'geimporteerd': uitkomst.geimporteerd,
            'duplicaten': uitkomst.duplicaten,
            'ongeldig': uitkomst.ongeldig,
            'zonder_bedrag': uitkomst.zonder_bedrag,
            'zonder_gps': uitkomst.zonder_gps,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='api-analyse')
    def api_analyse(self, request):
        """Haal de toltransacties uit de Radius-API en toon wat een import oplevert."""
        try:
            van, tot = _lees_periode(request)
            factuur, overgeslagen, verslag = bouw_factuur(van, tot)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RadiusError as exc:
            return Response({'detail': str(exc) or 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van Radius-toltransacties')
            return Response({'detail': 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_502_BAD_GATEWAY)

        analyse = analyseer(factuur, _lees_speling(request))
        return Response({
            'bron': 'radius-api',
            'date_from': van.isoformat() if van else None,
            'date_to': tot.isoformat() if tot else None,
            'aantal_regels': len(analyse.regels),
            'totaal_bedrag': str(analyse.totaal_bedrag),
            'per_land': {
                land: {'regels': cijfers['regels'],
                       'bedrag': str(cijfers['bedrag']),
                       'km': str(cijfers['km'])}
                for land, cijfers in analyse.per_land().items()
            },
            'koppelingen': verslag,
            'overgeslagen': overgeslagen,
            'regels': [_regel_naar_dict(r) for r in analyse.regels],
        })

    @action(detail=False, methods=['post'], url_path='api-importeren')
    def api_importeren(self, request):
        """Haal de toltransacties op en sla ze op als tolheffing-events."""
        try:
            van, tot = _lees_periode(request)
            factuur, overgeslagen, verslag = bouw_factuur(van, tot)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RadiusError as exc:
            return Response({'detail': str(exc) or 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van Radius-toltransacties')
            return Response({'detail': 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_502_BAD_GATEWAY)

        naam = 'Radius API %s t/m %s' % (van or 'begin', tot or 'nu')
        uitkomst = importeer(factuur, request.user, naam, _lees_speling(request))
        return Response({
            'batch_id': str(uitkomst.batch.id),
            'bron': 'radius-api',
            'date_from': van.isoformat() if van else None,
            'date_to': tot.isoformat() if tot else None,
            'totaal': uitkomst.totaal,
            'geimporteerd': uitkomst.geimporteerd,
            'duplicaten': uitkomst.duplicaten,
            'ongeldig': uitkomst.ongeldig,
            'zonder_bedrag': uitkomst.zonder_bedrag,
            'zonder_gps': uitkomst.zonder_gps,
            'koppelingen': verslag,
            'overgeslagen': overgeslagen,
        }, status=status.HTTP_201_CREATED)

    def _ronde(self, request, importeren):
        try:
            van, tot = _lees_periode(request)
            resultaat = haal_ronde(request.user, van, tot, importeren=importeren,
                                   speling_minuten=_lees_speling(request))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except RadiusError as exc:
            return Response({'detail': str(exc) or 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van de Radius-facturen')
            return Response({'detail': 'Ophalen bij Radius is mislukt.'},
                            status=status.HTTP_502_BAD_GATEWAY)

        analyse = resultaat.pop('analyse', None)
        if analyse is not None:
            resultaat.update({
                'aantal_regels': len(analyse.regels),
                'totaal_bedrag': str(analyse.totaal_bedrag),
                'per_land': {
                    land: {'regels': cijfers['regels'],
                           'bedrag': str(cijfers['bedrag']),
                           'km': str(cijfers['km'])}
                    for land, cijfers in analyse.per_land().items()
                },
                'regels': [_regel_naar_dict(r) for r in analyse.regels],
            })
        return Response(resultaat,
                        status=status.HTTP_201_CREATED if importeren else status.HTTP_200_OK)

    @action(detail=False, methods=['post'])
    def ophalen(self, request):
        """Facturen ophalen, GPS erbij synchroniseren en tonen wat het oplevert."""
        return self._ronde(request, importeren=False)

    @action(detail=False, methods=['post'], url_path='ophalen-verwerken')
    def ophalen_verwerken(self, request):
        """Dezelfde ronde, maar de tolregels worden ook echt ingelezen."""
        return self._ronde(request, importeren=True)

    @action(detail=False, methods=['get'])
    def openstaand(self, request):
        """Gereden dagen waarvoor nog geen tol is gefactureerd."""
        rijen = (OpenstaandeTolDag.objects
                 .filter(status=OpenstaandeTolDag.Status.OPEN)
                 .select_related('vehicle')[:500])
        return Response({
            'aantal': OpenstaandeTolDag.objects.filter(
                status=OpenstaandeTolDag.Status.OPEN).count(),
            'regels': [{
                'id': str(rij.id),
                'kenteken': rij.kenteken,
                'datum': rij.datum.isoformat(),
                'gps_ritten': rij.gps_ritten,
                'gps_km': str(rij.gps_km),
                'pogingen': rij.pogingen,
                'in_vloot': rij.vehicle_id is not None,
                'laatst_gecontroleerd': rij.laatst_gecontroleerd.isoformat(),
            } for rij in rijen],
        })
