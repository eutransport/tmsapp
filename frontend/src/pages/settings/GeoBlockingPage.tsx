import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ShieldCheckIcon,
  TrashIcon,
  PlusIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  GlobeEuropeAfricaIcon,
} from '@heroicons/react/24/outline'
import {
  geoBlockingApi,
  type GeoAccessLog,
  type GeoBlockSettings,
  type GeoRule,
  type GeoStatus,
  type GeoTestResultaat,
  type IPRule,
} from '@/api/geoBlocking'

type Tab = 'instellingen' | 'landen' | 'ip' | 'logboek'

const LANDEN_SNELKEUZE = [
  { code: 'NL', naam: 'Nederland' },
  { code: 'BE', naam: 'België' },
  { code: 'DE', naam: 'Duitsland' },
  { code: 'FR', naam: 'Frankrijk' },
  { code: 'LU', naam: 'Luxemburg' },
  { code: 'GB', naam: 'Verenigd Koninkrijk' },
  { code: 'PL', naam: 'Polen' },
  { code: 'ES', naam: 'Spanje' },
  { code: 'IT', naam: 'Italië' },
]

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? 'bg-primary-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function GeoBlockingPage() {
  const { t } = useTranslation()

  const [tab, setTab] = useState<Tab>('instellingen')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [status, setStatus] = useState<GeoStatus | null>(null)
  const [settings, setSettings] = useState<GeoBlockSettings | null>(null)
  const [rules, setRules] = useState<GeoRule[]>([])
  const [ipRules, setIpRules] = useState<IPRule[]>([])
  const [logs, setLogs] = useState<GeoAccessLog[]>([])

  const [nieuwLand, setNieuwLand] = useState({ country_code: 'NL', role: '*', action: 'allow' })
  const [nieuwIp, setNieuwIp] = useState({ cidr: '', label: '', action: 'allow' })
  const [testIp, setTestIp] = useState('')
  const [testRol, setTestRol] = useState('*')
  const [testResultaat, setTestResultaat] = useState<GeoTestResultaat | null>(null)

  const melding = (tekst: string) => {
    setSuccess(tekst)
    setTimeout(() => setSuccess(null), 3000)
  }

  const foutmelding = (err: any, standaard: string) => {
    setError(err?.response?.data?.detail || standaard)
  }

  const laadAlles = async () => {
    try {
      setLoading(true)
      const [statusData, settingsData, rulesData, ipData] = await Promise.all([
        geoBlockingApi.getStatus(),
        geoBlockingApi.getSettings(),
        geoBlockingApi.listRules(),
        geoBlockingApi.listIpRules(),
      ])
      setStatus(statusData)
      setSettings(settingsData)
      setRules(rulesData)
      setIpRules(ipData)
      setTestIp(statusData.jouw_ip || '')
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.laadFout'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    laadAlles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const laadLogs = async () => {
    try {
      const data = await geoBlockingApi.listLogs()
      setLogs(Array.isArray(data) ? data : data.results || [])
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.laadFout'))
    }
  }

  useEffect(() => {
    if (tab === 'logboek') laadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const bewaarInstellingen = async (wijziging: Partial<GeoBlockSettings>, force = false) => {
    if (!settings) return
    try {
      setSaving(true)
      setError(null)
      const bijgewerkt = await geoBlockingApi.updateSettings({ ...wijziging, force })
      setSettings(bijgewerkt)
      melding(t('geoBlocking.opgeslagen'))
      const nieuweStatus = await geoBlockingApi.getStatus()
      setStatus(nieuweStatus)
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.code === 'zelf_uitsluiten') {
        const bevestig = window.confirm(`${data.detail}\n\n${data.hint}\n\n${t('geoBlocking.tochDoorgaan')}`)
        if (bevestig) {
          await bewaarInstellingen(wijziging, true)
          return
        }
      } else {
        foutmelding(err, t('geoBlocking.opslaanFout'))
      }
    } finally {
      setSaving(false)
    }
  }

  const voegLandToe = async () => {
    try {
      setError(null)
      const regel = await geoBlockingApi.createRule(nieuwLand as Partial<GeoRule>)
      setRules((vorige) => [...vorige, regel])
      melding(t('geoBlocking.regelToegevoegd'))
    } catch (err: any) {
      const data = err?.response?.data
      foutmelding(err, data?.country_code?.[0] || data?.non_field_errors?.[0] || t('geoBlocking.opslaanFout'))
    }
  }

  const verwijderLand = async (id: number) => {
    try {
      await geoBlockingApi.deleteRule(id)
      setRules((vorige) => vorige.filter((r) => r.id !== id))
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.opslaanFout'))
    }
  }

  const wisselLandActief = async (regel: GeoRule) => {
    try {
      const bijgewerkt = await geoBlockingApi.updateRule(regel.id, { active: !regel.active })
      setRules((vorige) => vorige.map((r) => (r.id === regel.id ? bijgewerkt : r)))
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.opslaanFout'))
    }
  }

  const voegIpToe = async () => {
    try {
      setError(null)
      const regel = await geoBlockingApi.createIpRule(nieuwIp as Partial<IPRule>)
      setIpRules((vorige) => [...vorige, regel])
      setNieuwIp({ cidr: '', label: '', action: 'allow' })
      melding(t('geoBlocking.regelToegevoegd'))
    } catch (err: any) {
      foutmelding(err, err?.response?.data?.cidr?.[0] || t('geoBlocking.opslaanFout'))
    }
  }

  const verwijderIp = async (id: number) => {
    try {
      await geoBlockingApi.deleteIpRule(id)
      setIpRules((vorige) => vorige.filter((r) => r.id !== id))
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.opslaanFout'))
    }
  }

  const doeTest = async () => {
    try {
      setError(null)
      setTestResultaat(await geoBlockingApi.test(testIp, testRol))
    } catch (err: any) {
      foutmelding(err, t('geoBlocking.testFout'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'instellingen', label: t('geoBlocking.tabInstellingen') },
    { id: 'landen', label: t('geoBlocking.tabLanden') },
    { id: 'ip', label: t('geoBlocking.tabIp') },
    { id: 'logboek', label: t('geoBlocking.tabLogboek') },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheckIcon className="h-8 w-8 text-primary-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('geoBlocking.titel')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('geoBlocking.ondertitel')}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {status && !status.database_beschikbaar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">{t('geoBlocking.geenDatabase')}</p>
              <p>{t('geoBlocking.geenDatabaseUitleg')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Huidige positie van de beheerder: voorkomt dat je jezelf buitensluit */}
      {status && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <GlobeEuropeAfricaIcon className="h-5 w-5 text-primary-600" />
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {t('geoBlocking.jouwVerbinding')}
              </span>
            </div>
            <div>
              <span className="text-gray-500">IP: </span>
              <span className="font-mono">{status.jouw_ip || '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('geoBlocking.land')}: </span>
              <span className="font-semibold">{status.jouw_land || t('geoBlocking.onbekend')}</span>
            </div>
            <div>
              <span className="text-gray-500">{t('geoBlocking.rol')}: </span>
              <span>{status.jouw_rol}</span>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                status.huidige_uitkomst.toegestaan
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {status.huidige_uitkomst.toegestaan
                ? t('geoBlocking.jijKomtBinnen')
                : t('geoBlocking.jijWordtGeblokkeerd')}
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-6">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition ${
                tab === item.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'instellingen' && settings && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                {t('geoBlocking.inschakelen')}
              </p>
              <p className="text-sm text-gray-500">{t('geoBlocking.inschakelenUitleg')}</p>
            </div>
            <Toggle
              checked={settings.enabled}
              disabled={saving}
              onChange={(value) => bewaarInstellingen({ enabled: value })}
            />
          </div>

          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            <p className="font-medium text-gray-900 dark:text-white">{t('geoBlocking.modus')}</p>
            <p className="mb-3 text-sm text-gray-500">{t('geoBlocking.modusUitleg')}</p>
            <div className="flex gap-3">
              {(status?.modi || []).map((modus) => (
                <button
                  key={modus.waarde}
                  disabled={saving}
                  onClick={() => bewaarInstellingen({ mode: modus.waarde as any })}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                    settings.mode === modus.waarde
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {modus.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
            <p className="font-medium text-gray-900 dark:text-white">
              {t('geoBlocking.standaardActie')}
            </p>
            <p className="mb-3 text-sm text-gray-500">{t('geoBlocking.standaardActieUitleg')}</p>
            <div className="flex gap-3">
              {(status?.acties || []).map((actie) => (
                <button
                  key={actie.waarde}
                  disabled={saving}
                  onClick={() => bewaarInstellingen({ default_action: actie.waarde as any })}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                    settings.default_action === actie.waarde
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {actie.label}
                </button>
              ))}
            </div>
          </div>

          {[
            {
              veld: 'allow_superuser_bypass' as const,
              titel: t('geoBlocking.superuserBypass'),
              uitleg: t('geoBlocking.superuserBypassUitleg'),
            },
            {
              veld: 'block_unknown_country' as const,
              titel: t('geoBlocking.onbekendLandBlokkeren'),
              uitleg: t('geoBlocking.onbekendLandBlokkerenUitleg'),
            },
            {
              veld: 'log_allowed' as const,
              titel: t('geoBlocking.allesLoggen'),
              uitleg: t('geoBlocking.allesLoggenUitleg'),
            },
          ].map((optie) => (
            <div
              key={optie.veld}
              className="flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-700"
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{optie.titel}</p>
                <p className="text-sm text-gray-500">{optie.uitleg}</p>
              </div>
              <Toggle
                checked={Boolean(settings[optie.veld])}
                disabled={saving}
                onChange={(value) => bewaarInstellingen({ [optie.veld]: value })}
              />
            </div>
          ))}
        </div>
      )}

      {tab === 'landen' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-3 font-medium text-gray-900 dark:text-white">
              {t('geoBlocking.nieuweLandregel')}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">{t('geoBlocking.land')}</label>
                <input
                  list="landen-lijst"
                  value={nieuwLand.country_code}
                  onChange={(e) =>
                    setNieuwLand({ ...nieuwLand, country_code: e.target.value.toUpperCase() })
                  }
                  className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
                  placeholder="NL"
                />
                <datalist id="landen-lijst">
                  {LANDEN_SNELKEUZE.map((land) => (
                    <option key={land.code} value={land.code}>
                      {land.naam}
                    </option>
                  ))}
                  <option value="*">{t('geoBlocking.alleLanden')}</option>
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{t('geoBlocking.rol')}</label>
                <select
                  value={nieuwLand.role}
                  onChange={(e) => setNieuwLand({ ...nieuwLand, role: e.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {(status?.rollen || []).map((rol) => (
                    <option key={rol.waarde} value={rol.waarde}>
                      {rol.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{t('geoBlocking.actie')}</label>
                <select
                  value={nieuwLand.action}
                  onChange={(e) => setNieuwLand({ ...nieuwLand, action: e.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {(status?.acties || []).map((actie) => (
                    <option key={actie.waarde} value={actie.waarde}>
                      {actie.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={voegLandToe}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <PlusIcon className="h-4 w-4" />
                {t('geoBlocking.toevoegen')}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  {['land', 'rol', 'actie', 'actief', ''].map((kop, index) => (
                    <th
                      key={index}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500"
                    >
                      {kop ? t(`geoBlocking.${kop}`) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                      {t('geoBlocking.geenRegels')}
                    </td>
                  </tr>
                )}
                {rules.map((regel) => (
                  <tr key={regel.id}>
                    <td className="px-4 py-3 font-mono text-sm font-semibold">
                      {regel.country_code}
                    </td>
                    <td className="px-4 py-3 text-sm">{regel.role === '*' ? t('geoBlocking.alleRollen') : regel.role}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          regel.action === 'allow'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {regel.action === 'allow' ? t('geoBlocking.toestaan') : t('geoBlocking.blokkeren')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Toggle checked={regel.active} onChange={() => wisselLandActief(regel)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => verwijderLand(regel.id)}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ip' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-1 font-medium text-gray-900 dark:text-white">
              {t('geoBlocking.nieuweIpRegel')}
            </p>
            <p className="mb-3 text-sm text-gray-500">{t('geoBlocking.ipUitleg')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">{t('geoBlocking.ipAdres')}</label>
                <input
                  value={nieuwIp.cidr}
                  onChange={(e) => setNieuwIp({ ...nieuwIp, cidr: e.target.value })}
                  placeholder="84.25.11.7 of 84.25.11.0/24"
                  className="w-56 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">
                  {t('geoBlocking.omschrijving')}
                </label>
                <input
                  value={nieuwIp.label}
                  onChange={(e) => setNieuwIp({ ...nieuwIp, label: e.target.value })}
                  placeholder={t('geoBlocking.ipLabelVoorbeeld')}
                  className="w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">{t('geoBlocking.actie')}</label>
                <select
                  value={nieuwIp.action}
                  onChange={(e) => setNieuwIp({ ...nieuwIp, action: e.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {(status?.acties || []).map((actie) => (
                    <option key={actie.waarde} value={actie.waarde}>
                      {actie.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={voegIpToe}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <PlusIcon className="h-4 w-4" />
                {t('geoBlocking.toevoegen')}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {ipRules.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500">
                      {t('geoBlocking.geenRegels')}
                    </td>
                  </tr>
                )}
                {ipRules.map((regel) => (
                  <tr key={regel.id}>
                    <td className="px-4 py-3 font-mono text-sm">{regel.cidr}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{regel.label}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          regel.action === 'allow'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {regel.action === 'allow' ? t('geoBlocking.toestaan') : t('geoBlocking.blokkeren')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => verwijderIp(regel.id)}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-1 font-medium text-gray-900 dark:text-white">
              {t('geoBlocking.testTitel')}
            </p>
            <p className="mb-3 text-sm text-gray-500">{t('geoBlocking.testUitleg')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <input
                value={testIp}
                onChange={(e) => setTestIp(e.target.value)}
                placeholder="8.8.8.8"
                className="w-56 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm"
              />
              <select
                value={testRol}
                onChange={(e) => setTestRol(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {(status?.rollen || []).map((rol) => (
                  <option key={rol.waarde} value={rol.waarde}>
                    {rol.label}
                  </option>
                ))}
              </select>
              <button
                onClick={doeTest}
                className="rounded-lg border border-primary-600 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
              >
                {t('geoBlocking.testen')}
              </button>
              {testResultaat && (
                <div
                  className={`rounded-lg px-4 py-2 text-sm ${
                    testResultaat.toegestaan
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  <span className="font-semibold">
                    {testResultaat.toegestaan
                      ? t('geoBlocking.toegestaan')
                      : t('geoBlocking.geblokkeerd')}
                  </span>
                  {' — '}
                  {t('geoBlocking.land')}: {testResultaat.land || t('geoBlocking.onbekend')} ({testResultaat.reden})
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'logboek' && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['tijd', 'ipAdres', 'land', 'rol', 'resultaat', 'pad'].map((kop) => (
                  <th
                    key={kop}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500"
                  >
                    {t(`geoBlocking.${kop}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    {t('geoBlocking.geenLogs')}
                  </td>
                </tr>
              )}
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {new Date(log.created_at).toLocaleString('nl-NL')}
                  </td>
                  <td className="px-4 py-2 font-mono text-sm">{log.ip_address}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{log.country_code || '—'}</td>
                  <td className="px-4 py-2 text-sm">{log.role}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        log.decision === 'blocked'
                          ? 'bg-red-100 text-red-700'
                          : log.decision === 'would_block'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {t(`geoBlocking.decision_${log.decision}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{log.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
