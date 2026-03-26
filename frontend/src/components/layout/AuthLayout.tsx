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
      className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8"
      style={{ backgroundColor: settings?.login_background_color || '#F9FAFB' }}
    >
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {settings?.logo_url ? (
          <img
            className="mx-auto h-32 w-auto"
            src={settings.logo_url}
            alt={settings.app_name}
          />
        ) : (
          <h1 className="text-center text-3xl font-bold text-primary-600">
            {settings?.app_name || 'TMS'}
          </h1>
        )}
      </div>
      
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-lg sm:rounded-lg sm:px-10">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
