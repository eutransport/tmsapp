import React, { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useServerConfigStore } from '@/stores/serverConfigStore'

// Layouts (always needed — kept eager)
import DashboardLayout from '@/components/layout/DashboardLayout'
import AuthLayout from '@/components/layout/AuthLayout'

// PWA Components
import { PWAUpdatePrompt, PWAInstallPrompt } from '@/components/pwa'

// Font Components
import FontLoader from '@/components/fonts/FontLoader'

// Licensing store (used in guards)
import { useLicenseStore } from '@/stores/licenseStore'

// Small helper for code-split named exports
const lazyNamed = <M extends Record<string, any>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K
) => React.lazy(() => loader().then(m => ({ default: m[name] })))

// -------------------- Lazy-loaded pages --------------------
// Setup / auth / licensing pages
const ServerSetupPage = React.lazy(() => import('@/pages/setup/ServerSetupPage'))
const LoginPage = React.lazy(() => import('@/pages/auth/LoginPage'))
const MfaSetupPage = React.lazy(() => import('@/pages/auth/MfaSetupPage'))
const LicenseActivationPage = React.lazy(() => import('@/pages/licensing/LicenseActivationPage'))

// Dashboard / activity
const DashboardPage = React.lazy(() => import('@/pages/dashboard/DashboardPage'))
const ActivityPage = React.lazy(() => import('@/pages/activity/ActivityPage'))

// Admin / settings
const UsersPage = React.lazy(() => import('@/pages/admin/UsersPage'))
const SettingsPage = React.lazy(() => import('@/pages/settings/SettingsPage'))
const FontManagementPage = React.lazy(() => import('@/pages/settings/FontManagementPage'))

// Master data
const CompaniesPage = React.lazy(() => import('@/pages/companies/CompaniesPage'))
const DriversPage = React.lazy(() => import('@/pages/drivers/DriversPage'))
const FleetPage = React.lazy(() => import('@/pages/fleet/FleetPage'))

// Time tracking
const TimeEntriesPage = React.lazy(() => import('@/pages/time-entries/TimeEntriesPage'))
const MyHoursPage = React.lazy(() => import('@/pages/time-entries/MyHoursPage'))
const SubmittedHoursPage = React.lazy(() => import('@/pages/time-entries/SubmittedHoursPage'))

// Planning
const PlanningPage = React.lazy(() => import('@/pages/planning/PlanningPage'))

// Profile
const PasswordChangePage = React.lazy(() => import('@/pages/profile/PasswordChangePage'))

// Invoicing
const InvoicesPage = React.lazy(() => import('@/pages/invoices/InvoicesPage'))
const InvoiceCreatePage = React.lazy(() => import('@/pages/invoices/InvoiceCreatePage'))
const TemplatesPage = React.lazy(() => import('@/pages/invoices/TemplatesPage'))
const InvoiceEditPage = React.lazy(() => import('@/pages/invoices/InvoiceEditPage'))
const TemplateEditorPage = React.lazy(() => import('@/pages/invoices/TemplateEditorPage'))

// Revenue
const RevenuePage = React.lazy(() => import('@/pages/revenue/RevenuePage'))

// Invoice Import (OCR) — grouped named exports
const InvoiceImportPage = lazyNamed(() => import('@/pages/imports'), 'InvoiceImportPage')
const InvoiceImportDetailPage = lazyNamed(() => import('@/pages/imports'), 'InvoiceImportDetailPage')
const EmailImportPage = lazyNamed(() => import('@/pages/imports'), 'EmailImportPage')
const MailboxConfigPage = lazyNamed(() => import('@/pages/imports'), 'MailboxConfigPage')

// Leave management
const LeaveOverviewPage = React.lazy(() => import('@/pages/leave/LeaveOverviewPage'))
const LeaveRequestPage = React.lazy(() => import('@/pages/leave/LeaveRequestPage'))
const LeaveCalendarPage = React.lazy(() => import('@/pages/leave/LeaveCalendarPage'))
const LeaveSettingsPage = React.lazy(() => import('@/pages/settings/LeaveSettingsPage'))
const LeaveRequestsAdminPage = React.lazy(() => import('@/pages/leave/LeaveRequestsAdminPage'))
const LeaveBalancePage = React.lazy(() => import('@/pages/leave/LeaveBalancePage'))

// Tolregistratie
const TolRegistratiePage = React.lazy(() => import('@/pages/toll/TolRegistratiePage'))
const AdminTolRegistratiePage = React.lazy(() => import('@/pages/toll/AdminTolRegistratiePage'))

// Kilometerheffing
const KilometerheffingPage = React.lazy(() => import('@/pages/kilometerheffing/KilometerheffingPage'))

// Pakmiddelen Teruggavebonnen
const PakmiddelenPage = React.lazy(() => import('@/pages/pakmiddelen/PakmiddelenPage'))

// Tasks
const TasksPage = React.lazy(() => import('@/pages/tasks/TasksPage'))

// Notifications
const NotificationsPage = React.lazy(() => import('@/pages/notifications/NotificationsPage'))

// Documents (PDF Signing) — grouped named exports
const DocumentsPage = lazyNamed(() => import('@/pages/documents'), 'DocumentsPage')
const DocumentUploadPage = lazyNamed(() => import('@/pages/documents'), 'DocumentUploadPage')
const DocumentDetailPage = lazyNamed(() => import('@/pages/documents'), 'DocumentDetailPage')
const DocumentSignPage = lazyNamed(() => import('@/pages/documents'), 'DocumentSignPage')

// Spreadsheets
const SpreadsheetListPage = React.lazy(() => import('@/pages/spreadsheets/SpreadsheetListPage'))
const SpreadsheetEditorPage = React.lazy(() => import('@/pages/spreadsheets/SpreadsheetEditorPage'))
const SpreadsheetTemplateListPage = React.lazy(() => import('@/pages/spreadsheets/SpreadsheetTemplateListPage'))
const SpreadsheetTemplateEditorPage = React.lazy(() => import('@/pages/spreadsheets/SpreadsheetTemplateEditorPage'))

// Uren Import
const UrenImportPage = React.lazy(() => import('@/pages/uren-import/UrenImportPage'))

// Maintenance
const MaintenanceOverviewPage = React.lazy(() => import('@/pages/maintenance/MaintenanceOverviewPage'))
const APKPage = React.lazy(() => import('@/pages/maintenance/APKPage'))
const MaintenanceTasksPage = React.lazy(() => import('@/pages/maintenance/MaintenanceTasksPage'))
const TiresPage = React.lazy(() => import('@/pages/maintenance/TiresPage'))
const MaintenanceSettingsPage = React.lazy(() => import('@/pages/maintenance/MaintenanceSettingsPage'))

// Tachograph
const TachographPage = React.lazy(() => import('@/pages/tachograph/TachographPage'))
const TachographComparisonPage = React.lazy(() => import('@/pages/tachograph/TachographComparisonPage'))

// Reports
const ReportsPage = React.lazy(() => import('@/pages/reports/ReportsPage'))

// Track & Trace
const TrackingPage = React.lazy(() => import('@/pages/tracking/TrackingPage'))

// Shared loading fallback used by every Suspense boundary
const RouteFallback = () => (
  <div className="h-full flex items-center justify-center py-16">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
  </div>
)

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, pendingMfaSetup } = useAuthStore()
  const { isLicensed, isLoading: licenseLoading } = useLicenseStore()
  
  if (isLoading || licenseLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }
  
  // Redirect to license activation if not licensed
  if (!isLicensed) {
    return <Navigate to="/license" replace />
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  // Redirect to MFA setup if required
  if (pendingMfaSetup) {
    return <Navigate to="/setup-mfa" replace />
  }
  
  return <>{children}</>
}

// Server Config wrapper - redirects to dashboard if already configured and logged in
function SetupRoute({ children }: { children: React.ReactNode }) {
  const { isConfigured } = useServerConfigStore()
  const { isAuthenticated } = useAuthStore()
  
  // If already configured and authenticated, redirect to dashboard
  if (isConfigured && isAuthenticated) {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

// Auth Route wrapper - requires server config
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  
  // Redirect to dashboard if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

// Admin Route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  
  if (!user?.rol || user.rol !== 'admin') {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

// Route wrapper that allows admin OR users with a specific module permission
function PermissionRoute({ children, permission }: { children: React.ReactNode; permission: string }) {
  const { user } = useAuthStore()
  
  if (user?.rol === 'admin') return <>{children}</>
  if (user?.module_permissions?.includes(permission)) return <>{children}</>
  
  return <Navigate to="/" replace />
}

function App() {
  const { isAuthenticated } = useAuthStore()
  const { isConfigured, setServerUrl } = useServerConfigStore()
  const { checkLicense } = useLicenseStore()
  
  // Auto-detect server when not configured (incognito / new browser)
  // In production, the API is on the same origin behind nginx
  React.useEffect(() => {
    if (isConfigured) return
    
    const autoDetect = async () => {
      try {
        const response = await fetch('/api/core/settings/', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        })
        if (response.ok) {
          const data = await response.json()
          // Server is reachable on the same origin — auto-configure
          setServerUrl('', data.app_name || 'TMS Server')
        }
      } catch {
        // Server not reachable on same origin — user must configure manually
      }
    }
    
    autoDetect()
  }, [isConfigured, setServerUrl])
  
  // Check license status on app load when server is configured
  React.useEffect(() => {
    if (isConfigured) {
      checkLicense()
    }
  }, [isConfigured, checkLicense])
  
  return (
    <>
      {/* PWA Components */}
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      
      {/* Load custom fonts when authenticated and configured */}
      {isConfigured && isAuthenticated && <FontLoader />}
      
      <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* Server setup route */}
      <Route 
        path="/setup" 
        element={
          <SetupRoute>
            <ServerSetupPage />
          </SetupRoute>
        } 
      />
      
      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route 
          path="/login" 
          element={
            <AuthRoute>
              <LoginPage />
            </AuthRoute>
          } 
        />
      </Route>
      
      {/* MFA Setup route - outside of protected route since it has its own protection */}
      <Route path="/setup-mfa" element={<MfaSetupPage />} />
      
      {/* License activation route */}
      <Route path="/license" element={<LicenseActivationPage />} />
      
      {/* Protected dashboard routes */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/activities" element={<ActivityPage />} />
        
        {/* Admin routes */}
        <Route path="/admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
        <Route path="/settings/fonts" element={<AdminRoute><FontManagementPage /></AdminRoute>} />
        
        {/* Master data */}
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/drivers" element={<DriversPage />} />
        <Route path="/fleet" element={<FleetPage />} />
        
        {/* Maintenance */}
        <Route path="/maintenance" element={<MaintenanceOverviewPage />} />
        <Route path="/maintenance/apk" element={<APKPage />} />
        <Route path="/maintenance/tasks" element={<MaintenanceTasksPage />} />
        <Route path="/maintenance/tires" element={<TiresPage />} />
        <Route path="/maintenance/settings" element={<AdminRoute><MaintenanceSettingsPage /></AdminRoute>} />
        
        {/* Track & Trace */}
        <Route path="/track-trace" element={<AdminRoute><TrackingPage /></AdminRoute>} />

        {/* Tachograph */}
        <Route path="/tachograph" element={<AdminRoute><TachographPage /></AdminRoute>} />
        <Route path="/tachograph/comparison" element={<AdminRoute><TachographComparisonPage /></AdminRoute>} />
        
        {/* Time tracking */}
        <Route path="/time-entries" element={<TimeEntriesPage />} />
        <Route path="/my-hours" element={<MyHoursPage />} />
        <Route path="/submitted-hours" element={<SubmittedHoursPage />} />
        <Route path="/uren-import" element={<AdminRoute><UrenImportPage /></AdminRoute>} />
        
        {/* Planning */}
        <Route path="/planning" element={<PlanningPage />} />
        
        {/* Profile */}
        <Route path="/profile/password" element={<PasswordChangePage />} />

        {/* Notifications (Admin) */}
        <Route path="/notifications" element={<AdminRoute><NotificationsPage /></AdminRoute>} />

        {/* Invoicing */}
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/new" element={<InvoiceCreatePage />} />
        <Route path="/invoices/:id/edit" element={<InvoiceEditPage />} />
        <Route path="/invoices/templates" element={<AdminRoute><TemplatesPage /></AdminRoute>} />
        <Route path="/invoices/templates/new" element={<AdminRoute><TemplateEditorPage /></AdminRoute>} />
        <Route path="/invoices/templates/:id/edit" element={<AdminRoute><TemplateEditorPage /></AdminRoute>} />

        {/* Revenue */}
        <Route path="/revenue" element={<PermissionRoute permission="view_revenue"><RevenuePage /></PermissionRoute>} />

        {/* Invoice Import (OCR) */}
        <Route path="/imports" element={<AdminRoute><InvoiceImportPage /></AdminRoute>} />
        
        {/* Email Invoice Import - must be before /imports/:id */}
        <Route path="/imports/email" element={<AdminRoute><EmailImportPage /></AdminRoute>} />
        <Route path="/imports/email/mailbox/new" element={<AdminRoute><MailboxConfigPage /></AdminRoute>} />
        <Route path="/imports/email/mailbox/:id" element={<AdminRoute><MailboxConfigPage /></AdminRoute>} />
        
        {/* Invoice Import Detail - after more specific routes */}
        <Route path="/imports/:id" element={<AdminRoute><InvoiceImportDetailPage /></AdminRoute>} />

        {/* Leave management */}
        <Route path="/leave" element={<LeaveOverviewPage />} />
        <Route path="/leave/request" element={<LeaveRequestPage />} />
        <Route path="/leave/calendar" element={<LeaveCalendarPage />} />
        <Route path="/leave/admin" element={<PermissionRoute permission="can_manage_leave_for_all"><LeaveRequestsAdminPage /></PermissionRoute>} />
        <Route path="/leave/balances" element={<LeaveBalancePage />} />
        <Route path="/settings/leave" element={<AdminRoute><LeaveSettingsPage /></AdminRoute>} />

        {/* Tolregistratie */}
        <Route path="/toll" element={<TolRegistratiePage />} />
        <Route path="/toll/admin" element={<AdminRoute><AdminTolRegistratiePage /></AdminRoute>} />

        {/* Kilometerheffing */}
        <Route path="/kilometerheffing" element={<KilometerheffingPage />} />

        {/* Pakmiddelen Teruggavebonnen */}
        <Route path="/pakmiddelen" element={<PermissionRoute permission="view_pakmiddelen"><PakmiddelenPage /></PermissionRoute>} />

        {/* Takenlijst */}
        <Route path="/tasks" element={<TasksPage />} />

        {/* Spreadsheets (Ritregistratie) */}
        <Route path="/spreadsheets" element={<AdminRoute><SpreadsheetListPage /></AdminRoute>} />
        <Route path="/spreadsheets/new" element={<AdminRoute><SpreadsheetEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates" element={<AdminRoute><SpreadsheetTemplateListPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates/new" element={<AdminRoute><SpreadsheetTemplateEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates/:id/edit" element={<AdminRoute><SpreadsheetTemplateEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/:id" element={<AdminRoute><SpreadsheetEditorPage /></AdminRoute>} />

        {/* Reports (Rapport Agent) */}
        <Route path="/reports" element={<ReportsPage />} />

        {/* Documents (PDF Signing) */}
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/upload" element={<DocumentUploadPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/documents/:id/sign" element={<DocumentSignPage />} />
      </Route>
      
      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  )
}

export default App
