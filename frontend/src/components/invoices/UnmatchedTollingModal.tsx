/**
 * Modal die na een strikte tolheffing-match (op begin/eindtijd rit) een lijst
 * toont van tol-events die BUITEN de rit-tijden vielen. De gebruiker kan
 * kiezen om alleen de binnen-tijden events te factureren, of ook de events
 * buiten de tijden mee te nemen.
 */
import { Fragment, useMemo } from 'react'
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
  start_at: string
  end_at: string | null
  distance_km: number
  amount: number
  obu: string
  reason: 'outside_time_range' | 'no_range_for_plate'
}

export interface MatchedTollingRow {
  plate_normalized: string
  plate_display: string
  ritnummer: string | null
  total_km: number
  total_amount: number
  events_count: number
  event_ids?: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  matched: MatchedTollingRow[]
  unmatched: UnmatchedEvent[]
  bufferMinutes: number
  /** Alleen binnen tijden factureren (aanbevolen). */
  onConfirmStrict: () => void
  /** Ook alle events buiten tijden meenemen. */
  onConfirmIncludeAll: () => void
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

export default function UnmatchedTollingModal({
  open,
  onClose,
  matched,
  unmatched,
  bufferMinutes,
  onConfirmStrict,
  onConfirmIncludeAll,
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

  const hasMatched = matched.length > 0
  const hasUnmatched = unmatched.length > 0

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

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-3 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-xl bg-white shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <ExclamationTriangleIcon className="h-5 w-5 text-amber-500" />
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      Tolheffing buiten rit-tijden gevonden
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Sluiten"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
                  <p className="text-sm text-gray-600">
                    De tolheffing is strikt gematcht op de begin- en eindtijd van elke rit
                    {bufferMinutes > 0 && (
                      <span className="text-gray-500"> (± {bufferMinutes} min buffer)</span>
                    )}.
                    Kies hieronder wat er op de factuur moet komen.
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
                        <table className="min-w-full text-xs">
                          <thead className="bg-emerald-100 text-emerald-900">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-semibold">Kenteken</th>
                              <th className="px-3 py-1.5 text-left font-semibold">Rit</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Events</th>
                              <th className="px-3 py-1.5 text-right font-semibold">KM</th>
                              <th className="px-3 py-1.5 text-right font-semibold">Bedrag</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100">
                            {matched.map(r => (
                              <tr key={r.plate_normalized}>
                                <td className="px-3 py-1.5 font-medium text-gray-900">{r.plate_display}</td>
                                <td className="px-3 py-1.5 text-gray-700">{r.ritnummer || '—'}</td>
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

                  {/* Details buiten tijden */}
                  {hasUnmatched && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <ClockIcon className="h-5 w-5 text-amber-600" />
                        <h3 className="text-sm font-semibold text-amber-900">
                          Buiten rit-tijden ({unmatchedTotals.count} event{unmatchedTotals.count === 1 ? '' : 's'})
                        </h3>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded border border-amber-200 bg-white">
                        <table className="min-w-full text-xs">
                          <thead className="bg-amber-100 text-amber-900 sticky top-0">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-semibold">Kenteken</th>
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
                                <td className="px-3 py-1.5 text-gray-700">{fmtDateTime(u.start_at)}</td>
                                <td className="px-3 py-1.5 text-right text-gray-700">{fmtKm(u.distance_km)}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{fmtMoney(u.amount)}</td>
                                <td className="px-3 py-1.5 text-gray-500 text-[11px]">
                                  {u.reason === 'no_range_for_plate'
                                    ? 'Geen rit voor kenteken'
                                    : 'Buiten begin/eindtijd'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-amber-100 font-semibold text-amber-900">
                              <td className="px-3 py-1.5" colSpan={2}>Totaal buiten tijden</td>
                              <td className="px-3 py-1.5 text-right">{fmtKm(unmatchedTotals.km)}</td>
                              <td className="px-3 py-1.5 text-right">{fmtMoney(unmatchedTotals.amount)}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <p className="mt-2 text-[11px] text-amber-800">
                        Dit zijn tolheffing-events op dit kenteken die niet overlappen met een rit
                        uit de geïmporteerde uren. Vaak zijn dit ritten van een andere chauffeur
                        of ritten buiten werktijd.
                      </p>
                    </div>
                  )}

                  {!hasMatched && !hasUnmatched && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 text-center">
                      Geen tolheffing gevonden voor deze uren.
                    </div>
                  )}
                </div>

                {/* Footer met acties */}
                <div className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:flex-row sm:justify-end">
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
                      Alleen binnen tijden ({fmtMoney(matchedTotals.amount)})
                    </button>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
