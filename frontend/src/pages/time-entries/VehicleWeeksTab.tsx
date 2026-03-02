/**
 * Vehicle Weeks Tab
 * Shows worked weeks vs minimum weeks per vehicle.
 * Only vehicles with minimum_weken_per_jaar configured appear.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
  TruckIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import {
  VehicleWeeksOverview,
  getVehicleWeeksOverview,
} from '@/api/fleet'
import { getCurrentYear } from '@/api/timetracking'
import toast from 'react-hot-toast'

export default function VehicleWeeksTab() {
  const { t } = useTranslation()
  
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<VehicleWeeksOverview[]>([])
  const [filteredData, setFilteredData] = useState<VehicleWeeksOverview[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedYear, setSelectedYear] = useState(getCurrentYear())
  const [showOnlyBehind, setShowOnlyBehind] = useState(false)
  
  const years = Array.from({ length: 5 }, (_, i) => getCurrentYear() - i)

  useEffect(() => {
    loadData()
  }, [selectedYear])

  useEffect(() => {
    let filtered = [...data]
    
    if (searchTerm) {
      const lower = searchTerm.toLowerCase()
      filtered = filtered.filter(row =>
        row.kenteken.toLowerCase().includes(lower) ||
        row.ritnummer.toLowerCase().includes(lower) ||
        row.type_wagen.toLowerCase().includes(lower) ||
        row.bedrijf_naam.toLowerCase().includes(lower)
      )
    }
    
    if (showOnlyBehind) {
      filtered = filtered.filter(row => row.percentage < 100)
    }
    
    setFilteredData(filtered)
  }, [searchTerm, data, showOnlyBehind])

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await getVehicleWeeksOverview(selectedYear)
      setData(result)
      setFilteredData(result)
    } catch (err) {
      console.error('Failed to load vehicle weeks overview:', err)
      toast.error(t('vehicleWeeks.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-green-500'
    if (percentage >= 75) return 'bg-yellow-500'
    if (percentage >= 50) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const getTextColor = (percentage: number) => {
    if (percentage >= 100) return 'text-green-700'
    if (percentage >= 75) return 'text-yellow-700'
    return 'text-red-600'
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
                placeholder={t('vehicleWeeks.searchPlaceholder')}
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
                checked={showOnlyBehind}
                onChange={(e) => setShowOnlyBehind(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {t('vehicleWeeks.showOnlyBehind')}
            </label>
          </div>
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
            <TruckIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">{t('vehicleWeeks.noData')}</p>
            <p className="text-gray-400 text-sm mt-1">{t('vehicleWeeks.noDataHint')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('fleet.vehicle')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('fleet.licensePlate')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('fleet.routeNumber')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('vehicleWeeks.minimumWeeks')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('vehicleWeeks.workedWeeks')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('vehicleWeeks.totalMissed')}
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '180px' }}>
                      {t('vehicleWeeks.progress')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredData.map((row) => {
                    const isBehind = row.percentage < 100
                    
                    return (
                      <tr key={row.vehicle_id} className={`hover:bg-gray-50 ${isBehind && row.gemiste_weken > 0 ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{row.type_wagen || '-'}</div>
                          <div className="text-xs text-gray-500">{row.bedrijf_naam}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-yellow-50 border border-yellow-200 font-mono text-sm font-bold text-gray-800">
                            {row.kenteken}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {row.ritnummer || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-700">
                          {row.minimum_weken}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                          <span className={`font-semibold ${isBehind ? 'text-red-600' : 'text-green-600'}`}>
                            {row.gewerkte_weken}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                          {row.gemiste_weken > 0 ? (
                            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                              <ExclamationTriangleIcon className="h-4 w-4" />
                              {row.gemiste_weken}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <CheckCircleIcon className="h-4 w-4" />
                              0
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${getProgressColor(row.percentage)}`}
                                style={{ width: `${Math.min(row.percentage, 100)}%` }}
                              />
                            </div>
                            <span className={`text-sm font-bold min-w-[48px] text-right ${getTextColor(row.percentage)}`}>
                              {row.percentage}%
                            </span>
                          </div>
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
                const isBehind = row.percentage < 100
                
                return (
                  <div key={row.vehicle_id} className={`p-3 ${isBehind && row.gemiste_weken > 0 ? 'bg-red-50/30' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <TruckIcon className="h-8 w-8 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
                            {row.kenteken}
                          </span>
                          {row.ritnummer && (
                            <span className="text-xs text-gray-500">{row.ritnummer}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{row.type_wagen} • {row.bedrijf_naam}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div>
                        <span className="text-gray-500 block">{t('vehicleWeeks.minShort')}</span>
                        <span className="font-medium">{row.minimum_weken}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('vehicleWeeks.workedShort')}</span>
                        <span className={`font-semibold ${isBehind ? 'text-red-600' : 'text-green-600'}`}>
                          {row.gewerkte_weken}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">{t('vehicleWeeks.missedShort')}</span>
                        <span className={row.gemiste_weken > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>
                          {row.gemiste_weken}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getProgressColor(row.percentage)}`}
                          style={{ width: `${Math.min(row.percentage, 100)}%` }}
                        />
                      </div>
                      <span className={`text-sm font-bold min-w-[48px] text-right ${getTextColor(row.percentage)}`}>
                        {row.percentage}%
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
