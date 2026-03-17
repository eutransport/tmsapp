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
  BuildingOfficeIcon,
  EnvelopeIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { Company, MailingListContact } from '@/types'
import { 
  getCompanies, 
  createCompany, 
  updateCompany, 
  deleteCompany,
  CompanyFilters,
  CompanyCreate,
  CompanyUpdate,
  getMailingContacts,
  createMailingContact,
  updateMailingContact,
  deleteMailingContact,
} from '@/api/companies'
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

// Company form component
function CompanyForm({
  company,
  onSave,
  onCancel,
  isLoading,
}: {
  company?: Company
  onSave: (data: CompanyCreate | CompanyUpdate) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState({
    naam: company?.naam || '',
    kvk: company?.kvk || '',
    telefoon: company?.telefoon || '',
    contactpersoon: company?.contactpersoon || '',
    email: company?.email || '',
    adres: company?.adres || '',
    postcode: company?.postcode || '',
    stad: company?.stad || '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    if (!formData.naam.trim()) newErrors.naam = t('validation.nameRequired')
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = t('validation.invalidEmail')
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    onSave(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('companies.companyName')} *
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('companies.kvkNumber')}
          </label>
          <input
            type="text"
            name="kvk"
            value={formData.kvk}
            onChange={handleChange}
            className="input min-h-[44px]"
          />
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
            className="input min-h-[44px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('companies.contactPerson')}
          </label>
          <input
            type="text"
            name="contactpersoon"
            value={formData.contactpersoon}
            onChange={handleChange}
            className="input min-h-[44px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('common.email')}
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
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('common.address')}
        </label>
        <input
          type="text"
          name="adres"
          value={formData.adres}
          onChange={handleChange}
          className="input"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('common.zipCode')}
          </label>
          <input
            type="text"
            name="postcode"
            value={formData.postcode}
            onChange={handleChange}
            className="input min-h-[44px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('common.city')}
          </label>
          <input
            type="text"
            name="stad"
            value={formData.stad}
            onChange={handleChange}
            className="input min-h-[44px]"
          />
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
          {isLoading ? t('common.saving') : company ? t('common.save') : t('common.create')}
        </button>
      </div>
    </form>
  )
}

// Mailing List Panel component
function MailingListPanel({
  company,
  onClose,
}: {
  company: Company
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [contacts, setContacts] = useState<MailingListContact[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingContact, setEditingContact] = useState<MailingListContact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MailingListContact | null>(null)

  // Form state
  const [formData, setFormData] = useState({ naam: '', email: '', functie: '' })

  useEffect(() => {
    loadContacts()
  }, [company.id])

  const loadContacts = async () => {
    try {
      setLoading(true)
      const data = await getMailingContacts(company.id)
      setContacts(data)
    } catch (err) {
      console.error('Failed to load mailing contacts:', err)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({ naam: '', email: '', functie: '' })
    setShowAddForm(false)
    setEditingContact(null)
  }

  const handleAdd = async () => {
    if (!formData.naam.trim() || !formData.email.trim()) return
    try {
      setSaving(true)
      setError(null)
      await createMailingContact({
        bedrijf: company.id,
        naam: formData.naam,
        email: formData.email,
        functie: formData.functie,
      })
      resetForm()
      loadContacts()
    } catch (err: any) {
      setError(err.response?.data?.email?.[0] || err.response?.data?.detail || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async () => {
    if (!editingContact || !formData.naam.trim() || !formData.email.trim()) return
    try {
      setSaving(true)
      setError(null)
      await updateMailingContact(editingContact.id, {
        naam: formData.naam,
        email: formData.email,
        functie: formData.functie,
      })
      resetForm()
      loadContacts()
    } catch (err: any) {
      setError(err.response?.data?.email?.[0] || err.response?.data?.detail || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      setSaving(true)
      await deleteMailingContact(deleteTarget.id)
      setDeleteTarget(null)
      loadContacts()
    } catch (err: any) {
      setError(err.response?.data?.detail || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (contact: MailingListContact) => {
    try {
      await updateMailingContact(contact.id, { is_active: !contact.is_active })
      loadContacts()
    } catch (err) {
      console.error('Failed to toggle contact:', err)
    }
  }

  const startEdit = (contact: MailingListContact) => {
    setEditingContact(contact)
    setFormData({ naam: contact.naam, email: contact.email, functie: contact.functie })
    setShowAddForm(true)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <EnvelopeIcon className="h-5 w-5 text-primary-600" />
            {t('companies.mailingList')}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {company.naam} — {t('companies.mailingListDescription')}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XMarkIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* Contacts list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : contacts.length === 0 && !showAddForm ? (
        <div className="py-8 text-center">
          <UserGroupIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('companies.noContacts')}</p>
          <p className="text-sm text-gray-400 mb-4">{t('companies.addFirstContact')}</p>
          <button
            onClick={() => { resetForm(); setShowAddForm(true) }}
            className="btn-primary text-sm"
          >
            <PlusIcon className="w-4 h-4 mr-1" />
            {t('companies.addContact')}
          </button>
        </div>
      ) : (
        <>
          <div className="divide-y border rounded-lg overflow-hidden">
            {contacts.map(contact => (
              <div
                key={contact.id}
                className={`p-3 flex items-center justify-between gap-3 ${
                  !contact.is_active ? 'bg-gray-50 opacity-60' : 'bg-white'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{contact.naam}</span>
                    {contact.functie && (
                      <span className="text-xs text-gray-400 hidden sm:inline">({contact.functie})</span>
                    )}
                    {!contact.is_active && (
                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                        {t('common.inactive') || 'Inactief'}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 truncate">{contact.email}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleActive(contact)}
                    className={`p-1.5 rounded text-xs font-medium min-w-[44px] min-h-[44px] flex items-center justify-center ${
                      contact.is_active
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={contact.is_active ? 'Deactiveren' : 'Activeren'}
                  >
                    <CheckCircleIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => startEdit(contact)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(contact)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {!showAddForm && (
            <button
              onClick={() => { resetForm(); setShowAddForm(true) }}
              className="btn-secondary text-sm"
            >
              <PlusIcon className="w-4 h-4 mr-1" />
              {t('companies.addContact')}
            </button>
          )}
        </>
      )}

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <h4 className="font-medium text-gray-900 text-sm">
            {editingContact ? t('companies.editContact') : t('companies.addContact')}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('companies.contactName')} *
              </label>
              <input
                type="text"
                value={formData.naam}
                onChange={(e) => setFormData(prev => ({ ...prev, naam: e.target.value }))}
                className="input text-sm"
                placeholder="Jan de Vries"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {t('companies.contactEmail')} *
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="input text-sm"
                placeholder="jan@bedrijf.nl"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('companies.contactFunction')}
            </label>
            <input
              type="text"
              value={formData.functie}
              onChange={(e) => setFormData(prev => ({ ...prev, functie: e.target.value }))}
              className="input text-sm"
              placeholder="Administratie"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={resetForm}
              className="btn-secondary text-sm px-3 py-1.5"
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={editingContact ? handleEdit : handleAdd}
              className="btn-primary text-sm px-3 py-1.5"
              disabled={saving || !formData.naam.trim() || !formData.email.trim()}
            >
              {saving ? t('common.saving') : editingContact ? t('common.save') : t('common.add')}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="border border-red-200 rounded-lg p-4 bg-red-50">
          <p className="text-sm text-red-700 mb-3">
            {t('companies.deleteContactConfirm')} <strong>{deleteTarget.naam}</strong> ({deleteTarget.email})?
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="btn-secondary text-sm px-3 py-1.5"
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="btn-danger text-sm px-3 py-1.5"
              disabled={saving}
            >
              {saving ? t('common.deleting') : t('common.delete')}
            </button>
          </div>
        </div>
      )}

      {/* Close button */}
      <div className="flex justify-end pt-2 border-t">
        <button onClick={onClose} className="btn-secondary">
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

// Main CompaniesPage component
export default function CompaniesPage() {
  const { t } = useTranslation()
  const [companies, setCompanies] = useState<Company[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<string>('naam')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(30)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showMailingModal, setShowMailingModal] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)

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

  // Fetch companies
  const fetchCompanies = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const filters: CompanyFilters = {
        page,
        page_size: pageSize,
        ordering: sortDirection === 'asc' ? sortField : `-${sortField}`,
      }
      if (search) filters.search = search
      
      const response = await getCompanies(filters)
      setCompanies(response.results || [])
      setTotalCount(response.count || 0)
    } catch (err) {
      setError(t('companies.fetchError'))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, sortField, sortDirection, t])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

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
  const handleCreate = async (data: CompanyCreate | CompanyUpdate) => {
    setIsActionLoading(true)
    try {
      await createCompany(data as CompanyCreate)
      setShowCreateModal(false)
      showSuccess(t('companies.companyCreated'))
      fetchCompanies()
    } catch (err: any) {
      setError(getErrorMessage(err, t('companies.createError')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle update
  const handleUpdate = async (data: CompanyCreate | CompanyUpdate) => {
    if (!selectedCompany) return
    setIsActionLoading(true)
    try {
      await updateCompany(selectedCompany.id, data as CompanyUpdate)
      setShowEditModal(false)
      setSelectedCompany(null)
      showSuccess(t('companies.companyUpdated'))
      fetchCompanies()
    } catch (err: any) {
      setError(getErrorMessage(err, t('companies.updateError')))
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!selectedCompany) return
    setIsActionLoading(true)
    try {
      await deleteCompany(selectedCompany.id)
      setShowDeleteModal(false)
      setSelectedCompany(null)
      showSuccess(t('companies.companyDeleted'))
      fetchCompanies()
    } catch (err: any) {
      setError(getErrorMessage(err, t('companies.deleteError')))
      setShowDeleteModal(false)
      setSelectedCompany(null)
    } finally {
      setIsActionLoading(false)
    }
  }

  // Handle page size change
  const handlePageSizeChange = (newSize: PageSize) => {
    setPageSize(newSize)
    setPage(1)
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
        <h1 className="page-title">{t('companies.title')}</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          {t('companies.newCompany')}
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
            <div className="flex-1 min-w-0 sm:min-w-64">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('common.search')}
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder={t('companies.searchCompanies')}
                  className="input pl-10"
                />
              </div>
            </div>

            {/* Refresh button */}
            <button
              onClick={() => fetchCompanies()}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
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
                  className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('naam')}
                >
                  {t('companies.companyName')} <SortIcon field="naam" />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('companies.kvkNumber')}
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('companies.contactPerson')}
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase">
                  {t('companies.contact')}
                </th>
                <th 
                  className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('stad')}
                >
                  {t('companies.location')} <SortIcon field="stad" />
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                      <span className="ml-3">{t('common.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-gray-500">
                    <BuildingOfficeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p>{t('companies.noCompanies')}</p>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="mt-2 text-primary-600 hover:text-primary-700"
                    >
                      {t('companies.addFirstCompany')}
                    </button>
                  </td>
                </tr>
              ) : (
                companies.map(company => (
                  <tr key={company.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-sm text-gray-900">{company.naam}</div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-600">{company.kvk || '-'}</td>
                    <td className="px-3 py-2.5 text-sm text-gray-600">{company.contactpersoon || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-sm">
                        {company.telefoon && <div className="text-gray-600">{company.telefoon}</div>}
                        {company.email && <div className="text-gray-500 truncate max-w-[200px]">{company.email}</div>}
                        {!company.telefoon && !company.email && <span className="text-gray-400">-</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-sm">
                        {company.stad && <div className="text-gray-600">{company.stad}</div>}
                        {company.postcode && <div className="text-gray-500">{company.postcode}</div>}
                        {!company.stad && !company.postcode && <span className="text-gray-400">-</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => { setSelectedCompany(company); setShowMailingModal(true) }}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title={t('companies.mailingList')}
                        >
                          <EnvelopeIcon className="w-4 h-4" />
                          {(company.mailing_contacts_count > 0) && (
                            <span className="sr-only">{company.mailing_contacts_count}</span>
                          )}
                        </button>
                        <button
                          onClick={() => { setSelectedCompany(company); setShowEditModal(true) }}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded"
                          title="Bewerken"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedCompany(company); setShowDeleteModal(true) }}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded"
                          title="Verwijderen"
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
                <span className="ml-3">Laden...</span>
              </div>
            </div>
          ) : companies.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
              <BuildingOfficeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>Geen bedrijven gevonden</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-2 text-primary-600 hover:text-primary-700"
              >
                Voeg je eerste bedrijf toe
              </button>
            </div>
          ) : (
            companies.map(company => (
              <div key={company.id} className="p-3 hover:bg-gray-50">
                {/* Card Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-gray-900 truncate">{company.naam}</h3>
                    {company.contactpersoon && (
                      <p className="text-xs text-gray-500">{company.contactpersoon}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => { setSelectedCompany(company); setShowMailingModal(true) }}
                      className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg flex items-center justify-center"
                      title={t('companies.mailingList')}
                    >
                      <EnvelopeIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setSelectedCompany(company); setShowEditModal(true) }}
                      className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg flex items-center justify-center"
                      title="Bewerken"
                    >
                      <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setSelectedCompany(company); setShowDeleteModal(true) }}
                      className="p-1.5 min-w-[36px] min-h-[36px] text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-lg flex items-center justify-center"
                      title="Verwijderen"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Card Details */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {company.kvk && (
                    <div>
                      <span className="text-gray-500">KVK: </span>
                      <span className="text-gray-700">{company.kvk}</span>
                    </div>
                  )}
                  {company.telefoon && (
                    <div>
                      <span className="text-gray-500">Tel: </span>
                      <a href={`tel:${company.telefoon}`} className="text-primary-600">{company.telefoon}</a>
                    </div>
                  )}
                  {company.email && (
                    <div className="col-span-2">
                      <span className="text-gray-500">E-mail: </span>
                      <a href={`mailto:${company.email}`} className="text-primary-600 truncate">{company.email}</a>
                    </div>
                  )}
                  {(company.stad || company.postcode) && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Locatie: </span>
                      <span className="text-gray-700">
                        {[company.postcode, company.stad].filter(Boolean).join(' ')}
                      </span>
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
          onPageSizeChange={handlePageSizeChange}
        />
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nieuw bedrijf"
        size="lg"
      >
        <CompanyForm
          onSave={handleCreate}
          onCancel={() => setShowCreateModal(false)}
          isLoading={isActionLoading}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => { setShowEditModal(false); setSelectedCompany(null) }}
        title="Bedrijf bewerken"
        size="lg"
      >
        {selectedCompany && (
          <CompanyForm
            company={selectedCompany}
            onSave={handleUpdate}
            onCancel={() => { setShowEditModal(false); setSelectedCompany(null) }}
            isLoading={isActionLoading}
          />
        )}
      </Modal>

      {/* Delete Confirm Modal */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setSelectedCompany(null) }}
        onConfirm={handleDelete}
        title="Bedrijf verwijderen"
        message={`Weet je zeker dat je "${selectedCompany?.naam}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`}
        confirmText="Verwijderen"
        isLoading={isActionLoading}
      />

      {/* Mailing List Modal */}
      <Modal
        isOpen={showMailingModal}
        onClose={() => { setShowMailingModal(false); setSelectedCompany(null) }}
        title={t('companies.mailingList')}
        size="lg"
      >
        {selectedCompany && (
          <MailingListPanel
            company={selectedCompany}
            onClose={() => { setShowMailingModal(false); setSelectedCompany(null) }}
          />
        )}
      </Modal>
    </div>
  )
}
