/**
 * Leave Balance Tab
 * Shows remaining leave hours for all employees (admin view).
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
  SunIcon,
  ClockIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { getAllLeaveBalances, LeaveBalance } from '@/api/leave'

export default function LeaveBalanceTab() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [filteredBalances, setFilteredBalances] = useState<LeaveBalance[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  useEffect(() => {
    fetchBalances()
  }, [])

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredBalances(balances)
    } else {
      const term = searchTerm.toLowerCase()
      setFilteredBalances(
        balances.filter(
          (b) =>
            b.user_naam.toLowerCase().includes(term) ||
            b.user_email.toLowerCase().includes(term)
        )
      )
    }
    setCurrentPage(1)
  }, [balances, searchTerm])

  const fetchBalances = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAllLeaveBalances()
      // Sort alphabetically by name
      data.sort((a, b) => a.user_naam.localeCompare(b.user_naam))
      setBalances(data)
    } catch (err: any) {
      setError(err.message || 'Fout bij ophalen verlofsaldo\'s.')
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.ceil(filteredBalances.length / pageSize)
  const paginatedData = filteredBalances.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  // Summary stats
  const totalEmployees = balances.length
  const avgVacation =
    totalEmployees > 0
      ? balances.reduce((sum, b) => sum + Number(b.vacation_hours), 0) / totalEmployees
      : 0
  const avgOvertime =
    totalEmployees > 0
      ? balances.reduce((sum, b) => sum + Number(b.overtime_hours), 0) / totalEmployees
      : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <SunIcon className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Gem. verlofuren</p>
              <p className="text-lg font-bold text-gray-900">{avgVacation.toFixed(1)}u</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <ClockIcon className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Gem. overuren</p>
              <p className="text-lg font-bold text-gray-900">{avgOvertime.toFixed(1)}u</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <ArrowPathIcon className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Medewerkers</p>
              <p className="text-lg font-bold text-gray-900">{totalEmployees}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="card p-4">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Zoek op naam of e-mail..."
            className="form-input pl-10 w-full"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medewerker
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  E-mail
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Verlofuren
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Overuren
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Opneembaar (overuren)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Totaal beschikbaar
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {paginatedData.map((balance) => {
                const vacHours = Number(balance.vacation_hours)
                const overtimeHours = Number(balance.overtime_hours)
                const availableOvertime = Number(balance.available_overtime_for_leave)
                const totalAvailable = vacHours + availableOvertime
                const isLow = vacHours < 20

                return (
                  <tr key={balance.id} className={isLow ? 'bg-red-50/30' : ''}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {balance.user_naam}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {balance.user_email}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                      <span className={`font-semibold ${isLow ? 'text-red-600' : 'text-blue-600'}`}>
                        {vacHours}u
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-purple-600">
                      {overtimeHours}u
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                      {availableOvertime}u
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                      <span className="font-bold text-green-700">{totalAvailable.toFixed(1)}u</span>
                    </td>
                  </tr>
                )
              })}
              {paginatedData.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Geen resultaten gevonden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-gray-200">
          {paginatedData.map((balance) => {
            const vacHours = Number(balance.vacation_hours)
            const overtimeHours = Number(balance.overtime_hours)
            const availableOvertime = Number(balance.available_overtime_for_leave)
            const totalAvailable = vacHours + availableOvertime
            const isLow = vacHours < 20

            return (
              <div key={balance.id} className={`p-3 ${isLow ? 'bg-red-50/30' : ''}`}>
                <div className="mb-2">
                  <p className="font-medium text-gray-900 text-sm">{balance.user_naam}</p>
                  <p className="text-xs text-gray-500">{balance.user_email}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500 block">Verlofuren</span>
                    <span className={`font-semibold ${isLow ? 'text-red-600' : 'text-blue-600'}`}>
                      {vacHours}u
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Overuren</span>
                    <span className="font-semibold text-purple-600">{overtimeHours}u</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Opneembaar</span>
                    <span className="font-medium text-gray-600">{availableOvertime}u</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Totaal beschikbaar</span>
                    <span className="font-bold text-green-700">{totalAvailable.toFixed(1)}u</span>
                  </div>
                </div>
              </div>
            )
          })}
          {paginatedData.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Geen resultaten gevonden.
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredBalances.length)} van {filteredBalances.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.previous')}
              </button>
              <span className="px-3 py-1.5 text-sm text-gray-600">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
