import api from './client'
import type { 
  LoginCredentials, 
  LoginResponse, 
  MFAVerifyData, 
  User,
  UserCreate 
} from '@/types'

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await api.post('/auth/login/', credentials)
    return response.data
  },
  
  verify2FA: async (data: MFAVerifyData): Promise<LoginResponse> => {
    const response = await api.post('/auth/login/verify-2fa/', data)
    return response.data
  },

  entraConfig: async (): Promise<{
    enabled: boolean
    client_id?: string
    authority?: string
    tenant_name?: string
  }> => {
    const response = await api.get('/auth/entra/config/')
    return response.data
  },

  entraLogin: async (idToken: string): Promise<LoginResponse> => {
    const response = await api.post('/auth/entra/login/', { id_token: idToken })
    return response.data
  },
  
  logout: async (refreshToken: string): Promise<void> => {
    await api.post('/auth/logout/', { refresh: refreshToken })
  },
  
  refreshToken: async (refreshToken: string): Promise<{ access: string }> => {
    const response = await api.post('/auth/token/refresh/', { refresh: refreshToken })
    return response.data
  },
  
  getProfile: async (): Promise<User> => {
    const response = await api.get('/auth/profile/')
    return response.data
  },
  
  updateProfile: async (data: Partial<User>): Promise<User> => {
    const response = await api.patch('/auth/profile/', data)
    return response.data
  },
  
  changePassword: async (data: {
    old_password: string
    new_password: string
    new_password_confirm: string
  }): Promise<void> => {
    await api.post('/auth/profile/change-password/', data)
  },
  
  setup2FA: async (): Promise<{ secret: string; qr_code: string; uri: string }> => {
    const response = await api.get('/auth/profile/2fa/setup/')
    return response.data
  },
  
  enable2FA: async (code: string): Promise<void> => {
    await api.post('/auth/profile/2fa/setup/', { code })
  },
  
  disable2FA: async (data: { code: string; password: string }): Promise<void> => {
    await api.post('/auth/profile/2fa/disable/', data)
  },
}

export const usersApi = {
  getAll: async (params?: Record<string, string>): Promise<User[]> => {
    const response = await api.get('/auth/users/', { params })
    return response.data.results || response.data
  },
  
  getById: async (id: string): Promise<User> => {
    const response = await api.get(`/auth/users/${id}/`)
    return response.data
  },
  
  create: async (data: UserCreate): Promise<User> => {
    const response = await api.post('/auth/users/', data)
    return response.data
  },
  
  update: async (id: string, data: Partial<User>): Promise<User> => {
    const response = await api.patch(`/auth/users/${id}/`, data)
    return response.data
  },
  
  delete: async (id: string): Promise<void> => {
    await api.delete(`/auth/users/${id}/`)
  },
  
  resetPassword: async (id: string, newPassword: string): Promise<void> => {
    await api.post(`/auth/users/${id}/reset_password/`, { new_password: newPassword })
  },
  
  toggleActive: async (id: string): Promise<{ is_active: boolean }> => {
    const response = await api.post(`/auth/users/${id}/toggle_active/`)
    return response.data
  },
  
  disable2FA: async (id: string): Promise<void> => {
    await api.post(`/auth/users/${id}/disable_mfa/`)
  },
}
