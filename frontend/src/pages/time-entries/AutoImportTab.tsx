/**
 * Auto Import Tab - Shows auto-imported hours from tachograph (FM-Track)
 * Displays time entries with bron='auto_import', grouped by user per month.
 * Each user group is expandable to show individual entries.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
  ClockIcon,
  ChevronDownIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { TimeEntry } from '@/types'
import { getTimeEntries, PaginatedResponse } from '@/api/timetracking'
import toast from 'react-hot-toast'

// Format duration to readable string
function formatDuration(duration: string | null): string {
  if (!duration) return '-'
  if (duration.includes(':')) {
    const parts = duration.split(':')
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    return `${hours}u ${minutes}m`
  }
  return duration
}

// Format date to Dutch format
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Calculate total minutes from entries
function calcTotalMinutes(entries: TimeEntry[]): number {
  return entries.reduce((sum, e) => {
    if (!e.totaal_uren) return sum
    const parts = e.totaal_uren.split(':')
    return sum + (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0)
  }, 0)
}

// Calculate total overtime hours from entries
function calcTotalOvertime(entries: TimeEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.overtime_info?.overtime_hours || 0), 0)
}

// Format overtime hours to display string
function formatOvertime(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}u ${m}m`
}

// Format minutes to display string
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return `${hours}u ${mins}m`
}

interface UserGroup {
  userId: string
  userName: string
  entries: TimeEntry[]
  totalMinutes: number
  totalOvertime: number
  totalKm: number
}

export default function AutoImportTab() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    loadEntries()
  }, [selectedMonth])

  const loadEntries = async () => {
    try {
      setLoading(true)
      const [year, month] = selectedMonth.split('-').map(Number)
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

      const response: PaginatedResponse<TimeEntry> = await getTimeEntries({
        bron: 'auto_import',
        datum__gte: startDate,
        datum__lte: endDate,
        page_size: 500,
        ordering: 'datum',
        auto_uren_only: true,
      })
      setEntries(response.results)
    } catch (err) {
      console.error('Failed to load auto-imported entries:', err)
      toast.error('Fout bij laden tachograaf uren')
    } finally {
      setLoading(false)
    }
  }

  // Group entries by user
  const userGroups: UserGroup[] = useMemo(() => {
    const filtered = searchTerm
      ? entries.filter(e => {
          const lower = searchTerm.toLowerCase()
          return (
            e.user_naam?.toLowerCase().includes(lower) ||
            e.kenteken?.toLowerCase().includes(lower) ||
            e.ritnummer?.toLowerCase().includes(lower)
          )
        })
      : entries

    const groupMap: Record<string, TimeEntry[]> = {}
    for (const entry of filtered) {
      const key = entry.user || 'unknown'
      if (!groupMap[key]) groupMap[key] = []
      groupMap[key].push(entry)
    }

    return Object.entries(groupMap)
      .map(([userId, userEntries]) => ({
        userId,
        userName: userEntries[0]?.user_naam || 'Onbekend',
        entries: userEntries.sort((a, b) => a.datum.localeCompare(b.datum)),
        totalMinutes: calcTotalMinutes(userEntries),
        totalOvertime: calcTotalOvertime(userEntries),
        totalKm: userEntries.reduce((sum, e) => sum + (e.totaal_km || 0), 0),
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName))
  }, [entries, searchTerm])

  // Overall totals
  const grandTotalMinutes = userGroups.reduce((sum, g) => sum + g.totalMinutes, 0)
  const grandTotalKm = userGroups.reduce((sum, g) => sum + g.totalKm, 0)
  const grandTotalRitten = userGroups.reduce((sum, g) => sum + g.entries.length, 0)

  const toggleUser = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  // Month options (last 12 months)
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
    return { value, label }
  })

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
                placeholder="Zoek op naam, kenteken of ritnummer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input pl-10 w-full"
              />
            </div>
            <select
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setExpandedUsers(new Set()) }}
              className="form-select sm:w-56"
            >
              {monthOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500 uppercase">Chauffeurs</p>
          <p className="text-2xl font-bold text-purple-600">{userGroups.length}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500 uppercase">Totaal uren</p>
          <p className="text-2xl font-bold text-purple-600">{formatMinutes(grandTotalMinutes)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500 uppercase">Totaal KM</p>
          <p className="text-2xl font-bold text-purple-600">{grandTotalKm}</p>
        </div>
      </div>

      {/* User groups */}
      <div className="space-y-3">
        {loading ? (
          <div className="card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
          </div>
        ) : userGroups.length === 0 ? (
          <div className="card p-8 text-center">
            <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Geen tachograaf uren gevonden voor deze periode</p>
          </div>
        ) : (
          userGroups.map(group => {
            const isExpanded = expandedUsers.has(group.userId)
            return (
              <div key={group.userId} className="card overflow-hidden">
                {/* User header - clickable */}
                <button
                  onClick={() => toggleUser(group.userId)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-purple-50/50 transition-colors text-left"
                >
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-purple-100 text-purple-700 flex-shrink-0">
                    <UserIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{group.userName}</h3>
                    <p className="text-xs text-gray-500">{group.entries.length} ritten</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Uren</p>
                      <p className="font-bold text-purple-600">{formatMinutes(group.totalMinutes)}</p>
                    </div>                    {group.totalOvertime > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Overuren</p>
                        <p className="font-bold text-orange-600">{formatOvertime(group.totalOvertime)}</p>
                      </div>
                    )}                    <div className="text-right">
                      <p className="text-xs text-gray-500">KM</p>
                      <p className="font-bold text-gray-900">{group.totalKm}</p>
                    </div>
                  </div>
                  {/* Mobile totals */}
                  <div className="sm:hidden text-right">
                    <p className="font-bold text-purple-600 text-sm">{formatMinutes(group.totalMinutes)}</p>
                    <p className="text-xs text-gray-500">{group.totalKm} km</p>
                  </div>
                  <ChevronDownIcon className={`h-5 w-5 text-gray-400 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded entries */}
                {isExpanded && (
                  <div className="border-t border-gray-200">
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-purple-50/50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.date')}</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('timeEntries.routeNumberShort')}</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('fleet.licensePlate')}</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('timeEntries.startTime')}</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('timeEntries.endTime')}</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('timeEntries.hours')}</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Overuren</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('timeEntries.km')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {group.entries.map(entry => (
                            <tr key={entry.id} className="hover:bg-purple-50/30">
                              <td className="px-4 py-2 text-sm">{formatDate(entry.datum)}</td>
                              <td className="px-4 py-2 text-sm font-mono">{entry.ritnummer}</td>
                              <td className="px-4 py-2 text-sm font-mono">{entry.kenteken}</td>
                              <td className="px-4 py-2 text-sm">{entry.aanvang || '-'}</td>
                              <td className="px-4 py-2 text-sm">{entry.eind || '-'}</td>
                              <td className="px-4 py-2 text-sm text-right font-medium text-purple-600">{formatDuration(entry.totaal_uren)}</td>
                              <td className="px-4 py-2 text-sm text-right font-medium text-orange-600">
                                {entry.overtime_info ? (
                                  <span title={entry.overtime_info.formula}>{entry.overtime_info.overtime_display}</span>
                                ) : '-'}
                              </td>
                              <td className="px-4 py-2 text-sm text-right">{entry.totaal_km}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-purple-50/50">
                          <tr>
                            <td colSpan={5} className="px-4 py-2 text-sm font-semibold text-right">Totaal:</td>
                            <td className="px-4 py-2 text-sm text-right font-bold text-purple-600">{formatMinutes(group.totalMinutes)}</td>
                            <td className="px-4 py-2 text-sm text-right font-bold text-orange-600">{group.totalOvertime > 0 ? formatOvertime(group.totalOvertime) : '-'}</td>
                            <td className="px-4 py-2 text-sm text-right font-bold">{group.totalKm}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile entries */}
                    <div className="md:hidden divide-y divide-gray-100">
                      {group.entries.map(entry => (
                        <div key={entry.id} className="p-3 hover:bg-purple-50/30">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="font-medium text-gray-900 text-sm">{formatDate(entry.datum)}</h4>
                            <div className="text-right">
                              <span className="font-bold text-purple-600 text-sm">{formatDuration(entry.totaal_uren)}</span>
                              {entry.overtime_info && entry.overtime_info.overtime_hours > 0 && (
                                <span className="ml-2 text-xs font-medium text-orange-600">+{entry.overtime_info.overtime_display}</span>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 text-xs">
                            <div>
                              <span className="text-gray-500">{t('fleet.licensePlate')}: </span>
                              <span className="font-mono font-medium">{entry.kenteken}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">{t('common.time')}: </span>
                              <span className="font-medium">{entry.aanvang || '-'} - {entry.eind || '-'}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">{t('timeEntries.km')}: </span>
                              <span className="font-medium">{entry.totaal_km}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="p-3 bg-purple-50/50">
                        <div className="flex justify-between text-sm font-bold">
                          <span>Totaal:</span>
                          <div className="flex gap-4">
                            <span className="text-purple-600">{formatMinutes(group.totalMinutes)}</span>
                            <span>{group.totalKm} km</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Grand total footer */}
      {userGroups.length > 1 && (
        <div className="card mt-4 p-4 bg-purple-50">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-gray-700">Totaal alle chauffeurs</span>
            <div className="flex gap-6 text-sm">
              <div className="text-right">
                <span className="text-gray-500 mr-2">Ritten:</span>
                <span className="font-bold">{grandTotalRitten}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-500 mr-2">Uren:</span>
                <span className="font-bold text-purple-600">{formatMinutes(grandTotalMinutes)}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-500 mr-2">KM:</span>
                <span className="font-bold">{grandTotalKm}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
