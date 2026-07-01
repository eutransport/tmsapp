import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  Cog6ToothIcon,
  FolderOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import { getDossiers, getDossierTypes, DossierListItem, DossierType } from '@/api/dossiers'

export default function DossierListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const isManager = user?.rol === 'admin' || user?.module_permissions?.includes('manage_dossiers')

  const [dossiers, setDossiers] = useState<DossierListItem[]>([])
  const [types, setTypes] = useState<DossierType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [count, setCount] = useState(0)

  const loadDossiers = useCallback(async () => {
    try {
      setLoading(true)
      const res = await getDossiers({ page, type: selectedType || undefined, search: search || undefined })
      setDossiers(res.results)
      setTotalPages(res.total_pages)
      setCount(res.count)
      setError(null)
    } catch {
      setError(t('errors.loadError', 'Kon dossiers niet laden'))
    } finally {
      setLoading(false)
    }
  }, [page, selectedType, search, t])

  useEffect(() => {
    getDossierTypes().then(setTypes).catch(() => {})
  }, [])

  useEffect(() => {
    loadDossiers()
  }, [loadDossiers])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setPage(1)
      loadDossiers()
    }
  }

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="page-title">{t('dossiers.title', 'Dossiers')}</h1>
          <p className="mt-1 text-sm text-gray-500">{count} {t('dossiers.totalItems', 'dossiers')}</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/dossiers/types')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
              {t('dossiers.manageTypes', 'Types beheren')}
            </button>
            <button
              onClick={() => navigate('/dossiers/new')}
              className="inline-flex items-center px-3 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <PlusIcon className="h-4 w-4 mr-1.5" />
              {t('dossiers.newDossier', 'Nieuw dossier')}
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('common.search', 'Zoeken...')}
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={selectedType}
          onChange={e => { setSelectedType(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-md text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('dossiers.allTypes', 'Alle types')}</option>
          {types.map(tp => (
            <option key={tp.id} value={tp.id}>{tp.naam}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : dossiers.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpenIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-900">{t('dossiers.empty', 'Geen dossiers gevonden')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{t('dossiers.subject', 'Onderwerp')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{t('dossiers.type', 'Type')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">{t('dossiers.regarding', 'Betreft')}</th>
                  {isManager && (
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">{t('dossiers.submittedBy', 'Instuurder')}</th>
                  )}
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">{t('dossiers.attachment', 'Bijlage')}</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">{t('dossiers.reactions', 'Reacties')}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">{t('common.createdAt', 'Aangemaakt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dossiers.map(d => (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/dossiers/${d.id}`)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900 max-w-xs truncate">{d.onderwerp}</td>
                    <td className="px-3 py-2.5 text-gray-600">{d.type_naam}</td>
                    <td className="px-3 py-2.5 text-gray-600 hidden md:table-cell">{d.betreft_naam || '-'}</td>
                    {isManager && (
                      <td className="px-3 py-2.5 text-gray-600 hidden lg:table-cell">{d.instuurder_naam || '-'}</td>
                    )}
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      {d.heeft_bijlage ? <PaperClipIcon className="h-4 w-4 text-blue-500 mx-auto" /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gray-100 text-xs font-medium text-gray-600">{d.reactie_count}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs hidden md:table-cell">{formatDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {t('common.page', 'Pagina')} {page} {t('common.of', 'van')} {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
