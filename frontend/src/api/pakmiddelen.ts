/**
 * Pakmiddelen Teruggavebonnen API
 */
import api from './client'

export interface PakmiddelenConfig {
  id: string
  provider: 'imap' | 'graph'
  imap_host: string
  imap_port: number
  imap_use_ssl: boolean
  imap_username: string
  imap_password?: string
  imap_password_set: boolean
  imap_folder: string
  graph_tenant_id: string
  graph_client_id: string
  graph_client_secret?: string
  graph_client_secret_set: boolean
  graph_client_secret_expires_at: string | null
  graph_client_secret_days_left: number | null
  graph_mailbox: string
  graph_folder: string
  subject_template: string
  mark_as_read: boolean
  enabled: boolean
  schedule_time: string  // "HH:MM:SS"
  period_days: number
  period_from_date: string | null
  notification_recipients: string[]
  notification_email_profile: string | null
  last_run_at: string | null
  last_run_status: string
  last_run_message: string
  created_at: string
  updated_at: string
}

export interface AvailableVehicle {
  id: string
  kenteken: string
  ritnummer: string
  type_wagen: string
  bedrijf_naam: string | null
  actief: boolean
}

export interface RitnummerSelection {
  id: string
  ritnummer: string
  vehicle: string | null
  vehicle_kenteken?: string
  actief: boolean
  notitie: string
  created_at: string
  updated_at: string
}

export interface CheckResult {
  id: string
  check_date: string
  ritnummer: string
  has_bon: boolean
  matched_subject: string
  mail_message_id: string
  mail_received_at: string | null
  notification_sent: boolean
  created_at: string
  updated_at: string
}

const BASE = '/pakmiddelen'

export const pakmiddelenApi = {
  // Config
  getConfig: () => api.get<PakmiddelenConfig>(`${BASE}/config/`).then(r => r.data),

  updateConfig: (data: Partial<PakmiddelenConfig>) =>
    api.patch<PakmiddelenConfig>(`${BASE}/config/current/`, data).then(r => r.data),

  testImap: (override?: { imap_host?: string; imap_password?: string }) =>
    api.post<{ success: boolean; message: string }>(`${BASE}/config/test-imap/`, override || {})
      .then(r => r.data)
      .catch(err => err.response?.data || { success: false, message: 'Onbekende fout' }),

  testGraph: (override?: {
    graph_tenant_id?: string
    graph_client_id?: string
    graph_client_secret?: string
    graph_mailbox?: string
    graph_folder?: string
  }) =>
    api.post<{ success: boolean; message: string }>(`${BASE}/config/test-graph/`, override || {})
      .then(r => r.data)
      .catch(err => err.response?.data || { success: false, message: 'Onbekende fout' }),

  testEmail: (recipient: string) =>
    api.post<{ success: boolean; message: string }>(`${BASE}/config/test-email/`, { recipient })
      .then(r => r.data)
      .catch(err => err.response?.data || { success: false, message: 'Onbekende fout' }),

  runNow: (params?: { date?: string; from?: string; to?: string; send_report?: boolean }) =>
    api.post<{ success: boolean; matched: number; missing?: string[]; message: string; date?: string }>(
      `${BASE}/config/run-now/`, params || {}
    ).then(r => r.data),

  // Ritnummers
  listRitnummers: () =>
    api.get<RitnummerSelection[] | { results: RitnummerSelection[] }>(`${BASE}/ritnummers/`)
      .then(r => Array.isArray(r.data) ? r.data : r.data.results || []),

  availableVehicles: () =>
    api.get<AvailableVehicle[]>(`${BASE}/ritnummers/available-vehicles/`).then(r => r.data),

  bulkSetRitnummers: (items: { ritnummer: string; vehicle?: string | null; actief?: boolean; notitie?: string }[]) =>
    api.post<RitnummerSelection[]>(`${BASE}/ritnummers/bulk-set/`, { items }).then(r => r.data),

  // Results
  listResults: (params?: { date?: string; from?: string; to?: string }) =>
    api.get<CheckResult[] | { results: CheckResult[] }>(`${BASE}/results/`, {
      params: params || undefined,
    }).then(r => Array.isArray(r.data) ? r.data : r.data.results || []),

  resultDates: (params?: { from?: string; to?: string }) =>
    api.get<{ dates: string[]; min_date: string | null; max_date: string | null }>(
      `${BASE}/results/dates/`, { params: params || undefined }
    ).then(r => r.data),

  exportResults: (params: { format: 'xlsx' | 'pdf'; date?: string; from?: string; to?: string }) =>
    api.get(`${BASE}/results/export/`, {
      params: { fmt: params.format, date: params.date, from: params.from, to: params.to },
      responseType: 'blob',
    }).then(r => {
      const url = window.URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url
      const cd = r.headers['content-disposition'] || ''
      const match = /filename="?([^"]+)"?/.exec(cd)
      a.download = match ? match[1] : `pakmiddelen.${params.format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    }),

  mailResults: (params: {
    from?: string; to?: string; date?: string;
    recipients?: string[]; use_config_recipients?: boolean;
    include_xlsx?: boolean; include_pdf?: boolean;
  }) =>
    api.post<{ success: boolean; message: string; recipients?: string[] }>(
      `${BASE}/results/mail/`, params,
    ).then(r => r.data),

  // Mail history
  listMailLogs: (params?: {
    page?: number; page_size?: number;
    mail_type?: MailLogType | '';
    success?: 'true' | 'false' | '';
    from?: string; to?: string;
  }) =>
    api.get<PaginatedResponse<MailLog>>(`${BASE}/mail-logs/`, {
      params: params || undefined,
    }).then(r => r.data),
}

export type MailLogType = 'daily_report' | 'overview' | 'test' | 'secret_expiry'

export interface MailLog {
  id: string
  sent_at: string
  mail_type: MailLogType
  mail_type_display: string
  recipients: string[]
  subject: string
  success: boolean
  message: string
  related_date: string | null
  user: string | null
  user_email: string | null
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
