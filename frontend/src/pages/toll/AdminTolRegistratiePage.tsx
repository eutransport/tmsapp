import { useState, useEffect, Fragment } from 'react'
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  EyeIcon,
  PaperClipIcon,
  TrashIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { TolRegistratie, getTolRegistraties, getTolDownloadUrl, deleteTolRegistratie, markTolIngediend, markTolGefactureerd } from '@/api/tolregistratie'
import toast from 'react-hot-toast'
import api from '@/api/client'
import Pagination, { PageSize } from '@/components/common/Pagination'
import { formatBedrag, formatDate } from './utils'
import { Dialog, Transition } from '@headlessui/react'

export default function AdminTolRegistratiePage() {
  const [registraties, setRegistraties] = useState<TolRegistratie[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [datumVan, setDatumVan] = useState('')
  const [datumTot, setDatumTot] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [pageSize, setPageSize] = useState<PageSize>(30)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<TolRegistratie | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Status toggle state
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null)

  // PDF viewer modal state
  const [pdfModalReg, setPdfModalReg] = useState<TolRegistratie | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  useEffect(() => {
    loadRegistraties()
  }, [currentPage, pageSize, datumVan, datumTot, searchTerm])

  // Cleanup blob URL when modal closes
  useEffect(() => {
    if (!pdfModalReg && pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }
  }, [pdfModalReg, pdfBlobUrl])

  const loadRegistraties = async () => {
    try {
      setLoading(true)
      const filters: Record<string, any> = {
        page: currentPage,
        page_size: pageSize,
        ordering: '-datum',
      }
      if (datumVan) filters['datum__gte'] = datumVan
      if (datumTot) filters['datum__lte'] = datumTot
      if (searchTerm) filters['search'] = searchTerm

      const response = await getTolRegistraties(filters)
      setRegistraties(response.results)
      setTotalCount(response.count)
    } catch {
      toast.error('Fout bij laden')
    } finally {
      setLoading(false)
    }
  }

  const filtered = registraties

  const handleViewBijlage = async (reg: TolRegistratie) => {
    if (!reg.bijlage_url) return
    setPdfModalReg(reg)
    setPdfLoading(true)
    try {
      const response = await api.get(getTolDownloadUrl(reg.id), { responseType: 'blob' })
      const blob = new Blob([response.data], { type: response.headers['Content-Type'] || response.headers['content-type'] || 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfBlobUrl(url)
    } catch {
      toast.error('Fout bij laden van bijlage')
      setPdfModalReg(null)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleClosePdfModal = () => {
    setPdfModalReg(null)
  }

  const handleDownload = async (reg: TolRegistratie) => {
    try {
      const response = await api.get(getTolDownloadUrl(reg.id), { responseType: 'blob' })
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = reg.bijlage_naam || `tol-${reg.id}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Fout bij downloaden')
    }
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteTolRegistratie(deleteTarget.id)
      toast.success('Tolregistratie verwijderd')
      setDeleteTarget(null)
      loadRegistraties()
    } catch {
      toast.error('Fout bij verwijderen')
    } finally {
      setDeleting(false)
    }
  }

  const handleToggleStatus = async (reg: TolRegistratie) => {
    setTogglingStatus(reg.id)
    try {
      if (reg.gefactureerd) {
        await markTolIngediend([reg.id])
        toast.success('Status gewijzigd naar Ingediend')
      } else {
        await markTolGefactureerd([reg.id])
        toast.success('Status gewijzigd naar Gefactureerd')
      }
      loadRegistraties()
    } catch {
      toast.error('Fout bij wijzigen status')
    } finally {
      setTogglingStatus(null)
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Ingediende Tol</h1>
        <p className="text-sm text-gray-500">Alle tolregistraties van chauffeurs</p>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
            placeholder="Zoek op chauffeur of kenteken..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Van:</label>
          <input
            type="date"
            value={datumVan}
            onChange={e => { setDatumVan(e.target.value); setCurrentPage(1) }}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Tot:</label>
          <input
            type="date"
            value={datumTot}
            onChange={e => { setDatumTot(e.target.value); setCurrentPage(1) }}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <PaperClipIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Geen tolregistraties gevonden</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chauffeur</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Wagen</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ritnummers</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Bijlage</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(reg => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{reg.user_naam || '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(reg.datum)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{reg.kenteken || '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {reg.ritten && reg.ritten.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {reg.ritten.map(r => (
                            <span key={r.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">
                              {r.ritnummer}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{formatBedrag(reg.totaal_bedrag)}</td>
                    <td className="px-4 py-2 text-center">
                      {reg.bijlage_url ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleViewBijlage(reg)}
                            title="Bekijken"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                          >
                            <EyeIcon className="w-3 h-3" /> Inzien
                          </button>
                          <button
                            onClick={() => handleDownload(reg)}
                            title="Downloaden"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-50 text-gray-700 rounded hover:bg-gray-100"
                          >
                            <ArrowDownTrayIcon className="w-3 h-3" /> Download
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => handleToggleStatus(reg)}
                        disabled={togglingStatus === reg.id}
                        title={reg.gefactureerd ? 'Klik om terug te zetten naar Ingediend' : 'Klik om te markeren als Gefactureerd'}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-50 ${
                          reg.gefactureerd
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {togglingStatus === reg.id ? (
                          <span aria-label="Status wordt gewijzigd" className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <ArrowPathIcon aria-hidden="true" className="w-3 h-3" />
                        )}
                        {reg.gefactureerd ? 'Gefactureerd' : 'Ingediend'}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => setDeleteTarget(reg)}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Verwijderen"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t px-4 py-3">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalCount={totalCount}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1) }}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Transition appear show={!!deleteTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => !deleting && setDeleteTarget(null)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
                    </div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      Tolregistratie verwijderen
                    </Dialog.Title>
                  </div>
                  <p className="text-gray-600 mb-2">
                    Weet je zeker dat je deze tolregistratie wilt verwijderen?
                  </p>
                  {deleteTarget && (
                    <p className="text-sm font-medium text-gray-700 mb-6">
                      {formatDate(deleteTarget.datum)} — {deleteTarget.kenteken} — {formatBedrag(deleteTarget.totaal_bedrag)}
                    </p>
                  )}
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Annuleren
                    </button>
                    <button
                      onClick={handleDeleteConfirm}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? 'Bezig...' : 'Verwijderen'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* PDF viewer modal */}
      <Transition appear show={!!pdfModalReg} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleClosePdfModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col" style={{ maxHeight: '90vh' }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      Bijlage — {pdfModalReg && `${formatDate(pdfModalReg.datum)} · ${pdfModalReg.kenteken}`}
                    </Dialog.Title>
                    <div className="flex items-center gap-2">
                      {pdfModalReg && (
                        <button
                          onClick={() => handleDownload(pdfModalReg)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" /> Download
                        </button>
                      )}
                      <button
                        onClick={handleClosePdfModal}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden" style={{ minHeight: '60vh' }}>
                    {pdfLoading ? (
                      <div className="flex items-center justify-center h-full py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                      </div>
                    ) : pdfBlobUrl ? (
                      <iframe
                        src={pdfBlobUrl}
                        className="w-full h-full border-0"
                        style={{ minHeight: '60vh' }}
                        title="Tolfactuur bijlage"
                      />
                    ) : null}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
