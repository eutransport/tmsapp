import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  WrenchScrewdriverIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CurrencyEuroIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { MaintenanceStats, APKCountdown, MaintenanceAlert, MaintenanceTaskList } from '@/types'
import {
  getMaintenanceStats,
  getAPKCountdown,
  getActiveAlerts,
  getOverdueTasks,
  getUpcomingTasks,
} from '@/api/maintenance'
import LicensePlate from '@/components/common/LicensePlate'

export default function MaintenanceOverviewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stats, setStats] = useState<MaintenanceStats | null>(null)
  const [apkCountdowns, setApkCountdowns] = useState<APKCountdown[]>([])
  const [alerts, setAlerts] = useState<MaintenanceAlert[]>([])
  const [overdueTasks, setOverdueTasks] = useState<MaintenanceTaskList[]>([])
  const [upcomingTasks, setUpcomingTasks] = useState<MaintenanceTaskList[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [statsData, apkData, alertsData, overdueData, upcomingData] = await Promise.all([
        getMaintenanceStats(),
        getAPKCountdown(),
        getActiveAlerts(),
        getOverdueTasks(),
        getUpcomingTasks(14),
      ])
      setStats(statsData)
      setApkCountdowns(apkData)
      setAlerts(alertsData)
      setOverdueTasks(overdueData)
      setUpcomingTasks(upcomingData)
    } catch (err) {
      console.error('Failed to fetch maintenance data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(num || 0)
  }

  const getCountdownColor = (status: string) => {
    switch (status) {
      case 'expired': return 'bg-red-100 text-red-800 border-red-200'
      case 'urgent': return 'bg-red-50 text-red-700 border-red-200'
      case 'critical': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      default: return 'bg-green-100 text-green-800 border-green-200'
    }
  }

  const getAlertIcon = (severity: string) => {
    switch (severity) {
      case 'urgent':
      case 'critical': return <XCircleIcon className="w-5 h-5 text-red-500" />
      case 'warning': return <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500" />
      default: return <CheckCircleIcon className="w-5 h-5 text-blue-500" />
    }
  }

  const getPriorityBadge = (priority: string) => {
    const classes: Record<string, string> = {
      urgent: 'bg-red-100 text-red-800',
      high: 'bg-orange-100 text-orange-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-gray-100 text-gray-800',
    }
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${classes[priority] || classes.low}`}>
        {t(`maintenance.priority.${priority}`)}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <WrenchScrewdriverIcon className="w-7 h-7 text-primary-600" />
            {t('maintenance.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('maintenance.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate('/maintenance/settings')}
            className="btn-secondary flex items-center gap-2"
          >
            <Cog6ToothIcon className="w-5 h-5" />
            {t('maintenance.settings.title')}
          </button>
          <button
            onClick={() => navigate('/maintenance/apk')}
            className="btn-secondary flex items-center gap-2"
          >
            <ShieldCheckIcon className="w-5 h-5" />
            {t('maintenance.apk.title')}
          </button>
          <button
            onClick={() => navigate('/maintenance/tasks')}
            className="btn-primary flex items-center gap-2"
          >
            <WrenchScrewdriverIcon className="w-5 h-5" />
            {t('maintenance.tasks.newTask')}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<WrenchScrewdriverIcon className="w-6 h-6 text-primary-600" />}
          label={t('maintenance.stats.scheduledTasks')}
          value={stats?.scheduled_tasks ?? 0}
          color="primary"
        />
        <StatCard
          icon={<ExclamationTriangleIcon className="w-6 h-6 text-red-600" />}
          label={t('maintenance.stats.overdueTasks')}
          value={stats?.overdue_tasks ?? 0}
          color="red"
          onClick={() => navigate('/maintenance/tasks?status=overdue')}
        />
        <StatCard
          icon={<CurrencyEuroIcon className="w-6 h-6 text-green-600" />}
          label={t('maintenance.stats.costMonth')}
          value={formatCurrency(stats?.total_cost_month ?? '0')}
          color="green"
        />
        <StatCard
          icon={<ArrowTrendingUpIcon className="w-6 h-6 text-blue-600" />}
          label={t('maintenance.stats.costYTD')}
          value={formatCurrency(stats?.total_cost_ytd ?? '0')}
          color="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* APK Countdown */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ShieldCheckIcon className="w-5 h-5 text-primary-600" />
              {t('maintenance.apk.countdown')}
            </h2>
            <button
              onClick={() => navigate('/maintenance/apk')}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              {t('common.viewAll')}
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {apkCountdowns.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {t('maintenance.apk.noRecords')}
              </div>
            ) : (
              apkCountdowns.slice(0, 8).map((apk) => (
                <div key={apk.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 hover:bg-gray-50 gap-2">
                  <div className="flex items-center gap-3">
                    <LicensePlate kenteken={apk.vehicle_kenteken} size="sm" />
                    <div className="text-xs text-gray-500">
                      {apk.vehicle_type || '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-0 sm:ml-0">
                    <div className="text-xs text-gray-500">
                      {new Date(apk.expiry_date).toLocaleDateString('nl-NL')}
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${getCountdownColor(apk.countdown_status)}`}>
                      {apk.days_until_expiry > 0
                        ? `${apk.days_until_expiry} ${t('maintenance.apk.daysLeft')}`
                        : t('maintenance.apk.expired')
                      }
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Active Alerts */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500" />
              {t('maintenance.alerts.title')}
              {alerts.length > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {alerts.length}
                </span>
              )}
            </h2>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-gray-500 flex flex-col items-center gap-2">
                <CheckCircleIcon className="w-8 h-8 text-green-400" />
                {t('maintenance.alerts.noAlerts')}
              </div>
            ) : (
              alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 p-3 hover:bg-gray-50">
                  {getAlertIcon(alert.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{alert.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                      <LicensePlate kenteken={alert.vehicle_kenteken} size="sm" />
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    {new Date(alert.created_at).toLocaleDateString('nl-NL')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Overdue Tasks */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-red-500" />
              {t('maintenance.tasks.overdue')}
              {overdueTasks.length > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {overdueTasks.length}
                </span>
              )}
            </h2>
            <button
              onClick={() => navigate('/maintenance/tasks?status=overdue')}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              {t('common.viewAll')}
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {overdueTasks.length === 0 ? (
              <div className="p-6 text-center text-gray-500 flex flex-col items-center gap-2">
                <CheckCircleIcon className="w-8 h-8 text-green-400" />
                {t('maintenance.tasks.noOverdue')}
              </div>
            ) : (
              overdueTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/maintenance/tasks?task=${task.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2 h-8 rounded-full"
                      style={{ backgroundColor: task.category_color }}
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{task.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <LicensePlate kenteken={task.vehicle_kenteken} size="sm" />
                        <span className="text-xs text-gray-500">{task.category_name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {getPriorityBadge(task.priority)}
                    {task.scheduled_date && (
                      <div className="text-xs text-red-500 mt-1">
                        {new Date(task.scheduled_date).toLocaleDateString('nl-NL')}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Upcoming Tasks */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-blue-500" />
              {t('maintenance.tasks.upcoming')}
            </h2>
            <button
              onClick={() => navigate('/maintenance/tasks')}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              {t('common.viewAll')}
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {upcomingTasks.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {t('maintenance.tasks.noUpcoming')}
              </div>
            ) : (
              upcomingTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/maintenance/tasks?task=${task.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2 h-8 rounded-full"
                      style={{ backgroundColor: task.category_color }}
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{task.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <LicensePlate kenteken={task.vehicle_kenteken} size="sm" />
                        <span className="text-xs text-gray-500">{task.maintenance_type_name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {getPriorityBadge(task.priority)}
                    {task.scheduled_date && (
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(task.scheduled_date).toLocaleDateString('nl-NL')}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Most expensive vehicle */}
      {stats?.most_expensive_vehicle && (
        <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl border border-primary-100 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-600">{t('maintenance.stats.mostExpensive')}</h3>
              <div className="flex items-center gap-3 mt-2">
                <LicensePlate kenteken={stats.most_expensive_vehicle.vehicle_kenteken} size="md" />
                <span className="text-2xl font-bold text-gray-900">
                  {formatCurrency(stats.most_expensive_vehicle.total_cost)}
                </span>
              </div>
            </div>
            <CurrencyEuroIcon className="w-12 h-12 text-primary-200" />
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
  onClick?: () => void
}) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border p-4 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-${color}-50`}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-sm text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  )
}
