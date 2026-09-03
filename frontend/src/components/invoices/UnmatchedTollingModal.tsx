/**
 * Modal die na een strikte tolheffing-match (op begin/eindtijd rit) een lijst
 * toont van tol-events die BUITEN de rit-tijden vielen. De gebruiker kan
 * kiezen om alleen de binnen-tijden events te factureren, of ook de events
 * buiten de tijden mee te nemen.
 */
import { Fragment, useMemo, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  XMarkIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

export interface UnmatchedEvent {
  id: string
  plate_display: string
  plate_normalized: string
  /** Ritnummer dat voor die dag in de urenregistratie staat. */
  dag_ritnummer?: string
  /** Ritnummer dat aan het tol-event zelf hangt. */
  ritnummer?: string
  start_at: string
  end_at: string | null
  distance_km: number
  amount: number
  obu: string
  reason: 'outside_time_range' | 'no_range_for_plate' | 'ander_ritnummer'
}

/** Een rit waarvoor helemaal geen tol is opgehaald. */
export interface SkippedRange {
  plate: string
  plate_normalized: string
  date: string
  start_time: string | null
  end_time: string | null
  reason: 'missing_time'
}

export interface MatchedEventDetail {
  id: string
  /** Ritnummer dat voor die dag in de urenregistratie staat. */
  dag_ritnummer?: string
  start_at: string
  end_at: string | null
  distance_km: number
  amount: number
  obu: string
}

export interface MatchedTollingRow {
  plate_normalized: string
  plate_display: string
  ritnummer: string | null
  /** Alle ritnummers uit de uren die bij deze regels horen. */
  dag_ritnummers?: string[]
  total_km: number
  total_amount: number
  events_count: number
  event_ids?: string[]
  events?: MatchedEventDetail[]
}

interface Props {
  open: boolean
  onClose: () => void
  matched: MatchedTollingRow[]
  unmatched: UnmatchedEvent[]
  /** Ritten waarvoor geen tol is opgehaald, bv. door ontbrekende tijden. */
  skipped?: SkippedRange[]
  bufferMinutes: number
  /** Alleen binnen tijden factureren (aanbevolen). */
  onConfirmStrict: () => void
  /** Ook alle events buiten tijden meenemen. */
  onConfirmIncludeAll: () => void
  /** Totaal geregistreerde km op de factuur (uit de rit-regels). Optioneel. */
  totalRegisteredKm?: number
}

const fmtMoney = (n: number) =>
  `€ ${n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtKm = (n: number) =>
  `${n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Uitleg per reden waarom een event niet automatisch is meegenomen. */
const redenTekst = (reden: UnmatchedEvent['reason']): string => {
  if (reden === 'no_range_for_plate') return 'Geen rit voor kenteken'
  if (reden === 'ander_ritnummer') return 'Ander ritnummer'
  return 'Buiten begin/eindtijd'
}

/** Zaterdag of zondag, in de tijdzone van de browser. */
const isWeekend = (iso: string): boolean => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const dag = d.getDay()
  return dag === 0 || dag === 6
}

const WeekendLabel = () => (
  <span className="ml-1 inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">
    Weekend
  </span>
)

export default function UnmatchedTollingModal({
  open,
  onClose,
  matched,
  unmatched,
  skipped = [],
  bufferMinutes,
  onConfirmStrict,
  onConfirmIncludeAll,
  totalRegisteredKm,
}: Props) {
  const matchedTotals = useMemo(() => {
    const km = matched.reduce((s, r) => s + (r.total_km || 0), 0)
    const amount = matched.reduce((s, r) => s + (r.total_amount || 0), 0)
    const count = matched.reduce((s, r) => s + (r.events_count || 0), 0)
    return { km, amount, count }
  }, [matched])

  const unmatchedTotals = useMemo(() => {
    const km = unmatched.reduce((s, u) => s + (u.distance_km || 0), 0)
    const amount = unmatched.reduce((s, u) => s + (u.amount || 0), 0)
    return { km, amount, count: unmatched.length }
  }, [unmatched])

  // Tol in het weekend springt er apart uit: dat wordt lang niet altijd
  // doorbelast, dus de gebruiker moet het los kunnen zien.
  const weekendTotals = useMemo(() => {
    const regels = unmatched.filter(u => isWeekend(u.start_at))
    return {
      count: regels.length,
      km: regels.reduce((s, u) => s + (u.distance_km || 0), 0),
      amount: regels.reduce((s, u) => s + (u.amount || 0), 0),
    }
  }, [unmatched])

  const hasMatched = matched.length > 0
  const hasUnmatched = unmatched.length > 0
  const hasSkipped = skipped.length > 0

  // Flat list met per-event details voor de "Details"-tab.
  const matchedEventDetails = useMemo(() => {
    const rows: Array<{
      plate_display: string
      ritnummer: string | null
      start_at: string
      end_at: string | null
      distance_km: number
      amount: number
      obu: string
    }> = []
    for (const r of matched) {
      if (!r.events || r.events.length === 0) continue
      for (const e of r.events) {
        rows.push({
          plate_display: r.plate_display,
          // Het ritnummer van die dag uit de uren; anders dat van de wagen.
          ritnummer: e.dag_ritnummer || r.ritnummer,
          start_at: e.start_at,
          end_at: e.end_at,
          distance_km: e.distance_km,
          amount: e.amount,
          obu: e.obu,
        })
      }
    }
    rows.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return rows
  }, [matched])

  /**
   * Unieke ritnummers van alle dagen samen. De backend levert per dag een
   * label dat zelf al meerdere nummers kan bevatten ("A / B"), dus die halen
   * we eerst uit elkaar voordat we ontdubbelen en afkappen.
   */
  const ritNummers = (r: MatchedTollingRow): string[] => {
    const uniek: string[] = []
    for (const label of r.dag_ritnummers || []) {
      for (const nummer of label.split(' / ')) {
        const schoon = nummer.trim()
        if (schoon && !uniek.includes(schoon)) uniek.push(schoon)
      }
    }
    return uniek
  }

  /** Ritnummers uit de uren, met terugval op het ritnummer van de wagen. */
  const ritLabel = (r: MatchedTollingRow): string => {
    const nummers = ritNummers(r)
    if (nummers.length === 0) return r.ritnummer || '—'
    if (nummers.length <= 3) return nummers.join(' / ')
    return `${nummers.slice(0, 3).join(' / ')} +${nummers.length - 3}`
  }

  /** Volledige lijst voor de tooltip, zodat niets verloren gaat. */
  const ritTitel = (r: MatchedTollingRow): string =>
    ritNummers(r).join(' / ') || r.ritnummer || ''

  const hasEventDetails = matchedEventDetails.length > 0
  const [tab, setTab] = useState<'overview' | 'details'>('overview')

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-[100]" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col max-h-[92vh] sm:max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gradient-to-r from-primary-50 to-white px-4 sm:px-5 py-3 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {hasUnmatched || hasSkipped ? (
                      <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />
                    )}
                    <Dialog.Title className="text-sm sm:text-base font-semibold text-gray-900">
                      {hasUnmatched || hasSkipped
                        ? 'Tolheffing gevonden — controleer de aandachtspunten'
                        : 'Tolheffing gevonden — controleer koppeling'}
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Sluiten"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Tabs */}
                {hasEventDetails && (
                  <div className="border-b border-gray-200 bg-white px-4 sm:px-5 shrink-0">
                    <nav className="-mb-px flex gap-4" aria-label="Tabs">
                      <button
                        type="button"
                        onClick={() => setTab('overview')}
                        className={`whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                          tab === 'overview'
                            ? 'border-primary-600 text-primary-700'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }`}
                      >
                        Overzicht
                      </button>
                      <button
                        type="button"
                        onClick={() => setTab('details')}
                        className={`whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                          tab === 'details'
                            ? 'border-primary-600 text-primary-700'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }`}
                      >
                        Details
                        <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                          {matchedEventDetails.length}
                        </span>
                      </button>
                    </nav>
                  </div>
                )}

                {/* Body */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
                  {tab === 'overview' && (
                    <>
                  <p className="text-sm text-gray-600">
                    De tolheffing is strikt gematcht op de begin- en eindtijd van elke rit
                    {bufferMinutes > 0 && (
                      <span className="text-gray-500"> (± {bufferMinutes} min buffer)</span>
                    )}.
                    {hasUnmatched
                      ? ' Kies hieronder wat er op de factuur moet komen.'
                      : ' Alle events vielen binnen de ritranges. Bevestig hieronder om ze aan de factuur toe te voegen.'}
                  </p>

                  {/* Samenvatting binnen tijden */}
                  {hasMatched && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                        <h3 className="text-sm font-semibold text-emerald-900">
                          Binnen rit-tijden ({matchedTotals.count} event{matchedTotals.count === 1 ? '' : 's'})
                        </h3>
                      </div>
                      <div className="overflow-hidden rounded border border-emerald-200 bg-white">
                        {/* Mobile: card list */}
                        <div className="sm:hidden divide-y divide-emerald-100">
                          {matched.map(r => (
                            <div key={r.plate_normalized} className="p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900">{r.plate_display}</span>
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmtMoney(r.total_amount)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-gray-600">
                                <span className="truncate" title={ritTitel(r)}>Rit {ritLabel(r)} · {r.events_count} events</span>
                                <span className="tabular-nums">{fmtKm(r.total_km)}</span>
                              </div>
                            </div>
                          ))}
                          <div className="bg-emerald-50 p-2.5">
                            <div className="flex items-center justify-between gap-2 text-sm font-semibold text-emerald-900">
                              <span>Totaal ({matchedTotals.count})</span>
                              <span className="tabular-nums">{fmtMoney(matchedTotals.amount)}</span>
                            </div>
                            <div className="mt-0.5 text-right text-[11px] text-emerald-800 tabular-nums">
                              {fmtKm(matchedTotals.km)}
                            </div>
                          </div>
                        </div>

                        {/* Desktop: table */}
                        <table className="hidden sm:table min-w-full text-xs">
                          <thead className="bg-emerald-100 text-emerald-900">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-semibold">Kenteken</th>
                              <th className="px-3 py-1.5 text-left font-semibold">Ritnummer</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Events</th>
                              <th className="px-3 py-1.5 text-right font-semibold">KM</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Bedrag</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100">
                            {matched.map(r => (
                              <tr key={r.plate_normalized}>
                                <td className="px-3 py-1.5 font-medium text-gray-900">{r.plate_display}</td>
                                <td className="px-3 py-1.5 text-gray-700" title={ritTitel(r)}>{ritLabel(r)}</td>
                                <td className="px-3 py-1.5 text-right text-gray-700">{r.events_count}</td>
                                <td className="px-3 py-1.5 text-right text-gray-700">{fmtKm(r.total_km)}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{fmtMoney(r.total_amount)}</td>
                              </tr>
                            ))}
                            <tr className="bg-emerald-50 font-semibold">
                              <td className="px-3 py-1.5" colSpan={2}>Totaal</td>
                              <td className="px-3 py-1.5 text-right">{matchedTotals.count}</td>
                              <td className="px-3 py-1.5 text-right">{fmtKm(matchedTotals.km)}</td>
                              <td className="px-3 py-1.5 text-right">{fmtMoney(matchedTotals.amount)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Km-samenvatting: geregistreerd vs tolheffing + percentage */}
                  {hasMatched && typeof totalRegisteredKm === 'number' && totalRegisteredKm > 0 && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <h3 className="text-sm font-semibold text-sky-900 mb-2">Kilometer-verhouding</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        <div className="rounded border border-sky-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-sky-700">Totaal geregistreerd</div>
                          <div className="text-lg font-semibold text-sky-900 tabular-nums">
                            {totalRegisteredKm.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km
                          </div>
                        </div>
                        <div className="rounded border border-sky-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-sky-700">Totaal tolheffing</div>
                          <div className="text-lg font-semibold text-sky-900 tabular-nums">
                            {matchedTotals.km.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km
                          </div>
                        </div>
                        <div className="rounded border border-sky-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-sky-700">Tolheffing / geregistreerd</div>
                          <div className="text-lg font-semibold text-sky-900 tabular-nums">
                            {((matchedTotals.km / totalRegisteredKm) * 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Details buiten tijden */}
                  {hasUnmatched && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ClockIcon className="h-5 w-5 text-amber-600" />
                        <h3 className="text-sm font-semibold text-amber-900">
                          Niet automatisch meegenomen ({unmatchedTotals.count} event{unmatchedTotals.count === 1 ? '' : 's'})
                        </h3>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded border border-amber-200 bg-white">
                        {/* Mobile: card list */}
                        <div className="sm:hidden divide-y divide-amber-100">
                          {unmatched.map(u => (
                            <div key={u.id} className="p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900">{u.plate_display}</span>
                                <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmtMoney(u.amount)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-gray-600">
                                <span>{fmtDateTime(u.start_at)}</span>
                                <span className="tabular-nums">{fmtKm(u.distance_km)}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-gray-500">
                                Rit {u.ritnummer || u.dag_ritnummer || '—'} · {redenTekst(u.reason)}
                                {isWeekend(u.start_at) && <WeekendLabel />}
                              </div>
                            </div>
                          ))}
                          <div className="bg-amber-100 p-2.5">
                            <div className="flex items-center justify-between gap-2 text-sm font-semibold text-amber-900">
                              <span>Totaal buiten tijden</span>
                              <span className="tabular-nums">{fmtMoney(unmatchedTotals.amount)}</span>
                            </div>
                            <div className="mt-0.5 text-right text-[11px] text-amber-800 tabular-nums">
                              {fmtKm(unmatchedTotals.km)}
                            </div>
                          </div>
                        </div>

                        {/* Desktop: table */}
                        <table className="hidden sm:table min-w-full text-xs">
                          <thead className="bg-amber-100 text-amber-900 sticky top-0">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-semibold">Kenteken</th>
                              <th className="px-3 py-1.5 text-left font-semibold">Ritnummer</th>
                              <th className="px-3 py-1.5 text-left font-semibold">Datum / tijd</th>
                              <th className="px-3 py-1.5 text-right font-semibold">KM</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Bedrag</th>
                              <th className="px-3 py-1.5 text-left font-semibold">Reden</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-100">
                            {unmatched.map(u => (
                              <tr key={u.id}>
                                <td className="px-3 py-1.5 font-medium text-gray-900">{u.plate_display}</td>
                                <td className="px-3 py-1.5 text-gray-700">{u.ritnummer || u.dag_ritnummer || '—'}</td>
                                <td className="px-3 py-1.5 text-gray-700">{fmtDateTime(u.start_at)}</td>
                                <td className="px-3 py-1.5 text-right text-gray-700">{fmtKm(u.distance_km)}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{fmtMoney(u.amount)}</td>
                                <td className="px-3 py-1.5 text-gray-500 text-[11px]">
                                  {redenTekst(u.reason)}
                                  {isWeekend(u.start_at) && <WeekendLabel />}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-amber-100 font-semibold text-amber-900">
                              <td className="px-3 py-1.5" colSpan={3}>Totaal buiten tijden</td>
                              <td className="px-3 py-1.5 text-right">{fmtKm(unmatchedTotals.km)}</td>
                              <td className="px-3 py-1.5 text-right">{fmtMoney(unmatchedTotals.amount)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <p className="mt-2 text-[11px] text-amber-800">
                        Dit zijn tolheffing-events die niet vanzelf bij deze factuur horen: ze
                        overlappen niet met een rit uit de geïmporteerde uren, of ze staan op een
                        ander ritnummer. Vaak zijn dit ritten van een andere chauffeur, ritten
                        buiten werktijd of tol die op een andere factuur thuishoort.
                      </p>
                      {weekendTotals.count > 0 && (
                        <p className="mt-1 text-[11px] font-medium text-indigo-800">
                          Waarvan in het weekend: {weekendTotals.count} event
                          {weekendTotals.count === 1 ? '' : 's'} · {fmtKm(weekendTotals.km)} ·{' '}
                          {fmtMoney(weekendTotals.amount)}.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Ritten waarvoor helemaal geen tol is opgehaald */}
                  {hasSkipped && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ExclamationTriangleIcon className="h-5 w-5 text-rose-600" />
                        <h3 className="text-sm font-semibold text-rose-900">
                          Geen tol opgehaald ({skipped.length} dag{skipped.length === 1 ? '' : 'en'})
                        </h3>
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded border border-rose-200 bg-white divide-y divide-rose-100">
                        {skipped.map((s, i) => (
                          <div key={`${s.plate_normalized}-${s.date}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                            <span className="font-medium text-gray-900">{s.plate}</span>
                            <span className="text-gray-700 tabular-nums">{fmtDate(s.date)}</span>
                            <span className="text-gray-500 text-[11px]">
                              {s.start_time || '—'} – {s.end_time || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-rose-800">
                        Voor deze dagen ontbreekt een begin- of eindtijd, dus kon er geen
                        tolheffing worden gekoppeld. Vul de tijden aan in de urenregistratie en
                        importeer opnieuw, of voeg de tolheffing handmatig toe.
                      </p>
                    </div>
                  )}

                  {!hasMatched && !hasUnmatched && !hasSkipped && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 text-center">
                      Geen tolheffing gevonden voor deze uren.
                    </div>
                  )}
                    </>
                  )}

                  {tab === 'details' && hasEventDetails && (
                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs uppercase tracking-wide text-gray-600">
                        Alle {matchedEventDetails.length} gekoppelde tolheffing-events (chronologisch)
                      </div>
                      {/* Mobile: card list */}
                      <div className="sm:hidden divide-y divide-gray-100">
                        {matchedEventDetails.map((e, i) => (
                          <div key={i} className="p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium text-gray-900">{e.plate_display}</span>
                              <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmtMoney(e.amount)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-gray-600">
                              <span className="tabular-nums">{fmtDateTime(e.start_at)}</span>
                              <span className="tabular-nums">{fmtKm(e.distance_km)}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-400">
                              Rit {e.ritnummer || '—'}{e.obu ? ` · OBU ${e.obu}` : ''}
                            </div>
                          </div>
                        ))}
                        <div className="bg-gray-50 p-2.5">
                          <div className="flex items-center justify-between gap-2 text-sm font-semibold text-gray-800">
                            <span>Totaal</span>
                            <span className="tabular-nums">{fmtMoney(matchedTotals.amount)}</span>
                          </div>
                          <div className="mt-0.5 text-right text-[11px] text-gray-600 tabular-nums">
                            {fmtKm(matchedTotals.km)}
                          </div>
                        </div>
                      </div>
                      {/* Desktop: table */}
                      <table className="hidden sm:table min-w-full text-xs">
                        <thead className="bg-white text-gray-600 sticky top-0 shadow-sm">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Kenteken</th>
                            <th className="px-3 py-2 text-left font-semibold">Ritnummer</th>
                            <th className="px-3 py-2 text-left font-semibold">Datum / tijd</th>
                            <th className="px-3 py-2 text-right font-semibold">KM</th>
                            <th className="px-3 py-2 text-right font-semibold">Bedrag</th>
                            <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">OBU</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {matchedEventDetails.map((e, i) => (
                            <tr key={i} className="hover:bg-emerald-50/40">
                              <td className="px-3 py-1.5 font-medium text-gray-900">{e.plate_display}</td>
                              <td className="px-3 py-1.5 text-gray-700">{e.ritnummer || '—'}</td>
                              <td className="px-3 py-1.5 text-gray-700 tabular-nums">{fmtDateTime(e.start_at)}</td>
                              <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums">{fmtKm(e.distance_km)}</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-gray-900 tabular-nums">{fmtMoney(e.amount)}</td>
                              <td className="px-3 py-1.5 text-gray-500 hidden sm:table-cell text-[11px]">{e.obu || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50">
                          <tr className="font-semibold text-gray-800">
                            <td className="px-3 py-2" colSpan={3}>Totaal</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtKm(matchedTotals.km)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(matchedTotals.amount)}</td>
                            <td className="hidden sm:table-cell" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* Footer met acties */}
                <div className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-4 sm:px-5 py-3 sm:flex-row sm:justify-end shrink-0">
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                  >
                    Sluiten (niets toevoegen)
                  </button>
                  {hasUnmatched && (
                    <button
                      type="button"
                      onClick={onConfirmIncludeAll}
                      className="inline-flex justify-center rounded-md border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 shadow-sm hover:bg-amber-200"
                    >
                      Ook buiten tijden meenemen ({fmtMoney(matchedTotals.amount + unmatchedTotals.amount)})
                    </button>
                  )}
                  {hasMatched && (
                    <button
                      type="button"
                      onClick={onConfirmStrict}
                      className="inline-flex justify-center rounded-md border border-transparent bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
                    >
                      {hasUnmatched
                        ? `Alleen binnen tijden (${fmtMoney(matchedTotals.amount)})`
                        : `Toevoegen aan factuur (${fmtMoney(matchedTotals.amount)})`}
                    </button>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  )
}
