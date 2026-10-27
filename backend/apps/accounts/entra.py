"""
Inloggen via Microsoft Entra ID.

De opzet is bewust klein gehouden: Microsoft stelt alleen vast *wie* iemand is.
Wat die persoon vervolgens mag, bepaalt deze applicatie zelf via `rol` en
`module_permissions`. Daarom wisselen we een token van Microsoft om voor een
eigen JWT en laten we de rest van de applicatie ongemoeid.

Wat hier expliciet NIET gebeurt: rollen of rechten uit het Microsoft-token
overnemen. Die claims zijn beheerd in een andere omgeving en mogen nooit
rechtstreeks bepalen wat iemand in deze applicatie kan.
"""
import hashlib
import logging

import jwt
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger('accounts.security')

# De metadata verandert zelden, maar sleutels worden wel geroteerd. Een uur is
# de gebruikelijke balans tussen rotatie opvangen en niet elke login een
# netwerkverzoek doen.
METADATA_CACHE_KEY = 'entra:oidc-metadata'
METADATA_CACHE_TTL = 3600

# Entra levert het e-mailadres niet altijd in hetzelfde veld. Deze volgorde
# gaat van meest naar minst betrouwbaar.
EMAIL_CLAIMS = ('email', 'preferred_username', 'upn', 'unique_name')

# Een uitgenodigde gast krijgt in de tenant een omgebouwde inlognaam:
#   info@moveo-bv.nl  ->  info_moveo-bv.nl#EXT#@mijntenant.onmicrosoft.com
# Dat is niet het adres waarop wij de gebruiker kennen, dus draaien we het terug.
GAST_SCHEIDING = '#EXT#'


def _herstel_gast_email(waarde: str) -> str:
    if GAST_SCHEIDING not in waarde:
        return waarde
    oorspronkelijk = waarde.split(GAST_SCHEIDING, 1)[0]
    # Bij het uitnodigen is de '@' vervangen door een '_'. Alleen de laatste
    # telt; een onderstrepingsteken in het adres zelf blijft zo intact.
    basis, _, domein = oorspronkelijk.rpartition('_')
    if basis and domein:
        return f'{basis}@{domein}'
    return oorspronkelijk


class EntraConfiguratieFout(Exception):
    """De koppeling is niet (volledig) ingesteld."""


class EntraTokenFout(Exception):
    """Het token is niet geldig, of de gebruiker mag niet naar binnen."""


def is_ingeschakeld() -> bool:
    return bool(getattr(settings, 'ENTRA_ENABLED', False))


def authority() -> str:
    """
    De basis-URL waar Microsoft het inloggen afhandelt.

    Een werknemers-tenant (met B2B-gasten) gebruikt login.microsoftonline.com
    met de tenant-id. Een aparte External ID-tenant gebruikt haar eigen
    ciamlogin.com-adres.
    """
    soort = getattr(settings, 'ENTRA_TENANT_TYPE', 'workforce')

    if soort == 'external':
        naam = getattr(settings, 'ENTRA_TENANT_NAME', '')
        if not naam:
            raise EntraConfiguratieFout(
                'ENTRA_TENANT_NAME ontbreekt voor een external tenant.'
            )
        return f'https://{naam}.ciamlogin.com/{naam}.onmicrosoft.com/v2.0'

    tenant_id = getattr(settings, 'ENTRA_TENANT_ID', '')
    if not tenant_id:
        raise EntraConfiguratieFout('ENTRA_TENANT_ID ontbreekt.')
    return f'https://login.microsoftonline.com/{tenant_id}/v2.0'


def metadata_url() -> str:
    return f'{authority()}/.well-known/openid-configuration'


def _metadata_cache_key() -> str:
    """
    De cachesleutel bevat de authority, zodat een tenantwijziging niet urenlang
    de metadata van de vorige tenant blijft gebruiken. Zonder dit worden na een
    verhuizing alle tokens afgekeurd omdat de uitgever niet blijkt te kloppen.
    """
    vingerafdruk = hashlib.sha256(authority().encode()).hexdigest()[:16]
    return f'{METADATA_CACHE_KEY}:{vingerafdruk}'


def _haal_metadata() -> dict:
    """Haal de OIDC-metadata op, met cache."""
    sleutel = _metadata_cache_key()
    bewaard = cache.get(sleutel)
    if bewaard:
        return bewaard

    import requests

    antwoord = requests.get(metadata_url(), timeout=10)
    antwoord.raise_for_status()
    data = antwoord.json()
    if 'jwks_uri' not in data or 'issuer' not in data:
        raise EntraConfiguratieFout('Onverwachte OIDC-metadata van Microsoft.')

    cache.set(sleutel, data, METADATA_CACHE_TTL)
    return data


def _signing_key(token: str, jwks_uri: str):
    client = jwt.PyJWKClient(jwks_uri, cache_keys=True)
    return client.get_signing_key_from_jwt(token).key


def valideer_token(token: str) -> dict:
    """
    Controleer een id-token van Entra en geef de claims terug.

    Controleert handtekening, uitgever, doelgroep en geldigheidsduur. Een token
    dat ook maar op een van die punten afwijkt wordt geweigerd.
    """
    if not is_ingeschakeld():
        raise EntraConfiguratieFout('Inloggen via Microsoft staat uit.')
    if not token:
        raise EntraTokenFout('Geen token ontvangen.')

    metadata = _haal_metadata()

    try:
        sleutel = _signing_key(token, metadata['jwks_uri'])
        claims = jwt.decode(
            token,
            sleutel,
            algorithms=['RS256'],
            audience=settings.ENTRA_CLIENT_ID,
            issuer=metadata['issuer'],
            options={
                'require': ['exp', 'iat', 'aud', 'iss'],
                'verify_exp': True,
                'verify_aud': True,
                'verify_iss': True,
                'verify_signature': True,
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise EntraTokenFout('Het token van Microsoft is verlopen.') from exc
    except jwt.InvalidAudienceError as exc:
        raise EntraTokenFout('Het token hoort niet bij deze applicatie.') from exc
    except jwt.InvalidIssuerError as exc:
        raise EntraTokenFout('Het token komt niet van de verwachte tenant.') from exc
    except jwt.PyJWTError as exc:
        # Geen details naar buiten: dat zou een aanvaller helpen bij het
        # finetunen van een vervalst token.
        logger.warning('Entra-token geweigerd: %s', exc)
        raise EntraTokenFout('Het token van Microsoft is ongeldig.') from exc

    return claims


def email_uit_claims(claims: dict) -> str:
    for veld in EMAIL_CLAIMS:
        waarde = claims.get(veld)
        if not waarde:
            continue
        hersteld = _herstel_gast_email(str(waarde).strip())
        if '@' in hersteld:
            return hersteld.lower()
    raise EntraTokenFout(
        'Het token bevat geen e-mailadres. Zet de claim "email" aan in de user flow.'
    )


def _domein_toegestaan(email: str) -> bool:
    toegestaan = getattr(settings, 'ENTRA_ALLOWED_EMAIL_DOMAINS', [])
    if not toegestaan:
        return True
    return email.rsplit('@', 1)[-1] in toegestaan


def zoek_of_maak_gebruiker(claims: dict):
    """
    Koppel de Microsoft-identiteit aan een gebruiker in deze applicatie.

    Standaard moet die gebruiker al bestaan. Automatisch aanmaken is een
    bewuste keuze die per omgeving aangezet moet worden.
    """
    from apps.accounts.models import User

    email = email_uit_claims(claims)

    if not _domein_toegestaan(email):
        logger.warning('Entra-login geweigerd, domein niet toegestaan: %s', email)
        raise EntraTokenFout('Dit e-maildomein mag niet inloggen.')

    gebruiker = User.objects.filter(email__iexact=email).first()

    if gebruiker is None:
        if not getattr(settings, 'ENTRA_AUTO_CREATE_USERS', False):
            logger.warning('Entra-login voor onbekend account: %s', email)
            raise EntraTokenFout(
                'Dit account is bij ons niet bekend. Vraag een beheerder om toegang.'
            )
        gebruiker = User.objects.create_user(
            email=email,
            username=email,
            voornaam=(claims.get('given_name') or '').strip(),
            achternaam=(claims.get('family_name') or '').strip(),
            rol=getattr(settings, 'ENTRA_DEFAULT_ROLE', 'opdrachtgever'),
        )
        # Geen bruikbaar wachtwoord: deze gebruiker hoort via Microsoft binnen
        # te komen, niet via het gewone inlogformulier.
        gebruiker.set_unusable_password()
        gebruiker.save(update_fields=['password'])
        logger.info('Entra-login: nieuw account aangemaakt voor %s', email)

    if not gebruiker.is_active:
        logger.warning('Entra-login geweigerd, account staat uit: %s', email)
        raise EntraTokenFout('Dit account is gedeactiveerd.')

    return gebruiker
