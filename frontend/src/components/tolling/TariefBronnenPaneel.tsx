/**
 * Officiele toltarieven van Nederland, Duitsland en Belgie. Een taak kijkt
 * elke maandagochtend of de tariefpagina's zijn gewijzigd; hier zie je de
 * uitkomst en kun je een melding afvinken.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

import { TariefBron, tollingApi } from '@/api/tolling'

const VLAG: Record<string, string> = { NL: 'Nederland', DE: 'Duitsland', BE: 'Belgie' }

function wanneer(iso: string | null): string {
  if (!iso) return 'nog niet'
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function TariefBronnenPaneel() {
  const [bronnen, setBronnen] = useState<TariefBron[]>([])
  const [bezig, setBezig] = useState(false)

  const laden = async () => {
    try {
      const data = await tollingApi.tariefBronnen()
      setBronnen(data.bronnen)
    } catch {
      /* geen melding: dit paneel mag de pagina niet in de weg zitten */
    }
  }

  useEffect(() => { laden() }, [])

  const controleren = async () => {
    setBezig(true)
    try {
      const data = await tollingApi.controleerTarieven()
      setBronnen(data.bronnen)
      if (data.gewijzigd.length > 0) {
        toast.error(`Tarieven gewijzigd op: ${data.gewijzigd.join(', ')}`, { duration: 8000 })
      } else if (data.mislukt.length > 0) {
        toast.error(`Niet gelezen: ${data.mislukt.join(', ')}`)
      } else {
        toast.success('Tarieven ongewijzigd')
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Controle mislukt')
    } finally {
      setBezig(false)
    }
  }

  const afvinken = async (bron: TariefBron) => {
    try {
      await tollingApi.tariefBronAfgehandeld(bron.id)
      await laden()
      toast.success(`${bron.naam} afgevinkt`)
    } catch {
      toast.error('Afvinken mislukt')
    }
  }

  const openstaand = bronnen.filter(b => b.openstaand)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Officiele toltarieven</h2>
          <p className="text-xs text-gray-500">
            Elke maandagochtend wordt gekeken of de tarieven van NL, DE of BE zijn gewijzigd.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={controleren} disabled={bezig}>
          <ArrowPathIcon className={`h-4 w-4 mr-1.5 ${bezig ? 'animate-spin' : ''}`} />
          {bezig ? 'Bezig…' : 'Nu controleren'}
        </button>
      </div>

      {openstaand.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
          <span>
            De tarieven zijn gewijzigd bij {openstaand.map(b => b.naam).join(', ')}. Kijk na wat
            er anders is voordat je een factuur verstuurt.
          </span>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {bronnen.map(bron => (
          <div
            key={bron.id}
            className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {VLAG[bron.land] || bron.land} · {bron.naam}
              </p>
              <p className="text-xs text-gray-500">
                Gecontroleerd {wanneer(bron.laatst_gecontroleerd)}
                {bron.laatst_gewijzigd && ` · gewijzigd ${wanneer(bron.laatst_gewijzigd)}`}
                {bron.fout && ` · ${bron.fout}`}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <a
                href={bron.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-xs text-blue-600 hover:underline"
              >
                Tarieven bekijken
                <ArrowTopRightOnSquareIcon className="ml-1 h-3.5 w-3.5" />
              </a>
              {bron.openstaand && (
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => afvinken(bron)}
                >
                  <CheckCircleIcon className="mr-1 h-4 w-4" />
                  Nagekeken
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
