/**
 * Uren Import API - Upload Excel, get imported entries, week comparison
 */
import api from './client'

// Types
export interface ImportBatch {
  id: string
  bestandsnaam: string
  geimporteerd_door: string | null
  geimporteerd_door_naam: string
  totaal_rijen: number
  gekoppeld: number
  niet_gekoppeld: number
  created_at: string
}

export interface ImportedTimeEntry {
  id: string
  batch: string
  user: string | null
  user_naam: string
  weeknummer: number
  periode: string
  datum: string
  ritlijst: string
  kenteken_import: string
  km: number
  uurtarief: number
  dot: string
  geplande_vertrektijd: string | null
  ingelogd_bc: string | null
  begintijd_rit: string | null
  eindtijd_rit: string | null
  uren: number
  pauze: string
  pauze_display: string
  netto_uren: number
  uren_factuur: number
  factuur_bedrag: number
  gekoppeld_voertuig: string | null
  voertuig_kenteken: string
  voertuig_ritnummer: string
  created_at: string
}

export interface WeekComparison {
  user_id: string
  user_naam: string
  jaar: number
  weeknummer: number
  import_uren: number
  chauffeur_uren: number
  verschil: number
  import_km: number
  chauffeur_km: number
}

export interface WeekComparisonFilters {
  jaar?: number
  weeknummer?: number
  user?: string
}

export interface ImportedEntryFilters {
  weeknummer?: number
  jaar?: number
  user?: string
  kenteken?: string
}

// API functions

export async function getImportBatches(): Promise<ImportBatch[]> {
  const response = await api.get('/time-entries/imports/')
  return response.data.results ?? response.data
}

export async function getImportBatch(id: string): Promise<ImportBatch> {
  const response = await api.get(`/time-entries/imports/${id}/`)
  return response.data
}

export async function deleteImportBatch(id: string): Promise<void> {
  await api.delete(`/time-entries/imports/${id}/`)
}

export async function uploadImportFile(file: File): Promise<ImportBatch> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/time-entries/imports/upload/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function getBatchEntries(
  batchId: string,
  filters?: ImportedEntryFilters
): Promise<ImportedTimeEntry[]> {
  const params = new URLSearchParams()
  if (filters?.weeknummer) params.append('weeknummer', filters.weeknummer.toString())
  if (filters?.user) params.append('user', filters.user)
  if (filters?.kenteken) params.append('kenteken', filters.kenteken)
  const response = await api.get(`/time-entries/imports/${batchId}/entries/?${params.toString()}`)
  return response.data
}

export async function getImportedEntries(filters?: ImportedEntryFilters): Promise<ImportedTimeEntry[]> {
  const params = new URLSearchParams()
  if (filters?.weeknummer) params.append('weeknummer', filters.weeknummer.toString())
  if (filters?.jaar) params.append('jaar', filters.jaar.toString())
  if (filters?.user) params.append('user', filters.user)
  if (filters?.kenteken) params.append('kenteken', filters.kenteken)
  const response = await api.get(`/time-entries/imports/imported-entries/?${params.toString()}`)
  return response.data
}

export async function getWeekComparison(filters?: WeekComparisonFilters): Promise<WeekComparison[]> {
  const params = new URLSearchParams()
  if (filters?.jaar) params.append('jaar', filters.jaar.toString())
  if (filters?.weeknummer) params.append('weeknummer', filters.weeknummer.toString())
  if (filters?.user) params.append('user', filters.user)
  const response = await api.get(`/time-entries/imports/week-comparison/?${params.toString()}`)
  return response.data
}
