/**
 * Tolheffing (toll) import & overview page.
 *
 * - Upload CSV (from OBU provider).
 * - Group per license plate.
 * - Expandable per-plate view with week/month navigation, event table with
 *   pagination and Excel/PDF export.
 * - Shows whether the events were already put on an invoice, with an option
 *   to reset that status.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CurrencyEuroIcon,
  DocumentArrowDownIcon,
  DocumentTextIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'

import { tollingApi, TollingSummary, TollingVehicleRow } from '@/api/tolling'
import ConfirmDialog, { ConfirmState } from '@/components/common/ConfirmDialog'
import CreateTollingInvoiceModal from '@/components/tolling/CreateTollingInvoiceModal'

const PAGE_SIZE = 15

function currency(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}
function kmFmt(n: number): string {
  return `${(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} km`
}
function dateFmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('nl-NL', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function companyKey(row: TollingVehicleRow): string {
  if (row.bedrijf_id) return `id:${row.bedrijf_id}`
  if (row.bedrijf_naam) return `name:${row.bedrijf_naam}`
  return '__none__'
}

function companyLabel(row: TollingVehicleRow): string {
  return row.bedrijf_naam || 'Zonder bedrijf'
}

export default function TollingPage() {
  const [rows, setRows] = useState<TollingVehicleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<string[]>([])
  const [showMoreCompanies, setShowMoreCompanies] = useState(false)
  const [invoiceModalRow, setInvoiceModalRow] = useState<TollingVehicleRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = async () => {
    setLoading(true)
    try {
      setRows(await tollingApi.listVehicles())
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon lijst niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const onFile = async (f: File | null) => {
    if (!f) return
    setUploading(true)
    try {
      const batch = await tollingApi.uploadCsv(f)
      const r = batch.result
      if (batch.error_message) {
        toast.error(batch.error_message)
      } else if (r) {
        toast.success(`Geïmporteerd: ${r.imported} · duplicaten: ${r.duplicates} · ongeldig: ${r.invalid}`)
      } else {
        toast.success('Import voltooid')
      }
      await reload()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Import mislukt')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const companyOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(companyKey(row), companyLabel(row))
    }
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'nl-NL'))
  }, [rows])

  const filteredRows = useMemo(() => {
    if (selectedCompanyKeys.length === 0) return rows
    const allowed = new Set(selectedCompanyKeys)
    return rows.filter(r => allowed.has(companyKey(r)))
  }, [rows, selectedCompanyKeys])

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        km: acc.km + (r.current_month_km || 0),
        amount: acc.amount + (r.current_month_amount || 0),
      }),
      { km: 0, amount: 0 },
    )
  }, [filteredRows])

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <CurrencyEuroIcon className="h-6 w-6 text-primary-600" />
            Tolheffing import
          </h1>
          <p className="text-sm text-gray-500">
            Importeer het CSV-bestand van de tolprovider. De regels worden per kenteken gegroepeerd en kunnen op
            een factuur worden gezet.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => onFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => reload()}
            disabled={loading}
          >
            <ArrowPathIcon className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Vernieuwen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <ArrowUpTrayIcon className="h-4 w-4 mr-1.5" />
            {uploading ? 'Bezig…' : 'CSV importeren'}
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Auto's met events" value={String(filteredRows.length)} />
        <StatCard label="KM huidige maand" value={kmFmt(totals.km)} />
        <StatCard label="Bedrag huidige maand" value={currency(totals.amount)} />
      </section>

      {companyOptions.length > 0 && (
        <section className="rounded-lg border bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-gray-500 uppercase mr-0.5">Bedrijf:</span>
            <button
              type="button"
              onClick={() => setSelectedCompanyKeys([])}
              className={`px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                selectedCompanyKeys.length === 0
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Alle bedrijven
            </button>
            {(showMoreCompanies ? companyOptions : companyOptions.slice(0, 10)).map(opt => {
              const active = selectedCompanyKeys.includes(opt.key)
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setSelectedCompanyKeys(prev =>
                      prev.includes(opt.key)
                        ? prev.filter(k => k !== opt.key)
                        : [...prev, opt.key],
                    )
                  }
                  className={`px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
            {companyOptions.length > 10 && (
              <button
                type="button"
                onClick={() => setShowMoreCompanies(v => !v)}
                className="px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium text-primary-600 hover:bg-primary-50 transition-colors"
              >
                {showMoreCompanies ? 'Minder tonen' : 'Meer tonen'}
              </button>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">Laden…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-gray-500">
          Nog geen tolheffing-regels geïmporteerd. Klik op “CSV importeren” om te beginnen.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-gray-500">
          Geen resultaten voor de geselecteerde bedrijven.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map(row => (
            <VehicleRow
              key={row.plate_normalized}
              row={row}
              open={!!expanded[row.plate_normalized]}
              onToggle={() =>
                setExpanded(prev => ({ ...prev, [row.plate_normalized]: !prev[row.plate_normalized] }))
              }
              onCreateInvoice={() => setInvoiceModalRow(row)}
            />
          ))}
        </div>
      )}

      {invoiceModalRow && (
        <CreateTollingInvoiceModal
          isOpen={!!invoiceModalRow}
          row={invoiceModalRow}
          onClose={() => setInvoiceModalRow(null)}
          onCreated={() => {
            setInvoiceModalRow(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  )
}

interface VehicleRowProps {
  row: TollingVehicleRow
  open: boolean
  onToggle: () => void
  onCreateInvoice: () => void
}

function VehicleRow({ row, open, onToggle, onCreateInvoice }: VehicleRowProps) {
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-semibold text-gray-900">{row.plate_display}</span>
              {row.ritnummer && (
                <span className="text-xs uppercase tracking-wide text-gray-500">
                  {row.ritnummer}
                </span>
              )}
              {row.bedrijf_naam && (
                <span className="text-xs text-primary-700 bg-primary-50 rounded px-1.5 py-0.5">
                  {row.bedrijf_naam}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Huidige maand: {kmFmt(row.current_month_km)} · {currency(row.current_month_amount)}
            </div>
          </div>
          {open ? (
            <ChevronUpIcon className="h-5 w-5 text-gray-400 shrink-0" />
          ) : (
            <ChevronDownIcon className="h-5 w-5 text-gray-400 shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={onCreateInvoice}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 border-l border-gray-200 text-sm text-primary-700 hover:bg-primary-50 hover:text-primary-800 transition-colors"
          title="Factuur maken voor dit voertuig"
        >
          <DocumentTextIcon className="h-4 w-4" />
          Factuur
        </button>
      </div>
      <div className="sm:hidden border-t border-gray-100">
        <button
          type="button"
          onClick={onCreateInvoice}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-sm text-primary-700 hover:bg-primary-50"
        >
          <DocumentTextIcon className="h-4 w-4" />
          Factuur maken
        </button>
      </div>
      {open && <VehicleDetail plate={row.plate_normalized} plateDisplay={row.plate_display} />}
    </div>
  )
}

interface VehicleDetailProps {
  plate: string
  plateDisplay: string
}

function VehicleDetail({ plate, plateDisplay }: VehicleDetailProps) {
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<TollingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null)
  const [unmarking, setUnmarking] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const s = await tollingApi.summary(plate, { period, offset })
      setData(s)
      setPage(1)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon overzicht niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [plate, period, offset])

  const totalPages = data ? Math.max(1, Math.ceil(data.events.length / PAGE_SIZE)) : 1
  const pageEvents = data ? data.events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []

  const download = async (fmt: 'xlsx' | 'pdf') => {
    setExporting(fmt)
    try {
      const blob = await tollingApi.downloadExport(plate, { period, offset, format: fmt })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safe = plateDisplay.replace(/[^A-Za-z0-9-]/g, '') || 'tolheffing'
      a.download = `tolheffing_${safe}_${period}_${data?.year ?? ''}_${data?.index ?? ''}.${fmt}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Export mislukt')
    } finally {
      setExporting(null)
    }
  }

  const unmark = async () => {
    if (!data) return
    let year: number
    let index: number
    if (period === 'month') {
      year = data.year
      index = data.index
    } else {
      const iso = data
      year = iso.year
      index = iso.index
    }
    const label = period === 'month' ? `${year}/${index}` : `week ${index}/${year}`
    const doUnmark = async () => {
      setUnmarking(true)
      try {
        const r = await tollingApi.markUninvoiced(plate, { period, year, index })
        toast.success(`Teruggezet: ${r.unmarked} events; ${r.lines_deleted} factuurregels verwijderd.`)
        await load()
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Bijwerken mislukt')
      } finally {
        setUnmarking(false)
      }
    }
    setConfirmState({
      title: '"Gefactureerd" terugdraaien?',
      message: (
        <span>
          Weet je zeker dat je "gefactureerd" wilt terugdraaien voor{' '}
          <strong>{plateDisplay}</strong> — <strong>{label}</strong>?
          <br />
          <span className="text-xs text-gray-500">
            De bijbehorende factuurregels worden verwijderd.
          </span>
        </span>
      ),
      confirmLabel: 'Terugdraaien',
      variant: 'warning',
      onConfirm: doUnmark,
    })
  }

  return (
    <div className="border-t bg-gray-50">
      <div className="p-3 sm:p-4 space-y-3">
        {/* Period switch + prev/next */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="inline-flex rounded-md border border-gray-300 bg-white overflow-hidden self-start">
            {(['month', 'week'] as const).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => { setPeriod(p); setOffset(0) }}
                className={`px-3 py-1.5 text-sm ${
                  period === p ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p === 'month' ? 'Maand' : 'Week'}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-2 bg-white border border-gray-300 rounded-md">
            <button
              type="button"
              className="p-1.5 hover:bg-gray-50"
              onClick={() => setOffset(o => o - 1)}
              title="Vorige"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center">
              {data?.label ?? '—'}
            </span>
            <button
              type="button"
              className="p-1.5 hover:bg-gray-50 disabled:opacity-40"
              onClick={() => setOffset(o => o + 1)}
              disabled={offset >= 0}
              title="Volgende"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => download('xlsx')}
              disabled={!!exporting || !data || data.events.length === 0}
            >
              <TableCellsIcon className="h-4 w-4 mr-1" />
              {exporting === 'xlsx' ? '…' : 'Excel'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => download('pdf')}
              disabled={!!exporting || !data || data.events.length === 0}
            >
              <DocumentArrowDownIcon className="h-4 w-4 mr-1" />
              {exporting === 'pdf' ? '…' : 'PDF'}
            </button>
          </div>
        </div>

        {/* Totals summary */}
        {data && (() => {
          const billableEvents = data.events.filter(ev => !ev.is_private)
          const privateEvents = data.events.filter(ev => ev.is_private)
          const weekendEvents = billableEvents.filter(ev => {
            const d = new Date(ev.start_at)
            const dow = d.getDay() // 0=Sun, 6=Sat
            return dow === 0 || dow === 6
          })
          const weekdayEvents = billableEvents.filter(ev => {
            const d = new Date(ev.start_at)
            const dow = d.getDay()
            return dow !== 0 && dow !== 6
          })
          const privateKm = privateEvents.reduce((s, e) => s + Number(e.distance_km || 0), 0)
          const privateAmount = privateEvents.reduce((s, e) => s + Number(e.amount || 0), 0)
          const sumKm = (arr: typeof data.events) => arr.reduce((s, e) => s + Number(e.distance_km || 0), 0)
          const sumAmount = (arr: typeof data.events) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)
          const weekdayKm = sumKm(weekdayEvents)
          const weekdayAmount = sumAmount(weekdayEvents)
          const weekendKm = sumKm(weekendEvents)
          const weekendAmount = sumAmount(weekendEvents)
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <MiniStat label="Events" value={String(data.events_count)} />
                <MiniStat label="Totaal KM" value={kmFmt(data.total_km)} />
                <MiniStat label="Totaal bedrag" value={currency(data.total_amount)} highlight />
                <MiniStat
                  label="Gefactureerd"
                  value={data.invoiced_count > 0
                    ? `${data.invoiced_count} / ${data.events_count}`
                    : '—'}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border bg-blue-50/60 p-3">
                  <div className="text-xs uppercase text-blue-700 font-semibold mb-1">Doordeweeks (ma-vr)</div>
                  <div className="tabular-nums text-gray-800">
                    {weekdayEvents.length} events &middot; {kmFmt(weekdayKm)} km
                  </div>
                  <div className="tabular-nums font-semibold text-blue-800">{currency(weekdayAmount)}</div>
                </div>
                <div className="rounded-md border bg-amber-50/60 p-3">
                  <div className="text-xs uppercase text-amber-700 font-semibold mb-1">Weekend (za-zo)</div>
                  <div className="tabular-nums text-gray-800">
                    {weekendEvents.length} events &middot; {kmFmt(weekendKm)} km
                  </div>
                  <div className="tabular-nums font-semibold text-amber-800">{currency(weekendAmount)}</div>
                </div>
              </div>
              {privateEvents.length > 0 ? (
                <div className="rounded-md border bg-purple-50/60 p-3 text-sm">
                  <div className="text-xs uppercase text-purple-700 font-semibold mb-1">Privé (niet gefactureerd)</div>
                  <div className="tabular-nums text-gray-800">
                    {privateEvents.length} events &middot; {kmFmt(privateKm)} km &middot; <span className="font-semibold text-purple-800">{currency(privateAmount)}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed bg-purple-50/30 p-3 text-sm">
                  <div className="text-xs uppercase text-purple-700 font-semibold mb-1">Privé (niet gefactureerd)</div>
                  <div className="tabular-nums text-gray-500">0 events &middot; 0 km &middot; € 0,00</div>
                </div>
              )}
            </>
          )
        })()}

        {loading ? (
          <div className="py-6 text-center text-gray-400">Laden…</div>
        ) : !data || data.events.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">
            Geen tolregels voor deze periode.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Startdatum</th>
                    <th className="text-left px-3 py-2">Einddatum</th>
                    <th className="text-right px-3 py-2">Afstand</th>
                    <th className="text-right px-3 py-2">Bedrag</th>
                    <th className="text-center px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageEvents.map(ev => {
                    const d = new Date(ev.start_at)
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6
                    const isPrivate = !!ev.is_private
                    const rowBg = isPrivate ? 'bg-purple-50/60' : (isWeekend ? 'bg-amber-50/40' : '')
                    return (
                    <tr key={ev.id} className={`hover:bg-gray-50 ${rowBg}`}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {dateFmt(ev.start_at)}
                        {isWeekend && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-medium uppercase">
                            weekend
                          </span>
                        )}
                        {isPrivate && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 font-medium uppercase">
                            privé
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{dateFmt(ev.end_at)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {Number(ev.distance_km).toLocaleString('nl-NL', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {currency(Number(ev.amount))}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {ev.invoiced ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                            Gefactureerd
                          </span>
                        ) : isPrivate ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                            Privé
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                            Open
                          </span>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 text-sm font-medium">
                  <tr>
                    <td className="px-3 py-2 text-right" colSpan={2}>Totaal (periode)</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(data.total_km).toLocaleString('nl-NL', { maximumFractionDigits: 3 })} km
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-primary-700">
                      {currency(data.total_amount)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-500">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.events.length)} van {data.events.length}
                </div>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1.5 border rounded hover:bg-white disabled:opacity-40"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <span className="px-2">Pagina {page} / {totalPages}</span>
                  <button
                    type="button"
                    className="p-1.5 border rounded hover:bg-white disabled:opacity-40"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {data.invoiced_count > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={unmark}
                  disabled={unmarking}
                  title="Zet de status voor deze maand terug naar 'niet gefactureerd'"
                >
                  <ArrowDownTrayIcon className="h-4 w-4 mr-1 rotate-180" />
                  {unmarking ? 'Bezig…' : 'Status → niet gefactureerd'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}

function MiniStat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-md border bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`font-semibold ${highlight ? 'text-primary-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  )
}
