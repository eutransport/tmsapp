/**
 * Imported Hours Tab - Shows imported hours from Excel (planbureau)
 * and comparison with chauffeur-submitted hours.
 * Visible to both admins and chauffeurs (chauffeurs see their own data only).
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MinusIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import {
  getImportedEntries,
  getWeekComparison,
  ImportedTimeEntry,
  WeekComparison,
} from '@/api/urenImport'
import toast from 'react-hot-toast'

// Format date to Dutch format
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`
}

interface WeekGroup {
  weeknummer: number
  jaar: number
  entries: ImportedTimeEntry[]
  totaal_uren: number
  totaal_km: number
}

export default function ImportedHoursTab() {
  const { t } = useTranslation()
  const { user } = useAuthStore()

  const [loading, setLoading] = useState(true)
  const [weekGroups, setWeekGroups] = useState<WeekGroup[]>([])
  const [comparison, setComparison] = useState<WeekComparison[]>([])
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [entries, comp] = await Promise.all([
        getImportedEntries(user?.rol === 'chauffeur' ? { user: user.id } : undefined),
        getWeekComparison(),
      ])

      // Group entries by week+year
      const groups: Record<string, WeekGroup> = {}
      for (const entry of entries) {
        const jaar = new Date(entry.datum).getFullYear()
        const key = `${jaar}-${entry.weeknummer}`
        if (!groups[key]) {
          groups[key] = {
            weeknummer: entry.weeknummer,
            jaar,
            entries: [],
            totaal_uren: 0,
            totaal_km: 0,
          }
        }
        groups[key].entries.push(entry)
        groups[key].totaal_uren += Number(entry.uren_factuur || 0)
        groups[key].totaal_km += Number(entry.km || 0)
      }

      // Sort by year desc, week desc
      const sorted = Object.values(groups).sort((a, b) => {
        if (a.jaar !== b.jaar) return b.jaar - a.jaar
        return b.weeknummer - a.weeknummer
      })

      setWeekGroups(sorted)
      setComparison(comp)
    } catch (err) {
      console.error('Failed to load imported data:', err)
      toast.error(t('urenImport.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const toggleWeek = (key: string) => {
    setExpandedWeek(expandedWeek === key ? null : key)
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Imported entries per week */}
      {weekGroups.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500">{t('urenImport.noImportedData')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('common.week')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('common.year')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('timeEntries.trips')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('urenImport.invoiceHours')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('timeEntries.totalKm')}
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {weekGroups.map((group) => {
                  const key = `${group.jaar}-${group.weeknummer}`
                  const isExpanded = expandedWeek === key
                  return (
                    <>
                      <tr
                        key={key}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggleWeek(key)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 text-blue-700 font-bold">
                            {group.weeknummer}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {group.jaar}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                          {group.entries.length}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                          {Number(group.totaal_uren).toFixed(2)}u
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                          {group.totaal_km} km
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <button className="btn-secondary text-sm">
                            {isExpanded ? t('common.close') : t('urenImport.details')}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${key}-detail`}>
                          <td colSpan={6} className="px-0 py-0">
                            <div className="bg-gray-50 border-t border-b border-gray-200">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.date')}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('fleet.licensePlate')}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('urenImport.ritlijst')}</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('urenImport.times')}</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.break')}</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.netHours')}</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.invoiceHours')}</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('timeEntries.km')}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                  {group.entries
                                    .sort((a, b) => a.datum.localeCompare(b.datum))
                                    .map((entry) => (
                                      <tr key={entry.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 text-sm">{formatDate(entry.datum)}</td>
                                        <td className="px-4 py-2 text-sm font-mono">{entry.kenteken_import}</td>
                                        <td className="px-4 py-2 text-sm">{entry.ritlijst}</td>
                                        <td className="px-4 py-2 text-sm">
                                          {entry.begintijd_rit || '-'} - {entry.eindtijd_rit || '-'}
                                        </td>
                                        <td className="px-4 py-2 text-sm text-right">{entry.pauze_display || '-'}</td>
                                        <td className="px-4 py-2 text-sm text-right">{entry.netto_uren != null ? Number(entry.netto_uren).toFixed(2) : '-'}</td>
                                        <td className="px-4 py-2 text-sm text-right font-medium">{entry.uren_factuur != null ? Number(entry.uren_factuur).toFixed(2) : '-'}</td>
                                        <td className="px-4 py-2 text-sm text-right">{entry.km}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-gray-200">
            {weekGroups.map((group) => {
              const key = `${group.jaar}-${group.weeknummer}`
              const isExpanded = expandedWeek === key
              return (
                <div key={key}>
                  <div
                    className="p-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleWeek(key)}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 text-blue-700 font-bold">
                        {group.weeknummer}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">
                          {t('common.week')} {group.weeknummer} - {group.jaar}
                        </p>
                        <p className="text-xs text-gray-500">{group.entries.length} {t('timeEntries.trips')}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm">{Number(group.totaal_uren).toFixed(2)}u</p>
                        <p className="text-xs text-gray-500">{group.totaal_km} km</p>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="bg-gray-50 border-t px-3 pb-3">
                      {group.entries
                        .sort((a, b) => a.datum.localeCompare(b.datum))
                        .map((entry) => (
                          <div key={entry.id} className="py-2 border-b border-gray-200 last:border-0">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-sm">{formatDate(entry.datum)}</p>
                                <p className="text-xs text-gray-500 font-mono">{entry.kenteken_import}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-sm">{entry.uren_factuur != null ? Number(entry.uren_factuur).toFixed(2) : '-'}u</p>
                                <p className="text-xs text-gray-500">{entry.km} km</p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Comparison section */}
      {comparison.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">{t('urenImport.comparisonTitle')}</h3>
          <div className="card overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.week')}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.year')}</th>
                    {(user?.rol === 'admin' || user?.rol === 'gebruiker') && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('urenImport.driver')}</th>
                    )}
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.importHours')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.driverHours')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.difference')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.importKm')}</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('urenImport.driverKm')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {comparison.map((row) => {
                    const verschilClass =
                      row.verschil > 0
                        ? 'text-green-600'
                        : row.verschil < 0
                        ? 'text-red-600'
                        : 'text-gray-500'
                    const VerschilIcon =
                      row.verschil > 0
                        ? ArrowTrendingUpIcon
                        : row.verschil < 0
                        ? ArrowTrendingDownIcon
                        : MinusIcon
                    return (
                      <tr key={`${row.user_id}-${row.jaar}-${row.weeknummer}`} className="hover:bg-gray-50">
                        <td className="px-6 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                            {row.weeknummer}
                          </span>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">{row.jaar}</td>
                        {(user?.rol === 'admin' || user?.rol === 'gebruiker') && (
                          <td className="px-6 py-3 whitespace-nowrap text-sm font-medium">{row.user_naam}</td>
                        )}
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-right">{Number(row.import_uren || 0).toFixed(2)}u</td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-right">{Number(row.chauffeur_uren || 0).toFixed(2)}u</td>
                        <td className={`px-6 py-3 whitespace-nowrap text-sm text-right font-bold ${verschilClass}`}>
                          <span className="inline-flex items-center gap-1">
                            <VerschilIcon className="h-4 w-4" />
                            {Number(row.verschil) > 0 ? '+' : ''}{Number(row.verschil || 0).toFixed(2)}u
                          </span>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-right">{row.import_km}</td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm text-right">{row.chauffeur_km}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-200">
              {comparison.map((row) => {
                const verschilClass =
                  row.verschil > 0
                    ? 'text-green-600'
                    : row.verschil < 0
                    ? 'text-red-600'
                    : 'text-gray-500'
                return (
                  <div key={`${row.user_id}-${row.jaar}-${row.weeknummer}`} className="p-3">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                        {row.weeknummer}
                      </span>
                      <div className="flex-1">
                        {(user?.rol === 'admin' || user?.rol === 'gebruiker') && (
                          <p className="font-medium text-sm">{row.user_naam}</p>
                        )}
                        <p className="text-xs text-gray-500">{row.jaar}</p>
                      </div>
                      <div className={`text-right font-bold text-sm ${verschilClass}`}>
                        {Number(row.verschil) > 0 ? '+' : ''}{Number(row.verschil || 0).toFixed(2)}u
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 text-xs ml-11">
                      <div>
                        <span className="text-gray-500">{t('urenImport.importShort')}: </span>
                        <span className="font-medium">{Number(row.import_uren || 0).toFixed(2)}u</span>
                      </div>
                      <div>
                        <span className="text-gray-500">{t('urenImport.driverShort')}: </span>
                        <span className="font-medium">{Number(row.chauffeur_uren || 0).toFixed(2)}u</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
