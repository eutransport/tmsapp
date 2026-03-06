/**
 * Font Management Page
 * Admin interface for uploading and managing custom fonts
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  DocumentArrowUpIcon,
  CheckCircleIcon,
  XMarkIcon,
  EyeIcon,
  Cog6ToothIcon,
  PhotoIcon,
  SwatchIcon,
  LanguageIcon,
  BuildingOfficeIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  SparklesIcon,
  ServerIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import { fontsApi, CustomFont, FontFamily } from '@/api/fonts'
import toast from 'react-hot-toast'

// Tab configuration (same as SettingsPage)
const tabs = [
  { id: 'branding', name: 'Branding', icon: PhotoIcon, link: '/settings' },
  { id: 'theme', name: 'Thema', icon: SwatchIcon, link: '/settings' },
  { id: 'fonts', name: 'Fonts', icon: LanguageIcon },
  { id: 'company', name: 'Bedrijfsgegevens', icon: BuildingOfficeIcon, link: '/settings' },
  { id: 'invoice', name: 'Factuur', icon: DocumentTextIcon, link: '/settings' },
  { id: 'email', name: 'E-mail', icon: EnvelopeIcon, link: '/settings' },
  { id: 'ai', name: 'AI Extractie', icon: SparklesIcon, link: '/settings' },
  { id: 'server', name: 'Server', icon: ServerIcon, link: '/settings' },
]

// Font weight options
const FONT_WEIGHTS = [
  { value: 100, label: 'Thin (100)' },
  { value: 200, label: 'Extra Light (200)' },
  { value: 300, label: 'Light (300)' },
  { value: 400, label: 'Regular (400)' },
  { value: 500, label: 'Medium (500)' },
  { value: 600, label: 'Semi Bold (600)' },
  { value: 700, label: 'Bold (700)' },
  { value: 800, label: 'Extra Bold (800)' },
  { value: 900, label: 'Black (900)' },
]

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.otf']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export default function FontManagementPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  
  // State
  const [families, setFamilies] = useState<FontFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewFont, setPreviewFont] = useState<CustomFont | null>(null)
  
  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    family: '',
    name: '',
    weight: 400,
    style: 'normal' as 'normal' | 'italic',
    file: null as File | null,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load fonts on mount
  useEffect(() => {
    loadFonts()
  }, [])

  const loadFonts = async () => {
    try {
      setLoading(true)
      const data = await fontsApi.getFamilies()
      setFamilies(data)
    } catch (error) {
      console.error('Failed to load fonts:', error)
      toast.error(t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(t('errors.invalidFormat'))
      return
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('errors.saveFailed'))
      return
    }

    // Auto-fill family name from filename
    const baseName = file.name.replace(/\.[^/.]+$/, '')
    // Remove weight/style indicators from name
    const cleanName = baseName
      .replace(/[-_]?(regular|bold|italic|light|medium|thin|black|extra|semi)/gi, '')
      .replace(/[-_]?(\d{3})/g, '')
      .trim()

    setUploadForm(prev => ({
      ...prev,
      file,
      family: prev.family || cleanName,
      name: prev.name || baseName,
    }))
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!uploadForm.file || !uploadForm.family || !uploadForm.name) {
      toast.error(t('errors.required'))
      return
    }

    try {
      setUploading(true)
      await fontsApi.upload({
        family: uploadForm.family,
        name: uploadForm.name,
        font_file: uploadForm.file,
        weight: uploadForm.weight,
        style: uploadForm.style,
      })
      
      toast.success(t('common.success'))
      setShowUploadModal(false)
      setUploadForm({ family: '', name: '', weight: 400, style: 'normal', file: null })
      loadFonts()
    } catch (error: any) {
      console.error('Upload failed:', error)
      toast.error(error.response?.data?.font_file?.[0] || t('errors.saveFailed'))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (font: CustomFont) => {
    if (font.is_system) {
      toast.error(t('errors.forbidden'))
      return
    }

    if (!confirm(t('confirm.delete'))) {
      return
    }

    try {
      await fontsApi.delete(font.id)
      toast.success(t('common.deleted'))
      loadFonts()
    } catch (error) {
      console.error('Delete failed:', error)
      toast.error(t('errors.deleteFailed'))
    }
  }

  const handleToggleActive = async (font: CustomFont) => {
    try {
      await fontsApi.update(font.id, { is_active: !font.is_active })
      toast.success(t('common.success'))
      loadFonts()
    } catch (error) {
      console.error('Toggle failed:', error)
      toast.error(t('errors.saveFailed'))
    }
  }

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Header - hidden when embedded */}
      {!embedded && (
        <div className="page-header">
          <div className="flex items-center gap-3">
            <Cog6ToothIcon className="h-8 w-8 text-gray-400" />
            <h1 className="page-title">{t('settings.title')}</h1>
          </div>
          
          <button
            onClick={() => setShowUploadModal(true)}
            className="btn-primary"
          >
            <PlusIcon className="h-5 w-5 mr-2" />
            {t('common.upload')}
          </button>
        </div>
      )}

      {/* Tabs - hidden when embedded */}
      {!embedded && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              tab.link ? (
                <Link
                  key={tab.id}
                  to={tab.link}
                  className="flex items-center gap-2 py-4 px-1 border-b-2 border-transparent font-medium text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
                >
                  <tab.icon className="h-5 w-5" />
                  {tab.name}
                </Link>
              ) : (
                <button
                  key={tab.id}
                  className="flex items-center gap-2 py-4 px-1 border-b-2 border-primary-500 text-primary-600 font-medium text-sm transition-colors"
                >
                  <tab.icon className="h-5 w-5" />
                  {tab.name}
                </button>
              )
            ))}
          </nav>
        </div>
      )}

      {/* Upload button when embedded */}
      {embedded && (
        <div className="flex justify-end">
          <button onClick={() => setShowUploadModal(true)} className="btn-primary text-sm">
            <PlusIcon className="h-4 w-4 mr-1" />
            {t('common.upload')}
          </button>
        </div>
      )}

      {/* Content */}
      <div className={embedded ? '' : 'card'}>
        <div className={embedded ? '' : 'p-6'}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('settings.fontManagement')}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {t('settings.fonts')}
              </p>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-12">
              <ArrowPathIcon className="h-8 w-8 text-primary-600 animate-spin" />
            </div>
          )}

          {/* Empty state */}
          {!loading && families.length === 0 && (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <DocumentArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">{t('common.noData')}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('common.noResults')}
              </p>
              <button
                onClick={() => setShowUploadModal(true)}
                className="mt-4 btn-primary"
              >
                <PlusIcon className="h-5 w-5 mr-2" />
                {t('common.upload')}
              </button>
            </div>
          )}

          {/* Font families list */}
          {!loading && families.length > 0 && (
            <div className="space-y-6">
              {families.map((family) => (
                <div key={family.family} className="bg-gray-50 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-100">
                    <h3 className="text-lg font-semibold text-gray-900" style={{ fontFamily: family.family }}>
                      {family.family}
                    </h3>
                    <p className="text-sm text-gray-500">{family.fonts.length} variant(en)</p>
                  </div>
              
              <div className="divide-y divide-gray-200">
                {family.fonts.map((font) => (
                  <div key={font.id} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span 
                          className="text-lg"
                          style={{ 
                            fontFamily: font.family,
                            fontWeight: font.weight,
                            fontStyle: font.style,
                          }}
                        >
                          {font.name}
                        </span>
                        {font.is_system && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                            Systeem
                          </span>
                        )}
                        {!font.is_active && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                            Inactief
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {font.weight_display} • {font.style_display} • {font.file_format.toUpperCase()}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPreviewFont(font)}
                        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                        title="Preview"
                      >
                        <EyeIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(font)}
                        className={`p-2 rounded-lg ${
                          font.is_active 
                            ? 'text-green-600 hover:bg-green-50' 
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={font.is_active ? 'Deactiveren' : 'Activeren'}
                      >
                        <CheckCircleIcon className="h-5 w-5" />
                      </button>
                      {!font.is_system && (
                        <button
                          onClick={() => handleDelete(font)}
                          className="p-2 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                          title="Verwijderen"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{t('common.upload')}</h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              {/* File input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Font Bestand
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".woff,.woff2,.ttf,.otf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-primary-500 transition-colors"
                >
                  {uploadForm.file ? (
                    <div>
                      <DocumentArrowUpIcon className="mx-auto h-8 w-8 text-green-500" />
                      <p className="mt-2 text-sm text-gray-900">{uploadForm.file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(uploadForm.file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <DocumentArrowUpIcon className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-500">
                        Klik om een bestand te selecteren
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        WOFF, WOFF2, TTF of OTF (max 5MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Family name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Font Familie
                </label>
                <input
                  type="text"
                  value={uploadForm.family}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, family: e.target.value }))}
                  placeholder="bijv. Roboto"
                  className="input-field w-full"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Groepeer varianten onder dezelfde familie naam
                </p>
              </div>

              {/* Display name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weergavenaam
                </label>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="bijv. Roboto Bold"
                  className="input-field w-full"
                  required
                />
              </div>

              {/* Weight */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gewicht
                </label>
                <select
                  value={uploadForm.weight}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, weight: parseInt(e.target.value) }))}
                  className="input-field w-full"
                >
                  {FONT_WEIGHTS.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>

              {/* Style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Stijl
                </label>
                <select
                  value={uploadForm.style}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, style: e.target.value as 'normal' | 'italic' }))}
                  className="input-field w-full"
                >
                  <option value="normal">Normaal</option>
                  <option value="italic">Cursief</option>
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 btn-secondary"
                  disabled={uploading}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 btn-primary"
                  disabled={uploading || !uploadForm.file}
                >
                  {uploading ? (
                    <>
                      <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    t('common.upload')
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewFont && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{t('common.preview')}</h2>
              <button
                onClick={() => setPreviewFont(null)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div 
                style={{ 
                  fontFamily: previewFont.family,
                  fontWeight: previewFont.weight,
                  fontStyle: previewFont.style,
                }}
              >
                <p className="text-4xl mb-4">Aa Bb Cc</p>
                <p className="text-2xl mb-4">The quick brown fox jumps over the lazy dog</p>
                <p className="text-xl mb-4">De snelle bruine vos springt over de luie hond</p>
                <p className="text-lg mb-4">0123456789 !@#$%^&*()</p>
                <p className="text-base">
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
                  Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
