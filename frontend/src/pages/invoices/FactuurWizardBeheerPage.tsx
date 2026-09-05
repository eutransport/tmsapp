/**
 * Beheer van de factuurwizard.
 *
 * Hier legt een beheerder vast welke bedrijven via de wizard gefactureerd
 * mogen worden, welke template daarbij hoort en welke diensten (routenummers
 * uit de vloot) er te kiezen zijn.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import toast from 'react-hot-toast'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  BuildingOfficeIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

import {
  getWizardConfigs,
  getWizardKeuzelijsten,
  getWizardRitnummers,
  createWizardConfig,
  updateWizardConfig,
  deleteWizardConfig,
  type WizardBedrijfConfig,
  type WizardDienst,
  type WizardRitnummer,
} from '@/api/factuurwizard'
import ConfirmDialog, { type ConfirmState } from '@/components/common/ConfirmDialog'
import clsx from '@/utils/clsx'

/** Een keuze in een uitklaplijst. */
interface Keuze {
  id: string
  naam: string
}

/** Het formulier zoals het in de dialoog staat. */
interface FormState {
  bedrijf: string
  template: string
  administratie: string
  btwPercentage: string
  betaaltermijn: string
  actief: boolean
  diensten: Map<string, string> // routenummer -> toelichting
}

const leegFormulier = (): FormState => ({
  bedrijf: '',
  template: '',
  administratie: '',
  btwPercentage: '21',
  betaaltermijn: '30',
  actief: true,
  diensten: new Map(),
})

export default function FactuurWizardBeheerPage() {
  const [configs, setConfigs] = useState<WizardBedrijfConfig[]>([])
  const [companies, setCompanies] = useState<Keuze[]>([])
  const [templates, setTemplates] = useState<Keuze[]>([])
  const [administraties, setAdministraties] = useState<Keuze[]>([])
  const [ritnummers, setRitnummers] = useState<WizardRitnummer[]>([])
  const [laden, setLaden] = useState(true)

  const [dialoogOpen, setDialoogOpen] = useState(false)
  const [bewerktConfig, setBewerktConfig] = useState<WizardBedrijfConfig | null>(null)
  const [form, setForm] = useState<FormState>(leegFormulier)
  const [opslaan, setOpslaan] = useState(false)
  const [zoekRoute, setZoekRoute] = useState('')
  const [bevestiging, setBevestiging] = useState<ConfirmState | null>(null)

  useEffect(() => {
    void alleGegevensLaden()
  }, [])

  const alleGegevensLaden = async () => {
    try {
      setLaden(true)
      const [configLijst, keuzes, routeLijst] = await Promise.all([
        getWizardConfigs(),
        getWizardKeuzelijsten(),
        getWizardRitnummers(),
      ])
      setConfigs(configLijst)
      setCompanies(keuzes.bedrijven)
      setTemplates(keuzes.templates)
      setAdministraties(keuzes.administraties)
      setRitnummers(routeLijst)
    } catch (err) {
      console.error(err)
      toast.error('Laden van de instellingen is mislukt')
    } finally {
      setLaden(false)
    }
  }

  /** Bedrijven die nog geen instelling hebben (plus het bedrijf dat je bewerkt). */
  const kiesbareBedrijven = useMemo(() => {
    const bezet = new Set(configs.map((c) => c.bedrijf))
    if (bewerktConfig) bezet.delete(bewerktConfig.bedrijf)
    return companies.filter((b) => !bezet.has(b.id))
  }, [companies, configs, bewerktConfig])

  const gefilterdeRoutes = useMemo(() => {
    const zoek = zoekRoute.trim().toLowerCase()
    if (!zoek) return ritnummers
    return ritnummers.filter(
      (r) =>
        r.ritnummer.toLowerCase().includes(zoek) ||
        r.kenteken.toLowerCase().includes(zoek) ||
        r.bedrijf_naam.toLowerCase().includes(zoek)
    )
  }, [ritnummers, zoekRoute])

  const openNieuw = () => {
    setBewerktConfig(null)
    setForm(leegFormulier())
    setZoekRoute('')
    setDialoogOpen(true)
  }

  const openBewerken = (config: WizardBedrijfConfig) => {
    setBewerktConfig(config)
    setForm({
      bedrijf: config.bedrijf,
      template: config.template,
      administratie: config.administratie ?? '',
      btwPercentage: String(Number(config.btw_percentage)),
      betaaltermijn: String(config.betaaltermijn_dagen),
      actief: config.actief,
      diensten: new Map(config.diensten.map((d) => [d.ritnummer, d.omschrijving])),
    })
    setZoekRoute('')
    setDialoogOpen(true)
  }

  const routeAanUit = (ritnummer: string) => {
    setForm((vorig) => {
      const nieuw = new Map(vorig.diensten)
      if (nieuw.has(ritnummer)) nieuw.delete(ritnummer)
      else nieuw.set(ritnummer, '')
      return { ...vorig, diensten: nieuw }
    })
  }

  const routeToelichting = (ritnummer: string, tekst: string) => {
    setForm((vorig) => {
      const nieuw = new Map(vorig.diensten)
      nieuw.set(ritnummer, tekst)
      return { ...vorig, diensten: nieuw }
    })
  }

  const handleOpslaan = async () => {
    if (!form.bedrijf) {
      toast.error('Kies een bedrijf')
      return
    }
    if (!form.template) {
      toast.error('Kies een template')
      return
    }
    const btw = Number(form.btwPercentage)
    if (!isFinite(btw) || btw < 0 || btw > 100) {
      toast.error('Vul een BTW-percentage tussen 0 en 100 in')
      return
    }
    const termijn = Number(form.betaaltermijn)
    if (!Number.isInteger(termijn) || termijn < 0 || termijn > 365) {
      toast.error('Vul een betaaltermijn tussen 0 en 365 dagen in')
      return
    }

    const diensten: WizardDienst[] = Array.from(form.diensten.entries()).map(
      ([ritnummer, omschrijving], index) => ({
        ritnummer,
        omschrijving,
        actief: true,
        volgorde: index,
      })
    )

    const gegevens = {
      bedrijf: form.bedrijf,
      template: form.template,
      administratie: form.administratie || null,
      btw_percentage: form.btwPercentage,
      betaaltermijn_dagen: termijn,
      actief: form.actief,
      diensten,
    }

    try {
      setOpslaan(true)
      if (bewerktConfig) {
        await updateWizardConfig(bewerktConfig.id, gegevens)
        toast.success('Instelling opgeslagen')
      } else {
        await createWizardConfig(gegevens)
        toast.success('Bedrijf toegevoegd aan de wizard')
      }
      setDialoogOpen(false)
      await alleGegevensLaden()
    } catch (err: unknown) {
      const melding =
        (err as { response?: { data?: Record<string, unknown> } })?.response?.data
      console.error(err)
      toast.error(
        typeof melding === 'object' && melding
          ? Object.values(melding).flat().join(' ')
          : 'Opslaan is mislukt'
      )
    } finally {
      setOpslaan(false)
    }
  }

  const vraagVerwijderen = (config: WizardBedrijfConfig) => {
    setBevestiging({
      title: 'Uit de wizard halen?',
      message: (
        <>
          <strong>{config.bedrijf_naam}</strong> kan daarna niet meer via de wizard
          gefactureerd worden. Bestaande facturen blijven gewoon staan.
        </>
      ),
      confirmLabel: 'Verwijderen',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteWizardConfig(config.id)
          toast.success('Uit de wizard gehaald')
          await alleGegevensLaden()
        } catch (err) {
          console.error(err)
          toast.error('Verwijderen is mislukt')
        }
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Kop */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
            Factuurwizard instellen
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Bepaal welke bedrijven via de wizard gefactureerd kunnen worden, welke
            template daarbij hoort en welke diensten er te kiezen zijn.
          </p>
        </div>
        <button type="button" onClick={openNieuw} className="btn-primary w-full sm:w-auto">
          <PlusIcon className="mr-2 h-5 w-5" />
          Bedrijf toevoegen
        </button>
      </div>

      {laden ? (
        <div className="card py-12 text-center text-gray-500">Bezig met laden…</div>
      ) : configs.length === 0 ? (
        <div className="card py-12 text-center">
          <BuildingOfficeIcon className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Er is nog geen bedrijf ingesteld. Voeg er één toe om de wizard te kunnen
            gebruiken.
          </p>
        </div>
      ) : (
        <>
          {/* Mobiel: kaarten */}
          <div className="space-y-3 lg:hidden">
            {configs.map((config) => (
              <div key={config.id} className="card space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">
                      {config.bedrijf_naam}
                    </p>
                    <p className="truncate text-sm text-gray-500">{config.template_naam}</p>
                  </div>
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      config.actief
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {config.actief ? 'Actief' : 'Inactief'}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-gray-500">Administratie</dt>
                    <dd className="text-gray-900">{config.administratie_naam || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">BTW / termijn</dt>
                    <dd className="text-gray-900">
                      {Number(config.btw_percentage)}% · {config.betaaltermijn_dagen} dgn
                    </dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-1 text-sm text-gray-500">
                    Diensten ({config.diensten.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {config.diensten.map((d) => (
                      <span
                        key={d.ritnummer}
                        className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                      >
                        {d.ritnummer}
                      </span>
                    ))}
                    {config.diensten.length === 0 && (
                      <span className="text-xs text-gray-400">Geen</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => openBewerken(config)}
                    className="btn-secondary flex-1"
                  >
                    <PencilIcon className="mr-2 h-4 w-4" />
                    Bewerken
                  </button>
                  <button
                    type="button"
                    onClick={() => vraagVerwijderen(config)}
                    className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50"
                    aria-label="Verwijderen"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabel */}
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Bedrijf
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Template
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Administratie
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Diensten
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    BTW / termijn
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {configs.map((config) => (
                  <tr key={config.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {config.bedrijf_naam}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{config.template_naam}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {config.administratie_naam || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {config.diensten.map((d) => (
                          <span
                            key={d.ritnummer}
                            className="rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                          >
                            {d.ritnummer}
                          </span>
                        ))}
                        {config.diensten.length === 0 && (
                          <span className="text-xs text-gray-400">Geen</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {Number(config.btw_percentage)}% · {config.betaaltermijn_dagen} dgn
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          config.actief
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {config.actief ? 'Actief' : 'Inactief'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openBewerken(config)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Bewerken"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => vraagVerwijderen(config)}
                        className="ml-1 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Verwijderen"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Dialoog: instelling toevoegen of bewerken */}
      <Transition appear show={dialoogOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => !opslaan && setDialoogOpen(false)}>
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
                <Dialog.Panel className="flex max-h-[92vh] w-full max-w-2xl transform flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl transition-all sm:max-h-[88vh] sm:rounded-lg">
                  <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
                    <Dialog.Title className="text-base font-semibold text-gray-900 sm:text-lg">
                      {bewerktConfig ? 'Instelling bewerken' : 'Bedrijf toevoegen'}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setDialoogOpen(false)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      aria-label="Sluiten"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Bedrijf *
                        </label>
                        <select
                          className="input w-full"
                          value={form.bedrijf}
                          disabled={Boolean(bewerktConfig)}
                          onChange={(e) => setForm({ ...form, bedrijf: e.target.value })}
                        >
                          <option value="">Kies een bedrijf…</option>
                          {kiesbareBedrijven.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.naam}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Template *
                        </label>
                        <select
                          className="input w-full"
                          value={form.template}
                          onChange={(e) => setForm({ ...form, template: e.target.value })}
                        >
                          <option value="">Kies een template…</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.naam}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Administratie
                        </label>
                        <select
                          className="input w-full"
                          value={form.administratie}
                          onChange={(e) => setForm({ ...form, administratie: e.target.value })}
                        >
                          <option value="">Geen</option>
                          {administraties.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.naam}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Bepaalt de factuurnummering en wie de factuur mag inzien.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            BTW %
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            className="input w-full"
                            value={form.btwPercentage}
                            onChange={(e) => setForm({ ...form, btwPercentage: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Termijn (dagen)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={365}
                            className="input w-full"
                            value={form.betaaltermijn}
                            onChange={(e) => setForm({ ...form, betaaltermijn: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        checked={form.actief}
                        onChange={(e) => setForm({ ...form, actief: e.target.checked })}
                      />
                      Actief — verschijnt in de wizard
                    </label>

                    {/* Diensten */}
                    <div className="border-t pt-4">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">
                            Diensten (routenummers)
                          </h3>
                          <p className="text-xs text-gray-500">
                            {form.diensten.size} van {ritnummers.length} routes gekozen
                          </p>
                        </div>
                        <div className="relative sm:w-56">
                          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            className="input w-full pl-8"
                            placeholder="Zoek route of kenteken"
                            value={zoekRoute}
                            onChange={(e) => setZoekRoute(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                        {gefilterdeRoutes.length === 0 && (
                          <p className="px-2 py-4 text-center text-sm text-gray-400">
                            Geen routes gevonden
                          </p>
                        )}
                        {gefilterdeRoutes.map((route) => {
                          const gekozen = form.diensten.has(route.ritnummer)
                          return (
                            <div
                              key={route.ritnummer}
                              className={clsx(
                                'rounded-lg border p-2 transition-colors',
                                gekozen
                                  ? 'border-primary-200 bg-primary-50'
                                  : 'border-transparent hover:bg-gray-50'
                              )}
                            >
                              <label className="flex cursor-pointer items-start gap-2">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  checked={gekozen}
                                  onChange={() => routeAanUit(route.ritnummer)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-gray-900">
                                    {route.ritnummer}
                                  </span>
                                  <span className="block truncate text-xs text-gray-500">
                                    {route.kenteken}
                                    {route.type_wagen ? ` · ${route.type_wagen}` : ''}
                                    {route.bedrijf_naam ? ` · ${route.bedrijf_naam}` : ''}
                                  </span>
                                </span>
                              </label>
                              {gekozen && (
                                <input
                                  type="text"
                                  className="input mt-2 w-full text-sm"
                                  placeholder="Toelichting (optioneel)"
                                  value={form.diensten.get(route.ritnummer) ?? ''}
                                  onChange={(e) =>
                                    routeToelichting(route.ritnummer, e.target.value)
                                  }
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-gray-50 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setDialoogOpen(false)}
                      disabled={opslaan}
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleOpslaan}
                      disabled={opslaan}
                    >
                      <CheckCircleIcon className="mr-2 h-5 w-5" />
                      {opslaan ? 'Bezig…' : 'Opslaan'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog state={bevestiging} onClose={() => setBevestiging(null)} />
    </div>
  )
}
