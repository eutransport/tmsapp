/**
 * Users API service
 * CRUD operations for user management
 */
import api from './client'
import { User, UserCreate } from '@/types'

export interface UserUpdate {
  email?: string
  username?: string
  voornaam?: string
  achternaam?: string
  telefoon?: string
  bedrijf?: string
  rol?: 'admin' | 'gebruiker' | 'chauffeur'
  is_active?: boolean
  module_permissions?: string[]
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
export async function toggleUserActive(id: string): Promise<{ message: string; is_active: boolean }> {
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
