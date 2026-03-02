/**
 * Submitted Hours Page - For admins to view and edit all submitted hours
 * Full editing capabilities for all chauffeur time entries
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  MagnifyingGlassIcon,
  PencilIcon,
  XMarkIcon,
  ClockIcon,
  ChartBarIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import WeeklyHoursTab from './WeeklyHoursTab'
import VehicleWeeksTab from './VehicleWeeksTab'
import { TimeEntry } from '@/types'
import {
  getTimeEntries,
  updateTimeEntry,
  WeekHistory,
  getWeekHistory,
} from '@/api/timetracking'
import toast from 'react-hot-toast'
import Pagination, { PageSize } from '@/components/common/Pagination'

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

// Format date to Dutch format
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function SubmittedHoursPage() {
  const { t } = useTranslation()
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'submitted' | 'weekly' | 'vehicleWeeks'>('submitted')
  
  // State
  const [loading, setLoading] = useState(true)
  const [weekHistory, setWeekHistory] = useState<WeekHistory[]>([])
  const [filteredWeeks, setFilteredWeeks] = useState<WeekHistory[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'concept' | 'ingediend' | ''>('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  
  // Week detail state
  const [showWeekModal, setShowWeekModal] = useState(false)
  const [selectedWeek, setSelectedWeek] = useState<WeekHistory | null>(null)
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)
  
  // Edit entry state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  const [editForm, setEditForm] = useState({
    ritnummer: '',
    kenteken: '',
    datum: '',
    aanvang: '',
    eind: '',
    pauze: '',
    km_start: 0,
    km_eind: 0,
  })
  const [saving, setSaving] = useState(false)

  // Load week history on mount and when status filter changes
  useEffect(() => {
    loadWeekHistory()
  }, [statusFilter])

  // Filter weeks when search changes
  useEffect(() => {
    if (!searchTerm) {
      setFilteredWeeks(weekHistory)
    } else {
      const lower = searchTerm.toLowerCase()
      const filtered = weekHistory.filter(week => {
        const fullName = `${week.user__voornaam} ${week.user__achternaam}`.toLowerCase()
        return (
          fullName.includes(lower) ||
          week.weeknummer.toString().includes(lower) ||
          week.jaar.toString().includes(lower)
        )
      })
      setFilteredWeeks(filtered)
    }
    setCurrentPage(1)
  }, [searchTerm, weekHistory])

  const loadWeekHistory = async () => {
    try {
      setLoading(true)
      const history = await getWeekHistory(undefined, statusFilter || undefined)
      // Sort by year and week descending
      const sorted = history.sort((a, b) => {
        if (a.jaar !== b.jaar) return b.jaar - a.jaar
        return b.weeknummer - a.weeknummer
      })
      setWeekHistory(sorted)
      setFilteredWeeks(sorted)
    } catch (err) {
      console.error('Failed to load week history:', err)
      toast.error(t('timeEntries.loadWeeksError'))
    } finally {
      setLoading(false)
    }
  }

  const loadWeekEntries = async (week: WeekHistory) => {
    try {
      setLoadingEntries(true)
      const response = await getTimeEntries({
        weeknummer: week.weeknummer,
        jaar: week.jaar,
        user: week.user_id,
        status: statusFilter || undefined,
        page_size: 100,
        ordering: 'datum',
      })
      setWeekEntries(response.results)
    } catch (err) {
      console.error('Failed to load week entries:', err)
      toast.error(t('timeEntries.loadError'))
    } finally {
      setLoadingEntries(false)
    }
  }

  const handleViewWeek = async (week: WeekHistory) => {
    setSelectedWeek(week)
    setShowWeekModal(true)
    await loadWeekEntries(week)
  }

  const handleEditEntry = (entry: TimeEntry) => {
    setEditingEntry(entry)
    setEditForm({
      ritnummer: entry.ritnummer,
      kenteken: entry.kenteken,
      datum: entry.datum,
      aanvang: entry.aanvang,
      eind: entry.eind,
      pauze: entry.pauze || '00:00:00',
      km_start: entry.km_start,
      km_eind: entry.km_eind,
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editingEntry) return
    
    try {
      setSaving(true)
      await updateTimeEntry(editingEntry.id, {
        ritnummer: editForm.ritnummer,
        kenteken: editForm.kenteken,
        datum: editForm.datum,
        aanvang: editForm.aanvang,
        eind: editForm.eind,
        pauze: editForm.pauze,
        km_start: editForm.km_start,
        km_eind: editForm.km_eind,
      })
      
      toast.success(t('timeEntries.entryUpdated'))
      setShowEditModal(false)
      setEditingEntry(null)
      
      // Reload entries for this week
      if (selectedWeek) {
        await loadWeekEntries(selectedWeek)
      }
      
      // Reload week history for updated totals
      loadWeekHistory()
    } catch (err) {
      console.error('Failed to update entry:', err)
      toast.error(t('timeEntries.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Pagination
  const totalPages = Math.ceil(filteredWeeks.length / pageSize)
  const paginatedWeeks = filteredWeeks.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('timeEntries.submittedHours')}</h1>
          <p className="text-gray-500 mt-1">{t('timeEntries.submittedHoursDescription')}</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('submitted')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'submitted'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ClockIcon className="h-5 w-5" />
            {t('timeEntries.submittedHoursTab')}
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'weekly'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ChartBarIcon className="h-5 w-5" />
            {t('weeklyHours.title')}
          </button>
          <button
            onClick={() => setActiveTab('vehicleWeeks')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'vehicleWeeks'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <TruckIcon className="h-5 w-5" />
            {t('vehicleWeeks.title')}
          </button>
        </nav>
      </div>

      {/* Weekly Hours Tab */}
      {activeTab === 'weekly' && <WeeklyHoursTab />}

      {/* Vehicle Weeks Tab */}
      {activeTab === 'vehicleWeeks' && <VehicleWeeksTab />}

      {/* Submitted Hours Tab */}
      {activeTab === 'submitted' && <>
      {/* Search bar and filters */}
      <div className="card mb-6">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder={t('timeEntries.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input pl-10 w-full"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'concept' | 'ingediend' | '')}
              className="form-select sm:w-48"
            >
              <option value="">{t('timeEntries.allStatuses')}</option>
              <option value="concept">{t('timeEntries.concept')}</option>
              <option value="ingediend">{t('timeEntries.submitted')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Weeks table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : paginatedWeeks.length === 0 ? (
          <div className="p-8 text-center">
            <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('timeEntries.noSubmittedHours')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.week')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.year')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('drivers.title')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.trips')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.totalKm')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedWeeks.map((week) => (
                    <tr key={`${week.user_id}-${week.jaar}-${week.weeknummer}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary-100 text-primary-700 font-bold">
                          {week.weeknummer}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {week.jaar}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {week.user__voornaam} {week.user__achternaam}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        {week.ingediend_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                        {week.totaal_km} km
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleViewWeek(week)}
                          className="btn-secondary text-sm"
                        >
                          {t('timeEntries.viewEdit')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {paginatedWeeks.map((week) => (
                <div key={`${week.user_id}-${week.jaar}-${week.weeknummer}`} className="p-3 hover:bg-gray-50">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary-100 text-primary-700 font-bold">
                      {week.weeknummer}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {week.user__voornaam} {week.user__achternaam}
                      </p>
                      <p className="text-xs text-gray-500">{week.jaar}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 text-xs mb-2 ml-13">
                    <div>
                      <span className="text-gray-500">{t('timeEntries.trips')}: </span>
                      <span className="font-medium">{week.ingediend_count}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">{t('timeEntries.km')}: </span>
                      <span className="font-medium">{week.totaal_km}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleViewWeek(week)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 min-h-[44px] text-sm mt-2"
                  >
                    {t('timeEntries.viewEdit')}
                  </button>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={filteredWeeks.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(newSize) => { setPageSize(newSize); setCurrentPage(1); }}
            />
          </>
        )}
      </div>

      {/* Week Detail Modal */}
      <Transition appear show={showWeekModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowWeekModal(false)}>
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
                  <div className="flex items-center justify-between p-4 sm:p-6 border-b">
                    <div>
                      <Dialog.Title className="text-lg font-semibold">
                        Week {selectedWeek?.weeknummer} - {selectedWeek?.jaar}
                      </Dialog.Title>
                      <p className="text-sm text-gray-500 mt-1">
                        {selectedWeek?.user__voornaam} {selectedWeek?.user__achternaam}
                      </p>
                    </div>
                    <button onClick={() => setShowWeekModal(false)} className="text-gray-400 hover:text-gray-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="p-4 sm:p-6">
                    {loadingEntries ? (
                      <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                      </div>
                    ) : weekEntries.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">{t('timeEntries.noEntriesFound')}</p>
                    ) : (
                      <>
                        {/* Desktop Table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                  {t('common.date')}
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                  {t('timeEntries.routeNumberShort')}
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                  {t('fleet.licensePlate')}
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                  {t('timeEntries.times')}
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('timeEntries.hours')}
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('timeEntries.km')}
                                </th>
                                <th className="px-4 py-3"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {weekEntries.map(entry => (
                                <tr key={entry.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm">
                                    {formatDate(entry.datum)}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-medium">
                                    {entry.ritnummer}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-mono">
                                    {entry.kenteken}
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {entry.aanvang} - {entry.eind}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    {formatDuration(entry.totaal_uren)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right font-medium">
                                    {entry.totaal_km}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      onClick={() => handleEditEntry(entry)}
                                      className="text-primary-600 hover:text-primary-900 p-1"
                                      title={t('common.edit')}
                                    >
                                      <PencilIcon className="h-5 w-5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Card View */}
                        <div className="md:hidden divide-y divide-gray-200 -mx-4">
                          {weekEntries.map(entry => (
                            <div key={entry.id} className="p-3 hover:bg-gray-50">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <h4 className="font-semibold text-gray-900 text-sm">{formatDate(entry.datum)}</h4>
                                  <p className="text-xs text-gray-500 font-mono">{entry.ritnummer}</p>
                                </div>
                                <button
                                  onClick={() => handleEditEntry(entry)}
                                  className="text-primary-600 hover:text-primary-900 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                                >
                                  <PencilIcon className="h-5 w-5" />
                                </button>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div>
                                  <span className="text-gray-500">{t('fleet.licensePlate')}: </span>
                                  <span className="font-mono font-medium">{entry.kenteken}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">{t('common.time')}: </span>
                                  <span className="font-medium">{entry.aanvang}-{entry.eind}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">{t('timeEntries.hours')}: </span>
                                  <span className="font-bold text-primary-600">{formatDuration(entry.totaal_uren)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">{t('timeEntries.km')}: </span>
                                  <span className="font-medium">{entry.totaal_km}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="px-4 sm:px-6 py-4 border-t flex justify-end">
                    <button onClick={() => setShowWeekModal(false)} className="btn-secondary min-h-[44px]">
                      {t('common.close')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Edit Entry Modal */}
      <Transition appear show={showEditModal} as={Fragment}>
        <Dialog as="div" className="relative z-[60]" onClose={() => setShowEditModal(false)}>
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
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-lg bg-white p-4 sm:p-6 shadow-xl transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title className="text-lg font-semibold">
                      {t('timeEntries.editEntry')}
                    </Dialog.Title>
                    <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-500 min-w-[44px] min-h-[44px] flex items-center justify-center">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <div>
                        <label className="form-label">{t('timeEntries.routeNumber')}</label>
                        <input
                          type="text"
                          value={editForm.ritnummer}
                          onChange={(e) => setEditForm({ ...editForm, ritnummer: e.target.value })}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">{t('fleet.licensePlate')}</label>
                        <input
                          type="text"
                          value={editForm.kenteken}
                          onChange={(e) => setEditForm({ ...editForm, kenteken: e.target.value })}
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="form-label">{t('common.date')}</label>
                      <input
                        type="date"
                        value={editForm.datum}
                        onChange={(e) => setEditForm({ ...editForm, datum: e.target.value })}
                        className="form-input"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                      <div>
                        <label className="form-label text-xs sm:text-sm">{t('timeEntries.startTime')}</label>
                        <input
                          type="time"
                          value={editForm.aanvang}
                          onChange={(e) => setEditForm({ ...editForm, aanvang: e.target.value })}
                          className="form-input text-sm"
                        />
                      </div>
                      <div>
                        <label className="form-label text-xs sm:text-sm">{t('timeEntries.endTime')}</label>
                        <input
                          type="time"
                          value={editForm.eind}
                          onChange={(e) => setEditForm({ ...editForm, eind: e.target.value })}
                          className="form-input text-sm"
                        />
                      </div>
                      <div>
                        <label className="form-label text-xs sm:text-sm">{t('timeEntries.breakTime')}</label>
                        <input
                          type="time"
                          value={editForm.pauze?.substring(0, 5) || '00:00'}
                          onChange={(e) => setEditForm({ ...editForm, pauze: e.target.value + ':00' })}
                          className="form-input text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div>
                        <label className="form-label">{t('timeEntries.kmStart')}</label>
                        <input
                          type="number"
                          value={editForm.km_start}
                          onChange={(e) => setEditForm({ ...editForm, km_start: parseInt(e.target.value) || 0 })}
                          className="form-input"
                        />
                      </div>
                      <div>
                        <label className="form-label">{t('timeEntries.kmEnd')}</label>
                        <input
                          type="number"
                          value={editForm.km_eind}
                          onChange={(e) => setEditForm({ ...editForm, km_eind: parseInt(e.target.value) || 0 })}
                          className="form-input"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col-reverse sm:flex-row justify-end gap-3">
                    <button
                      onClick={() => setShowEditModal(false)}
                      className="btn-secondary min-h-[44px]"
                      disabled={saving}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="btn-primary min-h-[44px]"
                      disabled={saving}
                    >
                      {saving ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
      </>}
    </div>
  )
}
