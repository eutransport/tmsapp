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
  created_at: string
}

export interface TollingVehicleRow {
  plate_normalized: string
  plate_raw: string
  plate_display: string
  ritnummer: string | null
  vehicle_id: string | null
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
  ): Promise<{ lines: Array<{ id: string; plate: string; ritnummer: string; total_km: number; total_amount: number; events_count: number }> }> => {
    const { data } = await api.post('/tolling/invoicing/add-to-invoice/', {
      invoice_id: invoiceId,
      period: ref.period,
      year: ref.year,
      index: ref.index,
      plates,
    })
    return data
  },

  linkLine: async (
    invoiceLineId: string,
    plate: string,
    ref: TollingPeriodRef,
  ): Promise<{ linked: number }> => {
    const { data } = await api.post('/tolling/invoicing/link-line/', {
      invoice_line_id: invoiceLineId,
      plate,
      period: ref.period,
      year: ref.year,
      index: ref.index,
    })
    return data
  },
}
