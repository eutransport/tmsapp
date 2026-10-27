"""
Accounts aanmaken in Microsoft Entra ID via Microsoft Graph.

Bewust een aparte app-registratie van die voor het inloggen. De inlog-app
draait in de browser van elke gebruiker; deze praat alleen server-naar-server
en heeft rechten die je nooit in een browser wilt hebben.

De rechten zijn zo krap mogelijk gehouden:
  * User.Create    - uitsluitend nieuwe accounts aanmaken
  * User.Read.All  - kijken of iemand al bestaat

Daarmee kan deze koppeling met opzet NIET: bestaande accounts wijzigen of
verwijderen, wachtwoorden van anderen resetten, groepen of rollen aanpassen,
of bij mail en bestanden komen.
"""
import logging
import secrets
import string

import requests
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger('accounts.security')

GRAPH = 'https://graph.microsoft.com/v1.0'
TOKEN_CACHE_KEY = 'entra:graph-token'

# Microsoft hanteert een tijdslimiet; zonder eigen limiet blijft een verzoek
# hangen en loopt de hele synchronisatie vast.
TIMEOUT = 20


class GraphFout(Exception):
    """Iets ging mis in het verkeer met Microsoft. De tekst is leesbaar."""


class GraphNietIngesteld(GraphFout):
    """De koppeling staat uit of is niet volledig ingevuld."""


def _instellingen():
    from apps.core.models import AppSettings

    return AppSettings.get_settings()


def is_ingeschakeld() -> bool:
    s = _instellingen()
    return bool(
        s.entra_sync_enabled
        and s.entra_sync_client_id
        and s.entra_sync_client_secret
    )


def _tenant_id() -> str:
    from django.conf import settings as django_settings

    tenant = getattr(django_settings, 'ENTRA_TENANT_ID', '')
    if not tenant:
        raise GraphNietIngesteld(
            'Er is geen tenant ingesteld. Vul eerst de Entra-instellingen in.'
        )
    return tenant


def _haal_token() -> str:
    """
    Haalt een toegangstoken op met het clientgeheim.

    Het token wordt gedeeld bewaard: een synchronisatie van tientallen
    gebruikers hoeft niet tientallen keren opnieuw in te loggen.
    """
    bewaard = cache.get(TOKEN_CACHE_KEY)
    if bewaard:
        return bewaard

    s = _instellingen()
    if not is_ingeschakeld():
        raise GraphNietIngesteld(
            'De koppeling met Azure staat uit of is niet volledig ingevuld.'
        )

    url = f'https://login.microsoftonline.com/{_tenant_id()}/oauth2/v2.0/token'
    try:
        antwoord = requests.post(
            url,
            data={
                'client_id': s.entra_sync_client_id,
                'client_secret': s.entra_sync_client_secret,
                'scope': 'https://graph.microsoft.com/.default',
                'grant_type': 'client_credentials',
            },
            timeout=TIMEOUT,
        )
    except requests.RequestException as fout:
        raise GraphFout(f'Azure is niet bereikbaar: {fout}') from fout

    if antwoord.status_code != 200:
        # De foutbeschrijving van Microsoft is lang en bevat verwijzingen;
        # de eerste regel is doorgaans het bruikbare deel.
        melding = _leesbare_fout(antwoord)
        logger.error('Entra-synchronisatie: token ophalen mislukt: %s', melding)
        raise GraphFout(f'Aanmelden bij Azure mislukt: {melding}')

    gegevens = antwoord.json()
    token = gegevens.get('access_token')
    if not token:
        raise GraphFout('Azure gaf geen toegangstoken terug.')

    # Een marge van een minuut voorkomt dat een token tijdens gebruik verloopt.
    geldig = max(int(gegevens.get('expires_in', 3600)) - 60, 60)
    cache.set(TOKEN_CACHE_KEY, token, geldig)
    return token


def vergeet_token() -> None:
    """Na het wijzigen van het geheim mag het oude token niet blijven hangen."""
    cache.delete(TOKEN_CACHE_KEY)


def _leesbare_fout(antwoord) -> str:
    try:
        gegevens = antwoord.json()
    except ValueError:
        return f'HTTP {antwoord.status_code}'

    fout = gegevens.get('error')
    if isinstance(fout, dict):
        melding = fout.get('message') or fout.get('code') or ''
    else:
        melding = gegevens.get('error_description') or str(fout or '')

    melding = melding.split('\r\n')[0].split('\n')[0].strip()
    return melding or f'HTTP {antwoord.status_code}'


def _verzoek(methode: str, pad: str, **kwargs):
    token = _haal_token()
    try:
        antwoord = requests.request(
            methode,
            f'{GRAPH}{pad}',
            headers={'Authorization': f'Bearer {token}'},
            timeout=TIMEOUT,
            **kwargs,
        )
    except requests.RequestException as fout:
        raise GraphFout(f'Azure is niet bereikbaar: {fout}') from fout

    if antwoord.status_code == 403:
        raise GraphFout(
            'Azure weigert dit: de app-registratie mist de rechten '
            'User.Create en User.Read.All, of er is nog geen '
            'beheerderstoestemming gegeven.'
        )
    if antwoord.status_code == 401:
        # Een verlopen of ingetrokken geheim; het bewaarde token is waardeloos.
        vergeet_token()
        raise GraphFout(
            'Azure accepteert de aanmelding niet meer. Controleer of het '
            'clientgeheim nog geldig is.'
        )
    return antwoord


def zoek_account(adres: str) -> dict | None:
    """
    Zoekt een account op inlognaam of e-mailadres.

    Geeft `None` als het niet bestaat. Alles wat geen duidelijk antwoord is,
    wordt een fout: stilletjes 'bestaat niet' teruggeven zou leiden tot een
    tweede account voor dezelfde persoon.
    """
    if not adres:
        return None

    # Een apostrof zou het filter kunnen breken; Microsoft verwacht die
    # verdubbeld. Dit is geen theoretisch geval: namen als o'brien komen voor.
    veilig = adres.replace("'", "''")
    filter_tekst = f"userPrincipalName eq '{veilig}' or mail eq '{veilig}'"

    antwoord = _verzoek(
        'GET',
        '/users',
        params={
            '$filter': filter_tekst,
            '$select': 'id,userPrincipalName,mail,displayName,accountEnabled',
            '$top': 2,
        },
    )
    if antwoord.status_code != 200:
        raise GraphFout(f'Opzoeken mislukte: {_leesbare_fout(antwoord)}')

    gevonden = antwoord.json().get('value') or []
    return gevonden[0] if gevonden else None


def genereer_wachtwoord(lengte: int = 20) -> str:
    """
    Een startwachtwoord dat aan het wachtwoordbeleid van Entra voldoet.

    Expliciet uit alle vier de groepen putten; puur toeval kan een groep
    overslaan en dan weigert Microsoft het wachtwoord.
    """
    groepen = (
        string.ascii_lowercase,
        string.ascii_uppercase,
        string.digits,
        '!@#$%^&*-_=+?',
    )
    tekens = [secrets.choice(groep) for groep in groepen]
    alles = ''.join(groepen)
    tekens += [secrets.choice(alles) for _ in range(max(lengte - len(groepen), 0))]
    secrets.SystemRandom().shuffle(tekens)
    return ''.join(tekens)


def stel_inlognaam_voor(gebruiker, domein: str) -> str:
    """
    Bedenkt de Azure-inlognaam voor een gebruiker.

    Staat het e-mailadres al op het gekozen domein, dan blijft dat ongewijzigd.
    Anders wordt alleen het deel vóór de '@' overgenomen; het domein verzinnen
    we niet, dat kiest de beheerder.
    """
    domein = (domein or '').strip().lstrip('@').lower()
    if not domein:
        raise GraphNietIngesteld('Er is geen domein ingesteld voor nieuwe accounts.')

    adres = (gebruiker.email or '').strip().lower()
    lokaal = adres.split('@')[0] if adres else ''
    if not lokaal:
        raise GraphFout('Deze gebruiker heeft geen e-mailadres.')

    # Entra staat lang niet alle tekens toe in een inlognaam.
    toegestaan = set(string.ascii_lowercase + string.digits + "'.-_!#^~")
    lokaal = ''.join(teken for teken in lokaal if teken in toegestaan)
    if not lokaal:
        raise GraphFout(
            f'Uit het adres "{adres}" is geen geldige Azure-inlognaam af te leiden.'
        )

    return f'{lokaal}@{domein}'


def maak_account(gebruiker, inlognaam: str) -> tuple[dict, str]:
    """
    Maakt een nieuw account aan en geeft (gegevens, startwachtwoord) terug.

    Het wachtwoord wordt nergens bewaard: het is eenmalig, de gebruiker moet
    het bij de eerste aanmelding wijzigen.
    """
    wachtwoord = genereer_wachtwoord()
    weergavenaam = (
        f'{gebruiker.voornaam} {gebruiker.achternaam}'.strip()
        or gebruiker.username
        or inlognaam
    )

    lichaam = {
        'accountEnabled': True,
        'displayName': weergavenaam,
        'mailNickname': inlognaam.split('@')[0],
        'userPrincipalName': inlognaam,
        'passwordProfile': {
            'password': wachtwoord,
            'forceChangePasswordNextSignIn': True,
        },
    }
    if gebruiker.voornaam:
        lichaam['givenName'] = gebruiker.voornaam
    if gebruiker.achternaam:
        lichaam['surname'] = gebruiker.achternaam

    antwoord = _verzoek('POST', '/users', json=lichaam)
    if antwoord.status_code not in (200, 201):
        raise GraphFout(f'Aanmaken mislukte: {_leesbare_fout(antwoord)}')

    gegevens = antwoord.json()
    logger.info(
        'Entra-synchronisatie: account aangemaakt voor %s (%s)',
        gebruiker.email,
        gegevens.get('id'),
    )
    return gegevens, wachtwoord


def koppel(gebruiker, gegevens: dict) -> None:
    """Legt de verwijzing naar het Azure-account vast op de gebruiker."""
    gebruiker.entra_object_id = gegevens.get('id') or ''
    gebruiker.entra_upn = gegevens.get('userPrincipalName') or ''
    gebruiker.entra_synced_at = timezone.now()
    gebruiker.save(
        update_fields=['entra_object_id', 'entra_upn', 'entra_synced_at']
    )


def dagen_tot_verval() -> int | None:
    """
    Aantal dagen tot het clientgeheim verloopt, of `None` als er geen datum is.
    Negatief betekent: al verlopen.
    """
    s = _instellingen()
    if not s.entra_sync_secret_expires_on:
        return None
    return (s.entra_sync_secret_expires_on - timezone.localdate()).days


def verlooptermijn_bereikt(waarschuwingsdagen: int = 7) -> bool:
    dagen = dagen_tot_verval()
    return dagen is not None and dagen <= waarschuwingsdagen


__all__ = [
    'GraphFout',
    'GraphNietIngesteld',
    'dagen_tot_verval',
    'genereer_wachtwoord',
    'is_ingeschakeld',
    'koppel',
    'maak_account',
    'stel_inlognaam_voor',
    'vergeet_token',
    'verlooptermijn_bereikt',
    'zoek_account',
]
