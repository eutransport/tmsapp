/**
 * Leave Settings Page (Admin)
 * Admin interface for managing leave settings:
 * - Global settings (default hours, work week hours, overtime percentage)
 * - Leave reminder email settings
 * - Per-user leave balance management
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftIcon,
  Cog6ToothIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline'
import {
  getGlobalSettings,
  updateGlobalSettings,
  GlobalLeaveSettings,
} from '@/api/leave'

const DEFAULT_REMINDER_WEEKS = [1, 2, 3, 4]

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
  
  // Reminder settings state
  const [editingReminder, setEditingReminder] = useState(false)
  const [reminderForm, setReminderForm] = useState({
    leave_reminder_enabled: false,
    leave_reminder_email: '',
    leave_reminder_weeks_before: DEFAULT_REMINDER_WEEKS as number[],
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
      const settings = await getGlobalSettings()
      setGlobalSettings(settings)
      setGlobalForm({
        default_vacation_hours: settings.default_vacation_hours,
        work_week_hours: settings.work_week_hours,
        overtime_leave_percentage: settings.overtime_leave_percentage,
        free_special_leave_hours: settings.free_special_leave_hours,
      })
      setReminderForm({
        leave_reminder_enabled: settings.leave_reminder_enabled ?? false,
        leave_reminder_email: settings.leave_reminder_email ?? '',
        leave_reminder_weeks_before: settings.leave_reminder_weeks_before?.length
          ? settings.leave_reminder_weeks_before
          : DEFAULT_REMINDER_WEEKS,
      })
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
      const payload = {
        default_leave_hours: String(globalForm.default_vacation_hours),
        standard_work_week_hours: String(globalForm.work_week_hours),
        overtime_leave_percentage: globalForm.overtime_leave_percentage,
        free_special_leave_hours_per_month: String(globalForm.free_special_leave_hours),
      }
      const updated = await updateGlobalSettings(globalSettings.id, payload)
      setGlobalSettings(updated)
      setEditingGlobal(false)
      showSuccess(t('settings.saved'))
    } catch (err: any) {
      setError(err.message || t('errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveReminderSettings = async () => {
    if (!globalSettings) return
    setIsSaving(true)
    setError(null)
    try {
      const payload = {
        leave_reminder_enabled: reminderForm.leave_reminder_enabled,
        leave_reminder_email: reminderForm.leave_reminder_email,
        leave_reminder_weeks_before: reminderForm.leave_reminder_weeks_before,
      }
      const updated = await updateGlobalSettings(globalSettings.id, payload)
      setGlobalSettings(updated)
      setEditingReminder(false)
      showSuccess(t('settings.saved'))
    } catch (err: any) {
      setError(err.message || t('errors.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  const toggleWeek = (week: number) => {
    setReminderForm(prev => {
      const weeks = prev.leave_reminder_weeks_before.includes(week)
        ? prev.leave_reminder_weeks_before.filter(w => w !== week)
        : [...prev.leave_reminder_weeks_before, week].sort((a, b) => a - b)
      return { ...prev, leave_reminder_weeks_before: weeks }
    })
  }

  const getWeeksLabel = (weeks: number[]): string => {
    if (!weeks || weeks.length === 0) return 'Geen'
    const sorted = [...weeks].sort((a, b) => b - a)
    return sorted.map(w => w === 1 ? '1 week' : `${w} weken`).join(', ')
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

      {/* Leave Reminder Settings */}
      <div className="card">
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <EnvelopeIcon className="w-5 h-5 text-gray-400" />
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Verlofherinneringen</h2>
              <p className="text-xs sm:text-sm text-gray-500">
                Automatische e-mailherinneringen voor aankomend verlof
              </p>
            </div>
          </div>
          {!editingReminder && (
            <button
              onClick={() => setEditingReminder(true)}
              className="text-primary-600 hover:text-primary-700 text-sm font-medium"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        <div className="p-4 sm:p-6">
          {editingReminder ? (
            <div className="space-y-4">
              {/* Enable/Disable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Herinneringen inschakelen
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Stuur automatisch e-mails voorafgaand aan goedgekeurd verlof
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReminderForm(prev => ({
                    ...prev,
                    leave_reminder_enabled: !prev.leave_reminder_enabled,
                  }))}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                    reminderForm.leave_reminder_enabled ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      reminderForm.leave_reminder_enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {reminderForm.leave_reminder_enabled && (
                <>
                  {/* Email address */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      E-mailadres werkgever
                    </label>
                    <input
                      type="email"
                      value={reminderForm.leave_reminder_email}
                      onChange={(e) => setReminderForm(prev => ({
                        ...prev,
                        leave_reminder_email: e.target.value,
                      }))}
                      className="input"
                      placeholder="werkgever@bedrijf.nl"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Het e-mailadres waar de verlofherinneringen naartoe gestuurd worden
                    </p>
                  </div>

                  {/* Reminder intervals */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Herinneringsmomenten
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      Selecteer wanneer herinneringen verstuurd moeten worden vóór de startdatum van het verlof
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { weeks: 4, label: '4 weken (1 maand)' },
                        { weeks: 3, label: '3 weken' },
                        { weeks: 2, label: '2 weken' },
                        { weeks: 1, label: '1 week' },
                      ].map(({ weeks, label }) => (
                        <button
                          key={weeks}
                          type="button"
                          onClick={() => toggleWeek(weeks)}
                          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            reminderForm.leave_reminder_weeks_before.includes(weeks)
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <button
                  onClick={() => {
                    setEditingReminder(false)
                    setReminderForm({
                      leave_reminder_enabled: globalSettings?.leave_reminder_enabled ?? false,
                      leave_reminder_email: globalSettings?.leave_reminder_email ?? '',
                      leave_reminder_weeks_before: globalSettings?.leave_reminder_weeks_before?.length
                        ? globalSettings.leave_reminder_weeks_before
                        : DEFAULT_REMINDER_WEEKS,
                    })
                  }}
                  className="btn btn-secondary"
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveReminderSettings}
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  globalSettings?.leave_reminder_enabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {globalSettings?.leave_reminder_enabled ? 'Actief' : 'Uitgeschakeld'}
                </span>
              </div>
              {globalSettings?.leave_reminder_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs sm:text-sm text-gray-500">E-mailadres</p>
                    <p className="text-sm sm:text-base font-medium text-gray-900">
                      {globalSettings?.leave_reminder_email || 'Niet ingesteld'}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs sm:text-sm text-gray-500">Herinneringsmomenten</p>
                    <p className="text-sm sm:text-base font-medium text-gray-900">
                      {getWeeksLabel(globalSettings?.leave_reminder_weeks_before || [])}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
