import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  BanknotesIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MapIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import Pagination, { PageSize } from '@/components/common/Pagination'
import { portaalTol, TolWeek } from '@/api/opdrachten'
import { portaalTracking } from '@/api/portaalTracking'

const PER_PAGINA = 10 as PageSize

export default function PortaalTolPage() {
  const { t } = useTranslation()
  const [kenteken, setKenteken] = useState('')
  const [week, setWeek] = useState('')
  const [weekInvoer, setWeekInvoer] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const timer = setTimeout(() => { setWeek(weekInvoer.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [weekInvoer])

  const { data: voertuigen = [] } = useQuery({
    queryKey: ['portaal-voertuigen'],
    queryFn: portaalTracking.voertuigen,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-tol', kenteken, week, page],
    queryFn: () => portaalTol.lijst({ kenteken, week, page, page_size: PER_PAGINA }),
  })

  const weken: TolWeek[] = data?.results || []
  const totaal = data?.count || 0
  const bedrag = (waarde: number) =>
    waarde.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('tollPortal.title', 'Tolheffing')}</h1>
          <p className="text-sm text-muted">
            {t('tollPortal.subtitle', 'De tol die is gemaakt met de wagens die u mag volgen.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-primary-50 p-2 text-primary-600"><BanknotesIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{bedrag(data?.totaal_bedrag || 0)}</div>
            <div className="text-xs text-muted">{t('tollPortal.totalAmount', 'Totaal tolbedrag')}</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-teal-50 p-2 text-teal-600"><MapIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">
              {(data?.totaal_km || 0).toLocaleString('nl-NL')}
            </div>
            <div className="text-xs text-muted">{t('tollPortal.totalKm', 'Totaal tolkilometers')}</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600"><TruckIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{totaal}</div>
            <div className="text-xs text-muted">{t('tollPortal.weeks', 'Weken')}</div>
          </div>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <select
          value={kenteken}
          onChange={e => { setKenteken(e.target.value); setPage(1) }}
          className="input-field"
        >
          <option value="">{t('tollPortal.allPlates', 'Alle kentekens')}</option>
          {voertuigen.map(v => <option key={v.id} value={v.kenteken}>{v.kenteken}</option>)}
        </select>
        <input
          type="number"
          min={1}
          max={53}
          value={weekInvoer}
          onChange={e => setWeekInvoer(e.target.value)}
          placeholder={t('tollPortal.weekFilter', 'Weeknummer')}
          className="input-field"
        />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : weken.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('tollPortal.empty', 'Geen tolgegevens gevonden.')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {weken.map(w => {
              const uit = !open[w.id]
              return (
                <li key={w.id}>
                  <button
                    onClick={() => setOpen(vorig => ({ ...vorig, [w.id]: uit }))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    {uit
                      ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      : <ChevronDownIcon className="h-4 w-4 shrink-0 text-primary-600" />}
                    <span className="w-24 shrink-0 rounded bg-gray-100 px-2 py-0.5 text-center font-mono text-xs text-gray-600">
                      {t('hoursPortal.weekShort', 'wk')} {w.week} &middot; {w.jaar}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{w.kenteken}</span>
                    <span className="hidden text-xs text-gray-500 sm:inline">
                      {w.aantal} {t('tollPortal.passages', 'passages')}
                    </span>
                    <span className="hidden w-28 text-right text-sm text-gray-600 sm:inline">
                      {w.totaal_km.toLocaleString('nl-NL')} km
                    </span>
                    <span className="w-28 text-right text-sm font-semibold text-gray-900">
                      {bedrag(w.totaal_bedrag)}
                    </span>
                  </button>

                  {!uit && (
                    <div className="overflow-x-auto border-t border-gray-100 bg-gray-50 px-4 py-3">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <th className="py-1.5 pr-4">{t('tollPortal.moment', 'Moment')}</th>
                            <th className="py-1.5 pr-4">{t('tollPortal.country', 'Land')}</th>
                            <th className="py-1.5 pr-4">{t('orders.tripNumber', 'Ritnummer')}</th>
                            <th className="py-1.5 pr-4 text-right">{t('hoursPortal.kmTotal', 'Totaal km')}</th>
                            <th className="py-1.5 text-right">{t('tollPortal.amount', 'Bedrag')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {w.passages.map(p => (
                            <tr key={p.id} className="text-gray-700">
                              <td className="whitespace-nowrap py-1.5 pr-4">{p.moment}</td>
                              <td className="py-1.5 pr-4">{p.land || '-'}</td>
                              <td className="py-1.5 pr-4 font-mono text-xs">{p.ritnummer || '-'}</td>
                              <td className="py-1.5 pr-4 text-right">{p.km.toLocaleString('nl-NL')}</td>
                              <td className="py-1.5 text-right font-medium">{bedrag(p.bedrag)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                            <td className="py-2 pr-4" colSpan={3}>{t('tollPortal.weekTotal', 'Totaal week')}</td>
                            <td className="py-2 pr-4 text-right">{w.totaal_km.toLocaleString('nl-NL')}</td>
                            <td className="py-2 text-right">{bedrag(w.totaal_bedrag)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <Pagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(totaal / PER_PAGINA))}
          totalCount={totaal}
          pageSize={PER_PAGINA}
          onPageChange={setPage}
          onPageSizeChange={() => {}}
          showPageSizeSelector={false}
        />
      </div>
    </div>
  )
}
