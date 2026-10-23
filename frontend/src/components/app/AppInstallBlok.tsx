import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { androidApp } from '@/api/androidApp'

// Wordt gezet als iemand op de downloadknop drukt zonder ingelogd te zijn;
// LoginPage leest hem na een geslaagde aanmelding.
export const APK_NA_LOGIN = 'tms-apk-na-login'

export function isAndroid() {
  return /android/i.test(navigator.userAgent)
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export async function startApkDownload(): Promise<boolean> {
  try {
    const url = await androidApp.downloadLink()
    // Alleen ons eigen, relatieve bestandspad accepteren.
    if (!url.startsWith('/files/')) return false
    const anker = document.createElement('a')
    anker.href = url
    anker.download = 'tms-android.apk'
    document.body.appendChild(anker)
    anker.click()
    anker.remove()
    return true
  } catch {
    return false
  }
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

interface Props {
  ingelogd: boolean
  onLoginVereist: () => void
}

export default function AppInstallBlok({ ingelogd, onLoginVereist }: Props) {
  const { t } = useTranslation()
  const [versie, setVersie] = useState<string | null>(null)
  const [beschikbaar, setBeschikbaar] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let actief = true
    androidApp
      .info()
      .then(info => {
        if (!actief) return
        setBeschikbaar(info.available)
        setVersie(info.version || null)
      })
      .catch(() => undefined)
    return () => {
      actief = false
    }
  }, [])

  const toonAndroid = beschikbaar && !isIOS()

  if (!toonAndroid) {
    return (
      <div className="mt-6 border-t border-gray-200 pt-4 text-center">
        <Link to="/app-installatie" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <AppleLogo className="h-4 w-4" />
          {t('appInstall.iosLink')}
        </Link>
      </div>
    )
  }

  const klik = async () => {
    if (!ingelogd) {
      sessionStorage.setItem(APK_NA_LOGIN, '1')
      toast(t('appInstall.loginFirst'))
      onLoginVereist()
      return
    }
    setBezig(true)
    const gelukt = await startApkDownload()
    setBezig(false)
    toast[gelukt ? 'success' : 'error'](
      t(gelukt ? 'appInstall.downloadStarting' : 'appInstall.downloadFailed')
    )
  }

  return (
    <div className="mt-6 space-y-3 border-t border-gray-200 pt-4">
      <button type="button" onClick={klik} disabled={bezig} className="btn-secondary w-full justify-center gap-2">
        <AndroidLogo className="h-5 w-5 text-[#3ddc84]" />
        <span>{t('appInstall.androidButton')}</span>
      </button>
      {versie && <p className="text-center text-xs text-gray-400">{t('appInstall.androidHint', { version: versie })}</p>}
      <div className="text-center">
        <Link to="/app-installatie" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <AppleLogo className="h-4 w-4" />
          {t('appInstall.iosLink')}
        </Link>
      </div>
    </div>
  )
}
