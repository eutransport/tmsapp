"""
Access helpers voor administratie-gebaseerde scoping.

Gebruik deze helpers in viewsets/views om data (facturen, uitgaven, omzet,
dashboard-cijfers) te filteren op de administraties waar een gebruiker via
`Administratie.allowed_users` toegang toe heeft.

Voor admins/superusers geven beide helpers ``None`` terug om "geen filter"
te signaleren — de aanroeper kan dan de volledige queryset gebruiken.
"""
from __future__ import annotations

from typing import Optional, Set
from uuid import UUID


def _is_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    return getattr(user, 'rol', None) == 'admin' or getattr(user, 'is_staff', False)


def accessible_administratie_ids(user) -> Optional[Set[UUID]]:
    """
    Geef de set van Administratie-ids waar ``user`` toegang toe heeft.

    - Admins/superusers krijgen ``None`` terug (= geen scoping nodig).
    - Niet-ingelogde of niet-toegelaten users krijgen een lege set terug.
    """
    if _is_admin(user):
        return None
    if not user or not user.is_authenticated:
        return set()
    from apps.core.models import Administratie
    return set(
        Administratie.objects.filter(allowed_users=user).values_list('id', flat=True)
    )


def accessible_company_ids(user) -> Optional[Set[UUID]]:
    """
    Geef de set van Company-ids die gekoppeld zijn aan de administraties
    waar ``user`` toegang toe heeft.

    - Admins/superusers krijgen ``None`` terug (= geen scoping nodig).
    - Niet-ingelogde of niet-toegelaten users krijgen een lege set terug.
    """
    if _is_admin(user):
        return None
    if not user or not user.is_authenticated:
        return set()
    from apps.core.models import Administratie
    return set(
        Administratie.objects
        .filter(allowed_users=user)
        .exclude(bedrijven__isnull=True)
        .values_list('bedrijven__id', flat=True)
    )
