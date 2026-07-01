import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  WrenchScrewdriverIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  XMarkIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { TireRecord, Vehicle } from '@/types'
import { getTires, createTire, updateTire, deleteTire, replaceTire } from '@/api/maintenance'
import { getAllVehicles } from '@/api/fleet'
import LicensePlate from '@/components/common/LicensePlate'

function Modal({ isOpen, onClose, title, children, size = 'md' }: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg'
}) {
  if (!isOpen) return null
  const sizeClasses = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative bg-white rounded-xl shadow-xl w-full ${sizeClasses[size]} transform transition-all max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
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

const POSITIONS = [
  { value: 'front_left', label: 'Linksv.' },
  { value: 'front_right', label: 'Rechtsv.' },
  { value: 'rear_left_outer', label: 'LA buiten' },
  { value: 'rear_left_inner', label: 'LA binnen' },
  { value: 'rear_right_inner', label: 'RA binnen' },
  { value: 'rear_right_outer', label: 'RA buiten' },
  { value: 'spare', label: 'Reserve' },
]

const TIRE_TYPES = [
  { value: 'summer', label: 'Zomer' },
  { value: 'winter', label: 'Winter' },
  { value: 'all_season', label: 'All-season' },
]

export default function TiresPage() {
  const { t } = useTranslation()
  const [tires, setTires] = useState<TireRecord[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedTire, setSelectedTire] = useState<TireRecord | null>(null)

  const fetchTires = useCallback(async () => {
    setIsLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (vehicleFilter) params.vehicle = vehicleFilter
      const data = await getTires(params)
      setTires(Array.isArray(data) ? data : data.results || [])
    } catch { setError(t('common.error')) }
    finally { setIsLoading(false) }
  }, [search, vehicleFilter, t])

  const fetchVehicles = useCallback(async () => {
    try {
      const data = await getAllVehicles()
      setVehicles(data)
    } catch { /* */ }
  }, [])

  useEffect(() => { fetchVehicles() }, [fetchVehicles])
  useEffect(() => { fetchTires() }, [fetchTires])

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  const handleCreate = async (data: Partial<TireRecord>) => {
    setIsActionLoading(true)
    try {
      await createTire(data)
      setShowCreateModal(false)
      setSuccessMessage(t('maintenance.tires.created'))
      fetchTires()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const handleEdit = async (data: Partial<TireRecord>) => {
    if (!selectedTire) return
    setIsActionLoading(true)
    try {
      await updateTire(selectedTire.id, data)
      setShowEditModal(false)
      setSelectedTire(null)
      setSuccessMessage(t('maintenance.tires.updated'))
      fetchTires()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const handleReplace = async (data: { removed_date: string; removed_km?: number; removal_reason?: string }) => {
    if (!selectedTire) return
    setIsActionLoading(true)
    try {
      await replaceTire(selectedTire.id, data)
      setShowReplaceModal(false)
      setSelectedTire(null)
      setSuccessMessage(t('maintenance.tires.replaced'))
      fetchTires()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  const handleDelete = async () => {
    if (!selectedTire) return
    setIsActionLoading(true)
    try {
      await deleteTire(selectedTire.id)
      setShowDeleteModal(false)
      setSelectedTire(null)
      setSuccessMessage(t('maintenance.tires.deleted'))
      fetchTires()
    } catch { setError(t('common.error')) }
    finally { setIsActionLoading(false) }
  }

  // Group tires by vehicle
  const grouped = tires.reduce<Record<string, TireRecord[]>>((acc, tire) => {
    const key = tire.vehicle_kenteken || tire.vehicle
    if (!acc[key]) acc[key] = []
    acc[key].push(tire)
    return acc
  }, {})

  const getConditionBadge = (tread: string | null) => {
    if (!tread) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800">?</span>
    const depth = parseFloat(tread)
    if (depth >= 4) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">{t('maintenance.tires.condition.good')}</span>
    if (depth >= 2) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">{t('maintenance.tires.condition.fair')}</span>
    return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">{t('maintenance.tires.condition.poor')}</span>
  }

  const getTireTypeLabel = (type: string) => {
    const s = TIRE_TYPES.find(s => s.value === type)
    return s ? s.label : type
  }

  const getPositionLabel = (pos: string) => {
    const p = POSITIONS.find(p => p.value === pos)
    return p ? p.label : pos
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
        <span className="text-gray-900 font-medium">{t('maintenance.tires.title')}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{t('maintenance.tires.title')}</h1>
          <p className="text-gray-500 mt-1">{t('maintenance.tires.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
          <PlusIcon className="w-5 h-5" />
          {t('maintenance.tires.addTire')}
        </button>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircleIcon className="w-5 h-5" />{successMessage}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <XCircleIcon className="w-5 h-5" />{error}
          <button onClick={() => setError(null)} className="ml-auto"><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('maintenance.tires.searchPlaceholder')} className="input pl-10" />
        </div>
        <select value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="input w-auto">
          <option value="">{t('maintenance.tires.allVehicles')}</option>
          {vehicles.map(v => <option key={v.id} value={v.id}>{v.kenteken}</option>)}
        </select>
        <button onClick={fetchTires} className="btn-secondary flex items-center gap-1">
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">{t('common.loading')}</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">{t('maintenance.tires.noTires')}</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([kenteken, vehicleTires]) => (
            <div key={kenteken} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {/* Vehicle header */}
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center gap-3">
                <LicensePlate kenteken={kenteken} size="md" />
                <span className="text-sm text-gray-500">{vehicleTires.length} {t('maintenance.tires.tiresRegistered')}</span>
              </div>

              {/* Tire diagram - simple position grid */}
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {vehicleTires.map(tire => (
                    <div key={tire.id}
                      className="relative border rounded-lg p-3 hover:shadow-md transition cursor-pointer group"
                      onClick={() => { setSelectedTire(tire); setShowEditModal(true) }}
                    >
                      {/* Position label */}
                      <div className="text-xs font-medium text-gray-500 mb-1">{tire.position_display || getPositionLabel(tire.position)}</div>

                      {/* Tire icon - simple circle */}
                      <div className="w-12 h-12 mx-auto rounded-full border-4 border-gray-700 bg-gray-100 flex items-center justify-center mb-2">
                        <span className="text-[9px] font-bold text-gray-600">{tire.tread_depth_mm || '?'}</span>
                      </div>

                      {/* Brand + size */}
                      <div className="text-xs text-center font-medium text-gray-900 truncate">{tire.brand}</div>
                      <div className="text-[10px] text-center text-gray-500 truncate">{tire.size}</div>

                      {/* Badges */}
                      <div className="flex justify-center gap-1 mt-1">
                        {getConditionBadge(tire.tread_depth_mm)}
                      </div>
                      <div className="text-[10px] text-center text-gray-400 mt-1">{getTireTypeLabel(tire.tire_type)}</div>

                      {/* Action buttons on hover */}
                      <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTire(tire); setShowReplaceModal(true) }}
                          className="p-1 bg-yellow-100 rounded text-yellow-700 hover:bg-yellow-200" title={t('maintenance.tires.replace')}
                        >
                          <ArrowPathIcon className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTire(tire); setShowDeleteModal(true) }}
                          className="p-1 bg-red-100 rounded text-red-700 hover:bg-red-200" title={t('common.delete')}
                        >
                          <TrashIcon className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title={t('maintenance.tires.addTire')} size="md">
        <TireForm vehicles={vehicles} onSave={handleCreate} onCancel={() => setShowCreateModal(false)} isLoading={isActionLoading} t={t} />
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEditModal} onClose={() => { setShowEditModal(false); setSelectedTire(null) }} title={t('maintenance.tires.editTire')} size="md">
        {selectedTire && (
          <TireForm tire={selectedTire} vehicles={vehicles} onSave={handleEdit}
            onCancel={() => { setShowEditModal(false); setSelectedTire(null) }} isLoading={isActionLoading} t={t} />
        )}
      </Modal>

      {/* Replace Modal */}
      <Modal isOpen={showReplaceModal} onClose={() => { setShowReplaceModal(false); setSelectedTire(null) }} title={t('maintenance.tires.replace')} size="md">
        {selectedTire && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="font-medium text-gray-700 mb-1">{t('maintenance.tires.currentTire')}</div>
              <div>{selectedTire.brand} {selectedTire.size} — {selectedTire.position_display || getPositionLabel(selectedTire.position)}</div>
              <div className="text-gray-500">DOT: {selectedTire.dot_code || '—'} | {t('maintenance.tires.treadDepth')}: {selectedTire.tread_depth_mm || '—'} mm</div>
            </div>
            <TireForm vehicles={vehicles} prefillVehicle={selectedTire.vehicle} prefillPosition={selectedTire.position}
              isReplace onSave={(data) => handleReplace({
                removed_date: new Date().toISOString().split('T')[0],
                removal_reason: `Vervangen door ${data.brand} ${data.size}`,
              })} onCancel={() => { setShowReplaceModal(false); setSelectedTire(null) }} isLoading={isActionLoading} t={t} />
          </div>
        )}
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setSelectedTire(null) }} title={t('common.delete')} size="sm">
        <p className="text-gray-600 mb-6">{t('maintenance.tires.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => { setShowDeleteModal(false); setSelectedTire(null) }} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
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

// Tire Form
function TireForm({ tire, vehicles, prefillVehicle, prefillPosition, isReplace, onSave, onCancel, isLoading, t }: {
  tire?: TireRecord
  vehicles: Vehicle[]
  prefillVehicle?: string
  prefillPosition?: string
  isReplace?: boolean
  onSave: (data: Partial<TireRecord>) => void
  onCancel: () => void
  isLoading: boolean
  t: (key: string) => string
}) {
  const [formData, setFormData] = useState({
    vehicle: tire?.vehicle || prefillVehicle || '',
    position: tire?.position || prefillPosition || '',
    brand: tire?.brand || '',
    size: tire?.size || '',
    dot_code: tire?.dot_code || '',
    tire_type: tire?.tire_type || 'all_season',
    tread_depth_mm: tire?.tread_depth_mm || '',
    mounted_date: tire?.mounted_date || new Date().toISOString().split('T')[0],
    mounted_km: tire?.mounted_km || '',
    purchase_cost: tire?.purchase_cost || '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value
    setFormData(prev => ({ ...prev, [e.target.name]: val }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData as Partial<TireRecord>)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isReplace && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('fleet.licensePlate')} *</label>
            <select name="vehicle" value={formData.vehicle} onChange={handleChange} className="input" required disabled={!!prefillVehicle}>
              <option value="">{t('maintenance.apk.selectVehicle')}</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.kenteken}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.position')} *</label>
            <select name="position" value={formData.position} onChange={handleChange} className="input" required disabled={!!prefillPosition}>
              <option value="">{t('maintenance.tires.selectPosition')}</option>
              {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.brand')} *</label>
          <input type="text" name="brand" value={formData.brand} onChange={handleChange} className="input" required placeholder="bijv. Michelin" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.size')} *</label>
          <input type="text" name="size" value={formData.size} onChange={handleChange} className="input" required placeholder="bijv. 315/80R22.5" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">DOT Code</label>
          <input type="text" name="dot_code" value={formData.dot_code} onChange={handleChange} className="input" placeholder="bijv. 2024" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.season')}</label>
          <select name="tire_type" value={formData.tire_type} onChange={handleChange} className="input">
            {TIRE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.treadDepth')} (mm)</label>
          <input type="number" step="0.1" name="tread_depth_mm" value={formData.tread_depth_mm} onChange={handleChange} className="input" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.purchaseDate')}</label>
          <input type="date" name="mounted_date" value={formData.mounted_date} onChange={handleChange} className="input" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.purchasePrice')}</label>
          <input type="number" step="0.01" name="purchase_cost" value={formData.purchase_cost} onChange={handleChange} className="input" placeholder="€ 0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('maintenance.tires.mileageAtMount')}</label>
          <input type="number" name="mounted_km" value={formData.mounted_km} onChange={handleChange} className="input" placeholder="km" />
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200" disabled={isLoading}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? t('common.saving') : isReplace ? t('maintenance.tires.replace') : tire ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}
