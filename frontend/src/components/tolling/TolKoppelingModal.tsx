/**
 * Tolregels opnieuw tegen de planning leggen over een zelfgekozen periode.
 *
 * De startdatum staat standaard op de eerste van de huidige maand, want
 * eerdere maanden zijn meestal al doorbelast. De gebruiker mag hem aanpassen;
 * er staat nergens een vaste datum vast.
 */
import { Fragment, useEffect, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import toast from 'react-hot-toast'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import { KoppelingUitkomst, tollingApi } from '@/api/tolling'

const euro = (bedrag: number) =>
  bedrag.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })

const datumKort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
  })

interface Props {
  open: boolean
  onClose: () => void
  onKlaar?: () => void
}

export default function TolKoppelingModal({ open, onClose, onKlaar }: Props) {
  const [vanaf, setVanaf] = useState('')
  const [tot, setTot] = useState('')
  const [bezig, setBezig] = useState(false)
  const [uitkomst, setUitkomst] = useState<KoppelingUitkomst | null>(null)

  useEffect(() => {
    if (!open) return
    setUitkomst(null)
    tollingApi
      .koppelingStandaard()
      .then((d) => setVanaf((huidig) => huidig || d.standaard_vanaf))
      .catch(() => {
        const nu = new Date()
        setVanaf(
          (huidig) =>
            huidig ||
            `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`,
        )
      })
  }, [open])

  const uitvoeren = async (toepassen: boolean) => {
    if (!vanaf) {
      toast.error('Kies een startdatum')
      return
    }
    setBezig(true)
    try {
      const data = await tollingApi.controleerKoppeling(vanaf, tot || null, toepassen)
      setUitkomst(data)
      if (toepassen) {
        toast.success(
          data.toegepast
            ? `${data.toegepast} tolregels bijgewerkt`
            : 'Er viel niets bij te werken',
        )
        onKlaar?.()
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Controleren mislukt')
    } finally {
      setBezig(false)
    }
  }

  const tonen = uitkomst && !uitkomst.toepassen
  const nogDoen = (uitkomst?.te_wijzigen ?? 0) + (uitkomst?.alleen_bron ?? 0)

  return (
    <Transition.Root show={open} as={Fragment}>
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
          <div className="fixed inset-0 bg-gray-900/50" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-4 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform rounded-t-2xl bg-white shadow-xl transition-all sm:rounded-2xl">
                <div className="flex items-start justify-between border-b border-gray-200 px-4 py-4 sm:px-6">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      Koppeling met de planning controleren
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      Zet de tolregels op het ritnummer en het bedrijf die de planning
                      nu aangeeft. Gefactureerde regels blijven staan.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="ml-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4 px-4 py-4 sm:px-6">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Vanaf</span>
                      <input
                        type="date"
                        value={vanaf}
                        onChange={(e) => {
                          setVanaf(e.target.value)
                          setUitkomst(null)
                        }}
                        className="mt-1 block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Tot en met <span className="text-gray-400">(optioneel)</span>
                      </span>
                      <input
                        type="date"
                        value={tot}
                        onChange={(e) => {
                          setTot(e.target.value)
                          setUitkomst(null)
                        }}
                        className="mt-1 block w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </label>
                  </div>

                  {!uitkomst && (
                    <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      Er wordt eerst alleen gekeken. Je ziet wat er zou veranderen
                      voordat er iets wordt opgeslagen.
                    </p>
                  )}

                  {uitkomst && (
                    <div className="space-y-4">
                      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          ['Bekeken', uitkomst.bekeken],
                          ['Klopt al', uitkomst.klopt],
                          ['Andere rit', uitkomst.te_wijzigen],
                          ['Geen planning', uitkomst.ongepland],
                        ].map(([label, waarde]) => (
                          <div
                            key={label as string}
                            className="rounded-lg border border-gray-200 px-3 py-2"
                          >
                            <dt className="text-xs text-gray-500">{label}</dt>
                            <dd className="text-lg font-semibold text-gray-900">
                              {waarde as number}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      {uitkomst.gefactureerd_overgeslagen > 0 && (
                        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>
                            {uitkomst.gefactureerd_overgeslagen} regels in deze periode
                            staan al op een factuur en zijn overgeslagen.
                          </span>
                        </p>
                      )}

                      {uitkomst.dubbel > 0 && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          {uitkomst.dubbel} regels vallen op een dag met meer dan één
                          planningsregel voor dezelfde wagen. Die worden met rust
                          gelaten.
                        </p>
                      )}

                      {uitkomst.wijzigingen.length > 0 ? (
                        <div className="overflow-hidden rounded-lg border border-gray-200">
                          <div className="max-h-72 overflow-y-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                              <thead className="sticky top-0 bg-gray-50">
                                <tr className="text-left text-xs uppercase text-gray-500">
                                  <th className="px-3 py-2">Wagen</th>
                                  <th className="px-3 py-2">Dag</th>
                                  <th className="px-3 py-2">Van</th>
                                  <th className="px-3 py-2">Naar</th>
                                  <th className="px-3 py-2 text-right">Bedrag</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {uitkomst.wijzigingen.map((rij, i) => (
                                  <tr key={`${rij.kenteken}-${rij.datum}-${i}`}>
                                    <td className="px-3 py-2 font-medium text-gray-900">
                                      {rij.kenteken}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">
                                      {datumKort(rij.datum)}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">
                                      {rij.van_ritnummer || '—'}
                                      {rij.van_bedrijf && (
                                        <span className="block text-xs text-gray-400">
                                          {rij.van_bedrijf}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 font-medium text-gray-900">
                                      {rij.naar_ritnummer || '—'}
                                      {rij.naar_bedrijf && (
                                        <span className="block text-xs font-normal text-gray-400">
                                          {rij.naar_bedrijf}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-gray-600">
                                      {euro(rij.bedrag)}
                                      <span className="block text-xs text-gray-400">
                                        {rij.regels} regels
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <p className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                          <CheckCircleIcon className="h-5 w-5 flex-shrink-0" />
                          Geen enkele tolregel staat op een ander ritnummer dan de
                          planning aangeeft.
                        </p>
                      )}

                      {uitkomst.alleen_bron > 0 && (
                        <p className="text-sm text-gray-500">
                          Daarnaast {uitkomst.alleen_bron} regels waarbij rit en bedrijf
                          al goed stonden; alleen de herkomst wordt bijgewerkt.
                        </p>
                      )}

                      {uitkomst.verweesd.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="text-sm font-medium text-amber-900">
                            {uitkomst.verweesd.length} dagen met een ritnummer uit de
                            planning terwijl die planningsregel er niet meer is
                          </p>
                          <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
                            {uitkomst.verweesd.slice(0, 10).map((rij, i) => (
                              <li key={`${rij.kenteken}-${rij.datum}-${i}`}>
                                {rij.kenteken} {datumKort(rij.datum)} — {rij.ritnummer}{' '}
                                ({rij.regels} regels, {euro(rij.bedrag)})
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-xs text-amber-700">
                            Deze worden niet aangepast. Controleer de planning van die
                            dagen.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Sluiten
                  </button>
                  <button
                    type="button"
                    disabled={bezig}
                    onClick={() => uitvoeren(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${bezig ? 'animate-spin' : ''}`} />
                    Controleren
                  </button>
                  {tonen && nogDoen > 0 && (
                    <button
                      type="button"
                      disabled={bezig}
                      onClick={() => uitvoeren(true)}
                      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {uitkomst?.te_wijzigen
                        ? `${uitkomst.te_wijzigen} regels doorvoeren`
                        : 'Herkomst bijwerken'}
                    </button>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}
