import { useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useAppStore } from '@/stores/appStore'

export default function AuthLayout() {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore()
  const { settings, fetchSettings, isLoading: settingsLoading } = useAppStore()
  
  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])
  
  if (authLoading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f3f4f6' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-400"></div>
      </div>
    )
  }
  
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }
  
  return (
    <div
      className="auth-shell relative min-h-screen flex flex-col items-center justify-center py-10 px-4 sm:px-6 lg:px-8 overflow-hidden"
      style={{
        background: settings?.login_background_color
          ? settings.login_background_color
          : undefined,
      }}
    >
      {/* Decorative gradient blobs — pure CSS, no assets */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl auth-blob-a"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 -right-24 h-[32rem] w-[32rem] rounded-full opacity-35 blur-3xl auth-blob-b"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 right-1/4 h-64 w-64 rounded-full opacity-20 blur-3xl auth-blob-c"
      />

      {/* Floating logo — sits above the card, no badge */}
      <div className="relative z-10 sm:w-full sm:max-w-md flex flex-col items-center auth-logo-wrap">
        <img
          className="auth-logo-img"
          src={settings?.logo_url || '/moveo-logo.png'}
          alt={settings?.app_name || 'Moveo'}
          onError={(e) => {
            // Fall back to the bundled Moveo logo if the configured URL fails to load
            const img = e.currentTarget
            if (img.src.indexOf('/moveo-logo.png') === -1) img.src = '/moveo-logo.png'
          }}
        />
      </div>

      {/* Floating card — springs into view */}
      <div className="relative z-10 mt-6 sm:w-full sm:max-w-md auth-card-wrap">
        <div className="auth-card">
          <Outlet />
        </div>
        <p className="mt-5 text-center text-xs text-white/70 drop-shadow-sm">
          {settings?.app_name || 'TMS'}
        </p>
      </div>
    </div>
  )
}
