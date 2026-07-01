/**
 * Leave Overview Page
 * Main page for employees to view their leave balance and requests
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  CalendarDaysIcon,
  ClockIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import {
  getMyLeaveBalance,
  getMyLeaveRequests,
  LeaveBalance,
  LeaveRequest,
} from '@/api/leave'

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  switch (status) {
    case 'pending':
      return (
        <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
          {t('leave.pending')}
        </span>
      )
    case 'approved':
      return (
        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
          {t('leave.approved')}
        </span>
      )
    case 'rejected':
      return (
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
          {t('leave.rejected')}
        </span>
      )
    case 'cancelled':
      return (
        <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">
          {t('leave.cancelled')}
        </span>
      )
    default:
      return null
  }
}

export default function LeaveOverviewPage() {
  const { t } = useTranslation()
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [balanceData, requestsData] = await Promise.all([
          getMyLeaveBalance(),
          getMyLeaveRequests(),
        ])
        setBalance(balanceData)
        setRequests(requestsData)
      } catch (err) {
        setError(t('leave.loadError'))
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-lg">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="page-title">{t('leave.myLeave')}</h1>
          <p className="text-gray-500">{t('leave.manageLeaveDescription')}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/leave/calendar"
            className="btn-secondary flex items-center"
          >
            <CalendarDaysIcon className="w-5 h-5 mr-2" />
            {t('leave.leaveCalendar')}
          </Link>
          <Link
            to="/leave/request"
            className="btn-primary flex items-center"
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            {t('leave.requestLeave')}
          </Link>
        </div>
      </div>

      {/* Balance Cards */}
      {balance && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Vacation Hours */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t('leave.vacationHours')}</p>
                <p className="text-3xl font-bold text-primary-600">
                  {Number(balance.vacation_hours).toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">{t('leave.hoursAvailable')}</p>
              </div>
              <div className="p-3 bg-primary-100 rounded-full">
                <CalendarDaysIcon className="w-8 h-8 text-primary-600" />
              </div>
            </div>
          </div>

          {/* Overtime Hours */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t('leave.overtimeHours')}</p>
                <p className="text-3xl font-bold text-green-600">
                  {Number(balance.overtime_hours).toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">{t('leave.totalAccrued')}</p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <ClockIcon className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </div>

          {/* Available for Leave */}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t('leave.overtimeAvailable')}</p>
                <p className="text-3xl font-bold text-blue-600">
                  {Number(balance.available_overtime_for_leave).toFixed(1)}
                </p>
                <p className="text-xs text-gray-400">{t('leave.hoursAsLeave')}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <CheckCircleIcon className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Requests */}
      <div className="card">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">{t('leave.myRequests')}</h2>
        </div>
        
        {requests.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <CalendarDaysIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>{t('leave.noRequests')}</p>
            <Link
              to="/leave/request"
              className="mt-2 text-primary-600 hover:text-primary-700 inline-block"
            >
              {t('leave.requestFirstLeave')}
            </Link>
          </div>
        ) : (
          <div className="divide-y">
            {requests.map((request) => (
              <div key={request.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {request.leave_type_display}
                      </span>
                      <StatusBadge status={request.status} t={t} />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(request.start_date).toLocaleDateString('nl-NL')} 
                      {request.start_date !== request.end_date && (
                        <> t/m {new Date(request.end_date).toLocaleDateString('nl-NL')}</>
                      )}
                    </p>
                    {request.reason && (
                      <p className="text-sm text-gray-400 mt-1">{request.reason}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {parseFloat(request.hours_requested).toFixed(1)} {t('timeEntries.hour')}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(request.created_at).toLocaleDateString('nl-NL')}
                    </p>
                  </div>
                </div>
                {request.status === 'rejected' && request.admin_comment && (
                  <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
                    <strong>{t('leave.rejectionReason')}:</strong> {request.admin_comment}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
