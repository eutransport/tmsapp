import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  XMarkIcon,
  PencilSquareIcon,
  TrashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  BellAlertIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { ADRRecord, ADRSettings, User, Vehicle } from '@/types'
import {
  getADRRecords,
  createADRRecord,
  updateADRRecord,
  deleteADRRecord,
  getADRSettings,
  updateADRSettings,
  ADRFilters,
  ADRPayload,
  ADRSettingsPayload,
} from '@/api/maintenance'
import { getAllVehicles } from '@/api/fleet'
import { getUsers } from '@/api/users'
import { listEmailProfiles, EmailProfile } from '@/api/emailProfiles'
import { useAuthStore } from '@/stores/authStore'
import LicensePlate from '@/components/common/LicensePlate'
import Pagination, { PageSize } from '@/components/common/Pagination'

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
          <div className="p-4 max-h-[75vh] overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Vinkje of kruisje in de tabel, zodat een rij in een oogopslag te lezen is. */
function BoolCell({ value }: { value: boolean }) {
  return value
    ? <CheckCircleIcon className="w-5 h-5 text-green-600" />
    : <XCircleIcon className="w-5 h-5 text-gray-300" />
}

export default function ADRPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const isAdmin = user?.rol === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightId = searchParams.get('record')

  const [records, setRecords] = useState<ADRRecord[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [settings, setSettings] = useState<ADRSettings | null>(null)
  const [emailProfiles, setEmailProfiles] = useState<EmailProfile[]>([])
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [sortField, setSortField] = useState('next_inspection_date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const [showFormModal, setShowFormModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<ADRRecord | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)

  const fetchRecords = useCallback(async () => {
    setIsLoading(true)
    try {
      const filters: ADRFilters = {
        page,
        page_size: pageSize,
        ordering: `${sortDirection === 'desc' ? '-' : ''}${sortField}`,
      }
      if (search) filters.search = search
      const data = await getADRRecords(filters)
      setRecords(data.results)
      setTotalCount(data.count)
    } catch {
      setError(t('common.error'))
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, sortField, sortDirection, search, t])

  const fetchLookups = useCallback(async () => {
    try {
      const [vehicleData, userData] = await Promise.all([
        getAllVehicles(),
        getUsers({ is_active: 'true', page_size: 200, ordering: 'voornaam' }),
      ])
      setVehicles(vehicleData)
      setUsers(userData.results.filter(u => !!u.email))
    } catch { /* selectielijsten zijn niet kritiek */ }

    try {
      setSettings(await getADRSettings())
    } catch { /* instellingen zijn optioneel voor het overzicht */ }

    try {
      setEmailProfiles(await listEmailProfiles())
    } catch { /* alleen nodig voor het configscherm */ }
  }, [])

  useEffect(() => { fetchLookups() }, [fetchLookups])
  useEffect(() => { fetchRecords() }, [fetchRecords])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
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

  const handleSave = async (data: ADRPayload) => {
    setIsActionLoading(true)
    try {
      if (selectedRecord) {
        await updateADRRecord(selectedRecord.id, data)
        setSuccessMessage(t('maintenance.adr.updated'))
      } else {
        await createADRRecord(data)
        setSuccessMessage(t('maintenance.adr.created'))
      }
      setShowFormModal(false)
      setSelectedRecord(null)
      fetchRecords()
    } catch (err: any) {
      const detail = err?.response?.data
      const eerste = detail && typeof detail === 'object' ? Object.values(detail)[0] : null
      setError(Array.isArray(eerste) ? String(eerste[0]) : t('common.error'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleSaveSettings = async (data: ADRSettingsPayload) => {
    setIsActionLoading(true)
    try {
      setSettings(await updateADRSettings(data))
      setShowSettingsModal(false)
      setSuccessMessage(t('maintenance.adr.settingsSaved'))
    } catch (err: any) {
      const detail = err?.response?.data
      const eerste = detail && typeof detail === 'object' ? Object.values(detail)[0] : null
      setError(Array.isArray(eerste) ? String(eerste[0]) : t('common.error'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedRecord) return
    setIsActionLoading(true)
    try {
      await deleteADRRecord(selectedRecord.id)
      setShowDeleteModal(false)
      setSelectedRecord(null)
      setSuccessMessage(t('maintenance.adr.deleted'))
      fetchRecords()
    } catch {
      setError(t('common.error'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const getCountdownBg = (status: string) => {
    switch (status) {
      case 'expired': return 'bg-red-500 text-white'
      case 'critical': return 'bg-red-100 text-red-800'
      case 'warning': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-green-100 text-green-800'
    }
  }

  const daysLabel = (record: ADRRecord) => {
    if (record.days_remaining === null) return '—'
    return record.days_remaining >= 0
      ? `${record.days_remaining}d`
      : t('maintenance.adr.expired')
  }

  const recipientsLabel = (record: ADRRecord) => {
    const namen = record.notify_users_detail.map(u => u.naam)
    const extra = record.notify_extra_emails || []
    const alles = [...namen, ...extra]
    return alles.length > 0 ? alles.join(', ') : '—'
  }

  const formatDate = (value: string) => new Date(value).toLocaleDateString('nl-NL')

  const openCreate = () => { setSelectedRecord(null); setShowFormModal(true) }
  const openEdit = (record: ADRRecord) => { setSelectedRecord(record); setShowFormModal(true) }

  const clearHighlight = () => {
    if (!highlightId) return
    const params = new URLSearchParams(searchParams)
    params.delete('record')
    setSearchParams(params, { replace: true })
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
        <span className="text-gray-900 font-medium">{t('maintenance.adr.title')}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ExclamationTriangleIcon className="w-7 h-7 text-primary-600" />
            {t('maintenance.adr.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('maintenance.adr.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowSettingsModal(true)}
              className="btn-secondary flex items-center justify-center gap-2"
            >
              <Cog6ToothIcon className="w-5 h-5" />
              {t('maintenance.adr.settings')}
            </button>
          )}
          <button onClick={openCreate} className="btn-primary flex items-center justify-center gap-2">
            <PlusIcon className="w-5 h-5" />
            {t('maintenance.adr.newRecord')}
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircleIcon className="w-5 h-5" />
          {successMessage}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <XCircleIcon className="w-5 h-5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {highlightId && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
          <BellAlertIcon className="w-5 h-5 shrink-0" />
          <span className="flex-1">{t('maintenance.adr.reminderInfo')}</span>
          <button onClick={clearHighlight}><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder={t('maintenance.adr.searchPlaceholder')}
            className="input pl-10"
          />
        </div>
        <button onClick={() => fetchRecords()} className="btn-secondary flex items-center justify-center gap-1">
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('vehicle__kenteken')}>
                  {t('maintenance.adr.vehicle')} <SortIcon field="vehicle__kenteken" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('maintenance.adr.route')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('maintenance.adr.hasAdr')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('maintenance.adr.caseSealed')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('inspection_date')}>
                  {t('maintenance.adr.inspectionDate')} <SortIcon field="inspection_date" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer" onClick={() => handleSort('next_inspection_date')}>
                  {t('maintenance.adr.nextInspectionDate')} <SortIcon field="next_inspection_date" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('maintenance.adr.daysLeft')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('maintenance.adr.notifyTo')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">{t('common.loading')}</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">{t('maintenance.adr.noRecords')}</td></tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className={`hover:bg-gray-50 ${record.id === highlightId ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-2">
                      <LicensePlate kenteken={record.vehicle_kenteken} size="sm" />
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-900">{record.route || '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-center"><BoolCell value={record.has_adr} /></div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-center"><BoolCell value={record.case_sealed} /></div>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{formatDate(record.inspection_date)}</td>
                    <td className="px-4 py-2 text-sm text-gray-900">{formatDate(record.next_inspection_date)}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${getCountdownBg(record.countdown_status)}`}>
                        {daysLabel(record)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600 max-w-[16rem] truncate" title={recipientsLabel(record)}>
                      {recipientsLabel(record)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(record)}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title={t('common.edit')}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedRecord(record); setShowDeleteModal(true) }}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                          title={t('common.delete')}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobiel / tablet */}
        <div className="lg:hidden divide-y">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">{t('common.loading')}</div>
          ) : records.length === 0 ? (
            <div className="p-6 text-center text-gray-500">{t('maintenance.adr.noRecords')}</div>
          ) : (
            records.map((record) => (
              <div key={record.id} className={`p-4 ${record.id === highlightId ? 'bg-blue-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <LicensePlate kenteken={record.vehicle_kenteken} size="sm" />
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${getCountdownBg(record.countdown_status)}`}>
                    {daysLabel(record)}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-gray-500">{t('maintenance.adr.route')}</dt>
                  <dd className="text-gray-900 text-right">{record.route || '—'}</dd>
                  <dt className="text-gray-500">{t('maintenance.adr.hasAdr')}</dt>
                  <dd className="flex justify-end"><BoolCell value={record.has_adr} /></dd>
                  <dt className="text-gray-500">{t('maintenance.adr.caseSealed')}</dt>
                  <dd className="flex justify-end"><BoolCell value={record.case_sealed} /></dd>
                  <dt className="text-gray-500">{t('maintenance.adr.inspectionDate')}</dt>
                  <dd className="text-gray-900 text-right">{formatDate(record.inspection_date)}</dd>
                  <dt className="text-gray-500">{t('maintenance.adr.nextInspectionDate')}</dt>
                  <dd className="text-gray-900 text-right">{formatDate(record.next_inspection_date)}</dd>
                  <dt className="text-gray-500">{t('maintenance.adr.notifyTo')}</dt>
                  <dd className="text-gray-900 text-right truncate">{recipientsLabel(record)}</dd>
                </dl>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => openEdit(record)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => { setSelectedRecord(record); setShowDeleteModal(true) }}
                    className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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

      {/* Aanmaken / bewerken */}
      <Modal
        isOpen={showFormModal}
        onClose={() => { setShowFormModal(false); setSelectedRecord(null) }}
        title={selectedRecord ? t('maintenance.adr.editRecord') : t('maintenance.adr.newRecord')}
        size="lg"
      >
        <ADRForm
          record={selectedRecord}
          vehicles={vehicles}
          users={users}
          settings={settings}
          onSave={handleSave}
          onCancel={() => { setShowFormModal(false); setSelectedRecord(null) }}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Configuratie */}
      <Modal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title={t('maintenance.adr.settings')}
        size="lg"
      >
        <ADRSettingsForm
          settings={settings}
          users={users}
          profiles={emailProfiles}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettingsModal(false)}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Verwijderen */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedRecord(null) }}
        title={t('common.delete')}
        size="sm"
      >
        <p className="text-gray-600 mb-6">{t('maintenance.adr.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => { setShowDeleteModal(false); setSelectedRecord(null) }}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={isActionLoading}
            className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {isActionLoading ? t('common.deleting') : t('common.delete')}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function ADRForm({ record, vehicles, users, settings, onSave, onCancel, isLoading, t }: {
  record: ADRRecord | null
  vehicles: Vehicle[]
  users: User[]
  settings: ADRSettings | null
  onSave: (data: ADRPayload) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const vandaag = new Date().toISOString().split('T')[0]
  const [vehicle, setVehicle] = useState(record?.vehicle || '')
  const [route, setRoute] = useState(record?.route || '')
  const [hasAdr, setHasAdr] = useState(record ? record.has_adr : true)
  const [caseSealed, setCaseSealed] = useState(record ? record.case_sealed : false)
  const [inspectionDate, setInspectionDate] = useState(record?.inspection_date || vandaag)
  const [nextInspectionDate, setNextInspectionDate] = useState(record?.next_inspection_date || '')
  // Nieuwe regel? Dan de standaard ontvangers uit de instellingen voorvullen.
  const [notifyUsers, setNotifyUsers] = useState<string[]>(
    record?.notify_users || settings?.default_notify_users || []
  )
  const [extraEmails, setExtraEmails] = useState(
    (record ? record.notify_extra_emails : settings?.default_notify_extra_emails || []).join(', ')
  )
  const [remarks, setRemarks] = useState(record?.remarks || '')

  const actieveVoertuigen = useMemo(
    () => vehicles.filter(v => v.actief !== false || v.id === record?.vehicle),
    [vehicles, record]
  )

  const handleVehicleChange = (id: string) => {
    setVehicle(id)
    // Route standaard overnemen uit de vloot; handmatig aanpassen blijft mogelijk.
    const gekozen = vehicles.find(v => v.id === id)
    if (gekozen && !route) setRoute(gekozen.ritnummer || '')
  }

  const toggleUser = (id: string, aan: boolean) => {
    setNotifyUsers(prev => (aan ? [...prev, id] : prev.filter(u => u !== id)))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      vehicle,
      route,
      has_adr: hasAdr,
      case_sealed: caseSealed,
      inspection_date: inspectionDate,
      next_inspection_date: nextInspectionDate,
      notify_users: notifyUsers,
      notify_extra_emails: extraEmails
        .split(/[,;\s]+/)
        .map(a => a.trim())
        .filter(Boolean),
      remarks,
    })
  }

  const canSave = vehicle && inspectionDate && nextInspectionDate && !isLoading

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.vehicle')} *</label>
          <select
            value={vehicle}
            onChange={(e) => handleVehicleChange(e.target.value)}
            className="input"
            required
          >
            <option value="">{t('maintenance.adr.selectVehicle')}</option>
            {actieveVoertuigen.map(v => (
              <option key={v.id} value={v.id}>{v.kenteken} — {v.type_wagen}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.route')}</label>
          <input type="text" value={route} onChange={(e) => setRoute(e.target.value)} className="input" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={hasAdr}
            onChange={(e) => setHasAdr(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm font-medium text-gray-900">{t('maintenance.adr.hasAdr')}</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            checked={caseSealed}
            onChange={(e) => setCaseSealed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm font-medium text-gray-900">{t('maintenance.adr.caseSealed')}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.inspectionDate')} *</label>
          <input
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
            className="input"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.nextInspectionDate')} *</label>
          <input
            type="date"
            value={nextInspectionDate}
            min={inspectionDate || undefined}
            onChange={(e) => setNextInspectionDate(e.target.value)}
            className="input"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.notifyTo')}</label>
        <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
          {users.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">—</p>
          ) : (
            users.map(user => (
              <label key={user.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={notifyUsers.includes(user.id)}
                  onChange={(e) => toggleUser(user.id, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {user.full_name || user.email} <span className="text-gray-500">({user.email})</span>
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('maintenance.adr.notifyHint')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.extraEmails')}</label>
        <input
          type="text"
          value={extraEmails}
          onChange={(e) => setExtraEmails(e.target.value)}
          placeholder="naam@bedrijf.nl, tweede@bedrijf.nl"
          className="input"
        />
        <p className="mt-1 text-xs text-gray-500">{t('maintenance.adr.extraEmailsHint')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.remarks')}</label>
        <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="input" />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
        <button type="submit" disabled={!canSave} className="btn-primary disabled:opacity-50">
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

/** Klein configscherm: verzendaccount, verzendtijd en standaard ontvangers. */
function ADRSettingsForm({ settings, users, profiles, onSave, onCancel, isLoading, t }: {
  settings: ADRSettings | null
  users: User[]
  profiles: EmailProfile[]
  onSave: (data: ADRSettingsPayload) => void
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
      default_notify_extra_emails: defaultExtra
        .split(/[,;\s]+/)
        .map(a => a.trim())
        .filter(Boolean),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.sendAccount')}</label>
          <select value={emailProfile} onChange={(e) => setEmailProfile(e.target.value)} className="input">
            <option value="">{t('maintenance.adr.sendAccountDefault')}</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.smtp_from_email ? ` (${p.smtp_from_email})` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">{t('maintenance.adr.sendAccountHint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.sendTime')}</label>
          <input type="time" value={tijd} onChange={(e) => setTijd(e.target.value)} className="input" required />
          <p className="mt-1 text-xs text-gray-500">{t('maintenance.adr.sendTimeHint')}</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.defaultRecipients')}</label>
        <div className="max-h-44 overflow-y-auto rounded-lg border divide-y">
          {users.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">—</p>
          ) : (
            users.map(user => (
              <label key={user.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={defaultUsers.includes(user.id)}
                  onChange={(e) => toggleUser(user.id, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                  {user.full_name || user.email} <span className="text-gray-500">({user.email})</span>
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('maintenance.adr.defaultRecipientsHint')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.adr.defaultExtraEmails')}</label>
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
          {t('maintenance.adr.lastRun')}: {new Date(settings.last_run_on).toLocaleDateString('nl-NL')}
        </p>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
        <button type="submit" disabled={isLoading} className="btn-primary disabled:opacity-50">
          {isLoading ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
