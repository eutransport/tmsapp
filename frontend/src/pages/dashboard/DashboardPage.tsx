import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { settingsApi, DashboardStats, OnlineUser, RecentLogin, ActivityItem } from '@/api/settings'
import { getLeaveCalendar, CalendarLeaveEntry } from '@/api/leave'
import {
  UsersIcon,
  BuildingOfficeIcon,
  TruckIcon,
  ClockIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  ArrowRightIcon,
  SignalIcon,
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(value)
}

// Chauffeur-specific dashboard
function ChauffeurDashboard({ user }: { user: any }) {
  const { t } = useTranslation()
  
  return (
    <div>
      {/* Welcome message */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('dashboard.welcomeDriver', { name: user?.voornaam })}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('dashboard.manageHours')}
        </p>
      </div>
      
      {/* Quick actions for chauffeur */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Link
          to="/time-entries"
          className="card p-6 hover:shadow-md transition-shadow text-center"
        >
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-primary-100 mb-4">
              <ClockIcon className="h-8 w-8 text-primary-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('nav.timeEntries')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('dashboard.registerHours')}</p>
          </div>
        </Link>
        
        <Link
          to="/my-hours"
          className="card p-6 hover:shadow-md transition-shadow text-center"
        >
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-green-100 mb-4">
              <ClipboardDocumentListIcon className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('nav.myHours')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('dashboard.viewSubmittedHours')}</p>
          </div>
        </Link>
        
        <Link
          to="/planning"
          className="card p-6 hover:shadow-md transition-shadow text-center"
        >
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-purple-100 mb-4">
              <CalendarDaysIcon className="h-8 w-8 text-purple-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('nav.planning')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('dashboard.viewPlanning')}</p>
          </div>
        </Link>

        <Link
          to="/leave"
          className="card p-6 hover:shadow-md transition-shadow text-center"
        >
          <div className="flex flex-col items-center">
            <div className="p-4 rounded-full bg-orange-100 mb-4">
              <CalendarDaysIcon className="h-8 w-8 text-orange-600" />
            </div>
            <h3 className="font-semibold text-gray-900">{t('nav.leave')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('dashboard.requestLeave')}</p>
          </div>
        </Link>
      </div>
      
      {/* Info card */}
      <div className="card p-6 bg-blue-50 border-blue-200">
        <h3 className="font-medium text-blue-900">💡 {t('dashboard.tip')}</h3>
        <p className="text-sm text-blue-700 mt-1">
          {t('dashboard.tipText')}
        </p>
      </div>
    </div>
  )
}

// Admin/Gebruiker dashboard
function AdminDashboard({ user }: { user: any }) {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  // Online users state + polling
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [onlineLoading, setOnlineLoading] = useState(true)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Recent logins state + pagination
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>([])
  const [loginsPage, setLoginsPage] = useState(1)
  const [loginsPagination, setLoginsPagination] = useState({ total: 0, total_pages: 1, has_next: false, has_previous: false })
  const [loginsLoading, setLoginsLoading] = useState(true)

  // Leave this month state
  const [leaveEntries, setLeaveEntries] = useState<CalendarLeaveEntry[]>([])
  const [leaveLoading, setLeaveLoading] = useState(true)

  // Tabs: online | logins | activity
  const [activeTab, setActiveTab] = useState<'online' | 'logins' | 'activity'>('online')

  useEffect(() => {
    loadStats()
    loadActivities()
    loadOnlineUsers()
    loadRecentLogins(1)
    loadLeaveEntries()

    // Poll online users every 2 minutes
    pollingRef.current = setInterval(() => {
      loadOnlineUsers()
    }, 120_000)

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  const loadStats = async () => {
    try {
      const data = await settingsApi.getDashboardStats()
      setStats(data)
    } catch (err) {
      console.error('Failed to load dashboard stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadActivities = async () => {
    try {
      const data = await settingsApi.getRecentActivity(10)
      setActivities(Array.isArray(data.activities) ? data.activities : [])
    } catch (err) {
      console.error('Failed to load recent activity:', err)
    } finally {
      setActivitiesLoading(false)
    }
  }

  const loadOnlineUsers = useCallback(async () => {
    try {
      const data = await settingsApi.getOnlineUsers()
      setOnlineUsers(data.online_users)
      setOnlineCount(data.online_count)
    } catch (err) {
      console.error('Failed to load online users:', err)
    } finally {
      setOnlineLoading(false)
    }
  }, [])

  const loadRecentLogins = async (page: number) => {
    setLoginsLoading(true)
    try {
      const data = await settingsApi.getRecentLogins(page, 10)
      setRecentLogins(data.logins)
      setLoginsPage(data.pagination.page)
      setLoginsPagination(data.pagination)
    } catch (err) {
      console.error('Failed to load recent logins:', err)
    } finally {
      setLoginsLoading(false)
    }
  }

  const loadLeaveEntries = async () => {
    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
    try {
      const data = await getLeaveCalendar(startDate, endDate)
      const sorted = [...data].sort((a, b) => a.start_date.localeCompare(b.start_date))
      setLeaveEntries(sorted)
    } catch (err) {
      console.error('Failed to load leave entries:', err)
    } finally {
      setLeaveLoading(false)
    }
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'invoice': return DocumentTextIcon
      case 'planning': return CalendarDaysIcon
      case 'leave': return ClockIcon
      case 'user': return UsersIcon
      case 'company': return BuildingOfficeIcon
      default: return ClipboardDocumentListIcon
    }
  }

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'invoice': return 'text-blue-600 bg-blue-50'
      case 'planning': return 'text-purple-600 bg-purple-50'
      case 'leave': return 'text-orange-600 bg-orange-50'
      case 'user': return 'text-green-600 bg-green-50'
      case 'company': return 'text-indigo-600 bg-indigo-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const statCards = [
    { 
      name: t('nav.users'), 
      value: stats?.users ?? '-', 
      icon: UsersIcon, 
      href: '/admin/users',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    { 
      name: t('nav.companies'), 
      value: stats?.companies ?? '-', 
      icon: BuildingOfficeIcon, 
      href: '/companies',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    { 
      name: t('fleet.title'), 
      value: stats?.vehicles ?? '-', 
      icon: TruckIcon, 
      href: '/fleet',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    { 
      name: `${t('dashboard.hoursWeek')} ${stats?.week_number ?? ''}`, 
      value: stats?.hours_this_week ?? '-', 
      icon: ClockIcon, 
      href: '/time-entries',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    { 
      name: t('dashboard.pendingInvoices'), 
      value: stats?.open_invoices ?? '-', 
      icon: DocumentTextIcon, 
      href: '/invoices',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ]

  const fin = stats?.financial
  const financialCards = [
    {
      name: t('dashboard.totalIncome'),
      value: fin ? formatCurrency(fin.income) : '-',
      icon: ArrowTrendingUpIcon,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
    },
    {
      name: t('dashboard.totalExpenses'),
      value: fin ? formatCurrency(fin.expenses) : '-',
      icon: ArrowTrendingDownIcon,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
    },
    {
      name: t('dashboard.profit'),
      value: fin ? formatCurrency(fin.profit) : '-',
      icon: BanknotesIcon,
      color: fin && fin.profit >= 0 ? 'text-blue-600' : 'text-red-600',
      bgColor: fin && fin.profit >= 0 ? 'bg-blue-50' : 'bg-red-50',
      borderColor: fin && fin.profit >= 0 ? 'border-blue-200' : 'border-red-200',
    },
    {
      name: t('dashboard.totalCollected'),
      value: fin ? formatCurrency(fin.collected) : '-',
      icon: CheckCircleIcon,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
    },
    {
      name: t('dashboard.totalOutstanding'),
      value: fin ? formatCurrency(fin.outstanding) : '-',
      icon: ClockIcon,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200',
    },
  ]
  
  return (
    <div className="space-y-6">
      {/* Welcome message */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          {t('dashboard.welcomeDriver', { name: user?.voornaam })}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('dashboard.overview')}
        </p>
      </div>
      
      {/* Stats grid — 2 cols mobile, 3 cols md, 5 cols xl */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
        {statCards.map((stat) => (
          <Link
            key={stat.name}
            to={stat.href}
            className="card p-3 sm:p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={`flex-shrink-0 p-1.5 sm:p-2.5 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] sm:text-xs font-medium text-gray-500 truncate">{stat.name}</p>
                <p className="text-base sm:text-xl font-semibold text-gray-900">
                  {loading ? (
                    <span className="inline-block w-8 h-5 bg-gray-200 rounded animate-pulse" />
                  ) : (
                    stat.value
                  )}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Financial cards — 2 cols mobile, 3 md, 5 xl */}
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3">{t('dashboard.financialOverview')} {stats?.year}</h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
          {financialCards.map((card) => (
            <div
              key={card.name}
              className={`rounded-xl border p-3 sm:p-4 ${card.bgColor} ${card.borderColor}`}
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className={`flex-shrink-0 p-1.5 sm:p-2 rounded-lg ${card.bgColor}`}>
                  <card.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${card.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs font-medium opacity-70 truncate">{card.name}</p>
                  <p className={`text-sm sm:text-lg font-bold ${card.color} truncate`}>
                    {loading ? (
                      <span className="inline-block w-16 h-5 bg-gray-200/50 rounded animate-pulse" />
                    ) : (
                      card.value
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Quick actions — 2 cols mobile, 3 md, 5 lg */}
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3">{t('dashboard.quickActions')}</h2>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Link to="/time-entries" className="btn-primary text-center text-xs sm:text-sm py-2 sm:py-2.5">
            + {t('dashboard.registerHoursAction')}
          </Link>
          <Link to="/leave" className="btn-secondary text-center text-xs sm:text-sm py-2 sm:py-2.5">
            {t('dashboard.requestLeaveAction')}
          </Link>
          <Link to="/planning" className="btn-secondary text-center text-xs sm:text-sm py-2 sm:py-2.5">
            + {t('dashboard.newPlanningAction')}
          </Link>
          <Link to="/invoices/new" className="btn-secondary text-center text-xs sm:text-sm py-2 sm:py-2.5">
            + {t('dashboard.createInvoiceAction')}
          </Link>
          <Link to="/companies" className="btn-secondary text-center text-xs sm:text-sm py-2 sm:py-2.5 col-span-2 md:col-span-1">
            + {t('companies.addCompany')}
          </Link>
        </div>
      </div>

      {/* Leave this month */}
      <div>
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <CalendarDaysIcon className="h-5 w-5 text-orange-500" />
          {t('dashboard.leaveThisMonth')}
        </h2>
        <div className="card overflow-hidden">
          {leaveLoading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
            </div>
          ) : leaveEntries.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              {t('dashboard.noLeaveThisMonth')}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leaveEntries.map((entry) => (
                <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 gap-1 sm:gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 p-1.5 rounded-lg bg-orange-50">
                      <CalendarDaysIcon className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{entry.user_naam}</p>
                      <p className="text-xs text-gray-500 truncate">{entry.leave_type_display}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-600 sm:flex-shrink-0 pl-10 sm:pl-0">
                    <span>
                      {new Date(entry.start_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(entry.end_date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                    </span>
                    <span className="font-medium text-gray-900">{entry.hours} {t('dashboard.leaveHours')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <Link
              to="/leave/calendar"
              className="flex items-center gap-1.5 text-xs sm:text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              <ArrowRightIcon className="h-3.5 w-3.5" />
              {t('dashboard.viewLeaveCalendar')}
            </Link>
          </div>
        </div>
      </div>
      
      {/* Tabbed section: Online Users | Recent Logins | Recent Activity */}
      <div>
        {/* Tab headers — scrollable on mobile */}
        <div className="border-b border-gray-200 mb-0 overflow-x-auto">
          <nav className="-mb-px flex space-x-4 sm:space-x-6 min-w-max">
            <button
              onClick={() => setActiveTab('online')}
              className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-1 border-b-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'online'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <SignalIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('dashboard.onlineNow')}
              <span className={`inline-flex items-center justify-center min-w-[18px] h-4 sm:h-5 px-1 sm:px-1.5 rounded-full text-[10px] sm:text-xs font-semibold ${
                onlineCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {onlineCount}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('logins')}
              className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-1 border-b-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'logins'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <ArrowRightOnRectangleIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('dashboard.recentLogins')}
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-1 border-b-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'activity'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <ClipboardDocumentListIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {t('dashboard.recentActivity')}
            </button>
          </nav>
        </div>

        {/* Tab content */}
        <div className="card overflow-hidden rounded-t-none border-t-0">
          {/* === Online Users Tab === */}
          {activeTab === 'online' && (
            onlineLoading ? (
              <div className="p-6 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
              </div>
            ) : onlineUsers.length === 0 ? (
              <div className="p-6">
                <p className="text-gray-500 text-center py-4">{t('dashboard.noOnlineUsers')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {onlineUsers.map((u) => {
                  const roleBadge = getRoleBadge(u.rol, t)
                  return (
                    <li key={u.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
                      <div className="flex-shrink-0 relative">
                        <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-primary-100 flex items-center justify-center">
                          <span className="text-xs sm:text-sm font-medium text-primary-700">
                            {u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-green-400 ring-2 ring-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                        <p className="text-[11px] sm:text-xs text-gray-500 truncate">{u.email}</p>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3">
                        <span className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge.color}`}>
                          {roleBadge.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-green-600 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          {t('dashboard.online')}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          )}

          {/* === Recent Logins Tab === */}
          {activeTab === 'logins' && (
            loginsLoading ? (
              <div className="p-6 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
              </div>
            ) : recentLogins.length === 0 ? (
              <div className="p-6">
                <p className="text-gray-500 text-center py-4">{t('dashboard.noRecentLogins')}</p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {recentLogins.map((u) => {
                    const roleBadge = getRoleBadge(u.rol, t)
                    const isOnline = onlineUsers.some(o => o.id === u.id)
                    return (
                      <li key={u.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
                        <div className="flex-shrink-0 relative">
                          <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-primary-100 flex items-center justify-center">
                            <span className="text-xs sm:text-sm font-medium text-primary-700">
                              {u.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          {isOnline && (
                            <span className="absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-green-400 ring-2 ring-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">{u.full_name}</p>
                          <p className="text-[11px] sm:text-xs text-gray-500 truncate">{u.email}</p>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3">
                          <span className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge.color}`}>
                            {roleBadge.label}
                          </span>
                          <span className="text-[11px] sm:text-xs text-gray-400 text-right">
                            {u.last_login ? formatTimestamp(u.last_login, t) : '-'}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {/* Pagination */}
                {loginsPagination.total_pages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-3 sm:px-4 py-2.5 sm:py-3">
                    <p className="text-[11px] sm:text-xs text-gray-500">
                      {t('dashboard.pageOf', { page: loginsPage, total: loginsPagination.total_pages })}
                      <span className="hidden sm:inline">{' · '}{loginsPagination.total} {t('dashboard.totalEntries')}</span>
                    </p>
                    <div className="flex gap-1.5 sm:gap-2">
                      <button
                        onClick={() => loadRecentLogins(loginsPage - 1)}
                        disabled={!loginsPagination.has_previous}
                        className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronLeftIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        <span className="hidden sm:inline">{t('common.previous')}</span>
                      </button>
                      <button
                        onClick={() => loadRecentLogins(loginsPage + 1)}
                        disabled={!loginsPagination.has_next}
                        className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span className="hidden sm:inline">{t('common.next')}</span>
                        <ChevronRightIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
          )}

          {/* === Recent Activity Tab === */}
          {activeTab === 'activity' && (
            activitiesLoading ? (
              <div className="p-6 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
              </div>
            ) : activities.length === 0 ? (
              <div className="p-6">
                <p className="text-gray-500 text-center py-8">
                  {t('dashboard.noActivity')}
                </p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {(activities || []).slice(0, 10).map((activity, idx) => {
                    const Icon = getActivityIcon(activity.type)
                    const colorClass = getActivityColor(activity.type)
                    const isClickable = activity.link && activity.link !== '/'
                    
                    const content = (
                      <>
                        <div className={`flex-shrink-0 p-1.5 sm:p-2 rounded-lg ${colorClass}`}>
                          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                            {activity.title}
                          </p>
                          <p className="text-[11px] sm:text-sm text-gray-500 truncate">
                            {activity.description}
                            {activity.user_name && <span className="hidden sm:inline ml-2 text-gray-400">· {t('dashboard.by')} {activity.user_name}</span>}
                          </p>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <span className="text-[11px] sm:text-xs text-gray-400">
                            {formatTimestamp(activity.timestamp, t)}
                          </span>
                          {isClickable && <ArrowRightIcon className="hidden sm:block h-4 w-4 text-gray-400" />}
                        </div>
                      </>
                    )

                    return (
                      <li key={activity.id || idx}>
                        {isClickable ? (
                          <Link to={activity.link} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-gray-50 transition-colors">
                            {content}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3">
                            {content}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div className="border-t border-gray-100 px-3 sm:px-4 py-2.5 sm:py-3 text-right">
                  <Link to="/activities" className="text-xs sm:text-sm text-primary-600 hover:text-primary-700 font-medium">
                    {t('common.viewAll')} →
                  </Link>
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// Helper functions
function getRoleBadge(rol: string, t: any) {
  return {
    admin: { label: t('dashboard.roleAdmin'), color: 'bg-red-100 text-red-700' },
    gebruiker: { label: t('dashboard.roleGebruiker'), color: 'bg-blue-100 text-blue-700' },
    chauffeur: { label: t('dashboard.roleChauffeur'), color: 'bg-green-100 text-green-700' },
  }[rol] || { label: rol, color: 'bg-gray-100 text-gray-700' }
}

function formatTimestamp(timestamp: string, t: any) {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('dashboard.justNow')
  if (diffMins < 60) return t('dashboard.minutesAgo', { count: diffMins })
  if (diffHours < 24) return t('dashboard.hoursAgo', { count: diffHours })
  if (diffDays < 7) return t('dashboard.daysAgo', { count: diffDays })
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  
  // Show chauffeur-specific dashboard
  if (user?.rol === 'chauffeur') {
    return <ChauffeurDashboard user={user} />
  }
  
  // Show admin/gebruiker dashboard
  return <AdminDashboard user={user} />
}
