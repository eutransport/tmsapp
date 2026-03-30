/**
 * Drivers API service
 * CRUD operations for driver management
 */
import api from './client'
import { Driver } from '@/types'

export interface DriverCreate {
  naam: string
  telefoon?: string
  bedrijven?: string[]
  gekoppelde_gebruiker?: string | null
  voertuig?: string | null
  adr?: boolean
  einddatum_bestuurderspas?: string | null
  einddatum_code95?: string | null
  einddatum_adr?: string | null
  einddatum_rijbewijs?: string | null
  minimum_uren_per_week?: number | null
  actief?: boolean
}

export interface DriverUpdate extends Partial<DriverCreate> {}

export interface DriversResponse {
  count: number
  next: string | null
  previous: string | null
  results: Driver[]
}

export interface DriverFilters {
  search?: string
  bedrijven?: string
  adr?: string
  page?: number
  page_size?: number
  ordering?: string
}

// Get all drivers with optional filters
export async function getDrivers(filters?: DriverFilters): Promise<DriversResponse> {
  const params = new URLSearchParams()
  
  if (filters?.search) params.append('search', filters.search)
  if (filters?.bedrijven) params.append('bedrijven', filters.bedrijven)
  if (filters?.adr !== undefined) params.append('adr', filters.adr)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/drivers/?${params.toString()}`)
  return response.data
}

// Get all drivers (without pagination, for dropdowns)
export async function getAllDrivers(): Promise<Driver[]> {
  const response = await api.get('/drivers/?page_size=1000')
  return response.data.results || response.data
}

// Get single driver by ID
export async function getDriver(id: string): Promise<Driver> {
  const response = await api.get(`/drivers/${id}/`)
  return response.data
}

// Create new driver
export async function createDriver(data: DriverCreate): Promise<Driver> {
  const response = await api.post('/drivers/', data)
  return response.data
}

// Update driver
export async function updateDriver(id: string, data: DriverUpdate): Promise<Driver> {
  const response = await api.patch(`/drivers/${id}/`, data)
  return response.data
}

// Delete driver
export async function deleteDriver(id: string): Promise<void> {
  await api.delete(`/drivers/${id}/`)
}
