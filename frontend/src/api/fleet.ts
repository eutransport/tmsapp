/**
 * Fleet/Vehicles API service
 * CRUD operations for vehicle management
 */
import api from './client'
import { Vehicle, RdwAs } from '@/types'

/** Wat het RDW over een kenteken weet. Alle velden kunnen ontbreken. */
export interface RdwGegevens {
  gevonden: boolean
  kenteken: string
  detail?: string
  rdw_merk?: string
  rdw_handelsbenaming?: string
  rdw_voertuigsoort?: string
  rdw_inrichting?: string
  rdw_voertuigcategorie?: string
  rdw_voertuigcategorie_omschrijving?: string
  rdw_carrosserie?: string
  rdw_datum_eerste_toelating?: string | null
  rdw_bouwjaar?: number | null
  rdw_apk_vervaldatum?: string | null
  rdw_tachograaf_vervaldatum?: string | null
  rdw_massa_ledig?: number | null
  rdw_massa_rijklaar?: number | null
  rdw_max_massa?: number | null
  rdw_technisch_max_massa?: number | null
  rdw_max_massa_samenstelling?: number | null
  rdw_laadvermogen?: number | null
  rdw_lengte_cm?: number | null
  rdw_breedte_cm?: number | null
  rdw_wielbasis_cm?: number | null
  rdw_brandstof?: string
  rdw_emissieklasse?: string
  rdw_euronorm?: string
  rdw_co2_klasse?: string
  rdw_co2_klasse_omschrijving?: string
  rdw_vermogen_kw?: string | null
  rdw_geluidsniveau?: number | null
  rdw_cilinderinhoud?: number | null
  rdw_aantal_assen?: number | null
  rdw_aantal_wielen?: number | null
  rdw_max_aslast?: number | null
  rdw_assen?: RdwAs[]
  rdw_aantal_zitplaatsen?: number | null
  rdw_max_snelheid?: number | null
  rdw_wam_verzekerd?: boolean | null
  rdw_terugroepactie_open?: boolean | null
  rdw_export?: boolean | null
}

/** Uitkomst van het bijwerken van een enkele wagen. */
export interface RdwVerversResultaat {
  gevonden: boolean
  melding: string
  apk_vastgelegd: boolean
  voertuig: Vehicle
}

/** Uitkomst van het bijwerken van meerdere wagens. */
export interface RdwBulkResultaat {
  bijgewerkt: number
  niet_gevonden: number
  mislukt: number
  apk_records: number
  afgebroken: boolean
  melding?: string
  regels: { kenteken: string; uitkomst: string; melding: string }[]
}

/**
 * Zoek een kenteken op bij de RDW zonder het op te slaan.
 * Gebruikt bij het invoeren van een nieuwe wagen.
 */
export async function zoekKentekenOp(kenteken: string): Promise<RdwGegevens> {
  const response = await api.get('/fleet/rdw-opzoeken/', { params: { kenteken } })
  return response.data
}

/** Werk een wagen bij met de gegevens van de RDW. */
export async function verversRdw(vehicleId: string): Promise<RdwVerversResultaat> {
  const response = await api.post(`/fleet/${vehicleId}/rdw-verversen/`)
  return response.data
}

/**
 * Werk meerdere wagens bij.
 * Zonder `alles` alleen de wagens die nog geen RDW-gegevens hebben.
 */
export async function verversRdwAlles(alles = false): Promise<RdwBulkResultaat> {
  const response = await api.post('/fleet/rdw-verversen-alles/', { alles })
  return response.data
}

export interface VehicleCreate {
  kenteken: string
  type_wagen?: string
  ritnummer?: string
  bedrijf: string
  minimum_weken_per_jaar?: number | null
  actief?: boolean
  /** Zet de bestaande actieve regel met hetzelfde kenteken op inactief. */
  vervang_actief?: boolean
}

export interface VehicleUpdate extends Partial<VehicleCreate> {
  /** Laat het nieuwe ritnummer pas vanaf deze datum gelden (jjjj-mm-dd). */
  ritnummer_vanaf?: string | null
  /** Laat het nieuwe bedrijf pas vanaf deze datum gelden (jjjj-mm-dd). */
  bedrijf_vanaf?: string | null
}

/** Een ritnummer van een wagen met de datum vanaf wanneer het geldt. */
export interface VehicleRitnummerPeriode {
  id: string
  vehicle: string
  ritnummer: string
  /** null betekent: vanaf het begin. */
  geldig_vanaf: string | null
  /** Bijvoorbeeld 'week 37 (2026)'; leeg bij een periode zonder datum. */
  weeknummer: string
  notitie: string
  /** Geldt deze periode vandaag? */
  is_huidig: boolean
  created_at: string
  updated_at: string
}

export interface VehicleRitnummerPeriodeInput {
  vehicle: string
  ritnummer: string
  geldig_vanaf: string | null
  notitie?: string
}

/** Meegestuurd bij een 400 als het kenteken al actief in de vloot staat. */
export interface KentekenConflict {
  id: string
  kenteken: string
  ritnummer: string
  type_wagen: string
  bedrijf_naam: string
}

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

// Vehicle averages (km/uren) per kenteken
export interface VehicleWeekAverage {
  year: number
  week: number
  total_km: number
  total_hours: number
  days_worked: number
  avg_km_per_day: number
  avg_hours_per_day: number
}

export interface VehicleMonthAverage {
  year: number
  month: number
  total_km: number
  total_hours: number
  days_worked: number
  avg_km_per_day: number
  avg_hours_per_day: number
}

export interface VehicleAverages {
  kenteken: string
  type_wagen: string
  ritnummer: string
  bedrijf_naam: string
  jaar: number
  totals: {
    total_km: number
    total_hours: number
    days_worked: number
    weeks_worked: number
    months_worked: number
  }
  averages: {
    avg_km_per_day: number
    avg_hours_per_day: number
    avg_km_per_week: number
    avg_hours_per_week: number
    avg_km_per_month: number
    avg_hours_per_month: number
  }
  weekly: VehicleWeekAverage[]
  monthly: VehicleMonthAverage[]
}

export async function getVehicleAverages(jaar?: number): Promise<VehicleAverages[]> {
  const params = new URLSearchParams()
  if (jaar) params.append('jaar', jaar.toString())
  const response = await api.get(`/fleet/vehicle_averages/?${params.toString()}`)
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

// === Ritnummerperiodes: welk ritnummer had een wagen wanneer? ===

export async function getRitnummerPeriodes(vehicleId: string): Promise<VehicleRitnummerPeriode[]> {
  const response = await api.get('/fleet/ritnummer-periodes/', { params: { vehicle: vehicleId } })
  return response.data.results || response.data
}

export async function createRitnummerPeriode(
  data: VehicleRitnummerPeriodeInput,
): Promise<VehicleRitnummerPeriode> {
  const response = await api.post('/fleet/ritnummer-periodes/', data)
  return response.data
}

export async function updateRitnummerPeriode(
  id: string, data: Partial<VehicleRitnummerPeriodeInput>,
): Promise<VehicleRitnummerPeriode> {
  const response = await api.patch(`/fleet/ritnummer-periodes/${id}/`, data)
  return response.data
}

export async function deleteRitnummerPeriode(id: string): Promise<void> {
  await api.delete(`/fleet/ritnummer-periodes/${id}/`)
}
