// User types
export interface User {
  id: string
  email: string
  username: string
  voornaam: string
  achternaam: string
  full_name: string
  telefoon: string
  bedrijf: string
  rol: 'admin' | 'gebruiker' | 'chauffeur'
  module_permissions: string[]
  mfa_enabled: boolean
  mfa_required: boolean
  is_active: boolean
  date_joined: string
  last_login: string | null
}

export interface UserCreate {
  email: string
  username: string
  password: string
  password_confirm: string
  voornaam: string
  achternaam: string
  telefoon?: string
  bedrijf?: string
  rol: 'admin' | 'gebruiker' | 'chauffeur'
  is_active?: boolean
  module_permissions?: string[]
}

// Auth types
export interface LoginCredentials {
  email: string
  password: string
}

export interface LoginResponse {
  access: string
  refresh: string
  user: User
  requires_2fa?: boolean
  requires_2fa_setup?: boolean
  user_id?: string
}

export interface MFAVerifyData {
  user_id: string
  code: string
}

// App Settings
export interface AppSettings {
  app_name: string
  logo_url: string | null
  favicon_url: string | null
  primary_color: string
  login_background_color: string
  company_name: string
}

export interface AppSettingsAdmin extends AppSettings {
  company_address: string
  company_phone: string
  company_email: string
  company_kvk: string
  company_btw: string
  company_iban: string
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password?: string // Write-only
  smtp_use_tls: boolean
  smtp_from_email: string
  oauth_enabled: boolean
  oauth_client_id: string
  oauth_client_secret?: string // Write-only
  oauth_tenant_id: string
  invoice_payment_text: string
  invoice_start_number_verkoop: number
  invoice_start_number_inkoop: number
  invoice_start_number_credit: number
  email_signature: string
  // AI Settings
  ai_provider: 'github' | 'openai' | 'azure' | 'none'
  ai_github_token?: string // Write-only
  ai_openai_api_key?: string // Write-only
  ai_azure_endpoint?: string
  ai_azure_api_key?: string // Write-only
  ai_azure_deployment?: string
  ai_model?: string
  ai_status?: {
    configured: boolean
    provider?: string
    message: string
  }
  // Reminder Settings
  reminder_enabled: boolean
  reminder_time: string
  reminder_frequency: 'daily' | 'weekdays' | 'weekly' | 'custom'
  reminder_weekly_day: number
  reminder_custom_days: number[]
  reminder_weeks_before: number[]
  reminder_email: string
  reminder_signature: string
}

// Company types
export interface Company {
  id: string
  naam: string
  kvk: string
  telefoon: string
  contactpersoon: string
  email: string
  adres: string
  postcode: string
  stad: string
  mailing_contacts: MailingListContact[]
  mailing_contacts_count: number
  created_at: string
  updated_at: string
}

export interface MailingListContact {
  id: string
  bedrijf: string
  naam: string
  email: string
  functie: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// Driver types
export interface Driver {
  id: string
  naam: string
  telefoon: string
  bedrijven: string[]
  bedrijven_namen: string[]
  bedrijf: string | null
  bedrijf_naam: string | null
  gekoppelde_gebruiker: string | null
  gekoppelde_gebruiker_naam: string | null
  voertuig: string | null
  voertuig_ritnummer: string | null
  voertuig_kenteken: string | null
  adr: boolean
  einddatum_bestuurderspas: string | null
  einddatum_code95: string | null
  einddatum_adr: string | null
  einddatum_rijbewijs: string | null
  minimum_uren_per_week: number | null
  actief: boolean
  created_at: string
  updated_at: string
}

// Vehicle types
export interface Vehicle {
  id: string
  kenteken: string
  type_wagen: string
  ritnummer: string
  bedrijf: string
  bedrijf_naam: string
  minimum_weken_per_jaar: number | null
  actief: boolean
  created_at: string
  updated_at: string
}

// Time Entry types
export interface TimeEntry {
  id: string
  user: string
  user_naam: string
  user_bedrijf?: string
  weeknummer: number
  ritnummer: string
  datum: string
  kenteken: string
  km_start: number
  km_eind: number
  totaal_km: number
  aanvang: string
  eind: string
  pauze: string
  totaal_uren: string
  totaal_uren_display: string
  status: 'concept' | 'ingediend'
  created_at: string
  updated_at: string
}

// Planning types
export interface WeekPlanning {
  id: string
  bedrijf: string
  bedrijf_naam: string
  weeknummer: number
  jaar: number
  entries: PlanningEntry[]
  created_at: string
  updated_at: string
}

export interface PlanningEntry {
  id: string
  planning: string
  vehicle: string
  vehicle_kenteken: string
  vehicle_type: string
  vehicle_ritnummer: string
  dag: 'ma' | 'di' | 'wo' | 'do' | 'vr'
  dag_display: string
  chauffeur: string | null
  chauffeur_naam: string | null
  telefoon: string
  adr: boolean
  created_at: string
  updated_at: string
}

// Invoice types

// Template Field Types
export type TemplateFieldType = 'text' | 'image' | 'amount' | 'date' | 'variable'
export type TextAlignment = 'left' | 'center' | 'right'

export interface TemplateFieldStyle {
  alignment: TextAlignment
  bold: boolean
  italic: boolean
  color: string
  fontFamily: string
  fontSize: number
}

export interface TemplateField {
  id: string
  type: TemplateFieldType
  content: string // tekst of variabele naam
  style: TemplateFieldStyle
  imageUrl?: string
  imageWidth?: number // pixels
  imageHeight?: number // pixels
}

// Section with 3 columns (header, subheader, footer)
export interface TemplateSection {
  left: TemplateField | null
  center: TemplateField | null
  right: TemplateField | null
}

// Table column types
export type ColumnType = 'text' | 'aantal' | 'km' | 'uren' | 'prijs' | 'btw' | 'percentage' | 'berekend'

export interface TemplateColumn {
  id: string  // unieke naam voor berekeningen
  naam: string // display naam
  type: ColumnType
  breedte: number // percentage
  // Voor berekende kolommen
  formule?: string // bijv. "kolom_a * kolom_b" of "kolom_c * 0.21"
}

// Standaard tarieven
export interface TemplateDefaults {
  uurtarief: number
  dotPrijs: number
  dotIsPercentage: boolean
  kmTarief: number
}

// Footer totalen configuratie
export interface TemplateTotals {
  showSubtotaal: boolean
  showBtw: boolean
  showTotaal: boolean
  btwPercentage: number
}

// Tabel styling configuratie
export interface TemplateTableStyle {
  headerBackground: string
  headerTextColor: string
  headerFont: string
  evenRowBackground: string
  oddRowBackground: string
  rowTextColor: string
  rowFont: string
}

// Volledige template layout
export interface TemplateLayout {
  header: TemplateSection
  subheader: TemplateSection
  columns: TemplateColumn[]
  footer: TemplateSection
  defaults: TemplateDefaults
  totals: TemplateTotals
  tableStyle?: TemplateTableStyle
}

export interface InvoiceTemplate {
  id: string
  naam: string
  beschrijving: string
  layout: TemplateLayout
  variables: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Invoice {
  id: string
  factuurnummer: string
  type: 'inkoop' | 'verkoop' | 'credit'
  status: 'concept' | 'definitief' | 'verzonden' | 'betaald'
  template: string
  template_naam: string
  bedrijf: string
  bedrijf_naam: string
  factuurdatum: string
  vervaldatum: string
  subtotaal: number
  btw_percentage: number
  btw_bedrag: number
  totaal: number
  opmerkingen: string
  pdf_file: string | null
  bijlage: string | null
  created_by: string
  created_by_naam: string
  sent_at: string | null
  week_number: number | null
  week_year: number | null
  chauffeur: string | null
  chauffeur_naam: string | null
  lines: InvoiceLine[]
  created_at: string
  updated_at: string
}

export interface InvoiceLine {
  id: string
  invoice: string
  omschrijving: string
  aantal: number
  eenheid: string
  prijs_per_eenheid: number
  totaal: number
  time_entry: string | null
  extra_data: Record<string, unknown>
  volgorde: number
  created_at: string
  updated_at: string
}

// Spreadsheet Template types
export type SpreadsheetColumnType = 'text' | 'nummer' | 'datum' | 'tijd' | 'valuta' | 'berekend'

export interface SpreadsheetTemplateKolom {
  id: string              // unieke identifier (bijv. 'ritnr', 'chauffeur', 'totaal_uren')
  naam: string            // display naam (bijv. 'RITNR', 'CHAUFFEUR')
  type: SpreadsheetColumnType
  breedte: number         // kolom breedte in pixels
  formule?: string        // Excel-achtige formule (bijv. '=eind_tijd-begin_tijd-pauze')
  zichtbaar: boolean      // kolom tonen of verbergen
  bewerkbaar: boolean     // of de gebruiker de waarde kan aanpassen
  styling?: {
    achtergrond?: string  // achtergrondkleur (hex)
    tekstKleur?: string   // tekstkleur (hex)
    lettertype?: string   // 'normal' | 'bold' | 'italic'
    uitlijning?: string   // 'left' | 'center' | 'right'
  }
}

export interface SpreadsheetTemplateFooter {
  toon_subtotaal: boolean
  toon_btw: boolean
  toon_totaal: boolean
  btw_percentage: number
  totaal_kolommen: string[]  // welke kolommen een SUM krijgen in de footer
}

export interface SpreadsheetTemplateStyling {
  header_achtergrond: string
  header_tekst_kleur: string
  header_lettertype: string
  rij_even_achtergrond: string
  rij_oneven_achtergrond: string
  rij_tekst_kleur: string
}

export interface SpreadsheetTemplateStandaardTarieven {
  tarief_per_uur: number
  tarief_per_km: number
  tarief_dot: number
}

export interface SpreadsheetTemplate {
  id: string
  naam: string
  beschrijving: string
  kolommen: SpreadsheetTemplateKolom[]
  footer: SpreadsheetTemplateFooter
  standaard_tarieven: SpreadsheetTemplateStandaardTarieven
  styling: SpreadsheetTemplateStyling
  is_active: boolean
  created_at: string
  updated_at: string
}

// Spreadsheet types
export interface SpreadsheetRij {
  ritnr: string
  volgnummer: string
  chauffeur: string
  datum: string
  begin_tijd: number | null
  eind_tijd: number | null
  pauze: number | null
  correctie: number | null
  begin_km: number | null
  eind_km: number | null
  overnachting: number | null
  overige_kosten: number | null
}

export interface Spreadsheet {
  id: string
  naam: string
  bedrijf: string
  bedrijf_naam: string
  week_nummer: number
  jaar: number
  tarief_per_uur: number
  tarief_per_km: number
  tarief_dot: number
  rijen: SpreadsheetRij[]
  notities: string
  totaal_factuur: number
  status: 'concept' | 'ingediend'
  template: string | null
  template_naam: string | null
  created_by: string | null
  created_by_naam: string | null
  created_at: string
  updated_at: string
}

// API Response types
export interface PaginatedResponse<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface ApiError {
  detail?: string
  message?: string
  [key: string]: unknown
}

// =============================================================================
// MAINTENANCE TYPES
// =============================================================================

export type MaintenanceVehicleType = 'all' | 'truck' | 'motorwagen' | 'car' | 'trailer' | 'van'
export type APKStatus = 'scheduled' | 'passed' | 'failed' | 'expired' | 'exempted'
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'deferred'
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent'
export type AlertSeverity = 'info' | 'warning' | 'critical' | 'urgent'
export type DashboardWidgetType =
  | 'apk_countdown' | 'fleet_health' | 'upcoming_tasks' | 'overdue_tasks'
  | 'cost_overview' | 'cost_by_type' | 'cost_by_vehicle' | 'cost_trend'
  | 'tire_status' | 'active_alerts' | 'recent_tasks' | 'maintenance_calendar'
  | 'vehicle_status' | 'obd_live' | 'obd_alerts' | 'custom_query' | 'statistics'
export type DashboardWidgetSize = 'small' | 'medium' | 'large' | 'full'

export interface MaintenanceCategory {
  id: string
  name: string
  name_en: string
  description: string
  icon: string
  color: string
  sort_order: number
  is_active: boolean
  type_count: number
  created_at: string
  updated_at: string
}

export interface MaintenanceType {
  id: string
  category: string
  category_name: string
  name: string
  name_en: string
  description: string
  default_interval_km: number | null
  default_interval_days: number | null
  vehicle_type: MaintenanceVehicleType
  is_mandatory: boolean
  estimated_cost: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface VehicleMaintenanceProfile {
  id: string
  vehicle: string
  vehicle_kenteken: string
  maintenance_type: string
  maintenance_type_name: string
  category_name: string
  custom_interval_km: number | null
  custom_interval_days: number | null
  last_performed_date: string | null
  last_performed_km: number | null
  next_due_date: string | null
  next_due_km: number | null
  is_active: boolean
  notes: string
  days_until_due: number | null
  is_overdue: boolean
  status: string
  interval_km: number | null
  interval_days: number | null
  created_at: string
  updated_at: string
}

export interface APKRecord {
  id: string
  vehicle: string
  vehicle_kenteken: string
  vehicle_type: string
  inspection_date: string
  expiry_date: string
  status: APKStatus
  passed: boolean
  inspection_station: string
  inspector_name: string
  mileage_at_inspection: number | null
  cost: string | null
  remarks: string
  defects: string
  certificate_file: string | null
  is_current: boolean
  days_until_expiry: number
  is_expired: boolean
  countdown_status: string
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export interface APKCountdown {
  id: string
  vehicle: string
  vehicle_kenteken: string
  vehicle_type: string
  bedrijf_naam: string | null
  expiry_date: string
  days_until_expiry: number
  countdown_status: string
  status: APKStatus
}

export interface MaintenanceTask {
  id: string
  vehicle: string
  vehicle_kenteken: string
  vehicle_type: string
  bedrijf_naam: string | null
  maintenance_type: string
  maintenance_type_name: string
  category_name: string
  category_color: string
  status: MaintenanceStatus
  priority: MaintenancePriority
  title: string
  description: string
  scheduled_date: string | null
  completed_date: string | null
  mileage_at_service: number | null
  service_provider: string
  service_provider_contact: string
  labor_cost: string
  parts_cost: string
  total_cost: string
  invoice_number: string
  invoice_file: string | null
  work_performed: string
  parts_replaced: string
  technician_notes: string
  assigned_to: string | null
  assigned_to_name: string | null
  created_by: string | null
  created_by_name: string | null
  completed_by: string | null
  completed_by_name: string | null
  is_overdue: boolean
  parts: MaintenancePart[]
  created_at: string
  updated_at: string
}

export interface MaintenanceTaskList {
  id: string
  vehicle: string
  vehicle_kenteken: string
  maintenance_type_name: string
  category_name: string
  category_color: string
  status: MaintenanceStatus
  priority: MaintenancePriority
  title: string
  scheduled_date: string | null
  completed_date: string | null
  total_cost: string
  is_overdue: boolean
  created_at: string
}

export interface MaintenancePart {
  id: string
  task: string
  name: string
  part_number: string
  quantity: number
  unit_price: string
  total_price: string
  supplier: string
  warranty_months: number | null
  created_at: string
}

export interface TireRecord {
  id: string
  vehicle: string
  vehicle_kenteken: string
  position: string
  position_display: string
  brand: string
  model: string
  size: string
  tire_type: string
  tire_type_display: string
  dot_code: string
  serial_number: string
  tread_depth_mm: string | null
  minimum_tread_depth: string
  mounted_date: string | null
  mounted_km: number | null
  expected_replacement_date: string | null
  days_until_replacement: number | null
  removed_date: string | null
  removed_km: number | null
  removal_reason: string
  km_driven: number | null
  purchase_cost: string | null
  is_current: boolean
  notes: string
  created_at: string
  updated_at: string
}

export interface MaintenanceThreshold {
  id: string
  name: string
  description: string
  maintenance_type: string | null
  maintenance_type_name: string | null
  is_apk_threshold: boolean
  warning_days: number
  critical_days: number
  urgent_days: number
  warning_km: number | null
  critical_km: number | null
  send_email: boolean
  send_push: boolean
  send_to_admin: boolean
  extra_email_recipients: string
  is_active: boolean
  active_alerts_count: number
  created_at: string
  updated_at: string
}

export interface MaintenanceAlert {
  id: string
  vehicle: string
  vehicle_kenteken: string
  threshold: string | null
  threshold_name: string | null
  maintenance_task: string | null
  apk_record: string | null
  severity: AlertSeverity
  title: string
  message: string
  is_read: boolean
  is_dismissed: boolean
  is_resolved: boolean
  email_sent: boolean
  email_sent_at: string | null
  push_sent: boolean
  resolved_at: string | null
  resolved_by: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
}

export interface MaintenanceDashboard {
  id: string
  user: string
  user_name: string
  name: string
  description: string
  is_default: boolean
  is_shared: boolean
  layout: Record<string, unknown>
  widgets: DashboardWidget[]
  created_at: string
  updated_at: string
}

export interface DashboardWidget {
  id: string
  dashboard: string
  widget_type: DashboardWidgetType
  widget_type_display: string
  title: string
  size: DashboardWidgetSize
  size_display: string
  position_x: number
  position_y: number
  sort_order: number
  config: Record<string, unknown>
  custom_query: string | null
  custom_query_name: string | null
  is_visible: boolean
  refresh_interval_seconds: number
  created_at: string
  updated_at: string
}

export interface MaintenanceQuery {
  id: string
  name: string
  description: string
  query_definition: Record<string, unknown>
  result_type: string
  created_by: string | null
  created_by_name: string | null
  is_sample: boolean
  is_public: boolean
  created_at: string
  updated_at: string
}

export interface MaintenanceStats {
  total_tasks: number
  completed_tasks: number
  scheduled_tasks: number
  overdue_tasks: number
  total_cost_ytd: string
  total_cost_month: string
  avg_cost_per_vehicle: string
  most_expensive_vehicle: {
    vehicle_id: string
    vehicle_kenteken: string
    total_cost: string
  } | null
  cost_trend: Array<{
    month: string
    total: string
  }>
}

export interface FleetHealth {
  total_vehicles: number
  vehicles_ok: number
  vehicles_warning: number
  vehicles_critical: number
  vehicles_overdue: number
  apk_expired: number
  upcoming_tasks_7days: number
  upcoming_tasks_30days: number
  total_active_alerts: number
}

export interface VehicleCostSummary {
  vehicle_id: string
  vehicle_kenteken: string
  vehicle_type: string
  total_cost: string
  labor_cost: string
  parts_cost: string
  task_count: number
  apk_cost: string
  tire_cost: string
}

// License types
export interface LicenseInfo {
  id: string
  customer_name: string
  status: 'pending' | 'active' | 'expired' | 'revoked'
  issued_at: string
  expires_at: string
  max_users: number
  features: string[]
  activated_at: string | null
  days_remaining: number
  is_valid: boolean
  is_expiring_soon: boolean
}

export interface LicenseStatusResponse {
  licensed: boolean
  message?: string
  license?: LicenseInfo
}

export interface LicenseActivateResponse {
  success: boolean
  error?: string
  message: string
  license?: {
    id: string
    customer: string
    expires_at: string
    max_users: number
    features: string[]
    days_remaining: number
  }
}
