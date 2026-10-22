import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { useServerConfigStore } from '@/stores/serverConfigStore'

// Security: Validate that the base URL is safe
const isValidBaseUrl = (url: string): boolean => {
  if (url === '/api') return true // Relative URL is always safe
  
  try {
    const parsed = new URL(url)
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }
    // Block javascript: and data: protocols
    if (url.toLowerCase().startsWith('javascript:') || url.toLowerCase().startsWith('data:')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

// Function to get the current base URL
const getBaseUrl = (): string => {
  const serverConfig = useServerConfigStore.getState()
  
  // If server is configured, use the getApiUrl method
  if (serverConfig.isConfigured) {
    const apiUrl = serverConfig.getApiUrl()
    // Security check
    if (isValidBaseUrl(apiUrl)) {
      return apiUrl
    }
    console.error('Invalid API URL detected, falling back to /api')
  }
  
  // Development: direct backend URL to bypass Service Worker issues
  if (import.meta.env.DEV) {
    return 'http://localhost:8001/api'
  }
  
  // Production: uses relative URL
  return '/api'
}

const api = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  // Security: Set reasonable timeouts
  timeout: 30000, // 30 seconds
})

// Subscribe to server config changes and update baseURL
useServerConfigStore.subscribe((state) => {
  if (state.isConfigured) {
    const apiUrl = useServerConfigStore.getState().getApiUrl()
    // Security check before updating
    if (isValidBaseUrl(apiUrl)) {
      api.defaults.baseURL = apiUrl
    }
  } else {
    api.defaults.baseURL = '/api'
  }
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // Axios mag de boundary zelf zetten; anders komt het bestand niet aan.
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      delete config.headers['Content-Type']
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    
    // If 401 and not already retrying, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      
      const refreshToken = useAuthStore.getState().refreshToken
      
      if (refreshToken) {
        try {
          // Use the current baseURL for refresh
          const baseUrl = api.defaults.baseURL || '/api'
          const response = await axios.post(`${baseUrl}/auth/token/refresh/`, {
            refresh: refreshToken,
          })
          
          const { access } = response.data
          useAuthStore.getState().setTokens(access, refreshToken)
          
          originalRequest.headers.Authorization = `Bearer ${access}`
          return api(originalRequest)
        } catch (refreshError) {
          // Refresh failed, logout user
          useAuthStore.getState().logout()
          window.location.href = '/login'
          return Promise.reject(refreshError)
        }
      }
    }
    
    return Promise.reject(error)
  }
)

export default api
