/**
 * Planning API service
 * CRUD operations for week planning management
 */
import api from './client'
import { WeekPlanning, PlanningEntry, Company, Driver } from '@/types'

// Types
export interface WeekPlanningCreate {
  bedrijf: string
  weeknummer: number
  jaar: number
}

export interface PlanningEntryUpdate {
  chauffeur: string | null
}

export interface WeekPlanningsResponse {
  count: number
  next: string | null
  previous: string | null
  results: WeekPlanning[]
}

export interface WeekPlanningFilters {
  bedrijf?: string
  weeknummer?: number
  jaar?: number
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export interface WeekInfo {
  weeknummer: number
  jaar: number
}

// Week Planning API

/**
 * Get all week plannings with optional filters
 */
export async function getWeekPlannings(filters?: WeekPlanningFilters): Promise<WeekPlanningsResponse> {
  const params = new URLSearchParams()
  
  if (filters?.bedrijf) params.append('bedrijf', filters.bedrijf)
  if (filters?.weeknummer) params.append('weeknummer', filters.weeknummer.toString())
  if (filters?.jaar) params.append('jaar', filters.jaar.toString())
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/planning/weeks/?${params.toString()}`)
  return response.data
}

/**
 * Get a single week planning by ID
 */
export async function getWeekPlanning(id: string): Promise<WeekPlanning> {
  const response = await api.get(`/planning/weeks/${id}/`)
  return response.data
}

/**
 * Create a new week planning (auto-generates entries for all company vehicles)
 */
export async function createWeekPlanning(data: WeekPlanningCreate): Promise<WeekPlanning> {
  const response = await api.post('/planning/weeks/', data)
  return response.data
}

/**
 * Delete a week planning
 */
export async function deleteWeekPlanning(id: string): Promise<void> {
  await api.delete(`/planning/weeks/${id}/`)
}

/**
 * Get current week info
 */
export async function getCurrentWeek(): Promise<WeekInfo> {
  const response = await api.get('/planning/weeks/current_week/')
  return response.data
}

/**
 * Get next week info
 */
export async function getNextWeek(): Promise<WeekInfo> {
  const response = await api.get('/planning/weeks/next_week/')
  return response.data
}

/**
 * Copy planning to next week
 */
export async function copyToNextWeek(id: string): Promise<WeekPlanning> {
  const response = await api.post(`/planning/weeks/${id}/copy_to_next_week/`)
  return response.data
}

// Planning Entry API

/**
 * Update a planning entry (assign/unassign chauffeur)
 */
export async function updatePlanningEntry(id: string, data: PlanningEntryUpdate): Promise<PlanningEntry> {
  const response = await api.patch(`/planning/entries/${id}/`, data)
  return response.data
}

/**
 * Get entries for a specific planning
 */
export async function getPlanningEntries(planningId: string): Promise<PlanningEntry[]> {
  const response = await api.get(`/planning/entries/?planning=${planningId}`)
  return response.data.results || response.data
}

// Chauffeur-specific API

export interface MyPlanningEntry {
  id: string
  dag: string
  dag_naam: string
  dag_order: number
  kenteken: string
  voertuig_type: string
  bedrijf: string
  ritnummer: string
  weeknummer: number
  jaar: number
}

export interface MyPlanningResponse {
  weeknummer: number
  jaar: number
  chauffeur: string
  entries: MyPlanningEntry[]
  message?: string
}

/**
 * Get the logged-in chauffeur's planning for a specific week
 */
export async function getMyPlanning(weeknummer: number, jaar: number): Promise<MyPlanningResponse> {
  const response = await api.get(`/planning/weeks/my_planning/?weeknummer=${weeknummer}&jaar=${jaar}`)
  return response.data
}

/**
 * Send planning as PDF via email
 */
export async function sendPlanningEmail(id: string, email: string): Promise<{ message: string }> {
  const response = await api.post(`/planning/weeks/${id}/send_email/`, { email })
  return response.data
}

export interface PlanningDataResponse {
  companies: Company[]
  drivers: Driver[]
}

/**
 * Get companies and drivers for the planning admin view.
 * Uses dedicated endpoint that respects planning permissions.
 */
export async function getPlanningData(): Promise<PlanningDataResponse> {
  const response = await api.get('/planning/weeks/planning_data/')
  return response.data
}
