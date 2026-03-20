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
  TruckIcon,
} from '@heroicons/react/24/outline'
import { Vehicle, Company } from '@/types'
import { 
  getVehicles, 
  createVehicle, 
  updateVehicle, 
  deleteVehicle,
  VehicleFilters,
  VehicleCreate,
  VehicleUpdate,
} from '@/api/fleet'
import { getAllCompanies } from '@/api/companies'
import Pagination, { PageSize } from '@/components/common/Pagination'
import LicensePlate from '@/components/common/LicensePlate'

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

// Vehicle form component
function VehicleForm({
  vehicle,
  companies,
  onSave,
  onCancel,
  isLoading,
  t,
}: {
  vehicle?: Vehicle
  companies: Company[]
  onSave: (data: VehicleCreate | VehicleUpdate) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [formData, setFormData] = useState({
    kenteken: vehicle?.kenteken || '',
    type_wagen: vehicle?.type_wagen || '',
    ritnummer: vehicle?.ritnummer || '',
    bedrijf: vehicle?.bedrijf?.toString() || '',
    minimum_weken_per_jaar: vehicle?.minimum_weken_per_jaar?.toString() || '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!formData.kenteken.trim()) newErrors.kenteken = t('validation.licensePlateRequired')
    if (!formData.bedrijf) newErrors.bedrijf = t('validation.companyRequired')
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    
    const saveData: VehicleCreate | VehicleUpdate = {
      kenteken: formData.kenteken.toUpperCase(),
      type_wagen: formData.type_wagen || undefined,
      ritnummer: formData.ritnummer || undefined,
      bedrijf: formData.bedrijf,
      minimum_weken_per_jaar: formData.minimum_weken_per_jaar ? parseInt(formData.minimum_weken_per_jaar) : null,
    }
    onSave(saveData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('fleet.licensePlate')} *
        </label>
        <input
          type="text"
          name="kenteken"
          value={formData.kenteken}
          onChange={handleChange}
          placeholder="AB-123-CD"
          className={`input uppercase ${errors.kenteken ? 'border-red-500' : ''}`}
        />
        {errors.kenteken && <p className="text-red-500 text-xs mt-1">{errors.kenteken}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('fleet.vehicleType')}
        </label>
        <input
          type="text"
          name="type_wagen"
          value={formData.type_wagen}
          onChange={handleChange}
          placeholder={t('fleet.vehicleTypePlaceholder')}
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('fleet.routeNumber')}
        </label>
        <input
          type="text"
          name="ritnummer"
          value={formData.ritnummer}
          onChange={handleChange}
          placeholder={t('fleet.routeNumberPlaceholder')}
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('companies.title')} *
        </label>
        <select
          name="bedrijf"
          value={formData.bedrijf}
          onChange={handleChange}
          className={`input ${errors.bedrijf ? 'border-red-500' : ''}`}
        >
          <option value="">{t('fleet.selectCompany')}</option>
          {companies.map(company => (
            <option key={company.id} value={company.id}>
              {company.naam}
            </option>
          ))}
        </select>
        {errors.bedrijf && <p className="text-red-500 text-xs mt-1">{errors.bedrijf}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('fleet.minimumWeeksPerYear')}
        </label>
        <input
          type="number"
          name="minimum_weken_per_jaar"
          value={formData.minimum_weken_per_jaar}
          onChange={handleChange}
          placeholder={t('fleet.minimumWeeksPlaceholder')}
          className="input"
          min="0"
          max="52"
        />
        <p className="text-xs text-gray-500 mt-1">{t('fleet.minimumWeeksHelp')}</p>
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
          {isLoading ? t('common.saving') : vehicle ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}

// Main FleetPage component
export default function FleetPage() {
  const { t } = useTranslation()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>('kenteken')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(30)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

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

  // Fetch lookups (companies)
  useEffect(() => {
    const fetchLookups = async () => {
      try {
        const companiesData = await getAllCompanies()
        setCompanies(companiesData)
      } catch (err) {
        console.error('Error fetching companies:', err)
      }
    }
    fetchLookups()
  }, [])

  // Get unique vehicle types for filter
  const vehicleTypes = [...new Set(vehicles.map(v => v.type_wagen).filter(Boolean))]

  // Fetch vehicles
  const fetchVehicles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const filters: VehicleFilters = {
        page,
        page_size: pageSize,
        ordering: sortDirection === 'asc' ? sortField : `-${sortField}`,
      }
      if (search) filters.search = search
      if (companyFilter) filters.bedrijf = companyFilter
      if (typeFilter) filters.type_wagen = typeFilter
      
      const response = await getVehicles(filters)
      setVehicles(response.results || [])
      setTotalCount(response.count || 0)
    } catch (err) {
      setError(t('common.error'))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, companyFilter, typeFilter, sortField, sortDirection])

  useEffect(() => {
    fetchVehicles()
  }, [fetchVehicles])

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
  const handleCreate = async (data: VehicleCreate | VehicleUpdate) => {
    setIsActionLoading(true)
    try {
      await createVehicle(data as VehicleCreate)
      setShowCreateModal(false)
      showSuccess(t('fleet.vehicleCreated'))
      fetchVehicles()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle update
  const handleUpdate = async (data: VehicleCreate | VehicleUpdate) => {
    if (!selectedVehicle) return
    setIsActionLoading(true)
    try {
      await updateVehicle(selectedVehicle.id, data as VehicleUpdate)
      setShowEditModal(false)
      setSelectedVehicle(null)
      showSuccess(t('fleet.vehicleUpdated'))
      fetchVehicles()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!selectedVehicle) return
    setIsActionLoading(true)
    try {
      await deleteVehicle(selectedVehicle.id)
      setShowDeleteModal(false)
      setSelectedVehicle(null)
      showSuccess(t('fleet.vehicleDeleted'))
      fetchVehicles()
    } catch (err: any) {
      setError(getErrorMessage(err, t('common.error')))
      setShowDeleteModal(false)
      setSelectedVehicle(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Get company name by ID
  const getCompanyName = (vehicle: Vehicle) => {
    if (vehicle.bedrijf_naam) return vehicle.bedrijf_naam
    if (vehicle.bedrijf) {
      const company = companies.find(c => c.id === vehicle.bedrijf)
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
        <h1 className="page-title">{t('fleet.title')}</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          {t('fleet.newVehicle')}
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
      <div className="card mb-4">
        <div className="p-3">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder={t('fleet.searchVehicles')}
                  className="input pl-9 text-sm h-9"
                />
              </div>
            </div>

            {/* Filter row */}
            <div className="flex flex-col xs:flex-row gap-2 w-full sm:w-auto">
              {/* Company filter */}
              <div className="flex-1 xs:w-36">
                <select
                  value={companyFilter}
                  onChange={(e) => { setCompanyFilter(e.target.value); setPage(1) }}
                  className="input text-sm h-9"
                >
                  <option value="">{t('companies.allCompanies')}</option>
                  {companies.map(company => (
                    <option key={company.id} value={company.id}>
                      {company.naam}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type filter */}
              {vehicleTypes.length > 0 && (
                <div className="flex-1 xs:w-36">
                  <select
                    value={typeFilter}
                    onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                    className="input text-sm h-9"
                  >
                    <option value="">{t('common.allTypes')}</option>
                    {vehicleTypes.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Refresh button */}
            <button
              onClick={() => fetchVehicles()}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg self-end"
              title={t('common.refresh')}
            >
              <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
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
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('kenteken')}
                >
                  {t('fleet.licensePlate')} <SortIcon field="kenteken" />
                </th>
                <th 
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('type_wagen')}
                >
                  {t('fleet.vehicleType')} <SortIcon field="type_wagen" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('fleet.routeNumber')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('companies.title')}
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                      <span className="ml-3">{t('common.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    <TruckIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p>{t('fleet.noVehicles')}</p>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="mt-2 text-primary-600 hover:text-primary-700"
                    >
                      {t('fleet.addVehicle')}
                    </button>
                  </td>
                </tr>
              ) : (
                vehicles.map(vehicle => (
                  <tr key={vehicle.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <LicensePlate kenteken={vehicle.kenteken} size="sm" />
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600">{vehicle.type_wagen || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{vehicle.ritnummer || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{getCompanyName(vehicle)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => { setSelectedVehicle(vehicle); setShowEditModal(true) }}
                          className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title={t('common.edit')}
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedVehicle(vehicle); setShowDeleteModal(true) }}
                          className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
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

        {/* Mobile Card View */}
        <div className="md:hidden divide-y">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3">{t('common.loading')}</span>
              </div>
            </div>
          ) : vehicles.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <TruckIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>{t('fleet.noVehicles')}</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-2 text-primary-600 hover:text-primary-700"
              >
                {t('fleet.addVehicle')}
              </button>
            </div>
          ) : (
            vehicles.map(vehicle => (
              <div key={vehicle.id} className="px-3 py-2.5 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <LicensePlate kenteken={vehicle.kenteken} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {vehicle.type_wagen && <span>{vehicle.type_wagen}</span>}
                        {vehicle.type_wagen && vehicle.ritnummer && <span className="text-gray-300">&middot;</span>}
                        {vehicle.ritnummer && <span>Rit {vehicle.ritnummer}</span>}
                        <span className="text-gray-300">&middot;</span>
                        <span>{getCompanyName(vehicle)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => { setSelectedVehicle(vehicle); setShowEditModal(true) }}
                      className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                      title={t('common.edit')}
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setSelectedVehicle(vehicle); setShowDeleteModal(true) }}
                      className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                      title={t('common.delete')}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
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
        title={t('fleet.newVehicle')}
        size="md"
      >
        <VehicleForm
          companies={companies}
          onSave={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isActionLoading}
          t={t}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setSelectedVehicle(null) }}
        title={t('fleet.editVehicle')}
        size="md"
      >
        {selectedVehicle && (
          <VehicleForm
            vehicle={selectedVehicle}
            companies={companies}
            onSave={handleUpdate}
            onCancel={() => { setShowEditModal(false); setSelectedVehicle(null) }}
            isLoading={isActionLoading}
            t={t}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedVehicle(null) }}
        onConfirm={handleDelete}
        title={t('common.delete')}
        message={t('fleet.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loadingText={t('common.deleting')}
        isLoading={isActionLoading}
      />
    </div>
  )
}
