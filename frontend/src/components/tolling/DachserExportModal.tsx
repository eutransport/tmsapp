/**
 * Tolheffing exporteren per bedrijf: kies een periode en een bedrijf, koppel
 * per route een carrier en download een Excel-bestand in de Dachser-opmaak
 * (logo, donkerblauwe koprij met gouden tekst en een filter per kolom).
 * Weekenden worden standaard niet meegenomen.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi, DachserPreview } from '@/api/tolling'
import { getAllCompanies } from '@/api/companies'
import type { Company } from '@/types'

interface Props {
  isOpen: boolean
  onClose: () => void
}

function firstDayOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE')
}

function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function euro(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function km(n: number): string {
  return `${(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} km`
}

/** Leest een foutmelding uit een axios-error waarvan het antwoord een Blob is. */
async function blobErrorMessage(err: any): Promise<string | null> {
  const data = err?.response?.data
  if (!data) return null
  if (typeof data === 'string') return data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      return parsed?.detail || text
    } catch {
      return null
    }
  }
  return data.detail || null
}

export default function DachserExportModal({ isOpen, onClose }: Props) {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [bedrijfId, setBedrijfId] = useState('')
  const [excludeWeekend, setExcludeWeekend] = useState(true)
  const [preview, setPreview] = useState<DachserPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [carriers, setCarriers] = useState<Record<string, string>>({})
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})
  const [bulkCarrier, setBulkCarrier] = useState('')

  useEffect(() => {
    if (!isOpen) return
    getAllCompanies()
      .then(setCompanies)
      .catch(() => toast.error('Kon bedrijven niet laden'))
    loadPreview(dateFrom, dateTo, bedrijfId, excludeWeekend)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const loadPreview = async (
    from: string,
    to: string,
    bedrijf: string,
    noWeekend: boolean,
  ) => {
    setLoading(true)
    try {
      const data = await tollingApi.dachserPreview({
        date_from: from,
        date_to: to,
        bedrijf: bedrijf || undefined,
        exclude_weekend: noWeekend,
      })
      setPreview(data)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon voorbeeld niet laden')
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }

  const handleBedrijfChange = (value: string) => {
    setBedrijfId(value)
    setExcluded({})
    loadPreview(dateFrom, dateTo, value, excludeWeekend)
  }

  const handleWeekendChange = (value: boolean) => {
    setExcludeWeekend(value)
    loadPreview(dateFrom, dateTo, bedrijfId, value)
  }

  const includedRoutes = useMemo(
    () => (preview?.routes ?? []).filter(r => !excluded[r.route]),
    [preview, excluded],
  )

  const totals = useMemo(() => {
    return includedRoutes.reduce(
      (acc, r) => ({
        rows: acc.rows + r.rows,
        totalKm: acc.totalKm + r.total_km,
        totalAmount: acc.totalAmount + r.total_amount,
      }),
      { rows: 0, totalKm: 0, totalAmount: 0 },
    )
  }, [includedRoutes])

  const applyBulkCarrier = (name: string) => {
    setBulkCarrier(name)
    if (!name || !preview) return
    const next: Record<string, string> = {}
    preview.routes.forEach(r => { next[r.route] = name })
    setCarriers(next)
  }

  const handleExport = async () => {
    if (!preview || includedRoutes.length === 0) {
      toast.error('Selecteer minimaal één route.')
      return
    }
    setExporting(true)
    try {
      const blob = await tollingApi.dachserExport({
        date_from: dateFrom,
        date_to: dateTo,
        bedrijf: bedrijfId || undefined,
        carriers,
        default_carrier: bulkCarrier || undefined,
        routes: includedRoutes.map(r => r.route),
        exclude_weekend: excludeWeekend,
        country: 'NL',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const naam = preview?.companies.find(c => c.bedrijf_id === bedrijfId)?.bedrijf_naam
      const slug = (naam || 'tol').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
      a.download = `${slug}_${dateFrom}_${dateTo}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Export gedownload.')
    } catch (e: any) {
      const message = await blobErrorMessage(e)
      toast.error(message || 'Export mislukt')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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

        <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            enterTo="opacity-100 translate-y-0 sm:scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
          >
            <Dialog.Panel className="flex max-h-[92vh] w-full max-w-3xl transform flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/5 sm:max-h-[90vh] sm:rounded-2xl">
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-[#002060] px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Dialog.Title className="text-sm font-semibold text-[#FFC000] sm:text-base">
                    Exporteer per bedrijf
                  </Dialog.Title>
                  <p className="truncate text-[11px] text-white/70">
                    Kies een periode en bedrijf, en koppel per route een carrier.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
                  aria-label="Sluiten"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                {/* Periode */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">Van</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">Tot en met</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => loadPreview(dateFrom, dateTo, bedrijfId, excludeWeekend)}
                      disabled={loading}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                      Ophalen
                    </button>
                  </div>
                </div>

                {/* Bedrijfsfilter */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Bedrijf</label>
                  <select
                    value={bedrijfId}
                    onChange={e => handleBedrijfChange(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Alle bedrijven</option>
                    {(preview?.companies ?? []).map(c => (
                      <option key={c.bedrijf_id || '__none__'} value={c.bedrijf_id}>
                        {c.bedrijf_naam} ({c.routes.length} route{c.routes.length === 1 ? '' : 's'})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Alleen de routes die aan dit bedrijf gekoppeld zijn worden geëxporteerd.
                  </p>
                </div>

                {/* Weekenden */}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={excludeWeekend}
                    onChange={e => handleWeekendChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">
                    Weekenden niet meenemen
                    <span className="block text-[11px] text-gray-500">
                      Zaterdag en zondag worden overgeslagen.
                    </span>
                  </span>
                </label>

                {/* Carrier voor alle routes */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Carrier voor alle routes (optioneel)
                  </label>
                  <select
                    value={bulkCarrier}
                    onChange={e => applyBulkCarrier(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">— kies een bedrijf —</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.naam}>{c.naam}</option>
                    ))}
                  </select>
                </div>

                {loading ? (
                  <div className="py-8 text-center text-sm text-gray-500">Laden…</div>
                ) : !preview || preview.routes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    {bedrijfId
                      ? 'Geen tolheffing gevonden voor dit bedrijf in deze periode.'
                      : 'Geen tolheffing gevonden in deze periode.'}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs uppercase tracking-wide text-gray-600">
                      {preview.routes.length} route{preview.routes.length === 1 ? '' : 's'} · carrier per route
                    </div>

                    <ul className="divide-y divide-gray-100">
                      {preview.routes.map(r => {
                        const isExcluded = !!excluded[r.route]
                        return (
                          <li key={r.route || '__none__'} className={`p-3 ${isExcluded ? 'bg-gray-50 opacity-60' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                              <label className="flex min-w-0 items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={e =>
                                    setExcluded(prev => ({ ...prev, [r.route]: !e.target.checked }))
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-medium text-gray-900">{r.label}</span>
                                  <span className="block truncate text-[11px] text-gray-500">
                                    {r.plates.join(', ')} · {r.rows} regel{r.rows === 1 ? '' : 's'}
                                  </span>
                                </span>
                              </label>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-semibold text-gray-900">{euro(r.total_amount)}</div>
                                <div className="text-[11px] text-gray-500">{km(r.total_km)}</div>
                              </div>
                            </div>

                            <select
                              value={carriers[r.route] || ''}
                              onChange={e =>
                                setCarriers(prev => ({ ...prev, [r.route]: e.target.value }))
                              }
                              disabled={isExcluded}
                              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-100"
                            >
                              <option value="">— carrier kiezen —</option>
                              {companies.map(c => (
                                <option key={c.id} value={c.naam}>{c.naam}</option>
                              ))}
                            </select>
                          </li>
                        )
                      })}
                    </ul>

                    <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                      <span className="font-medium text-gray-700">
                        Totaal ({totals.rows} regel{totals.rows === 1 ? '' : 's'})
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold text-gray-900">{euro(totals.totalAmount)}</span>
                        <span className="block text-[11px] text-gray-500">{km(totals.totalKm)}</span>
                      </span>
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-gray-500">
                  Country staat voorlopig vast op <strong>NL</strong>. Total tol kilometers is het
                  totaal per route, kenteken en dag; meerdere ritten op dezelfde dag komen als
                  losse regels onder elkaar te staan.
                </p>
              </div>

              {/* Footer */}
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting || loading || totals.rows === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#002060] px-4 py-2 text-sm font-medium text-white hover:bg-[#00184a] disabled:opacity-50"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {exporting ? 'Bezig…' : 'Exporteer naar Excel'}
                </button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  )
}
