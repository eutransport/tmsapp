import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import Pagination, { PageSize } from '@/components/common/Pagination'
import { portaalUren, UrenWeek } from '@/api/opdrachten'

const PER_PAGINA = 10 as PageSize

const urenTekst = (uren: number) => {
  const totaal = Math.round(uren * 60)
  return `${Math.floor(totaal / 60)}u ${String(totaal % 60).padStart(2, '0')}m`
}

export default function PortaalUrenPage() {
  const { t, i18n } = useTranslation()
  const [zoek, setZoek] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const datumTekst = (datum: string) =>
    new Date(datum).toLocaleDateString(i18n.language, {
      weekday: 'short', day: '2-digit', month: 'short',
    })

  useEffect(() => {
    const timer = setTimeout(() => { setTerm(zoek.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [zoek])

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-uren', term, page],
    queryFn: () => portaalUren.lijst({ search: term || undefined, page, page_size: PER_PAGINA }),
  })

  const weken: UrenWeek[] = data?.results || []
  const totaal = data?.count || 0
  const totalPages = Math.max(1, Math.ceil(totaal / PER_PAGINA))
  const totalen = { uren: data?.totaal_uren || 0, km: data?.totaal_km || 0 }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('hoursPortal.title', 'Urenregistratie')}</h1>
          <p className="text-sm text-muted">
            {t('hoursPortal.subtitle', 'De geregistreerde uren van uw chauffeurs, per week.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-primary-50 p-2 text-primary-600"><ClockIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{urenTekst(totalen.uren)}</div>
            <div className="text-xs text-muted">{t('hoursPortal.totalHours', 'Totaal uren')}</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-teal-50 p-2 text-teal-600"><TruckIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{totalen.km.toLocaleString('nl-NL')}</div>
            <div className="text-xs text-muted">{t('hoursPortal.totalKm', 'Totaal kilometers')}</div>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600"><ChevronDownIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{totaal}</div>
            <div className="text-xs text-muted">{t('hoursPortal.weeks', 'Weken')}</div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={zoek}
            onChange={e => setZoek(e.target.value)}
            placeholder={t('hoursPortal.searchPlaceholder', 'Zoek op chauffeur, ritnummer, kenteken of datum')}
            className="input-field pl-9"
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : weken.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('hoursPortal.empty', 'Geen uren gevonden.')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {weken.map(week => {
              const uit = !open[week.id]
              return (
                <li key={week.id}>
                  <button
                    onClick={() => setOpen(vorig => ({ ...vorig, [week.id]: uit }))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    {uit
                      ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      : <ChevronDownIcon className="h-4 w-4 shrink-0 text-primary-600" />}
                    <span className="w-24 shrink-0 rounded bg-gray-100 px-2 py-0.5 text-center font-mono text-xs text-gray-600">
                      {t('hoursPortal.weekShort', 'wk')} {week.week} &middot; {week.jaar}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{week.chauffeur}</span>
                    <span className="hidden text-xs text-gray-500 sm:inline">
                      {week.aantal_dagen} {t('hoursPortal.days', 'dagen')}
                    </span>
                    <span className="hidden w-28 text-right text-sm text-gray-600 sm:inline">
                      {week.totaal_km.toLocaleString('nl-NL')} km
                    </span>
                    <span className="w-20 text-right text-sm font-semibold text-gray-900">
                      {urenTekst(week.totaal_uren)}
                    </span>
                  </button>

                  {!uit && (
                    <div className="overflow-x-auto border-t border-gray-100 bg-gray-50 px-4 py-3">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <th className="py-1.5 pr-4">{t('hours.date', 'Datum')}</th>
                            <th className="py-1.5 pr-4">{t('orders.tripNumber', 'Ritnummer')}</th>
                            <th className="py-1.5 pr-4">{t('hours.plate', 'Kenteken')}</th>
                            <th className="py-1.5 pr-4">{t('hoursPortal.start', 'Begin')}</th>
                            <th className="py-1.5 pr-4">{t('hoursPortal.end', 'Eind')}</th>
                            <th className="py-1.5 pr-4 text-right">{t('hoursPortal.kmStart', 'KM start')}</th>
                            <th className="py-1.5 pr-4 text-right">{t('hoursPortal.kmEnd', 'KM eind')}</th>
                            <th className="py-1.5 pr-4 text-right">{t('hoursPortal.kmTotal', 'Totaal km')}</th>
                            <th className="py-1.5 text-right">{t('hoursPortal.hours', 'Uren')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {week.dagen.map(dag => (
                            <tr key={dag.id} className="text-gray-700">
                              <td className="whitespace-nowrap py-1.5 pr-4">{datumTekst(dag.datum)}</td>
                              <td className="py-1.5 pr-4 font-mono text-xs">{dag.ritnummer || '-'}</td>
                              <td className="py-1.5 pr-4">{dag.kenteken || '-'}</td>
                              <td className="py-1.5 pr-4">{dag.aanvang}</td>
                              <td className="py-1.5 pr-4">{dag.eind}</td>
                              <td className="py-1.5 pr-4 text-right">{dag.km_start.toLocaleString('nl-NL')}</td>
                              <td className="py-1.5 pr-4 text-right">{dag.km_eind.toLocaleString('nl-NL')}</td>
                              <td className="py-1.5 pr-4 text-right">{dag.totaal_km.toLocaleString('nl-NL')}</td>
                              <td className="py-1.5 text-right font-medium">{urenTekst(dag.uren)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                            <td className="py-2 pr-4" colSpan={7}>{t('hoursPortal.weekTotal', 'Totaal week')}</td>
                            <td className="py-2 pr-4 text-right">{week.totaal_km.toLocaleString('nl-NL')}</td>
                            <td className="py-2 text-right">{urenTekst(week.totaal_uren)}</td>
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
          totalPages={totalPages}
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
