import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { PencilIcon, PlusIcon, TrashIcon, TruckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Charter, CharterInput, CharterPeriode, chartersApi } from '@/api/charters'
import { getAllVehicles } from '@/api/fleet'
import ConfirmDialog, { ConfirmState } from '@/components/common/ConfirmDialog'

const LEEG: CharterInput = { naam: '', kvk: '', contactpersoon: '', email: '', telefoon: '', voertuigen: [] }

const foutTekst = (err: unknown, standaard: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (Array.isArray(data)) return String(data[0])
  if (data && typeof data === 'object') {
    const eerste = Object.values(data as Record<string, unknown>)[0]
    return Array.isArray(eerste) ? String(eerste[0]) : String(eerste)
  }
  return standaard
}

export default function ChartersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [bewerk, setBewerk] = useState<{ id: string | null; invoer: CharterInput } | null>(null)
  const [geselecteerd, setGeselecteerd] = useState<string | null>(null)
  const [bevestig, setBevestig] = useState<ConfirmState | null>(null)

  const { data: charters = [], isLoading } = useQuery({ queryKey: ['charters'], queryFn: chartersApi.lijst })
  const { data: voertuigen = [] } = useQuery({
    queryKey: ['charters', 'voertuigen'],
    queryFn: getAllVehicles,
    enabled: bewerk !== null,
  })

  const opslaan = useMutation({
    mutationFn: ({ id, invoer }: { id: string | null; invoer: CharterInput }) =>
      id ? chartersApi.wijzig(id, invoer) : chartersApi.maak(invoer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charters'] })
      setBewerk(null)
      toast.success(t('charters.saved', 'Charter opgeslagen'))
    },
    onError: (err) => toast.error(foutTekst(err, t('charters.saveError', 'Opslaan mislukt'))),
  })

  const verwijder = (charter: Charter) => setBevestig({
    title: t('charters.deleteTitle', 'Charter verwijderen?'),
    message: t('charters.deleteMessage', 'Weet u zeker dat u "{{naam}}" wilt verwijderen?', { naam: charter.naam }),
    variant: 'danger',
    onConfirm: async () => {
      try {
        await chartersApi.verwijder(charter.id)
        if (geselecteerd === charter.id) setGeselecteerd(null)
        queryClient.invalidateQueries({ queryKey: ['charters'] })
      } catch (err) {
        toast.error(foutTekst(err, t('charters.deleteError', 'Verwijderen mislukt')))
      }
    },
  })

  const zet = (veld: keyof CharterInput, waarde: string | string[]) =>
    setBewerk(b => (b ? { ...b, invoer: { ...b.invoer, [veld]: waarde } } : b))

  const wisselVoertuig = (id: string) => setBewerk(b => {
    if (!b) return b
    const huidig = b.invoer.voertuigen
    const voertuigenNieuw = huidig.includes(id) ? huidig.filter(v => v !== id) : [...huidig, id]
    return { ...b, invoer: { ...b.invoer, voertuigen: voertuigenNieuw } }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('charters.title', 'Charters')}</h1>
          <p className="text-sm text-gray-500">
            {t('charters.subtitle', 'Een charter ziet alleen de uren en tol van zijn eigen chauffeurs en de wagens die u hier koppelt op de kaart.')}
          </p>
        </div>
        <button
          onClick={() => setBewerk({ id: null, invoer: LEEG })}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
        >
          <PlusIcon className="h-4 w-4" />
          {t('charters.new', 'Nieuwe charter')}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : charters.length === 0 ? (
        <div className="card p-8 text-center">
          <TruckIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{t('charters.empty', 'Nog geen charters aangemaakt')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('charters.name', 'Naam')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">{t('charters.contact', 'Contactpersoon')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('charters.drivers', 'Chauffeurs')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('charters.vehicles', 'Wagens op kaart')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {charters.map(c => (
                <tr key={c.id} className={geselecteerd === c.id ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setGeselecteerd(geselecteerd === c.id ? null : c.id)}
                      className="text-sm font-medium text-blue-600 hover:underline text-left"
                    >
                      {c.naam}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">{c.contactpersoon || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.aantal_chauffeurs}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.voertuig_kentekens.join(', ') || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setBewerk({
                          id: c.id,
                          invoer: {
                            naam: c.naam, kvk: c.kvk, contactpersoon: c.contactpersoon,
                            email: c.email, telefoon: c.telefoon, voertuigen: c.voertuigen,
                          },
                        })}
                        className="p-1 text-gray-400 hover:text-blue-600"
                        title={t('common.edit', 'Bewerken')}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => verwijder(c)}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title={t('common.delete', 'Verwijderen')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {geselecteerd && (
        <PeriodesBlok charter={charters.find(c => c.id === geselecteerd)} />
      )}

      {bewerk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">
                {bewerk.id ? t('charters.edit', 'Charter bewerken') : t('charters.new', 'Nieuwe charter')}
              </h2>
              <button onClick={() => setBewerk(null)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form
              className="p-5 space-y-3"
              onSubmit={(e) => { e.preventDefault(); opslaan.mutate(bewerk) }}
            >
              {([
                ['naam', t('charters.name', 'Naam')],
                ['kvk', t('charters.kvk', 'KvK-nummer')],
                ['contactpersoon', t('charters.contact', 'Contactpersoon')],
                ['email', t('charters.email', 'E-mail')],
                ['telefoon', t('charters.phone', 'Telefoon')],
              ] as const).map(([veld, label]) => (
                <div key={veld}>
                  <label className="block text-sm font-medium text-gray-700">{label}</label>
                  <input
                    type={veld === 'email' ? 'email' : 'text'}
                    required={veld === 'naam'}
                    value={bewerk.invoer[veld]}
                    onChange={(e) => zet(veld, e.target.value)}
                    className="input mt-1 w-full"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('charters.vehicles', 'Wagens op kaart')}
                </label>
                <p className="text-xs text-gray-500 mb-1">
                  {t('charters.vehiclesHelp', 'Alleen deze wagens ziet de charter op de kaart. Tol en uren volgen uit zijn chauffeurs.')}
                </p>
                <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                  {voertuigen.map(v => (
                    <label key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={bewerk.invoer.voertuigen.includes(v.id)}
                        onChange={() => wisselVoertuig(v.id)}
                      />
                      <span className="font-mono">{v.kenteken}</span>
                      <span className="text-gray-500">{v.type_wagen}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setBewerk(null)} className="btn-secondary">
                  {t('common.cancel', 'Annuleren')}
                </button>
                <button type="submit" disabled={opslaan.isPending} className="btn-primary">
                  {t('common.save', 'Opslaan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog state={bevestig} onClose={() => setBevestig(null)} />
    </div>
  )
}

function PeriodesBlok({ charter }: { charter?: Charter }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [bewerk, setBewerk] = useState<Record<string, { vanaf: string; tot: string }>>({})

  const { data: periodes = [], isLoading } = useQuery({
    queryKey: ['charters', 'periodes', charter?.id],
    queryFn: () => chartersApi.periodes(charter!.id),
    enabled: !!charter,
  })

  const vernieuw = () => queryClient.invalidateQueries({ queryKey: ['charters', 'periodes', charter?.id] })

  const opslaan = async (p: CharterPeriode) => {
    const w = bewerk[p.id]
    try {
      await chartersApi.wijzigPeriode(p.id, { vanaf: w.vanaf || null, tot: w.tot || null })
      setBewerk(({ [p.id]: _, ...rest }) => rest)
      vernieuw()
      toast.success(t('charters.periodSaved', 'Periode opgeslagen'))
    } catch (err) {
      toast.error(foutTekst(err, t('charters.saveError', 'Opslaan mislukt')))
    }
  }

  const verwijder = async (p: CharterPeriode) => {
    if (!window.confirm(t('charters.periodDeleteConfirm', 'Deze periode verwijderen? De charter ziet de uren uit deze periode dan niet meer.'))) return
    try {
      await chartersApi.verwijderPeriode(p.id)
      vernieuw()
    } catch (err) {
      toast.error(foutTekst(err, t('charters.deleteError', 'Verwijderen mislukt')))
    }
  }

  if (!charter) return null

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">
          {t('charters.periodsTitle', 'Periodes van {{naam}}', { naam: charter.naam })}
        </h2>
        <p className="text-sm text-gray-500">
          {t('charters.periodsHelp', 'De charter ziet alleen uren en tol binnen deze periodes. Koppel een chauffeur via het chauffeursscherm; een lege "vanaf" betekent vanaf het begin.')}
        </p>
      </div>
      {isLoading ? (
        <div className="text-sm text-gray-500">{t('common.loading', 'Laden...')}</div>
      ) : periodes.length === 0 ? (
        <div className="text-sm text-gray-500">{t('charters.noPeriods', 'Nog geen chauffeurs gekoppeld.')}</div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase">
              <th className="py-2 pr-4">{t('charters.driver', 'Chauffeur')}</th>
              <th className="py-2 pr-4">{t('charters.from', 'Vanaf')}</th>
              <th className="py-2 pr-4">{t('charters.until', 'Tot en met')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {periodes.map(p => {
              const w = bewerk[p.id]
              return (
                <tr key={p.id}>
                  <td className="py-2 pr-4">{p.driver_naam}</td>
                  <td className="py-2 pr-4">
                    {w ? (
                      <input type="date" className="input" value={w.vanaf}
                        onChange={(e) => setBewerk(b => ({ ...b, [p.id]: { ...w, vanaf: e.target.value } }))} />
                    ) : (p.vanaf ?? t('charters.fromStart', 'begin'))}
                  </td>
                  <td className="py-2 pr-4">
                    {w ? (
                      <input type="date" className="input" value={w.tot}
                        onChange={(e) => setBewerk(b => ({ ...b, [p.id]: { ...w, tot: e.target.value } }))} />
                    ) : (p.tot ?? t('charters.ongoing', 'lopend'))}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {w ? (
                      <>
                        <button onClick={() => opslaan(p)} className="text-blue-600 hover:underline mr-3">
                          {t('common.save', 'Opslaan')}
                        </button>
                        <button onClick={() => setBewerk(({ [p.id]: _, ...rest }) => rest)} className="text-gray-500 hover:underline">
                          {t('common.cancel', 'Annuleren')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setBewerk(b => ({ ...b, [p.id]: { vanaf: p.vanaf ?? '', tot: p.tot ?? '' } }))}
                          className="p-1 text-gray-400 hover:text-blue-600"
                          title={t('common.edit', 'Bewerken')}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button onClick={() => verwijder(p)} className="p-1 text-gray-400 hover:text-red-600"
                          title={t('common.delete', 'Verwijderen')}>
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
