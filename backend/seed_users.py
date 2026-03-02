"""Re-create test users and link drivers."""
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.production')
django.setup()

from apps.accounts.models import User, UserRole
from apps.drivers.models import Driver

# === GEBRUIKERS AANMAKEN ===
print("\n=== GEBRUIKERS ===")
users_data = [
    # Admins
    {'email': 'admin@test.nl', 'username': 'admin', 'voornaam': 'Admin', 'achternaam': 'TMS', 'rol': UserRole.ADMIN, 'is_staff': True, 'is_superuser': True, 'password': 'Admin123!'},
    {'email': 'jan@test.nl', 'username': 'jan', 'voornaam': 'Jan', 'achternaam': 'de Vries', 'rol': UserRole.ADMIN, 'is_staff': True, 'is_superuser': False, 'password': 'Test1234!'},
    # Gebruikers (planner/kantoor)
    {'email': 'pieter@test.nl', 'username': 'pieter', 'voornaam': 'Pieter', 'achternaam': 'Bakker', 'rol': UserRole.GEBRUIKER, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'lisa@test.nl', 'username': 'lisa', 'voornaam': 'Lisa', 'achternaam': 'Jansen', 'rol': UserRole.GEBRUIKER, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'ahmed@test.nl', 'username': 'ahmed', 'voornaam': 'Ahmed', 'achternaam': 'El Amrani', 'rol': UserRole.GEBRUIKER, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'sophie@test.nl', 'username': 'sophie', 'voornaam': 'Sophie', 'achternaam': 'Visser', 'rol': UserRole.GEBRUIKER, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    # Chauffeurs
    {'email': 'marco@test.nl', 'username': 'marco', 'voornaam': 'Marco', 'achternaam': 'de Groot', 'rol': UserRole.CHAUFFEUR, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'dennis@test.nl', 'username': 'dennis', 'voornaam': 'Dennis', 'achternaam': 'Smit', 'rol': UserRole.CHAUFFEUR, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'yusuf@test.nl', 'username': 'yusuf', 'voornaam': 'Yusuf', 'achternaam': 'Kaya', 'rol': UserRole.CHAUFFEUR, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
    {'email': 'emma@test.nl', 'username': 'emma', 'voornaam': 'Emma', 'achternaam': 'Mulder', 'rol': UserRole.CHAUFFEUR, 'is_staff': False, 'is_superuser': False, 'password': 'Test1234!'},
]

for u in users_data:
    password = u.pop('password')
    user, created = User.objects.get_or_create(
        email=u['email'],
        defaults=u,
    )
    if created:
        user.set_password(password)
        user.save()
    tag = 'NIEUW' if created else 'BESTAAT'
    print(f"  {user.voornaam} {user.achternaam} ({user.email}) - {user.rol} [{tag}]")

print(f"\n  Totaal: {User.objects.count()} gebruikers")


# === CHAUFFEURS KOPPELEN ===
print("\n=== CHAUFFEURS KOPPELEN ===")
driver_links = {
    'Marco de Groot': 'marco@test.nl',
    'Dennis Smit': 'dennis@test.nl',
    'Yusuf Kaya': 'yusuf@test.nl',
    'Emma Mulder': 'emma@test.nl',
}

for driver_naam, email in driver_links.items():
    try:
        driver = Driver.objects.get(naam=driver_naam)
        user = User.objects.get(email=email)
        if driver.gekoppelde_gebruiker != user:
            driver.gekoppelde_gebruiker = user
            driver.save()
            print(f"  {driver.naam} -> gekoppeld aan {user.email}")
        else:
            print(f"  {driver.naam} -> al gekoppeld aan {user.email}")
    except (Driver.DoesNotExist, User.DoesNotExist) as e:
        print(f"  FOUT: {driver_naam} / {email} - {e}")

print("\n=== KOPPELING COMPLEET ===\n")
