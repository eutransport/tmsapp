/**
 * Reports Agent - Main page
 * Allows users to request reports, view queue status, and open completed reports.
 */
import { useState, useEffect, useCallback } from 'react'
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
import { User } from '@/types'
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

// ---- Main page ----

export default function ReportsPage() {
  const [requests, setRequests] = useState<ReportRequest[]>([])
  const [reportTypes, setReportTypes] = useState<ReportTypeInfo[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<{ id: string; naam: string }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [viewingReport, setViewingReport] = useState<ReportRequest | null>(null)
  const [executingId, setExecutingId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [requestsData, typesData] = await Promise.all([
        getReportRequests(),
        getReportTypes(),
      ])
      setRequests(requestsData)
      setReportTypes(typesData)
    } catch {
      toast.error('Fout bij laden van rapporten')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load users and companies for parameter inputs
  useEffect(() => {
    getUsers({ page_size: 200 })
      .then((r) => setUsers(r.results))
      .catch(() => {})
    getCompanies({ page_size: 200 } as Parameters<typeof getCompanies>[0])
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as { results?: { id: string; naam: string }[] }).results ?? []
        setCompanies(list)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchData()
    // Poll for updates when any request is processing
    const interval = setInterval(() => {
      if (requests.some((r) => r.status === 'pending' || r.status === 'processing')) {
        fetchData()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchData, requests])

  const handleCreate = async (data: CreateReportRequest) => {
    try {
      const created = await createReportRequest(data)
      toast.success('Rapport verzoek aangemaakt')
      setIsFormOpen(false)
      setRequests((prev) => [created, ...prev])
      // Auto-execute
      handleExecute(created.id)
    } catch {
      toast.error('Fout bij aanmaken rapport verzoek')
    }
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
      setRequests((prev) => prev.filter((r) => r.id !== id))
      toast.success('Rapport verwijderd')
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SparklesIcon className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rapport Agent</h1>
            <p className="text-sm text-gray-500">
              Genereer rapporten en exports op basis van uw vragen
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Nieuw rapport
        </button>
      </div>

      {/* Report type quick-select cards */}
      {reportTypes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
            Snel starten
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {reportTypes.slice(0, 8).map((rt) => (
              <button
                key={rt.value}
                onClick={() => setIsFormOpen(true)}
                className="text-left p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
              >
                <DocumentChartBarIcon className="w-5 h-5 text-blue-500 mb-1 group-hover:text-blue-700" />
                <p className="text-sm font-medium text-gray-800 group-hover:text-blue-800">
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
            Rapport wachtrij ({requests.length})
          </h2>
          <button
            onClick={fetchData}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Vernieuwen
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-dashed border-gray-300">
            <DocumentChartBarIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Nog geen rapporten aangevraagd.</p>
            <button
              onClick={() => setIsFormOpen(true)}
              className="mt-3 text-blue-600 hover:underline text-sm"
            >
              Maak uw eerste rapport aan
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Titel</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Rijen</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Aangevraagd</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{req.title}</span>
                      {req.error_message && (
                        <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <ExclamationCircleIcon className="w-3 h-3" />
                          {req.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{req.report_type_display}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} display={req.status_display} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {req.row_count !== null ? req.row_count : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(req.created_at).toLocaleString('nl-NL')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* View on screen */}
                        {req.status === 'completed' && req.result_data && (
                          <button
                            onClick={() => setViewingReport(req)}
                            title="Bekijk op scherm"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <EyeIcon className="w-4 h-4" />
                          </button>
                        )}

                        {/* Download Excel */}
                        {req.status === 'completed' && req.excel_file && (
                          <button
                            onClick={() =>
                              handleDownload(req.id, 'excel', `${req.title}.xlsx`)
                            }
                            title="Download Excel"
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                          </button>
                        )}

                        {/* Download PDF */}
                        {req.status === 'completed' && req.pdf_file && (
                          <button
                            onClick={() =>
                              handleDownload(req.id, 'pdf', `${req.title}.pdf`)
                            }
                            title="Download PDF"
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                          </button>
                        )}

                        {/* Execute (for pending) */}
                        {req.status === 'pending' && (
                          <button
                            onClick={() => handleExecute(req.id)}
                            disabled={executingId === req.id}
                            title="Uitvoeren"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
                          >
                            <ArrowPathIcon
                              className={`w-4 h-4 ${executingId === req.id ? 'animate-spin' : ''}`}
                            />
                          </button>
                        )}

                        {/* Retry failed */}
                        {req.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(req.id)}
                            title="Opnieuw proberen"
                            className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded"
                          >
                            <ArrowPathIcon className="w-4 h-4" />
                          </button>
                        )}

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(req.id)}
                          title="Verwijderen"
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New report form modal */}
      {isFormOpen && (
        <ReportRequestForm
          reportTypes={reportTypes}
          users={users}
          companies={companies}
          onSubmit={handleCreate}
          onClose={() => setIsFormOpen(false)}
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
