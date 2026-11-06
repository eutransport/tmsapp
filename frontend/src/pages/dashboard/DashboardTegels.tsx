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
    <div className="grid grid-cols-2 gap-3">
      {zichtbaar.map(t => (
        <Link
          key={t.href}
          to={t.href}
          className="card card-interactive group relative flex flex-col items-start gap-3 p-4"
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${t.kleur} shadow-md ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-110`}>
            <t.icoon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t.titel}</p>
            <p className="mt-0.5 hidden text-xs text-gray-500 sm:block">{t.omschrijving}</p>
          </div>
          <ArrowUpRightIcon className="absolute right-3 top-3 h-4 w-4 text-gray-400 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#105BFF]" />
        </Link>
      ))}
    </div>
  )
}
