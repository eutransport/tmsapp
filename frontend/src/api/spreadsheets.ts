/**
 * Spreadsheets API service
 * CRUD operations for transport ritregistratie spreadsheets
 */
import api from './client'
import { Spreadsheet, PaginatedResponse } from '@/types'

export interface SpreadsheetFilters {
  page?: number
  page_size?: number
  search?: string
  ordering?: string
  bedrijf?: string
  week_nummer?: number
  jaar?: number
  status?: string
}

export interface SpreadsheetCreate {
  naam: string
  bedrijf: string
  week_nummer: number
  jaar: number
  tarief_per_uur?: number
  tarief_per_km?: number
  tarief_dot?: number
  rijen?: any[]
  notities?: string
  template?: string | null
}

export interface SpreadsheetUpdate extends Partial<SpreadsheetCreate> {}

// List spreadsheets
export async function getSpreadsheets(filters?: SpreadsheetFilters): Promise<PaginatedResponse<Spreadsheet>> {
  const response = await api.get('/spreadsheets/', { params: filters })
  return response.data
}

// Get single spreadsheet
export async function getSpreadsheet(id: string): Promise<Spreadsheet> {
  const response = await api.get(`/spreadsheets/${id}/`)
  return response.data
}

// Create spreadsheet
export async function createSpreadsheet(data: SpreadsheetCreate): Promise<Spreadsheet> {
  const response = await api.post('/spreadsheets/', data)
  return response.data
}

// Update spreadsheet
export async function updateSpreadsheet(id: string, data: SpreadsheetUpdate): Promise<Spreadsheet> {
  const response = await api.patch(`/spreadsheets/${id}/`, data)
  return response.data
}

// Delete spreadsheet
export async function deleteSpreadsheet(id: string): Promise<void> {
  await api.delete(`/spreadsheets/${id}/`)
}

// Duplicate spreadsheet
export async function duplicateSpreadsheet(id: string): Promise<Spreadsheet> {
  const response = await api.post(`/spreadsheets/${id}/duplicate/`)
  return response.data
}

// Send spreadsheet via email
export async function sendSpreadsheetEmail(
  id: string,
  emails: string[],
  emailProfileId?: string,
): Promise<{ message: string }> {
  const data: Record<string, unknown> = { emails }
  if (emailProfileId) data.email_profile_id = emailProfileId
  const response = await api.post(`/spreadsheets/${id}/send_email/`, data)
  return response.data
}

// Submit spreadsheet (mark as ingediend)
export async function submitSpreadsheet(id: string): Promise<Spreadsheet> {
  const response = await api.post(`/spreadsheets/${id}/submit/`)
  return response.data
}

// Reopen spreadsheet (mark as concept)
export async function reopenSpreadsheet(id: string): Promise<Spreadsheet> {
  const response = await api.post(`/spreadsheets/${id}/reopen/`)
  return response.data
}

// Import time entries as spreadsheet rows
export interface ImportTimeEntriesParams {
  week_nummer: number
  jaar: number
  user?: string
}

export interface ImportedRij {
  ritnr: string
  volgnummer: string
  chauffeur: string
  datum: string
  begin_tijd: number | null
  eind_tijd: number | null
  pauze: number | null
  correctie: number | null
  begin_km: number | null
  eind_km: number | null
  overnachting: number | null
  overige_kosten: number | null
  time_entry_id?: string
}

export interface WeekChauffeur {
  id: string
  naam: string
  entries: number
  totaal_uren: number
  totaal_km: number
}

export interface AvailableWeek {
  week_nummer: number
  jaar: number
  count: number
  datum_van: string
  datum_tot: string
  chauffeurs: WeekChauffeur[]
}

export async function getAvailableWeeks(
  params?: { jaar?: number },
): Promise<AvailableWeek[]> {
  const response = await api.get('/spreadsheets/available-weeks/', { params })
  return response.data
}

export async function importTimeEntries(
  params: ImportTimeEntriesParams,
): Promise<{ count: number; rijen: ImportedRij[] }> {
  const response = await api.get('/spreadsheets/import-time-entries/', { params })
  return response.data
}
