/**
 * Leave Settings Page (Admin)
 * Admin interface for managing leave settings:
 * - Global settings (default hours, work week hours, overtime percentage)
 * - Per-user leave balance management
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  UserGroupIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getAllBalances,
  updateLeaveBalance,
  GlobalLeaveSettings,
  LeaveBalance,
} from '@/api/leave'

export default function LeaveSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  
  // Global settings state
  const [globalSettings, setGlobalSettings] = useState<GlobalLeaveSettings | null>(null)
  const [editingGlobal, setEditingGlobal] = useState(false)
  const [globalForm, setGlobalForm] = useState({
    default_vacation_hours: 216,
    work_week_hours: 40,
    overtime_leave_percentage: 50,
    free_special_leave_hours: 1,
  })
  
  // Balances state
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [editingBalance, setEditingBalance] = useState<string | null>(null)
  const [balanceForm, setBalanceForm] = useState({
    vacation_hours: 0,
    overtime_hours: 0,
  })
  
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [settings, balanceList] = await Promise.all([
        getGlobalSettings(),
        getAllBalances(),
      ])
      setGlobalSettings(settings)
      setGlobalForm({
        default_vacation_hours: settings.default_vacation_hours,
        work_week_hours: settings.work_week_hours,
        overtime_leave_percentage: settings.overtime_leave_percentage,
        free_special_leave_hours: settings.free_special_leave_hours,
      })
      setBalances(balanceList)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setIsLoading(false)
    }
  }

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const handleSaveGlobalSettings = async () => {
    if (!globalSettings) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateGlobalSettings(globalSettings.id, globalForm)
      setGlobalSettings(updated)
      setEditingGlobal(false)
      showSuccess(t('settings.saved'))
    } catch (err: any) {
      setError(err.message || t('errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const startEditBalance = (balance: LeaveBalance) => {
    setEditingBalance(balance.id)
    setBalanceForm({
      vacation_hours: balance.vacation_hours,
      overtime_hours: balance.overtime_hours,
    })
  }

  const cancelEditBalance = () => {
    setEditingBalance(null)
    setBalanceForm({ vacation_hours: 0, overtime_hours: 0 })
  }

  const handleSaveBalance = async (balanceId: string) => {
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateLeaveBalance(balanceId, balanceForm)
      setBalances(balances.map(b => b.id === balanceId ? updated : b))
      setEditingBalance(null)
      showSuccess(t('common.success'))
    } catch (err: any) {
      setError(err.message || t('errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Header - hidden when embedded */}
      {!embedded && (
        <div>
          <Link
            to="/settings"
            className="flex items-center text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            {t('common.back')}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{t('settings.leaveSettings')}</h1>
          <p className="text-gray-500">{t('leave.title')}</p>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      {/* Global Settings */}
      <div className="card">
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Cog6ToothIcon className="w-5 h-5 text-gray-400" />
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">{t('settings.general')}</h2>
          </div>
          {!editingGlobal && (
            <button
              onClick={() => setEditingGlobal(true)}
              className="text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        <div className="p-4 sm:p-6">
          {editingGlobal ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Standaard vakantie-uren per jaar
                  </label>
                  <input
                    type="number"
                    value={globalForm.default_vacation_hours}
                    onChange={(e) => setGlobalForm({ ...globalForm, default_vacation_hours: Number(e.target.value) })}
                    className="input"
                    min="0"
                    step="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Standaard: 216 uur</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Werkweek uren
                  </label>
                  <input
                    type="number"
                    value={globalForm.work_week_hours}
                    onChange={(e) => setGlobalForm({ ...globalForm, work_week_hours: Number(e.target.value) })}
                    className="input"
                    min="1"
                    step="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Uren boven dit aantal = overwerk</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Overwerk percentage voor verlof (%)
                  </label>
                  <input
                    type="number"
                    value={globalForm.overtime_leave_percentage}
                    onChange={(e) => setGlobalForm({ ...globalForm, overtime_leave_percentage: Number(e.target.value) })}
                    className="input"
                    min="0"
                    max="100"
                    step="1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Hoeveel % van overwerk als verlof opneembaar is</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Gratis bijzonder verlof per maand (uren)
                  </label>
                  <input
                    type="number"
                    value={globalForm.free_special_leave_hours}
                    onChange={(e) => setGlobalForm({ ...globalForm, free_special_leave_hours: Number(e.target.value) })}
                    className="input"
                    min="0"
                    step="0.5"
                  />
                  <p className="text-xs text-gray-500 mt-1">Extra uren worden van vakantie afgetrokken</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  onClick={() => {
                    setEditingGlobal(false)
                    setGlobalForm({
                      default_vacation_hours: globalSettings?.default_vacation_hours || 216,
                      work_week_hours: globalSettings?.work_week_hours || 40,
                      overtime_leave_percentage: globalSettings?.overtime_leave_percentage || 50,
                      free_special_leave_hours: globalSettings?.free_special_leave_hours || 1,
                    })
                  }}
                  className="btn btn-secondary"
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveGlobalSettings}
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs sm:text-sm text-gray-500">Standaard vakantie-uren</p>
                <p className="text-lg sm:text-2xl font-semibold text-gray-900">
                  {globalSettings?.default_vacation_hours || 216}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs sm:text-sm text-gray-500">Werkweek uren</p>
                <p className="text-lg sm:text-2xl font-semibold text-gray-900">
                  {globalSettings?.work_week_hours || 40}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs sm:text-sm text-gray-500">Overwerk % verlof</p>
                <p className="text-lg sm:text-2xl font-semibold text-gray-900">
                  {globalSettings?.overtime_leave_percentage || 50}%
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs sm:text-sm text-gray-500">Gratis bijz. verlof</p>
                <p className="text-lg sm:text-2xl font-semibold text-gray-900">
                  {globalSettings?.free_special_leave_hours || 1} uur
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Balances */}
      <div className="card">
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center gap-2 sm:gap-3">
          <UserGroupIcon className="w-5 h-5 text-gray-400" />
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">{t('leave.balance')}</h2>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">
                  {t('leave.employee')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('leave.vacationHours')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('leave.overtimeHours')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('leave.overtimeAvailable')}
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {balances.map((balance) => {
                const isEditing = editingBalance === balance.id
                const usableOvertime = balance.overtime_hours * (globalSettings?.overtime_leave_percentage || 50) / 100
                
                return (
                  <tr key={balance.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{balance.user_naam}</p>
                        <p className="text-xs text-gray-500">{balance.user_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={balanceForm.vacation_hours}
                          onChange={(e) => setBalanceForm({ ...balanceForm, vacation_hours: Number(e.target.value) })}
                          className="input w-24 text-right"
                          min="0"
                          step="0.5"
                        />
                      ) : (
                        <span className="text-sm font-medium">{balance.vacation_hours} uur</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={balanceForm.overtime_hours}
                          onChange={(e) => setBalanceForm({ ...balanceForm, overtime_hours: Number(e.target.value) })}
                          className="input w-24 text-right"
                          step="0.5"
                        />
                      ) : (
                        <span className={`text-sm ${balance.overtime_hours >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {balance.overtime_hours >= 0 ? '+' : ''}{balance.overtime_hours} uur
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <span className="text-sm text-gray-600">
                        {usableOvertime.toFixed(1)} uur
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEditBalance}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            disabled={isSaving}
                          >
                            <XMarkIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleSaveBalance(balance.id)}
                            className="p-1 text-green-600 hover:text-green-700"
                            disabled={isSaving}
                          >
                            <CheckIcon className="w-5 h-5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditBalance(balance)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <PencilIcon className="w-5 h-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {balances.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    {t('common.noResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="sm:hidden divide-y divide-gray-200">
          {balances.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              {t('common.noResults')}
            </div>
          ) : (
            balances.map((balance) => {
              const isEditing = editingBalance === balance.id
              const usableOvertime = balance.overtime_hours * (globalSettings?.overtime_leave_percentage || 50) / 100

              return (
                <div key={balance.id} className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{balance.user_naam}</p>
                      <p className="text-xs text-gray-500 truncate">{balance.user_email}</p>
                    </div>
                    {isEditing ? (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={cancelEditBalance}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                          disabled={isSaving}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleSaveBalance(balance.id)}
                          className="p-1.5 text-green-600 hover:text-green-700 rounded"
                          disabled={isSaving}
                        >
                          <CheckIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditBalance(balance)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t('leave.vacationHours')}</label>
                        <input
                          type="number"
                          value={balanceForm.vacation_hours}
                          onChange={(e) => setBalanceForm({ ...balanceForm, vacation_hours: Number(e.target.value) })}
                          className="input text-sm w-full"
                          min="0"
                          step="0.5"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t('leave.overtimeHours')}</label>
                        <input
                          type="number"
                          value={balanceForm.overtime_hours}
                          onChange={(e) => setBalanceForm({ ...balanceForm, overtime_hours: Number(e.target.value) })}
                          className="input text-sm w-full"
                          step="0.5"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 block">Vakantie</span>
                        <span className="font-medium">{balance.vacation_hours} uur</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Overwerk</span>
                        <span className={`font-medium ${balance.overtime_hours >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {balance.overtime_hours >= 0 ? '+' : ''}{balance.overtime_hours} uur
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Beschikbaar</span>
                        <span className="font-medium text-gray-600">{usableOvertime.toFixed(1)} uur</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
