import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  CalendarDaysIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  TruckIcon,
  MapPinIcon,
  CheckCircleIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import toast from 'react-hot-toast'
import { getTachographOverview, getTachographArchive, syncTachographArchiveDay, writeOvertime, triggerTachographSync, getTachographSyncInfo, exportTachographArchiveCsv, exportTachographArchiveXlsx, exportTachographArchivePdf, TachographVehicle, TachographTrip } from '@/api/tachograph'
import { getAllDrivers } from '@/api/drivers'
import { Driver } from '@/types'
import clsx from '@/utils/clsx'

const PAGE_SIZE = 15

function formatKm(km: number): string {
  return Math.round(km).toLocaleString('nl-NL')
}

export default function TachographPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'live' | 'archive'>('live')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [vehicles, setVehicles] = useState<TachographVehicle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  
  // Overtime linking
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [overtimeModal, setOvertimeModal] = useState<{
    vehicle: TachographVehicle
    fmDriverName: string
  } | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStartDatum, setSyncStartDatum] = useState<string | null>(null)
  const [syncEffectiveStart, setSyncEffectiveStart] = useState<string | null>(null)
  const [showSyncConfirm, setShowSyncConfirm] = useState(false)
  const [showArchiveSyncConfirm, setShowArchiveSyncConfirm] = useState(false)
  const [isArchiveSyncing, setIsArchiveSyncing] = useState(false)
  const [archiveExporting, setArchiveExporting] = useState<null | 'csv' | 'xlsx' | 'pdf'>(null)

  // Date navigation helpers
  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr + 'T12:00:00')
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  const goToPreviousDay = () => setDate(prev => addDays(prev, -1))
  const goToNextDay = () => setDate(prev => addDays(prev, 1))
  const goToPreviousWeek = () => setDate(prev => addDays(prev, -7))
  const goToNextWeek = () => setDate(prev => addDays(prev, 7))
  const goToToday = () => setDate(new Date().toISOString().split('T')[0])

  const isToday = date === new Date().toISOString().split('T')[0]

  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = activeTab === 'live'
        ? await getTachographOverview(date)
        : await getTachographArchive(date)
      setVehicles(data.vehicles)
      setCurrentPage(1)
      setExpandedIds(new Set())
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || t('tachograph.fetchError')
      setError(msg)
      setVehicles([])
    } finally {
      setIsLoading(false)
    }
  }, [activeTab, date, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    getAllDrivers().then(setDrivers).catch(() => {})
    getTachographSyncInfo().then(info => {
      setSyncStartDatum(info.start_datum)
      setSyncEffectiveStart(info.effective_start)
    }).catch(() => {})
  }, [])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Pagination
  const totalPages = Math.ceil(vehicles.length / PAGE_SIZE)
  const paginatedVehicles = vehicles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const handleWriteOvertime = async () => {
    if (!overtimeModal || !selectedDriverId) return
    setIsSaving(true)
    try {
      await writeOvertime({
        driver_id: selectedDriverId,
        date,
        overtime_hours: overtimeModal.vehicle.overtime_hours,
        vehicle_name: overtimeModal.vehicle.vehicle_name,
        fm_driver_name: overtimeModal.fmDriverName,
      })
      setSaveSuccess(t('tachograph.overtimeSaved'))
      setOvertimeModal(null)
      setSelectedDriverId('')
      setTimeout(() => setSaveSuccess(null), 3000)
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('tachograph.overtimeSaveError')
      setError(msg)
    } finally {
      setIsSaving(false)
    }
  }

  const formatTime = (dt: string | null) => {
    if (!dt) return '-'
    try {
      return new Date(dt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return dt
    }
  }

  const handleManualSync = async (force = false) => {
    if (force) {
      setShowSyncConfirm(true)
      return
    }
    await executeSync(false)
  }

  const executeSync = async (force: boolean) => {
    setShowSyncConfirm(false)
    setIsSyncing(true)
    setError(null)
    try {
      const result = await triggerTachographSync(force)
      if (result.status === 'completed') {
        if (result.force_resync) {
          setSaveSuccess(t('tachograph.forceResyncComplete', {
            deleted: result.deleted_entries,
            entries: result.entries_created,
            dates: result.dates_processed,
          }))
        } else {
          setSaveSuccess(t('tachograph.syncComplete', { entries: result.entries_created, dates: result.dates_processed }))
        }
      } else if (result.status === 'up_to_date') {
        setSaveSuccess(t('tachograph.syncUpToDate'))
      } else {
        setSaveSuccess(t('tachograph.syncSkipped', { reason: result.reason }))
      }
      setTimeout(() => setSaveSuccess(null), 5000)
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('tachograph.syncError')
      setError(msg)
    } finally {
      setIsSyncing(false)
    }
  }

  const executeArchiveSync = async () => {
    setShowArchiveSyncConfirm(false)
    setIsArchiveSyncing(true)
    setError(null)
    try {
      const result = await syncTachographArchiveDay(date)
      setSaveSuccess(t('tachograph.archive.syncComplete', { created: result.created_count }))
      setTimeout(() => setSaveSuccess(null), 5000)
      await fetchData()
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('tachograph.archive.syncError')
      setError(msg)
    } finally {
      setIsArchiveSyncing(false)
    }
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

  const handleArchiveExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setArchiveExporting(format)
    setError(null)
    try {
      const file = format === 'csv'
        ? await exportTachographArchiveCsv(date)
        : format === 'xlsx'
          ? await exportTachographArchiveXlsx(date)
          : await exportTachographArchivePdf(date)
      downloadBlob(file.blob, file.filename)
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('tachograph.archive.exportError')
      setError(msg)
      toast.error(msg)
    } finally {
      setArchiveExporting(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('tachograph.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('tachograph.subtitle')}
          </p>
          <nav className="mt-4 border-b border-gray-200 dark:border-gray-700">
            <div className="-mb-px flex gap-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('live')}
                className={`py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'live'
                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {t('tachograph.liveTab')}
              </button>
              <button
                onClick={() => setActiveTab('archive')}
                className={`py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'archive'
                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {t('tachograph.archive.tab')}
              </button>
            </div>
          </nav>
        </div>
        {activeTab === 'live' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleManualSync(true)}
              disabled={isSyncing}
              className="btn-outline flex items-center gap-2 text-sm text-orange-600 border-orange-300 hover:bg-orange-50"
              title={t('tachograph.forceResyncTooltip')}
            >
              <ArrowPathIcon className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {t('tachograph.forceResync')}
            </button>
            <button
              onClick={() => handleManualSync(false)}
              disabled={isSyncing}
              className="btn-primary flex items-center gap-2 text-sm"
              title={t('tachograph.syncTooltip')}
            >
              <ArrowPathIcon className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? t('tachograph.syncing') : t('tachograph.syncNow')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => setShowArchiveSyncConfirm(true)}
              disabled={isArchiveSyncing || archiveExporting !== null}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isArchiveSyncing ? 'animate-spin' : ''}`} />
              {isArchiveSyncing ? t('tachograph.syncing') : t('tachograph.archive.syncDay')}
            </button>
            <button
              onClick={() => handleArchiveExport('csv')}
              disabled={isArchiveSyncing || archiveExporting !== null || vehicles.length === 0}
              className="btn-outline flex items-center gap-2 text-sm"
            >
              <DocumentArrowDownIcon className="w-4 h-4" />
              {archiveExporting === 'csv' ? t('tachograph.archive.exporting') : t('tachograph.archive.exportCsv')}
            </button>
            <button
              onClick={() => handleArchiveExport('xlsx')}
              disabled={isArchiveSyncing || archiveExporting !== null || vehicles.length === 0}
              className="btn-outline flex items-center gap-2 text-sm"
            >
              <DocumentArrowDownIcon className="w-4 h-4" />
              {archiveExporting === 'xlsx' ? t('tachograph.archive.exporting') : t('tachograph.archive.exportExcel')}
            </button>
            <button
              onClick={() => handleArchiveExport('pdf')}
              disabled={isArchiveSyncing || archiveExporting !== null || vehicles.length === 0}
              className="btn-outline flex items-center gap-2 text-sm"
            >
              <DocumentArrowDownIcon className="w-4 h-4" />
              {archiveExporting === 'pdf' ? t('tachograph.archive.exporting') : t('tachograph.archive.exportPdf')}
            </button>
          </div>
        )}
      </div>

      {/* Date Navigation */}
      <div className="card p-4">
        {/* Desktop layout */}
        <div className="hidden sm:flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={goToPreviousWeek}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              title={t('tachograph.previousWeek')}
            >
              <ChevronDoubleLeftIcon className="w-5 h-5" />
            </button>
            <button
              onClick={goToPreviousDay}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              title={t('tachograph.previousDay')}
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <CalendarDaysIcon className="w-5 h-5 text-primary-600" />
            <span className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
              {formatDateDisplay(date)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={goToNextDay}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              title={t('tachograph.nextDay')}
            >
              <ChevronRightIcon className="w-5 h-5" />
            </button>
            <button
              onClick={goToNextWeek}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
              title={t('tachograph.nextWeek')}
            >
              <ChevronDoubleRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="sm:hidden space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <button onClick={goToPreviousWeek} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <ChevronDoubleLeftIcon className="w-4 h-4" />
              </button>
              <button onClick={goToPreviousDay} className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="text-center">
              <span className="text-sm font-semibold text-gray-900 capitalize">
                {formatDateDisplay(date)}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={goToNextDay} className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <ChevronRightIcon className="w-4 h-4" />
              </button>
              <button onClick={goToNextWeek} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg">
                <ChevronDoubleRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Date picker + Today button */}
        <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-gray-100">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
          />
          <button
            onClick={goToToday}
            disabled={isToday}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              isToday
                ? 'text-gray-400 cursor-default'
                : 'text-primary-600 hover:text-primary-700 hover:bg-primary-50 font-medium'
            }`}
          >
            {t('tachograph.today')}
          </button>
        </div>
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4">
          <div className="flex">
            <CheckCircleIcon className="h-5 w-5 text-green-400" />
            <p className="ml-3 text-sm text-green-700 dark:text-green-300">{saveSuccess}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
          <div className="flex">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
            <p className="ml-3 text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Summary stats */}
      {!isLoading && vehicles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('tachograph.totalVehicles')}</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{vehicles.length}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('tachograph.totalTrips')}</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {vehicles.reduce((sum, v) => sum + v.trip_count, 0)}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('tachograph.totalKm')}</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {formatKm(vehicles.reduce((sum, v) => sum + v.total_km, 0))} km
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('tachograph.vehiclesOvertime')}</div>
            <div className={clsx(
              'text-lg sm:text-2xl font-bold',
              vehicles.some(v => v.has_overtime)
                ? 'text-red-600 dark:text-red-400'
                : 'text-green-600 dark:text-green-400'
            )}>
              {vehicles.filter(v => v.has_overtime).length}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      )}

      {/* No data */}
      {!isLoading && vehicles.length === 0 && !error && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
          <TruckIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
            {activeTab === 'archive' ? t('tachograph.archive.noData') : t('tachograph.noData')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {activeTab === 'archive' ? t('tachograph.archive.noDataHint') : t('tachograph.noDataHint')}
          </p>
          {activeTab === 'archive' && (
            <button
              onClick={() => setShowArchiveSyncConfirm(true)}
              className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <ArrowPathIcon className="h-4 w-4" />
              {t('tachograph.archive.syncDay')}
            </button>
          )}
        </div>
      )}

      {/* Vehicle cards */}
      {!isLoading && paginatedVehicles.length > 0 && (
        <div className="space-y-3">
          {paginatedVehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.object_id}
              vehicle={vehicle}
              date={date}
              isExpanded={expandedIds.has(vehicle.object_id)}
              onToggle={() => toggleExpand(vehicle.object_id)}
              onWriteOvertime={(fmDriverName) => {
                setOvertimeModal({ vehicle, fmDriverName })
                setSelectedDriverId('')
              }}
              formatTime={formatTime}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('tachograph.showing', {
              from: (currentPage - 1) * PAGE_SIZE + 1,
              to: Math.min(currentPage * PAGE_SIZE, vehicles.length),
              total: vehicles.length,
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              {t('common.previous')}
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              {t('common.next')}
            </button>
          </div>
        </div>
      )}

      {/* Force Resync Confirm Modal */}
      {showSyncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('tachograph.forceResync')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('tachograph.forceResyncConfirm')}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('tachograph.syncStartInfo', {
                datum: (syncEffectiveStart || syncStartDatum)
                  ? new Date(((syncEffectiveStart || syncStartDatum) as string) + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
                  : '-',
              })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowSyncConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => executeSync(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700"
              >
                {t('tachograph.forceResync')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showArchiveSyncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {t('tachograph.archive.syncDay')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              {t('tachograph.archive.syncConfirm', { date })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowArchiveSyncConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={executeArchiveSync}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
              >
                {t('tachograph.archive.syncDay')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overtime Link Modal */}
      {overtimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t('tachograph.linkOvertime')}
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium">{t('tachograph.vehicle')}:</span> {overtimeModal.vehicle.vehicle_name}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium">{t('tachograph.fmDriver')}:</span> {overtimeModal.fmDriverName}
                </p>
                <p className="text-sm text-red-600 dark:text-red-400">
                  <span className="font-medium">{t('tachograph.overtime')}:</span> {overtimeModal.vehicle.overtime_display}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('tachograph.selectDriver')}
                </label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm"
                >
                  <option value="">{t('tachograph.chooseDriver')}</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>{d.naam}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => { setOvertimeModal(null); setSelectedDriverId('') }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleWriteOvertime}
                  disabled={!selectedDriverId || isSaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isSaving ? t('common.saving') : t('tachograph.saveOvertime')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface VehicleCardProps {
  vehicle: TachographVehicle
  date: string
  isExpanded: boolean
  onToggle: () => void
  onWriteOvertime: (fmDriverName: string) => void
  formatTime: (dt: string | null) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}

function VehicleCard({ vehicle, date, isExpanded, onToggle, onWriteOvertime, formatTime, t }: VehicleCardProps) {
  const handleExportPDF = () => {
    const plate = vehicle.plate_number || vehicle.vehicle_name
    const dateFmt = new Date(date + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    // Title
    doc.setFontSize(16)
    doc.text(`Tachograaf - ${plate}`, 14, 15)
    doc.setFontSize(11)
    doc.text(dateFmt, 14, 22)

    // Vehicle info
    doc.setFontSize(9)
    doc.setTextColor(100)
    const vehicleInfo = [
      `${vehicle.vehicle_make} ${vehicle.vehicle_model}`.trim(),
      `Start KM: ${formatKm(vehicle.first_km)}`,
      `Eind KM: ${formatKm(vehicle.last_km)}`,
      `Gereden: ${formatKm(vehicle.total_km)} km`,
    ].filter(Boolean).join('  |  ')
    doc.text(vehicleInfo, 14, 28)

    // Driver info
    if (vehicle.drivers.length > 0) {
      doc.text(`Chauffeur(s): ${vehicle.drivers.map(d => d.name).join(', ')}`, 14, 33)
    }
    doc.setTextColor(0)

    // Trips table - decide columns based on data
    const hasMultipleDrivers = new Set(vehicle.trips.flatMap(t => t.drivers.map(d => d.name))).size > 1
    const hasRoutes = vehicle.trips.some(t => t.start_address || t.end_address)

    const headers: string[] = ['Start', 'Eind', 'Duur', 'Afstand']
    if (hasMultipleDrivers) headers.push('Chauffeur')
    if (hasRoutes) headers.push('Route')

    const tableData = vehicle.trips.map((trip: TachographTrip) => {
      const row: string[] = [
        formatTime(trip.start_time),
        formatTime(trip.end_time),
        trip.duration_display,
        `${trip.distance_km.toFixed(1)} km`,
      ]
      if (hasMultipleDrivers) row.push(trip.drivers.map(d => d.name).join(', ') || '-')
      if (hasRoutes) {
        const route = trip.start_address && trip.end_address
          ? `${trip.start_address} -> ${trip.end_address}`
          : trip.start_address || trip.end_address || '-'
        row.push(route)
      }
      return row
    })

    const footRow: string[] = [
      'Totaal', '', vehicle.total_hours_display + (vehicle.has_overtime ? ` (+${vehicle.overtime_display})` : ''),
      `${formatKm(vehicle.total_km)} km`,
    ]
    if (hasMultipleDrivers) footRow.push('')
    if (hasRoutes) footRow.push('')

    // Column styles
    const colStyles: Record<number, { cellWidth?: number | 'auto' | 'wrap' }> = {}
    const routeColIdx = headers.indexOf('Route')
    if (routeColIdx !== -1) {
      colStyles[routeColIdx] = { cellWidth: 'wrap' }
    }

    autoTable(doc, {
      head: [headers],
      body: tableData,
      foot: [footRow],
      startY: vehicle.drivers.length > 0 ? 38 : 33,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: colStyles,
    })

    // Overtime calculation breakdown
    const calc = vehicle.overtime_calculation
    if (calc) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalY = (doc as any).lastAutoTable?.finalY || 120
      doc.setFontSize(10)
      doc.setTextColor(0)
      doc.text('Overuren berekening:', 14, finalY + 8)
      doc.setFontSize(9)
      doc.text(
        `${calc.driver_name}  |  Start: ${calc.start_time}  |  Eind: ${calc.end_time}  |  Totaal: ${calc.total_work_display}  |  Pauze: ${calc.pauze_display}  |  Netto: ${calc.netto_display}  |  Contract: ${calc.uren_per_dag_display}  |  Overuren: ${calc.overtime_display}`,
        14, finalY + 14
      )
      doc.setFontSize(8)
      doc.setTextColor(100)
      doc.text(calc.formula, 14, finalY + 19)
      doc.setTextColor(0)
    }

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

    doc.save(`tachograaf_${plate.replace(/[\s-]/g, '_')}_${date}.pdf`)
    toast.success('PDF geëxporteerd')
  }

  return (
    <div className={clsx(
      'bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden',
      vehicle.has_overtime && 'ring-2 ring-red-300 dark:ring-red-700'
    )}>
      {/* Header row - clickable */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        {isExpanded
          ? <ChevronDownIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
          : <ChevronRightIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
        }
        
        {/* Vehicle info */}
        <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-5 gap-1 sm:gap-4 items-center">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {vehicle.plate_number || vehicle.vehicle_name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {vehicle.vehicle_make} {vehicle.vehicle_model}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('tachograph.start')}</p>
            <p className="text-sm text-gray-900 dark:text-white">{formatTime(vehicle.first_start)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('tachograph.end')}</p>
            <p className="text-sm text-gray-900 dark:text-white">{formatTime(vehicle.last_end)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('tachograph.totalHours')}</p>
            <p className="text-sm text-gray-900 dark:text-white">{vehicle.total_hours_display}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('tachograph.totalKm')}</p>
            <p className="text-sm text-gray-900 dark:text-white">{formatKm(vehicle.total_km)} km</p>
          </div>
        </div>

        {/* Overtime badge - fixed width area to prevent column shifting */}
        <div className="w-16 flex-shrink-0 text-right">
          {vehicle.has_overtime && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 whitespace-nowrap">
              +{vehicle.overtime_display}
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div>
          {/* Drivers */}
          {vehicle.drivers.length > 0 && (
            <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/10 border-t border-blue-200 dark:border-blue-800 flex flex-wrap gap-2">
              {vehicle.drivers.map(d => (
                <span key={d.id} className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  {d.name}
                </span>
              ))}
            </div>
          )}

          {/* Actions bar */}
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
              <span>{t('tachograph.startKm')}: <strong>{formatKm(vehicle.first_km)}</strong></span>
              <span>{t('tachograph.endKm')}: <strong>{formatKm(vehicle.last_km)}</strong></span>
              <span>{t('tachograph.drivenKm')}: <strong>{formatKm(vehicle.total_km)} km</strong></span>
            </div>
            <button
              onClick={handleExportPDF}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
              title="Exporteer naar PDF"
            >
              <DocumentArrowDownIcon className="h-4 w-4" />
              PDF
            </button>
          </div>

          {/* Trips table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.tripStart')}</th>
                  <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.tripEnd')}</th>
                  <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.duration')}</th>
                  <th className="px-3 sm:px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.distance')}</th>
                  <th className="hidden md:table-cell px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.driver')}</th>
                  <th className="hidden lg:table-cell px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('tachograph.route')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {vehicle.trips.map((trip: TachographTrip, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 sm:px-4 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">
                      {formatTime(trip.start_time)}
                    </td>
                    <td className="px-3 sm:px-4 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">
                      {formatTime(trip.end_time)}
                    </td>
                    <td className="px-3 sm:px-4 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">
                      <span className="inline-flex items-center gap-1">
                        <ClockIcon className="h-3.5 w-3.5 text-gray-400" />
                        {trip.duration_display}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">
                      {trip.distance_km.toFixed(1)} km
                    </td>
                    <td className="hidden md:table-cell px-4 py-2 text-gray-900 dark:text-gray-100">
                      {trip.drivers.length > 0
                        ? trip.drivers.map(d => d.name).join(', ')
                        : <span className="text-gray-400 italic">{t('tachograph.unknown')}</span>
                      }
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2 text-gray-500 dark:text-gray-400 text-xs max-w-xs truncate">
                      {trip.start_address || trip.end_address ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPinIcon className="h-3 w-3 flex-shrink-0" />
                          {trip.start_address} → {trip.end_address}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-700/50 font-medium">
                <tr>
                  <td className="px-3 sm:px-4 py-2 text-gray-900 dark:text-white" colSpan={2}>{t('tachograph.totalLabel')}</td>
                  <td className="px-3 sm:px-4 py-2 text-gray-900 dark:text-white">
                    {vehicle.total_hours_display}
                    {vehicle.has_overtime && (
                      <span className="ml-1 text-red-600 dark:text-red-400 text-xs">
                        (+{vehicle.overtime_display})
                      </span>
                    )}
                  </td>
                  <td className="px-3 sm:px-4 py-2 text-gray-900 dark:text-white">{formatKm(vehicle.total_km)} km</td>
                  <td className="hidden md:table-cell"></td>
                  <td className="hidden lg:table-cell"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Overtime calculation breakdown */}
          {vehicle.overtime_calculation && (
            <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
                <span className="font-medium text-gray-900 dark:text-white">{vehicle.overtime_calculation.driver_name}</span>
                <span>Start: <strong>{vehicle.overtime_calculation.start_time}</strong></span>
                <span>Eind: <strong>{vehicle.overtime_calculation.end_time}</strong></span>
                <span>Totaal: <strong>{vehicle.overtime_calculation.total_work_display}</strong></span>
                <span>Pauze: <strong>{vehicle.overtime_calculation.pauze_display}</strong></span>
                <span>Netto: <strong>{vehicle.overtime_calculation.netto_display}</strong></span>
                <span>Contract: <strong>{vehicle.overtime_calculation.uren_per_dag_display}</strong></span>
                <span className={vehicle.overtime_calculation.overtime_hours > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                  Overuren: <strong>{vehicle.overtime_calculation.overtime_display}</strong>
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-mono">
                {vehicle.overtime_calculation.formula}
              </div>
            </div>
          )}

          {/* Overtime action */}
          {vehicle.has_overtime && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/10 border-t border-red-200 dark:border-red-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
                  {t('tachograph.overtimeWarning', { hours: vehicle.overtime_display })}
                </p>
              </div>
              <div className="flex gap-2">
                {vehicle.drivers.map(d => (
                  <button
                    key={d.id}
                    onClick={(e) => { e.stopPropagation(); onWriteOvertime(d.name) }}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 shadow-sm"
                  >
                    {t('tachograph.linkTo')} {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
