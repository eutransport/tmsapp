import { Link } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'
import {
  ArrowUpRightIcon,
  CurrencyEuroIcon,
  MapPinIcon,
  ReceiptPercentIcon,
  TruckIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'

interface Tegel {
  titel: string
  omschrijving: string
  href: string
  icoon: ComponentType<SVGProps<SVGSVGElement>>
  /** Tailwind-gradient voor het icoonvlak. */
  kleur: string
  /** Module-recht dat een gebruiker nodig heeft; admin ziet alles. */
  recht?: string
  alleenAdmin?: boolean
}

const TEGELS: Tegel[] = [
  { titel: 'Tol per kenteken', omschrijving: 'Tolheffing per wagen, week of maand', href: '/tolheffing',
    icoon: ReceiptPercentIcon, kleur: 'from-[#FE8500] to-[#ffa94d]', recht: 'view_tolling' },
  { titel: 'Gebruikers', omschrijving: 'Accounts, rollen en rechten', href: '/beheer/gebruikers',
    icoon: UsersIcon, kleur: 'from-[#105BFF] to-[#4f86ff]', alleenAdmin: true },
  { titel: 'Chauffeurs', omschrijving: 'Chauffeurs en hun koppelingen', href: '/drivers',
    icoon: UserGroupIcon, kleur: 'from-[#21233E] to-[#3b3f66]', recht: 'view_drivers' },
  { titel: 'Vloot', omschrijving: 'Wagens, APK en onderhoud', href: '/fleet',
    icoon: TruckIcon, kleur: 'from-[#105BFF] to-[#21233E]', recht: 'view_fleet' },
  { titel: 'Omzet', omschrijving: 'Omzet per periode en klant', href: '/revenue',
    icoon: CurrencyEuroIcon, kleur: 'from-emerald-500 to-emerald-700', recht: 'view_revenue' },
  { titel: 'Track & Trace', omschrijving: 'Live posities van de vloot', href: '/track-trace',
    icoon: MapPinIcon, kleur: 'from-[#FE8500] to-[#21233E]', recht: 'view_track_trace' },
]

export default function DashboardTegels({ user }: { user: any }) {
  const rechten: string[] = user?.module_permissions || []
  const isAdmin = user?.rol === 'admin'
  const zichtbaar = TEGELS.filter(t =>
    isAdmin || (!t.alleenAdmin && (!t.recht || rechten.includes(t.recht))))

  if (!zichtbaar.length) return null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {zichtbaar.map(t => (
        <Link
          key={t.href}
          to={t.href}
          className="card card-interactive group relative flex items-center gap-5 p-6 sm:p-7"
        >
          <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${t.kleur} shadow-lg ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-110`}>
            <t.icoon className="h-7 w-7 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-gray-900">{t.titel}</p>
            <p className="mt-0.5 text-sm text-gray-500">{t.omschrijving}</p>
          </div>
          <ArrowUpRightIcon className="h-5 w-5 flex-shrink-0 text-gray-400 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#105BFF]" />
        </Link>
      ))}
    </div>
  )
}
