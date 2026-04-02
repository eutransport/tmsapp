import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarDaysIcon,
  ArrowPathIcon,
  UserIcon,
  TruckIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline'
import { getTachographComparison, exportTachographComparisonXlsx, exportTachographComparisonPdf, TachographComparisonRow } from '@/api/tachograph'

function getMonday(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

export default function TachographComparisonPage() {
  const { t } = useTranslation()

  // Default: current week (Monday → today)
  const [dateFrom, setDateFrom] = useState(() => toDateStr(getMonday(new Date())))
  const [dateTill, setDateTill] = useState(() => toDateStr(new Date()))
  const [rows, setRows] = useState<TachographComparisonRow[]>([])
  const [drivers, setDrivers] = useState<{ id: string; naam: string }[]>([])
  const [plates, setPlates] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterChauffeur, setFilterChauffeur] = useState('')
  const [filterKenteken, setFilterKenteken] = useState('')
  const [exportingXlsx, setExportingXlsx] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  const fetchData = useCallback(async () => {
    if (!dateFrom || !dateTill) return
    setLoading(true)
    setError(null)
    try {
      const data = await getTachographComparison(dateFrom, dateTill, filterKenteken || undefined)
      setRows(data.rows)
      setDrivers(data.drivers || [])
      // Only update plates when no filter active (keep dropdown populated)
      if (!filterKenteken) {
        setPlates(data.plates || [])
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || t('tachograph.comparison.fetchError'))
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTill, filterKenteken, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Presets
  const setThisWeek = () => {
    const now = new Date()
    setDateFrom(toDateStr(getMonday(now)))
    setDateTill(toDateStr(now))
  }
  const setLastWeek = () => {
    const now = new Date()
    const mon = getMonday(now)
    const prevMon = new Date(mon)
    prevMon.setDate(prevMon.getDate() - 7)
    const prevSun = new Date(prevMon)
    prevSun.setDate(prevSun.getDate() + 6)
    setDateFrom(toDateStr(prevMon))
    setDateTill(toDateStr(prevSun))
  }
  const setThisMonth = () => {
    const now = new Date()
    setDateFrom(toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)))
    setDateTill(toDateStr(now))
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }

  const handleExportXlsx = async () => {
    setExportingXlsx(true)
    try {
      const blob = await exportTachographComparisonXlsx(dateFrom, dateTill)
      downloadBlob(blob, `uren_vergelijking_${dateFrom}_${dateTill}.xlsx`)
    } catch {
      // silent
    } finally {
      setExportingXlsx(false)
    }
  }

  const handleExportPdf = async () => {
    setExportingPdf(true)
    try {
      const blob = await exportTachographComparisonPdf(dateFrom, dateTill)
      downloadBlob(blob, `uren_vergelijking_${dateFrom}_${dateTill}.pdf`)
    } catch {
      // silent
    } finally {
      setExportingPdf(false)
    }
  }

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const formatHours = (hours: number | null) => {
    if (hours === null || hours === undefined) return '-'
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return `${h}:${m.toString().padStart(2, '0')}`
  }

  // Unique values for filters
  const chauffeurs = drivers.length > 0
    ? drivers.map(d => d.naam)
    : [...new Set(rows.map(r => r.chauffeur_naam).filter(Boolean))].sort()
  const kentekens = plates.length > 0
    ? plates
    : [...new Set(rows.map(r => r.kenteken).filter(Boolean))].sort()

  const normPlate = (p: string) => p.toUpperCase().replace(/[-\s]/g, '')

  const filteredRows = rows.filter(r => {
    if (filterChauffeur && r.chauffeur_naam !== filterChauffeur) return false
    if (filterKenteken && normPlate(r.kenteken) !== normPlate(filterKenteken)) return false
    return true
  })

  const renderDiffBadge = (row: TachographComparisonRow) => {
    if (row.verschil !== null && row.verschil !== undefined) {
      const isDriver = row.verschil_bron === 'chauffeur'
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          isDriver
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        }`}>
          {isDriver ? <UserIcon className="w-3.5 h-3.5" /> : <TruckIcon className="w-3.5 h-3.5" />}
          +{formatHours(row.verschil)}
        </span>
      )
    }
    return <span className="text-green-600 dark:text-green-400 text-xs font-medium">✓</span>
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            {t('tachograph.comparison.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('tachograph.comparison.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf || rows.length === 0}
            className="btn btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exportingPdf ? '...' : t('tachograph.comparison.exportPdf')}
          </button>
          <button
            onClick={handleExportXlsx}
            disabled={exportingXlsx || rows.length === 0}
            className="btn btn-primary inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exportingXlsx ? '...' : t('tachograph.comparison.exportExcel')}
          </button>
        </div>
      </div>

      {/* Date Range */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('tachograph.comparison.dateFrom')}
            </label>
            <div className="relative">
              <CalendarDaysIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input pl-9 w-full"
              />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('tachograph.comparison.dateTill')}
            </label>
            <div className="relative">
              <CalendarDaysIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={dateTill}
                onChange={(e) => setDateTill(e.target.value)}
                className="input pl-9 w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={setThisWeek} className="btn btn-secondary text-xs whitespace-nowrap">
              {t('tachograph.comparison.thisWeek')}
            </button>
            <button onClick={setLastWeek} className="btn btn-secondary text-xs whitespace-nowrap">
              {t('tachograph.comparison.lastWeek')}
            </button>
            <button onClick={setThisMonth} className="btn btn-secondary text-xs whitespace-nowrap">
              {t('tachograph.comparison.thisMonth')}
            </button>
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {formatDateDisplay(dateFrom)} — {formatDateDisplay(dateTill)}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('tachograph.comparison.filterDriver')}
            </label>
            <select
              value={filterChauffeur}
              onChange={(e) => setFilterChauffeur(e.target.value)}
              className="input w-full"
            >
              <option value="">{t('tachograph.comparison.allDrivers')}</option>
              {chauffeurs.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('tachograph.comparison.filterPlate')}
            </label>
            <select
              value={filterKenteken}
              onChange={(e) => setFilterKenteken(e.target.value)}
              className="input w-full"
            >
              <option value="">{t('tachograph.comparison.allPlates')}</option>
              {kentekens.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-600 mr-2" />
          <span className="text-gray-500">{t('common.loading')}</span>
        </div>
      )}

      {/* Data */}
      {!loading && !error && (
        <>
          {/* Desktop Table (hidden on mobile) */}
          <div className="card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('tachograph.comparison.colDate')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('tachograph.comparison.colDriver')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('tachograph.comparison.colPlate')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20">
                      {t('tachograph.comparison.colDriverStart')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20">
                      {t('tachograph.comparison.colDriverEnd')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20">
                      Aut. Begin
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20">
                      Aut. Eind
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20">
                      {t('tachograph.comparison.colTachoStart')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20">
                      {t('tachograph.comparison.colTachoEnd')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20">
                      {t('tachograph.comparison.colDriverTotal')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20">
                      {t('tachograph.comparison.colTachoTotal')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('tachograph.comparison.colDifference')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-green-50 dark:bg-green-900/20">
                      {t('tachograph.comparison.colHoursPerDay')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-red-50 dark:bg-red-900/20">
                      {t('tachograph.comparison.colOvertimeHours')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider bg-red-50 dark:bg-red-900/20">
                      {t('tachograph.comparison.colOvertimeTacho')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-4 py-8 text-center text-gray-500">
                        {t('tachograph.comparison.noData')}
                      </td>
                    </tr>
                  ) : filteredRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {new Date(row.datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {row.chauffeur_naam || <span className="text-gray-400 italic">{t('tachograph.comparison.unlinked')}</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {row.kenteken}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-blue-50/50 dark:bg-blue-900/10">
                        {row.chauffeur_begin || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-blue-50/50 dark:bg-blue-900/10">
                        {row.chauffeur_eind || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-purple-50/50 dark:bg-purple-900/10">
                        {row.auto_begin || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-purple-50/50 dark:bg-purple-900/10">
                        {row.auto_eind || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-amber-50/50 dark:bg-amber-900/10">
                        {row.tacho_begin || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-amber-50/50 dark:bg-amber-900/10">
                        {row.tacho_eind || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-medium text-gray-900 dark:text-white bg-blue-50/50 dark:bg-blue-900/10">
                        {row.chauffeur_totaal !== null ? formatHours(row.chauffeur_totaal) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-medium text-gray-900 dark:text-white bg-amber-50/50 dark:bg-amber-900/10">
                        {formatHours(row.tacho_totaal)}
                      </td>
                      <td className="px-4 py-3 text-sm text-center whitespace-nowrap">
                        {renderDiffBadge(row)}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300 bg-green-50/50 dark:bg-green-900/10">
                        {row.uren_per_dag !== null ? formatHours(row.uren_per_dag) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-medium whitespace-nowrap bg-red-50/50 dark:bg-red-900/10">
                        {row.overwerk_uren !== null ? (
                          <span className="text-red-600 dark:text-red-400">+{formatHours(row.overwerk_uren)}</span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-medium whitespace-nowrap bg-red-50/50 dark:bg-red-900/10">
                        {row.overwerk_tacho !== null ? (
                          <span className="text-red-600 dark:text-red-400">+{formatHours(row.overwerk_tacho)}</span>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards (hidden on desktop) */}
          <div className="md:hidden space-y-3">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-gray-500">
                {t('tachograph.comparison.noData')}
              </div>
            ) : filteredRows.map((row, idx) => (
              <div key={idx} className="card p-4 space-y-3">
                {/* Card header: date + diff badge */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {new Date(row.datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  {renderDiffBadge(row)}
                </div>
                {/* Driver + plate */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                    {row.chauffeur_naam || <span className="text-gray-400 italic">{t('tachograph.comparison.unlinked')}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                    <TruckIcon className="w-4 h-4 text-gray-400" />
                    {row.kenteken}
                  </div>
                </div>
                {/* Times grid */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-blue-100 dark:bg-blue-900/40 rounded-lg p-2 border border-blue-200 dark:border-blue-800">
                    <div className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">{t('tachograph.comparison.colDriver')}</div>
                    <div className="flex justify-between">
                      <span className="text-blue-900 dark:text-blue-200">{row.chauffeur_begin || '-'}</span>
                      <span className="text-blue-400 dark:text-blue-500">→</span>
                      <span className="text-blue-900 dark:text-blue-200">{row.chauffeur_eind || '-'}</span>
                    </div>
                    <div className="text-center font-semibold text-blue-900 dark:text-white mt-1">
                      {row.chauffeur_totaal !== null ? formatHours(row.chauffeur_totaal) : '-'}
                    </div>
                  </div>
                  <div className="bg-purple-100 dark:bg-purple-900/40 rounded-lg p-2 border border-purple-200 dark:border-purple-800">
                    <div className="text-xs text-purple-700 dark:text-purple-300 font-medium mb-1">Aut. Import</div>
                    <div className="flex justify-between">
                      <span className="text-purple-900 dark:text-purple-200">{row.auto_begin || '-'}</span>
                      <span className="text-purple-400 dark:text-purple-500">→</span>
                      <span className="text-purple-900 dark:text-purple-200">{row.auto_eind || '-'}</span>
                    </div>
                    <div className="text-center font-semibold text-purple-900 dark:text-white mt-1">
                      {row.auto_totaal !== null ? formatHours(row.auto_totaal) : '-'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg p-2 border border-amber-200 dark:border-amber-800">
                    <div className="text-xs text-amber-700 dark:text-amber-300 font-medium mb-1">{t('tachograph.comparison.colTachoTotal', 'Totaal (tacho)')}</div>
                    <div className="flex justify-between">
                      <span className="text-amber-900 dark:text-amber-200">{row.tacho_begin || '-'}</span>
                      <span className="text-amber-400 dark:text-amber-500">→</span>
                      <span className="text-amber-900 dark:text-amber-200">{row.tacho_eind || '-'}</span>
                    </div>
                    <div className="text-center font-semibold text-amber-900 dark:text-white mt-1">
                      {formatHours(row.tacho_totaal)}
                    </div>
                  </div>
                </div>
                {/* Overtime info */}
                {row.uren_per_dag !== null && (
                  <div className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <span className="text-gray-500 dark:text-gray-400">
                      {t('tachograph.comparison.colHoursPerDay')}: <span className="font-medium text-gray-700 dark:text-gray-300">{formatHours(row.uren_per_dag)}</span>
                    </span>
                    <div className="flex gap-3">
                      {row.overwerk_uren !== null && (
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {t('tachograph.comparison.colOvertimeHoursShort')}: +{formatHours(row.overwerk_uren)}
                        </span>
                      )}
                      {row.overwerk_tacho !== null && (
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {t('tachograph.comparison.colOvertimeTachoShort')}: +{formatHours(row.overwerk_tacho)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
