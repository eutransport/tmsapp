/**
 * Modal to create an invoice directly from the tolheffing import page.
 *
 * Flow (drie fases in één dialog):
 *   1. `config`   – kies periode (1 of 2 weken), week, template, bedrijf,
 *                    administratie, datums. Toont live factuurnummer.
 *   2. `preview`  – toont net-gemaakte factuur PDF + samenvatting. Vraagt of
 *                    de factuur direct gemaild moet worden.
 *   3. `mail`     – vinklijst met mailinglijstcontacten van het bedrijf +
 *                    extra e-mailadressen. Verstuurt met tolheffing-bijlage.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import toast from 'react-hot-toast'
import {
  XMarkIcon,
  DocumentTextIcon,
  PaperAirplaneIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

import api from '@/api/client'
import {
  tollingApi,
  TollingOpenWeek,
  TollingVehicleRow,
} from '@/api/tolling'
import {
  getTemplates,
  getNextInvoiceNumber,
  changeStatus,
  sendInvoiceEmail,
} from '@/api/invoices'
import { getAllCompanies, getMailingContacts } from '@/api/companies'
import { listAdministraties, type Administratie } from '@/api/administraties'
import type {
  Company,
  InvoiceTemplate,
  MailingListContact,
} from '@/types'

interface CreateTollingInvoiceModalProps {
  isOpen: boolean
  row: TollingVehicleRow
  onClose: () => void
  onCreated: () => void
}

type Phase = 'config' | 'preview' | 'mail'

interface CreatedInvoice {
  invoice_id: string
  factuurnummer: string
  totaal: number
  subtotaal: number
  btw_bedrag: number
  events_marked: number
  weeks: Array<{ year: number; week: number; total_amount: number; events_count: number }>
}

const currency = (n: number): string =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)

const isoToday = (): string => new Date().toISOString().slice(0, 10)
const isoPlusDays = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function CreateTollingInvoiceModal({
  isOpen,
  row,
  onClose,
  onCreated,
}: CreateTollingInvoiceModalProps) {
  const [phase, setPhase] = useState<Phase>('config')

  // Reference data
  const [openWeeks, setOpenWeeks] = useState<TollingOpenWeek[]>([])
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [administraties, setAdministraties] = useState<Administratie[]>([])
  const [loadingRefs, setLoadingRefs] = useState(false)

  // Form state
  const [periodWeeks, setPeriodWeeks] = useState<1 | 2 | 3 | 4>(1)
  const [weekKey, setWeekKey] = useState<string>('') // "year-week"
  const [templateId, setTemplateId] = useState('')
  const [bedrijfId, setBedrijfId] = useState('')
  const [administratieId, setAdministratieId] = useState('')
  const [factuurdatum, setFactuurdatum] = useState(isoToday())
  const [vervaldatum, setVervaldatum] = useState(isoPlusDays(30))
  // Tolheffing wordt altijd zonder BTW gefactureerd (doorlopende post).
  const [excludeWeekend, setExcludeWeekend] = useState<boolean>(true)
  const [cutoffEnabled, setCutoffEnabled] = useState<boolean>(false)
  const [cutoffTime, setCutoffTime] = useState<string>('20:00')

  // Preview number
  const [previewNumber, setPreviewNumber] = useState<string>('')

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedInvoice | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string>('')

  // Mail phase
  const [mailingContacts, setMailingContacts] = useState<MailingListContact[]>([])
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
  const [extraEmail, setExtraEmail] = useState('')
  const [sending, setSending] = useState(false)

  // Load reference data + prefill defaults on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setPhase('config')
    setCreated(null)
    setPdfUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return ''
    })
    setLoadingRefs(true)
    Promise.all([
      tollingApi.openWeeks(row.plate_normalized, { excludeWeekend: true, cutoffTime: null }),
      getTemplates(true),
      getAllCompanies(),
      listAdministraties().catch(() => [] as Administratie[]),
    ])
      .then(([weeks, tplRes, comps, admins]) => {
        if (cancelled) return
        setOpenWeeks(weeks)
        setTemplates(tplRes.results)
        setCompanies(comps)
        setAdministraties(admins)
        // Pre-select newest open week
        if (weeks.length > 0) {
          setWeekKey(`${weeks[0].year}-${weeks[0].week}`)
        } else {
          setWeekKey('')
        }
        // Pre-select first template
        if (tplRes.results.length > 0) setTemplateId(tplRes.results[0].id)
        // Pre-select vehicle's bedrijf
        if (row.bedrijf_id) setBedrijfId(row.bedrijf_id)
        else if (comps.length === 1) setBedrijfId(comps[0].id)
        setAdministratieId('')
        setFactuurdatum(isoToday())
        setVervaldatum(isoPlusDays(30))
        setExcludeWeekend(true)
        setCutoffEnabled(false)
        setCutoffTime('20:00')
      })
      .catch((e: any) => {
        toast.error(e?.response?.data?.detail || 'Kon gegevens niet laden')
      })
      .finally(() => {
        if (!cancelled) setLoadingRefs(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, row.plate_normalized])

  // Refresh preview invoice number when administratie changes
  useEffect(() => {
    if (!isOpen) return
    getNextInvoiceNumber('verkoop', administratieId || null)
      .then(r => setPreviewNumber(r.factuurnummer))
      .catch(() => setPreviewNumber(''))
  }, [isOpen, administratieId])

  // Re-fetch open weeks when filters (weekend / cutoff) change,
  // so totals in the dropdown reflect the actual amount to be invoiced.
  useEffect(() => {
    if (!isOpen || loadingRefs) return
    let cancelled = false
    const cutoff = cutoffEnabled && cutoffTime ? cutoffTime : null
    tollingApi.openWeeks(row.plate_normalized, {
      excludeWeekend,
      cutoffTime: cutoff,
    })
      .then(weeks => {
        if (cancelled) return
        setOpenWeeks(weeks)
        // Keep selected week if it still exists; otherwise pick newest
        const stillExists = weeks.some(w => `${w.year}-${w.week}` === weekKey)
        if (!stillExists) {
          setWeekKey(weeks.length > 0 ? `${weeks[0].year}-${weeks[0].week}` : '')
        }
      })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, excludeWeekend, cutoffEnabled, cutoffTime, row.plate_normalized])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Determine the weeks that will be invoiced (chronological consecutive open weeks)
  const selectedWeeks = useMemo(() => {
    if (!weekKey) return [] as TollingOpenWeek[]
    const [ys, ws] = weekKey.split('-').map(Number)
    const idx = openWeeks.findIndex(w => w.year === ys && w.week === ws)
    if (idx === -1) return []
    const result: TollingOpenWeek[] = [openWeeks[idx]]
    let prev = openWeeks[idx]
    for (let i = 1; i < periodWeeks; i++) {
      const prevStart = new Date(prev.start)
      const nextExpected = new Date(prevStart)
      nextExpected.setDate(nextExpected.getDate() + 7)
      const nextKey = nextExpected.toISOString().slice(0, 10)
      const next = openWeeks.find(w => w.start === nextKey)
      if (!next) break
      result.push(next)
      prev = next
    }
    return result
  }, [weekKey, openWeeks, periodWeeks])

  const selectedTotal = useMemo(
    () => selectedWeeks.reduce((s, w) => s + (w.total_amount || 0), 0),
    [selectedWeeks],
  )

  const selectedBedrijf = useMemo(
    () => companies.find(c => c.id === bedrijfId) || null,
    [companies, bedrijfId],
  )

  const canSubmit =
    !submitting && !!weekKey && !!templateId && !!bedrijfId && selectedWeeks.length > 0

  const handleSubmit = async () => {
    if (!canSubmit) return
    const [ys, ws] = weekKey.split('-').map(Number)
    setSubmitting(true)
    try {
      const res = await tollingApi.createInvoiceForVehicle({
        plate: row.plate_normalized,
        year: ys,
        week_start: ws,
        period_weeks: periodWeeks,
        template_id: templateId,
        bedrijf_id: bedrijfId,
        administratie_id: administratieId || null,
        factuurdatum,
        vervaldatum,
        btw_percentage: 0,
        exclude_weekend: excludeWeekend,
        cutoff_time: cutoffEnabled && cutoffTime ? cutoffTime : null,
      })
      setCreated({
        invoice_id: res.invoice_id,
        factuurnummer: res.factuurnummer,
        totaal: res.totaal,
        subtotaal: res.subtotaal,
        btw_bedrag: res.btw_bedrag,
        events_marked: res.events_marked,
        weeks: res.lines.map(l => ({
          year: l.year,
          week: l.week,
          total_amount: l.total_amount,
          events_count: l.events_count,
        })),
      })
      // Load PDF preview
      try {
        const resp = await api.get(
          `/invoicing/invoices/${res.invoice_id}/generate_pdf/`,
          { responseType: 'blob' },
        )
        const blob = new Blob([resp.data], { type: 'application/pdf' })
        setPdfUrl(URL.createObjectURL(blob))
      } catch (pdfErr: any) {
        toast.error('Factuur is aangemaakt maar voorbeeld kon niet worden geladen.')
      }
      setPhase('preview')
      toast.success(`Factuur ${res.factuurnummer} aangemaakt`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Aanmaken mislukt')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartMail = async () => {
    if (!created) return
    // Load mailing contacts for the selected bedrijf
    try {
      const contacts = await getMailingContacts(bedrijfId)
      const active = contacts.filter(c => c.is_active)
      setMailingContacts(active)
      setSelectedEmails(new Set(active.map(c => c.email)))
    } catch {
      setMailingContacts([])
      setSelectedEmails(new Set())
    }
    setExtraEmail('')
    setPhase('mail')
  }

  const handleSend = async () => {
    if (!created) return
    const extras = extraEmail
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e.includes('@'))
    const emails = Array.from(new Set([...Array.from(selectedEmails), ...extras]))
    if (emails.length === 0) {
      toast.error('Kies minimaal één ontvanger.')
      return
    }
    setSending(true)
    try {
      // Bump to definitief (send_email requires it) — silently ignore if already definitief
      try {
        await changeStatus(created.invoice_id, 'definitief')
      } catch {
        // ignore — will fail send if truly needed
      }
      await sendInvoiceEmail(created.invoice_id, undefined, emails)
      toast.success(`Factuur verzonden naar ${emails.length} ontvanger(s)`)
      onCreated()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.response?.data?.detail || 'Verzenden mislukt')
    } finally {
      setSending(false)
    }
  }

  const handleCloseWithoutMail = () => {
    // Invoice is already saved as concept — user chose not to mail. Just close.
    onCreated()
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => (submitting || sending ? null : onClose())}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-2 sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-xl bg-white shadow-2xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <DocumentTextIcon className="h-5 w-5 text-primary-600" />
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      {phase === 'config' && `Factuur maken · ${row.plate_display}`}
                      {phase === 'preview' && `Factuur ${created?.factuurnummer ?? ''} — voorbeeld`}
                      {phase === 'mail' && `Factuur ${created?.factuurnummer ?? ''} — verzenden`}
                    </Dialog.Title>
                  </div>
                  <button
                    type="button"
                    onClick={() => (submitting || sending ? null : onClose())}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
                    disabled={submitting || sending}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* PHASE 1 — CONFIG */}
                {phase === 'config' && (
                  <div className="max-h-[80vh] overflow-y-auto px-5 py-4 space-y-4">
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
                      <span><strong>Kenteken:</strong> {row.plate_display}</span>
                      {row.ritnummer && <span><strong>Rit:</strong> {row.ritnummer}</span>}
                      {row.bedrijf_naam && <span><strong>Bedrijf:</strong> {row.bedrijf_naam}</span>}
                    </div>

                    {loadingRefs ? (
                      <div className="py-8 text-center text-gray-400">Laden…</div>
                    ) : (
                      <>
                        {/* Periode */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Factuurperiode</label>
                          <div className="inline-flex rounded-md border border-gray-300 bg-white overflow-hidden">
                            {([1, 2, 3, 4] as const).map(n => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setPeriodWeeks(n)}
                                className={`px-4 py-1.5 text-sm ${
                                  periodWeeks === n
                                    ? 'bg-primary-600 text-white'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {n === 1 ? '1 week' : n === 4 ? 'Maand (4 weken)' : `${n} weken`}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Filters: weekend & cutoff-tijd */}
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 space-y-3">
                          <div className="flex items-start gap-3">
                            <input
                              id="excl-weekend"
                              type="checkbox"
                              checked={excludeWeekend}
                              onChange={e => setExcludeWeekend(e.target.checked)}
                              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <label htmlFor="excl-weekend" className="text-sm text-gray-800 cursor-pointer">
                              <span className="font-medium">Weekend niet factureren</span>
                              <span className="block text-xs text-gray-500">
                                Zaterdag- en zondag-events worden overgeslagen (standaard aan).
                              </span>
                            </label>
                          </div>

                          <div className="flex items-start gap-3">
                            <input
                              id="cutoff-enabled"
                              type="checkbox"
                              checked={cutoffEnabled}
                              onChange={e => setCutoffEnabled(e.target.checked)}
                              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <div className="flex-1">
                              <label htmlFor="cutoff-enabled" className="text-sm text-gray-800 cursor-pointer">
                                <span className="font-medium">Cutoff-tijd per dag</span>
                                <span className="block text-xs text-gray-500">
                                  Alles vanaf deze tijd (op elke dag) wordt niet gefactureerd. Optioneel.
                                </span>
                              </label>
                              {cutoffEnabled && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="time"
                                    value={cutoffTime}
                                    onChange={e => setCutoffTime(e.target.value)}
                                    step={300}
                                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:ring-primary-500"
                                  />
                                  <span className="text-xs text-gray-500">
                                    Events die om of na deze tijd starten worden overgeslagen.
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Week keuze */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            {periodWeeks === 1
                              ? 'Kies week'
                              : `Kies startweek (${periodWeeks} weken vanaf hier)`}
                          </label>
                          {openWeeks.length === 0 ? (
                            <div className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500">
                              Geen openstaande weken. Alle tolregels voor dit voertuig zijn al gefactureerd.
                            </div>
                          ) : (
                            <select
                              value={weekKey}
                              onChange={e => setWeekKey(e.target.value)}
                              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                            >
                              {openWeeks.map(w => (
                                <option key={`${w.year}-${w.week}`} value={`${w.year}-${w.week}`}>
                                  {w.label} · {w.events_count} events · {currency(w.total_amount)}
                                </option>
                              ))}
                            </select>
                          )}
                          {selectedWeeks.length > 0 && (
                            <div className="mt-2 rounded-md bg-primary-50 border border-primary-200 px-3 py-2 text-sm text-primary-900">
                              <div className="font-medium">
                                Gefactureerde weken ({selectedWeeks.length}):
                              </div>
                              <ul className="mt-1 space-y-0.5">
                                {selectedWeeks.map(w => (
                                  <li key={`${w.year}-${w.week}`} className="flex justify-between gap-4">
                                    <span>{w.label}</span>
                                    <span className="tabular-nums">{currency(w.total_amount)} · {w.events_count} events</span>
                                  </li>
                                ))}
                                <li className="flex justify-between gap-4 pt-1 border-t border-primary-200 font-semibold">
                                  <span>Totaal (excl. BTW)</span>
                                  <span className="tabular-nums">{currency(selectedTotal)}</span>
                                </li>
                              </ul>
                              {periodWeeks > 1 && selectedWeeks.length < periodWeeks && (
                                <div className="mt-1 text-xs text-amber-700">
                                  Let op: er zijn geen aaneensluitende openstaande volgweken gevonden;
                                  alleen {selectedWeeks.length} week/weken worden gefactureerd.
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Template */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Template</label>
                          <select
                            value={templateId}
                            onChange={e => setTemplateId(e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                          >
                            <option value="">— kies —</option>
                            {templates.map(t => (
                              <option key={t.id} value={t.id}>{t.naam}</option>
                            ))}
                          </select>
                        </div>

                        {/* Bedrijf */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Bedrijf om te factureren</label>
                          <select
                            value={bedrijfId}
                            onChange={e => setBedrijfId(e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                          >
                            <option value="">— kies —</option>
                            {companies.map(c => (
                              <option key={c.id} value={c.id}>{c.naam}</option>
                            ))}
                          </select>
                          {row.bedrijf_id && bedrijfId !== row.bedrijf_id && (
                            <p className="mt-1 text-xs text-amber-700">
                              Voertuig hoort standaard bij <strong>{row.bedrijf_naam}</strong>.
                            </p>
                          )}
                        </div>

                        {/* Administratie */}
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Administratie</label>
                          <select
                            value={administratieId}
                            onChange={e => setAdministratieId(e.target.value)}
                            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                          >
                            <option value="">— geen / standaard —</option>
                            {administraties.map(a => (
                              <option key={a.id} value={a.id}>{a.naam}</option>
                            ))}
                          </select>
                        </div>

                        {/* Datums */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Factuurdatum</label>
                            <input
                              type="date"
                              value={factuurdatum}
                              onChange={e => setFactuurdatum(e.target.value)}
                              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Vervaldatum</label>
                            <input
                              type="date"
                              value={vervaldatum}
                              onChange={e => setVervaldatum(e.target.value)}
                              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 -mt-1">
                          Tolheffing wordt zonder BTW gefactureerd (doorlopende post).
                        </p>

                        {/* Factuurnummer preview */}
                        {previewNumber && (
                          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-700">
                            Volgend factuurnummer: <span className="font-semibold text-gray-900">{previewNumber}</span>
                            <span className="text-xs text-gray-500 ml-2">(wordt automatisch toegekend)</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* PHASE 2 — PREVIEW */}
                {phase === 'preview' && created && (
                  <div className="max-h-[80vh] overflow-y-auto px-5 py-4 space-y-3">
                    <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900 flex items-start gap-2">
                      <CheckCircleIcon className="h-5 w-5 shrink-0 mt-0.5" />
                      <div>
                        Factuur <strong>{created.factuurnummer}</strong> is aangemaakt (concept).<br />
                        {created.events_marked} tolregel(s) zijn als gefactureerd gemarkeerd.
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div className="rounded-md border bg-white px-3 py-2">
                        <div className="text-xs uppercase text-gray-500">Bedrijf</div>
                        <div className="font-medium text-gray-900 truncate">{selectedBedrijf?.naam ?? '—'}</div>
                      </div>
                      <div className="rounded-md border bg-white px-3 py-2">
                        <div className="text-xs uppercase text-gray-500">Weken</div>
                        <div className="font-medium text-gray-900">{created.weeks.length}</div>
                      </div>
                      <div className="rounded-md border bg-white px-3 py-2">
                        <div className="text-xs uppercase text-gray-500">Subtotaal</div>
                        <div className="font-medium text-gray-900 tabular-nums">{currency(created.subtotaal)}</div>
                      </div>
                      <div className="rounded-md border bg-primary-50 px-3 py-2">
                        <div className="text-xs uppercase text-primary-700">Totaal incl. BTW</div>
                        <div className="font-semibold text-primary-800 tabular-nums">{currency(created.totaal)}</div>
                      </div>
                    </div>

                    {pdfUrl ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-gray-500">
                            Voorbeeld van de gegenereerde PDF-factuur.
                          </div>
                          <div className="flex gap-2">
                            <a
                              href={pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Openen in nieuw tabblad
                            </a>
                            <a
                              href={pdfUrl}
                              download={`Factuur-${created.factuurnummer}.pdf`}
                              className="inline-flex items-center rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
                            >
                              Downloaden
                            </a>
                          </div>
                        </div>
                        {/* Op desktop tonen we de iframe inline. Mobiele browsers
                           (met name iOS) renderen PDF's vaak niet betrouwbaar in
                           een iframe — daar valt de gebruiker terug op de knoppen
                           hierboven. */}
                        <iframe
                          src={pdfUrl}
                          title="Factuur voorbeeld"
                          className="hidden md:block w-full h-[55vh] rounded-md border border-gray-200 bg-gray-50"
                        />
                        <div className="md:hidden rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
                          PDF-voorbeeld wordt op mobiel niet inline getoond.<br />
                          Gebruik "Openen in nieuw tabblad" of "Downloaden".
                        </div>
                      </div>
                    ) : (
                      <div className="h-[40vh] flex items-center justify-center text-gray-400 border border-dashed rounded-md">
                        Voorbeeld wordt geladen…
                      </div>
                    )}
                  </div>
                )}

                {/* PHASE 3 — MAIL */}
                {phase === 'mail' && created && (
                  <div className="max-h-[80vh] overflow-y-auto px-5 py-4 space-y-3">
                    <div className="text-sm text-gray-700">
                      Kies de ontvangers voor factuur <strong>{created.factuurnummer}</strong>.
                      De tolheffing-bijlage wordt automatisch meegestuurd.
                    </div>

                    <div>
                      <div className="text-xs font-medium text-gray-700 mb-1">
                        Mailinglijst {selectedBedrijf?.naam ? `— ${selectedBedrijf.naam}` : ''}
                      </div>
                      {mailingContacts.length === 0 ? (
                        <div className="rounded-md border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500">
                          Geen actieve contacten in de mailinglijst van dit bedrijf.
                        </div>
                      ) : (
                        <div className="rounded-md border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
                          {mailingContacts.map(c => {
                            const checked = selectedEmails.has(c.email)
                            return (
                              <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => {
                                    setSelectedEmails(prev => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(c.email)
                                      else next.delete(c.email)
                                      return next
                                    })
                                  }}
                                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">{c.naam}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {c.email}{c.functie ? ` · ${c.functie}` : ''}
                                  </div>
                                </div>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Extra e-mailadressen (komma / puntkomma / spatie gescheiden)
                      </label>
                      <input
                        type="text"
                        value={extraEmail}
                        onChange={e => setExtraEmail(e.target.value)}
                        placeholder="andere@voorbeeld.nl, kopie@voorbeeld.nl"
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 bg-gray-50">
                  {phase === 'config' && (
                    <>
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900"
                        disabled={submitting}
                      >
                        Annuleren
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <DocumentTextIcon className="h-4 w-4" />
                        {submitting ? 'Aanmaken…' : 'Factuur aanmaken & voorbeeld tonen'}
                      </button>
                    </>
                  )}
                  {phase === 'preview' && (
                    <>
                      <button
                        type="button"
                        onClick={handleCloseWithoutMail}
                        className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 rounded-md hover:bg-gray-100"
                      >
                        Nee, sluiten (opgeslagen)
                      </button>
                      <button
                        type="button"
                        onClick={handleStartMail}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
                      >
                        <PaperAirplaneIcon className="h-4 w-4" />
                        Ja, direct mailen
                      </button>
                    </>
                  )}
                  {phase === 'mail' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPhase('preview')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 rounded-md hover:bg-gray-100"
                        disabled={sending}
                      >
                        <ArrowLeftIcon className="h-4 w-4" />
                        Terug
                      </button>
                      <button
                        type="button"
                        onClick={handleSend}
                        disabled={sending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <PaperAirplaneIcon className="h-4 w-4" />
                        {sending ? 'Verzenden…' : 'Verzenden'}
                      </button>
                    </>
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
