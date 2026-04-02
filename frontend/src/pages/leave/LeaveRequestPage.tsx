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
  PublicHoliday,
} from '@/api/leave'

const HOURS_PER_DAY = 8

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
      const workDays = calculateWorkDays(formData.start_date, formData.end_date, holidayDates)
      const calculatedHours = workDays * HOURS_PER_DAY
      if (calculatedHours !== formData.hours_requested) {
        setFormData(prev => ({ ...prev, hours_requested: calculatedHours }))
      }
    }
  }, [formData.start_date, formData.end_date, isManualHours, holidayDates])

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
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
    setFormErrors((prev) => ({ ...prev, [name]: '' }))
  }

  const validate = () => {
    const errors: Record<string, string> = {}
    
    if (!formData.start_date) errors.start_date = t('leave.startDateRequired')
    if (!formData.end_date) errors.end_date = t('leave.endDateRequired')
    if (formData.start_date && formData.end_date && formData.start_date > formData.end_date) {
      errors.end_date = t('leave.endDateAfterStart')
    }
    if (!formData.hours_requested || formData.hours_requested <= 0) {
      errors.hours_requested = t('leave.hoursGreaterThanZero')
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

      {/* Concurrent Leave Warning */}
      {concurrentCheck?.warning && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">
              {t('leave.concurrentWarning', { count: concurrentCheck.concurrent_count })}
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              {concurrentCheck.employees_on_leave.join(', ')}
            </p>
            <p className="text-sm text-yellow-600 mt-2">
              {t('leave.concurrentWarningNote')}
            </p>
          </div>
        </div>
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
            min="0.5"
            step="0.5"
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
