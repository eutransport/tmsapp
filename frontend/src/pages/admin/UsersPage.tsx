import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  MagnifyingGlassIcon, 
  PlusIcon, 
  PencilSquareIcon, 
  TrashIcon,
  KeyIcon,
  ShieldCheckIcon,
  NoSymbolIcon,
  CheckCircleIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { User, UserCreate, Company } from '@/types'
import { 
  getUsers, 
  createUser, 
  updateUser, 
  deleteUser, 
  resetUserPassword, 
  toggleUserActive, 
  disableUserMFA,
  UserFilters,
  UserUpdate,
} from '@/api/users'
import { getAllCompanies } from '@/api/companies'
import Pagination, { PageSize } from '@/components/common/Pagination'

// Role labels and colors
const roleConfig: Record<string, { key: string; color: string }> = {
  admin: { key: 'users.admin', color: 'bg-purple-100 text-purple-800' },
  gebruiker: { key: 'users.user', color: 'bg-blue-100 text-blue-800' },
  chauffeur: { key: 'users.driver', color: 'bg-green-100 text-green-800' },
}

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
  confirmText = 'Bevestigen',
  cancelText = 'Annuleren',
  confirmColor = 'red',
  isLoading = false,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmColor?: 'red' | 'blue' | 'green'
  isLoading?: boolean
}) {
  const colorClasses = {
    red: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    blue: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    green: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
  }

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
          className={`px-4 py-2 text-white rounded-lg focus:ring-2 focus:ring-offset-2 ${colorClasses[confirmColor]} disabled:opacity-50`}
          disabled={isLoading}
        >
          {isLoading ? 'Bezig...' : confirmText}
        </button>
      </div>
    </Modal>
  )
}

// User form component
function UserForm({
  user,
  onSave,
  onCancel,
  isLoading,
}: {
  user?: User
  onSave: (data: UserCreate | UserUpdate) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const [companies, setCompanies] = useState<Company[]>([])
  const [formData, setFormData] = useState({
    email: user?.email || '',
    username: user?.username || '',
    voornaam: user?.voornaam || '',
    achternaam: user?.achternaam || '',
    telefoon: user?.telefoon || '',
    bedrijf: user?.bedrijf || '',
    rol: user?.rol || 'gebruiker',
    is_active: user?.is_active ?? true,
    mfa_required: user?.mfa_required ?? false,
    password: '',
    password_confirm: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    getAllCompanies().then(setCompanies).catch(console.error)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    setFormData(prev => ({ ...prev, [name]: newValue }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.email) newErrors.email = t('errors.required')
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = t('validation.email')
    
    if (!formData.username) newErrors.username = t('errors.required')
    if (!formData.voornaam) newErrors.voornaam = t('errors.required')
    if (!formData.achternaam) newErrors.achternaam = t('errors.required')
    
    if (!user) {
      // Password required for new users
      if (!formData.password) newErrors.password = t('errors.required')
      else if (formData.password.length < 8) newErrors.password = t('validation.minLength', { min: 8 })
      
      if (formData.password !== formData.password_confirm) {
        newErrors.password_confirm = t('auth.passwordMismatch')
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    if (user) {
      // Update - don't send password
      const { password, password_confirm, ...updateData } = formData
      onSave(updateData)
    } else {
      // Create - send all data
      onSave(formData as UserCreate)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('users.firstName')} *
          </label>
          <input
            type="text"
            name="voornaam"
            value={formData.voornaam}
            onChange={handleChange}
            className={`input min-h-[44px] ${errors.voornaam ? 'border-red-500' : ''}`}
          />
          {errors.voornaam && <p className="text-red-500 text-xs mt-1">{errors.voornaam}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('users.lastName')} *
          </label>
          <input
            type="text"
            name="achternaam"
            value={formData.achternaam}
            onChange={handleChange}
            className={`input min-h-[44px] ${errors.achternaam ? 'border-red-500' : ''}`}
          />
          {errors.achternaam && <p className="text-red-500 text-xs mt-1">{errors.achternaam}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.email')} *
        </label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          className={`input min-h-[44px] ${errors.email ? 'border-red-500' : ''}`}
        />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('auth.email')} *
        </label>
        <input
          type="text"
          name="username"
          value={formData.username}
          onChange={handleChange}
          className={`input min-h-[44px] ${errors.username ? 'border-red-500' : ''}`}
        />
        {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
      </div>

      {!user && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('auth.password')} *
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className={`input min-h-[44px] ${errors.password ? 'border-red-500' : ''}`}
            />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('auth.confirmPassword')} *
            </label>
            <input
              type="password"
              name="password_confirm"
              value={formData.password_confirm}
              onChange={handleChange}
              className={`input min-h-[44px] ${errors.password_confirm ? 'border-red-500' : ''}`}
            />
            {errors.password_confirm && <p className="text-red-500 text-xs mt-1">{errors.password_confirm}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('common.phone')}
          </label>
          <input
            type="tel"
            name="telefoon"
            value={formData.telefoon}
            onChange={handleChange}
            className="input min-h-[44px]"
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
            className="input min-h-[44px]"
          >
            <option value="">-- Selecteer bedrijf --</option>
            {companies.map(c => (
              <option key={c.id} value={c.naam}>{c.naam}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('users.role')}
          </label>
          <select
            name="rol"
            value={formData.rol}
            onChange={handleChange}
            className="input min-h-[44px]"
          >
            <option value="gebruiker">{t('users.user')}</option>
            <option value="chauffeur">{t('users.driver')}</option>
            <option value="admin">{t('users.admin')}</option>
          </select>
        </div>
        <div className="flex items-center pt-0 sm:pt-6">
          <label className="flex items-center cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="w-5 h-5 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            />
            <span className="ml-2 text-sm text-gray-700">{t('common.active')}</span>
          </label>
        </div>
        <div className="flex items-center sm:pt-0">
          <label className="flex items-center cursor-pointer min-h-[44px]">
            <input
              type="checkbox"
              name="mfa_required"
              checked={formData.mfa_required}
              onChange={handleChange}
              className="w-5 h-5 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            />
            <span className="ml-2 text-sm text-gray-700">2FA</span>
          </label>
        </div>
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
          {isLoading ? t('common.saving') : user ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}

// Password reset form
function PasswordResetForm({
  user,
  onSave,
  onCancel,
  isLoading,
}: {
  user: User
  onSave: (password: string) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (password.length < 8) {
      setError(t('validation.minLength', { min: 8 }))
      return
    }
    if (password !== passwordConfirm) {
      setError(t('auth.passwordMismatch'))
      return
    }
    
    onSave(password)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-gray-600">
        {t('users.resetPassword')} <strong>{user.full_name}</strong>
      </p>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('auth.newPassword')}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          className="input"
          placeholder={t('users.form.passwordPlaceholder')}
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('auth.confirmPassword')}
        </label>
        <input
          type="password"
          value={passwordConfirm}
          onChange={(e) => { setPasswordConfirm(e.target.value); setError('') }}
          className="input"
        />
      </div>
      
      {error && <p className="text-red-500 text-sm">{error}</p>}
      
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
          {isLoading ? t('common.loading') : t('users.resetPassword')}
        </button>
      </div>
    </form>
  )
}

// Main UsersPage component
export default function UsersPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<User[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>('achternaam')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(30)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [showMfaModal, setShowMfaModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const filters: UserFilters = {
        page,
        page_size: pageSize,
        ordering: sortDirection === 'asc' ? sortField : `-${sortField}`,
      }
      if (search) filters.search = search
      if (roleFilter) filters.rol = roleFilter
      if (statusFilter) filters.is_active = statusFilter
      
      const response = await getUsers(filters)
      setUsers(response.results || [])
      setTotalCount(response.count || 0)
    } catch (err) {
      setError(t('errors.loadFailed'))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, roleFilter, statusFilter, sortField, sortDirection])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

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

  // Handle create user
  // Helper to extract error message from response
  const getErrorMessage = (err: any, defaultMsg: string): string => {
    if (err.response?.data) {
      const data = err.response.data
      // Handle {error: "message"} format
      if (data.error) return data.error
      // Handle {message: "message"} format
      if (data.message) return data.message
      // Handle {detail: "message"} format
      if (data.detail) return data.detail
      // Handle field errors {field: ["error"]}
      const firstField = Object.keys(data)[0]
      if (firstField && Array.isArray(data[firstField])) {
        return data[firstField][0]
      }
    }
    return defaultMsg
  }

  // Handle create user
  const handleCreateUser = async (data: UserCreate | UserUpdate) => {
    setIsActionLoading(true)
    try {
      await createUser(data as UserCreate)
      setShowCreateModal(false)
      showSuccess(t('users.userCreated'))
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.saveFailed')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle update user
  const handleUpdateUser = async (data: UserCreate | UserUpdate) => {
    if (!selectedUser) return
    setIsActionLoading(true)
    try {
      await updateUser(selectedUser.id, data as UserUpdate)
      setShowEditModal(false)
      setSelectedUser(null)
      showSuccess(t('users.userUpdated'))
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.saveFailed')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle delete user
  const handleDeleteUser = async () => {
    if (!selectedUser) return
    setIsActionLoading(true)
    try {
      await deleteUser(selectedUser.id)
      setShowDeleteModal(false)
      setSelectedUser(null)
      showSuccess(t('users.userDeleted'))
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.deleteFailed')))
      setShowDeleteModal(false)
      setSelectedUser(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle password reset
  const handlePasswordReset = async (password: string) => {
    if (!selectedUser) return
    setIsActionLoading(true)
    try {
      await resetUserPassword(selectedUser.id, password)
      setShowPasswordModal(false)
      setSelectedUser(null)
      showSuccess(t('users.passwordReset'))
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.saveFailed')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle toggle active
  const handleToggleActive = async () => {
    if (!selectedUser) return
    setIsActionLoading(true)
    try {
      await toggleUserActive(selectedUser.id)
      setShowBlockModal(false)
      setSelectedUser(null)
      showSuccess(t('common.success'))
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.saveFailed')))
      setShowBlockModal(false)
      setSelectedUser(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle disable MFA
  const handleDisableMfa = async () => {
    if (!selectedUser) return
    setIsActionLoading(true)
    try {
      await disableUserMFA(selectedUser.id)
      setShowMfaModal(false)
      setSelectedUser(null)
      showSuccess(t('users.twoFactorDisabled'))
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, t('errors.saveFailed')))
      setShowMfaModal(false)
      setSelectedUser(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Pagination
  const totalPages = Math.ceil(totalCount / pageSize)

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

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
        <h1 className="page-title">{t('users.title')}</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          {t('users.newUser')}
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
                  placeholder={t('users.searchUsers')}
                  className="input pl-10 min-h-[44px]"
                />
              </div>
            </div>

            {/* Filter row */}
            <div className="flex flex-col xs:flex-row gap-3 w-full sm:w-auto">
              {/* Role filter */}
              <div className="flex-1 xs:w-36">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('users.role')}
                </label>
                <select
                  value={roleFilter}
                  onChange={(e) => { setRoleFilter(e.target.value); setPage(1) }}
                  className="input min-h-[44px]"
                >
                  <option value="">{t('common.all')}</option>
                  <option value="admin">{t('users.admin')}</option>
                  <option value="gebruiker">{t('users.user')}</option>
                  <option value="chauffeur">{t('users.driver')}</option>
                </select>
              </div>

              {/* Status filter */}
              <div className="flex-1 xs:w-36">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.status')}
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
                  className="input min-h-[44px]"
                >
                  <option value="">{t('common.all')}</option>
                  <option value="true">{t('common.active')}</option>
                  <option value="false">{t('common.inactive')}</option>
                </select>
              </div>
            </div>

            {/* Refresh button */}
            <button
              onClick={() => fetchUsers()}
              className="p-2 min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg self-end"
              title="Vernieuwen"
            >
              <ArrowPathIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th 
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('achternaam')}
                >
                  {t('common.name')} <SortIcon field="achternaam" />
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('email')}
                >
                  {t('common.email')} <SortIcon field="email" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('users.role')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('common.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  2FA
                </th>
                <th 
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('last_login')}
                >
                  {t('users.lastLogin')} <SortIcon field="last_login" />
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
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    {t('users.noUsers')}
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-gray-900">{user.full_name}</div>
                        <div className="text-sm text-gray-500">@{user.username}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${roleConfig[user.rol]?.color}`}>
                        {t(roleConfig[user.rol]?.key)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {user.is_active ? (
                        <span className="flex items-center text-green-600">
                          <CheckCircleIcon className="w-4 h-4 mr-1" />
                          {t('common.active')}
                        </span>
                      ) : (
                        <span className="flex items-center text-red-600">
                          <NoSymbolIcon className="w-4 h-4 mr-1" />
                          {t('common.inactive')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.mfa_enabled ? (
                        <span className="flex items-center text-green-600">
                          <ShieldCheckIcon className="w-4 h-4 mr-1" />
                          Aan
                        </span>
                      ) : user.mfa_required ? (
                        <span className="flex items-center text-orange-600">
                          <ShieldCheckIcon className="w-4 h-4 mr-1" />
                          Verplicht
                        </span>
                      ) : (
                        <span className="text-gray-400">Uit</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(user.last_login)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setSelectedUser(user); setShowEditModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title="Bewerken"
                        >
                          <PencilSquareIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setShowPasswordModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-yellow-600 hover:bg-gray-100 rounded"
                          title="Wachtwoord resetten"
                        >
                          <KeyIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setShowBlockModal(true) }}
                          className={`p-2 min-w-[40px] min-h-[40px] hover:bg-gray-100 rounded ${user.is_active ? 'text-gray-500 hover:text-orange-600' : 'text-gray-500 hover:text-green-600'}`}
                          title={user.is_active ? 'Blokkeren' : 'Activeren'}
                        >
                          {user.is_active ? <NoSymbolIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                        </button>
                        {user.mfa_enabled && (
                          <button
                            onClick={() => { setSelectedUser(user); setShowMfaModal(true) }}
                            className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-purple-600 hover:bg-gray-100 rounded"
                            title="2FA uitschakelen"
                          >
                            <ShieldCheckIcon className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setSelectedUser(user); setShowDeleteModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                          title="Verwijderen"
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
        <div className="lg:hidden divide-y">
          {isLoading ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3">{t('common.loading')}</span>
              </div>
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
              {t('users.noUsers')}
            </div>
          ) : (
            users.map(user => (
              <div key={user.id} className="p-4 hover:bg-gray-50">
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{user.full_name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ${roleConfig[user.rol]?.color}`}>
                        {t(roleConfig[user.rol]?.key)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">@{user.username}</p>
                    <p className="text-sm text-gray-600 truncate">{user.email}</p>
                  </div>
                </div>

                {/* Card Status */}
                <div className="flex flex-wrap gap-3 text-sm mb-3">
                  {user.is_active ? (
                    <span className="flex items-center text-green-600">
                      <CheckCircleIcon className="w-4 h-4 mr-1" />
                      {t('common.active')}
                    </span>
                  ) : (
                    <span className="flex items-center text-red-600">
                      <NoSymbolIcon className="w-4 h-4 mr-1" />
                      {t('common.inactive')}
                    </span>
                  )}
                  {user.mfa_enabled ? (
                    <span className="flex items-center text-green-600">
                      <ShieldCheckIcon className="w-4 h-4 mr-1" />
                      {t('users.twoFactorEnabled')}
                    </span>
                  ) : user.mfa_required ? (
                    <span className="flex items-center text-orange-600">
                      <ShieldCheckIcon className="w-4 h-4 mr-1" />
                      2FA
                    </span>
                  ) : null}
                  {user.last_login && (
                    <span className="text-gray-500">
                      Laatste login: {formatDate(user.last_login)}
                    </span>
                  )}
                </div>
                
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => { setSelectedUser(user); setShowEditModal(true) }}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg min-h-[44px]"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                    <span>{t('common.edit')}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedUser(user); setShowPasswordModal(true) }}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-yellow-600 bg-yellow-50 hover:bg-yellow-100 rounded-lg min-h-[44px]"
                  >
                    <KeyIcon className="w-4 h-4" />
                    <span>{t('auth.password')}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedUser(user); setShowBlockModal(true) }}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg min-h-[44px] ${user.is_active ? 'text-orange-600 bg-orange-50 hover:bg-orange-100' : 'text-green-600 bg-green-50 hover:bg-green-100'}`}
                  >
                    {user.is_active ? <NoSymbolIcon className="w-4 h-4" /> : <CheckCircleIcon className="w-4 h-4" />}
                    <span>{user.is_active ? t('common.inactive') : t('common.active')}</span>
                  </button>
                  {user.mfa_enabled && (
                    <button
                      onClick={() => { setSelectedUser(user); setShowMfaModal(true) }}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg min-h-[44px]"
                    >
                      <ShieldCheckIcon className="w-4 h-4" />
                      <span>2FA uit</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedUser(user); setShowDeleteModal(true) }}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg min-h-[44px]"
                  >
                    <TrashIcon className="w-4 h-4" />
                    <span>{t('common.delete')}</span>
                  </button>
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
        title={t('users.newUser')}
        size="lg"
      >
        <UserForm
          onSave={handleCreateUser}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isActionLoading}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setSelectedUser(null) }}
        title={t('users.editUser')}
        size="lg"
      >
        {selectedUser && (
          <UserForm
            user={selectedUser}
            onSave={handleUpdateUser}
            onCancel={() => { setShowEditModal(false); setSelectedUser(null) }}
            isLoading={isActionLoading}
          />
        )}
      </Modal>

      {/* Password Reset Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setSelectedUser(null) }}
        title={t('users.resetPassword')}
        size="sm"
      >
        {selectedUser && (
          <PasswordResetForm
            user={selectedUser}
            onSave={handlePasswordReset}
            onCancel={() => { setShowPasswordModal(false); setSelectedUser(null) }}
            isLoading={isActionLoading}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedUser(null) }}
        onConfirm={handleDeleteUser}
        title={t('common.delete')}
        message={t('users.deleteConfirm')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        confirmColor="red"
        isLoading={isActionLoading}
      />

      {/* Block/Unblock Confirm Modal */}
      <ConfirmDialog
        isOpen={showBlockModal}
        onClose={() => { setShowBlockModal(false); setSelectedUser(null) }}
        onConfirm={handleToggleActive}
        title={selectedUser?.is_active ? t('common.inactive') : t('common.active')}
        message={t('confirm.submit')}
        confirmText={selectedUser?.is_active ? t('common.inactive') : t('common.active')}
        cancelText={t('common.cancel')}
        confirmColor={selectedUser?.is_active ? 'red' : 'green'}
        isLoading={isActionLoading}
      />

      {/* Disable MFA Confirm Modal */}
      <ConfirmDialog
        isOpen={showMfaModal}
        onClose={() => { setShowMfaModal(false); setSelectedUser(null) }}
        onConfirm={handleDisableMfa}
        title={t('users.twoFactorDisabled')}
        message={t('confirm.submit')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        confirmColor="red"
        isLoading={isActionLoading}
      />
    </div>
  )
}
