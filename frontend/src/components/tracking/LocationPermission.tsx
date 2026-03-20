/**
 * Location Permission Components
 * 
 * 1. LocationPermissionDialog — first-time popup asking for permission
 * 2. LocationDeniedBanner — persistent banner when GPS is blocked
 * 
 * Includes platform-specific help instructions for Android and iOS.
 */
import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  MapPinIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ShieldCheckIcon,
  DevicePhoneMobileIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import type { Platform } from '@/hooks/useLocationPermission'

// ====== First-time Permission Dialog ======
export function LocationPermissionDialog({
  isOpen,
  onAllow,
  onDeny,
  loading,
}: {
  isOpen: boolean
  onAllow: () => void
  onDeny: () => void
  platform?: Platform
  loading?: boolean
}) {
  const { t } = useTranslation()

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onDeny}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-sm transform overflow-hidden rounded-2xl bg-white p-5 text-left shadow-xl transition-all">
                {/* Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                    <MapPinIcon className="h-8 w-8 text-primary-600" />
                  </div>
                </div>

                <Dialog.Title className="text-lg font-semibold text-gray-900 text-center">
                  {t('tracking.permission.title')}
                </Dialog.Title>
                
                <p className="mt-2 text-sm text-gray-600 text-center">
                  {t('tracking.permission.description')}
                </p>

                {/* Privacy info */}
                <div className="mt-4 bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-gray-600">{t('tracking.permission.privacy1')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-gray-600">{t('tracking.permission.privacy2')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-gray-600">{t('tracking.permission.privacy3')}</span>
                  </div>
                </div>

                {/* Buttons */}
                <div className="mt-5 space-y-2">
                  <button
                    onClick={onAllow}
                    disabled={loading}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <MapPinIcon className="h-4 w-4" />
                    )}
                    {t('tracking.permission.allow')}
                  </button>
                  <button
                    onClick={onDeny}
                    className="btn-secondary w-full text-sm"
                  >
                    {t('tracking.permission.deny')}
                  </button>
                </div>

                <p className="mt-3 text-[10px] text-gray-400 text-center">
                  {t('tracking.permission.changeLater')}
                </p>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

// ====== GPS Blocked Banner ======
export function LocationDeniedBanner({
  platform,
  onDismiss,
}: {
  platform: Platform
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg overflow-hidden">
      {/* Main banner */}
      <div className="px-3 py-2.5 flex items-start gap-2.5">
        <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900">
            {t('tracking.denied.title')}
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            {t('tracking.denied.description')}
          </p>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900 underline underline-offset-2"
          >
            {t('tracking.denied.howToEnable')}
            {showHelp ? (
              <ChevronUpIcon className="h-3 w-3" />
            ) : (
              <ChevronDownIcon className="h-3 w-3" />
            )}
          </button>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-0.5 text-amber-500 hover:text-amber-700 rounded shrink-0"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Expandable help section */}
      {showHelp && (
        <div className="px-3 pb-3 border-t border-amber-200 pt-2.5 space-y-3">
          {/* Android instructions */}
          {(platform === 'android' || platform === 'desktop') && (
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <div className="flex items-center gap-2 mb-2">
                <DevicePhoneMobileIcon className="h-4 w-4 text-green-600" />
                <span className="text-xs font-semibold text-gray-900">Android</span>
              </div>
              <ol className="text-xs text-gray-700 space-y-1.5 list-decimal list-inside">
                <li>{t('tracking.help.android.step1')}</li>
                <li>{t('tracking.help.android.step2')}</li>
                <li>{t('tracking.help.android.step3')}</li>
                <li>{t('tracking.help.android.step4')}</li>
                <li>{t('tracking.help.android.step5')}</li>
              </ol>
              <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] text-gray-500">
                <strong>Chrome:</strong> {t('tracking.help.android.chrome')}
              </div>
            </div>
          )}

          {/* iOS instructions */}
          {(platform === 'ios' || platform === 'desktop') && (
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <div className="flex items-center gap-2 mb-2">
                <DevicePhoneMobileIcon className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-semibold text-gray-900">iPhone / iPad</span>
              </div>
              <ol className="text-xs text-gray-700 space-y-1.5 list-decimal list-inside">
                <li>{t('tracking.help.ios.step1')}</li>
                <li>{t('tracking.help.ios.step2')}</li>
                <li>{t('tracking.help.ios.step3')}</li>
                <li>{t('tracking.help.ios.step4')}</li>
                <li>{t('tracking.help.ios.step5')}</li>
              </ol>
              <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] text-gray-500">
                <strong>Safari:</strong> {t('tracking.help.ios.safari')}
              </div>
            </div>
          )}

          {/* Desktop browser instructions */}
          {platform === 'desktop' && (
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <div className="flex items-center gap-2 mb-2">
                <Cog6ToothIcon className="h-4 w-4 text-gray-600" />
                <span className="text-xs font-semibold text-gray-900">{t('tracking.help.desktop.title')}</span>
              </div>
              <ol className="text-xs text-gray-700 space-y-1.5 list-decimal list-inside">
                <li>{t('tracking.help.desktop.step1')}</li>
                <li>{t('tracking.help.desktop.step2')}</li>
                <li>{t('tracking.help.desktop.step3')}</li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
