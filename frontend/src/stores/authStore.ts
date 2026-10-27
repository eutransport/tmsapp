import { create } from 'zustand'
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware'
import type { User } from '@/types'
import { authApi } from '@/api/auth'
import { vergeetMicrosoftSessie } from '@/utils/entra'

// Simple obfuscation for localStorage
// This adds a layer of protection against casual inspection
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

// Custom storage with obfuscation for auth tokens
const secureAuthStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const value = localStorage.getItem(name)
    if (!value) return null
    
    try {
      if (value.startsWith('__sec__:')) {
        return deobfuscate(value.slice(8))
      }
      return value
    } catch {
      return value
    }
  },
  setItem: (name: string, value: string): void => {
    localStorage.setItem(name, '__sec__:' + obfuscate(value))
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name)
  },
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  pendingMfaSetup: boolean  // User must complete MFA setup before full access
  
  // Actions
  setUser: (user: User | null) => void
  setTokens: (access: string, refresh: string) => void
  login: (email: string, password: string) => Promise<{ requires2FA: boolean; requires2FASetup: boolean; userId?: string }>
  loginMetMicrosoft: (idToken: string) => Promise<void>
  verify2FA: (userId: string, code: string) => Promise<void>
  completeMfaSetup: () => void
  logout: () => void
  fetchProfile: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      pendingMfaSetup: false,
      
      setUser: (user) => set({ user, isAuthenticated: !!user }),
      
      setTokens: (access, refresh) => set({ 
        accessToken: access, 
        refreshToken: refresh,
        isAuthenticated: true,
      }),
      
      login: async (email, password) => {
        const response = await authApi.login({ email, password })
        
        if (response.requires_2fa) {
          return { requires2FA: true, requires2FASetup: false, userId: response.user_id }
        }
        
        if (response.requires_2fa_setup) {
          // User must set up 2FA, give them temporary access but mark as pending
          set({
            user: response.user,
            accessToken: response.access,
            refreshToken: response.refresh,
            isAuthenticated: true,
            pendingMfaSetup: true,  // Block access until MFA is set up
            isLoading: false,
          })
          return { requires2FA: false, requires2FASetup: true, userId: response.user_id }
        }
        
        set({
          user: response.user,
          accessToken: response.access,
          refreshToken: response.refresh,
          isAuthenticated: true,
          pendingMfaSetup: false,
          isLoading: false,
        })
        
        return { requires2FA: false, requires2FASetup: false }
      },

      loginMetMicrosoft: async (idToken) => {
        // Microsoft heeft de identiteit al vastgesteld en regelt daar de
        // tweede factor. Hier komt dus geen 2FA-stap meer overheen.
        const response = await authApi.entraLogin(idToken)

        set({
          user: response.user,
          accessToken: response.access,
          refreshToken: response.refresh,
          isAuthenticated: true,
          pendingMfaSetup: false,
          isLoading: false,
        })
      },
      
      verify2FA: async (userId, code) => {
        const response = await authApi.verify2FA({ user_id: userId, code })
        
        set({
          user: response.user,
          accessToken: response.access,
          refreshToken: response.refresh,
          isAuthenticated: true,
          pendingMfaSetup: false,
          isLoading: false,
        })
      },
      
      completeMfaSetup: () => {
        set({ pendingMfaSetup: false })
      },
      
      logout: () => {
        const { refreshToken } = get()
        if (refreshToken) {
          authApi.logout(refreshToken).catch(() => {})
        }
        // Ook de Microsoft-kant opruimen, anders kan de applicatie de bewaarde
        // aanmelding meteen opnieuw gebruiken en lijkt uitloggen te mislukken.
        vergeetMicrosoftSessie()
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          pendingMfaSetup: false,
          isLoading: false,
        })
      },
      
      fetchProfile: async () => {
        try {
          set({ isLoading: true })
          const user = await authApi.getProfile()
          set({ user, isAuthenticated: true, isLoading: false })
        } catch {
          set({ 
            user: null, 
            accessToken: null, 
            refreshToken: null, 
            isAuthenticated: false, 
            isLoading: false 
          })
        }
      },
    }),
    {
      name: 'tms-auth',
      storage: createJSONStorage(() => secureAuthStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        // Use setTimeout to defer until store is initialized
        setTimeout(() => {
          if (state?.accessToken) {
            state.fetchProfile().catch(() => {
              // fetchProfile already sets isLoading to false on error
            })
          } else {
            useAuthStore.setState({ isLoading: false })
          }
        }, 0)
      },
    }
  )
)
