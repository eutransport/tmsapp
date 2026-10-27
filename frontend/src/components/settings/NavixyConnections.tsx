/**
 * Beheer van de Navixy-koppeling binnen Instellingen > Koppelingen.
 * Eén API-sleutel per account, met daaronder de kastjes gekoppeld aan kenteken.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  SignalIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import {
  NavixyKoppeling,
  getNavixyKoppelingen,
  maakNavixyKoppeling,
  maakNavixyTracker,
  testNavixyKoppeling,
  verwijderNavixyKoppeling,
  verwijderNavixyTracker,
  wijzigNavixyKoppeling,
  wijzigNavixyTracker,
} from '@/api/navixyConnections'

export default function NavixyConnections() {
  const { t } = useTranslation()
  const [koppelingen, setKoppelingen] = useState<NavixyKoppeling[]>([])
  const [laden, setLaden] = useState(true)
  const [laadFout, setLaadFout] = useState('')
  const [formulierOpen, setFormulierOpen] = useState(false)
  const [naam, setNaam] = useState('')
  const [sleutel, setSleutel] = useState('')
  const [opslaan, setOpslaan] = useState(false)
  const [fout, setFout] = useState('')

  const laadKoppelingen = async () => {
    try {
      setKoppelingen(await getNavixyKoppelingen())
      setLaadFout('')
    } catch {
      setLaadFout(
        t('settings.navixyLaadFout', 'De Navixy-koppeling kon niet geladen worden.'),
      )
    } finally {
      setLaden(false)
    }
  }

  useEffect(() => {
    laadKoppelingen()
  }, [])

  const toevoegen = async (e: React.FormEvent) => {
    e.preventDefault()
    setFout('')
    setOpslaan(true)
    try {
      await maakNavixyKoppeling({ naam: naam.trim(), api_key: sleutel.trim() })
      setNaam('')
      setSleutel('')
      setFormulierOpen(false)
      await laadKoppelingen()
    } catch (error: any) {
      const gegevens = error?.response?.data
      setFout(
        gegevens?.api_key?.[0] ||
          gegevens?.naam?.[0] ||
          gegevens?.detail ||
          (t('settings.navixyOpslaanMislukt', 'Opslaan mislukt.') as string),
      )
    } finally {
      setOpslaan(false)
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <SignalIcon className="h-5 w-5" />
            {t('settings.navixyTitel', 'Navixy (GPS per voertuig)')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t(
              'settings.navixyUitleg',
              'Voor wagens met een eigen Navixy-kastje. Koppel het tracker-nummer aan het kenteken; de posities komen daarna vanzelf op de kaart en in de opdrachten.',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormulierOpen(!formulierOpen)}
          className="btn-secondary text-sm whitespace-nowrap"
        >
          {formulierOpen ? (
            <>
              <XMarkIcon className="h-4 w-4 mr-1 inline" />
              {t('common.cancel', 'Annuleren')}
            </>
          ) : (
            <>
              <PlusIcon className="h-4 w-4 mr-1 inline" />
              {t('settings.navixyAccountToevoegen', 'Account toevoegen')}
            </>
          )}
        </button>
      </div>

      {laadFout && <p className="text-sm text-red-600 dark:text-red-400">{laadFout}</p>}

      {laden ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading', 'Laden...')}</p>
      ) : koppelingen.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('settings.navixyGeenAccounts', 'Nog geen Navixy-account gekoppeld.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {koppelingen.map((koppeling) => (
            <KoppelingRij
              key={koppeling.id}
              koppeling={koppeling}
              opVernieuwen={laadKoppelingen}
            />
          ))}
        </ul>
      )}

      {formulierOpen && (
        <form
          onSubmit={toevoegen}
          className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('settings.navixyKoppelingNaam', 'Naam')}
              </label>
              <input
                type="text"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                placeholder={t('settings.navixyNaamVoorbeeld', 'Navy Track') as string}
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('settings.navixyApiSleutel', 'API-sleutel')}
              </label>
              <input
                type="password"
                value={sleutel}
                onChange={(e) => setSleutel(e.target.value)}
                className="input"
                autoComplete="off"
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                {t(
                  'settings.navixyApiSleutelHint',
                  'Gebruik een permanente API-sleutel uit Navixy, geen inlogsessie.',
                )}
              </p>
            </div>
          </div>
          {fout && <p className="text-sm text-red-600 dark:text-red-400">{fout}</p>}
          <button type="submit" disabled={opslaan} className="btn-primary disabled:opacity-50">
            {opslaan ? t('common.saving', 'Opslaan...') : t('common.save', 'Opslaan')}
          </button>
        </form>
      )}
    </div>
  )
}

function KoppelingRij({
  koppeling,
  opVernieuwen,
}: {
  koppeling: NavixyKoppeling
  opVernieuwen: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [testen, setTesten] = useState(false)
  const [nieuweSleutel, setNieuweSleutel] = useState('')
  const [sleutelOpslaan, setSleutelOpslaan] = useState(false)
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerId, setTrackerId] = useState('')
  const [kenteken, setKenteken] = useState('')
  const [trackerFout, setTrackerFout] = useState('')
  const [trackerOpslaan, setTrackerOpslaan] = useState(false)

  const geslaagd = koppeling.laatste_resultaat.startsWith('Verbinding in orde')

  const testVerbinding = async () => {
    setTesten(true)
    await testNavixyKoppeling(koppeling.id)
    setTesten(false)
    await opVernieuwen()
  }

  const sleutelVervangen = async () => {
    if (!nieuweSleutel.trim()) return
    setSleutelOpslaan(true)
    try {
      await wijzigNavixyKoppeling(koppeling.id, { api_key: nieuweSleutel.trim() })
      setNieuweSleutel('')
      await opVernieuwen()
    } finally {
      setSleutelOpslaan(false)
    }
  }

  const verwijderen = async () => {
    if (
      !window.confirm(
        t(
          'settings.navixyKoppelingVerwijderBevestig',
          'Deze Navixy-koppeling en alle gekoppelde trackers verwijderen?',
        ) as string,
      )
    ) {
      return
    }
    await verwijderNavixyKoppeling(koppeling.id)
    await opVernieuwen()
  }

  const trackerToevoegen = async (e: React.FormEvent) => {
    e.preventDefault()
    setTrackerFout('')
    setTrackerOpslaan(true)
    try {
      await maakNavixyTracker({
        koppeling: koppeling.id,
        tracker_id: Number(trackerId),
        kenteken: kenteken.trim().toUpperCase(),
      })
      setTrackerId('')
      setKenteken('')
      setTrackerOpen(false)
      await opVernieuwen()
    } catch (error: any) {
      const gegevens = error?.response?.data
      setTrackerFout(
        gegevens?.tracker_id?.[0] ||
          gegevens?.kenteken?.[0] ||
          gegevens?.detail ||
          (t('settings.navixyTrackerOpslaanMislukt', 'Tracker opslaan mislukt.') as string),
      )
    } finally {
      setTrackerOpslaan(false)
    }
  }

  return (
    <li className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-white truncate">{koppeling.naam}</p>
          {koppeling.laatste_resultaat ? (
            <p
              className={`text-xs flex items-center gap-1 ${
                geslaagd ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {geslaagd ? (
                <CheckCircleIcon className="h-4 w-4" />
              ) : (
                <ExclamationTriangleIcon className="h-4 w-4" />
              )}
              {koppeling.laatste_resultaat}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.navixyNogNietGetest', 'Nog niet getest.')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={testVerbinding}
            disabled={testen}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {testen
              ? t('settings.navixyTesting', 'Bezig met testen...')
              : t('settings.navixyTest', 'Verbinding testen')}
          </button>
          <button
            type="button"
            onClick={verwijderen}
            className="p-2 text-gray-400 hover:text-red-600"
            title={t('common.delete', 'Verwijderen') as string}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {t('settings.navixySleutelVervangen', 'Sleutel vervangen')}
          </label>
          <input
            type="password"
            value={nieuweSleutel}
            onChange={(e) => setNieuweSleutel(e.target.value)}
            placeholder={t('settings.navixySleutelPlaceholder', 'Nieuwe API-sleutel') as string}
            className="input"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          onClick={sleutelVervangen}
          disabled={sleutelOpslaan || !nieuweSleutel.trim()}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {sleutelOpslaan ? t('common.saving', 'Opslaan...') : t('common.save', 'Opslaan')}
        </button>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('settings.navixyTrackers', 'Gekoppelde voertuigen')}
          </p>
          <button
            type="button"
            onClick={() => setTrackerOpen(!trackerOpen)}
            className="btn-secondary text-xs"
          >
            {trackerOpen ? (
              <>
                <XMarkIcon className="h-3.5 w-3.5 mr-1 inline" />
                {t('common.cancel', 'Annuleren')}
              </>
            ) : (
              <>
                <PlusIcon className="h-3.5 w-3.5 mr-1 inline" />
                {t('settings.navixyTrackerToevoegen', 'Voertuig koppelen')}
              </>
            )}
          </button>
        </div>

        {koppeling.trackers.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('settings.navixyGeenTrackers', 'Nog geen voertuig gekoppeld.')}
          </p>
        ) : (
          <ul className="space-y-1">
            {koppeling.trackers.map((tracker) => (
              <li
                key={tracker.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1.5"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {tracker.kenteken}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.navixyTrackerNummer', 'Tracker')} {tracker.tracker_id}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={tracker.actief}
                      onChange={async (e) => {
                        await wijzigNavixyTracker(tracker.id, { actief: e.target.checked })
                        await opVernieuwen()
                      }}
                      className="rounded"
                    />
                    {t('settings.navixyTrackerActief', 'Actief')}
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      await verwijderNavixyTracker(tracker.id)
                      await opVernieuwen()
                    }}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title={t('common.delete', 'Verwijderen') as string}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {trackerOpen && (
          <form onSubmit={trackerToevoegen} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <input
              type="text"
              value={kenteken}
              onChange={(e) => setKenteken(e.target.value)}
              placeholder={t('settings.navixyKentekenPlaceholder', 'Kenteken') as string}
              className="input"
              required
            />
            <input
              type="number"
              value={trackerId}
              onChange={(e) => setTrackerId(e.target.value)}
              placeholder={t('settings.navixyTrackerIdPlaceholder', 'Tracker-id') as string}
              className="input"
              min={1}
              required
            />
            <button
              type="submit"
              disabled={trackerOpslaan}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {trackerOpslaan ? t('common.saving', 'Opslaan...') : t('common.save', 'Opslaan')}
            </button>
            {trackerFout && (
              <p className="sm:col-span-3 text-sm text-red-600 dark:text-red-400">{trackerFout}</p>
            )}
          </form>
        )}
      </div>
    </li>
  )
}
