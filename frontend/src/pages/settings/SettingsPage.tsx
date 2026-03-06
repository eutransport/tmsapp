/**
 * Settings Page
 * Admin interface for managing application settings:
 * - Branding (app name, logo, favicon, colors)
 * - Theme selection
 * - Company info (for invoices)
 * - Email settings (SMTP/OAuth)
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Cog6ToothIcon,
  PhotoIcon,
  BuildingOfficeIcon,
  EnvelopeIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  EyeIcon,
  EyeSlashIcon,
  DocumentTextIcon,
  TrashIcon,
  SwatchIcon,
  ServerIcon,
  LanguageIcon,
  SparklesIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import { settingsApi } from '@/api/settings'
import { useAppStore } from '@/stores/appStore'
import { useServerConfigStore } from '@/stores/serverConfigStore'
import ThemeSelector from '@/components/settings/ThemeSelector'
import type { AppSettingsAdmin } from '@/types'
import { CalendarDaysIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import LicenseStatusCard from '@/components/licensing/LicenseStatusCard'
import FontManagementPage from '@/pages/settings/FontManagementPage'
import LeaveSettingsPage from '@/pages/settings/LeaveSettingsPage'
import ServerMonitoringPanel from '@/components/ServerMonitoringPanel'

export default function SettingsPage() {
  const { t } = useTranslation()
  const { fetchSettings } = useAppStore()
  const serverConfig = useServerConfigStore()

  // Tab configuration - moved inside component for translations
  const tabs = [
    { id: 'branding', name: t('settings.branding', 'Branding'), icon: PhotoIcon },
    { id: 'theme', name: t('settings.theme', 'Thema'), icon: SwatchIcon },
    { id: 'fonts', name: t('settings.fonts', 'Fonts'), icon: LanguageIcon, link: '/settings/fonts' },
    { id: 'company', name: t('settings.companyInfo', 'Bedrijfsgegevens'), icon: BuildingOfficeIcon },
    { id: 'invoice', name: t('settings.invoiceSettings', 'Factuur'), icon: DocumentTextIcon },
    { id: 'email', name: t('settings.emailSettings', 'E-mail'), icon: EnvelopeIcon },
    { id: 'ai', name: t('settings.aiExtraction', 'AI Extractie'), icon: SparklesIcon },
    { id: 'server', name: t('settings.server', 'Server'), icon: ServerIcon },
    { id: 'leave', name: t('settings.leaveSettings', 'Verlof'), icon: CalendarDaysIcon, link: '/settings/leave' },
    { id: 'license', name: t('settings.license', 'Licentie'), icon: ShieldCheckIcon },
  ]
  
  // State
  const [activeTab, setActiveTab] = useState('branding')
  const [settings, setSettings] = useState<AppSettingsAdmin | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Form state
  const [formData, setFormData] = useState<Partial<AppSettingsAdmin>>({})
  const [hasChanges, setHasChanges] = useState(false)
  
  // File refs
  const logoInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)
  
  // Password visibility
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)
  const [showOAuthSecret, setShowOAuthSecret] = useState(false)
  
  // Email test
  const [testEmail, setTestEmail] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const data = await settingsApi.getAdmin()
      setSettings(data)
      setFormData({
        app_name: data.app_name,
        primary_color: data.primary_color,
        company_name: data.company_name,
        company_address: data.company_address,
        company_phone: data.company_phone,
        company_email: data.company_email,
        company_kvk: data.company_kvk,
        company_btw: data.company_btw,
        company_iban: data.company_iban,
        smtp_host: data.smtp_host,
        smtp_port: data.smtp_port,
        smtp_username: data.smtp_username,
        smtp_use_tls: data.smtp_use_tls,
        smtp_from_email: data.smtp_from_email,
        oauth_enabled: data.oauth_enabled,
        oauth_client_id: data.oauth_client_id,
        oauth_tenant_id: data.oauth_tenant_id,
        invoice_payment_text: data.invoice_payment_text,
        invoice_start_number_verkoop: data.invoice_start_number_verkoop || 1,
        invoice_start_number_inkoop: data.invoice_start_number_inkoop || 1,
        invoice_start_number_credit: data.invoice_start_number_credit || 1,
        email_signature: data.email_signature,
        // AI settings
        ai_provider: data.ai_provider || 'none',
        ai_azure_endpoint: data.ai_azure_endpoint,
        ai_azure_deployment: data.ai_azure_deployment,
        ai_model: data.ai_model || 'gpt-4o-mini',
      })
    } catch (err: any) {
      setError(t('errors.loadFailed'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field: keyof AppSettingsAdmin, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      
      const updated = await settingsApi.update(formData)
      setSettings(updated)
      setHasChanges(false)
      setSuccess(t('settings.saved'))
      
      // Refresh global settings
      fetchSettings()
      
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    try {
      setSaving(true)
      const updated = await settingsApi.uploadLogo(file)
      setSettings(updated)
      setSuccess(t('common.success'))
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    try {
      setSaving(true)
      const updated = await settingsApi.uploadFavicon(file)
      setSettings(updated)
      setSuccess(t('common.success'))
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLogo = async () => {
    if (!confirm(t('confirm.delete'))) return
    
    try {
      setSaving(true)
      const updated = await settingsApi.deleteLogo()
      setSettings(updated)
      setSuccess(t('common.deleted'))
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(t('errors.deleteFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteFavicon = async () => {
    if (!confirm(t('confirm.delete'))) return
    
    try {
      setSaving(true)
      const updated = await settingsApi.deleteFavicon()
      setSettings(updated)
      setSuccess(t('common.deleted'))
      fetchSettings()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(t('errors.deleteFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmail) {
      setError(t('validation.email'))
      return
    }
    
    try {
      setTestingEmail(true)
      setError(null)
      
      // First save any pending email settings
      if (hasChanges) {
        await settingsApi.update(formData)
      }
      
      const result = await settingsApi.testEmail(testEmail)
      setSuccess(result.message || t('common.sent'))
      setTimeout(() => setSuccess(null), 5000)
    } catch (err: any) {
      setError(err.response?.data?.error || t('errors.saveFailed'))
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    )
  }

  const renderTabContent = () => (
    <>
          {/* Branding Tab */}
          {activeTab === 'branding' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.appearance')}</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.appearance')}
                </p>
              </div>

              {/* App Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.appName')}
                </label>
                <input
                  type="text"
                  value={formData.app_name || ''}
                  onChange={(e) => handleInputChange('app_name', e.target.value)}
                  className="input-field max-w-md"
                  placeholder="TMS"
                />
              </div>

              {/* Primary Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.primaryColor')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={formData.primary_color || '#3B82F6'}
                    onChange={(e) => handleInputChange('primary_color', e.target.value)}
                    className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.primary_color || '#3B82F6'}
                    onChange={(e) => handleInputChange('primary_color', e.target.value)}
                    className="input-field w-32"
                    placeholder="#3B82F6"
                  />
                </div>
              </div>

              {/* Login Background Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.loginBackgroundColor')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={formData.login_background_color || '#F9FAFB'}
                    onChange={(e) => handleInputChange('login_background_color', e.target.value)}
                    className="h-10 w-20 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.login_background_color || '#F9FAFB'}
                    onChange={(e) => handleInputChange('login_background_color', e.target.value)}
                    className="input-field w-32"
                    placeholder="#F9FAFB"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {t('settings.loginBackgroundColorHint')}
                </p>
              </div>

              {/* Logo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.logo')}
                </label>
                <div className="flex items-start gap-4">
                  {settings?.logo_url ? (
                    <img
                      src={settings.logo_url}
                      alt="Logo"
                      className="h-16 w-auto object-contain bg-gray-100 rounded p-2"
                    />
                  ) : (
                    <div className="h-16 w-32 bg-gray-100 rounded flex items-center justify-center">
                      <PhotoIcon className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => logoInputRef.current?.click()}
                        disabled={saving}
                        className="btn-secondary text-sm"
                      >
                        {t('settings.uploadLogo')}
                      </button>
                      {settings?.logo_url && (
                        <button
                          onClick={handleDeleteLogo}
                          disabled={saving}
                          className="btn-secondary text-sm text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      PNG, JPG of SVG. Max 2MB.
                    </p>
                  </div>
                </div>
              </div>

              {/* Favicon */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.favicon')}
                </label>
                <div className="flex items-start gap-4">
                  {settings?.favicon_url ? (
                    <img
                      src={settings.favicon_url}
                      alt="Favicon"
                      className="h-10 w-10 object-contain bg-gray-100 rounded p-1"
                    />
                  ) : (
                    <div className="h-10 w-10 bg-gray-100 rounded flex items-center justify-center">
                      <PhotoIcon className="h-5 w-5 text-gray-400" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input
                      ref={faviconInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFaviconUpload}
                      className="hidden"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => faviconInputRef.current?.click()}
                        disabled={saving}
                        className="btn-secondary text-sm"
                      >
                        {t('settings.uploadFavicon')}
                      </button>
                      {settings?.favicon_url && (
                        <button
                          onClick={handleDeleteFavicon}
                          disabled={saving}
                          className="btn-secondary text-sm text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      PNG of ICO. 32x32 of 64x64 pixels.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Theme Tab */}
          {activeTab === 'theme' && (
            <ThemeSelector />
          )}

          {/* Company Tab */}
          {activeTab === 'company' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.companyInfo')}</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.companyInfo')}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('companies.companyName')}
                  </label>
                  <input
                    type="text"
                    value={formData.company_name || ''}
                    onChange={(e) => handleInputChange('company_name', e.target.value)}
                    className="input-field"
                    placeholder="Uw Bedrijf B.V."
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('common.phone')}
                  </label>
                  <input
                    type="tel"
                    value={formData.company_phone || ''}
                    onChange={(e) => handleInputChange('company_phone', e.target.value)}
                    className="input-field"
                    placeholder="+31 6 12345678"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('common.email')}
                  </label>
                  <input
                    type="email"
                    value={formData.company_email || ''}
                    onChange={(e) => handleInputChange('company_email', e.target.value)}
                    className="input-field"
                    placeholder="info@uwbedrijf.nl"
                  />
                </div>

                {/* KvK */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('companies.kvkNumber')}
                  </label>
                  <input
                    type="text"
                    value={formData.company_kvk || ''}
                    onChange={(e) => handleInputChange('company_kvk', e.target.value)}
                    className="input-field"
                    placeholder="12345678"
                  />
                </div>

                {/* BTW */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('companies.vatNumber')}
                  </label>
                  <input
                    type="text"
                    value={formData.company_btw || ''}
                    onChange={(e) => handleInputChange('company_btw', e.target.value)}
                    className="input-field"
                    placeholder="NL123456789B01"
                  />
                </div>

                {/* IBAN */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    IBAN
                  </label>
                  <input
                    type="text"
                    value={formData.company_iban || ''}
                    onChange={(e) => handleInputChange('company_iban', e.target.value)}
                    className="input-field"
                    placeholder="NL00BANK0123456789"
                  />
                </div>
              </div>

              {/* Address (full width) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('common.address')}
                </label>
                <textarea
                  value={formData.company_address || ''}
                  onChange={(e) => handleInputChange('company_address', e.target.value)}
                  rows={3}
                  className="input-field"
                  placeholder="Straatnaam 123&#10;1234 AB Plaats"
                />
              </div>
            </div>
          )}

          {/* Invoice Tab */}
          {activeTab === 'invoice' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.invoiceSettings')}</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.invoiceSettings')}
                </p>
              </div>

              {/* Payment Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.paymentText')}
                </label>
                <textarea
                  value={formData.invoice_payment_text || ''}
                  onChange={(e) => handleInputChange('invoice_payment_text', e.target.value)}
                  rows={4}
                  className="input-field"
                  placeholder="Wij verzoeken u vriendelijk het totaalbedrag vóór de vervaldatum over te maken op bovenstaand IBAN onder vermelding van het factuurnummer."
                />
                <p className="text-xs text-gray-500 mt-2">
                  {t('settings.availableVariables')}: <code className="bg-gray-100 px-1 rounded">{'{bedrag}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{vervaldatum}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{factuurnummer}'}</code>
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('settings.example')}: "Wij verzoeken u vriendelijk het totaalbedrag van {'{bedrag}'} vóór {'{vervaldatum}'} over te maken onder vermelding van {'{factuurnummer}'}."
                </p>
              </div>

              {/* Invoice Number Start Settings */}
              <div className="border-t pt-6">
                <h3 className="text-md font-semibold text-gray-900 mb-4">{t('settings.invoiceNumberSettings')}</h3>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.invoiceNumberDescription')}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Verkoop Start Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.startNumberSales')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formData.invoice_start_number_verkoop || 1}
                      onChange={(e) => handleInputChange('invoice_start_number_verkoop', parseInt(e.target.value) || 1)}
                      className="input-field"
                      placeholder="1"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('settings.exampleFormat')}: F-2026-{String(formData.invoice_start_number_verkoop || 1).padStart(4, '0')}
                    </p>
                  </div>

                  {/* Inkoop Start Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.startNumberPurchase')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formData.invoice_start_number_inkoop || 1}
                      onChange={(e) => handleInputChange('invoice_start_number_inkoop', parseInt(e.target.value) || 1)}
                      className="input-field"
                      placeholder="1"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('settings.exampleFormat')}: I-2026-{String(formData.invoice_start_number_inkoop || 1).padStart(4, '0')}
                    </p>
                  </div>

                  {/* Credit Start Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.startNumberCredit')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={formData.invoice_start_number_credit || 1}
                      onChange={(e) => handleInputChange('invoice_start_number_credit', parseInt(e.target.value) || 1)}
                      className="input-field"
                      placeholder="1"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('settings.exampleFormat')}: C-2026-{String(formData.invoice_start_number_credit || 1).padStart(4, '0')}
                    </p>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>{t('common.warning')}:</strong> {t('settings.invoiceNumberWarning')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Email Tab */}
          {activeTab === 'email' && (
            <div className="space-y-8">
              {/* SMTP Settings */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.emailSettings')}</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.emailSettings')}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* SMTP Host */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      SMTP Host
                    </label>
                    <input
                      type="text"
                      value={formData.smtp_host || ''}
                      onChange={(e) => handleInputChange('smtp_host', e.target.value)}
                      className="input-field"
                      placeholder="smtp.example.com"
                    />
                  </div>

                  {/* SMTP Port */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.smtpPort')}
                    </label>
                    <input
                      type="number"
                      value={formData.smtp_port || 587}
                      onChange={(e) => handleInputChange('smtp_port', parseInt(e.target.value) || 587)}
                      className="input-field"
                      placeholder="587"
                    />
                  </div>

                  {/* SMTP Username */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('auth.email')}
                    </label>
                    <input
                      type="text"
                      value={formData.smtp_username || ''}
                      onChange={(e) => handleInputChange('smtp_username', e.target.value)}
                      className="input-field"
                      placeholder="user@example.com"
                    />
                  </div>

                  {/* SMTP Password */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('auth.password')}
                    </label>
                    <div className="relative">
                      <input
                        type={showSmtpPassword ? 'text' : 'password'}
                        value={formData.smtp_password || ''}
                        onChange={(e) => handleInputChange('smtp_password', e.target.value)}
                        className="input-field pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showSmtpPassword ? (
                          <EyeSlashIcon className="h-5 w-5" />
                        ) : (
                          <EyeIcon className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* From Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.senderEmail')}
                    </label>
                    <input
                      type="email"
                      value={formData.smtp_from_email || ''}
                      onChange={(e) => handleInputChange('smtp_from_email', e.target.value)}
                      className="input-field"
                      placeholder="noreply@example.com"
                    />
                  </div>

                  {/* Use TLS */}
                  <div className="flex items-center">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.smtp_use_tls ?? true}
                        onChange={(e) => handleInputChange('smtp_use_tls', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">{t('settings.useTls')}</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* OAuth Settings (Exchange Online) */}
              <div className="border-t pt-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.oauthMicrosoft')}</h2>
                <p className="text-sm text-gray-500 mb-6">
                  {t('settings.oauthDescription')}
                </p>

                <div className="space-y-6">
                  {/* Enable OAuth */}
                  <div>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.oauth_enabled ?? false}
                        onChange={(e) => handleInputChange('oauth_enabled', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">{t('settings.enableOauth')}</span>
                    </label>
                  </div>

                  {formData.oauth_enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-6 border-l-2 border-primary-200">
                      {/* Client ID */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Client ID
                        </label>
                        <input
                          type="text"
                          value={formData.oauth_client_id || ''}
                          onChange={(e) => handleInputChange('oauth_client_id', e.target.value)}
                          className="input-field"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        />
                      </div>

                      {/* Tenant ID */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Tenant ID
                        </label>
                        <input
                          type="text"
                          value={formData.oauth_tenant_id || ''}
                          onChange={(e) => handleInputChange('oauth_tenant_id', e.target.value)}
                          className="input-field"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        />
                      </div>

                      {/* Client Secret */}
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Client Secret
                        </label>
                        <div className="relative">
                          <input
                            type={showOAuthSecret ? 'text' : 'password'}
                            value={formData.oauth_client_secret || ''}
                            onChange={(e) => handleInputChange('oauth_client_secret', e.target.value)}
                            className="input-field pr-10"
                            placeholder="••••••••••••••••••••"
                          />
                          <button
                            type="button"
                            onClick={() => setShowOAuthSecret(!showOAuthSecret)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showOAuthSecret ? (
                              <EyeSlashIcon className="h-5 w-5" />
                            ) : (
                              <EyeIcon className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Email Signature */}
              <div className="border-t pt-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.emailSignature')}</h2>
                <p className="text-sm text-gray-500 mb-4">
                  {t('settings.emailSignatureDescription')}
                </p>
                
                <div>
                  <textarea
                    value={formData.email_signature || ''}
                    onChange={(e) => handleInputChange('email_signature', e.target.value)}
                    rows={6}
                    className="input-field"
                    placeholder="Met vriendelijke groet,&#10;&#10;Jan Jansen&#10;Functie&#10;Bedrijfsnaam&#10;Tel: 012-3456789"
                  />
                </div>
              </div>

              {/* Test Email */}
              <div className="border-t pt-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.testEmail')}</h2>
                <p className="text-sm text-gray-500 mb-4">
                  {t('settings.testEmailDescription')}
                </p>
                
                <div className="flex gap-3">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="input-field max-w-md"
                    placeholder="test@example.com"
                  />
                  <button
                    onClick={handleTestEmail}
                    disabled={testingEmail || !testEmail}
                    className="btn-secondary"
                  >
                    {testingEmail ? (
                      <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                    ) : (
                      <PaperAirplaneIcon className="h-5 w-5 mr-2" />
                    )}
                    {t('settings.sendTest')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* AI Tab */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('settings.aiInvoiceExtraction')}</h2>
                <p className="text-sm text-gray-500">
                  {t('settings.aiDescription')}
                </p>
              </div>

              {/* Status indicator */}
              {settings?.ai_status && (
                <div className={`p-4 rounded-lg ${settings.ai_status.configured ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${settings.ai_status.configured ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                    <span className={`text-sm font-medium ${settings.ai_status.configured ? 'text-green-800' : 'text-yellow-800'}`}>
                      {settings.ai_status.message}
                    </span>
                  </div>
                </div>
              )}

              {/* Provider selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('settings.aiProvider')}
                </label>
                <select
                  value={formData.ai_provider || 'none'}
                  onChange={(e) => handleInputChange('ai_provider', e.target.value)}
                  className="input w-full"
                >
                  <option value="none">{t('settings.disabled')}</option>
                  <option value="github">{t('settings.githubModelsFree')}</option>
                  <option value="openai">{t('settings.openaiPaid')}</option>
                  <option value="azure">{t('settings.azureOpenai')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {t('settings.githubRecommended')}
                </p>
              </div>

              {/* GitHub Models settings */}
              {formData.ai_provider === 'github' && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-medium text-gray-900">{t('settings.githubModelsFree')}</h3>
                  
                  {/* Rate limit warning */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="text-sm">
                        <p className="font-medium text-amber-800">{t('settings.rateLimit')}</p>
                        <p className="text-amber-700 mt-1">
                          {t('settings.rateLimitDescription')}
                        </p>
                        <p className="text-amber-600 mt-1 text-xs">
                          {t('settings.unlimitedUsage')}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.githubToken')}
                    </label>
                    <input
                      type="password"
                      placeholder="ghp_... or github_pat_..."
                      onChange={(e) => handleInputChange('ai_github_token', e.target.value)}
                      className="input w-full font-mono"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('settings.createTokenAt')}{' '}
                      <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        github.com/settings/tokens
                      </a>
                      {' '}{t('settings.withModelsPermission')}
                    </p>
                  </div>
                </div>
              )}

              {/* OpenAI settings */}
              {formData.ai_provider === 'openai' && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-medium text-gray-900">OpenAI</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      placeholder="sk-..."
                      onChange={(e) => handleInputChange('ai_openai_api_key', e.target.value)}
                      className="input w-full font-mono"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {t('settings.availableAt')}{' '}
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        platform.openai.com
                      </a>
                    </p>
                  </div>
                </div>
              )}

              {/* Azure OpenAI settings */}
              {formData.ai_provider === 'azure' && (
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-medium text-gray-900">{t('settings.azureOpenai')}</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.endpointUrl')}
                    </label>
                    <input
                      type="text"
                      placeholder="https://your-resource.openai.azure.com/"
                      value={formData.ai_azure_endpoint || ''}
                      onChange={(e) => handleInputChange('ai_azure_endpoint', e.target.value)}
                      className="input w-full font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      placeholder="Azure API key"
                      onChange={(e) => handleInputChange('ai_azure_api_key', e.target.value)}
                      className="input w-full font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('settings.deploymentName')}
                    </label>
                    <input
                      type="text"
                      placeholder="gpt-4o-mini"
                      value={formData.ai_azure_deployment || ''}
                      onChange={(e) => handleInputChange('ai_azure_deployment', e.target.value)}
                      className="input w-full"
                    />
                  </div>
                </div>
              )}

              {/* Model selection (for all providers except none) */}
              {formData.ai_provider && formData.ai_provider !== 'none' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('settings.model')}
                  </label>
                  <select
                    value={formData.ai_model || 'gpt-4o-mini'}
                    onChange={(e) => handleInputChange('ai_model', e.target.value)}
                    className="input w-full"
                  >
                    <option value="gpt-4o-mini">{t('settings.modelFast')}</option>
                    <option value="gpt-4o">{t('settings.modelBest')}</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Server Tab */}
          {activeTab === 'server' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">{t('settings.server')}</h2>
              <p className="text-sm text-gray-500">
                {t('settings.serverSetup')}
              </p>

              <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Server URL</label>
                  <p className="mt-1 text-lg font-mono text-gray-900">
                    {serverConfig.serverUrl || '(Lokale ontwikkeling)'}
                  </p>
                </div>
                
                {serverConfig.serverName && (
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Server Naam</label>
                    <p className="mt-1 text-lg text-gray-900">{serverConfig.serverName}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-500">Status</label>
                  <p className="mt-1 flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    <span className="text-sm text-green-700">Verbonden</span>
                  </p>
                </div>
              </div>

              {/* Server Monitoring */}
              <div className="border-t pt-6">
                <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">Server Monitoring</h3>
                <ServerMonitoringPanel />
              </div>

              <div className="border-t pt-6">
                <h3 className="text-md font-medium text-gray-900 mb-2">Andere server gebruiken</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Om een andere server te gebruiken moet je uitloggen en de app opnieuw configureren.
                </p>
                <button
                  onClick={() => {
                    if (confirm(t('confirm.logout'))) {
                      serverConfig.clearServerUrl()
                      window.location.href = '/setup'
                    }
                  }}
                  className="btn-danger"
                >
                  <ServerIcon className="h-5 w-5 mr-2" />
                  {t('settings.serverSetup')}
                </button>
              </div>
            </div>
          )}

          {/* License Tab */}
          {activeTab === 'license' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.license', 'Licentie')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('settings.licenseDescription', 'Informatie over de actieve licentie van deze installatie.')}
              </p>
              <LicenseStatusCard />
            </div>
          )}
    </>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Cog6ToothIcon className="h-8 w-8 text-gray-400" />
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
        
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? (
              <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <CheckCircleIcon className="h-5 w-5 mr-2" />
            )}
            {t('common.save')}
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Desktop Tabs - hidden on mobile */}
      <div className="hidden md:block border-b border-gray-200">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {tabs.map((tab) => (
            tab.link ? (
              <Link
                key={tab.id}
                to={tab.link}
                className="flex items-center gap-2 py-4 px-1 border-b-2 border-transparent font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors whitespace-nowrap"
              >
                <tab.icon className="h-5 w-5" />
                {tab.name}
              </Link>
            ) : (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
                `}
              >
                <tab.icon className="h-5 w-5" />
                {tab.name}
              </button>
            )
          ))}
        </nav>
      </div>

      {/* Mobile Accordion Navigation with inline content */}
      <div className="md:hidden space-y-2">
        {tabs.map((tab) => {
          const isOpen = activeTab === tab.id
          return (
            <div key={tab.id}>
              <button
                onClick={() => setActiveTab(isOpen ? '' : tab.id)}
                className={`flex items-center gap-3 w-full p-4 bg-white rounded-xl border shadow-sm text-sm font-medium transition-colors ${
                  isOpen
                    ? 'border-primary-300 text-primary-600 bg-primary-50 rounded-b-none'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <tab.icon className={`h-5 w-5 ${isOpen ? 'text-primary-600' : 'text-gray-400'}`} />
                {tab.name}
                <ChevronDownIcon className={`h-4 w-4 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180 text-primary-600' : 'text-gray-400'}`} />
              </button>
              {isOpen && (
                <div className="bg-white rounded-b-xl border border-t-0 border-primary-300 shadow-sm p-4">
                  {tab.id === 'fonts' ? (
                    <FontManagementPage embedded />
                  ) : tab.id === 'leave' ? (
                    <LeaveSettingsPage embedded />
                  ) : (
                    renderTabContent()
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Desktop Tab Content */}
      <div className="hidden md:block">
        {activeTab && !tabs.find(t => t.id === activeTab)?.link && (
        <div className="card">
          <div className="p-6">
            {renderTabContent()}
          </div>
        </div>
        )}
      </div>

      {/* Save Button (sticky at bottom for mobile) */}
      {hasChanges && (
        <div className="fixed bottom-4 right-4 md:hidden">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary shadow-lg"
          >
            {saving ? (
              <ArrowPathIcon className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircleIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
