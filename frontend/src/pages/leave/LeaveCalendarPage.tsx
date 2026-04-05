/**
 * Leave Calendar Page
 * Gantt-style timeline view showing who is on leave when
 * - Employees listed vertically on the left
 * - Horizontal timeline with colored bars for leave periods
 */
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import {
  getLeaveCalendar,
  getPublicHolidays,
  CalendarLeaveEntry,
} from '@/api/leave'

// Color palette for different leave types
const LEAVE_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  vakantie: { bg: 'bg-blue-400', border: 'border-blue-500', text: 'text-blue-900' },
  overuren: { bg: 'bg-green-400', border: 'border-green-500', text: 'text-green-900' },
  bijzonder_tandarts: { bg: 'bg-purple-400', border: 'border-purple-500', text: 'text-purple-900' },
  bijzonder_huisarts: { bg: 'bg-orange-400', border: 'border-orange-500', text: 'text-orange-900' },
}

function getLeaveTypeColor(type: string) {
  return LEAVE_TYPE_COLORS[type] || { bg: 'bg-gray-400', border: 'border-gray-500', text: 'text-gray-900' }
}

/** Format a local Date as YYYY-MM-DD without UTC conversion */
function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Parse a YYYY-MM-DD string as a local-time Date (avoids UTC midnight shift) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function LeaveCalendarPage() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<CalendarLeaveEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map())

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Get first and last day of month
  const firstDayOfMonth = useMemo(() => new Date(year, month, 1), [year, month])
  const lastDayOfMonth = useMemo(() => new Date(year, month + 1, 0), [year, month])
  const daysInMonth = lastDayOfMonth.getDate()

  // Generate array of dates for the month
  const monthDates = useMemo(() => {
    const dates: Date[] = []
    for (let i = 1; i <= daysInMonth; i++) {
      dates.push(new Date(year, month, i))
    }
    return dates
  }, [year, month, daysInMonth])

  useEffect(() => {
    const fetchCalendar = async () => {
      setIsLoading(true)
      const startDate = formatLocalDate(firstDayOfMonth)
      const endDate = formatLocalDate(lastDayOfMonth)
      
      try {
        const data = await getLeaveCalendar(startDate, endDate)
        setEntries(data)
        
        // Load holidays for this month's year
        const holidays = await getPublicHolidays(year)
        const map = new Map<string, string>()
        holidays.forEach(h => map.set(h.date, h.name))
        setHolidayMap(map)
      } catch (err) {
        console.error('Error fetching calendar:', err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchCalendar()
  }, [firstDayOfMonth, lastDayOfMonth])

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const goToCurrentMonth = () => {
    setCurrentDate(new Date())
  }

  // Group entries by user
  const userEntries = useMemo(() => {
    const grouped = new Map<string, { naam: string; entries: CalendarLeaveEntry[] }>()
    
    entries.forEach(entry => {
      if (!grouped.has(entry.user_id)) {
        grouped.set(entry.user_id, { naam: entry.user_naam, entries: [] })
      }
      grouped.get(entry.user_id)!.entries.push(entry)
    })
    
    // Sort by name
    return Array.from(grouped.entries()).sort((a, b) => 
      a[1].naam.localeCompare(b[1].naam)
    )
  }, [entries])

  const monthNames = [
    t('common.months.january'), t('common.months.february'), t('common.months.march'),
    t('common.months.april'), t('common.months.may'), t('common.months.june'),
    t('common.months.july'), t('common.months.august'), t('common.months.september'),
    t('common.months.october'), t('common.months.november'), t('common.months.december')
  ]

  const today = new Date()
  const todayStr = formatLocalDate(today)

  // Calculate bar position and width for a leave entry
  const getBarStyle = (entry: CalendarLeaveEntry) => {
    const startDate = parseLocalDate(entry.start_date)
    const endDate = parseLocalDate(entry.end_date)
    
    // Skip entries that don't actually overlap with the current month
    if (endDate < firstDayOfMonth || startDate > lastDayOfMonth) {
      return null
    }
    
    // Clamp to current month
    const effectiveStart = startDate < firstDayOfMonth ? firstDayOfMonth : startDate
    const effectiveEnd = endDate > lastDayOfMonth ? lastDayOfMonth : endDate
    
    const startDay = effectiveStart.getDate()
    const endDay = effectiveEnd.getDate()
    
    // Calculate left position (0-100%)
    const left = ((startDay - 1) / daysInMonth) * 100
    // Calculate width (span of days)
    const width = ((endDay - startDay + 1) / daysInMonth) * 100
    
    return { left: `${left}%`, width: `${width}%` }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <Link
            to="/leave"
            className="flex items-center text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            {t('common.back')}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{t('leave.leaveCalendar')}</h1>
          <p className="text-gray-500">{t('leave.calendarDescription')}</p>
        </div>
      </div>

      {/* Calendar Navigation */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={goToPreviousMonth}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">
              {monthNames[month]} {year}
            </h2>
            <button
              onClick={goToCurrentMonth}
              className="text-sm text-primary-600 hover:text-primary-700 mt-1"
            >
              {t('common.month')}
            </button>
          </div>
          <button
            onClick={goToNextMonth}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-4 pb-4 border-b">
          {Object.entries(LEAVE_TYPE_COLORS).map(([type, colors]) => (
            <div key={type} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded ${colors.bg}`} />
              <span className="text-sm text-gray-600 capitalize">
                {type === 'vakantie' ? t('leave.vacation') : 
                 type === 'overuren' ? t('leave.overtime') :
                 type === 'bijzonder_tandarts' ? t('leave.dentist') : t('leave.doctor')}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-100 border border-red-300 flex items-center justify-center text-[8px] text-red-500">★</div>
            <span className="text-sm text-gray-600">Feestdag</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : userEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <CalendarDaysIcon className="w-12 h-12 text-gray-300 mb-4" />
            <p>{t('leave.noLeaveThisMonth')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Timeline Grid */}
            <div className="min-w-[800px]">
              {/* Day Headers */}
              <div className="flex border-b border-gray-200">
                {/* Employee name column */}
                <div className="w-40 flex-shrink-0 px-3 py-2 bg-gray-50 font-medium text-sm text-gray-700 sticky left-0 z-10">
                  {t('leave.employee')}
                </div>
                {/* Day columns */}
                <div className="flex-1 flex">
                  {monthDates.map((date, idx) => {
                    const dateStr = formatLocalDate(date)
                    const isToday = dateStr === todayStr
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6
                    const holidayName = holidayMap.get(dateStr)
                    const isHoliday = !!holidayName
                    const dayNames = [t('planning.sun'), t('planning.mon'), t('planning.tue'), t('planning.wed'), t('planning.thu'), t('planning.fri'), t('planning.sat')]
                    
                    return (
                      <div
                        key={idx}
                        className={`flex-1 min-w-[28px] px-0.5 py-1 text-center text-xs border-l border-gray-100 ${
                          isHoliday ? 'bg-red-50' : isWeekend ? 'bg-gray-50' : ''
                        } ${isToday ? 'bg-primary-50' : ''}`}
                        title={holidayName || ''}
                      >
                        <div className={`font-medium ${isHoliday ? 'text-red-500' : isToday ? 'text-primary-600' : 'text-gray-400'}`}>
                          {dayNames[date.getDay()]}
                        </div>
                        <div className={`${isHoliday ? 'text-red-600 font-bold' : isToday ? 'text-primary-700 font-bold' : 'text-gray-600'}`}>
                          {date.getDate()}
                        </div>
                        {isHoliday && (
                          <div className="text-[9px] text-red-500 leading-tight truncate" title={holidayName}>
                            ★
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Employee Rows */}
              {userEntries.map(([userId, { naam, entries: userLeaveEntries }]) => (
                <div key={userId} className="flex border-b border-gray-100 hover:bg-gray-50">
                  {/* Employee name */}
                  <div className="w-40 flex-shrink-0 px-3 py-3 font-medium text-sm text-gray-900 truncate sticky left-0 bg-white z-10">
                    {naam}
                  </div>
                  {/* Timeline bar area */}
                  <div className="flex-1 relative h-12">
                    {/* Background grid lines */}
                    <div className="absolute inset-0 flex">
                      {monthDates.map((date, idx) => {
                        const isWeekend = date.getDay() === 0 || date.getDay() === 6
                        const dateStr = formatLocalDate(date)
                        const isToday = dateStr === todayStr
                        const isHoliday = holidayMap.has(dateStr)
                        return (
                          <div
                            key={idx}
                            className={`flex-1 min-w-[28px] border-l border-gray-100 ${
                              isHoliday ? 'bg-red-50/50' : isWeekend ? 'bg-gray-50/50' : ''
                            } ${isToday ? 'bg-primary-50/50' : ''}`}
                          />
                        )
                      })}
                    </div>
                    
                    {/* Leave bars */}
                    <div className="absolute inset-0 py-2 px-0.5">
                      {userLeaveEntries.map((entry) => {
                        const style = getBarStyle(entry)
                        if (!style) return null
                        const colors = getLeaveTypeColor(entry.leave_type)
                        
                        return (
                          <div
                            key={entry.id}
                            className={`absolute top-2 h-8 ${colors.bg} ${colors.border} border rounded-md shadow-sm cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center overflow-hidden`}
                            style={{ left: style.left, width: style.width, minWidth: '24px' }}
                            title={`${entry.user_naam}: ${entry.leave_type_display}\n${parseLocalDate(entry.start_date).toLocaleDateString('nl-NL')} - ${parseLocalDate(entry.end_date).toLocaleDateString('nl-NL')}`}
                          >
                            <span className={`text-xs font-medium ${colors.text} truncate px-1`}>
                              {entry.leave_type_display}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary List */}
      {entries.length > 0 && (
        <div className="card">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('leave.leaveThisMonth')} ({entries.length})
            </h2>
          </div>
          <div className="divide-y">
            {entries.map((entry) => {
              const colors = getLeaveTypeColor(entry.leave_type)
              return (
                <div key={entry.id} className="px-6 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${colors.bg}`} />
                    <div>
                      <p className="font-medium text-gray-900">{entry.user_naam}</p>
                      <p className="text-sm text-gray-500">{entry.leave_type_display}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-900">
                      {parseLocalDate(entry.start_date).toLocaleDateString('nl-NL')}
                      {entry.start_date !== entry.end_date && (
                        <> - {parseLocalDate(entry.end_date).toLocaleDateString('nl-NL')}</>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
