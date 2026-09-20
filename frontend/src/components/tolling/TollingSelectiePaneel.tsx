import { useEffect, useMemo, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import {
  tollingFactuurDetailApi,
  type TollingSelectieOverzicht,
  type TollingSelectieRegel,
} from '../../api/tolling'

interface TollingSelectiePaneelProps {
  plate: string
  year: number | null
  weekStart: number | null
  periodWeeks: number
  bedrijfId: string | null
  excludeWeekend: boolean
  /** "HH:MM" of null als er geen afkapuur is gekozen. */
  cutoffTime: string | null
  /** De tolregels die de gebruiker alsnog wil meenemen. */
  onSelectionChange: (ids: string[]) => void
}

const euro = (n: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)

const km = (n: number) =>
  `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(n || 0)} km`

function tijdLabel(regel: TollingSelectieRegel): string {
  if (regel.tijd_status === 'binnen') return 'binnen rittijd'
  if (regel.tijd_status === 'marge') return 'binnen marge'
  if (regel.tijd_status === 'buiten') return 'buiten rittijd'
  return 'geen uren bekend'
}

/**
 * Laat zien wat er wel en niet op de tolheffing-factuur komt, en biedt de
 * randregels aan: tolregels die nu wegvallen terwijl de wagen op dat moment
 * wel aan het rijden was (binnen de rittijd of een kwartier ervoor/erna).
 *
 * Het paneel verandert niets; kiest de gebruiker regels, dan worden die pas
 * na het aanmaken van de factuur toegevoegd.
 */
export default function TollingSelectiePaneel({
  plate,
  year,
  weekStart,
  periodWeeks,
  bedrijfId,
  excludeWeekend,
  cutoffTime,
  onSelectionChange,
}: TollingSelectiePaneelProps) {
  const [data, setData] = useState<TollingSelectieOverzicht | null>(null)
  const [laden, setLaden] = useState(false)
  const [fout, setFout] = useState('')
  const [margeAan, setMargeAan] = useState(false)
  const [gekozen, setGekozen] = useState<Set<string>>(new Set())
  const [toonNiet, setToonNiet] = useState(false)
  const [toonDagen, setToonDagen] = useState(false)

  useEffect(() => {
    if (!plate || !year || !weekStart) {
      setData(null)
      return
    }
    let gestopt = false
    setLaden(true)
    setFout('')
    tollingFactuurDetailApi
      .selectie({
        plate,
        year,
        week_start: weekStart,
        period_weeks: periodWeeks,
        bedrijf_id: bedrijfId || undefined,
        exclude_weekend: excludeWeekend,
        cutoff_time: cutoffTime,
      })
      .then(res => {
        if (gestopt) return
        setData(res)
        // Standaard staan alle randregels aangevinkt; de gebruiker hoeft
        // alleen de optie zelf aan te zetten.
        setGekozen(new Set(res.marge_regels.map(r => r.id)))
      })
      .catch((e: any) => {
        if (gestopt) return
        setData(null)
        setFout(e?.response?.data?.detail || 'Overzicht kon niet worden geladen')
      })
      .finally(() => {
        if (!gestopt) setLaden(false)
      })
    return () => {
      gestopt = true
    }
  }, [plate, year, weekStart, periodWeeks, bedrijfId, excludeWeekend, cutoffTime])

  const actieveIds = useMemo(
    () => (margeAan && data ? data.marge_regels.filter(r => gekozen.has(r.id)).map(r => r.id) : []),
    [margeAan, data, gekozen],
  )

  useEffect(() => {
    onSelectionChange(actieveIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actieveIds.join(',')])

  const margeTotaal = useMemo(() => {
    if (!data) return { aantal: 0, bedrag: 0, km: 0 }
    const rijen = data.marge_regels.filter(r => gekozen.has(r.id))
    return {
      aantal: rijen.length,
      bedrag: rijen.reduce((s, r) => s + r.bedrag, 0),
      km: rijen.reduce((s, r) => s + r.km, 0),
    }
  }, [data, gekozen])

  const wissel = (id: string) => {
    setGekozen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!plate || !year || !weekStart) return null

  if (laden && !data) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
        Overzicht laden…
      </div>
    )
  }

  if (fout) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {fout}
      </div>
    )
  }

  if (!data) return null

  const { meegenomen, niet_meegenomen: nietMee, marge } = data.samenvatting

  return (
    <div className="space-y-3">
      {/* Wat komt er op de factuur */}
      <div className="rounded-md border border-gray-200 bg-white px-3 py-3 space-y-2">
        <button
          type="button"
          onClick={() => setToonDagen(v => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-800">
            Op de factuur: {meegenomen.aantal} tolregels · {km(meegenomen.km)} ·{' '}
            {euro(meegenomen.bedrag)}
          </span>
          {toonDagen ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {toonDagen && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Dag</th>
                <th className="py-1 text-right">Regels</th>
                <th className="py-1 text-right">Km</th>
                <th className="py-1 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {data.meegenomen_per_dag.map(d => (
                <tr key={d.datum} className="border-t border-gray-100">
                  <td className="py-1">{d.datum}</td>
                  <td className="py-1 text-right tabular-nums">{d.aantal}</td>
                  <td className="py-1 text-right tabular-nums">{km(d.km)}</td>
                  <td className="py-1 text-right tabular-nums">{euro(d.bedrag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Niet meegenomen */}
      <div className="rounded-md border border-gray-200 bg-white px-3 py-3 space-y-2">
        <button
          type="button"
          onClick={() => setToonNiet(v => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-800">
            Niet meegenomen: {nietMee.aantal} tolregels · {km(nietMee.km)} ·{' '}
            {euro(nietMee.bedrag)}
          </span>
          {toonNiet ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {toonNiet && (
          nietMee.aantal === 0 ? (
            <p className="text-xs text-gray-500">
              Alle tolregels van deze periode komen op de factuur.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1">Datum / tijd</th>
                  <th className="py-1 text-right">Km</th>
                  <th className="py-1 text-right">Bedrag</th>
                  <th className="py-1">Reden</th>
                  <th className="py-1">Rittijd</th>
                </tr>
              </thead>
              <tbody>
                {data.niet_meegenomen.map(r => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-1 whitespace-nowrap">
                      {r.start}
                      {r.eind ? ` - ${r.eind}` : ''}
                    </td>
                    <td className="py-1 text-right tabular-nums">{km(r.km)}</td>
                    <td className="py-1 text-right tabular-nums">{euro(r.bedrag)}</td>
                    <td className="py-1">{r.reden_label}</td>
                    <td className="py-1 text-gray-500">
                      {tijdLabel(r)}
                      {r.rit_venster ? ` · ${r.rit_venster}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Randregels rond de rittijd */}
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 space-y-2">
        <div className="flex items-start gap-3">
          <input
            id="marge-aan"
            type="checkbox"
            checked={margeAan}
            onChange={e => setMargeAan(e.target.checked)}
            disabled={marge.aantal === 0}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40"
          />
          <label htmlFor="marge-aan" className="text-sm text-gray-800 cursor-pointer">
            <span className="font-medium">
              Tolregels rond de rittijd meenemen (± {data.marge_minuten} min)
            </span>
            <span className="block text-xs text-gray-600">
              {marge.aantal === 0
                ? 'Geen tolregels gevonden die hierbinnen vallen.'
                : `${marge.aantal} tolregel(s) · ${km(marge.km)} · ${euro(marge.bedrag)} ` +
                  'vallen nu weg, terwijl de wagen op dat moment reed. Aanzetten telt ze bij de factuur op.'}
            </span>
          </label>
        </div>

        {margeAan && marge.aantal > 0 && (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 w-6"></th>
                  <th className="py-1">Datum / tijd</th>
                  <th className="py-1 text-right">Km</th>
                  <th className="py-1 text-right">Kosten</th>
                  <th className="py-1">Reden weggelaten</th>
                  <th className="py-1">Gereden tijd</th>
                </tr>
              </thead>
              <tbody>
                {data.marge_regels.map(r => (
                  <tr key={r.id} className="border-t border-sky-100">
                    <td className="py-1">
                      <input
                        type="checkbox"
                        checked={gekozen.has(r.id)}
                        onChange={() => wissel(r.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="py-1 whitespace-nowrap">
                      {r.start}
                      {r.eind ? ` - ${r.eind}` : ''}
                    </td>
                    <td className="py-1 text-right tabular-nums">{km(r.km)}</td>
                    <td className="py-1 text-right tabular-nums">{euro(r.bedrag)}</td>
                    <td className="py-1">{r.reden_label}</td>
                    <td className="py-1 text-gray-600">
                      {tijdLabel(r)}
                      {r.rit_venster ? ` · ${r.rit_venster}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-sky-200 pt-2 text-sm font-medium text-sky-900">
              <span>Komt bovenop de factuur</span>
              <span className="tabular-nums">
                {margeTotaal.aantal} regel(s) · {km(margeTotaal.km)} · {euro(margeTotaal.bedrag)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
