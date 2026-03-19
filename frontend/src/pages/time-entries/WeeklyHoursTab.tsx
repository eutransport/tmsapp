/**
 * Weekly Hours Overview Tab
 * Shows worked hours vs minimum hours per user per week.
 * Allows setting minimum hours and importing missed hours to invoices.
 */
import { useState, useEffect, useMemo, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  MagnifyingGlassIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  DocumentPlusIcon,
  XMarkIcon,
  EyeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import HoursDetailModal from './HoursDetailModal'
import {
  WeeklyHoursOverview,
  getWeeklyHoursOverview,
  addMissedHoursToInvoice,
  getCurrentYear,
} from '@/api/timetracking'
import { getAllCompanies } from '@/api/companies'
import { getInvoices } from '@/api/invoices'
import { Company, Invoice } from '@/types'
import toast from 'react-hot-toast'

export default function WeeklyHoursTab() {
  const { t } = useTranslation()
  
  // Data state
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<WeeklyHoursOverview[]>([])
  const [filteredData, setFilteredData] = useState<WeeklyHoursOverview[]>([])
  
  // Filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [showOnlyMissed, setShowOnlyMissed] = useState(false)
  
  // Collapsible period groups
  const [expandedPeriods, setExpandedPeriods] = useState<Set<number>>(new Set())
  
  // Hours detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailRow, setDetailRow] = useState<WeeklyHoursOverview | null>(null)

  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceRow, setInvoiceRow] = useState<WeeklyHoursOverview | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [linkedInvoices, setLinkedInvoices] = useState<Invoice[]>([])
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([])
  const [allInvoicesCount, setAllInvoicesCount] = useState(0)
  const [allInvoicesPage, setAllInvoicesPage] = useState(1)
  const [invoiceTab, setInvoiceTab] = useState<'linked' | 'all' | 'new'>('linked')
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState('')
  const [pricePerHour, setPricePerHour] = useState('0')
  const [invoiceSaving, setInvoiceSaving] = useState(false)
  const [invoicesLoading, setInvoicesLoading] = useState(false)

  // Available years
  const years = Array.from({ length: 5 }, (_, i) => getCurrentYear() - i)

  // Load data
  useEffect(() => {
    loadData()
  }, [selectedYear])

  // Filter data
  useEffect(() => {
    let filtered = [...data]
    
    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      filtered = filtered.filter(row =>
        row.user_naam.toLowerCase().includes(lower) ||
        row.user_email.toLowerCase().includes(lower) ||
        row.periode.toString().includes(lower) ||
        `${row.week_start}-${row.week_eind}`.includes(lower)
      )
    }
    
    if (showOnlyMissed) {
      filtered = filtered.filter(row => row.gemiste_uren !== null && row.gemiste_uren > 0)
    }
    
    setFilteredData(filtered)
  }, [searchTerm, data, showOnlyMissed])

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await getWeeklyHoursOverview(selectedYear)
      setData(result)
      setFilteredData(result)
    } catch (err) {
      console.error('Failed to load weekly hours overview:', err)
      toast.error(t('weeklyHours.loadError'))
    } finally {
      setLoading(false)
    }
  }

  // Group data by period
  const groupedData = useMemo(() => {
    const groups = new Map<number, { periode: number; week_start: number; week_eind: number; rows: WeeklyHoursOverview[] }>()
    filteredData.forEach(row => {
      if (!groups.has(row.periode)) {
        groups.set(row.periode, { periode: row.periode, week_start: row.week_start, week_eind: row.week_eind, rows: [] })
      }
      groups.get(row.periode)!.rows.push(row)
    })
    return Array.from(groups.values()).sort((a, b) => b.periode - a.periode)
  }, [filteredData])

  const togglePeriod = (periode: number) => {
    setExpandedPeriods(prev => {
      const next = new Set(prev)
      if (next.has(periode)) next.delete(periode)
      else next.add(periode)
      return next
    })
  }

  // Invoice missed hours
  const openInvoiceModal = async (row: WeeklyHoursOverview) => {
    setInvoiceRow(row)
    setSelectedCompany('')
    setSelectedInvoice('')
    setPricePerHour('0')
    setInvoiceTab('linked')
    setAllInvoicesPage(1)
    setShowInvoiceModal(true)
    setInvoicesLoading(true)
    
    try {
      // Load linked invoices (matching user+week) and all concept invoices + companies in parallel
      const [companiesData, linkedData, allData] = await Promise.all([
        getAllCompanies(),
        getInvoices({
          status: 'concept',
          chauffeur: row.user_id,
          week_year: row.jaar,
          page_size: 10,
        }),
        getInvoices({ status: 'concept', page_size: 10, page: 1 }),
      ])
      setCompanies(companiesData)
      setLinkedInvoices(linkedData.results)
      setAllInvoices(allData.results)
      setAllInvoicesCount(allData.count)
      
      // Auto-select if exactly one linked invoice found
      if (linkedData.results.length === 1) {
        setSelectedInvoice(linkedData.results[0].id)
      } else if (linkedData.results.length === 0) {
        // No linked invoices, switch to all tab
        setInvoiceTab('all')
      }
    } catch (err) {
      console.error('Failed to load invoices:', err)
    } finally {
      setInvoicesLoading(false)
    }
  }

  // Load more all-invoices for pagination
  const loadAllInvoicesPage = async (page: number) => {
    setAllInvoicesPage(page)
    try {
      setInvoicesLoading(true)
      const data = await getInvoices({ status: 'concept', page_size: 10, page })
      setAllInvoices(data.results)
      setAllInvoicesCount(data.count)
    } catch (err) {
      console.error('Failed to load invoices page:', err)
    } finally {
      setInvoicesLoading(false)
    }
  }

  const handleInvoiceSave = async () => {
    if (!invoiceRow) return
    
    const price = parseFloat(pricePerHour)
    if (isNaN(price) || price < 0) {
      toast.error(t('weeklyHours.invalidPrice'))
      return
    }
    
    try {
      setInvoiceSaving(true)
      
      const payload: {
        user_id: string
        jaar: number
        periode: number
        prijs_per_uur: number
        invoice_id?: string
        bedrijf_id?: string
      } = {
        user_id: invoiceRow.user_id,
        jaar: invoiceRow.jaar,
        periode: invoiceRow.periode,
        prijs_per_uur: price,
      }
      
      if (invoiceTab === 'new' && selectedCompany) {
        payload.bedrijf_id = selectedCompany
      } else if (selectedInvoice) {
        payload.invoice_id = selectedInvoice
      } else {
        toast.error(invoiceTab === 'new' 
          ? t('weeklyHours.selectCompany')
          : t('weeklyHours.selectInvoice')
        )
        return
      }
      
      const result = await addMissedHoursToInvoice(payload)
      
      toast.success(
        t('weeklyHours.invoiceCreated', {
          hours: result.gemiste_uren,
          invoice: result.factuurnummer,
        })
      )
      setShowInvoiceModal(false)
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('weeklyHours.invoiceError')
      toast.error(msg)
    } finally {
      setInvoiceSaving(false)
    }
  }

  return (
    <div>
      {/* Filters */}
      <div className="card mb-6">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder={t('weeklyHours.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input pl-10 w-full"
              />
            </div>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="form-select sm:w-32"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlyMissed}
                onChange={(e) => setShowOnlyMissed(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {t('weeklyHours.showOnlyMissed')}
            </label>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="p-8 text-center">
            <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('weeklyHours.noData')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block space-y-3">
              {groupedData.map((group) => {
                const isExpanded = expandedPeriods.has(group.periode)
                const grpWorked = group.rows.reduce((s, r) => s + r.gewerkte_uren, 0)
                const grpMissed = group.rows.reduce((s, r) => s + (r.gemiste_uren || 0), 0)
                const grpKm = group.rows.reduce((s, r) => s + r.totaal_km, 0)
                return (
                  <div key={`period-${group.periode}`} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <button
                      onClick={() => togglePeriod(group.periode)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-500" /> : <ChevronRightIcon className="h-4 w-4 text-gray-500" />}
                        <span className="inline-flex items-center justify-center h-7 min-w-[2rem] px-2 rounded-full bg-primary-100 text-primary-700 font-bold text-sm">P{group.periode}</span>
                        <span className="text-sm text-gray-500">wk {group.week_start}-{group.week_eind}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{group.rows.length} chauffeurs</span>
                        <span className="font-medium text-gray-700">{grpWorked}u</span>
                        {grpMissed > 0 && <span className="font-medium text-red-600">{grpMissed}u gemist</span>}
                        <span>{grpKm} km</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('weeklyHours.period')}</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('drivers.title')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('weeklyHours.minimumHours')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('weeklyHours.workedHours')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('weeklyHours.averageHours')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('weeklyHours.missedHours')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('timeEntries.totalKm')}</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Overzicht</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{t('common.actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {group.rows.map((row) => {
                              const key = `${row.user_id}-${row.jaar}-${row.periode}`
                              const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                              const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren
                              return (
                                <tr key={key} className={`hover:bg-gray-50 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                                  <td className="px-4 py-2 whitespace-nowrap">
                                    <div className="flex flex-col items-center">
                                      <span className="inline-flex items-center justify-center h-7 min-w-[2rem] px-2 rounded-full bg-primary-100 text-primary-700 font-bold text-xs">
                                        P{row.periode}
                                      </span>
                                      <span className="text-[10px] text-gray-400 mt-0.5">
                                        {t('weeklyHours.weekRange', { start: row.week_start, end: row.week_eind })}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap">
                                    <div className="text-sm font-medium text-gray-900">{row.user_naam}</div>
                                    <div className="text-xs text-gray-500">{row.user_bedrijf}</div>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-right">
                                    <span className={`text-sm font-medium ${row.minimum_uren !== null ? '' : 'text-gray-400 italic'}`}>
                                      {row.minimum_uren !== null ? `${row.minimum_uren}u` : t('weeklyHours.notSet')}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right">
                                    <span className={`font-semibold ${belowMinimum ? 'text-red-600' : 'text-gray-900'}`}>
                                      {row.gewerkte_uren}u
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right">
                                    <span className="font-medium text-gray-700">
                                      {row.weken_met_uren > 0 ? `${(row.gewerkte_uren / row.weken_met_uren).toFixed(1)}u` : '-'}
                                    </span>
                                    <span className="text-[10px] text-gray-400 block">
                                      ({row.weken_met_uren} {row.weken_met_uren === 1 ? 'week' : 'weken'})
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right">
                                    {hasMissed ? (
                                      <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                                        <ExclamationTriangleIcon className="h-4 w-4" />
                                        {row.gemiste_uren}u
                                      </span>
                                    ) : row.minimum_uren !== null ? (
                                      <span className="text-green-600 font-medium">0u</span>
                                    ) : (
                                      <span className="text-gray-400">-</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-medium text-gray-700">
                                    {row.totaal_km} km
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-center">
                                    <button
                                      onClick={() => { setDetailRow(row); setShowDetailModal(true) }}
                                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium"
                                      title="Overzicht Uren"
                                    >
                                      <EyeIcon className="h-3.5 w-3.5" />
                                      Overzicht Uren
                                    </button>
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap text-center">
                                    {hasMissed && (
                                      <button
                                        onClick={() => openInvoiceModal(row)}
                                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors font-medium"
                                        title={t('weeklyHours.addToInvoice')}
                                      >
                                        <DocumentPlusIcon className="h-3.5 w-3.5" />
                                        {t('weeklyHours.addToInvoice')}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {groupedData.map((group) => {
                const isExpanded = expandedPeriods.has(group.periode)
                const grpWorked = group.rows.reduce((s, r) => s + r.gewerkte_uren, 0)
                const grpMissed = group.rows.reduce((s, r) => s + (r.gemiste_uren || 0), 0)
                return (
                  <div key={`mgroup-${group.periode}`}>
                    <div className="px-3 py-2.5 bg-gray-50 flex items-center gap-2 cursor-pointer active:bg-gray-100" onClick={() => togglePeriod(group.periode)}>
                      {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-500" /> : <ChevronRightIcon className="h-4 w-4 text-gray-500" />}
                      <span className="inline-flex items-center justify-center h-6 px-2 rounded-full bg-primary-100 text-primary-700 font-bold text-xs">P{group.periode}</span>
                      <span className="text-xs text-gray-500">wk {group.week_start}-{group.week_eind}</span>
                      <span className="ml-auto text-xs text-gray-400">{group.rows.length} • {grpWorked}u{grpMissed > 0 ? ` • ${grpMissed}u gemist` : ''}</span>
                    </div>
                    {isExpanded && group.rows.map((row) => {
                const key = `${row.user_id}-${row.jaar}-${row.periode}`
                const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren
                
                return (
                  <div key={key} className={`p-3 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex flex-col items-center">
                        <span className="inline-flex items-center justify-center h-10 min-w-[2.5rem] px-2 rounded-full bg-primary-100 text-primary-700 font-bold">
                          P{row.periode}
                        </span>
                        <span className="text-[10px] text-gray-400 mt-0.5">
                          wk {row.week_start}-{row.week_eind}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{row.user_naam}</p>
                        <p className="text-xs text-gray-500">{row.user_bedrijf}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-2 text-xs ml-13 mb-2">
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.minimumShort')}</span>
                        <span className="font-medium">
                          {row.minimum_uren !== null ? `${row.minimum_uren}u` : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.workedShort')}</span>
                        <span className={`font-semibold ${belowMinimum ? 'text-red-600' : ''}`}>
                          {row.gewerkte_uren}u
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.avgShort')}</span>
                        <span className="font-medium">
                          {row.weken_met_uren > 0 ? `${(row.gewerkte_uren / row.weken_met_uren).toFixed(1)}u` : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.missedShort')}</span>
                        {hasMissed ? (
                          <span className="text-red-600 font-semibold">{row.gemiste_uren}u</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={() => { setDetailRow(row); setShowDetailModal(true) }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 min-h-[44px] text-sm mt-1"
                    >
                      <EyeIcon className="h-4 w-4" />
                      Overzicht Uren
                    </button>
                    {hasMissed && (
                      <button
                        onClick={() => openInvoiceModal(row)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 min-h-[44px] text-sm mt-1"
                      >
                        <DocumentPlusIcon className="h-4 w-4" />
                        {t('weeklyHours.addToInvoice')}
                      </button>
                    )}
                  </div>
                )
                    })}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Add to Invoice Modal */}
      <Transition appear show={showInvoiceModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowInvoiceModal(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
                  <div className="flex items-center justify-between p-4 border-b">
                    <Dialog.Title className="text-lg font-semibold">
                      {t('weeklyHours.addToInvoiceTitle')}
                    </Dialog.Title>
                    <button onClick={() => setShowInvoiceModal(false)} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Summary info */}
                    {invoiceRow && (
                      <div className="bg-orange-50 rounded-lg p-3 text-sm">
                        <div className="font-medium text-orange-800 mb-1">
                          {t('weeklyHours.missedHoursSummary')}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-orange-700">
                          <div>{t('drivers.title')}: <span className="font-medium">{invoiceRow.user_naam}</span></div>
                          <div>{t('weeklyHours.period')}: <span className="font-medium">P{invoiceRow.periode} ({t('weeklyHours.weekRange', { start: invoiceRow.week_start, end: invoiceRow.week_eind })})</span></div>
                          <div>{t('weeklyHours.minimumHours')}: <span className="font-medium">{invoiceRow.minimum_uren}u</span></div>
                          <div>{t('weeklyHours.workedHours')}: <span className="font-medium">{invoiceRow.gewerkte_uren}u</span></div>
                        </div>
                        <div className="mt-2 text-orange-800 font-semibold">
                          {t('weeklyHours.missedHours')}: {invoiceRow.gemiste_uren}u
                        </div>
                      </div>
                    )}

                    {/* Tab navigation */}
                    <div className="border-b border-gray-200">
                      <nav className="-mb-px flex gap-4" aria-label="Invoice tabs">
                        <button
                          onClick={() => setInvoiceTab('linked')}
                          className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                            invoiceTab === 'linked'
                              ? 'border-primary-600 text-primary-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {t('weeklyHours.linkedInvoices')}
                          {linkedInvoices.length > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700">
                              {linkedInvoices.length}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => setInvoiceTab('all')}
                          className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                            invoiceTab === 'all'
                              ? 'border-primary-600 text-primary-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {t('weeklyHours.allInvoices')}
                          {allInvoicesCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                              {allInvoicesCount}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => setInvoiceTab('new')}
                          className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                            invoiceTab === 'new'
                              ? 'border-primary-600 text-primary-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {t('weeklyHours.newInvoice')}
                        </button>
                      </nav>
                    </div>

                    {/* Loading state */}
                    {invoicesLoading && (
                      <div className="text-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                      </div>
                    )}

                    {/* Linked invoices tab */}
                    {invoiceTab === 'linked' && !invoicesLoading && (
                      <div className="space-y-2">
                        {linkedInvoices.length === 0 ? (
                          <div className="text-center py-4 text-sm text-gray-500">
                            <p>{t('weeklyHours.noLinkedInvoices')}</p>
                            <button
                              onClick={() => setInvoiceTab('all')}
                              className="text-primary-600 hover:text-primary-700 mt-1 text-sm font-medium"
                            >
                              {t('weeklyHours.viewAllInvoices')}
                            </button>
                          </div>
                        ) : (
                          linkedInvoices.map(inv => (
                            <label
                              key={inv.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                selectedInvoice === inv.id
                                  ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name="selectedInvoice"
                                value={inv.id}
                                checked={selectedInvoice === inv.id}
                                onChange={() => setSelectedInvoice(inv.id)}
                                className="text-primary-600 focus:ring-primary-500"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{inv.factuurnummer}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                    {t('weeklyHours.linked')}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {inv.bedrijf_naam}
                                  {inv.chauffeur_naam && ` • ${inv.chauffeur_naam}`}
                                  {inv.week_number && ` • ${t('common.week')} ${inv.week_number}`}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  €{Number(inv.totaal).toFixed(2)} • {inv.lines?.length || 0} {t('weeklyHours.lines')}
                                </div>
                              </div>
                            </label>
                          ))
                        )}
                      </div>
                    )}

                    {/* All invoices tab */}
                    {invoiceTab === 'all' && !invoicesLoading && (
                      <div className="space-y-2">
                        {allInvoices.length === 0 ? (
                          <div className="text-center py-4 text-sm text-gray-500">
                            <p>{t('weeklyHours.noConceptInvoices')}</p>
                            <button
                              onClick={() => setInvoiceTab('new')}
                              className="text-primary-600 hover:text-primary-700 mt-1 text-sm font-medium"
                            >
                              {t('weeklyHours.createNewInvoice')}
                            </button>
                          </div>
                        ) : (
                          <>
                            {allInvoices.map(inv => (
                              <label
                                key={inv.id}
                                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                  selectedInvoice === inv.id
                                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="selectedInvoice"
                                  value={inv.id}
                                  checked={selectedInvoice === inv.id}
                                  onChange={() => setSelectedInvoice(inv.id)}
                                  className="text-primary-600 focus:ring-primary-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{inv.factuurnummer}</span>
                                    {inv.chauffeur === invoiceRow?.user_id && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                        {t('weeklyHours.linked')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {inv.bedrijf_naam}
                                    {inv.chauffeur_naam && ` • ${inv.chauffeur_naam}`}
                                    {inv.week_number && ` • ${t('common.week')} ${inv.week_number}`}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                    €{Number(inv.totaal).toFixed(2)} • {inv.lines?.length || 0} {t('weeklyHours.lines')}
                                  </div>
                                </div>
                              </label>
                            ))}
                            {/* Pagination */}
                            {allInvoicesCount > 10 && (
                              <div className="flex items-center justify-between pt-2 text-sm">
                                <span className="text-gray-500">
                                  {t('common.page')} {allInvoicesPage} / {Math.ceil(allInvoicesCount / 10)}
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => loadAllInvoicesPage(allInvoicesPage - 1)}
                                    disabled={allInvoicesPage <= 1}
                                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {t('common.previous')}
                                  </button>
                                  <button
                                    onClick={() => loadAllInvoicesPage(allInvoicesPage + 1)}
                                    disabled={allInvoicesPage >= Math.ceil(allInvoicesCount / 10)}
                                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {t('common.next')}
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* New invoice tab */}
                    {invoiceTab === 'new' && (
                      <div>
                        <label className="form-label">{t('invoices.company')}</label>
                        <select
                          value={selectedCompany}
                          onChange={(e) => setSelectedCompany(e.target.value)}
                          className="form-select w-full"
                        >
                          <option value="">{t('weeklyHours.selectCompanyPlaceholder')}</option>
                          {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.naam}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Price per hour */}
                    <div>
                      <label className="form-label">{t('weeklyHours.pricePerHour')}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">€</span>
                        <input
                          type="number"
                          value={pricePerHour}
                          onChange={(e) => setPricePerHour(e.target.value)}
                          className="form-input pl-8"
                          step="0.01"
                          min="0"
                        />
                      </div>
                    </div>

                    {/* Line preview */}
                    {invoiceRow && (
                      <div className="bg-gray-50 rounded-lg p-3 text-sm">
                        <div className="text-gray-500 text-xs mb-1">{t('weeklyHours.linePreview')}</div>
                        <div className="font-medium">
                          Gemiste werkuren periode {invoiceRow.periode} (week {invoiceRow.week_start}-{invoiceRow.week_eind}) - {invoiceRow.user_naam}
                        </div>
                        <div className="text-gray-600 mt-1">
                          {invoiceRow.gemiste_uren}u × €{parseFloat(pricePerHour || '0').toFixed(2)} = 
                          <span className="font-semibold text-gray-900 ml-1">
                            €{((invoiceRow.gemiste_uren || 0) * parseFloat(pricePerHour || '0')).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3 border-t flex justify-end gap-3">
                    <button onClick={() => setShowInvoiceModal(false)} className="btn-secondary">
                      {t('common.cancel')}
                    </button>
                    <button 
                      onClick={handleInvoiceSave} 
                      className="btn-primary" 
                      disabled={invoiceSaving || (invoiceTab !== 'new' && !selectedInvoice) || (invoiceTab === 'new' && !selectedCompany)}
                    >
                      {invoiceSaving ? t('common.saving') : t('weeklyHours.addToInvoice')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* Hours Detail Modal */}
      {detailRow && (
        <HoursDetailModal
          show={showDetailModal}
          onClose={() => { setShowDetailModal(false); setDetailRow(null) }}
          userId={detailRow.user_id}
          userName={detailRow.user_naam}
          jaar={detailRow.jaar}
          weekStart={detailRow.week_start}
          weekEnd={detailRow.week_eind}
          periodLabel={`P${detailRow.periode}`}
        />
      )}
    </div>
  )
}
