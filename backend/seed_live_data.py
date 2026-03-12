"""Import live production data into local database."""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.local')
django.setup()

from django.utils import timezone
from django.db import transaction
from apps.accounts.models import User
from apps.companies.models import Company, MailingListContact
from apps.drivers.models import Driver
from apps.fleet.models import Vehicle


def run():
    with transaction.atomic():
        # === CLEAR EXISTING DATA (in correct order due to FK constraints) ===
        print("Clearing existing data...")
        Driver.objects.all().delete()
        Vehicle.objects.all().delete()
        MailingListContact.objects.all().delete()
        User.objects.all().delete()
        Company.objects.all().delete()
        print("Done.\n")

        # === BEDRIJVEN ===
        print("=== BEDRIJVEN ===")
        companies = [
            {'id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b', 'naam': 'DACHSER (Nijkerk)  Food Logistics B.V'},
            {'id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'naam': 'DACHSER (Zevenaar)'},
            {'id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'naam': 'MAİNFREİGHT (\'s-Heerenberg)'},
            {'id': '1f7b0e4c-7b9e-4fbb-90f1-1be52202ff85', 'naam': 'Mainfreight Forwarding Netherlands'},
        ]
        for c in companies:
            Company.objects.create(**c)
            print(f"  + {c['naam']}")
        print(f"  {len(companies)} bedrijven aangemaakt.\n")

        # === MAILING CONTACTS ===
        print("=== MAILING CONTACTS ===")
        contacts = [
            {'id': '6855bd40-d372-4d9e-af6c-21630d7fe56d', 'naam': 'Accounting', 'email': 'accounting@mainfreight.com', 'functie': 'Finance', 'is_active': True, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a'},
            {'id': '13fe13bc-ab22-47db-a23e-cf6f64f95040', 'naam': 'Finance', 'email': 'financieel@muller.nl', 'functie': 'Finance', 'is_active': True, 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b'},
            {'id': 'e7821767-15bc-46fc-81b4-a7cdfe5260d6', 'naam': 'Jaap Venema', 'email': 'jaap.venema@muller.nl', 'functie': '', 'is_active': True, 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b'},
            {'id': 'eca21137-8e22-42d9-80f6-6a9b5afce71c', 'naam': 'Jaco', 'email': 'jefactuur@gmail.com', 'functie': 'Boekhouding', 'is_active': True, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a'},
            {'id': '91261274-af6c-46af-9873-ec7359268957', 'naam': 'Jaco', 'email': 'jefactuur@gmail.com', 'functie': 'Boekhouding', 'is_active': True, 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b'},
            {'id': 'c2851463-5603-42c6-a2cf-7dc07d71dc59', 'naam': 'Planning', 'email': 'sd.zevenaar@dachser.com', 'functie': '', 'is_active': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725'},
            {'id': '8dec7f59-6ce0-4784-99cb-804dec4339d6', 'naam': 'Robin', 'email': 'robin.boeijink@mainfreight.com', 'functie': '', 'is_active': True, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a'},
            {'id': 'db0168c7-4de2-4109-9e10-a241d8f0d633', 'naam': 'Roy Brinkman', 'email': 'roy.brinkman@muller.nl', 'functie': '', 'is_active': True, 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b'},
            {'id': '42db1f0e-a466-4755-8734-90cc5144d81b', 'naam': 'Tom Benning', 'email': 'tom.benning@mainfreight.com', 'functie': '', 'is_active': True, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a'},
            {'id': '2f8e84ec-2f2c-42f8-bc19-f23d5e4fdeea', 'naam': 'Tom Delaney', 'email': 'tom.delaney@muller.nl', 'functie': '', 'is_active': True, 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b'},
        ]
        for c in contacts:
            MailingListContact.objects.create(**c)
            print(f"  + {c['naam']} ({c['email']})")
        print(f"  {len(contacts)} contacten aangemaakt.\n")

        # === GEBRUIKERS ===
        print("=== GEBRUIKERS ===")
        users = [
            {'id': 'aa01e180-9d71-4e5c-8fa9-f5813521b465', 'email': 'recep@moveo-bv.nl', 'username': 'recep', 'voornaam': 'Recep', 'achternaam': '', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$QH0XrpQVlInRg9Iy9GOI4P$jPJ4+WBgGrSbiIGQ9nAl55pMxt0MTU25cxgZAzyKR+Y=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'c8314eec-6df0-484c-8f58-314081ca5a30', 'email': 'stil@moveo-bv.nl', 'username': 'stil', 'voornaam': 'Stil', 'achternaam': '', 'telefoon': '', 'bedrijf': 'Mainfreight', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$ehkxg8hz0saDkNLMREfpeu$lC1CIhgDJnoxbisE60+qLeMdB5Cw0KOa84mJUO5nrkw=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '693636c7-64f3-4dfa-abe5-97a2d8cb0ff5', 'email': 'kamil@moveo-bv.nl', 'username': 'kamil', 'voornaam': 'Kamil', 'achternaam': '', 'telefoon': '', 'bedrijf': 'Mainfreight', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$a78KAUv953m8qOBi4LrBw7$Vxxzow09KEFN9Ld+C8Z/QOVsR8dZpeUW0r0DGmOGv1s=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'b09cd26d-b6b1-4921-b358-de1f46629d32', 'email': 'julius@moveo-bv.nl', 'username': 'julius@moveo-bv.nl', 'voornaam': 'Julius', 'achternaam': '..', 'telefoon': '', 'bedrijf': 'MAİNFREİGHT (\'s-Heerenberg)', 'rol': 'gebruiker', 'password': 'pbkdf2_sha256$1000000$30U3kmHbpAXUswGFAQd8Nj$gObnVPHVNnIIp8FZ05TOelElRDpT9KtBxf9dCm4dlQg=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '546e896b-49bd-422e-ae1a-03709750a30e', 'email': 'admin@moveo-bv.nl', 'username': 'admin@moveo-bv.nl', 'voornaam': 'Admin', 'achternaam': 'Admin', 'telefoon': '', 'bedrijf': '', 'rol': 'admin', 'password': 'pbkdf2_sha256$1000000$hftkkAYQjGQzW0e3FWB9mi$1HPX+4KdbS+mo00Nm0+0JurG+0US1CRsS4CuHBuFtbI=', 'is_superuser': True, 'is_staff': True, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'bfd91a6a-6dd9-491d-b5ff-3f150f269348', 'email': 'burak@moveo-bv.nl', 'username': 'burak', 'voornaam': 'Burak', 'achternaam': 'Akkan', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$046noanJdZffVeJZsct7mr$o98PyOHf3XT8XBj4jhtQt1uOUzWjwK8NC9CH/nlwCYA=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'a6f9ba85-6620-418b-9c7f-f632d335d585', 'email': 'rezan@moveo-bv.nl', 'username': 'rezan', 'voornaam': 'Rezan', 'achternaam': 'Balyeci', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$hFph9emLnXfu5eW48AVUqM$/rrNZioiHkH4Nht3Skn2iiGN1JZDshAu7y2CDM90bE8=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'c86255c6-f2b0-45f6-abc0-4974b68b428a', 'email': 'senel@moveo-bv.nl', 'username': 'senel@moveo-bv.nl', 'voornaam': 'Senel', 'achternaam': 'Cagiran', 'telefoon': '', 'bedrijf': 'Mainfreight', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$Dq7lLC50CDtPI4rVJvJLKv$ZE6oqrEmUCqtabjITe5yqLkE6+tuASufEti9/qmDWiI=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'f67d0980-871d-4837-8506-02f8a66b22f9', 'email': 'kristian@moveo-bv.nl', 'username': 'kristian', 'voornaam': 'Kristian', 'achternaam': 'Dimitriovski', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$LPOEY1sXntsbCjeWpYJF3H$F5Xgtal8aCLoEb+v0l+UnzcIpey/Bje0AJXavimj84M=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '637f67e5-7f45-46fc-a8a5-f0fb584fa095', 'email': 'onur@moveo-bv.nl', 'username': 'onur', 'voornaam': 'Onur', 'achternaam': 'Eris', 'telefoon': '', 'bedrijf': 'DACHSER (Zevenaar)', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$umW5SgTIaqEkXNMdvVwS1G$qf45HCLLN1M5mDsznUE3Olqgrtnmb5c2bxBPuM9p9Mc=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '5329296b-d6e5-4fc3-a9e8-7480ad465668', 'email': 'derk@moveo-bv.nl', 'username': 'derk', 'voornaam': 'Derk', 'achternaam': 'Geressen', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$lbhaTcASeDeT1VLONgKK1k$lLvgtPcZWnwAxBt20g8IQV3rCtze8GTDGoApgGdEuDY=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '5b7bbc8d-59d3-47b8-bcd3-c69308bda805', 'email': 'ozan@moveo-bv.nl', 'username': 'ozan', 'voornaam': 'Ozan', 'achternaam': 'Kermen', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$SjwC7M6CmcAgkTCRUNljRG$XxaO/aKXISUoS7Xf58P69y59bTy9hbgMcG/yVUCdRdM=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'dbd70760-285c-47f3-b723-f078c81d49d8', 'email': 'piotr@moveo-bv.nl', 'username': 'piotr@moveo-bv.nl', 'voornaam': 'Piotr', 'achternaam': 'Kozon', 'telefoon': '', 'bedrijf': 'Mainfreight', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$DHxWvYFUaCSZjEizPF42Jg$L3UyGE5CGEYSyhTQyky6p98YHaWIW3s+e+Pn4O9PC6w=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '2e8f32b4-cb63-4b04-b435-004d4f3f7f98', 'email': 'ali@moveo-bv.nl', 'username': 'ali', 'voornaam': 'Ali', 'achternaam': 'Neven Asenov', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$2Z6m7fgvd1AfwnprWCIgw8$mWyLNPjIJlOFwfJraMdCQy4XOW0hh7jzxWArp7r6wD8=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'b2a7d3f5-8b6d-4086-89a6-fe131223d7b9', 'email': 'andre@moveo-bv.nl', 'username': 'andre', 'voornaam': 'Andre', 'achternaam': 'Pitlo', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$BGvgl3AeERWLYcRJUAMDMT$wyzDMpcjAiIUhdP/hARx5hFmhHa9bx+FswYK+XkKpOY=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '74763ba9-a7de-44bc-b3ff-0f132a996298', 'email': 'ergin@moveo-bv.nl', 'username': 'ergin@moveo-bv.nl', 'voornaam': 'Ergin', 'achternaam': 'Sariusta', 'telefoon': '', 'bedrijf': '', 'rol': 'admin', 'password': 'pbkdf2_sha256$1000000$BvyqjNHelhU1ZIm6xcBm0t$Bd6LWTrl+oHX/AcqzGsaFNGHLBA+mmAdHfTLit/QYys=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '17278993-62b9-47ca-84a4-00c223405a00', 'email': 'serhan@moveo-bv.nl', 'username': 'serhan', 'voornaam': 'Serhan', 'achternaam': 'Sariusta', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$Vx558FJWwBH0An4dQMO9fz$Q2vRxNN8hph2i9F7IBo9UdTP7mQz2gVyfMFr8e09xeg=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '600b074b-e0d6-4e96-83f2-f1123b51e4f7', 'email': 'patrick@eutransport.nl', 'username': 'patrick@eutransport.nl', 'voornaam': 'Patrick', 'achternaam': 'Scherpenisse', 'telefoon': '', 'bedrijf': '', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$bGfqCmyamNELVX15RPHldN$zcnPhrc0ZeyhViZhz5MFIvwU+mGAjqCSEPHBb14K4j0=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'c62ce200-832c-479b-a394-e108bfcd3787', 'email': 'janwillem@moveo-bv.nl', 'username': 'janwillem', 'voornaam': 'Jan Willem', 'achternaam': 'Scherpenisse', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$4tAGkTnFA0ddAl59jHF5Kf$zjz0vHlG3CFmwhvO4qoIf55dxMT0KGyAkOsiM2MkwFM=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': 'c7abb632-a00d-4b8d-93ca-8e68c08ee53e', 'email': 'ordancho@moveo-bv.nl', 'username': 'ordancho', 'voornaam': 'Ordancho', 'achternaam': 'Trajkovski', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$iVrOJ9O5OsEik4r92uAXjX$Z7/rAU3oYWgvaf0MBZaVGoW5ZtCo90kxGF0z8uOONFo=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '30eeb25b-9c17-4c6c-a61f-aa12af9bc5f2', 'email': 'borche@moveo-bv.nl', 'username': 'borche', 'voornaam': 'Borche', 'achternaam': 'Yovanovski', 'telefoon': '', 'bedrijf': 'Dachser', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$omul68Iu25xHnAGZ5zfXBI$BIV6KbMu77/iAmqJb4Ic1qQLiLEThoI4XBb/LSFpQ4w=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
            {'id': '43327b54-5238-4fc6-9f50-8f3d6eb6edb9', 'email': 'hasan@moveo-bv.nl', 'username': 'hasan', 'voornaam': 'Hasan', 'achternaam': 'Çakmakci', 'telefoon': '', 'bedrijf': 'Mainfreight', 'rol': 'chauffeur', 'password': 'pbkdf2_sha256$1000000$omul68Iu25xHnAGZ5zfXBI$BIV6KbMu77/iAmqJb4Ic1qQLiLEThoI4XBb/LSFpQ4w=', 'is_superuser': False, 'is_staff': False, 'is_active': True, 'mfa_enabled': False, 'mfa_required': False, 'mfa_secret': ''},
        ]
        for u in users:
            pw = u.pop('password')
            user = User(**u)
            user.password = pw  # Set hashed password directly
            user.save()
            print(f"  + {u['voornaam']} {u['achternaam']} ({u['email']})")
        print(f"  {len(users)} gebruikers aangemaakt.\n")

        # === VOERTUIGEN ===
        print("=== VOERTUIGEN ===")
        vehicles = [
            {'id': '73be567a-1b7f-44a9-8a79-336369f772e7', 'kenteken': '06-BZF-5', 'type_wagen': 'Mega + Kast', 'ritnummer': '792', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': 'f6646494-d4ae-4c41-b476-be6022c6b948', 'kenteken': '09-BGL-1', 'type_wagen': 'Motorwagen', 'ritnummer': '795', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': 'e5209379-bc16-4588-855b-174498ff0c34', 'kenteken': '32-BLN-8', 'type_wagen': 'Motorwagen', 'ritnummer': '793', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '85afbf31-bee1-4187-9d61-d4dd7cee8548', 'kenteken': '36-BNL-9', 'type_wagen': 'Kast', 'ritnummer': '796', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '0ba11a41-aa98-4de0-98b8-6d425e638e3a', 'kenteken': '39-BPB-9', 'type_wagen': 'Motorwagen', 'ritnummer': '790', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '49926e9d-9022-42cb-bce3-1b06a0ba405c', 'kenteken': '41-BRR-3', 'type_wagen': 'Kast', 'ritnummer': '791', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '21e047a0-acf1-401f-993f-5728b5f4f60d', 'kenteken': '50-BXN-5', 'type_wagen': 'Mega + Kast', 'ritnummer': 'EU trans 1', 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'minimum_weken_per_jaar': 47},
            {'id': 'a5e2c065-877c-4ca6-8261-6004d36f09b4', 'kenteken': '51-BXN-5', 'type_wagen': 'Mega + Kast', 'ritnummer': '794', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '392a0445-1a38-4ea7-9a8f-73d176c7fea3', 'kenteken': '79-BNL-8', 'type_wagen': 'Trekker', 'ritnummer': '3946', 'bedrijf_id': 'f2c7bfc1-d2d2-4e4f-9335-82cce8aea77b', 'minimum_weken_per_jaar': None},
            {'id': '9d27e77f-b898-4d91-a824-4b8faaea18fa', 'kenteken': '99-BRD-5', 'type_wagen': 'Motorwagen', 'ritnummer': '797', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '01246e06-f523-4d6b-a94f-c4e1929a7c53', 'kenteken': 'BB 470 X', 'type_wagen': 'Trekker', 'ritnummer': 'EU trans 4', 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'minimum_weken_per_jaar': 47},
            {'id': 'e8192625-5ea6-4ce4-b332-475062597ddd', 'kenteken': 'BB 625 L', 'type_wagen': 'Trekker', 'ritnummer': 'EU trans 3', 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'minimum_weken_per_jaar': 47},
            {'id': 'e34ae552-12c5-4028-afa8-cbef4da2908a', 'kenteken': 'BB-286-H', 'type_wagen': 'Mega', 'ritnummer': '798', 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'minimum_weken_per_jaar': None},
            {'id': '56e02f12-63c5-4a93-b9c5-b5126d6d6535', 'kenteken': 'BB-949-N', 'type_wagen': 'Trekker', 'ritnummer': 'EU trans 2', 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'minimum_weken_per_jaar': 47},
        ]
        for v in vehicles:
            Vehicle.objects.create(**v)
            print(f"  + {v['kenteken']} ({v['type_wagen']})")
        print(f"  {len(vehicles)} voertuigen aangemaakt.\n")

        # === CHAUFFEURS ===
        print("=== CHAUFFEURS ===")
        drivers = [
            {'id': 'fe2e7683-9b2b-4609-a92a-ee805a3ceac4', 'naam': 'Ali Neven Asenov', 'telefoon': '+31 6 85346183', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '2e8f32b4-cb63-4b04-b435-004d4f3f7f98', 'minimum_uren_per_week': None},
            {'id': '7452ed6b-2a70-4d42-9df0-4528f93a6fd2', 'naam': 'Andre Pitlo', 'telefoon': '0652420914', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'b2a7d3f5-8b6d-4086-89a6-fe131223d7b9', 'minimum_uren_per_week': None},
            {'id': '8ba66270-6de0-494c-a53a-8dc0eb4c7cad', 'naam': 'Borche Yovanovski', 'telefoon': '0643498995', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '30eeb25b-9c17-4c6c-a61f-aa12af9bc5f2', 'minimum_uren_per_week': None},
            {'id': 'b07bdcb7-e0d0-4e2f-9d4b-cb872f2db6e7', 'naam': 'Buklat Bartosz', 'telefoon': '0685268385', 'adr': True, 'bedrijf_id': None, 'gekoppelde_gebruiker_id': None, 'minimum_uren_per_week': None},
            {'id': 'e6b908d6-4502-42c4-8c9c-48c794ecb49b', 'naam': 'Burak Akkan', 'telefoon': '0652594277', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'bfd91a6a-6dd9-491d-b5ff-3f150f269348', 'minimum_uren_per_week': None},
            {'id': '92745294-16d7-47e3-befb-34bbf0a4c21f', 'naam': 'Derk Geressen', 'telefoon': '0646723731', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '5329296b-d6e5-4fc3-a9e8-7480ad465668', 'minimum_uren_per_week': None},
            {'id': '1c2fbc66-829f-41e6-8200-67ca65bf78d8', 'naam': 'Ergin Sariusta', 'telefoon': '0636129223', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '74763ba9-a7de-44bc-b3ff-0f132a996298', 'minimum_uren_per_week': None},
            {'id': '09d68483-fa22-4490-9d80-f9cf894fe5b8', 'naam': 'Hasan Cakmakci', 'telefoon': '06 48398003', 'adr': False, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'gekoppelde_gebruiker_id': '43327b54-5238-4fc6-9f50-8f3d6eb6edb9', 'minimum_uren_per_week': 50},
            {'id': '5a5212b8-28b8-4c53-bab9-75efbde3f578', 'naam': 'Jan Willem Scherpenisse', 'telefoon': '0657778166', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'c62ce200-832c-479b-a394-e108bfcd3787', 'minimum_uren_per_week': None},
            {'id': 'e6c9c618-370d-4ef6-a40e-a4bfaeb42141', 'naam': 'Kamil Guba', 'telefoon': '', 'adr': False, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'gekoppelde_gebruiker_id': '693636c7-64f3-4dfa-abe5-97a2d8cb0ff5', 'minimum_uren_per_week': 50},
            {'id': '43edc717-18cf-49b7-a121-a449da6d9ef5', 'naam': 'Kristijan Dimitriovski', 'telefoon': '0684221446', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'f67d0980-871d-4837-8506-02f8a66b22f9', 'minimum_uren_per_week': 50},
            {'id': 'da6245dc-171a-48ae-9919-2e8b0cf5763e', 'naam': 'Onur Eris', 'telefoon': '0610006669', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '637f67e5-7f45-46fc-a8a5-f0fb584fa095', 'minimum_uren_per_week': None},
            {'id': '2e2128cb-4f73-468a-8c57-c400e8a9a37f', 'naam': 'Ordancho Trajkovski', 'telefoon': '0638618310', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'c7abb632-a00d-4b8d-93ca-8e68c08ee53e', 'minimum_uren_per_week': None},
            {'id': '81fd89a4-69f6-4cca-80d3-36b230ffc6ca', 'naam': 'Ozan Kermen', 'telefoon': '0623089650', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '5b7bbc8d-59d3-47b8-bcd3-c69308bda805', 'minimum_uren_per_week': None},
            {'id': 'f888a9bd-dea5-43b4-bfce-b92d0a023dc3', 'naam': 'Patrick Scherpenisse', 'telefoon': '0633254535', 'adr': True, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': '600b074b-e0d6-4e96-83f2-f1123b51e4f7', 'minimum_uren_per_week': 50},
            {'id': 'ff425b34-cdf4-45a5-ac94-5187b46f2b68', 'naam': 'Recep Dogan', 'telefoon': '0619991224', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'aa01e180-9d71-4e5c-8fa9-f5813521b465', 'minimum_uren_per_week': None},
            {'id': '4571ef35-4c16-4a4d-9a96-e890c487bbca', 'naam': 'Rezan Balyeci', 'telefoon': '0614800410', 'adr': False, 'bedrijf_id': '2ac3226d-c978-4134-95e4-6fec4fae2725', 'gekoppelde_gebruiker_id': 'a6f9ba85-6620-418b-9c7f-f632d335d585', 'minimum_uren_per_week': None},
            {'id': 'b5984992-2e78-454f-b7a4-65e19e88f204', 'naam': 'Senel Cagiran', 'telefoon': '06 21406921', 'adr': False, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'gekoppelde_gebruiker_id': 'c86255c6-f2b0-45f6-abc0-4974b68b428a', 'minimum_uren_per_week': 50},
            {'id': '3acc6ea5-9f01-4e29-95f9-53e6d4b34915', 'naam': 'Stil', 'telefoon': '', 'adr': False, 'bedrijf_id': 'd712c42a-306d-46ad-a31f-13e858094c9a', 'gekoppelde_gebruiker_id': 'c8314eec-6df0-484c-8f58-314081ca5a30', 'minimum_uren_per_week': None},
        ]
        for d in drivers:
            Driver.objects.create(**d)
            print(f"  + {d['naam']}")
        print(f"  {len(drivers)} chauffeurs aangemaakt.\n")

    print("=== IMPORT COMPLEET ===")
    print(f"  Bedrijven:     {Company.objects.count()}")
    print(f"  Contacten:     {MailingListContact.objects.count()}")
    print(f"  Gebruikers:    {User.objects.count()}")
    print(f"  Voertuigen:    {Vehicle.objects.count()}")
    print(f"  Chauffeurs:    {Driver.objects.count()}")


if __name__ == '__main__':
    run()
