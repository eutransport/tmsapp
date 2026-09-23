/**
 * Radius Velocity — ritgeschiedenis en archief.
 *
 * Radius bewaart zelf ongeveer 30 dagen. Het tabblad "Archief" leest uit onze
 * eigen database en gaat daardoor verder terug.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import {
  downloadRadiusArchive,
  getRadiusArchive,
  getRadiusJourneySummary,
  syncRadiusArchive,
  type RadiusArchiveEntry,
  type RadiusVehicleSummary,
} from '@/api/radius'

type Weergave = 'overzicht' | 'archief'

function urenTekst(seconden: number): string {
  const uren = Math.floor(seconden / 3600)
  const minuten = Math.floor((seconden % 3600) / 60)
  return `${uren}u ${String(minuten).padStart(2, '0')}m`
}

function tijdTekst(waarde: string | null): string {
  if (!waarde) return '-'
  return new Date(waarde).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function datumTekst(waarde: string): string {
  return new Date(waarde).toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function vandaag(): string {
  return new Date().toISOString().slice(0, 10)
}

function dagenGeleden(dagen: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dagen)
  return d.toISOString().slice(0, 10)
}

export default function RadiusJourneysPanel() {
  const { t } = useTranslation()
  const [weergave, setWeergave] = useState<Weergave>('overzicht')
  const [van, setVan] = useState(dagenGeleden(6))
  const [tot, setTot] = useState(vandaag())
  const [kenteken, setKenteken] = useState('')

  const [overzicht, setOverzicht] = useState<RadiusVehicleSummary[]>([])
  const [archief, setArchief] = useState<RadiusArchiveEntry[]>([])
  const [kentekens, setKentekens] = useState<string[]>([])
  const [totalen, setTotalen] = useState({ km: 0, seconden: 0, ritten: 0 })

  const [laden, setLaden] = useState(false)
  const [synchroniseert, setSynchroniseert] = useState(false)
  const [downloadt, setDownloadt] = useState<string | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [melding, setMelding] = useState<string | null>(null)
  const [uitgeklapt, setUitgeklapt] = useState<string | null>(null)

  const laadGegevens = useCallback(async () => {
    setLaden(true)
    setFout(null)
    try {
      if (weergave === 'overzicht') {
        const data = await getRadiusJourneySummary({ from: van, to: tot })
        setOverzicht(data.vehicles)
        setTotalen({
          km: data.total_distance_km,
          seconden: data.total_duration_seconds,
          ritten: data.journey_count,
        })
      } else {
        const data = await getRadiusArchive({
          from: van,
          to: tot,
          ...(kenteken ? { plate: kenteken } : {}),
        })
        setArchief(data.entries)
        setKentekens(data.plates)
        setTotalen({
          km: data.total_distance_km,
          seconden: data.total_duration_seconds,
          ritten: data.journey_count,
        })
      }
    } catch (err: any) {
      setFout(
        err?.response?.data?.detail ||
          t('radius.loadFailed', 'De Radius-gegevens konden niet worden opgehaald.'),
      )
    } finally {
      setLaden(false)
    }
  }, [weergave, van, tot, kenteken, t])

  useEffect(() => {
    laadGegevens()
  }, [laadGegevens])

  const handleSync = async () => {
    setSynchroniseert(true)
    setMelding(null)
    setFout(null)
    try {
      const resultaat = await syncRadiusArchive(30)
      setMelding(
        t('radius.syncDone', {
          defaultValue: '{{fetched}} ritten opgehaald, {{created}} nieuw in het archief.',
          fetched: resultaat.journeys_fetched,
          created: resultaat.journeys_created,
        }) as string,
      )
      await laadGegevens()
    } catch (err: any) {
      setFout(
        err?.response?.data?.detail ||
          t('radius.syncFailed', 'De synchronisatie is mislukt.'),
      )
    } finally {
      setSynchroniseert(false)
    }
  }

  const handleDownload = async (formaat: 'csv' | 'xlsx' | 'pdf') => {
    setDownloadt(formaat)
    setFout(null)
    try {
      await downloadRadiusArchive(
        { from: van, to: tot, ...(kenteken ? { plate: kenteken } : {}) },
        formaat,
      )
    } catch {
      setFout(t('radius.downloadFailed', 'De download is mislukt.'))
    } finally {
      setDownloadt(null)
    }
  }

  const periodeKnoppen = useMemo(
    () => [
      { id: 'vandaag', label: t('radius.today', 'Vandaag'), dagen: 0 },
      { id: 'week', label: t('radius.last7', '7 dagen'), dagen: 6 },
      { id: 'maand', label: t('radius.last30', '30 dagen'), dagen: 29 },
    ],
    [t],
  )

  const actievePeriode = useMemo(() => {
    if (tot !== vandaag()) return null
    const knop = periodeKnoppen.find((k) => dagenGeleden(k.dagen) === van)
    return knop?.id ?? null
  }, [van, tot, periodeKnoppen])

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClockIcon className="h-6 w-6 text-primary-600 sm:h-7 sm:w-7" />
            {t('radius.journeysTitle', 'Radius ritgeschiedenis')}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            {totalen.ritten} {t('radius.journeys', 'ritten')} ·{' '}
            {totalen.km.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km ·{' '}
            {urenTekst(totalen.seconden)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={synchroniseert}
          className="btn-secondary flex items-center gap-2"
          title={t('radius.syncHint', 'Haalt alles op wat Radius nog bewaart (circa 30 dagen)') as string}
        >
          <ArrowPathIcon className={`h-4 w-4 ${synchroniseert ? 'animate-spin' : ''}`} />
          {t('radius.sync', 'Nu synchroniseren')}
        </button>
      </div>

      {/* Filters */}
      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">{t('common.from', 'Van')}</label>
            <input
              type="date"
              value={van}
              max={tot}
              onChange={(e) => setVan(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">{t('common.to', 'Tot')}</label>
            <input
              type="date"
              value={tot}
              min={van}
              max={vandaag()}
              onChange={(e) => setTot(e.target.value)}
              className="input"
            />
          </div>
          {weergave === 'archief' && (
            <div>
              <label className="label">{t('radius.plate', 'Kenteken')}</label>
              <select
                value={kenteken}
                onChange={(e) => setKenteken(e.target.value)}
                className="input"
              >
                <option value="">{t('radius.allPlates', 'Alle wagens')}</option>
                {kentekens.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            {periodeKnoppen.map((knop) => (
              <button
                key={knop.id}
                type="button"
                onClick={() => {
                  setVan(dagenGeleden(knop.dagen))
                  setTot(vandaag())
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  actievePeriode === knop.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {knop.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {(['csv', 'xlsx', 'pdf'] as const).map((formaat) => (
              <button
                key={formaat}
                type="button"
                onClick={() => handleDownload(formaat)}
                disabled={downloadt !== null}
                className="btn-secondary flex items-center gap-1.5 text-sm uppercase"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {formaat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1 border-t border-gray-100 pt-3">
          {(
            [
              ['overzicht', t('radius.perVehicle', 'Per wagen (live uit Radius)')],
              ['archief', t('radius.archive', 'Archief per dag')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setWeergave(id as Weergave)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                weergave === id
                  ? 'bg-primary-100 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {melding && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {melding}
        </div>
      )}
      {fout && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          <span>{fout}</span>
        </div>
      )}

      {laden && <p className="text-sm text-gray-500">{t('common.loading', 'Laden...')}</p>}

      {/* Overzicht per wagen */}
      {!laden && weergave === 'overzicht' && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                  {t('radius.plate', 'Kenteken')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.distance', 'Afstand')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.journeyCount', 'Ritten')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.duration', 'Rijtijd')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overzicht.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    {t('radius.noJourneys', 'Geen ritten in deze periode.')}
                  </td>
                </tr>
              )}
              {overzicht.map((wagen) => (
                <tr key={wagen.plate_number} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-gray-900">
                      <TruckIcon className="h-4 w-4 text-gray-400" />
                      {wagen.plate_number}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                    {wagen.distance_km.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                    {wagen.journey_count}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                    {urenTekst(wagen.duration_seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Archief per dag */}
      {!laden && weergave === 'archief' && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-8 px-2 py-2.5" />
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                  {t('common.date', 'Datum')}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                  {t('radius.plate', 'Kenteken')}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                  {t('radius.firstStart', 'Eerste start')}
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-600">
                  {t('radius.lastEnd', 'Laatste einde')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.distance', 'Afstand')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.journeyCount', 'Ritten')}
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-gray-600">
                  {t('radius.duration', 'Rijtijd')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {archief.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    {t('radius.noArchive', 'Nog geen ritten in het archief voor deze periode.')}
                  </td>
                </tr>
              )}
              {archief.map((regel) => {
                const sleutel = `${regel.date}-${regel.plate_number}`
                const open = uitgeklapt === sleutel
                return (
                  <Fragment key={sleutel}>
                    <tr
                      onClick={() => setUitgeklapt(open ? null : sleutel)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-2 py-2.5 text-gray-400">
                        {open ? (
                          <ChevronDownIcon className="h-4 w-4" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4" />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                        {datumTekst(regel.date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900">
                        {regel.plate_number}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                        {tijdTekst(regel.first_start)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                        {tijdTekst(regel.last_end)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                        {regel.distance_km.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                        {regel.journey_count}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                        {urenTekst(regel.duration_seconds)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-4 py-3">
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="py-1 text-left font-medium">
                                  {t('radius.start', 'Start')}
                                </th>
                                <th className="py-1 text-left font-medium">
                                  {t('radius.from', 'Vertrek')}
                                </th>
                                <th className="py-1 text-left font-medium">
                                  {t('radius.end', 'Einde')}
                                </th>
                                <th className="py-1 text-left font-medium">
                                  {t('radius.destination', 'Aankomst')}
                                </th>
                                <th className="py-1 text-right font-medium">
                                  {t('radius.distance', 'Afstand')}
                                </th>
                                <th className="py-1 text-right font-medium">
                                  {t('radius.duration', 'Duur')}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {regel.journeys.map((rit) => (
                                <tr key={`${rit.service_id}-${rit.start_time}`} className="text-gray-700">
                                  <td className="whitespace-nowrap py-1 pr-3">
                                    {tijdTekst(rit.start_time)}
                                  </td>
                                  <td className="max-w-[220px] truncate py-1 pr-3">
                                    {rit.start_address || '-'}
                                  </td>
                                  <td className="whitespace-nowrap py-1 pr-3">
                                    {tijdTekst(rit.end_time)}
                                  </td>
                                  <td className="max-w-[220px] truncate py-1 pr-3">
                                    {rit.end_address || '-'}
                                  </td>
                                  <td className="whitespace-nowrap py-1 text-right">
                                    {rit.distance_km.toLocaleString('nl-NL', {
                                      maximumFractionDigits: 1,
                                    })}{' '}
                                    km
                                  </td>
                                  <td className="whitespace-nowrap py-1 text-right">
                                    {urenTekst(rit.duration_seconds)}
                                  </td>
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
      )}
    </div>
  )
}
