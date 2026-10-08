/**
 * Ritnummer en/of bedrijf van tolregels met terugwerkende kracht corrigeren.
 *
 * Bedoeld voor het geval dat te laat is doorgegeven dat een wagen onder een
 * ander ritnummer of voor een andere opdrachtgever reed. Alleen het ritnummer
 * en het bedrijf op de tolregels veranderen; bedragen, kilometers, wagen en
 * factuurstatus blijven ongemoeid. Voor het bevestigen wordt eerst getoond
 * hoeveel regels het betreft.
 */
import { Fragment, useEffect, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { ArrowPathIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi, RitnummerWijzigingResultaat } from '@/api/tolling'
import { getAllCompanies } from '@/api/companies'

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
  /** Bedrijf waarop nu gefilterd wordt; wordt als hint getoond. */
  huidigBedrijfId?: string | null
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
  huidigBedrijfId = null,
  onGewijzigd,
}: Props) {
  const [van, setVan] = useState(standaardVan)
  const [tot, setTot] = useState(standaardTot)
  const [naar, setNaar] = useState(voorstelRitnummer)
  // '' = bedrijf ongemoeid laten, '-' = bedrijf wissen, anders een bedrijf-id.
  const [naarBedrijf, setNaarBedrijf] = useState('')
  const [alleRitnummers, setAlleRitnummers] = useState(huidigRitnummer === null)
  const [inclusiefGefactureerd, setInclusiefGefactureerd] = useState(false)
  const [preview, setPreview] = useState<RitnummerWijzigingResultaat | null>(null)
  const [bezig, setBezig] = useState(false)
  const [opslaan, setOpslaan] = useState(false)
  const [bedrijven, setBedrijven] = useState<{ id: string; naam: string }[]>([])

  // Alle bedrijven ophalen, niet alleen die in deze periode al tolregels
  // hebben; een wagen kan juist naar een nieuw bedrijf verhuizen.
  useEffect(() => {
    if (!isOpen || bedrijven.length) return
    getAllCompanies()
      .then(lijst =>
        setBedrijven(
          lijst
            .map(c => ({ id: c.id, naam: c.naam || '(naamloos)' }))
            .sort((a, b) => a.naam.localeCompare(b.naam, 'nl-NL')),
        ),
      )
      .catch(() => toast.error('Bedrijven konden niet geladen worden'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Bij openen de velden terugzetten naar de meegegeven voorinvulling.
  useEffect(() => {
    if (!isOpen) return
    setVan(standaardVan)
    setTot(standaardTot)
    setNaar(voorstelRitnummer)
    setNaarBedrijf('')
    setAlleRitnummers(huidigRitnummer === null)
    setInclusiefGefactureerd(false)
    setPreview(null)
  }, [isOpen, standaardVan, standaardTot, voorstelRitnummer, huidigRitnummer])

  const filterRitnummer = alleRitnummers ? undefined : huidigRitnummer ?? ''
  const bedrijfVeld =
    naarBedrijf === '' ? undefined : { naar_bedrijf: naarBedrijf === '-' ? '' : naarBedrijf }
  const geldig = Boolean(
    van && tot && van <= tot && (naar.trim() || bedrijfVeld !== undefined),
  )

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
        ...(naar.trim() ? { naar_ritnummer: naar.trim() } : {}),
        ...(bedrijfVeld ?? {}),
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
  }, [isOpen, plate, van, tot, naar, naarBedrijf, alleRitnummers, huidigRitnummer,
      inclusiefGefactureerd, geldig])

  const toepassen = async () => {
    if (!geldig || !preview || preview.aantal === 0) return
    setOpslaan(true)
    try {
      const r = await tollingApi.wijzigRitnummer(plate, {
        van,
        tot,
        ...(filterRitnummer === undefined ? {} : { van_ritnummer: filterRitnummer }),
        ...(naar.trim() ? { naar_ritnummer: naar.trim() } : {}),
        ...(bedrijfVeld ?? {}),
        inclusief_gefactureerd: inclusiefGefactureerd,
      })
      const doelen = [
        r.ritnummer_gewijzigd ? `ritnummer ${r.naar_ritnummer}` : '',
        r.bedrijf_gewijzigd ? (r.naar_bedrijf_naam || 'geen bedrijf') : '',
      ].filter(Boolean)
      toast.success(`${r.aangepast} regel(s) gezet op ${doelen.join(' / ')}`)
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
                      Ritnummer of bedrijf corrigeren
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      {plateDisplay || plate} &middot; alleen het ritnummer en het bedrijf op
                      de tolregels veranderen.
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
                    <span className="mt-1 block text-xs text-gray-500">
                      Leeg laten = het ritnummer blijft zoals het is.
                    </span>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Nieuw bedrijf</span>
                    <select
                      value={naarBedrijf} onChange={e => setNaarBedrijf(e.target.value)}
                      className="mt-1 w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">Bedrijf niet wijzigen</option>
                      {bedrijven.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.naam}{b.id === huidigBedrijfId ? ' (huidig filter)' : ''}
                        </option>
                      ))}
                      <option value="-">Bedrijf leegmaken</option>
                    </select>
                    <span className="mt-1 block text-xs text-gray-500">
                      De regels vallen hierna in de export van dit bedrijf, met het
                      ritnummer dat eronder hoort.
                    </span>
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
                      <span className="text-gray-500">
                        Vul een periode in en kies een ritnummer of een bedrijf.
                      </span>
                    ) : preview ? (
                      preview.aantal === 0 ? (
                        <span className="text-gray-600">
                          Geen regels gevonden die aangepast moeten worden.
                        </span>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-gray-900">
                            <span className="font-semibold">{preview.aantal}</span> regel(s)
                            {preview.ritnummer_gewijzigd && (
                              <> krijgen ritnummer{' '}
                                <span className="font-semibold">{preview.naar_ritnummer}</span>
                              </>
                            )}
                            {preview.ritnummer_gewijzigd && preview.bedrijf_gewijzigd && ' en'}
                            {preview.bedrijf_gewijzigd && (
                              <> komen op{' '}
                                <span className="font-semibold">
                                  {preview.naar_bedrijf_naam || 'geen bedrijf'}
                                </span>
                              </>
                            )}
                            .
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
                    {opslaan ? 'Bezig\u2026' : 'Wijziging toepassen'}
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
