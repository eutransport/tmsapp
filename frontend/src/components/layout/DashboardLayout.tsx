import { useEffect, Fragment } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Dialog, Transition, Menu } from '@headlessui/react'
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
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  KeyIcon,
  CurrencyEuroIcon,
  ArrowUpTrayIcon,
  CalendarDaysIcon,
  BellIcon,
  PencilSquareIcon,
  TableCellsIcon,
  SwatchIcon,
  WrenchScrewdriverIcon,
  MapPinIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import { useAppStore } from '@/stores/appStore'
import { useThemeStore } from '@/stores/themeStore'
import { AppSettings } from '@/types'
import clsx from '@/utils/clsx'
import NotificationBell from '@/components/notifications/NotificationBell'
import PushNotificationPrompt from '@/components/pwa/PushNotificationPrompt'
import LicenseExpiryBanner from '@/components/licensing/LicenseExpiryBanner'
import LanguageSwitcher from '@/components/common/LanguageSwitcher'
import { useTranslation } from 'react-i18next'

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles?: ('admin' | 'gebruiker' | 'chauffeur')[]  // If undefined, all roles can see it
  permission?: string  // Optional module permission key that also grants access
}

// Navigation items with role-based access - keys for translation
const navigation: NavItem[] = [
  { name: 'nav.dashboard', href: '/', icon: HomeIcon, roles: ['admin'], permission: 'view_dashboard' },
  { name: 'nav.companies', href: '/companies', icon: BuildingOfficeIcon, roles: ['admin'], permission: 'view_companies' },
  { name: 'nav.drivers', href: '/drivers', icon: UsersIcon, roles: ['admin'], permission: 'view_drivers' },
  { name: 'nav.fleet', href: '/fleet', icon: TruckIcon, roles: ['admin'], permission: 'view_fleet' },
  { name: 'nav.tracking', href: '/tracking', icon: MapPinIcon },  // All roles - Track & Trace
  { name: 'nav.timeEntries', href: '/time-entries', icon: ClockIcon },  // All roles
  { name: 'nav.myHours', href: '/my-hours', icon: ClipboardDocumentListIcon, roles: ['chauffeur', 'gebruiker'] },
  { name: 'nav.submittedHours', href: '/submitted-hours', icon: ClipboardDocumentListIcon, roles: ['admin'], permission: 'view_submitted_hours' },
  { name: 'nav.urenImport', href: '/uren-import', icon: ArrowUpTrayIcon, roles: ['admin'], permission: 'view_uren_import' },
  { name: 'nav.planning', href: '/planning', icon: CalendarIcon },  // All roles (filtered by backend)
  { name: 'nav.leave', href: '/leave', icon: CalendarDaysIcon },  // All roles
  { name: 'nav.leaveRequests', href: '/leave/admin', icon: ClipboardDocumentCheckIcon, roles: ['admin'], permission: 'can_manage_leave_for_all' },
  { name: 'nav.documents', href: '/documents', icon: PencilSquareIcon },  // All roles - PDF signing
  { name: 'nav.notifications', href: '/notifications', icon: BellIcon, roles: ['admin'], permission: 'view_notifications' },
  { name: 'nav.invoices', href: '/invoices', icon: DocumentTextIcon, roles: ['admin'], permission: 'view_invoices' },
  { name: 'nav.invoiceTemplates', href: '/invoices/templates', icon: DocumentDuplicateIcon, roles: ['admin'], permission: 'view_invoice_templates' },
  { name: 'nav.invoiceImport', href: '/imports', icon: ArrowUpTrayIcon, roles: ['admin'], permission: 'view_invoice_import' },
  { name: 'nav.banking', href: '/banking', icon: BanknotesIcon, roles: ['admin'], permission: 'view_banking' },
  { name: 'nav.revenue', href: '/revenue', icon: CurrencyEuroIcon, roles: ['admin'], permission: 'view_revenue' },
  { name: 'nav.spreadsheets', href: '/spreadsheets', icon: TableCellsIcon, roles: ['admin'], permission: 'view_spreadsheets' },
  { name: 'nav.spreadsheetTemplates', href: '/spreadsheets/templates', icon: SwatchIcon, roles: ['admin'], permission: 'view_spreadsheet_templates' },
  { name: 'nav.maintenance', href: '/maintenance', icon: WrenchScrewdriverIcon, roles: ['admin'], permission: 'view_maintenance' },
]

const adminNavigation: NavItem[] = [
  { name: 'nav.users', href: '/admin/users', icon: UsersIcon, roles: ['admin'] },
  { name: 'nav.settings', href: '/settings', icon: Cog6ToothIcon, roles: ['admin'] },
]

export default function DashboardLayout() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { settings, sidebarOpen, setSidebarOpen, fetchSettings, isLoading: settingsLoading } = useAppStore()
  const { currentTheme, applyTheme } = useThemeStore()
  const { t } = useTranslation()
  
  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])
  
  // Apply theme on mount
  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme, applyTheme])
  
  const handleLogout = () => {
    logout()
    navigate('/login')
  }
  
  const userRole = user?.rol || 'chauffeur'
  const userPermissions = user?.module_permissions || []
  
  // Filter navigation items based on user role OR explicit module permission
  const filterByRole = (items: NavItem[]) => 
    items.filter(item => {
      // No role restriction - visible to all
      if (!item.roles) return true
      // Role matches
      if (item.roles.includes(userRole)) return true
      // User has explicit module permission for this item
      if (item.permission && userPermissions.includes(item.permission)) return true
      return false
    })
  
  const filteredNavigation = filterByRole(navigation)
  const filteredAdminNavigation = filterByRole(adminNavigation)
  const allNavigation = [...filteredNavigation, ...filteredAdminNavigation]
  
  return (
    <div className="h-full flex">
      {/* Mobile sidebar */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                  <button type="button" className="-m-2.5 p-2.5" onClick={() => setSidebarOpen(false)}>
                    <XMarkIcon className="h-6 w-6 text-white" />
                  </button>
                </div>
                
                <SidebarContent 
                  navigation={allNavigation} 
                  settings={settings}
                  settingsLoading={settingsLoading}
                  onNavigate={() => setSidebarOpen(false)}
                />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
        <SidebarContent navigation={allNavigation} settings={settings} settingsLoading={settingsLoading} />
      </div>

      {/* Main content */}
      <div className="lg:pl-64 flex flex-col flex-1">
        {/* Top bar */}
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-2 sm:gap-x-4 border-b border-gray-200 bg-white px-3 sm:px-4 shadow-sm lg:gap-x-6 lg:px-8">
          <button
            type="button"
            className="p-2.5 text-gray-700 lg:hidden touch-target"
            onClick={() => setSidebarOpen(true)}
          >
            <Bars3Icon className="h-6 w-6" />
          </button>

          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="flex flex-1" />
            
            {/* Language Switcher, Notification Bell & Profile dropdown */}
            <div className="flex items-center gap-x-2 sm:gap-x-4 lg:gap-x-6">
              {/* Language Switcher */}
              <LanguageSwitcher />
              
              {/* Notification Bell */}
              <NotificationBell />
              
              <Menu as="div" className="relative">
                <Menu.Button className="flex items-center p-1.5 hover:bg-gray-50 rounded-lg touch-target">
                  <UserCircleIcon className="h-8 w-8 text-gray-400" />
                  <span className="hidden lg:flex lg:items-center">
                    <span className="ml-4 text-sm font-semibold text-gray-900">
                      {user?.full_name}
                    </span>
                    <ChevronDownIcon className="ml-2 h-5 w-5 text-gray-400" />
                  </span>
                </Menu.Button>
                
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute right-0 z-10 mt-2.5 w-48 origin-top-right rounded-md bg-white py-2 shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm text-gray-500">{user?.email}</p>
                      <p className="text-xs text-gray-400 capitalize">{user?.rol}</p>
                    </div>
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={() => navigate('/profile/password')}
                          className={clsx(
                            active ? 'bg-gray-50' : '',
                            'flex w-full items-center px-4 py-2 text-sm text-gray-700'
                          )}
                        >
                          <KeyIcon className="mr-3 h-5 w-5 text-gray-400" />
                          {t('auth.changePassword')}
                        </button>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={handleLogout}
                          className={clsx(
                            active ? 'bg-gray-50' : '',
                            'flex w-full items-center px-4 py-2 text-sm text-gray-700'
                          )}
                        >
                          <ArrowRightOnRectangleIcon className="mr-3 h-5 w-5 text-gray-400" />
                          {t('auth.logout')}
                        </button>
                      )}
                    </Menu.Item>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          </div>
        </div>

        {/* License expiry warning */}
        <LicenseExpiryBanner />

        {/* Page content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <div className="px-3 py-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Push Notification Prompt - shows after login if not subscribed */}
      <PushNotificationPrompt delay={3000} />
    </div>
  )
}

interface SidebarContentProps {
  navigation: NavItem[]
  settings: AppSettings | null
  settingsLoading?: boolean
  onNavigate?: () => void
}

function SidebarContent({ navigation, settings, settingsLoading, onNavigate }: SidebarContentProps) {
  const { t } = useTranslation()
  
  return (
    <div 
      className="flex grow flex-col gap-y-5 overflow-y-auto px-6 pb-4"
      style={{ backgroundColor: 'var(--color-sidebar)' }}
    >
      <div className="flex h-16 shrink-0 items-center gap-3">
        {settingsLoading ? (
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white opacity-50" />
        ) : (
          <>
            {settings?.logo_url && (
              <img className="h-8 w-auto" src={settings.logo_url} alt={settings.app_name} />
            )}
            <span className="text-xl font-bold text-white">{settings?.app_name || 'TMS'}</span>
          </>
        )}
      </div>
      
      <nav className="flex flex-1 flex-col">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {navigation.map((item) => (
                <li key={item.name}>
                  <NavLink
                    to={item.href}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        'group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 transition-colors',
                        isActive
                          ? 'text-white'
                          : 'hover:text-white'
                      )
                    }
                    style={({ isActive }) => ({
                      backgroundColor: isActive ? 'var(--color-sidebar-hover)' : 'transparent',
                      color: isActive ? 'white' : 'var(--color-sidebar-text)',
                    })}
                  >
                    <item.icon className="h-6 w-6 shrink-0" />
                    {t(item.name)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      </nav>
    </div>
  )
}
