/**
 * Sent Notifications Tab
 * Admin view showing sent notification history with read receipts
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  ArrowPathIcon,
  PaperAirplaneIcon,
  UserGroupIcon,
  CheckCircleIcon,
  XMarkIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FunnelIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import {
  pushApi,
  type SentNotification,
  type NotificationGroup,
} from '@/api/push'

// Helper function to format date in Dutch
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface SentNotificationsTabProps {
  onSuccess?: (message: string) => void
  onError?: (message: string) => void
}

export default function SentNotificationsTab({ onSuccess, onError }: SentNotificationsTabProps) {
  const { t } = useTranslation()
  const [notifications, setNotifications] = useState<SentNotification[]>([])
  const [groups, setGroups] = useState<NotificationGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState<SentNotification | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showClearOldModal, setShowClearOldModal] = useState(false)
  const [clearDays, setClearDays] = useState(30)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  
  // Filter state
  const [filterGroup, setFilterGroup] = useState<string>('')
  const [filterDateFrom, setFilterDateFrom] = useState<string>('')
  const [filterDateTo, setFilterDateTo] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [filterGroup, filterDateFrom, filterDateTo])

  const loadData = async () => {
    try {
      setLoading(true)
      const [notificationsData, groupsData] = await Promise.all([
        pushApi.getSentNotifications(),
        pushApi.getGroups(),
      ])
      setNotifications(notificationsData)
      setGroups(groupsData)
    } catch (err: any) {
      console.error('Failed to load data:', err)
      onError?.(t('notifications.loadSentError'))
    } finally {
      setLoading(false)
    }
  }

  const loadNotifications = async () => {
    try {
      const params: any = {}
      if (filterGroup) params.group = filterGroup
      if (filterDateFrom) params.date_from = filterDateFrom
      if (filterDateTo) params.date_to = filterDateTo
      
      const data = await pushApi.getSentNotifications(params)
      setNotifications(data)
      setSelectedIds(new Set()) // Clear selection on reload
    } catch (err: any) {
      console.error('Failed to load notifications:', err)
    }
  }

  const openDetailModal = async (notification: SentNotification) => {
    try {
      // Fetch full details with read receipts
      const details = await pushApi.getSentNotification(notification.id)
      setSelectedNotification(details)
      setShowDetailModal(true)
    } catch (err: any) {
      console.error('Failed to load notification details:', err)
      onError?.(t('notifications.loadDetailsError'))
    }
  }

  const toggleExpandRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectNotification = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(notifications.map(n => n.id)))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return
    
    try {
      setDeleting(true)
      const result = await pushApi.bulkDeleteSentNotifications(Array.from(selectedIds))
      onSuccess?.(result.message)
      setShowDeleteModal(false)
      setSelectedIds(new Set())
      await loadData()
    } catch (err: any) {
      console.error('Failed to delete notifications:', err)
      onError?.(err.response?.data?.detail || t('notifications.deleteNotificationsError'))
    } finally {
      setDeleting(false)
    }
  }

  const handleClearOld = async () => {
    try {
      setDeleting(true)
      const result = await pushApi.clearOldNotifications(clearDays)
      onSuccess?.(result.message)
      setShowClearOldModal(false)
      await loadData()
    } catch (err: any) {
      console.error('Failed to clear old notifications:', err)
      onError?.(err.response?.data?.detail || t('notifications.clearOldError'))
    } finally {
      setDeleting(false)
    }
  }

  const clearFilters = () => {
    setFilterGroup('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  const hasActiveFilters = filterGroup || filterDateFrom || filterDateTo

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
          <h3 className="text-lg font-medium text-gray-900">{t('notifications.sentNotifications')}</h3>
          <p className="text-sm text-gray-500">
            {t('notifications.sentDescription')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="btn-danger flex items-center gap-2"
            >
              <TrashIcon className="h-4 w-4" />
              {t('common.delete')} ({selectedIds.size})
            </button>
          )}
          <button
            onClick={() => setShowClearOldModal(true)}
            className="btn-secondary flex items-center gap-2 text-red-600 hover:text-red-700"
          >
            <TrashIcon className="h-4 w-4" />
            {t('notifications.cleanup')}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary flex items-center gap-2 ${hasActiveFilters ? 'ring-2 ring-primary-500' : ''}`}
          >
            <FunnelIcon className="h-4 w-4" />
            {t('common.filter')}
            {hasActiveFilters && (
              <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {[filterGroup, filterDateFrom, filterDateTo].filter(Boolean).length}
              </span>
            )}
          </button>
          <button onClick={loadData} className="btn-secondary">
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('notifications.group')}
              </label>
              <select
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
                className="input-field"
              >
                <option value="">{t('notifications.allGroups')}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('notifications.fromDate')}
              </label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('notifications.toDate')}
              </label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-primary-600 hover:text-primary-700">
              {t('notifications.clearFilters')}
            </button>
          )}
        </div>
      )}

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <PaperAirplaneIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">
            {t('notifications.noNotificationsSent')}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters 
              ? t('notifications.noNotificationsWithFilters') 
              : t('notifications.noNotificationsSentYet')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden bg-white shadow ring-1 ring-black ring-opacity-5 rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 pl-4 pr-1 text-left">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === notifications.length && notifications.length > 0}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="py-3 pl-2 pr-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('notifications.notification')}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('notifications.recipients')}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('notifications.read')}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('notifications.sent')}
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {notifications.map((notification) => (
                <Fragment key={notification.id}>
                  <tr className={`hover:bg-gray-50 ${selectedIds.has(notification.id) ? 'bg-primary-50' : ''}`}>
                    <td className="py-3 pl-4 pr-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(notification.id)}
                        onChange={() => toggleSelectNotification(notification.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="py-3 pl-2 pr-3">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleExpandRow(notification.id)}
                          className="mt-1 text-gray-400 hover:text-gray-600"
                        >
                          {expandedRows.has(notification.id) ? (
                            <ChevronUpIcon className="h-4 w-4" />
                          ) : (
                            <ChevronDownIcon className="h-4 w-4" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate max-w-xs">
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-500 truncate max-w-xs">
                            {notification.body}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {notification.send_to_all ? (
                        <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                          <UserGroupIcon className="h-4 w-4" />
                          {t('notifications.everyone')}
                        </span>
                      ) : notification.group_name ? (
                        <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                          <UserGroupIcon className="h-4 w-4" />
                          {notification.group_name}
                        </span>
                      ) : notification.recipient_email ? (
                        <span className="text-sm text-gray-700">
                          {notification.recipient_name || notification.recipient_email}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 text-sm ${
                          notification.read_count > 0 ? 'text-green-600' : 'text-gray-500'
                        }`}>
                          {notification.read_count > 0 ? (
                            <EnvelopeOpenIcon className="h-4 w-4" />
                          ) : (
                            <EnvelopeIcon className="h-4 w-4" />
                          )}
                          {notification.read_count}/{notification.total_recipients}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDateShort(notification.sent_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => openDetailModal(notification)}
                        className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                      >
                        {t('common.details')}
                      </button>
                    </td>
                  </tr>
                  
                  {/* Expanded row with quick read receipts */}
                  {expandedRows.has(notification.id) && (
                    <tr className="bg-gray-50">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="text-sm">
                          <p className="font-medium text-gray-700 mb-2">
                            {t('notifications.sentBy')}: {notification.sent_by_email || t('notifications.system')}
                          </p>
                          <p className="text-gray-600 mb-2">{notification.body}</p>
                          {notification.total_recipients > 0 && (
                            <button
                              onClick={() => openDetailModal(notification)}
                              className="text-primary-600 hover:text-primary-700 text-sm"
                            >
                              {t('notifications.viewReadReceipts')} →
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal with Read Receipts */}
      <Transition appear show={showDetailModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowDetailModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-gray-900">
                        {selectedNotification?.title}
                      </Dialog.Title>
                      <p className="text-sm text-gray-500 mt-1">
                        Verzonden op {selectedNotification && formatDate(selectedNotification.sent_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowDetailModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  {selectedNotification && (
                    <div className="space-y-6">
                      {/* Message Content */}
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-gray-700">{selectedNotification.body}</p>
                        {selectedNotification.url && (
                          <p className="text-sm text-primary-600 mt-2">
                            Link: {selectedNotification.url}
                          </p>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <p className="page-title">
                            {selectedNotification.total_recipients}
                          </p>
                          <p className="text-xs text-gray-500">{t('notifications.recipients')}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <p className="text-2xl font-bold text-green-600">
                            {selectedNotification.read_count}
                          </p>
                          <p className="text-xs text-gray-500">{t('notifications.read')}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <p className="text-2xl font-bold text-gray-600">
                            {selectedNotification.total_recipients - selectedNotification.read_count}
                          </p>
                          <p className="text-xs text-gray-500">{t('notifications.unread')}</p>
                        </div>
                      </div>

                      {/* Read Receipts Table */}
                      {selectedNotification.read_receipts && selectedNotification.read_receipts.length > 0 ? (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">
                            {t('notifications.readReceipts')}
                          </h4>
                          <div className="max-h-64 overflow-y-auto border rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                                    {t('notifications.user')}
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                                    {t('common.status')}
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                                    {t('notifications.readAt')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {selectedNotification.read_receipts.map((receipt) => (
                                  <tr key={receipt.user_id}>
                                    <td className="px-3 py-2">
                                      <div>
                                        <p className="text-sm font-medium text-gray-900">
                                          {receipt.user_full_name}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          {receipt.user_email}
                                        </p>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      {receipt.is_read ? (
                                        <span className="inline-flex items-center gap-1 text-sm text-green-600">
                                          <CheckCircleIcon className="h-4 w-4" />
                                          {t('notifications.read')}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-sm text-gray-500">
                                          <ClockIcon className="h-4 w-4" />
                                          {t('notifications.unread')}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-gray-500">
                                      {receipt.read_at ? formatDate(receipt.read_at) : '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 text-center py-4">
                          {t('notifications.noReadReceipts')}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setShowDetailModal(false)}
                      className="btn-secondary"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Delete Confirmation Modal */}
      <Transition appear show={showDeleteModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => !deleting && setShowDeleteModal(false)}>
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
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                    </div>
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {t('notifications.deleteNotifications')}
                    </Dialog.Title>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm text-gray-600">
                      {t('notifications.deleteNotificationsConfirm', { count: selectedIds.size })}
                    </p>
                    <p className="mt-2 text-sm text-red-600">
                      {t('notifications.cannotBeUndone')}
                    </p>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(false)}
                      disabled={deleting}
                      className="btn-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={deleting}
                      className="btn-danger"
                    >
                      {deleting ? (
                        <>
                          <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                          {t('common.deleting')}
                        </>
                      ) : (
                        <>
                          <TrashIcon className="h-5 w-5 mr-2" />
                          {t('common.delete')}
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

      {/* Clear Old Notifications Modal */}
      <Transition appear show={showClearOldModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => !deleting && setShowClearOldModal(false)}>
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
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                      <TrashIcon className="h-5 w-5 text-yellow-600" />
                    </div>
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {t('notifications.cleanupOldNotifications')}
                    </Dialog.Title>
                  </div>

                  <div className="mt-4 space-y-4">
                    <p className="text-sm text-gray-600">
                      {t('notifications.cleanupDescription')}
                    </p>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('notifications.deleteOlderThan')}:
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={clearDays}
                          onChange={(e) => setClearDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))}
                          className="input-field w-24 text-center"
                        />
                        <span className="text-sm text-gray-600">{t('notifications.days')}</span>
                      </div>
                    </div>

                    <p className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg">
                      <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                      {t('notifications.cleanupWarning')}
                    </p>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowClearOldModal(false)}
                      disabled={deleting}
                      className="btn-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearOld}
                      disabled={deleting}
                      className="btn-danger"
                    >
                      {deleting ? (
                        <>
                          <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                          {t('notifications.cleaning')}
                        </>
                      ) : (
                        <>
                          <TrashIcon className="h-5 w-5 mr-2" />
                          {t('notifications.cleanup')}
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
