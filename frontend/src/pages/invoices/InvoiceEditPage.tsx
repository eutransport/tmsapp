/**
 * Invoice Edit Page
 * Edit existing invoice details and lines
 */
import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon, PlusIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { 
  getInvoice, 
  updateInvoice, 
  getInvoiceLines, 
  createInvoiceLine, 
  updateInvoiceLine, 
  deleteInvoiceLine,
  changeStatus 
} from '@/api/invoices'
import { Invoice, InvoiceLine } from '@/types'
import toast from 'react-hot-toast'

// Format currency
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}

export default function InvoiceEditPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const fromTask = searchParams.get('fromTask')

  const goBack = () => {
    if (fromTask) {
      navigate(`/tasks?task=${fromTask}`)
      return
    }
    navigate('/invoices')
  }
  
  // Data state
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<InvoiceLine[]>([])
  
  // Form state
  const [status, setStatus] = useState<Invoice['status']>('concept')
  const [vervaldatum, setVervaldatum] = useState('')
  const [btwPercentage, setBtwPercentage] = useState(21)
  const [opmerkingen, setOpmerkingen] = useState('')
  
  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load invoice data
  useEffect(() => {
    const loadData = async () => {
      if (!id) return
      
      try {
        const [invoiceData, linesData] = await Promise.all([
          getInvoice(id),
          getInvoiceLines(id),
        ])
        
        setInvoice(invoiceData)
        setLines(linesData)
        setStatus(invoiceData.status)
        setVervaldatum(invoiceData.vervaldatum)
        setBtwPercentage(invoiceData.btw_percentage)
        setOpmerkingen(invoiceData.opmerkingen || '')
      } catch (err) {
        setError(t('errors.loadFailed'))
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [id])

  // Calculate totals
  const calculateTotals = () => {
    let subtotaal = lines.reduce((sum, line) => sum + (Number(line.totaal) || 0), 0)
    // Creditfacturen: bedragen negatief tonen
    if (invoice?.type === 'credit') {
      subtotaal = -Math.abs(subtotaal)
    }
    const btw = subtotaal * ((Number(btwPercentage) || 0) / 100)
    const totaal = subtotaal + btw
    return { subtotaal, btw, totaal }
  }

  const { subtotaal, btw, totaal } = calculateTotals()

  // Update line locally only (called on every keystroke). Prevents cursor jumping
  // because we don't replace the input value with a server response mid-edit.
  const handleLineChange = (lineId: string, field: keyof InvoiceLine, value: any) => {
    setLines(prev => prev.map(l => {
      if (l.id !== lineId) return l
      const updated: InvoiceLine = { ...l, [field]: value }
      if (field === 'aantal' || field === 'prijs_per_eenheid') {
        const aantal = field === 'aantal' ? value : l.aantal
        const prijs = field === 'prijs_per_eenheid' ? value : l.prijs_per_eenheid
        updated.totaal = (Number(aantal) || 0) * (Number(prijs) || 0)
      }
      return updated
    }))
  }

  // Persist line on blur
  const handleLineBlur = async (lineId: string, field: keyof InvoiceLine) => {
    const line = lines.find(l => l.id === lineId)
    if (!line) return

    const updates: any = { [field]: line[field] }
    if (field === 'aantal' || field === 'prijs_per_eenheid') {
      updates.totaal = (Number(line.aantal) || 0) * (Number(line.prijs_per_eenheid) || 0)
    }

    try {
      const updatedLine = await updateInvoiceLine(lineId, updates)
      // Merge server response without clobbering any field the user is currently editing
      setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...updatedLine } : l))
    } catch (err) {
      toast.error(t('timeEntries.updateFailed'))
    }
  }

  // Delete line
  const handleDeleteLine = async (lineId: string) => {
    if (!confirm(t('invoices.deleteLineConfirm'))) return
    
    try {
      await deleteInvoiceLine(lineId)
      setLines(lines.filter(l => l.id !== lineId))
      toast.success(t('invoices.lineDeleted'))
    } catch (err) {
      toast.error(t('timeEntries.deleteFailed'))
    }
  }

  // Delete ALL lines
  const handleDeleteAllLines = async () => {
    if (lines.length === 0) return
    if (!confirm(`Weet je zeker dat je alle ${lines.length} regels wilt verwijderen?`)) return

    try {
      await Promise.all(lines.map(l => deleteInvoiceLine(l.id)))
      setLines([])
      toast.success('Alle regels verwijderd')
    } catch (err) {
      toast.error(t('timeEntries.deleteFailed'))
    }
  }

  // Add new line
  const handleAddLine = async () => {
    if (!id) return
    
    try {
      const newLine = await createInvoiceLine({
        invoice: id,
        omschrijving: t('invoices.newLine'),
        aantal: 1,
        prijs_per_eenheid: 0,
        volgorde: lines.length,
      })
      setLines([...lines, newLine])
      toast.success(t('invoices.lineAdded'))
    } catch (err) {
      toast.error(t('timeEntries.createError'))
    }
  }

  // Save invoice
  const handleSave = async () => {
    if (!id || !invoice) return
    
    setIsSaving(true)
    setError(null)

    try {
      // Update status if changed
      if (status !== invoice.status) {
        await changeStatus(id, status)
      }
      
      // Update invoice details
      await updateInvoice(id, {
        vervaldatum,
        btw_percentage: btwPercentage,
        opmerkingen: opmerkingen || undefined,
      })
      
      toast.success(t('invoices.invoiceUpdated'))
      navigate('/invoices')
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errors.saveFailed'))
      toast.error(t('errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || t('invoices.notFound')}</p>
        <button onClick={goBack} className="btn-secondary mt-4">
          {t('invoices.backToOverview')}
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={goBack}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 shrink-0"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
              {t('invoices.editInvoice')} {invoice.factuurnummer}
            </h1>
            <p className="text-sm text-gray-500 truncate">{invoice.bedrijf_naam}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:justify-end">
          {fromTask && (
            <button onClick={() => navigate(`/tasks?task=${fromTask}`)} className="btn-secondary flex-1 sm:flex-none">
              Terug naar taak
            </button>
          )}
          <button
            onClick={goBack}
            className="btn-secondary flex-1 sm:flex-none"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary flex-1 sm:flex-none"
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - lines */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h2 className="text-base sm:text-lg font-semibold">{t('invoices.lines')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    if (!confirm('Hiermee ga je naar het importscherm waar je opnieuw uren of regels kunt toevoegen aan deze factuur. De bestaande regels blijven staan totdat je daar op opslaan klikt (dan worden ze vervangen). Doorgaan?')) return
                    navigate(`/invoices/new?reimport=${id}`)
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-2.5 text-xs sm:text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                  title="Open importscherm om uren of regels opnieuw te importeren"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  <span className="hidden xs:inline">Opnieuw importeren</span>
                  <span className="xs:hidden">Import</span>
                </button>
                {lines.length > 0 && (
                  <button
                    onClick={handleDeleteAllLines}
                    className="inline-flex items-center gap-1.5 h-9 px-2.5 text-xs sm:text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    title="Verwijder alle regels"
                  >
                    <TrashIcon className="h-4 w-4" />
                    <span className="hidden xs:inline">Alles verwijderen</span>
                    <span className="xs:hidden">Alles</span>
                  </button>
                )}
                <button
                  onClick={handleAddLine}
                  className="inline-flex items-center gap-1.5 h-9 px-2.5 text-xs sm:text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                >
                  <PlusIcon className="h-4 w-4" />
                  {t('invoices.addLine')}
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('invoices.noLines')}</p>
            ) : (
              <>
                {/* Mobile: card per line */}
                <div className="sm:hidden space-y-3">
                  {lines.map((line, idx) => (
                    <div key={line.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-500">Regel {idx + 1}</span>
                        <button
                          onClick={() => handleDeleteLine(line.id)}
                          className="text-red-500 hover:text-red-700 p-1.5 -mr-1 rounded-md hover:bg-red-50"
                          aria-label="Verwijder regel"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">
                            {t('invoices.lineDescription')}
                          </label>
                          <input
                            type="text"
                            value={line.omschrijving}
                            onChange={(e) => handleLineChange(line.id, 'omschrijving', e.target.value)}
                            onBlur={() => handleLineBlur(line.id, 'omschrijving')}
                            className="w-full text-sm px-2 py-1.5 bg-white"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">
                              {t('common.quantity')}
                            </label>
                            <input
                              type="number"
                              value={line.aantal}
                              onChange={(e) => handleLineChange(line.id, 'aantal', parseFloat(e.target.value) || 0)}
                              onBlur={() => handleLineBlur(line.id, 'aantal')}
                              className="w-full text-sm text-right px-2 py-1.5 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">
                              {t('common.price')}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={line.prijs_per_eenheid}
                              onChange={(e) => handleLineChange(line.id, 'prijs_per_eenheid', parseFloat(e.target.value) || 0)}
                              onBlur={() => handleLineBlur(line.id, 'prijs_per_eenheid')}
                              className="w-full text-sm text-right px-2 py-1.5 bg-white"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                          <span className="text-xs font-medium text-gray-500">{t('common.total')}</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {formatCurrency(line.totaal || line.aantal * line.prijs_per_eenheid)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-gray-500">{t('invoices.lineDescription')}</th>
                        <th className="text-right py-2 text-sm font-medium text-gray-500 w-24">{t('common.quantity')}</th>
                        <th className="text-right py-2 text-sm font-medium text-gray-500 w-32">{t('common.price')}</th>
                        <th className="text-right py-2 text-sm font-medium text-gray-500 w-32">{t('common.total')}</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(line => (
                        <tr key={line.id} className="border-b">
                          <td className="py-2">
                            <input
                              type="text"
                              value={line.omschrijving}
                              onChange={(e) => handleLineChange(line.id, 'omschrijving', e.target.value)}
                              onBlur={() => handleLineBlur(line.id, 'omschrijving')}
                              className="w-full border-0 bg-transparent focus:ring-0 p-0"
                            />
                          </td>
                          <td className="py-2">
                            <input
                              type="number"
                              value={line.aantal}
                              onChange={(e) => handleLineChange(line.id, 'aantal', parseFloat(e.target.value) || 0)}
                              onBlur={() => handleLineBlur(line.id, 'aantal')}
                              className="w-full text-right border-0 bg-transparent focus:ring-0 p-0"
                            />
                          </td>
                          <td className="py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={line.prijs_per_eenheid}
                              onChange={(e) => handleLineChange(line.id, 'prijs_per_eenheid', parseFloat(e.target.value) || 0)}
                              onBlur={() => handleLineBlur(line.id, 'prijs_per_eenheid')}
                              className="w-full text-right border-0 bg-transparent focus:ring-0 p-0"
                            />
                          </td>
                          <td className="py-2 text-right font-medium">
                            {formatCurrency(line.totaal || line.aantal * line.prijs_per_eenheid)}
                          </td>
                          <td className="py-2">
                            <button
                              onClick={() => handleDeleteLine(line.id)}
                              className="text-red-500 hover:text-red-700 p-1"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Totals */}
            <div className="border-t mt-4 pt-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('invoices.subtotal')}:</span>
                    <span>{formatCurrency(subtotaal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('invoices.vat')} ({btwPercentage}%):</span>
                    <span>{formatCurrency(btw)}</span>
                  </div>
                  <div className="flex justify-between font-medium text-lg border-t pt-2">
                    <span>{t('common.total')}:</span>
                    <span>{formatCurrency(totaal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - invoice details */}
        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">{t('invoices.invoiceDetails')}</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.status')}
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Invoice['status'])}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="concept">{t('invoices.draft')}</option>
                  <option value="definitief">{t('invoices.definitive')}</option>
                  <option value="verzonden">{t('invoices.sent')}</option>
                  <option value="betaald">{t('invoices.paid')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('invoices.invoiceNumber')}
                </label>
                <input
                  type="text"
                  value={invoice.factuurnummer}
                  disabled
                  className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('invoices.invoiceDate')}
                </label>
                <input
                  type="date"
                  value={invoice.factuurdatum}
                  disabled
                  className="w-full border rounded-lg px-3 py-2 bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('invoices.dueDate')}
                </label>
                <input
                  type="date"
                  value={vervaldatum}
                  onChange={(e) => setVervaldatum(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('invoices.vatRate')}
                </label>
                <input
                  type="number"
                  value={btwPercentage}
                  onChange={(e) => setBtwPercentage(parseFloat(e.target.value) || 0)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.notes')}
                </label>
                <textarea
                  value={opmerkingen}
                  onChange={(e) => setOpmerkingen(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder={t('invoices.optionalNotes')}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
