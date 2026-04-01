/**
 * Fleet/Vehicles API service
 * CRUD operations for vehicle management
 */
import api from './client'
import { Vehicle } from '@/types'

export interface VehicleCreate {
  kenteken: string
  type_wagen?: string
  ritnummer?: string
  bedrijf: string
  minimum_weken_per_jaar?: number | null
  actief?: boolean
}

export interface VehicleUpdate extends Partial<VehicleCreate> {}

// Vehicle weeks overview
export interface VehicleWeeksOverview {
  vehicle_id: string
  kenteken: string
  type_wagen: string
  ritnummer: string
  bedrijf_naam: string
  minimum_weken: number
  minimum_dagen: number
  gewerkte_dagen: number
  gemiste_dagen: number
  gewerkte_weken_decimal: number
  percentage: number
}

export async function getVehicleWeeksOverview(jaar?: number): Promise<VehicleWeeksOverview[]> {
  const params = new URLSearchParams()
  if (jaar) params.append('jaar', jaar.toString())
  const response = await api.get(`/fleet/vehicle_weeks_overview/?${params.toString()}`)
  return response.data
}

export interface VehiclesResponse {
  count: number
  next: string | null
  previous: string | null
  results: Vehicle[]
}

export interface VehicleFilters {
  search?: string
  bedrijf?: string
  type_wagen?: string
  page?: number
  page_size?: number
  ordering?: string
}

// Get all vehicles with optional filters
export async function getVehicles(filters?: VehicleFilters): Promise<VehiclesResponse> {
  const params = new URLSearchParams()
  
  if (filters?.search) params.append('search', filters.search)
  if (filters?.bedrijf) params.append('bedrijf', filters.bedrijf)
  if (filters?.type_wagen) params.append('type_wagen', filters.type_wagen)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/fleet/?${params.toString()}`)
  return response.data
}

// Get all vehicles (without pagination, for dropdowns)
export async function getAllVehicles(): Promise<Vehicle[]> {
  const response = await api.get('/fleet/?page_size=1000')
  return response.data.results || response.data
}

// Get vehicles for dropdown (accessible by all authenticated users including chauffeurs)
export async function getVehiclesForDropdown(): Promise<Vehicle[]> {
  const response = await api.get('/fleet/dropdown/')
  return response.data
}

// Get single vehicle by ID
export async function getVehicle(id: string): Promise<Vehicle> {
  const response = await api.get(`/fleet/${id}/`)
  return response.data
}

// Create new vehicle
export async function createVehicle(data: VehicleCreate): Promise<Vehicle> {
  const response = await api.post('/fleet/', data)
  return response.data
}

// Update vehicle
export async function updateVehicle(id: string, data: VehicleUpdate): Promise<Vehicle> {
  const response = await api.patch(`/fleet/${id}/`, data)
  return response.data
}

// Delete vehicle
export async function deleteVehicle(id: string): Promise<void> {
  await api.delete(`/fleet/${id}/`)
}
