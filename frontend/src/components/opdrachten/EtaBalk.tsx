import { useTranslation } from 'react-i18next'
import { CheckCircleIcon, ClockIcon, MapPinIcon } from '@heroicons/react/24/outline'
import { OpdrachtEta, OpdrachtFase } from '@/api/opdrachten'

interface Props {
  eta?: OpdrachtEta | null
  compact?: boolean
  fase?: OpdrachtFase
}

const FOUTSLEUTELS: Record<string, string> = {
  gps_niet_beschikbaar: 'eta.errorGps',
  geen_positie: 'eta.errorNoPosition',
  adres_onbekend: 'eta.errorAddress',
  route_mislukt: 'eta.errorRoute',
}

export default function EtaBalk({ eta, compact = false, fase }: Props) {
  const { t, i18n } = useTranslation()

  // Staat hij bij de klant, dan is de rit klaar: een volle balk zegt meer dan
  // een aankomsttijd die op een paar minuten blijft hangen.
  if (fase && fase !== 'onderweg') {
    return (
      <div className={compact ? 'w-40' : 'w-full'}>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <CheckCircleIcon className="h-3.5 w-3.5" />
          {t('eta.arrived', 'Aangekomen bij klant')}
        </span>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full w-full rounded-full bg-emerald-500 transition-all duration-700" />
        </div>
      </div>
    )
  }

  if (!eta) return null

  if (eta.eta_fout) {
    return (
      <p className="text-xs text-gray-400">
        {t(FOUTSLEUTELS[eta.eta_fout] || 'eta.errorUnknown', 'Aankomsttijd niet beschikbaar')}
      </p>
    )
  }

  if (eta.eta_minuten === null || eta.eta_aankomst === null) return null

  const start = eta.eta_start_minuten || eta.eta_minuten || 1
  // Hoe korter de resterende tijd, hoe voller de balk.
  const voortgang = Math.min(100, Math.max(0, ((start - eta.eta_minuten) / start) * 100))
  const bijna = eta.eta_minuten <= 15
  const aankomst = new Date(eta.eta_aankomst).toLocaleTimeString(i18n.language, {
    hour: '2-digit', minute: '2-digit',
  })
  const resterend = eta.eta_minuten >= 60
    ? `${Math.floor(eta.eta_minuten / 60)}u ${String(eta.eta_minuten % 60).padStart(2, '0')}m`
    : `${eta.eta_minuten} min`

  return (
    <div className={compact ? 'w-40' : 'w-full'}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 font-medium ${bijna ? 'text-emerald-700' : 'text-sky-700'}`}>
          <ClockIcon className="h-3.5 w-3.5" />
          {t('eta.arrivesAt', 'Aankomst ca.')} {aankomst}
        </span>
        <span className="text-gray-500">{resterend}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${bijna ? 'bg-emerald-500' : 'bg-sky-500'}`}
          style={{ width: `${voortgang}%` }}
        />
      </div>
      {!compact && eta.eta_afstand_km !== null && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400">
          <MapPinIcon className="h-3.5 w-3.5" />
          {eta.eta_afstand_km.toLocaleString('nl-NL')} km {t('eta.toGo', 'te gaan')}
        </p>
      )}
    </div>
  )
}
