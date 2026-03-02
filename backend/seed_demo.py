"""Seed demo data: companies, fleet, drivers."""
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.production')
django.setup()

from apps.accounts.models import User
from apps.companies.models import Company
from apps.drivers.models import Driver
from apps.fleet.models import Vehicle

# === BEDRIJVEN ===
print("\n=== BEDRIJVEN ===")
companies_data = [
    {
        'naam': 'Van der Berg Transport',
        'kvk': '12345678',
        'telefoon': '010-1234567',
        'contactpersoon': 'Henk van der Berg',
        'email': 'info@vandenbergtransport.nl',
        'adres': 'Industrieweg 15',
        'postcode': '3045 AB',
        'stad': 'Rotterdam',
    },
    {
        'naam': 'De Vries Logistics',
        'kvk': '23456789',
        'telefoon': '020-2345678',
        'contactpersoon': 'Karin de Vries',
        'email': 'info@devrieslogistics.nl',
        'adres': 'Havenstraat 42',
        'postcode': '1013 AW',
        'stad': 'Amsterdam',
    },
    {
        'naam': 'Jansen en Zonen BV',
        'kvk': '34567890',
        'telefoon': '030-3456789',
        'contactpersoon': 'Pieter Jansen',
        'email': 'info@jansenzonen.nl',
        'adres': 'Transportlaan 8',
        'postcode': '3500 GH',
        'stad': 'Utrecht',
    },
    {
        'naam': 'Bakker Koeltransport',
        'kvk': '45678901',
        'telefoon': '040-4567890',
        'contactpersoon': 'Willem Bakker',
        'email': 'info@bakkerkoeltransport.nl',
        'adres': 'Koelweg 3',
        'postcode': '5612 AE',
        'stad': 'Eindhoven',
    },
    {
        'naam': 'Euroweg BV',
        'kvk': '56789012',
        'telefoon': '050-5678901',
        'contactpersoon': 'Sandra Mulder',
        'email': 'info@euroweg.nl',
        'adres': 'Europaweg 120',
        'postcode': '9700 AB',
        'stad': 'Groningen',
    },
]

companies = {}
for c in companies_data:
    obj, created = Company.objects.get_or_create(naam=c['naam'], defaults=c)
    companies[c['naam']] = obj
    tag = 'NIEUW' if created else 'BESTAAT'
    print(f"  {obj.naam} ({obj.stad}) [{tag}]")

print(f"\n  Totaal: {Company.objects.count()} bedrijven")


# === VLOOT ===
print("\n=== VLOOT ===")
vehicles_data = [
    # Van der Berg Transport - 3 voertuigen
    {'kenteken': 'BX-123-D', 'type_wagen': 'Trekker', 'ritnummer': 'R001', 'bedrijf': 'Van der Berg Transport'},
    {'kenteken': 'BX-456-F', 'type_wagen': 'Trekker', 'ritnummer': 'R002', 'bedrijf': 'Van der Berg Transport'},
    {'kenteken': 'GH-789-J', 'type_wagen': 'Bakwagen', 'ritnummer': 'R003', 'bedrijf': 'Van der Berg Transport'},
    # De Vries Logistics - 3 voertuigen
    {'kenteken': 'KL-012-M', 'type_wagen': 'Trekker', 'ritnummer': 'R010', 'bedrijf': 'De Vries Logistics'},
    {'kenteken': 'KL-345-N', 'type_wagen': 'Vrachtwagen', 'ritnummer': 'R011', 'bedrijf': 'De Vries Logistics'},
    {'kenteken': 'NP-678-R', 'type_wagen': 'Bestelbus', 'ritnummer': 'R012', 'bedrijf': 'De Vries Logistics'},
    # Jansen en Zonen - 2 voertuigen
    {'kenteken': 'ST-901-V', 'type_wagen': 'Trekker', 'ritnummer': 'R020', 'bedrijf': 'Jansen en Zonen BV'},
    {'kenteken': 'ST-234-W', 'type_wagen': 'Kipwagen', 'ritnummer': 'R021', 'bedrijf': 'Jansen en Zonen BV'},
    # Bakker Koeltransport - 3 voertuigen
    {'kenteken': 'VX-567-Z', 'type_wagen': 'Koelwagen', 'ritnummer': 'R030', 'bedrijf': 'Bakker Koeltransport'},
    {'kenteken': 'VX-890-A', 'type_wagen': 'Koelwagen', 'ritnummer': 'R031', 'bedrijf': 'Bakker Koeltransport'},
    {'kenteken': 'AB-123-C', 'type_wagen': 'Koelbestelbus', 'ritnummer': 'R032', 'bedrijf': 'Bakker Koeltransport'},
    # Euroweg BV - 2 voertuigen
    {'kenteken': 'DE-456-F', 'type_wagen': 'Trekker', 'ritnummer': 'R040', 'bedrijf': 'Euroweg BV'},
    {'kenteken': 'DE-789-G', 'type_wagen': 'Containerwagen', 'ritnummer': 'R041', 'bedrijf': 'Euroweg BV'},
]

for v in vehicles_data:
    bedrijf_naam = v.pop('bedrijf')
    bedrijf = companies[bedrijf_naam]
    obj, created = Vehicle.objects.get_or_create(
        kenteken=v['kenteken'],
        defaults={**v, 'bedrijf': bedrijf}
    )
    tag = 'NIEUW' if created else 'BESTAAT'
    print(f"  {obj.kenteken} - {obj.type_wagen} ({bedrijf.naam}) [{tag}]")

print(f"\n  Totaal: {Vehicle.objects.count()} voertuigen")


# === CHAUFFEURS ===
print("\n=== CHAUFFEURS ===")
drivers_data = [
    {
        'naam': 'Marco de Groot',
        'telefoon': '06-11111111',
        'email': 'marco@test.nl',
        'bedrijf': 'Van der Berg Transport',
        'adr': True,
    },
    {
        'naam': 'Dennis Smit',
        'telefoon': '06-22222222',
        'email': 'dennis@test.nl',
        'bedrijf': 'Van der Berg Transport',
        'adr': False,
    },
    {
        'naam': 'Yusuf Kaya',
        'telefoon': '06-33333333',
        'email': 'yusuf@test.nl',
        'bedrijf': 'De Vries Logistics',
        'adr': True,
    },
    {
        'naam': 'Emma Mulder',
        'telefoon': '06-44444444',
        'email': 'emma@test.nl',
        'bedrijf': 'Jansen en Zonen BV',
        'adr': False,
    },
]

for d in drivers_data:
    bedrijf = companies[d['bedrijf']]

    # Probeer de gebruiker te vinden
    try:
        user = User.objects.get(email=d['email'])
        user_label = user.email
    except User.DoesNotExist:
        user = None
        user_label = 'GEEN GEBRUIKER'

    obj, created = Driver.objects.get_or_create(
        naam=d['naam'],
        defaults={
            'telefoon': d['telefoon'],
            'bedrijf': bedrijf,
            'gekoppelde_gebruiker': user,
            'adr': d['adr'],
        }
    )

    # Als chauffeur al bestond maar nog niet gekoppeld, update
    if not created and user and not obj.gekoppelde_gebruiker:
        obj.gekoppelde_gebruiker = user
        obj.bedrijf = bedrijf
        obj.adr = d['adr']
        obj.telefoon = d['telefoon']
        obj.save()
        tag = 'BIJGEWERKT'
    elif created:
        tag = 'NIEUW'
    else:
        tag = 'BESTAAT'

    adr_label = 'ADR' if obj.adr else '-'
    print(f"  {obj.naam} -> {bedrijf.naam} | Gebruiker: {user_label} | {adr_label} [{tag}]")

print(f"\n  Totaal: {Driver.objects.count()} chauffeurs")

print("\n=== DEMO DATA COMPLEET ===\n")
