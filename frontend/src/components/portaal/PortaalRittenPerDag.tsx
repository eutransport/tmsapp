import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { PortaalRit } from '@/api/portaalTracking'

interface Dagregel {
  sleutel: string
  datum: string
  kenteken: string
  eerste_start: string
  laatste_eind: string | null
  afstand_km: number
  rijtijd_seconden: number
  ritten: PortaalRit[]
}

function duurSeconden(rit: PortaalRit) {
  if (!rit.eind_tijd) return 0
  const verschil = new Date(rit.eind_tijd).getTime() - new Date(rit.start_tijd).getTime()
  return verschil > 0 ? Math.round(verschil / 1000) : 0
}

function groepeer(ritten: PortaalRit[]): Dagregel[] {
  const perDag = new Map<string, Dagregel>()
  for (const rit of ritten) {
    const sleutel = `${rit.datum}|${rit.kenteken}`
    let regel = perDag.get(sleutel)
    if (!regel) {
      regel = {
        sleutel,
        datum: rit.datum,
        kenteken: rit.kenteken,
        eerste_start: rit.start_tijd,
        laatste_eind: rit.eind_tijd,
        afstand_km: 0,
        rijtijd_seconden: 0,
        ritten: [],
      }
      perDag.set(sleutel, regel)
    }
    regel.ritten.push(rit)
    regel.afstand_km += rit.afstand_km || 0
    regel.rijtijd_seconden += duurSeconden(rit)
    if (new Date(rit.start_tijd) < new Date(regel.eerste_start)) regel.eerste_start = rit.start_tijd
    if (rit.eind_tijd && (!regel.laatste_eind || new Date(rit.eind_tijd) > new Date(regel.laatste_eind))) {
      regel.laatste_eind = rit.eind_tijd
    }
  }
  const regels = [...perDag.values()]
  for (const regel of regels) {
    regel.ritten.sort((a, b) => a.start_tijd.localeCompare(b.start_tijd))
  }
  regels.sort((a, b) => b.datum.localeCompare(a.datum) || a.kenteken.localeCompare(b.kenteken))
  return regels
}

export default function PortaalRittenPerDag({ ritten }: { ritten: PortaalRit[] }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  const regels = useMemo(() => groepeer(ritten), [ritten])

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '-'
  const datum = (waarde: string) =>
    new Date(waarde).toLocaleDateString(i18n.language, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  const uren = (seconden: number) =>
    `${Math.floor(seconden / 3600)}u ${String(Math.floor((seconden % 3600) / 60)).padStart(2, '0')}m`
  const km = (waarde: number) => `${waarde.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} km`
  const plek = (adres: string, plaats: string) => [adres, plaats].filter(Boolean).join(', ') || '-'

  if (regels.length === 0) {
    return <p className="p-4 text-sm text-muted">{t('portaalMap.noTrips', 'Geen ritten in deze periode.')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="w-8 px-2 py-3" />
            <th className="px-4 py-3">{t('portaalMap.date', 'Datum')}</th>
            <th className="px-4 py-3">{t('orders.plate', 'Kenteken')}</th>
            <th className="px-4 py-3">{t('radius.firstStart', 'Eerste start')}</th>
            <th className="px-4 py-3">{t('radius.lastEnd', 'Laatste einde')}</th>
            <th className="px-4 py-3 text-right">{t('portaalMap.distance', 'Afstand')}</th>
            <th className="px-4 py-3 text-right">{t('radius.journeyCount', 'Ritten')}</th>
            <th className="px-4 py-3 text-right">{t('radius.duration', 'Rijtijd')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {regels.map(regel => {
            const uitgeklapt = open === regel.sleutel
            return (
              <Fragment key={regel.sleutel}>
                <tr
                  onClick={() => setOpen(uitgeklapt ? null : regel.sleutel)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-2 py-3 text-gray-400">
                    {uitgeklapt ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{datum(regel.datum)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{regel.kenteken}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{tijd(regel.eerste_start)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{tijd(regel.laatste_eind)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">{km(regel.afstand_km)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">{regel.ritten.length}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">{uren(regel.rijtijd_seconden)}</td>
                </tr>
                {uitgeklapt && (
                  <tr className="bg-gray-50">
                    <td colSpan={8} className="px-4 py-3">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="py-1 text-left font-medium">{t('radius.start', 'Start')}</th>
                            <th className="py-1 text-left font-medium">{t('radius.from', 'Vertrek')}</th>
                            <th className="py-1 text-left font-medium">{t('radius.end', 'Einde')}</th>
                            <th className="py-1 text-left font-medium">{t('radius.destination', 'Aankomst')}</th>
                            <th className="py-1 text-right font-medium">{t('portaalMap.distance', 'Afstand')}</th>
                            <th className="py-1 text-right font-medium">{t('radius.duration', 'Duur')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {regel.ritten.map(rit => (
                            <tr key={rit.id} className="text-gray-700">
                              <td className="whitespace-nowrap py-1 pr-3">{tijd(rit.start_tijd)}</td>
                              <td className="py-1 pr-3">{plek(rit.start_adres, rit.start_plaats)}</td>
                              <td className="whitespace-nowrap py-1 pr-3">{tijd(rit.eind_tijd)}</td>
                              <td className="py-1 pr-3">{plek(rit.eind_adres, rit.eind_plaats)}</td>
                              <td className="whitespace-nowrap py-1 pl-3 text-right">{km(rit.afstand_km)}</td>
                              <td className="whitespace-nowrap py-1 pl-3 text-right">{uren(duurSeconden(rit))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
