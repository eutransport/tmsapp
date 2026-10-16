/**
 * Tolstations: welk land hoort bij een stationsnaam op een tolfactuur.
 *
 * Nieuwe namen komen hier vanzelf in te staan met een voorstel. Zolang een
 * naam niet bevestigd is, krijgt de passage geen land -- liever leeg dan het
 * verkeerde land op een factuur.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckIcon, ExclamationTriangleIcon, MapPinIcon } from '@heroicons/react/24/outline'

import { TolStation, TolStationLijst, tollingApi } from '@/api/tolling'

export default function TolStationsPaneel() {
  const [data, setData] = useState<TolStationLijst | null>(null)
  const [alleenOpen, setAlleenOpen] = useState(true)
  const [bezig, setBezig] = useState(false)

  const laden = async (openstaand: boolean) => {
    try {
      setData(await tollingApi.tolStations(openstaand))
    } catch {
      /* dit paneel mag de pagina niet blokkeren */
    }
  }

  useEffect(() => { laden(alleenOpen) }, [alleenOpen])

  const bevestig = async (station: TolStation, land: string) => {
    if (!land) return
    try {
      await tollingApi.bevestigStation(station.id, land)
      toast.success(`${station.naam.slice(0, 30)} staat nu op ${land}`)
      laden(alleenOpen)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Bevestigen mislukt')
    }
  }

  const allesOvernemen = async () => {
    setBezig(true)
    try {
      const uitkomst = await tollingApi.neemStationVoorstellenOver()
      toast.success(`${uitkomst.bevestigd} stations bevestigd`)
      laden(alleenOpen)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Overnemen mislukt')
    } finally {
      setBezig(false)
    }
  }

  if (!data) return null

  const landen = data.landen
  const metVoorstel = data.stations.filter((s) => s.openstaand && s.voorstel).length

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <MapPinIcon className="h-5 w-5 text-gray-400" />
          <h3 className="text-base font-semibold text-gray-900">Tolstations</h3>
          {data.openstaand > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {data.openstaand} te bevestigen
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAlleenOpen(!alleenOpen)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {alleenOpen ? 'Toon alle' : 'Alleen openstaande'}
          </button>
          {metVoorstel > 0 && (
            <button
              type="button"
              disabled={bezig}
              onClick={allesOvernemen}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {metVoorstel} voorstellen overnemen
            </button>
          )}
        </div>
      </div>

      {data.openstaand > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Passages van een onbevestigd station krijgen geen land. Bevestig ze om ze op een
            eigen factuurregel te laten komen.
          </span>
        </p>
      )}

      {data.stations.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Geen stations om te tonen.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {data.stations.map((station) => (
            <li key={station.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{station.naam}</p>
                <p className="text-xs text-gray-500">
                  {station.aantal_regels} regels
                  {station.openstaand && station.voorstel ? ` · voorstel ${station.voorstel}` : ''}
                </p>
              </div>
              {station.openstaand ? (
                <select
                  defaultValue={station.voorstel}
                  onChange={(e) => bevestig(station, e.target.value)}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm sm:w-40"
                >
                  <option value="">Kies land…</option>
                  {landen.map((l) => (
                    <option key={l.code} value={l.code}>{l.naam}</option>
                  ))}
                </select>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm text-gray-700 sm:w-40">
                  <CheckIcon className="h-4 w-4 text-green-600" />
                  {station.landnaam || station.land}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
