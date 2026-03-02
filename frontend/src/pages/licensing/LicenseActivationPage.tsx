/**
 * License Activation Page
 * 
 * Shown when no valid license is detected.
 * Allows entering a license key to activate the application.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  KeyIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { licensingApi } from '@/api/licensing'
import { useAppStore } from '@/stores/appStore'
import { useLicenseStore } from '@/stores/licenseStore'
import { useAuthStore } from '@/stores/authStore'

export default function LicenseActivationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { settings } = useAppStore()
  const { checkLicense } = useLicenseStore()
  const { isAuthenticated } = useAuthStore()
  
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [checkingLicense, setCheckingLicense] = useState(true)
  const [licenseInfo, setLicenseInfo] = useState<{
    customer: string
    expires_at: string
    days_remaining: number
  } | null>(null)

  // On mount, check if license is already active
  useEffect(() => {
    const verify = async () => {
      const licensed = await checkLicense()
      setCheckingLicense(false)
      if (licensed) {
        // License is already active, redirect appropriately
        if (isAuthenticated) {
          navigate('/', { replace: true })
        } else {
          navigate('/login', { replace: true })
        }
      }
    }
    verify()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleActivate = async () => {
    const key = licenseKey.trim()
    if (!key) {
      setError(t('license.enterKey', 'Voer een licentiesleutel in.'))
      return
    }

    setActivating(true)
    setError(null)
    setSuccess(false)

    try {
      const result = await licensingApi.activate(key)
      
      if (result.success && result.license) {
        setSuccess(true)
        setLicenseInfo({
          customer: result.license.customer,
          expires_at: result.license.expires_at,
          days_remaining: result.license.days_remaining,
        })
        
        // Update the license store so ProtectedRoute knows we're licensed
        await checkLicense()
        
        // After 2 seconds, redirect to login
        setTimeout(() => {
          navigate('/login', { replace: true })
        }, 2500)
      } else {
        setError(result.message || t('license.activationFailed', 'Activatie mislukt.'))
      }
    } catch (err: any) {
      const data = err.response?.data
      if (data?.message) {
        setError(data.message)
      } else if (data?.detail) {
        setError(data.detail)
      } else {
        setError(t('license.activationFailed', 'Activatie mislukt. Controleer de sleutel en probeer opnieuw.'))
      }
    } finally {
      setActivating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !activating) {
      handleActivate()
    }
  }

  // Show loading while checking license status
  if (checkingLicense) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          {settings?.logo_url ? (
            <img
              src={settings.logo_url}
              alt={settings.app_name || 'TMS'}
              className="mx-auto h-16 w-auto mb-4"
            />
          ) : (
            <ShieldCheckIcon className="mx-auto h-16 w-16 text-primary-600 mb-4" />
          )}
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t('license.activation', 'Licentie Activatie')}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t('license.activationDescription', 'Voer uw licentiesleutel in om de applicatie te activeren.')}
          </p>
        </div>

        {/* Activation form */}
        <div className="card p-6 space-y-6">
          {/* Error message */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
              <div className="flex">
                <ExclamationCircleIcon className="h-5 w-5 text-red-400 flex-shrink-0" />
                <div className="ml-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Success message */}
          {success && licenseInfo && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex">
                <CheckCircleIcon className="h-5 w-5 text-green-400 flex-shrink-0" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800 dark:text-green-300">
                    {t('license.activated', 'Licentie geactiveerd!')}
                  </h3>
                  <div className="mt-2 text-sm text-green-700 dark:text-green-400">
                    <p>{t('license.customer', 'Klant')}: {licenseInfo.customer}</p>
                    <p>
                      {t('license.expiresAt', 'Geldig tot')}:{' '}
                      {new Date(licenseInfo.expires_at).toLocaleDateString('nl-NL')}
                    </p>
                    <p>{t('license.daysRemaining', 'Dagen resterend')}: {licenseInfo.days_remaining}</p>
                  </div>
                  <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                    {t('license.redirecting', 'U wordt doorgestuurd naar de login pagina...')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* License key input */}
          {!success && (
            <>
              <div>
                <label
                  htmlFor="license-key"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t('license.key', 'Licentiesleutel')}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <KeyIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <textarea
                    id="license-key"
                    value={licenseKey}
                    onChange={(e) => {
                      setLicenseKey(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={t('license.keyPlaceholder', 'Plak hier uw licentiesleutel...')}
                    rows={4}
                    className="input pl-10 font-mono text-xs resize-none"
                    disabled={activating}
                    autoFocus
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('license.keyHint', 'De licentiesleutel is ontvangen van de leverancier.')}
                </p>
              </div>

              <button
                onClick={handleActivate}
                disabled={activating || !licenseKey.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {activating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    {t('license.activating', 'Activeren...')}
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon className="h-5 w-5" />
                    {t('license.activate', 'Licentie Activeren')}
                  </>
                )}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
          {t('license.contactSupport', 'Geen licentie? Neem contact op met de leverancier.')}
        </p>
      </div>
    </div>
  )
}
