/**
 * Monthly Hours Overview Tab
 * Shows worked hours vs minimum hours per user per calendar month.
 * Minimum = weekly minimum × weeks in that month.
 * Allows invoicing missed hours.
 */
import { useState, useEffect, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  MagnifyingGlassIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  DocumentPlusIcon,
  XMarkIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'
import HoursDetailModal from './HoursDetailModal'
import {
  MonthlyHoursOverview,
  getMonthlyHoursOverview,
  addMissedHoursToInvoiceMonthly,
  getCurrentYear,
} from '@/api/timetracking'
import { getAllCompanies } from '@/api/companies'
import { getInvoices } from '@/api/invoices'
import { Company, Invoice } from '@/types'
import toast from 'react-hot-toast'

export default function MonthlyHoursTab() {
  const { t } = useTranslation()

  // Data state
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<MonthlyHoursOverview[]>([])
  const [filteredData, setFilteredData] = useState<MonthlyHoursOverview[]>([])

  // Filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [showOnlyMissed, setShowOnlyMissed] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  // Hours detail modal state
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailRow, setDetailRow] = useState<MonthlyHoursOverview | null>(null)

  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceRow, setInvoiceRow] = useState<MonthlyHoursOverview | null>(null)
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

  // Years
  const years = Array.from({ length: 5 }, (_, i) => getCurrentYear() - i)

  useEffect(() => {
    loadData()
  }, [selectedYear])

  useEffect(() => {
    let filtered = [...data]
    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      filtered = filtered.filter(row =>
        row.user_naam.toLowerCase().includes(lower) ||
        row.user_email.toLowerCase().includes(lower) ||
        row.maand_naam.toLowerCase().includes(lower)
      )
    }
    if (showOnlyMissed) {
      filtered = filtered.filter(row => row.gemiste_uren !== null && row.gemiste_uren > 0)
    }
    setFilteredData(filtered)
    setCurrentPage(1)
  }, [searchTerm, data, showOnlyMissed])

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await getMonthlyHoursOverview(selectedYear)
      setData(result)
      setFilteredData(result)
    } catch (err) {
      console.error('Failed to load monthly hours overview:', err)
      toast.error(t('monthlyHours.loadError'))
    } finally {
      setLoading(false)
    }
  }

  // Pagination
  const totalPages = Math.ceil(filteredData.length / pageSize)
  const paginatedData = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const openInvoiceModal = async (row: MonthlyHoursOverview) => {
    setInvoiceRow(row)
    setSelectedCompany('')
    setSelectedInvoice('')
    setPricePerHour('0')
    setInvoiceTab('linked')
    setAllInvoicesPage(1)
    setShowInvoiceModal(true)
    setInvoicesLoading(true)

    try {
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

      if (linkedData.results.length === 1) {
        setSelectedInvoice(linkedData.results[0].id)
      } else if (linkedData.results.length === 0) {
        setInvoiceTab('all')
      }
    } catch (err) {
      console.error('Failed to load invoices:', err)
    } finally {
      setInvoicesLoading(false)
    }
  }

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
      toast.error(t('monthlyHours.invalidPrice'))
      return
    }

    try {
      setInvoiceSaving(true)

      const payload: {
        user_id: string
        jaar: number
        maand: number
        prijs_per_uur: number
        invoice_id?: string
        bedrijf_id?: string
      } = {
        user_id: invoiceRow.user_id,
        jaar: invoiceRow.jaar,
        maand: invoiceRow.maand,
        prijs_per_uur: price,
      }

      if (invoiceTab === 'new' && selectedCompany) {
        payload.bedrijf_id = selectedCompany
      } else if (selectedInvoice) {
        payload.invoice_id = selectedInvoice
      } else {
        toast.error(invoiceTab === 'new'
          ? t('monthlyHours.selectCompany')
          : t('monthlyHours.selectInvoice')
        )
        return
      }

      const result = await addMissedHoursToInvoiceMonthly(payload)

      toast.success(
        t('monthlyHours.invoiceCreated', {
          hours: result.gemiste_uren,
          invoice: result.factuurnummer,
        })
      )
      setShowInvoiceModal(false)
    } catch (err: any) {
      const msg = err?.response?.data?.error || t('monthlyHours.invoiceError')
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
                placeholder={t('monthlyHours.searchPlaceholder')}
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
              {t('monthlyHours.showOnlyMissed')}
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
            <p className="text-gray-500">{t('monthlyHours.noData')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('monthlyHours.month')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('drivers.title')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('monthlyHours.minimumHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('monthlyHours.workedHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('monthlyHours.missedHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.totalKm')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Overzicht
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedData.map((row) => {
                    const key = `${row.user_id}-${row.jaar}-${row.maand}`
                    const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                    const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren

                    return (
                      <tr key={key} className={`hover:bg-gray-50 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-gray-900">{row.maand_naam}</span>
                            <span className="text-xs text-gray-400">{row.weken_in_maand} {t('monthlyHours.weeks')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.user_naam}</div>
                          <div className="text-xs text-gray-500">{row.user_bedrijf}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className={`text-sm font-medium ${row.minimum_uren !== null ? '' : 'text-gray-400 italic'}`}>
                            {row.minimum_uren !== null ? (
                              <>
                                {row.minimum_uren}u
                                <span className="text-xs text-gray-400 ml-1">
                                  ({row.minimum_uren_per_week}u/wk)
                                </span>
                              </>
                            ) : t('monthlyHours.notSet')}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                          <span className={`font-semibold ${belowMinimum ? 'text-red-600' : 'text-gray-900'}`}>
                            {row.gewerkte_uren}u
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
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
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-700">
                          {row.totaal_km} km
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <button
                            onClick={() => { setDetailRow(row); setShowDetailModal(true) }}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium"
                            title="Overzicht Uren"
                          >
                            <EyeIcon className="h-3.5 w-3.5" />
                            Overzicht Uren
                          </button>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          {hasMissed && (
                            <button
                              onClick={() => openInvoiceModal(row)}
                              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors font-medium"
                              title={t('monthlyHours.addToInvoice')}
                            >
                              <DocumentPlusIcon className="h-3.5 w-3.5" />
                              {t('monthlyHours.addToInvoice')}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {paginatedData.map((row) => {
                const key = `${row.user_id}-${row.jaar}-${row.maand}`
                const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren

                return (
                  <div key={key} className={`p-3 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex flex-col items-center min-w-[3rem]">
                        <span className="text-sm font-bold text-primary-700">{row.maand_naam.slice(0, 3)}</span>
                        <span className="text-[10px] text-gray-400">{row.weken_in_maand} wk</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{row.user_naam}</p>
                        <p className="text-xs text-gray-500">{row.user_bedrijf}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs ml-13 mb-2">
                      <div>
                        <span className="text-gray-500 block">{t('monthlyHours.minimumShort')}</span>
                        <span className="font-medium">
                          {row.minimum_uren !== null ? `${row.minimum_uren}u` : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('monthlyHours.workedShort')}</span>
                        <span className={`font-semibold ${belowMinimum ? 'text-red-600' : ''}`}>
                          {row.gewerkte_uren}u
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('monthlyHours.missedShort')}</span>
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
                        {t('monthlyHours.addToInvoice')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredData.length)} {t('common.of')} {filteredData.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('common.previous')}
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-600">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
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
                      {t('monthlyHours.addToInvoiceTitle')}
                    </Dialog.Title>
                    <button onClick={() => setShowInvoiceModal(false)} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Summary */}
                    {invoiceRow && (
                      <div className="bg-orange-50 rounded-lg p-3 text-sm">
                        <div className="font-medium text-orange-800 mb-1">
                          {t('monthlyHours.missedHoursSummary')}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-orange-700">
                          <div>{t('drivers.title')}: <span className="font-medium">{invoiceRow.user_naam}</span></div>
                          <div>{t('monthlyHours.month')}: <span className="font-medium">{invoiceRow.maand_naam} {invoiceRow.jaar}</span></div>
                          <div>{t('monthlyHours.minimumHours')}: <span className="font-medium">{invoiceRow.minimum_uren}u ({invoiceRow.weken_in_maand} {t('monthlyHours.weeks')})</span></div>
                          <div>{t('monthlyHours.workedHours')}: <span className="font-medium">{invoiceRow.gewerkte_uren}u</span></div>
                        </div>
                        <div className="mt-2 text-orange-800 font-semibold">
                          {t('monthlyHours.missedHours')}: {invoiceRow.gemiste_uren}u
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
                          {t('monthlyHours.linkedInvoices')}
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
                          {t('monthlyHours.allInvoices')}
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
                          {t('monthlyHours.newInvoice')}
                        </button>
                      </nav>
                    </div>

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
                            <p>{t('monthlyHours.noLinkedInvoices')}</p>
                            <button
                              onClick={() => setInvoiceTab('all')}
                              className="text-primary-600 hover:text-primary-700 mt-1 text-sm font-medium"
                            >
                              {t('monthlyHours.viewAllInvoices')}
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
                                    {t('monthlyHours.linked')}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {inv.bedrijf_naam}
                                  {inv.chauffeur_naam && ` • ${inv.chauffeur_naam}`}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">
                                  €{Number(inv.totaal).toFixed(2)} • {inv.lines?.length || 0} {t('monthlyHours.lines')}
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
                            <p>{t('monthlyHours.noConceptInvoices')}</p>
                            <button
                              onClick={() => setInvoiceTab('new')}
                              className="text-primary-600 hover:text-primary-700 mt-1 text-sm font-medium"
                            >
                              {t('monthlyHours.createNewInvoice')}
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
                                        {t('monthlyHours.linked')}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {inv.bedrijf_naam}
                                    {inv.chauffeur_naam && ` • ${inv.chauffeur_naam}`}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                    €{Number(inv.totaal).toFixed(2)} • {inv.lines?.length || 0} {t('monthlyHours.lines')}
                                  </div>
                                </div>
                              </label>
                            ))}
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
                          <option value="">{t('monthlyHours.selectCompanyPlaceholder')}</option>
                          {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.naam}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Price per hour */}
                    <div>
                      <label className="form-label">{t('monthlyHours.pricePerHour')}</label>
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
                        <div className="text-gray-500 text-xs mb-1">{t('monthlyHours.linePreview')}</div>
                        <div className="font-medium">
                          Gemiste werkuren {invoiceRow.maand_naam.toLowerCase()} {invoiceRow.jaar} - {invoiceRow.user_naam}
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
                      {invoiceSaving ? t('common.saving') : t('monthlyHours.addToInvoice')}
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
          maand={detailRow.maand}
          maandNaam={detailRow.maand_naam}
        />
      )}
    </div>
  )
}
