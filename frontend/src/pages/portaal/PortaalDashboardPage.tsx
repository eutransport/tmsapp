import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  BanknotesIcon,
  BuildingOfficeIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { portaalTracking } from '@/api/portaalTracking'
import { portaalFacturen } from '@/api/portaalFacturen'

export default function PortaalDashboardPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuthStore()

  const { data } = useQuery({
    queryKey: ['portaal-dashboard'],
    queryFn: portaalTracking.dashboard,
    refetchInterval: 60000,
  })

  const { data: facturen } = useQuery({
    queryKey: ['portaal-facturen-samenvatting'],
    queryFn: portaalFacturen.samenvatting,
  })

  const tellers = [
    {
      icon: ClipboardDocumentCheckIcon,
      label: t('portaalDash.createdToday', 'Opdrachten vandaag'),
      waarde: data?.opdrachten_vandaag_aangemaakt ?? '-',
      kleur: 'bg-primary-50 text-primary-600',
      rand: 'border-l-primary-500',
      href: '/portaal/opdrachten?vandaag=aangemaakt',
    },
    {
      icon: CheckCircleIcon,
      label: t('portaalDash.deliveredToday', 'Vandaag afgeleverd'),
      waarde: data?.opdrachten_vandaag_afgeleverd ?? '-',
      kleur: 'bg-emerald-50 text-emerald-600',
      rand: 'border-l-emerald-500',
      href: '/portaal/opdrachten?vandaag=afgeleverd&status=afgeleverd',
    },
    {
      icon: ClockIcon,
      label: t('portaalDash.stillOpen', 'Nog open'),
      waarde: data?.opdrachten_open ?? '-',
      kleur: 'bg-amber-50 text-amber-600',
      rand: 'border-l-amber-500',
      href: '/portaal/opdrachten?open=1',
    },
    {
      icon: TruckIcon,
      label: t('portaalDash.driving', 'Onderweg'),
      waarde: data?.chauffeurs.filter(c => c.rijdt).length ?? '-',
      kleur: 'bg-sky-50 text-sky-600',
      rand: 'border-l-sky-500',
      href: '/portaal/opdrachten?status=gestart',
    },
  ]

  const uren = (waarde: number) => {
    const u = Math.floor(waarde)
    const m = Math.round((waarde - u) * 60)
    return `${u}u ${String(m).padStart(2, '0')}m`
  }

  const initialen = (naam: string) =>
    naam.split(/\s+/).filter(Boolean).slice(0, 2).map(d => d[0]).join('').toUpperCase()

  const tegels = [
    {
      href: '/portaal/opdrachten',
      icon: ClipboardDocumentCheckIcon,
      titel: t('portaal.orders', 'Opdrachten'),
      tekst: t('portaal.ordersIntro', 'Opdrachten aanmaken en de status volgen.'),
      kleur: 'bg-primary-50 text-primary-600',
    },
    {
      href: '/portaal/klanten',
      icon: BuildingOfficeIcon,
      titel: t('customers.title', 'Mijn klanten'),
      tekst: t('customers.subtitle', 'Adresboek dat automatisch wordt gevuld vanuit uw opdrachten.'),
      kleur: 'bg-violet-50 text-violet-600',
    },
    {
      href: '/portaal/uren',
      icon: ClockIcon,
      titel: t('hoursPortal.title', 'Urenregistratie'),
      tekst: t('hoursPortal.subtitle', 'De geregistreerde uren van uw chauffeurs, per week.'),
      kleur: 'bg-teal-50 text-teal-600',
    },
    {
      href: '/portaal/facturen',
      icon: DocumentTextIcon,
      titel: t('invoicePortal.title', 'Facturen'),
      tekst: t('invoicePortal.subtitle', 'Uw facturen met betaalstatus en vervaldatum.'),
      kleur: 'bg-amber-50 text-amber-600',
    },
    {
      href: '/portaal/kaart',
      icon: MapPinIcon,
      titel: t('portaal.map', 'Waar is mijn wagen'),
      tekst: t('portaal.mapIntro', 'Volg de voertuigen die aan u zijn toegewezen.'),
      kleur: 'bg-sky-50 text-sky-600',
    },
  ]

  const maxUren = Math.max(1, ...(data?.chauffeurs.map(c => c.uren_vandaag) || [1]))

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl bg-gradient-to-r from-slate-900 to-primary-800 px-6 py-6">
        <h1 className="text-2xl font-semibold text-white">
          {t('portaal.welcome', 'Welkom')}, {user?.voornaam}
        </h1>
        {user?.opdrachtgever_bedrijf_naam && (
          <p className="mt-1 text-sm text-white/70">{user.opdrachtgever_bedrijf_naam}</p>
        )}
        <p className="mt-3 text-sm text-white/60">
          {new Date().toLocaleDateString(i18n.language, {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tellers.map(teller => (
          <Link
            key={teller.label}
            to={teller.href}
            className={`card-interactive border-l-4 ${teller.rand} block p-4`}
          >
            <div className="flex items-center justify-between">
              <p className="text-3xl font-semibold text-gray-900">{teller.waarde}</p>
              <span className={`rounded-lg p-2 ${teller.kleur}`}>
                <teller.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{teller.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link to="/portaal/facturen?filter=open" className="card-interactive flex items-center gap-3 p-4">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600"><BanknotesIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-2xl font-semibold text-gray-900">{facturen?.open_aantal ?? '-'}</div>
            <div className="text-xs text-gray-500">{t('invoicePortal.openCount', 'Openstaande facturen')}</div>
          </div>
        </Link>
        <Link to="/portaal/facturen?filter=te_laat" className="card-interactive flex items-center gap-3 p-4">
          <span className="rounded-lg bg-red-50 p-2 text-red-600"><ExclamationTriangleIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-2xl font-semibold text-gray-900">{facturen?.te_laat_aantal ?? '-'}</div>
            <div className="text-xs text-gray-500">{t('invoicePortal.overdueCount', 'Te laat')}</div>
          </div>
        </Link>
        <Link to="/portaal/facturen" className="card-interactive flex items-center gap-3 p-4">
          <span className="rounded-lg bg-primary-50 p-2 text-primary-600"><ClockIcon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="truncate text-2xl font-semibold text-gray-900">
              {facturen?.eerstvolgende
                ? new Date(facturen.eerstvolgende.vervaldatum).toLocaleDateString(i18n.language)
                : '-'}
            </div>
            <div className="truncate text-xs text-gray-500">
              {t('invoicePortal.nextDue', 'Eerstvolgende betaling')}
              {facturen?.eerstvolgende ? ` · ${facturen.eerstvolgende.factuurnummer}` : ''}
            </div>
          </div>
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="section-title">{t('portaalDash.driverHours', 'Uren van vandaag')}</h2>
          <Link to="/portaal/uren" className="text-sm font-medium text-primary-600 hover:underline">
            {t('hoursPortal.viewAll', 'Alle uren')}
          </Link>
        </div>
        {!data?.chauffeurs.length ? (
          <p className="p-4 text-sm text-muted">{t('portaalDash.noDrivers', 'Geen chauffeurs gevonden.')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.chauffeurs.map(chauffeur => (
              <li key={chauffeur.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-700">
                  {initialen(chauffeur.naam)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{chauffeur.naam}</p>
                  <p className="text-xs text-gray-500">
                    {chauffeur.kenteken || '-'} &middot; {chauffeur.opdrachten_vandaag}{' '}
                    {t('portaalDash.ordersToday', 'opdrachten')} ({chauffeur.opdrachten_afgeleverd}{' '}
                    {t('portaalDash.deliveredShort', 'afgeleverd')}) &middot;{' '}
                    {chauffeur.ritten_vandaag} {t('portaalDash.trips', 'ritten')}
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${chauffeur.rijdt ? 'bg-sky-500' : 'bg-primary-500'}`}
                      style={{ width: `${Math.min(100, (chauffeur.uren_vandaag / maxUren) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold text-gray-900">{uren(chauffeur.uren_vandaag)}</p>
                  {chauffeur.rijdt && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-600" />
                      {t('portaalDash.onTheRoad', 'Aan het rijden')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tegels.map(tegel => (
          <Link key={tegel.href} to={tegel.href} className="card-interactive flex items-start gap-4 p-5">
            <span className={`rounded-lg p-2.5 ${tegel.kleur}`}>
              <tegel.icon className="h-6 w-6" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-gray-900">{tegel.titel}</span>
              <span className="mt-0.5 block text-sm text-gray-500">{tegel.tekst}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
