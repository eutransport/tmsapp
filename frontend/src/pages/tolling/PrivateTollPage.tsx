/**
 * Privé tolheffing pagina — voor chauffeurs (en admins).
 *
 * Chauffeurs registreren periodes waarin ze een voertuig privé hebben gebruikt.
 * TollingEvents die matchen op kenteken + datum + tijdvenster worden automatisch
 * als privé gemarkeerd en niet meegefactureerd.
 *
 * Bevat een formulier + overzicht met week/maand filter + pagination.
 * Elke gebruiker ziet enkel zijn/haar eigen registraties.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import {
  privateTollApi,
  PrivateTollRegistration,
  PrivateTollListParams,
} from '@/api/tolling'
import { getVehiclesForDropdown } from '@/api/fleet'
import { getUsers } from '@/api/users'
import { useAuthStore } from '@/stores/authStore'
import { Vehicle, User } from '@/types'
import ConfirmDialog, { ConfirmState } from '@/components/common/ConfirmDialog'

type PeriodMode = 'all' | 'week' | 'month'

const PAGE_SIZE = 20

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

const emptyForm = () => {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: '' as string,
    datum: today,
    begin_tijd: '17:00',
    eind_tijd: '19:00',
    license_plate_raw: '',
    notitie: '',
  }
}

export default function PrivateTollPage() {
  const currentUser = useAuthStore(s => s.user)
  const isAdmin = currentUser?.rol === 'admin'

  const [items, setItems] = useState<PrivateTollRegistration[]>([])
  const [count, setCount] = useState(0)
  const [numPages, setNumPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [monthIndex, setMonthIndex] = useState(now.getMonth() + 1)
  const [weekIndex, setWeekIndex] = useState(getIsoWeek(now).week)

  // Admin: selecteer een chauffeur om diens registraties te zien/beheren.
  // Lege string = eigen registraties.
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [driverList, setDriverList] = useState<User[]>([])

  // UI: welke rijen tonen hun gematchte events uitgeklapt
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const fmtDateTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('nl-NL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }
  const eur = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`

  // Samenvatting van huidige pagina: open vs. gefactureerd
  const summary = useMemo(() => {
    let openCount = 0, openAmount = 0
    let invCount = 0, invAmount = 0
    for (const r of items) {
      const amt = r.matched_events_amount || 0
      if (r.admin_invoiced) {
        invCount += 1
        invAmount += amt
      } else {
        openCount += 1
        openAmount += amt
      }
    }
    return { openCount, openAmount, invCount, invAmount }
  }, [items])

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const params: PrivateTollListParams = useMemo(() => {
    const p: PrivateTollListParams = { page, pageSize: PAGE_SIZE }
    if (periodMode === 'week') {
      p.period = 'week'
      p.year = year
      p.index = weekIndex
    } else if (periodMode === 'month') {
      p.period = 'month'
      p.year = year
      p.index = monthIndex
    }
    if (isAdmin && selectedUserId) p.user_id = selectedUserId
    return p
  }, [page, periodMode, year, monthIndex, weekIndex, isAdmin, selectedUserId])

  const load = async () => {
    setLoading(true)
    try {
      const data = await privateTollApi.list(params)
      setItems(data.results)
      setCount(data.count)
      setNumPages(data.num_pages)
    } catch (err: any) {
      toast.error('Kon privé tolregistraties niet laden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [params])

  useEffect(() => {
    (async () => {
      try { setVehicles(await getVehiclesForDropdown()) } catch { /* silent */ }
    })()
  }, [])

  // Admin: laad chauffeurs (rol=chauffeur) voor de dropdown
  useEffect(() => {
    if (!isAdmin) return
    (async () => {
      try {
        const res = await getUsers({ rol: 'chauffeur', page_size: 500, ordering: 'achternaam' })
        setDriverList(res.results)
      } catch { /* silent */ }
    })()
  }, [isAdmin])

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1) }, [periodMode, year, monthIndex, weekIndex, selectedUserId])

  const openNew = () => {
    setForm(emptyForm())
    setShowForm(true)
  }
  const openEdit = (r: PrivateTollRegistration) => {
    setForm({
      id: r.id,
      datum: r.datum,
      begin_tijd: r.begin_tijd.slice(0, 5),
      eind_tijd: r.eind_tijd.slice(0, 5),
      license_plate_raw: r.license_plate_raw,
      notitie: r.notitie || '',
    })
    setShowForm(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.datum || !form.begin_tijd || !form.eind_tijd || !form.license_plate_raw.trim()) {
      toast.error('Vul datum, tijden en kenteken in')
      return
    }
    if (form.eind_tijd <= form.begin_tijd) {
      toast.error('Eindtijd moet later zijn dan begintijd')
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        datum: form.datum,
        begin_tijd: form.begin_tijd,
        eind_tijd: form.eind_tijd,
        license_plate_raw: form.license_plate_raw.toUpperCase().trim(),
        notitie: form.notitie,
      }
      if (isAdmin && selectedUserId && !form.id) {
        payload.user_id = selectedUserId
      }
      let saved: PrivateTollRegistration
      if (form.id) {
        saved = await privateTollApi.update(form.id, payload)
        toast.success(`Bijgewerkt. ${saved.matched_events_count} tolregel(s) als privé gemarkeerd.`)
      } else {
        saved = await privateTollApi.create(payload)
        toast.success(`Opgeslagen. ${saved.matched_events_count} tolregel(s) als privé gemarkeerd.`)
      }
      setShowForm(false)
      await load()
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.eind_tijd?.[0] || 'Opslaan mislukt'
      toast.error(String(msg))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: PrivateTollRegistration) => {
    setConfirmState({
      title: 'Privé registratie verwijderen?',
      message: (
        <span>
          Registratie <strong>{r.datum}</strong> {r.begin_tijd.slice(0, 5)}–{r.eind_tijd.slice(0, 5)}{' '}
          voor <strong>{r.license_plate_raw}</strong> verwijderen? Gekoppelde tolregels worden ontkoppeld.
        </span>
      ),
      confirmLabel: 'Verwijderen',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await privateTollApi.remove(r.id)
          toast.success('Verwijderd. Gekoppelde tolregels zijn ontkoppeld.')
          await load()
        } catch {
          toast.error('Verwijderen mislukt')
        }
      },
    })
  }

  const weekOptions = Array.from({ length: 53 }, (_, i) => i + 1)
  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i)

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isAdmin && selectedUserId
              ? `Privé tolheffing — ${driverList.find(u => u.id === selectedUserId)?.full_name || 'Chauffeur'}`
              : 'Mijn privé tolheffing'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isAdmin && selectedUserId
              ? 'Je dient deze registratie in namens de geselecteerde chauffeur.'
              : 'Registreer wanneer je een voertuig privé gebruikte. Deze uren worden automatisch uit de doorbelasting gehouden.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4 mr-1" />
          Nieuwe registratie
        </button>
      </div>

      {/* Admin: chauffeur-selector */}
      {isAdmin && (
        <div className="rounded-md border bg-amber-50/60 p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-amber-800 font-medium">Beheer:</span>
          <span className="text-gray-700">Indienen namens</span>
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="px-2 py-1 border rounded"
          >
            <option value="">— mijzelf —</option>
            {driverList.map(u => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.username || u.email}
              </option>
            ))}
          </select>
          {selectedUserId && (
            <button
              type="button"
              onClick={() => setSelectedUserId('')}
              className="ml-1 text-xs text-amber-800 underline"
            >
              wissen
            </button>
          )}
        </div>
      )}

      {/* Filter */}
      <div className="rounded-md border bg-white p-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Periode:</span>
        {(['all', 'week', 'month'] as PeriodMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setPeriodMode(m)}
            className={`px-2.5 py-1 rounded ${periodMode === m
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
          >
            {m === 'all' ? 'Alles' : m === 'week' ? 'Per week' : 'Per maand'}
          </button>
        ))}
        {periodMode !== 'all' && (
          <>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="ml-2 px-2 py-1 border rounded"
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {periodMode === 'month' ? (
              <select
                value={monthIndex}
                onChange={e => setMonthIndex(Number(e.target.value))}
                className="px-2 py-1 border rounded"
              >
                {monthLabels.map((label, i) => (
                  <option key={i + 1} value={i + 1}>{label}</option>
                ))}
              </select>
            ) : (
              <select
                value={weekIndex}
                onChange={e => setWeekIndex(Number(e.target.value))}
                className="px-2 py-1 border rounded"
              >
                {weekOptions.map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            )}
          </>
        )}
        <div className="ml-auto text-gray-500">
          {count} registratie{count === 1 ? '' : 's'}
        </div>
      </div>

      {/* Samenvatting: open vs. gefactureerd (op basis van huidige pagina) */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-md border bg-amber-50 border-amber-200 p-3">
            <div className="text-xs uppercase font-medium text-amber-800">Openstaand</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-gray-700">
                {summary.openCount} registratie{summary.openCount === 1 ? '' : 's'}
              </span>
              <span className="text-lg font-semibold text-amber-900 tabular-nums">
                {eur(summary.openAmount)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-amber-700">Nog niet door de beheerder verrekend.</div>
          </div>
          <div className="rounded-md border bg-emerald-50 border-emerald-200 p-3">
            <div className="text-xs uppercase font-medium text-emerald-800">Gefactureerd</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-gray-700">
                {summary.invCount} registratie{summary.invCount === 1 ? '' : 's'}
              </span>
              <span className="text-lg font-semibold text-emerald-900 tabular-nums">
                {eur(summary.invAmount)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-emerald-700">Reeds door de beheerder afgehandeld.</div>
          </div>
        </div>
      )}

      {/* Formulier */}
      {showForm && (
        <form onSubmit={submit} className="rounded-md border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              {form.id ? 'Registratie bewerken' : 'Nieuwe privé registratie'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Annuleren
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Datum</span>
              <input
                type="date"
                value={form.datum}
                onChange={e => setForm(f => ({ ...f, datum: e.target.value }))}
                className="w-full px-2 py-1.5 border rounded"
                required
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Begintijd</span>
              <input
                type="time"
                value={form.begin_tijd}
                onChange={e => setForm(f => ({ ...f, begin_tijd: e.target.value }))}
                className="w-full px-2 py-1.5 border rounded"
                required
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Eindtijd</span>
              <input
                type="time"
                value={form.eind_tijd}
                onChange={e => setForm(f => ({ ...f, eind_tijd: e.target.value }))}
                className="w-full px-2 py-1.5 border rounded"
                required
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">Kenteken</span>
              {vehicles.length > 0 ? (
                <select
                  value={form.license_plate_raw}
                  onChange={e => setForm(f => ({ ...f, license_plate_raw: e.target.value }))}
                  className="w-full px-2 py-1.5 border rounded"
                  required
                >
                  <option value="">Selecteer kenteken…</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.kenteken}>
                      {v.kenteken}{v.ritnummer ? ` (${v.ritnummer})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.license_plate_raw}
                  onChange={e => setForm(f => ({ ...f, license_plate_raw: e.target.value }))}
                  className="w-full px-2 py-1.5 border rounded uppercase"
                  placeholder="Bv. 12-ABC-3"
                  required
                />
              )}
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-gray-600 mb-1">Notitie (optioneel)</span>
            <input
              type="text"
              value={form.notitie}
              onChange={e => setForm(f => ({ ...f, notitie: e.target.value }))}
              className="w-full px-2 py-1.5 border rounded"
              maxLength={255}
              placeholder="Bv. naar huis gereden na dienst"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </form>
      )}

      {/* Overzicht — desktop tabel */}
      <div className="hidden md:block rounded-md border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">Datum</th>
              <th className="text-left px-3 py-2">Tijdvenster</th>
              <th className="text-left px-3 py-2">Kenteken</th>
              <th className="text-left px-3 py-2">Notitie</th>
              <th className="text-right px-3 py-2">Gematcht</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Laden…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Geen registraties in deze periode.</td></tr>
            ) : (
              items.map(r => (
                <Fragment key={r.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.datum}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.begin_tijd.slice(0, 5)} — {r.eind_tijd.slice(0, 5)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap font-medium">{r.license_plate_raw}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.notitie || '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.matched_events_count > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(r.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-medium hover:bg-purple-200"
                        title="Klik om gematchte tolregels te tonen"
                      >
                        {r.matched_events_count} · {eur(r.matched_events_amount || 0)}
                        {expanded.has(r.id) ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                      </button>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                    {r.admin_invoiced ? (
                      <span
                        className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800 font-medium"
                        title={r.admin_invoiced_at ? `Gefactureerd op ${new Date(r.admin_invoiced_at).toLocaleDateString('nl-NL')}` : 'Gefactureerd'}
                      >
                        Gefactureerd
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 font-medium">
                        Open
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="inline-flex items-center p-1 text-gray-600 hover:text-primary-600"
                      title="Bewerken"
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="inline-flex items-center p-1 text-gray-600 hover:text-red-600 ml-1"
                      title="Verwijderen"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {expanded.has(r.id) && r.matched_events && r.matched_events.length > 0 && (
                  <tr key={`${r.id}-details`} className="bg-purple-50/40">                    <td colSpan={6} className="px-3 py-2">
                      <table className="w-full text-xs">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="text-left font-medium px-2 py-1">Start</th>
                            <th className="text-left font-medium px-2 py-1">Eind</th>
                            <th className="text-right font-medium px-2 py-1">Afstand</th>
                            <th className="text-right font-medium px-2 py-1">Bedrag</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-100">
                          {r.matched_events.map(ev => (
                            <tr key={ev.id}>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700">{fmtDateTime(ev.start_at)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700">{fmtDateTime(ev.end_at)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{ev.distance_km.toFixed(3)} km</td>
                              <td className="px-2 py-1 text-right tabular-nums text-purple-800 font-medium">{eur(ev.amount)}</td>
                            </tr>
                          ))}
                          <tr className="bg-purple-100/60">
                            <td className="px-2 py-1 font-medium text-gray-700" colSpan={2}>Totaal privé</td>
                            <td className="px-2 py-1 text-right tabular-nums font-medium">{(r.matched_events_km || 0).toFixed(3)} km</td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold text-purple-800">{eur(r.matched_events_amount || 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>

        {numPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
            <div className="text-gray-500">
              Pagina {page} van {numPages}
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
              <button
                type="button"
                className="p-1.5 border rounded hover:bg-white disabled:opacity-40"
                onClick={() => setPage(p => Math.min(numPages, p + 1))}
                disabled={page >= numPages}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Overzicht — mobiel kaartjes */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="rounded-md border bg-white py-6 text-center text-gray-400">Laden…</div>
        ) : items.length === 0 ? (
          <div className="rounded-md border bg-white py-6 text-center text-gray-500">Geen registraties in deze periode.</div>
        ) : items.map(r => (
          <div key={r.id} className="rounded-md border bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">{r.datum}</div>
                <div className="text-xs text-gray-600">{r.begin_tijd.slice(0, 5)} — {r.eind_tijd.slice(0, 5)}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-sm font-mono font-medium">{r.license_plate_raw}</div>
                {r.admin_invoiced ? (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-medium"
                    title={r.admin_invoiced_at ? `Gefactureerd op ${new Date(r.admin_invoiced_at).toLocaleDateString('nl-NL')}` : 'Gefactureerd'}
                  >
                    Gefactureerd
                  </span>
                ) : (
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-medium">
                    Open
                  </span>
                )}
              </div>
            </div>
            {r.notitie && <div className="mt-1 text-xs text-gray-500">{r.notitie}</div>}
            <div className="mt-2 flex items-center justify-between">
              {r.matched_events_count > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleExpanded(r.id)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-medium hover:bg-purple-200"
                >
                  {r.matched_events_count} gematcht · {eur(r.matched_events_amount || 0)}
                  {expanded.has(r.id) ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                </button>
              ) : (
                <span className="text-xs text-gray-400">Geen match</span>
              )}
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="inline-flex items-center p-1.5 text-gray-600 hover:text-primary-600 border rounded"
                  title="Bewerken"
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  className="inline-flex items-center p-1.5 text-gray-600 hover:text-red-600 border rounded"
                  title="Verwijderen"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            {expanded.has(r.id) && r.matched_events && r.matched_events.length > 0 && (
              <div className="mt-2 rounded border border-purple-100 bg-purple-50/40 divide-y divide-purple-100">
                {r.matched_events.map(ev => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="text-gray-700">{fmtDateTime(ev.start_at)}</div>
                      <div className="text-gray-500">→ {fmtDateTime(ev.end_at)}</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="tabular-nums text-gray-700">{ev.distance_km.toFixed(3)} km</div>
                      <div className="tabular-nums text-purple-800 font-medium">{eur(ev.amount)}</div>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-2 py-1.5 text-xs bg-purple-100/60">
                  <span className="font-medium text-gray-700">Totaal privé</span>
                  <span className="tabular-nums font-semibold text-purple-800">{eur(r.matched_events_amount || 0)}</span>
                </div>
              </div>
            )}
          </div>
        ))}

        {numPages > 1 && (
          <div className="flex items-center justify-between rounded-md border bg-gray-50 px-3 py-2 text-sm">
            <div className="text-gray-500">Pagina {page} van {numPages}</div>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                className="p-1.5 border rounded bg-white disabled:opacity-40"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="p-1.5 border rounded bg-white disabled:opacity-40"
                onClick={() => setPage(p => Math.min(numPages, p + 1))}
                disabled={page >= numPages}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
