/**
 * SQL Query Tab - Interactive SQL editor with autocomplete and results
 * Only SELECT/JOIN queries are allowed.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  PlayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  TableCellsIcon,
  LightBulbIcon,
  XMarkIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  getSqlSchema,
  executeSqlQuery,
  exportSqlQuery,
  SqlSchemaResponse,
  SqlQueryResult,
  SqlExampleQuery,
} from '@/api/reports'

// ---- Schema Browser ----

function SchemaBrowser({
  schema,
  onInsertText,
}: {
  schema: SqlSchemaResponse
  onInsertText: (text: string) => void
}) {
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const toggleTable = (table: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })
  }

  const filteredTables = useMemo(() => {
    if (!search) return schema.tables
    const lower = search.toLowerCase()
    return schema.tables.filter(
      (t) =>
        t.table.toLowerCase().includes(lower) ||
        t.columns.some((c) => c.name.toLowerCase().includes(lower)),
    )
  }, [schema.tables, search])

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek tabel of veld..."
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto text-xs">
        {filteredTables.map((table) => (
          <div key={table.table}>
            <button
              onClick={() => toggleTable(table.table)}
              className="w-full flex items-center gap-1 px-3 py-1.5 hover:bg-gray-100 text-left group"
            >
              {expandedTables.has(table.table) ? (
                <ChevronDownIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronRightIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
              )}
              <TableCellsIcon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span className="font-medium text-gray-800 truncate">{table.table}</span>
              <span className="text-gray-400 ml-auto text-[10px] flex-shrink-0">
                ~{table.estimated_rows}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onInsertText(table.table)
                }}
                className="opacity-0 group-hover:opacity-100 ml-1 text-blue-500 hover:text-blue-700 text-[10px] flex-shrink-0"
                title="Voeg in"
              >
                +
              </button>
            </button>
            {expandedTables.has(table.table) && (
              <div className="ml-5 border-l border-gray-200">
                {table.columns.map((col) => (
                  <button
                    key={col.name}
                    onClick={() => onInsertText(col.name)}
                    className="w-full flex items-center gap-2 px-3 py-1 hover:bg-blue-50 text-left"
                    title={`${col.type}${col.nullable ? ', nullable' : ''}${col.max_length ? `, max ${col.max_length}` : ''}`}
                  >
                    <span className="text-gray-700">{col.name}</span>
                    <span className="text-gray-400 text-[10px] ml-auto">{col.type}</span>
                  </button>
                ))}
                {table.foreign_keys.length > 0 && (
                  <div className="px-3 py-1 text-[10px] text-gray-400 border-t border-gray-100">
                    FK:{' '}
                    {table.foreign_keys.map((fk, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <button
                          onClick={() =>
                            onInsertText(
                              `JOIN ${fk.references_table} ON ${table.table}.${fk.column} = ${fk.references_table}.${fk.references_column}`,
                            )
                          }
                          className="text-blue-500 hover:underline"
                        >
                          {fk.column} → {fk.references_table}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Autocomplete Dropdown ----

interface Suggestion {
  text: string
  kind: 'table' | 'column' | 'keyword'
  detail?: string
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
  'FULL OUTER JOIN', 'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE',
  'BETWEEN', 'IS NULL', 'IS NOT NULL', 'ORDER BY', 'GROUP BY', 'HAVING',
  'LIMIT', 'OFFSET', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'ASC', 'DESC',
  'UNION', 'UNION ALL', 'EXISTS', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
  'date_trunc', 'EXTRACT',
]

function useAutocomplete(schema: SqlSchemaResponse | null) {
  return useCallback(
    (word: string): Suggestion[] => {
      if (!word || word.length < 1 || !schema) return []
      const lower = word.toLowerCase()
      const suggestions: Suggestion[] = []

      // Table names
      for (const table of schema.tables) {
        if (table.table.toLowerCase().includes(lower)) {
          suggestions.push({ text: table.table, kind: 'table', detail: `~${table.estimated_rows} rows` })
        }
        // Column names
        for (const col of table.columns) {
          if (col.name.toLowerCase().includes(lower)) {
            suggestions.push({
              text: col.name,
              kind: 'column',
              detail: `${table.table}.${col.name} (${col.type})`,
            })
          }
        }
      }

      // SQL keywords
      for (const kw of SQL_KEYWORDS) {
        if (kw.toLowerCase().includes(lower)) {
          suggestions.push({ text: kw, kind: 'keyword' })
        }
      }

      // Deduplicate by text and limit
      const seen = new Set<string>()
      return suggestions.filter((s) => {
        const key = s.text.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 15)
    },
    [schema],
  )
}

// ---- Query Editor with autocomplete ----

function QueryEditor({
  value,
  onChange,
  schema,
  onRun,
  isRunning,
}: {
  value: string
  onChange: (v: string) => void
  schema: SqlSchemaResponse | null
  onRun: () => void
  isRunning: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const getSuggestions = useAutocomplete(schema)

  const getCurrentWord = useCallback((): { word: string; start: number; end: number } => {
    const ta = textareaRef.current
    if (!ta) return { word: '', start: 0, end: 0 }
    const pos = ta.selectionStart
    const text = ta.value
    // Find word boundaries
    let start = pos
    while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) start--
    return { word: text.slice(start, pos), start, end: pos }
  }, [])

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      onChange(newValue)

      // Trigger autocomplete
      setTimeout(() => {
        const { word } = getCurrentWord()
        if (word.length >= 2) {
          const s = getSuggestions(word)
          setSuggestions(s)
          setShowSuggestions(s.length > 0)
          setSelectedIdx(0)
        } else {
          setShowSuggestions(false)
        }
      }, 0)
    },
    [onChange, getCurrentWord, getSuggestions],
  )

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      const { start, end } = getCurrentWord()
      const before = value.slice(0, start)
      const after = value.slice(end)
      const newValue = before + suggestion.text + ' ' + after
      onChange(newValue)
      setShowSuggestions(false)

      // Move cursor after inserted text
      setTimeout(() => {
        const ta = textareaRef.current
        if (ta) {
          const newPos = start + suggestion.text.length + 1
          ta.selectionStart = newPos
          ta.selectionEnd = newPos
          ta.focus()
        }
      }, 0)
    },
    [value, onChange, getCurrentWord],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIdx((i) => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          if (showSuggestions) {
            e.preventDefault()
            applySuggestion(suggestions[selectedIdx])
            return
          }
        }
        if (e.key === 'Escape') {
          setShowSuggestions(false)
          return
        }
      }

      // Ctrl+Enter / Cmd+Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!isRunning) onRun()
      }

      // Tab for indentation when no suggestions
      if (e.key === 'Tab' && !showSuggestions) {
        e.preventDefault()
        const ta = textareaRef.current
        if (ta) {
          const start = ta.selectionStart
          const end = ta.selectionEnd
          const newVal = value.slice(0, start) + '  ' + value.slice(end)
          onChange(newVal)
          setTimeout(() => {
            ta.selectionStart = start + 2
            ta.selectionEnd = start + 2
          }, 0)
        }
      }
    },
    [showSuggestions, suggestions, selectedIdx, applySuggestion, isRunning, onRun, value, onChange],
  )

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder="SELECT * FROM accounts_user LIMIT 10"
        className="w-full h-48 p-3 font-mono text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-y bg-gray-50"
        spellCheck={false}
      />
      {/* Autocomplete dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-80 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={`${s.text}-${s.kind}`}
              onMouseDown={(e) => {
                e.preventDefault()
                applySuggestion(s)
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                i === selectedIdx ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50'
              }`}
            >
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  s.kind === 'table'
                    ? 'bg-blue-100 text-blue-700'
                    : s.kind === 'column'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-purple-100 text-purple-700'
                }`}
              >
                {s.kind === 'table' ? 'TBL' : s.kind === 'column' ? 'COL' : 'SQL'}
              </span>
              <span className="font-mono">{s.text}</span>
              {s.detail && <span className="text-gray-400 text-xs ml-auto truncate">{s.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Results Table ----

function ResultsTable({ result }: { result: SqlQueryResult }) {
  if (result.columns.length === 0) {
    return <p className="text-gray-500 text-sm py-4 text-center">Query leverde geen kolommen op.</p>
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-500 w-12">#</th>
            {result.columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {result.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 text-gray-400">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-gray-800 whitespace-nowrap max-w-xs truncate" title={String(cell ?? '')}>
                  {cell === null ? <span className="text-gray-300 italic">NULL</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Example Queries Panel ----

function ExampleQueries({ examples, onSelect }: { examples: SqlExampleQuery[]; onSelect: (q: string) => void }) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-gray-50 transition-colors"
      >
        {isOpen ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />
        )}
        <LightBulbIcon className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Voorbeeld queries
        </span>
        <span className="text-[10px] text-gray-400 ml-1">({examples.length})</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {examples.map((ex, i) => (
              <button
                key={i}
                onClick={() => onSelect(ex.query)}
                className="text-left p-2 bg-gray-50 border border-gray-200 rounded hover:border-blue-300 hover:bg-blue-50 transition-colors text-xs group"
              >
                <span className="font-medium text-gray-800 group-hover:text-blue-800">{ex.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main SQL Query Tab ----

export default function SqlQueryTab() {
  const [query, setQuery] = useState('')
  const [schema, setSchema] = useState<SqlSchemaResponse | null>(null)
  const [result, setResult] = useState<SqlQueryResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isLoadingSchema, setIsLoadingSchema] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [executionTime, setExecutionTime] = useState<number | null>(null)

  // Load schema on mount
  useEffect(() => {
    getSqlSchema()
      .then(setSchema)
      .catch(() => toast.error('Fout bij laden database schema'))
      .finally(() => setIsLoadingSchema(false))
  }, [])

  const handleRun = useCallback(async () => {
    if (!query.trim()) {
      toast.error('Voer een query in')
      return
    }
    setIsRunning(true)
    setError(null)
    setResult(null)
    const start = Date.now()
    try {
      const r = await executeSqlQuery(query)
      setExecutionTime(Date.now() - start)
      setResult(r)
      if (r.has_more) {
        toast(`Resultaat beperkt tot ${r.limit} rijen. Er zijn meer resultaten.`, { icon: 'ℹ️' })
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Fout bij uitvoeren query'
      setError(message)
      toast.error(message)
    } finally {
      setIsRunning(false)
    }
  }, [query])

  const handleExportCsv = useCallback(async () => {
    if (!query.trim()) return
    setIsExporting(true)
    try {
      const blob = await exportSqlQuery(query)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `query_export_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '')}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('CSV geëxporteerd')
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Fout bij exporteren'
      toast.error(message)
    } finally {
      setIsExporting(false)
    }
  }, [query])

  const handleInsertText = useCallback(
    (text: string) => {
      setQuery((prev) => {
        if (!prev.trim()) return text
        return prev + (prev.endsWith(' ') ? '' : ' ') + text
      })
    },
    [],
  )

  if (isLoadingSchema) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Schema browser sidebar */}
        {showSidebar && schema && (
          <div className="lg:w-72 flex-shrink-0 bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Database Schema
              </span>
              <button onClick={() => setShowSidebar(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <SchemaBrowser schema={schema} onInsertText={handleInsertText} />
          </div>
        )}

        {/* Main editor area */}
        <div className="flex-1 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {!showSidebar && (
              <button
                onClick={() => setShowSidebar(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <TableCellsIcon className="w-4 h-4" />
                Schema
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={isRunning || !query.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <PlayIcon className="w-4 h-4" />
              )}
              {isRunning ? 'Bezig...' : 'Uitvoeren'}
              <span className="text-green-200 text-[10px] hidden sm:inline">(Ctrl+Enter)</span>
            </button>
            {result && (
              <button
                onClick={handleExportCsv}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="w-4 h-4" />
                {isExporting ? 'Exporteren...' : 'Exporteer CSV'}
              </button>
            )}
            {result && (
              <span className="text-xs text-gray-500 ml-auto">
                {result.row_count} rijen
                {executionTime !== null && ` · ${(executionTime / 1000).toFixed(2)}s`}
                {result.has_more && ' (meer beschikbaar)'}
              </span>
            )}
          </div>

          {/* Query editor */}
          <QueryEditor
            value={query}
            onChange={setQuery}
            schema={schema}
            onRun={handleRun}
            isRunning={isRunning}
          />

          {/* Example queries - always visible, collapsible */}
          {schema && (
            <ExampleQueries examples={schema.example_queries} onSelect={setQuery} />
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <strong>Fout:</strong> {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div>
              <ResultsTable result={result} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
