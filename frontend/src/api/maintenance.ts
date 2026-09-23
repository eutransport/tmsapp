/**
 * Maintenance API service
 * CRUD operations for fleet maintenance management
 */
import api from './client'
import {
  MaintenanceCategory,
  MaintenanceType,
  VehicleMaintenanceProfile,
  APKRecord,
  APKCountdown,
  ADRRecord,
  ADRSettings,
  FireExtinguisherRecord,
  FireExtinguisherSettings,
  MaintenanceTask,
  MaintenanceTaskList,
  MaintenancePart,
  TireRecord,
  MaintenanceThreshold,
  MaintenanceAlert,
  MaintenanceDashboard,
  DashboardWidget,
  MaintenanceQuery,
  MaintenanceStats,
  FleetHealth,
  VehicleCostSummary,
  ExpiringOverview,
  PaginatedResponse,
} from '@/types'

const BASE = '/maintenance'

// =============================================================================
// CATEGORIES
// =============================================================================

export async function getCategories(): Promise<MaintenanceCategory[]> {
  const response = await api.get(`${BASE}/categories/`)
  return response.data.results || response.data
}

export async function getCategory(id: string): Promise<MaintenanceCategory> {
  const response = await api.get(`${BASE}/categories/${id}/`)
  return response.data
}

export async function createCategory(data: Partial<MaintenanceCategory>): Promise<MaintenanceCategory> {
  const response = await api.post(`${BASE}/categories/`, data)
  return response.data
}

export async function updateCategory(id: string, data: Partial<MaintenanceCategory>): Promise<MaintenanceCategory> {
  const response = await api.patch(`${BASE}/categories/${id}/`, data)
  return response.data
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`${BASE}/categories/${id}/`)
}

// =============================================================================
// MAINTENANCE TYPES
// =============================================================================

export async function getMaintenanceTypes(filters?: { category?: string; vehicle_type?: string }): Promise<MaintenanceType[]> {
  const params = new URLSearchParams()
  if (filters?.category) params.append('category', filters.category)
  if (filters?.vehicle_type) params.append('vehicle_type', filters.vehicle_type)
  const response = await api.get(`${BASE}/types/?${params.toString()}`)
  return response.data.results || response.data
}

export async function getMaintenanceType(id: string): Promise<MaintenanceType> {
  const response = await api.get(`${BASE}/types/${id}/`)
  return response.data
}

export async function createMaintenanceType(data: Partial<MaintenanceType>): Promise<MaintenanceType> {
  const response = await api.post(`${BASE}/types/`, data)
  return response.data
}

export async function updateMaintenanceType(id: string, data: Partial<MaintenanceType>): Promise<MaintenanceType> {
  const response = await api.patch(`${BASE}/types/${id}/`, data)
  return response.data
}

export async function deleteMaintenanceType(id: string): Promise<void> {
  await api.delete(`${BASE}/types/${id}/`)
}

// =============================================================================
// MAINTENANCE PROFILES
// =============================================================================

export async function getProfiles(filters?: { vehicle?: string; page?: number; page_size?: number }): Promise<PaginatedResponse<VehicleMaintenanceProfile>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  const response = await api.get(`${BASE}/profiles/?${params.toString()}`)
  return response.data
}

export async function getProfilesByVehicle(vehicleId: string): Promise<VehicleMaintenanceProfile[]> {
  const response = await api.get(`${BASE}/profiles/by_vehicle/?vehicle_id=${vehicleId}`)
  return response.data
}

export async function getUpcomingProfiles(): Promise<VehicleMaintenanceProfile[]> {
  const response = await api.get(`${BASE}/profiles/upcoming/`)
  return response.data
}

export async function getOverdueProfiles(): Promise<VehicleMaintenanceProfile[]> {
  const response = await api.get(`${BASE}/profiles/overdue/`)
  return response.data
}

export async function markProfileCompleted(id: string, data: { performed_date: string; performed_km?: number }): Promise<VehicleMaintenanceProfile> {
  const response = await api.post(`${BASE}/profiles/${id}/mark_completed/`, data)
  return response.data
}

// =============================================================================
// APK RECORDS
// =============================================================================

export interface APKFilters {
  vehicle?: string
  status?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export async function getAPKRecords(filters?: APKFilters): Promise<PaginatedResponse<APKRecord>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.status) params.append('status', filters.status)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  const response = await api.get(`${BASE}/apk/?${params.toString()}`)
  return response.data
}

export async function getAPKRecord(id: string): Promise<APKRecord> {
  const response = await api.get(`${BASE}/apk/${id}/`)
  return response.data
}

export async function createAPKRecord(data: Partial<APKRecord>): Promise<APKRecord> {
  const response = await api.post(`${BASE}/apk/`, data)
  return response.data
}

export async function updateAPKRecord(id: string, data: Partial<APKRecord>): Promise<APKRecord> {
  const response = await api.patch(`${BASE}/apk/${id}/`, data)
  return response.data
}

export async function deleteAPKRecord(id: string): Promise<void> {
  await api.delete(`${BASE}/apk/${id}/`)
}

export async function getAPKCountdown(): Promise<APKCountdown[]> {
  const response = await api.get(`${BASE}/apk/countdown/`)
  return response.data
}

export async function getExpiringSoon(days?: number): Promise<APKCountdown[]> {
  const params = days ? `?days=${days}` : ''
  const response = await api.get(`${BASE}/apk/expiring_soon/${params}`)
  return response.data
}

export async function renewAPK(id: string, data: { inspection_date: string; expiry_date: string; cost?: string }): Promise<APKRecord> {
  const response = await api.post(`${BASE}/apk/${id}/renew/`, data)
  return response.data
}

export async function getAPKHistory(vehicleId: string): Promise<APKRecord[]> {
  const response = await api.get(`${BASE}/apk/history/?vehicle_id=${vehicleId}`)
  return response.data
}

// =============================================================================
// ADR
// =============================================================================

export interface ADRFilters {
  vehicle?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export type ADRPayload = {
  vehicle: string
  route?: string
  has_adr: boolean
  case_sealed: boolean
  inspection_date: string
  next_inspection_date: string
  notify_users?: string[]
  notify_extra_emails?: string[]
  remarks?: string
}

export async function getADRRecords(filters?: ADRFilters): Promise<PaginatedResponse<ADRRecord>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  const response = await api.get(`${BASE}/adr/?${params.toString()}`)
  return response.data
}

export async function createADRRecord(data: ADRPayload): Promise<ADRRecord> {
  const response = await api.post(`${BASE}/adr/`, data)
  return response.data
}

export async function updateADRRecord(id: string, data: Partial<ADRPayload>): Promise<ADRRecord> {
  const response = await api.patch(`${BASE}/adr/${id}/`, data)
  return response.data
}

export async function deleteADRRecord(id: string): Promise<void> {
  await api.delete(`${BASE}/adr/${id}/`)
}

export type ADRSettingsPayload = {
  email_profile: string | null
  send_hour: number
  send_minute: number
  default_notify_users: string[]
  default_notify_extra_emails: string[]
}

export async function getADRSettings(): Promise<ADRSettings> {
  const response = await api.get(`${BASE}/adr-settings/`)
  return response.data
}

export async function updateADRSettings(data: ADRSettingsPayload): Promise<ADRSettings> {
  const response = await api.put(`${BASE}/adr-settings/`, data)
  return response.data
}

// =============================================================================
// BRANDBLUSSERS
// =============================================================================

export interface BrandblusserFilters {
  vehicle?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export type BrandblusserPayload = {
  vehicle: string
  route?: string
  volgnummer?: number
  positie?: string
  serienummer?: string
  inspection_date: string
  next_inspection_date: string
  notify_users?: string[]
  notify_extra_emails?: string[]
  remarks?: string
}

/** Eén blusser binnen een bulk-aanmaak. */
export type BrandblusserItem = {
  inspection_date: string
  next_inspection_date: string
  positie?: string
  serienummer?: string
  remarks?: string
}

export type BrandblusserBulkPayload = {
  vehicle: string
  route?: string
  aantal: number
  blussers: BrandblusserItem[]
  notify_users?: string[]
  notify_extra_emails?: string[]
}

export async function getBrandblussers(
  filters?: BrandblusserFilters
): Promise<PaginatedResponse<FireExtinguisherRecord>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  const response = await api.get(`${BASE}/fire-extinguishers/?${params.toString()}`)
  return response.data
}

/** Meerdere blussers voor één wagen in één keer aanmaken. */
export async function createBrandblussersBulk(
  data: BrandblusserBulkPayload
): Promise<FireExtinguisherRecord[]> {
  const response = await api.post(`${BASE}/fire-extinguishers/bulk/`, data)
  return response.data
}

export async function updateBrandblusser(
  id: string,
  data: Partial<BrandblusserPayload>
): Promise<FireExtinguisherRecord> {
  const response = await api.patch(`${BASE}/fire-extinguishers/${id}/`, data)
  return response.data
}

export async function deleteBrandblusser(id: string): Promise<void> {
  await api.delete(`${BASE}/fire-extinguishers/${id}/`)
}

export type BrandblusserSettingsPayload = ADRSettingsPayload

export async function getBrandblusserSettings(): Promise<FireExtinguisherSettings> {
  const response = await api.get(`${BASE}/fire-extinguisher-settings/`)
  return response.data
}

export async function updateBrandblusserSettings(
  data: BrandblusserSettingsPayload
): Promise<FireExtinguisherSettings> {
  const response = await api.put(`${BASE}/fire-extinguisher-settings/`, data)
  return response.data
}

// =============================================================================
// VERLOOPOVERZICHT
// =============================================================================

/** APK, ADR en brandblussers die bijna verlopen of al verlopen zijn. */
export async function getExpiringOverview(days = 30): Promise<ExpiringOverview> {
  const response = await api.get(`${BASE}/expiring-overview/?days=${days}`)
  return response.data
}

// =============================================================================
// MAINTENANCE TASKS
// =============================================================================

export interface TaskFilters {
  vehicle?: string
  status?: string
  priority?: string
  maintenance_type?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export async function getTasks(filters?: TaskFilters): Promise<PaginatedResponse<MaintenanceTaskList>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.status) params.append('status', filters.status)
  if (filters?.priority) params.append('priority', filters.priority)
  if (filters?.maintenance_type) params.append('maintenance_type', filters.maintenance_type)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  const response = await api.get(`${BASE}/tasks/?${params.toString()}`)
  return response.data
}

export async function getTask(id: string): Promise<MaintenanceTask> {
  const response = await api.get(`${BASE}/tasks/${id}/`)
  return response.data
}

export async function createTask(data: Partial<MaintenanceTask>): Promise<MaintenanceTask> {
  const response = await api.post(`${BASE}/tasks/`, data)
  return response.data
}

export async function updateTask(id: string, data: Partial<MaintenanceTask>): Promise<MaintenanceTask> {
  const response = await api.patch(`${BASE}/tasks/${id}/`, data)
  return response.data
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`${BASE}/tasks/${id}/`)
}

export async function completeTask(id: string, data: { completed_date?: string; work_performed?: string; technician_notes?: string }): Promise<MaintenanceTask> {
  const response = await api.post(`${BASE}/tasks/${id}/complete/`, data)
  return response.data
}

export async function cancelTask(id: string): Promise<MaintenanceTask> {
  const response = await api.post(`${BASE}/tasks/${id}/cancel/`)
  return response.data
}

export async function getUpcomingTasks(days?: number): Promise<MaintenanceTaskList[]> {
  const params = days ? `?days=${days}` : ''
  const response = await api.get(`${BASE}/tasks/upcoming/${params}`)
  const data = response.data
  return Array.isArray(data) ? data : data.results || []
}

export async function getOverdueTasks(): Promise<MaintenanceTaskList[]> {
  const response = await api.get(`${BASE}/tasks/overdue/`)
  const data = response.data
  return Array.isArray(data) ? data : data.results || []
}

export async function getTasksByVehicle(vehicleId: string): Promise<MaintenanceTask[]> {
  const response = await api.get(`${BASE}/tasks/by_vehicle/?vehicle_id=${vehicleId}`)
  return response.data
}

// =============================================================================
// PARTS
// =============================================================================

export async function createPart(data: Partial<MaintenancePart>): Promise<MaintenancePart> {
  const response = await api.post(`${BASE}/parts/`, data)
  return response.data
}

export async function updatePart(id: string, data: Partial<MaintenancePart>): Promise<MaintenancePart> {
  const response = await api.patch(`${BASE}/parts/${id}/`, data)
  return response.data
}

export async function deletePart(id: string): Promise<void> {
  await api.delete(`${BASE}/parts/${id}/`)
}

// =============================================================================
// TIRES
// =============================================================================

export interface TireFilters {
  vehicle?: string
  is_current?: boolean
  search?: string
  page?: number
  page_size?: number
}

export async function getTires(filters?: TireFilters): Promise<PaginatedResponse<TireRecord>> {
  const params = new URLSearchParams()
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  if (filters?.is_current !== undefined) params.append('is_current', filters.is_current.toString())
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  const response = await api.get(`${BASE}/tires/?${params.toString()}`)
  return response.data
}

export async function getTiresByVehicle(vehicleId: string): Promise<TireRecord[]> {
  const response = await api.get(`${BASE}/tires/by_vehicle/?vehicle_id=${vehicleId}`)
  return response.data
}

export async function createTire(data: Partial<TireRecord>): Promise<TireRecord> {
  const response = await api.post(`${BASE}/tires/`, data)
  return response.data
}

export async function updateTire(id: string, data: Partial<TireRecord>): Promise<TireRecord> {
  const response = await api.patch(`${BASE}/tires/${id}/`, data)
  return response.data
}

export async function deleteTire(id: string): Promise<void> {
  await api.delete(`${BASE}/tires/${id}/`)
}

export async function replaceTire(id: string, data: { removed_date: string; removed_km?: number; removal_reason?: string }): Promise<TireRecord> {
  const response = await api.post(`${BASE}/tires/${id}/replace/`, data)
  return response.data
}

export async function extendTire(id: string, data: { new_date: string; reason?: string }): Promise<TireRecord> {
  const response = await api.post(`${BASE}/tires/${id}/extend/`, data)
  return response.data
}

// =============================================================================
// ALERTS
// =============================================================================

export async function getAlerts(filters?: { severity?: string; is_resolved?: boolean; page?: number }): Promise<PaginatedResponse<MaintenanceAlert>> {
  const params = new URLSearchParams()
  if (filters?.severity) params.append('severity', filters.severity)
  if (filters?.is_resolved !== undefined) params.append('is_resolved', filters.is_resolved.toString())
  if (filters?.page) params.append('page', filters.page.toString())
  const response = await api.get(`${BASE}/alerts/?${params.toString()}`)
  return response.data
}

export async function getActiveAlerts(): Promise<MaintenanceAlert[]> {
  const response = await api.get(`${BASE}/alerts/active/`)
  const data = response.data
  return Array.isArray(data) ? data : data.results || []
}

export async function getAlertCount(): Promise<{ active: number; warning: number; critical: number; urgent: number }> {
  const response = await api.get(`${BASE}/alerts/count/`)
  return response.data
}

export async function dismissAlert(id: string): Promise<void> {
  await api.post(`${BASE}/alerts/${id}/dismiss/`)
}

export async function resolveAlert(id: string): Promise<void> {
  await api.post(`${BASE}/alerts/${id}/resolve/`)
}

export async function dismissAllAlerts(): Promise<void> {
  await api.post(`${BASE}/alerts/dismiss_all/`)
}

// =============================================================================
// THRESHOLDS
// =============================================================================

export async function getThresholds(): Promise<MaintenanceThreshold[]> {
  const response = await api.get(`${BASE}/thresholds/`)
  return response.data.results || response.data
}

export async function updateThreshold(id: string, data: Partial<MaintenanceThreshold>): Promise<MaintenanceThreshold> {
  const response = await api.patch(`${BASE}/thresholds/${id}/`, data)
  return response.data
}

// =============================================================================
// DASHBOARD & WIDGETS
// =============================================================================

export async function getDashboards(): Promise<MaintenanceDashboard[]> {
  const response = await api.get(`${BASE}/dashboards/`)
  return response.data.results || response.data
}

export async function getDefaultDashboard(): Promise<MaintenanceDashboard> {
  const response = await api.get(`${BASE}/dashboards/default/`)
  return response.data
}

export async function updateDashboard(id: string, data: Partial<MaintenanceDashboard>): Promise<MaintenanceDashboard> {
  const response = await api.patch(`${BASE}/dashboards/${id}/`, data)
  return response.data
}

export async function createWidget(data: Partial<DashboardWidget>): Promise<DashboardWidget> {
  const response = await api.post(`${BASE}/widgets/`, data)
  return response.data
}

export async function updateWidget(id: string, data: Partial<DashboardWidget>): Promise<DashboardWidget> {
  const response = await api.patch(`${BASE}/widgets/${id}/`, data)
  return response.data
}

export async function deleteWidget(id: string): Promise<void> {
  await api.delete(`${BASE}/widgets/${id}/`)
}

export async function getWidgetTypes(): Promise<Array<{ value: string; label: string; description: string }>> {
  const response = await api.get(`${BASE}/widgets/types/`)
  return response.data
}

export async function getWidgetData(id: string): Promise<unknown> {
  const response = await api.get(`${BASE}/widgets/${id}/data/`)
  return response.data
}

// =============================================================================
// QUERIES
// =============================================================================

export async function getQueries(): Promise<MaintenanceQuery[]> {
  const response = await api.get(`${BASE}/queries/`)
  return response.data.results || response.data
}

export async function getSampleQueries(): Promise<MaintenanceQuery[]> {
  const response = await api.get(`${BASE}/queries/samples/`)
  return response.data
}

export async function executeQuery(id: string): Promise<unknown> {
  const response = await api.get(`${BASE}/queries/${id}/execute/`)
  return response.data
}

// =============================================================================
// STATS & REPORTS
// =============================================================================

export async function getMaintenanceStats(): Promise<MaintenanceStats> {
  const response = await api.get(`${BASE}/stats/`)
  return response.data
}

export async function getFleetHealth(): Promise<FleetHealth> {
  // This comes from the stats endpoint
  const response = await api.get(`${BASE}/stats/`)
  return response.data
}

export async function getVehicleCostReport(filters?: { year?: number; vehicle?: string }): Promise<VehicleCostSummary[]> {
  const params = new URLSearchParams()
  if (filters?.year) params.append('year', filters.year.toString())
  if (filters?.vehicle) params.append('vehicle', filters.vehicle)
  const response = await api.get(`${BASE}/cost-report/?${params.toString()}`)
  return response.data
}
