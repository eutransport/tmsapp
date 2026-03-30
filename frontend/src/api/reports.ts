/**
 * Reports Agent API
 * Handles report requests, execution, and downloads
 */
import api from './client'

// ---- Types ----

export type ReportStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ReportOutputFormat = 'screen' | 'excel' | 'pdf' | 'all'

export interface ReportParameterOption {
  value: string
  label: string
}

export interface ReportParameter {
  name: string
  label: string
  type: 'text' | 'user' | 'driver' | 'vehicle' | 'company' | 'year' | 'date' | 'select'
  required: boolean
  default?: string
  options?: ReportParameterOption[]
}

export interface ReportTypeInfo {
  value: string
  label: string
  description: string
  parameters: ReportParameter[]
}

export interface ReportResultData {
  columns: string[]
  rows: (string | number | null)[][]
  title: string
}

export interface ReportRequest {
  id: string
  title: string
  report_type: string
  report_type_display: string
  parameters: Record<string, string | number>
  output_format: ReportOutputFormat
  output_format_display: string
  status: ReportStatus
  status_display: string
  result_data: ReportResultData | null
  excel_file: string | null
  excel_url: string | null
  pdf_file: string | null
  pdf_url: string | null
  error_message: string
  row_count: number | null
  requested_by: string
  requested_by_naam: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CreateReportRequest {
  title: string
  report_type: string
  parameters: Record<string, string | number>
  output_format: ReportOutputFormat
}

// ---- API functions ----

/** Get all available report types with their parameter schemas */
export async function getReportTypes(): Promise<ReportTypeInfo[]> {
  const response = await api.get('/reports/requests/types/')
  return response.data
}

/** List all report requests (paginated) */
export async function getReportRequests(): Promise<ReportRequest[]> {
  const response = await api.get('/reports/requests/')
  return response.data.results ?? response.data
}

/** Get a single report request */
export async function getReportRequest(id: string): Promise<ReportRequest> {
  const response = await api.get(`/reports/requests/${id}/`)
  return response.data
}

/** Create a new report request */
export async function createReportRequest(data: CreateReportRequest): Promise<ReportRequest> {
  const response = await api.post('/reports/requests/', data)
  return response.data
}

/** Execute (process) a report request */
export async function executeReportRequest(id: string): Promise<ReportRequest> {
  const response = await api.post(`/reports/requests/${id}/execute/`)
  return response.data
}

/** Retry a failed report request */
export async function retryReportRequest(id: string): Promise<ReportRequest> {
  const response = await api.post(`/reports/requests/${id}/retry/`)
  return response.data
}

/** Delete a report request */
export async function deleteReportRequest(id: string): Promise<void> {
  await api.delete(`/reports/requests/${id}/`)
}

/** Get the Excel download URL for a completed report */
export function getExcelDownloadUrl(id: string): string {
  const { getApiUrl } = (window as unknown as { serverConfig?: { getApiUrl?: () => string } }).serverConfig ?? {}
  const base = getApiUrl?.() ?? '/api'
  return `${base}/reports/requests/${id}/download/excel/`
}

/** Get the PDF download URL for a completed report */
export function getPdfDownloadUrl(id: string): string {
  const { getApiUrl } = (window as unknown as { serverConfig?: { getApiUrl?: () => string } }).serverConfig ?? {}
  const base = getApiUrl?.() ?? '/api'
  return `${base}/reports/requests/${id}/download/pdf/`
}

/** Download a file via the API client (returns blob) */
export async function downloadReportFile(id: string, format: 'excel' | 'pdf'): Promise<Blob> {
  const response = await api.get(`/reports/requests/${id}/download/${format}/`, {
    responseType: 'blob',
  })
  return response.data
}
