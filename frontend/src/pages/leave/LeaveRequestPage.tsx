/**
 * Leave Request Page
 * Form for employees to submit leave requests
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
  UsersIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import {
  getMyLeaveBalance,
  checkConcurrentLeave,
  createLeaveRequest,
  getPublicHolidays,
  LeaveBalance,
  LeaveRequestCreate,
  LEAVE_TYPE_OPTIONS,
  ConcurrentLeaveCheck,
  ConcurrentLeaveEmployee,
  PublicHoliday,
} from '@/api/leave'

const HOURS_PER_DAY = 8

/** Leave types that should not deduct hours from balance */
const NO_DEDUCT_TYPES = ['ziekteverzuim', 'bijzonder_tandarts', 'bijzonder_huisarts', 'onbetaald']

/**
 * Calculate the number of work days between two dates (inclusive)
 * Excludes weekends (Saturday and Sunday) and public holidays
 */
function calculateWorkDays(startDate: string, endDate: string, holidayDates: Set<string>): number {
  if (!startDate || !endDate) return 0
  
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  if (start > end) return 0
  
  let workDays = 0
  const current = new Date(start)
  
  while (current <= end) {
    const dayOfWeek = current.getDay()
    const dateStr = current.toISOString().split('T')[0]
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
      workDays++
    }
    current.setDate(current.getDate() + 1)
  }
  
  return workDays
}

/**
 * Calculate end date based on start date and hours
 * Skips weekends and public holidays
 */
function calculateEndDate(startDate: string, hours: number, holidayDates: Set<string>): string {
  if (!startDate || hours <= 0) return startDate || ''
  
  const fullDays = Math.floor(hours / HOURS_PER_DAY)
  const remainingHours = hours % HOURS_PER_DAY
  
  const current = new Date(startDate)
  let workDaysCounted = 0
  const totalWorkDaysNeeded = remainingHours > 0 ? fullDays + 1 : Math.max(fullDays, 1)
  
  while (workDaysCounted < totalWorkDaysNeeded) {
    const dayOfWeek = current.getDay()
    const dateStr = current.toISOString().split('T')[0]
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
      workDaysCounted++
      if (workDaysCounted === totalWorkDaysNeeded) break
    }
    current.setDate(current.getDate() + 1)
  }
  
  return current.toISOString().split('T')[0]
}

/** Map leave_type code -> human label (falls back to code) */
function leaveTypeLabel(code: string): string {
  const opt = LEAVE_TYPE_OPTIONS.find(o => o.value === code)
  return opt ? opt.label : code
}

/** Format a date range as "5 mrt" or "5 mrt – 9 mrt" (NL locale). */
function formatPeriod(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const fmt = (d: Date) =>
    d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return start === end ? fmt(s) : `${fmt(s)} – ${fmt(e)}`
}

/** Initials from a display name, e.g. "Jan de Vries" -> "JV". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic pastel-ish color from a string for the avatar bubble. */
function colorFromName(name: string): string {
  const palette = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-purple-100 text-purple-700',
    'bg-amber-100 text-amber-700',
    'bg-pink-100 text-pink-700',
    'bg-cyan-100 text-cyan-700',
    'bg-indigo-100 text-indigo-700',
    'bg-rose-100 text-rose-700',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

interface ConcurrentLeavePanelProps {
  check: ConcurrentLeaveCheck
}

function ConcurrentLeavePanel({ check }: ConcurrentLeavePanelProps) {
  const { t } = useTranslation()
  const detail: ConcurrentLeaveEmployee[] = check.employees_on_leave_detail
    ?? check.employees_on_leave.map((name, idx) => ({
      user_id: `legacy-${idx}`,
      name,
      periods: [],
    }))

  // Nobody else on leave -> friendly confirmation card.
  if (detail.length === 0) {
    return (
      <div className="mb-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
        <CheckCircleIcon className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-emerald-800">
            {t('leave.overlap.noneTitle')}
          </p>
          <p className="text-sm text-emerald-700 mt-0.5">
            {t('leave.overlap.noneBody')}
          </p>
        </div>
      </div>
    )
  }

  const isWarning = check.warning
  const tone = isWarning
    ? {
        wrap: 'border-amber-300 bg-amber-50',
        iconWrap: 'bg-amber-100 text-amber-700',
        title: 'text-amber-900',
        body: 'text-amber-800',
        chip: 'bg-amber-200/60 text-amber-900',
      }
    : {
        wrap: 'border-blue-200 bg-blue-50',
        iconWrap: 'bg-blue-100 text-blue-700',
        title: 'text-blue-900',
        body: 'text-blue-800',
        chip: 'bg-blue-200/60 text-blue-900',
      }

  return (
    <div className={`mb-6 rounded-xl border ${tone.wrap} overflow-hidden`}>
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${tone.iconWrap}`}>
          {isWarning ? (
            <ExclamationTriangleIcon className="w-5 h-5" />
          ) : (
            <UsersIcon className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-semibold ${tone.title}`}>
              {isWarning
                ? t('leave.overlap.warningTitle')
                : t('leave.overlap.title')}
            </p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tone.chip}`}>
              {t('leave.overlap.countLabel', { count: check.concurrent_count })}
            </span>
          </div>
          <p className={`text-sm mt-1 ${tone.body}`}>
            {isWarning
              ? t('leave.overlap.warningBody', {
                  count: check.concurrent_count,
                  max: check.max_concurrent,
                })
              : t('leave.overlap.infoBody')}
          </p>
        </div>
      </div>

      {/* Employee list */}
      <ul className="divide-y divide-white/60 bg-white/40">
        {detail.map((emp) => (
          <li key={emp.user_id} className="px-4 py-3 flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${colorFromName(emp.name)}`}
            >
              {initials(emp.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{emp.name}</p>
              {emp.periods.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {emp.periods.map((p, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs"
                    >
                      <CalendarDaysIcon className="w-3.5 h-3.5" />
                      {formatPeriod(p.start_date, p.end_date)}
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600">{leaveTypeLabel(p.leave_type)}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function LeaveRequestPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const [concurrentCheck, setConcurrentCheck] = useState<ConcurrentLeaveCheck | null>(null)
  
  const [formData, setFormData] = useState<LeaveRequestCreate>({
    leave_type: 'vakantie',
    start_date: '',
    end_date: '',
    hours_requested: 8,
    reason: '',
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  
  // Track whether user is manually editing hours vs auto-calculated
  const [isManualHours, setIsManualHours] = useState(false)
  
  // Public holidays
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const data = await getMyLeaveBalance()
        setBalance(data)
      } catch (err) {
        setError(t('leave.balanceLoadError'))
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchBalance()
    
    // Load holidays for current and next year
    const currentYear = new Date().getFullYear()
    Promise.all([
      getPublicHolidays(currentYear),
      getPublicHolidays(currentYear + 1),
    ]).then(([thisYear, nextYear]) => {
      const all = [...thisYear, ...nextYear]
      setHolidays(all)
      setHolidayDates(new Set(all.map(h => h.date)))
    }).catch(console.error)
  }, [])

  // Auto-calculate hours when dates change (if not manually set)
  useEffect(() => {
    if (formData.start_date && formData.end_date && !isManualHours) {
      if (NO_DEDUCT_TYPES.includes(formData.leave_type)) {
        if (formData.hours_requested !== 0) {
          setFormData(prev => ({ ...prev, hours_requested: 0 }))
        }
      } else {
        const workDays = calculateWorkDays(formData.start_date, formData.end_date, holidayDates)
        const calculatedHours = workDays * HOURS_PER_DAY
        if (calculatedHours !== formData.hours_requested) {
          setFormData(prev => ({ ...prev, hours_requested: calculatedHours }))
        }
      }
    }
  }, [formData.start_date, formData.end_date, formData.leave_type, isManualHours, holidayDates])

  // Auto-calculate end date when hours change manually
  useEffect(() => {
    if (formData.start_date && isManualHours && formData.hours_requested > 0) {
      const newEndDate = calculateEndDate(formData.start_date, formData.hours_requested, holidayDates)
      if (newEndDate !== formData.end_date) {
        setFormData(prev => ({ ...prev, end_date: newEndDate }))
      }
    }
  }, [formData.hours_requested, formData.start_date, isManualHours, holidayDates])

  // Check concurrent leave when dates change
  useEffect(() => {
    if (formData.start_date && formData.end_date) {
      checkConcurrentLeave(formData.start_date, formData.end_date)
        .then(setConcurrentCheck)
        .catch(console.error)
    }
  }, [formData.start_date, formData.end_date])

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setIsManualHours(false) // Reset manual hours flag when date changes
    
    if (name === 'start_date' && value) {
      // If setting start date and no end date, default end date to start date
      setFormData(prev => ({
        ...prev,
        start_date: value,
        end_date: prev.end_date || value,
      }))
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }
    setFormErrors(prev => ({ ...prev, [name]: '' }))
  }

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value) || 0
    setIsManualHours(true) // User is manually setting hours
    setFormData(prev => ({ ...prev, hours_requested: value }))
    setFormErrors(prev => ({ ...prev, hours_requested: '' }))
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    if (name === 'leave_type' && NO_DEDUCT_TYPES.includes(value)) {
      setFormData((prev) => ({
        ...prev,
        leave_type: value as LeaveRequestCreate['leave_type'],
        hours_requested: 0,
      }))
      setIsManualHours(false)
    } else if (name === 'leave_type' && !NO_DEDUCT_TYPES.includes(value)) {
      // Switching back to a deductible type: recalculate hours
      const workDays = formData.start_date && formData.end_date
        ? calculateWorkDays(formData.start_date, formData.end_date, holidayDates)
        : 0
      setFormData((prev) => ({
        ...prev,
        leave_type: value as LeaveRequestCreate['leave_type'],
        hours_requested: workDays * HOURS_PER_DAY || prev.hours_requested,
      }))
      setIsManualHours(false)
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }))
    }
    setFormErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    
    if (!formData.start_date) errors.start_date = t('leave.startDateRequired')
    if (!formData.end_date) errors.end_date = t('leave.endDateRequired')
    if (formData.start_date && formData.end_date && formData.start_date > formData.end_date) {
      errors.end_date = t('leave.endDateAfterStart')
    }
    // Only validate hours > 0 for deductible leave types
    if (!NO_DEDUCT_TYPES.includes(formData.leave_type)) {
      if (!formData.hours_requested || formData.hours_requested <= 0) {
        errors.hours_requested = t('leave.hoursGreaterThanZero')
      }
    }
    
    // Check balance
    if (balance && formData.leave_type === 'vakantie') {
      if (formData.hours_requested > Number(balance.vacation_hours)) {
        errors.hours_requested = t('leave.insufficientVacationHours', { available: Number(balance.vacation_hours).toFixed(1) })
      }
    }
    
    if (balance && formData.leave_type === 'overuren') {
      if (formData.hours_requested > Number(balance.available_overtime_for_leave)) {
        errors.hours_requested = t('leave.insufficientOvertimeHours', { available: Number(balance.available_overtime_for_leave).toFixed(1) })
      }
    }
    
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    
    setIsSubmitting(true)
    setError(null)
    
    try {
      await createLeaveRequest(formData)
      setSuccess(true)
      setTimeout(() => navigate('/leave'), 2000)
    } catch (err: any) {
      const message = err.response?.data?.hours_requested?.[0] 
        || err.response?.data?.error 
        || t('leave.submitError')
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto mt-12 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CalendarDaysIcon className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('leave.requestSubmitted')}
        </h2>
        <p className="text-gray-500">
          {t('leave.requestSubmittedDescription')}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/leave')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          {t('common.back')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t('leave.requestLeave')}</h1>
      </div>

      {/* Balance Summary */}
      {balance && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="card p-4">
            <p className="text-sm text-gray-500">{t('leave.vacationHoursAvailable')}</p>
            <p className="text-2xl font-bold text-primary-600">
              {Number(balance.vacation_hours).toFixed(1)}u
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">{t('leave.overtimeAvailable')}</p>
            <p className="text-2xl font-bold text-green-600">
              {Number(balance.available_overtime_for_leave).toFixed(1)}u
            </p>
          </div>
        </div>
      )}

      {/* Concurrent Leave Overview */}
      {formData.start_date && formData.end_date && concurrentCheck && (
        <ConcurrentLeavePanel check={concurrentCheck} />
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Leave Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('leave.leaveType')} *
          </label>
          <select
            name="leave_type"
            value={formData.leave_type}
            onChange={handleChange}
            className="input w-full"
          >
            {LEAVE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {formData.leave_type === 'bijzonder_tandarts' || formData.leave_type === 'bijzonder_huisarts' ? (
            <p className="text-xs text-gray-500 mt-1">
              {t('leave.specialLeaveNote')}
            </p>
          ) : formData.leave_type === 'onbetaald' ? (
            <p className="text-xs text-gray-500 mt-1">
              {t('leave.unpaidLeaveNote')}
            </p>
          ) : null}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('leave.startDate')} *
            </label>
            <input
              type="date"
              name="start_date"
              value={formData.start_date}
              onChange={handleDateChange}
              className={`input w-full ${formErrors.start_date ? 'border-red-500' : ''}`}
            />
            {formErrors.start_date && (
              <p className="text-red-500 text-xs mt-1">{formErrors.start_date}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('leave.endDate')} *
            </label>
            <input
              type="date"
              name="end_date"
              value={formData.end_date}
              onChange={handleDateChange}
              className={`input w-full ${formErrors.end_date ? 'border-red-500' : ''}`}
            />
            {formErrors.end_date && (
              <p className="text-red-500 text-xs mt-1">{formErrors.end_date}</p>
            )}
          </div>
        </div>

        {/* Hours */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('leave.hoursRequested')} *
          </label>
          <input
            type="number"
            name="hours_requested"
            value={formData.hours_requested}
            onChange={handleHoursChange}
            min="0"
            step="0.5"
            disabled={NO_DEDUCT_TYPES.includes(formData.leave_type)}
            className={`input w-full ${formErrors.hours_requested ? 'border-red-500' : ''}`}
          />
          {formErrors.hours_requested && (
            <p className="text-red-500 text-xs mt-1">{formErrors.hours_requested}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            {formData.hours_requested > 0 && formData.start_date && (
              <>
                {Math.floor(formData.hours_requested / HOURS_PER_DAY)} {t('leave.days')}
                {formData.hours_requested % HOURS_PER_DAY > 0 && ` ${t('common.and')} ${formData.hours_requested % HOURS_PER_DAY} ${t('timeEntries.hour')}`}
                {' • '}
              </>
            )}
            {t('leave.hoursCalculationNote')}
          </p>
        </div>

        {/* Holiday info */}
        {formData.start_date && formData.end_date && (() => {
          const holidaysInRange = holidays.filter(h => h.date >= formData.start_date && h.date <= formData.end_date)
          if (holidaysInRange.length === 0) return null
          return (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <p className="font-medium text-blue-800 mb-1">
                Feestdagen in deze periode ({holidaysInRange.length}):
              </p>
              <ul className="text-blue-700 space-y-0.5">
                {holidaysInRange.map(h => (
                  <li key={h.id}>
                    • {h.name} — {new Date(h.date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </li>
                ))}
              </ul>
              <p className="text-blue-600 mt-1 text-xs">
                Deze dagen worden niet afgetrokken van je verlofuren.
              </p>
            </div>
          )
        })()}

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('leave.reasonOptional')}
          </label>
          <textarea
            name="reason"
            value={formData.reason}
            onChange={handleChange}
            rows={3}
            className="input w-full"
            placeholder={t('leave.reasonPlaceholder')}
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            type="button"
            onClick={() => navigate('/leave')}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary"
          >
            {isSubmitting ? t('common.saving') : t('leave.submitRequest')}
          </button>
        </div>
      </form>
    </div>
  )
}
