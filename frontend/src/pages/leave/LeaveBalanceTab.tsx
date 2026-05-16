/**
 * Leave Balance Tab
 * Shows remaining leave hours for all employees (admin/view_leave_balances) or
 * only the current user's own balance (users without that permission).
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
  SunIcon,
  ClockIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { adjustLeaveBalance, getAllLeaveBalances, LeaveBalance } from '@/api/leave'
import { useAuthStore } from '@/stores/authStore'

export default function LeaveBalanceTab() {
  const { t } = useTranslation()
  const { user } = useAuthStore()

  // Determine whether this user may see all employees' balances
  const canViewAll =
    user?.rol === 'admin' ||
    (user?.module_permissions?.includes('view_leave_balances') ?? false)

  const [loading, setLoading] = useState(true)
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [filteredBalances, setFilteredBalances] = useState<LeaveBalance[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  // Adjust-balance modal state (only used when canViewAll)
  const [editingBalance, setEditingBalance] = useState<LeaveBalance | null>(null)
  const [vacationDelta, setVacationDelta] = useState<string>('')
  const [overtimeDelta, setOvertimeDelta] = useState<string>('')
  const [adjustReason, setAdjustReason] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  useEffect(() => {
    fetchBalances()
  }, [])

  useEffect(() => {
    if (!canViewAll || !searchTerm.trim()) {
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
  }, [balances, searchTerm, canViewAll])

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

  const openAdjustModal = (balance: LeaveBalance) => {
    setEditingBalance(balance)
    setVacationDelta('')
    setOvertimeDelta('')
    setAdjustReason('')
    setModalError(null)
  }

  const closeAdjustModal = () => {
    if (saving) return
    setEditingBalance(null)
    setVacationDelta('')
    setOvertimeDelta('')
    setAdjustReason('')
    setModalError(null)
  }

  const handleAdjustSave = async () => {
    if (!editingBalance) return
    const vacNum = vacationDelta.trim() === '' ? 0 : Number(vacationDelta)
    const otNum = overtimeDelta.trim() === '' ? 0 : Number(overtimeDelta)
    if (Number.isNaN(vacNum) || Number.isNaN(otNum)) {
      setModalError('Voer geldige getallen in.')
      return
    }
    if (vacNum === 0 && otNum === 0) {
      setModalError('Geef minstens één wijziging op (verlofuren of overuren).')
      return
    }
    setSaving(true)
    setModalError(null)
    try {
      const updated = await adjustLeaveBalance(editingBalance.id, {
        vacation_delta: vacNum,
        overtime_delta: otNum,
        reason: adjustReason.trim() || undefined,
      })
      // Replace the balance in local state
      setBalances((prev) =>
        prev.map((b) => (b.id === updated.id ? updated : b))
      )
      setEditingBalance(null)
      setVacationDelta('')
      setOvertimeDelta('')
      setAdjustReason('')
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Bijwerken van het verlofsaldo is mislukt.'
      setModalError(msg)
    } finally {
      setSaving(false)
    }
  }

  const totalPages = Math.ceil(filteredBalances.length / pageSize)
  const paginatedData = filteredBalances.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  // Summary stats — for restricted users show own values, for admins show averages
  const totalEmployees = balances.length
  const ownBalance = balances.find((b) => b.user === user?.id) ?? balances[0] ?? null
  const avgVacation = canViewAll
    ? totalEmployees > 0
      ? balances.reduce((sum, b) => sum + Number(b.vacation_hours), 0) / totalEmployees
      : 0
    : Number(ownBalance?.vacation_hours ?? 0)
  const avgOvertime = canViewAll
    ? totalEmployees > 0
      ? balances.reduce((sum, b) => sum + Number(b.overtime_hours), 0) / totalEmployees
      : 0
    : Number(ownBalance?.overtime_hours ?? 0)

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
              <p className="text-xs text-gray-500">{canViewAll ? 'Gem. verlofuren' : 'Verlofuren'}</p>
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
              <p className="text-xs text-gray-500">{canViewAll ? 'Gem. overuren' : 'Overuren'}</p>
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

      {/* Search — only shown when the user can view all balances */}
      {canViewAll && (
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
      )}

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
                {canViewAll && (
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acties
                  </th>
                )}
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
                    {canViewAll && (
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                        <button
                          type="button"
                          onClick={() => openAdjustModal(balance)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 rounded"
                          title="Verlofsaldo bijwerken"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                          Bijwerken
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {paginatedData.length === 0 && (
                <tr>
                  <td colSpan={canViewAll ? 7 : 6} className="px-4 py-8 text-center text-gray-500">
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
                {canViewAll && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => openAdjustModal(balance)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 rounded border border-primary-200"
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                      Bijwerken
                    </button>
                  </div>
                )}
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

      {/* Adjust balance modal (admins / view_leave_balances permission only) */}
      {canViewAll && editingBalance && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeAdjustModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                Verlofsaldo bijwerken
              </h2>
              <button
                type="button"
                onClick={closeAdjustModal}
                disabled={saving}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Sluiten"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-4 space-y-4">
              <div className="text-sm text-gray-600">
                <div>
                  <span className="font-medium text-gray-900">{editingBalance.user_naam}</span>
                </div>
                <div className="text-xs text-gray-500">{editingBalance.user_email}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    Huidige verlofuren:{' '}
                    <span className="font-semibold text-blue-600">
                      {Number(editingBalance.vacation_hours)}u
                    </span>
                  </div>
                  <div>
                    Huidige overuren:{' '}
                    <span className="font-semibold text-purple-600">
                      {Number(editingBalance.overtime_hours)}u
                    </span>
                  </div>
                </div>
              </div>

              {modalError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  {modalError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verlofuren toevoegen (gebruik negatief om af te trekken)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={vacationDelta}
                  onChange={(e) => setVacationDelta(e.target.value)}
                  placeholder="bijv. 8 of -4"
                  className="form-input w-full"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Overuren toevoegen (gebruik negatief om af te trekken)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={overtimeDelta}
                  onChange={(e) => setOvertimeDelta(e.target.value)}
                  placeholder="bijv. 2 of -1"
                  className="form-input w-full"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reden (optioneel)
                </label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="bijv. correctie, bonus"
                  className="form-input w-full"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={closeAdjustModal}
                disabled={saving}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {t('common.cancel', 'Annuleren')}
              </button>
              <button
                type="button"
                onClick={handleAdjustSave}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Bezig...' : t('common.save', 'Opslaan')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
