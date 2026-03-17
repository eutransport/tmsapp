/**
 * Invoice Templates Management Page
 * Lists templates and links to the visual editor
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  DocumentDuplicateIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline'
import { getTemplates, deleteTemplate, copyTemplate, exportTemplate, importTemplate } from '@/api/invoices'
import { InvoiceTemplate } from '@/types'

export default function TemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Fetch templates
  const fetchTemplates = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await getTemplates(false)
      setTemplates(response.results)
    } catch (err) {
      setError(t('errors.loadTemplates'))
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  // Auto-hide messages
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  // Handle delete
  const handleDelete = async (id: string) => {
    try {
      setIsDeleting(true)
      setError(null)
      await deleteTemplate(id)
      setSuccessMessage(t('templates.deleted'))
      setDeleteConfirmId(null)
      fetchTemplates()
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errors.deleteTemplate'))
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle copy
  const handleCopy = async (template: InvoiceTemplate) => {
    try {
      setIsCopying(true)
      setError(null)
      const newTemplate = await copyTemplate(template.id)
      setSuccessMessage(t('templates.copied', { name: newTemplate.naam }))
      fetchTemplates()
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errors.copyTemplate'))
    } finally {
      setIsCopying(false)
    }
  }

  // Handle export
  const handleExport = async (template: InvoiceTemplate) => {
    try {
      setError(null)
      await exportTemplate(template.id)
      setSuccessMessage(t('templates.exported', { name: template.naam }))
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errors.exportTemplate'))
    }
  }

  // Handle import
  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setError(null)
      const newTemplate = await importTemplate(file)
      setSuccessMessage(t('templates.imported', { name: newTemplate.naam }))
      fetchTemplates()
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.importTemplate'))
    }
    
    // Reset file input
    event.target.value = ''
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('templates.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {t('templates.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
            <ArrowUpTrayIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
            {t('common.import')}
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              className="hidden"
            />
          </label>
          <button
            onClick={() => navigate('/invoices/templates/new')}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
          >
            <PlusIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
            {t('templates.newTemplate')}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="flex">
            <XCircleIcon className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="rounded-md bg-green-50 p-4">
          <div className="flex">
            <CheckCircleIcon className="h-5 w-5 text-green-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">{successMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Templates List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <DocumentDuplicateIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">{t('templates.noTemplates')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('templates.createFirst')}
          </p>
          <div className="mt-6">
            <button
              onClick={() => navigate('/invoices/templates/new')}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
              {t('templates.newTemplate')}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          {/* Desktop Table */}
          <table className="hidden md:table min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('common.template')}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('common.status')}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('common.updated')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {templates.map((template) => (
                <tr key={template.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center">
                      <DocumentDuplicateIcon className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {template.naam}
                        </div>
                        {template.beschrijving && (
                          <div className="text-xs text-gray-500 truncate max-w-xs">
                            {template.beschrijving}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {template.is_active ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircleIcon className="h-3 w-3 mr-1" />
                        {t('common.active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        {t('common.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {new Date(template.updated_at).toLocaleDateString('nl-NL', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-1">
                      <button
                        onClick={() => handleExport(template)}
                        className="p-1.5 text-gray-400 hover:text-green-600 transition-colors"
                        title={t('templates.export')}
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleCopy(template)}
                        disabled={isCopying}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                        title={t('templates.copy')}
                      >
                        <DocumentDuplicateIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => navigate(`/invoices/templates/${template.id}/edit`)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors"
                        title={t('templates.editVisual')}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(template.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                        title={t('common.delete')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile Card Layout */}
          <div className="md:hidden divide-y divide-gray-200">
            {templates.map((template) => (
              <div key={template.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <DocumentDuplicateIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{template.naam}</div>
                      {template.beschrijving && (
                        <div className="text-xs text-gray-500 truncate">{template.beschrijving}</div>
                      )}
                    </div>
                  </div>
                  {template.is_active ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 flex-shrink-0">
                      <CheckCircleIcon className="h-3 w-3 mr-1" />
                      {t('common.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 flex-shrink-0">
                      {t('common.inactive')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {t('common.updated')}: {new Date(template.updated_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div className="flex items-center gap-1 pt-1 border-t border-gray-100">
                  <button
                    onClick={() => handleExport(template)}
                    className="flex-1 flex items-center justify-center gap-1 p-2 text-xs text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    {t('templates.export')}
                  </button>
                  <button
                    onClick={() => handleCopy(template)}
                    disabled={isCopying}
                    className="flex-1 flex items-center justify-center gap-1 p-2 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" />
                    {t('templates.copy')}
                  </button>
                  <button
                    onClick={() => navigate(`/invoices/templates/${template.id}/edit`)}
                    className="flex-1 flex items-center justify-center gap-1 p-2 text-xs text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                  >
                    <PencilIcon className="h-4 w-4" />
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(template.id)}
                    className="flex-1 flex items-center justify-center gap-1 p-2 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <div 
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" 
              onClick={() => setDeleteConfirmId(null)} 
            />
            <div className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
              <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
                <h3 className="text-lg font-semibold leading-6 text-gray-900 mb-4">
                  {t('templates.deleteTitle')}
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  {t('templates.deleteConfirm')}
                </p>
                <p className="text-sm text-amber-600 mb-4">
                  {t('templates.deleteWarning')}
                </p>
                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => handleDelete(deleteConfirmId)}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? t('common.deleting') : t('common.delete')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
