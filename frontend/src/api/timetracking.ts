import api from './client'
import { TimeEntry } from '@/types'

// Types
export interface TimeEntryFilters {
  page?: number
  page_size?: number
  search?: string
  status?: 'concept' | 'ingediend'
  weeknummer?: number
  ritnummer?: string
  datum?: string
  user?: string
  jaar?: number
  ordering?: string
}

export interface TimeEntryCreate {
  ritnummer: string
  datum: string
  kenteken: string
  km_start: number
  km_eind: number
  aanvang: string
  eind: string
  pauze?: string
}

export interface TimeEntryUpdate extends Partial<TimeEntryCreate> {
  status?: 'concept' | 'ingediend'
}

export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface WeekSummary {
  weeknummer: number
  totaal_entries: number
  concept_count: number
  ingediend_count: number
  totaal_km: number
  totaal_uren: string
  kan_indienen: boolean
}

export interface WeekHistory {
  weeknummer: number
  jaar: number
  user_id: string
  user__voornaam: string
  user__achternaam: string
  totaal_km: number
  entries_count: number
  concept_count: number
  ingediend_count: number
}

// API functions

/**
 * Get paginated list of time entries
 */
export async function getTimeEntries(filters?: TimeEntryFilters): Promise<PaginatedResponse<TimeEntry>> {
  const params = new URLSearchParams()
  
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.search) params.append('search', filters.search)
  if (filters?.status) params.append('status', filters.status)
  if (filters?.weeknummer) params.append('weeknummer', filters.weeknummer.toString())
  if (filters?.ritnummer) params.append('ritnummer', filters.ritnummer)
  if (filters?.datum) params.append('datum', filters.datum)
  if (filters?.user) params.append('user', filters.user)
  if (filters?.jaar) params.append('jaar', filters.jaar.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/time-entries/?${params.toString()}`)
  return response.data
}

/**
 * Get a single time entry by ID
 */
export async function getTimeEntry(id: string): Promise<TimeEntry> {
  const response = await api.get(`/time-entries/${id}/`)
  return response.data
}

/**
 * Create a new time entry
 */
export async function createTimeEntry(data: TimeEntryCreate): Promise<TimeEntry> {
  const response = await api.post('/time-entries/', data)
  return response.data
}

/**
 * Update an existing time entry
 */
export async function updateTimeEntry(id: string, data: TimeEntryUpdate): Promise<TimeEntry> {
  const response = await api.patch(`/time-entries/${id}/`, data)
  return response.data
}

/**
 * Delete a time entry
 */
export async function deleteTimeEntry(id: string): Promise<void> {
  await api.delete(`/time-entries/${id}/`)
}

/**
 * Submit all concept entries for a week
 */
export async function submitWeek(weeknummer: number, jaar?: number): Promise<{ message: string; count: number }> {
  const response = await api.post('/time-entries/submit_week/', { 
    weeknummer,
    jaar 
  })
  return response.data
}

/**
 * Get summary for a specific week
 */
export async function getWeekSummary(weeknummer: number, jaar?: number, userId?: string): Promise<WeekSummary> {
  const params = new URLSearchParams()
  params.append('weeknummer', weeknummer.toString())
  if (jaar) params.append('jaar', jaar.toString())
  if (userId) params.append('user', userId)
  
  const response = await api.get(`/time-entries/week_summary/?${params.toString()}`)
  return response.data
}

/**
 * Get history grouped by week
 */
export async function getWeekHistory(userId?: string, status?: string): Promise<WeekHistory[]> {
  const params = new URLSearchParams()
  if (userId) params.append('user', userId)
  if (status) params.append('status', status)
  
  const response = await api.get(`/time-entries/history/?${params.toString()}`)
  return response.data
}

/**
 * Get current week number
 */
export function getCurrentWeekNumber(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now.getTime() - start.getTime()
  const oneWeek = 604800000 // milliseconds in a week
  return Math.ceil((diff + start.getDay() * 86400000) / oneWeek)
}

/**
 * Get current year
 */
export function getCurrentYear(): number {
  return new Date().getFullYear()
}

// Driver Report Types
export interface DriverReportDay {
  ritnummer: string
  kenteken: string
  km: number
  uren: string
}

export interface DriverReportWeek {
  jaar: number
  weeknummer: number
  dagen: {
    ma: DriverReportDay[]
    di: DriverReportDay[]
    wo: DriverReportDay[]
    do: DriverReportDay[]
    vr: DriverReportDay[]
    za: DriverReportDay[]
    zo: DriverReportDay[]
  }
}

export interface DriverReport {
  driver_id: number
  driver_name: string
  weeks: DriverReportWeek[]
}

export interface DriverReportYearsResponse {
  years: number[]
}

/**
 * Get available years for driver report (admin only)
 * Returns max 5 years from current year going back
 */
export async function getDriverReportYears(driverId?: string): Promise<DriverReportYearsResponse> {
  let url = '/time-entries/driver_report_years/'
  if (driverId) {
    url += `?driver_id=${driverId}`
  }
  const response = await api.get(url)
  return response.data
}

/**
 * Get driver history report (admin only)
 * @param driverId - The driver ID
 * @param jaar - Optional year filter
 */
export async function getDriverReport(driverId: string, jaar?: number): Promise<DriverReport> {
  let url = `/time-entries/driver_report/?driver_id=${driverId}`
  if (jaar) {
    url += `&jaar=${jaar}`
  }
  const response = await api.get(url)
  return response.data
}

/**
 * Download driver history report as PDF (admin only)
 */
export async function downloadDriverReportPdf(driverId: string, driverName: string): Promise<void> {
  const response = await api.get(`/time-entries/driver_report_pdf/?driver_id=${driverId}`, {
    responseType: 'blob'
  })
  
  // Create download link
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `chauffeur_historie_${driverName.replace(/ /g, '_')}.pdf`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/**
 * Format duration string (e.g., "PT30M" or "00:30:00") to minutes
 */
export function parseDurationToMinutes(duration: string): number {
  if (!duration) return 0
  
  // Handle HH:MM:SS format
  if (duration.includes(':')) {
    const parts = duration.split(':')
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    return hours * 60 + minutes
  }
  
  // Handle ISO 8601 duration (PT30M, PT1H30M, etc.)
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (match) {
    const hours = parseInt(match[1]) || 0
    const minutes = parseInt(match[2]) || 0
    return hours * 60 + minutes
  }
  
  return 0
}

/**
 * Format minutes to HH:MM string
 */
export function formatMinutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`
}

// ============================================
// Weekly Hours Overview API
// ============================================

export interface WeeklyHoursOverview {
  user_id: string
  user_naam: string
  user_email: string
  user_bedrijf: string
  jaar: number
  periode: number
  week_start: number
  week_eind: number
  gewerkte_uren: number
  minimum_uren: number | null
  gemiste_uren: number | null
  totaal_km: number
  entries_count: number
  minimum_uren_per_week: number | null
  weken_met_uren: number
}

export interface MonthlyHoursOverview {
  user_id: string
  user_naam: string
  user_email: string
  user_bedrijf: string
  jaar: number
  maand: number
  maand_naam: string
  weken_in_maand: number
  gewerkte_uren: number
  minimum_uren: number | null
  gemiste_uren: number | null
  totaal_km: number
  entries_count: number
  minimum_uren_per_week: number | null
}

/**
 * Get weekly hours overview for all users (admin only)
 */
export async function getWeeklyHoursOverview(jaar?: number, userId?: string): Promise<WeeklyHoursOverview[]> {
  const params = new URLSearchParams()
  if (jaar) params.append('jaar', jaar.toString())
  if (userId) params.append('user', userId)
  
  const response = await api.get(`/time-entries/weekly_hours_overview/?${params.toString()}`)
  return response.data
}

/**
 * Get monthly hours overview for all users (admin only)
 */
export async function getMonthlyHoursOverview(jaar?: number, userId?: string): Promise<MonthlyHoursOverview[]> {
  const params = new URLSearchParams()
  if (jaar) params.append('jaar', jaar.toString())
  if (userId) params.append('user', userId)
  
  const response = await api.get(`/time-entries/monthly_hours_overview/?${params.toString()}`)
  return response.data
}

/**
 * Set minimum hours for a user for a specific week
 */
export async function setMinimumHours(data: {
  user_id: string
  jaar: number
  weeknummer: number
  minimum_uren: number
}): Promise<{ success: boolean; created: boolean }> {
  const response = await api.post('/time-entries/set_minimum_hours/', data)
  return response.data
}

/**
 * Set minimum hours for a user for ALL weeks in a year
 */
export async function setMinimumHoursBulk(data: {
  user_id: string
  jaar: number
  minimum_uren: number
}): Promise<{ success: boolean; created: number; updated: number; total_weeks: number }> {
  const response = await api.post('/time-entries/set_minimum_hours_bulk/', data)
  return response.data
}

/**
 * Add missed hours as invoice line item
 */
export async function addMissedHoursToInvoice(data: {
  user_id: string
  jaar: number
  periode: number
  invoice_id?: string
  bedrijf_id?: string
  prijs_per_uur: number
}): Promise<{
  success: boolean
  invoice_id: string
  factuurnummer: string
  line_id: string
  gemiste_uren: number
  omschrijving: string
  totaal: number
}> {
  const response = await api.post('/time-entries/add_missed_hours_to_invoice/', data)
  return response.data
}

/**
 * Add missed hours for a calendar month as invoice line item
 */
export async function addMissedHoursToInvoiceMonthly(data: {
  user_id: string
  jaar: number
  maand: number
  invoice_id?: string
  bedrijf_id?: string
  prijs_per_uur: number
}): Promise<{
  success: boolean
  invoice_id: string
  factuurnummer: string
  line_id: string
  gemiste_uren: number
  omschrijving: string
  totaal: number
}> {
  const response = await api.post('/time-entries/add_missed_hours_to_invoice_monthly/', data)
  return response.data
}
