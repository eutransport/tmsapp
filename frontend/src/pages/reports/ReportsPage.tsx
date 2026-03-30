/**
 * Reports Agent - Main page
 * Allows users to request reports, view queue status, and open completed reports.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  DocumentChartBarIcon,
  PlusIcon,
  ArrowPathIcon,
  TrashIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  getReportRequests,
  getReportTypes,
  createReportRequest,
  executeReportRequest,
  retryReportRequest,
  deleteReportRequest,
  downloadReportFile,
  ReportRequest,
  ReportTypeInfo,
  CreateReportRequest,
} from '@/api/reports'
import { getUsers } from '@/api/users'
import { getCompanies } from '@/api/companies'
import { getAllDrivers } from '@/api/drivers'
import { getAllVehicles } from '@/api/fleet'
import { User, Driver, Vehicle } from '@/types'
import ReportRequestForm from './ReportRequestForm'
import ReportResultModal from './ReportResultModal'

// ---- Status badge ----

function StatusBadge({ status, display }: { status: string; display: string }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
          <ClockIcon className="w-3 h-3" />
          {display}
        </span>
      )
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
          <ArrowPathIcon className="w-3 h-3 animate-spin" />
          {display}
        </span>
      )
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
          <CheckCircleIcon className="w-3 h-3" />
          {display}
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
          <XCircleIcon className="w-3 h-3" />
          {display}
        </span>
      )
    default:
      return <span className="px-2 py-1 text-xs bg-gray-100 rounded-full">{display}</span>
  }
}

// ---- Action buttons (shared between table and card view) ----

interface ReportActionsProps {
  req: ReportRequest
  executingId: string | null
  onView: () => void
  onExecute: (id: string) => void
  onRetry: (id: string) => void
  onDelete: (id: string) => void
  onDownload: (id: string, format: 'excel' | 'pdf', filename: string) => void
}

function ReportActions({ req, executingId, onView, onExecute, onRetry, onDelete, onDownload }: ReportActionsProps) {
  return (
    <>
      {req.status === 'completed' && req.result_data && (
        <button onClick={onView} title="Bekijk op scherm" className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
          <EyeIcon className="w-4 h-4" />
        </button>
      )}
      {req.status === 'completed' && req.excel_file && (
        <button
          onClick={() => onDownload(req.id, 'excel', `${req.title}.xlsx`)}
          title="Download Excel"
          className="p-1.5 text-green-600 hover:bg-green-50 rounded"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
        </button>
      )}
      {req.status === 'completed' && req.pdf_file && (
        <button
          onClick={() => onDownload(req.id, 'pdf', `${req.title}.pdf`)}
          title="Download PDF"
          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
        </button>
      )}
      {req.status === 'pending' && (
        <button
          onClick={() => onExecute(req.id)}
          disabled={executingId === req.id}
          title="Uitvoeren"
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
        >
          <ArrowPathIcon className={`w-4 h-4 ${executingId === req.id ? 'animate-spin' : ''}`} />
        </button>
      )}
      {req.status === 'failed' && (
        <button onClick={() => onRetry(req.id)} title="Opnieuw proberen" className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded">
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      )}
      <button onClick={() => onDelete(req.id)} title="Verwijderen" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded">
        <TrashIcon className="w-4 h-4" />
      </button>
    </>
  )
}

// ---- Main page ----

const REPORTS_PAGE_SIZE = 10

export default function ReportsPage() {
  const [requests, setRequests] = useState<ReportRequest[]>([])
  const [reportTypes, setReportTypes] = useState<ReportTypeInfo[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [companies, setCompanies] = useState<{ id: string; naam: string }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [quickStartType, setQuickStartType] = useState<ReportTypeInfo | null>(null)
  const [viewingReport, setViewingReport] = useState<ReportRequest | null>(null)
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  const totalPages = Math.max(1, Math.ceil(totalCount / REPORTS_PAGE_SIZE))

  const fetchData = useCallback(async (page?: number) => {
    try {
      const targetPage = page ?? currentPage
      const [paginatedData, typesData] = await Promise.all([
        getReportRequests({ page: targetPage, page_size: REPORTS_PAGE_SIZE }),
        getReportTypes(),
      ])
      setRequests(paginatedData.results)
      setTotalCount(paginatedData.count)
      setReportTypes(typesData)
    } catch {
      toast.error('Fout bij laden van rapporten')
    } finally {
      setIsLoading(false)
    }
  }, [currentPage])

  // Load users, drivers, vehicles and companies for parameter inputs
  useEffect(() => {
    getUsers({ page_size: 200 })
      .then((r) => setUsers(r.results))
      .catch(() => {})
    getAllDrivers()
      .then((list) => setDrivers(list))
      .catch(() => {})
    getAllVehicles()
      .then((list) => setVehicles(list))
      .catch(() => {})
    getCompanies({ page_size: 200 } as Parameters<typeof getCompanies>[0])
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as { results?: { id: string; naam: string }[] }).results ?? []
        setCompanies(list)
      })
      .catch(() => {})
  }, [])

  const requestsRef = useRef<ReportRequest[]>([])

  // Keep ref in sync with state so the polling interval always reads the latest value
  useEffect(() => {
    requestsRef.current = requests
  }, [requests])

  useEffect(() => {
    fetchData()
    // Poll for updates when any request is pending or processing
    const interval = setInterval(() => {
      if (requestsRef.current.some((r) => r.status === 'pending' || r.status === 'processing')) {
        fetchData()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleCreate = async (data: CreateReportRequest) => {
    try {
      const created = await createReportRequest(data)
      toast.success('Rapport verzoek aangemaakt')
      setIsFormOpen(false)
      // Reset to page 1 so the new report is visible, then auto-execute
      setCurrentPage(1)
      await fetchData(1)
      handleExecute(created.id)
    } catch {
      toast.error('Fout bij aanmaken rapport verzoek')
    }
  }

  const handleQuickStart = (rt: ReportTypeInfo) => {
    setQuickStartType(rt)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setQuickStartType(null)
  }

  const handleExecute = async (id: string) => {
    setExecutingId(id)
    try {
      const updated = await executeReportRequest(id)
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)))
      if (updated.status === 'completed') {
        toast.success(`Rapport klaar: ${updated.row_count} rijen gevonden`)
      } else if (updated.status === 'failed') {
        toast.error(`Rapport mislukt: ${updated.error_message}`)
      }
      // Refresh list so the queue reflects the latest state
      await fetchData()
    } catch {
      toast.error('Fout bij uitvoeren rapport')
      await fetchData()
    } finally {
      setExecutingId(null)
    }
  }

  const handleRetry = async (id: string) => {
    try {
      await retryReportRequest(id)
      toast.success('Rapport opnieuw gestart')
      handleExecute(id)
    } catch {
      toast.error('Fout bij opnieuw starten')
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Weet u zeker dat u dit rapport wilt verwijderen?')) return
    try {
      await deleteReportRequest(id)
      toast.success('Rapport verwijderd')
      // If deleting the last item on this page, go back one page
      if (requests.length === 1 && currentPage > 1) {
        const newPage = currentPage - 1
        setCurrentPage(newPage)
        await fetchData(newPage)
      } else {
        await fetchData()
      }
    } catch {
      toast.error('Fout bij verwijderen rapport')
    }
  }

  const handleDownload = async (id: string, format: 'excel' | 'pdf', filename: string) => {
    try {
      const blob = await downloadReportFile(id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Fout bij downloaden bestand')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <SparklesIcon className="w-7 h-7 sm:w-8 sm:h-8 text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Rapport Agent</h1>
            <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">
              Genereer rapporten en exports op basis van uw vragen
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 sm:px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base flex-shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          <span className="hidden xs:inline">Nieuw rapport</span>
          <span className="xs:hidden">Nieuw</span>
        </button>
      </div>

      {/* Report type quick-select cards */}
      {reportTypes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
            Snel starten
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {reportTypes.slice(0, 8).map((rt) => (
              <button
                key={rt.value}
                onClick={() => handleQuickStart(rt)}
                className="text-left p-2.5 sm:p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
              >
                <DocumentChartBarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 mb-1 group-hover:text-blue-700" />
                <p className="text-xs sm:text-sm font-medium text-gray-800 group-hover:text-blue-800 line-clamp-2">
                  {rt.label}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Queue / Request list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Rapport wachtrij ({totalCount})
          </h2>
          <button
            onClick={() => fetchData()}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <ArrowPathIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Vernieuwen</span>
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-12 sm:py-16 bg-white rounded-lg border border-dashed border-gray-300">
            <DocumentChartBarIcon className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Nog geen rapporten aangevraagd.</p>
            <button
              onClick={() => setIsFormOpen(true)}
              className="mt-3 text-blue-600 hover:underline text-sm"
            >
              Maak uw eerste rapport aan
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Titel</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Type</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Rijen</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Aangevraagd</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {requests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 max-w-xs">
                        <span className="font-medium text-gray-900 block truncate">{req.title}</span>
                        {req.error_message && (
                          <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                            <ExclamationCircleIcon className="w-3 h-3" />
                            <span className="truncate">{req.error_message}</span>
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{req.report_type_display}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadge status={req.status} display={req.status_display} />
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {req.row_count !== null ? req.row_count : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {new Date(req.created_at).toLocaleString('nl-NL')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <ReportActions
                            req={req}
                            executingId={executingId}
                            onView={() => setViewingReport(req)}
                            onExecute={handleExecute}
                            onRetry={handleRetry}
                            onDelete={handleDelete}
                            onDownload={handleDownload}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="sm:hidden space-y-2">
              {requests.map((req) => (
                <div key={req.id} className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{req.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{req.report_type_display}</p>
                    </div>
                    <StatusBadge status={req.status} display={req.status_display} />
                  </div>
                  {req.error_message && (
                    <p className="text-xs text-red-500 mb-2 flex items-center gap-1">
                      <ExclamationCircleIcon className="w-3 h-3 flex-shrink-0" />
                      {req.error_message}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {new Date(req.created_at).toLocaleString('nl-NL')}
                      {req.row_count != null && ` · ${req.row_count} rijen`}
                    </span>
                    <div className="flex items-center gap-1">
                      <ReportActions
                        req={req}
                        executingId={executingId}
                        onView={() => setViewingReport(req)}
                        onExecute={handleExecute}
                        onRetry={handleRetry}
                        onDelete={handleDelete}
                        onDownload={handleDownload}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3 mt-3">
                <span className="text-sm text-gray-500">
                  Pagina {currentPage} van {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)) }}
                    disabled={currentPage <= 1}
                    className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
                  >
                    <ChevronLeftIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { setCurrentPage((p) => Math.min(totalPages, p + 1)) }}
                    disabled={currentPage >= totalPages}
                    className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
                  >
                    <ChevronRightIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* New report form modal */}
      {isFormOpen && (
        <ReportRequestForm
          reportTypes={reportTypes}
          users={users}
          drivers={drivers}
          vehicles={vehicles}
          companies={companies}
          onSubmit={handleCreate}
          onClose={handleCloseForm}
          initialType={quickStartType ?? undefined}
        />
      )}

      {/* Result viewer modal */}
      {viewingReport && (
        <ReportResultModal
          report={viewingReport}
          onClose={() => setViewingReport(null)}
          onDownloadExcel={() =>
            handleDownload(viewingReport.id, 'excel', `${viewingReport.title}.xlsx`)
          }
          onDownloadPdf={() =>
            handleDownload(viewingReport.id, 'pdf', `${viewingReport.title}.pdf`)
          }
        />
      )}
    </div>
  )
}
