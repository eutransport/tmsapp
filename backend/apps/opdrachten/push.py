"""Pushmeldingen rond opdrachten.

Versturen gebeurt stil, net als bij de mail: een push die mislukt mag nooit het
aanmaken, starten of afmelden van een opdracht blokkeren.
"""
import logging

from .models import OpdrachtMailInstelling

logger = logging.getLogger(__name__)

TEKSTEN = {
    'nl': {
        'nieuw_titel': 'Nieuwe opdracht',
        'nieuw_body': '%(klant)s, %(adres)s',
        'gestart_titel': 'Opdracht gestart',
        'gestart_body': '%(chauffeur)s is onderweg naar %(klant)s',
        'afgeleverd_titel': 'Opdracht afgeleverd',
        'afgeleverd_body': '%(chauffeur)s heeft afgeleverd bij %(klant)s',
        'niet_geleverd_titel': 'Niet geleverd',
        'niet_geleverd_body': '%(chauffeur)s kon niet afleveren bij %(klant)s',
        'ingetrokken_titel': 'Opdracht ingetrokken',
        'ingetrokken_body': '%(klant)s, %(adres)s is vervallen',
        'overgezet_titel': 'Opdracht overgedragen',
        'overgezet_body': '%(klant)s, %(adres)s staat nu bij een andere chauffeur',
        'eta': 'Verwacht over %(minuten)s minuten',
    },
    'en': {
        'nieuw_titel': 'New order',
        'nieuw_body': '%(klant)s, %(adres)s',
        'gestart_titel': 'Order started',
        'gestart_body': '%(chauffeur)s is on the way to %(klant)s',
        'afgeleverd_titel': 'Order delivered',
        'afgeleverd_body': '%(chauffeur)s delivered at %(klant)s',
        'niet_geleverd_titel': 'Not delivered',
        'niet_geleverd_body': '%(chauffeur)s could not deliver at %(klant)s',
        'ingetrokken_titel': 'Order withdrawn',
        'ingetrokken_body': '%(klant)s, %(adres)s has been cancelled',
        'overgezet_titel': 'Order reassigned',
        'overgezet_body': '%(klant)s, %(adres)s has been given to another driver',
        'eta': 'Expected in %(minuten)s minutes',
    },
    'tr': {
        'nieuw_titel': 'Yeni sipariş',
        'nieuw_body': '%(klant)s, %(adres)s',
        'gestart_titel': 'Sipariş başlatıldı',
        'gestart_body': '%(chauffeur)s %(klant)s adresine gidiyor',
        'afgeleverd_titel': 'Sipariş teslim edildi',
        'afgeleverd_body': '%(chauffeur)s %(klant)s adresine teslim etti',
        'niet_geleverd_titel': 'Teslim edilmedi',
        'niet_geleverd_body': '%(chauffeur)s %(klant)s adresine teslim edemedi',
        'ingetrokken_titel': 'Sipariş iptal edildi',
        'ingetrokken_body': '%(klant)s, %(adres)s iptal edildi',
        'overgezet_titel': 'Sipariş devredildi',
        'overgezet_body': '%(klant)s, %(adres)s artık başka bir şoförde',
        'eta': 'Tahmini %(minuten)s dakika',
    },
}


def _taal(opdracht):
    instelling = OpdrachtMailInstelling.objects.filter(bedrijf_id=opdracht.bedrijf_id).first()
    taal = getattr(instelling, 'taal', '') or 'nl'
    return taal if taal in TEKSTEN else 'nl'


def _chauffeur_naam(opdracht):
    chauffeur = opdracht.chauffeur
    return getattr(chauffeur, 'naam', '') or '-'


def _adres(opdracht):
    return ' '.join(deel for deel in (opdracht.adres, opdracht.plaats) if deel)


def _portaalgebruikers(opdracht):
    from apps.accounts.models import User, UserRole

    return list(
        User.objects.filter(
            opdrachtgever_bedrijf_id=opdracht.bedrijf_id,
            rol=UserRole.OPDRACHTGEVER,
            is_active=True,
        )
    )


def _stuur(gebruikers, titel, body, url):
    gebruikers = [g for g in gebruikers if g is not None]
    if not gebruikers:
        return False
    try:
        from apps.notifications.services import PushNotificationService

        dienst = PushNotificationService()
        if not dienst.is_configured():
            return False
        resultaat = dienst.send_to_users(users=gebruikers, title=titel, body=body, url=url)
        return bool(resultaat.get('success_count'))
    except Exception:
        logger.exception('Pushmelding voor opdracht kon niet verstuurd worden')
        return False


def meld_nieuwe_opdracht(opdracht):
    """De chauffeur hoort meteen dat er werk klaarstaat."""
    gebruiker = getattr(opdracht.chauffeur, 'gekoppelde_gebruiker', None)
    if gebruiker is None:
        return False
    T = TEKSTEN[_taal(opdracht)]
    return _stuur(
        [gebruiker],
        T['nieuw_titel'],
        T['nieuw_body'] % {'klant': opdracht.klant_naam, 'adres': _adres(opdracht)},
        '/mijn-opdrachten',
    )


def meld_ingetrokken(opdracht):
    """De chauffeur hoort dat hij niet meer hoeft te rijden."""
    gebruiker = getattr(opdracht.chauffeur, 'gekoppelde_gebruiker', None)
    if gebruiker is None:
        return False
    T = TEKSTEN[_taal(opdracht)]
    return _stuur(
        [gebruiker],
        T['ingetrokken_titel'],
        T['ingetrokken_body'] % {'klant': opdracht.klant_naam, 'adres': _adres(opdracht)},
        '/mijn-opdrachten',
    )


def meld_overgezet(opdracht, vorige_chauffeur):
    """De oude chauffeur raakt de opdracht kwijt, de nieuwe krijgt hem erbij."""
    T = TEKSTEN[_taal(opdracht)]
    gegevens = {'klant': opdracht.klant_naam, 'adres': _adres(opdracht)}

    oud = getattr(vorige_chauffeur, 'gekoppelde_gebruiker', None)
    if oud is not None:
        _stuur([oud], T['overgezet_titel'], T['overgezet_body'] % gegevens, '/mijn-opdrachten')

    return meld_nieuwe_opdracht(opdracht)


def meld_gestart(opdracht):
    T = TEKSTEN[_taal(opdracht)]
    body = T['gestart_body'] % {'chauffeur': _chauffeur_naam(opdracht), 'klant': opdracht.klant_naam}
    if opdracht.eta_start_minuten:
        body = f"{body} · {T['eta'] % {'minuten': opdracht.eta_start_minuten}}"
    return _stuur(_portaalgebruikers(opdracht), T['gestart_titel'], body, '/portaal/opdrachten')


def meld_afgeleverd(opdracht):
    T = TEKSTEN[_taal(opdracht)]
    return _stuur(
        _portaalgebruikers(opdracht),
        T['afgeleverd_titel'],
        T['afgeleverd_body'] % {'chauffeur': _chauffeur_naam(opdracht), 'klant': opdracht.klant_naam},
        '/portaal/opdrachten',
    )


def meld_niet_geleverd(opdracht):
    T = TEKSTEN[_taal(opdracht)]
    body = T['niet_geleverd_body'] % {'chauffeur': _chauffeur_naam(opdracht), 'klant': opdracht.klant_naam}
    if opdracht.niet_geleverd_reden:
        body = f'{body}: {opdracht.niet_geleverd_reden[:80]}'
    return _stuur(_portaalgebruikers(opdracht), T['niet_geleverd_titel'], body, '/portaal/opdrachten')
