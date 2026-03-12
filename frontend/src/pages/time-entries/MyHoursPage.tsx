/**
 * My Hours Page - For chauffeurs to view their submitted hours
 * They can view and delete but not edit submitted entries
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  TrashIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import ImportedHoursTab from './ImportedHoursTab'
import { TimeEntry } from '@/types'
import {
  getTimeEntries,
  deleteTimeEntry,
  getWeekSummary,
  WeekSummary,
} from '@/api/timetracking'
import toast from 'react-hot-toast'
import Pagination, { PageSize } from '@/components/common/Pagination'

// Format duration to readable string
function formatDuration(duration: string | null): string {
  if (!duration) return '-'
  
  // Handle HH:MM:SS format
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

// Get current week number
function getCurrentWeekNumber(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now.getTime() - start.getTime()
  const oneWeek = 604800000
  return Math.ceil((diff + start.getDay() * 86400000) / oneWeek)
}

export default function MyHoursPage() {
  const { t } = useTranslation()
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'myHours' | 'imported'>('myHours')
  
  // State - initialize with current week/year
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null)
  const [currentWeek, setCurrentWeek] = useState<number>(getCurrentWeekNumber())
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear())
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  
  // Modal state
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Load entries when week changes
  useEffect(() => {
    loadEntries()
    loadWeekSummary()
  }, [currentWeek, currentYear, currentPage, pageSize])

  const loadEntries = async () => {
    try {
      setLoading(true)
      const response = await getTimeEntries({
        weeknummer: currentWeek,
        jaar: currentYear,
        status: 'ingediend',
        page: currentPage,
        page_size: pageSize,
        ordering: '-datum',
      })
      
      setEntries(response.results)
      setTotalCount(response.count)
      setTotalPages(Math.ceil(response.count / pageSize))
    } catch (err) {
      console.error('Failed to load entries:', err)
      toast.error(t('timeEntries.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const loadWeekSummary = async () => {
    try {
      const summary = await getWeekSummary(currentWeek, currentYear)
      setWeekSummary(summary)
    } catch (err) {
      console.error('Failed to load week summary:', err)
    }
  }

  const handlePreviousWeek = () => {
    if (currentWeek === 1) {
      setCurrentWeek(52)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentWeek(currentWeek - 1)
    }
    setCurrentPage(1)
  }

  const handleNextWeek = () => {
    if (currentWeek === 52) {
      setCurrentWeek(1)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentWeek(currentWeek + 1)
    }
    setCurrentPage(1)
  }

  const handlePageSizeChange = (newSize: PageSize) => {
    setPageSize(newSize)
    setCurrentPage(1)
  }

  const handleViewEntry = (entry: TimeEntry) => {
    setSelectedEntry(entry)
    setShowDetailModal(true)
  }

  const handleDeleteClick = (entry: TimeEntry) => {
    setSelectedEntry(entry)
    setShowDeleteModal(true)
  }

  const handleDeleteConfirm = async () => {
    if (!selectedEntry) return
    
    try {
      setDeleting(true)
      await deleteTimeEntry(selectedEntry.id)
      toast.success(t('timeEntries.entryDeleted'))
      setShowDeleteModal(false)
      setSelectedEntry(null)
      loadEntries()
      loadWeekSummary()
    } catch (err) {
      toast.error(t('timeEntries.deleteFailed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('timeEntries.mySubmittedHours')}</h1>
          <p className="text-gray-500 mt-1">{t('timeEntries.mySubmittedHoursDescription')}</p>
        </div>
      </div>

      {/* Desktop Tab navigation - hidden on mobile */}
      <div className="hidden md:block mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('myHours')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'myHours'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ClockIcon className="h-5 w-5" />
            {t('timeEntries.mySubmittedHours')}
          </button>
          <button
            onClick={() => setActiveTab('imported')}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'imported'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <ArrowDownTrayIcon className="h-5 w-5" />
            {t('urenImport.importedTab')}
          </button>
        </nav>
      </div>

      {/* Mobile Tab Accordion - hidden on desktop */}
      <div className="md:hidden space-y-2 mb-4">
        {[
          { id: 'myHours' as const, name: t('timeEntries.mySubmittedHours'), icon: ClockIcon },
          { id: 'imported' as const, name: t('urenImport.importedTab'), icon: ArrowDownTrayIcon },
        ].map((tab) => {
          const isOpen = activeTab === tab.id
          return (
            <div key={tab.id}>
              <button
                onClick={() => setActiveTab(isOpen ? 'myHours' : tab.id)}
                className={`flex items-center gap-3 w-full p-4 bg-white rounded-xl border shadow-sm text-sm font-medium transition-colors ${
                  isOpen
                    ? 'border-primary-300 text-primary-600 bg-primary-50 rounded-b-none'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <tab.icon className={`h-5 w-5 ${isOpen ? 'text-primary-600' : 'text-gray-400'}`} />
                {tab.name}
                <ChevronDownIcon className={`h-4 w-4 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary-600' : 'text-gray-400'}`} />
              </button>
              {isOpen && tab.id === 'imported' && (
                <div className="bg-white rounded-b-xl border border-t-0 border-primary-300 shadow-sm p-4">
                  <ImportedHoursTab />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Imported Hours Tab - Desktop */}
      {activeTab === 'imported' && (
        <div className="hidden md:block">
          <ImportedHoursTab />
        </div>
      )}

      {/* My Hours Tab Content */}
      {activeTab === 'myHours' && <>
      {/* Week selector with search and summary */}
      <div className="card mb-6">
        <div className="p-4">
          {/* Search fields */}
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">{t('common.week')}:</label>
              <input
                type="number"
                min="1"
                max="53"
                value={currentWeek}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1
                  setCurrentWeek(Math.min(53, Math.max(1, val)))
                  setCurrentPage(1)
                }}
                className="form-input w-20 text-center"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">{t('common.year')}:</label>
              <input
                type="number"
                min="2020"
                max="2030"
                value={currentYear}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || new Date().getFullYear()
                  setCurrentYear(val)
                  setCurrentPage(1)
                }}
                className="form-input w-24 text-center"
              />
            </div>
          </div>
          
          {/* Navigation arrows and summary */}
          <div className="flex items-center justify-between">
            <button
              onClick={handlePreviousWeek}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            
            <div className="text-center flex-1">
              <div className="text-xl font-bold text-gray-900">
                Week {currentWeek}, {currentYear}
              </div>
              
              {weekSummary && weekSummary.ingediend_count > 0 && (
                <div className="mt-2 flex justify-center gap-6 text-sm">
                  <div>
                    <span className="text-gray-500">{t('timeEntries.hours')}:</span>{' '}
                    <span className="font-medium">{formatDuration(weekSummary.totaal_uren)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('timeEntries.km')}:</span>{' '}
                    <span className="font-medium">{weekSummary.totaal_km}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">{t('timeEntries.trips')}:</span>{' '}
                    <span className="font-medium">{weekSummary.ingediend_count}</span>
                  </div>
                </div>
              )}
            </div>
            
            <button
              onClick={handleNextWeek}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Entries table/cards */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('timeEntries.noSubmittedHoursForWeek')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.date')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.routeNumber')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('fleet.licensePlate')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.hours')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.km')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {formatDate(entry.datum)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {entry.ritnummer}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">
                        {entry.kenteken}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        {formatDuration(entry.totaal_uren)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        {entry.totaal_km}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleViewEntry(entry)}
                            className="text-primary-600 hover:text-primary-900 p-1"
                            title={t('common.view')}
                          >
                            <EyeIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(entry)}
                            className="text-red-600 hover:text-red-900 p-1"
                            title={t('common.delete')}
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {entries.map((entry) => (
                <div key={entry.id} className="p-4 hover:bg-gray-50">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{entry.ritnummer}</h3>
                      <p className="text-sm text-gray-500">{formatDate(entry.datum)}</p>
                    </div>
                    <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                      {entry.kenteken}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">{t('timeEntries.hours')}:</span>{' '}
                      <span className="font-medium">{formatDuration(entry.totaal_uren)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">{t('timeEntries.km')}:</span>{' '}
                      <span className="font-medium">{entry.totaal_km}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 pt-3 border-t">
                    <button
                      onClick={() => handleViewEntry(entry)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 min-h-[44px]"
                    >
                      <EyeIcon className="h-5 w-5" />
                      {t('common.view')}
                    </button>
                    <button
                      onClick={() => handleDeleteClick(entry)}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 min-h-[44px]"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        )}
      </div>

      {/* Detail Modal */}
      <Transition appear show={showDetailModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowDetailModal(false)}>
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
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 shadow-xl transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title className="text-lg font-semibold">
                      {t('timeEntries.entryDetails')}
                    </Dialog.Title>
                    <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  {selectedEntry && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-gray-500">{t('common.date')}</div>
                          <div className="font-medium">{formatDate(selectedEntry.datum)}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">{t('timeEntries.weekNumber')}</div>
                          <div className="font-medium">{selectedEntry.weeknummer}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">{t('timeEntries.routeNumber')}</div>
                          <div className="font-medium">{selectedEntry.ritnummer}</div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">{t('fleet.licensePlate')}</div>
                          <div className="font-mono font-medium">{selectedEntry.kenteken}</div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-2">{t('timeEntries.times')}</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-sm text-gray-500">{t('timeEntries.startTime')}</div>
                            <div className="font-medium">{selectedEntry.aanvang}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">{t('timeEntries.endTime')}</div>
                            <div className="font-medium">{selectedEntry.eind}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">{t('timeEntries.breakTime')}</div>
                            <div className="font-medium">{formatDuration(selectedEntry.pauze)}</div>
                          </div>
                        </div>
                        <div className="mt-2">
                          <div className="text-sm text-gray-500">{t('timeEntries.totalHours')}</div>
                          <div className="text-lg font-bold text-primary-600">
                            {formatDuration(selectedEntry.totaal_uren)}
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-2">{t('timeEntries.kilometers')}</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-sm text-gray-500">{t('timeEntries.start')}</div>
                            <div className="font-medium">{selectedEntry.km_start}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">{t('timeEntries.end')}</div>
                            <div className="font-medium">{selectedEntry.km_eind}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">{t('common.total')}</div>
                            <div className="text-lg font-bold text-primary-600">
                              {selectedEntry.totaal_km} km
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <button onClick={() => setShowDetailModal(false)} className="btn-secondary">
                      {t('common.close')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Delete Confirmation Modal */}
      <Transition appear show={showDeleteModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowDeleteModal(false)}>
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
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 shadow-xl transition-all">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 p-2 bg-red-100 rounded-full">
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-gray-900">
                        {t('timeEntries.deleteEntry')}
                      </Dialog.Title>
                      <p className="mt-2 text-sm text-gray-500">
                        {t('timeEntries.deleteConfirm')}
                      </p>
                      {selectedEntry && (
                        <p className="mt-2 text-sm font-medium">
                          {formatDate(selectedEntry.datum)} - {selectedEntry.ritnummer}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setShowDeleteModal(false)}
                      className="btn-secondary"
                      disabled={deleting}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleDeleteConfirm}
                      className="btn-primary bg-red-600 hover:bg-red-700"
                      disabled={deleting}
                    >
                      {deleting ? t('common.deleting') : t('common.delete')}
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
