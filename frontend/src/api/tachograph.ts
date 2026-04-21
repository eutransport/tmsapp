/**
 * Tachograph API service
 * FM-Track / Linqo tachograph data
 */
import api from './client'

export interface TachographTrip {
  start_time: string
  end_time: string
  start_km: number
  end_km: number
  distance_km: number
  duration_seconds: number
  duration_display: string
  drivers: { id: string; name: string }[]
  start_address: string
  end_address: string
}

export interface OvertimeCalculation {
  driver_name: string
  start_time: string
  end_time: string
  total_work_hours: number
  total_work_display: string
  pauze_minutes: number
  pauze_display: string
  netto_hours: number
  netto_display: string
  uren_per_dag: number
  uren_per_dag_display: string
  overtime_hours: number
  overtime_display: string
  formula: string
}

export interface TachographVehicle {
  object_id: string
  vehicle_name: string
  vehicle_make: string
  vehicle_model: string
  plate_number: string
  first_start: string | null
  last_end: string | null
  first_km: number
  last_km: number
  total_km: number
  total_duration_seconds: number
  total_hours: number
  total_hours_display: string
  overtime_hours: number
  overtime_display: string | null
  has_overtime: boolean
  overtime_calculation: OvertimeCalculation | null
  drivers: { id: string; name: string }[]
  trips: TachographTrip[]
  trip_count: number
}

export interface TachographOverview {
  date: string
  vehicles: TachographVehicle[]
  count: number
}

export interface TachographOvertimeRecord {
  id: string
  driver_id: string
  driver_naam: string
  date: string
  overtime_hours: number
  vehicle_name: string
  fm_driver_name: string
  created_at: string
}

export async function getTachographOverview(date: string): Promise<TachographOverview> {
  const response = await api.get(`/tracking/tachograph/?date=${date}`)
  return response.data
}

export async function getTachographArchive(date: string): Promise<TachographOverview> {
  const response = await api.get(`/tracking/tachograph/archive/?date=${date}`)
  return response.data
}

export async function syncTachographArchiveDay(date: string): Promise<{
  date: string
  deleted_count: number
  created_count: number
}> {
  const response = await api.post('/tracking/tachograph/archive/sync/', { date })
  return response.data
}

export interface TachographArchiveExportFile {
  blob: Blob
  filename: string
}

function getDownloadFilename(contentDisposition: string | undefined, fallback: string): string {
  if (!contentDisposition) return fallback
  const match = contentDisposition.match(/filename="?([^";\n]+)"?/)
  return match?.[1] || fallback
}

export async function exportTachographArchiveCsv(date: string): Promise<TachographArchiveExportFile> {
  const response = await api.get(
    `/tracking/tachograph/archive/?date=${encodeURIComponent(date)}&format=csv`,
    { responseType: 'blob' },
  )
  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers['content-disposition'], 'tachograaf_archief.csv'),
  }
}

export async function exportTachographArchiveXlsx(date: string): Promise<TachographArchiveExportFile> {
  const response = await api.get(
    `/tracking/tachograph/archive/?date=${encodeURIComponent(date)}&format=xlsx`,
    { responseType: 'blob' },
  )
  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers['content-disposition'], 'tachograaf_archief.xlsx'),
  }
}

export async function exportTachographArchivePdf(date: string): Promise<TachographArchiveExportFile> {
  const response = await api.get(
    `/tracking/tachograph/archive/?date=${encodeURIComponent(date)}&format=pdf`,
    { responseType: 'blob' },
  )
  return {
    blob: response.data,
    filename: getDownloadFilename(response.headers['content-disposition'], 'tachograaf_archief.pdf'),
  }
}

export async function writeOvertime(data: {
  driver_id: string
  date: string
  overtime_hours: number
  vehicle_name: string
  fm_driver_name: string
}): Promise<{ success: boolean; message: string; created: boolean }> {
  const response = await api.post('/tracking/tachograph/overtime/', data)
  return response.data
}

export async function getOvertimeList(params?: {
  driver_id?: string
  date_from?: string
  date_till?: string
}): Promise<{ results: TachographOvertimeRecord[]; count: number }> {
  const searchParams = new URLSearchParams()
  if (params?.driver_id) searchParams.append('driver_id', params.driver_id)
  if (params?.date_from) searchParams.append('date_from', params.date_from)
  if (params?.date_till) searchParams.append('date_till', params.date_till)
  const response = await api.get(`/tracking/tachograph/overtime/list/?${searchParams.toString()}`)
  return response.data
}

export interface TachoVehicle {
  object_id: string
  name: string
  plate_number: string
  make: string
  model: string
}

export async function getTachographVehicles(): Promise<{ vehicles: TachoVehicle[]; count: number }> {
  const response = await api.get('/tracking/tachograph/vehicles/')
  return response.data
}

export async function getTachographSyncInfo(): Promise<{
  start_datum: string | null
  effective_start: string | null
  unprocessed_dates: number
}> {
  const response = await api.get('/tracking/tachograph/sync/')
  return response.data
}

export async function triggerTachographSync(force = false): Promise<{
  status: string
  reason?: string
  dates_processed?: number
  entries_created?: number
  overtime_created?: number
  force_resync?: boolean
  deleted_entries?: number
  deleted_overtime?: number
  deleted_logs?: number
}> {
  const response = await api.post('/tracking/tachograph/sync/', { force })
  return response.data
}

export interface TachographComparisonRow {
  datum: string
  kenteken: string
  chauffeur_naam: string
  chauffeur_begin: string | null
  chauffeur_eind: string | null
  auto_begin: string | null
  auto_eind: string | null
  tacho_begin: string | null
  tacho_eind: string | null
  chauffeur_totaal: number | null
  tacho_totaal: number | null
  auto_totaal: number | null
  verschil: number | null
  verschil_bron: 'tacho' | 'chauffeur' | null
  uren_per_dag: number | null
  overwerk_uren: number | null
  overwerk_tacho: number | null
}

export interface TachographComparisonResponse {
  date_from: string
  date_till: string
  rows: TachographComparisonRow[]
  count: number
  drivers: { id: string; naam: string }[]
  plates: string[]
}

export async function getTachographComparison(dateFrom: string, dateTill: string, kenteken?: string): Promise<TachographComparisonResponse> {
  const params = new URLSearchParams({ date_from: dateFrom, date_till: dateTill })
  if (kenteken) params.append('kenteken', kenteken)
  const response = await api.get(`/tracking/tachograph/comparison/?${params.toString()}`)
  return response.data
}

export async function exportTachographComparisonXlsx(dateFrom: string, dateTill: string): Promise<Blob> {
  const response = await api.get(
    `/tracking/tachograph/comparison/?date_from=${encodeURIComponent(dateFrom)}&date_till=${encodeURIComponent(dateTill)}&export=xlsx`,
    { responseType: 'blob' },
  )
  return response.data
}

export async function exportTachographComparisonPdf(dateFrom: string, dateTill: string): Promise<Blob> {
  const response = await api.get(
    `/tracking/tachograph/comparison/?date_from=${encodeURIComponent(dateFrom)}&date_till=${encodeURIComponent(dateTill)}&export=pdf`,
    { responseType: 'blob' },
  )
  return response.data
}
