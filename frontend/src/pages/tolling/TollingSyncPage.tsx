/**
 * Tolheffing sync — factuurregels terugkoppelen aan tolregels.
 *
 * Na een volledige her-import staan alle tolregels weer op open, terwijl ze al
 * gefactureerd zijn. Deze pagina zoekt per factuurregel de bijbehorende
 * tolregels (kenteken + periode + exact bedrag + km) en zet ze na bevestiging
 * op gefactureerd. De analyse zelf verandert niets; pas bij "koppelen" wordt
 * er iets opgeslagen.
 */
import { useMemo, useState } from 'react'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import {
  tollingSyncApi,
  TollingSyncPreview,
  TollingSyncRow,
  TollingSyncVertrouwen,
} from '@/api/tolling'
import ConfirmDialog, { ConfirmState } from '@/components/common/ConfirmDialog'

const currency = (v: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v || 0)

const kmFmt = (v: number | null) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(v)

const datum = (v: string | null) => (v ? v.split('-').reverse().join('-') : '—')

const VERTROUWEN_STIJL: Record<TollingSyncVertrouwen, string> = {
  zeker: 'bg-green-100 text-green-800',
  waarschijnlijk: 'bg-blue-100 text-blue-800',
  onzeker: 'bg-amber-100 text-amber-800',
  geen: 'bg-gray-100 text-gray-600',
}

const VERTROUWEN_LABEL: Record<TollingSyncVertrouwen, string> = {
  zeker: 'Zeker',
  waarschijnlijk: 'Waarschijnlijk',
  onzeker: 'Onzeker',
  geen: 'Niet gevonden',
}

/** Handmatig gezochte tolregels per factuurregel. */
interface HandmatigState {
  plate: string
  dateFrom: string
  dateTo: string
  loading: boolean
  resultaat: {
    gevonden_events: number
    gevonden_bedrag: number
    gevonden_km: number
    periode_van: string | null
    periode_tot: string | null
    event_ids: string[]
  } | null
}

export default function TollingSyncPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<TollingSyncPreview | null>(null)
  const [geselecteerd, setGeselecteerd] = useState<Record<string, boolean>>({})
  const [handmatig, setHandmatig] = useState<Record<string, HandmatigState>>({})
  const [bezig, setBezig] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  /** Welke events horen bij een regel: handmatige keuze gaat voor het voorstel. */
  const eventsVan = (row: TollingSyncRow): string[] =>
    handmatig[row.line_id]?.resultaat?.event_ids ?? row.event_ids

  const analyseer = async () => {
    setLoading(true)
    try {
      const data = await tollingSyncApi.preview({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setPreview(data)
      setHandmatig({})
      // Alles wat het systeem zeker weet staat meteen aan.
      const selectie: Record<string, boolean> = {}
      data.regels.forEach(r => {
        if (r.vertrouwen === 'zeker') selectie[r.line_id] = true
      })
      setGeselecteerd(selectie)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Analyse mislukt')
    } finally {
      setLoading(false)
    }
  }

  const selecteerNiveaus = (niveaus: TollingSyncVertrouwen[]) => {
    if (!preview) return
    const selectie: Record<string, boolean> = {}
    preview.regels.forEach(r => {
      if (niveaus.includes(r.vertrouwen) && eventsVan(r).length) selectie[r.line_id] = true
    })
    setGeselecteerd(selectie)
  }

  const teKoppelen = useMemo(() => {
    if (!preview) return []
    return preview.regels
      .filter(r => geselecteerd[r.line_id] && eventsVan(r).length > 0)
      .map(r => ({ line_id: r.line_id, event_ids: eventsVan(r) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, geselecteerd, handmatig])

  const koppelen = () => {
    if (!teKoppelen.length) return
    const aantalEvents = teKoppelen.reduce((som, r) => som + r.event_ids.length, 0)
    setConfirmState({
      title: 'Tolregels koppelen',
      message:
        `${teKoppelen.length} factuurregel(s) met in totaal ${aantalEvents} tolregels ` +
        'worden gekoppeld en op gefactureerd gezet. Doorgaan?',
      confirmLabel: 'Koppelen',
      variant: 'info',
      onConfirm: async () => {
        setConfirmState(null)
        setBezig(true)
        try {
          const res = await tollingSyncApi.apply(teKoppelen)
          toast.success(`${res.gekoppeld} tolregels gekoppeld`)
          await analyseer()
        } catch (err: any) {
          toast.error(err?.response?.data?.detail || 'Koppelen mislukt')
        } finally {
          setBezig(false)
        }
      },
    })
  }

  const openHandmatig = (row: TollingSyncRow) => {
    setHandmatig(prev => {
      if (prev[row.line_id]) {
        const kopie = { ...prev }
        delete kopie[row.line_id]
        return kopie
      }
      return {
        ...prev,
        [row.line_id]: {
          plate: row.kenteken || row.kenteken_opties[0] || '',
          dateFrom: row.periode_van || '',
          dateTo: row.periode_tot || row.factuurdatum || '',
          loading: false,
          resultaat: null,
        },
      }
    })
  }

  const zoekHandmatig = async (row: TollingSyncRow) => {
    const state = handmatig[row.line_id]
    if (!state?.plate || !state.dateFrom || !state.dateTo) {
      toast.error('Vul kenteken en beide datums in')
      return
    }
    setHandmatig(prev => ({ ...prev, [row.line_id]: { ...state, loading: true } }))
    try {
      const res = await tollingSyncApi.search({
        plate: state.plate,
        date_from: state.dateFrom,
        date_to: state.dateTo,
      })
      setHandmatig(prev => ({
        ...prev,
        [row.line_id]: { ...state, loading: false, resultaat: res },
      }))
      if (!res.gevonden_events) toast('Geen open tolregels in deze periode')
    } catch (err: any) {
      setHandmatig(prev => ({ ...prev, [row.line_id]: { ...state, loading: false } }))
      toast.error(err?.response?.data?.detail || 'Zoeken mislukt')
    }
  }

  const samenvatting = preview?.samenvatting

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tolheffing synchroniseren</h1>
        <p className="mt-1 text-sm text-gray-600">
          Zoekt per factuurregel met tolheffing de bijbehorende tolregels terug en zet ze
          op gefactureerd. De analyse verandert niets; pas bij koppelen wordt er iets
          opgeslagen. Import en facturatie blijven ongewijzigd werken.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700">Factuurdatum vanaf</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="mt-1 rounded-md border-gray-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Factuurdatum t/m</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="mt-1 rounded-md border-gray-300 text-sm"
          />
        </div>
        <button
          onClick={analyseer}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyseren…' : 'Analyseren'}
        </button>
      </div>

      {samenvatting && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Factuurregels', samenvatting.regels, 'text-gray-900'],
            ['Zeker', samenvatting.zeker, 'text-green-700'],
            ['Waarschijnlijk', samenvatting.waarschijnlijk, 'text-blue-700'],
            ['Onzeker', samenvatting.onzeker, 'text-amber-700'],
            ['Niet gevonden', samenvatting.geen, 'text-gray-500'],
            ['Tolregels open', samenvatting.events_open, 'text-gray-900'],
          ].map(([label, waarde, kleur]) => (
            <div key={label as string} className="bg-white rounded-lg shadow p-3">
              <div className="text-xs text-gray-500">{label}</div>
              <div className={`text-xl font-semibold ${kleur}`}>{waarde}</div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="bg-white rounded-lg shadow">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4">
            <button
              onClick={() => selecteerNiveaus(['zeker'])}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Alleen zekere selecteren
            </button>
            <button
              onClick={() => selecteerNiveaus(['zeker', 'waarschijnlijk'])}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Zeker + waarschijnlijk
            </button>
            <button
              onClick={() => setGeselecteerd({})}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Selectie wissen
            </button>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-gray-600">{teKoppelen.length} geselecteerd</span>
              <button
                onClick={koppelen}
                disabled={bezig || !teKoppelen.length}
                className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircleIcon className="h-4 w-4" />
                {bezig ? 'Bezig…' : 'Koppelen'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Factuur</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Opdrachtgever</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Omschrijving</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Kenteken</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Regel</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Gevonden</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Periode</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.regels.map(row => {
                  const hand = handmatig[row.line_id]
                  const events = eventsVan(row)
                  const res = hand?.resultaat
                  return (
                    <>
                      <tr key={row.line_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!geselecteerd[row.line_id]}
                            disabled={!events.length}
                            onChange={e =>
                              setGeselecteerd(prev => ({
                                ...prev,
                                [row.line_id]: e.target.checked,
                              }))
                            }
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{row.factuurnummer}</div>
                          <div className="text-xs text-gray-500">{datum(row.factuurdatum)}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{row.bedrijf_naam}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-md truncate" title={row.omschrijving}>
                          {row.omschrijving}
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-900">
                          {row.kenteken || (
                            <span className="text-amber-700">
                              {row.kenteken_opties.length ? row.kenteken_opties.join(' / ') : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div>{currency(row.bedrag)}</div>
                          <div className="text-xs text-gray-500">{kmFmt(row.regel_km)} km</div>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {res ? (
                            <>
                              <div>{currency(res.gevonden_bedrag)}</div>
                              <div className="text-xs text-gray-500">
                                {kmFmt(res.gevonden_km)} km · {res.gevonden_events} regels
                              </div>
                            </>
                          ) : row.gevonden_events ? (
                            <>
                              <div>{currency(row.gevonden_bedrag)}</div>
                              <div className="text-xs text-gray-500">
                                {kmFmt(row.gevonden_km)} km · {row.gevonden_events} regels
                              </div>
                            </>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                          {res
                            ? `${datum(res.periode_van)} t/m ${datum(res.periode_tot)}`
                            : row.periode_van
                              ? `${datum(row.periode_van)} t/m ${datum(row.periode_tot)}`
                              : '—'}
                          <div className="text-xs text-gray-500">
                            {res ? 'handmatig gezocht' : row.methode}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${VERTROUWEN_STIJL[row.vertrouwen]}`}
                          >
                            {VERTROUWEN_LABEL[row.vertrouwen]}
                          </span>
                          {row.reden && (
                            <div className="mt-1 text-xs text-gray-500 max-w-xs">{row.reden}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => openHandmatig(row)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                          >
                            <MagnifyingGlassIcon className="h-3.5 w-3.5" />
                            Handmatig
                          </button>
                        </td>
                      </tr>
                      {hand && (
                        <tr key={`${row.line_id}-hand`} className="bg-gray-50">
                          <td />
                          <td colSpan={9} className="px-3 py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="block text-xs text-gray-600">Kenteken</label>
                                <input
                                  value={hand.plate}
                                  onChange={e =>
                                    setHandmatig(prev => ({
                                      ...prev,
                                      [row.line_id]: { ...hand, plate: e.target.value },
                                    }))
                                  }
                                  className="mt-1 w-32 rounded-md border-gray-300 text-sm font-mono uppercase"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-600">Van</label>
                                <input
                                  type="date"
                                  value={hand.dateFrom}
                                  onChange={e =>
                                    setHandmatig(prev => ({
                                      ...prev,
                                      [row.line_id]: { ...hand, dateFrom: e.target.value },
                                    }))
                                  }
                                  className="mt-1 rounded-md border-gray-300 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-600">T/m</label>
                                <input
                                  type="date"
                                  value={hand.dateTo}
                                  onChange={e =>
                                    setHandmatig(prev => ({
                                      ...prev,
                                      [row.line_id]: { ...hand, dateTo: e.target.value },
                                    }))
                                  }
                                  className="mt-1 rounded-md border-gray-300 text-sm"
                                />
                              </div>
                              <button
                                onClick={() => zoekHandmatig(row)}
                                disabled={hand.loading}
                                className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                              >
                                {hand.loading ? 'Zoeken…' : 'Zoeken'}
                              </button>
                              {res && (
                                <div className="text-sm text-gray-700">
                                  {res.gevonden_events} tolregels · {currency(res.gevonden_bedrag)} ·{' '}
                                  {kmFmt(res.gevonden_km)} km
                                  {Math.abs(res.gevonden_bedrag - row.bedrag) > 0.005 && (
                                    <span className="ml-2 text-amber-700">
                                      wijkt af van het regelbedrag {currency(row.bedrag)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                {!preview.regels.length && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-gray-500">
                      Geen factuurregels met tolheffing zonder koppeling gevonden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  )
}
