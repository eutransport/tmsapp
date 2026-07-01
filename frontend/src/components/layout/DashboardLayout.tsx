import { useEffect, useState, useCallback, Fragment, useMemo } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Dialog, Transition, Menu } from '@headlessui/react'
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid'
import {
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  UsersIcon,
  BuildingOfficeIcon,
  TruckIcon,
  ClockIcon,
  CalendarIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  KeyIcon,
  CurrencyEuroIcon,
  ArrowUpTrayIcon,
  CalendarDaysIcon,
  ScaleIcon,
  BellIcon,
  PencilSquareIcon,
  TableCellsIcon,
  SwatchIcon,
  WrenchScrewdriverIcon,
  ChartBarSquareIcon,
  MapPinIcon,
  DocumentChartBarIcon,
  EnvelopeIcon,
  ReceiptPercentIcon,
  StarIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import { useAppStore } from '@/stores/appStore'
import { useThemeStore } from '@/stores/themeStore'
import { AppSettings } from '@/types'
import { authApi } from '@/api/auth'
import clsx from '@/utils/clsx'
import NotificationBell from '@/components/notifications/NotificationBell'
import PushNotificationPrompt from '@/components/pwa/PushNotificationPrompt'
import ActiveTasksPopup from '@/components/tasks/ActiveTasksPopup'
import LicenseExpiryBanner from '@/components/licensing/LicenseExpiryBanner'
import LanguageSwitcher from '@/components/common/LanguageSwitcher'
import { useTranslation } from 'react-i18next'

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles?: ('admin' | 'gebruiker' | 'chauffeur')[]
  permission?: string
}

const navigation: NavItem[] = [
  { name: 'nav.dashboard', href: '/', icon: HomeIcon, roles: ['admin', 'gebruiker'], permission: 'view_dashboard' },
  { name: 'nav.companies', href: '/companies', icon: BuildingOfficeIcon, roles: ['admin', 'gebruiker'], permission: 'view_companies' },
  { name: 'nav.drivers', href: '/drivers', icon: UsersIcon, roles: ['admin', 'gebruiker'], permission: 'view_drivers' },
  { name: 'nav.fleet', href: '/fleet', icon: TruckIcon, roles: ['admin', 'gebruiker'], permission: 'view_fleet' },
  { name: 'nav.timeEntries', href: '/time-entries', icon: ClockIcon },
  { name: 'nav.myHours', href: '/my-hours', icon: ClipboardDocumentListIcon, roles: ['chauffeur'] },
  { name: 'nav.submittedHours', href: '/submitted-hours', icon: ClipboardDocumentListIcon, roles: ['admin', 'gebruiker'], permission: 'view_submitted_hours' },
  { name: 'nav.urenImport', href: '/uren-import', icon: ArrowUpTrayIcon, roles: ['admin'], permission: 'view_uren_import' },
  { name: 'nav.tolregistratie', href: '/toll', icon: ReceiptPercentIcon, roles: ['admin', 'chauffeur'] },
  { name: 'nav.tolregistratieAdmin', href: '/toll/admin', icon: ClipboardDocumentListIcon, roles: ['admin'] },
  { name: 'nav.kilometerheffing', href: '/kilometerheffing', icon: CurrencyEuroIcon, roles: ['admin', 'gebruiker'] },
  { name: 'nav.planning', href: '/planning', icon: CalendarIcon },
  { name: 'nav.leave', href: '/leave', icon: CalendarDaysIcon },
  { name: 'nav.leaveBalance', href: '/leave/balances', icon: ScaleIcon, roles: ['admin', 'gebruiker', 'chauffeur'], permission: 'view_leave_balances' },
  { name: 'nav.leaveRequests', href: '/leave/admin', icon: ClipboardDocumentCheckIcon, roles: ['admin'], permission: 'can_manage_leave_for_all' },
  { name: 'nav.documents', href: '/documents', icon: PencilSquareIcon },
  { name: 'nav.tasks', href: '/tasks', icon: ClipboardDocumentCheckIcon },
  { name: 'nav.notifications', href: '/notifications', icon: BellIcon, roles: ['admin'], permission: 'view_notifications' },
  { name: 'nav.invoices', href: '/invoices', icon: DocumentTextIcon, roles: ['admin', 'gebruiker'], permission: 'view_invoices' },
  { name: 'nav.invoiceTemplates', href: '/invoices/templates', icon: DocumentDuplicateIcon, roles: ['admin'], permission: 'view_invoice_templates' },
  { name: 'nav.invoiceImport', href: '/imports', icon: ArrowUpTrayIcon, roles: ['admin', 'gebruiker'], permission: 'view_invoice_import' },
  { name: 'nav.revenue', href: '/revenue', icon: CurrencyEuroIcon, roles: ['admin', 'gebruiker'], permission: 'view_revenue' },
  { name: 'nav.spreadsheets', href: '/spreadsheets', icon: TableCellsIcon, roles: ['admin'], permission: 'view_spreadsheets' },
  { name: 'nav.spreadsheetTemplates', href: '/spreadsheets/templates', icon: SwatchIcon, roles: ['admin'], permission: 'view_spreadsheet_templates' },
  { name: 'nav.maintenance', href: '/maintenance', icon: WrenchScrewdriverIcon, roles: ['admin', 'gebruiker'], permission: 'view_maintenance' },
  { name: 'nav.trackTrace', href: '/track-trace', icon: MapPinIcon, roles: ['admin'] },
  { name: 'nav.tachograph', href: '/tachograph', icon: ChartBarSquareIcon, roles: ['admin'] },
  { name: 'nav.tachographComparison', href: '/tachograph/comparison', icon: ChartBarSquareIcon, roles: ['admin'] },
  { name: 'nav.reports', href: '/reports', icon: DocumentChartBarIcon, roles: ['admin', 'gebruiker', 'chauffeur'], permission: 'view_reports' },
  { name: 'nav.pakmiddelen', href: '/pakmiddelen', icon: EnvelopeIcon, roles: ['admin', 'gebruiker'], permission: 'view_pakmiddelen' },
]

const adminNavigation: NavItem[] = [
  { name: 'nav.users', href: '/admin/users', icon: UsersIcon, roles: ['admin'] },
  { name: 'nav.settings', href: '/settings', icon: Cog6ToothIcon, roles: ['admin'] },
]

// Grouped navigation. Items not listed here fall into the "other" catch-all.
interface NavGroupDef {
  id: string
  labelKey: string
  fallback: string
  hrefs: string[]
}
const navGroups: NavGroupDef[] = [
  { id: 'overview',     labelKey: 'nav.group.overview',     fallback: 'Overzicht',              hrefs: ['/', '/planning', '/notifications'] },
  { id: 'masterdata',   labelKey: 'nav.group.masterdata',   fallback: 'Basisgegevens',          hrefs: ['/companies', '/drivers', '/fleet', '/pakmiddelen'] },
  { id: 'hours',        labelKey: 'nav.group.hours',        fallback: 'Uren & verlof',          hrefs: ['/time-entries', '/my-hours', '/submitted-hours', '/uren-import', '/leave', '/leave/balances', '/leave/admin'] },
  { id: 'registration', labelKey: 'nav.group.registration', fallback: 'Registraties',           hrefs: ['/toll', '/toll/admin', '/kilometerheffing', '/track-trace', '/tachograph', '/tachograph/comparison'] },
  { id: 'invoicing',    labelKey: 'nav.group.invoicing',    fallback: 'Facturatie',             hrefs: ['/invoices', '/invoices/templates', '/imports', '/revenue'] },
  { id: 'documents',    labelKey: 'nav.group.documents',    fallback: 'Documenten & rapporten', hrefs: ['/documents', '/tasks', '/reports', '/spreadsheets', '/spreadsheets/templates', '/maintenance'] },
  { id: 'admin',        labelKey: 'nav.group.admin',        fallback: 'Beheer',                 hrefs: ['/admin/users', '/settings'] },
]

const COLLAPSE_KEY = 'tms.sidebar.collapsed'
const GROUPS_KEY = 'tms.sidebar.groups'

export default function DashboardLayout() {
  const navigate = useNavigate()
  const { user, logout, setUser } = useAuthStore()
  const { settings, sidebarOpen, setSidebarOpen, fetchSettings } = useAppStore()
  const { currentTheme, applyTheme } = useThemeStore()
  const { t } = useTranslation()

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => { applyTheme(currentTheme) }, [currentTheme, applyTheme])

  const handleLogout = () => { logout(); navigate('/login') }

  const userRole = user?.rol || 'chauffeur'
  const userPermissions = user?.module_permissions || []

  const filterByRole = (items: NavItem[]) =>
    items.filter(item => {
      if (userRole === 'admin') {
        if (!item.roles) return true
        return item.roles.includes('admin')
      }
      if (item.permission && userPermissions.includes(item.permission)) return true
      if (item.roles && !item.roles.includes(userRole)) return false
      if (item.permission && !userPermissions.includes(item.permission)) return false
      return true
    })

  const filteredNavigation = filterByRole(navigation)
  const filteredAdminNavigation = filterByRole(adminNavigation)
  const allNavigation = useMemo(
    () => [...filteredNavigation, ...filteredAdminNavigation],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userRole, userPermissions.join(',')]
  )

  // Favorites
  const [favorites, setFavorites] = useState<string[]>(user?.nav_favorites ?? [])
  useEffect(() => { setFavorites(user?.nav_favorites ?? []) }, [user?.nav_favorites])
  const toggleFavorite = useCallback((href: string) => {
    const current = user?.nav_favorites ?? []
    const next = current.includes(href) ? current.filter(h => h !== href) : [...current, href]
    setFavorites(next)
    authApi.updateProfile({ nav_favorites: next })
      .then(updated => setUser(updated))
      .catch(() => setFavorites(current))
  }, [user?.nav_favorites, setUser])

  // Sidebar collapse (desktop only), persisted
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })
  const toggleCollapsed = () => {
    setCollapsed(c => {
      const nx = !c
      try { localStorage.setItem(COLLAPSE_KEY, nx ? '1' : '0') } catch { /* ignore */ }
      return nx
    })
  }

  // Group open states, persisted
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(GROUPS_KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return Object.fromEntries(navGroups.map(g => [g.id, true]))
  })
  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Edge-swipe to open the mobile sidebar
  useEffect(() => {
    if (sidebarOpen) return
    let startX = 0, startY = 0, tracking = false
    const EDGE = 18, THRESHOLD = 60
    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= 1024) return
      const tp = e.touches[0]
      if (!tp || tp.clientX > EDGE) return
      startX = tp.clientX; startY = tp.clientY; tracking = true
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const tp = e.touches[0]
      if (!tp) return
      const dx = tp.clientX - startX, dy = tp.clientY - startY
      if (dx > THRESHOLD && Math.abs(dx) > Math.abs(dy)) { tracking = false; setSidebarOpen(true) }
      else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20) { tracking = false }
    }
    const onEnd = () => { tracking = false }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [sidebarOpen, setSidebarOpen])

  return (
    <div className="h-full flex">
      {/* Mobile sidebar */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0" enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full" enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0" leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <div
                  className="absolute left-full top-0 flex w-16 justify-center"
                  style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}
                >
                  <button type="button" className="-m-2.5 p-2.5 touch-manipulation" onClick={() => setSidebarOpen(false)} aria-label="Sluit menu">
                    <XMarkIcon className="h-6 w-6 text-white pointer-events-none" />
                  </button>
                </div>

                <SidebarContent
                  navigation={allNavigation}
                  settings={settings}
                  onNavigate={() => setSidebarOpen(false)}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  collapsed={false}
                  openGroups={openGroups}
                  onToggleGroup={toggleGroup}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div
        className={clsx(
          'hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:flex-col transition-[width] duration-200 ease-out-quart',
          collapsed ? 'lg:w-[76px]' : 'lg:w-64'
        )}
      >
        <SidebarContent
          navigation={allNavigation}
          settings={settings}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
        />
      </div>

      {/* Main content */}
      <div
        className={clsx(
          'flex flex-col flex-1 min-w-0 transition-[padding] duration-200 ease-out-quart',
          collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'
        )}
      >
        {/* Top bar */}
        <div
          className="topbar-safe sticky top-0 z-40 flex shrink-0 items-center gap-x-2 sm:gap-x-4 border-b border-gray-200/80 bg-white/85 backdrop-blur"
          style={{ isolation: 'isolate' }}
        >
          <button
            type="button"
            className="p-2.5 -ml-1 text-gray-700 lg:hidden touch-target rounded-md hover:bg-gray-100 touch-manipulation"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.openSidebar', 'Open menu')}
          >
            <Bars3Icon className="h-6 w-6 pointer-events-none" />
          </button>

          <div className="flex flex-1 items-center justify-end gap-x-2 sm:gap-x-3">
            <div className="hidden sm:block"><LanguageSwitcher /></div>
            <NotificationBell />

            <Menu as="div" className="relative">
              <Menu.Button className="flex items-center gap-2 p-1.5 hover:bg-gray-100 rounded-lg touch-target transition-colors touch-manipulation">
                <UserCircleIcon className="h-8 w-8 text-gray-400 pointer-events-none" />
                <span className="hidden lg:flex lg:items-center">
                  <span className="text-sm font-semibold text-gray-900 max-w-[10rem] truncate">
                    {user?.full_name}
                  </span>
                  <ChevronDownIcon className="ml-1.5 h-4 w-4 text-gray-400" />
                </span>
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute right-0 z-[60] mt-2 w-56 origin-top-right rounded-xl bg-white py-2 shadow-pop ring-1 ring-gray-900/5 focus:outline-none">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900 truncate">{user?.full_name}</p>
                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    <p className="text-xs text-gray-400 capitalize mt-0.5">{user?.rol}</p>
                  </div>
                  <div className="sm:hidden px-4 py-2 border-b border-gray-100">
                    <LanguageSwitcher />
                  </div>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => navigate('/profile/password')}
                        className={clsx(active ? 'bg-gray-50' : '', 'flex w-full items-center px-4 py-2 text-sm text-gray-700 touch-manipulation')}
                      >
                        <KeyIcon className="mr-3 h-5 w-5 text-gray-400 pointer-events-none" />
                        {t('auth.changePassword')}
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={handleLogout}
                        className={clsx(active ? 'bg-gray-50' : '', 'flex w-full items-center px-4 py-2 text-sm text-gray-700 touch-manipulation')}
                      >
                        <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5 text-gray-400 pointer-events-none" />
                        {t('auth.logout')}
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>
          </div>
        </div>

        <LicenseExpiryBanner />

        <main className="flex-1 overflow-auto min-w-0">
          <div className="page-container min-w-0">
            <Outlet />
          </div>
        </main>
      </div>

      <PushNotificationPrompt delay={3000} />
      <ActiveTasksPopup />
    </div>
  )
}

interface SidebarContentProps {
  navigation: NavItem[]
  settings: AppSettings | null
  onNavigate?: () => void
  favorites: string[]
  onToggleFavorite: (href: string) => void
  collapsed: boolean
  onToggleCollapsed?: () => void
  openGroups: Record<string, boolean>
  onToggleGroup: (id: string) => void
}

function SidebarContent({
  navigation,
  settings,
  onNavigate,
  favorites,
  onToggleFavorite,
  collapsed,
  onToggleCollapsed,
  openGroups,
  onToggleGroup,
}: SidebarContentProps) {
  const { t } = useTranslation()
  const favoriteSet = new Set(favorites)
  const favoriteItems = navigation.filter(item => favoriteSet.has(item.href))

  // Build groups from currently visible navigation
  const byHref = new Map(navigation.map(it => [it.href, it]))
  const seen = new Set<string>()
  const builtGroups = navGroups
    .map(g => {
      const items = g.hrefs
        .map(href => byHref.get(href))
        .filter((it): it is NavItem => Boolean(it))
      items.forEach(it => seen.add(it.href))
      return { ...g, items }
    })
    .filter(g => g.items.length > 0)
  const ungrouped = navigation.filter(it => !seen.has(it.href))

  const renderItem = (item: NavItem, keyPrefix: string) => {
    const isFav = favoriteSet.has(item.href)
    const label = t(item.name)
    return (
      <li key={`${keyPrefix}-${item.href}`} className="relative group/item">
        <NavLink
          to={item.href}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            clsx(
              'relative flex items-center gap-x-3 rounded-md py-2 text-[13px] font-medium leading-6 transition-colors',
              collapsed ? 'justify-center px-2' : 'px-2 pr-9',
              isActive ? 'text-white' : 'hover:text-white'
            )
          }
          style={({ isActive }) => ({
            backgroundColor: isActive
              ? 'color-mix(in srgb, var(--color-primary) 28%, var(--color-sidebar-hover))'
              : 'transparent',
            color: isActive ? 'white' : 'var(--color-sidebar-text)',
            boxShadow: isActive ? 'inset 4px 0 0 0 var(--color-primary)' : 'none',
          })}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="truncate">{label}</span>}
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(item.href) }}
            aria-label={isFav ? t('nav.removeFavorite') : t('nav.addFavorite')}
            title={isFav ? t('nav.removeFavorite') : t('nav.addFavorite')}
            className={clsx(
              'absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-opacity',
              isFav ? 'opacity-100 text-yellow-300' : 'opacity-0 group-hover/item:opacity-100 text-white/50 hover:text-yellow-300'
            )}
          >
            {isFav ? <StarSolidIcon className="h-4 w-4" /> : <StarIcon className="h-4 w-4" />}
          </button>
        )}
      </li>
    )
  }

  return (
    <div
      className={clsx(
        'flex grow flex-col overflow-y-auto scrollbar-thin',
        collapsed ? 'px-2' : 'px-4'
      )}
      style={{
        backgroundColor: 'var(--color-sidebar)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Header / brand */}
      <div className={clsx('flex h-16 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between gap-3')}>
        <div className={clsx('flex items-center gap-2 min-w-0', collapsed && 'justify-center')}>
          {settings?.logo_url && (
            <img className="h-8 w-8 rounded-md object-contain" src={settings.logo_url} alt={settings.app_name} />
          )}
          {!collapsed && (
            <span className="text-lg font-bold text-white truncate">{settings?.app_name || 'TMS'}</span>
          )}
        </div>
        {onToggleCollapsed && !collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('nav.collapseSidebar', 'Zijbalk inklappen')}
            title={t('nav.collapseSidebar', 'Zijbalk inklappen')}
          >
            <ChevronDoubleLeftIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {onToggleCollapsed && collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="mx-auto mb-2 p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={t('nav.expandSidebar', 'Zijbalk uitklappen')}
          title={t('nav.expandSidebar', 'Zijbalk uitklappen')}
        >
          <ChevronDoubleRightIcon className="h-4 w-4" />
        </button>
      )}

      <nav className="flex flex-1 flex-col pb-4">
        <ul role="list" className="flex flex-1 flex-col gap-y-4">
          {/* Favorites */}
          {favoriteItems.length > 0 && (
            <li>
              {!collapsed && (
                <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {t('nav.favorites')}
                </div>
              )}
              <ul role="list" className="-mx-1 space-y-0.5">
                {favoriteItems.map(item => renderItem(item, 'fav'))}
              </ul>
              {!collapsed && <div className="mt-3 mx-2 border-t border-white/10" />}
            </li>
          )}

          {/* Groups */}
          {builtGroups.map(group => {
            const open = openGroups[group.id] !== false
            const label = t(group.labelKey, group.fallback)
            return (
              <li key={group.id}>
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => onToggleGroup(group.id)}
                    className="flex w-full items-center justify-between px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors"
                  >
                    <span className="truncate">{label}</span>
                    <ChevronRightIcon
                      className={clsx(
                        'h-3.5 w-3.5 transition-transform duration-150',
                        open && 'rotate-90'
                      )}
                    />
                  </button>
                ) : (
                  <div className="mx-2 my-2 border-t border-white/10" />
                )}
                {(collapsed || open) && (
                  <ul role="list" className="-mx-1 space-y-0.5">
                    {group.items.map(item => renderItem(item, group.id))}
                  </ul>
                )}
              </li>
            )
          })}

          {/* Ungrouped fallback */}
          {ungrouped.length > 0 && (
            <li>
              {!collapsed && (
                <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {t('nav.group.other', 'Overig')}
                </div>
              )}
              <ul role="list" className="-mx-1 space-y-0.5">
                {ungrouped.map(item => renderItem(item, 'other'))}
              </ul>
            </li>
          )}
        </ul>
      </nav>
    </div>
  )
}
