/**
 * Voorbeeld van een tolimport: laat zien wat er binnenkomt voordat er iets
 * wordt opgeslagen. Op een telefoon staat elk kenteken als kaartje onder
 * elkaar, op een breed scherm als tabel.
 */
import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  ArrowUpTrayIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import type { TolImportVoorbeeld } from '@/api/tolling'

interface Props {
  isOpen: boolean
  voorbeeld: TolImportVoorbeeld | null
  bezig: boolean
  importeren: boolean
  onClose: () => void
  onBevestig: () => void
}

function euro(waarde: string | undefined): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
    .format(Number(waarde || 0))
}

function km(waarde: string | undefined): string {
  return `${Number(waarde || 0).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km`
}

function datum(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** Uitleg bij de herkomst van de kilometers, want die is niet altijd hard. */
const KM_BRON_TEKST: Record<string, string> = {
  bestand: 'uit het bestand',
  tarief: 'berekend uit het tarief',
  schatting: 'geschat',
}

function kmBronLabel(bron: string): string {
  return bron
    .split(', ')
    .map(b => KM_BRON_TEKST[b] || b)
    .join(' + ')
}

export default function TolImportVoorbeeldModal({
  isOpen, voorbeeld, bezig, importeren, onClose, onBevestig,
}: Props) {
  const regels = voorbeeld?.per_kenteken ?? []
  const nieuw = voorbeeld?.nieuw ?? 0
  const onbekend = regels.filter(r => !r.bekend)
  const geschat = regels.filter(r => r.km_bron.includes('schatting'))

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
          <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 translate-y-4 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-t-2xl bg-white shadow-xl transition-all sm:rounded-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
                  <div className="min-w-0">
                    <Dialog.Title className="text-base font-semibold text-gray-900 sm:text-lg">
                      Dit wordt geïmporteerd
                    </Dialog.Title>
                    <p className="truncate text-xs text-gray-500 sm:text-sm">
                      {voorbeeld?.bestandsnaam}
                      {voorbeeld?.soort === 'verbruiken' && ' · verbruikenbestand'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    onClick={onClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-6">
                  {bezig && (
                    <p className="py-8 text-center text-sm text-gray-500">
                      Bestand wordt gelezen…
                    </p>
                  )}

                  {!bezig && voorbeeld?.fout && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                      <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
                      <span>{voorbeeld.fout}</span>
                    </div>
                  )}

                  {!bezig && voorbeeld && !voorbeeld.fout && (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-green-50 p-3">
                          <p className="text-xs text-green-700">Nieuw</p>
                          <p className="text-xl font-semibold text-green-800">{nieuw}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">Al aanwezig</p>
                          <p className="text-xl font-semibold text-gray-800">
                            {voorbeeld.duplicaten}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">Bedrag</p>
                          <p className="text-xl font-semibold text-gray-800">
                            {euro(voorbeeld.bedrag)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">Kilometers</p>
                          <p className="text-xl font-semibold text-gray-800">
                            {km(voorbeeld.km)}
                          </p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-gray-500">
                        {voorbeeld.regels_totaal} regels gelezen · periode{' '}
                        {datum(voorbeeld.eerste)} t/m {datum(voorbeeld.laatste)}
                        {!!voorbeeld.ongeldig && ` · ${voorbeeld.ongeldig} onleesbaar`}
                        {!!voorbeeld.zonder_kosten
                          && ` · ${voorbeeld.zonder_kosten} zonder kosten overgeslagen`}
                      </p>

                      {onbekend.length > 0 && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
                          <span>
                            {onbekend.length === 1 ? 'Eén kenteken staat' : `${onbekend.length} kentekens staan`}
                            {' '}niet in de vloot: {onbekend.map(r => r.kenteken).join(', ')}.
                            Die regels krijgen geen rit en geen bedrijf.
                          </span>
                        </div>
                      )}

                      {geschat.length > 0 && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
                          <span>
                            Bij {geschat.length === 1 ? 'één kenteken' : `${geschat.length} kentekens`}
                            {' '}zijn de kilometers geschat omdat er te weinig eerdere
                            regels zijn om het tarief af te leiden. De bedragen kloppen wel.
                          </span>
                        </div>
                      )}

                      {nieuw === 0 ? (
                        <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                          Alle regels uit dit bestand staan al in het systeem. Importeren
                          verandert niets.
                        </p>
                      ) : (
                        <>
                          {/* Telefoon: kaartjes onder elkaar. */}
                          <div className="mt-4 space-y-2 sm:hidden">
                            {regels.map(r => (
                              <div key={r.kenteken} className="rounded-lg border border-gray-200 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-semibold text-gray-900">{r.kenteken}</span>
                                  <span className="text-sm font-medium text-gray-900">
                                    {euro(r.bedrag)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                  {r.aantal} passages · {km(r.km)}
                                  {r.ritnummer && ` · rit ${r.ritnummer}`}
                                </p>
                                <p className="text-xs text-gray-400">
                                  Kilometers {kmBronLabel(r.km_bron)}
                                  {!r.bekend && ' · niet in de vloot'}
                                </p>
                              </div>
                            ))}
                          </div>

                          {/* Breed scherm: tabel. */}
                          <div className="mt-4 hidden overflow-x-auto sm:block">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                                  <th className="py-2 pr-3 font-medium">Kenteken</th>
                                  <th className="py-2 pr-3 font-medium">Rit</th>
                                  <th className="py-2 pr-3 text-right font-medium">Passages</th>
                                  <th className="py-2 pr-3 text-right font-medium">Bedrag</th>
                                  <th className="py-2 pr-3 text-right font-medium">Kilometers</th>
                                  <th className="py-2 font-medium">Herkomst km</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {regels.map(r => (
                                  <tr key={r.kenteken}>
                                    <td className="py-2 pr-3 font-medium text-gray-900">
                                      {r.kenteken}
                                      {!r.bekend && (
                                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                                          onbekend
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 pr-3 text-gray-600">{r.ritnummer || '—'}</td>
                                    <td className="py-2 pr-3 text-right text-gray-600">{r.aantal}</td>
                                    <td className="py-2 pr-3 text-right text-gray-900">{euro(r.bedrag)}</td>
                                    <td className="py-2 pr-3 text-right text-gray-600">{km(r.km)}</td>
                                    <td className="py-2 text-gray-500">{kmBronLabel(r.km_bron)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Annuleren
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onBevestig}
                    disabled={bezig || importeren || nieuw === 0 || !!voorbeeld?.fout}
                  >
                    <ArrowUpTrayIcon className="h-4 w-4 mr-1.5" />
                    {importeren ? 'Bezig…' : `${nieuw} regels importeren`}
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
