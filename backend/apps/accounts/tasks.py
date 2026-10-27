"""
Achtergrondtaken rond de Azure-koppeling.

Het clientgeheim van de app-registratie verloopt; Microsoft waarschuwt daar
niet voor. Loopt het af, dan stopt het aanmaken van accounts zonder dat
iemand het merkt. Vandaar deze dagelijkse controle.
"""
import logging

from celery import shared_task
from django.core.mail import EmailMessage, get_connection
from django.utils import timezone

logger = logging.getLogger('accounts.security')

# Een week vooraf: genoeg tijd om in Azure een nieuw geheim te maken, en niet
# zo vroeg dat de melding wordt weggeklikt en vergeten.
WAARSCHUWINGSDAGEN = 7


def _ontvangers(instellingen) -> list:
    adressen = [
        (instellingen.reminder_email or '').strip(),
        (instellingen.company_email or '').strip(),
    ]
    return [adres for adres in adressen if adres][:1]


@shared_task
def controleer_azure_geheim():
    """
    Waarschuwt per e-mail als het clientgeheim bijna verloopt.

    Stuurt hooguit één bericht per vervaldatum: `entra_sync_secret_reminder_sent_on`
    wordt gezet zodra het bericht weg is. Zet een beheerder een nieuwe datum,
    dan wordt die markering gewist en kan er opnieuw gewaarschuwd worden.
    """
    from apps.accounts import graph
    from apps.core.models import AppSettings

    instellingen = AppSettings.get_settings()
    if not instellingen.entra_sync_enabled:
        return 'koppeling staat uit'

    vervaldatum = instellingen.entra_sync_secret_expires_on
    if not vervaldatum:
        return 'geen vervaldatum ingevuld'

    if not graph.verlooptermijn_bereikt(WAARSCHUWINGSDAGEN):
        return 'nog niet aan de beurt'

    if instellingen.entra_sync_secret_reminder_sent_on == vervaldatum:
        return 'al gewaarschuwd'

    ontvangers = _ontvangers(instellingen)
    if not ontvangers:
        logger.error('Azure-geheim verloopt, maar er is geen ontvanger ingesteld.')
        return 'geen ontvanger'

    if not instellingen.smtp_host:
        logger.error('Azure-geheim verloopt, maar SMTP is niet ingesteld.')
        return 'geen smtp'

    dagen = graph.dagen_tot_verval()
    if dagen is not None and dagen < 0:
        kop = f'Let op: het Azure-clientgeheim is {abs(dagen)} dag(en) geleden verlopen'
        uitleg = (
            'Het aanmaken van Microsoft-accounts vanuit het TMS werkt nu niet meer.'
        )
    else:
        kop = f'Het Azure-clientgeheim verloopt over {dagen} dag(en)'
        uitleg = (
            'Maak op tijd een nieuw geheim aan, anders stopt het aanmaken van '
            'Microsoft-accounts vanuit het TMS.'
        )

    tekst = (
        f'{kop}.\n\n'
        f'Vervaldatum: {vervaldatum.strftime("%d-%m-%Y")}\n\n'
        f'{uitleg}\n\n'
        'Wat te doen:\n'
        '1. Ga in Azure naar de app-registratie voor de TMS-gebruikerssynchronisatie.\n'
        '2. Maak onder "Certificaten en geheimen" een nieuw clientgeheim aan.\n'
        '3. Vul dat geheim met de nieuwe vervaldatum in bij Instellingen in het TMS.\n\n'
        'Het oude geheim kan daarna in Azure verwijderd worden.\n'
    )

    verbinding = get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=instellingen.smtp_host,
        port=instellingen.smtp_port,
        username=instellingen.smtp_username or '',
        password=instellingen.smtp_password or '',
        use_tls=instellingen.smtp_use_tls,
        fail_silently=False,
    )
    bericht = EmailMessage(
        subject=f'TMS – {kop}',
        body=tekst,
        from_email=(instellingen.smtp_from_email or instellingen.smtp_username),
        to=ontvangers,
        connection=verbinding,
    )

    try:
        bericht.send(fail_silently=False)
    except Exception as fout:
        # Niet markeren als verzonden: morgen opnieuw proberen is beter dan
        # een waarschuwing die niemand ooit krijgt.
        logger.exception('Waarschuwing Azure-geheim versturen mislukt: %s', fout)
        return 'verzenden mislukt'

    instellingen.entra_sync_secret_reminder_sent_on = vervaldatum
    instellingen.save(update_fields=['entra_sync_secret_reminder_sent_on'])
    logger.warning(
        'Waarschuwing verstuurd: Azure-clientgeheim verloopt op %s (%s dagen)',
        vervaldatum,
        dagen,
    )
    return {'verstuurd_aan': ontvangers, 'dagen': dagen, 'op': timezone.now().isoformat()}
