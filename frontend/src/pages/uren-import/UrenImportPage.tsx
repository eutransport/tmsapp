import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpTrayIcon,
  TrashIcon,
  DocumentTextIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  getImportBatches,
  deleteImportBatch,
  uploadImportFile,
  getBatchEntries,
  getWeekComparison,
  ImportBatch,
  ImportedTimeEntry,
  WeekComparison,
} from '@/api/urenImport'
import clsx from '@/utils/clsx'

// Tab type
type TabKey = 'upload' | 'batches' | 'comparison'

// Delete confirmation dialog
function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isLoading,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  isLoading: boolean
}) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            </div>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={onConfirm}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isLoading ? 'Bezig...' : 'Verwijderen'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UrenImportPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabKey>('upload')
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Batch detail
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null)
  const [batchEntries, setBatchEntries] = useState<ImportedTimeEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)

  // Comparison
  const [comparisons, setComparisons] = useState<WeekComparison[]>([])
  const [compYear, setCompYear] = useState<number>(new Date().getFullYear())
  const [loadingComp, setLoadingComp] = useState(false)
  const [compWeekFilter, setCompWeekFilter] = useState<number | ''>('')
  const [compPage, setCompPage] = useState(1)
  const [expandedCompWeek, setExpandedCompWeek] = useState<number | null>(null)
  const WEEKS_PER_PAGE = 6

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ImportBatch | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadBatches = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getImportBatches()
      setBatches(data)
    } catch {
      toast.error(t('urenImport.loadError', 'Fout bij laden van imports'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploading(true)
      const batch = await uploadImportFile(file)
      toast.success(
        t('urenImport.uploadSuccess', '{{count}} rijen geïmporteerd, {{matched}} gekoppeld', {
          count: batch.totaal_rijen,
          matched: batch.gekoppeld,
        })
      )
      await loadBatches()
      setActiveTab('batches')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload mislukt'
      toast.error(message)
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = ''
    }
  }

  const handleViewBatch = async (batch: ImportBatch) => {
    setSelectedBatch(batch)
    setLoadingEntries(true)
    try {
      const entries = await getBatchEntries(batch.id)
      setBatchEntries(entries)
    } catch {
      toast.error('Fout bij laden van regels')
    } finally {
      setLoadingEntries(false)
    }
  }

  const handleDeleteBatch = async () => {
    if (!deleteTarget) return
    try {
      setDeleting(true)
      await deleteImportBatch(deleteTarget.id)
      toast.success('Import verwijderd')
      setDeleteTarget(null)
      if (selectedBatch?.id === deleteTarget.id) {
        setSelectedBatch(null)
        setBatchEntries([])
      }
      await loadBatches()
    } catch {
      toast.error('Verwijderen mislukt')
    } finally {
      setDeleting(false)
    }
  }

  const loadComparison = useCallback(async () => {
    try {
      setLoadingComp(true)
      const data = await getWeekComparison({ jaar: compYear })
      setComparisons(data)
    } catch {
      toast.error('Fout bij laden vergelijking')
    } finally {
      setLoadingComp(false)
    }
  }, [compYear])

  useEffect(() => {
    if (activeTab === 'comparison') {
      loadComparison()
    }
  }, [activeTab, loadComparison])

  const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'upload', label: t('urenImport.tabUpload', 'Upload'), icon: ArrowUpTrayIcon },
    { key: 'batches', label: t('urenImport.tabBatches', 'Imports'), icon: DocumentTextIcon },
    { key: 'comparison', label: t('urenImport.tabComparison', 'Weekoverzicht'), icon: TableCellsIcon },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('urenImport.title', 'Uren Import')}
          </h1>
          <p className="text-gray-500 mt-1">
            {t('urenImport.subtitle', 'Importeer uren uit Excel en vergelijk met chauffeur registraties')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2',
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="bg-white rounded-xl shadow-sm border p-8">
          <div className="max-w-lg mx-auto text-center">
            <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              {t('urenImport.uploadTitle', 'Excel bestand uploaden')}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {t('urenImport.uploadDesc', 'Upload een Excel bestand (.xlsx) met uren van het planbureau. De kentekens worden automatisch gekoppeld aan chauffeurs.')}
            </p>
            <div className="mt-6">
              <label className={clsx(
                'inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium cursor-pointer transition-colors',
                uploading
                  ? 'bg-gray-100 text-gray-400'
                  : 'bg-primary-600 text-white hover:bg-primary-700'
              )}>
                {uploading ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    {t('urenImport.uploading', 'Bezig met importeren...')}
                  </>
                ) : (
                  <>
                    <ArrowUpTrayIcon className="w-5 h-5" />
                    {t('urenImport.selectFile', 'Selecteer Excel bestand')}
                  </>
                )}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>
            <p className="mt-4 text-xs text-gray-400">
              {t('urenImport.uploadHint', 'Ondersteunde formaten: .xlsx, .xls')}
            </p>
          </div>
        </div>
      )}

      {/* Batches Tab */}
      {activeTab === 'batches' && (
        <div className="space-y-4">
          {/* Refresh button */}
          <div className="flex justify-end">
            <button
              onClick={loadBatches}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <ArrowPathIcon className={clsx('w-4 h-4', loading && 'animate-spin')} />
              {t('common.refresh', 'Vernieuwen')}
            </button>
          </div>

          {/* Batches list */}
          {batches.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
              {t('urenImport.noBatches', 'Nog geen imports gevonden. Upload een Excel bestand om te beginnen.')}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.filename', 'Bestand')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.importedBy', 'Door')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.totalRows', 'Rijen')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.matched', 'Gekoppeld')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.unmatched', 'Niet gekoppeld')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t('urenImport.importDate', 'Datum')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      {t('common.actions', 'Acties')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {batches.map((batch) => (
                    <tr
                      key={batch.id}
                      className={clsx(
                        'hover:bg-gray-50 cursor-pointer',
                        selectedBatch?.id === batch.id && 'bg-primary-50'
                      )}
                      onClick={() => handleViewBatch(batch)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {batch.bestandsnaam}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{batch.geimporteerd_door_naam}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">{batch.totaal_rijen}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className="text-green-600 font-medium">{batch.gekoppeld}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        {batch.niet_gekoppeld > 0 ? (
                          <span className="text-red-600 font-medium">{batch.niet_gekoppeld}</span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(batch.created_at).toLocaleString('nl-NL', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(batch)
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Verwijderen"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Batch detail entries */}
          {selectedBatch && (
            <div className="bg-white rounded-xl shadow-sm border">
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('urenImport.entriesFor', 'Regels voor')}{' '}
                  <span className="text-primary-600">{selectedBatch.bestandsnaam}</span>
                </h3>
                <button
                  onClick={() => {
                    setSelectedBatch(null)
                    setBatchEntries([])
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              {loadingEntries ? (
                <div className="p-8 text-center text-gray-500">
                  <ArrowPathIcon className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Laden...
                </div>
              ) : batchEntries.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Geen regels gevonden</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Kenteken</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chauffeur</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ritlijst</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">KM</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Begin</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Eind</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pauze</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Uren</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Netto</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Factuur</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {batchEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-900 whitespace-nowrap">
                            {new Date(entry.datum).toLocaleDateString('nl-NL', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{entry.weeknummer}</td>
                          <td className="px-3 py-2 text-gray-900 font-medium">{entry.kenteken_import}</td>
                          <td className="px-3 py-2">
                            {entry.user_naam ? (
                              <span className="text-green-700">{entry.user_naam}</span>
                            ) : (
                              <span className="text-red-500 text-xs italic">Niet gekoppeld</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{entry.ritlijst}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{entry.km}</td>
                          <td className="px-3 py-2 text-gray-600">{entry.begintijd_rit || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{entry.eindtijd_rit || '-'}</td>
                          <td className="px-3 py-2 text-gray-600">{entry.pauze_display}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{entry.uren}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{entry.netto_uren}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{entry.uren_factuur}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Comparison Tab */}
      {activeTab === 'comparison' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">{t('urenImport.year', 'Jaar')}:</label>
              <select
                value={compYear}
                onChange={(e) => { setCompYear(parseInt(e.target.value)); setCompPage(1); setCompWeekFilter('') }}
                className="rounded-lg border-gray-300 text-sm"
              >
                {[...Array(5)].map((_, i) => {
                  const year = new Date().getFullYear() - i
                  return <option key={year} value={year}>{year}</option>
                })}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">{t('urenImport.week', 'Week')}:</label>
              <select
                value={compWeekFilter}
                onChange={(e) => { setCompWeekFilter(e.target.value === '' ? '' : parseInt(e.target.value)); setCompPage(1); setExpandedCompWeek(null) }}
                className="rounded-lg border-gray-300 text-sm"
              >
                <option value="">Alle weken</option>
                {[...new Set(comparisons.map(c => c.weeknummer))].sort((a, b) => b - a).map(w => (
                  <option key={w} value={w}>Week {w}</option>
                ))}
              </select>
            </div>
            <button
              onClick={loadComparison}
              disabled={loadingComp}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <ArrowPathIcon className={clsx('w-4 h-4', loadingComp && 'animate-spin')} />
              {t('common.refresh', 'Vernieuwen')}
            </button>
          </div>

          {/* Comparison content */}
          {loadingComp ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
              <ArrowPathIcon className="w-6 h-6 animate-spin mx-auto mb-2" />
              Laden...
            </div>
          ) : comparisons.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
              {t('urenImport.noComparison', 'Geen data gevonden voor vergelijking.')}
            </div>
          ) : (() => {
            // Group by week
            const filtered = compWeekFilter !== '' ? comparisons.filter(c => c.weeknummer === compWeekFilter) : comparisons
            const weekMap: Record<number, WeekComparison[]> = {}
            filtered.forEach(c => {
              if (!weekMap[c.weeknummer]) weekMap[c.weeknummer] = []
              weekMap[c.weeknummer].push(c)
            })
            const weekNumbers = Object.keys(weekMap).map(Number).sort((a, b) => b - a)
            const totalCompPages = Math.ceil(weekNumbers.length / WEEKS_PER_PAGE)
            const pagedWeeks = weekNumbers.slice((compPage - 1) * WEEKS_PER_PAGE, compPage * WEEKS_PER_PAGE)

            return (
              <div className="space-y-3">
                {pagedWeeks.map(weekNr => {
                  const rows = weekMap[weekNr]
                  const isExpanded = expandedCompWeek === weekNr
                  const totImport = rows.reduce((s, r) => s + Number(r.import_uren || 0), 0)
                  const totChauffeur = rows.reduce((s, r) => s + Number(r.chauffeur_uren || 0), 0)
                  const totVerschil = totImport - totChauffeur
                  const totImportKm = rows.reduce((s, r) => s + Number(r.import_km || 0), 0)
                  const totChauffeurKm = rows.reduce((s, r) => s + Number(r.chauffeur_km || 0), 0)

                  return (
                    <div key={weekNr} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                      {/* Week header - clickable */}
                      <button
                        onClick={() => setExpandedCompWeek(isExpanded ? null : weekNr)}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                            {weekNr}
                          </span>
                          <span className="font-semibold text-gray-900">Week {weekNr}</span>
                          <span className="text-sm text-gray-500">({rows.length} chauffeurs)</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div>
                            <span className="text-gray-500">Import:</span>{' '}
                            <span className="font-medium">{totImport.toFixed(1)}u</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Chauffeur:</span>{' '}
                            <span className="font-medium">{totChauffeur.toFixed(1)}u</span>
                          </div>
                          <div>
                            <span className={clsx(
                              'font-bold',
                              totVerschil > 0.5 ? 'text-green-600' : totVerschil < -0.5 ? 'text-red-600' : 'text-gray-500'
                            )}>
                              {totVerschil > 0 ? '+' : ''}{totVerschil.toFixed(1)}u
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="border-t">
                          <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.driver', 'Chauffeur')}
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.importHours', 'Import uren')}
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.driverHours', 'Chauffeur uren')}
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.difference', 'Verschil')}
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.importKm', 'Import KM')}
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                                  {t('urenImport.driverKm', 'Chauffeur KM')}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {rows.map((row, idx) => (
                                <tr key={`${row.user_id}-${idx}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 font-medium text-gray-900">{row.user_naam}</td>
                                  <td className="px-4 py-2 text-right text-gray-900">{Number(row.import_uren || 0).toFixed(1)}</td>
                                  <td className="px-4 py-2 text-right text-gray-900">{Number(row.chauffeur_uren || 0).toFixed(1)}</td>
                                  <td className="px-4 py-2 text-right font-semibold">
                                    <span className={clsx(
                                      Number(row.verschil) > 0.5 ? 'text-green-600' : Number(row.verschil) < -0.5 ? 'text-red-600' : 'text-gray-500'
                                    )}>
                                      {Number(row.verschil) > 0 ? '+' : ''}{Number(row.verschil || 0).toFixed(1)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-600">{Number(row.import_km || 0).toFixed(0)}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">{Number(row.chauffeur_km || 0)}</td>
                                </tr>
                              ))}
                              {/* Totals row */}
                              <tr className="bg-gray-50 font-semibold">
                                <td className="px-4 py-2 text-gray-900">Totaal</td>
                                <td className="px-4 py-2 text-right">{totImport.toFixed(1)}</td>
                                <td className="px-4 py-2 text-right">{totChauffeur.toFixed(1)}</td>
                                <td className="px-4 py-2 text-right">
                                  <span className={clsx(
                                    totVerschil > 0.5 ? 'text-green-600' : totVerschil < -0.5 ? 'text-red-600' : 'text-gray-500'
                                  )}>
                                    {totVerschil > 0 ? '+' : ''}{totVerschil.toFixed(1)}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right">{totImportKm.toFixed(0)}</td>
                                <td className="px-4 py-2 text-right">{totChauffeurKm}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Pagination */}
                {totalCompPages > 1 && (
                  <div className="flex items-center justify-between px-1 pt-2">
                    <div className="text-sm text-gray-500">
                      Pagina {compPage} van {totalCompPages} ({weekNumbers.length} weken)
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setCompPage(p => Math.max(1, p - 1)); setExpandedCompWeek(null) }}
                        disabled={compPage === 1}
                        className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Vorige
                      </button>
                      <button
                        onClick={() => { setCompPage(p => Math.min(totalCompPages, p + 1)); setExpandedCompWeek(null) }}
                        disabled={compPage === totalCompPages}
                        className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Volgende
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteBatch}
        title={t('urenImport.deleteTitle', 'Import verwijderen')}
        message={t('urenImport.deleteMessage', 'Weet je zeker dat je deze import en alle bijbehorende regels wilt verwijderen? Dit kan niet ongedaan worden gemaakt.')}
        isLoading={deleting}
      />
    </div>
  )
}
