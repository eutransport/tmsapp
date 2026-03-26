/**
 * Invoice Create Page
 * Full-page invoice creation with:
 * - Template selection
 * - Dynamic line items based on template columns
 * - Automatic calculations based on template formulas
 * - Import time entries by week
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
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
  PaperClipIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { getTemplates, createInvoice, createInvoiceLine, getNextInvoiceNumber, uploadInvoiceBijlage } from '@/api/invoices'
import { getCompanies } from '@/api/companies'
import { getTimeEntries } from '@/api/timetracking'
import { getSpreadsheets } from '@/api/spreadsheets'
import { getImportedEntries, ImportedTimeEntry } from '@/api/urenImport'
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

interface InvoiceLineData {
  id: string // Local temp id
  values: Record<string, number | string> // Column values by column id
  timeEntryId?: string // If imported from time entry
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
      return safeMathEval(expression) || 0
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
        w-full box-border overflow-hidden border-2 rounded-lg p-4 cursor-pointer min-h-[80px]
        ${selected
          ? 'border-gray-300 bg-primary-50 shadow-inner'
          : 'border-gray-300 hover:bg-gray-50 bg-white'}
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{template.naam}</h3>
          {template.beschrijving && (
            <p className="text-sm text-gray-500 mt-1">{template.beschrijving}</p>
          )}
        </div>
        <CheckCircleIcon className={`h-6 w-6 flex-shrink-0 ${selected ? 'text-primary-500' : 'invisible'}`} />
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

// Time Entry Import Modal - Shows entries grouped by week + chauffeur + bedrijf
function TimeEntryImportModal({
  isOpen,
  onClose,
  onImport,
  onImportImported,
}: {
  isOpen: boolean
  onClose: () => void
  onImport: (entries: TimeEntry[]) => void
  onImportImported: (entries: ImportedTimeEntry[], chauffeurEntries: TimeEntry[]) => void
}) {
  const [activeTab, setActiveTab] = useState<'chauffeur' | 'imported'>('chauffeur')
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

  useEffect(() => {
    if (isOpen) {
      loadTimeEntries()
      loadImportedEntries()
      setCurrentPage(1)
      setImportedPage(1)
      setWeekFilter('')
      setImportedWeekFilter('')
      setActiveTab('chauffeur')
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
    onImport(entriesToImport)
    onClose()
  }

  const handleImportImported = () => {
    const entriesToImport: ImportedTimeEntry[] = []
    importedGroups.forEach(group => {
      if (group.selected) {
        entriesToImport.push(...group.entries)
      }
    })
    onImportImported(entriesToImport, chauffeurEntriesForMatch)
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
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
          {/* Header with tabs */}
          <div className="border-b">
            <div className="px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Uren Importeren</h3>
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
                Chauffeur Uren
              </button>
              <button
                onClick={() => setActiveTab('imported')}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'imported'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Geïmporteerde Uren
              </button>
            </div>
          </div>

          {/* Tab: Chauffeur Uren */}
          {activeTab === 'chauffeur' && (
            <>
              {/* Filter bar */}
              {availableWeeks.length > 0 && (
                <div className="px-6 py-2 border-b bg-gray-50 flex items-center gap-2">
                  <span className="text-sm text-gray-500">Filter:</span>
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
                    <p>Geen ingediende uren gevonden</p>
                    <p className="text-sm mt-1">Alleen ingediende uren kunnen worden geïmporteerd</p>
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
                          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Vorige</button>
                          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Volgende</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {selectedCount > 0 ? <>{selectedCount} groepen geselecteerd ({totalEntries} regels)</> : 'Selecteer chauffeur/week combinaties om te importeren'}
                </span>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Annuleren</button>
                  <button onClick={handleImport} disabled={totalEntries === 0} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    Importeren ({totalEntries} regels)
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
                  <span className="text-sm text-gray-500">Filter:</span>
                  <select
                    value={importedWeekFilter}
                    onChange={(e) => setImportedWeekFilter(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Alle weken</option>
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
                    <p>Geen geïmporteerde uren gevonden</p>
                    <p className="text-sm mt-1">Importeer eerst uren via de Uren Import pagina</p>
                  </div>
                ) : filteredImportedGroups.length === 0 ? (
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
                          <button onClick={() => setImportedPage(p => Math.max(1, p - 1))} disabled={importedPage === 1} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Vorige</button>
                          <button onClick={() => setImportedPage(p => Math.min(totalImportedPages, p + 1))} disabled={importedPage === totalImportedPages} className="px-3 py-1 text-sm border rounded-md hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Volgende</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {selectedImportedCount > 0 ? <>{selectedImportedCount} groepen geselecteerd ({totalImportedEntries} ritten)</> : 'Selecteer chauffeur/week combinaties om te importeren'}
                </span>
                <div className="flex gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Annuleren</button>
                  <button onClick={handleImportImported} disabled={totalImportedEntries === 0} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    Importeren ({totalImportedEntries} ritten)
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
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col">
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
                <>1 ritregistratie geselecteerd ({spreadsheets.find(s => s.id === selectedId)?.rijen.length || 0} ritten)</>
              ) : (
                'Selecteer een ritregistratie om te importeren'
              )}
            </span>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleImport}
                disabled={!selectedId}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Importeren
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
  
  // Data state
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  
  // Form state
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [invoiceType, setInvoiceType] = useState<'verkoop' | 'inkoop' | 'credit'>('verkoop')
  const [factuurnummer, setFactuurnummer] = useState<string>('')
  const [factuurdatum, setFactuurdatum] = useState(new Date().toISOString().split('T')[0])
  const [vervaldatum, setVervaldatum] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [opmerkingen, setOpmerkingen] = useState('')
  const [bijlage, setBijlage] = useState<File | null>(null)
  const [lines, setLines] = useState<InvoiceLineData[]>([])
  
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
  
  // Get template layout
  const templateLayout = useMemo(() => {
    if (!selectedTemplate?.layout) return null
    return selectedTemplate.layout as TemplateLayout
  }, [selectedTemplate])

  const columns = useMemo(() => templateLayout?.columns || [], [templateLayout])
  const defaults = useMemo(() => templateLayout?.defaults || {
    uurtarief: 45,
    dotPrijs: 21,
    dotIsPercentage: true,
    kmTarief: 0.23,
  }, [templateLayout])
  const totalsConfig = useMemo(() => templateLayout?.totals || {
    showSubtotaal: true,
    showBtw: true,
    showTotaal: true,
    btwPercentage: 21,
  }, [templateLayout])

  // Load next invoice number when type changes
  const loadNextInvoiceNumber = useCallback(async (type: 'verkoop' | 'inkoop' | 'credit') => {
    try {
      const result = await getNextInvoiceNumber(type)
      setFactuurnummer(result.factuurnummer)
    } catch (err) {
      console.error('Could not load next invoice number:', err)
    }
  }, [])

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [templatesRes, companiesRes] = await Promise.all([
          getTemplates(true),
          getCompanies({ page_size: 1000 }),
        ])
        setTemplates(templatesRes.results)
        setCompanies(companiesRes.results)
        
        // Load initial invoice number
        await loadNextInvoiceNumber('verkoop')
      } catch (err) {
        setError(t('errors.loadFailed'))
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [])

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

  // Import time entries with automatic KM and DOT calculations
  const handleImportEntries = (entries: TimeEntry[]) => {
    // Sort entries by date ascending (oldest first)
    const sortedEntries = [...entries].sort((a, b) => 
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
    
    // Create lines for each time entry (day)
    const entryLines: InvoiceLineData[] = sortedEntries.map(entry => {
      const values: Record<string, number | string> = {}
      
      // Parse uren
      const [h, m] = (entry.totaal_uren || '0:00').split(':').map(Number)
      const uren = h + (m / 60)
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
      
      return {
        id: generateId(),
        values,
        timeEntryId: entry.id,
      }
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
      const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
      summaryLines.push(createSummaryLine(
        `Totaal DOT (${defaults.dotPrijs}%)`,
        1,
        dotBedrag
      ))
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
    
    // Combine all lines
    setLines(prev => [...prev, ...entryLines, ...summaryLines])
  }

  // Import imported (Excel) entries with ritnummers from import, km from chauffeur, uren from import
  const handleImportImportedEntries = (entries: ImportedTimeEntry[], chauffeurEntries: TimeEntry[]) => {
    // Sort entries by date ascending
    const sortedEntries = [...entries].sort((a, b) =>
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

    // Create lines for each imported entry
    const entryLines: InvoiceLineData[] = sortedEntries.map(entry => {
      const values: Record<string, number | string> = {}

      const uren = entry.uren_factuur || 0
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

      return { id: generateId(), values }
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
      const dotBedrag = entriesSubtotaal * (defaults.dotPrijs / 100)
      summaryLines.push(createSummaryLine(`Totaal DOT (${defaults.dotPrijs}%)`, 1, dotBedrag))
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
      
      const uren = Math.max(0, eindTijd - beginTijd - pauze - correctie)
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
    
    let subtotaal = lines.reduce((sum, line) => {
      const val = totaalColumn ? (line.values[totaalColumn.id] as number || 0) : 0
      return sum + val
    }, 0)
    
    // Creditfacturen: bedragen negatief tonen
    if (invoiceType === 'credit') {
      subtotaal = -Math.abs(subtotaal)
    }
    
    const btw = subtotaal * (totalsConfig.btwPercentage / 100)
    const totaal = subtotaal + btw
    
    return { subtotaal, btw, totaal }
  }, [lines, columns, totalsConfig, invoiceType])

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
      
      const invoice = await createInvoice(invoiceData)

      // Upload bijlage if provided
      if (bijlage) {
        await uploadInvoiceBijlage(invoice.id, bijlage)
      }

      // Create invoice lines
      const totaalColumn = columns.find(c => c.type === 'berekend') || columns[columns.length - 1]
      
      for (const line of lines) {
        // Find omschrijving column
        const omschrijvingCol = columns.find(c => c.type === 'text' || c.id === 'omschrijving')
        const aantalCol = columns.find(c => c.type === 'aantal' || c.id === 'aantal')
        const prijsCol = columns.find(c => c.type === 'prijs' || c.id.includes('prijs') || c.id.includes('tarief'))
        
        // Round values to 2 decimals to prevent backend validation errors
        const roundTo2 = (n: number) => Math.round(n * 100) / 100
        
        const lineData: any = {
          invoice: invoice.id,
          omschrijving: omschrijvingCol ? String(line.values[omschrijvingCol.id]) : 'Regel',
          aantal: roundTo2(aantalCol ? Number(line.values[aantalCol.id]) || 1 : 1),
          prijs_per_eenheid: roundTo2(prijsCol 
            ? Number(line.values[prijsCol.id]) || 0 
            : totaalColumn 
              ? Number(line.values[totaalColumn.id]) || 0 
              : 0),
        }
        
        // Only add time_entry if it exists
        if (line.timeEntryId) {
          lineData.time_entry = line.timeEntryId
        }
        
        try {
          await createInvoiceLine(lineData)
        } catch (lineErr: any) {
          // Parse DRF validation errors
          const validationErrors = lineErr.response?.data
          let errorMsg = ''
          if (validationErrors && typeof validationErrors === 'object') {
            errorMsg = Object.entries(validationErrors)
              .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
              .join('; ')
          }
          throw new Error(errorMsg || t('errors.saveFailed'))
        }
      }

      // Navigate to invoice list
      navigate('/invoices')
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
    <div className="space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/invoices')}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('invoices.newInvoice')}</h1>
            <p className="text-sm text-gray-500">{t('invoices.createInvoiceDescription')}</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving || !selectedTemplate || !selectedCompany}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
        >
          {isSaving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
          {t('invoices.saveInvoice')}
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
      <div className="bg-white rounded-lg shadow p-6">
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
      <div className={`bg-white rounded-lg shadow p-6${!selectedTemplate ? ' hidden' : ''}`}>
          <h2 className="text-lg font-semibold mb-4">2. {t('invoices.invoiceDetails')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.company')} *</label>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full min-w-0 truncate rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="">{t('invoices.selectCompany')}...</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.naam}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.type')}</label>
              <select
                value={invoiceType}
                onChange={(e) => {
                  const newType = e.target.value as 'verkoop' | 'inkoop' | 'credit'
                  setInvoiceType(newType)
                  loadNextInvoiceNumber(newType)
                }}
                className="w-full min-w-0 truncate rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
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
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.attachment')}</label>
            {bijlage ? (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-gray-50">
                <PaperClipIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate flex-1">{bijlage.name}</span>
                <button
                  type="button"
                  onClick={() => setBijlage(null)}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                  title={t('invoices.removeAttachment')}
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 p-2 border border-dashed rounded-md cursor-pointer hover:bg-gray-50 text-sm text-gray-500">
                <PaperClipIcon className="h-4 w-4" />
                {t('invoices.addAttachment')}
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setBijlage(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
        </div>

      {/* Step 3: Invoice Lines */}
      <div className={`bg-white rounded-lg shadow p-6${!selectedTemplate || columns.length === 0 ? ' hidden' : ''}`}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-semibold">3. {t('invoices.lines')}</h2>
            <div className="flex gap-2 flex-wrap">
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
            <div className="flex items-center gap-2 text-blue-800 text-sm">
              <CalculatorIcon className="h-4 w-4" />
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
            <div className="overflow-x-auto">
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
          )}

          {/* Totals */}
          {lines.length > 0 && (
            <div className="mt-6 flex justify-end">
              <div className="w-72 bg-gray-50 rounded-lg p-4">
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

      {/* Time Entry Import Modal */}
      <TimeEntryImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportEntries}
        onImportImported={handleImportImportedEntries}
      />

      {/* Spreadsheet Import Modal */}
      <SpreadsheetImportModal
        isOpen={showSpreadsheetImportModal}
        onClose={() => setShowSpreadsheetImportModal(false)}
        onImport={handleImportSpreadsheet}
      />
    </div>
  )
}
