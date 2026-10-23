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
    adres = ' '.join(deel for deel in (opdracht.adres, opdracht.plaats) if deel)
    return _stuur(
        [gebruiker],
        T['nieuw_titel'],
        T['nieuw_body'] % {'klant': opdracht.klant_naam, 'adres': adres},
        '/mijn-opdrachten',
    )


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
