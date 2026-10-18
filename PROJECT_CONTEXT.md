# TMS Project Context

> **INSTRUCTIE VOOR COPILOT**: Lees dit bestand VOLLEDIG door voordat je begint. Dit bevat alle projectbeslissingen en specificaties.

---

## 🎯 Project Overzicht

**Naam**: Transport Management Systeem (TMS)  
**Doel**: Webapplicatie voor transportbeheer, facturatie, urenregistratie en planning  
**Rollen**: Copilot = Senior Developer, Gebruiker = Product Owner  

---

## 🛠️ Tech Stack (DEFINITIEF)

| Component | Technologie | Versie |
|-----------|-------------|--------|
| **Backend** | Django + Django REST Framework | 5.x |
| **API Auth** | JWT (Simple JWT) + TOTP voor 2FA | - |
| **Frontend** | React + Vite | 18.x / 5.x |
| **Styling** | TailwindCSS | 3.x |
| **Database** | PostgreSQL | 16 |
| **PDF Generation** | WeasyPrint | - |
| **Email** | Django Email + OAuth2 ondersteuning | - |
| **Mobile (later)** | Capacitor of React Native | - |

---

## 🏗️ Architectuur

```
┌─────────────────────────────────────────────────────────────────┐
│                      TMS APPLICATIE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│   │   Web App   │  │  iOS App    │  │ Android App │             │
│   │  (React +   │  │  (Later)    │  │  (Later)    │             │
│   │   Vite)     │  │             │  │             │             │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│          │                │                │                     │
│          └────────────────┼────────────────┘                     │
│                           │                                      │
│                           ▼                                      │
│              ┌─────────────────────────┐                        │
│              │   Django REST API       │                        │
│              │   (Backend + Auth)      │                        │
│              └───────────┬─────────────┘                        │
│                          │                                       │
│                          ▼                                       │
│              ┌─────────────────────────┐                        │
│              │     PostgreSQL          │                        │
│              │     (Database)          │                        │
│              └─────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structuur

```
tmsapp/
├── backend/                    # Django Project
│   ├── tms/                    # Django main app
│   │   ├── settings/
│   │   │   ├── base.py         # Gedeelde settings
│   │   │   ├── development.py
│   │   │   └── production.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── apps/
│   │   ├── accounts/           # Users, Auth, 2FA
│   │   ├── companies/          # Bedrijven
│   │   ├── drivers/            # Chauffeurs
│   │   ├── fleet/              # Voertuigen
│   │   ├── timetracking/       # Urenregistratie
│   │   ├── planning/           # Weekplanning
│   │   ├── invoicing/          # Facturen + Templates
│   │   └── core/               # App settings (naam, logo, etc.)
│   ├── requirements/
│   │   ├── base.txt
│   │   ├── development.txt
│   │   └── production.txt
│   └── manage.py
│
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── api/                # API calls (axios/fetch)
│   │   ├── components/
│   │   │   ├── ui/             # Buttons, Inputs, etc.
│   │   │   ├── layout/         # Sidebar, Header, etc.
│   │   │   └── forms/          # Form componenten
│   │   ├── pages/
│   │   │   ├── auth/           # Login, Register
│   │   │   ├── dashboard/
│   │   │   ├── admin/
│   │   │   ├── companies/
│   │   │   ├── drivers/
│   │   │   ├── fleet/
│   │   │   ├── time-entries/
│   │   │   ├── planning/
│   │   │   ├── invoices/
│   │   │   └── settings/
│   │   ├── hooks/              # Custom React hooks
│   │   ├── stores/             # Zustand stores
│   │   ├── types/              # TypeScript types
│   │   └── utils/
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── scripts/                    # Deployment scripts
│   ├── install.sh
│   └── update.sh
│
├── docker-compose.yml          # Local development
├── nginx.conf                  # Production config
└── README.md
```

---

## 🚨 BELANGRIJKE REGELS

### 1. Geen Django Admin voor Eindgebruikers
- Django Admin is ALLEEN voor developers/debugging
- ALLE functionaliteit moet in de React UI gebouwd worden
- Elke CRUD operatie krijgt een volledige gebruikersinterface

### 2. Responsive Design
- Mobile-first approach met TailwindCSS
- Applicatie moet werken op alle schermformaten
- Later wrappen naar iOS/Android app

### 3. Full Page Layout
- Applicatie gebruikt 100vh (volledige pagina)
- Sidebar navigatie (inklapbaar op mobile)
- Geen externe scrollbars op main container

### 4. API-First
- Backend levert alleen JSON API's
- Frontend is volledig gescheiden
- Zelfde API voor web en toekomstige mobile apps

---

## 📋 MODULES & FASEN

### Fase 0: Basis Setup
- [x] Project structuur bepaald
- [ ] Django project initialisatie
- [ ] React + Vite project initialisatie
- [ ] TailwindCSS configuratie
- [ ] PostgreSQL + Docker setup
- [ ] Basis layout (sidebar, header)
- [ ] App Settings pagina (naam, logo, favicon configureerbaar)

### Fase 1: Authenticatie & Gebruikersbeheer
**Database - Users tabel:**
| Veld | Type |
|------|------|
| id | UUID |
| username | CharField |
| voornaam | CharField |
| achternaam | CharField |
| telefoon | CharField |
| bedrijf | CharField |
| email | EmailField |
| password | Hashed |
| rol | Enum: Admin, Gebruiker, Chauffeur |
| mfa_enabled | Boolean |
| mfa_secret | CharField |
| is_active | Boolean |

**Functionaliteit:**
- Login/Register met JWT
- Optionele 2FA/MFA (TOTP)
- Admin: CRUD voor gebruikers
- Admin: Gebruikers blokkeren/deblokkeren
- Admin: Wachtwoord resetten

**UI:**
- Login scherm
- Admin dashboard met gebruikerslijst
- Formulier voor aanmaken/bewerken gebruiker

### Fase 2: Stamgegevens

**2.1 Bedrijven (Companies)**
| Veld | Type |
|------|------|
| id | UUID |
| naam | CharField |
| kvk | CharField |
| telefoon | CharField |
| contactpersoon | CharField |
| email | EmailField |
| adres | CharField |
| postcode | CharField |
| stad | CharField |

**2.2 Chauffeurs (Drivers)**
| Veld | Type |
|------|------|
| id | UUID |
| naam | CharField |
| telefoon | CharField |
| bedrijf | ForeignKey → Companies |
| gekoppelde_gebruiker | ForeignKey → Users |
| adr | Boolean |

**UI vereisten:**
- ADR als vinkje/toggle
- Gekoppelde gebruiker als dropdown van Users

**2.3 Vloot (Fleet)**
| Veld | Type |
|------|------|
| id | UUID |
| kenteken | CharField |
| type_wagen | CharField |
| ritnummer | CharField |
| bedrijf | ForeignKey → Companies |

**UI vereisten:**
- Bedrijf als dropdown van Companies

### Fase 3: Urenregistratie

**Database - TimeEntries:**
| Veld | Type |
|------|------|
| id | UUID |
| user | ForeignKey → Users |
| weeknummer | Integer (auto-berekend) |
| ritnummer | CharField |
| datum | DateField |
| kenteken | CharField |
| km_start | Integer |
| km_eind | Integer |
| totaal_km | Integer (berekend) |
| aanvang | TimeField |
| eind | TimeField |
| pauze | DurationField |
| totaal_uren | DurationField (berekend) |
| status | Enum: Concept, Ingediend |

**Logica:**
- Weeknummer: Auto-berekend uit datum (read-only)
- Totaal KM = KM Eind - KM Start (real-time)
- Totaal Uren = (Eind - Aanvang) - Pauze (real-time)
- Opslaan = status 'Concept'
- Indienen = status 'Ingediend' → naar Historie

**UI:**
- Menu 'Urenregistratie' met 'Dag toevoegen' en 'Uren indienen' knoppen
- Chauffeur ziet 'Historie' gegroepeerd per week (1 regel per week)
- Klik op regel → popup met detailregels (max 30 per pagina)
- Admin ziet 'Ingediende Uren' met live search op Ritnummer, Chauffeur, Weeknummer

### Fase 4: Weekplanning

**Logica 'Nieuwe Planning':**
1. Selecteer Bedrijf + Weeknummer (default: volgende week)
2. Systeem haalt alle voertuigen (Fleet) van dat bedrijf op
3. Auto-genereer: Per voertuig × 5 dagen (Ma-Vr) = planningsregels

**Grid kolommen:**
| Kolom | Bron |
|-------|------|
| Week | Input |
| Ritnummer | Uit Fleet |
| Dag | Ma/Di/Wo/Do/Vr |
| Chauffeur | Dropdown → Drivers |
| Telefoon | Auto-fill uit Chauffeur |
| ADR | Auto-fill uit Chauffeur |
| Truck Type | Uit Fleet |
| Kenteken | Uit Fleet |

**Automatisering:**
- Bij selectie Chauffeur → auto-fill Telefoon + ADR

**CRUD:**
- Regels handmatig toevoegen/wijzigen
- Hele weekplanning verwijderen

### Fase 5: Factuur Template Builder

**Datamodel:**
- Flexibele JSON structuur in database
- Templates per type factuur

**Layout Editor (4 delen):**

**Deel 1 & 2: Header & Sub-header**
- 3 kolommen: Links, Midden, Rechts
- Drag & drop widgets: Tekstveld, Afbeelding, Datum

**Deel 3: Regels/Tabel**
- Gebruiker definieert kolommen
- Per kolom: Naam, Type (Tekst/Aantal/Geld/Formule), Opmaak (Kleur/Vet/Cursief/Uitlijning)
- Formules: Excel-achtig (KolomA × KolomB)
- Variabelen: Uurtarief, KM_Tarief, etc.

**Deel 4: Totalen & Footer**
- Automatische berekening: Subtotaal, BTW, Totaal incl BTW

**Standaardwaarden:**
- Globale variabelen per template (DOT prijs, percentages, etc.)

### Fase 6: Facturen

**Aanmaken:**
- Type: Inkoop, Verkoop, Credit
- Selecteer Template (uit Fase 5)
- Importeer Uren: Modal met Ingediende Uren (filter chauffeur/week)
- Live calculatie bij wijzigingen

**Beheer:**
- Overzichtspagina alle facturen
- Acties: Bewerken, Verwijderen, Versturen via Email

**PDF Generatie:**
- Pixel-perfecte export (WeasyPrint)
- HTML/CSS → PDF

**Mail Settings:**
- SMTP configuratie (Host, Poort, Auth)
- OAuth ondersteuning voor Exchange Online

### Fase 7: Deployment Scripts

**install.sh:**
- Update systeem packages
- Installeer: Python, PostgreSQL, Nginx, Certbot
- Interactieve vragen: domeinnaam, repo-URL, wachtwoorden
- Maak service user aan
- Clone repo, stel permissies in
- Configureer Nginx (reverse proxy)
- SSL via Certbot
- Systemd service file
- Start applicatie

**update.sh:**
- Check of het draait onder service user
- git pull
- Update dependencies
- Database migraties (NOOIT data overschrijven!)
- Herstart service

---

## 🛣️ Tolheffing per land (module `tolling`)

### Waarom
Tolheffing wordt per land afgerekend en per land doorbelast. De buitenlandse tol
(Duitsland, België, …) moet apart op een factuur en apart exporteerbaar zijn, mét
het bedrijf erbij zodat duidelijk is wie het doorbelast krijgt.

### Backend
| Bestand | Rol |
|---|---|
| `backend/apps/tolling/buitenland.py` | Pure logica: `filter_op_land`, `overzicht`, `totalen_per_land`, `naar_xlsx` |
| `backend/apps/tolling/buitenland_views.py` | `TolBuitenlandViewSet` op `/api/tolling/buitenland/` + `/export/` |
| `backend/apps/tolling/views.py` | `land`-parameter op de export per kenteken en op de dachser-export/voorbeeld |

Landkeuzes overal gelijk: een ISO-code (`NL`, `DE`, `BE`, `LU`, `FR`),
`buitenland` (alles behalve leeg en `NL`), `onbekend` (land nog niet bepaald),
of niets meesturen voor alle landen. Een onbekende waarde geeft **400** met een
opsomming van de geldige keuzes. Periode: `date_from` + `date_to` (maximaal 400
dagen) óf `period=week|month` met `offset` (begrensd op ±520).

Rechten: `IsAuthenticated` + `HasReadWriteModulePermission` met
`view_tolling` / `manage_tolling`. Zonder login 401, zonder module-recht 403.

Facturatie splitste al per `(kenteken, land)` in `create_invoice_simple`; de
buitenlandregel krijgt het achtervoegsel `- tol <land>`. Dat is niet gewijzigd.

### Frontend
| Bestand | Rol |
|---|---|
| `frontend/src/components/tolling/TolBuitenlandPaneel.tsx` | Overzicht per kenteken per land met bedrijf, ritnummers en openstaand bedrag + xlsx-export |
| `frontend/src/components/tolling/DachserExportModal.tsx` | Landkeuze bij *Exporteer per bedrijf*; de country-kolom volgt die keuze |
| `frontend/src/pages/tolling/TollingPage.tsx` | Eén kaart per kenteken (`PlateCard`) met de rit/bedrijf-combinaties erbinnen |

### Afspraken over de filters
1. Eén regel per kenteken. Reed een wagen op meerdere ritnummers of voor
   meerdere bedrijven, dan staan die combinaties **binnen** de kaart.
2. Klik op een bedrijf → alleen dat bedrijf; de ritnummerbalk toont nog
   uitsluitend de ritnummers van dat bedrijf.
3. Klik op een ritnummer → het bijbehorende bedrijf wordt automatisch actief.
4. Nogmaals klikken zet het filter uit. Een bedrijf dat alleen door een
   ritnummerkeuze actief werd, gaat dan ook weer uit.
5. Een bedrijf uitzetten verwijdert de ritnummers die nergens meer bij horen,
   anders zou het overzicht leeg blijven.

### Let op
- DACHSER-regels tellen niet mee in de doorbelasting; daar doen we niets mee.
- Radius factureert na. Een maand kan dus nog volledig ontbreken.
- De dubbelcontrole werkt op `(start_at, end_at, kenteken, bedrag, obu)`.
  Een CSV met **dagtotalen** en de API met **losse passages** herkent hij
  daardoor niet als dezelfde tol. Controleer dat vóór een import.

---


1. **Frontend taal**: TypeScript
2. **UI stijl**: Modern/Clean mix (professioneel, niet saai)
3. **Primaire kleur**: Blauw (#3B82F6)
4. **Authenticatie**: JWT volledig (stateless, mobile-ready)

---

## 🚀 Volgende Stap

Zodra bovenstaande vragen beantwoord zijn, start Fase 0:
1. Django project initialiseren
2. React + Vite project initialiseren
3. TailwindCSS configureren
4. Docker-compose voor PostgreSQL
5. Basis layout bouwen
6. App Settings module implementeren

---

*Laatst bijgewerkt: 27 januari 2026*
