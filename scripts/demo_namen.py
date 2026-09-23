"""
Tijdelijk fictieve namen voor de handleiding-screenshots.

Vervangt voornaam, achternaam en e-mailadres van alle gebruikers, de namen van
de bedrijven en de losse notificatieadressen door verzonnen gegevens, zodat er
geen namen van collega's, chauffeurs of opdrachtgevers op de schermafbeeldingen
komen te staan. De originele gegevens gaan eerst naar een backupbestand, zodat
alles daarna weer teruggezet kan worden.

Gebruik:
    python manage.py shell -c "exec(open('/app/scripts/demo_namen.py').read())"
    DEMO_NAMEN_HERSTEL=1 python manage.py shell -c "exec(...)"
"""
import json
import os

from django.contrib.auth import get_user_model

from apps.companies.models import Company
from apps.maintenance.models import (
    ADRRecord, ADRSettings, APKSettings,
    FireExtinguisherRecord, FireExtinguisherSettings,
)

User = get_user_model()
BESTAND = '/app/demo_namen_backup.json'

# Het account waarmee de screenshots worden gemaakt; het nieuwe adres wordt
# apart getoond zodat er daarna nog ingelogd kan worden.
DEMO_LOGIN = 'handleiding@moveo-bv.nl'

# Neutrale, duidelijk verzonnen namen.
FICTIEF = [
    ('Jan', 'de Vries'),
    ('Sanne', 'Bakker'),
    ('Peter', 'Jansen'),
    ('Fatima', 'el Amrani'),
    ('Tom', 'Hendriks'),
    ('Lisa', 'van Dijk'),
    ('Mark', 'Visser'),
    ('Yusuf', 'Demir'),
    ('Eva', 'Smit'),
    ('Ruben', 'Mulder'),
    ('Nora', 'de Boer'),
    ('Daan', 'Peters'),
    ('Iris', 'Vermeulen'),
    ('Kasper', 'Willems'),
    ('Amber', 'Kuipers'),
    ('Joris', 'Blom'),
    ('Maud', 'Schouten'),
    ('Levi', 'Timmermans'),
    ('Noor', 'Verhoeven'),
    ('Stijn', 'de Wit'),
    ('Julia', 'Brouwer'),
    ('Bram', 'Dekker'),
    ('Fleur', 'van Leeuwen'),
    ('Thijs', 'Groen'),
    ('Sara', 'Hofman'),
    ('Niels', 'van Beek'),
    ('Roos', 'Meijer'),
    ('Gijs', 'Kramer',),
    ('Emma', 'Scholten'),
    ('Wouter', 'Postma'),
]
DOMEIN = 'voorbeeldtransport.nl'
PLANNING = f'planning@{DOMEIN}'

# Verzonnen opdrachtgevers.
BEDRIJVEN = [
    'Noordzee Logistiek',
    'Van Elst Transport',
    'Meridiaan Distributie',
    'De Rijn Expeditie',
    'Zuiderkruis Vervoer',
    'Hanze Cargo',
]


def _slug(voornaam: str, achternaam: str) -> str:
    kern = f'{voornaam}.{achternaam}'.lower()
    for van, naar in (('ä', 'a'), ('ë', 'e'), ('ï', 'i'), ('ö', 'o'), ('ü', 'u'), (' ', '')):
        kern = kern.replace(van, naar)
    return kern


def herstellen():
    with open(BESTAND) as fh:
        backup = json.load(fh)

    hersteld = 0
    for rij in backup['gebruikers']:
        hersteld += User.objects.filter(id=rij['id']).update(
            voornaam=rij['voornaam'],
            achternaam=rij['achternaam'],
            email=rij['email'],
        )
    print('Namen teruggezet:', hersteld)

    for rij in backup['bedrijven']:
        Company.objects.filter(id=rij['id']).update(naam=rij['naam'])
    print('Bedrijfsnamen teruggezet:', len(backup['bedrijven']))

    for rij in backup['adr_emails']:
        ADRRecord.objects.filter(id=rij['id']).update(notify_extra_emails=rij['emails'])
    for rij in backup['blusser_emails']:
        FireExtinguisherRecord.objects.filter(id=rij['id']).update(notify_extra_emails=rij['emails'])
    ADRSettings.objects.update(default_notify_extra_emails=backup['adr_default_emails'])
    APKSettings.objects.update(default_notify_extra_emails=backup['apk_default_emails'])
    FireExtinguisherSettings.objects.update(
        default_notify_extra_emails=backup['blusser_default_emails']
    )
    print('Notificatieadressen teruggezet.')


def vervangen():
    gebruikers = list(User.objects.order_by('email'))
    bedrijven = list(Company.objects.order_by('naam'))
    adr_settings = ADRSettings.objects.first()
    apk_settings = APKSettings.objects.first()
    blusser_settings = FireExtinguisherSettings.objects.first()

    backup = {
        'gebruikers': [
            {
                'id': str(u.id),
                'voornaam': u.voornaam,
                'achternaam': u.achternaam,
                'email': u.email,
            }
            for u in gebruikers
        ],
        'bedrijven': [{'id': str(b.id), 'naam': b.naam} for b in bedrijven],
        'adr_emails': [
            {'id': str(r.id), 'emails': r.notify_extra_emails or []}
            for r in ADRRecord.objects.all()
        ],
        'blusser_emails': [
            {'id': str(r.id), 'emails': r.notify_extra_emails or []}
            for r in FireExtinguisherRecord.objects.all()
        ],
        'adr_default_emails': (adr_settings.default_notify_extra_emails or []) if adr_settings else [],
        'apk_default_emails': (apk_settings.default_notify_extra_emails or []) if apk_settings else [],
        'blusser_default_emails': (
            (blusser_settings.default_notify_extra_emails or []) if blusser_settings else []
        ),
    }
    with open(BESTAND, 'w') as fh:
        json.dump(backup, fh, indent=2)

    nieuw_login = None
    for index, gebruiker in enumerate(gebruikers):
        voornaam, achternaam = FICTIEF[index % len(FICTIEF)]
        # Bij meer gebruikers dan namen een nummer erachter, zodat het uniek blijft.
        ronde = index // len(FICTIEF)
        achtervoegsel = f'{ronde + 1}' if ronde else ''
        nieuw_email = f'{_slug(voornaam, achternaam)}{achtervoegsel}@{DOMEIN}'
        User.objects.filter(id=gebruiker.id).update(
            voornaam=voornaam,
            achternaam=f'{achternaam}{(" " + achtervoegsel) if achtervoegsel else ""}',
            email=nieuw_email,
        )
        if gebruiker.email == DEMO_LOGIN:
            nieuw_login = nieuw_email

    for index, bedrijf in enumerate(bedrijven):
        Company.objects.filter(id=bedrijf.id).update(naam=BEDRIJVEN[index % len(BEDRIJVEN)])

    ADRRecord.objects.exclude(notify_extra_emails=[]).update(notify_extra_emails=[PLANNING])
    FireExtinguisherRecord.objects.exclude(notify_extra_emails=[]).update(
        notify_extra_emails=[PLANNING]
    )
    for model in (ADRSettings, APKSettings, FireExtinguisherSettings):
        model.objects.update(default_notify_extra_emails=[PLANNING])

    print('Fictieve namen ingesteld voor', len(gebruikers), 'gebruikers en',
          len(bedrijven), 'bedrijven.')
    print('Backup:', BESTAND)
    print('Inloggen met:', nieuw_login or '(demo-account niet gevonden)')


if os.environ.get('DEMO_NAMEN_HERSTEL'):
    herstellen()
else:
    vervangen()
