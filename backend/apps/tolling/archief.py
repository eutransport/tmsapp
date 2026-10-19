"""Alleen de lopende administratie laten zien.

Afgesloten periodes blijven in de database staan, maar horen nergens in een
gewoon overzicht thuis; zie `afsluiting_service`. Elke query die iets aan de
gebruiker toont of iets factureert gaat hier doorheen, zodat er maar op één
plek staat wat 'lopend' betekent.

Het archief zelf en de technische paden die juist álles moeten zien - de
dubbelcontrole bij het importeren, de backups, het terugdraaien van een
afsluiting en het opnieuw afdrukken van een oude factuur - gebruiken dit
bewust niet.
"""
from django.db.models import Q

LOPEND = Q(afsluiting__isnull=True)


def lopend(queryset):
    """Dezelfde queryset, zonder wat in een afsluiting is opgeborgen."""
    return queryset.filter(LOPEND)
