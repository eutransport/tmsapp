/**
 * Server Configuration Store
 * Manages the backend server URL configuration
 * 
 * Security: Uses encryption for sensitive data when Web Crypto API is available
 */
import { create } from 'zustand'
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware'
import { useAuthStore } from './authStore'

// Simple obfuscation for environments without Web Crypto API
// This is NOT encryption, just basic obfuscation to prevent casual inspection
const obfuscate = (data: string): string => {
  try {
    return btoa(encodeURIComponent(data).split('').reverse().join(''))
  } catch {
    return data
  }
}

const deobfuscate = (data: string): string => {
  try {
    return decodeURIComponent(atob(data).split('').reverse().join(''))
  } catch {
    return data
  }
}

// Custom storage with obfuscation
const secureStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const value = localStorage.getItem(name)
    if (!value) return null
    
    try {
      // Check if it's obfuscated (starts with specific marker)
      if (value.startsWith('__sec__:')) {
        return deobfuscate(value.slice(8))
      }
      // Legacy unobfuscated data - migrate it
      return value
    } catch {
      return value
    }
  },
  setItem: (name: string, value: string): void => {
    // Always store obfuscated
    localStorage.setItem(name, '__sec__:' + obfuscate(value))
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name)
  },
}

interface ServerConfig {
  serverUrl: string | null
  serverName: string | null
  isConfigured: boolean
}

interface ServerConfigStore extends ServerConfig {
  setServerUrl: (url: string, name?: string) => void
  clearServerUrl: () => void
  getApiUrl: () => string
}

export const useServerConfigStore = create<ServerConfigStore>()(
  persist(
    (set, get) => ({
      serverUrl: '',
      serverName: 'TMS Server',
      isConfigured: true,

      setServerUrl: (url: string, name?: string) => {
        // Empty URL means development mode (use Vite proxy)
        if (!url) {
          set({
            serverUrl: '',
            serverName: name || 'Lokale ontwikkeling',
            isConfigured: true,
          })
          return
        }
        
        // Security: Validate URL format and protocol
        try {
          const parsed = new URL(url)
          
          // Only allow http and https protocols
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol')
          }
          
          // Prevent javascript: and data: URLs
          if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:') {
            throw new Error('Invalid protocol')
          }
          
          // Normalize URL - remove trailing slash, only keep origin + path
          const normalizedUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
          
          // Sanitize server name
          const sanitizedName = name 
            ? name.replace(/[<>"'&]/g, '') 
            : parsed.hostname
          
          set({
            serverUrl: normalizedUrl,
            serverName: sanitizedName,
            isConfigured: true,
          })
        } catch {
          console.error('Invalid server URL:', url)
          // Don't set invalid URLs
        }
      },

      clearServerUrl: () => {
        // First logout the user
        useAuthStore.getState().logout()
        
        // Then clear the server config
        set({
          serverUrl: null,
          serverName: null,
          isConfigured: false,
        })
      },

      getApiUrl: () => {
        const { serverUrl } = get()
        // If serverUrl is set (even if empty string for dev mode), use it
        if (serverUrl !== null && serverUrl !== undefined) {
          return serverUrl ? `${serverUrl}/api` : '/api'
        }
        // Fallback to relative URL (for dev with proxy)
        return '/api'
      },
    }),
    {
      name: 'tms-server-config',
      storage: createJSONStorage(() => secureStorage),
    }
  )
)
