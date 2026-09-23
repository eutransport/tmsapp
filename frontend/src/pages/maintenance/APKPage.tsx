import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { APKRecord, APKCountdown, APKSettings, User, Vehicle } from '@/types'
import {
  getAPKRecords,
  getAPKCountdown,
  createAPKRecord,
  deleteAPKRecord,
  renewAPK,
  getAPKSettings,
  updateAPKSettings,
  APKFilters,
  APKSettingsPayload,
} from '@/api/maintenance'
import { getAllVehicles } from '@/api/fleet'
import { getUsers } from '@/api/users'
import { listEmailProfiles, EmailProfile } from '@/api/emailProfiles'
import { useAuthStore } from '@/stores/authStore'
import LicensePlate from '@/components/common/LicensePlate'
import Pagination, { PageSize } from '@/components/common/Pagination'

// Modal component
function Modal({ isOpen, onClose, title, children, size = 'md' }: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg'
}) {
  if (!isOpen) return null
  const sizeClasses = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative bg-white rounded-xl shadow-xl w-full ${sizeClasses[size]} transform transition-all`}>
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default function APKPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const isAdmin = user?.rol === 'admin'
  const [countdowns, setCountdowns] = useState<APKCountdown[]>([])
  const [records, setRecords] = useState<APKRecord[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [settings, setSettings] = useState<APKSettings | null>(null)
  const [emailProfiles, setEmailProfiles] = useState<EmailProfile[]>([])
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'countdown' | 'records'>('countdown')

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [sortField, setSortField] = useState('expiry_date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showRenewModal, setShowRenewModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<APKRecord | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)

  const fetchCountdowns = useCallback(async () => {
    try {
      const data = await getAPKCountdown()
      setCountdowns(data)
    } catch { /* ignore */ }
  }, [])

  const fetchRecords = useCallback(async () => {
    setIsLoading(true)
    try {
      const filters: APKFilters = {
        page,
        page_size: pageSize,
        ordering: `${sortDirection === 'desc' ? '-' : ''}${sortField}`,
      }
      if (search) filters.search = search
      if (statusFilter) filters.status = statusFilter
      const data = await getAPKRecords(filters)
      setRecords(data.results)
      setTotalCount(data.count)
    } catch {
      setError(t('common.error'))
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, sortField, sortDirection, search, statusFilter, t])

  const fetchVehicles = useCallback(async () => {
    try {
      const data = await getAllVehicles()
      setVehicles(data)
    } catch { /* ignore */ }

    try {
      const userData = await getUsers({ is_active: 'true', page_size: 200, ordering: 'voornaam' })
      setUsers(userData.results.filter(u => !!u.email))
    } catch { /* selectielijst is niet kritiek */ }

    try {
      setSettings(await getAPKSettings())
    } catch { /* instellingen zijn optioneel voor het overzicht */ }

    try {
      setEmailProfiles(await listEmailProfiles())
    } catch { /* alleen nodig voor het instellingenscherm */ }
  }, [])

  const handleSaveSettings = async (data: APKSettingsPayload) => {
    setIsActionLoading(true)
    try {
      setSettings(await updateAPKSettings(data))
      setShowSettingsModal(false)
      setSuccessMessage(t('maintenance.apk.settingsSaved'))
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  useEffect(() => { fetchCountdowns(); fetchVehicles() }, [fetchCountdowns, fetchVehicles])
  useEffect(() => { fetchRecords() }, [fetchRecords])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ChevronUpIcon className="w-4 h-4 inline" />
      : <ChevronDownIcon className="w-4 h-4 inline" />
  }

  const handleCreate = async (data: Partial<APKRecord>) => {
    setIsActionLoading(true)
    try {
      await createAPKRecord(data)
      setShowCreateModal(false)
      setSuccessMessage(t('maintenance.apk.created'))
      fetchRecords()
      fetchCountdowns()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const handleRenew = async (data: { inspection_date: string; expiry_date: string; cost?: string }) => {
    if (!selectedRecord) return
    setIsActionLoading(true)
    try {
      await renewAPK(selectedRecord.id, data)
      setShowRenewModal(false)
      setSelectedRecord(null)
      setSuccessMessage(t('maintenance.apk.renewed'))
      fetchRecords()
      fetchCountdowns()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const handleDelete = async () => {
    if (!selectedRecord) return
    setIsActionLoading(true)
    try {
      await deleteAPKRecord(selectedRecord.id)
      setShowDeleteModal(false)
      setSelectedRecord(null)
      setSuccessMessage(t('maintenance.apk.deleted'))
      fetchRecords()
      fetchCountdowns()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const getCountdownBg = (status: string) => {
    switch (status) {
      case 'expired': return 'bg-red-500 text-white'
      case 'urgent': return 'bg-red-100 text-red-800'
      case 'critical': return 'bg-orange-100 text-orange-800'
      case 'warning': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-green-100 text-green-800'
    }
  }

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      passed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      expired: 'bg-red-100 text-red-800',
      scheduled: 'bg-blue-100 text-blue-800',
      exempted: 'bg-gray-100 text-gray-800',
    }
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${classes[status] || 'bg-gray-100 text-gray-800'}`}>
        {t(`maintenance.apk.status.${status}`)}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/maintenance" className="hover:text-primary-600 flex items-center gap-1">
          <WrenchScrewdriverIcon className="w-4 h-4" />
          {t('maintenance.title')}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{t('maintenance.apk.title')}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheckIcon className="w-7 h-7 text-primary-600" />
            {t('maintenance.apk.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('maintenance.apk.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowSettingsModal(true)}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2"
            >
              <Cog6ToothIcon className="w-5 h-5" />
              {t('maintenance.apk.settings')}
            </button>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            {t('maintenance.apk.newRecord')}
          </button>
        </div>
      </div>

      {/* Success/Error messages */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircleIcon className="w-5 h-5" />
          {successMessage}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <XCircleIcon className="w-5 h-5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('countdown')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'countdown'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ClockIcon className="w-4 h-4 inline mr-1" />
            {t('maintenance.apk.countdown')}
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'records'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ShieldCheckIcon className="w-4 h-4 inline mr-1" />
            {t('maintenance.apk.records')}
          </button>
        </div>
      </div>

      {/* Countdown Tab */}
      {activeTab === 'countdown' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {countdowns.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500">
              {t('maintenance.apk.noRecords')}
            </div>
          ) : (
            countdowns.map((apk) => (
              <div
                key={apk.id}
                className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow p-4 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <LicensePlate kenteken={apk.vehicle_kenteken} size="md" />
                </div>
                <div className="text-xs text-gray-500">{apk.vehicle_type || '—'} {apk.bedrijf_naam ? `• ${apk.bedrijf_naam}` : ''}</div>
                <div className="flex items-center justify-between mt-auto">
                  <div>
                    <div className="text-xs text-gray-500">{t('maintenance.apk.expiryDate')}</div>
                    <div className="font-medium text-gray-900">
                      {new Date(apk.expiry_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${getCountdownBg(apk.countdown_status)}`}>
                    {apk.days_until_expiry > 0
                      ? `${apk.days_until_expiry}d`
                      : t('maintenance.apk.expired')
                    }
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Records Tab */}
      {activeTab === 'records' && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder={t('maintenance.apk.searchPlaceholder')}
                className="input pl-10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="input w-auto"
            >
              <option value="">{t('common.all')}</option>
              <option value="passed">{t('maintenance.apk.status.passed')}</option>
              <option value="failed">{t('maintenance.apk.status.failed')}</option>
              <option value="scheduled">{t('maintenance.apk.status.scheduled')}</option>
              <option value="expired">{t('maintenance.apk.status.expired')}</option>
            </select>
            <button
              onClick={() => { fetchRecords(); fetchCountdowns() }}
              className="btn-secondary flex items-center gap-1"
            >
              <ArrowPathIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('vehicle__kenteken')}>
                      {t('fleet.licensePlate')} <SortIcon field="vehicle__kenteken" />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('expiry_date')}>
                      {t('maintenance.apk.expiryDate')} <SortIcon field="expiry_date" />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('maintenance.apk.daysLeft')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('maintenance.apk.station')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('maintenance.apk.cost')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{t('common.loading')}</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">{t('maintenance.apk.noRecords')}</td></tr>
                  ) : (
                    records.map((record) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <LicensePlate kenteken={record.vehicle_kenteken} size="sm" />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {new Date(record.expiry_date).toLocaleDateString('nl-NL')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${getCountdownBg(record.countdown_status)}`}>
                            {record.days_until_expiry > 0 ? `${record.days_until_expiry}d` : t('maintenance.apk.expired')}
                          </span>
                        </td>
                        <td className="px-4 py-3">{getStatusBadge(record.status)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{record.inspection_station || '—'}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900">
                          {record.cost ? `€ ${parseFloat(record.cost).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setSelectedRecord(record); setShowRenewModal(true) }}
                              className="p-2 text-gray-500 hover:text-green-600 hover:bg-gray-100 rounded"
                              title={t('maintenance.apk.renew')}
                            >
                              <ArrowPathIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setSelectedRecord(record); setShowDeleteModal(true) }}
                              className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                              title={t('common.delete')}
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y">
              {isLoading ? (
                <div className="p-6 text-center text-gray-500">{t('common.loading')}</div>
              ) : records.length === 0 ? (
                <div className="p-6 text-center text-gray-500">{t('maintenance.apk.noRecords')}</div>
              ) : (
                records.map((record) => (
                  <div key={record.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between mb-3">
                      <LicensePlate kenteken={record.vehicle_kenteken} size="sm" />
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${getCountdownBg(record.countdown_status)}`}>
                        {record.days_until_expiry > 0 ? `${record.days_until_expiry}d` : t('maintenance.apk.expired')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">{t('maintenance.apk.expiryDate')}: </span>
                        <span className="font-medium">{new Date(record.expiry_date).toLocaleDateString('nl-NL')}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">{t('common.status')}: </span>
                        {getStatusBadge(record.status)}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        onClick={() => { setSelectedRecord(record); setShowRenewModal(true) }}
                        className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100"
                      >
                        {t('maintenance.apk.renew')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalCount > pageSize && (
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(totalCount / pageSize)}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />
          )}
        </>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title={t('maintenance.apk.newRecord')} size="lg">
        <APKForm
          vehicles={vehicles}
          users={users}
          settings={settings}
          onSave={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Settings Modal */}
      <Modal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} title={t('maintenance.apk.settingsTitle')} size="lg">
        <APKSettingsForm
          settings={settings}
          users={users}
          profiles={emailProfiles}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettingsModal(false)}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Renew Modal */}
      <Modal isOpen={showRenewModal} onClose={() => { setShowRenewModal(false); setSelectedRecord(null) }} title={t('maintenance.apk.renew')} size="md">
        <RenewForm record={selectedRecord} onSave={handleRenew} onCancel={() => { setShowRenewModal(false); setSelectedRecord(null) }} isLoading={isActionLoading} t={t} />
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setSelectedRecord(null) }} title={t('common.delete')} size="sm">
        <p className="text-gray-600 mb-6">{t('maintenance.apk.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => { setShowDeleteModal(false); setSelectedRecord(null) }} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
            {t('common.cancel')}
          </button>
          <button onClick={handleDelete} className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50" disabled={isActionLoading}>
            {isActionLoading ? t('common.deleting') : t('common.delete')}
          </button>
        </div>
      </Modal>
    </div>
  )
}

// APK Form
function APKForm({ vehicles, users, settings, onSave, onCancel, isLoading, t }: {
  vehicles: Vehicle[]
  users: User[]
  settings: APKSettings | null
  onSave: (data: Partial<APKRecord>) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [formData, setFormData] = useState({
    vehicle: '',
    inspection_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    status: 'valid',
    passed: true,
    inspection_station: '',
    cost: '',
    remarks: '',
  })
  // Nieuwe keuring? Dan de standaard ontvangers uit de instellingen voorvullen.
  const [notifyUsers, setNotifyUsers] = useState<string[]>([])
  const [extraEmails, setExtraEmails] = useState('')

  useEffect(() => {
    if (settings) {
      setNotifyUsers(settings.default_notify_users || [])
      setExtraEmails((settings.default_notify_extra_emails || []).join(', '))
    }
  }, [settings])

  const toggleUser = (id: string, aan: boolean) => {
    setNotifyUsers(prev => (aan ? [...prev, id] : prev.filter(u => u !== id)))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      ...formData,
      cost: formData.cost || undefined,
      notify_users: notifyUsers,
      notify_extra_emails: extraEmails.split(/[,;\s]+/).map(a => a.trim()).filter(Boolean),
    } as Partial<APKRecord>)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('fleet.licensePlate')} *</label>
        <select name="vehicle" value={formData.vehicle} onChange={handleChange} className="input" required>
          <option value="">{t('maintenance.apk.selectVehicle')}</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.kenteken} — {v.type_wagen || v.ritnummer}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.inspectionDate')} *</label>
          <input type="date" name="inspection_date" value={formData.inspection_date} onChange={handleChange} className="input" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.expiryDate')} *</label>
          <input type="date" name="expiry_date" value={formData.expiry_date} onChange={handleChange} className="input" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.status')}</label>
          <select name="status" value={formData.status} onChange={handleChange} className="input">
            <option value="valid">{t('maintenance.apk.status.valid')}</option>
            <option value="pending">{t('maintenance.apk.status.scheduled')}</option>
            <option value="failed">{t('maintenance.apk.status.failed')}</option>
            <option value="expired">{t('maintenance.apk.status.expired')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.cost')}</label>
          <input type="number" step="0.01" name="cost" value={formData.cost} onChange={handleChange} placeholder="0.00" className="input" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.station')}</label>
        <input type="text" name="inspection_station" value={formData.inspection_station} onChange={handleChange} className="input" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.notes')}</label>
        <textarea name="remarks" value={formData.remarks} onChange={handleChange} className="input" rows={2} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.notifyTo')}</label>
        <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
          {users.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">—</p>
          ) : (
            users.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={notifyUsers.includes(u.id)}
                  onChange={(e) => toggleUser(u.id, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {u.full_name || u.email} <span className="text-gray-500">({u.email})</span>
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('maintenance.apk.notifyHint')}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.extraEmails')}</label>
        <input
          type="text"
          value={extraEmails}
          onChange={(e) => setExtraEmails(e.target.value)}
          placeholder="naam@bedrijf.nl, tweede@bedrijf.nl"
          className="input"
        />
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200" disabled={isLoading}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

/** Instellingen voor de APK-herinneringen: verzendtijd en standaard ontvangers. */
function APKSettingsForm({ settings, users, profiles, onSave, onCancel, isLoading, t }: {
  settings: APKSettings | null
  users: User[]
  profiles: EmailProfile[]
  onSave: (data: APKSettingsPayload) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [emailProfile, setEmailProfile] = useState(settings?.email_profile || '')
  const [tijd, setTijd] = useState(
    `${String(settings?.send_hour ?? 6).padStart(2, '0')}:${String(settings?.send_minute ?? 0).padStart(2, '0')}`
  )
  const [defaultUsers, setDefaultUsers] = useState<string[]>(settings?.default_notify_users || [])
  const [defaultExtra, setDefaultExtra] = useState((settings?.default_notify_extra_emails || []).join(', '))

  const toggleUser = (id: string, aan: boolean) => {
    setDefaultUsers(prev => (aan ? [...prev, id] : prev.filter(u => u !== id)))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const [uur, minuut] = tijd.split(':')
    onSave({
      email_profile: emailProfile || null,
      send_hour: Number(uur),
      send_minute: Number(minuut),
      default_notify_users: defaultUsers,
      default_notify_extra_emails: defaultExtra.split(/[,;\s]+/).map(a => a.trim()).filter(Boolean),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.sendAccount')}</label>
          <select value={emailProfile} onChange={(e) => setEmailProfile(e.target.value)} className="input">
            <option value="">{t('maintenance.apk.sendAccountDefault')}</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.smtp_from_email ? ` (${p.smtp_from_email})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.sendTime')}</label>
          <input type="time" value={tijd} onChange={(e) => setTijd(e.target.value)} className="input" required />
          <p className="mt-1 text-xs text-gray-500">{t('maintenance.apk.sendTimeHint')}</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.defaultRecipients')}</label>
        <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
          {users.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">—</p>
          ) : (
            users.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={defaultUsers.includes(u.id)}
                  onChange={(e) => toggleUser(u.id, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {u.full_name || u.email} <span className="text-gray-500">({u.email})</span>
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('maintenance.apk.defaultRecipientsHint')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.defaultExtraEmails')}</label>
        <input
          type="text"
          value={defaultExtra}
          onChange={(e) => setDefaultExtra(e.target.value)}
          placeholder="naam@bedrijf.nl, tweede@bedrijf.nl"
          className="input"
        />
      </div>

      {settings?.last_run_on && (
        <p className="text-xs text-gray-500">
          {t('maintenance.apk.lastRun')}: {new Date(settings.last_run_on).toLocaleDateString('nl-NL')}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200" disabled={isLoading}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

// Renew Form
function RenewForm({ record, onSave, onCancel, isLoading, t }: {
  record: APKRecord | null
  onSave: (data: { inspection_date: string; expiry_date: string; cost?: string }) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [formData, setFormData] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    cost: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      inspection_date: formData.inspection_date,
      expiry_date: formData.expiry_date,
      cost: formData.cost || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {record && (
        <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
          <LicensePlate kenteken={record.vehicle_kenteken} size="md" />
          <div className="text-sm text-gray-600">
            {t('maintenance.apk.currentExpiry')}: <span className="font-medium">{new Date(record.expiry_date).toLocaleDateString('nl-NL')}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.newInspectionDate')} *</label>
          <input type="date" name="inspection_date" value={formData.inspection_date} onChange={handleChange} className="input" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.newExpiryDate')} *</label>
          <input type="date" name="expiry_date" value={formData.expiry_date} onChange={handleChange} className="input" required />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.apk.cost')}</label>
        <input type="number" step="0.01" name="cost" value={formData.cost} onChange={handleChange} placeholder="0.00" className="input" />
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200" disabled={isLoading}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? t('common.saving') : t('maintenance.apk.renew')}
        </button>
      </div>
    </form>
  )
}
