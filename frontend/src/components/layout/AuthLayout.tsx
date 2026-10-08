import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useAppStore } from '@/stores/appStore'

// Alleen binnen dezelfde paginalading onthouden: na F5 speelt de intro weer, na uitloggen (SPA-navigatie) niet.
let introPlayed = false

function introAlreadySeen(): boolean {
  return introPlayed
}

// Bewust geen "verminder beweging"-uitzondering: de intro is een korte merk-animatie.

export default function AuthLayout() {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore()
  const { settings, fetchSettings, isLoading: settingsLoading } = useAppStore()
  const lockupRef = useRef<HTMLDivElement>(null)
  const introRef = useRef<boolean | null>(null)
  const ready = !authLoading && !settingsLoading
  if (ready && introRef.current === null) {
    introRef.current = !introAlreadySeen()
  }
  const intro = introRef.current === true

  const stars = useMemo(
    () => Array.from({ length: 40 }, () => {
      const a = Math.random() * Math.PI * 2
      const d = 250 + Math.random() * 600
      return { x: Math.cos(a) * d, y: Math.sin(a) * d, delay: Math.random() * 1.8 }
    }),
    [],
  )

  // Meet waar het logo uiteindelijk staat, zodat het vanuit het midden van het scherm erheen kan vliegen.
  useLayoutEffect(() => {
    const el = lockupRef.current
    if (!intro || !el) return
    const r = el.getBoundingClientRect()
    const dy = window.innerHeight / 2 - (r.top + r.height / 2)
    const s0 = Math.min(1.6, (window.innerWidth * 0.82) / r.width)
    el.style.setProperty('--dy', `${dy}px`)
    el.style.setProperty('--s0', String(s0))
    introPlayed = true
  }, [intro, ready])
  
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
      className={`auth-shell relative min-h-screen flex flex-col items-center justify-center py-10 px-4 sm:px-6 lg:px-8 overflow-hidden${intro ? ' auth-intro' : ''}`}
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
      {intro && (
        <div aria-hidden="true" className="auth-stars">
          {stars.map((s, i) => (
            <i key={i} style={{ '--x': `${s.x}px`, '--y': `${s.y}px`, animationDelay: `${s.delay}s` } as CSSProperties} />
          ))}
          <div className="auth-flash" />
          <div className="auth-ring" />
          <div className="auth-ring auth-ring-2" />
        </div>
      )}
      <div className="relative z-10 sm:w-full sm:max-w-md flex flex-col items-center auth-logo-wrap">
        <div ref={lockupRef} className="auth-lockup-pos">
          <div className="auth-lockup" role="img" aria-label={settings?.app_name || 'Moveo'}>
            <div className="auth-word" />
            <div className="auth-gpos"><div className="auth-globe" /></div>
          </div>
        </div>
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
