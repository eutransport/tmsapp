import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { settingsApi, ActivityItem } from '@/api/settings'
import {
  DocumentTextIcon,
  CalendarDaysIcon,
  ClockIcon,
  UsersIcon,
  BuildingOfficeIcon,
  TruckIcon,
  UserIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FunnelIcon,
  ArrowLeftOnRectangleIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'

// Entity types and actions - labels will be translated in component

export default function ActivityPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  const ENTITY_TYPES = [
    { value: '', label: t('common.allTypes') },
    { value: 'invoice', label: t('nav.invoices') },
    { value: 'planning', label: t('nav.planning') },
    { value: 'leave', label: t('nav.leave') },
    { value: 'user', label: t('nav.users') },
    { value: 'company', label: t('nav.companies') },
    { value: 'vehicle', label: t('fleet.title', 'Voertuigen') },
    { value: 'driver', label: t('nav.drivers') },
    { value: 'time_entry', label: t('nav.timeEntries') },
    { value: 'auth', label: t('activity.loginLogout', 'Login/Logout') },
  ]

  const ACTIONS = [
    { value: '', label: t('activity.allActions') },
    { value: 'created', label: t('activity.created') },
    { value: 'updated', label: t('activity.updated') },
    { value: 'deleted', label: t('activity.deleted') },
    { value: 'submitted', label: t('activity.submitted') },
    { value: 'approved', label: t('activity.approved') },
    { value: 'rejected', label: t('activity.rejected') },
    { value: 'sent', label: t('activity.sent') },
    { value: 'login', label: t('activity.login') },
    { value: 'logout', label: t('activity.logout') },
  ]
  const [pagination, setPagination] = useState({
    page: 1,
    per_page: 25,
    total: 0,
    total_pages: 0,
    has_next: false,
    has_previous: false,
  })
  const [filterType, setFilterType] = useState('')
  const [filterAction, setFilterAction] = useState('')

  useEffect(() => {
    loadActivities()
  }, [pagination.page, filterType, filterAction])

  const loadActivities = async () => {
    setLoading(true)
    try {
      const data = await settingsApi.getActivities(
        pagination.page,
        pagination.per_page,
        filterType || undefined,
        filterAction || undefined
      )
      setActivities(data.activities)
      setPagination(data.pagination)
    } catch (err) {
      console.error('Failed to load activities:', err)
    } finally {
      setLoading(false)
    }
  }

  const getIcon = (type: string, action?: string) => {
    if (action === 'login') return ArrowLeftOnRectangleIcon
    if (action === 'logout') return ArrowRightOnRectangleIcon
    
    switch (type) {
      case 'invoice': return DocumentTextIcon
      case 'planning': return CalendarDaysIcon
      case 'leave': return ClockIcon
      case 'user': return UsersIcon
      case 'company': return BuildingOfficeIcon
      case 'vehicle': return TruckIcon
      case 'driver': return UserIcon
      case 'time_entry': return ClockIcon
      case 'auth': return UserIcon
      default: return DocumentTextIcon
    }
  }

  const getColor = (type: string, action?: string) => {
    if (action === 'login') return 'text-green-600 bg-green-50'
    if (action === 'logout') return 'text-gray-600 bg-gray-50'
    if (action === 'approved') return 'text-green-600 bg-green-50'
    if (action === 'rejected') return 'text-red-600 bg-red-50'
    if (action === 'deleted') return 'text-red-600 bg-red-50'
    
    switch (type) {
      case 'invoice': return 'text-blue-600 bg-blue-50'
      case 'planning': return 'text-purple-600 bg-purple-50'
      case 'leave': return 'text-orange-600 bg-orange-50'
      case 'user': return 'text-green-600 bg-green-50'
      case 'company': return 'text-indigo-600 bg-indigo-50'
      case 'vehicle': return 'text-cyan-600 bg-cyan-50'
      case 'driver': return 'text-teal-600 bg-teal-50'
      case 'time_entry': return 'text-amber-600 bg-amber-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleActivityClick = (activity: ActivityItem) => {
    if (activity.link && activity.link !== '/') {
      navigate(activity.link)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="page-title">{t('activity.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('activity.systemOverview', 'Overzicht van alle activiteiten in het systeem')}
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <FunnelIcon className="h-5 w-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">{t('common.filter')}:</span>
          </div>
          
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            className="input-field w-auto"
          >
            {ENTITY_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          
          <select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value)
              setPagination(p => ({ ...p, page: 1 }))
            }}
            className="input-field w-auto"
          >
            {ACTIONS.map(action => (
              <option key={action.value} value={action.value}>{action.label}</option>
            ))}
          </select>
          
          {(filterType || filterAction) && (
            <button
              onClick={() => {
                setFilterType('')
                setFilterAction('')
                setPagination(p => ({ ...p, page: 1 }))
              }}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              {t('activity.clearFilters', 'Filters wissen')}
            </button>
          )}
        </div>
      </div>

      {/* Activity List */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
            <p className="mt-4 text-gray-500">{t('activity.loading', 'Activiteiten laden...')}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <ClockIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>{t('activity.noActivity')}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {activities.map((activity) => {
                const Icon = getIcon(activity.type, activity.action)
                const colorClass = getColor(activity.type, activity.action)
                const isClickable = activity.link && activity.link !== '/'
                
                return (
                  <li key={activity.id}>
                    <div
                      onClick={() => isClickable && handleActivityClick(activity)}
                      className={`flex items-center gap-4 p-4 ${isClickable ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
                    >
                      <div className={`flex-shrink-0 p-2 rounded-lg ${colorClass}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900">
                            {activity.title}
                          </p>
                          {activity.action_display && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              {activity.action_display}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate">
                          {activity.description}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatTimestamp(activity.timestamp)}</span>
                          {activity.user_name && (
                            <>
                              <span>•</span>
                              <span>{t('activity.by')} {activity.user_name}</span>
                            </>
                          )}
                          {activity.ip_address && (
                            <>
                              <span>•</span>
                              <span>IP: {activity.ip_address}</span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {isClickable && (
                        <div className="flex-shrink-0">
                          <ArrowRightIcon className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
              <div className="text-sm text-gray-500">
                {pagination.total} {t('activity.activities', 'activiteiten')} • {t('timeEntries.page', 'Pagina')} {pagination.page} {t('common.of')} {pagination.total_pages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                  disabled={!pagination.has_previous}
                  className="btn-secondary py-1 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                  disabled={!pagination.has_next}
                  className="btn-secondary py-1 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
