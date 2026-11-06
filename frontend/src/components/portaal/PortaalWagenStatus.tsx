import { useTranslation } from 'react-i18next'
import { MapPinIcon } from '@heroicons/react/24/outline'
import { PortaalVoertuigDag } from '@/api/portaalTracking'

export default function PortaalWagenStatus({ dag }: { dag: PortaalVoertuigDag }) {
  const { t, i18n } = useTranslation()

  const getal = (waarde: number | null, cijfers = 1) =>
    waarde == null ? '-' : `${waarde.toLocaleString(i18n.language, { maximumFractionDigits: cijfers })} km`
  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '-'

  const rijdt = dag.rijdt
  const status = rijdt ? t('portaalMap.driving', 'Rijdt') : t('portaalMap.parked', 'Geparkeerd')

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="section-title">{dag.kenteken}</h2>
          <span className={`chip ${rijdt ? 'chip-success' : 'chip-warning'}`}>{status}</span>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-xl bg-primary-50/60 px-3 py-2 text-sm text-gray-900">
        <MapPinIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" />
        <span>
          <span className="font-medium">{dag.positie_adres || t('portaalMap.noAddress', 'Adres onbekend')}</span>
          <span className="text-muted"> &middot; {tijd(dag.positie_moment)}</span>
        </span>
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <dt className="text-xs text-muted">{t('radius.firstStart', 'Eerste start')}</dt>
          <dd className="text-sm font-medium text-gray-900">{tijd(dag.eerste_start)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('radius.lastEnd', 'Laatste einde')}</dt>
          <dd className="text-sm font-medium text-gray-900">{tijd(dag.laatste_eind)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('portaalMap.startKm', 'Beginstand')}</dt>
          <dd className="text-sm font-medium text-gray-900">{getal(dag.km_start, 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('portaalMap.endKm', 'Eindstand')}</dt>
          <dd className="text-sm font-medium text-gray-900">{getal(dag.km_eind, 0)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('portaalMap.drivenKm', 'Gereden')}</dt>
          <dd className="text-sm font-medium text-gray-900">{getal(dag.km_gereden)}</dd>
        </div>
      </dl>
    </div>
  )
}
