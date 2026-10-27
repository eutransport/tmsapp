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
  CloudArrowUpIcon,
  LockClosedIcon,
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
  getAvailablePermissions,
  syncUserMetAzure,
  getAzureOverzicht,
  syncAlleUsersMetAzure,
  UserFilters,
  UserUpdate,
  AvailablePermission,
  AzureOverzichtRegel,
  AzureSyncAllesResultaat,
} from '@/api/users'
import { getAllCompanies } from '@/api/companies'
import Pagination, { PageSize } from '@/components/common/Pagination'

// Role labels and colors
const roleConfig: Record<string, { key: string; color: string }> = {
  admin: { key: 'users.admin', color: 'bg-purple-100 text-purple-800' },
  gebruiker: { key: 'users.user', color: 'bg-blue-100 text-blue-800' },
  chauffeur: { key: 'users.driver', color: 'bg-green-100 text-green-800' },
  opdrachtgever: { key: 'users.client', color: 'bg-amber-100 text-amber-800' },
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
  const [availablePermissions, setAvailablePermissions] = useState<AvailablePermission[]>([])
  const [dependencies, setDependencies] = useState<Record<string, string[]>>({})
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(user?.module_permissions || [])
  const [formData, setFormData] = useState({
    email: user?.email || '',
    username: user?.username || '',
    voornaam: user?.voornaam || '',
    achternaam: user?.achternaam || '',
    telefoon: user?.telefoon || '',
    bedrijf: user?.bedrijf || '',
    rol: user?.rol || 'gebruiker',
    opdrachtgever_bedrijf: user?.opdrachtgever_bedrijf || '',
    is_active: user?.is_active ?? true,
    mfa_required: user?.mfa_required ?? false,
    password: '',
    password_confirm: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    getAllCompanies().then(setCompanies).catch(console.error)
    getAvailablePermissions().then(data => {
      setAvailablePermissions(data.permissions)
      setDependencies(data.dependencies)
    }).catch(console.error)
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

    if (formData.rol === 'opdrachtgever' && !formData.opdrachtgever_bedrijf) {
      newErrors.opdrachtgever_bedrijf = t('errors.required')
    }
    
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

  // Resolve dependencies: when toggling a permission on, also enable required dependencies
  const resolveWithDependencies = (perms: string[]): string[] => {
    const resolved = new Set(perms)
    for (const perm of perms) {
      for (const dep of (dependencies[perm] || [])) {
        resolved.add(dep)
      }
    }
    return Array.from(resolved)
  }

  // Check if a permission is a dependency of any currently selected permission
  const isDependencyOf = (permCode: string): boolean => {
    return selectedPermissions.some(p => 
      (dependencies[p] || []).includes(permCode)
    )
  }

  const handlePermissionToggle = (permCode: string) => {
    setSelectedPermissions(prev => {
      if (prev.includes(permCode)) {
        // Don't allow unchecking if it's a dependency of another selected permission
        if (isDependencyOf(permCode)) return prev
        return prev.filter(p => p !== permCode)
      } else {
        return resolveWithDependencies([...prev, permCode])
      }
    })
  }

  const handleSelectAll = () => {
    setSelectedPermissions(availablePermissions.map(p => p.code))
  }

  const handleDeselectAll = () => {
    setSelectedPermissions([])
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    // De backend eist dat het bedrijf leeg is zodra de rol geen opdrachtgever is.
    const isOpdrachtgever = formData.rol === 'opdrachtgever'
    const basis = {
      ...formData,
      opdrachtgever_bedrijf: isOpdrachtgever ? formData.opdrachtgever_bedrijf : null,
    }
    const rechten = isOpdrachtgever ? [] : selectedPermissions

    if (user) {
      // Update - don't send password
      const { password, password_confirm, ...updateData } = basis
      onSave({ ...updateData, module_permissions: rechten })
    } else {
      // Create - send all data
      onSave({ ...basis, module_permissions: rechten } as any)
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
            <option value="opdrachtgever">{t('users.client', 'Opdrachtgever')}</option>
            <option value="admin">{t('users.admin')}</option>
          </select>
        </div>
        {formData.rol === 'opdrachtgever' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('users.clientCompany', 'Bedrijf opdrachtgever')} *
            </label>
            <select
              name="opdrachtgever_bedrijf"
              value={formData.opdrachtgever_bedrijf}
              onChange={handleChange}
              className="input min-h-[44px]"
            >
              <option value="">{t('common.select', 'Selecteer...')}</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.naam}</option>
              ))}
            </select>
            {errors.opdrachtgever_bedrijf && (
              <p className="mt-1 text-sm text-red-600">{errors.opdrachtgever_bedrijf}</p>
            )}
          </div>
        )}
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

      {/* Module Permissions */}
      {availablePermissions.length > 0 && formData.rol !== 'opdrachtgever' && (
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">{t('users.modulePermissions')}</h4>
            {formData.rol !== 'admin' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-primary-600 hover:text-primary-800"
                >
                  {t('users.selectAll')}
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-xs text-primary-600 hover:text-primary-800"
                >
                  {t('users.deselectAll')}
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">{t('users.modulePermissionsDesc')}</p>
          
          {formData.rol === 'admin' ? (
            <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
              ✓ {t('users.adminAllPermissions')}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {availablePermissions.map(perm => {
                const isChecked = selectedPermissions.includes(perm.code)
                const isDepLocked = isDependencyOf(perm.code) && isChecked
                return (
                  <label
                    key={perm.code}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      isChecked
                        ? 'bg-primary-50 border-primary-200'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                    } ${isDepLocked ? 'opacity-70' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handlePermissionToggle(perm.code)}
                      disabled={isDepLocked}
                      className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 select-none">
                      {perm.label}
                      {isDepLocked && (
                        <span className="text-xs text-gray-400 ml-1">({t('users.autoEnabled')})</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )}

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

  // Azure / Microsoft Entra ID
  const [azureBezig, setAzureBezig] = useState<string | null>(null)
  const [azureOverzicht, setAzureOverzicht] = useState<AzureOverzichtRegel[] | null>(null)
  const [azureAlles, setAzureAlles] = useState<AzureSyncAllesResultaat | null>(null)
  // Startwachtwoorden worden alleen in het geheugen gehouden en verdwijnen
  // zodra het venster gesloten wordt; ze staan nergens opgeslagen.
  const [azureWachtwoorden, setAzureWachtwoorden] = useState<Record<string, string> | null>(null)

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
      const nieuw: any = await createUser(data as UserCreate)
      setShowCreateModal(false)
      // Bij automatisch aanmaken in Azure komt het startwachtwoord mee; dat
      // is de enige keer dat het te zien is.
      if (nieuw?.azure?.wachtwoord) {
        setAzureWachtwoorden({ [(data as UserCreate).email]: nieuw.azure.wachtwoord })
      } else if (nieuw?.azure?.status === 'mislukt') {
        setError(`Gebruiker aangemaakt, maar het Microsoft-account niet: ${nieuw.azure.reden}`)
      }
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

  // Maak of koppel het Microsoft-account van één gebruiker
  const handleAzureSync = async (user: User) => {
    setAzureBezig(user.id)
    setError(null)
    try {
      const resultaat = await syncUserMetAzure(user.id)
      if (resultaat.wachtwoord) {
        setAzureWachtwoorden({ [user.email]: resultaat.wachtwoord })
      } else {
        showSuccess(
          resultaat.status === 'gekoppeld'
            ? `${user.email} bestond al in Azure en is nu gekoppeld.`
            : `${user.email} was al gekoppeld.`
        )
      }
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, 'Synchroniseren met Azure is mislukt.'))
    } finally {
      setAzureBezig(null)
    }
  }

  // Eerst laten zien wat er zou gebeuren; pas daarna echt aanmaken
  const handleAzureOverzicht = async () => {
    setAzureBezig('overzicht')
    setError(null)
    try {
      const resultaat = await getAzureOverzicht()
      setAzureOverzicht(resultaat.gebruikers)
    } catch (err: any) {
      setError(getErrorMessage(err, 'Het Azure-overzicht ophalen is mislukt.'))
    } finally {
      setAzureBezig(null)
    }
  }

  const handleAzureSyncAlles = async () => {
    setAzureBezig('alles')
    setError(null)
    try {
      const resultaat = await syncAlleUsersMetAzure()
      setAzureOverzicht(null)
      setAzureAlles(resultaat)
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, 'Synchroniseren met Azure is mislukt.'))
    } finally {
      setAzureBezig(null)
    }
  }

  // Zet wachtwoord-login aan of uit voor één gebruiker
  const handleWachtwoordLogin = async (user: User) => {
    setAzureBezig(user.id)
    setError(null)
    try {
      await updateUser(user.id, {
        wachtwoord_login_uitgeschakeld: !user.wachtwoord_login_uitgeschakeld,
      })
      showSuccess(
        user.wachtwoord_login_uitgeschakeld
          ? `${user.email} kan weer met wachtwoord inloggen.`
          : `${user.email} kan voortaan alleen nog via Microsoft inloggen.`
      )
      fetchUsers()
    } catch (err: any) {
      setError(getErrorMessage(err, 'Wijzigen is mislukt.'))
    } finally {
      setAzureBezig(null)
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
        <div className="flex items-center gap-2">
          <button
            onClick={handleAzureOverzicht}
            disabled={azureBezig !== null}
            className="btn-secondary disabled:opacity-50"
            title="Laat eerst zien welke gebruikers een Microsoft-account zouden krijgen"
          >
            <CloudArrowUpIcon className="w-5 h-5 mr-2" />
            {azureBezig === 'overzicht' ? 'Bezig...' : 'Synchroniseer met Azure'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            {t('users.newUser')}
          </button>
        </div>
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
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {/* Role filter */}
              <div className="flex-1 sm:w-36">
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
                  <option value="opdrachtgever">{t('users.client', 'Opdrachtgever')}</option>
                </select>
              </div>

              {/* Status filter */}
              <div className="flex-1 sm:w-36">
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Microsoft
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
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                      <span className="ml-3">{t('common.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
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
                    <td className="px-4 py-3 text-sm">
                      {user.azure_gekoppeld ? (
                        <div>
                          <span className="flex items-center text-green-600">
                            <CheckCircleIcon className="w-4 h-4 mr-1" />
                            Gekoppeld
                          </span>
                          {user.entra_upn && (
                            <div className="text-xs text-gray-500">{user.entra_upn}</div>
                          )}
                          {user.wachtwoord_login_uitgeschakeld && (
                            <div className="text-xs text-purple-600">Alleen Microsoft</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">Niet gekoppeld</span>
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
                          title={t('common.edit')}
                        >
                          <PencilSquareIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setShowPasswordModal(true) }}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-yellow-600 hover:bg-gray-100 rounded"
                          title={t('users.resetPassword')}
                        >
                          <KeyIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setShowBlockModal(true) }}
                          className={`p-2 min-w-[40px] min-h-[40px] hover:bg-gray-100 rounded ${user.is_active ? 'text-gray-500 hover:text-orange-600' : 'text-gray-500 hover:text-green-600'}`}
                          title={user.is_active ? t('users.block') : t('users.activate')}
                        >
                          {user.is_active ? <NoSymbolIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
                        </button>
                        {user.mfa_enabled && (
                          <button
                            onClick={() => { setSelectedUser(user); setShowMfaModal(true) }}
                            className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-purple-600 hover:bg-gray-100 rounded"
                            title={t('users.disable2FA')}
                          >
                            <ShieldCheckIcon className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleAzureSync(user)}
                          disabled={!!user.azure_gekoppeld || azureBezig === user.id}
                          className="p-2 min-w-[40px] min-h-[40px] text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500"
                          title={user.azure_gekoppeld
                            ? 'Deze gebruiker heeft al een gekoppeld Microsoft-account'
                            : 'Microsoft-account aanmaken of koppelen'}
                        >
                          <CloudArrowUpIcon className="w-5 h-5" />
                        </button>
                        {user.azure_gekoppeld && (
                          <button
                            onClick={() => handleWachtwoordLogin(user)}
                            disabled={azureBezig === user.id}
                            className={`p-2 min-w-[40px] min-h-[40px] hover:bg-gray-100 rounded disabled:opacity-40 ${
                              user.wachtwoord_login_uitgeschakeld ? 'text-purple-600' : 'text-gray-500 hover:text-purple-600'
                            }`}
                            title={user.wachtwoord_login_uitgeschakeld
                              ? 'Inloggen met wachtwoord weer toestaan'
                              : 'Alleen nog inloggen via Microsoft toestaan'}
                          >
                            <LockClosedIcon className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => { setSelectedUser(user); setShowDeleteModal(true) }}
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
                  {user.azure_gekoppeld ? (
                    <span className="flex items-center text-green-600">
                      <CloudArrowUpIcon className="w-4 h-4 mr-1" />
                      {user.wachtwoord_login_uitgeschakeld ? 'Alleen Microsoft' : 'Microsoft gekoppeld'}
                    </span>
                  ) : (
                    <span className="text-gray-400">Geen Microsoft-account</span>
                  )}
                </div>
                
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => { setSelectedUser(user); setShowEditModal(true) }}
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('common.edit')}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedUser(user); setShowPasswordModal(true) }}
                    title={t('auth.password')}
                    aria-label={t('auth.password')}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                  >
                    <KeyIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('auth.password')}</span>
                  </button>
                  <button
                    onClick={() => { setSelectedUser(user); setShowBlockModal(true) }}
                    title={user.is_active ? t('common.inactive') : t('common.active')}
                    aria-label={user.is_active ? t('common.inactive') : t('common.active')}
                    className={`inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium rounded-md transition-colors ${user.is_active ? 'text-orange-700 bg-orange-50 hover:bg-orange-100' : 'text-green-700 bg-green-50 hover:bg-green-100'}`}
                  >
                    {user.is_active ? <NoSymbolIcon className="w-4 h-4" /> : <CheckCircleIcon className="w-4 h-4" />}
                    <span className="hidden sm:inline">{user.is_active ? t('common.inactive') : t('common.active')}</span>
                  </button>
                  {user.mfa_enabled && (
                    <button
                      onClick={() => { setSelectedUser(user); setShowMfaModal(true) }}
                      title="2FA uit"
                      aria-label="2FA uit"
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors"
                    >
                      <ShieldCheckIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">2FA uit</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleAzureSync(user)}
                    disabled={!!user.azure_gekoppeld || azureBezig === user.id}
                    title={user.azure_gekoppeld ? 'Heeft al een Microsoft-account' : 'Microsoft-account aanmaken'}
                    aria-label="Microsoft-account aanmaken"
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CloudArrowUpIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">Azure</span>
                  </button>
                  {user.azure_gekoppeld && (
                    <button
                      onClick={() => handleWachtwoordLogin(user)}
                      disabled={azureBezig === user.id}
                      title={user.wachtwoord_login_uitgeschakeld
                        ? 'Inloggen met wachtwoord weer toestaan'
                        : 'Alleen nog inloggen via Microsoft'}
                      aria-label="Wachtwoord-login omschakelen"
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors disabled:opacity-40"
                    >
                      <LockClosedIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">
                        {user.wachtwoord_login_uitgeschakeld ? 'Wachtwoord aan' : 'Wachtwoord uit'}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedUser(user); setShowDeleteModal(true) }}
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('common.delete')}</span>
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

      {/* Azure: eerst tonen wat er zou gebeuren */}
      <Modal
        isOpen={azureOverzicht !== null}
        onClose={() => setAzureOverzicht(null)}
        title="Synchroniseren met Azure"
        size="lg"
      >
        {azureOverzicht && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Er wordt nog niets aangemaakt. Hieronder zie je wat er gaat gebeuren als je doorgaat.
              Gebruikers die al gekoppeld zijn, worden overgeslagen.
            </p>
            <div className="max-h-80 overflow-y-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Gebruiker</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Wordt in Azure</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Actie</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {azureOverzicht.map(regel => (
                    <tr key={regel.id}>
                      <td className="px-3 py-2">
                        <div className="text-gray-900">{regel.naam}</div>
                        <div className="text-xs text-gray-500">{regel.email}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {regel.voorstel || <span className="text-red-600">{regel.probleem}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {regel.gekoppeld ? (
                          <span className="text-gray-400">Overslaan</span>
                        ) : regel.voorstel ? (
                          <span className="text-blue-600">Aanmaken of koppelen</span>
                        ) : (
                          <span className="text-red-600">Niet mogelijk</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-gray-600">
              {azureOverzicht.filter(r => !r.gekoppeld && r.voorstel).length} gebruiker(s) worden verwerkt.
              Startwachtwoorden zie je daarna <strong>één keer</strong>; bewaar ze meteen.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setAzureOverzicht(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary disabled:opacity-50"
                onClick={handleAzureSyncAlles}
                disabled={azureBezig !== null || azureOverzicht.every(r => r.gekoppeld || !r.voorstel)}
              >
                {azureBezig === 'alles' ? 'Bezig...' : 'Doorgaan'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Azure: uitslag van een volledige ronde */}
      <Modal
        isOpen={azureAlles !== null}
        onClose={() => setAzureAlles(null)}
        title="Resultaat synchronisatie"
        size="lg"
      >
        {azureAlles && (
          <div className="space-y-4 text-sm">
            <ul className="space-y-1">
              <li><strong>{azureAlles.aangemaakt.length}</strong> account(s) aangemaakt</li>
              <li><strong>{azureAlles.gekoppeld.length}</strong> bestaand account gekoppeld</li>
              <li><strong>{azureAlles.overgeslagen.length}</strong> overgeslagen (al gekoppeld)</li>
              <li className={azureAlles.mislukt.length ? 'text-red-600' : ''}>
                <strong>{azureAlles.mislukt.length}</strong> mislukt
              </li>
            </ul>

            {azureAlles.mislukt.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded p-3 max-h-40 overflow-y-auto">
                {azureAlles.mislukt.map(m => (
                  <div key={m.email} className="text-red-700">
                    <strong>{m.email}</strong>: {m.reden}
                  </div>
                ))}
              </div>
            )}

            {Object.keys(azureAlles.wachtwoorden).length > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2">
                <p className="text-amber-800 font-medium">
                  Startwachtwoorden – deze worden nergens opgeslagen en zijn na sluiten weg.
                </p>
                <div className="max-h-48 overflow-y-auto font-mono text-xs space-y-1">
                  {Object.entries(azureAlles.wachtwoorden).map(([email, ww]) => (
                    <div key={email}>{email}: {ww}</div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => navigator.clipboard?.writeText(
                    Object.entries(azureAlles.wachtwoorden)
                      .map(([email, ww]) => `${email}\t${ww}`)
                      .join('\n')
                  )}
                >
                  Kopieer naar klembord
                </button>
              </div>
            )}

            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setAzureAlles(null)}>
                {t('common.close', 'Sluiten')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Azure: startwachtwoord van één gebruiker, eenmalig */}
      <Modal
        isOpen={azureWachtwoorden !== null}
        onClose={() => setAzureWachtwoorden(null)}
        title="Microsoft-account aangemaakt"
        size="md"
      >
        {azureWachtwoorden && (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              Noteer dit startwachtwoord nu. Het wordt nergens bewaard en is na het sluiten
              van dit venster niet meer op te vragen. De gebruiker moet het bij de eerste
              aanmelding zelf wijzigen.
            </p>
            <div className="border border-amber-300 bg-amber-50 rounded p-3 font-mono">
              {Object.entries(azureWachtwoorden).map(([email, ww]) => (
                <div key={email}>
                  <div className="text-xs text-gray-600">{email}</div>
                  <div className="text-base">{ww}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigator.clipboard?.writeText(
                  Object.values(azureWachtwoorden)[0] || ''
                )}
              >
                Kopieer wachtwoord
              </button>
              <button className="btn-primary" onClick={() => setAzureWachtwoorden(null)}>
                {t('common.close', 'Sluiten')}
              </button>
            </div>
          </div>
        )}
      </Modal>

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
