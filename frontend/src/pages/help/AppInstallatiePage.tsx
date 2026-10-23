import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon, BellAlertIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline'

function Stap({ nummer, tekst }: { nummer: number; tekst: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
        {nummer}
      </span>
      <span className="text-sm text-gray-700">{tekst}</span>
    </li>
  )
}

export default function AppInstallatiePage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="page-title">{t('appInstall.pageTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('appInstall.pageIntro')}</p>
        </div>

        <section className="card p-5">
          <h2 className="section-title flex items-center gap-2">
            <DevicePhoneMobileIcon className="h-5 w-5 text-gray-400" />
            {t('appInstall.iosHeading')}
          </h2>
          <ol className="mt-3 space-y-2.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Stap key={n} nummer={n} tekst={t(`appInstall.iosStep${n}`)} />
            ))}
          </ol>
        </section>

        <section className="card p-5">
          <h2 className="section-title flex items-center gap-2">
            <BellAlertIcon className="h-5 w-5 text-gray-400" />
            {t('appInstall.pushHeading')}
          </h2>
          <p className="mt-2 text-sm text-gray-700">{t('appInstall.pushIntro')}</p>
          <p className="mt-3 text-sm text-gray-700">{t('appInstall.pushIos')}</p>
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">{t('appInstall.pushIosVersion')}</p>
          <p className="mt-3 text-sm text-gray-700">{t('appInstall.pushAndroid')}</p>
        </section>

        <section className="card p-5">
          <h2 className="section-title">{t('appInstall.androidHeading')}</h2>
          <p className="mt-2 text-sm text-gray-700">{t('appInstall.androidIntro')}</p>
          <ol className="mt-3 space-y-2.5">
            {[1, 2, 3, 4].map(n => (
              <Stap key={n} nummer={n} tekst={t(`appInstall.androidStep${n}`)} />
            ))}
          </ol>
        </section>

        <Link to="/login" className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeftIcon className="h-4 w-4" />
          {t('appInstall.backToLogin')}
        </Link>
      </div>
    </div>
  )
}
