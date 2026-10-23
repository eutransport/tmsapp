/**
 * Push Notification Prompt
 * Shows a modal prompting users to enable push notifications after login
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  BellAlertIcon,
  BellSlashIcon,
  XMarkIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import { usePushNotifications, getDeviceName } from '@/hooks/usePushNotifications'

const PROMPT_DISMISSED_KEY = 'push_prompt_dismissed'
const PROMPT_DISMISSED_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 dagen

interface PushNotificationPromptProps {
  /** Delay before showing the prompt (ms) */
  delay?: number
}

export default function PushNotificationPrompt({ delay = 2000 }: PushNotificationPromptProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [isEnabling, setIsEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  const [enableSuccess, setEnableSuccess] = useState(false)
  
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    pushConfig,
    subscribe,
  } = usePushNotifications()

  useEffect(() => {
    // Don't show if still loading or already subscribed
    if (isLoading || isSubscribed) return
    
    // Don't show if push not supported or not configured
    if (!isSupported || !pushConfig?.is_configured) return
    
    // Don't show if permission was already denied (user needs to fix in browser settings)
    if (permission === 'denied') return
    
    // Check if user dismissed the prompt recently
    const dismissedAt = localStorage.getItem(PROMPT_DISMISSED_KEY)
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10)
      if (Date.now() - dismissedTime < PROMPT_DISMISSED_DURATION) {
        return // Still within dismiss period
      }
    }
    
    // Show prompt after delay
    const timer = setTimeout(() => {
      setIsOpen(true)
    }, delay)
    
    return () => clearTimeout(timer)
  }, [isLoading, isSubscribed, isSupported, pushConfig, permission, delay])

  const handleEnable = async () => {
    setIsEnabling(true)
    setEnableError(null)
    
    try {
      // Get device name from user agent
      const deviceName = getDeviceName()
      const success = await subscribe(deviceName)
      
      if (success) {
        setEnableSuccess(true)
        // Close after showing success
        setTimeout(() => {
          setIsOpen(false)
        }, 2000)
      } else {
        setEnableError(t('pwa.couldNotEnableNotifications'))
      }
    } catch (err: any) {
      setEnableError(err.message || t('common.error'))
    } finally {
      setIsEnabling(false)
    }
  }

  const handleDismiss = () => {
    // Remember that user dismissed the prompt
    localStorage.setItem(PROMPT_DISMISSED_KEY, Date.now().toString())
    setIsOpen(false)
  }

  const handleClose = () => {
    if (!isEnabling) {
      handleDismiss()
    }
  }

  // Don't render anything if not needed
  if (!isSupported || !pushConfig?.is_configured || isSubscribed) {
    return null
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50" />
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
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all">
                {/* Close button */}
                {!isEnabling && !enableSuccess && (
                  <button
                    onClick={handleDismiss}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                )}

                {/* Success State */}
                {enableSuccess ? (
                  <div className="text-center py-4">
                    <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                      <CheckCircleIcon className="h-10 w-10 text-green-600" />
                    </div>
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {t('pwa.notificationsEnabled')}
                    </Dialog.Title>
                    <p className="mt-2 text-sm text-gray-600">
                      {t('pwa.willReceiveUpdates')}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Icon */}
                    <div className="mx-auto w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                      <BellAlertIcon className="h-10 w-10 text-primary-600" />
                    </div>

                    {/* Title */}
                    <Dialog.Title as="h3" className="text-xl font-semibold text-gray-900 text-center">
                      {t('pwa.enablePushNotifications')}
                    </Dialog.Title>

                    {/* Description */}
                    <div className="mt-4 space-y-3">
                      <p className="text-center text-gray-600">
                        {t('pwa.enableToStayInformed')}
                      </p>
                      
                      <ul className="space-y-2 text-sm text-gray-600">
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-primary-500 rounded-full"></span>
                          {t('pwa.newTripsAndChanges')}
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-primary-500 rounded-full"></span>
                          {t('pwa.importantAnnouncements')}
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-primary-500 rounded-full"></span>
                          {t('pwa.planningUpdates')}
                        </li>
                      </ul>

                      {/* Important notice */}
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
                        <div className="flex gap-2">
                          <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-amber-800">
                            <strong>{t('pwa.important')}:</strong> {t('pwa.mayMissUpdates')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Error message */}
                    {enableError && (
                      <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-sm text-red-700">{enableError}</p>
                      </div>
                    )}

                    {/* Permission denied info */}
                    {permission === 'denied' && (
                      <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex gap-2">
                          <BellSlashIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
                          <p className="text-sm text-gray-600">
                            {t('pwa.notificationsBlockedBrowser')}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Buttons */}
                    <div className="mt-6 space-y-3">
                      <button
                        onClick={handleEnable}
                        disabled={isEnabling || permission === 'denied'}
                        className="w-full btn-primary py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isEnabling ? (
                          <>
                            <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                            {t('pwa.enabling')}
                          </>
                        ) : (
                          <>
                            <BellAlertIcon className="h-5 w-5 mr-2" />
                            {t('pwa.yesEnable')}
                          </>
                        )}
                      </button>
                      
                      {!isEnabling && (
                        <button
                          onClick={handleDismiss}
                          className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
                        >
                          {t('pwa.remindLater')}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

/**
 * Get a friendly device name from the user agent
 */
