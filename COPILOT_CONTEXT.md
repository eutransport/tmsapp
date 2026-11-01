# TMS Application - Copilot Quick Reference

> **DOEL**: Dit bestand bevat een samenvatting van de applicatie zodat Copilot niet steeds de hele codebase hoeft te doorlopen.
> **Laatst bijgewerkt**: 26 februari 2026

---

## 🎯 Wat is TMS?

**Transport Management Systeem** - een webapplicatie voor transportbeheer, urenregistratie, weekplanning, facturatie, verlofbeheer, documentondertekening en vlootbeheer.

---

## 🛠️ Tech Stack

| Component | Technologie |
|-----------|-------------|
| Backend | Django 5.x + Django REST Framework |
| Frontend | React 18 + Vite + TypeScript |
| Styling | TailwindCSS 3.x |
| Database | PostgreSQL 16 |
| Auth | JWT (SimpleJWT) + TOTP 2FA |
| API Docs | drf-spectacular (Swagger) |
| PDF | WeasyPrint + ReportLab + PyMuPDF |
| Containers | Docker + Docker Compose |
| State Mgmt | Zustand (stores) |
| i18n | react-i18next (nl/en) |
| UI Kit | @headlessui/react + @heroicons/react |
| HTTP Client | Axios (met JWT interceptors) |

---

## 🏗️ Architectuur

- **API-First**: Backend levert alleen JSON, frontend is volledig gescheiden
- **Multi-tenant ready**: Bedrijven als ForeignKey, niet per database
- **Rollen**: `admin`, `gebruiker`, `chauffeur`
- **UUID primary keys** op alle modellen
- **Singleton pattern** voor AppSettings en PushSettings

---

## 📁 Backend Structuur

```
backend/
├── tms/                          # Django project config
│   ├── settings/
│   │   ├── base.py               # Gedeelde settings (INSTALLED_APPS, REST_FRAMEWORK, JWT, LOGGING)
│   │   ├── development.py        # Debug, SQLite, CORS allow all
│   │   └── production.py         # PostgreSQL, security headers
│   ├── urls.py                   # Alle API URL registraties
│   └── middleware.py
├── apps/
│   ├── accounts/                 # Users, Auth, 2FA, JWT endpoints
│   ├── companies/                # Bedrijven CRUD + Mailinglijst
│   ├── drivers/                  # Chauffeurs CRUD
│   ├── fleet/                    # Voertuigen (Vehicle model: kenteken, type_wagen, ritnummer, bedrijf)
│   ├── timetracking/             # Urenregistratie per dag
│   ├── planning/                 # Weekplanning (bedrijf × voertuigen × dagen)
│   ├── invoicing/                # Facturen + Templates + OCR + Email Import
│   ├── leave/                    # Verlofbeheer + Saldo + Goedkeuring
│   ├── notifications/            # Push notificaties (VAPID/Firebase) + Inbox + Schedules
│   ├── documents/                # PDF upload + digitaal ondertekenen
│   ├── spreadsheets/             # Ritregistratie templates + data
│   ├── licensing/                # Licentie systeem (Ed25519 signed keys, eenmalig gebruik)
│   └── core/                     # AppSettings, ActivityLog, Permissions, CustomFont, Encryption
├── requirements/
│   ├── base.txt                  # Productie dependencies
│   ├── development.txt           # + debug-toolbar, ipython
│   └── local.txt                 # Verwijst naar development.txt
```

### Belangrijke Backend Patterns

- **Models**: UUID PK, `created_at`/`updated_at` auto fields, ForeignKey met `related_name`
- **Serializers**: ModelSerializer met `read_only_fields`, computed fields via `source='relatie.veld'`
- **Views**: ModelViewSet met `queryset`, `serializer_class`, `permission_classes`, `search_fields`, `filterset_fields`, `ordering_fields`
- **Permissions**: `IsAdminOrManager` (admin/gebruiker = full, chauffeur = read-only), `IsAdminOnly`, `IsOwnerOrAdmin`
- **URLs**: DefaultRouter per app, included via `path('api/{app}/', include('{app}.urls'))`
- **Logging**: `logger.info/warning` bij create/update/delete, logger name = `accounts.security`

### API URL Mapping

| Prefix | App |
|--------|-----|
| `/api/auth/` | accounts |
| `/api/core/` | core |
| `/api/companies/` | companies |
| `/api/drivers/` | drivers |
| `/api/fleet/` | fleet |
| `/api/time-entries/` | timetracking |
| `/api/planning/` | planning |
| `/api/invoicing/` | invoicing |
| `/api/leave/` | leave |
| `/api/notifications/` | notifications |
| `/api/documents/` | documents |
| `/api/spreadsheets/` | spreadsheets |
| `/api/licensing/` | licensing |

---

## 📁 Frontend Structuur

```
frontend/src/
├── api/                          # API service modules (1 per backend app)
│   ├── client.ts                 # Axios instance + JWT interceptors
│   ├── fleet.ts                  # getVehicles, createVehicle, etc.
│   ├── companies.ts, drivers.ts, auth.ts, invoices.ts, etc.
├── components/
│   ├── layout/
│   │   ├── DashboardLayout.tsx   # Sidebar nav + top bar + Outlet
│   │   └── AuthLayout.tsx        # Login layout
│   ├── common/
│   │   ├── Pagination.tsx        # Herbruikbare paginering
│   │   ├── ResponsiveTable.tsx
│   │   └── LanguageSwitcher.tsx
│   ├── notifications/            # NotificationBell, etc.
│   └── pwa/                      # PWA install/update prompts
├── pages/                        # 1 map per feature
│   ├── fleet/FleetPage.tsx       # Voorbeeld: CRUD met modal, tabel, zoeken, paginering
│   ├── companies/, drivers/, dashboard/, invoices/, etc.
├── hooks/                        # Custom React hooks
├── stores/                       # Zustand stores
│   ├── authStore.ts              # User, tokens, login/logout
│   ├── appStore.ts               # Settings, sidebar state
│   ├── themeStore.ts             # Dark/light/custom themes
│   └── serverConfigStore.ts      # Server URL config
├── types/index.ts                # Alle TypeScript interfaces
├── i18n/
│   ├── index.ts                  # i18next config
│   └── locales/
│       ├── nl.json               # Nederlandse vertalingen (~1439 regels)
│       └── en.json               # Engelse vertalingen
└── utils/                        # Helpers (clsx, etc.)
```

### Belangrijke Frontend Patterns

- **Pagina's**: Alles in 1 bestand (Modal, Form, MainPage componenten), useState voor state
- **Data fetching**: useCallback + useEffect, geen React Query/SWR
- **API calls**: `api.get/post/patch/delete` via axios instance, returns `response.data`
- **Paginering**: `{ count, results, next, previous }` response, `Pagination` component
- **Sortering**: `ordering` query param, `-` prefix voor desc
- **Zoeken**: `search` query param (backend SearchFilter)
- **i18n**: `useTranslation()` hook, `t('section.key')` syntax
- **Navigatie**: NavItem array in DashboardLayout.tsx met `name` (i18n key), `href`, `icon`, `roles`
- **Routes**: Defined in App.tsx met ProtectedRoute wrapper, `adminOnly` prop
- **Icons**: @heroicons/react/24/outline
- **Modals**: Headless UI Dialog/Transition of custom Modal component
- **Succes/Error**: `setSuccessMessage` + setTimeout 3s auto-clear
- **Responsive**: Desktop tabel + mobiele kaartweergave (`hidden md:block` / `md:hidden`)
- **CSS klassen**: `page-header`, `page-title`, `btn-primary`, `card`, `input` (Tailwind @apply in index.css)

### Design system: glassmorphism (index.css + tailwind.config.js)

- **Merkkleuren**: charcoal `#21232E` (`--brand-charcoal`), royal blue `#105BFF` (`--brand-royal`, tevens primary), tangerine `#FE8500` (`--brand-tangerine`, accent). Tailwind-schalen: `charcoal-*`, `royal-*`, `tangerine-*`.
- **Glas-tokens**: `--glass-bg`, `--glass-bg-strong`, `--glass-bg-soft`, `--glass-border`, `--glass-border-strong`, `--glass-highlight`, `--glass-blur`, `--glass-topbar`, `--glass-sidebar`. Deze worden per thema herberekend in `themeStore.ts` (`applyGlassTokens`), zodat donkere thema's donker glas krijgen en licht blijft leesbaar.
- **Zweef-diepte**: `--shadow-card` / `--shadow-card-hover` / `--shadow-pop`; kaarten en modals liften bij hover en komen binnen met `glass-float-in`.
- **Herbruikbaar**: `.glass`, `.glass-strong`, `.glass-soft`, `.float-panel`, `.float-in`, `.glass-topbar`, `.glass-sidebar`, `.btn-accent`, `.chip-accent` (staan op de Tailwind `safelist`).
- **Leesbaarheid**: op `html.glass-light` worden bestaande utilities (`bg-white`, `bg-gray-50/100`, `border-gray-*`, `text-gray-*`) naar glas-tokens gemapt; zwevende lagen (menu's, dialogen) krijgen een dichtere vulling, en zonder `backdrop-filter`-support vallen alle vlakken terug op dekkend wit.

### Sidebar Navigatie (DashboardLayout.tsx)

```typescript
const navigation: NavItem[] = [
  { name: 'nav.dashboard', href: '/', icon: HomeIcon, roles: ['admin', 'gebruiker'] },
  { name: 'nav.companies', href: '/companies', icon: BuildingOfficeIcon, roles: ['admin', 'gebruiker'] },
  { name: 'nav.drivers', href: '/drivers', icon: UsersIcon, roles: ['admin', 'gebruiker'] },
  { name: 'nav.fleet', href: '/fleet', icon: TruckIcon, roles: ['admin', 'gebruiker'] },
  // ... meer items
]
```

### TypeScript Types (types/index.ts)

Key interfaces: `User`, `Company`, `Driver`, `Vehicle`, `TimeEntry`, `WeekPlanning`, `PlanningEntry`, `InvoiceTemplate`, `Invoice`, `InvoiceLine`, `Spreadsheet`, `PaginatedResponse<T>`

**Vehicle interface:**
```typescript
export interface Vehicle {
  id: string
  kenteken: string
  type_wagen: string
  ritnummer: string
  bedrijf: string
  bedrijf_naam: string
  created_at: string
  updated_at: string
}
```

---

## 🔒 Authenticatie & Autorisatie

- JWT Access Token: 60 min, Refresh Token: 7 dagen
- Rollen: `admin` (alles), `gebruiker` (manager, CRUD), `chauffeur` (eigen data + read-only)
- Optional TOTP 2FA
- Token refresh met blacklist na rotation

---

## 🗄️ Database

- PostgreSQL 16 in productie, SQLite in development
- UUID primary keys overal
- `created_at` (auto_now_add), `updated_at` (auto_now) op alle modellen
- Django migrations per app

---

## 📦 Key Dependencies

Backend: Django 5.x, DRF, SimpleJWT, django-filter, drf-spectacular, WeasyPrint, openai, pyotp, cryptography
Frontend: React 18, Vite, TypeScript, TailwindCSS, Zustand, react-i18next, @headlessui/react, @heroicons/react, axios

---

## 🚀 Development Setup

```bash
# Backend
cd backend
pip install -r requirements/development.txt
python manage.py runserver 0.0.0.0:8001

# Frontend
cd frontend
npm install
npm run dev  # Vite dev server op :5173
```

Docker: `docker-compose.yml` (productie), `docker-compose.local.yml` (development)

---

## 📝 Conventies

1. **Taal**: UI is tweetalig (NL/EN), code comments in Engels, model velden in Nederlands
2. **API URLs**: `/api/{app-naam}/` → REST endpoints
3. **Geen Django Admin voor eindgebruikers** - alles via React UI
4. **Mobile-first** responsive design
5. **Full page layout** - 100vh, sidebar navigatie
6. **Consistente error handling** met `getErrorMessage()` helper

---

*Dit bestand wordt bijgewerkt wanneer er grote wijzigingen aan de applicatie worden gemaakt.*
