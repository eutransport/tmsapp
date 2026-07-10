/**
 * Admin: Privé tolheffing per chauffeur — overzicht + markeer als gefactureerd.
 *
 * Toont per week/maand alle chauffeurs die privé-registraties hebben ingediend,
 * met totaal aantal, totaal km, totaal bedrag (van gematchte tolling-events).
 * Admin kan per chauffeur voor die periode markeren als "gefactureerd aan chauffeur".
 */
import { useEffect, useMemo, useState, Fragment } from 'react'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import {
  privateTollAdminApi,
  PrivateTollAdminSummaryRow,
  PrivateTollRegistration,
} from '@/api/tolling'

type PeriodMode = 'week' | 'month'

const monthLabels = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
]

function getIsoWeek(d: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = target.getTime()
  target.setUTCMonth(0, 1)
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7)
  }
  const week = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000)
  return { year: new Date(firstThursday).getUTCFullYear(), week }
}

const currency = (v: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v || 0)

const kmFmt = (v: number) =>
  new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 3 }).format(v || 0)

export default function PrivateTollAdminPage() {
  const now = new Date()
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [monthIndex, setMonthIndex] = useState(now.getMonth() + 1)
  const [weekIndex, setWeekIndex] = useState(getIsoWeek(now).week)

  const [loading, setLoading] = useState(false)
  const [label, setLabel] = useState('')
  const [rows, setRows] = useState<PrivateTollAdminSummaryRow[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [details, setDetails] = useState<Record<string, PrivateTollRegistration[]>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [markingUserId, setMarkingUserId] = useState<string | null>(null)

  const currentIndex = periodMode === 'week' ? weekIndex : monthIndex

  const yearOptions = useMemo(() => {
    const y = now.getFullYear()
    return [y - 2, y - 1, y, y + 1]
  }, [now])

  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])

  const load = async () => {
    setLoading(true)
    try {
      const data = await privateTollAdminApi.summary({
        period: periodMode,
        year,
        index: currentIndex,
      })
      setRows(data.results)
      setLabel(data.label)
      setExpanded({})
      setDetails({})
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Kon overzicht niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMode, year, monthIndex, weekIndex])

  const toggleExpand = async (userId: string) => {
    const isOpen = !!expanded[userId]
    setExpanded(prev => ({ ...prev, [userId]: !isOpen }))
    if (!isOpen && !details[userId]) {
      setDetailLoading(prev => ({ ...prev, [userId]: true }))
      try {
        const detail = await privateTollAdminApi.detail({
          period: periodMode,
          year,
          index: currentIndex,
          user_id: userId,
        })
        setDetails(prev => ({ ...prev, [userId]: detail }))
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || 'Kon details niet laden')
      } finally {
        setDetailLoading(prev => ({ ...prev, [userId]: false }))
      }
    }
  }

  const handleMark = async (row: PrivateTollAdminSummaryRow, invoiced: boolean) => {
    if (invoiced && !window.confirm(
      `Markeer alle ${row.registrations_count} privé-registratie(s) van ${row.user_name} voor ${label} als gefactureerd?`,
    )) return
    if (!invoiced && !window.confirm(
      `Zet de markering "gefactureerd" ongedaan voor ${row.user_name} in ${label}?`,
    )) return
    setMarkingUserId(row.user_id)
    try {
      const res = await privateTollAdminApi.markInvoiced({
        period: periodMode,
        year,
        index: currentIndex,
        user_id: row.user_id,
        invoiced,
      })
      toast.success(`${res.updated} registratie(s) bijgewerkt`)
      await load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Kon niet markeren')
    } finally {
      setMarkingUserId(null)
    }
  }

  const totalRegs = rows.reduce((s, r) => s + r.registrations_count, 0)
  const totalEvents = rows.reduce((s, r) => s + r.matched_events_count, 0)
  const totalKm = rows.reduce((s, r) => s + r.total_km, 0)
  const totalAmount = rows.reduce((s, r) => s + r.total_amount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Privé tolheffing — per chauffeur</h1>
      </div>

      {/* Filter */}
      <div className="rounded-md border bg-white p-3 flex flex-wrap gap-2 items-center">
        <div className="inline-flex rounded-md shadow-sm">
          <button
            type="button"
            className={`px-3 py-1.5 text-sm rounded-l-md border ${periodMode === 'month' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}
            onClick={() => setPeriodMode('month')}
          >Maand</button>
          <button
            type="button"
            className={`px-3 py-1.5 text-sm rounded-r-md border -ml-px ${periodMode === 'week' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}
            onClick={() => setPeriodMode('week')}
          >Week</button>
        </div>
        <select
          className="rounded-md border-gray-300 text-sm"
          value={year}
          onChange={e => setYear(parseInt(e.target.value, 10))}
        >
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {periodMode === 'month' ? (
          <select
            className="rounded-md border-gray-300 text-sm"
            value={monthIndex}
            onChange={e => setMonthIndex(parseInt(e.target.value, 10))}
          >
            {monthLabels.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        ) : (
          <select
            className="rounded-md border-gray-300 text-sm"
            value={weekIndex}
            onChange={e => setWeekIndex(parseInt(e.target.value, 10))}
          >
            {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
          </select>
        )}
        <div className="ml-auto text-sm text-gray-500">
          {label}
        </div>
      </div>

      {/* Totalen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs uppercase text-gray-500">Chauffeurs</div>
          <div className="tabular-nums font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-md border bg-white p-3">
          <div className="text-xs uppercase text-gray-500">Registraties</div>
          <div className="tabular-nums font-semibold">{totalRegs}</div>
        </div>
        <div className="rounded-md border bg-purple-50/60 p-3">
          <div className="text-xs uppercase text-purple-700">Gematchte events</div>
          <div className="tabular-nums font-semibold text-purple-900">{totalEvents} &middot; {kmFmt(totalKm)} km</div>
        </div>
        <div className="rounded-md border bg-purple-50/60 p-3">
          <div className="text-xs uppercase text-purple-700">Totaal bedrag</div>
          <div className="tabular-nums font-semibold text-purple-900">{currency(totalAmount)}</div>
        </div>
      </div>

      {/* Tabel — desktop */}
      <div className="hidden md:block overflow-x-auto rounded-md border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2">Chauffeur</th>
              <th className="text-right px-3 py-2">Registraties</th>
              <th className="text-right px-3 py-2">Events</th>
              <th className="text-right px-3 py-2">Km</th>
              <th className="text-right px-3 py-2">Bedrag</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Actie</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="py-6 text-center text-gray-400">Laden…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="py-6 text-center text-gray-500">Geen privé-registraties in deze periode.</td></tr>
            ) : rows.map(row => {
              const isOpen = !!expanded[row.user_id]
              return (
                <Fragment key={row.user_id}>
                  <tr className={row.all_invoiced ? 'bg-green-50/50' : ''}>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.user_id)}
                        className="text-gray-500 hover:text-gray-800"
                        title={isOpen ? 'Inklappen' : 'Details tonen'}
                      >
                        {isOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-900">{row.user_name}</div>
                      {row.user_email && <div className="text-xs text-gray-500">{row.user_email}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.registrations_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.matched_events_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{kmFmt(row.total_km)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-purple-800">{currency(row.total_amount)}</td>
                    <td className="px-3 py-1.5 text-center">
                      {row.all_invoiced ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                          Gefactureerd
                        </span>
                      ) : row.any_invoiced ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                          Deels ({row.invoiced_count}/{row.registrations_count})
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {row.all_invoiced ? (
                        <button
                          type="button"
                          disabled={markingUserId === row.user_id}
                          onClick={() => handleMark(row, false)}
                          className="btn btn-secondary btn-xs inline-flex items-center gap-1"
                          title="Markering ongedaan maken"
                        >
                          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                          Ongedaan
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={markingUserId === row.user_id}
                          onClick={() => handleMark(row, true)}
                          className="btn btn-primary btn-xs inline-flex items-center gap-1"
                          title="Markeer alle registraties in deze periode als gefactureerd aan chauffeur"
                        >
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                          Markeer gefactureerd
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${row.user_id}-detail`} className="bg-gray-50/60">
                      <td></td>
                      <td colSpan={7} className="px-3 py-2">
                        {detailLoading[row.user_id] ? (
                          <div className="text-xs text-gray-500 py-2">Laden…</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left px-2 py-1">Datum</th>
                                  <th className="text-left px-2 py-1">Tijdvenster</th>
                                  <th className="text-left px-2 py-1">Kenteken</th>
                                  <th className="text-left px-2 py-1">Notitie</th>
                                  <th className="text-right px-2 py-1">Events</th>
                                  <th className="text-right px-2 py-1">Km</th>
                                  <th className="text-right px-2 py-1">Bedrag</th>
                                  <th className="text-center px-2 py-1">Gefactureerd</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(details[row.user_id] || []).map(d => (
                                  <tr key={d.id} className={d.admin_invoiced ? 'bg-green-50' : ''}>
                                    <td className="px-2 py-1">{d.datum}</td>
                                    <td className="px-2 py-1">{d.begin_tijd?.slice(0, 5)} — {d.eind_tijd?.slice(0, 5)}</td>
                                    <td className="px-2 py-1 font-mono">{d.license_plate_raw}</td>
                                    <td className="px-2 py-1">{d.notitie || '—'}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{d.matched_events_count}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{kmFmt(d.matched_events_km || 0)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{currency(d.matched_events_amount || 0)}</td>
                                    <td className="px-2 py-1 text-center">
                                      {d.admin_invoiced ? (
                                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700">Ja</span>
                                      ) : (
                                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600">Nee</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobiele kaart-layout */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="rounded-md border bg-white py-6 text-center text-gray-400">Laden…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border bg-white py-6 text-center text-gray-500">Geen privé-registraties in deze periode.</div>
        ) : rows.map(row => {
          const isOpen = !!expanded[row.user_id]
          return (
            <div key={row.user_id} className={`rounded-md border bg-white p-3 ${row.all_invoiced ? 'bg-green-50/50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 truncate">{row.user_name}</div>
                  {row.user_email && <div className="text-xs text-gray-500 truncate">{row.user_email}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => toggleExpand(row.user_id)}
                  className="text-gray-500 hover:text-gray-800 p-1"
                  title={isOpen ? 'Inklappen' : 'Details tonen'}
                >
                  {isOpen ? <ChevronDownIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div className="text-gray-500">Registraties</div>
                <div className="text-right tabular-nums">{row.registrations_count}</div>
                <div className="text-gray-500">Events</div>
                <div className="text-right tabular-nums">{row.matched_events_count}</div>
                <div className="text-gray-500">Km</div>
                <div className="text-right tabular-nums">{kmFmt(row.total_km)}</div>
                <div className="text-gray-500">Bedrag</div>
                <div className="text-right tabular-nums font-semibold text-purple-800">{currency(row.total_amount)}</div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                {row.all_invoiced ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Gefactureerd</span>
                ) : row.any_invoiced ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                    Deels ({row.invoiced_count}/{row.registrations_count})
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">Open</span>
                )}
                {row.all_invoiced ? (
                  <button
                    type="button"
                    disabled={markingUserId === row.user_id}
                    onClick={() => handleMark(row, false)}
                    className="btn btn-secondary btn-xs inline-flex items-center gap-1"
                  >
                    <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                    Ongedaan
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={markingUserId === row.user_id}
                    onClick={() => handleMark(row, true)}
                    className="btn btn-primary btn-xs inline-flex items-center gap-1"
                  >
                    <CheckCircleIcon className="h-3.5 w-3.5" />
                    Markeer
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  {detailLoading[row.user_id] ? (
                    <div className="text-xs text-gray-500">Laden…</div>
                  ) : (details[row.user_id] || []).length === 0 ? (
                    <div className="text-xs text-gray-500">Geen registraties.</div>
                  ) : (details[row.user_id] || []).map(d => (
                    <div key={d.id} className={`rounded border p-2 text-xs ${d.admin_invoiced ? 'bg-green-50 border-green-200' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{d.datum}</div>
                        <div className="font-mono">{d.license_plate_raw}</div>
                      </div>
                      <div className="text-gray-600">{d.begin_tijd?.slice(0, 5)} — {d.eind_tijd?.slice(0, 5)}</div>
                      {d.notitie && <div className="text-gray-500 mt-0.5">{d.notitie}</div>}
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        <div>
                          <div className="text-[10px] uppercase text-gray-400">Events</div>
                          <div className="tabular-nums">{d.matched_events_count}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-gray-400">Km</div>
                          <div className="tabular-nums">{kmFmt(d.matched_events_km || 0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-gray-400">Bedrag</div>
                          <div className="tabular-nums">{currency(d.matched_events_amount || 0)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
