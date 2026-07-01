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
      className="relative min-h-screen flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 overflow-hidden"
      style={{ backgroundColor: settings?.login_background_color || '#f5f7fb' }}
    >
      {/* Soft decorative gradient blobs — pure CSS, no assets */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-primary), transparent)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--color-primary-hover), transparent)' }}
      />

      <div className="relative sm:mx-auto sm:w-full sm:max-w-md animate-fade-in">
        {settings?.logo_url ? (
          <img
            className="mx-auto h-24 sm:h-28 w-auto drop-shadow-sm"
            src={settings.logo_url}
            alt={settings.app_name}
          />
        ) : (
          <h1 className="text-center text-display" style={{ color: 'var(--color-primary)' }}>
            {settings?.app_name || 'TMS'}
          </h1>
        )}
      </div>

      <div className="relative mt-8 sm:mx-auto sm:w-full sm:max-w-md animate-scale-in">
        <div className="bg-white/95 backdrop-blur-sm py-8 px-5 shadow-pop rounded-2xl border border-white/60 sm:px-10">
          <Outlet />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          {settings?.app_name || 'TMS'}
        </p>
      </div>
    </div>
  )
}
