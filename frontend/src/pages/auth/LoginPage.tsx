import { useState, type CSSProperties } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import AppInstallBlok, { APK_NA_LOGIN, startApkDownload } from '@/components/app/AppInstallBlok'
import toast from 'react-hot-toast'

interface LoginForm {
  email: string
  password: string
}

interface TwoFactorForm {
  code: string
}

// Volgorde-index voor de intro-animatie (zie .auth-reveal in index.css)
const stagger = (i: number) => ({ '--i': i }) as CSSProperties

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [requires2FA, setRequires2FA] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  
  const { login, verify2FA } = useAuthStore()
  
  const loginForm = useForm<LoginForm>()
  const twoFactorForm = useForm<TwoFactorForm>()

  // Wie vóór het inloggen op de downloadknop drukte, krijgt de APK alsnog.
  const apkNaLogin = async () => {
    if (sessionStorage.getItem(APK_NA_LOGIN) !== '1') return
    sessionStorage.removeItem(APK_NA_LOGIN)
    const gelukt = await startApkDownload()
    toast[gelukt ? 'success' : 'error'](
      t(gelukt ? 'appInstall.downloadStarting' : 'appInstall.downloadFailed')
    )
  }
  
  const onLoginSubmit = async (data: LoginForm) => {
    setIsLoading(true)
    try {
      const result = await login(data.email, data.password)
      
      if (result.requires2FA) {
        setRequires2FA(true)
        setUserId(result.userId || null)
        toast.success(t('auth.enterCode'))
      } else if (result.requires2FASetup) {
        // Redirect to MFA setup page
        toast.success(t('auth.setupMfaDescription'))
        navigate('/setup-mfa')
      } else {
        toast.success(t('auth.successfullyLoggedIn'))
        await apkNaLogin()
        navigate('/')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast.error(err.response?.data?.detail || t('auth.invalidCredentials'))
    } finally {
      setIsLoading(false)
    }
  }
  
  const on2FASubmit = async (data: TwoFactorForm) => {
    if (!userId) return
    
    setIsLoading(true)
    try {
      await verify2FA(userId, data.code)
      toast.success(t('auth.successfullyLoggedIn'))
      await apkNaLogin()
      navigate('/')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error || t('auth.verificationFailed'))
    } finally {
      setIsLoading(false)
    }
  }
  
  if (requires2FA) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">
          {t('auth.twoFactor')}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {t('auth.twoFactorDescription')}
        </p>
        
        <form onSubmit={twoFactorForm.handleSubmit(on2FASubmit)} className="space-y-6">
          <div>
            <label htmlFor="code" className="label">
              {t('auth.twoFactorCode')}
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input text-center text-2xl tracking-widest"
              placeholder="000000"
              {...twoFactorForm.register('code', { 
                required: t('auth.codeRequired'),
                pattern: {
                  value: /^\d{6}$/,
                  message: t('auth.codeMustBe6Digits')
                }
              })}
            />
            {twoFactorForm.formState.errors.code && (
              <p className="mt-1 text-sm text-red-600">
                {twoFactorForm.formState.errors.code.message}
              </p>
            )}
          </div>
          
          <button
            type="submit"
            disabled={isLoading}
            className="btn-primary w-full"
          >
            {isLoading ? t('common.loading') : t('common.confirm')}
          </button>
          
          <button
            type="button"
            onClick={() => {
              setRequires2FA(false)
              setUserId(null)
            }}
            className="btn-secondary w-full"
          >
            {t('common.back')}
          </button>
        </form>
      </div>
    )
  }
  
  return (
    <div>
      <div className="auth-reveal mb-6" style={stagger(0)}>
        <h2 className="auth-title">{t('auth.welcomeBack')}</h2>
        <p className="auth-subtitle">{t('auth.loginSubtitle')}</p>
      </div>
      
      <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-5">
        <div className="auth-reveal" style={stagger(1)}>
          <label htmlFor="email" className="label">
            {t('auth.email')}
          </label>
          <div className="auth-field">
            <svg className="auth-field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
          <input
            id="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            className="input auth-input"
            {...loginForm.register('email', { 
              required: t('errors.required'),
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: t('errors.invalidEmail')
              }
            })}
          />
          </div>
          {loginForm.formState.errors.email && (
            <p className="mt-1 text-sm text-red-600">
              {loginForm.formState.errors.email.message}
            </p>
          )}
        </div>
        
        <div className="auth-reveal" style={stagger(2)}>
          <label htmlFor="password" className="label">
            {t('auth.password')}
          </label>
          <div className="auth-field">
            <svg className="auth-field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="input auth-input"
            {...loginForm.register('password', { 
              required: t('errors.required')
            })}
          />
          </div>
          {loginForm.formState.errors.password && (
            <p className="mt-1 text-sm text-red-600">
              {loginForm.formState.errors.password.message}
            </p>
          )}
        </div>
        
        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary w-full auth-reveal"
          style={stagger(3)}
        >
          {isLoading ? t('auth.loggingIn') : t('auth.loginButton')}
        </button>
        <div className="auth-foot auth-reveal" style={stagger(4)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
          {t('auth.secureConnection')}
        </div>
      </form>

      <AppInstallBlok
        ingelogd={false}
        onLoginVereist={() => loginForm.setFocus('email')}
      />
    </div>
  )
}
