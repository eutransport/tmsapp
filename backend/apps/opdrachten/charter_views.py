"""Uren, tol en kaart voor het charterportaal.

Een charter is een ingehuurde vervoerder. Hij ziet uitsluitend:

- de uren van zijn eigen chauffeurs, binnen de periodes dat ze via hem reden;
- de tol van de wagen waarin zijn chauffeur op die dag volgens de uren reed;
- de wagens die een beheerder bij de charter op de kaart heeft gezet.

De views hergebruiken de logica van het opdrachtgeversportaal; alleen de bron
van de gegevens is anders. ``bedrijf_id`` geeft hier bewust ``None`` terug, zodat
een vergeten override nooit de gegevens van een opdrachtgever kan tonen.
"""
from django.db.models import Q
from rest_framework.permissions import IsAuthenticated

from apps.core.permissions import IsCharter
from apps.drivers.models import Charter, DriverCharterPeriode
from apps.fleet.models import Vehicle
from apps.timetracking.models import TimeEntry
from apps.tolling.models import TollingEvent, normalize_plate

from .portaal_views import (
    PortaalPositiesView,
    PortaalRittenView,
    PortaalTolView,
    PortaalUrenView,
    PortaalVoertuigDagView,
    PortaalVoertuigenView,
)


def charter_uren_queryset(charter_id):
    """Alleen uren uit de periodes dat de chauffeur via deze charter reed."""
    periodes = DriverCharterPeriode.objects.filter(
        charter_id=charter_id, driver__gekoppelde_gebruiker__isnull=False
    ).select_related('driver')

    voorwaarde = Q(pk__in=[])
    for periode in periodes:
        bereik = Q(user_id=periode.driver.gekoppelde_gebruiker_id)
        if periode.vanaf:
            bereik &= Q(datum__gte=periode.vanaf)
        if periode.tot:
            bereik &= Q(datum__lte=periode.tot)
        voorwaarde |= bereik

    return TimeEntry.objects.filter(voorwaarde).select_related('user')


class CharterBasisMixin:
    """Moet vóór de portaalview in de MRO staan, zodat deze rechten gelden."""

    permission_classes = [IsAuthenticated, IsCharter]

    @property
    def charter_id(self):
        return self.request.user.charter_id

    @property
    def bedrijf_id(self):
        return None

    def toegestane_voertuigen(self):
        charter = Charter.objects.filter(pk=self.charter_id).first()
        if charter is None:
            return []
        return list(charter.voertuigen.all())

    def uren_queryset(self):
        return charter_uren_queryset(self.charter_id)


class CharterVoertuigenView(CharterBasisMixin, PortaalVoertuigenView):
    """GET /api/charter/voertuigen/"""


class CharterPositiesView(CharterBasisMixin, PortaalPositiesView):
    """GET /api/charter/posities/"""


class CharterRittenView(CharterBasisMixin, PortaalRittenView):
    """GET /api/charter/ritten/"""


class CharterVoertuigDagView(CharterBasisMixin, PortaalVoertuigDagView):
    """GET /api/charter/voertuigen/<kenteken>/dag/"""


class CharterUrenView(CharterBasisMixin, PortaalUrenView):
    """GET /api/charter/uren/ — uren van de eigen chauffeurs per week."""


class CharterTolView(CharterBasisMixin, PortaalTolView):
    """GET /api/charter/tol/ — alleen tol op dagen dat de eigen chauffeur in die wagen reed.

    De koppeling loopt via de uren: elke urenregel levert een paar
    (kenteken, datum) op. Een passage telt alleen mee als zijn kenteken en
    lokale datum precies zo'n paar vormen.
    """

    def tol_bron(self):
        self._gereden_dagen = set()
        weergave = {}
        for kenteken, datum in self.uren_queryset().values_list('kenteken', 'datum'):
            plaat = normalize_plate(kenteken)
            if not plaat:
                continue
            self._gereden_dagen.add((plaat, datum))
            weergave.setdefault(plaat, kenteken)

        if not self._gereden_dagen:
            return TollingEvent.objects.none(), {}

        for voertuig in Vehicle.objects.only('kenteken'):
            plaat = normalize_plate(voertuig.kenteken)
            if plaat in weergave:
                weergave[plaat] = voertuig.kenteken

        datums = [datum for _, datum in self._gereden_dagen]
        passages = TollingEvent.objects.filter(
            license_plate_normalized__in=list(weergave),
            start_at__date__gte=min(datums),
            start_at__date__lte=max(datums),
        )
        return passages, weergave

    def passage_toegestaan(self, passage, lokaal):
        return (passage.license_plate_normalized, lokaal.date()) in self._gereden_dagen
