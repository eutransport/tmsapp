/**
 * Ritnummer van tolregels met terugwerkende kracht corrigeren.
 *
 * Bedoeld voor het geval dat te laat is doorgegeven dat een wagen onder een
 * ander ritnummer reed. Alleen het ritnummer op de tolregels verandert;
 * bedragen, kilometers, wagen en factuurstatus blijven ongemoeid. Voor het
 * bevestigen wordt eerst getoond hoeveel regels het betreft.
 */
import { Fragment, useEffect, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { ArrowPathIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi, RitnummerWijzigingResultaat } from '@/api/tolling'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Kenteken waarvan de regels aangepast worden. */
  plate: string
  plateDisplay?: string
  /** Voorinvulling van de periode (jjjj-mm-dd). */
  standaardVan: string
  standaardTot: string
  /** Ritnummer waarop nu gefilterd wordt; null = alle ritnummers. */
  huidigRitnummer: string | null
  /** Ritnummer dat als nieuwe waarde wordt voorgesteld. */
  voorstelRitnummer?: string
  /** Keuzelijst met bekende ritnummers. */
  bekendeRitnummers?: string[]
  /** Wordt aangeroepen na een geslaagde wijziging. */
  onGewijzigd?: (resultaat: RitnummerWijzigingResultaat) => void
}

function euro(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function km(n: number): string {
  return `${(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km`
}

export default function RitnummerCorrectieDialog({
  isOpen,
  onClose,
  plate,
  plateDisplay,
  standaardVan,
  standaardTot,
  huidigRitnummer,
  voorstelRitnummer = '',
  bekendeRitnummers = [],
  onGewijzigd,
}: Props) {
  const [van, setVan] = useState(standaardVan)
  const [tot, setTot] = useState(standaardTot)
  const [naar, setNaar] = useState(voorstelRitnummer)
  const [alleRitnummers, setAlleRitnummers] = useState(huidigRitnummer === null)
  const [inclusiefGefactureerd, setInclusiefGefactureerd] = useState(false)
  const [preview, setPreview] = useState<RitnummerWijzigingResultaat | null>(null)
  const [bezig, setBezig] = useState(false)
  const [opslaan, setOpslaan] = useState(false)

  // Bij openen de velden terugzetten naar de meegegeven voorinvulling.
  useEffect(() => {
    if (!isOpen) return
    setVan(standaardVan)
    setTot(standaardTot)
    setNaar(voorstelRitnummer)
    setAlleRitnummers(huidigRitnummer === null)
    setInclusiefGefactureerd(false)
    setPreview(null)
  }, [isOpen, standaardVan, standaardTot, voorstelRitnummer, huidigRitnummer])

  const filterRitnummer = alleRitnummers ? undefined : huidigRitnummer ?? ''
  const geldig = Boolean(van && tot && naar.trim() && van <= tot)

  // Zodra de selectie verandert opnieuw tellen, zodat het aantal altijd klopt
  // met wat er straks daadwerkelijk aangepast wordt.
  useEffect(() => {
    if (!isOpen || !geldig) {
      setPreview(null)
      return
    }
    let verouderd = false
    setBezig(true)
    tollingApi
      .wijzigRitnummer(plate, {
        van,
        tot,
        ...(filterRitnummer === undefined ? {} : { van_ritnummer: filterRitnummer }),
        naar_ritnummer: naar.trim(),
        inclusief_gefactureerd: inclusiefGefactureerd,
        preview: true,
      })
      .then(r => {
        if (!verouderd) setPreview(r)
      })
      .catch(() => {
        if (!verouderd) setPreview(null)
      })
      .finally(() => {
        if (!verouderd) setBezig(false)
      })
    return () => {
      verouderd = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, plate, van, tot, naar, alleRitnummers, huidigRitnummer, inclusiefGefactureerd, geldig])

  const toepassen = async () => {
    if (!geldig || !preview || preview.aantal === 0) return
    setOpslaan(true)
    try {
      const r = await tollingApi.wijzigRitnummer(plate, {
        van,
        tot,
        ...(filterRitnummer === undefined ? {} : { van_ritnummer: filterRitnummer }),
        naar_ritnummer: naar.trim(),
        inclusief_gefactureerd: inclusiefGefactureerd,
      })
      toast.success(`${r.aangepast} regel(s) gezet op ritnummer ${r.naar_ritnummer}`)
      onGewijzigd?.(r)
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Wijzigen is niet gelukt')
    } finally {
      setOpslaan(false)
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      Ritnummer corrigeren
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      {plateDisplay || plate} &middot; alleen het ritnummer op de tolregels
                      verandert.
                    </p>
                  </div>
                  <button
                    type="button" onClick={onClose}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Van</span>
                      <input
                        type="date" value={van} onChange={e => setVan(e.target.value)}
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Tot en met</span>
                      <input
                        type="date" value={tot} onChange={e => setTot(e.target.value)}
                        className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                  {van > tot && (
                    <p className="text-sm text-red-600">De einddatum ligt voor de begindatum.</p>
                  )}

                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Nieuw ritnummer</span>
                    <input
                      type="text" value={naar} onChange={e => setNaar(e.target.value)}
                      list="bekende-ritnummers" maxLength={50} placeholder="Bijvoorbeeld 800"
                      className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                    <datalist id="bekende-ritnummers">
                      {bekendeRitnummers.map(r => <option key={r} value={r} />)}
                    </datalist>
                  </label>

                  <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox" checked={alleRitnummers}
                        onChange={e => setAlleRitnummers(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        Alle ritnummers in deze periode meenemen
                        {huidigRitnummer !== null && !alleRitnummers && (
                          <span className="block text-xs text-gray-500">
                            Nu alleen regels met ritnummer{' '}
                            {huidigRitnummer || '(leeg)'}.
                          </span>
                        )}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox" checked={inclusiefGefactureerd}
                        onChange={e => setInclusiefGefactureerd(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>
                        Ook al gefactureerde regels aanpassen
                        <span className="block text-xs text-gray-500">
                          De factuur zelf verandert hier niet door.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-3 text-sm">
                    {bezig ? (
                      <span className="flex items-center gap-2 text-gray-500">
                        <ArrowPathIcon className="h-4 w-4 animate-spin" /> Bezig met tellen&hellip;
                      </span>
                    ) : !geldig ? (
                      <span className="text-gray-500">Vul een periode en een ritnummer in.</span>
                    ) : preview ? (
                      preview.aantal === 0 ? (
                        <span className="text-gray-600">
                          Geen regels gevonden die aangepast moeten worden.
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-gray-900">
                            <span className="font-semibold">{preview.aantal}</span> regel(s) krijgen
                            ritnummer <span className="font-semibold">{preview.naar_ritnummer}</span>.
                          </p>
                          <p className="text-gray-600">
                            {km(preview.totaal_km)} &middot; {euro(preview.totaal_bedrag)}
                          </p>
                          {preview.gefactureerd_aantal > 0 && (
                            <p className="flex items-start gap-1.5 text-amber-700">
                              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>
                                {preview.gefactureerd_aantal} regel(s) in deze periode zijn al
                                gefactureerd
                                {preview.inclusief_gefactureerd
                                  ? ' en worden meegenomen.'
                                  : ' en worden overgeslagen.'}
                              </span>
                            </p>
                          )}
                        </div>
                      )
                    ) : (
                      <span className="text-gray-500">Tellen is niet gelukt.</span>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button" onClick={onClose}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Annuleren
                  </button>
                  <button
                    type="button" onClick={toepassen}
                    disabled={!geldig || bezig || opslaan || !preview || preview.aantal === 0}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {opslaan ? 'Bezig\u2026' : 'Ritnummer wijzigen'}
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
