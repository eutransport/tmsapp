/**
 * Users API service
 * CRUD operations for user management
 */
import api from './client'
import { User, UserCreate, UserRole } from '@/types'

export interface UserUpdate {
  email?: string
  username?: string
  voornaam?: string
  achternaam?: string
  telefoon?: string
  bedrijf?: string
  rol?: UserRole
  opdrachtgever_bedrijf?: string | null
  is_active?: boolean
  module_permissions?: string[]
  wachtwoord_login_uitgeschakeld?: boolean
}

export interface AzureSyncResultaat {
  status: 'al_gekoppeld' | 'gekoppeld' | 'aangemaakt'
  inlognaam: string
  object_id: string
  /** Alleen bij `aangemaakt`, en maar één keer: dit wordt nergens bewaard. */
  wachtwoord?: string
}

export interface AzureOverzichtRegel {
  id: string
  naam: string
  email: string
  rol: string
  gekoppeld: boolean
  koppeling_opgeruimd?: boolean
  voorstel: string | null
  probleem?: string
}

export interface AzureSyncAllesResultaat {
  aangemaakt: string[]
  gekoppeld: string[]
  overgeslagen: string[]
  mislukt: { email: string; reden: string }[]
  /** Startwachtwoorden per e-mailadres; eenmalig tonen, niet opslaan. */
  wachtwoorden: Record<string, string>
}

export interface AvailablePermission {
  code: string
  label: string
}

export interface AvailablePermissionsResponse {
  permissions: AvailablePermission[]
  dependencies: Record<string, string[]>
}

export interface UsersResponse {
  count: number
  next: string | null
  previous: string | null
  results: User[]
}

export interface UserFilters {
  search?: string
  rol?: string
  is_active?: string
  page?: number
  page_size?: number
  ordering?: string
}

// Get all users with optional filters
export async function getUsers(filters?: UserFilters): Promise<UsersResponse> {
  const params = new URLSearchParams()
  
  if (filters?.search) params.append('search', filters.search)
  if (filters?.rol) params.append('rol', filters.rol)
  if (filters?.is_active !== undefined) params.append('is_active', filters.is_active)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/auth/users/?${params.toString()}`)
  return response.data
}

// Get single user by ID
export async function getUser(id: string): Promise<User> {
  const response = await api.get(`/auth/users/${id}/`)
  return response.data
}

// Create new user
export async function createUser(data: UserCreate): Promise<User> {
  const response = await api.post('/auth/users/', data)
  return response.data
}

// Update user
export async function updateUser(id: string, data: UserUpdate): Promise<User> {
  const response = await api.patch(`/auth/users/${id}/`, data)
  return response.data
}

// Delete user
export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/auth/users/${id}/`)
}

// Reset user password (admin)
export async function resetUserPassword(id: string, newPassword: string): Promise<{ message: string }> {
  const response = await api.post(`/auth/users/${id}/reset_password/`, {
    new_password: newPassword,
  })
  return response.data
}

// Toggle user active status (block/unblock)
export async function toggleUserActive(id: string): Promise<{ message: string; is_active: boolean; azure_waarschuwing?: string | null }> {
  const response = await api.post(`/auth/users/${id}/toggle_active/`)
  return response.data
}

// Disable 2FA for user (admin)
export async function disableUserMFA(id: string): Promise<{ message: string }> {
  const response = await api.post(`/auth/users/${id}/disable_mfa/`)
  return response.data
}

// Get available module permissions
export async function getAvailablePermissions(): Promise<AvailablePermissionsResponse> {
  const response = await api.get('/auth/users/available_permissions/')
  return response.data
}

// Update user module permissions
export async function updateUserPermissions(id: string, permissions: string[]): Promise<User> {
  const response = await api.patch(`/auth/users/${id}/`, { module_permissions: permissions })
  return response.data
}

// Maak of koppel het Microsoft-account van één gebruiker
export async function syncUserMetAzure(id: string, inlognaam?: string): Promise<AzureSyncResultaat> {
  const response = await api.post(
    `/auth/users/${id}/azure-sync/`,
    inlognaam ? { inlognaam } : {}
  )
  return response.data
}

// Verbreekt de koppeling met Azure (bijvoorbeeld als het Microsoft-account
// daar verwijderd is). In Azure wordt niets gewijzigd.
export async function ontkoppelUserVanAzure(id: string): Promise<{
  message: string
  wachtwoord_login_hersteld: boolean
}> {
  const response = await api.post(`/auth/users/${id}/azure-ontkoppel/`)
  return response.data
}

// Toont wat een synchronisatie zou doen, zonder iets aan te maken
export async function getAzureOverzicht(): Promise<{ gebruikers: AzureOverzichtRegel[] }> {
  const response = await api.get('/auth/users/azure-overzicht/')
  return response.data
}

// Maakt in één ronde de ontbrekende Microsoft-accounts aan
export async function syncAlleUsersMetAzure(): Promise<AzureSyncAllesResultaat> {
  const response = await api.post('/auth/users/azure-sync-alles/')
  return response.data
}
