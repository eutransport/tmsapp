/**
 * Vehicle Averages Tab
 * Gemiddeld aantal km en uren per kenteken, per week en per maand.
 * Op basis van ingediende urenregistraties.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  MagnifyingGlassIcon,
  TruckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline'
import { getVehicleAverages, VehicleAverages } from '@/api/fleet'
import { getCurrentYear } from '@/api/timetracking'
import toast from 'react-hot-toast'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
]

function formatHours(h: number): string {
  const hours = Math.floor(h)
  const minutes = Math.round((h - hours) * 60)
  return `${hours}u ${minutes.toString().padStart(2, '0')}m`
}

function formatKm(km: number): string {
  return new Intl.NumberFormat('nl-NL').format(Math.round(km)) + ' km'
}

export default function VehicleAveragesTab() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<VehicleAverages[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [expanded, setExpanded] = useState<Record<string, 'week' | 'month' | null>>({})

  const years = Array.from({ length: 5 }, (_, i) => getCurrentYear() - i).filter(y => y >= 2026)

  useEffect(() => {
    loadData()
  }, [selectedYear])

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await getVehicleAverages(selectedYear)
      setData(result)
    } catch (err) {
      console.error('Failed to load vehicle averages:', err)
      toast.error('Kon gemiddelden niet laden')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!searchTerm) return data
    const lower = searchTerm.toLowerCase()
    return data.filter(v =>
      v.kenteken.toLowerCase().includes(lower) ||
      (v.ritnummer || '').toLowerCase().includes(lower) ||
      (v.type_wagen || '').toLowerCase().includes(lower) ||
      (v.bedrijf_naam || '').toLowerCase().includes(lower)
    )
  }, [data, searchTerm])

  const toggle = (kenteken: string, view: 'week' | 'month') => {
    setExpanded(prev => ({
      ...prev,
      [kenteken]: prev[kenteken] === view ? null : view,
    }))
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Filters */}
      <div className="card">
        <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Zoek op kenteken, ritnummer, type of bedrijf..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading / empty */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">
          <TruckIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p>Geen ingediende uren gevonden voor {selectedYear}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(v => {
            const view = expanded[v.kenteken]
            return (
              <div key={v.kenteken} className="card overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-primary-100 text-primary-700 rounded-lg p-2 flex-shrink-0">
                      <TruckIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">
                        {v.kenteken}
                        {v.ritnummer && <span className="ml-2 text-xs text-gray-500">#{v.ritnummer}</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {[v.type_wagen, v.bedrijf_naam].filter(Boolean).join(' • ') || '-'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggle(v.kenteken, 'week')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1 ${
                        view === 'week'
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {view === 'week' ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                      <ChartBarIcon className="h-3 w-3" />
                      Per week
                    </button>
                    <button
                      onClick={() => toggle(v.kenteken, 'month')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1 ${
                        view === 'month'
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {view === 'month' ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                      <CalendarDaysIcon className="h-3 w-3" />
                      Per maand
                    </button>
                  </div>
                </div>

                {/* Summary cards */}
                <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <SummaryCard label="Totaal km" value={formatKm(v.totals.total_km)} sub={`${v.totals.days_worked} dagen`} />
                  <SummaryCard label="Totaal uren" value={formatHours(v.totals.total_hours)} sub={`${v.totals.weeks_worked} weken`} />
                  <SummaryCard label="Ø km / dag" value={formatKm(v.averages.avg_km_per_day)} highlight />
                  <SummaryCard label="Ø uren / dag" value={formatHours(v.averages.avg_hours_per_day)} highlight />
                  <SummaryCard label="Ø km / week" value={formatKm(v.averages.avg_km_per_week)} highlight />
                  <SummaryCard label="Ø uren / week" value={formatHours(v.averages.avg_hours_per_week)} highlight />
                </div>

                {/* Weekly breakdown */}
                {view === 'week' && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-2 text-left">Week</th>
                          <th className="px-4 py-2 text-right">Dagen</th>
                          <th className="px-4 py-2 text-right">Totaal km</th>
                          <th className="px-4 py-2 text-right">Totaal uren</th>
                          <th className="px-4 py-2 text-right">Ø km/dag</th>
                          <th className="px-4 py-2 text-right">Ø uren/dag</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {v.weekly.map(w => (
                          <tr key={`${w.year}-${w.week}`} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-900">Week {w.week} <span className="text-gray-400 text-xs">{w.year}</span></td>
                            <td className="px-4 py-2 text-right text-gray-700">{w.days_worked}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{formatKm(w.total_km)}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{formatHours(w.total_hours)}</td>
                            <td className="px-4 py-2 text-right font-medium text-primary-700">{formatKm(w.avg_km_per_day)}</td>
                            <td className="px-4 py-2 text-right font-medium text-primary-700">{formatHours(w.avg_hours_per_day)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Monthly breakdown */}
                {view === 'month' && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-2 text-left">Maand</th>
                          <th className="px-4 py-2 text-right">Dagen</th>
                          <th className="px-4 py-2 text-right">Totaal km</th>
                          <th className="px-4 py-2 text-right">Totaal uren</th>
                          <th className="px-4 py-2 text-right">Ø km/dag</th>
                          <th className="px-4 py-2 text-right">Ø uren/dag</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {v.monthly.map(m => (
                          <tr key={`${m.year}-${m.month}`} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-900">{MONTH_NAMES[m.month - 1]} <span className="text-gray-400 text-xs">{m.year}</span></td>
                            <td className="px-4 py-2 text-right text-gray-700">{m.days_worked}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{formatKm(m.total_km)}</td>
                            <td className="px-4 py-2 text-right text-gray-700">{formatHours(m.total_hours)}</td>
                            <td className="px-4 py-2 text-right font-medium text-primary-700">{formatKm(m.avg_km_per_day)}</td>
                            <td className="px-4 py-2 text-right font-medium text-primary-700">{formatHours(m.avg_hours_per_day)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${highlight ? 'bg-primary-50 border-primary-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-base font-semibold ${highlight ? 'text-primary-700' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
