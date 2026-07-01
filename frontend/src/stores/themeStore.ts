import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Theme {
  id: string
  nameKey: string
  colors: {
    primary: string
    primaryHover: string
    primaryLight: string
    background: string
    backgroundSecondary: string
    sidebar: string
    sidebarText: string
    sidebarHover: string
    card: string
    cardBorder: string
    text: string
    textSecondary: string
    accent: string
  }
}

// Predefined themes
export const themes: Theme[] = [
  {
    id: 'default',
    nameKey: 'themes.default',
    colors: {
      primary: '#4f46e5',
      primaryHover: '#4338ca',
      primaryLight: '#eef2ff',
      background: '#f5f6fb',
      backgroundSecondary: '#ffffff',
      sidebar: '#1e1b4b',
      sidebarText: '#c7d2fe',
      sidebarHover: '#312e81',
      card: '#ffffff',
      cardBorder: '#ecebf5',
      text: '#0f172a',
      textSecondary: '#64748b',
      accent: '#6366f1',
    },
  },
  {
    id: 'blue',
    nameKey: 'themes.blue',
    colors: {
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
      primaryLight: '#eff6ff',
      background: '#f4f6fa',
      backgroundSecondary: '#ffffff',
      sidebar: '#111827',
      sidebarText: '#cbd5e1',
      sidebarHover: '#1f2937',
      card: '#ffffff',
      cardBorder: '#eef1f6',
      text: '#0f172a',
      textSecondary: '#64748b',
      accent: '#3b82f6',
    },
  },
  {
    id: 'emerald',
    nameKey: 'themes.emerald',
    colors: {
      primary: '#059669',
      primaryHover: '#047857',
      primaryLight: '#ecfdf5',
      background: '#f4faf6',
      backgroundSecondary: '#ffffff',
      sidebar: '#052e2b',
      sidebarText: '#a7f3d0',
      sidebarHover: '#064e3b',
      card: '#ffffff',
      cardBorder: '#e2efe8',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#10b981',
    },
  },
  {
    id: 'teal',
    nameKey: 'themes.teal',
    colors: {
      primary: '#0d9488',
      primaryHover: '#0f766e',
      primaryLight: '#ccfbf1',
      background: '#f2faf9',
      backgroundSecondary: '#ffffff',
      sidebar: '#083344',
      sidebarText: '#a5f3fc',
      sidebarHover: '#0e4c5c',
      card: '#ffffff',
      cardBorder: '#e0efec',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#14b8a6',
    },
  },
  {
    id: 'violet',
    nameKey: 'themes.violet',
    colors: {
      primary: '#7c3aed',
      primaryHover: '#6d28d9',
      primaryLight: '#f5f3ff',
      background: '#f7f5fc',
      backgroundSecondary: '#ffffff',
      sidebar: '#3b0764',
      sidebarText: '#ddd6fe',
      sidebarHover: '#4c1d95',
      card: '#ffffff',
      cardBorder: '#ede9f7',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#8b5cf6',
    },
  },
  {
    id: 'amber',
    nameKey: 'themes.amber',
    colors: {
      primary: '#d97706',
      primaryHover: '#b45309',
      primaryLight: '#fffbeb',
      background: '#fdf9f0',
      backgroundSecondary: '#ffffff',
      sidebar: '#451a03',
      sidebarText: '#fcd34d',
      sidebarHover: '#78350f',
      card: '#ffffff',
      cardBorder: '#f3ecd9',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#f59e0b',
    },
  },
  {
    id: 'rose',
    nameKey: 'themes.rose',
    colors: {
      primary: '#e11d48',
      primaryHover: '#be123c',
      primaryLight: '#fff1f2',
      background: '#fdf5f6',
      backgroundSecondary: '#ffffff',
      sidebar: '#4c0519',
      sidebarText: '#fda4af',
      sidebarHover: '#881337',
      card: '#ffffff',
      cardBorder: '#f5e6e9',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#f43f5e',
    },
  },
  {
    id: 'cyan',
    nameKey: 'themes.cyan',
    colors: {
      primary: '#0891b2',
      primaryHover: '#0e7490',
      primaryLight: '#ecfeff',
      background: '#f2fafd',
      backgroundSecondary: '#ffffff',
      sidebar: '#083344',
      sidebarText: '#a5f3fc',
      sidebarHover: '#164e63',
      card: '#ffffff',
      cardBorder: '#dceff3',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#06b6d4',
    },
  },
  {
    id: 'slate',
    nameKey: 'themes.slate',
    colors: {
      primary: '#475569',
      primaryHover: '#334155',
      primaryLight: '#f1f5f9',
      background: '#f4f6f8',
      backgroundSecondary: '#ffffff',
      sidebar: '#0f172a',
      sidebarText: '#cbd5e1',
      sidebarHover: '#1e293b',
      card: '#ffffff',
      cardBorder: '#e5e9ef',
      text: '#0f172a',
      textSecondary: '#475569',
      accent: '#64748b',
    },
  },
  {
    id: 'dark',
    nameKey: 'themes.dark',
    colors: {
      primary: '#818cf8',
      primaryHover: '#6366f1',
      primaryLight: '#1e1b4b',
      background: '#0b1220',
      backgroundSecondary: '#111827',
      sidebar: '#050915',
      sidebarText: '#94a3b8',
      sidebarHover: '#1e293b',
      card: '#111827',
      cardBorder: '#1f2937',
      text: '#f1f5f9',
      textSecondary: '#94a3b8',
      accent: '#a5b4fc',
    },
  },
]

interface ThemeState {
  currentTheme: Theme
  setTheme: (themeId: string) => void
  applyTheme: (theme: Theme) => void
}

// Apply theme to CSS variables
const applyThemeToDOM = (theme: Theme) => {
  const root = document.documentElement
  
  root.style.setProperty('--color-primary', theme.colors.primary)
  root.style.setProperty('--color-primary-hover', theme.colors.primaryHover)
  root.style.setProperty('--color-primary-light', theme.colors.primaryLight)
  root.style.setProperty('--color-background', theme.colors.background)
  root.style.setProperty('--color-background-secondary', theme.colors.backgroundSecondary)
  root.style.setProperty('--color-sidebar', theme.colors.sidebar)
  root.style.setProperty('--color-sidebar-text', theme.colors.sidebarText)
  root.style.setProperty('--color-sidebar-hover', theme.colors.sidebarHover)
  root.style.setProperty('--color-card', theme.colors.card)
  root.style.setProperty('--color-card-border', theme.colors.cardBorder)
  root.style.setProperty('--color-text', theme.colors.text)
  root.style.setProperty('--color-text-secondary', theme.colors.textSecondary)
  root.style.setProperty('--color-accent', theme.colors.accent)
  
  // Generate primary color shades for Tailwind compatibility
  root.style.setProperty('--color-primary-50', theme.colors.primaryLight)
  root.style.setProperty('--color-primary-500', theme.colors.primary)
  root.style.setProperty('--color-primary-600', theme.colors.primary)
  root.style.setProperty('--color-primary-700', theme.colors.primaryHover)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      currentTheme: themes[0],
      
      setTheme: (themeId: string) => {
        const theme = themes.find(t => t.id === themeId) || themes[0]
        set({ currentTheme: theme })
        applyThemeToDOM(theme)
      },
      
      applyTheme: (theme: Theme) => {
        applyThemeToDOM(theme)
      },
    }),
    {
      name: 'tms-theme-v2',
      onRehydrateStorage: () => (state) => {
        // Migration: if the stored theme id no longer exists (older builds),
        // fall back to the current default so users get the refreshed palette
        // instead of a broken/empty theme.
        if (state?.currentTheme) {
          const known = themes.find(t => t.id === state.currentTheme.id)
          if (!known) {
            state.currentTheme = themes[0]
          } else {
            // Refresh the color values in case the palette definition changed.
            state.currentTheme = known
          }
          applyThemeToDOM(state.currentTheme)
        }
      },
    }
  )
)
