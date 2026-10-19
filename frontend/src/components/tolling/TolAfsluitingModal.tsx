/**
 * Een tolperiode dichtzetten vanuit het tolheffing-importmenu.
 *
 * Alles tot en met de gekozen dag verdwijnt uit de overzichten: passages,
 * afrekeningen, openstaande toldagen, privé-registraties en de bijbehorende
 * imports. Er wordt niets weggegooid, dus een foute afsluiting is terug te
 * draaien. Omdat dit het hele tolbeeld raakt vragen we naast het vinkje ook om
 * de code uit de authenticator, of om het wachtwoord als er geen 2FA aan staat.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tolAfsluitingApi } from '@/api/tolAfsluiting'
import type { Afsluiting, AfsluitingVoorbeeld, Bevestiging } from '@/api/tolAfsluiting'

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Wordt aangeroepen als er daadwerkelijk iets veranderd is. */
  onKlaar?: () => void
}

function euro(bedrag: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(bedrag || 0)
}

function dag(iso: string | null): string {
  if (!iso) return '-'
  const [jaar, maand, dagdeel] = iso.split('T')[0].split('-')
  return `${dagdeel}-${maand}-${jaar}`
}

/** Standaard de laatste dag van de vorige maand; zo sluit je meestal af. */
function vorigeMaandEind(): string {
  const d = new Date()
  d.setDate(0)
  return d.toLocaleDateString('sv-SE')
}

export default function TolAfsluitingModal({ isOpen, onClose, onKlaar }: Props) {
  const [totDatum, setTotDatum] = useState(vorigeMaandEind)
  const [omschrijving, setOmschrijving] = useState('')
  const [openstaandMeenemen, setOpenstaandMeenemen] = useState(false)
  const [bevestigd, setBevestigd] = useState(false)
  const [geheim, setGeheim] = useState('')
  const [voorbeeld, setVoorbeeld] = useState<AfsluitingVoorbeeld | null>(null)
  const [afsluitingen, setAfsluitingen] = useState<Afsluiting[]>([])
  const [tweefactor, setTweefactor] = useState(true)
  const [laden, setLaden] = useState(false)
  const [bezig, setBezig] = useState(false)

  const lijstOphalen = useCallback(async () => {
    try {
      const data = await tolAfsluitingApi.overzicht()
      setAfsluitingen(data.afsluitingen)
      setTweefactor(data.tweefactor)
    } catch {
      /* De lijst is bijzaak; het afsluiten zelf gaat gewoon door. */
    }
  }, [])

  const voorbeeldOphalen = useCallback(async () => {
    if (!totDatum) return
    setLaden(true)
    try {
      setVoorbeeld(await tolAfsluitingApi.voorbeeld(totDatum))
    } catch (e: any) {
      setVoorbeeld(null)
      toast.error(e?.response?.data?.detail || 'Ophalen mislukt')
    } finally {
      setLaden(false)
    }
  }, [totDatum])

  useEffect(() => {
    if (!isOpen) return
    void lijstOphalen()
    void voorbeeldOphalen()
  }, [isOpen, lijstOphalen, voorbeeldOphalen])

  const bevestiging = (): Bevestiging =>
    tweefactor ? { bevestigd: true, code: geheim } : { bevestigd: true, wachtwoord: geheim }

  const leegmaken = () => {
    setBevestigd(false)
    setGeheim('')
    setOmschrijving('')
    setOpenstaandMeenemen(false)
  }

  const afsluiten = async () => {
    setBezig(true)
    try {
      await tolAfsluitingApi.afsluiten({
        ...bevestiging(),
        tot_datum: totDatum,
        omschrijving,
        openstaand_meenemen: openstaandMeenemen,
      })
      toast.success(`Tolheffing afgesloten tot en met ${dag(totDatum)}`)
      leegmaken()
      await lijstOphalen()
      await voorbeeldOphalen()
      onKlaar?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Afsluiten mislukt')
    } finally {
      setBezig(false)
    }
  }

  const terugdraaien = async (afsluiting: Afsluiting) => {
    if (!bevestigd || !geheim) {
      toast.error('Vink eerst de bevestiging aan en vul je code of wachtwoord in.')
      return
    }
    setBezig(true)
    try {
      const uitkomst = await tolAfsluitingApi.terugdraaien(afsluiting.id, bevestiging())
      toast.success(`${uitkomst.passages} passages staan weer in de lopende administratie`)
      leegmaken()
      await lijstOphalen()
      await voorbeeldOphalen()
      onKlaar?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Terugdraaien mislukt')
    } finally {
      setBezig(false)
    }
  }

  const klaarVoorAfsluiten = bevestigd && geheim.length > 0 && !bezig && !!voorbeeld
  const meegenomen = voorbeeld
    ? voorbeeld.gefactureerd.aantal + (openstaandMeenemen ? voorbeeld.openstaand.aantal : 0)
    : 0

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
              <Dialog.Panel className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
                <div className="flex items-start justify-between border-b px-5 py-4">
                  <div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      Periode afsluiten
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      Alles tot en met de gekozen dag gaat naar het archief en verdwijnt uit de
                      tolheffing, tol buiten de uren, de tolafrekening en tol versus facturatie.
                      Er wordt niets verwijderd.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="font-medium text-gray-700">Afsluiten tot en met</span>
                      <input
                        type="date"
                        value={totDatum}
                        onChange={(e) => setTotDatum(e.target.value)}
                        className="mt-1 w-full rounded border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-medium text-gray-700">Omschrijving (optioneel)</span>
                      <input
                        type="text"
                        value={omschrijving}
                        onChange={(e) => setOmschrijving(e.target.value)}
                        placeholder="Bijvoorbeeld: boekjaar 2026 t/m augustus"
                        className="mt-1 w-full rounded border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      />
                    </label>
                  </div>

                  {laden && <p className="text-sm text-gray-500">Bezig met tellen…</p>}

                  {voorbeeld && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-xs uppercase text-gray-500">Gefactureerd</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {voorbeeld.gefactureerd.aantal}
                          </p>
                          <p className="text-sm text-gray-600">{euro(voorbeeld.gefactureerd.bedrag)}</p>
                        </div>
                        <div className="rounded border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs uppercase text-amber-700">Nog niet gefactureerd</p>
                          <p className="text-lg font-semibold text-amber-900">
                            {voorbeeld.openstaand.aantal}
                          </p>
                          <p className="text-sm text-amber-800">{euro(voorbeeld.openstaand.bedrag)}</p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-xs uppercase text-gray-500">Tolafrekeningen</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {voorbeeld.afrekeningen.aantal}
                          </p>
                          <p className="text-sm text-gray-600">{euro(voorbeeld.afrekeningen.bedrag)}</p>
                        </div>
                        <div className="rounded border border-gray-200 bg-gray-50 p-3">
                          <p className="text-xs uppercase text-gray-500">Overig</p>
                          <p className="text-sm text-gray-700">{voorbeeld.toldagen} openstaande toldagen</p>
                          <p className="text-sm text-gray-700">
                            {voorbeeld.prive_registraties} privé-registraties
                          </p>
                        </div>
                      </div>

                      {voorbeeld.eerdere_afsluiting && (
                        <p className="text-sm text-gray-500">
                          Laatste afsluiting liep tot en met {dag(voorbeeld.eerdere_afsluiting)}.
                        </p>
                      )}

                      {voorbeeld.openstaand.aantal > 0 && (
                        <div className="rounded border border-amber-200 bg-amber-50 p-3">
                          <p className="text-sm text-amber-900">
                            Deze passages staan nog niet op een factuur. Standaard blijven ze staan
                            en schuiven ze vanzelf het archief in zodra ze gefactureerd worden.
                          </p>
                          {voorbeeld.openstaand.per_wagen.length > 0 && (
                            <ul className="mt-2 grid gap-x-6 text-xs text-amber-800 sm:grid-cols-2 lg:grid-cols-3">
                              {voorbeeld.openstaand.per_wagen.map((w) => (
                                <li key={w.kenteken} className="flex justify-between">
                                  <span>{w.kenteken || 'zonder kenteken'}</span>
                                  <span>{w.aantal} · {euro(w.bedrag)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                            <input
                              type="checkbox"
                              checked={openstaandMeenemen}
                              onChange={(e) => setOpenstaandMeenemen(e.target.checked)}
                              className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                            />
                            <span>
                              Toch meenemen en in het archief markeren als afgesloten zonder
                              facturatie. Gebruik dit voor oude periodes waar niets meer van bekend
                              is; corrigeren kan achteraf nog steeds.
                            </span>
                          </label>
                        </div>
                      )}

                      <p className="text-sm text-gray-700">
                        Er gaan <span className="font-semibold">{meegenomen}</span> passages mee in
                        deze afsluiting.
                      </p>
                    </div>
                  )}

                  <div className="rounded border border-red-200 bg-red-50 p-3">
                    <div className="flex items-start gap-2">
                      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                      <div className="w-full space-y-3">
                        <label className="flex items-start gap-2 text-sm font-medium text-red-900">
                          <input
                            type="checkbox"
                            checked={bevestigd}
                            onChange={(e) => setBevestigd(e.target.checked)}
                            className="mt-0.5 rounded border-red-400 text-red-600 focus:ring-red-500"
                          />
                          <span>
                            Ja, ik weet het zeker: de tolheffing begint na deze datum weer bij nul.
                          </span>
                        </label>
                        <label className="block text-sm">
                          <span className="font-medium text-red-900">
                            {tweefactor ? 'Code uit je authenticator' : 'Je wachtwoord'}
                          </span>
                          <input
                            type={tweefactor ? 'text' : 'password'}
                            value={geheim}
                            onChange={(e) => setGeheim(e.target.value)}
                            autoComplete={tweefactor ? 'one-time-code' : 'current-password'}
                            inputMode={tweefactor ? 'numeric' : undefined}
                            maxLength={tweefactor ? 6 : undefined}
                            placeholder={tweefactor ? '000000' : '••••••••'}
                            className="mt-1 w-full max-w-xs rounded border-red-300 text-sm shadow-sm focus:border-red-500 focus:ring-red-500"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {afsluitingen.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Eerdere afsluitingen</h3>
                      <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-200">
                        {afsluitingen.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <div>
                              <p className="font-medium text-gray-900">
                                Tot en met {dag(a.tot_datum)}
                                {a.omschrijving && <span className="font-normal text-gray-500"> · {a.omschrijving}</span>}
                              </p>
                              <p className="text-xs text-gray-500">
                                {a.passages} passages · {euro(a.bedrag)} · door {a.uitgevoerd_door} op{' '}
                                {dag(a.uitgevoerd_op)}
                                {!a.actief && ` · teruggedraaid op ${dag(a.teruggedraaid_op)}`}
                              </p>
                            </div>
                            {a.actief && (
                              <button
                                type="button"
                                disabled={bezig}
                                onClick={() => void terugdraaien(a)}
                                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <ArrowUturnLeftIcon className="h-4 w-4" />
                                Terugdraaien
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={bezig}
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Annuleren
                  </button>
                  <button
                    type="button"
                    onClick={() => void afsluiten()}
                    disabled={!klaarVoorAfsluiten}
                    className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {bezig ? 'Bezig…' : 'Periode afsluiten'}
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
