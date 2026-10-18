/**
 * Tolheffing per land exporteren: kies een periode en een land en zie per
 * kenteken welke ritten daar gereden zijn, met kilometers, bedrag en het
 * bedrijf waaraan het doorbelast kan worden.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi } from '@/api/tolling'
import type { BuitenlandOverzicht, BuitenlandParams } from '@/api/tolling'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Vaste keuzes naast de losse landcodes die de backend meestuurt. */
const VERZAMELKEUZES = [
  { code: 'buitenland', naam: 'Alles buiten Nederland' },
  { code: 'onbekend', naam: 'Land nog onbekend' },
]

function euro(bedrag: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(bedrag || 0)
}

function km(waarde: number): string {
  return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(waarde || 0)} km`
}

function dag(iso: string | null): string {
  if (!iso) return '-'
  const [jaar, maand, dagdeel] = iso.split('-')
  return `${dagdeel}-${maand}-${jaar}`
}

/** Standaard de afgelopen week, want zo komen de tolfacturen binnen. */
function standaardPeriode(): { van: string; tot: string } {
  const vandaag = new Date()
  const van = new Date(vandaag)
  van.setDate(van.getDate() - 7)
  const naar = (d: Date) => d.toLocaleDateString('sv-SE')
  return { van: naar(van), tot: naar(vandaag) }
}

export default function TolBuitenlandModal({ isOpen, onClose }: Props) {
  const standaard = standaardPeriode()
  const [van, setVan] = useState(standaard.van)
  const [tot, setTot] = useState(standaard.tot)
  const [land, setLand] = useState('buitenland')
  const [bezig, setBezig] = useState(false)
  const [exporteren, setExporteren] = useState(false)
  const [data, setData] = useState<BuitenlandOverzicht | null>(null)

  const parameters = useCallback((): BuitenlandParams => ({
    date_from: van,
    date_to: tot,
    land,
  }), [van, tot, land])

  const ophalen = useCallback(async () => {
    setBezig(true)
    try {
      setData(await tollingApi.buitenlandOverzicht(parameters()))
    } catch (e: any) {
      setData(null)
      toast.error(e?.response?.data?.detail || 'Ophalen mislukt')
    } finally {
      setBezig(false)
    }
  }, [parameters])

  useEffect(() => {
    if (isOpen) void ophalen()
  }, [isOpen, ophalen])

  const exporteer = async () => {
    setExporteren(true)
    try {
      const blob = await tollingApi.downloadBuitenlandExport(parameters())
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tolheffing-${land}-${van}-tm-${tot}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export mislukt')
    } finally {
      setExporteren(false)
    }
  }

  const keuzes = [...VERZAMELKEUZES, ...(data?.landkeuzes ?? [])]

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

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-5xl rounded-lg bg-white shadow-xl">
                <div className="flex items-start justify-between border-b px-5 py-4">
                  <div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      Exporteer buitenland
                    </Dialog.Title>
                    <p className="text-sm text-gray-500">
                      Per kenteken de ritten in het gekozen land, met periode, kilometers en bedrag.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Vanaf</span>
                      <input
                        type="date"
                        value={van}
                        onChange={e => setVan(e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Tot en met</span>
                      <input
                        type="date"
                        value={tot}
                        onChange={e => setTot(e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      <span className="mb-1 block">Land</span>
                      <select
                        value={land}
                        onChange={e => setLand(e.target.value)}
                        className="rounded-md border-gray-300 text-sm"
                      >
                        {keuzes.map(k => (
                          <option key={k.code} value={k.code}>{k.naam}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void ophalen()}
                      disabled={bezig}
                    >
                      <ArrowPathIcon className={`h-4 w-4 mr-1.5 ${bezig ? 'animate-spin' : ''}`} />
                      Ophalen
                    </button>
                  </div>

                  {bezig && <div className="py-10 text-center text-sm text-gray-400">Laden…</div>}

                  {!bezig && data && data.rijen.length === 0 && (
                    <div className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
                      Geen tolregels gevonden voor {data.periode}.
                    </div>
                  )}

                  {!bezig && data && data.rijen.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {data.per_land.map(l => (
                          <div key={l.land || 'leeg'} className="rounded-md border bg-gray-50 px-3 py-2">
                            <div className="text-xs uppercase tracking-wide text-gray-500">{l.land_naam}</div>
                            <div className="text-sm font-semibold text-gray-900">{euro(l.bedrag)}</div>
                            <div className="text-xs text-gray-500">
                              {l.kentekens} wagen{l.kentekens === 1 ? '' : 's'} · {l.regels} regels
                              {l.open_bedrag > 0 && ` · ${euro(l.open_bedrag)} nog open`}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="max-h-[50vh] overflow-auto">
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                              <th className="py-2 pr-3">Kenteken</th>
                              <th className="py-2 pr-3">Land</th>
                              <th className="py-2 pr-3">Bedrijf</th>
                              <th className="py-2 pr-3">Ritnummers</th>
                              <th className="py-2 pr-3">Periode</th>
                              <th className="py-2 pr-3 text-right">Regels</th>
                              <th className="py-2 pr-3 text-right">Afstand</th>
                              <th className="py-2 pr-3 text-right">Bedrag</th>
                              <th className="py-2 text-right">Nog open</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {data.rijen.map(r => (
                              <tr key={`${r.plate_normalized}|${r.land}|${r.bedrijf_id ?? ''}`}>
                                <td className="py-2 pr-3 font-medium text-gray-900">{r.plate_display}</td>
                                <td className="py-2 pr-3">{r.land_naam}</td>
                                <td className="py-2 pr-3 text-gray-700">
                                  {r.bedrijf_naam || <span className="text-amber-700">Geen bedrijf</span>}
                                </td>
                                <td className="py-2 pr-3 text-gray-600">{r.ritnummers.join(', ') || '-'}</td>
                                <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                                  {dag(r.eerste_dag)} – {dag(r.laatste_dag)}
                                </td>
                                <td className="py-2 pr-3 text-right text-gray-600">{r.regels}</td>
                                <td className="py-2 pr-3 text-right text-gray-600">{km(r.km)}</td>
                                <td className="py-2 pr-3 text-right font-medium text-gray-900">{euro(r.bedrag)}</td>
                                <td className="py-2 text-right">
                                  {r.open_bedrag > 0
                                    ? <span className="font-medium text-amber-700">{euro(r.open_bedrag)}</span>
                                    : <span className="text-gray-400">-</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <p className="text-xs text-gray-500">
                        Regels zonder bedrijf kun je niet doorbelasten. Controleer die eerst met
                        “Koppeling controleren”.
                      </p>
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t px-5 py-3">
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Sluiten
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void exporteer()}
                    disabled={exporteren || bezig || !data || data.rijen.length === 0}
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
                    {exporteren ? 'Bezig…' : 'Exporteren naar Excel'}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
