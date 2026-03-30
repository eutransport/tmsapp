/**
 * Report Request Form Modal
 * Wizard-style form for creating a new report request.
 */
import { useState, useMemo } from 'react'
import {
  XMarkIcon,
  DocumentChartBarIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { User, Driver, Vehicle } from '@/types'
import { ReportTypeInfo, CreateReportRequest, ReportOutputFormat } from '@/api/reports'

interface Props {
  reportTypes: ReportTypeInfo[]
  users: User[]
  drivers: Driver[]
  vehicles: Vehicle[]
  companies: { id: string; naam: string }[]
  onSubmit: (data: CreateReportRequest) => Promise<void>
  onClose: () => void
  initialType?: ReportTypeInfo
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

export default function ReportRequestForm({ reportTypes, users, drivers, vehicles, companies, onSubmit, onClose, initialType }: Props) {
  const [step, setStep] = useState<'type' | 'params'>(initialType ? 'params' : 'type')
  const [selectedType, setSelectedType] = useState<ReportTypeInfo | null>(initialType ?? null)
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState(initialType?.label ?? '')
  const [outputFormat, setOutputFormat] = useState<ReportOutputFormat>('all')
  const [params, setParams] = useState<Record<string, string>>(() => {
    const defaultParams: Record<string, string> = {}
    if (initialType) {
      initialType.parameters.forEach((p) => {
        if (p.default === 'current_year') defaultParams[p.name] = String(CURRENT_YEAR)
      })
    }
    return defaultParams
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const filteredTypes = useMemo(
    () =>
      reportTypes.filter(
        (rt) =>
          rt.label.toLowerCase().includes(search.toLowerCase()) ||
          rt.description.toLowerCase().includes(search.toLowerCase()),
      ),
    [reportTypes, search],
  )

  const handleSelectType = (rt: ReportTypeInfo) => {
    setSelectedType(rt)
    setTitle(rt.label)
    // Default year param
    const defaultParams: Record<string, string> = {}
    rt.parameters.forEach((p) => {
      if (p.default === 'current_year') defaultParams[p.name] = String(CURRENT_YEAR)
    })
    setParams(defaultParams)
    setStep('params')
  }

  const handleParamChange = (name: string, value: string) => {
    setParams((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedType) return
    setIsSubmitting(true)
    try {
      await onSubmit({
        title,
        report_type: selectedType.value,
        parameters: params,
        output_format: outputFormat,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <DocumentChartBarIcon className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {step === 'type' ? 'Kies rapport type' : `Configureer: ${selectedType?.label}`}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Select type */}
        {step === 'type' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="px-6 pt-4">
              <input
                type="text"
                placeholder="Zoek rapport type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {filteredTypes.map((rt) => (
                <button
                  key={rt.value}
                  onClick={() => handleSelectType(rt)}
                  className="w-full text-left flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors group"
                >
                  <div>
                    <p className="font-medium text-gray-900 group-hover:text-blue-800">
                      {rt.label}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">{rt.description}</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-400 group-hover:text-blue-500 flex-shrink-0 ml-4" />
                </button>
              ))}
              {filteredTypes.length === 0 && (
                <p className="text-center text-gray-500 py-8">Geen rapport types gevonden</p>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Configure parameters */}
        {step === 'params' && selectedType && (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rapport titel
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Output format */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Uitvoer formaat
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { value: 'all', label: 'Alle formaten' },
                    { value: 'screen', label: 'Scherm' },
                    { value: 'excel', label: 'Excel' },
                    { value: 'pdf', label: 'PDF' },
                  ].map((fmt) => (
                    <button
                      key={fmt.value}
                      type="button"
                      onClick={() => setOutputFormat(fmt.value as ReportOutputFormat)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        outputFormat === fmt.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Parameters */}
              {selectedType.parameters.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">Parameters</p>
                  {selectedType.parameters.map((param) => (
                    <div key={param.name}>
                      <label className="block text-sm text-gray-600 mb-1">
                        {param.label}
                        {param.required && <span className="text-red-500 ml-1">*</span>}
                      </label>

                      {param.type === 'driver' && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Alle chauffeurs</option>
                          {drivers.filter(d => d.actief).map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.naam}{d.voertuig_kenteken ? ` (${d.voertuig_kenteken})` : ''}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'vehicle' && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Alle voertuigen</option>
                          {vehicles.filter(v => v.actief).map((v) => (
                            <option key={v.id} value={v.kenteken}>
                              {v.kenteken}{v.ritnummer ? ` – Rit ${v.ritnummer}` : ''}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'user' && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Alle medewerkers</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.voornaam} {u.achternaam} ({u.email})
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'company' && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Alle bedrijven</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.naam}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'year' && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Alle jaren</option>
                          {YEARS.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'date' && (
                        <input
                          type="date"
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}

                      {param.type === 'select' && param.options && (
                        <select
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {param.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {param.type === 'text' && (
                        <input
                          type="text"
                          value={params[param.name] ?? ''}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                          required={param.required}
                          placeholder={`Voer ${param.label.toLowerCase()} in`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setStep('type')}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                ← Terug
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting ? 'Verwerken...' : 'Rapport aanvragen'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
