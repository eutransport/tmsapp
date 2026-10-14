/**
 * Eén ronde met Radius: facturen ophalen, GPS erbij synchroniseren,
 * vergelijken en pas na akkoord inlezen.
 *
 * Gereden dagen zonder tolregel blijven als openstaand staan, zodat een
 * volgende ronde ze alsnog kan aanvullen zodra Radius ze factureert.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import {
  haalFacturenOp,
  haalOpenstaand,
  verwerkFacturen,
  type OpenstaandeDag,
  type RondeVoorbeeld,
} from '@/api/radiusSync'

const LAND_KLEUR: Record<string, string> = {
  NL: 'bg-orange-100 text-orange-800',
  DE: 'bg-slate-200 text-slate-800',
  BE: 'bg-yellow-100 text-yellow-800',
}

function datumMin(dagen: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dagen)
  return d.toLocaleDateString('sv-SE')
}

function vandaag(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function euro(waarde: string | number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
    .format(Number(waarde) || 0)
}

export default function RadiusSyncPaneel({ opKlaar }: { opKlaar?: () => void }) {
  const [van, setVan] = useState(() => datumMin(30))
  const [tot, setTot] = useState(vandaag)
  const [bezig, setBezig] = useState<'' | 'ophalen' | 'verwerken'>('')
  const [ronde, setRonde] = useState<RondeVoorbeeld | null>(null)
  const [openstaand, setOpenstaand] = useState<OpenstaandeDag[]>([])
  const [openTonen, setOpenTonen] = useState(false)

  const periode = { date_from: van || undefined, date_to: tot || undefined }

  async function ververOpenstaand() {
    try {
      const r = await haalOpenstaand()
      setOpenstaand(r.regels)
    } catch {
      // Een lege lijst is hier geen fout die de gebruiker moet zien.
    }
  }

  useEffect(() => {
    ververOpenstaand()
  }, [])

  async function ophalen() {
    setBezig('ophalen')
    try {
      const r = await haalFacturenOp(periode)
      setRonde(r)
      if (!r.gps.gelukt) {
        toast.error(`GPS ophalen mislukt: ${r.gps.melding ?? 'onbekende fout'}`)
      }
      toast.success(
        `${r.aantal_regels} tolregels gevonden, ${r.gps.journeys_fetched ?? 0} GPS-ritten erbij`,
      )
      await ververOpenstaand()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Ophalen bij Radius is mislukt.')
    } finally {
      setBezig('')
    }
  }

  async function verwerken() {
    setBezig('verwerken')
    try {
      const r = await verwerkFacturen(periode)
      toast.success(
        `${r.import.geimporteerd} tolregels ingelezen` +
        (r.openstaand.alsnog_aangevuld
          ? `, ${r.openstaand.alsnog_aangevuld} openstaande dagen aangevuld`
          : ''),
      )
      setRonde(null)
      await ververOpenstaand()
      opKlaar?.()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? 'Inlezen is mislukt.')
    } finally {
      setBezig('')
    }
  }

  const nieuw = ronde ? ronde.regels.filter(r => !r.bestaat_al).length : 0

  return (
    <section className="card p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">Facturen ophalen bij Radius</h3>
          <p className="text-sm text-slate-500">
            Haalt de toltransacties op, synchroniseert de GPS-ritten van dezelfde periode
            en vergelijkt beide voordat er iets wordt ingelezen.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-slate-600">Van</span>
            <input type="date" className="input" value={van} max={tot}
              onChange={e => setVan(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-600">Tot en met</span>
            <input type="date" className="input" value={tot} min={van} max={vandaag()}
              onChange={e => setTot(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" disabled={bezig !== ''}
            onClick={ophalen}>
            <ArrowPathIcon className={`w-4 h-4 mr-1 ${bezig === 'ophalen' ? 'animate-spin' : ''}`} />
            {bezig === 'ophalen' ? 'Bezig met ophalen...' : 'Facturen ophalen'}
          </button>
        </div>
      </div>

      {ronde && (
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-700">
              <strong>{ronde.aantal_regels}</strong> tolregels, totaal{' '}
              <strong>{euro(ronde.totaal_bedrag)}</strong>, waarvan{' '}
              <strong>{nieuw}</strong> nog niet ingelezen
            </span>
            {Object.entries(ronde.per_land).map(([land, cijfers]) => (
              <span key={land}
                className={`px-2 py-0.5 rounded text-xs font-medium ${LAND_KLEUR[land] ?? 'bg-slate-100 text-slate-700'}`}>
                {land}: {cijfers.regels} regels, {euro(cijfers.bedrag)}
              </span>
            ))}
            <button type="button" className="btn btn-primary ml-auto"
              disabled={bezig !== '' || nieuw === 0} onClick={verwerken}>
              <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
              {bezig === 'verwerken' ? 'Bezig met inlezen...' : `${nieuw} regels inlezen`}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="bg-slate-50 rounded p-3">
              <div className="text-slate-500">GPS-ritten opgehaald</div>
              <div className="font-semibold text-slate-800">
                {ronde.gps.journeys_fetched ?? 0}
                <span className="font-normal text-slate-500">
                  {' '}({ronde.gps.journeys_created ?? 0} nieuw, {ronde.gps.vehicles ?? 0} wagens)
                </span>
              </div>
              {ronde.gps.begrensd && (
                <div className="text-amber-700 text-xs mt-1">
                  De periode is lang; GPS is beperkt tot de laatste 92 dagen.
                </div>
              )}
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="text-slate-500">Gereden dagen vergeleken</div>
              <div className="font-semibold text-slate-800">
                {ronde.openstaand.gefactureerde_dagen} van {ronde.openstaand.gereden_dagen}{' '}
                <span className="font-normal text-slate-500">gefactureerd</span>
              </div>
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="text-slate-500">Nog niet gefactureerd</div>
              <div className="font-semibold text-slate-800">
                {ronde.openstaand.totaal_openstaand} dagen
                {ronde.openstaand.alsnog_aangevuld > 0 && (
                  <span className="font-normal text-emerald-700">
                    {' '}({ronde.openstaand.alsnog_aangevuld} aangevuld)
                  </span>
                )}
              </div>
            </div>
          </div>

          {ronde.overgeslagen.length > 0 && (
            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
              <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
              <div>
                {ronde.overgeslagen.length} toltransacties zonder kenteken worden niet ingelezen.
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Kenteken</th>
                  <th className="px-3 py-2 text-center">Land</th>
                  <th className="px-3 py-2">Rit</th>
                  <th className="px-3 py-2">Bedrijf</th>
                  <th className="px-3 py-2 text-right">Bedrag</th>
                  <th className="px-3 py-2 text-right">Km</th>
                  <th className="px-3 py-2">Opmerking</th>
                </tr>
              </thead>
              <tbody>
                {ronde.regels.slice(0, 100).map((r, i) => (
                  <tr key={i}
                    className={`border-b border-slate-100 ${r.bestaat_al ? 'text-slate-400' : ''}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.datum} {r.tijdstip}</td>
                    <td className="px-3 py-1.5">{r.kenteken}</td>
                    <td className="px-3 py-1.5 text-center">
                      {r.land ? (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${LAND_KLEUR[r.land] ?? 'bg-slate-100'}`}>
                          {r.land}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5">{r.ritnummer || '—'}</td>
                    <td className="px-3 py-1.5">{r.bedrijf || '—'}</td>
                    <td className="px-3 py-1.5 text-right">{euro(r.bedrag)}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap"
                      title={r.gps_km ? `De GPS-rit was ${r.gps_km} km, inclusief tolvrije wegen.` : ''}>
                      {r.afstand_km
                        ? Number(r.afstand_km).toLocaleString('nl-NL', { maximumFractionDigits: 1 })
                        : <span className="text-amber-600">?</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-500">{r.opmerking}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ronde.regels.length > 100 && (
              <p className="text-xs text-slate-500 mt-2">
                Eerste 100 van {ronde.regels.length} regels getoond.
              </p>
            )}
            <p className="text-xs text-slate-500 mt-2">
              Radius levert geen kilometers bij een tolregel. De afstand wordt teruggerekend
              uit het bedrag met het tarief dat deze wagen in dit land eerder betaalde. Een
              <span className="text-amber-600 font-medium"> ? </span>
              betekent dat dat tarief nog niet bekend is; die regels vullen zich vanzelf
              zodra er genoeg tolregels met afstand zijn ingelezen.
            </p>
          </div>
        </div>
      )}

      {openstaand.length > 0 && (
        <div className="border-t border-slate-200 pt-3">
          <button type="button" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
            onClick={() => setOpenTonen(v => !v)}>
            <ClockIcon className="w-4 h-4" />
            {openstaand.length} gereden dagen wachten nog op een factuur
            <span className="text-xs text-slate-400">({openTonen ? 'verbergen' : 'tonen'})</span>
          </button>
          {openTonen && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">Datum</th>
                    <th className="px-3 py-2">Kenteken</th>
                    <th className="px-3 py-2 text-right">GPS-ritten</th>
                    <th className="px-3 py-2 text-right">GPS-km</th>
                    <th className="px-3 py-2 text-right">Controles</th>
                  </tr>
                </thead>
                <tbody>
                  {openstaand.slice(0, 50).map(r => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5">{r.datum}</td>
                      <td className="px-3 py-1.5">
                        {r.kenteken}
                        {!r.in_vloot && (
                          <span className="ml-2 text-xs text-amber-700">niet in de vloot</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">{r.gps_ritten}</td>
                      <td className="px-3 py-1.5 text-right">{Number(r.gps_km).toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-right">{r.pogingen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
