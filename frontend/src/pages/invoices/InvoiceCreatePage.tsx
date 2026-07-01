/**
 * Invoice Create Page
 * Full-page invoice creation with:
 * - Template selection
 * - Dynamic line items based on template columns
 * - Automatic calculations based on template formulas
 * - Import time entries by week
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  ClockIcon,
  CalculatorIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline'
import { getTemplates, createInvoice, createInvoiceLine, getNextInvoiceNumber, getInvoice, getInvoiceLines, updateInvoice, deleteInvoiceLine } from '@/api/invoices'
import { getCompanies } from '@/api/companies'
import { getMijnAdministraties, Administratie } from '@/api/administraties'
import { getTimeEntries, markKilometerheffingGefactureerd } from '@/api/timetracking'
import { getSpreadsheets } from '@/api/spreadsheets'
import { getImportedEntries, ImportedTimeEntry } from '@/api/urenImport'
import { getTolRegistraties, markTolGefactureerd, TolRegistratie } from '@/api/tolregistratie'
import { 
  InvoiceTemplate, 
  Company, 
  TimeEntry,
  Spreadsheet,
  TemplateLayout,
  TemplateColumn 
} from '@/types'

// ============================================
// Types
// ============================================

const SINGLE_INVOICE_TARGET = '__single__'

interface InvoiceLineData {
  id: string // Local temp id
  values: Record<string, number | string> // Column values by column id
  timeEntryId?: string // If imported from time entry
  isInfoLine?: boolean // Info-only line (e.g. werktijden): no aantal/prijs/totaal rendered
  kilometerheffingTimeEntryId?: string // If this line represents a kilometerheffing for a TimeEntry
}

interface ChauffeurWeekGroup {
  key: string // "jaar-weeknummer-userId"
  weeknummer: number
  jaar: number
  userId: string
  chauffeurNaam: string
  bedrijfNaam: string
  entries: TimeEntry[]
  selected: boolean
}

interface ImportedChauffeurWeekGroup {
  key: string
  weeknummer: number
  jaar: number
  userId: string
  chauffeurNaam: string
  entries: ImportedTimeEntry[]
  selected: boolean
}

type ImportMode = 'single' | 'perWeek'

interface BatchInvoiceDraft {
  id: string
  factuurnummer: string
  weekNumber: number | null
  weekYear: number | null
  chauffeur: string | null
  chauffeurNaam: string | null
  lines: InvoiceLineData[]
}

// ============================================
// Helper Functions
// ============================================

// Safe math expression parser (no eval!)
function safeMathEval(expression: string): number {
  // Tokenize the expression
  const tokens = expression.match(/(\d+\.?\d*|\+|\-|\*|\/|\(|\))/g)
  if (!tokens || tokens.length === 0) return 0
  
  let pos = 0
  
  function parseExpression(): number {
    let result = parseTerm()
    while (pos < tokens!.length && (tokens![pos] === '+' || tokens![pos] === '-')) {
      const op = tokens![pos++]
      const term = parseTerm()
      result = op === '+' ? result + term : result - term
    }
    return result
  }
  
  function parseTerm(): number {
    let result = parseFactor()
    while (pos < tokens!.length && (tokens![pos] === '*' || tokens![pos] === '/')) {
      const op = tokens![pos++]
      const factor = parseFactor()
      result = op === '*' ? result * factor : result / factor
    }
    return result
  }
  
  function parseFactor(): number {
    if (tokens![pos] === '(') {
      pos++ // skip '('
      const result = parseExpression()
      pos++ // skip ')'
      return result
    }
    if (tokens![pos] === '-') {
      pos++
      return -parseFactor()
    }
    return parseFloat(tokens![pos++]) || 0
  }
  
  try {
    return parseExpression()
  } catch {
    return 0
  }
}

// Parse and evaluate formula with column values
function evaluateFormula(formula: string, values: Record<string, number | string>, defaults: TemplateLayout['defaults']): number {
  if (!formula) return 0
  
  try {
    // Replace column references with values
    let expression = formula.toLowerCase()
    
    // Replace default values
    expression = expression.replace(/uurtarief/g, defaults.uurtarief.toString())
    expression = expression.replace(/kmtarief/g, defaults.kmTarief.toString())
    expression = expression.replace(/dotprijs/g, defaults.dotPrijs.toString())
    
    // Replace column values
    Object.entries(values).forEach(([key, val]) => {
      const numVal = typeof val === 'number' ? val : parseFloat(val as string) || 0
      expression = expression.replace(new RegExp(key.toLowerCase(), 'g'), numVal.toString())
    })
    
    // Evaluate using safe math parser (no eval!)
    if (/^[\d\s+\-*/().]+$/.test(expression)) {
      const result = safeMathEval(expression) || 0
      // Rond af op maximaal 2 decimalen (voorkomt floating-point staarten zoals 801.5999999999999)
      return Math.round(result * 100) / 100
    }
    return 0
  } catch {
    return 0
  }
}

// Generate unique id
function generateId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Format currency
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(value)
}

// Rond een hoeveelheid (uren/aantal) af op maximaal 2 decimalen
function roundUren(n: number): number {
  if (!isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

// Toon een celwaarde met maximaal 2 decimalen (getallen), strings blijven ongewijzigd
function formatCellValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!isFinite(value)) return ''
    return String(Math.round(value * 100) / 100)
  }
  return String(value)
}

function incrementInvoiceNumber(baseNumber: string, offset: number): string {
  if (offset <= 0) return baseNumber
  const match = baseNumber.match(/^(.*?)(\d+)$/)
  if (!match) return `${baseNumber}-${offset + 1}`
  const [, prefix, numericPart] = match
  const nextNumber = String(parseInt(numericPart, 10) + offset).padStart(numericPart.length, '0')
  return `${prefix}${nextNumber}`
}

// ============================================
// Components
// ============================================

// Template Selector Card
function TemplateCard({ 
  template, 
  selected, 
  onSelect 
}: { 
  template: InvoiceTemplate
  selected: boolean
  onSelect: () => void 
}) {
  return (
    <div
      onClick={onSelect}
      className={`
        border-2 rounded-lg p-4 cursor-pointer transition-all
        ${selected 
          ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200' 
          : 'border-gray-200 hover:border-gray-300 bg-white'}
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{template.naam}</h3>
          {template.beschrijving && (
            <p className="text-sm text-gray-500 mt-1">{template.beschrijving}</p>
          )}
        </div>
        {selected && (
          <CheckCircleIcon className="h-6 w-6 text-primary-500 flex-shrink-0" />
        )}
      </div>
      {template.layout && (
        <div className="mt-3 text-xs text-gray-400">
          {(template.layout as TemplateLayout).columns?.length || 0} kolommen
        </div>
      )}
    </div>
  )
}

// Invoice Line Row with editable columns
function InvoiceLineRow({
  line,
  columns,
  defaults,
  onUpdate,
  onDelete,
}: {
  line: InvoiceLineData
  columns: TemplateColumn[]
  defaults: TemplateLayout['defaults']
  onUpdate: (lineId: string, values: Record<string, number | string>) => void
  onDelete: (lineId: string) => void
}) {
  const handleValueChange = (columnId: string, value: string) => {
    const newValues = { ...line.values }
    
    // Find column type
    const column = columns.find(c => c.id === columnId)
    if (column?.type === 'text') {
      newValues[columnId] = value
    } else {
      newValues[columnId] = parseFloat(value) || 0
    }
    
    // Recalculate computed columns
    columns.forEach(col => {
      if (col.type === 'berekend' && col.formule) {
        newValues[col.id] = evaluateFormula(col.formule, newValues, defaults)
      }
    })
    
    onUpdate(line.id, newValues)
  }

  return (
    <tr className="hover:bg-gray-50">
      {columns.map((col) => (
        <td key={col.id} className="px-3 py-2" style={{ width: `${col.breedte}%` }}>
          {col.type === 'berekend' ? (
            // Computed field - read only
            <span className="font-medium text-gray-900">
              {formatCurrency(line.values[col.id] as number || 0)}
            </span>
          ) : col.type === 'text' ? (
            <input
              type="text"
              value={line.values[col.id] || ''}
              onChange={(e) => handleValueChange(col.id, e.target.value)}
              className="w-full border-0 bg-transparent focus:ring-2 focus:ring-primary-500 rounded px-2 py-1 text-sm"
              placeholder={col.naam}
            />
          ) : col.type === 'prijs' ? (
            <div className="flex items-center">
              <span className="text-gray-400 mr-1">€</span>
              <input
                type="number"
                step="0.01"
                value={line.values[col.id] || ''}
                onChange={(e) => handleValueChange(col.id, e.target.value)}
                className="w-full border-0 bg-transparent focus:ring-2 focus:ring-primary-500 rounded px-2 py-1 text-sm text-right"
                placeholder="0.00"
              />
            </div>
          ) : (
            <input
              type="number"
              step={col.type === 'km' ? '1' : col.type === 'uren' ? '0.25' : '0.01'}
              value={line.values[col.id] || ''}
              onChange={(e) => handleValueChange(col.id, e.target.value)}
              className="w-full border-0 bg-transparent focus:ring-2 focus:ring-primary-500 rounded px-2 py-1 text-sm text-right"
              placeholder="0"
            />
          )}
        </td>
      ))}
      <td className="px-2 py-2 w-10">
        <button
          type="button"
          onClick={() => onDelete(line.id)}
          className="p-1 text-gray-400 hover:text-red-500"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

// Invoice Line Card - mobile/responsive version of InvoiceLineRow
function InvoiceLineCard({
  line,
  index,
  columns,
  defaults,
  onUpdate,
  onDelete,
}: {
  line: InvoiceLineData
  index: number
  columns: TemplateColumn[]
  defaults: TemplateLayout['defaults']
  onUpdate: (lineId: string, values: Record<string, number | string>) => void
  onDelete: (lineId: string) => void
}) {
  const handleValueChange = (columnId: string, value: string) => {
    const newValues = { ...line.values }

    const column = columns.find(c => c.id === columnId)
    if (column?.type === 'text') {
      newValues[columnId] = value
    } else {
      newValues[columnId] = parseFloat(value) || 0
    }

    columns.forEach(col => {
      if (col.type === 'berekend' && col.formule) {
        newValues[col.id] = evaluateFormula(col.formule, newValues, defaults)
      }
    })

    onUpdate(line.id, newValues)
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Regel {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onDelete(line.id)}
          className="p-1 text-gray-400 hover:text-red-500"
          aria-label="Verwijder regel"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">
        {columns.map((col) => (
          <div key={col.id} className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1">
              {col.naam}
              {col.type === 'berekend' && (
                <span className="ml-1 text-xs font-normal text-gray-400">(auto)</span>
              )}
            </label>
            {col.type === 'berekend' ? (
              <span className="font-medium text-gray-900 px-2 py-1 bg-gray-50 rounded">
                {formatCurrency(line.values[col.id] as number || 0)}
              </span>
            ) : col.type === 'text' ? (
              <input
                type="text"
                value={line.values[col.id] || ''}
                onChange={(e) => handleValueChange(col.id, e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                placeholder={col.naam}
              />
            ) : col.type === 'prijs' ? (
              <div className="flex items-center">
                <span className="text-gray-400 mr-1">€</span>
                <input
                  type="number"
                  step="0.01"
                  value={line.values[col.id] ? formatCellValue(line.values[col.id]) : ''}
                  onChange={(e) => handleValueChange(col.id, e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm text-right"
                  placeholder="0.00"
                />
              </div>
            ) : (
              <input
                type="number"
                step={col.type === 'km' ? '1' : col.type === 'uren' ? '0.25' : '0.01'}
                value={line.values[col.id] ? formatCellValue(line.values[col.id]) : ''}
                onChange={(e) => handleValueChange(col.id, e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm text-right"
                placeholder="0"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Time Entry Import Modal - Shows entries grouped by week + chauffeur + bedrijf
function TimeEntryImportModal({
  isOpen,
  onClose,
  onImport,
  onImportImported,
  showWorkTimes,
  setShowWorkTimes,
}: {
  isOpen: boolean
  onClose: () => void
  onImport: (entries: TimeEntry[], mode: ImportMode) => void
  onImportImported: (entries: ImportedTimeEntry[], chauffeurEntries: TimeEntry[], mode: ImportMode) => void
  showWorkTimes: boolean
  setShowWorkTimes: (v: boolean) => void
}) {
  const [activeTab, setActiveTab] = useState<'chauffeur' | 'imported'>('chauffeur')
  const { t } = useTranslation()
  // Chauffeur tab state
  const [chauffeurGroups, setChauffeurGroups] = useState<ChauffeurWeekGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<string>('') // '' = alle weken
  const itemsPerPage = 20

  // Imported tab state
  const [importedGroups, setImportedGroups] = useState<ImportedChauffeurWeekGroup[]>([])
  const [chauffeurEntriesForMatch, setChauffeurEntriesForMatch] = useState<TimeEntry[]>([])
  const [isLoadingImported, setIsLoadingImported] = useState(false)
  const [importedPage, setImportedPage] = useState(1)
  const [expandedImportedGroup, setExpandedImportedGroup] = useState<string | null>(null)
  const [importedWeekFilter, setImportedWeekFilter] = useState<string>('')
  const [importMode, setImportMode] = useState<ImportMode>('single')

  useEffect(() => {
    if (isOpen) {
      loadTimeEntries()
      loadImportedEntries()
      setCurrentPage(1)
      setImportedPage(1)
      setWeekFilter('')
      setImportedWeekFilter('')
      setActiveTab('chauffeur')
      setImportMode('single')
    }
  }, [isOpen])

  const loadTimeEntries = async () => {
    setIsLoading(true)
    try {
      // Get all submitted time entries (admin sees all)
      const response = await getTimeEntries({
        status: 'ingediend',
        page_size: 1000,
        ordering: '-datum',
      })
      
      // Group by week + chauffeur
      const groups: Record<string, ChauffeurWeekGroup> = {}
      
      response.results.forEach((entry) => {
        const jaar = new Date(entry.datum).getFullYear()
        const key = `${jaar}-${entry.weeknummer}-${entry.user}`
        
        if (!groups[key]) {
          groups[key] = {
            key,
            weeknummer: entry.weeknummer,
            jaar: jaar,
            userId: entry.user,
            chauffeurNaam: entry.user_naam || 'Onbekend',
            bedrijfNaam: entry.user_bedrijf || '-',
            entries: [],
            selected: false,
          }
        }
        groups[key].entries.push(entry)
      })
      
      // Sort by year desc, week desc, chauffeur name asc
      const sortedGroups = Object.values(groups).sort((a, b) => {
        if (a.jaar !== b.jaar) return b.jaar - a.jaar
        if (a.weeknummer !== b.weeknummer) return b.weeknummer - a.weeknummer
        return a.chauffeurNaam.localeCompare(b.chauffeurNaam)
      })
      
      setChauffeurGroups(sortedGroups)
    } catch (err) {
      console.error('Failed to load time entries:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadImportedEntries = async () => {
    setIsLoadingImported(true)
    try {
      // Load imported entries and chauffeur entries in parallel
      const [importedData, chauffeurData] = await Promise.all([
        getImportedEntries(),
        getTimeEntries({ status: 'ingediend', page_size: 1000, ordering: '-datum' }),
      ])

      setChauffeurEntriesForMatch(chauffeurData.results)

      // Group imported entries by week + chauffeur
      const groups: Record<string, ImportedChauffeurWeekGroup> = {}
      importedData.forEach((entry) => {
        const key = `imp-${entry.weeknummer}-${entry.user}`
        if (!groups[key]) {
          groups[key] = {
            key,
            weeknummer: entry.weeknummer,
            jaar: new Date(entry.datum).getFullYear(),
            userId: entry.user || '',
            chauffeurNaam: entry.user_naam || 'Onbekend',
            entries: [],
            selected: false,
          }
        }
        groups[key].entries.push(entry)
      })

      const sortedGroups = Object.values(groups).sort((a, b) => {
        if (a.jaar !== b.jaar) return b.jaar - a.jaar
        if (a.weeknummer !== b.weeknummer) return b.weeknummer - a.weeknummer
        return a.chauffeurNaam.localeCompare(b.chauffeurNaam)
      })

      setImportedGroups(sortedGroups)
    } catch (err) {
      console.error('Failed to load imported entries:', err)
    } finally {
      setIsLoadingImported(false)
    }
  }

  const toggleSelection = (key: string) => {
    setChauffeurGroups(prev => prev.map(g => 
      g.key === key ? { ...g, selected: !g.selected } : g
    ))
  }

  const toggleImportedSelection = (key: string) => {
    setImportedGroups(prev => prev.map(g =>
      g.key === key ? { ...g, selected: !g.selected } : g
    ))
  }

  const toggleExpand = (key: string) => {
    setExpandedGroup(prev => prev === key ? null : key)
  }

  const toggleImportedExpand = (key: string) => {
    setExpandedImportedGroup(prev => prev === key ? null : key)
  }

  const handleImport = () => {
    const entriesToImport: TimeEntry[] = []
    chauffeurGroups.forEach(group => {
      if (group.selected) {
        entriesToImport.push(...group.entries)
      }
    })
    const selectedGroupCount = chauffeurGroups.filter(group => group.selected).length
    const mode: ImportMode = selectedGroupCount > 1 ? importMode : 'single'
    onImport(entriesToImport, mode)
    onClose()
  }

  const handleImportImported = () => {
    const entriesToImport: ImportedTimeEntry[] = []
    importedGroups.forEach(group => {
      if (group.selected) {
        entriesToImport.push(...group.entries)
      }
    })
    const selectedGroupCount = importedGroups.filter(group => group.selected).length
    const mode: ImportMode = selectedGroupCount > 1 ? importMode : 'single'
    onImportImported(entriesToImport, chauffeurEntriesForMatch, mode)
    onClose()
  }

  // Get unique weeks for filter dropdown
  const availableWeeks = [...new Set(chauffeurGroups.map(g => `${g.jaar}-W${g.weeknummer}`))]
    .sort((a, b) => b.localeCompare(a)) // Sort descending

  // Filter groups by selected week
  const filteredGroups = weekFilter 
    ? chauffeurGroups.filter(g => `${g.jaar}-W${g.weeknummer}` === weekFilter)
    : chauffeurGroups

  const selectedCount = filteredGroups.filter(g => g.selected).length
  const totalEntries = filteredGroups
    .filter(g => g.selected)
    .reduce((sum, g) => sum + g.entries.length, 0)

  // Imported tab filtering & pagination
  const availableImportedWeeks = [...new Set(importedGroups.map(g => `${g.jaar}-W${g.weeknummer}`))]
    .sort((a, b) => b.localeCompare(a))

  const filteredImportedGroups = importedWeekFilter
    ? importedGroups.filter(g => `${g.jaar}-W${g.weeknummer}` === importedWeekFilter)
    : importedGroups

  const selectedImportedCount = filteredImportedGroups.filter(g => g.selected).length
  const totalImportedEntries = filteredImportedGroups
    .filter(g => g.selected)
    .reduce((sum, g) => sum + g.entries.length, 0)

  const totalImportedPages = Math.ceil(filteredImportedGroups.length / itemsPerPage)
  const paginatedImportedGroups = filteredImportedGroups.slice(
    (importedPage - 1) * itemsPerPage,
    importedPage * itemsPerPage
  )

  // Helper: find chauffeur km for a given user+datum
  const findChauffeurKm = (userId: string | null, datum: string): number => {
    if (!userId) return 0
    const match = chauffeurEntriesForMatch.find(e => e.user === userId && e.datum === datum)
    return match?.totaal_km || 0
  }

  useEffect(() => { setImportedPage(1) }, [importedWeekFilter])

  // Pagination (on filtered groups)
  const totalPages = Math.ceil(filteredGroups.length / itemsPerPage)
  const paginatedGroups = filteredGroups.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [weekFilter])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500/75" onClick={onClose} />
        <div className="modal-panel w-full max-w-4xl max-h-[85vh] flex flex-col">
          {/* Header with tabs */}
          <div className="border-b">
            <div className="px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('invoices.importHours')}</h3>
              <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                <XCircleIcon className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="px-6 flex gap-4">
              <button
                onClick={() => setActiveTab('chauffeur')}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'chauffeur'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('invoices.driverHours')}
              </button>
              <button
                onClick={() => setActiveTab('imported')}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'imported'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('invoices.importedHoursTab')}
              </button>
            </div>
          </div>

          {/* Tab: Chauffeur Uren */}
          {activeTab === 'chauffeur' && (
            <>
              {/* Filter bar */}
              {availableWeeks.length > 0 && (
                <div className="px-6 py-2 border-b bg-gray-50 flex items-center gap-2">
                  <span className="text-sm text-gray-500">{t('common.filter')}:</span>
                  <select
                    value={weekFilter}
                    onChange={(e) => setWeekFilter(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">{t('invoices.allWeeks')}</option>
                    {availableWeeks.map(week => (
                      <option key={week} value={week}>{week.replace('-W', ' Week ')}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                  </div>
                ) : chauffeurGroups.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>{t('invoices.noSubmittedHoursFound')}</p>
                    <p className="text-sm mt-1">{t('invoices.onlySubmittedCanBeImported')}</p>
                  </div>
                ) : filteredGroups.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>Geen uren gevonden voor deze week</p>
                  </div>
                ) : (
                  <>
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                            <input
                              type="checkbox"
                              checked={paginatedGroups.every(g => g.selected)}
                              onChange={() => {
                                const allSelected = paginatedGroups.every(g => g.selected)
                                const pageKeys = new Set(paginatedGroups.map(g => g.key))
                                setChauffeurGroups(prev => prev.map(g => 
                                  pageKeys.has(g.key) ? { ...g, selected: !allSelected } : g
                                ))
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Week</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chauffeur</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bedrijf</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Regels</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Totaal Uren</th>
                          <th className="px-4 py-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {paginatedGroups.map((group) => {
                          const totalUren = group.entries.reduce((sum, e) => {
                            const parts = (e.totaal_uren || '0:00').split(':')
                            const h = parseInt(parts[0]) || 0
                            const m = parseInt(parts[1]) || 0
                            return sum + h + (m / 60)
                          }, 0)
                          const isExpanded = expandedGroup === group.key
                          return (
                            <Fragment key={group.key}>
                              <tr 
                                className={`hover:bg-gray-50 cursor-pointer ${group.selected ? 'bg-primary-50' : ''}`}
                                onClick={() => toggleSelection(group.key)}
                              >
                                <td className="px-4 py-3">
                                  <input type="checkbox" checked={group.selected} onChange={() => toggleSelection(group.key)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="font-medium">Week {group.weeknummer}</span>
                                  <span className="text-gray-400 ml-1">{group.jaar}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">{group.chauffeurNaam}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-gray-500">{group.bedrijfNaam}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{group.entries.length}</span>
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">{totalUren.toFixed(1)} uur</td>
                                <td className="px-4 py-3">
                                  <button onClick={(e) => { e.stopPropagation(); toggleExpand(group.key) }} className="p-1 hover:bg-gray-200 rounded">
                                    {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-400" /> : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={7} className="px-4 py-0">
                                    <div className="bg-gray-50 rounded-lg my-2 overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead className="bg-gray-100">
                                          <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Datum</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ritnummer</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Kenteken</th>
                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Uren</th>
                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Km</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                          {group.entries.map((entry) => (
                                            <tr key={entry.id}>
                                              <td className="px-4 py-2">{new Date(entry.datum).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                                              <td className="px-4 py-2">{entry.ritnummer}</td>
                                              <td className="px-4 py-2 font-mono text-xs">{entry.kenteken}</td>
                                              <td className="px-4 py-2 text-right">{entry.totaal_uren || '0:00'}</td>
                                              <td className="px-4 py-2 text-right">{entry.totaal_km || 0}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    {totalPages > 1 && (
                      <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
                        <div className="text-sm text-gray-500">Pagina {currentPage} van {totalPages} ({chauffeurGroups.length} groepen)</div>
                        <div className="flex gap-2">
                          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">{t('common.previous')}</button>
                          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">{t('common.next')}</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">
                    {selectedCount > 0 ? <>{t('invoices.groupsSelectedLines', { count: selectedCount, entries: totalEntries })}</> : t('invoices.selectDriverWeekCombinations')}
                  </span>
                  {selectedCount > 1 && (
                    <div className="flex items-center gap-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                      <span className="text-gray-600">Importeren als:</span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
                        <input
                          type="radio"
                          name="import-mode-chauffeur"
                          checked={importMode === 'single'}
                          onChange={() => setImportMode('single')}
                          className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        1 factuur
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
                        <input
                          type="radio"
                          name="import-mode-chauffeur"
                          checked={importMode === 'perWeek'}
                          onChange={() => setImportMode('perWeek')}
                          className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Losse facturen per groep
                      </label>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer" title="Voegt onder elke rit/dag een extra regel toe met begin- en eindtijd">
                    <input
                      type="checkbox"
                      checked={showWorkTimes}
                      onChange={(e) => setShowWorkTimes(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    Toon werktijden op factuur
                  </label>
                </div>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">{t('common.cancel')}</button>
                  <button onClick={handleImport} disabled={totalEntries === 0} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('invoices.importCount', { count: totalEntries })}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Tab: Geïmporteerde Uren */}
          {activeTab === 'imported' && (
            <>
              {/* Filter bar */}
              {availableImportedWeeks.length > 0 && (
                <div className="px-6 py-2 border-b bg-gray-50 flex items-center gap-2">
                  <span className="text-sm text-gray-500">{t('common.filter')}:</span>
                  <select
                    value={importedWeekFilter}
                    onChange={(e) => setImportedWeekFilter(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">{t('invoices.allWeeks')}</option>
                    {availableImportedWeeks.map(week => (
                      <option key={week} value={week}>{week.replace('-W', ' Week ')}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {isLoadingImported ? (
                  <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                  </div>
                ) : importedGroups.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>{t('invoices.noImportedHoursFound')}</p>
                    <p className="text-sm mt-1">{t('invoices.importHoursFirst')}</p>
                  </div>
                ) : filteredImportedGroups.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>{t('invoices.noHoursFoundForWeek')}</p>
                  </div>
                ) : (
                  <>
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                            <input
                              type="checkbox"
                              checked={paginatedImportedGroups.every(g => g.selected)}
                              onChange={() => {
                                const allSelected = paginatedImportedGroups.every(g => g.selected)
                                const pageKeys = new Set(paginatedImportedGroups.map(g => g.key))
                                setImportedGroups(prev => prev.map(g =>
                                  pageKeys.has(g.key) ? { ...g, selected: !allSelected } : g
                                ))
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Week</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Chauffeur</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ritten</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Factuur Uren</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">KM (chauffeur)</th>
                          <th className="px-4 py-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {paginatedImportedGroups.map((group) => {
                          const totalFactuurUren = group.entries.reduce((sum, e) => sum + Number(e.uren_factuur || 0), 0)
                          const totalKm = group.entries.reduce((sum, e) => sum + findChauffeurKm(group.userId, e.datum), 0)
                          const isExpanded = expandedImportedGroup === group.key
                          return (
                            <Fragment key={group.key}>
                              <tr
                                className={`hover:bg-gray-50 cursor-pointer ${group.selected ? 'bg-primary-50' : ''}`}
                                onClick={() => toggleImportedSelection(group.key)}
                              >
                                <td className="px-4 py-3">
                                  <input type="checkbox" checked={group.selected} onChange={() => toggleImportedSelection(group.key)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="font-medium">Week {group.weeknummer}</span>
                                  <span className="text-gray-400 ml-1">{group.jaar}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">{group.chauffeurNaam}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">{group.entries.length}</span>
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap font-medium">{totalFactuurUren.toFixed(1)} uur</td>
                                <td className="px-4 py-3 text-right whitespace-nowrap text-gray-600">{totalKm} km</td>
                                <td className="px-4 py-3">
                                  <button onClick={(e) => { e.stopPropagation(); toggleImportedExpand(group.key) }} className="p-1 hover:bg-gray-200 rounded">
                                    {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-400" /> : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                                  </button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={7} className="px-4 py-0">
                                    <div className="bg-gray-50 rounded-lg my-2 overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead className="bg-gray-100">
                                          <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Datum</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ritlijst</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Kenteken</th>
                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Factuur Uren</th>
                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">KM (chauffeur)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                          {group.entries.map((entry) => (
                                            <tr key={entry.id}>
                                              <td className="px-4 py-2">{new Date(entry.datum).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                                              <td className="px-4 py-2 font-medium">{entry.ritlijst}</td>
                                              <td className="px-4 py-2 font-mono text-xs">{entry.kenteken_import || entry.voertuig_kenteken}</td>
                                              <td className="px-4 py-2 text-right">{Number(entry.uren_factuur || 0).toFixed(2)}</td>
                                              <td className="px-4 py-2 text-right">{findChauffeurKm(group.userId, entry.datum)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    {totalImportedPages > 1 && (
                      <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
                        <div className="text-sm text-gray-500">Pagina {importedPage} van {totalImportedPages} ({filteredImportedGroups.length} groepen)</div>
                        <div className="flex gap-2">
                          <button onClick={() => setImportedPage(p => Math.max(1, p - 1))} disabled={importedPage === 1} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">{t('common.previous')}</button>
                          <button onClick={() => setImportedPage(p => Math.min(totalImportedPages, p + 1))} disabled={importedPage === totalImportedPages} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">{t('common.next')}</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">
                    {selectedImportedCount > 0 ? <>{t('invoices.groupsSelectedTrips', { count: selectedImportedCount, entries: totalImportedEntries })}</> : t('invoices.selectDriverWeekCombinations')}
                  </span>
                  {selectedImportedCount > 1 && (
                    <div className="flex items-center gap-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm">
                      <span className="text-gray-600">Importeren als:</span>
                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
                        <input
                          type="radio"
                          name="import-mode-imported"
                          checked={importMode === 'single'}
                          onChange={() => setImportMode('single')}
                          className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        1 factuur
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-gray-700">
                        <input
                          type="radio"
                          name="import-mode-imported"
                          checked={importMode === 'perWeek'}
                          onChange={() => setImportMode('perWeek')}
                          className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Losse facturen per groep
                      </label>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer" title="Voegt onder elke rit een extra regel toe met begin- en eindtijd">
                    <input
                      type="checkbox"
                      checked={showWorkTimes}
                      onChange={(e) => setShowWorkTimes(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    Toon werktijden op factuur
                  </label>
                </div>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">{t('common.cancel')}</button>
                  <button onClick={handleImportImported} disabled={totalImportedEntries === 0} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('invoices.importTrips', { count: totalImportedEntries })}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Spreadsheet Import Modal
// ============================================

function SpreadsheetImportModal({
  isOpen,
  onClose,
  onImport,
}: {
  isOpen: boolean
  onClose: () => void
  onImport: (spreadsheet: Spreadsheet) => void
}) {
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([])
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<string>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const itemsPerPage = 20

  useEffect(() => {
    if (isOpen) {
      loadSpreadsheets()
      setCurrentPage(1)
      setWeekFilter('')
      setSelectedId(null)
    }
  }, [isOpen])

  const loadSpreadsheets = async () => {
    setIsLoading(true)
    try {
      const response = await getSpreadsheets({
        page_size: 1000,
        ordering: '-jaar,-week_nummer',
        status: 'ingediend',
      })
      setSpreadsheets(response.results)
    } catch (err) {
      console.error('Failed to load spreadsheets:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  const handleImport = () => {
    const selected = spreadsheets.find(s => s.id === selectedId)
    if (selected) {
      onImport(selected)
      onClose()
    }
  }

  // Get unique weeks for filter
  const availableWeeks = [...new Set(spreadsheets.map(s => `${s.jaar}-W${s.week_nummer}`))]
    .sort((a, b) => b.localeCompare(a))

  // Filter by week
  const filteredSpreadsheets = weekFilter
    ? spreadsheets.filter(s => `${s.jaar}-W${s.week_nummer}` === weekFilter)
    : spreadsheets

  // Pagination
  const totalPages = Math.ceil(filteredSpreadsheets.length / itemsPerPage)
  const paginatedSpreadsheets = filteredSpreadsheets.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [weekFilter])

  // Helper: calculate rij uren
  const calcRijUren = (rij: any): number => {
    const begin = parseFloat(rij.begin_tijd || 0)
    const eind = parseFloat(rij.eind_tijd || 0)
    const pauze = parseFloat(rij.pauze || 0)
    const correctie = parseFloat(rij.correctie || 0)
    return Math.max(0, eind - begin - pauze - correctie)
  }

  // Helper: calculate rij km
  const calcRijKm = (rij: any): number => {
    const begin = parseFloat(rij.begin_km || 0)
    const eind = parseFloat(rij.eind_km || 0)
    return Math.max(0, eind - begin)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500/75" onClick={onClose} />
        <div className="modal-panel w-full max-w-5xl max-h-[85vh] flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold">Ritregistratie Importeren</h3>
              {availableWeeks.length > 0 && (
                <select
                  value={weekFilter}
                  onChange={(e) => setWeekFilter(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Alle weken</option>
                  {availableWeeks.map(week => (
                    <option key={week} value={week}>{week.replace('-W', ' Week ')}</option>
                  ))}
                </select>
              )}
            </div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <XCircleIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            ) : spreadsheets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <CalculatorIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>Geen ingediende ritregistraties gevonden</p>
                <p className="text-sm mt-1">Markeer eerst een ritregistratie als ingediend</p>
              </div>
            ) : filteredSpreadsheets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <CalculatorIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>Geen ritregistraties gevonden voor deze week</p>
              </div>
            ) : (
              <>
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Week
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Naam
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Bedrijf
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Ritten
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Totaal
                      </th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedSpreadsheets.map((spreadsheet) => {
                      const isSelected = selectedId === spreadsheet.id
                      const isExpanded = expandedId === spreadsheet.id
                      
                      return (
                        <Fragment key={spreadsheet.id}>
                          <tr 
                            className={`hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-primary-50' : ''}`}
                            onClick={() => setSelectedId(isSelected ? null : spreadsheet.id)}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="radio"
                                checked={isSelected}
                                onChange={() => setSelectedId(isSelected ? null : spreadsheet.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-medium">Week {spreadsheet.week_nummer}</span>
                              <span className="text-gray-400 ml-1">{spreadsheet.jaar}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {spreadsheet.naam}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                              {spreadsheet.bedrijf_naam}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                {spreadsheet.rijen.length}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap font-medium">
                              {formatCurrency(spreadsheet.totaal_factuur)}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleExpand(spreadsheet.id)
                                }}
                                className="p-1 hover:bg-gray-200 rounded"
                              >
                                {isExpanded ? (
                                  <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                                )}
                              </button>
                            </td>
                          </tr>
                          
                          {/* Expanded details - show rijen */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="px-4 py-0">
                                <div className="bg-gray-50 rounded-lg my-2 overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Rit</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Chauffeur</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Datum</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Uren</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Km</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Bedrag</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {spreadsheet.rijen.map((rij, idx) => {
                                        const uren = calcRijUren(rij)
                                        const km = calcRijKm(rij)
                                        const overnachting = parseFloat(rij.overnachting as any || 0)
                                        const overigeKosten = parseFloat(rij.overige_kosten as any || 0)
                                        const tarUur = uren * spreadsheet.tarief_per_uur
                                        const tarKm = km * spreadsheet.tarief_per_km
                                        const dot = km * spreadsheet.tarief_dot
                                        const rijTotaal = tarUur + tarKm + dot + overnachting + overigeKosten
                                        
                                        return (
                                          <tr key={idx}>
                                            <td className="px-3 py-2">{rij.ritnr || idx + 1}</td>
                                            <td className="px-3 py-2">{rij.chauffeur || '-'}</td>
                                            <td className="px-3 py-2">{rij.datum || '-'}</td>
                                            <td className="px-3 py-2 text-right">{uren.toFixed(2)}</td>
                                            <td className="px-3 py-2 text-right">{km.toFixed(0)}</td>
                                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(rijTotaal)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                  <div className="px-3 py-2 bg-gray-100 text-xs text-gray-500 flex gap-4">
                                    <span>Uurtarief: €{spreadsheet.tarief_per_uur}</span>
                                    <span>KM-tarief: €{spreadsheet.tarief_per_km}</span>
                                    <span>DOT-tarief: €{spreadsheet.tarief_dot}</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      Pagina {currentPage} van {totalPages} ({filteredSpreadsheets.length} spreadsheets)
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Vorige
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Volgende
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {selectedId ? (
                <>{t('invoices.tripRegistrationSelected', { count: spreadsheets.find(s => s.id === selectedId)?.rijen.length || 0 })}</>
              ) : (
                t('invoices.selectTripRegistration')
              )}
            </span>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={!selectedId}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.import')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Tol Import Modal
// ============================================

interface TolTarget {
  id: string
  label: string
}

function TolImportModal({
  isOpen,
  onClose,
  onImport,
  targets,
}: {
  isOpen: boolean
  onClose: () => void
  onImport: (registraties: TolRegistratie[], targetId: string) => void
  targets: TolTarget[]
}) {
  const [allRegistraties, setAllRegistraties] = useState<TolRegistratie[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [targetId, setTargetId] = useState<string>('')

  useEffect(() => {
    if (isOpen) {
      loadData()
      setSelectedIds(new Set())
      setSearchTerm('')
      setTargetId(targets[0]?.id || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Keep selected target valid if the list changes while open
  useEffect(() => {
    if (isOpen && targets.length > 0 && !targets.some(t => t.id === targetId)) {
      setTargetId(targets[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const response = await getTolRegistraties({ gefactureerd: false, page_size: 500, ordering: '-datum' })
      setAllRegistraties(response.results)
    } catch {
      console.error('Failed to load toll registrations')
    } finally {
      setIsLoading(false)
    }
  }

  const filtered = allRegistraties.filter(r => {
    if (!searchTerm) return true
    const q = searchTerm.toLowerCase()
    return (
      (r.user_naam || '').toLowerCase().includes(q) ||
      (r.kenteken || '').toLowerCase().includes(q) ||
      (r.ritten || []).some(rit => rit.ritnummer.toLowerCase().includes(q))
    )
  })

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(r => r.id)))
    }
  }

  const handleImport = () => {
    if (!targetId) return
    const toImport = allRegistraties.filter(r => selectedIds.has(r.id))
    onImport(toImport, targetId)
    onClose()
  }

  const formatBedrag = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(isNaN(num) ? 0 : num)
  }

  const totalSelected = selectedIds.size
  const totalBedrag = allRegistraties
    .filter(r => selectedIds.has(r.id))
    .reduce((sum, r) => sum + parseFloat(r.totaal_bedrag), 0)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500/75" onClick={onClose} />
        <div className="modal-panel w-full max-w-3xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h3 className="text-lg font-semibold">Tol importeren</h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <XCircleIcon className="h-5 w-5 text-gray-400" />
            </button>
          </div>

          {/* Target + Search */}
          <div className="px-6 py-3 border-b bg-gray-50 space-y-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Koppel aan factuur</label>
              <select
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500 bg-white"
              >
                {targets.map(target => (
                  <option key={target.id} value={target.id}>{target.label}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Zoek op chauffeur of kenteken..."
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            ) : allRegistraties.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>Geen openstaande tolregistraties gevonden</p>
                <p className="text-sm mt-1">Alleen niet-gefactureerde registraties worden getoond</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>Geen resultaten gevonden</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 w-12">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chauffeur</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wagen</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ritnummers</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filtered.map(reg => (
                    <tr
                      key={reg.id}
                      className={`hover:bg-gray-50 cursor-pointer ${selectedIds.has(reg.id) ? 'bg-primary-50' : ''}`}
                      onClick={() => toggleSelection(reg.id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(reg.id)}
                          onChange={() => toggleSelection(reg.id)}
                          onClick={e => e.stopPropagation()}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {reg.datum ? new Date(reg.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">{reg.user_naam || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{reg.kenteken || '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {reg.ritten && reg.ritten.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {reg.ritten.map(rit => (
                              <span key={rit.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">{rit.ritnummer}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-sm">{formatBedrag(reg.totaal_bedrag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {totalSelected > 0
                ? `${totalSelected} geselecteerd — totaal ${formatBedrag(totalBedrag)}`
                : 'Selecteer tolregistraties om te importeren'}
            </span>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Annuleren
              </button>
              <button
                onClick={handleImport}
                disabled={totalSelected === 0 || !targetId}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Importeer {totalSelected > 0 ? `(${totalSelected})` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export default function InvoiceCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const reimportId = searchParams.get('reimport')
  
  // Data state
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [administraties, setAdministraties] = useState<Administratie[]>([])
  
  // Form state
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [selectedAdministratie, setSelectedAdministratie] = useState<string>('')
  const [invoiceType, setInvoiceType] = useState<'verkoop' | 'inkoop' | 'credit'>('verkoop')
  const [factuurnummer, setFactuurnummer] = useState<string>('')
  const [factuurdatum, setFactuurdatum] = useState(new Date().toISOString().split('T')[0])
  const [vervaldatum, setVervaldatum] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [opmerkingen, setOpmerkingen] = useState('')
  const [lines, setLines] = useState<InvoiceLineData[]>([])
  // Override DOT percentage from template (empty string = use template default)
  const [dotPercentageOverride, setDotPercentageOverride] = useState<string>('')
  
  // Week/Chauffeur tracking (from imported time entries)
  const [weekNumber, setWeekNumber] = useState<number | null>(null)
  const [weekYear, setWeekYear] = useState<number | null>(null)
  const [chauffeur, setChauffeur] = useState<string | null>(null)
  
  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showSpreadsheetImportModal, setShowSpreadsheetImportModal] = useState(false)
  const [showTolImportModal, setShowTolImportModal] = useState(false)
  const [showWorkTimes, setShowWorkTimes] = useState(false)
  const [batchDrafts, setBatchDrafts] = useState<BatchInvoiceDraft[]>([])
  const [expandedBatchDraftId, setExpandedBatchDraftId] = useState<string | null>(null)
  const [savingBatchDraftId, setSavingBatchDraftId] = useState<string | null>(null)
  
  // Get template layout
  const templateLayout = useMemo(() => {
    if (!selectedTemplate?.layout) return null
    return selectedTemplate.layout as TemplateLayout
  }, [selectedTemplate])

  const columns = useMemo(() => templateLayout?.columns || [], [templateLayout])
  const defaults = useMemo(() => {
    const base = templateLayout?.defaults || {
      uurtarief: 45,
      dotPrijs: 21,
      dotIsPercentage: true,
      kmTarief: 0.23,
    }
    const trimmed = dotPercentageOverride.trim()
    if (trimmed !== '') {
      const parsed = parseFloat(trimmed.replace(',', '.'))
      if (!isNaN(parsed)) {
        return { ...base, dotPrijs: parsed }
      }
    }
    return base
  }, [templateLayout, dotPercentageOverride])
  const totalsConfig = useMemo(() => templateLayout?.totals || {
    showSubtotaal: true,
    showBtw: true,
    showTotaal: true,
    btwPercentage: 21,
  }, [templateLayout])

  // Load next invoice number when type or administratie changes
  const loadNextInvoiceNumber = useCallback(async (
    type: 'verkoop' | 'inkoop' | 'credit',
    administratie?: string | null,
  ) => {
    try {
      const result = await getNextInvoiceNumber(type, administratie || null)
      setFactuurnummer(result.factuurnummer)
    } catch (err) {
      console.error('Could not load next invoice number:', err)
    }
  }, [])

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [templatesRes, companiesRes, administratiesRes] = await Promise.all([
          getTemplates(true),
          getCompanies({ page_size: 1000 }),
          getMijnAdministraties(),
        ])
        setTemplates(templatesRes.results)
        setCompanies(companiesRes.results)
        setAdministraties(administratiesRes)

        if (reimportId) {
          // Reimport mode: prefill from existing invoice
          try {
            const existing = await getInvoice(reimportId)
            setInvoiceType(existing.type as 'verkoop' | 'inkoop' | 'credit')
            setFactuurnummer(existing.factuurnummer)
            setFactuurdatum(existing.factuurdatum)
            setVervaldatum(existing.vervaldatum)
            setOpmerkingen(existing.opmerkingen || '')
            setSelectedCompany(existing.bedrijf)
            setSelectedAdministratie(existing.administratie || '')
            if (existing.dot_percentage !== null && existing.dot_percentage !== undefined) {
              setDotPercentageOverride(String(existing.dot_percentage))
            }
            const tpl = templatesRes.results.find(t => t.id === existing.template)
            if (tpl) setSelectedTemplate(tpl)
          } catch (e) {
            console.error('Could not load invoice to reimport:', e)
            setError('Kon de factuur niet laden voor opnieuw importeren')
          }
        } else {
          // Load initial invoice number
          await loadNextInvoiceNumber('verkoop')
        }
      } catch (err) {
        setError(t('errors.loadFailed'))
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [reimportId])

  // Refresh next invoice number when administratie changes (skip in reimport mode,
  // where the existing factuurnummer must stay untouched)
  useEffect(() => {
    if (reimportId) return
    loadNextInvoiceNumber(invoiceType, selectedAdministratie || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdministratie])

  // Create empty line with default values for all columns
  const createEmptyLine = useCallback((): InvoiceLineData => {
    const values: Record<string, number | string> = {}
    
    columns.forEach(col => {
      if (col.type === 'text') {
        values[col.id] = ''
      } else if (col.type === 'prijs' || col.id === 'prijs') {
        // Use uurtarief as default price for new lines
        values[col.id] = defaults.uurtarief
      } else if (col.type === 'aantal' || col.id === 'aantal') {
        // Default aantal = 1
        values[col.id] = 1
      } else if (col.type === 'berekend') {
        values[col.id] = 0
      } else {
        values[col.id] = 0
      }
    })
    
    // Calculate computed columns
    columns.forEach(col => {
      if (col.type === 'berekend' && col.formule) {
        values[col.id] = evaluateFormula(col.formule, values, defaults)
      }
    })
    
    return {
      id: generateId(),
      values,
    }
  }, [columns, defaults])

  // Add new line
  const addLine = () => {
    setLines(prev => [...prev, createEmptyLine()])
  }

  // Update line values
  const updateLine = (lineId: string, values: Record<string, number | string>) => {
    setLines(prev => prev.map(line => 
      line.id === lineId ? { ...line, values } : line
    ))
  }

  // Delete line
  const deleteLine = (lineId: string) => {
    setLines(prev => prev.filter(line => line.id !== lineId))
  }

  // Batch draft line operations (editable per-draft lines)
  const addBatchLine = (draftId: string) => {
    setBatchDrafts(prev => prev.map(d =>
      d.id === draftId ? { ...d, lines: [...d.lines, createEmptyLine()] } : d
    ))
  }

  const updateBatchLine = (draftId: string, lineId: string, values: Record<string, number | string>) => {
    setBatchDrafts(prev => prev.map(d =>
      d.id === draftId
        ? { ...d, lines: d.lines.map(l => (l.id === lineId ? { ...l, values } : l)) }
        : d
    ))
  }

  const deleteBatchLine = (draftId: string, lineId: string) => {
    setBatchDrafts(prev => prev.map(d =>
      d.id === draftId ? { ...d, lines: d.lines.filter(l => l.id !== lineId) } : d
    ))
  }

  // Build invoice lines from selected toll registrations.
  // Each ritnummer becomes an informational line without toll amount.
  // Per submission, add one final line carrying the full toll amount.
  const buildTolLines = useCallback((registraties: TolRegistratie[]): InvoiceLineData[] => {
    const result: InvoiceLineData[] = []

    registraties.forEach(reg => {
      const bedrag = parseFloat(reg.totaal_bedrag) || 0
      const ritten = reg.ritten && reg.ritten.length > 0 ? reg.ritten : null
      const wagenLabel = reg.kenteken || ''

      const buildLine = (omschrijving: string, lineBedrag: number) => {
        const values: Record<string, number | string> = {}

        columns.forEach(col => {
          if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
            values[col.id] = omschrijving
          } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
            values[col.id] = 1
          } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
            values[col.id] = lineBedrag
          } else if (col.type === 'berekend') {
            values[col.id] = 0
          } else {
            values[col.id] = 0
          }
        })

        columns.forEach(col => {
          if (col.type === 'berekend' && col.formule) {
            values[col.id] = evaluateFormula(col.formule, values, defaults)
          }
        })

        result.push({ id: generateId(), values })
      }

      if (ritten) {
        ritten.forEach(rit => {
          const ritDatumLabel = rit.rit_datum ? new Date(rit.rit_datum).toLocaleDateString('nl-NL') : ''
          const parts = ['Tol', wagenLabel, `rit ${rit.ritnummer}`, ritDatumLabel].filter(Boolean)
          buildLine(parts.join(' - '), 0)
        })

        const totalParts = ['Totaal tol', wagenLabel].filter(Boolean)
        buildLine(totalParts.join(' - '), bedrag)
      } else {
        const totalParts = ['Totaal tol', wagenLabel].filter(Boolean)
        buildLine(totalParts.join(' - '), bedrag)
      }
    })

    return result
  }, [columns, defaults])

  // Import toll registrations as invoice lines, attached to the chosen target invoice
  const handleImportTol = async (registraties: TolRegistratie[], targetId: string) => {
    if (registraties.length === 0 || !targetId) return

    const tolLines = buildTolLines(registraties)

    if (targetId === SINGLE_INVOICE_TARGET) {
      setLines(prev => [...prev, ...tolLines])
    } else {
      setBatchDrafts(prev => prev.map(d =>
        d.id === targetId ? { ...d, lines: [...d.lines, ...tolLines] } : d
      ))
      setExpandedBatchDraftId(targetId)
    }

    try {
      await markTolGefactureerd(registraties.map(r => r.id))
    } catch {
      console.error('Failed to mark toll registrations as gefactureerd')
    }
  }

  // Import time entries with automatic KM and DOT calculations
  const handleImportEntries = (entries: TimeEntry[], mode: ImportMode = 'single') => {
    if (mode === 'perWeek') {
      if (!selectedCompany) {
        setError('Selecteer eerst een bedrijf voordat je losse facturen maakt.')
        return
      }

      const groupedByWeek: Record<string, TimeEntry[]> = {}
      entries.forEach(entry => {
        const year = new Date(entry.datum).getFullYear()
        const key = `${year}-W${entry.weeknummer}-${entry.user ?? 'onbekend'}`
        if (!groupedByWeek[key]) groupedByWeek[key] = []
        groupedByWeek[key].push(entry)
      })

      const sortedKeys = Object.keys(groupedByWeek).sort((a, b) => b.localeCompare(a))
      const drafts = sortedKeys.map((key, index) => {
        const built = buildLinesFromTimeEntries(groupedByWeek[key])
        return {
          id: `draft-time-${key}-${Date.now()}-${index}`,
          factuurnummer: incrementInvoiceNumber(factuurnummer, index),
          weekNumber: built.weekNumber,
          weekYear: built.weekYear,
          chauffeur: built.chauffeur,
          chauffeurNaam: built.chauffeurNaam,
          lines: built.lines,
        } satisfies BatchInvoiceDraft
      })

      setBatchDrafts(drafts)
      setExpandedBatchDraftId(drafts[0]?.id || null)
      setLines([])
      setWeekNumber(null)
      setWeekYear(null)
      setChauffeur(null)
      return
    }

    // Filter regels zonder ritnummer (of 'Geen inzet') én 0 km — geen inzet, niet factureren
    const isGeenInzet = (e: TimeEntry) => {
      const rit = String(e.ritnummer || '').trim().toLowerCase()
      const km = e.totaal_km || 0
      return (rit === '' || rit === 'geen inzet') && km === 0
    }
    const filteredEntries = entries.filter(e => !isGeenInzet(e))
    const skippedGeenInzet = entries.length - filteredEntries.length
    if (skippedGeenInzet > 0) {
      console.info(`[invoice import] ${skippedGeenInzet} 'Geen inzet / 0 km' regel(s) overgeslagen`)
    }
    // Sort entries by date ascending (oldest first)
    const sortedEntries = [...filteredEntries].sort((a, b) => 
      new Date(a.datum).getTime() - new Date(b.datum).getTime()
    )
    
    // Extract week/chauffeur from first entry (all entries in a group have same week/chauffeur)
    if (sortedEntries.length > 0) {
      const firstEntry = sortedEntries[0]
      setWeekNumber(firstEntry.weeknummer)
      setWeekYear(new Date(firstEntry.datum).getFullYear())
      setChauffeur(firstEntry.user)
    }
    
    // Calculate totals from all entries
    let totalKm = 0
    let totalUren = 0
    
    // Helper: extract HH:MM from a time string like '08:00:00' or '08:00'
    const fmtTime = (t: string | null | undefined): string | null => {
      if (!t) return null
      const m = String(t).match(/^(\d{1,2}):(\d{2})/)
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
    }

    // Helper: build a 'werktijden' info line (alleen omschrijving, geen aantal/prijs/totaal)
    const buildWorkTimeLine = (begin: string | null, eind: string | null): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      const tekst = `Werktijden: ${begin || '-'} - ${eind || '-'}`
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = tekst
        } else {
          values[col.id] = 0
        }
      })
      return { id: generateId(), values, isInfoLine: true }
    }

    // Create lines for each time entry (day) — optioneel met werktijden-regel eronder
    const entryLines: InvoiceLineData[] = sortedEntries.flatMap(entry => {
      const values: Record<string, number | string> = {}
      
      // Parse uren
      const [h, m] = (entry.totaal_uren || '0:00').split(':').map(Number)
      const uren = roundUren(h + (m / 60))
      const km = entry.totaal_km || 0
      
      totalUren += uren
      totalKm += km
      
      columns.forEach(col => {
        // Map time entry fields to template columns
        if (col.type === 'text' || col.id === 'omschrijving') {
          // Include km in description
          values[col.id] = `Rit ${entry.ritnummer} - ${new Date(entry.datum).toLocaleDateString('nl-NL')} (${km} km)`
        } else if (col.type === 'aantal' || col.id === 'aantal') {
          // Aantal = uren van die dag
          values[col.id] = uren
        } else if (col.type === 'prijs' || col.id === 'prijs') {
          // Prijs = uurtarief uit template
          values[col.id] = defaults.uurtarief
        } else if (col.type === 'uren' || col.id.includes('uur')) {
          values[col.id] = uren
        } else if (col.type === 'km' || col.id.includes('km')) {
          values[col.id] = km
        } else {
          values[col.id] = 0
        }
      })
      
      // Calculate computed columns
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      
      const mainLine: InvoiceLineData = {
        id: generateId(),
        values,
        timeEntryId: entry.id,
      }

      if (showWorkTimes) {
        const begin = fmtTime(entry.aanvang)
        const eind = fmtTime(entry.eind)
        if (begin || eind) {
          return [mainLine, buildWorkTimeLine(begin, eind)]
        }
      }
      return [mainLine]
    })
    
    // Calculate subtotal of entry lines (for percentage calculation)
    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    const entriesSubtotaal = entryLines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)
    
    // Create helper function for summary lines
    const createSummaryLine = (omschrijving: string, aantal: number, prijs: number): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = omschrijving
        } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
          values[col.id] = aantal
        } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
          values[col.id] = prijs
        } else {
          values[col.id] = 0
        }
      })
      
      // Calculate computed columns
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      
      return { id: generateId(), values }
    }
    
    const summaryLines: InvoiceLineData[] = []
    
    // Check if KM should be percentage or fixed
    if (defaults.dotIsPercentage) {
      // DOT is percentage mode: only add DOT line (no KM line)
      // DOT = percentage of subtotal of uren
      if (defaults.dotPrijs > 0) {
        const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
        summaryLines.push(createSummaryLine(
          `Totaal DOT (${defaults.dotPrijs}%)`,
          1,
          dotBedrag
        ))
      }
    } else {
      // Fixed mode: add both KM and DOT lines
      
      // KM Line: Totaal KM * kmTarief
      if (totalKm > 0 && defaults.kmTarief > 0) {
        summaryLines.push(createSummaryLine(
          'Totaal KM',
          totalKm,
          defaults.kmTarief
        ))
      }
      
      // DOT Line: Totaal KM * dotPrijs (fixed price per km)
      if (totalKm > 0 && defaults.dotPrijs > 0) {
        summaryLines.push(createSummaryLine(
          'Totaal DOT',
          totalKm,
          defaults.dotPrijs
        ))
      }
    }

    // Kilometerheffing-regels per rit
    const kilometerheffingLines: InvoiceLineData[] = sortedEntries
      .filter(entry => entry.kilometerheffing_bedrag != null && String(entry.kilometerheffing_bedrag).trim() !== '')
      .map(entry => {
        const bedrag = parseFloat(String(entry.kilometerheffing_bedrag)) || 0
        const datumStr = new Date(entry.datum).toLocaleDateString('nl-NL')
        const omschrijving = `Kilometerheffing rit ${entry.ritnummer} - ${datumStr}`
        const values: Record<string, number | string> = {}
        columns.forEach(col => {
          if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
            values[col.id] = omschrijving
          } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
            values[col.id] = 1
          } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
            values[col.id] = bedrag
          } else {
            values[col.id] = 0
          }
        })
        columns.forEach(col => {
          if (col.type === 'berekend' && col.formule) {
            values[col.id] = evaluateFormula(col.formule, values, defaults)
          }
        })
        return { id: generateId(), values, kilometerheffingTimeEntryId: entry.id }
      })

    // Combine all lines
    setLines(prev => [...prev, ...entryLines, ...summaryLines, ...kilometerheffingLines])
  }

  // Import imported (Excel) entries with ritnummers from import, km from chauffeur, uren from import
  const handleImportImportedEntries = (entries: ImportedTimeEntry[], chauffeurEntries: TimeEntry[], mode: ImportMode = 'single') => {
    if (mode === 'perWeek') {
      if (!selectedCompany) {
        setError('Selecteer eerst een bedrijf voordat je losse facturen maakt.')
        return
      }

      const groupedByWeek: Record<string, ImportedTimeEntry[]> = {}
      entries.forEach(entry => {
        const year = new Date(entry.datum).getFullYear()
        const key = `${year}-W${entry.weeknummer}-${entry.user ?? 'onbekend'}`
        if (!groupedByWeek[key]) groupedByWeek[key] = []
        groupedByWeek[key].push(entry)
      })

      const sortedKeys = Object.keys(groupedByWeek).sort((a, b) => b.localeCompare(a))
      const drafts = sortedKeys.map((key, index) => {
        const built = buildLinesFromImportedEntries(groupedByWeek[key], chauffeurEntries)
        return {
          id: `draft-imported-${key}-${Date.now()}-${index}`,
          factuurnummer: incrementInvoiceNumber(factuurnummer, index),
          weekNumber: built.weekNumber,
          weekYear: built.weekYear,
          chauffeur: built.chauffeur,
          chauffeurNaam: built.chauffeurNaam,
          lines: built.lines,
        } satisfies BatchInvoiceDraft
      })

      setBatchDrafts(drafts)
      setExpandedBatchDraftId(drafts[0]?.id || null)
      setLines([])
      setWeekNumber(null)
      setWeekYear(null)
      setChauffeur(null)
      return
    }

    // Filter out "niet gereden" rows — these are non-valid trips and must not be invoiced
    const isNietGereden = (e: ImportedTimeEntry) => {
      const haystack = [
        e.ritlijst,
        e.periode,
        e.dot,
        e.kenteken_import,
      ].map(v => String(v ?? '').toLowerCase()).join(' ')
      return haystack.includes('niet gereden')
    }
    // Regels zonder ritlijst (of 'Geen inzet') én 0 km zijn geen inzet en mogen niet gefactureerd worden
    const isGeenInzetImported = (e: ImportedTimeEntry) => {
      const rit = String(e.ritlijst || '').trim().toLowerCase()
      const km = e.user ? (chauffeurEntries.find(c => c.user === e.user && c.datum === e.datum)?.totaal_km || 0) : 0
      return (rit === '' || rit === 'geen inzet') && km === 0
    }
    const validEntries = entries.filter(e => !isNietGereden(e) && !isGeenInzetImported(e))
    const skipped = entries.length - validEntries.length
    if (skipped > 0) {
      console.info(`[invoice import] ${skipped} 'niet gereden' / 'Geen inzet' regel(s) overgeslagen`)
    }

    // Sort entries by date ascending
    const sortedEntries = [...validEntries].sort((a, b) =>
      new Date(a.datum).getTime() - new Date(b.datum).getTime()
    )

    // Set week/chauffeur from first entry
    if (sortedEntries.length > 0) {
      const first = sortedEntries[0]
      setWeekNumber(first.weeknummer)
      setWeekYear(new Date(first.datum).getFullYear())
      if (first.user) setChauffeur(first.user)
    }

    // Build lookup for chauffeur km by user+datum
    const chauffeurKmMap: Record<string, number> = {}
    chauffeurEntries.forEach(e => {
      chauffeurKmMap[`${e.user}|${e.datum}`] = e.totaal_km || 0
    })

    let totalKm = 0
    let totalUren = 0

    // Helper: extract HH:MM from a time string
    const fmtTime = (t: string | null | undefined): string | null => {
      if (!t) return null
      const m = String(t).match(/^(\d{1,2}):(\d{2})/)
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
    }

    // Helper: build a 'werktijden' info line (alleen omschrijving, geen aantal/prijs/totaal)
    const buildWorkTimeLine = (begin: string | null, eind: string | null): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      const tekst = `Werktijden: ${begin || '-'} - ${eind || '-'}`
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = tekst
        } else {
          values[col.id] = 0
        }
      })
      return { id: generateId(), values, isInfoLine: true }
    }

    // Create lines for each imported entry — optioneel met werktijden-regel eronder
    const entryLines: InvoiceLineData[] = sortedEntries.flatMap(entry => {
      const values: Record<string, number | string> = {}

      const uren = roundUren(Number(entry.uren_factuur))
      const km = entry.user ? (chauffeurKmMap[`${entry.user}|${entry.datum}`] || 0) : 0

      totalUren += uren
      totalKm += km

      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving') {
          values[col.id] = `Rit ${entry.ritlijst} - ${new Date(entry.datum).toLocaleDateString('nl-NL')} (${km} km)`
        } else if (col.type === 'aantal' || col.id === 'aantal') {
          values[col.id] = uren
        } else if (col.type === 'prijs' || col.id === 'prijs') {
          values[col.id] = defaults.uurtarief
        } else if (col.type === 'uren' || col.id.includes('uur')) {
          values[col.id] = uren
        } else if (col.type === 'km' || col.id.includes('km')) {
          values[col.id] = km
        } else {
          values[col.id] = 0
        }
      })

      // Calculate computed columns
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })

      const mainLine: InvoiceLineData = { id: generateId(), values }

      if (showWorkTimes) {
        const begin = fmtTime(entry.begintijd_rit)
        const eind = fmtTime(entry.eindtijd_rit)
        if (begin || eind) {
          return [mainLine, buildWorkTimeLine(begin, eind)]
        }
      }
      return [mainLine]
    })

    // Calculate subtotal for percentage DOT
    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    const entriesSubtotaal = entryLines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)

    const createSummaryLine = (omschrijving: string, aantal: number, prijs: number): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = omschrijving
        } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
          values[col.id] = aantal
        } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
          values[col.id] = prijs
        } else {
          values[col.id] = 0
        }
      })
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      return { id: generateId(), values }
    }

    const summaryLines: InvoiceLineData[] = []

    if (defaults.dotIsPercentage) {
      if (defaults.dotPrijs > 0) {
        const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
        summaryLines.push(createSummaryLine(`Totaal DOT (${defaults.dotPrijs}%)`, 1, dotBedrag))
      }
    } else {
      if (totalKm > 0 && defaults.kmTarief > 0) {
        summaryLines.push(createSummaryLine('Totaal KM', totalKm, defaults.kmTarief))
      }
      if (totalKm > 0 && defaults.dotPrijs > 0) {
        summaryLines.push(createSummaryLine('Totaal DOT', totalKm, defaults.dotPrijs))
      }
    }

    setLines(prev => [...prev, ...entryLines, ...summaryLines])
  }

  // Import spreadsheet ritregistratie entries
  const handleImportSpreadsheet = (spreadsheet: Spreadsheet) => {
    // Set week/chauffeur tracking from spreadsheet
    setWeekNumber(spreadsheet.week_nummer)
    setWeekYear(spreadsheet.jaar)
    
    // Set company if not already set
    if (!selectedCompany && spreadsheet.bedrijf) {
      setSelectedCompany(spreadsheet.bedrijf)
    }

    const tarUur = Number(spreadsheet.tarief_per_uur) || 0
    const tarKm = Number(spreadsheet.tarief_per_km) || 0
    const tarDot = Number(spreadsheet.tarief_dot) || 0
    
    let totalKm = 0
    let totalOvernachting = 0
    let totalOverigeKosten = 0
    
    // Create one invoice line per rij (for uren)
    const entryLines: InvoiceLineData[] = spreadsheet.rijen.map((rij, idx) => {
      const beginTijd = parseFloat(rij.begin_tijd as any || 0)
      const eindTijd = parseFloat(rij.eind_tijd as any || 0)
      const pauze = parseFloat(rij.pauze as any || 0)
      const correctie = parseFloat(rij.correctie as any || 0)
      const beginKm = parseFloat(rij.begin_km as any || 0)
      const eindKm = parseFloat(rij.eind_km as any || 0)
      const overnachting = parseFloat(rij.overnachting as any || 0)
      const overigeKosten = parseFloat(rij.overige_kosten as any || 0)
      
      const uren = roundUren(Math.max(0, eindTijd - beginTijd - pauze - correctie))
      const km = Math.max(0, eindKm - beginKm)
      
      totalKm += km
      totalOvernachting += overnachting
      totalOverigeKosten += overigeKosten
      
      const values: Record<string, number | string> = {}
      
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving') {
          values[col.id] = `Rit ${rij.ritnr || idx + 1} - ${rij.datum || ''} (${km} km)`
        } else if (col.type === 'aantal' || col.id === 'aantal') {
          values[col.id] = uren
        } else if (col.type === 'prijs' || col.id === 'prijs') {
          values[col.id] = tarUur
        } else if (col.type === 'uren' || col.id.includes('uur')) {
          values[col.id] = uren
        } else if (col.type === 'km' || col.id.includes('km')) {
          values[col.id] = km
        } else {
          values[col.id] = 0
        }
      })
      
      // Calculate computed columns
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      
      return { id: generateId(), values }
    })
    
    // Helper for summary lines
    const createSummaryLine = (omschrijving: string, aantal: number, prijs: number): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = omschrijving
        } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
          values[col.id] = aantal
        } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
          values[col.id] = prijs
        } else {
          values[col.id] = 0
        }
      })
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      return { id: generateId(), values }
    }
    
    const summaryLines: InvoiceLineData[] = []
    
    // KM line
    if (totalKm > 0 && tarKm > 0) {
      summaryLines.push(createSummaryLine('Totaal KM', totalKm, tarKm))
    }
    
    // DOT line
    if (totalKm > 0 && tarDot > 0) {
      summaryLines.push(createSummaryLine('Totaal DOT', totalKm, tarDot))
    }
    
    // Overnachting line
    if (totalOvernachting > 0) {
      summaryLines.push(createSummaryLine('Overnachtingen', 1, totalOvernachting))
    }
    
    // Overige kosten line
    if (totalOverigeKosten > 0) {
      summaryLines.push(createSummaryLine('Overige kosten', 1, totalOverigeKosten))
    }
    
    setLines(prev => [...prev, ...entryLines, ...summaryLines])
  }

  // Calculate totals
  const calculateTotals = useMemo(() => {
    // Find the totaal/berekend column
    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    
    const subtotaal = lines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)
    
    const btw = subtotaal * (totalsConfig.btwPercentage / 100)
    const totaal = subtotaal + btw
    
    return { subtotaal, btw, totaal }
  }, [lines, columns, totalsConfig])

  // Totals for a specific batch draft's lines
  const calculateDraftTotals = useCallback((draftLines: InvoiceLineData[]) => {
    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    const subtotaal = draftLines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)
    const btw = subtotaal * (totalsConfig.btwPercentage / 100)
    const totaal = subtotaal + btw
    return { subtotaal, btw, totaal }
  }, [columns, totalsConfig])

  const isBatchMode = batchDrafts.length > 0

  // Targets for toll import: each open batch draft, or the single invoice
  const tolTargets = useMemo<TolTarget[]>(() => {
    if (isBatchMode) {
      return batchDrafts.map(d => ({
        id: d.id,
        label: `${d.factuurnummer}${d.chauffeurNaam ? ` · ${d.chauffeurNaam}` : ''}${d.weekNumber ? ` · Week ${d.weekNumber}` : ''}`,
      }))
    }
    return [{ id: SINGLE_INVOICE_TARGET, label: factuurnummer || 'Deze factuur' }]
  }, [isBatchMode, batchDrafts, factuurnummer])

  const buildLinesFromTimeEntries = useCallback((entries: TimeEntry[]) => {
    const isGeenInzet = (e: TimeEntry) => {
      const rit = String(e.ritnummer || '').trim().toLowerCase()
      const km = e.totaal_km || 0
      return (rit === '' || rit === 'geen inzet') && km === 0
    }
    const filteredEntries = entries.filter(e => !isGeenInzet(e))
    const sortedEntries = [...filteredEntries].sort((a, b) => new Date(a.datum).getTime() - new Date(b.datum).getTime())

    const firstEntry = sortedEntries[0]
    const resolvedWeekNumber = firstEntry ? firstEntry.weeknummer : null
    const resolvedWeekYear = firstEntry ? new Date(firstEntry.datum).getFullYear() : null
    const resolvedChauffeur = firstEntry ? firstEntry.user : null
    const resolvedChauffeurNaam = firstEntry ? (firstEntry.user_naam || null) : null

    let totalKm = 0
    const fmtTime = (t: string | null | undefined): string | null => {
      if (!t) return null
      const m = String(t).match(/^(\d{1,2}):(\d{2})/)
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
    }

    const buildWorkTimeLine = (begin: string | null, eind: string | null): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      const tekst = `Werktijden: ${begin || '-'} - ${eind || '-'}`
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = tekst
        } else {
          values[col.id] = 0
        }
      })
      return { id: generateId(), values, isInfoLine: true }
    }

    const entryLines: InvoiceLineData[] = sortedEntries.flatMap(entry => {
      const values: Record<string, number | string> = {}
      const [h, m] = (entry.totaal_uren || '0:00').split(':').map(Number)
      const uren = roundUren(h + (m / 60))
      const km = entry.totaal_km || 0
      totalKm += km

      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving') {
          values[col.id] = `Rit ${entry.ritnummer} - ${new Date(entry.datum).toLocaleDateString('nl-NL')} (${km} km)`
        } else if (col.type === 'aantal' || col.id === 'aantal') {
          values[col.id] = uren
        } else if (col.type === 'prijs' || col.id === 'prijs') {
          values[col.id] = defaults.uurtarief
        } else if (col.type === 'uren' || col.id.includes('uur')) {
          values[col.id] = uren
        } else if (col.type === 'km' || col.id.includes('km')) {
          values[col.id] = km
        } else {
          values[col.id] = 0
        }
      })

      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })

      const mainLine: InvoiceLineData = {
        id: generateId(),
        values,
        timeEntryId: entry.id,
      }

      if (showWorkTimes) {
        const begin = fmtTime(entry.aanvang)
        const eind = fmtTime(entry.eind)
        if (begin || eind) return [mainLine, buildWorkTimeLine(begin, eind)]
      }

      return [mainLine]
    })

    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    const entriesSubtotaal = entryLines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)

    const createSummaryLine = (omschrijving: string, aantal: number, prijs: number): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = omschrijving
        } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
          values[col.id] = aantal
        } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
          values[col.id] = prijs
        } else {
          values[col.id] = 0
        }
      })
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      return { id: generateId(), values }
    }

    const summaryLines: InvoiceLineData[] = []
    if (defaults.dotIsPercentage) {
      if (defaults.dotPrijs > 0) {
        const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
        summaryLines.push(createSummaryLine(`Totaal DOT (${defaults.dotPrijs}%)`, 1, dotBedrag))
      }
    } else {
      if (totalKm > 0 && defaults.kmTarief > 0) {
        summaryLines.push(createSummaryLine('Totaal KM', totalKm, defaults.kmTarief))
      }
      if (totalKm > 0 && defaults.dotPrijs > 0) {
        summaryLines.push(createSummaryLine('Totaal DOT', totalKm, defaults.dotPrijs))
      }
    }

    const kilometerheffingLines: InvoiceLineData[] = sortedEntries
      .filter(entry => entry.kilometerheffing_bedrag != null && String(entry.kilometerheffing_bedrag).trim() !== '')
      .map(entry => {
        const bedrag = parseFloat(String(entry.kilometerheffing_bedrag)) || 0
        const datumStr = new Date(entry.datum).toLocaleDateString('nl-NL')
        const omschrijving = `Kilometerheffing rit ${entry.ritnummer} - ${datumStr}`
        const values: Record<string, number | string> = {}
        columns.forEach(col => {
          if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
            values[col.id] = omschrijving
          } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
            values[col.id] = 1
          } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
            values[col.id] = bedrag
          } else {
            values[col.id] = 0
          }
        })
        columns.forEach(col => {
          if (col.type === 'berekend' && col.formule) {
            values[col.id] = evaluateFormula(col.formule, values, defaults)
          }
        })
        return { id: generateId(), values, kilometerheffingTimeEntryId: entry.id }
      })

    return {
      lines: [...entryLines, ...summaryLines, ...kilometerheffingLines],
      weekNumber: resolvedWeekNumber,
      weekYear: resolvedWeekYear,
      chauffeur: resolvedChauffeur,
      chauffeurNaam: resolvedChauffeurNaam,
    }
  }, [columns, defaults, showWorkTimes])

  const buildLinesFromImportedEntries = useCallback((entries: ImportedTimeEntry[], chauffeurEntries: TimeEntry[]) => {
    const isNietGereden = (e: ImportedTimeEntry) => {
      const haystack = [e.ritlijst, e.periode, e.dot, e.kenteken_import].map(v => String(v ?? '').toLowerCase()).join(' ')
      return haystack.includes('niet gereden')
    }
    const isGeenInzetImported = (e: ImportedTimeEntry) => {
      const rit = String(e.ritlijst || '').trim().toLowerCase()
      const km = e.user ? (chauffeurEntries.find(c => c.user === e.user && c.datum === e.datum)?.totaal_km || 0) : 0
      return (rit === '' || rit === 'geen inzet') && km === 0
    }

    const validEntries = entries.filter(e => !isNietGereden(e) && !isGeenInzetImported(e))
    const sortedEntries = [...validEntries].sort((a, b) => new Date(a.datum).getTime() - new Date(b.datum).getTime())
    const first = sortedEntries[0]

    const resolvedWeekNumber = first ? first.weeknummer : null
    const resolvedWeekYear = first ? new Date(first.datum).getFullYear() : null
    const resolvedChauffeur = first?.user || null
    const resolvedChauffeurNaam = first ? (first.user_naam || null) : null

    const chauffeurKmMap: Record<string, number> = {}
    chauffeurEntries.forEach(e => {
      chauffeurKmMap[`${e.user}|${e.datum}`] = e.totaal_km || 0
    })

    let totalKm = 0
    const fmtTime = (t: string | null | undefined): string | null => {
      if (!t) return null
      const m = String(t).match(/^(\d{1,2}):(\d{2})/)
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
    }

    const buildWorkTimeLine = (begin: string | null, eind: string | null): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      const tekst = `Werktijden: ${begin || '-'} - ${eind || '-'}`
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = tekst
        } else {
          values[col.id] = 0
        }
      })
      return { id: generateId(), values, isInfoLine: true }
    }

    const entryLines: InvoiceLineData[] = sortedEntries.flatMap(entry => {
      const values: Record<string, number | string> = {}
      const uren = roundUren(Number(entry.uren_factuur))
      const km = entry.user ? (chauffeurKmMap[`${entry.user}|${entry.datum}`] || 0) : 0
      totalKm += km

      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving') {
          values[col.id] = `Rit ${entry.ritlijst} - ${new Date(entry.datum).toLocaleDateString('nl-NL')} (${km} km)`
        } else if (col.type === 'aantal' || col.id === 'aantal') {
          values[col.id] = uren
        } else if (col.type === 'prijs' || col.id === 'prijs') {
          values[col.id] = defaults.uurtarief
        } else if (col.type === 'uren' || col.id.includes('uur')) {
          values[col.id] = uren
        } else if (col.type === 'km' || col.id.includes('km')) {
          values[col.id] = km
        } else {
          values[col.id] = 0
        }
      })

      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })

      const mainLine: InvoiceLineData = { id: generateId(), values }
      if (showWorkTimes) {
        const begin = fmtTime(entry.begintijd_rit)
        const eind = fmtTime(entry.eindtijd_rit)
        if (begin || eind) return [mainLine, buildWorkTimeLine(begin, eind)]
      }
      return [mainLine]
    })

    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
    const entriesSubtotaal = entryLines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)

    const createSummaryLine = (omschrijving: string, aantal: number, prijs: number): InvoiceLineData => {
      const values: Record<string, number | string> = {}
      columns.forEach(col => {
        if (col.type === 'text' || col.id === 'omschrijving' || col.id.includes('omschrijving')) {
          values[col.id] = omschrijving
        } else if (col.type === 'aantal' || col.id === 'aantal' || col.id.includes('aantal')) {
          values[col.id] = aantal
        } else if (col.type === 'prijs' || col.id === 'prijs' || col.id.includes('prijs') || col.id.includes('tarief')) {
          values[col.id] = prijs
        } else {
          values[col.id] = 0
        }
      })
      columns.forEach(col => {
        if (col.type === 'berekend' && col.formule) {
          values[col.id] = evaluateFormula(col.formule, values, defaults)
        }
      })
      return { id: generateId(), values }
    }

    const summaryLines: InvoiceLineData[] = []
    if (defaults.dotIsPercentage) {
      if (defaults.dotPrijs > 0) {
        const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
        summaryLines.push(createSummaryLine(`Totaal DOT (${defaults.dotPrijs}%)`, 1, dotBedrag))
      }
    } else {
      if (totalKm > 0 && defaults.kmTarief > 0) {
        summaryLines.push(createSummaryLine('Totaal KM', totalKm, defaults.kmTarief))
      }
      if (totalKm > 0 && defaults.dotPrijs > 0) {
        summaryLines.push(createSummaryLine('Totaal DOT', totalKm, defaults.dotPrijs))
      }
    }

    return {
      lines: [...entryLines, ...summaryLines],
      weekNumber: resolvedWeekNumber,
      weekYear: resolvedWeekYear,
      chauffeur: resolvedChauffeur,
      chauffeurNaam: resolvedChauffeurNaam,
    }
  }, [columns, defaults, showWorkTimes])

  const persistInvoiceLines = useCallback(async (invoiceId: string, linesToPersist: InvoiceLineData[]) => {
    const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]

    for (const [index, line] of linesToPersist.entries()) {
      const omschrijvingCol = columns.find(c => c.type === 'text' || c.id === 'omschrijving')
      const aantalCol = columns.find(c => c.type === 'aantal' || c.id === 'aantal')
      const prijsCol = columns.find(c => c.type === 'prijs' || c.id.includes('prijs') || c.id.includes('tarief'))
      const roundTo2 = (n: number) => Math.round(n * 100) / 100

      const lineData: any = {
        invoice: invoiceId,
        volgorde: index,
        omschrijving: omschrijvingCol ? String(line.values[omschrijvingCol.id]) : 'Regel',
        aantal: line.isInfoLine ? 0 : roundTo2(aantalCol ? Number(line.values[aantalCol.id]) || 1 : 1),
        prijs_per_eenheid: line.isInfoLine ? 0 : roundTo2(prijsCol
          ? Number(line.values[prijsCol.id]) || 0
          : totaalColumn
            ? Number(line.values[totaalColumn.id]) || 0
            : 0),
      }

      if (line.isInfoLine) {
        lineData.extra_data = { info_line: true }
      }
      if (line.timeEntryId) {
        lineData.time_entry = line.timeEntryId
      }
      if (line.kilometerheffingTimeEntryId) {
        lineData.extra_data = { ...(lineData.extra_data || {}), kind: 'kilometerheffing', time_entry: line.kilometerheffingTimeEntryId }
      }

      await createInvoiceLine(lineData)
    }

    const heffingIds = Array.from(new Set(
      linesToPersist.map(l => l.kilometerheffingTimeEntryId).filter((x): x is string => !!x)
    ))
    if (heffingIds.length > 0) {
      try {
        await markKilometerheffingGefactureerd(heffingIds)
      } catch {
        // niet-fataal: factuur is opgeslagen
      }
    }
  }, [columns])

  const saveBatchDraft = async (draftId: string) => {
    if (!selectedTemplate || !selectedCompany || !selectedAdministratie) {
      setError('Template, bedrijf en administratie zijn verplicht om batchfacturen op te slaan.')
      return
    }

    const draft = batchDrafts.find(d => d.id === draftId)
    if (!draft) return

    setSavingBatchDraftId(draftId)
    setError(null)
    try {
      const invoiceData: any = {
        template: selectedTemplate.id,
        bedrijf: selectedCompany,
        administratie: selectedAdministratie,
        type: invoiceType,
        factuurdatum,
        vervaldatum,
        btw_percentage: totalsConfig.btwPercentage,
        opmerkingen,
      }

      if (draft.weekNumber !== null) {
        invoiceData.week_number = draft.weekNumber
      }
      if (draft.weekYear !== null) {
        invoiceData.week_year = draft.weekYear
      }
      if (draft.chauffeur !== null) {
        invoiceData.chauffeur = draft.chauffeur
      }

      const dotTrimmed = dotPercentageOverride.trim()
      if (dotTrimmed !== '') {
        const dotParsed = parseFloat(dotTrimmed.replace(',', '.'))
        if (!isNaN(dotParsed)) {
          invoiceData.dot_percentage = dotParsed
        }
      }

      const invoice = await createInvoice(invoiceData)
      await persistInvoiceLines(invoice.id, draft.lines)

      setBatchDrafts(prev => {
        const remaining = prev.filter(d => d.id !== draftId)
        if (expandedBatchDraftId === draftId) {
          setExpandedBatchDraftId(remaining[0]?.id || null)
        }
        return remaining
      })
    } catch (err: any) {
      const errorMessage = err.message || err.response?.data?.detail || t('errors.saveFailed')
      setError(errorMessage)
    } finally {
      setSavingBatchDraftId(null)
    }
  }

  // Save invoice
  const handleSave = async () => {
    if (!selectedTemplate) {
      setError(t('invoices.selectTemplateError'))
      return
    }
    if (!selectedCompany) {
      setError(t('invoices.selectCompanyError'))
      return
    }
    if (!selectedAdministratie) {
      setError(t('invoices.selectAdministratieError', 'Selecteer een administratie'))
      return
    }
    if (lines.length === 0) {
      setError(t('invoices.addLineError'))
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      // Create invoice with optional week/chauffeur tracking
      const invoiceData: any = {
        template: selectedTemplate.id,
        bedrijf: selectedCompany,
        administratie: selectedAdministratie,
        type: invoiceType,
        factuurdatum,
        vervaldatum,
        btw_percentage: totalsConfig.btwPercentage,
        opmerkingen,
      }
      
      // Add week/chauffeur if available (from imported time entries)
      if (weekNumber !== null) {
        invoiceData.week_number = weekNumber
      }
      if (weekYear !== null) {
        invoiceData.week_year = weekYear
      }
      if (chauffeur !== null) {
        invoiceData.chauffeur = chauffeur
      }
      // Optional DOT percentage override (gebruikt om template default te overrulen)
      const dotTrimmed = dotPercentageOverride.trim()
      if (dotTrimmed !== '') {
        const dotParsed = parseFloat(dotTrimmed.replace(',', '.'))
        if (!isNaN(dotParsed)) {
          invoiceData.dot_percentage = dotParsed
        }
      }
      
      let invoiceId: string
      if (reimportId) {
        // Reimport: update fields that the backend allows on existing invoice + delete old lines.
        // NOTE: template, bedrijf, factuurdatum, type kunnen niet meer worden gewijzigd op een
        // bestaande factuur (backend InvoiceUpdateSerializer staat dit niet toe).
        await updateInvoice(reimportId, {
          vervaldatum,
          btw_percentage: totalsConfig.btwPercentage,
          opmerkingen,
          administratie: selectedAdministratie,
        } as any)
        const existingLines = await getInvoiceLines(reimportId)
        await Promise.all(existingLines.map(l => deleteInvoiceLine(l.id)))
        invoiceId = reimportId
      } else {
        const invoice = await createInvoice(invoiceData)
        invoiceId = invoice.id
      }

      await persistInvoiceLines(invoiceId, lines)

      // Navigate back
      navigate(reimportId ? `/invoices/${reimportId}/edit` : '/invoices')
    } catch (err: any) {
      // Parse error message from Error object or API response
      const errorMessage = err.message || err.response?.data?.detail || 
        (err.response?.data && typeof err.response.data === 'object' 
          ? Object.entries(err.response.data)
              .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
              .join('; ')
          : t('errors.saveFailed'))
      setError(errorMessage)
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

  return (
    <div className="space-y-6 min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate('/invoices')}
            className="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">
              {reimportId ? `Opnieuw importeren: ${factuurnummer || ''}` : t('invoices.newInvoice')}
            </h1>
            <p className="text-sm text-gray-500">
              {reimportId
                ? 'Bestaande regels worden vervangen door de nieuwe import zodra je opslaat'
                : t('invoices.createInvoiceDescription')}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving || isBatchMode || !selectedTemplate || !selectedCompany || !selectedAdministratie}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
        >
          {isSaving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
          {isBatchMode ? 'Batch actief: opslaan via tabs hieronder' : t('invoices.saveInvoice')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <XCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Step 1: Select Template */}
      <div className="card p-4 sm:p-6 min-w-0">
        <h2 className="text-lg font-semibold mb-4">1. {t('invoices.selectTemplate')}</h2>
        {templates.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>{t('templates.noTemplates')}</p>
            <button
              onClick={() => navigate('/invoices/templates/new')}
              className="mt-2 text-primary-600 hover:text-primary-700"
            >
              {t('templates.createFirstTemplate')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={selectedTemplate?.id === template.id}
                onSelect={() => {
                  setSelectedTemplate(template)
                  setLines([]) // Reset lines when changing template
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Invoice Details */}
      {selectedTemplate && (
        <div className="card p-4 sm:p-6 min-w-0">
          <h2 className="text-lg font-semibold mb-4">2. {t('invoices.invoiceDetails')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.company')} *</label>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="">{t('invoices.selectCompany')}...</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.naam}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.administratie', 'Administratie')} *</label>
              <select
                value={selectedAdministratie}
                onChange={(e) => setSelectedAdministratie(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="">{t('invoices.selectAdministratie', 'Selecteer administratie')}...</option>
                {administraties.map((adm) => (
                  <option key={adm.id} value={adm.id}>{adm.naam}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.type')}</label>
              <select
                value={invoiceType}
                onChange={(e) => {
                  const newType = e.target.value as 'verkoop' | 'inkoop' | 'credit'
                  setInvoiceType(newType)
                  loadNextInvoiceNumber(newType, selectedAdministratie || null)
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="verkoop">{t('invoices.salesInvoice')} (F-)</option>
                <option value="credit">{t('invoices.creditInvoice')} (C-)</option>
                <option value="inkoop">{t('invoices.purchaseInvoice')} (I-)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.invoiceNumber')}</label>
              <input
                type="text"
                value={factuurnummer}
                disabled
                className="w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-gray-700 font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">{t('invoices.autoGenerated')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.invoiceDate')}</label>
              <input
                type="date"
                value={factuurdatum}
                onChange={(e) => setFactuurdatum(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.dueDate')}</label>
              <input
                type="date"
                value={vervaldatum}
                onChange={(e) => setVervaldatum(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                DOT {templateLayout?.defaults?.dotIsPercentage === false ? '(prijs/km)' : '%'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={dotPercentageOverride}
                onChange={(e) => setDotPercentageOverride(e.target.value)}
                placeholder={
                  templateLayout?.defaults
                    ? `Template: ${templateLayout.defaults.dotPrijs}${templateLayout.defaults.dotIsPercentage ? '%' : ''}`
                    : ''
                }
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-500 mt-1">Overruled de template waarde</p>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.notes')}</label>
            <textarea
              value={opmerkingen}
              onChange={(e) => setOpmerkingen(e.target.value)}
              rows={2}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              placeholder={t('invoices.optionalNotes')}
            />
          </div>
        </div>
      )}

      {/* Step 3: Invoice Lines */}
      {selectedTemplate && columns.length > 0 && !isBatchMode && (
        <div className="card p-4 sm:p-6 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold">3. {t('invoices.lines')}</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="flex items-center gap-2 text-sm text-gray-700 mr-2 select-none cursor-pointer" title="Voegt onder elke rit/dag een extra regel toe met begin- en eindtijd">
                <input
                  type="checkbox"
                  checked={showWorkTimes}
                  onChange={(e) => setShowWorkTimes(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Toon werktijden op factuur
              </label>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <ClockIcon className="h-4 w-4" />
                {t('invoices.importHours')}
              </button>
              <button
                onClick={() => setShowSpreadsheetImportModal(true)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <CalculatorIcon className="h-4 w-4" />
                {t('invoices.importSpreadsheet')}
              </button>
              <button
                onClick={() => setShowTolImportModal(true)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <ReceiptPercentIcon className="h-4 w-4" />
                Tol importeren
              </button>
              <button
                onClick={addLine}
                className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-2"
              >
                <PlusIcon className="h-4 w-4" />
                {t('invoices.addLine')}
              </button>
            </div>
          </div>

          {/* Invoice Header Preview */}
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Factuurnummer</p>
                <p className="text-lg font-bold font-mono text-gray-900">{factuurnummer || '-'}</p>
              </div>
              <div className="text-right">
                <div className="mb-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Factuurdatum</p>
                  <p className="font-medium text-gray-900">
                    {factuurdatum ? new Date(factuurdatum).toLocaleDateString('nl-NL', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    }) : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Vervaldatum</p>
                  <p className="font-medium text-gray-900">
                    {vervaldatum ? new Date(vervaldatum).toLocaleDateString('nl-NL', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    }) : '-'}
                  </p>
                </div>
              </div>
            </div>
            {selectedCompany && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{t('invoices.customer')}</p>
                <p className="font-medium text-gray-900">
                  {companies.find(c => c.id === selectedCompany)?.naam || '-'}
                </p>
              </div>
            )}
          </div>

          {/* Template columns info */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-blue-800 text-sm">
              <CalculatorIcon className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium">Template kolommen:</span>
              {columns.map((col, i) => (
                <span key={col.id} className="inline-flex items-center">
                  {i > 0 && <span className="mx-1">→</span>}
                  <code className="bg-blue-100 px-1 rounded text-xs">{col.naam}</code>
                  {col.type === 'berekend' && col.formule && (
                    <span className="text-xs text-blue-600 ml-1">({col.formule})</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Lines Table */}
          {lines.length === 0 ? (
            <div className="text-center py-12 text-gray-500 border-2 border-dashed rounded-lg">
              <p className="mb-2">{t('invoices.noLinesYet')}</p>
              <p className="text-sm">{t('invoices.clickToAddLines')}</p>
            </div>
          ) : (
            <>
              {/* Table layout for md+ screens */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      {columns.map((col) => (
                        <th
                          key={col.id}
                          className="px-3 py-2 text-left font-semibold text-gray-700"
                          style={{ width: `${col.breedte}%` }}
                        >
                          {col.naam}
                          {col.type === 'berekend' && (
                            <span className="ml-1 text-xs font-normal text-gray-400">(auto)</span>
                          )}
                        </th>
                      ))}
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <InvoiceLineRow
                        key={line.id}
                        line={line}
                        columns={columns}
                        defaults={defaults}
                        onUpdate={updateLine}
                        onDelete={deleteLine}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Card layout for small screens */}
              <div className="md:hidden space-y-3">
                {lines.map((line, index) => (
                  <InvoiceLineCard
                    key={line.id}
                    line={line}
                    index={index}
                    columns={columns}
                    defaults={defaults}
                    onUpdate={updateLine}
                    onDelete={deleteLine}
                  />
                ))}
              </div>
            </>
          )}

          {/* Totals */}
          {lines.length > 0 && (
            <div className="mt-6 flex justify-end">
              <div className="w-full sm:w-72 bg-gray-50 rounded-lg p-4">
                {totalsConfig.showSubtotaal && (
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600">{t('invoices.subtotalExclVat')}:</span>
                    <span className="font-medium">{formatCurrency(calculateTotals.subtotaal)}</span>
                  </div>
                )}
                {totalsConfig.showBtw && (
                  <div className="flex justify-between py-1">
                    <span className="text-gray-600">{t('invoices.vat')} ({totalsConfig.btwPercentage}%):</span>
                    <span className="font-medium">{formatCurrency(calculateTotals.btw)}</span>
                  </div>
                )}
                {totalsConfig.showTotaal && (
                  <div className="flex justify-between py-2 border-t border-gray-300 mt-2 text-lg font-bold">
                    <span>{t('invoices.totalInclVat')}:</span>
                    <span className="text-primary-600">{formatCurrency(calculateTotals.totaal)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Losse facturen (batch) - editable tabs at the bottom */}
      {isBatchMode && (
        <div className="card p-4 sm:p-6 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Losse facturen</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowTolImportModal(true)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <ReceiptPercentIcon className="h-4 w-4" />
                Tol importeren
              </button>
              <span className="text-sm text-gray-500">{batchDrafts.length} open</span>
            </div>
          </div>
          <div className="space-y-3">
            {batchDrafts.map((draft) => {
              const isExpanded = expandedBatchDraftId === draft.id
              const draftTotals = calculateDraftTotals(draft.lines)
              return (
                <div key={draft.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedBatchDraftId(prev => (prev === draft.id ? null : draft.id))}
                      className="flex items-center gap-2 min-w-0"
                    >
                      {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-gray-500" /> : <ChevronRightIcon className="h-4 w-4 text-gray-500" />}
                      <span className="font-mono font-semibold text-gray-900">{draft.factuurnummer}</span>
                      <span className="text-sm text-gray-600">
                        {draft.chauffeurNaam ? `${draft.chauffeurNaam} · ` : ''}{draft.weekNumber ? `Week ${draft.weekNumber}` : 'Week onbekend'} {draft.weekYear || ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => saveBatchDraft(draft.id)}
                      disabled={savingBatchDraftId !== null}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 flex-shrink-0"
                    >
                      {savingBatchDraftId === draft.id ? 'Opslaan...' : 'Factuur opslaan'}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="p-4">
                      <div className="flex justify-end mb-3">
                        <button
                          type="button"
                          onClick={() => addBatchLine(draft.id)}
                          className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-2"
                        >
                          <PlusIcon className="h-4 w-4" />
                          {t('invoices.addLine')}
                        </button>
                      </div>

                      {draft.lines.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                          <p className="text-sm">{t('invoices.noLinesYet')}</p>
                        </div>
                      ) : (
                        <>
                          {/* Table layout for md+ screens */}
                          <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b-2 border-gray-200">
                                  {columns.map((col) => (
                                    <th
                                      key={col.id}
                                      className="px-3 py-2 text-left font-semibold text-gray-700"
                                      style={{ width: `${col.breedte}%` }}
                                    >
                                      {col.naam}
                                      {col.type === 'berekend' && (
                                        <span className="ml-1 text-xs font-normal text-gray-400">(auto)</span>
                                      )}
                                    </th>
                                  ))}
                                  <th className="w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {draft.lines.map((line) => (
                                  <InvoiceLineRow
                                    key={line.id}
                                    line={line}
                                    columns={columns}
                                    defaults={defaults}
                                    onUpdate={(lineId, values) => updateBatchLine(draft.id, lineId, values)}
                                    onDelete={(lineId) => deleteBatchLine(draft.id, lineId)}
                                  />
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Card layout for small screens */}
                          <div className="md:hidden space-y-3">
                            {draft.lines.map((line, index) => (
                              <InvoiceLineCard
                                key={line.id}
                                line={line}
                                index={index}
                                columns={columns}
                                defaults={defaults}
                                onUpdate={(lineId, values) => updateBatchLine(draft.id, lineId, values)}
                                onDelete={(lineId) => deleteBatchLine(draft.id, lineId)}
                              />
                            ))}
                          </div>

                          {/* Totals */}
                          <div className="mt-4 flex justify-end">
                            <div className="w-full sm:w-72 bg-gray-50 rounded-lg p-4">
                              {totalsConfig.showSubtotaal && (
                                <div className="flex justify-between py-1">
                                  <span className="text-gray-600">{t('invoices.subtotalExclVat')}:</span>
                                  <span className="font-medium">{formatCurrency(draftTotals.subtotaal)}</span>
                                </div>
                              )}
                              {totalsConfig.showBtw && (
                                <div className="flex justify-between py-1">
                                  <span className="text-gray-600">{t('invoices.vat')} ({totalsConfig.btwPercentage}%):</span>
                                  <span className="font-medium">{formatCurrency(draftTotals.btw)}</span>
                                </div>
                              )}
                              {totalsConfig.showTotaal && (
                                <div className="flex justify-between py-2 border-t border-gray-300 mt-2 text-lg font-bold">
                                  <span>{t('invoices.totalInclVat')}:</span>
                                  <span className="text-primary-600">{formatCurrency(draftTotals.totaal)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Time Entry Import Modal */}
      <TimeEntryImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportEntries}
        onImportImported={handleImportImportedEntries}
        showWorkTimes={showWorkTimes}
        setShowWorkTimes={setShowWorkTimes}
      />

      {/* Spreadsheet Import Modal */}
      <SpreadsheetImportModal
        isOpen={showSpreadsheetImportModal}
        onClose={() => setShowSpreadsheetImportModal(false)}
        onImport={handleImportSpreadsheet}
      />

      {/* Tol Import Modal */}
      <TolImportModal
        isOpen={showTolImportModal}
        onClose={() => setShowTolImportModal(false)}
        onImport={handleImportTol}
        targets={tolTargets}
      />
    </div>
  )
}
