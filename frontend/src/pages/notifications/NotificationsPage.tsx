/**
 * Notifications Management Page
 * Admin interface for managing notification groups, schedules, sending and sent history
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BellIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import NotificationGroupsTab from '@/components/settings/NotificationGroupsTab'
import NotificationSchedulesTab from '@/components/settings/NotificationSchedulesTab'
import SentNotificationsTab from '@/components/settings/SentNotificationsTab'
import SendUserNotificationTab from '@/components/settings/SendUserNotificationTab'

type SubTab = 'groups' | 'schedules' | 'send' | 'sent'

export default function NotificationsPage() {
  const { t } = useTranslation()
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('groups')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const subTabs = [
    { id: 'groups' as SubTab, name: t('notifications.groups', 'Groepen'), icon: UserGroupIcon },
    { id: 'schedules' as SubTab, name: t('notifications.schedules', "Schema's"), icon: CalendarDaysIcon },
    { id: 'send' as SubTab, name: t('notifications.send', 'Versturen'), icon: PaperAirplaneIcon },
    { id: 'sent' as SubTab, name: t('notifications.sent', 'Verzonden'), icon: CheckCircleIcon },
  ]

  const handleSuccess = (message: string) => {
    setSuccessMessage(message)
    setErrorMessage(null)
    setTimeout(() => setSuccessMessage(null), 5000)
  }

  const handleError = (message: string) => {
    setErrorMessage(message)
    setSuccessMessage(null)
    setTimeout(() => setErrorMessage(null), 5000)
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <BellIcon className="h-8 w-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('notifications.title')}</h1>
            <p className="text-sm text-gray-500">
              {t('notifications.manageDescription', "Beheer notificatie groepen, schema's en verstuur berichten.")}
            </p>
          </div>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {errorMessage}
        </div>
      )}

      {/* Desktop Tabs - hidden on mobile */}
      <div className="hidden md:block border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`
                flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeSubTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile Accordion - hidden on desktop */}
      <div className="md:hidden space-y-2 mb-4">
        {subTabs.map((tab) => {
          const isOpen = activeSubTab === tab.id
          return (
            <div key={tab.id}>
              <button
                onClick={() => setActiveSubTab(isOpen ? '' as SubTab : tab.id)}
                className={`flex items-center gap-3 w-full p-4 bg-white rounded-xl border shadow-sm text-sm font-medium transition-colors ${
                  isOpen
                    ? 'border-primary-300 text-primary-600 bg-primary-50 rounded-b-none'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <tab.icon className={`h-5 w-5 ${isOpen ? 'text-primary-600' : 'text-gray-400'}`} />
                {tab.name}
                <ChevronDownIcon className={`h-4 w-4 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary-600' : 'text-gray-400'}`} />
              </button>
              {isOpen && (
                <div className="bg-white rounded-b-xl border border-t-0 border-primary-300 shadow-sm p-4">
                  {activeSubTab === 'groups' && (
                    <NotificationGroupsTab onSuccess={handleSuccess} onError={handleError} />
                  )}
                  {activeSubTab === 'schedules' && (
                    <NotificationSchedulesTab onSuccess={handleSuccess} onError={handleError} />
                  )}
                  {activeSubTab === 'send' && (
                    <SendUserNotificationTab onSuccess={handleSuccess} onError={handleError} />
                  )}
                  {activeSubTab === 'sent' && (
                    <SentNotificationsTab />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Desktop Tab Content */}
      <div className="hidden md:block">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {activeSubTab === 'groups' && (
            <NotificationGroupsTab onSuccess={handleSuccess} onError={handleError} />
          )}
          {activeSubTab === 'schedules' && (
            <NotificationSchedulesTab onSuccess={handleSuccess} onError={handleError} />
          )}
          {activeSubTab === 'send' && (
            <SendUserNotificationTab onSuccess={handleSuccess} onError={handleError} />
          )}
          {activeSubTab === 'sent' && (
            <SentNotificationsTab />
          )}
        </div>
      </div>
    </div>
  )
}
