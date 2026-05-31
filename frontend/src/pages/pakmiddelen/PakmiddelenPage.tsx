/**
 * Pakmiddelen Teruggavebonnen
 * - Overzicht: dagelijks per ritnummer of de pakmiddelen-teruggavebon binnen is.
 * - Configuratie: IMAP, schedule, ontvangers, test-knoppen.
 * - Ritnummers: selectie van vloot-ritnummers en eventueel handmatige ritnummers.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircleIcon,
  XCircleIcon,
  PlayCircleIcon,
  EnvelopeIcon,
  Cog6ToothIcon,
  ListBulletIcon,
  TableCellsIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import {
  pakmiddelenApi,
  PakmiddelenConfig,
  RitnummerSelection,
  AvailableVehicle,
  CheckResult,
} from '@/api/pakmiddelen'
import { listEmailProfiles, EmailProfile } from '@/api/emailProfiles'

type Tab = 'overview' | 'config' | 'ritnummers'

export default function PakmiddelenPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const canManage =
    user?.rol === 'admin' ||
    (user?.module_permissions || []).includes('manage_pakmiddelen')

  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('pakmiddelen.title', 'Pakmiddelen Teruggavebonnen')}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {t('pakmiddelen.subtitle',
            'Dagelijkse controle van pakmiddelen-teruggavebonnen via mailbox.')}
        </p>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex flex-wrap gap-x-6 gap-y-2">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={<TableCellsIcon className="w-4 h-4" />}>
            {t('pakmiddelen.tab.overview', 'Overzicht')}
          </TabButton>
          {canManage && (
            <TabButton active={tab === 'config'} onClick={() => setTab('config')} icon={<Cog6ToothIcon className="w-4 h-4" />}>
              {t('pakmiddelen.tab.config', 'Configuratie')}
            </TabButton>
          )}
          {canManage && (
            <TabButton active={tab === 'ritnummers'} onClick={() => setTab('ritnummers')} icon={<ListBulletIcon className="w-4 h-4" />}>
              {t('pakmiddelen.tab.ritnummers', 'Ritnummers')}
            </TabButton>
          )}
        </nav>
      </div>

      {tab === 'overview' && <OverviewTab canManage={canManage} />}
      {tab === 'config' && canManage && <ConfigTab />}
      {tab === 'ritnummers' && canManage && <RitnummersTab />}
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 py-2 px-1 border-b-2 text-sm font-medium ${
        active
          ? 'border-primary-600 text-primary-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

/* -------------------- Overview -------------------- */

function OverviewTab({ canManage }: { canManage: boolean }) {
  const todayISO = () => new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState<string>(todayISO())
  const [to, setTo] = useState<string>(todayISO())
  const [results, setResults] = useState<CheckResult[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [configRecipients, setConfigRecipients] = useState<string[]>([])
  const [mailOpen, setMailOpen] = useState(false)
  const [mailExtra, setMailExtra] = useState('')
  const [mailUseConfig, setMailUseConfig] = useState(true)
  const [mailIncludeXlsx, setMailIncludeXlsx] = useState(true)
  const [mailIncludePdf, setMailIncludePdf] = useState(false)
  const [mailSending, setMailSending] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [data, cfg] = await Promise.all([
        pakmiddelenApi.listResults({ from, to }),
        pakmiddelenApi.getConfig().catch(() => null),
      ])
      setResults(data)
      if (cfg) setConfigRecipients(cfg.notification_recipients || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [from, to])

  const runNow = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const r = from === to
        ? await pakmiddelenApi.runNow({ date: to, send_report: false })
        : await pakmiddelenApi.runNow({ from, to, send_report: false })
      setMessage(r.message || 'Klaar.')
      await load()
    } catch (e: any) {
      setMessage(e?.response?.data?.message || 'Fout bij uitvoeren controle.')
    } finally {
      setRunning(false)
    }
  }

  const exportFile = async (format: 'xlsx' | 'pdf') => {
    setExporting(true)
    setMessage(null)
    try {
      await pakmiddelenApi.exportResults({ format, from, to })
    } catch (e: any) {
      setMessage('Export mislukt.')
    } finally {
      setExporting(false)
    }
  }

  const sendMail = async () => {
    setMailSending(true)
    setMessage(null)
    try {
      const extras = mailExtra.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
      const r = await pakmiddelenApi.mailResults({
        from, to,
        recipients: extras,
        use_config_recipients: mailUseConfig,
        include_xlsx: mailIncludeXlsx,
        include_pdf: mailIncludePdf,
      })
      setMessage(r.message || 'Verstuurd.')
      if (r.success) setMailOpen(false)
    } catch (e: any) {
      setMessage(e?.response?.data?.message || 'Versturen mislukt.')
    } finally {
      setMailSending(false)
    }
  }

  /* ---- period navigation ---- */
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
  const startOfWeek = (d: Date) => {
    const x = new Date(d)
    const dow = (x.getDay() + 6) % 7  // monday = 0
    x.setDate(x.getDate() - dow)
    return x
  }
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
  const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

  const setRange = (a: Date, b: Date) => { setFrom(fmt(a)); setTo(fmt(b)) }

  const today = () => { const t = todayISO(); setFrom(t); setTo(t) }
  const thisWeek = () => { const s = startOfWeek(new Date()); setRange(s, addDays(s, 6)) }
  const thisMonth = () => { const n = new Date(); setRange(startOfMonth(n), endOfMonth(n)) }

  const prevWeek = () => {
    const s = startOfWeek(parse(from))
    const ps = addDays(s, -7)
    setRange(ps, addDays(ps, 6))
  }
  const nextWeek = () => {
    const s = startOfWeek(parse(from))
    const ns = addDays(s, 7)
    setRange(ns, addDays(ns, 6))
  }
  const prevMonth = () => {
    const f = parse(from)
    const pm = new Date(f.getFullYear(), f.getMonth() - 1, 1)
    setRange(pm, endOfMonth(pm))
  }
  const nextMonth = () => {
    const f = parse(from)
    const nm = new Date(f.getFullYear(), f.getMonth() + 1, 1)
    setRange(nm, endOfMonth(nm))
  }

  const canGoNextWeek = useMemo(() => {
    const s = startOfWeek(parse(from))
    const ns = addDays(s, 7)
    return ns <= parse(todayISO())
  }, [from])

  const canGoNextMonth = useMemo(() => {
    const f = parse(from)
    const nm = new Date(f.getFullYear(), f.getMonth() + 1, 1)
    return nm <= parse(todayISO())
  }, [from])

  const stats = useMemo(() => ({
    total: results.length,
    ja: results.filter(r => r.has_bon).length,
    nee: results.filter(r => !r.has_bon).length,
  }), [results])

  const showDate = from !== to
  const fmtDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || '')
  }
  const navBtn = 'px-2.5 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 block mb-1">Van</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700 block mb-1">Tot en met</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm" />
        </label>
        <div className="flex flex-wrap gap-1">
          <button onClick={today} className={navBtn}>Vandaag</button>
          <button onClick={thisWeek} className={navBtn}>Deze week</button>
          <button onClick={thisMonth} className={navBtn}>Deze maand</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={prevWeek} className={navBtn} title="Vorige week">← Week</button>
          <button onClick={nextWeek} disabled={!canGoNextWeek} className={navBtn} title="Volgende week">Week →</button>
          <button onClick={prevMonth} className={navBtn} title="Vorige maand">← Maand</button>
          <button onClick={nextMonth} disabled={!canGoNextMonth} className={navBtn} title="Volgende maand">Maand →</button>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
            Vernieuwen
          </button>
          <button onClick={() => exportFile('xlsx')} disabled={exporting}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            Export Excel
          </button>
          <button onClick={() => exportFile('pdf')} disabled={exporting}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            Export PDF
          </button>
          <button onClick={() => setMailOpen(true)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 inline-flex items-center gap-1">
            <EnvelopeIcon className="w-4 h-4" /> Mail overzicht
          </button>
          {canManage && (
            <button
              onClick={runNow}
              disabled={running}
              className="px-3 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 inline-flex items-center gap-2 disabled:opacity-50"
            >
              <PlayCircleIcon className="w-4 h-4" />
              {running ? 'Bezig...' : 'Mailbox nu uitlezen'}
            </button>
          )}
        </div>
        <div className="ml-auto flex gap-3 text-sm">
          <span className="px-3 py-1 bg-gray-100 rounded">Totaal: <b>{stats.total}</b></span>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded">Ja: <b>{stats.ja}</b></span>
          <span className="px-3 py-1 bg-red-100 text-red-800 rounded">Nee: <b>{stats.nee}</b></span>
        </div>
      </div>

      {message && (
        <div className="px-3 py-2 text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded">
          {message}
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {showDate && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>}
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ritnummer</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Onderwerp</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pakmiddelen teruggavebon</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ontvangen op</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr><td colSpan={showDate ? 5 : 4} className="px-4 py-8 text-center text-gray-500">Laden...</td></tr>
            )}
            {!loading && results.length === 0 && (
              <tr><td colSpan={showDate ? 5 : 4} className="px-4 py-8 text-center text-gray-500">
                Geen resultaten in deze periode.
              </td></tr>
            )}
            {!loading && results.map(r => (
              <tr key={r.id}>
                {showDate && <td className="px-4 py-2 text-sm text-gray-700">{fmtDate(r.check_date)}</td>}
                <td className="px-4 py-2 text-sm font-medium text-gray-900">{r.ritnummer}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{r.matched_subject || <span className="text-gray-400">—</span>}</td>
                <td className="px-4 py-2 text-sm">
                  {r.has_bon ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                      <CheckCircleIcon className="w-4 h-4" /> Ja
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
                      <XCircleIcon className="w-4 h-4" /> Nee
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-sm text-gray-500">
                  {r.mail_received_at ? new Date(r.mail_received_at).toLocaleString('nl-NL') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !mailSending && setMailOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Mail overzicht versturen</h3>
              <button onClick={() => !mailSending && setMailOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="text-sm text-gray-600">
              Periode: <b>{fmtDate(from)}</b>{from !== to && <> — <b>{fmtDate(to)}</b></>}
            </p>

            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={mailUseConfig} onChange={e => setMailUseConfig(e.target.checked)}
                  className="mt-1 h-4 w-4" />
                <span>
                  <b>Standaard ontvangers</b> (uit configuratie):
                  <div className="text-xs text-gray-600 mt-0.5">
                    {configRecipients.length > 0 ? configRecipients.join(', ') : <i>geen geconfigureerd</i>}
                  </div>
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700 block mb-1">Extra ontvangers (komma-gescheiden)</span>
                <textarea rows={2} value={mailExtra} onChange={e => setMailExtra(e.target.value)}
                  placeholder="naam@bedrijf.nl, andere@bedrijf.nl"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </label>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={mailIncludeXlsx} onChange={e => setMailIncludeXlsx(e.target.checked)}
                    className="h-4 w-4" /> Excel bijvoegen
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={mailIncludePdf} onChange={e => setMailIncludePdf(e.target.checked)}
                    className="h-4 w-4" /> PDF bijvoegen
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setMailOpen(false)} disabled={mailSending}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                Annuleren
              </button>
              <button onClick={sendMail} disabled={mailSending}
                className="px-3 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4" />
                {mailSending ? 'Versturen...' : 'Verstuur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------- Configuratie -------------------- */

function ConfigTab() {
  const [config, setConfig] = useState<PakmiddelenConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [imapPasswordInput, setImapPasswordInput] = useState('')
  const [graphSecretInput, setGraphSecretInput] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('')
  const [testRecipient, setTestRecipient] = useState('')
  const [emailProfiles, setEmailProfiles] = useState<EmailProfile[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [c, profiles] = await Promise.all([
        pakmiddelenApi.getConfig(),
        listEmailProfiles().catch(() => [] as EmailProfile[]),
      ])
      setConfig(c)
      setRecipientsInput((c.notification_recipients || []).join(', '))
      setEmailProfiles(profiles)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading || !config) {
    return <div className="text-gray-500">Laden...</div>
  }

  const update = (patch: Partial<PakmiddelenConfig>) => setConfig({ ...config, ...patch })

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const recipients = recipientsInput
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
      const payload: any = {
        provider: config.provider,
        imap_host: config.imap_host,
        imap_port: config.imap_port,
        imap_use_ssl: config.imap_use_ssl,
        imap_username: config.imap_username,
        imap_folder: config.imap_folder,
        graph_tenant_id: config.graph_tenant_id,
        graph_client_id: config.graph_client_id,
        graph_client_secret_expires_at: config.graph_client_secret_expires_at || null,
        graph_mailbox: config.graph_mailbox,
        graph_folder: config.graph_folder,
        subject_template: config.subject_template,
        mark_as_read: config.mark_as_read,
        enabled: config.enabled,
        schedule_time: config.schedule_time,
        period_days: config.period_days,
        period_from_date: config.period_from_date || null,
        notification_recipients: recipients,
        notification_email_profile: config.notification_email_profile || null,
      }
      if (imapPasswordInput) payload.imap_password = imapPasswordInput
      if (graphSecretInput) payload.graph_client_secret = graphSecretInput
      const updated = await pakmiddelenApi.updateConfig(payload)
      setConfig(updated)
      setRecipientsInput((updated.notification_recipients || []).join(', '))
      setImapPasswordInput('')
      setGraphSecretInput('')
      setMessage({ kind: 'ok', text: 'Opgeslagen.' })
    } catch (e: any) {
      const data = e?.response?.data
      const msg = data ? JSON.stringify(data) : 'Opslaan mislukt.'
      setMessage({ kind: 'err', text: msg })
    } finally {
      setSaving(false)
    }
  }

  const testImap = async () => {
    setMessage(null)
    const r = await pakmiddelenApi.testImap(
      imapPasswordInput ? { imap_host: config.imap_host, imap_password: imapPasswordInput } : { imap_host: config.imap_host }
    )
    setMessage({ kind: r.success ? 'ok' : 'err', text: r.message })
  }

  const testGraph = async () => {
    setMessage(null)
    const r = await pakmiddelenApi.testGraph({
      graph_tenant_id: config.graph_tenant_id,
      graph_client_id: config.graph_client_id,
      graph_mailbox: config.graph_mailbox,
      graph_folder: config.graph_folder,
      ...(graphSecretInput ? { graph_client_secret: graphSecretInput } : {}),
    })
    setMessage({ kind: r.success ? 'ok' : 'err', text: r.message })
  }

  const testEmail = async () => {
    if (!testRecipient) {
      setMessage({ kind: 'err', text: 'Vul een ontvanger in.' })
      return
    }
    setMessage(null)
    const r = await pakmiddelenApi.testEmail(testRecipient)
    setMessage({ kind: r.success ? 'ok' : 'err', text: r.message })
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`px-3 py-2 text-sm rounded border ${
          message.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>{message.text}</div>
      )}

      <Section title="Mailprovider">
        <Field label="Provider" full>
          <select
            value={config.provider}
            onChange={e => update({ provider: e.target.value as 'imap' | 'graph' })}
            className={inputCls}
          >
            <option value="imap">IMAP (klassiek)</option>
            <option value="graph">Microsoft Graph (OAuth2 — vereist voor Microsoft 365)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Microsoft 365 vereist OAuth2; klassieke IMAP-login werkt daar niet meer.
          </p>
        </Field>
      </Section>

      {config.provider === 'imap' && (
      <Section title="IMAP mailbox">
        <Field label="Host">
          <input type="text" value={config.imap_host} onChange={e => update({ imap_host: e.target.value })}
            className={inputCls} placeholder="imap.example.com" />
        </Field>
        <Field label="Poort">
          <input type="number" value={config.imap_port} onChange={e => update({ imap_port: Number(e.target.value) })}
            className={inputCls} />
        </Field>
        <Field label="SSL/TLS">
          <input type="checkbox" checked={config.imap_use_ssl}
            onChange={e => update({ imap_use_ssl: e.target.checked })} className="h-4 w-4" />
        </Field>
        <Field label="Gebruikersnaam">
          <input type="text" value={config.imap_username} onChange={e => update({ imap_username: e.target.value })}
            className={inputCls} autoComplete="off" />
        </Field>
        <Field label={`Wachtwoord ${config.imap_password_set ? '(opgeslagen)' : '(niet ingesteld)'}`}>
          <input type="password" value={imapPasswordInput} onChange={e => setImapPasswordInput(e.target.value)}
            placeholder={config.imap_password_set ? '••••••••' : ''} className={inputCls} autoComplete="new-password" />
        </Field>
        <Field label="Map">
          <input type="text" value={config.imap_folder} onChange={e => update({ imap_folder: e.target.value })}
            className={inputCls} placeholder="INBOX" />
        </Field>
        <div className="col-span-full">
          <button onClick={testImap}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 inline-flex items-center gap-2">
            <PlayCircleIcon className="w-4 h-4" /> Test IMAP-verbinding
          </button>
        </div>
      </Section>
      )}

      {config.provider === 'graph' && (
      <Section title="Microsoft Graph (OAuth2)">
        <Field label="Tenant ID" full>
          <input type="text" value={config.graph_tenant_id}
            onChange={e => update({ graph_tenant_id: e.target.value })} className={inputCls}
            placeholder="contoso.onmicrosoft.com of GUID" autoComplete="off" />
        </Field>
        <Field label="Application (client) ID">
          <input type="text" value={config.graph_client_id}
            onChange={e => update({ graph_client_id: e.target.value })} className={inputCls}
            placeholder="GUID uit Azure / Entra ID" autoComplete="off" />
        </Field>
        <Field label={`Client secret ${config.graph_client_secret_set ? '(opgeslagen)' : '(niet ingesteld)'}`}>
          <input type="password" value={graphSecretInput}
            onChange={e => setGraphSecretInput(e.target.value)}
            placeholder={config.graph_client_secret_set ? '••••••••' : ''}
            className={inputCls} autoComplete="new-password" />
        </Field>
        <Field label="Vervaldatum client secret">
          <input type="date" value={config.graph_client_secret_expires_at || ''}
            onChange={e => update({ graph_client_secret_expires_at: e.target.value || null })}
            className={inputCls} />
          {typeof config.graph_client_secret_days_left === 'number' && (
            <p className={`text-xs mt-1 ${
              config.graph_client_secret_days_left < 0
                ? 'text-red-700 font-medium'
                : config.graph_client_secret_days_left <= 7
                  ? 'text-red-600 font-medium'
                  : config.graph_client_secret_days_left <= 30
                    ? 'text-amber-700'
                    : 'text-gray-500'
            }`}>
              {config.graph_client_secret_days_left < 0
                ? `Secret is ${Math.abs(config.graph_client_secret_days_left)} dag(en) verlopen.`
                : `Nog ${config.graph_client_secret_days_left} dag(en) geldig. Herinneringen worden 30/14/7 dagen vooraf gestuurd.`}
            </p>
          )}
        </Field>
        <Field label="Mailbox (UPN)">
          <input type="text" value={config.graph_mailbox}
            onChange={e => update({ graph_mailbox: e.target.value })} className={inputCls}
            placeholder="info@bedrijf.nl" autoComplete="off" />
        </Field>
        <Field label="Mailmap">
          <input type="text" value={config.graph_folder}
            onChange={e => update({ graph_folder: e.target.value })} className={inputCls}
            placeholder="Postvak IN/smapone" />
          <p className="text-xs text-gray-500 mt-1">
            Hoofdmap of pad naar submap, bv. <code>Postvak IN</code>, <code>Inbox</code>, <code>Postvak IN/smapone</code>.
          </p>
        </Field>
        <div className="col-span-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
          Vereiste app-permission: <b>Mail.ReadWrite</b> (Application) met admin consent.
          Het secret wordt encrypted opgeslagen.
        </div>
        <div className="col-span-full">
          <button onClick={testGraph}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 inline-flex items-center gap-2">
            <PlayCircleIcon className="w-4 h-4" /> Test Graph-verbinding
          </button>
        </div>
      </Section>
      )}

      <Section title="Mail matching">
        <Field label="Onderwerp template" full>
          <input type="text" value={config.subject_template}
            onChange={e => update({ subject_template: e.target.value })} className={inputCls}
            placeholder="Pakmiddelen teruggavebon {ritnummer}" />
          <p className="text-xs text-gray-500 mt-1">Gebruik {'{ritnummer}'} als placeholder.</p>
        </Field>
        <Field label="Mails als gelezen markeren">
          <input type="checkbox" checked={config.mark_as_read}
            onChange={e => update({ mark_as_read: e.target.checked })} className="h-4 w-4" />
        </Field>
      </Section>

      <Section title="Periode">
        <Field label="Aantal dagen terug">
          <input type="number" min={1} value={config.period_days}
            onChange={e => update({ period_days: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="Of: vaste startdatum">
          <input type="date" value={config.period_from_date || ''}
            onChange={e => update({ period_from_date: e.target.value || null })} className={inputCls} />
        </Field>
      </Section>

      <Section title="Dagelijkse rapportmail">
        <Field label="Actief">
          <input type="checkbox" checked={config.enabled}
            onChange={e => update({ enabled: e.target.checked })} className="h-4 w-4" />
        </Field>
        <Field label="Tijdstip">
          <input type="time" value={(config.schedule_time || '').slice(0, 5)}
            onChange={e => update({ schedule_time: e.target.value + ':00' })} className={inputCls} />
        </Field>
        <Field label="SMTP profiel (verzender)" full>
          <select
            value={config.notification_email_profile || ''}
            onChange={e => update({ notification_email_profile: e.target.value || null })}
            className={inputCls}
          >
            <option value="">— Standaard profiel —</option>
            {emailProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_default ? ' (standaard)' : ''} — {p.smtp_from_email || p.smtp_username || p.smtp_host}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Beheer profielen onder Instellingen → E-mailprofielen. Eerst opslaan voordat je een testmail verstuurt.
          </p>
        </Field>
        <Field label="Ontvangers (komma-gescheiden)" full>
          <textarea rows={2} value={recipientsInput} onChange={e => setRecipientsInput(e.target.value)}
            className={inputCls} placeholder="naam1@bedrijf.nl, naam2@bedrijf.nl" />
        </Field>
        <div className="col-span-full flex flex-wrap gap-2">
          <input type="email" value={testRecipient} onChange={e => setTestRecipient(e.target.value)}
            placeholder="testmail@voorbeeld.nl" className={inputCls + ' max-w-xs'} />
          <button onClick={testEmail}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 inline-flex items-center gap-2">
            <EnvelopeIcon className="w-4 h-4" /> Verstuur testmail
          </button>
        </div>
      </Section>

      {config.last_run_at && (
        <div className="text-xs text-gray-500">
          Laatste run: {new Date(config.last_run_at).toLocaleString('nl-NL')}
          {config.last_run_status && <> — status: <b>{config.last_run_status}</b></>}
          {config.last_run_message && <> — {config.last_run_message}</>}
        </div>
      )}

      <div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Opslaan...' : 'Opslaan'}
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      {children}
    </label>
  )
}

/* -------------------- Ritnummers -------------------- */

function RitnummersTab() {
  const [vehicles, setVehicles] = useState<AvailableVehicle[]>([])
  const [selections, setSelections] = useState<RitnummerSelection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [manualInput, setManualInput] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [v, s] = await Promise.all([
        pakmiddelenApi.availableVehicles(),
        pakmiddelenApi.listRitnummers(),
      ])
      setVehicles(v)
      setSelections(s)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const selectionByRit = useMemo(() => {
    const m = new Map<string, RitnummerSelection>()
    for (const s of selections) m.set(s.ritnummer, s)
    return m
  }, [selections])

  const isActive = (rit: string) => selectionByRit.get(rit)?.actief ?? false

  const toggle = (rit: string) => {
    const existing = selectionByRit.get(rit)
    if (existing) {
      setSelections(selections.map(s => s.ritnummer === rit ? { ...s, actief: !s.actief } : s))
    } else {
      const v = vehicles.find(x => x.ritnummer === rit)
      setSelections([...selections, {
        id: 'tmp-' + rit, ritnummer: rit, vehicle: v?.id || null,
        vehicle_kenteken: v?.kenteken, actief: true, notitie: '',
        created_at: '', updated_at: '',
      }])
    }
  }

  const addManual = () => {
    const rit = manualInput.trim()
    if (!rit) return
    if (!selectionByRit.has(rit)) {
      setSelections([...selections, {
        id: 'tmp-' + rit, ritnummer: rit, vehicle: null,
        actief: true, notitie: '', created_at: '', updated_at: '',
      }])
    }
    setManualInput('')
  }

  const remove = (rit: string) => {
    setSelections(selections.filter(s => s.ritnummer !== rit))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const items = selections.map(s => ({
        ritnummer: s.ritnummer,
        vehicle: s.vehicle,
        actief: s.actief,
        notitie: s.notitie,
      }))
      const updated = await pakmiddelenApi.bulkSetRitnummers(items)
      setSelections(updated)
      setMessage('Opgeslagen.')
    } catch (e: any) {
      setMessage(e?.response?.data?.detail || 'Opslaan mislukt.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-500">Laden...</div>

  return (
    <div className="space-y-4">
      {message && (
        <div className="px-3 py-2 text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded">
          {message}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-md p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Vloot ritnummers</h3>
        <p className="text-xs text-gray-500 mb-3">
          Vink aan welke ritnummers gemonitord moeten worden. Ritnummers komen uit de actieve voertuigenlijst.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-80 overflow-auto">
          {vehicles.filter(v => v.ritnummer).map(v => (
            <label key={v.id} className="flex items-center gap-2 px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
              <input type="checkbox" checked={isActive(v.ritnummer)} onChange={() => toggle(v.ritnummer)} className="h-4 w-4" />
              <span className="text-sm">
                <span className="font-medium">{v.ritnummer}</span>
                <span className="text-gray-500 ml-1">— {v.kenteken}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-md p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Handmatig ritnummer</h3>
        <div className="flex gap-2">
          <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder="bv. 999" className={inputCls + ' max-w-xs'}
            onKeyDown={e => e.key === 'Enter' && addManual()} />
          <button onClick={addManual} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50 inline-flex items-center gap-1">
            <PlusIcon className="w-4 h-4" /> Toevoegen
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-md p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Geselecteerd ({selections.filter(s => s.actief).length})
        </h3>
        {selections.length === 0 ? (
          <div className="text-sm text-gray-500">Nog geen ritnummers geselecteerd.</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {selections.map(s => (
              <li key={s.ritnummer} className="py-2 flex items-center justify-between">
                <span className="text-sm">
                  <input type="checkbox" checked={s.actief} onChange={() => toggle(s.ritnummer)} className="h-4 w-4 mr-2 align-middle" />
                  <b>{s.ritnummer}</b>
                  {s.vehicle_kenteken && <span className="text-gray-500 ml-2">— {s.vehicle_kenteken}</span>}
                </span>
                <button onClick={() => remove(s.ritnummer)} className="text-red-600 hover:text-red-800" title="Verwijderen">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button onClick={save} disabled={saving}
        className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">
        {saving ? 'Opslaan...' : 'Selectie opslaan'}
      </button>
    </div>
  )
}
