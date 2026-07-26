/**
 * Tolheffing (toll charging) API — CSV import + per-vehicle summaries + invoice hooks.
 */
import api from './client'

export interface TollingEvent {
  id: string
  start_at: string
  end_at: string
  distance_km: string
  amount: string
  license_plate_raw: string
  license_plate_normalized: string
  obu: string
  invoice_line: string | null
  invoiced_at: string | null
  invoiced: boolean
  is_private?: boolean
  private_registration?: string | null
  created_at: string
}

export interface TollingVehicleRow {
  plate_normalized: string
  plate_raw: string
  plate_display: string
  ritnummer: string | null
  vehicle_id: string | null
  bedrijf_id: string | null
  bedrijf_naam: string | null
  current_month_km: number
  current_month_amount: number
}

export interface TollingSummary {
  plate_normalized: string
  period: 'week' | 'month'
  year: number
  index: number
  offset: number
  start: string
  end: string
  label: string
  total_km: number
  total_amount: number
  events_count: number
  invoiced_count: number
  events: TollingEvent[]
}

export interface TollingInvoicePreviewRow {
  plate_normalized: string
  plate_display: string
  ritnummer: string | null
  vehicle_id: string | null
  total_km: number
  total_amount: number
  events_count: number
  weekday_km: number
  weekday_amount: number
  weekend_km: number
  weekend_amount: number
  period: 'month' | 'week'
  year: number
  index: number
  label: string
  /** @deprecated use `index` when period === 'month' */
  month: number
}

export type TollingPeriod = 'month' | 'week'

export interface TollingPeriodRef {
  period: TollingPeriod
  year: number
  index: number
}

export interface TollingOpenWeek {
  year: number
  week: number
  start: string        // YYYY-MM-DD
  end: string          // YYYY-MM-DD (inclusive)
  label: string
  events_count: number
  total_km: number
  total_amount: number
}

export interface CreateTollingInvoicePayload {
  plate: string
  year: number
  week_start: number
  period_weeks: 1 | 2 | 3 | 4
  template_id: string
  bedrijf_id: string
  administratie_id?: string | null
  factuurdatum?: string  // YYYY-MM-DD
  vervaldatum?: string   // YYYY-MM-DD
  btw_percentage?: number
  exclude_weekend?: boolean
  cutoff_time?: string | null  // "HH:MM" local time
}

export interface CreateTollingInvoiceLine {
  id: string
  week: number
  year: number
  omschrijving: string
  total_km: number
  total_amount: number
  events_count: number
}

export interface CreateTollingInvoiceResponse {
  invoice_id: string
  factuurnummer: string
  status: string
  subtotaal: number
  btw_bedrag: number
  totaal: number
  lines: CreateTollingInvoiceLine[]
  events_marked: number
}

export interface TollingImportBatch {
  id: string
  filename: string
  rows_total: number
  rows_imported: number
  rows_duplicate: number
  rows_invalid: number
  error_message: string
  created_at: string
  result?: {
    imported: number
    duplicates: number
    invalid: number
    total: number
  }
}

export const tollingApi = {
  uploadCsv: async (file: File): Promise<TollingImportBatch> => {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await api.post('/tolling/imports/upload/', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  listBatches: async (): Promise<TollingImportBatch[]> => {
    const { data } = await api.get('/tolling/imports/')
    return Array.isArray(data) ? data : (data?.results ?? [])
  },

  listVehicles: async (): Promise<TollingVehicleRow[]> => {
    const { data } = await api.get('/tolling/vehicles/')
    return data
  },

  summary: async (
    plate: string,
    params: { period: 'week' | 'month'; offset: number },
  ): Promise<TollingSummary> => {
    const { data } = await api.get(`/tolling/vehicles/${encodeURIComponent(plate)}/summary/`, { params })
    return data
  },

  exportUrl: (
    plate: string,
    params: { period: 'week' | 'month'; offset: number; format: 'xlsx' | 'pdf' },
  ): string => {
    const query = new URLSearchParams({
      period: params.period,
      offset: String(params.offset),
      export_format: params.format,
    })
    return `/api/tolling/vehicles/${encodeURIComponent(plate)}/export/?${query.toString()}`
  },

  downloadExport: async (
    plate: string,
    params: { period: 'week' | 'month'; offset: number; format: 'xlsx' | 'pdf' },
  ): Promise<Blob> => {
    const { data } = await api.get(
      `/tolling/vehicles/${encodeURIComponent(plate)}/export/`,
      {
        params: { period: params.period, offset: params.offset, export_format: params.format },
        responseType: 'blob',
      },
    )
    return data
  },

  markUninvoiced: async (
    plate: string,
    ref: TollingPeriodRef,
  ): Promise<{ unmarked: number; lines_deleted: number }> => {
    const { data } = await api.post(
      `/tolling/vehicles/${encodeURIComponent(plate)}/mark-uninvoiced/`,
      { period: ref.period, year: ref.year, index: ref.index },
    )
    return data
  },

  emailExport: async (
    plate: string,
    payload: {
      recipients: string[]
      subject?: string
      body?: string
      fmt: 'pdf' | 'xlsx'
      period: 'week' | 'month'
      offset: number
      email_profile_id?: string
    },
  ): Promise<{ sent: boolean; recipients: string[]; filename: string }> => {
    const { data } = await api.post(
      `/tolling/vehicles/${encodeURIComponent(plate)}/email-export/`,
      payload,
    )
    return data
  },

  openWeeks: async (
    plate: string,
    opts: { excludeWeekend?: boolean; cutoffTime?: string | null } = {},
  ): Promise<TollingOpenWeek[]> => {
    const params: Record<string, string> = {}
    if (opts.excludeWeekend !== undefined) {
      params.exclude_weekend = opts.excludeWeekend ? 'true' : 'false'
    }
    if (opts.cutoffTime) params.cutoff_time = opts.cutoffTime
    const { data } = await api.get(
      `/tolling/vehicles/${encodeURIComponent(plate)}/open-weeks/`,
      { params },
    )
    return data
  },

  createInvoiceForVehicle: async (
    payload: CreateTollingInvoicePayload,
  ): Promise<CreateTollingInvoiceResponse> => {
    const { data } = await api.post('/tolling/invoicing/create-invoice/', payload)
    return data
  },

  invoicePreview: async (ref: TollingPeriodRef): Promise<TollingInvoicePreviewRow[]> => {
    const { data } = await api.get('/tolling/invoicing/preview/', {
      params: { period: ref.period, year: ref.year, index: ref.index },
    })
    return data
  },

  addToInvoice: async (
    invoiceId: string,
    ref: TollingPeriodRef,
    plates: string[],
    opts: { excludeWeekend?: boolean } = {},
  ): Promise<{ lines: Array<{ id: string; plate: string; ritnummer: string; total_km: number; total_amount: number; events_count: number }> }> => {
    const { data } = await api.post('/tolling/invoicing/add-to-invoice/', {
      invoice_id: invoiceId,
      period: ref.period,
      year: ref.year,
      index: ref.index,
      plates,
      exclude_weekend: opts.excludeWeekend === true,
    })
    return data
  },

  linkLine: async (
    invoiceLineId: string,
    plate: string,
    ref: TollingPeriodRef,
    opts: { excludeWeekend?: boolean } = {},
  ): Promise<{ linked: number }> => {
    const { data } = await api.post('/tolling/invoicing/link-line/', {
      invoice_line_id: invoiceLineId,
      plate,
      period: ref.period,
      year: ref.year,
      index: ref.index,
      exclude_weekend: opts.excludeWeekend === true,
    })
    return data
  },
}

// -------- Privé tolregistratie (chauffeur) --------

export interface PrivateTollRegistration {
  id: string
  datum: string // YYYY-MM-DD
  begin_tijd: string // HH:mm[:ss]
  eind_tijd: string
  license_plate_raw: string
  license_plate_normalized: string
  notitie: string
  matched_events_count: number
  matched_events_amount?: number
  matched_events_km?: number
  matched_events?: PrivateTollMatchedEvent[]
  admin_invoiced?: boolean
  admin_invoiced_at?: string | null
  created_at: string
  updated_at: string
}

export interface PrivateTollMatchedEvent {
  id: string
  start_at: string
  end_at: string
  distance_km: number
  amount: number
}

export interface PrivateTollListResponse {
  count: number
  page: number
  page_size: number
  num_pages: number
  results: PrivateTollRegistration[]
}

export interface PrivateTollListParams {
  page?: number
  pageSize?: number
  period?: 'week' | 'month'
  year?: number
  index?: number
  plate?: string
  user_id?: string
}

export const privateTollApi = {
  list: async (params: PrivateTollListParams = {}): Promise<PrivateTollListResponse> => {
    const query: Record<string, string | number> = {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    }
    if (params.period && params.year != null && params.index != null) {
      query.period = params.period
      query.year = params.year
      query.index = params.index
    }
    if (params.plate) query.plate = params.plate
    if (params.user_id) query.user_id = params.user_id
    const { data } = await api.get('/tolling/private/', { params: query })
    return data
  },

  create: async (payload: Partial<PrivateTollRegistration> & { user_id?: string }): Promise<PrivateTollRegistration> => {
    const { data } = await api.post('/tolling/private/', payload)
    return data
  },

  update: async (id: string, payload: Partial<PrivateTollRegistration>): Promise<PrivateTollRegistration> => {
    const { data } = await api.patch(`/tolling/private/${id}/`, payload)
    return data
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/tolling/private/${id}/`)
  },
}

// -------- Admin: privé tolheffing per chauffeur --------

export interface PrivateTollAdminSummaryRow {
  user_id: string
  user_name: string
  user_email: string
  registrations_count: number
  matched_events_count: number
  total_km: number
  total_amount: number
  invoiced_count: number
  all_invoiced: boolean
  any_invoiced: boolean
  first_datum: string | null
  last_datum: string | null
}

export interface PrivateTollAdminSummaryResponse {
  period: 'week' | 'month'
  year: number
  index: number
  label: string
  start: string
  end: string
  results: PrivateTollAdminSummaryRow[]
}

export interface PrivateTollAdminParams {
  period: 'week' | 'month'
  year: number
  index: number
}

export const privateTollAdminApi = {
  summary: async (params: PrivateTollAdminParams): Promise<PrivateTollAdminSummaryResponse> => {
    const { data } = await api.get('/tolling/private/admin-summary/', { params })
    return data
  },

  detail: async (params: PrivateTollAdminParams & { user_id: string }): Promise<PrivateTollRegistration[]> => {
    const { data } = await api.get('/tolling/private/admin-detail/', { params })
    return data
  },

  markInvoiced: async (
    payload: PrivateTollAdminParams & { user_id: string; invoiced: boolean },
  ): Promise<{ updated: number; invoiced: boolean }> => {
    const { data } = await api.post('/tolling/private/admin-mark-invoiced/', payload)
    return data
  },
}
