import { useState, useEffect, useCallback, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  TruckIcon,
  UserIcon,
  DocumentArrowDownIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useAuthStore } from '@/stores/authStore'
import { Company, Driver, WeekPlanning, PlanningEntry } from '@/types'
import {
  getWeekPlannings,
  createWeekPlanning,
  deleteWeekPlanning,
  getCurrentWeek,
  copyToNextWeek,
  updatePlanningEntry,
  getMyPlanning,
  sendPlanningEmail,
  getPlanningData,
  MyPlanningEntry,
} from '@/api/planning'
import { getDriverReport, DriverReport, downloadDriverReportPdf, getDriverReportYears } from '@/api/timetracking'
import { getDrivers } from '@/api/drivers'
import clsx from '@/utils/clsx'

const DAYS = [
  { key: 'ma', labelKey: 'planning.mon', fullKey: 'planning.monday' },
  { key: 'di', labelKey: 'planning.tue', fullKey: 'planning.tuesday' },
  { key: 'wo', labelKey: 'planning.wed', fullKey: 'planning.wednesday' },
  { key: 'do', labelKey: 'planning.thu', fullKey: 'planning.thursday' },
  { key: 'vr', labelKey: 'planning.fri', fullKey: 'planning.friday' },
] as const

const ALL_DAYS = [
  { key: 'ma', labelKey: 'planning.mon', fullKey: 'planning.monday' },
  { key: 'di', labelKey: 'planning.tue', fullKey: 'planning.tuesday' },
  { key: 'wo', labelKey: 'planning.wed', fullKey: 'planning.wednesday' },
  { key: 'do', labelKey: 'planning.thu', fullKey: 'planning.thursday' },
  { key: 'vr', labelKey: 'planning.fri', fullKey: 'planning.friday' },
  { key: 'za', labelKey: 'planning.sat', fullKey: 'planning.saturday' },
  { key: 'zo', labelKey: 'planning.sun', fullKey: 'planning.sunday' },
] as const

// Get current ISO 8601 week number (matches backend Python isocalendar)
function getCurrentWeekNumber(): number {
  const now = new Date()
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// Chauffeur Planning View Component
function ChauffeurPlanningView() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [weekInitialized, setWeekInitialized] = useState(false)
  const [currentWeek, setCurrentWeek] = useState<number>(0)
  const [currentYear, setCurrentYear] = useState<number>(0)
  const [entries, setEntries] = useState<MyPlanningEntry[]>([])
  const [chauffeurName, setChauffeurName] = useState<string>('')
  const [message, setMessage] = useState<string>('')

  // Load the correct current week from the backend (ISO 8601)
  useEffect(() => {
    const initWeek = async () => {
      try {
        const weekInfo = await getCurrentWeek()
        setCurrentWeek(weekInfo.weeknummer)
        setCurrentYear(weekInfo.jaar)
        setWeekInitialized(true)
      } catch (err) {
        console.error('Failed to get current week:', err)
        // Fallback to local calculation
        setCurrentWeek(getCurrentWeekNumber())
        setCurrentYear(new Date().getFullYear())
        setWeekInitialized(true)
      }
    }
    initWeek()
  }, [])

  useEffect(() => {
    if (weekInitialized) {
      loadMyPlanning()
    }
  }, [currentWeek, currentYear, weekInitialized])

  const loadMyPlanning = async () => {
    try {
      setLoading(true)
      const response = await getMyPlanning(currentWeek, currentYear)
      setEntries(response.entries)
      setChauffeurName(response.chauffeur || '')
      setMessage(response.message || '')
    } catch (err) {
      console.error('Failed to load my planning:', err)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const handlePreviousWeek = () => {
    if (currentWeek === 1) {
      setCurrentWeek(52)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentWeek(currentWeek - 1)
    }
  }

  const handleNextWeek = () => {
    if (currentWeek === 52) {
      setCurrentWeek(1)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentWeek(currentWeek + 1)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('planning.myPlanning')}</h1>
          {chauffeurName && (
            <p className="text-gray-500 mt-1">{t('drivers.title')}: {chauffeurName}</p>
          )}
        </div>
      </div>

      {/* Week selector */}
      <div className="card mb-6">
        <div className="p-4">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handlePreviousWeek}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            
            <div className="text-center min-w-[200px]">
              <div className="text-2xl font-bold text-gray-900">
                {t('common.week')} {currentWeek}
              </div>
              <div className="text-sm text-gray-500">{currentYear}</div>
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

      {/* Planning content */}
      {loading ? (
        <div className="card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : message ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500">{message}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center">
          <TruckIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{t('planning.noPlanningForWeek')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('timeEntries.day')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('timeEntries.vehicle')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('timeEntries.routeNumber')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('fleet.vehicleType')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('fleet.company')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{entry.dag_naam}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <TruckIcon className="h-5 w-5 text-gray-400 mr-2" />
                        <span className="font-mono font-medium">{entry.kenteken}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-gray-600">{entry.ritnummer || '-'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {entry.voertuig_type}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {entry.bedrijf}
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
                    <h3 className="font-semibold text-gray-900">{entry.dag_naam}</h3>
                    <p className="text-sm text-gray-500">{entry.bedrijf}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                    <TruckIcon className="h-4 w-4 text-gray-500" />
                    {entry.kenteken}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-600">
                    <span className="text-gray-500">{t('timeEntries.routeNumber')}:</span>{' '}
                    <span className="font-mono font-medium">{entry.ritnummer || '-'}</span>
                  </div>
                  <div className="text-gray-600">
                    <span className="text-gray-500">{t('fleet.vehicleType')}:</span>{' '}
                    <span className="font-medium">{entry.voertuig_type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Admin/Manager Planning View
function AdminPlanningView({ isReadOnly = false }: { isReadOnly?: boolean }) {
  const { t } = useTranslation()
  
  // State
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [planning, setPlanning] = useState<WeekPlanning | null>(null)
  
  // Filters
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [currentWeek, setCurrentWeek] = useState<number>(1)
  const [currentYear, setCurrentYear] = useState<number>(2026)
  const [showMoreCompanies, setShowMoreCompanies] = useState(false)
  
  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailAddress, setEmailAddress] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Entry editing
  const [editingEntry, setEditingEntry] = useState<string | null>(null)

  // Load initial data
  useEffect(() => {
    loadInitialData()
  }, [])

  // Load planning when filters change
  useEffect(() => {
    if (selectedCompany && currentWeek && currentYear) {
      loadPlanning()
    }
  }, [selectedCompany, currentWeek, currentYear])

  const loadInitialData = async () => {
    try {
      setLoading(true)
      const [planningData, weekInfo] = await Promise.all([
        getPlanningData(),
        getCurrentWeek(),
      ])
      
      setCompanies(planningData.companies)
      setDrivers(planningData.drivers)
      setCurrentWeek(weekInfo.weeknummer)
      setCurrentYear(weekInfo.jaar)
      
      // Auto-select first company
      if (planningData.companies.length > 0) {
        setSelectedCompany(planningData.companies[0].id)
      }
    } catch (err) {
      console.error('Failed to load initial data:', err)
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const loadPlanning = async () => {
    if (!selectedCompany) return
    
    try {
      const response = await getWeekPlannings({
        bedrijf: selectedCompany,
        weeknummer: currentWeek,
        jaar: currentYear,
      })
      
      setPlanning(response.results.length > 0 ? response.results[0] : null)
    } catch (err) {
      console.error('Failed to load planning:', err)
    }
  }

  const handlePreviousWeek = () => {
    if (currentWeek === 1) {
      setCurrentWeek(52)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentWeek(currentWeek - 1)
    }
  }

  const handleNextWeek = () => {
    if (currentWeek === 52) {
      setCurrentWeek(1)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentWeek(currentWeek + 1)
    }
  }

  const handleCreatePlanning = async () => {
    if (!selectedCompany) return
    
    try {
      setSaving(true)
      setError(null)
      
      await createWeekPlanning({
        bedrijf: selectedCompany,
        weeknummer: currentWeek,
        jaar: currentYear,
      })
      
      setShowCreateModal(false)
      loadPlanning()
    } catch (err: any) {
      setError(err.response?.data?.detail || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePlanning = async () => {
    if (!planning) return
    
    try {
      setSaving(true)
      await deleteWeekPlanning(planning.id)
      setPlanning(null)
      setShowDeleteModal(false)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleCopyToNextWeek = async () => {
    if (!planning) return
    
    try {
      setSaving(true)
      setError(null)
      
      const newPlanning = await copyToNextWeek(planning.id)
      
      // Navigate to the new week
      setCurrentWeek(newPlanning.weeknummer)
      setCurrentYear(newPlanning.jaar)
    } catch (err: any) {
      setError(err.response?.data?.error || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleSendEmail = async () => {
    if (!planning || !emailAddress) return
    
    try {
      setEmailSending(true)
      setEmailError(null)
      setEmailSuccess(null)
      
      const result = await sendPlanningEmail(planning.id, emailAddress)
      setEmailSuccess(result.message)
      
      // Close modal after 2 seconds on success
      setTimeout(() => {
        setShowEmailModal(false)
        setEmailAddress('')
        setEmailSuccess(null)
      }, 2000)
    } catch (err: any) {
      setEmailError(err.response?.data?.error || t('common.error'))
    } finally {
      setEmailSending(false)
    }
  }

  const handleUpdateEntry = async (entryId: string, chauffeurId: string | null) => {
    try {
      await updatePlanningEntry(entryId, { chauffeur: chauffeurId })
      loadPlanning()
      setEditingEntry(null)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('common.error'))
    }
  }

  // Export planning to PDF
  const handleExportPDF = () => {
    if (!planning?.entries || planning.entries.length === 0) {
      setError(t('common.noData'))
      return
    }

    const companyName = companies.find(c => c.id === selectedCompany)?.naam || t('common.none')
    
    // Create PDF in landscape mode for better table fit
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    })

    // Title
    doc.setFontSize(18)
    doc.text(`${t('planning.weekPlanning')} ${t('common.week')} ${currentWeek} - ${currentYear}`, 14, 15)
    
    doc.setFontSize(12)
    doc.text(`${t('fleet.company')}: ${companyName}`, 14, 23)
    
    // Prepare table data
    // Columns: Weeknummer, Dag, Route, Chauffeur, Telefoonnummer, ADR, Kenteken
    const tableData: string[][] = []
    
    // Sort entries by ritnummer first, then by day
    const dayOrder = { ma: 1, di: 2, wo: 3, do: 4, vr: 5 }
    const sortedEntries = [...planning.entries].sort((a, b) => {
      // First sort by ritnummer (numeric)
      const numA = parseInt(a.vehicle_ritnummer, 10)
      const numB = parseInt(b.vehicle_ritnummer, 10)
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB
      }
      // Then by ritnummer string
      const ritCompare = (a.vehicle_ritnummer || '').localeCompare(b.vehicle_ritnummer || '')
      if (ritCompare !== 0) return ritCompare
      // Finally by day
      return dayOrder[a.dag] - dayOrder[b.dag]
    })

    for (const entry of sortedEntries) {
      tableData.push([
        currentWeek.toString(),
        entry.dag_display || entry.dag.toUpperCase(),
        entry.vehicle_ritnummer || '-',
        entry.chauffeur_naam || '-',
        entry.telefoon || '-',
        entry.adr ? 'Ja' : 'Nee',
        entry.vehicle_kenteken || '-'
      ])
    }

    // Generate table
    autoTable(doc, {
      head: [['Weeknummer', 'Dag', 'Route', 'Chauffeur', 'Telefoonnummer', 'ADR', 'Kenteken']],
      body: tableData,
      startY: 30,
      styles: {
        fontSize: 10,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [59, 130, 246], // Blue color
        textColor: 255,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250],
      },
      columnStyles: {
        0: { cellWidth: 25 }, // Weeknummer
        1: { cellWidth: 25 }, // Dag
        2: { cellWidth: 35 }, // Route
        3: { cellWidth: 50 }, // Chauffeur
        4: { cellWidth: 40 }, // Telefoonnummer
        5: { cellWidth: 20 }, // ADR
        6: { cellWidth: 30 }, // Kenteken
      },
    })

    // Footer
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(128)
      doc.text(
        `Gegenereerd op ${new Date().toLocaleDateString('nl-NL')} om ${new Date().toLocaleTimeString('nl-NL')}`,
        14,
        doc.internal.pageSize.height - 10
      )
      doc.text(
        `Pagina ${i} van ${pageCount}`,
        doc.internal.pageSize.width - 30,
        doc.internal.pageSize.height - 10
      )
    }

    // Download
    doc.save(`planning-week-${currentWeek}-${currentYear}-${companyName.replace(/\s+/g, '-')}.pdf`)
  }

  // Group entries by vehicle
  const getEntriesByVehicle = useCallback(() => {
    if (!planning?.entries) return []
    
    const vehicleMap = new Map<string, {
      kenteken: string
      type: string
      ritnummer: string
      entries: Map<string, PlanningEntry>
    }>()
    
    for (const entry of planning.entries) {
      if (!vehicleMap.has(entry.vehicle)) {
        vehicleMap.set(entry.vehicle, {
          kenteken: entry.vehicle_kenteken,
          type: entry.vehicle_type,
          ritnummer: entry.vehicle_ritnummer,
          entries: new Map()
        })
      }
      vehicleMap.get(entry.vehicle)!.entries.set(entry.dag, entry)
    }
    
    // Sort by ritnummer (numeric sort, lowest first)
    return Array.from(vehicleMap.entries())
      .map(([vehicleId, data]) => ({
        vehicleId,
        ...data
      }))
      .sort((a, b) => {
        // Try numeric sort first
        const numA = parseInt(a.ritnummer, 10)
        const numB = parseInt(b.ritnummer, 10)
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB
        }
        // Fall back to string sort
        return (a.ritnummer || '').localeCompare(b.ritnummer || '')
      })
  }, [planning])

  // Get drivers for company
  const companyDrivers = drivers.filter(d => 
    !d.bedrijf || d.bedrijf === selectedCompany
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">{t('planning.weekPlanning')}</h1>
        {planning && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportPDF}
              className="btn-secondary text-sm px-3 py-2"
            >
              <DocumentArrowDownIcon className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('planning.export')}</span>
            </button>
            <button
              onClick={() => {
                setEmailAddress('')
                setEmailError(null)
                setEmailSuccess(null)
                setShowEmailModal(true)
              }}
              className="btn-secondary text-sm px-3 py-2"
            >
              <EnvelopeIcon className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{t('planning.sendEmail')}</span>
            </button>
            {!isReadOnly && (
              <>
                <button
                  onClick={handleCopyToNextWeek}
                  disabled={saving}
                  className="btn-secondary text-sm px-3 py-2"
                >
                  <DocumentDuplicateIcon className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('common.copy')} {t('common.next').toLowerCase()} {t('common.week').toLowerCase()}</span>
                </button>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="btn-danger text-sm px-3 py-2"
                >
                  <TrashIcon className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{t('common.delete')}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="p-3 flex flex-wrap items-center gap-2 sm:gap-4">
          {/* Company selector */}
          <div className="flex flex-wrap items-center gap-1">
            {(showMoreCompanies ? companies : companies.slice(0, 4)).map((company) => (
              <button
                key={company.id}
                onClick={() => setSelectedCompany(company.id.toString())}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedCompany === company.id.toString()
                    ? 'bg-primary-600 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {company.naam}
              </button>
            ))}
            {companies.length > 4 && (
              <button
                onClick={() => setShowMoreCompanies(!showMoreCompanies)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-primary-600 hover:bg-primary-50 transition-colors"
              >
                {showMoreCompanies ? t('common.showLess', 'Toon minder') : t('common.showMore', 'Toon meer')}
              </button>
            )}
          </div>

          {/* Week navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviousWeek}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <div className="px-3 py-2 bg-primary-50 rounded-lg font-medium text-primary-700 min-w-[120px] text-center text-sm">
              {t('common.week')} {currentWeek} / {currentYear}
            </div>
            <button
              onClick={handleNextWeek}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Create button */}
          {!isReadOnly && !planning && selectedCompany && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary ml-auto"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              {t('planning.createPlanning')}
            </button>
          )}
        </div>
      </div>

      {/* Planning Grid */}
      {planning ? (
        <div className="card overflow-hidden">
          {/* Desktop Table View */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                    {t('timeEntries.vehicle')}
                  </th>
                  {DAYS.map((day) => (
                    <th
                      key={day.key}
                      className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]"
                    >
                      {t(day.fullKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {getEntriesByVehicle().map((vehicle) => (
                  <tr key={vehicle.vehicleId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center">
                        <TruckIcon className="h-5 w-5 text-gray-400 mr-2" />
                        <div>
                          <div className="font-medium text-gray-900">
                            {vehicle.kenteken}
                          </div>
                          <div className="text-sm text-gray-500">
                            {vehicle.ritnummer} • {vehicle.type}
                          </div>
                        </div>
                      </div>
                    </td>
                    {DAYS.map((day) => {
                      const entry = vehicle.entries.get(day.key)
                      if (!entry) return <td key={day.key} className="px-4 py-3" />
                      
                      const isEditing = editingEntry === entry.id
                      
                      return (
                        <td key={day.key} className="px-2 py-2">
                          {isEditing && !isReadOnly ? (
                            <DriverSelector
                              drivers={companyDrivers}
                              value={entry.chauffeur}
                              onChange={(driverId) => handleUpdateEntry(entry.id, driverId)}
                              onCancel={() => setEditingEntry(null)}
                            />
                          ) : (
                            <div
                              onClick={() => !isReadOnly && setEditingEntry(entry.id)}
                              className={clsx(
                                'rounded-lg p-2 min-h-[60px] transition-colors',
                                entry.chauffeur
                                  ? 'bg-primary-50 border border-primary-200'
                                  : 'bg-gray-50 border border-gray-200 border-dashed',
                                !isReadOnly && 'cursor-pointer hover:border-primary-400'
                              )}
                            >
                              {entry.chauffeur ? (
                                <div className="flex items-center">
                                  <UserIcon className="h-4 w-4 text-primary-600 mr-1.5" />
                                  <div>
                                    <div className="text-sm font-medium text-gray-900">
                                      {entry.chauffeur_naam}
                                    </div>
                                    {entry.adr && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                        ADR
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-gray-400 text-center">
                                  {isReadOnly ? t('planning.noPlanning') : t('planning.assignDriver')}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden divide-y divide-gray-200">
            {getEntriesByVehicle().map((vehicle) => (
              <div key={vehicle.vehicleId} className="p-3">
                {/* Vehicle header */}
                <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                  <TruckIcon className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="font-mono font-bold text-gray-900">{vehicle.kenteken}</div>
                    <div className="text-xs text-gray-500">{vehicle.ritnummer} • {vehicle.type}</div>
                  </div>
                </div>
                
                {/* Days grid */}
                <div className="grid grid-cols-5 gap-1">
                  {DAYS.map((day) => {
                    const entry = vehicle.entries.get(day.key)
                    
                    return (
                      <div key={day.key} className="text-center">
                        <div className="text-xs font-medium text-gray-500 mb-1">{t(day.labelKey)}</div>
                        {entry ? (
                          <div
                            onClick={() => !isReadOnly && setEditingEntry(entry.id)}
                            className={clsx(
                              'rounded p-1 min-h-[40px] text-xs transition-colors',
                              entry.chauffeur
                                ? 'bg-primary-50 border border-primary-200'
                                : 'bg-gray-50 border border-gray-200 border-dashed',
                              !isReadOnly && 'cursor-pointer active:bg-primary-100'
                            )}
                          >
                            {editingEntry === entry.id && !isReadOnly ? (
                              <DriverSelector
                                drivers={companyDrivers}
                                value={entry.chauffeur}
                                onChange={(driverId) => handleUpdateEntry(entry.id, driverId)}
                                onCancel={() => setEditingEntry(null)}
                              />
                            ) : entry.chauffeur ? (
                              <div>
                                <div className="font-medium text-gray-900 truncate text-[10px]">
                                  {entry.chauffeur_naam?.split(' ')[0]}
                                </div>
                                {entry.adr && (
                                  <span className="text-[8px] font-medium text-yellow-800">ADR</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </div>
                        ) : (
                          <div className="rounded p-1 min-h-[40px] bg-gray-100 text-gray-400 text-[10px]">-</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          
          {getEntriesByVehicle().length === 0 && (
            <div className="p-8 text-center text-gray-500">
              {t('fleet.noVehicles')}
            </div>
          )}
        </div>
      ) : selectedCompany ? (
        <div className="card">
          <div className="p-8 text-center">
            <TruckIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-lg font-medium text-gray-900">
              {t('planning.noPlanningForWeek')}
            </h3>
            <p className="mt-1 text-gray-500">
              {t('planning.noPlanningCreated', { week: currentWeek, year: currentYear })}
            </p>
            {!isReadOnly && (
              <div className="mt-6">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary"
                >
                  <PlusIcon className="h-5 w-5 mr-2" />
                  {t('planning.createPlanning')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="p-8 text-center text-gray-500">
            {t('planning.selectCompany')}
          </div>
        </div>
      )}

      {/* Create Modal */}
      <Transition appear show={showCreateModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowCreateModal(false)}>
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
                      {t('planning.createPlanning')}
                    </Dialog.Title>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="text-gray-400 hover:text-gray-500"
                    >
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      {t('planning.createPlanning')}:
                    </p>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <dl className="space-y-2">
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">{t('fleet.company')}:</dt>
                          <dd className="text-sm font-medium">
                            {companies.find(c => c.id === selectedCompany)?.naam}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-sm text-gray-500">{t('common.week')}:</dt>
                          <dd className="text-sm font-medium">
                            {currentWeek} / {currentYear}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <p className="text-sm text-gray-500">
                      {t('common.info')}
                    </p>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="btn-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleCreatePlanning}
                      disabled={saving}
                      className="btn-primary"
                    >
                      {saving ? t('common.creating') : t('common.create')}
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
                    <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold text-gray-900">
                        {t('common.delete')} {t('planning.title').toLowerCase()}
                      </Dialog.Title>
                      <p className="mt-2 text-sm text-gray-500">
                        {t('common.confirm')} {t('common.week').toLowerCase()} {currentWeek} / {currentYear}?
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(false)}
                      className="btn-secondary"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleDeletePlanning}
                      disabled={saving}
                      className="btn-danger"
                    >
                      {saving ? t('common.deleting') : t('common.delete')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Email Modal */}
      <Transition appear show={showEmailModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowEmailModal(false)}>
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
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-primary-100">
                      <EnvelopeIcon className="h-6 w-6 text-primary-600" />
                    </div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      {t('planning.sendEmail')}
                    </Dialog.Title>
                  </div>
                  
                  <p className="text-sm text-gray-500 mb-4">
                    {t('planning.title')} {t('common.week').toLowerCase()} {currentWeek} PDF.
                  </p>

                  {emailSuccess ? (
                    <div className="rounded-md bg-green-50 p-4 mb-4">
                      <p className="text-sm text-green-700">{emailSuccess}</p>
                    </div>
                  ) : (
                    <>
                      {emailError && (
                        <div className="rounded-md bg-red-50 p-4 mb-4">
                          <p className="text-sm text-red-700">{emailError}</p>
                        </div>
                      )}
                      
                      <div className="mb-4">
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                          {t('common.email')}
                        </label>
                        <input
                          type="email"
                          id="email"
                          value={emailAddress}
                          onChange={(e) => setEmailAddress(e.target.value)}
                          placeholder="email@example.com"
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowEmailModal(false)}
                      className="btn-secondary"
                    >
                      {emailSuccess ? t('common.close') : t('common.cancel')}
                    </button>
                    {!emailSuccess && (
                      <button
                        onClick={handleSendEmail}
                        disabled={emailSending || !emailAddress}
                        className="btn-primary"
                      >
                        {emailSending ? t('common.sending') : t('common.send')}
                      </button>
                    )}
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

// Driver selector dropdown component
interface DriverSelectorProps {
  drivers: Driver[]
  value: string | null
  onChange: (driverId: string | null) => void
  onCancel: () => void
}

function DriverSelector({ drivers, value, onChange, onCancel }: DriverSelectorProps) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <select
        autoFocus
        defaultValue={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={onCancel}
        className="block w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
      >
        <option value="">-- {t('planning.noPlanning')} --</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.naam} {driver.adr ? '(ADR)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

// Historie View Component (Admin only)
function HistorieView() {
  const { t } = useTranslation()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null)
  const [report, setReport] = useState<DriverReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | ''>('')

  // Load drivers on mount
  useEffect(() => {
    loadDrivers()
  }, [])

  const loadDrivers = async () => {
    try {
      const response = await getDrivers()
      setDrivers(response.results || response)
    } catch (err) {
      console.error('Failed to load drivers:', err)
    }
  }

  // Load available years when driver is selected
  const loadAvailableYears = async (driverId: string) => {
    try {
      const response = await getDriverReportYears(driverId)
      setAvailableYears(response.years || [])
    } catch (err) {
      console.error('Failed to load available years:', err)
      setAvailableYears([])
    }
  }

  // Filter drivers based on search
  const filteredDrivers = drivers.filter(driver => 
    driver.naam.toLowerCase().includes(searchQuery.toLowerCase()) ||
    driver.gekoppelde_gebruiker_naam?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Load report when driver is selected
  const handleSelectDriver = async (driver: Driver) => {
    setSelectedDriver(driver)
    setSearchQuery(driver.naam)
    setSearchFocused(false)
    setSelectedYear('')
    setLoading(true)
    
    try {
      // Load available years for this driver
      await loadAvailableYears(driver.id.toString())
      
      // Load report without year filter initially
      const reportData = await getDriverReport(driver.id.toString())
      setReport(reportData)
    } catch (err) {
      console.error('Failed to load driver report:', err)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  // Reload report when year filter changes
  const handleYearChange = async (year: number | '') => {
    setSelectedYear(year)
    if (!selectedDriver) return
    
    setLoading(true)
    try {
      const reportData = await getDriverReport(
        selectedDriver.id.toString(),
        year ? year : undefined
      )
      setReport(reportData)
    } catch (err) {
      console.error('Failed to load driver report:', err)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  const clearSelection = () => {
    setSelectedDriver(null)
    setReport(null)
    setSearchQuery('')
    setSelectedYear('')
    setAvailableYears([])
  }

  return (
    <div className="space-y-6">
      {/* Search Bar and Year Filter */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Chauffeur Search */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('drivers.searchDrivers')}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (selectedDriver) {
                    setSelectedDriver(null)
                    setReport(null)
                    setSelectedYear('')
                    setAvailableYears([])
                  }
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                placeholder={t('common.searchPlaceholder')}
                className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              />
              {searchQuery && (
                <button
                  onClick={clearSelection}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                </button>
              )}
              
              {/* Search Results Dropdown */}
              {searchFocused && searchQuery && !selectedDriver && filteredDrivers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {filteredDrivers.map((driver) => (
                    <button
                      key={driver.id}
                      onClick={() => handleSelectDriver(driver)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
                    >
                      <UserIcon className="h-5 w-5 text-gray-400" />
                      <div>
                        <div className="font-medium text-gray-900">{driver.naam}</div>
                        {driver.gekoppelde_gebruiker_naam && (
                          <div className="text-sm text-gray-500">{driver.gekoppelde_gebruiker_naam}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              
              {searchFocused && searchQuery && !selectedDriver && filteredDrivers.length === 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-4 text-center text-gray-500">
                  {t('drivers.noDrivers')}
                </div>
              )}
            </div>
          </div>

          {/* Year Filter - only show when driver is selected */}
          {selectedDriver && availableYears.length > 0 && (
            <div className="md:w-48">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('common.year')}
              </label>
              <select
                value={selectedYear}
                onChange={(e) => handleYearChange(e.target.value ? parseInt(e.target.value) : '')}
                className="block w-full py-2 px-3 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">{t('drivers.allYears')}</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Report Display */}
      {loading && (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
          <p className="mt-4 text-gray-500">{t('common.loading')}</p>
        </div>
      )}

      {!loading && selectedDriver && report && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {/* Report Header */}
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                  <UserIcon className="h-4 w-4 sm:h-5 sm:w-5 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm sm:text-base text-gray-900 truncate">{report.driver_name || selectedDriver.naam}</h3>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">{selectedDriver.gekoppelde_gebruiker_naam || ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 ml-10 sm:ml-0">
                <span className="text-xs sm:text-sm text-gray-500">
                  {report.weeks.length} {t('drivers.weeksWithTrips')}
                </span>
                <button
                  onClick={() => downloadDriverReportPdf(selectedDriver.id.toString(), selectedDriver.naam)}
                  className="inline-flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
                >
                  <DocumentArrowDownIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">{t('drivers.exportPdf')}</span>
                  <span className="sm:hidden">PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Report Table */}
          {report.weeks.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>{t('drivers.noSubmittedHours')}</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-100">
                        {t('common.week')}
                      </th>
                      {ALL_DAYS.map(day => (
                        <th key={day.key} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {t(day.fullKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {report.weeks.map((week) => (
                      <tr key={`${week.jaar}-${week.weeknummer}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-sm text-gray-900 sticky left-0 bg-white">
                          <div className="flex items-center gap-1.5">
                            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                            <span>W{week.weeknummer} '{String(week.jaar).slice(-2)}</span>
                          </div>
                        </td>
                        {ALL_DAYS.map(day => {
                          const dayData = week.dagen[day.key as keyof typeof week.dagen]
                          return (
                            <td key={day.key} className="px-2 py-2 text-center">
                              {dayData && dayData.length > 0 ? (
                                <div className="space-y-1">
                                  {dayData.map((entry, idx) => (
                                    <div 
                                      key={idx} 
                                      className="bg-primary-50 text-primary-700 rounded px-1.5 py-0.5 text-xs"
                                      title={`Rit ${entry.ritnummer} - ${entry.kenteken}`}
                                    >
                                      <div className="font-medium">{entry.ritnummer || '-'}</div>
                                      <div className="text-primary-500 text-[10px]">{entry.kenteken}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card Layout */}
              <div className="lg:hidden divide-y divide-gray-200">
                {report.weeks.map((week) => (
                  <div key={`${week.jaar}-${week.weeknummer}`} className="p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-sm text-gray-900">W{week.weeknummer} '{String(week.jaar).slice(-2)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {ALL_DAYS.map(day => {
                        const dayData = week.dagen[day.key as keyof typeof week.dagen]
                        if (!dayData || dayData.length === 0) return null
                        return (
                          <div key={day.key} className="bg-gray-50 rounded p-1.5">
                            <div className="text-[10px] font-medium text-gray-500 uppercase mb-0.5">{t(day.fullKey).substring(0, 2)}</div>
                            {dayData.map((entry, idx) => (
                              <div key={idx} className="bg-primary-50 text-primary-700 rounded px-1.5 py-0.5 text-xs mt-0.5">
                                <span className="font-medium">{entry.ritnummer || '-'}</span>
                                <span className="text-primary-500 text-[10px] ml-1">{entry.kenteken}</span>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !selectedDriver && (
        <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
          <MagnifyingGlassIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{t('drivers.selectDriver')}</h3>
          <p className="text-gray-500">{t('drivers.searchAndSelect')}</p>
        </div>
      )}
    </div>
  )
}

// Main export - shows different view based on user role
export default function PlanningPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'planning' | 'historie'>('planning')
  
  const userPermissions = user?.module_permissions || []
  const isAdmin = user?.rol === 'admin'
  const hasViewAll = isAdmin || userPermissions.includes('view_all_planning') || userPermissions.includes('manage_all_planning')
  const hasManageAll = isAdmin || userPermissions.includes('manage_all_planning')
  
  // Users without view_all_planning or manage_all_planning see only their own planning
  if (!hasViewAll) {
    return <ChauffeurPlanningView />
  }
  
  // Users with view/manage all planning see the full planning management
  return (
    <div className="space-y-6">
      {/* Tabs (only for admins or manage_all_planning) */}
      {hasManageAll && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('planning')}
              className={clsx(
                'py-4 px-1 border-b-2 font-medium text-sm',
                activeTab === 'planning'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <CalendarDaysIcon className="h-5 w-5 inline-block mr-2" />
              {t('planning.title')}
            </button>
            <button
              onClick={() => setActiveTab('historie')}
              className={clsx(
                'py-4 px-1 border-b-2 font-medium text-sm',
                activeTab === 'historie'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <ClockIcon className="h-5 w-5 inline-block mr-2" />
              {t('planning.history')}
            </button>
          </nav>
        </div>
      )}
      
      {/* Tab Content */}
      {activeTab === 'planning' ? <AdminPlanningView isReadOnly={!hasManageAll} /> : <HistorieView />}
    </div>
  )
}
