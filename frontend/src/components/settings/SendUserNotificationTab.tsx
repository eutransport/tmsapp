/**
 * Send User Notification Component
 * Admin interface for sending push notifications to individual users/chauffeurs
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition, Combobox } from '@headlessui/react'
import {
  PaperAirplaneIcon,
  UserIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  ChevronUpDownIcon,
  ArrowPathIcon,
  XMarkIcon,
  BellIcon,
} from '@heroicons/react/24/outline'
import { pushApi, type AvailableUser } from '@/api/push'

interface SendUserNotificationTabProps {
  onSuccess?: (message: string) => void
  onError?: (message: string) => void
}

export default function SendUserNotificationTab({ onSuccess, onError }: SendUserNotificationTabProps) {
  const { t } = useTranslation()
  const [users, setUsers] = useState<AvailableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  
  // Form state
  const [selectedUser, setSelectedUser] = useState<AvailableUser | null>(null)
  const [userQuery, setUserQuery] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  
  // Modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      const usersData = await pushApi.getAvailableUsers()
      setUsers(usersData)
    } catch (err: any) {
      console.error('Failed to load users:', err)
      onError?.(t('notifications.loadUsersError'))
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = userQuery === ''
    ? users
    : users.filter((user) => {
        const search = userQuery.toLowerCase()
        return (
          user.email.toLowerCase().includes(search) ||
          user.full_name.toLowerCase().includes(search)
        )
      })

  const handleSend = async () => {
    if (!selectedUser) {
      onError?.(t('notifications.selectUserError'))
      return
    }
    if (!title.trim()) {
      onError?.(t('notifications.titleRequiredError'))
      return
    }
    if (!body.trim()) {
      onError?.(t('notifications.messageRequiredError'))
      return
    }

    try {
      setSending(true)
      const result = await pushApi.send({
        user_id: selectedUser.id,
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || undefined,
      })
      
      setShowConfirmModal(false)
      
      if (result.success_count > 0) {
        onSuccess?.(t('notifications.notificationSentToUser', { name: selectedUser.full_name, count: result.success_count }))
        // Reset form
        setSelectedUser(null)
        setUserQuery('')
        setTitle('')
        setBody('')
        setUrl('')
      } else if (result.error === 'not_configured') {
        onError?.(t('notifications.pushNotConfigured', 'Push notificaties zijn niet geconfigureerd. Stel eerst VAPID-sleutels in bij Instellingen.'))
      } else if (result.failure_count > 0) {
        onError?.(t('notifications.notificationFailedUser', { name: selectedUser.full_name }))
      } else {
        onError?.(t('notifications.noDevicesRegistered', { name: selectedUser.full_name }))
      }
    } catch (err: any) {
      console.error('Failed to send notification:', err)
      onError?.(err.response?.data?.detail || t('notifications.sendError'))
    } finally {
      setSending(false)
    }
  }

  const canSend = selectedUser && title.trim() && body.trim()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{t('notifications.sendPushNotification')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('notifications.sendToUserDescription')}
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
        {/* User Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <UserIcon className="inline-block h-4 w-4 mr-1 -mt-0.5" />
            {t('notifications.selectUser')}
          </label>
          <Combobox value={selectedUser} onChange={setSelectedUser}>
            <div className="relative">
              <div className="relative w-full cursor-default overflow-hidden rounded-lg border border-gray-300 bg-white text-left focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                <Combobox.Input
                  className="w-full border-none py-3 pl-10 pr-10 text-sm leading-5 text-gray-900 focus:ring-0"
                  displayValue={(user: AvailableUser | null) => user?.full_name || ''}
                  onChange={(event) => setUserQuery(event.target.value)}
                  placeholder={t('notifications.searchByNameOrEmail')}
                />
                <div className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </div>
                <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </Combobox.Button>
              </div>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
                afterLeave={() => setUserQuery('')}
              >
                <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                  {filteredUsers.length === 0 && userQuery !== '' ? (
                    <div className="relative cursor-default select-none py-3 px-4 text-gray-700">
                      {t('notifications.noUsersFound')}
                    </div>
                  ) : (
                    filteredUsers.map((user) => (
                      <Combobox.Option
                        key={user.id}
                        className={({ active }) =>
                          `relative cursor-pointer select-none py-3 pl-10 pr-4 ${
                            active ? 'bg-primary-600 text-white' : 'text-gray-900'
                          }`
                        }
                        value={user}
                      >
                        {({ selected, active }) => (
                          <>
                            <div className="flex flex-col">
                              <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                {user.full_name}
                              </span>
                              <span className={`block truncate text-xs ${active ? 'text-primary-200' : 'text-gray-500'}`}>
                                {user.email}
                              </span>
                            </div>
                            {selected ? (
                              <span
                                className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                                  active ? 'text-white' : 'text-primary-600'
                                }`}
                              >
                                <CheckIcon className="h-5 w-5" aria-hidden="true" />
                              </span>
                            ) : null}
                          </>
                        )}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              </Transition>
            </div>
          </Combobox>
          {selectedUser && (
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <CheckIcon className="h-4 w-4 text-green-500" />
              <span>{t('notifications.selected')}: <strong>{selectedUser.full_name}</strong> ({selectedUser.email})</span>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="ml-auto text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label htmlFor="notification-title" className="block text-sm font-medium text-gray-700 mb-2">
            {t('notifications.notificationTitle')} *
          </label>
          <input
            type="text"
            id="notification-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-field"
            placeholder={t('notifications.titlePlaceholder')}
            maxLength={100}
          />
          <p className="mt-1 text-xs text-gray-500">{title.length}/100 {t('notifications.characters')}</p>
        </div>

        {/* Body */}
        <div>
          <label htmlFor="notification-body" className="block text-sm font-medium text-gray-700 mb-2">
            {t('notifications.message')} *
          </label>
          <textarea
            id="notification-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="input-field resize-none"
            placeholder={t('notifications.messagePlaceholderUser')}
            maxLength={500}
          />
          <p className="mt-1 text-xs text-gray-500">{body.length}/500 {t('notifications.characters')}</p>
        </div>

        {/* URL (optional) */}
        <div>
          <label htmlFor="notification-url" className="block text-sm font-medium text-gray-700 mb-2">
            {t('notifications.link')} ({t('common.optional')})
          </label>
          <input
            type="url"
            id="notification-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="input-field"
            placeholder="https://..."
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('notifications.linkDescription')}
          </p>
        </div>

        {/* Send Button */}
        <div className="flex justify-end pt-4 border-t">
          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={!canSend}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PaperAirplaneIcon className="h-5 w-5 mr-2" />
            {t('notifications.sendNotification')}
          </button>
        </div>
      </div>

      {/* Preview Card */}
      {canSend && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <BellIcon className="h-4 w-4" />
            {t('common.preview')}
          </h4>
          <div className="card p-4 max-w-sm">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <BellIcon className="h-5 w-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
                <p className="text-sm text-gray-500 line-clamp-2">{body}</p>
                {url && (
                  <p className="text-xs text-primary-600 mt-1 truncate">{url}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <Transition appear show={showConfirmModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowConfirmModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" />
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
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-xl bg-white p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <PaperAirplaneIcon className="h-5 w-5 text-primary-600" />
                    {t('notifications.sendNotification')}
                  </Dialog.Title>

                  <div className="mt-4 space-y-4">
                    <p className="text-sm text-gray-600">
                      {t('notifications.confirmSend')}
                    </p>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                      <div>
                        <span className="text-xs font-medium text-gray-500">{t('notifications.recipient')}</span>
                        <p className="text-sm text-gray-900">{selectedUser?.full_name}</p>
                        <p className="text-xs text-gray-500">{selectedUser?.email}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500">{t('notifications.notificationTitle')}</span>
                        <p className="text-sm text-gray-900">{title}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-gray-500">{t('notifications.message')}</span>
                        <p className="text-sm text-gray-900">{body}</p>
                      </div>
                      {url && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">{t('notifications.link')}</span>
                          <p className="text-sm text-primary-600 truncate">{url}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowConfirmModal(false)}
                      disabled={sending}
                      className="btn-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sending}
                      className="btn-primary"
                    >
                      {sending ? (
                        <>
                          <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                          {t('common.sending')}
                        </>
                      ) : (
                        <>
                          <PaperAirplaneIcon className="h-5 w-5 mr-2" />
                          {t('common.send')}
                        </>
                      )}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
