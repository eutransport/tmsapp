import api from './client'
import type { AppSettings, AppSettingsAdmin } from '@/types'

export interface OnlineUser {
  id: string
  full_name: string
  email: string
  rol: string
  last_activity: string | null
}

export interface OnlineUsersResponse {
  online_users: OnlineUser[]
  online_count: number
}

export interface RecentLogin {
  id: string
  full_name: string
  email: string
  rol: string
  last_login: string | null
}

export interface RecentLoginsResponse {
  logins: RecentLogin[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages: number
    has_next: boolean
    has_previous: boolean
  }
}

export interface DashboardFinancial {
  income: number
  expenses: number
  profit: number
  collected: number
  outstanding: number
}

export interface DashboardStats {
  users: number
  companies: number
  vehicles: number
  hours_this_week: number
  open_invoices: number
  week_number: number
  year: number
  financial: DashboardFinancial
}

export interface ActivityItem {
  id?: string
  type: string
  action?: string
  action_display?: string
  icon?: string
  title: string
  description: string
  timestamp: string
  user: string | null
  user_name?: string
  link: string
  ip_address?: string | null
}

export interface RecentActivityResponse {
  activities: ActivityItem[]
  has_more?: boolean
}

export interface ActivityListResponse {
  activities: ActivityItem[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages: number
    has_next: boolean
    has_previous: boolean
  }
}

export const settingsApi = {
  // Public settings (no auth required)
  getPublic: async (): Promise<AppSettings> => {
    const response = await api.get('/core/settings/')
    return response.data
  },
  
  // Admin settings
  getAdmin: async (): Promise<AppSettingsAdmin> => {
    const response = await api.get('/core/admin/settings/')
    return response.data
  },
  
  update: async (data: Partial<AppSettingsAdmin>): Promise<AppSettingsAdmin> => {
    const response = await api.patch('/core/admin/settings/', data)
    return response.data
  },
  
  uploadLogo: async (file: File): Promise<AppSettingsAdmin> => {
    const formData = new FormData()
    formData.append('logo', file)
    const response = await api.post('/core/admin/settings/upload-logo/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  
  uploadFavicon: async (file: File): Promise<AppSettingsAdmin> => {
    const formData = new FormData()
    formData.append('favicon', file)
    const response = await api.post('/core/admin/settings/upload-favicon/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  
  deleteLogo: async (): Promise<AppSettingsAdmin> => {
    const response = await api.post('/core/admin/settings/delete-logo/')
    return response.data
  },
  
  deleteFavicon: async (): Promise<AppSettingsAdmin> => {
    const response = await api.post('/core/admin/settings/delete-favicon/')
    return response.data
  },
  
  testEmail: async (toEmail: string): Promise<{ message: string }> => {
    const response = await api.post('/core/admin/settings/test-email/', { to_email: toEmail })
    return response.data
  },
  
  // Dashboard stats
  getDashboardStats: async (): Promise<DashboardStats> => {
    const response = await api.get('/core/dashboard/stats/')
    return response.data
  },
  
  // Online users (polled every 2 minutes)
  getOnlineUsers: async (): Promise<OnlineUsersResponse> => {
    const response = await api.get('/core/dashboard/online-users/')
    return response.data
  },
  
  // Recent logins (paginated)
  getRecentLogins: async (page: number = 1, perPage: number = 10): Promise<RecentLoginsResponse> => {
    const response = await api.get(`/core/dashboard/recent-logins/?page=${page}&per_page=${perPage}`)
    return response.data
  },

  // Recent activity (dashboard - max 10)
  getRecentActivity: async (limit: number = 10): Promise<RecentActivityResponse> => {
    const response = await api.get(`/core/dashboard/activity/?limit=${limit}`)
    return response.data
  },
  
  // Full activity list (paginated)
  getActivities: async (page: number = 1, perPage: number = 25, type?: string, action?: string): Promise<ActivityListResponse> => {
    let url = `/core/activities/?page=${page}&per_page=${perPage}`
    if (type) url += `&type=${type}`
    if (action) url += `&action=${action}`
    const response = await api.get(url)
    return response.data
  },
  
  // Image upload
  uploadImage: async (file: File): Promise<{ url: string; filename: string; size: number }> => {
    const formData = new FormData()
    formData.append('image', file)
    const response = await api.post('/core/upload/image/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
}
