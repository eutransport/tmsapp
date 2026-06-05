/**
 * Invoice Template Editor
 * Visual editor for creating invoice templates with:
 * - Header/Subheader/Footer sections (3 columns each)
 * - Dynamic table columns with calculations
 * - Styling options (font, color, alignment)
 * - PDF preview
 */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  Cog6ToothIcon,
  PhotoIcon,
  DocumentTextIcon,
  CurrencyEuroIcon,
  CalendarIcon,
  VariableIcon,
} from '@heroicons/react/24/outline'
import {
  TemplateLayout,
  TemplateSection,
  TemplateField,
  TemplateFieldStyle,
  TemplateColumn,
  TemplateDefaults,
  TemplateTotals,
  TemplateTableStyle,
  TemplateFieldType,
  TextAlignment,
  ColumnType,
} from '@/types'
import {
  getTemplate,
  createTemplate,
  updateTemplate,
} from '@/api/invoices'
import { settingsApi } from '@/api/settings'

// Default styling
const defaultFieldStyle: TemplateFieldStyle = {
  alignment: 'left',
  bold: false,
  italic: false,
  color: '#000000',
  fontFamily: 'Arial',
  fontSize: 12,
}

// Default empty layout
const defaultLayout: TemplateLayout = {
  header: { left: null, center: null, right: null },
  subheader: { left: null, center: null, right: null },
  columns: [
    { id: 'omschrijving', naam: 'Omschrijving', type: 'text', breedte: 40 },
    { id: 'aantal', naam: 'Aantal', type: 'aantal', breedte: 15 },
    { id: 'prijs', naam: 'Prijs', type: 'prijs', breedte: 20 },
    { id: 'totaal', naam: 'Totaal', type: 'berekend', breedte: 25, formule: 'aantal * prijs' },
  ],
  footer: { left: null, center: null, right: null },
  defaults: {
    uurtarief: 45.00,
    dotPrijs: 21,
    dotIsPercentage: true,
    kmTarief: 0.23,
  },
  totals: {
    showSubtotaal: true,
    showBtw: true,
    showTotaal: true,
    btwPercentage: 21,
  },
  tableStyle: {
    headerBackground: '#1f2937',
    headerTextColor: '#ffffff',
    headerFont: 'Helvetica',
    evenRowBackground: '#ffffff',
    oddRowBackground: '#f9fafb',
    rowTextColor: '#1f2937',
    rowFont: 'Helvetica',
  },
}

// Field type icons
const fieldTypeIcons: Record<TemplateFieldType, React.ElementType> = {
  text: DocumentTextIcon,
  image: PhotoIcon,
  amount: CurrencyEuroIcon,
  date: CalendarIcon,
  variable: VariableIcon,
}

// Available fonts
const fontFamilies = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New']

// Helper function to get column type labels (called inside components with t())
const getColumnTypeLabels = (t: (key: string) => string): Record<ColumnType, string> => ({
  text: t('templates.editor.text'),
  aantal: t('templates.editor.quantity'),
  km: t('templates.editor.kilometers'),
  uren: t('templates.editor.hours'),
  prijs: t('templates.editor.price'),
  btw: t('templates.editor.vat'),
  percentage: t('templates.editor.percentage'),
  berekend: t('templates.editor.calculated'),
})

// Helper function to get available variables (called inside components with t())
const getAvailableVariables = (t: (key: string) => string) => [
  { name: 'bedrijf.naam', label: t('templates.editor.companyName') },
  { name: 'bedrijf.adres', label: t('templates.editor.companyAddress') },
  { name: 'bedrijf.kvk', label: t('templates.editor.kvkNumber') },
  { name: 'bedrijf.btw', label: t('templates.editor.vatNumber') },
  { name: 'factuurnummer', label: t('templates.editor.invoiceNumber') },
  { name: 'factuurdatum', label: t('templates.editor.invoiceDate') },
  { name: 'vervaldatum', label: t('templates.editor.dueDate') },
  { name: 'klant.naam', label: t('templates.editor.customerName') },
  { name: 'klant.adres', label: t('templates.editor.customerAddress') },
  { name: 'klant.postcode', label: t('templates.editor.customerZip') },
  { name: 'klant.stad', label: t('templates.editor.customerCity') },
  { name: 'klant.postcode_plaats', label: t('templates.editor.customerZipCity') },
  { name: 'klant.land', label: t('templates.editor.customerCountry') },
  { name: 'klant.kvk', label: t('templates.editor.customerKvk') },
  { name: 'klant.telefoon', label: t('templates.editor.customerPhone') },
  { name: 'klant.email', label: t('templates.editor.customerEmail') },
  { name: 'klant.contactpersoon', label: t('templates.editor.customerContact') },
]

// ============================================
// Field Editor Component
// ============================================
interface FieldEditorProps {
  field: TemplateField | null
  position: string
  onSave: (field: TemplateField | null) => void
  onClose: () => void
}

function FieldEditor({ field, position, onSave, onClose }: FieldEditorProps) {
  const { t } = useTranslation()
  const availableVariables = getAvailableVariables(t)
  const [localField, setLocalField] = useState<TemplateField>(
    field || {
      id: `field_${Date.now()}`,
      type: 'text',
      content: '',
      style: { ...defaultFieldStyle },
    }
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const insertVariableAtCursor = (varName: string) => {
    if (!varName) return
    const placeholder = `{{${varName}}}`
    const el = textareaRef.current
    const current = localField.content || ''
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart
      const end = el.selectionEnd ?? start
      const next = current.slice(0, start) + placeholder + current.slice(end)
      setLocalField({ ...localField, content: next })
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + placeholder.length
        el.setSelectionRange(pos, pos)
      })
    } else {
      setLocalField({ ...localField, content: current + placeholder })
    }
  }

  const handleStyleChange = (key: keyof TemplateFieldStyle, value: unknown) => {
    setLocalField({
      ...localField,
      style: { ...localField.style, [key]: value },
    })
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError(null)

    try {
      const result = await settingsApi.uploadImage(file)
      setLocalField({ ...localField, imageUrl: result.url })
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      setUploadError(err.response?.data?.error || t('templates.editor.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500/75" onClick={onClose} />
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t('templates.editor.editField')} - {position}
          </h3>

          <div className="space-y-4">
            {/* Field Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('templates.editor.type')}</label>
              <div className="grid grid-cols-5 gap-2">
                {(Object.keys(fieldTypeIcons) as TemplateFieldType[]).map((type) => {
                  const Icon = fieldTypeIcons[type]
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setLocalField({ ...localField, type })}
                      className={`p-3 rounded-lg border-2 flex flex-col items-center ${
                        localField.type === type
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs mt-1 capitalize">{type}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Content based on type */}
            {localField.type === 'text' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">{t('templates.editor.text')}</label>
                  <select
                    value=""
                    onChange={(e) => {
                      insertVariableAtCursor(e.target.value)
                      e.target.value = ''
                    }}
                    className="text-xs rounded border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  >
                    <option value="">{t('templates.editor.insertVariable')}</option>
                    {availableVariables.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  ref={textareaRef}
                  value={localField.content}
                  onChange={(e) => setLocalField({ ...localField, content: e.target.value })}
                  rows={5}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono text-sm"
                  placeholder={t('templates.editor.enterText')}
                />
                <p className="mt-1 text-xs text-gray-500">{t('templates.editor.multilineHint')}</p>
              </div>
            )}

            {localField.type === 'variable' && (
              <div>
                <label className="block text-sm font-medium text-gray-700">{t('templates.editor.variable')}</label>
                <select
                  value={localField.content}
                  onChange={(e) => setLocalField({ ...localField, content: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                >
                  <option value="">{t('templates.editor.selectVariable')}</option>
                  {availableVariables.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.label} ({`{{${v.name}}}`})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {localField.type === 'image' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('templates.editor.uploadImage')}</label>
                  <div className="flex items-center justify-center w-full">
                    <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer ${
                      uploading ? 'bg-gray-100 border-gray-300' : 'bg-gray-50 border-gray-300 hover:bg-gray-100 hover:border-primary-400'
                    }`}>
                      {uploading ? (
                        <div className="flex flex-col items-center">
                          <svg className="animate-spin h-8 w-8 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span className="mt-2 text-sm text-gray-500">{t('templates.editor.uploading')}</span>
                        </div>
                      ) : localField.imageUrl ? (
                        <div className="flex flex-col items-center">
                          <img src={localField.imageUrl} alt="Preview" className="max-h-20 object-contain" />
                          <span className="mt-2 text-xs text-gray-500">{t('templates.editor.clickToChange')}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <PhotoIcon className="h-10 w-10 text-gray-400" />
                          <span className="mt-2 text-sm text-gray-500">{t('templates.editor.clickToUpload')}</span>
                          <span className="text-xs text-gray-400">PNG, JPG, GIF, WEBP, SVG (max 5MB)</span>
                        </div>
                      )}
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                        onChange={handleImageUpload}
                        disabled={uploading}
                      />
                    </label>
                  </div>
                  {uploadError && (
                    <p className="mt-2 text-sm text-red-600">{uploadError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Of gebruik een URL</label>
                  <input
                    type="url"
                    value={localField.imageUrl || ''}
                    onChange={(e) => setLocalField({ ...localField, imageUrl: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t('templates.editor.widthPixels')}</label>
                    <input
                      type="number"
                      min="10"
                      max="500"
                      value={localField.imageWidth || ''}
                      onChange={(e) => setLocalField({ ...localField, imageWidth: e.target.value ? parseInt(e.target.value) : undefined })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      placeholder="Auto"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t('templates.editor.heightPixels')}</label>
                    <input
                      type="number"
                      min="10"
                      max="500"
                      value={localField.imageHeight || ''}
                      onChange={(e) => setLocalField({ ...localField, imageHeight: e.target.value ? parseInt(e.target.value) : undefined })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                      placeholder="Auto"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">{t('templates.editor.imageSizeNote')}</p>
              </div>
            )}

            {/* Styling Options */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{t('templates.editor.styling')}</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.alignment')}</label>
                  <div className="flex rounded-md overflow-hidden border">
                    {(['left', 'center', 'right'] as TextAlignment[]).map((align) => (
                      <button
                        key={align}
                        type="button"
                        onClick={() => handleStyleChange('alignment', align)}
                        className={`flex-1 py-2 text-sm ${
                          localField.style.alignment === align
                            ? 'bg-primary-500 text-white'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        {align === 'left' ? '⬅' : align === 'center' ? '⬌' : '➡'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.style')}</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleStyleChange('bold', !localField.style.bold)}
                      className={`flex-1 py-2 rounded border font-bold ${
                        localField.style.bold
                          ? 'bg-primary-500 text-white border-primary-500'
                          : 'bg-white border-gray-300'
                      }`}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStyleChange('italic', !localField.style.italic)}
                      className={`flex-1 py-2 rounded border italic ${
                        localField.style.italic
                          ? 'bg-primary-500 text-white border-primary-500'
                          : 'bg-white border-gray-300'
                      }`}
                    >
                      I
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.color')}</label>
                  <input
                    type="color"
                    value={localField.style.color}
                    onChange={(e) => handleStyleChange('color', e.target.value)}
                    className="w-full h-10 rounded border border-gray-300 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.size')}</label>
                  <select
                    value={localField.style.fontSize}
                    onChange={(e) => handleStyleChange('fontSize', parseInt(e.target.value))}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  >
                    {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32].map((size) => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.font')}</label>
                  <select
                    value={localField.style.fontFamily}
                    onChange={(e) => handleStyleChange('fontFamily', e.target.value)}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  >
                    {fontFamilies.map((font) => (
                      <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            {field && (
              <button
                type="button"
                onClick={() => onSave(null)}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-800"
              >
                {t('common.delete')}
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => onSave(localField)}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Section Editor Component (Header/Subheader/Footer)
// ============================================
interface SectionEditorProps {
  title: string
  section: TemplateSection
  onChange: (section: TemplateSection) => void
}

function SectionEditor({ title, section, onChange }: SectionEditorProps) {
  const { t } = useTranslation()
  const [editingPosition, setEditingPosition] = useState<'left' | 'center' | 'right' | null>(null)

  const handleFieldSave = (position: 'left' | 'center' | 'right', field: TemplateField | null) => {
    onChange({ ...section, [position]: field })
    setEditingPosition(null)
  }

  const renderFieldPreview = (field: TemplateField | null, position: 'left' | 'center' | 'right') => {
    const positionLabels = { 
      left: t('templates.editor.leftColumn'), 
      center: t('templates.editor.centerColumn'), 
      right: t('templates.editor.rightColumn') 
    }
    
    return (
      <div
        onClick={() => setEditingPosition(position)}
        className="min-h-[80px] border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
      >
        {field && typeof field === 'object' && field.type ? (
          <div
            style={{
              textAlign: field.style?.alignment || 'left',
              fontWeight: field.style?.bold ? 'bold' : 'normal',
              fontStyle: field.style?.italic ? 'italic' : 'normal',
              color: field.style?.color || '#000',
              fontFamily: field.style?.fontFamily || 'Arial',
              fontSize: field.style?.fontSize ? `${field.style.fontSize}px` : '12px',
            }}
            className="w-full"
          >
            {field.type === 'image' && field.imageUrl ? (
              <img src={field.imageUrl} alt="" className="max-h-16 mx-auto" />
            ) : field.type === 'variable' ? (
              <span className="text-primary-600">{`{{${field.content}}}`}</span>
            ) : (
              field.content ? (
                String(field.content).split(/\r?\n/).map((line, idx) => (
                  <div key={idx} style={{ 
                    lineHeight: 1.2, 
                    margin: 0, 
                    padding: 0,
                    textAlign: field.style?.alignment || 'left',
                  }}>{line || '\u00A0'}</div>
                ))
              ) : (
                <span className="text-gray-400">({t('templates.editor.empty')})</span>
              )
            )}
          </div>
        ) : (
          <div className="text-center text-gray-400 h-full flex flex-col items-center justify-center">
            <PlusIcon className="h-6 w-6 mx-auto mb-1" />
            <span className="text-xs">{t('templates.editor.clickToAddField')}<br/>({positionLabels[position]})</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="grid grid-cols-3 gap-4">
        {(['left', 'center', 'right'] as const).map((position) => (
          <div key={position}>
            {renderFieldPreview(section[position], position)}
          </div>
        ))}
      </div>

      {editingPosition && (
        <FieldEditor
          field={section[editingPosition]}
          position={`${title} - ${editingPosition === 'left' ? t('templates.editor.leftColumn') : editingPosition === 'center' ? t('templates.editor.centerColumn') : t('templates.editor.rightColumn')}`}
          onSave={(field) => handleFieldSave(editingPosition, field)}
          onClose={() => setEditingPosition(null)}
        />
      )}
    </div>
  )
}

// ============================================
// Column Editor Component
// ============================================
interface ColumnEditorProps {
  columns: TemplateColumn[]
  onChange: (columns: TemplateColumn[]) => void
}

function ColumnEditor({ columns, onChange }: ColumnEditorProps) {
  const { t } = useTranslation()
  const columnTypeLabels = getColumnTypeLabels(t)
  const [editingColumn, setEditingColumn] = useState<TemplateColumn | null>(null)
  const [editingIndex, setEditingIndex] = useState<number>(-1)

  const addColumn = () => {
    const newColumn: TemplateColumn = {
      id: `kolom_${Date.now()}`,
      naam: t('templates.editor.newColumn'),
      type: 'text',
      breedte: 20,
    }
    setEditingColumn(newColumn)
    setEditingIndex(columns.length)
  }

  const updateColumn = (index: number, column: TemplateColumn) => {
    const newColumns = [...columns]
    newColumns[index] = column
    onChange(newColumns)
  }

  const deleteColumn = (index: number) => {
    onChange(columns.filter((_, i) => i !== index))
  }

  const saveColumn = () => {
    if (!editingColumn) return
    
    if (editingIndex >= columns.length) {
      onChange([...columns, editingColumn])
    } else {
      updateColumn(editingIndex, editingColumn)
    }
    setEditingColumn(null)
    setEditingIndex(-1)
  }

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= columns.length) return
    
    const newColumns = [...columns]
    const [movedColumn] = newColumns.splice(index, 1)
    newColumns.splice(newIndex, 0, movedColumn)
    onChange(newColumns)
  }

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{t('templates.editor.tableColumns')}</h3>
        <button
          type="button"
          onClick={addColumn}
          className="text-sm text-primary-600 hover:text-primary-800 flex items-center"
        >
          <PlusIcon className="h-4 w-4 mr-1" />
          {t('templates.editor.addColumn')}
        </button>
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        {/* Column headers preview */}
        <div className="flex border-b-2 border-gray-300 pb-2 mb-3">
          {columns.map((col) => (
            <div
              key={col.id}
              style={{ width: `${col.breedte}%` }}
              className="px-2 text-center"
            >
              <div className="font-semibold text-sm truncate">{col.naam}</div>
              <div className="text-xs text-gray-500">{columnTypeLabels[col.type]}</div>
            </div>
          ))}
        </div>

        {/* Column list for editing */}
        <div className="space-y-2">
          <p className="text-xs text-gray-500 mb-2">💡 {t('templates.editor.orderTip')}</p>
          {columns.map((col, colIndex) => (
            <div
              key={col.id}
              className="flex items-center justify-between bg-white rounded p-3 border hover:shadow-sm"
            >
              <div className="flex-1">
                <div className="font-medium text-sm">{col.naam}</div>
                <div className="text-xs text-gray-500">
                  ID: <code className="bg-gray-100 px-1 rounded">{col.id}</code>
                  {' • '}{columnTypeLabels[col.type]}
                  {' • '}{col.breedte}%
                  {col.formule && (
                    <> • Formule: <code className="bg-blue-100 text-blue-800 px-1 rounded">{col.formule}</code></>
                  )}
                </div>
              </div>
              
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveColumn(colIndex, 'up')}
                  disabled={colIndex === 0}
                  className="p-1 text-gray-400 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t('templates.editor.moveUp')}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(colIndex, 'down')}
                  disabled={colIndex === columns.length - 1}
                  className="p-1 text-gray-400 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={t('templates.editor.moveDown')}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingColumn(col)
                    setEditingIndex(colIndex)
                  }}
                  className="p-1 text-gray-500 hover:text-primary-600"
                  title={t('common.edit')}
                >
                  <Cog6ToothIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteColumn(colIndex)}
                  className="p-1 text-gray-500 hover:text-red-600"
                  title={t('common.delete')}
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Column Edit Modal */}
      {editingColumn && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-gray-500/75" onClick={() => setEditingColumn(null)} />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold mb-4">{t('templates.editor.editColumn')}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('templates.editor.columnId')}</label>
                  <input
                    type="text"
                    value={editingColumn.id}
                    onChange={(e) => setEditingColumn({
                      ...editingColumn,
                      id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')
                    })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    placeholder="unieke_naam"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('templates.editor.columnIdDescription')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('templates.editor.displayName')}</label>
                  <input
                    type="text"
                    value={editingColumn.naam}
                    onChange={(e) => setEditingColumn({ ...editingColumn, naam: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('templates.editor.type')}</label>
                  <select
                    value={editingColumn.type}
                    onChange={(e) => setEditingColumn({ ...editingColumn, type: e.target.value as ColumnType })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  >
                    {Object.entries(columnTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('templates.editor.width')}</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={editingColumn.breedte}
                    onChange={(e) => setEditingColumn({ ...editingColumn, breedte: parseInt(e.target.value) || 20 })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>

                {editingColumn.type === 'berekend' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t('templates.editor.formula')}</label>
                    <input
                      type="text"
                      value={editingColumn.formule || ''}
                      onChange={(e) => setEditingColumn({ ...editingColumn, formule: e.target.value })}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 font-mono"
                      placeholder="kolom_a * kolom_b"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('templates.editor.formulaExample')}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setEditingColumn(null)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={saveColumn}
                  className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// Defaults Editor Component
// ============================================
interface DefaultsEditorProps {
  defaults: TemplateDefaults
  totals: TemplateTotals
  onDefaultsChange: (defaults: TemplateDefaults) => void
  onTotalsChange: (totals: TemplateTotals) => void
}

function DefaultsEditor({ defaults, totals, onDefaultsChange, onTotalsChange }: DefaultsEditorProps) {
  const { t } = useTranslation()
  return (
    <div className="mb-6 grid grid-cols-2 gap-6">
      {/* Default Tarieven */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('templates.editor.defaultRates')}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500">{t('templates.editor.hourlyRate')}</label>
            <input
              type="number"
              step="0.01"
              value={defaults.uurtarief}
              onChange={(e) => onDefaultsChange({ ...defaults, uurtarief: parseFloat(e.target.value) || 0 })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">{t('templates.editor.kmRate')}</label>
            <input
              type="number"
              step="0.01"
              value={defaults.kmTarief}
              onChange={(e) => onDefaultsChange({ ...defaults, kmTarief: parseFloat(e.target.value) || 0 })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">{t('templates.editor.dotPrice')}</label>
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                step="0.01"
                value={defaults.dotPrijs}
                onChange={(e) => onDefaultsChange({ ...defaults, dotPrijs: parseFloat(e.target.value) || 0 })}
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              />
              <label className="flex items-center text-xs">
                <input
                  type="checkbox"
                  checked={defaults.dotIsPercentage}
                  onChange={(e) => onDefaultsChange({ ...defaults, dotIsPercentage: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 mr-1"
                />
                %
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Totalen Config */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('templates.editor.totalsConfig')}</h3>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={totals.showSubtotaal}
              onChange={(e) => onTotalsChange({ ...totals, showSubtotaal: e.target.checked })}
              className="rounded border-gray-300 text-primary-600"
            />
            <span className="ml-2 text-sm">{t('templates.editor.showSubtotal')}</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={totals.showBtw}
              onChange={(e) => onTotalsChange({ ...totals, showBtw: e.target.checked })}
              className="rounded border-gray-300 text-primary-600"
            />
            <span className="ml-2 text-sm">{t('templates.editor.showVat')}</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={totals.showTotaal}
              onChange={(e) => onTotalsChange({ ...totals, showTotaal: e.target.checked })}
              className="rounded border-gray-300 text-primary-600"
            />
            <span className="ml-2 text-sm">{t('templates.editor.showTotal')}</span>
          </label>
          <div>
            <label className="block text-xs text-gray-500">{t('templates.editor.vatPercentage')}</label>
            <input
              type="number"
              step="0.1"
              value={totals.btwPercentage}
              onChange={(e) => onTotalsChange({ ...totals, btwPercentage: parseFloat(e.target.value) || 21 })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Table Style Editor Component
// ============================================
interface TableStyleEditorProps {
  tableStyle: TemplateTableStyle
  onChange: (tableStyle: TemplateTableStyle) => void
}

const defaultTableStyle: TemplateTableStyle = {
  headerBackground: '#1f2937',
  headerTextColor: '#ffffff',
  headerFont: 'Helvetica',
  evenRowBackground: '#ffffff',
  oddRowBackground: '#f9fafb',
  rowTextColor: '#1f2937',
  rowFont: 'Helvetica',
}

function TableStyleEditor({ tableStyle, onChange }: TableStyleEditorProps) {
  const { t } = useTranslation()
  const style = { ...defaultTableStyle, ...tableStyle }
  
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('templates.editor.tableStyle')}</h3>
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid grid-cols-2 gap-6">
          {/* Header styling */}
          <div>
            <h4 className="text-xs font-medium text-gray-600 mb-2">{t('templates.editor.headerRow')}</h4>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.background')}</label>
                <input
                  type="color"
                  value={style.headerBackground}
                  onChange={(e) => onChange({ ...style, headerBackground: e.target.value })}
                  className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.textColor')}</label>
                <input
                  type="color"
                  value={style.headerTextColor}
                  onChange={(e) => onChange({ ...style, headerTextColor: e.target.value })}
                  className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.font')}</label>
                <select
                  value={style.headerFont}
                  onChange={(e) => onChange({ ...style, headerFont: e.target.value })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                >
                  {fontFamilies.map((font) => (
                    <option key={font} value={font}>{font}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Row styling */}
          <div>
            <h4 className="text-xs font-medium text-gray-600 mb-2">{t('templates.editor.rows')}</h4>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.evenRowBackground')}</label>
                <input
                  type="color"
                  value={style.evenRowBackground}
                  onChange={(e) => onChange({ ...style, evenRowBackground: e.target.value })}
                  className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.oddRowBackground')}</label>
                <input
                  type="color"
                  value={style.oddRowBackground}
                  onChange={(e) => onChange({ ...style, oddRowBackground: e.target.value })}
                  className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.textColor')}</label>
                <input
                  type="color"
                  value={style.rowTextColor}
                  onChange={(e) => onChange({ ...style, rowTextColor: e.target.value })}
                  className="w-full h-8 rounded border border-gray-300 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('templates.editor.font')}</label>
                <select
                  value={style.rowFont}
                  onChange={(e) => onChange({ ...style, rowFont: e.target.value })}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
                >
                  {fontFamilies.map((font) => (
                    <option key={font} value={font}>{font}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-2">{t('templates.editor.preview')}:</p>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: style.headerBackground, color: style.headerTextColor, fontFamily: style.headerFont }}>
                <th className="py-2 px-3 text-left">Omschrijving</th>
                <th className="py-2 px-3 text-right">Aantal</th>
                <th className="py-2 px-3 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ backgroundColor: style.oddRowBackground, color: style.rowTextColor, fontFamily: style.rowFont }}>
                <td className="py-2 px-3">Voorbeeld regel 1</td>
                <td className="py-2 px-3 text-right">2</td>
                <td className="py-2 px-3 text-right">€ 90,00</td>
              </tr>
              <tr style={{ backgroundColor: style.evenRowBackground, color: style.rowTextColor, fontFamily: style.rowFont }}>
                <td className="py-2 px-3">Voorbeeld regel 2</td>
                <td className="py-2 px-3 text-right">5</td>
                <td className="py-2 px-3 text-right">€ 225,00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ============================================
// PDF Preview Component
// ============================================
interface PDFPreviewProps {
  layout: TemplateLayout
  templateName: string
}

function PDFPreview({ layout }: PDFPreviewProps) {
  const renderField = (field: TemplateField | null) => {
    if (!field) return null
    
    const style: React.CSSProperties = {
      textAlign: field.style.alignment,
      fontWeight: field.style.bold ? 'bold' : 'normal',
      fontStyle: field.style.italic ? 'italic' : 'normal',
      color: field.style.color,
      fontFamily: field.style.fontFamily,
      fontSize: `${field.style.fontSize * 0.75}px`,
    }

    if (field.type === 'image' && field.imageUrl) {
      return <img src={field.imageUrl} alt="" className="max-h-8" style={{ display: 'block', margin: field.style.alignment === 'center' ? '0 auto' : field.style.alignment === 'right' ? '0 0 0 auto' : '0' }} />
    }
    if (field.type === 'variable') {
      return <span style={style} className="text-primary-600">{`{{${field.content}}}`}</span>
    }
    return (
      <>
        {String(field.content).split(/\r?\n/).map((line, idx) => (
          <div key={idx} style={{ ...style, display: 'block', lineHeight: 1, margin: 0, padding: 0 }}>{line || '\u00A0'}</div>
        ))}
      </>
    )
  }

  // Sample data for preview
  const sampleRows = [
    { omschrijving: 'Transport Amsterdam - Rotterdam', aantal: 1, prijs: 250.00, totaal: 250.00 },
    { omschrijving: 'Wachttijd', aantal: 2, prijs: 45.00, totaal: 90.00 },
    { omschrijving: 'Extra kilometers', aantal: 50, prijs: 0.23, totaal: 11.50 },
  ]
  const subtotaal = sampleRows.reduce((sum, row) => sum + row.totaal, 0)
  const btw = subtotaal * (layout.totals.btwPercentage / 100)
  const totaal = subtotaal + btw

  return (
    <div className="bg-white border rounded-lg shadow-sm p-6 text-sm flex flex-col" style={{ minHeight: '700px' }}>
      {/* Header */}
      <div className="grid grid-cols-3 gap-4 pb-4 border-b">
        <div>{renderField(layout.header.left)}</div>
        <div className="text-center">{renderField(layout.header.center)}</div>
        <div className="text-right">{renderField(layout.header.right)}</div>
      </div>

      {/* Subheader */}
      <div className="grid grid-cols-3 gap-4 py-4 border-b">
        <div>{renderField(layout.subheader.left)}</div>
        <div className="text-center">{renderField(layout.subheader.center)}</div>
        <div className="text-right">{renderField(layout.subheader.right)}</div>
      </div>

      {/* Table */}
      <div className="py-4 flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr style={{
              backgroundColor: layout.tableStyle?.headerBackground || '#1f2937',
              color: layout.tableStyle?.headerTextColor || '#ffffff',
              fontFamily: layout.tableStyle?.headerFont || 'Arial',
            }}>
              {layout.columns.map((col) => (
                <th
                  key={col.id}
                  style={{ width: `${col.breedte}%` }}
                  className="py-2 px-1 text-left font-semibold"
                >
                  {col.naam}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, i) => (
              <tr 
                key={i} 
                style={{
                  backgroundColor: i % 2 === 0 
                    ? (layout.tableStyle?.oddRowBackground || '#f9fafb')
                    : (layout.tableStyle?.evenRowBackground || '#ffffff'),
                  color: layout.tableStyle?.rowTextColor || '#1f2937',
                  fontFamily: layout.tableStyle?.rowFont || 'Arial',
                }}
              >
                {layout.columns.map((col) => (
                  <td key={col.id} className="py-2 px-1">
                    {col.type === 'prijs' || col.type === 'berekend'
                      ? `€ ${((row as Record<string, unknown>)[col.id] as number)?.toFixed(2) || '0.00'}`
                      : String((row as Record<string, unknown>)[col.id] || '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 text-xs">
            {layout.totals.showSubtotaal && (
              <div className="flex justify-between py-1">
                <span>Subtotaal (excl. BTW):</span>
                <span>€ {subtotaal.toFixed(2)}</span>
              </div>
            )}
            {layout.totals.showBtw && (
              <div className="flex justify-between py-1">
                <span>BTW ({layout.totals.btwPercentage}%):</span>
                <span>€ {btw.toFixed(2)}</span>
              </div>
            )}
            {layout.totals.showTotaal && (
              <div className="flex justify-between py-1 border-t border-gray-400 font-bold">
                <span>Totaal (incl. BTW):</span>
                <span>€ {totaal.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t mt-auto">
        <div>{renderField(layout.footer.left)}</div>
        <div className="text-center">{renderField(layout.footer.center)}</div>
        <div className="text-right">{renderField(layout.footer.right)}</div>
      </div>
    </div>
  )
}

// ============================================
// Main Template Editor Page
// ============================================
export default function TemplateEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isEditing = !!id

  const [templateName, setTemplateName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [layout, setLayout] = useState<TemplateLayout>(defaultLayout)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (id) {
      setIsLoading(true)
      getTemplate(id)
        .then((template) => {
          setTemplateName(template.naam)
          setDescription(template.beschrijving || '')
          setIsActive(template.is_active)
          if (template.layout) {
            setLayout({ ...defaultLayout, ...template.layout as TemplateLayout })
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false))
    }
  }, [id])

  const handleSave = async () => {
    if (!templateName.trim()) {
      alert(t('templates.editor.enterTemplateName'))
      return
    }

    setIsSaving(true)
    try {
      const data = {
        naam: templateName,
        beschrijving: description,
        actief: isActive,
        layout: layout as unknown as Record<string, unknown>,
        variables: {}
      }

      if (isEditing && id) {
        await updateTemplate(id, data)
      } else {
        await createTemplate(data)
      }
      navigate('/invoices/templates')
    } catch (error) {
      console.error('Save failed:', error)
      alert(t('templates.editor.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/invoices/templates')} className="p-2 hover:bg-gray-100 rounded">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold">
            {isEditing ? t('templates.editTemplate') : t('templates.newTemplate')}
          </h1>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50"
        >
          {isSaving ? t('templates.editor.saving') : t('templates.editor.saveTemplate')}
        </button>
      </div>

      {/* Content */}
      <div className="flex">
        {/* Editor Panel */}
        <div className="w-1/2 p-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 73px)' }}>
          {/* Basic info */}
          <div className="bg-white rounded-lg p-4 mb-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('templates.templateName')}</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="w-full border rounded p-2"
                  placeholder={t('templates.editor.templateNamePlaceholder')}
                />
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">{t('common.active')}</span>
                </label>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border rounded p-2 h-20"
                placeholder={t('templates.editor.descriptionPlaceholder')}
              />
            </div>
          </div>

          {/* Sections */}
          <div className="bg-white rounded-lg p-4 mb-4">
            <SectionEditor
              title={t('templates.editor.headerSection')}
              section={layout.header}
              onChange={(header) => setLayout({ ...layout, header })}
            />
            <SectionEditor
              title={t('templates.editor.subheaderSection')}
              section={layout.subheader}
              onChange={(subheader) => setLayout({ ...layout, subheader })}
            />
          </div>

          {/* Columns */}
          <div className="bg-white rounded-lg p-4 mb-4">
            <ColumnEditor
              columns={layout.columns}
              onChange={(columns) => setLayout({ ...layout, columns })}
            />
          </div>

          {/* Defaults & Totals */}
          <div className="bg-white rounded-lg p-4 mb-4">
            <DefaultsEditor
              defaults={layout.defaults}
              totals={layout.totals}
              onDefaultsChange={(defaults) => setLayout({ ...layout, defaults })}
              onTotalsChange={(totals) => setLayout({ ...layout, totals })}
            />
            <TableStyleEditor
              tableStyle={layout.tableStyle || defaultTableStyle}
              onChange={(tableStyle) => setLayout({ ...layout, tableStyle })}
            />
          </div>

          {/* Footer */}
          <div className="bg-white rounded-lg p-4">
            <SectionEditor
              title={t('templates.editor.footerSection')}
              section={layout.footer}
              onChange={(footer) => setLayout({ ...layout, footer })}
            />
          </div>
        </div>

        {/* Preview Panel */}
        <div className="w-1/2 bg-gray-200 p-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 73px)' }}>
          <h2 className="text-lg font-medium mb-4">{t('templates.editor.preview')}</h2>
          <div className="transform scale-75 origin-top">
            <PDFPreview layout={layout} templateName={templateName} />
          </div>
        </div>
      </div>
    </div>
  )
}

