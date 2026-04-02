/**
 * Leave Management API
 * Handles vacation, overtime, and special leave requests
 */
import api from './client'

// Types
export interface GlobalLeaveSettings {
  id: string
  default_leave_hours: string
  default_vacation_hours: number  // Alias for default_leave_hours (as number)
  standard_work_week_hours: string
  work_week_hours: number  // Alias for standard_work_week_hours (as number)
  overtime_leave_percentage: number
  max_concurrent_leave: number
  free_special_leave_hours_per_month: string
  free_special_leave_hours: number  // Alias for free_special_leave_hours_per_month (as number)
  updated_at: string
}

export interface LeaveBalance {
  id: string
  user: string
  user_naam: string
  user_email: string
  vacation_hours: number
  overtime_hours: number
  available_overtime_for_leave: number
  special_leave_used: Record<string, number>
  updated_at: string
}

export type LeaveType = 'vakantie' | 'overuren' | 'bijzonder_tandarts' | 'bijzonder_huisarts' | 'ziekteverzuim'
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveRequest {
  id: string
  user: string
  user_naam: string
  leave_type: LeaveType
  leave_type_display: string
  start_date: string
  end_date: string
  hours_requested: string
  hours: string  // Alias for hours_requested for convenience
  reason: string
  notes: string  // Alias for reason for convenience
  status: LeaveRequestStatus
  status_display: string
  admin_comment: string
  reviewed_by: string | null
  reviewed_by_naam: string | null
  reviewed_at: string | null
  deductions: {
    vacation_deduct: string
    overtime_deduct: string
    special_free: string
  } | null
  created_at: string
  updated_at: string
}

export interface LeaveRequestCreate {
  leave_type: LeaveType
  start_date: string
  end_date: string
  hours_requested: number
  reason?: string
}

export interface CalendarLeaveEntry {
  id: string
  user_id: string
  user_naam: string
  leave_type: LeaveType
  leave_type_display: string
  start_date: string
  end_date: string
  hours: string
  status: LeaveRequestStatus
}

export interface ConcurrentLeaveCheck {
  start_date: string
  end_date: string
  concurrent_count: number
  max_concurrent: number
  warning: boolean
  employees_on_leave: string[]
}

// Leave type options for dropdowns
export const LEAVE_TYPE_OPTIONS = [
  { value: 'vakantie', label: 'Vakantie' },
  { value: 'overuren', label: 'Verlof overuren' },
  { value: 'bijzonder_tandarts', label: 'Bijzonder verlof tandarts' },
  { value: 'bijzonder_huisarts', label: 'Bijzonder verlof huisarts' },
  { value: 'ziekteverzuim', label: 'Ziekteverzuim' },
] as const

// ===== Global Settings =====

export async function getGlobalLeaveSettings(): Promise<GlobalLeaveSettings> {
  const response = await api.get('/leave/settings/')
  return response.data
}

// Alias for components that use different name
export const getGlobalSettings = getGlobalLeaveSettings

export async function updateGlobalLeaveSettings(
  data: Partial<GlobalLeaveSettings>
): Promise<GlobalLeaveSettings> {
  const response = await api.patch('/leave/settings/update_settings/', data)
  return response.data
}

// Alias with ID parameter for components that use different signature
export async function updateGlobalSettings(
  _id: string,
  data: Partial<GlobalLeaveSettings>
): Promise<GlobalLeaveSettings> {
  const response = await api.patch('/leave/settings/update_settings/', data)
  return response.data
}

// ===== Leave Balances =====

export async function getAllLeaveBalances(): Promise<LeaveBalance[]> {
  const response = await api.get('/leave/balances/')
  return response.data
}

// Alias for components that use different name
export const getAllBalances = getAllLeaveBalances

export async function getMyLeaveBalance(): Promise<LeaveBalance> {
  const response = await api.get('/leave/balances/my_balance/')
  return response.data
}

export async function updateLeaveBalance(
  id: string,
  data: { vacation_hours: number; overtime_hours?: number }
): Promise<LeaveBalance> {
  const response = await api.patch(`/leave/balances/${id}/`, data)
  return response.data
}

// ===== Leave Requests =====

export async function getMyLeaveRequests(): Promise<LeaveRequest[]> {
  const response = await api.get('/leave/requests/my_requests/')
  const data = response.data
  return Array.isArray(data) ? data : (data.results || [])
}

export async function getAllLeaveRequests(filters?: {
  status?: LeaveRequestStatus
  user?: string
}): Promise<LeaveRequest[]> {
  const params = new URLSearchParams()
  if (filters?.status) params.append('status', filters.status)
  if (filters?.user) params.append('user', filters.user)
  
  const response = await api.get(`/leave/requests/?${params.toString()}`)
  // Handle both paginated and non-paginated responses
  const data = response.data
  return Array.isArray(data) ? data : (data.results || [])
}

export async function getPendingLeaveRequests(): Promise<LeaveRequest[]> {
  const response = await api.get('/leave/requests/pending/')
  const data = response.data
  return Array.isArray(data) ? data : (data.results || [])
}

export async function createLeaveRequest(data: LeaveRequestCreate): Promise<LeaveRequest> {
  const response = await api.post('/leave/requests/', data)
  return response.data
}

export interface AdminLeaveRequestCreate {
  user_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  hours_requested: number
  reason?: string
  auto_approve?: boolean
}

export async function adminCreateLeaveRequest(data: AdminLeaveRequestCreate): Promise<LeaveRequest> {
  const response = await api.post('/leave/requests/admin_create/', data)
  return response.data
}

export async function adminUpdateLeaveRequest(
  id: string,
  data: Partial<LeaveRequestCreate>
): Promise<LeaveRequest> {
  const response = await api.patch(`/leave/requests/${id}/`, data)
  return response.data
}

export async function adminActionLeaveRequest(
  id: string,
  action: 'approve' | 'reject' | 'delete',
  admin_comment?: string
): Promise<{ message: string; deductions?: Record<string, string> }> {
  const response = await api.post(`/leave/requests/${id}/admin_action/`, {
    action,
    admin_comment: admin_comment || '',
  })
  return response.data
}

// Alias for components that use different name
export const adminLeaveAction = adminActionLeaveRequest

// ===== Calendar =====

export async function getLeaveCalendar(
  startDate?: string,
  endDate?: string
): Promise<CalendarLeaveEntry[]> {
  const params = new URLSearchParams()
  if (startDate) params.append('start_date', startDate)
  if (endDate) params.append('end_date', endDate)
  
  const response = await api.get(`/leave/requests/calendar/?${params.toString()}`)
  return response.data
}

export async function checkConcurrentLeave(
  startDate: string,
  endDate: string
): Promise<ConcurrentLeaveCheck> {
  const params = new URLSearchParams()
  params.append('start_date', startDate)
  params.append('end_date', endDate)
  
  const response = await api.get(`/leave/requests/check_concurrent/?${params.toString()}`)
  return response.data
}

// ===== Public Holidays =====

export interface PublicHoliday {
  id: string
  date: string
  name: string
  year: number
}

export async function getPublicHolidays(year?: number): Promise<PublicHoliday[]> {
  const params = new URLSearchParams()
  if (year) params.append('year', year.toString())
  const response = await api.get(`/leave/holidays/?${params.toString()}`)
  return response.data
}
