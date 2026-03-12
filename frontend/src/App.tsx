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
  
  if (isLoading || licenseLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }
  
  // Redirect to server setup if not configured
  if (!isConfigured) {
    return <Navigate to="/setup" replace />
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

function App() {
  const { isAuthenticated } = useAuthStore()
  const { isConfigured } = useServerConfigStore()
  const { checkLicense } = useLicenseStore()
  
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
        <Route path="/revenue" element={<AdminRoute><RevenuePage /></AdminRoute>} />

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
        <Route path="/leave/admin" element={<AdminRoute><LeaveRequestsAdminPage /></AdminRoute>} />
        <Route path="/settings/leave" element={<AdminRoute><LeaveSettingsPage /></AdminRoute>} />

        {/* Spreadsheets (Ritregistratie) */}
        <Route path="/spreadsheets" element={<AdminRoute><SpreadsheetListPage /></AdminRoute>} />
        <Route path="/spreadsheets/new" element={<AdminRoute><SpreadsheetEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates" element={<AdminRoute><SpreadsheetTemplateListPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates/new" element={<AdminRoute><SpreadsheetTemplateEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/templates/:id/edit" element={<AdminRoute><SpreadsheetTemplateEditorPage /></AdminRoute>} />
        <Route path="/spreadsheets/:id" element={<AdminRoute><SpreadsheetEditorPage /></AdminRoute>} />

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
