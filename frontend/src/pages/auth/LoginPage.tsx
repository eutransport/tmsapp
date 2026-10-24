import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { startApkDownload } from '@/components/app/AppInstallBlok'
import toast from 'react-hot-toast'

interface LoginForm {
  email: string
  password: string
}

interface TwoFactorForm {
  code: string
}

function AndroidLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.14-.52.38.38 0 0 0-.52.14l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.52-.14.38.38 0 0 0-.14.52L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52M7 15.25a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 7 15.25m10 0A1.25 1.25 0 1 1 18.25 14 1.25 1.25 0 0 1 17 15.25" />
    </svg>
  )
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.76c.02 2.5 2.2 3.33 2.22 3.34-.02.06-.35 1.2-1.15 2.37-.69 1.02-1.4 2.03-2.53 2.05-1.11.02-1.47-.65-2.73-.65-1.27 0-1.66.63-2.71.67-1.09.04-1.92-1.1-2.61-2.11-1.42-2.07-2.5-5.84-1.05-8.39.72-1.26 2.01-2.06 3.41-2.08 1.07-.02 2.08.72 2.73.72.66 0 1.88-.89 3.17-.76.54.02 2.06.22 3.03 1.64-.08.05-1.81 1.06-1.79 3.2M14.3 4.9c.58-.7.97-1.67.86-2.64-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.88 2.56.93.07 1.88-.47 2.46-1.17" />
    </svg>
  )
}

const stagger = (i: number) => ({ '--i': i }) as CSSProperties

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [requires2FA, setRequires2FA] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  const { login, verify2FA } = useAuthStore()
  const loginForm = useForm<LoginForm>()
  const twoFactorForm = useForm<TwoFactorForm>()

  const handleAndroidDownload = async () => {
    const ok = await startApkDownload()
    toast[ok ? 'success' : 'error'](
      t(ok ? 'appInstall.downloadStarting' : 'appInstall.downloadFailed')
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
        toast.success(t('auth.setupMfaDescription'))
        navigate('/setup-mfa')
      } else {
        toast.success(t('auth.successfullyLoggedIn'))
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
      navigate('/')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error || t('auth.verificationFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const triggerAutoLogin = async () => {
    if (!showLogin || isLoading || requires2FA) return

    const values = loginForm.getValues()
    if (!values.email || !values.password) return

    const validEmail = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)
    if (!validEmail) return

    await loginForm.handleSubmit(onLoginSubmit)()
  }

  if (requires2FA) {
    return (
      <div className="auth-card-form auth-card-form-compact">
        <h2 className="text-xl font-semibold text-white mb-6">{t('auth.twoFactor')}</h2>
        <p className="text-sm text-sky-100/80 mb-6">{t('auth.twoFactorDescription')}</p>

        <form onSubmit={twoFactorForm.handleSubmit(on2FASubmit)} className="space-y-6">
          <div>
            <label htmlFor="code" className="label">{t('auth.twoFactorCode')}</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input auth-input text-center text-2xl tracking-widest"
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
              <p className="mt-1 text-sm text-red-300">{twoFactorForm.formState.errors.code.message}</p>
            )}
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary w-full auth-login-btn">
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

  if (!showLogin) {
    return (
      <div className="auth-landing">
        <div className="auth-reveal mb-3" style={stagger(0)}>
          <h2 className="auth-title">Welkom bij Moveo</h2>
          <p className="auth-subtitle">Realtime transport intelligence voor uw vloot.</p>
        </div>

        <div className="auth-action-grid auth-reveal" style={stagger(2)}>
          <button type="button" className="auth-square-btn" onClick={handleAndroidDownload}>
            <AndroidLogo className="auth-square-icon auth-square-icon-android" />
            <span>Android app</span>
          </button>

          <button type="button" className="auth-square-btn auth-square-btn-primary" onClick={() => setShowLogin(true)}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="auth-square-icon">
              <path d="M7 12.5 9.8 15.3 17 8.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 3.5c4.8 0 8.5 3.7 8.5 8.5s-3.7 8.5-8.5 8.5S3.5 16.8 3.5 12 7.2 3.5 12 3.5Z" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            <span>Sign in</span>
          </button>

          <Link to="/app-installatie" className="auth-square-btn">
            <AppleLogo className="auth-square-icon auth-square-icon-apple" />
            <span>iPhone</span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-card-form">
      <div className="auth-reveal mb-4" style={stagger(0)}>
        <h2 className="auth-title">{t('auth.welcomeBack')}</h2>
        <p className="auth-subtitle">{t('auth.loginSubtitle')}</p>
      </div>

      <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-5">
        <div className="auth-reveal" style={stagger(1)}>
          <label htmlFor="email" className="label">{t('auth.email')}</label>
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
            <p className="mt-1 text-sm text-red-300">{loginForm.formState.errors.email.message}</p>
          )}
        </div>

        <div className="auth-reveal" style={stagger(2)}>
          <label htmlFor="password" className="label">{t('auth.password')}</label>
          <div className="auth-field">
            <svg className="auth-field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input auth-input"
              {...loginForm.register('password', {
                required: t('errors.required'),
                onBlur: async () => {
                  await triggerAutoLogin()
                }
              })}
            />
          </div>
          {loginForm.formState.errors.password && (
            <p className="mt-1 text-sm text-red-300">{loginForm.formState.errors.password.message}</p>
          )}
        </div>

        <button type="submit" disabled={isLoading} className="btn-primary w-full auth-login-btn auth-reveal" style={stagger(3)}>
          {isLoading ? t('auth.loggingIn') : t('auth.loginButton')}
        </button>

        <div className="auth-actions-inline auth-reveal" style={stagger(4)}>
          <button type="button" className="auth-link-button" onClick={() => setShowLogin(false)}>
            Terug
          </button>
        </div>
      </form>
    </div>
  )
}
