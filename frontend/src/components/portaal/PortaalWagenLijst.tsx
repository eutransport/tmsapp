import { useTranslation } from 'react-i18next'
import { PortaalPositie, PortaalVoertuig } from '@/api/portaalTracking'

interface Props {
  voertuigen: PortaalVoertuig[]
  posities: PortaalPositie[]
  gekozen: string
  onKies: (kenteken: string) => void
}

export default function PortaalWagenLijst({ voertuigen, posities, gekozen, onKies }: Props) {
  const { t, i18n } = useTranslation()
  const perKenteken = new Map(posities.map(p => [p.kenteken, p]))

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="card flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="section-title">{t('portaalMap.vehicles', 'Wagens')}</h2>
        {gekozen && (
          <button className="btn btn-ghost btn-sm" onClick={() => onKies('')}>
            {t('portaalMap.allVehicles', 'Alle wagens')}
          </button>
        )}
      </div>
      <ul className="divide-y divide-gray-200 overflow-y-auto">
        {voertuigen.map(voertuig => {
          const positie = perKenteken.get(voertuig.kenteken)
          const rijdt = positie?.status === 'driving'
          const actief = gekozen === voertuig.kenteken
          return (
            <li key={voertuig.id}>
              <button
                onClick={() => onKies(actief ? '' : voertuig.kenteken)}
                className={`touch-target w-full px-4 py-3 text-left transition-colors ${
                  actief ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{voertuig.kenteken}</span>
                  <span className={`chip ${rijdt ? 'chip-success' : 'chip-warning'}`}>
                    {rijdt ? t('portaalMap.driving', 'Rijdt') : t('portaalMap.parked', 'Geparkeerd')}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {positie?.address || t('portaalMap.noPosition', 'Geen positie bekend')}
                </p>
                {positie?.timestamp && (
                  <p className="text-xs text-muted">{tijd(positie.timestamp)}</p>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
