/**
 * De factuurstatus van tolregels met de hand omzetten.
 *
 * Soms is tol al afgerekend zonder dat er een eigen factuurregel tegenover
 * staat, bijvoorbeeld omdat de opdrachtgever hem zelf vergoedt. Dan blijft het
 * bedrag onterecht als openstaand staan. Hier zet je dat recht voor een
 * periode, eventueel ingeperkt op wagen en land. Er wordt geen factuur
 * aangemaakt; alleen de markering verschuift.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { CheckCircleIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi } from '@/api/tolling'
import type { MarkeerResultaat } from '@/api/tolling'

interface Props {
  isOpen: boolean
  onClose: () => void
  onKlaar?: () => void
  /** Vult het kentekenveld alvast in. */
  kenteken?: string
}

function euro(bedrag: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(bedrag || 0)
}

function landnaam(code: string): string {
  return code === 'onbekend' ? 'Land onbekend' : code
}

/** Alleen letters en cijfers, zodat 'bb6' ook op 'BB-625-L' aanslaat. */
function kaal(waarde: string): string {
  return waarde.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/** Standaard de vorige maand; daar gaat het meestal over. */
function vorigeMaand(): { van: string; tot: string } {
  const nu = new Date()
  const eerste = new Date(nu.getFullYear(), nu.getMonth() - 1, 1)
  const laatste = new Date(nu.getFullYear(), nu.getMonth(), 0)
  const naar = (d: Date) => d.toLocaleDateString('sv-SE')
  return { van: naar(eerste), tot: naar(laatste) }
}

export default function TolMarkeerModal({ isOpen, onClose, onKlaar, kenteken = '' }: Props) {
  const standaard = vorigeMaand()
  const [van, setVan] = useState(standaard.van)
  const [tot, setTot] = useState(standaard.tot)
  const [plaat, setPlaat] = useState(kenteken)
  const [land, setLand] = useState('')
  const [gefactureerd, setGefactureerd] = useState(true)
  const [resultaat, setResultaat] = useState<MarkeerResultaat | null>(null)
  const [alles, setAlles] = useState<MarkeerResultaat | null>(null)
  const [lijstOpen, setLijstOpen] = useState(false)
  const [laden, setLaden] = useState(false)
  const [bezig, setBezig] = useState(false)
  const zoekvak = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) setPlaat(kenteken)
  }, [isOpen, kenteken])

  useEffect(() => {
    const weg = (e: MouseEvent) => {
      if (zoekvak.current && !zoekvak.current.contains(e.target as Node)) setLijstOpen(false)
    }
    document.addEventListener('mousedown', weg)
    return () => document.removeEventListener('mousedown', weg)
  }, [])

  // Het ongefilterde beeld voedt de kentekenlijst en de landkeuze.
  useEffect(() => {
    if (!isOpen || !van || !tot) return
    let afgebroken = false
    tollingApi
      .markeerGefactureerd({ van, tot, gefactureerd, preview: true })
      .then((data) => { if (!afgebroken) setAlles(data) })
      .catch(() => { if (!afgebroken) setAlles(null) })
    return () => { afgebroken = true }
  }, [isOpen, van, tot, gefactureerd])

  const kijken = useCallback(async () => {
    if (!van || !tot) return
    setLaden(true)
    try {
      const data = await tollingApi.markeerGefactureerd({
        van, tot, kenteken: plaat, land, gefactureerd, preview: true,
      })
      setResultaat(data)
    } catch (e: any) {
      setResultaat(null)
      toast.error(e?.response?.data?.detail || 'Ophalen mislukt')
    } finally {
      setLaden(false)
    }
  }, [van, tot, plaat, land, gefactureerd])

  useEffect(() => {
    if (!isOpen) return
    const tijd = setTimeout(() => void kijken(), 300)
    return () => clearTimeout(tijd)
  }, [isOpen, kijken])

  /** Alleen kentekens die met het getypte beginnen, niet die het ergens bevatten. */
  const suggesties = useMemo(() => {
    const begin = kaal(plaat)
    return (alles?.per_wagen || [])
      .filter((w) => !begin || kaal(w.kenteken).startsWith(begin))
      .slice(0, 12)
  }, [alles, plaat])

  const landkeuzes = alles?.per_land.map((l) => l.land) || []

  const toepassen = async () => {
    setBezig(true)
    try {
      const data = await tollingApi.markeerGefactureerd({
        van, tot, kenteken: plaat, land, gefactureerd,
      })
      toast.success(
        `${data.gewijzigd} regels op ${gefactureerd ? 'gefactureerd' : 'open'} gezet (${euro(data.bedrag)})`,
      )
      await kijken()
      onKlaar?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Omzetten mislukt')
    } finally {
      setBezig(false)
    }
  }

  const veld = 'mt-1 w-full rounded-lg border-gray-400 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500'

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={bezig ? () => {} : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/50" />
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
              <Dialog.Panel className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-300">
                <div
                  className="flex items-start justify-between px-5 py-4 text-white"
                  style={{ backgroundColor: 'var(--color-sidebar)' }}
                >
                  <div>
                    <Dialog.Title className="text-base font-semibold text-white">
                      Factuurstatus omzetten
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-white/75">
                      Zet tolregels op gefactureerd of juist weer open, voor een periode en
                      eventueel voor een wagen of een land. Er wordt geen factuur aangemaakt.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="ml-4 rounded-lg p-1 text-white/70 transition hover:bg-white/15 hover:text-white"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-sm">
                      <span className="font-medium text-gray-700">Van</span>
                      <input type="date" value={van} onChange={(e) => setVan(e.target.value)} className={veld} />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium text-gray-700">Tot en met</span>
                      <input type="date" value={tot} onChange={(e) => setTot(e.target.value)} className={veld} />
                    </label>

                    <div className="relative block text-sm" ref={zoekvak}>
                      <span className="font-medium text-gray-700">Kenteken</span>
                      <div className="relative">
                        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          value={plaat}
                          onChange={(e) => { setPlaat(e.target.value); setLijstOpen(true) }}
                          onFocus={() => setLijstOpen(true)}
                          placeholder="Alle wagens"
                          className={`${veld} pl-9 pr-8 uppercase placeholder:normal-case`}
                        />
                        {plaat && (
                          <button
                            type="button"
                            onClick={() => { setPlaat(''); setLijstOpen(false) }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {lijstOpen && suggesties.length > 0 && (
                        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-300 bg-white py-1 shadow-lg">
                          {suggesties.map((w) => (
                            <li key={w.kenteken}>
                              <button
                                type="button"
                                onClick={() => { setPlaat(w.kenteken); setLijstOpen(false) }}
                                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                              >
                                <span className="font-medium text-gray-800">{w.kenteken || 'zonder kenteken'}</span>
                                <span className="text-xs tabular-nums text-gray-500">{euro(w.bedrag)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <label className="block text-sm">
                      <span className="font-medium text-gray-700">Land</span>
                      <select value={land} onChange={(e) => setLand(e.target.value)} className={veld}>
                        <option value="">Alle landen</option>
                        <option value="onbekend">Land onbekend</option>
                        {landkeuzes
                          .filter((l) => l !== 'onbekend')
                          .map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={gefactureerd}
                        onChange={() => setGefactureerd(true)}
                        className="text-primary-600 focus:ring-primary-500"
                      />
                      <span>Openstaande regels op gefactureerd zetten</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={!gefactureerd}
                        onChange={() => setGefactureerd(false)}
                        className="text-primary-600 focus:ring-primary-500"
                      />
                      <span>Markering weghalen</span>
                    </label>
                  </div>

                  {!gefactureerd && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                      Regels die aan een factuurregel hangen blijven ongemoeid. Die haal je weg via
                      de knop bij de wagen zelf, zodat de factuurregel meekomt.
                    </p>
                  )}

                  {laden && <p className="text-sm text-gray-500">Bezig met tellen...</p>}

                  {resultaat && !laden && (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-800">
                        <span className="font-semibold">{resultaat.aantal}</span> regels,{' '}
                        <span className="font-semibold">{euro(resultaat.bedrag)}</span>
                      </p>

                      {resultaat.per_land.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase text-gray-500">Per land</h3>
                          <ul className="mt-1 grid gap-x-6 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
                            {resultaat.per_land.map((l) => (
                              <li key={l.land} className="flex justify-between">
                                <span>{landnaam(l.land)}</span>
                                <span>{l.aantal} &middot; {euro(l.bedrag)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {resultaat.per_wagen.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold uppercase text-gray-500">Per wagen</h3>
                          <ul className="mt-1 grid gap-x-6 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
                            {resultaat.per_wagen.map((w) => (
                              <li key={w.kenteken} className="flex justify-between">
                                <span>{w.kenteken || 'zonder kenteken'}</span>
                                <span>{w.aantal} &middot; {euro(w.bedrag)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-gray-300 px-5 py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={bezig}
                    className="rounded-lg border border-gray-400 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Sluiten
                  </button>
                  <button
                    type="button"
                    onClick={() => void toepassen()}
                    disabled={bezig || laden || !resultaat || resultaat.aantal === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-sidebar)' }}
                  >
                    <CheckCircleIcon className="h-4 w-4" />
                    {bezig ? 'Bezig...' : `${resultaat?.aantal ?? 0} regels omzetten`}
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
