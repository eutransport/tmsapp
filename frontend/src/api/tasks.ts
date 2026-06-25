/**
 * Tasks (Takenlijst) API service
 */
import api from './client'

export type TaskStatus = 'nieuw' | 'in_behandeling' | 'afgerond'
export type TaskPriority = 'laag' | 'normaal' | 'hoog'

export interface TaskUser {
  id: string
  full_name: string
  email: string
}

export interface TaskNote {
  id: string
  auteur: TaskUser | null
  tekst: string
  created_at: string
}

export interface TaskActivity {
  id: string
  user: TaskUser | null
  actie: string
  created_at: string
}

export interface Task {
  id: string
  titel: string
  omschrijving: string
  status: TaskStatus
  prioriteit: TaskPriority
  aangemaakt_door: TaskUser | null
  toegewezen_aan: TaskUser | null
  vervaldatum: string | null
  status_changed_at: string | null
  last_activity_at: string | null
  afgerond_op: string | null
  notes: TaskNote[]
  notes_count: number
  created_at: string
  updated_at: string
}

export interface TaskListItem {
  id: string
  titel: string
  status: TaskStatus
  prioriteit: TaskPriority
  aangemaakt_door: TaskUser | null
  toegewezen_aan: TaskUser | null
  vervaldatum: string | null
  notes_count: number
  last_activity_at: string | null
  created_at: string
}

export interface TasksResponse {
  count: number
  next: string | null
  previous: string | null
  results: TaskListItem[]
}

export type TaskTab = 'mine' | 'assigned_by_me' | 'all'

export interface TaskFilters {
  tab?: TaskTab
  status?: TaskStatus | ''
  search?: string
  page?: number
  page_size?: number
}

export interface TaskCreate {
  titel: string
  omschrijving?: string
  prioriteit?: TaskPriority
  toegewezen_aan_id?: string | null
  vervaldatum?: string | null
}

export interface TaskUpdate {
  titel?: string
  omschrijving?: string
  prioriteit?: TaskPriority
  vervaldatum?: string | null
}

export interface ReminderSettings {
  daily_reminder_enabled: boolean
  daily_reminder_hour: number
  daily_reminder_minute: number
  daily_reminder_weekdays: number[]
  stale_reminder_enabled: boolean
  stale_after_days: number
}

// List tasks
export async function getTasks(filters?: TaskFilters): Promise<TasksResponse> {
  const params = new URLSearchParams()
  if (filters?.tab) params.append('tab', filters.tab)
  if (filters?.status) params.append('status', filters.status)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  const response = await api.get(`/tasks/tasks/?${params.toString()}`)
  return response.data
}

// Single task with notes
export async function getTask(id: string): Promise<Task> {
  const response = await api.get(`/tasks/tasks/${id}/`)
  return response.data
}

export async function createTask(data: TaskCreate): Promise<Task> {
  const response = await api.post('/tasks/tasks/', data)
  return response.data
}

export async function updateTask(id: string, data: TaskUpdate): Promise<Task> {
  const response = await api.patch(`/tasks/tasks/${id}/`, data)
  return response.data
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`/tasks/tasks/${id}/`)
}

export async function changeTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const response = await api.post(`/tasks/tasks/${id}/change_status/`, { status })
  return response.data
}

export async function reassignTask(id: string, userId: string): Promise<Task> {
  const response = await api.post(`/tasks/tasks/${id}/reassign/`, { toegewezen_aan_id: userId })
  return response.data
}

export async function addTaskNote(id: string, tekst: string): Promise<TaskNote> {
  const response = await api.post(`/tasks/tasks/${id}/add_note/`, { tekst })
  return response.data
}

export async function sendTaskReminder(id: string): Promise<{ sent: unknown }> {
  const response = await api.post(`/tasks/tasks/${id}/send_reminder/`)
  return response.data
}

export interface ActiveCount {
  open: number
  nieuw: number
}

export async function getActiveTaskCount(): Promise<ActiveCount> {
  const response = await api.get('/tasks/tasks/active_count/')
  return response.data
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const response = await api.get('/tasks/tasks/reminder-settings/')
  return response.data
}

export async function updateReminderSettings(data: ReminderSettings): Promise<ReminderSettings> {
  const response = await api.put('/tasks/tasks/reminder-settings/', data)
  return response.data
}
