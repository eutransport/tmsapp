/**
 * Weekly Hours Overview Tab
 * Shows worked hours vs minimum hours per user per week.
 * Allows setting minimum hours and importing missed hours to invoices.
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
  PencilIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import {
  WeeklyHoursOverview,
  getWeeklyHoursOverview,
  setMinimumHours,
  setMinimumHoursBulk,
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
  
  // Edit minimum hours state
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [editMinValue, setEditMinValue] = useState('')
  
  // Bulk set minimum hours state
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkUser, setBulkUser] = useState<{ id: string; naam: string } | null>(null)
  const [bulkMinHours, setBulkMinHours] = useState('40')
  const [bulkSaving, setBulkSaving] = useState(false)
  
  // Invoice modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceRow, setInvoiceRow] = useState<WeeklyHoursOverview | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceMode, setInvoiceMode] = useState<'new' | 'existing'>('new')
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState('')
  const [pricePerHour, setPricePerHour] = useState('0')
  const [invoiceSaving, setInvoiceSaving] = useState(false)

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
        row.weeknummer.toString().includes(lower)
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

  // Edit minimum hours inline
  const startEdit = (row: WeeklyHoursOverview) => {
    const key = `${row.user_id}-${row.jaar}-${row.weeknummer}`
    setEditingRow(key)
    setEditMinValue(row.minimum_uren?.toString() || '40')
  }

  const saveMinHours = async (row: WeeklyHoursOverview) => {
    const value = parseFloat(editMinValue)
    if (isNaN(value) || value < 0) {
      toast.error(t('weeklyHours.invalidMinHours'))
      return
    }
    
    try {
      await setMinimumHours({
        user_id: row.user_id,
        jaar: row.jaar,
        weeknummer: row.weeknummer,
        minimum_uren: value,
      })
      setEditingRow(null)
      toast.success(t('weeklyHours.minHoursUpdated'))
      await loadData()
    } catch (err) {
      console.error('Failed to set minimum hours:', err)
      toast.error(t('weeklyHours.minHoursError'))
    }
  }

  const cancelEdit = () => {
    setEditingRow(null)
    setEditMinValue('')
  }

  const handleBulkSave = async () => {
    if (!bulkUser) return
    const value = parseFloat(bulkMinHours)
    if (isNaN(value) || value < 0) {
      toast.error(t('weeklyHours.invalidMinHours'))
      return
    }
    
    try {
      setBulkSaving(true)
      const result = await setMinimumHoursBulk({
        user_id: bulkUser.id,
        jaar: selectedYear,
        minimum_uren: value,
      })
      toast.success(t('weeklyHours.bulkMinHoursUpdated', { count: result.total_weeks }))
      setShowBulkModal(false)
      await loadData()
    } catch (err) {
      console.error('Failed to bulk set minimum hours:', err)
      toast.error(t('weeklyHours.minHoursError'))
    } finally {
      setBulkSaving(false)
    }
  }

  // Invoice missed hours
  const openInvoiceModal = async (row: WeeklyHoursOverview) => {
    setInvoiceRow(row)
    setInvoiceMode('existing')
    setSelectedCompany('')
    setSelectedInvoice('')
    setPricePerHour('0')
    setShowInvoiceModal(true)
    
    // Load companies and concept invoices
    try {
      const [companiesData, invoicesData] = await Promise.all([
        getAllCompanies(),
        getInvoices({ status: 'concept', page_size: 100 }),
      ])
      setCompanies(companiesData)
      setInvoices(invoicesData.results)
    } catch (err) {
      console.error('Failed to load companies/invoices:', err)
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
        weeknummer: number
        prijs_per_uur: number
        invoice_id?: string
        bedrijf_id?: string
      } = {
        user_id: invoiceRow.user_id,
        jaar: invoiceRow.jaar,
        weeknummer: invoiceRow.weeknummer,
        prijs_per_uur: price,
      }
      
      if (invoiceMode === 'existing' && selectedInvoice) {
        payload.invoice_id = selectedInvoice
      } else if (invoiceMode === 'new' && selectedCompany) {
        payload.bedrijf_id = selectedCompany
      } else {
        toast.error(invoiceMode === 'new' 
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

  // Group by user for summary
  const uniqueUsers = [...new Map(data.map(r => [r.user_id, { id: r.user_id, naam: r.user_naam }])).values()]

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
          
          {/* Bulk set buttons per user */}
          {uniqueUsers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-xs text-gray-500 self-center">{t('weeklyHours.bulkSetFor')}:</span>
              {uniqueUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => {
                    setBulkUser(u)
                    setBulkMinHours('40')
                    setShowBulkModal(true)
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
                >
                  {u.naam}
                </button>
              ))}
            </div>
          )}
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
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.week')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('drivers.title')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('weeklyHours.minimumHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('weeklyHours.workedHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('weeklyHours.missedHours')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('timeEntries.totalKm')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredData.map((row) => {
                    const key = `${row.user_id}-${row.jaar}-${row.weeknummer}`
                    const isEditing = editingRow === key
                    const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                    const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren
                    
                    return (
                      <tr key={key} className={`hover:bg-gray-50 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                            {row.weeknummer}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.user_naam}</div>
                          <div className="text-xs text-gray-500">{row.user_bedrijf}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                value={editMinValue}
                                onChange={(e) => setEditMinValue(e.target.value)}
                                className="form-input w-20 text-sm text-right py-1"
                                step="0.5"
                                min="0"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveMinHours(row)
                                  if (e.key === 'Escape') cancelEdit()
                                }}
                              />
                              <button
                                onClick={() => saveMinHours(row)}
                                className="p-1 text-green-600 hover:text-green-800"
                                title={t('common.save')}
                              >
                                <CheckIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="p-1 text-gray-400 hover:text-gray-600"
                                title={t('common.cancel')}
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <span className={`text-sm font-medium ${row.minimum_uren !== null ? '' : 'text-gray-400 italic'}`}>
                                {row.minimum_uren !== null ? `${row.minimum_uren}u` : t('weeklyHours.notSet')}
                              </span>
                              <button
                                onClick={() => startEdit(row)}
                                className="p-1 text-gray-400 hover:text-primary-600"
                                title={t('weeklyHours.editMinHours')}
                              >
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
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

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {filteredData.map((row) => {
                const key = `${row.user_id}-${row.jaar}-${row.weeknummer}`
                const hasMissed = row.gemiste_uren !== null && row.gemiste_uren > 0
                const belowMinimum = row.minimum_uren !== null && row.gewerkte_uren < row.minimum_uren
                
                return (
                  <div key={key} className={`p-3 ${hasMissed ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary-100 text-primary-700 font-bold">
                        {row.weeknummer}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{row.user_naam}</p>
                        <p className="text-xs text-gray-500">{row.user_bedrijf}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-xs ml-13 mb-2">
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.minimumShort')}</span>
                        <span className="font-medium">
                          {row.minimum_uren !== null ? `${row.minimum_uren}u` : '-'}
                        </span>
                        <button
                          onClick={() => startEdit(row)}
                          className="ml-1 text-gray-400 hover:text-primary-600"
                        >
                          <PencilIcon className="h-3 w-3 inline" />
                        </button>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('weeklyHours.workedShort')}</span>
                        <span className={`font-semibold ${belowMinimum ? 'text-red-600' : ''}`}>
                          {row.gewerkte_uren}u
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
          </>
        )}
      </div>

      {/* Bulk Set Minimum Hours Modal */}
      <Transition appear show={showBulkModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowBulkModal(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100" leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-lg bg-white shadow-xl transition-all">
                  <div className="flex items-center justify-between p-4 border-b">
                    <Dialog.Title className="text-lg font-semibold">
                      {t('weeklyHours.bulkSetTitle')}
                    </Dialog.Title>
                    <button onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-gray-500">
                      <XMarkIcon className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    <p className="text-sm text-gray-600">
                      {t('weeklyHours.bulkSetDescription', { name: bulkUser?.naam, year: selectedYear })}
                    </p>
                    <div>
                      <label className="form-label">{t('weeklyHours.minimumHoursPerWeek')}</label>
                      <input
                        type="number"
                        value={bulkMinHours}
                        onChange={(e) => setBulkMinHours(e.target.value)}
                        className="form-input"
                        step="0.5"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="px-4 py-3 border-t flex justify-end gap-3">
                    <button onClick={() => setShowBulkModal(false)} className="btn-secondary">
                      {t('common.cancel')}
                    </button>
                    <button onClick={handleBulkSave} className="btn-primary" disabled={bulkSaving}>
                      {bulkSaving ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

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
                          <div>{t('common.week')}: <span className="font-medium">{invoiceRow.weeknummer} ({invoiceRow.jaar})</span></div>
                          <div>{t('weeklyHours.minimumHours')}: <span className="font-medium">{invoiceRow.minimum_uren}u</span></div>
                          <div>{t('weeklyHours.workedHours')}: <span className="font-medium">{invoiceRow.gewerkte_uren}u</span></div>
                        </div>
                        <div className="mt-2 text-orange-800 font-semibold">
                          {t('weeklyHours.missedHours')}: {invoiceRow.gemiste_uren}u
                        </div>
                      </div>
                    )}

                    {/* Mode selection */}
                    <div>
                      <label className="form-label">{t('weeklyHours.invoiceTarget')}</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="invoiceMode"
                            value="new"
                            checked={invoiceMode === 'new'}
                            onChange={() => setInvoiceMode('new')}
                            className="text-primary-600 focus:ring-primary-500"
                          />
                          {t('weeklyHours.newInvoice')}
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="invoiceMode"
                            value="existing"
                            checked={invoiceMode === 'existing'}
                            onChange={() => setInvoiceMode('existing')}
                            className="text-primary-600 focus:ring-primary-500"
                          />
                          {t('weeklyHours.existingInvoice')}
                        </label>
                      </div>
                    </div>

                    {/* New invoice: company selector */}
                    {invoiceMode === 'new' && (
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

                    {/* Existing invoice selector */}
                    {invoiceMode === 'existing' && (
                      <div>
                        <label className="form-label">{t('weeklyHours.selectInvoiceLabel')}</label>
                        <select
                          value={selectedInvoice}
                          onChange={(e) => setSelectedInvoice(e.target.value)}
                          className="form-select w-full"
                        >
                          <option value="">{t('weeklyHours.selectInvoicePlaceholder')}</option>
                          {invoices.map(inv => (
                            <option key={inv.id} value={inv.id}>
                              {inv.factuurnummer} - {inv.bedrijf_naam}
                            </option>
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
                          Gemiste werkuren week {invoiceRow.weeknummer} - {invoiceRow.user_naam}
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
                    <button onClick={handleInvoiceSave} className="btn-primary" disabled={invoiceSaving}>
                      {invoiceSaving ? t('common.saving') : t('weeklyHours.addToInvoice')}
                    </button>
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
