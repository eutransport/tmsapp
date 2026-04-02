/**
 * Leave Requests Admin Page
 * Admin interface for approving/rejecting/editing leave requests
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckIcon,
  XMarkIcon,
  TrashIcon,
  FunnelIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  PencilIcon,
  PlusIcon,
  UserIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import LeaveBalanceTab from './LeaveBalanceTab'
import {
  getAllLeaveRequests,
  adminLeaveAction,
  adminUpdateLeaveRequest,
  adminCreateLeaveRequest,
  getPublicHolidays,
  LeaveRequest,
  LeaveRequestCreate,
  AdminLeaveRequestCreate,
  LEAVE_TYPE_OPTIONS,
} from '@/api/leave'
import { getUsers } from '@/api/users'

const HOURS_PER_DAY = 8

function calculateWorkDays(startDate: string, endDate: string, holidayDates: Set<string>): number {
  if (!startDate || !endDate) return 0
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (start > end) return 0
  let workDays = 0
  const current = new Date(start)
  while (current <= end) {
    const day = current.getDay()
    const dateStr = current.toISOString().split('T')[0]
    if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) workDays++
    current.setDate(current.getDate() + 1)
  }
  return workDays
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

const getStatusBadges = (t: (key: string) => string) => ({
  pending: {
    icon: ClockIcon,
    label: t('leave.pending'),
    className: 'bg-yellow-100 text-yellow-700',
  },
  approved: {
    icon: CheckCircleIcon,
    label: t('leave.approved'),
    className: 'bg-green-100 text-green-700',
  },
  rejected: {
    icon: XCircleIcon,
    label: t('leave.rejected'),
    className: 'bg-red-100 text-red-700',
  },
  cancelled: {
    icon: XMarkIcon,
    label: t('leave.cancelled'),
    className: 'bg-gray-100 text-gray-700',
  },
})

export default function LeaveRequestsAdminPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'requests' | 'balances'>('requests')
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [filteredRequests, setFilteredRequests] = useState<LeaveRequest[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Edit modal state
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null)
  const [editForm, setEditForm] = useState<Partial<LeaveRequestCreate>>({})
  const [isSaving, setIsSaving] = useState(false)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [users, setUsers] = useState<Array<{ id: string; voornaam: string; achternaam: string; username: string }>>([])
  const [createForm, setCreateForm] = useState<AdminLeaveRequestCreate>({
    user_id: '',
    leave_type: 'vakantie',
    start_date: '',
    end_date: '',
    hours_requested: 8,
    reason: '',
    auto_approve: true,
  })
  const [isCreating, setIsCreating] = useState(false)

  // Public holidays
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchRequests()
    fetchUsers()
    
    // Load holidays for current and next year
    const currentYear = new Date().getFullYear()
    Promise.all([
      getPublicHolidays(currentYear),
      getPublicHolidays(currentYear + 1),
    ]).then(([thisYear, nextYear]) => {
      setHolidayDates(new Set([...thisYear, ...nextYear].map(h => h.date)))
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (statusFilter === 'all') {
      setFilteredRequests(requests)
    } else {
      setFilteredRequests(requests.filter(r => r.status === statusFilter))
    }
  }, [requests, statusFilter])

  const fetchRequests = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getAllLeaveRequests()
      // Sort by created_at descending (newest first)
      data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setRequests(data)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setIsLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const data = await getUsers({ page_size: 1000, is_active: 'true' })
      setUsers(data.results || [])
    } catch {
      // silently fail, users list optional
    }
  }

  const openCreateModal = () => {
    setCreateForm({
      user_id: '',
      leave_type: 'vakantie',
      start_date: '',
      end_date: '',
      hours_requested: 8,
      reason: '',
      auto_approve: true,
    })
    setShowCreateModal(true)
  }

  const handleCreate = async () => {
    if (!createForm.user_id) {
      setError('Selecteer een medewerker.')
      return
    }
    if (!createForm.start_date || !createForm.end_date) {
      setError('Vul start- en einddatum in.')
      return
    }
    setIsCreating(true)
    setError(null)
    try {
      await adminCreateLeaveRequest(createForm)
      setShowCreateModal(false)
      await fetchRequests()
      showSuccess(t('leave.requestCreated', 'Verlofaanvraag aangemaakt.'))
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('common.error'))
    } finally {
      setIsCreating(false)
    }
  }

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const handleAction = async (requestId: string, action: 'approve' | 'reject' | 'delete') => {
    setIsProcessing(requestId)
    setError(null)
    try {
      await adminLeaveAction(requestId, action)
      
      if (action === 'delete') {
        setRequests(requests.filter(r => r.id !== requestId))
        showSuccess(t('leave.requestDeleted'))
      } else {
        // Refetch to get updated status
        await fetchRequests()
        showSuccess(action === 'approve' ? t('leave.requestApproved') : t('leave.requestRejected'))
      }
    } catch (err: any) {
      setError(err.message || t('leave.actionError'))
    } finally {
      setIsProcessing(null)
    }
  }

  const openEditModal = (request: LeaveRequest) => {
    setEditingRequest(request)
    setEditForm({
      leave_type: request.leave_type,
      start_date: request.start_date,
      end_date: request.end_date,
      hours_requested: Number(request.hours_requested || request.hours),
      reason: request.reason || request.notes || '',
    })
  }

  const closeEditModal = () => {
    setEditingRequest(null)
    setEditForm({})
  }

  const handleSaveEdit = async () => {
    if (!editingRequest) return
    
    setIsSaving(true)
    setError(null)
    try {
      await adminUpdateLeaveRequest(editingRequest.id, editForm)
      await fetchRequests()
      closeEditModal()
      showSuccess(t('leave.requestUpdated'))
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || t('leave.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  const getLeaveTypeLabel = (type: string): string => {
    const option = LEAVE_TYPE_OPTIONS.find(o => o.value === type)
    return option?.label || type
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length
  const approvedCount = requests.filter(r => r.status === 'approved').length
  const rejectedCount = requests.filter(r => r.status === 'rejected').length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('leave.adminRequests')}</h1>
          <p className="text-gray-500">
            {pendingCount > 0 ? (
              <span className="text-yellow-600 font-medium">{t('leave.pendingRequests', { count: pendingCount })}</span>
            ) : (
              t('leave.allRequestsProcessed')
            )}
          </p>
        </div>
        {activeTab === 'requests' && (
          <button
            onClick={openCreateModal}
            className="btn btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            {t('leave.createRequest', 'Verlof aanmaken')}
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('requests')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'requests'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ClockIcon className="h-5 w-5" />
            Verlofaanvragen
          </button>
          <button
            onClick={() => setActiveTab('balances')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'balances'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <CalendarDaysIcon className="h-5 w-5" />
            Resterend Verlof
          </button>
        </nav>
      </div>

      {/* Balances Tab */}
      {activeTab === 'balances' && <LeaveBalanceTab />}

      {/* Requests Tab */}
      {activeTab === 'requests' && <>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {/* Filter */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <FunnelIcon className="w-5 h-5 text-gray-400" />
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all', label: t('common.all'), count: requests.length },
              { value: 'pending', label: t('leave.pending'), count: pendingCount },
              { value: 'approved', label: t('leave.approved'), count: approvedCount },
              { value: 'rejected', label: t('leave.rejected'), count: rejectedCount },
            ].map((filter) => (
              <button
                key={filter.value}
                onClick={() => setStatusFilter(filter.value as StatusFilter)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === filter.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {filter.label}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  statusFilter === filter.value 
                    ? 'bg-white/20' 
                    : filter.value === 'pending' && filter.count > 0
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-200'
                }`}>
                  {filter.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Requests List */}
      <div className="card">
        {filteredRequests.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ClockIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">{t('leave.noRequests')}</p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredRequests.map((request) => {
              const STATUS_BADGES = getStatusBadges(t)
              const statusInfo = STATUS_BADGES[request.status as keyof typeof STATUS_BADGES] || STATUS_BADGES.pending
              const StatusIcon = statusInfo.icon
              const isCurrentProcessing = isProcessing === request.id
              
              return (
                <div key={request.id} className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Request Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{request.user_naam}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500">{t('leave.leaveType')}:</span>{' '}
                          <span className="text-gray-900">{getLeaveTypeLabel(request.leave_type)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">{t('leave.period')}:</span>{' '}
                          <span className="text-gray-900">
                            {new Date(request.start_date).toLocaleDateString('nl-NL')}
                            {request.start_date !== request.end_date && (
                              <> - {new Date(request.end_date).toLocaleDateString('nl-NL')}</>
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">{t('leave.hours')}:</span>{' '}
                          <span className="text-gray-900 font-medium">{request.hours || request.hours_requested} {t('timeEntries.hour')}</span>
                        </div>
                      </div>
                      {(request.notes || request.reason) && (
                        <p className="text-sm text-gray-600 mt-2">
                          <span className="text-gray-500">{t('leave.comment')}:</span> {request.notes || request.reason}
                        </p>
                      )}
                      {request.admin_comment && (
                        <p className="text-sm text-gray-600 mt-1">
                          <span className="text-gray-500">{t('leave.adminComment')}:</span> {request.admin_comment}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        {t('leave.requestedOn')} {new Date(request.created_at).toLocaleString('nl-NL')}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {/* Edit button - visible for pending and approved */}
                      {(request.status === 'pending' || request.status === 'approved') && (
                        <button
                          onClick={() => openEditModal(request)}
                          className="btn btn-secondary flex items-center gap-2"
                          title={t('common.edit')}
                        >
                          <PencilIcon className="w-4 h-4" />
                          {t('common.edit')}
                        </button>
                      )}
                      
                      {request.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleAction(request.id, 'approve')}
                            disabled={isCurrentProcessing}
                            className="btn btn-primary flex items-center gap-2"
                          >
                            <CheckIcon className="w-4 h-4" />
                            {t('leave.approve')}
                          </button>
                          <button
                            onClick={() => handleAction(request.id, 'reject')}
                            disabled={isCurrentProcessing}
                            className="btn btn-secondary flex items-center gap-2"
                          >
                            <XMarkIcon className="w-4 h-4" />
                            {t('leave.reject')}
                          </button>
                        </>
                      )}
                      {request.status === 'approved' && (
                        <button
                          onClick={() => {
                            if (confirm(t('leave.deleteConfirmation'))) {
                              handleAction(request.id, 'delete')
                            }
                          }}
                          disabled={isCurrentProcessing}
                          className="btn btn-secondary flex items-center gap-2 text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="w-4 h-4" />
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingRequest && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/30" onClick={closeEditModal} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {t('leave.editRequest')}
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                {editingRequest.user_naam}
              </p>
              
              <div className="space-y-4">
                {/* Leave Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.leaveType')}
                  </label>
                  <select
                    value={editForm.leave_type || ''}
                    onChange={(e) => setEditForm({ ...editForm, leave_type: e.target.value as any })}
                    className="input w-full"
                  >
                    {LEAVE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('leave.startDate')}
                    </label>
                    <input
                      type="date"
                      value={editForm.start_date || ''}
                      onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('leave.endDate')}
                    </label>
                    <input
                      type="date"
                      value={editForm.end_date || ''}
                      onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                      className="input w-full"
                    />
                  </div>
                </div>

                {/* Hours */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.hoursRequested')}
                  </label>
                  <input
                    type="number"
                    value={editForm.hours_requested || 0}
                    onChange={(e) => setEditForm({ ...editForm, hours_requested: parseFloat(e.target.value) || 0 })}
                    min="0.5"
                    step="0.5"
                    className="input w-full"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.comment')}
                  </label>
                  <textarea
                    value={editForm.reason || ''}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                    rows={2}
                    className="input w-full"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={closeEditModal}
                  className="btn btn-secondary"
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/30" onClick={() => setShowCreateModal(false)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <UserIcon className="w-5 h-5" />
                {t('leave.createRequest', 'Verlof aanmaken')}
              </h2>
              
              <div className="space-y-4">
                {/* User Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.employee', 'Medewerker')}
                  </label>
                  <select
                    value={createForm.user_id}
                    onChange={(e) => setCreateForm({ ...createForm, user_id: e.target.value })}
                    className="input w-full"
                  >
                    <option value="">{t('leave.selectEmployee', 'Selecteer medewerker...')}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.voornaam && user.achternaam
                          ? `${user.voornaam} ${user.achternaam}`
                          : user.username}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Leave Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.leaveType')}
                  </label>
                  <select
                    value={createForm.leave_type}
                    onChange={(e) => setCreateForm({ ...createForm, leave_type: e.target.value as any })}
                    className="input w-full"
                  >
                    {LEAVE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('leave.startDate')}
                    </label>
                    <input
                      type="date"
                      value={createForm.start_date}
                      onChange={(e) => {
                        const start = e.target.value
                        const end = createForm.end_date || start
                        const hours = calculateWorkDays(start, end, holidayDates) * HOURS_PER_DAY
                        setCreateForm({ ...createForm, start_date: start, end_date: end, hours_requested: hours })
                      }}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('leave.endDate')}
                    </label>
                    <input
                      type="date"
                      value={createForm.end_date}
                      onChange={(e) => {
                        const end = e.target.value
                        const hours = calculateWorkDays(createForm.start_date, end, holidayDates) * HOURS_PER_DAY
                        setCreateForm({ ...createForm, end_date: end, hours_requested: hours })
                      }}
                      min={createForm.start_date}
                      className="input w-full"
                    />
                  </div>
                </div>

                {/* Hours */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.hoursRequested')}
                  </label>
                  <input
                    type="number"
                    value={createForm.hours_requested}
                    onChange={(e) => setCreateForm({ ...createForm, hours_requested: parseFloat(e.target.value) || 0 })}
                    min="0.5"
                    step="0.5"
                    className="input w-full"
                  />
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('leave.comment')}
                  </label>
                  <textarea
                    value={createForm.reason || ''}
                    onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                    rows={2}
                    className="input w-full"
                    placeholder={t('leave.reasonPlaceholder', 'Reden (optioneel)...')}
                  />
                </div>

                {/* Auto Approve */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="auto-approve"
                    checked={createForm.auto_approve}
                    onChange={(e) => setCreateForm({ ...createForm, auto_approve: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="auto-approve" className="text-sm text-gray-700">
                    {t('leave.autoApprove', 'Direct goedkeuren en uren inhouden')}
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                  disabled={isCreating}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreate}
                  className="btn btn-primary flex items-center gap-2"
                  disabled={isCreating || !createForm.user_id}
                >
                  {isCreating ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <PlusIcon className="w-4 h-4" />
                  )}
                  {isCreating ? t('common.saving') : t('leave.createRequest', 'Verlof aanmaken')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
