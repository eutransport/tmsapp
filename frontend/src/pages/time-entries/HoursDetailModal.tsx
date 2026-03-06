/**
 * Hours Detail Modal
 * Shows all individual time entries for a given user/period in a modal.
 * Used by WeeklyHoursTab (period overview) and MonthlyHoursTab (month overview).
 */
import { Fragment, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  XMarkIcon,
  ClockIcon,
  CalendarDaysIcon,
  TruckIcon,
  MapPinIcon,
  DocumentArrowDownIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'
import { TimeEntry } from '@/types'
import { getTimeEntries } from '@/api/timetracking'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'

interface HoursDetailModalProps {
  show: boolean
  onClose: () => void
  userId: string
  userName: string
  jaar: number
  /** For period mode: week range */
  weekStart?: number
  weekEnd?: number
  periodLabel?: string
  /** For month mode: month number (1-12) */
  maand?: number
  maandNaam?: string
}

// Format time string (HH:MM:SS -> HH:MM)
function formatTime(time: string | null): string {
  if (!time) return '-'
  const parts = time.split(':')
  return `${parts[0]}:${parts[1]}`
}

// Format date to Dutch format
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Format duration to readable string
function formatDuration(duration: string | null): string {
  if (!duration) return '-'
  if (duration.includes(':')) {
    const parts = duration.split(':')
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    return `${hours}u ${minutes}m`
  }
  return duration
}

export default function HoursDetailModal({
  show,
  onClose,
  userId,
  userName,
  jaar,
  weekStart,
  weekEnd,
  periodLabel,
  maand,
  maandNaam,
}: HoursDetailModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<TimeEntry[]>([])

  useEffect(() => {
    if (show && userId) {
      loadEntries()
    }
  }, [show, userId, jaar, weekStart, weekEnd, maand])

  const loadEntries = async () => {
    try {
      setLoading(true)

      if (maand) {
        // Monthly mode: filter by date range of the month
        const startDate = `${jaar}-${String(maand).padStart(2, '0')}-01`
        const lastDay = new Date(jaar, maand, 0).getDate()
        const endDate = `${jaar}-${String(maand).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

        const result = await getTimeEntries({
          user: userId,
          datum__gte: startDate,
          datum__lte: endDate,
          status: 'ingediend',
          page_size: 200,
          ordering: 'datum,aanvang',
        })
        setEntries(result.results || [])
      } else if (weekStart !== undefined && weekEnd !== undefined) {
        // Period mode: filter by week number range
        const result = await getTimeEntries({
          user: userId,
          jaar: jaar,
          weeknummer__gte: weekStart,
          weeknummer__lte: weekEnd,
          status: 'ingediend',
          page_size: 200,
          ordering: 'datum,aanvang',
        })
        setEntries(result.results || [])
      }
    } catch (error) {
      console.error('Failed to load time entries:', error)
      toast.error(t('hoursDetail.loadError', 'Kon uren niet laden'))
    } finally {
      setLoading(false)
    }
  }

  // Calculate totals
  const totalKm = entries.reduce((sum, e) => sum + (e.totaal_km || 0), 0)

  // Calculate total hours from totaal_uren strings
  const totalMinutes = entries.reduce((sum, e) => {
    if (!e.totaal_uren) return sum
    const parts = e.totaal_uren.split(':')
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    return sum + hours * 60 + minutes
  }, 0)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalMins = totalMinutes % 60

  // Build title
  const title = maandNaam
    ? `${userName} — ${maandNaam} ${jaar}`
    : `${userName} — ${periodLabel || `W${weekStart}-${weekEnd}`} ${jaar}`

  const fileTitle = maandNaam
    ? `Overzicht_Uren_${userName.replace(/\s+/g, '_')}_${maandNaam}_${jaar}`
    : `Overzicht_Uren_${userName.replace(/\s+/g, '_')}_${periodLabel || `W${weekStart}-${weekEnd}`}_${jaar}`

  // PDF Export
  const handleExportPDF = () => {
    if (entries.length === 0) return

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    // Title
    doc.setFontSize(16)
    doc.text('Overzicht Uren', 14, 15)
    doc.setFontSize(11)
    doc.text(title, 14, 22)

    // Summary line
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(
      `Totaal Uren: ${totalHours}u ${totalMins}m  |  Totaal KM: ${totalKm.toLocaleString('nl-NL')} km  |  Aantal Ritten: ${entries.length}`,
      14, 29
    )
    doc.setTextColor(0)

    // Table
    const tableData = entries.map((e) => [
      formatDate(e.datum),
      `W${e.weeknummer}`,
      String(e.ritnummer),
      e.kenteken || '-',
      formatTime(e.aanvang),
      formatTime(e.eind),
      formatDuration(e.pauze),
      formatDuration(e.totaal_uren),
      `${e.totaal_km} km`,
    ])

    autoTable(doc, {
      head: [['Datum', 'Week', 'Ritnr', 'Kenteken', 'Begin', 'Eind', 'Pauze', 'Totaal Uren', 'Totaal KM']],
      body: tableData,
      foot: [['Totaal', '', '', '', '', '', '', `${totalHours}u ${totalMins}m`, `${totalKm.toLocaleString('nl-NL')} km`]],
      startY: 34,
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    })

    // Footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(128)
      doc.text(
        `Gegenereerd op ${new Date().toLocaleDateString('nl-NL')} om ${new Date().toLocaleTimeString('nl-NL')}`,
        14, doc.internal.pageSize.height - 10
      )
    }

    doc.save(`${fileTitle}.pdf`)
    toast.success('PDF geëxporteerd')
  }

  // Excel Export
  const handleExportExcel = async () => {
    if (entries.length === 0) return

    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Overzicht Uren')

      // Title row
      sheet.mergeCells('A1:I1')
      const titleCell = sheet.getCell('A1')
      titleCell.value = 'Overzicht Uren'
      titleCell.font = { size: 16, bold: true }
      titleCell.alignment = { vertical: 'middle' }
      sheet.getRow(1).height = 30

      // Subtitle row
      sheet.mergeCells('A2:I2')
      const subtitleCell = sheet.getCell('A2')
      subtitleCell.value = title
      subtitleCell.font = { size: 11, color: { argb: '666666' } }

      // Summary row
      sheet.mergeCells('A3:I3')
      const summaryCell = sheet.getCell('A3')
      summaryCell.value = `Totaal Uren: ${totalHours}u ${totalMins}m  |  Totaal KM: ${totalKm}  |  Aantal Ritten: ${entries.length}`
      summaryCell.font = { size: 9, italic: true, color: { argb: '888888' } }

      // Empty row
      sheet.addRow([])

      // Header row
      const headerRow = sheet.addRow(['Datum', 'Week', 'Ritnr', 'Kenteken', 'Begin', 'Eind', 'Pauze', 'Totaal Uren', 'Totaal KM'])
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'D1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
          left: { style: 'thin', color: { argb: 'D1D5DB' } },
          right: { style: 'thin', color: { argb: 'D1D5DB' } },
        }
      })
      headerRow.height = 22

      // Data rows
      entries.forEach((e, idx) => {
        const row = sheet.addRow([
          formatDate(e.datum),
          `W${e.weeknummer}`,
          e.ritnummer,
          e.kenteken || '-',
          formatTime(e.aanvang),
          formatTime(e.eind),
          formatDuration(e.pauze),
          formatDuration(e.totaal_uren),
          `${e.totaal_km} km`,
        ])
        row.eachCell((cell) => {
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          cell.border = {
            top: { style: 'thin', color: { argb: 'E5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
            left: { style: 'thin', color: { argb: 'E5E7EB' } },
            right: { style: 'thin', color: { argb: 'E5E7EB' } },
          }
          if (idx % 2 === 1) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } }
          }
        })
      })

      // Totals row
      const totalRow = sheet.addRow(['Totaal', '', '', '', '', '', '', `${totalHours}u ${totalMins}m`, `${totalKm} km`])
      totalRow.eachCell((cell) => {
        cell.font = { bold: true, size: 10 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'D1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'D1D5DB' } },
          left: { style: 'thin', color: { argb: 'D1D5DB' } },
          right: { style: 'thin', color: { argb: 'D1D5DB' } },
        }
      })
      // Left-align "Totaal" label
      totalRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' }

      // Column widths
      sheet.columns = [
        { width: 22 }, // Datum
        { width: 10 }, // Week
        { width: 8 },  // Ritnr
        { width: 14 }, // Kenteken
        { width: 10 }, // Begin
        { width: 10 }, // Eind
        { width: 10 }, // Pauze
        { width: 14 }, // Totaal Uren
        { width: 12 }, // Totaal KM
      ]

      // Download
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileTitle}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Excel geëxporteerd')
    } catch (error) {
      console.error('Excel export error:', error)
      toast.error('Fout bij exporteren naar Excel')
    }
  }

  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                  <div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      {t('hoursDetail.title', 'Overzicht Uren')}
                    </Dialog.Title>
                    <p className="text-sm text-gray-500 mt-0.5">{title}</p>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-500 p-1"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Content */}
                <div className="p-4">
                  {loading ? (
                    <div className="flex justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                    </div>
                  ) : entries.length === 0 ? (
                    <div className="text-center py-12">
                      <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-500">
                        {t('hoursDetail.noEntries', 'Geen uren gevonden voor deze periode')}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Summary cards */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                          <ClockIcon className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                          <p className="text-xs text-blue-600 font-medium">
                            {t('hoursDetail.totalHours', 'Totaal Uren')}
                          </p>
                          <p className="text-lg font-bold text-blue-700">
                            {totalHours}u {totalMins}m
                          </p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <MapPinIcon className="h-5 w-5 text-green-500 mx-auto mb-1" />
                          <p className="text-xs text-green-600 font-medium">
                            {t('hoursDetail.totalKm', 'Totaal KM')}
                          </p>
                          <p className="text-lg font-bold text-green-700">
                            {totalKm.toLocaleString('nl-NL')} km
                          </p>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-3 text-center">
                          <CalendarDaysIcon className="h-5 w-5 text-purple-500 mx-auto mb-1" />
                          <p className="text-xs text-purple-600 font-medium">
                            {t('hoursDetail.totalEntries', 'Aantal Ritten')}
                          </p>
                          <p className="text-lg font-bold text-purple-700">
                            {entries.length}
                          </p>
                        </div>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                {t('hoursDetail.date', 'Datum')}
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                {t('hoursDetail.week', 'Week')}
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                {t('timeEntries.ritnummer', 'Ritnr')}
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                {t('timeEntries.licensePlate', 'Kenteken')}
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                {t('hoursDetail.startTime', 'Begin')}
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                {t('hoursDetail.endTime', 'Eind')}
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                                {t('timeEntries.pause', 'Pauze')}
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                {t('timeEntries.totalHours', 'Uren')}
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                {t('timeEntries.totalKm', 'KM')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {entries.map((entry) => (
                              <tr key={entry.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                                  {formatDate(entry.datum)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                                  W{entry.weeknummer}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {entry.ritnummer}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                                  <span className="inline-flex items-center gap-1">
                                    <TruckIcon className="h-3.5 w-3.5 text-gray-400" />
                                    {entry.kenteken}
                                  </span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-center text-gray-700">
                                  {formatTime(entry.aanvang)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-center text-gray-700">
                                  {formatTime(entry.eind)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-center text-gray-500">
                                  {formatDuration(entry.pauze)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                                  {formatDuration(entry.totaal_uren)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-right text-gray-700">
                                  {entry.totaal_km} km
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {/* Totals footer */}
                          <tfoot className="bg-gray-100 sticky bottom-0">
                            <tr className="font-bold">
                              <td className="px-3 py-2 text-sm text-gray-900" colSpan={7}>
                                {t('common.total')}
                              </td>
                              <td className="px-3 py-2 text-sm text-right text-gray-900">
                                {totalHours}u {totalMins}m
                              </td>
                              <td className="px-3 py-2 text-sm text-right text-gray-900">
                                {totalKm.toLocaleString('nl-NL')} km
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
                  {entries.length > 0 && (
                    <>
                      <button
                        onClick={handleExportPDF}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <DocumentArrowDownIcon className="h-4 w-4" />
                        PDF
                      </button>
                      <button
                        onClick={handleExportExcel}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                      >
                        <TableCellsIcon className="h-4 w-4" />
                        Excel
                      </button>
                    </>
                  )}
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.close', 'Sluiten')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
