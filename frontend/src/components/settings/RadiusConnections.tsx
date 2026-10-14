/**
 * Beheer van Radius-koppelingen binnen Instellingen > Koppelingen.
 * Twee gescheiden vakken: telematica (GPS en ritten) en tank- en laadkaarten
 * (facturen en tolheffing). Per vak kun je meerdere accounts toevoegen.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircleIcon,
  CreditCardIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import {
  RadiusKoppeling,
  RadiusKoppelingSoort,
  getRadiusKoppelingen,
  maakRadiusKoppeling,
  testRadiusKoppeling,
  verwijderRadiusKoppeling,
  wijzigRadiusKoppeling,
} from '@/api/radiusConnections'

interface FormulierStand {
  naam: string
  api_token: string
  start_datum: string
}

const LEEG: FormulierStand = { naam: '', api_token: '', start_datum: '' }

export default function RadiusConnections() {
  const { t } = useTranslation()
  const [koppelingen, setKoppelingen] = useState<RadiusKoppeling[]>([])
  const [laden, setLaden] = useState(true)
  const [laadFout, setLaadFout] = useState('')

  const laadKoppelingen = async () => {
    try {
      setKoppelingen(await getRadiusKoppelingen())
      setLaadFout('')
    } catch {
      setLaadFout(
        t('settings.radiusKoppelingenLaadFout', 'De koppelingen konden niet geladen worden.'),
      )
    } finally {
      setLaden(false)
    }
  }

  useEffect(() => {
    laadKoppelingen()
  }, [])

  return (
    <div className="space-y-4">
      {laadFout && <p className="text-sm text-red-600 dark:text-red-400">{laadFout}</p>}

      <SoortBlok
        soort="telematics"
        titel={t('settings.radiusSoortTelematica', 'Telematica (GPS en ritten)')}
        uitleg={t(
          'settings.radiusTelematicaUitleg',
          'Levert voertuigposities, ritten en kilometers. Voeg per Radius-account een token toe.',
        )}
        icoon={<MapPinIcon className="h-5 w-5" />}
        koppelingen={koppelingen.filter((k) => k.soort === 'telematics')}
        laden={laden}
        opVernieuwen={laadKoppelingen}
      />

      <SoortBlok
        soort="fuel"
        titel={t('settings.radiusSoortTankkaarten', 'Tank- en laadkaarten (facturatie)')}
        uitleg={t(
          'settings.radiusTankkaartenUitleg',
          'Levert de transacties en facturen van de tankkaarten, inclusief de tolheffing per land.',
        )}
        icoon={<CreditCardIcon className="h-5 w-5" />}
        koppelingen={koppelingen.filter((k) => k.soort === 'fuel')}
        laden={laden}
        opVernieuwen={laadKoppelingen}
      />
    </div>
  )
}

interface SoortBlokProps {
  soort: RadiusKoppelingSoort
  titel: string
  uitleg: string
  icoon: React.ReactNode
  koppelingen: RadiusKoppeling[]
  laden: boolean
  opVernieuwen: () => Promise<void>
}

function SoortBlok({
  soort,
  titel,
  uitleg,
  icoon,
  koppelingen,
  laden,
  opVernieuwen,
}: SoortBlokProps) {
  const { t } = useTranslation()
  const [formulierOpen, setFormulierOpen] = useState(false)
  const [formulier, setFormulier] = useState<FormulierStand>(LEEG)
  const [opslaan, setOpslaan] = useState(false)
  const [fout, setFout] = useState('')

  const toevoegen = async (e: React.FormEvent) => {
    e.preventDefault()
    setFout('')
    setOpslaan(true)
    try {
      await maakRadiusKoppeling({
        naam: formulier.naam.trim(),
        soort,
        api_token: formulier.api_token.trim(),
        start_datum: formulier.start_datum || null,
      })
      setFormulier(LEEG)
      setFormulierOpen(false)
      await opVernieuwen()
    } catch (error: any) {
      const data = error?.response?.data
      const eerste = data && typeof data === 'object' ? Object.values(data)[0] : null
      setFout(
        Array.isArray(eerste)
          ? String(eerste[0])
          : t('settings.radiusKoppelingOpslaanFout', 'De koppeling kon niet opgeslagen worden.'),
      )
    } finally {
      setOpslaan(false)
    }
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="text-gray-400 mt-0.5">{icoon}</span>
          <div>
            <h3 className="text-md font-medium text-gray-900 dark:text-white">{titel}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{uitleg}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormulierOpen((open) => !open)
            setFout('')
          }}
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
              {t('settings.radiusAccountToevoegen', 'Account toevoegen')}
            </>
          )}
        </button>
      </div>

      {laden ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading', 'Laden...')}</p>
      ) : koppelingen.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('settings.radiusGeenAccounts', 'Nog geen account gekoppeld.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {koppelingen.map((koppeling) => (
            <KoppelingRij key={koppeling.id} koppeling={koppeling} opVernieuwen={opVernieuwen} />
          ))}
        </ul>
      )}

      {formulierOpen && (
        <form
          onSubmit={toevoegen}
          className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('settings.radiusKoppelingNaam', 'Naam')}
              </label>
              <input
                type="text"
                value={formulier.naam}
                onChange={(e) => setFormulier({ ...formulier, naam: e.target.value })}
                placeholder={
                  soort === 'fuel'
                    ? (t('settings.radiusNaamVoorbeeldKaarten', 'Almen tankkaarten') as string)
                    : (t('settings.radiusNaamVoorbeeldGps', 'Almen telematica') as string)
                }
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('settings.radiusApiToken', 'API Token')}
              </label>
              <input
                type="password"
                value={formulier.api_token}
                onChange={(e) => setFormulier({ ...formulier, api_token: e.target.value })}
                className="input"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('settings.radiusStartDatum', 'Startdatum Radius')}
              </label>
              <input
                type="date"
                value={formulier.start_datum}
                onChange={(e) => setFormulier({ ...formulier, start_datum: e.target.value })}
                className="input"
              />
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
  koppeling: RadiusKoppeling
  opVernieuwen: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [testen, setTesten] = useState(false)
  const [nieuwToken, setNieuwToken] = useState('')
  const [tokenOpslaan, setTokenOpslaan] = useState(false)

  const geslaagd = koppeling.laatste_resultaat === 'Verbinding in orde'

  const testVerbinding = async () => {
    setTesten(true)
    await testRadiusKoppeling(koppeling.id)
    setTesten(false)
    await opVernieuwen()
  }

  const tokenVervangen = async () => {
    if (!nieuwToken.trim()) return
    setTokenOpslaan(true)
    await wijzigRadiusKoppeling(koppeling.id, { api_token: nieuwToken.trim() })
    setNieuwToken('')
    setTokenOpslaan(false)
    await opVernieuwen()
  }

  const verwijderen = async () => {
    if (
      !window.confirm(
        t('settings.radiusKoppelingVerwijderBevestig', 'Deze koppeling verwijderen?') as string,
      )
    ) {
      return
    }
    await verwijderRadiusKoppeling(koppeling.id)
    await opVernieuwen()
  }

  return (
    <li className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
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
              {t('settings.radiusNogNietGetest', 'Nog niet getest.')}
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
              ? t('settings.radiusTesting', 'Bezig met testen...')
              : t('settings.radiusTest', 'Verbinding testen')}
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={nieuwToken}
          onChange={(e) => setNieuwToken(e.target.value)}
          placeholder={
            t(
              'settings.radiusKoppelingTokenVervangen',
              'Nieuw token (laat leeg om te behouden)',
            ) as string
          }
          className="input flex-1 min-w-[16rem]"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={tokenVervangen}
          disabled={!nieuwToken.trim() || tokenOpslaan}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {tokenOpslaan
            ? t('common.saving', 'Opslaan...')
            : t('settings.radiusTokenVervangen', 'Token vervangen')}
        </button>
      </div>
    </li>
  )
}
