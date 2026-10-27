"""
Gebruikers uit deze applicatie koppelen aan accounts in Microsoft Entra ID.

De regel is: bestaat het account al in Azure, dan raken we het niet aan.
Alleen als het ontbreekt wordt er een nieuw account gemaakt. De applicatie
heeft in Azure ook letterlijk geen rechten om meer te doen.
"""
import logging

from django.utils import timezone

from apps.accounts import graph
from apps.core.models import AppSettings

logger = logging.getLogger('accounts.security')


def synchroniseer_gebruiker_met_azure(gebruiker, inlognaam=None, beheerder=None) -> dict:
    """
    Zorgt dat `gebruiker` een account in Entra ID heeft en koppelt het.

    Geeft een verslag terug met `status`:
      * `al_gekoppeld`  - deze gebruiker was al gekoppeld; niets gedaan
      * `gekoppeld`     - account bestond al in Azure; alleen vastgelegd
      * `aangemaakt`    - nieuw account gemaakt; `wachtwoord` is eenmalig

    Het startwachtwoord wordt bewust alleen teruggegeven en nooit opgeslagen.
    """
    if not graph.is_ingeschakeld():
        raise graph.GraphNietIngesteld(
            'De koppeling met Azure staat uit of is niet volledig ingevuld.'
        )

    # Een geblokkeerde gebruiker hoort geen werkend Microsoft-account te
    # krijgen. Aanmaken en meteen weer uitzetten zou alleen maar rommel in
    # de tenant opleveren.
    if not gebruiker.is_active:
        raise graph.GraphFout(
            'Deze gebruiker is inactief en wordt niet met Azure gesynchroniseerd.'
        )

    if gebruiker.entra_object_id:
        return {
            'status': 'al_gekoppeld',
            'inlognaam': gebruiker.entra_upn,
            'object_id': gebruiker.entra_object_id,
        }

    instellingen = AppSettings.get_settings()
    inlognaam = (inlognaam or '').strip().lower() or graph.stel_inlognaam_voor(
        gebruiker, instellingen.entra_sync_domain
    )

    # Eerst op de voorgestelde inlognaam zoeken, daarna op het e-mailadres uit
    # de applicatie. Dat tweede vangt het geval af dat iemand in Azure al
    # bestaat onder een ander adres dan wij zouden verzinnen.
    bestaand = graph.zoek_account(inlognaam)
    if bestaand is None and gebruiker.email and gebruiker.email.lower() != inlognaam:
        bestaand = graph.zoek_account(gebruiker.email.lower())

    if bestaand is not None:
        graph.koppel(gebruiker, bestaand)
        logger.info(
            'Entra-synchronisatie: %s gekoppeld aan bestaand account %s',
            gebruiker.email,
            bestaand.get('userPrincipalName'),
        )
        return {
            'status': 'gekoppeld',
            'inlognaam': gebruiker.entra_upn,
            'object_id': gebruiker.entra_object_id,
        }

    gegevens, wachtwoord = graph.maak_account(gebruiker, inlognaam)
    graph.koppel(gebruiker, gegevens)
    logger.warning(
        'Entra-synchronisatie: nieuw account %s aangemaakt voor %s door %s',
        gegevens.get('userPrincipalName'),
        gebruiker.email,
        getattr(beheerder, 'email', 'systeem'),
    )
    return {
        'status': 'aangemaakt',
        'inlognaam': gebruiker.entra_upn,
        'object_id': gebruiker.entra_object_id,
        'wachtwoord': wachtwoord,
        'aangemaakt_op': timezone.now().isoformat(),
    }


def werk_azure_status_bij(gebruiker, beheerder=None) -> str:
    """
    Zet het gekoppelde Azure-account aan of uit, gelijk aan de TMS-status.

    Geeft terug wat er gebeurd is: `niet_gekoppeld`, `uit`, `koppeling_uit`
    of `aangepast`. Het blokkeren van een gebruiker in het TMS hoort ook in
    Azure te gelden, anders kan iemand via Microsoft gewoon weer binnen.
    """
    if not gebruiker.entra_object_id:
        return 'niet_gekoppeld'

    if not graph.is_ingeschakeld():
        return 'koppeling_uit'

    graph.zet_account_status(gebruiker.entra_object_id, gebruiker.is_active)
    gebruiker.entra_synced_at = timezone.now()
    gebruiker.save(update_fields=['entra_synced_at'])

    logger.warning(
        'Entra-synchronisatie: account van %s %s door %s',
        gebruiker.email,
        'ingeschakeld' if gebruiker.is_active else 'uitgeschakeld',
        getattr(beheerder, 'email', 'systeem'),
    )
    return 'aangepast'