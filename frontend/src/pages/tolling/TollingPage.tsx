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
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CurrencyEuroIcon,
  DocumentArrowDownIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PencilSquareIcon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import {
  RitnummerCorrectie,
  tollingApi,
  TollingInvoiceRow,
  TollingListPeriod,
  TollingSummary,
  TollingVehicleList,
  TollingVehicleRow,
} from '@/api/tolling'
import { getMailingContacts } from '@/api/companies'
import type { MailingListContact } from '@/types'
import ConfirmDialog, { ConfirmState } from '@/components/common/ConfirmDialog'
import CreateTollingInvoiceModal from '@/components/tolling/CreateTollingInvoiceModal'
import DachserExportModal from '@/components/tolling/DachserExportModal'
import RitnummerCorrectieDialog from '@/components/tolling/RitnummerCorrectieDialog'
import EmailProfileSelector from '@/components/EmailProfileSelector'

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
/** Alleen de datum, zonder tijd: 15-05-2026. */
function korteDatum(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nl-NL', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function companyKey(row: TollingVehicleRow): string {
  if (row.bedrijf_id) return `id:${row.bedrijf_id}`
  if (row.bedrijf_naam) return `name:${row.bedrijf_naam}`
  return '__none__'
}

function companyLabel(row: TollingVehicleRow): string {
  return row.bedrijf_naam || 'Zonder bedrijf'
}

/* ---------------------- periode-selectie ---------------------- */

const PERIOD_OPTIONS: { value: TollingListPeriod; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Maand' },
  { value: 'quarter', label: 'Kwartaal' },
  { value: 'year', label: 'Jaar' },
  { value: 'all', label: 'Alles' },
]

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Leesbare titel van de geselecteerde periode, bv. "Augustus 2026". */
function periodTitle(meta: TollingVehicleList | null, period: TollingListPeriod): string {
  if (period === 'all') return 'Alles tot nu toe'
  if (!meta) return '…'
  switch (period) {
    case 'week':
      return `Week ${String(meta.index).padStart(2, '0')} · ${meta.year}`
    case 'quarter':
      return `Kwartaal ${meta.index} · ${meta.year}`
    case 'year':
      return String(meta.year)
    default: {
      if (!meta.date_from) return String(meta.year)
      const d = new Date(`${meta.date_from}T00:00:00`)
      return capitalize(d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }))
    }
  }
}

/** Subtitel met het exacte datumbereik. */
function periodRange(meta: TollingVehicleList | null): string {
  if (!meta?.date_from || !meta?.date_to) return 'Alle geïmporteerde regels'
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('nl-NL', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  return `${fmt(meta.date_from)} t/m ${fmt(meta.date_to)}`
}

export default function TollingPage() {
  const [rows, setRows] = useState<TollingVehicleRow[]>([])
  const [meta, setMeta] = useState<TollingVehicleList | null>(null)
  const [period, setPeriod] = useState<TollingListPeriod>('month')
  const [offset, setOffset] = useState(0)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState<string[]>([])
  const [showMoreCompanies, setShowMoreCompanies] = useState(false)
  const [invoiceModalRow, setInvoiceModalRow] = useState<TollingVehicleRow | null>(null)
  const [invoicesRefresh, setInvoicesRefresh] = useState(0)
  const [dachserOpen, setDachserOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [deletingPlate, setDeletingPlate] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const askDeletePlate = (row: TollingVehicleRow) => {
    const delen = [row.plate_display]
    if (row.ritnummer) delen.push(`rit ${row.ritnummer}`)
    if (row.bedrijf_naam) delen.push(row.bedrijf_naam)
    const label = delen.length > 1
      ? `${row.plate_display} (${delen.slice(1).join(' · ')})`
      : row.plate_display
    setConfirmState({
      title: `Alle tolheffingen van ${label} verwijderen?`,
      message: (
        <span>
          Alle geïmporteerde tolheffing-events voor <strong>{label}</strong> worden
          definitief verwijderd. Gekoppelde factuurregels blijven bestaan maar verliezen hun
          onderliggende events. Deze actie kan niet ongedaan worden gemaakt.
        </span>
      ),
      confirmLabel: 'Verwijderen',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingPlate(row.row_key)
        try {
          const res = await tollingApi.deleteEventsForPlate(
            row.plate_normalized,
            row.ritnummer,
            row.bedrijf_id,
          )
          if (res.invoiced_deleted > 0) {
            toast.success(
              `${res.deleted} events verwijderd (${res.invoiced_deleted} waren gefactureerd, ${res.invoice_lines_affected} factuurregels aangepast).`,
              { duration: 6000 },
            )
          } else {
            toast.success(`${res.deleted} events verwijderd.`)
          }
          await reload()
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Verwijderen mislukt')
        } finally {
          setDeletingPlate(null)
        }
      },
    })
  }

  const askDeleteAll = () => {
    setConfirmState({
      title: 'ALLE tolheffingen verwijderen?',
      message: (
        <span>
          Je staat op het punt om <strong>alle geïmporteerde tolheffing-events</strong> te
          verwijderen — voor alle kentekens. Gekoppelde factuurregels blijven bestaan maar verliezen
          hun onderliggende events. Deze actie kan niet ongedaan worden gemaakt.
        </span>
      ),
      confirmLabel: 'Alles verwijderen',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingAll(true)
        try {
          const res = await tollingApi.deleteAllEvents()
          if (res.invoiced_deleted > 0) {
            toast.success(
              `${res.deleted} events verwijderd (${res.invoiced_deleted} waren gefactureerd, ${res.invoice_lines_affected} factuurregels aangepast).`,
              { duration: 6000 },
            )
          } else {
            toast.success(`${res.deleted} events verwijderd.`)
          }
          await reload()
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Verwijderen mislukt')
        } finally {
          setDeletingAll(false)
        }
      },
    })
  }

  const reload = async () => {
    setLoading(true)
    try {
      const data = await tollingApi.listVehicles({ period, offset })
      setMeta(data)
      setRows(data.rows)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon lijst niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [period, offset])

  const changePeriod = (value: TollingListPeriod) => {
    setPeriod(value)
    setOffset(0)
  }

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

  const companyRows = useMemo(() => {
    if (selectedCompanyKeys.length === 0) return rows
    const allowed = new Set(selectedCompanyKeys)
    return rows.filter(r => allowed.has(companyKey(r)))
  }, [rows, selectedCompanyKeys])

  /** Auto's zonder tolheffing in de gekozen periode worden standaard verborgen. */
  const filteredRows = useMemo(
    () => (hideEmpty ? companyRows.filter(r => r.period_events > 0) : companyRows),
    [companyRows, hideEmpty],
  )

  const emptyCount = companyRows.length - companyRows.filter(r => r.period_events > 0).length

  const totals = useMemo(() => {
    return companyRows.reduce(
      (acc, r) => ({
        vehicles: acc.vehicles + (r.period_events > 0 ? 1 : 0),
        km: acc.km + (r.period_km || 0),
        amount: acc.amount + (r.period_amount || 0),
      }),
      { vehicles: 0, km: 0, amount: 0 },
    )
  }, [companyRows])

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
        <div className="flex flex-wrap gap-2">
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
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-[#002060] px-3 py-2 text-sm font-medium text-white hover:bg-[#00184a]"
            onClick={() => setDachserOpen(true)}
            title="Exporteer tolheffing per bedrijf naar Excel"
          >
            <TableCellsIcon className="h-4 w-4 mr-1.5" />
            Exporteer per bedrijf
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
              onClick={askDeleteAll}
              disabled={deletingAll || loading}
              title="Verwijder alle geïmporteerde tolheffing-events"
            >
              <TrashIcon className="h-4 w-4 mr-1.5" />
              {deletingAll ? 'Bezig…' : 'Alles verwijderen'}
            </button>
          )}
        </div>
      </header>

      {/* Periode-selectie: week / maand / kwartaal / jaar / alles + navigatie */}
      <section className="rounded-lg border bg-white px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-gray-500 uppercase mr-0.5">Periode:</span>
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => changePeriod(opt.value)}
              className={`px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                period === opt.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOffset(o => o - 1)}
            disabled={period === 'all' || loading}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Vorige periode"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 sm:flex-none sm:min-w-[16rem] text-center sm:text-left">
            <div className="text-sm font-semibold text-gray-900">
              {periodTitle(meta, period)}
            </div>
            <div className="text-xs text-gray-500">{periodRange(meta)}</div>
          </div>
          <button
            type="button"
            onClick={() => setOffset(o => o + 1)}
            disabled={period === 'all' || loading}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Volgende periode"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          {offset !== 0 && period !== 'all' && (
            <button
              type="button"
              onClick={() => setOffset(0)}
              className="px-2 py-1 rounded-lg text-xs font-medium text-primary-700 hover:bg-primary-50"
            >
              Naar nu
            </button>
          )}
          {emptyCount > 0 && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={!hideEmpty}
                onChange={e => setHideEmpty(!e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              Toon ook {emptyCount} auto{emptyCount === 1 ? '' : "'s"} zonder tolheffing
            </label>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Auto's met events" value={String(totals.vehicles)} />
        <StatCard label={`KM ${periodTitle(meta, period).toLowerCase()}`} value={kmFmt(totals.km)} />
        <StatCard
          label={`Bedrag ${periodTitle(meta, period).toLowerCase()}`}
          value={currency(totals.amount)}
        />
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
          Geen tolheffing gevonden voor <strong>{periodTitle(meta, period)}</strong>
          {selectedCompanyKeys.length > 0 && ' bij de geselecteerde bedrijven'}.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRows.map(row => (
            <VehicleRow
              key={row.row_key}
              row={row}
              periodLabel={periodTitle(meta, period)}
              open={!!expanded[row.row_key]}
              onToggle={() =>
                setExpanded(prev => ({ ...prev, [row.row_key]: !prev[row.row_key] }))
              }
              onCreateInvoice={() => setInvoiceModalRow(row)}
              onDelete={() => askDeletePlate(row)}
              deleting={deletingPlate === row.row_key}
            />
          ))}
        </div>
      )}

      <TollingInvoicesSection refreshKey={invoicesRefresh} />

      {invoiceModalRow && (
        <CreateTollingInvoiceModal
          isOpen={!!invoiceModalRow}
          row={invoiceModalRow}
          onClose={() => setInvoiceModalRow(null)}
          onCreated={() => {
            setInvoiceModalRow(null)
            setInvoicesRefresh(n => n + 1)
            reload()
          }}
        />
      )}

      <DachserExportModal isOpen={dachserOpen} onClose={() => setDachserOpen(false)} />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Overzicht van facturen die via de knop "Factuur" zijn aangemaakt.
 * Mobiel = kaarten, desktop = tabel. Per factuur kan een creditfactuur
 * worden gemaakt (met een nummer uit de credit-nummerreeks).
 * ------------------------------------------------------------------ */
function invoiceStatusClass(status: string): string {
  switch (status) {
    case 'concept': return 'bg-gray-100 text-gray-700'
    case 'definitief': return 'bg-blue-100 text-blue-700'
    case 'verzonden': return 'bg-indigo-100 text-indigo-700'
    case 'betaald': return 'bg-green-100 text-green-700'
    case 'vervallen': return 'bg-red-100 text-red-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function dateOnlyFmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('nl-NL', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function TollingInvoicesSection({ refreshKey }: { refreshKey: number }) {
  const [invoices, setInvoices] = useState<TollingInvoiceRow[]>([])
  const [loadingInvoices, setLoadingInvoices] = useState(true)
  const [creditingId, setCreditingId] = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = async () => {
    setLoadingInvoices(true)
    try {
      setInvoices(await tollingApi.listInvoices({ limit: 200 }))
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon facturen niet laden')
    } finally {
      setLoadingInvoices(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [refreshKey])

  const createCredit = async (inv: TollingInvoiceRow, force = false) => {
    setCreditingId(inv.id)
    try {
      const res = await tollingApi.createCreditInvoice({ invoice_id: inv.id, force })
      toast.success(`Creditfactuur ${res.factuurnummer} aangemaakt voor ${inv.factuurnummer}.`)
      await load()
    } catch (e: any) {
      if (e?.response?.status === 409) {
        const detail = e.response.data?.detail || 'Er bestaat al een creditfactuur.'
        setConfirmState({
          title: 'Toch nog een creditfactuur maken?',
          message: <span>{detail}</span>,
          confirmLabel: 'Ja, aanmaken',
          variant: 'danger',
          onConfirm: async () => { await createCredit(inv, true) },
        })
      } else {
        toast.error(e?.response?.data?.detail || 'Creditfactuur maken mislukt')
      }
    } finally {
      setCreditingId(null)
    }
  }

  const askCredit = (inv: TollingInvoiceRow) => {
    setConfirmState({
      title: `Creditfactuur maken voor ${inv.factuurnummer}?`,
      message: (
        <span>
          Er wordt een nieuwe creditfactuur aangemaakt met een eigen nummer uit de
          credit-nummerreeks. Alle regels van <strong>{inv.factuurnummer}</strong> worden
          gekopieerd en negatief geboekt.
        </span>
      ),
      confirmLabel: 'Creditfactuur maken',
      onConfirm: async () => { await createCredit(inv) },
    })
  }

  const visible = showAll ? invoices : invoices.slice(0, 10)

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Gemaakte facturen</h2>
          <p className="text-xs text-gray-500">Facturen die via de knop “Factuur” zijn aangemaakt.</p>
        </div>
        <button
          onClick={load}
          disabled={loadingInvoices}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loadingInvoices ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Vernieuwen</span>
        </button>
      </div>

      {loadingInvoices ? (
        <div className="p-6 text-center text-sm text-gray-500">Laden…</div>
      ) : invoices.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          Nog geen facturen vanuit tolheffing aangemaakt.
        </div>
      ) : (
        <>
          {/* Mobiel: kaarten */}
          <ul className="sm:hidden divide-y">
            {visible.map(inv => (
              <li key={inv.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900">{inv.factuurnummer}</span>
                      {inv.type === 'credit' && (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                          Credit
                        </span>
                      )}
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${invoiceStatusClass(inv.status)}`}>
                        {inv.status}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-600">
                      {inv.bedrijf_naam || 'Zonder bedrijf'}
                    </div>
                  </div>
                  <div className={`shrink-0 text-right text-sm font-semibold ${inv.totaal < 0 ? 'text-orange-600' : 'text-gray-900'}`}>
                    {currency(inv.totaal)}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                  <span>{dateOnlyFmt(inv.factuurdatum)}</span>
                  {inv.plates.length > 0 && <span>{inv.plates.join(', ')}</span>}
                  {inv.weeks.length > 0 && <span>{inv.weeks.join(', ')}</span>}
                </div>

                {inv.credit_of && (
                  <div className="mt-1 text-[11px] text-orange-600">
                    Credit van {inv.credit_of.factuurnummer}
                  </div>
                )}
                {inv.credits.length > 0 && (
                  <div className="mt-1 text-[11px] text-gray-600">
                    Gecrediteerd: {inv.credits.map(c => c.factuurnummer).join(', ')}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Link
                    to={`/invoices/${inv.id}/edit`}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                    Openen
                  </Link>
                  {inv.type !== 'credit' && (
                    <button
                      onClick={() => askCredit(inv)}
                      disabled={creditingId === inv.id}
                      className="inline-flex items-center gap-1 rounded-md border border-orange-300 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                      {creditingId === inv.id ? 'Bezig…' : 'Creditfactuur'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: tabel */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Factuur</th>
                  <th className="px-4 py-2 text-left">Bedrijf</th>
                  <th className="px-4 py-2 text-left">Kenteken(s)</th>
                  <th className="px-4 py-2 text-left">Periode</th>
                  <th className="px-4 py-2 text-left">Datum</th>
                  <th className="px-4 py-2 text-right">Totaal</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900">{inv.factuurnummer}</span>
                        {inv.type === 'credit' && (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                            Credit
                          </span>
                        )}
                      </div>
                      {inv.credit_of && (
                        <div className="text-[11px] text-orange-600">van {inv.credit_of.factuurnummer}</div>
                      )}
                      {inv.credits.length > 0 && (
                        <div className="text-[11px] text-gray-500">
                          gecrediteerd: {inv.credits.map(c => c.factuurnummer).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{inv.bedrijf_naam || '—'}</td>
                    <td className="px-4 py-2 text-gray-700">{inv.plates.join(', ') || '—'}</td>
                    <td className="px-4 py-2 text-gray-700">{inv.weeks.join(', ') || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">{dateOnlyFmt(inv.factuurdatum)}</td>
                    <td className={`whitespace-nowrap px-4 py-2 text-right font-medium ${inv.totaal < 0 ? 'text-orange-600' : 'text-gray-900'}`}>
                      {currency(inv.totaal)}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${invoiceStatusClass(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/invoices/${inv.id}/edit`}
                          className="rounded p-1.5 text-gray-600 hover:bg-gray-100"
                          title="Factuur openen"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </Link>
                        {inv.type !== 'credit' && (
                          <button
                            onClick={() => askCredit(inv)}
                            disabled={creditingId === inv.id}
                            className="inline-flex items-center gap-1 rounded-md border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                            title="Creditfactuur maken"
                          >
                            <ArrowUturnLeftIcon className="h-4 w-4" />
                            {creditingId === inv.id ? 'Bezig…' : 'Credit'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invoices.length > visible.length && (
            <div className="border-t px-4 py-2 text-center">
              <button
                onClick={() => setShowAll(true)}
                className="text-xs font-medium text-primary-600 hover:underline"
              >
                Toon alle {invoices.length} facturen
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </section>
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
  periodLabel: string
  open: boolean
  onToggle: () => void
  onCreateInvoice: () => void
  onDelete: () => void
  deleting: boolean
}

function VehicleRow({ row, periodLabel, open, onToggle, onCreateInvoice, onDelete, deleting }: VehicleRowProps) {
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
              {row.ritnummer ? (
                <span
                  className={
                    row.is_actueel
                      ? 'text-xs font-medium uppercase tracking-wide text-gray-700 bg-gray-100 rounded px-1.5 py-0.5'
                      : 'text-xs font-medium uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5'
                  }
                  title={
                    row.is_actueel
                      ? 'Huidig ritnummer van deze wagen'
                      : `Eerder ritnummer. Deze wagen rijdt nu op ${row.huidig_ritnummer || 'geen ritnummer'}.`
                  }
                >
                  Rit {row.ritnummer}
                  {!row.is_actueel && ' · eerder'}
                </span>
              ) : (
                <span className="text-xs uppercase tracking-wide text-gray-400">
                  Geen ritnummer
                </span>
              )}
              {row.bedrijf_naam && (
                <span
                  className={
                    row.is_actueel_bedrijf === false
                      ? 'text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5'
                      : 'text-xs text-primary-700 bg-primary-50 rounded px-1.5 py-0.5'
                  }
                  title={
                    row.is_actueel_bedrijf === false
                      ? `Eerder bedrijf. Deze wagen rijdt nu voor ${row.huidig_bedrijf_naam || 'geen bedrijf'}.`
                      : 'Huidig bedrijf van deze wagen'
                  }
                >
                  {row.bedrijf_naam}
                  {row.is_actueel_bedrijf === false && ' · eerder'}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {periodLabel}: {kmFmt(row.period_km)} · {currency(row.period_amount)}
              {row.period_events > 0 && (
                <span className="text-gray-400"> · {row.period_events} regels</span>
              )}
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
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="hidden sm:inline-flex items-center justify-center px-3 border-l border-gray-200 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-50"
          title="Alle tolheffingen van dit voertuig verwijderen"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="sm:hidden border-t border-gray-100 grid grid-cols-2 divide-x divide-gray-100">
        <button
          type="button"
          onClick={onCreateInvoice}
          className="inline-flex items-center justify-center gap-1.5 py-2 text-sm text-primary-700 hover:bg-primary-50"
        >
          <DocumentTextIcon className="h-4 w-4" />
          Factuur
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center justify-center gap-1.5 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <TrashIcon className="h-4 w-4" />
          Verwijderen
        </button>
      </div>
      {open && (
        <VehicleDetail
          plate={row.plate_normalized}
          plateDisplay={row.plate_display}
          bedrijfId={row.bedrijf_id}
          ritnummer={row.ritnummer}
        />
      )}
    </div>
  )
}

interface VehicleDetailProps {
  plate: string
  plateDisplay: string
  bedrijfId: string | null
  /** Beperk het detail tot dit ritnummer (momentopname bij import). */
  ritnummer: string
}

function VehicleDetail({ plate, plateDisplay, bedrijfId, ritnummer }: VehicleDetailProps) {
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [offset, setOffset] = useState(0)
  // Standaard het ritnummer van de aangeklikte regel; null = alle ritnummers.
  const [ritFilter, setRitFilter] = useState<string | null>(ritnummer)
  // Standaard het bedrijf van de aangeklikte regel; null = alle bedrijven.
  const [bedrijfFilter, setBedrijfFilter] = useState<string | null>(bedrijfId)
  const [data, setData] = useState<TollingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<null | 'xlsx' | 'pdf'>(null)
  const [unmarking, setUnmarking] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [emailModal, setEmailModal] = useState<null | { fmt: 'pdf' | 'xlsx' }>(null)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailProfileId, setEmailProfileId] = useState<string>('')
  const [emailSending, setEmailSending] = useState(false)
  const [mailingContacts, setMailingContacts] = useState<MailingListContact[]>([])
  const [selectedContactEmails, setSelectedContactEmails] = useState<Set<string>>(new Set())
  // Dialoog om het ritnummer van bestaande tolregels alsnog te corrigeren.
  const [correctieOpen, setCorrectieOpen] = useState(false)
  // Uitgevoerde ritnummercorrecties van de afgelopen maand, om terug te draaien.
  const [correcties, setCorrecties] = useState<RitnummerCorrectie[]>([])
  const [historieOpen, setHistorieOpen] = useState(false)
  const [ongedaanBezig, setOngedaanBezig] = useState<string | null>(null)

  const laadCorrecties = async () => {
    try {
      setCorrecties(await tollingApi.getRitnummerCorrecties(plate))
    } catch {
      // De historie is bijzaak; een fout hier mag het overzicht niet blokkeren.
      setCorrecties([])
    }
  }

  const maakOngedaan = async (correctie: RitnummerCorrectie) => {
    setOngedaanBezig(correctie.id)
    try {
      const r = await tollingApi.maakRitnummerCorrectieOngedaan(plate, correctie.id)
      toast.success(
        r.overgeslagen > 0
          ? `${r.teruggezet} regel(s) teruggezet, ${r.overgeslagen} overgeslagen omdat er later nog een wijziging overheen ging`
          : `${r.teruggezet} regel(s) teruggezet`,
      )
      await laadCorrecties()
      // Stond het filter op het ritnummer dat we net hebben teruggedraaid, dan
      // zou het scherm nu leeg lijken. Schuif het filter mee terug.
      if (ritFilter !== null && ritFilter === correctie.naar_ritnummer) {
        setRitFilter(correctie.van_ritnummer || null)
      } else {
        await load()
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Terugdraaien mislukt')
    } finally {
      setOngedaanBezig(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const s = await tollingApi.summary(plate, {
        period,
        offset,
        // Parameter weglaten = alle ritnummers van deze wagen.
        ...(ritFilter === null ? {} : { ritnummer: ritFilter }),
        // Idem voor het bedrijf waarvoor de wagen toen reed.
        ...(bedrijfFilter === null ? {} : { bedrijf_id: bedrijfFilter }),
      })
      setData(s)
      setPage(1)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon overzicht niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [plate, period, offset, ritFilter, bedrijfFilter])

  useEffect(() => { laadCorrecties() /* eslint-disable-next-line */ }, [plate])

  const totalPages = data ? Math.max(1, Math.ceil(data.events.length / PAGE_SIZE)) : 1
  const pageEvents = data ? data.events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []

  const download = async (fmt: 'xlsx' | 'pdf') => {
    setExporting(fmt)
    try {
      const blob = await tollingApi.downloadExport(plate, {
        period,
        offset,
        format: fmt,
        ...(ritFilter === null ? {} : { ritnummer: ritFilter }),
        ...(bedrijfFilter === null ? {} : { bedrijf_id: bedrijfFilter }),
      })
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
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!data) return
                setEmailRecipients('')
                setEmailSubject(`Tolheffing overzicht ${plateDisplay} — ${data.label}`)
                setEmailBody(
                  `Beste,\n\nIn de bijlage vind je het tolheffing overzicht voor ${plateDisplay} (${data.label}).\n\nMet vriendelijke groet,`
                )
                setEmailProfileId('')
                setSelectedContactEmails(new Set())
                setEmailModal({ fmt: 'pdf' })
                if (bedrijfId) {
                  getMailingContacts(bedrijfId)
                    .then(cs => setMailingContacts(cs.filter(c => c.is_active)))
                    .catch(() => setMailingContacts([]))
                } else {
                  setMailingContacts([])
                }
              }}
              disabled={!data || data.events.length === 0}
              title="Overzicht mailen"
            >
              <EnvelopeIcon className="h-4 w-4 mr-1" />
              Mail
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

        {/* Ritnummerfilter: welke ritten heeft deze wagen in de periode gereden? */}
        {data && data.ritnummers.length > 0 && (data.ritnummers.length > 1 || ritFilter !== null) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Ritnummer</span>
            <button
              type="button"
              onClick={() => setRitFilter(null)}
              className={`px-2 py-1 rounded text-xs font-medium border ${
                ritFilter === null
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Alle ({data.ritnummers.reduce((s, r) => s + r.events_count, 0)})
            </button>
            {data.ritnummers.map(r => (
              <button
                key={r.ritnummer || '(leeg)'}
                type="button"
                onClick={() => setRitFilter(r.ritnummer)}
                className={`px-2 py-1 rounded text-xs font-medium border ${
                  ritFilter === r.ritnummer
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                title={`${kmFmt(r.total_km)} km · ${currency(r.total_amount)}`}
              >
                {r.ritnummer || 'Geen ritnummer'} ({r.events_count})
              </button>
            ))}
          </div>
        )}

        {/* Bedrijfsfilter: voor welk bedrijf reed deze wagen in de periode? */}
        {data && data.bedrijven && data.bedrijven.length > 0
          && (data.bedrijven.length > 1 || bedrijfFilter !== null) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">Bedrijf</span>
            <button
              type="button"
              onClick={() => setBedrijfFilter(null)}
              className={`px-2 py-1 rounded text-xs font-medium border ${
                bedrijfFilter === null
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Alle ({data.bedrijven.reduce((s, b) => s + b.events_count, 0)})
            </button>
            {data.bedrijven.map(b => (
              <button
                key={b.bedrijf_id || '(leeg)'}
                type="button"
                onClick={() => setBedrijfFilter(b.bedrijf_id)}
                disabled={!b.bedrijf_id}
                className={`px-2 py-1 rounded text-xs font-medium border ${
                  bedrijfFilter === b.bedrijf_id
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                } disabled:opacity-60`}
                title={`${kmFmt(b.total_km)} km · ${currency(b.total_amount)}`}
              >
                {b.bedrijf_naam || 'Geen bedrijf'} ({b.events_count})
              </button>
            ))}
          </div>
        )}

        {/* Ritnummer van de getoonde regels alsnog corrigeren. */}
        {data && data.events.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setCorrectieOpen(true)}
              className="text-xs font-medium text-primary-700 underline hover:text-primary-900"
            >
              Ritnummer terugwerkend corrigeren…
            </button>
            {correcties.length > 0 && (
              <button
                type="button"
                onClick={() => setHistorieOpen(o => !o)}
                className="text-xs font-medium text-gray-600 underline hover:text-gray-900"
              >
                {historieOpen
                  ? 'Recente wijzigingen verbergen'
                  : `Recente wijzigingen (${correcties.length})`}
              </button>
            )}
          </div>
        )}

        {/* Uitgevoerde correcties, met de mogelijkheid ze terug te draaien. */}
        {historieOpen && correcties.length > 0 && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs text-gray-500">
              Wijzigingen van de afgelopen maand. Daarna worden ze opgeruimd en kunnen
              ze niet meer teruggedraaid worden.
            </p>
            <ul className="divide-y divide-gray-200">
              {correcties.map(cor => (
                <li key={cor.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">
                      {cor.aantal} regel(s) → ritnummer {cor.naar_ritnummer}
                    </span>
                    <span className="text-gray-500">
                      {' '}· {korteDatum(cor.van)} t/m {korteDatum(cor.tot)}
                      {cor.van_ritnummer ? ` · alleen ${cor.van_ritnummer}` : ''}
                    </span>
                    <div className="text-gray-500">
                      {new Date(cor.uitgevoerd_op).toLocaleString('nl-NL')}
                      {cor.uitgevoerd_door ? ` · ${cor.uitgevoerd_door}` : ''}
                    </div>
                  </div>
                  {cor.teruggedraaid_op ? (
                    <span className="text-xs text-gray-500">
                      Teruggedraaid ({cor.teruggedraaid_aantal} regels)
                      {cor.teruggedraaid_door ? ` door ${cor.teruggedraaid_door}` : ''}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={ongedaanBezig === cor.id}
                      onClick={() => maakOngedaan(cor)}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      {ongedaanBezig === cor.id ? 'Bezig…' : 'Ongedaan maken'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                    <th className="text-left px-3 py-2">Ritnummer</th>
                    <th className="text-left px-3 py-2">Bedrijf</th>
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
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {ev.ritnummer ? (
                          <button
                            type="button"
                            onClick={() => setRitFilter(ev.ritnummer)}
                            className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-primary-100 hover:text-primary-800"
                            title={`Alleen ritnummer ${ev.ritnummer} tonen`}
                          >
                            {ev.ritnummer}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {ev.bedrijf_naam ? (
                          <button
                            type="button"
                            onClick={() => setBedrijfFilter(ev.bedrijf)}
                            className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-primary-100 hover:text-primary-800"
                            title={`Alleen ${ev.bedrijf_naam} tonen`}
                          >
                            {ev.bedrijf_naam}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
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
                    <td className="px-3 py-2 text-right" colSpan={4}>Totaal (periode)</td>
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
      <RitnummerCorrectieDialog
        isOpen={correctieOpen}
        onClose={() => setCorrectieOpen(false)}
        plate={plate}
        plateDisplay={plateDisplay}
        standaardVan={data?.start?.slice(0, 10) || ''}
        standaardTot={
          // data.end is exclusief; toon de laatste dag van de periode.
          data?.end
            ? new Date(new Date(data.end).getTime() - 86400000).toLocaleDateString('sv-SE')
            : ''
        }
        huidigRitnummer={ritFilter}
        voorstelRitnummer={ritFilter || ''}
        bekendeRitnummers={(data?.ritnummers || []).map(r => r.ritnummer).filter(Boolean)}
        onGewijzigd={(resultaat) => {
          laadCorrecties()
          // Stond er een filter op het oude ritnummer, dan zou het scherm nu
          // leeg lijken. Schuif het filter mee naar het nieuwe ritnummer.
          if (ritFilter !== null && ritFilter !== resultaat.naar_ritnummer) {
            setRitFilter(resultaat.naar_ritnummer)
          } else {
            load()
          }
        }}
      />
      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-base font-semibold text-gray-900">
                Tolheffing overzicht mailen
              </h3>
              <button
                type="button"
                className="p-1 text-gray-500 hover:text-gray-800"
                onClick={() => setEmailModal(null)}
                disabled={emailSending}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Bijlage</label>
                <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
                  {(['pdf', 'xlsx'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setEmailModal({ fmt: f })}
                      className={`px-3 py-1.5 text-sm ${
                        emailModal.fmt === f
                          ? 'bg-primary-600 text-white'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Ontvangers uit mailinglijst
                </label>
                {mailingContacts.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">
                    {bedrijfId
                      ? 'Geen actieve contacten in de mailinglijst van dit bedrijf.'
                      : 'Geen bedrijf gekoppeld aan dit kenteken.'}
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2 space-y-1">
                    {mailingContacts.map(c => {
                      const checked = selectedContactEmails.has(c.email)
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white rounded px-1 py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedContactEmails(prev => {
                                const next = new Set(prev)
                                if (next.has(c.email)) next.delete(c.email)
                                else next.add(c.email)
                                return next
                              })
                            }}
                          />
                          <span className="font-medium text-gray-900">{c.naam}</span>
                          <span className="text-gray-500">&lt;{c.email}&gt;</span>
                          {c.functie && (
                            <span className="text-xs text-gray-400">— {c.functie}</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Extra ontvangers (komma-gescheiden)
                </label>
                <input
                  type="text"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  value={emailRecipients}
                  onChange={e => setEmailRecipients(e.target.value)}
                  placeholder="naam@bedrijf.nl, ander@voorbeeld.nl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Onderwerp</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Bericht</label>
                <textarea
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  rows={5}
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Mailprofiel (optioneel)
                </label>
                <EmailProfileSelector
                  value={emailProfileId}
                  onChange={setEmailProfileId}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEmailModal(null)}
                disabled={emailSending}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  const manual = emailRecipients
                    .split(/[;,]/)
                    .map(s => s.trim())
                    .filter(Boolean)
                  const recipients = Array.from(
                    new Set<string>([...selectedContactEmails, ...manual]),
                  )
                  if (recipients.length === 0) {
                    toast.error('Vul minstens één e-mailadres in of kies een contact.')
                    return
                  }
                  setEmailSending(true)
                  try {
                    const r = await tollingApi.emailExport(plate, {
                      recipients,
                      subject: emailSubject,
                      body: emailBody,
                      fmt: emailModal.fmt,
                      period,
                      offset,
                      ...(ritFilter === null ? {} : { ritnummer: ritFilter }),
                      email_profile_id: emailProfileId || undefined,
                    })
                    toast.success(`Mail verzonden naar ${r.recipients.length} ontvanger(s).`)
                    setEmailModal(null)
                  } catch (e: any) {
                    toast.error(e?.response?.data?.detail || 'Mail versturen mislukt')
                  } finally {
                    setEmailSending(false)
                  }
                }}
                disabled={emailSending}
              >
                {emailSending ? 'Versturen…' : 'Verstuur'}
              </button>
            </div>
          </div>
        </div>
      )}
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
