import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useServerConfigStore } from '@/stores/serverConfigStore'

// Layouts
import DashboardLayout from '@/components/layout/DashboardLayout'
import AuthLayout from '@/components/layout/AuthLayout'

// PWA Components
import { PWAUpdatePrompt, PWAInstallPrompt } from '@/components/pwa'

// Font Components
import FontLoader from '@/components/fonts/FontLoader'

// Setup pages
import ServerSetupPage from '@/pages/setup/ServerSetupPage'

// Auth pages
import LoginPage from '@/pages/auth/LoginPage'
import MfaSetupPage from '@/pages/auth/MfaSetupPage'

// Dashboard pages
import DashboardPage from '@/pages/dashboard/DashboardPage'

// Activity page
import ActivityPage from '@/pages/activity/ActivityPage'

// Admin pages
import UsersPage from '@/pages/admin/UsersPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import FontManagementPage from '@/pages/settings/FontManagementPage'

// Master data pages
import CompaniesPage from '@/pages/companies/CompaniesPage'
import DriversPage from '@/pages/drivers/DriversPage'
import FleetPage from '@/pages/fleet/FleetPage'

// Time tracking
import TimeEntriesPage from '@/pages/time-entries/TimeEntriesPage'
import MyHoursPage from '@/pages/time-entries/MyHoursPage'
import SubmittedHoursPage from '@/pages/time-entries/SubmittedHoursPage'

// Planning
import PlanningPage from '@/pages/planning/PlanningPage'

// Track & Trace
import TrackingPage from '@/pages/tracking/TrackingPage'

// Profile
import PasswordChangePage from '@/pages/profile/PasswordChangePage'

// Invoicing
import InvoicesPage from '@/pages/invoices/InvoicesPage'
import InvoiceCreatePage from '@/pages/invoices/InvoiceCreatePage'
import TemplatesPage from '@/pages/invoices/TemplatesPage'
import InvoiceEditPage from '@/pages/invoices/InvoiceEditPage'
import TemplateEditorPage from '@/pages/invoices/TemplateEditorPage'

// Revenue
import RevenuePage from '@/pages/revenue/RevenuePage'

// Banking
import BankingPage from '@/pages/banking/BankingPage'

// Invoice Import (OCR)
import { InvoiceImportPage, InvoiceImportDetailPage, EmailImportPage, MailboxConfigPage } from '@/pages/imports'

// Leave management
import LeaveOverviewPage from '@/pages/leave/LeaveOverviewPage'
import LeaveRequestPage from '@/pages/leave/LeaveRequestPage'
import LeaveCalendarPage from '@/pages/leave/LeaveCalendarPage'
import LeaveSettingsPage from '@/pages/settings/LeaveSettingsPage'
import LeaveRequestsAdminPage from '@/pages/leave/LeaveRequestsAdminPage'

// Notifications
import NotificationsPage from '@/pages/notifications/NotificationsPage'

// Documents (PDF Signing)
import {
  DocumentsPage,
  DocumentUploadPage,
  DocumentDetailPage,
  DocumentSignPage,
} from '@/pages/documents'

// Spreadsheets (Ritregistratie)
import SpreadsheetListPage from '@/pages/spreadsheets/SpreadsheetListPage'
import SpreadsheetEditorPage from '@/pages/spreadsheets/SpreadsheetEditorPage'
import SpreadsheetTemplateListPage from '@/pages/spreadsheets/SpreadsheetTemplateListPage'
import SpreadsheetTemplateEditorPage from '@/pages/spreadsheets/SpreadsheetTemplateEditorPage'

// Uren Import
import UrenImportPage from '@/pages/uren-import/UrenImportPage'

// Maintenance
import MaintenanceOverviewPage from '@/pages/maintenance/MaintenanceOverviewPage'
import APKPage from '@/pages/maintenance/APKPage'
import MaintenanceTasksPage from '@/pages/maintenance/MaintenanceTasksPage'
import TiresPage from '@/pages/maintenance/TiresPage'
import MaintenanceSettingsPage from '@/pages/maintenance/MaintenanceSettingsPage'

// Licensing
import LicenseActivationPage from '@/pages/licensing/LicenseActivationPage'
import { useLicenseStore } from '@/stores/licenseStore'

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, pendingMfaSetup } = useAuthStore()
  const { isConfigured } = useServerConfigStore()
  const { isLicensed, isLoading: licenseLoading } = useLicenseStore()
  
  // Check server config FIRST — if not configured, redirect immediately
  // (license check never runs when !isConfigured, so licenseLoading stays true)
  if (!isConfigured) {
    return <Navigate to="/setup" replace />
  }
  
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
  const { isConfigured } = useServerConfigStore()
  const { isAuthenticated } = useAuthStore()
  
  // Redirect to server setup if not configured
  if (!isConfigured) {
    return <Navigate to="/setup" replace />
  }
  
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

// Route accessible to admins OR users with a specific module permission
function PermissionRoute({ 
  children, 
  permission,
  redirectTo = '/time-entries',
}: { 
  children: React.ReactNode
  permission: string
  redirectTo?: string
}) {
  const { user } = useAuthStore()
  
  if (!user) return <Navigate to="/" replace />
  if (user.rol === 'admin') return <>{children}</>
  if ((user.module_permissions || []).includes(permission)) return <>{children}</>
  
  return <Navigate to={redirectTo} replace />
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
        <Route path="/" element={<PermissionRoute permission="view_dashboard"><DashboardPage /></PermissionRoute>} />
        <Route path="/activities" element={<ActivityPage />} />
        
        {/* Admin routes */}
        <Route path="/admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
        <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
        <Route path="/settings/fonts" element={<AdminRoute><FontManagementPage /></AdminRoute>} />
        
        {/* Master data */}
        <Route path="/companies" element={<PermissionRoute permission="view_companies"><CompaniesPage /></PermissionRoute>} />
        <Route path="/drivers" element={<PermissionRoute permission="view_drivers"><DriversPage /></PermissionRoute>} />
        <Route path="/fleet" element={<PermissionRoute permission="view_fleet"><FleetPage /></PermissionRoute>} />
        
        {/* Maintenance */}
        <Route path="/maintenance" element={<PermissionRoute permission="view_maintenance"><MaintenanceOverviewPage /></PermissionRoute>} />
        <Route path="/maintenance/apk" element={<PermissionRoute permission="view_maintenance"><APKPage /></PermissionRoute>} />
        <Route path="/maintenance/tasks" element={<PermissionRoute permission="view_maintenance"><MaintenanceTasksPage /></PermissionRoute>} />
        <Route path="/maintenance/tires" element={<PermissionRoute permission="view_maintenance"><TiresPage /></PermissionRoute>} />
        <Route path="/maintenance/settings" element={<AdminRoute><MaintenanceSettingsPage /></AdminRoute>} />
        
        {/* Time tracking */}
        <Route path="/time-entries" element={<TimeEntriesPage />} />
        <Route path="/my-hours" element={<MyHoursPage />} />
        <Route path="/submitted-hours" element={<PermissionRoute permission="view_submitted_hours"><SubmittedHoursPage /></PermissionRoute>} />
        <Route path="/uren-import" element={<PermissionRoute permission="view_uren_import"><UrenImportPage /></PermissionRoute>} />
        
        {/* Planning */}
        <Route path="/planning" element={<PlanningPage />} />

        {/* Track & Trace */}
        <Route path="/tracking" element={<TrackingPage />} />
        
        {/* Profile */}
        <Route path="/profile/password" element={<PasswordChangePage />} />

        {/* Notifications (Admin) */}
        <Route path="/notifications" element={<PermissionRoute permission="view_notifications"><NotificationsPage /></PermissionRoute>} />

        {/* Invoicing */}
        <Route path="/invoices" element={<PermissionRoute permission="view_invoices"><InvoicesPage /></PermissionRoute>} />
        <Route path="/invoices/new" element={<PermissionRoute permission="view_invoices"><InvoiceCreatePage /></PermissionRoute>} />
        <Route path="/invoices/:id/edit" element={<PermissionRoute permission="view_invoices"><InvoiceEditPage /></PermissionRoute>} />
        <Route path="/invoices/templates" element={<PermissionRoute permission="view_invoice_templates"><TemplatesPage /></PermissionRoute>} />
        <Route path="/invoices/templates/new" element={<PermissionRoute permission="view_invoice_templates"><TemplateEditorPage /></PermissionRoute>} />
        <Route path="/invoices/templates/:id/edit" element={<PermissionRoute permission="view_invoice_templates"><TemplateEditorPage /></PermissionRoute>} />

        {/* Revenue */}
        <Route path="/revenue" element={<PermissionRoute permission="view_revenue"><RevenuePage /></PermissionRoute>} />

        {/* Banking */}
        <Route path="/banking" element={<PermissionRoute permission="view_banking"><BankingPage /></PermissionRoute>} />

        {/* Invoice Import (OCR) */}
        <Route path="/imports" element={<PermissionRoute permission="view_invoice_import"><InvoiceImportPage /></PermissionRoute>} />
        
        {/* Email Invoice Import - must be before /imports/:id */}
        <Route path="/imports/email" element={<PermissionRoute permission="view_invoice_import"><EmailImportPage /></PermissionRoute>} />
        <Route path="/imports/email/mailbox/new" element={<PermissionRoute permission="view_invoice_import"><MailboxConfigPage /></PermissionRoute>} />
        <Route path="/imports/email/mailbox/:id" element={<PermissionRoute permission="view_invoice_import"><MailboxConfigPage /></PermissionRoute>} />
        
        {/* Invoice Import Detail - after more specific routes */}
        <Route path="/imports/:id" element={<PermissionRoute permission="view_invoice_import"><InvoiceImportDetailPage /></PermissionRoute>} />

        {/* Leave management */}
        <Route path="/leave" element={<LeaveOverviewPage />} />
        <Route path="/leave/request" element={<LeaveRequestPage />} />
        <Route path="/leave/calendar" element={<LeaveCalendarPage />} />
        <Route path="/leave/admin" element={<PermissionRoute permission="can_manage_leave_for_all"><LeaveRequestsAdminPage /></PermissionRoute>} />
        <Route path="/settings/leave" element={<AdminRoute><LeaveSettingsPage /></AdminRoute>} />

        {/* Spreadsheets (Ritregistratie) */}
        <Route path="/spreadsheets" element={<PermissionRoute permission="view_spreadsheets"><SpreadsheetListPage /></PermissionRoute>} />
        <Route path="/spreadsheets/new" element={<PermissionRoute permission="view_spreadsheets"><SpreadsheetEditorPage /></PermissionRoute>} />
        <Route path="/spreadsheets/templates" element={<PermissionRoute permission="view_spreadsheet_templates"><SpreadsheetTemplateListPage /></PermissionRoute>} />
        <Route path="/spreadsheets/templates/new" element={<PermissionRoute permission="view_spreadsheet_templates"><SpreadsheetTemplateEditorPage /></PermissionRoute>} />
        <Route path="/spreadsheets/templates/:id/edit" element={<PermissionRoute permission="view_spreadsheet_templates"><SpreadsheetTemplateEditorPage /></PermissionRoute>} />
        <Route path="/spreadsheets/:id" element={<PermissionRoute permission="view_spreadsheets"><SpreadsheetEditorPage /></PermissionRoute>} />

        {/* Documents (PDF Signing) */}
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/upload" element={<DocumentUploadPage />} />
        <Route path="/documents/:id" element={<DocumentDetailPage />} />
        <Route path="/documents/:id/sign" element={<DocumentSignPage />} />
      </Route>
      
      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

export default App
