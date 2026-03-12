import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  MagnifyingGlassIcon, 
  PlusIcon, 
  PencilSquareIcon, 
  TrashIcon,
  CheckCircleIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowPathIcon,
  UserGroupIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { Driver, Company, User, Vehicle } from '@/types'
import { 
  getDrivers, 
  createDriver, 
  updateDriver, 
  deleteDriver,
  DriverFilters,
  DriverCreate,
  DriverUpdate,
} from '@/api/drivers'
import { getAllCompanies } from '@/api/companies'
import { getUsers } from '@/api/users'
import { getAllVehicles } from '@/api/fleet'
import Pagination, { PageSize } from '@/components/common/Pagination'

// Modal component
function Modal({ 
  isOpen, 
  onClose, 
  title, 
  children,
  size = 'md'
}: { 
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative bg-white rounded-xl shadow-xl w-full ${sizeClasses[size]} transform transition-all`}>
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Confirm dialog component
function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  loadingText,
  isLoading = false,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  loadingText?: string
  isLoading?: boolean
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          disabled={isLoading}
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? loadingText : confirmText}
        </button>
      </div>
    </Modal>
  )
}

// Driver form component
function DriverForm({
  driver,
  companies,
  users,
  vehicles,
  onSave,
  onCancel,
  isLoading,
  t,
}: {
  driver?: Driver
  companies: Company[]
  users: User[]
  vehicles: Vehicle[]
  onSave: (data: DriverCreate | DriverUpdate) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [formData, setFormData] = useState({
    naam: driver?.naam || '',
    telefoon: driver?.telefoon || '',
    bedrijf: driver?.bedrijf?.toString() || '',
    gekoppelde_gebruiker: driver?.gekoppelde_gebruiker?.toString() || '',
    voertuig: driver?.voertuig?.toString() || '',
    adr: driver?.adr || false,
    minimum_uren_per_week: driver?.minimum_uren_per_week?.toString() || '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setFormData(prev => ({ 
      ...prev, 
      [name]: type === 'checkbox' ? checked : value 
    }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!formData.naam.trim()) newErrors.naam = t('validation.nameRequired')
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    
    const saveData: DriverCreate | DriverUpdate = {
      naam: formData.naam,
      telefoon: formData.telefoon || undefined,
      bedrijf: formData.bedrijf || undefined,
      gekoppelde_gebruiker: formData.gekoppelde_gebruiker || undefined,
      voertuig: formData.voertuig || null,
      adr: formData.adr,
      minimum_uren_per_week: formData.minimum_uren_per_week ? parseFloat(formData.minimum_uren_per_week) : null,
    }
    onSave(saveData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('drivers.driverName')} *
        </label>
        <input
          type="text"
          name="naam"
          value={formData.naam}
          onChange={handleChange}
          className={`input ${errors.naam ? 'border-red-500' : ''}`}
        />
        {errors.naam && <p className="text-red-500 text-xs mt-1">{errors.naam}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.phone')}
        </label>
        <input
          type="tel"
          name="telefoon"
          value={formData.telefoon}
          onChange={handleChange}
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('companies.title')}
        </label>
        <select
          name="bedrijf"
          value={formData.bedrijf}
          onChange={handleChange}
          className="input"
        >
          <option value="">{t('common.none')}</option>
          {companies.map(company => (
            <option key={company.id} value={company.id}>
              {company.naam}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('drivers.linkedUser')}
        </label>
        <select
          name="gekoppelde_gebruiker"
          value={formData.gekoppelde_gebruiker}
          onChange={handleChange}
          className="input"
        >
          <option value="">{t('drivers.noLinkedUser')}</option>
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.voornaam && user.achternaam 
                ? `${user.voornaam} ${user.achternaam}` 
                : user.username}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {t('drivers.selectUser')}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('drivers.vehicle')}
        </label>
        <select
          name="voertuig"
          value={formData.voertuig}
          onChange={handleChange}
          className="input"
        >
          <option value="">{t('drivers.noVehicle')}</option>
          {vehicles
            .filter(v => !formData.bedrijf || v.bedrijf === formData.bedrijf)
            .map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.ritnummer} - {vehicle.kenteken} ({vehicle.type_wagen})
              </option>
            ))}
        </select>
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="adr"
          name="adr"
          checked={formData.adr}
          onChange={handleChange}
          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
        />
        <label htmlFor="adr" className="ml-2 text-sm text-gray-700">
          {t('drivers.adrCertified')}
        </label>
        <span className="ml-2 text-xs text-gray-500">
          ({t('drivers.adrDescription')})
        </span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('drivers.minimumHoursPerWeek')}
        </label>
        <input
          type="number"
          name="minimum_uren_per_week"
          value={formData.minimum_uren_per_week}
          onChange={handleChange}
          className="input"
          step="0.5"
          min="0"
          placeholder={t('drivers.minimumHoursPlaceholder')}
        />
        <p className="text-xs text-gray-500 mt-1">
          {t('drivers.minimumHoursHelp')}
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          disabled={isLoading}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={isLoading}
        >
          {isLoading ? t('common.saving') : driver ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}

// Main DriversPage component
export default function DriversPage() {
  const { t } = useTranslation()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [adrFilter, setAdrFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>('naam')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(30)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null)

  // Helper to extract error message
  const getErrorMessage = (err: any, defaultMsg: string): string => {
    if (err.response?.data) {
      const data = err.response.data
      if (data.error) return data.error
      if (data.message) return data.message
      if (data.detail) return data.detail
      const firstField = Object.keys(data)[0]
      if (firstField && Array.isArray(data[firstField])) {
        return `${firstField}: ${data[firstField][0]}`
      }
    }
    return defaultMsg
  }

  // Fetch lookups (companies and users)
  useEffect(() => {
    const fetchLookups = async () => {
      try {
        const [companiesData, usersData, vehiclesData] = await Promise.all([
          getAllCompanies(),
          getUsers({ page_size: 1000 }),
          getAllVehicles(),
        ])
        setCompanies(companiesData)
        setUsers(usersData.results || [])
        setVehicles(vehiclesData)
      } catch (err) {
        console.error('Error fetching lookups:', err)
      }
    }
    fetchLookups()
  }, [])

  // Fetch drivers
  const fetchDrivers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const filters: DriverFilters = {
        page,
        page_size: pageSize,
        ordering: sortDirection === 'asc' ? sortField : `-${sortField}`,
      }
      if (search) filters.search = search
      if (companyFilter) filters.bedrijf = companyFilter
      if (adrFilter !== 'all') filters.adr = adrFilter === 'yes' ? 'true' : 'false'
      
      const response = await getDrivers(filters)
      setDrivers(response.results || [])
      setTotalCount(response.count || 0)
    } catch (err) {
      setError(t('common.error'))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, companyFilter, adrFilter, sortField, sortDirection])

  useEffect(() => {
    fetchDrivers()
  }, [fetchDrivers])

  // Show success message temporarily
  const showSuccess = (message: string) => {
    setSuccessMessage(message)
    setTimeout(() => setSuccessMessage(null), 3000)
  }

  // Handle sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  // Handle create
  const handleCreate = async (data: DriverCreate | DriverUpdate) => {
    setIsActionLoading(true)
    try {
      await createDriver(data as DriverCreate)
      setShowCreateModal(false)
      showSuccess(t('drivers.driverCreated'))
      fetchDrivers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle update
  const handleUpdate = async (data: DriverCreate | DriverUpdate) => {
    if (!selectedDriver) return
    setIsActionLoading(true)
    try {
      await updateDriver(selectedDriver.id, data as DriverUpdate)
      setShowEditModal(false)
      setSelectedDriver(null)
      showSuccess(t('drivers.driverUpdated'))
      fetchDrivers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!selectedDriver) return
    setIsActionLoading(true)
    try {
      await deleteDriver(selectedDriver.id)
      setShowDeleteModal(false)
      setSelectedDriver(null)
      showSuccess(t('drivers.driverDeleted'))
      fetchDrivers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
      setShowDeleteModal(false)
      setSelectedDriver(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Get company name by ID
  const getCompanyName = (driver: Driver) => {
    if (driver.bedrijf_naam) return driver.bedrijf_naam
    if (driver.bedrijf) {
      const company = companies.find(c => c.id === driver.bedrijf)
      return company?.naam || '-'
    }
    return '-'
  }

  // Pagination
  const totalPages = Math.ceil(totalCount / pageSize)

  // Sort icon
  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' 
      ? <ChevronUpIcon className="w-4 h-4 inline ml-1" />
      : <ChevronDownIcon className="w-4 h-4 inline ml-1" />
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">{t('drivers.title')}</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          {t('drivers.newDriver')}
        </button>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg flex items-center">
          <CheckCircleIcon className="w-5 h-5 mr-2" />
          {successMessage}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-6">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
            {/* Search */}
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('common.search')}
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder={t('drivers.searchDrivers')}
                  className="input pl-10 min-h-[44px]"
                />
              </div>
            </div>

            {/* Filter row */}
            <div className="flex flex-col xs:flex-row gap-3 w-full sm:w-auto">
              {/* Company filter */}
              <div className="flex-1 xs:w-40">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('companies.title')}
                </label>
                <select
                  value={companyFilter}
                  onChange={(e) => { setCompanyFilter(e.target.value); setPage(1) }}
                  className="input min-h-[44px]"
                >
                  <option value="">{t('companies.allCompanies')}</option>
                  {companies.map(company => (
                    <option key={company.id} value={company.id}>
                      {company.naam}
                    </option>
                  ))}
                </select>
              </div>

              {/* ADR filter */}
              <div className="flex-1 xs:w-36">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ADR
                </label>
                <select
                  value={adrFilter}
                  onChange={(e) => { setAdrFilter(e.target.value as 'all' | 'yes' | 'no'); setPage(1) }}
                  className="input min-h-[44px]"
                >
                  <option value="all">{t('common.all')}</option>
                  <option value="yes">{t('drivers.adrCertified')}</option>
                  <option value="no">{t('drivers.noAdr')}</option>
                </select>
              </div>
            </div>

            {/* Refresh button */}
            <button
              onClick={() => fetchDrivers()}
              className="p-2 min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg self-end"
              title={t('common.refresh')}
            >
              <ArrowPathIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th 
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('naam')}
                >
                  {t('common.name')} <SortIcon field="naam" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('common.phone')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('companies.title')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('drivers.vehicle')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('drivers.linkedUser')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                  ADR
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                      <span className="ml-3">{t('common.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : drivers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    <UserGroupIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p>{t('drivers.noDrivers')}</p>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="mt-2 text-primary-600 hover:text-primary-700"
                    >
                      {t('drivers.addDriver')}
                    </button>
                  </td>
                </tr>
              ) : (
                drivers.map(driver => (
                  <tr key={driver.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{driver.naam}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{driver.telefoon || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{getCompanyName(driver)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {driver.voertuig_ritnummer 
                        ? `${driver.voertuig_ritnummer} (${driver.voertuig_kenteken})`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {driver.gekoppelde_gebruiker_naam || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {driver.adr ? (
                        <span className="inline-flex items-center text-green-600" title="ADR gecertificeerd">
                          <ShieldCheckIcon className="w-5 h-5" />
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setSelectedDriver(driver); setShowEditModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title={t('common.edit')}
                        >
                          <PencilSquareIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => { setSelectedDriver(driver); setShowDeleteModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                          title={t('common.delete')}
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3">{t('common.loading')}</span>
              </div>
            </div>
          ) : drivers.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <UserGroupIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>{t('drivers.noDrivers')}</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-2 text-primary-600 hover:text-primary-700"
              >
                {t('drivers.addDriver')}
              </button>
            </div>
          ) : (
            drivers.map(driver => (
              <div key={driver.id} className="p-4 hover:bg-gray-50">
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{driver.naam}</h3>
                      {driver.adr && (
                        <span className="inline-flex items-center text-green-600 shrink-0" title="ADR gecertificeerd">
                          <ShieldCheckIcon className="w-5 h-5" />
                        </span>
                      )}
                    </div>
                    {driver.telefoon && (
                      <a href={`tel:${driver.telefoon}`} className="text-sm text-primary-600">{driver.telefoon}</a>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setSelectedDriver(driver); setShowEditModal(true) }}
                      className="p-2 min-w-[44px] min-h-[44px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                      title={t('common.edit')}
                    >
                      <PencilSquareIcon className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => { setSelectedDriver(driver); setShowDeleteModal(true) }}
                      className="p-2 min-w-[44px] min-h-[44px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-lg"
                      title={t('common.delete')}
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Card Details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">{t('companies.title')}: </span>
                    <span className="text-gray-700">{getCompanyName(driver)}</span>
                  </div>
                  {driver.voertuig_ritnummer && (
                    <div>
                      <span className="text-gray-500">{t('drivers.vehicle')}: </span>
                      <span className="text-gray-700">{driver.voertuig_ritnummer} ({driver.voertuig_kenteken})</span>
                    </div>
                  )}
                  {driver.gekoppelde_gebruiker_naam && (
                    <div>
                      <span className="text-gray-500">{t('drivers.linkedUser')}: </span>
                      <span className="text-gray-700">{driver.gekoppelde_gebruiker_naam}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => { setPageSize(newSize); setPage(1); }}
        />
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('drivers.newDriver')}
        size="md"
      >
        <DriverForm
          companies={companies}
          users={users}
          vehicles={vehicles}
          onSave={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setSelectedDriver(null) }}
        title={t('drivers.editDriver')}
        size="md"
      >
        {selectedDriver && (
          <DriverForm
            driver={selectedDriver}
            companies={companies}
            users={users}
            vehicles={vehicles}
            onSave={handleUpdate}
            onCancel={() => { setShowEditModal(false); setSelectedDriver(null) }}
            isLoading={isActionLoading}
            t={t}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedDriver(null) }}
        onConfirm={handleDelete}
        title={t('common.delete')}
        message={t('drivers.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loadingText={t('common.deleting')}
        isLoading={isActionLoading}
      />
    </div>
  )
}
