/**
 * Tol versus facturatie.
 *
 * Een opdrachtgever vergoedt tolheffing op twee manieren, en welke van de twee
 * geldt verschilt per klant: als tolregel op onze eigen factuur (Mainfreight)
 * of als Maut-vergoeding op een afrekening die de klant stuurt (Dachser). Deze
 * pagina zet beide naast de tol die wij werkelijk betaalden, anders lijkt de
 * ene klant structureel te weinig gefactureerd.
 *
 * De bronnen zijn op verschillende dagen geboekt — een passage op zijn
 * rijdatum, een factuurregel op de factuurdatum, een afrekening op het begin
 * van de bon. Over een hele periode horen de totalen gelijk te zijn, per maand
 * niet. Daarom staat het verschil per wagen voorop en de maandkolom eronder.
 */
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

import { getAllCompanies } from '@/api/companies'
import {
  DoorbelastingOverzicht,
  tolDoorbelastingApi,
} from '@/api/tolDoorbelasting'
import { Company } from '@/types'

/** Kleinere verschillen zijn afrondings- en kortingsruis, geen signaal. */
const RUIS_GRENS = 1

function currency(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function maandLabel(maand: string): string {
  const [jaar, nummer] = maand.split('-')
  const d = new Date(Number(jaar), Number(nummer) - 1, 1)
  if (Number.isNaN(d.getTime())) return maand
  return d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
}

function verschilKlasse(verschil: number): string {
  if (Math.abs(verschil) < RUIS_GRENS) return 'text-gray-500'
  return verschil > 0 ? 'text-amber-700' : 'text-red-700'
}

function jaarStart(): string {
  return `${new Date().getFullYear()}-01-01`
}

function vandaag(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function TolDoorbelastingPage() {
  const [bedrijven, setBedrijven] = useState<Company[]>([])
  const [bedrijfId, setBedrijfId] = useState('')
  const [van, setVan] = useState(jaarStart)
  const [tot, setTot] = useState(vandaag)
  const [data, setData] = useState<DoorbelastingOverzicht | null>(null)
  const [laden, setLaden] = useState(false)

  useEffect(() => {
    getAllCompanies()
      .then(lijst => setBedrijven(
        [...lijst].sort((a, b) => a.naam.localeCompare(b.naam, 'nl-NL'))))
      .catch(() => toast.error('Bedrijven konden niet geladen worden.'))
  }, [])

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      setData(await tolDoorbelastingApi.overzicht({
        date_from: van,
        date_to: tot,
        ...(bedrijfId ? { bedrijf_id: bedrijfId } : {}),
      }))
    } catch (fout) {
      const detail = (fout as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      toast.error(detail || 'Het overzicht kon niet geladen worden.')
    } finally {
      setLaden(false)
    }
  }, [van, tot, bedrijfId])

  useEffect(() => { laad() }, [laad])

  const totalen = data?.totalen

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tol versus facturatie</h1>
        <p className="text-sm text-gray-600 mt-1">
          Wat wij aan tolheffing betaalden, naast wat we ervoor terugkregen: via
          een tolregel op onze eigen factuur, of via de Maut-vergoeding op een
          tolafrekening van de klant. Een positief verschil betekent dat wij
          ervoor opdraaien.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label" htmlFor="doorbelasting-bedrijf">Opdrachtgever</label>
          <select
            id="doorbelasting-bedrijf"
            className="input"
            value={bedrijfId}
            onChange={e => setBedrijfId(e.target.value)}
          >
            <option value="">Alle opdrachtgevers</option>
            {bedrijven.map(b => (
              <option key={b.id} value={b.id}>{b.naam}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="doorbelasting-van">Van</label>
          <input
            id="doorbelasting-van" type="date" className="input"
            value={van} onChange={e => setVan(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="doorbelasting-tot">Tot en met</label>
          <input
            id="doorbelasting-tot" type="date" className="input"
            value={tot} onChange={e => setTot(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-secondary" onClick={laad} disabled={laden}>
          <ArrowPathIcon className={`h-4 w-4 mr-1 ${laden ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {totalen && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kaart
            label="Betaalde tolheffing"
            waarde={currency(totalen.betaald)}
            bij={`${totalen.betaald_aantal} passages`}
          />
          <Kaart
            label="Doorbelast op facturen"
            waarde={currency(totalen.doorbelast)}
            bij={`${totalen.doorbelast_aantal} factuurregels`}
          />
          <Kaart
            label="Vergoed via afrekening"
            waarde={currency(totalen.vergoed)}
            bij={`${totalen.vergoed_aantal} regels op bonnen`}
          />
          <Kaart
            label="Verschil"
            waarde={currency(totalen.verschil)}
            bij={totalen.verschil > 0 ? 'niet terugontvangen' : 'te veel ontvangen'}
            klasse={verschilKlasse(totalen.verschil)}
          />
          <Kaart
            label="Nog niet gekoppeld"
            waarde={currency(totalen.open_bedrag)}
            bij="passages zonder factuurregel"
          />
        </div>
      )}

      {data && data.waarschuwingen.length > 0 && (
        <div className="card p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <ul className="text-sm text-amber-900 space-y-1">
              {data.waarschuwingen.map(melding => <li key={melding}>{melding}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 text-left">Kenteken</th>
              <th className="px-4 py-2 text-right">Betaald</th>
              <th className="px-4 py-2 text-right">Passages</th>
              <th className="px-4 py-2 text-right">Doorbelast</th>
              <th className="px-4 py-2 text-right">Regels</th>
              <th className="px-4 py-2 text-right">Vergoed</th>
              <th className="px-4 py-2 text-right">Verschil</th>
              <th className="px-4 py-2 text-right">Niet gekoppeld</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(data?.wagens ?? []).map(w => (
              <tr key={w.kenteken || '__leeg__'} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-medium text-gray-900">
                  {w.kenteken_display || w.kenteken || 'Zonder kenteken'}
                  {w.kenteken && !w.in_vloot && (
                    <span
                      className="ml-2 text-xs text-red-700"
                      title="Dit kenteken staat niet in het wagenpark; mogelijk een leesfout in de import"
                    >
                      niet in vloot
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{currency(w.betaald)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{w.betaald_aantal}</td>
                <td className="px-4 py-2 text-right tabular-nums">{currency(w.doorbelast)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{w.doorbelast_aantal}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {w.vergoed_aantal ? currency(w.vergoed) : '—'}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${verschilKlasse(w.verschil)}`}>
                  {currency(w.verschil)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                  {w.open_bedrag ? currency(w.open_bedrag) : '—'}
                </td>
              </tr>
            ))}
            {!laden && data && data.wagens.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Geen tolheffing en geen tolregels in deze periode.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.maanden.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4 text-sm text-gray-600">
            Per maand loopt de facturatie achter op de rit; alleen het totaal over
            de hele periode hoort te kloppen.
          </div>
          <table className="min-w-full text-sm mt-2">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left">Maand</th>
                <th className="px-4 py-2 text-right">Betaald</th>
                <th className="px-4 py-2 text-right">Doorbelast</th>
                <th className="px-4 py-2 text-right">Vergoed</th>
                <th className="px-4 py-2 text-right">Verschil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.maanden.map(m => (
                <tr key={m.maand}>
                  <td className="px-4 py-2 capitalize">{maandLabel(m.maand)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{currency(m.betaald)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{currency(m.doorbelast)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{currency(m.vergoed)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                    {currency(m.verschil)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kaart({ label, waarde, bij, klasse }: {
  label: string
  waarde: string
  bij: string
  klasse?: string
}) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${klasse || 'text-gray-900'}`}>{waarde}</div>
      <div className="text-xs text-gray-500 mt-0.5">{bij}</div>
    </div>
  )
}
