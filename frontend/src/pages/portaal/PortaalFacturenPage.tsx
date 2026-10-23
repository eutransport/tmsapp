import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  BanknotesIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import Pagination, { PageSize } from '@/components/common/Pagination'
import { portaalFacturen, FactuurFilter, PortaalFactuur } from '@/api/portaalFacturen'

const FILTERS: { waarde: FactuurFilter; sleutel: string; standaard: string }[] = [
  { waarde: '', sleutel: 'invoicePortal.filterAll', standaard: 'Alle' },
  { waarde: 'open', sleutel: 'invoicePortal.filterOpen', standaard: 'Openstaand' },
  { waarde: 'te_laat', sleutel: 'invoicePortal.filterOverdue', standaard: 'Te laat' },
  { waarde: 'betaald', sleutel: 'invoicePortal.filterPaid', standaard: 'Betaald' },
]

function bedragVan(waarde: string, taal: string) {
  return Number(waarde || 0).toLocaleString(taal, { style: 'currency', currency: 'EUR' })
}

export default function PortaalFacturenPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<FactuurFilter>((params.get('filter') as FactuurFilter) || '')
  const [zoekInvoer, setZoekInvoer] = useState('')
  const [zoek, setZoek] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [bezig, setBezig] = useState<string | null>(null)

  const taal = i18n.language?.startsWith('tr') ? 'tr-TR' : i18n.language?.startsWith('en') ? 'en-GB' : 'nl-NL'

  useEffect(() => {
    const timer = setTimeout(() => { setZoek(zoekInvoer.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [zoekInvoer])

  const kiesFilter = (waarde: FactuurFilter) => {
    setFilter(waarde)
    setPage(1)
    setParams(waarde ? { filter: waarde } : {}, { replace: true })
  }

  const { data: samenvatting } = useQuery({
    queryKey: ['portaal-facturen-samenvatting'],
    queryFn: portaalFacturen.samenvatting,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-facturen', filter, zoek, page, pageSize],
    queryFn: () => portaalFacturen.lijst({ filter, zoek, page, page_size: pageSize }),
  })

  const facturen: PortaalFactuur[] = data?.results || []

  const haalBinnen = async (blob: Blob, bestandsnaam: string) => {
    const url = URL.createObjectURL(blob)
    const anker = document.createElement('a')
    anker.href = url
    anker.download = bestandsnaam
    document.body.appendChild(anker)
    anker.click()
    anker.remove()
    URL.revokeObjectURL(url)
  }

  const download = async (factuur: PortaalFactuur) => {
    setBezig(`${factuur.id}-pdf`)
    try {
      await haalBinnen(await portaalFacturen.pdf(factuur.id), `factuur-${factuur.factuurnummer}.pdf`)
    } catch {
      toast.error(t('invoicePortal.downloadFailed', 'De factuur kon niet worden opgehaald.'))
    } finally {
      setBezig(null)
    }
  }

  const downloadTol = async (factuur: PortaalFactuur) => {
    setBezig(`${factuur.id}-tol`)
    try {
      await haalBinnen(await portaalFacturen.tol(factuur.id), `tolheffing-${factuur.factuurnummer}.pdf`)
    } catch {
      toast.error(t('invoicePortal.tollFailed', 'De tolspecificatie kon niet worden opgehaald.'))
    } finally {
      setBezig(null)
    }
  }

  const datum = (waarde: string) => (waarde ? new Date(waarde).toLocaleDateString(taal) : '-')

  const status = (factuur: PortaalFactuur) => {
    if (factuur.credit) {
      return <span className="chip chip-primary">{t('invoicePortal.credit', 'Creditnota')}</span>
    }
    if (factuur.betaald) {
      return <span className="chip chip-success">{t('invoicePortal.paid', 'Betaald')}</span>
    }
    if (factuur.te_laat) {
      return (
        <span className="chip chip-danger">
          {t('invoicePortal.overdueDays', {
            count: Math.abs(factuur.dagen_tot_vervaldatum ?? 0),
            defaultValue: '{{count}} dagen te laat',
          })}
        </span>
      )
    }
    return <span className="chip chip-warning">{t('invoicePortal.open', 'Openstaand')}</span>
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('invoicePortal.title', 'Facturen')}</h1>
          <p className="text-sm text-muted">
            {t('invoicePortal.subtitle', 'Uw facturen met betaalstatus en vervaldatum.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => kiesFilter('open')}
          className="card card-hover flex items-center gap-3 p-4 text-left"
        >
          <span className="rounded-lg bg-amber-50 p-2 text-amber-600"><BanknotesIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{samenvatting?.open_aantal ?? 0}</div>
            <div className="text-xs text-muted">
              {t('invoicePortal.openCount', 'Openstaande facturen')}
              {samenvatting ? ` · ${bedragVan(samenvatting.open_bedrag, taal)}` : ''}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => kiesFilter('te_laat')}
          className="card card-hover flex items-center gap-3 p-4 text-left"
        >
          <span className="rounded-lg bg-red-50 p-2 text-red-600"><ExclamationTriangleIcon className="h-5 w-5" /></span>
          <div>
            <div className="text-xl font-semibold text-gray-900">{samenvatting?.te_laat_aantal ?? 0}</div>
            <div className="text-xs text-muted">
              {t('invoicePortal.overdueCount', 'Te laat')}
              {samenvatting ? ` · ${bedragVan(samenvatting.te_laat_bedrag, taal)}` : ''}
            </div>
          </div>
        </button>

        <div className="card flex items-center gap-3 p-4">
          <span className="rounded-lg bg-primary-50 p-2 text-primary-600"><ClockIcon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="truncate text-xl font-semibold text-gray-900">
              {samenvatting?.eerstvolgende ? datum(samenvatting.eerstvolgende.vervaldatum) : '-'}
            </div>
            <div className="truncate text-xs text-muted">
              {t('invoicePortal.nextDue', 'Eerstvolgende betaling')}
              {samenvatting?.eerstvolgende ? ` · ${samenvatting.eerstvolgende.factuurnummer}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f.waarde || 'alle'}
              type="button"
              onClick={() => kiesFilter(f.waarde)}
              className={filter === f.waarde ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {t(f.sleutel, f.standaard)}
            </button>
          ))}
        </div>
        <input
          value={zoekInvoer}
          onChange={e => setZoekInvoer(e.target.value)}
          placeholder={t('invoicePortal.searchPlaceholder', 'Zoek op factuurnummer')}
          className="input-field sm:ml-auto sm:max-w-xs"
        />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : facturen.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('invoicePortal.empty', 'Geen facturen gevonden.')}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">{t('invoicePortal.number', 'Factuurnummer')}</th>
                  <th className="px-4 py-3">{t('invoicePortal.date', 'Factuurdatum')}</th>
                  <th className="px-4 py-3">{t('invoicePortal.dueDate', 'Vervaldatum')}</th>
                  <th className="px-4 py-3 text-right">{t('invoicePortal.amount', 'Totaalbedrag')}</th>
                  <th className="px-4 py-3">{t('common.status', 'Status')}</th>
                  <th className="px-4 py-3 text-right">{t('common.actions', 'Acties')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {facturen.map(f => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm">{f.factuurnummer}</td>
                    <td className="px-4 py-3 text-sm">{datum(f.factuurdatum)}</td>
                    <td className="px-4 py-3 text-sm">{datum(f.vervaldatum)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold">{bedragVan(f.totaal, taal)}</td>
                    <td className="px-4 py-3">{status(f)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => download(f)}
                          disabled={bezig === `${f.id}-pdf`}
                          className="btn btn-ghost btn-sm gap-1.5"
                        >
                          <ArrowDownTrayIcon className="h-4 w-4" />
                          {t('invoicePortal.download', 'PDF')}
                        </button>
                        {f.heeft_tol && (
                          <button
                            type="button"
                            onClick={() => downloadTol(f)}
                            disabled={bezig === `${f.id}-tol`}
                            className="btn btn-ghost btn-sm gap-1.5"
                            title={t('invoicePortal.tollHint', 'Specificatie van de tolpassages bij deze factuur')}
                          >
                            <BanknotesIcon className="h-4 w-4" />
                            {t('invoicePortal.toll', 'Tolheffing')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <ul className="divide-y divide-gray-100 md:hidden">
              {facturen.map(f => (
                <li key={f.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold">{f.factuurnummer}</span>
                    {status(f)}
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>{t('invoicePortal.dueDate', 'Vervaldatum')}: {datum(f.vervaldatum)}</span>
                    <span className="font-semibold text-gray-900">{bedragVan(f.totaal, taal)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => download(f)}
                      disabled={bezig === `${f.id}-pdf`}
                      className="btn btn-secondary btn-sm flex-1 gap-1.5"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" />
                      {t('invoicePortal.download', 'PDF')}
                    </button>
                    {f.heeft_tol && (
                      <button
                        type="button"
                        onClick={() => downloadTol(f)}
                        disabled={bezig === `${f.id}-tol`}
                        className="btn btn-secondary btn-sm flex-1 gap-1.5"
                      >
                        <BanknotesIcon className="h-4 w-4" />
                        {t('invoicePortal.toll', 'Tolheffing')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Pagination
        currentPage={page}
        totalPages={Math.max(1, Math.ceil((data?.count || 0) / pageSize))}
        totalCount={data?.count || 0}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />
    </div>
  )
}
