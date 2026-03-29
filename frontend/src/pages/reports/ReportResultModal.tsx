/**
 * Report Result Modal
 * Shows the completed report data on screen with download options.
 */
import { useState } from 'react'
import {
  XMarkIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  DocumentChartBarIcon,
} from '@heroicons/react/24/outline'
import { ReportRequest } from '@/api/reports'

interface Props {
  report: ReportRequest
  onClose: () => void
  onDownloadExcel: () => void
  onDownloadPdf: () => void
}

export default function ReportResultModal({
  report,
  onClose,
  onDownloadExcel,
  onDownloadPdf,
}: Props) {
  const [search, setSearch] = useState('')

  const { result_data } = report
  if (!result_data) return null

  const { columns, rows, title } = result_data

  // Filter rows by search
  const filteredRows = search
    ? rows.filter((row) =>
        row.some((cell) =>
          String(cell ?? '').toLowerCase().includes(search.toLowerCase()),
        ),
      )
    : rows

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <DocumentChartBarIcon className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <p className="text-xs text-gray-500">
                {report.title} &middot; {report.row_count} rijen &middot;{' '}
                {new Date(report.completed_at!).toLocaleString('nl-NL')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-4">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1">
            <MagnifyingGlassIcon className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Doorzoek resultaten..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm focus:outline-none bg-transparent flex-1"
            />
            {search && (
              <span className="text-xs text-gray-400">
                {filteredRows.length} van {rows.length} rijen
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {report.excel_file && (
              <button
                onClick={onDownloadExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                Excel
              </button>
            )}
            {report.pdf_file && (
              <button
                onClick={onDownloadPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                PDF
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {filteredRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500">
              {search ? 'Geen rijen gevonden voor deze zoekopdracht' : 'Geen gegevens'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-white sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-xs w-10">#</th>
                  {columns.map((col, i) => (
                    <th key={i} className="px-3 py-2 text-left font-semibold text-xs whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="px-3 py-2 text-gray-400 text-xs">{rowIdx + 1}</td>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="px-3 py-2 text-gray-800 whitespace-nowrap">
                        {cell !== null && cell !== undefined ? String(cell) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {filteredRows.length} {search ? `van ${rows.length} ` : ''}rijen weergegeven
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
          >
            Sluiten
          </button>
        </div>
      </div>
    </div>
  )
}
