/**
 * Radius Velocity (VelocityFleet) telematics API service
 */
import api from './client'

export interface RadiusConnectionResult {
  ok: boolean
  token_type: string
  is_distributor: boolean
  detail?: string
}

export interface RadiusCustomer {
  id: string
  name: string
  number: string
  country: string
  contact_name: string
  parent_name: string
  products: string[]
}

/** Eén tracker in een voertuig. */
export interface RadiusDevice {
  device_id: number
  service_id: string
  plate_number: string
  driver_name: string
  driver_id: string
  latitude: number | null
  longitude: number | null
  speed: number
  speed_unit: string
  heading: number
  ignition: boolean
  street: string
  town: string
  post_code: string
  country: string
  address: string
  /** Unix-tijd in seconden (UTC). */
  timestamp: number | null
  group_color: string
  is_private: boolean
}

/** Een voertuig met de meest recente positie van zijn trackers. */
export interface RadiusVehicle extends RadiusDevice {
  devices: RadiusDevice[]
  device_count: number
}

export interface RadiusVehiclesResponse {
  vehicles: RadiusVehicle[]
  count: number
  device_count: number | null
  /** Ververssnelheid in milliseconden zoals Radius die adviseert. */
  refresh_rate_ms: number | null
  customer: string
}

/** Controleert of het opgeslagen Radius API token geldig is. */
export async function testRadiusConnection(): Promise<RadiusConnectionResult> {
  const response = await api.post<RadiusConnectionResult>('/tracking/radius/test/')
  return response.data
}

/** Haalt de Radius-klanten op met een Telematics-abonnement. */
export async function getRadiusCustomers(): Promise<RadiusCustomer[]> {
  const response = await api.get<{ customers: RadiusCustomer[] }>('/tracking/radius/customers/')
  return response.data.customers
}

/** Haalt alle voertuigen met hun laatst bekende positie op. */
export async function getRadiusVehicles(customerId?: string): Promise<RadiusVehiclesResponse> {
  const response = await api.get<RadiusVehiclesResponse>('/tracking/radius/vehicles/', {
    params: customerId ? { customer: customerId } : undefined,
  })
  return response.data
}

/** Eén rit uit de Radius ritgeschiedenis. */
export interface RadiusJourney {
  service_id: string
  plate_number: string
  driver_name: string
  start_time: string
  end_time: string | null
  start_latitude: number | null
  start_longitude: number | null
  end_latitude: number | null
  end_longitude: number | null
  start_address: string
  start_city: string
  start_country: string
  end_address: string
  end_city: string
  end_country: string
  distance_km: number
  duration_seconds: number
}

export interface RadiusJourneysResponse {
  journeys: RadiusJourney[]
  count: number
  total_distance_km: number
  total_duration_seconds: number
  date_from: string
  date_to: string
  customer: string
}

/** Totalen per voertuig over een periode. */
export interface RadiusVehicleSummary {
  plate_number: string
  driver_name: string
  distance_km: number
  duration_seconds: number
  journey_count: number
  first_start: string | null
  last_end: string | null
}

export interface RadiusSummaryResponse {
  vehicles: RadiusVehicleSummary[]
  count: number
  total_distance_km: number
  total_duration_seconds: number
  journey_count: number
  date_from: string
  date_to: string
  customer: string
}

/** Eén dag van één voertuig uit het opgebouwde archief. */
export interface RadiusArchiveEntry {
  date: string
  plate_number: string
  driver_name: string
  first_start: string | null
  last_end: string | null
  distance_km: number
  duration_seconds: number
  journey_count: number
  journeys: RadiusJourney[]
}

export interface RadiusArchiveResponse {
  entries: RadiusArchiveEntry[]
  count: number
  total_distance_km: number
  total_duration_seconds: number
  journey_count: number
  date_from: string
  date_to: string
  plates: string[]
}

export interface RadiusSyncResult {
  customer: string
  date_from: string
  date_to: string
  journeys_fetched: number
  journeys_created: number
  journeys_updated: number
  vehicles: number
}

interface PeriodeParams {
  from: string
  to: string
}

/** Losse ritten rechtstreeks uit Radius (maximaal ~30 dagen historie). */
export async function getRadiusJourneys(params: PeriodeParams): Promise<RadiusJourneysResponse> {
  const response = await api.get<RadiusJourneysResponse>('/tracking/radius/journeys/', { params })
  return response.data
}

/** Totalen per voertuig, zoals het overzicht in het Radius-portaal. */
export async function getRadiusJourneySummary(params: PeriodeParams): Promise<RadiusSummaryResponse> {
  const response = await api.get<RadiusSummaryResponse>('/tracking/radius/journeys/summary/', { params })
  return response.data
}

/** Het eigen archief; gaat verder terug dan de 30 dagen van Radius. */
export async function getRadiusArchive(
  params: PeriodeParams & { plate?: string },
): Promise<RadiusArchiveResponse> {
  const response = await api.get<RadiusArchiveResponse>('/tracking/radius/archive/', { params })
  return response.data
}

/** Haalt het archief op als bestand en start de download. */
export async function downloadRadiusArchive(
  params: PeriodeParams & { plate?: string },
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<void> {
  const response = await api.get('/tracking/radius/archive/', {
    params: { ...params, format },
    responseType: 'blob',
  })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = `radius_archief_${params.from}_${params.to}.${format}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

/** Haalt de ritgeschiedenis nu op en werkt het archief bij. */
export async function syncRadiusArchive(days?: number): Promise<RadiusSyncResult> {
  const response = await api.post<RadiusSyncResult>('/tracking/radius/sync/', { days })
  return response.data
}
