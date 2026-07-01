/**
 * MFA Setup Page - Shown when user must configure 2FA before accessing the app
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import { authApi } from '@/api/auth'
import toast from 'react-hot-toast'

interface MfaForm {
  code: string
}

export default function MfaSetupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isAuthenticated, pendingMfaSetup, completeMfaSetup, logout } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  const [setupData, setSetupData] = useState<{ secret: string; qr_code: string; uri: string } | null>(null)
  const [loadingSetup, setLoadingSetup] = useState(true)
  
  const { register, handleSubmit, formState: { errors } } = useForm<MfaForm>()

  useEffect(() => {
    // If not authenticated or MFA is already set up, redirect
    if (!isAuthenticated) {
      navigate('/login', { replace: true })
      return
    }
    
    if (!pendingMfaSetup) {
      navigate('/', { replace: true })
      return
    }

    // Load MFA setup data
    loadSetupData()
  }, [isAuthenticated, pendingMfaSetup, navigate])

  const loadSetupData = async () => {
    try {
      setLoadingSetup(true)
      const data = await authApi.setup2FA()
      setSetupData(data)
    } catch (err) {
      toast.error(t('errors.loadFailed'))
    } finally {
      setLoadingSetup(false)
    }
  }

  const onSubmit = async (data: MfaForm) => {
    setIsLoading(true)
    try {
      await authApi.enable2FA(data.code)
      completeMfaSetup()
      toast.success(t('common.success'))
      navigate('/', { replace: true })
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error || t('auth.verificationFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  if (loadingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
              <ShieldCheckIcon className="h-8 w-8 text-primary-600" />
            </div>
            <h1 className="page-title">
              {t('auth.setupMfa')}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {t('auth.setupMfaDescription')}
            </p>
          </div>

          {setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-4">
                  {t('auth.scanQrCode')}
                </p>
                <div className="flex justify-center">
                  <img 
                    src={setupData.qr_code} 
                    alt="2FA QR Code" 
                    className="w-48 h-48 border rounded"
                  />
                </div>
              </div>

              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">{t('common.or')}:</p>
                <code className="text-sm bg-gray-100 px-3 py-1 rounded font-mono">
                  {setupData.secret}
                </code>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="code" className="form-label">
                    {t('auth.twoFactorCode')}
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="form-input text-center text-2xl tracking-widest"
                    maxLength={6}
                    {...register('code', {
                      required: t('auth.codeRequired'),
                      pattern: {
                        value: /^\d{6}$/,
                        message: t('auth.codeMustBe6Digits'),
                      },
                    })}
                  />
                  {errors.code && (
                    <p className="mt-1 text-sm text-red-600">{errors.code.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary w-full"
                >
                  {isLoading ? t('common.loading') : t('common.confirm')}
                </button>
              </form>
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
