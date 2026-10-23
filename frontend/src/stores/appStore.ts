import { create } from 'zustand'
import type { AppSettings } from '@/types'
import { settingsApi } from '@/api/settings'

interface AppState {
  settings: AppSettings | null
  isLoading: boolean
  sidebarOpen: boolean
  
  // Actions
  fetchSettings: () => Promise<void>
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

const defaultSettings: AppSettings = {
  app_name: 'TMS',
  logo_url: null,
  favicon_url: null,
  primary_color: '#3B82F6',
  login_background_color: '#F9FAFB',
  company_name: '',
}

export const useAppStore = create<AppState>((set) => ({
  settings: defaultSettings,
  isLoading: true,
  // Het mobiele menu is een overlay; bij het openen van de app hoort de pagina zelf zichtbaar te zijn.
  sidebarOpen: false,
  
  fetchSettings: async () => {
    try {
      const settings = await settingsApi.getPublic()
      set({ settings, isLoading: false })
      
      // Update document title
      document.title = settings.app_name || 'TMS'
      
      // Update favicon if available
      if (settings.favicon_url) {
        const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement
        if (link) {
          link.href = settings.favicon_url
        }
      }
    } catch {
      set({ settings: defaultSettings, isLoading: false })
    }
  },
  
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
