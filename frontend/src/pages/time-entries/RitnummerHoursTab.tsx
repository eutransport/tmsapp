/**
 * Ritnummer Hours Overview Tab
 * Shows worked hours grouped by Fleet vehicle ritnummer, per week, per year.
 * Matches: Vehicle.ritnummer → Driver.voertuig → Driver.gekoppelde_gebruiker → ImportedTimeEntry.user
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import {
  RitnummerHoursOverview,
  getRitnummerHoursOverview,
  getCurrentYear,
} from '@/api/timetracking'
import toast from 'react-hot-toast'

interface RitnummerGroup {
  ritnummer: string
  kenteken: string
  type_wagen: string
  bedrijf_naam: string
  chauffeurs: string[]
  weeks: RitnummerHoursOverview[]
  totalHours: number
  totalKm: number
}

export default function RitnummerHoursTab() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RitnummerHoursOverview[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [expandedRitnummers, setExpandedRitnummers] = useState<Set<string>>(new Set())

  const years = Array.from({ length: 5 }, (_, i) => getCurrentYear() - i).filter(y => y >= 2024)

  useEffect(() => {
    loadData()
  }, [selectedYear])

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await getRitnummerHoursOverview(selectedYear)
      setData(result)
    } catch (err) {
      console.error('Failed to load ritnummer hours overview:', err)
      toast.error(t('ritnummerHours.loadError'))
    } finally {
      setLoading(false)
    }
  }

  // Group data by ritnummer
  const groupedData = useMemo(() => {
    const groups = new Map<string, RitnummerGroup>()

    data.forEach(row => {
      if (!groups.has(row.ritnummer)) {
        groups.set(row.ritnummer, {
          ritnummer: row.ritnummer,
          kenteken: row.kenteken,
          type_wagen: row.type_wagen,
          bedrijf_naam: row.bedrijf_naam,
          chauffeurs: row.chauffeurs,
          weeks: [],
          totalHours: 0,
          totalKm: 0,
        })
      }
      const group = groups.get(row.ritnummer)!
      group.weeks.push(row)
      group.totalHours += row.gewerkte_uren
      group.totalKm += row.totaal_km
    })

    let result = Array.from(groups.values())

    // Apply search filter
    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      result = result.filter(g =>
        g.ritnummer.toLowerCase().includes(lower) ||
        g.kenteken.toLowerCase().includes(lower) ||
        g.type_wagen.toLowerCase().includes(lower) ||
        g.bedrijf_naam.toLowerCase().includes(lower) ||
        g.chauffeurs.some(c => c.toLowerCase().includes(lower))
      )
    }

    return result.sort((a, b) => a.ritnummer.localeCompare(b.ritnummer))
  }, [data, searchTerm])

  const toggleRitnummer = (ritnummer: string) => {
    setExpandedRitnummers(prev => {
      const next = new Set(prev)
      if (next.has(ritnummer)) next.delete(ritnummer)
      else next.add(ritnummer)
      return next
    })
  }

  const expandAll = () => {
    setExpandedRitnummers(new Set(groupedData.map(g => g.ritnummer)))
  }

  const collapseAll = () => {
    setExpandedRitnummers(new Set())
  }

  const formatHours = (hours: number) => {
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return `${h}:${m.toString().padStart(2, '0')}`
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
                placeholder={t('ritnummerHours.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input pl-10 w-full"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedYear === y ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Alles open
              </button>
              <button
                onClick={collapseAll}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Alles dicht
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {!loading && groupedData.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-primary-600">{groupedData.length}</div>
            <div className="text-xs text-gray-500 mt-1">{t('ritnummerHours.ritnummer')}s</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {formatHours(groupedData.reduce((s, g) => s + g.totalHours, 0))}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('ritnummerHours.totalHours')}</div>
          </div>
          <div className="card p-4 text-center hidden sm:block">
            <div className="text-2xl font-bold text-green-600">
              {Math.round(groupedData.reduce((s, g) => s + g.totalKm, 0)).toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">{t('ritnummerHours.totalKm')}</div>
          </div>
        </div>
      )}

      {/* Data */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
          </div>
        ) : groupedData.length === 0 ? (
          <div className="p-8 text-center">
            <ChartBarIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('ritnummerHours.noData')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {groupedData.map(group => {
              const isExpanded = expandedRitnummers.has(group.ritnummer)

              return (
                <div key={group.ritnummer}>
                  {/* Ritnummer header */}
                  <button
                    onClick={() => toggleRitnummer(group.ritnummer)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isExpanded
                        ? <ChevronDownIcon className="h-4 w-4 text-gray-500 shrink-0" />
                        : <ChevronRightIcon className="h-4 w-4 text-gray-500 shrink-0" />
                      }
                      <TruckIcon className="h-5 w-5 text-primary-500 shrink-0" />
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 font-mono text-sm font-bold text-blue-800 shrink-0">
                        {group.ritnummer}
                      </span>
                      <span className="text-sm text-gray-600 truncate hidden sm:inline">
                        {group.kenteken} · {group.type_wagen}
                      </span>
                      {group.chauffeurs.length > 0 && (
                        <span className="text-xs text-gray-400 truncate hidden md:inline">
                          ({group.chauffeurs.join(', ')})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
                      <span className="hidden sm:inline">
                        {group.weeks.length} {t('ritnummerHours.totalWeeks')}
                      </span>
                      <span>
                        <strong className="text-gray-700">{formatHours(group.totalHours)}</strong> uur
                      </span>
                      <span className="hidden sm:inline">
                        <strong className="text-gray-700">{Math.round(group.totalKm).toLocaleString()}</strong> km
                      </span>
                    </div>
                  </button>

                  {/* Week rows */}
                  {isExpanded && (
                    <>
                      {/* Desktop table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-white">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('ritnummerHours.week')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('ritnummerHours.hours')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('ritnummerHours.km')}</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('ritnummerHours.entries')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {group.weeks.map((week) => (
                              <tr key={week.weeknummer} className="hover:bg-gray-50">
                                <td className="px-4 py-2.5">
                                  <span className="text-sm font-medium text-gray-900">
                                    {t('ritnummerHours.week')} {week.weeknummer}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-sm text-right">
                                  <span className="font-semibold text-primary-600">
                                    {formatHours(week.gewerkte_uren)}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-sm text-right text-gray-700">
                                  {Math.round(week.totaal_km).toLocaleString()}
                                </td>
                                <td className="px-4 py-2.5 text-sm text-right text-gray-600">
                                  {week.entries_count}
                                </td>
                              </tr>
                            ))}
                            {/* Totals row */}
                            <tr className="bg-gray-50 font-semibold">
                              <td className="px-4 py-2.5 text-sm text-gray-700">Totaal</td>
                              <td className="px-4 py-2.5 text-sm text-right text-primary-700">
                                {formatHours(group.totalHours)}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-700">
                                {Math.round(group.totalKm).toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right text-gray-600">
                                {group.weeks.reduce((s, w) => s + w.entries_count, 0)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile card list */}
                      <div className="md:hidden divide-y divide-gray-100">
                        {group.weeks.map((week) => (
                          <div key={week.weeknummer} className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-900">
                                {t('ritnummerHours.week')} {week.weeknummer}
                              </span>
                              <span className="text-sm font-semibold text-primary-600">
                                {formatHours(week.gewerkte_uren)}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <span>{Math.round(week.totaal_km).toLocaleString()} km</span>
                              <span>{week.entries_count} {t('ritnummerHours.entries')}</span>
                            </div>
                          </div>
                        ))}
                        {/* Mobile totals */}
                        <div className="p-3 bg-gray-50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-700">Totaal</span>
                            <span className="text-sm font-bold text-primary-700">{formatHours(group.totalHours)}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                            <span>{Math.round(group.totalKm).toLocaleString()} km</span>
                            <span>{group.weeks.reduce((s, w) => s + w.entries_count, 0)} {t('ritnummerHours.entries')}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
