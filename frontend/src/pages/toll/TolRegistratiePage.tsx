import { useState, useEffect, useRef, Fragment } from 'react'
import {
  PlusIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  PaperClipIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { TolRegistratie, createTolRegistratie, getTolRegistraties, deleteTolRegistratie, getTolDownloadUrl } from '@/api/tolregistratie'
import { getVehiclesForDropdown } from '@/api/fleet'
import { Vehicle } from '@/types'
import toast from 'react-hot-toast'
import api from '@/api/client'
import { formatBedrag, formatDate } from './utils'
import { Dialog, Transition } from '@headlessui/react'

export default function TolRegistratiePage() {
  const [datum, setDatum] = useState(new Date().toISOString().split('T')[0])
  const [kenteken, setKenteken] = useState('')
  const [totaalBedrag, setTotaalBedrag] = useState('')
  const [bijlage, setBijlage] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [registraties, setRegistraties] = useState<TolRegistratie[]>([])
  const [loading, setLoading] = useState(true)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // PDF viewer modal state
  const [pdfModalReg, setPdfModalReg] = useState<TolRegistratie | null>(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  useEffect(() => {
    loadRegistraties()
    loadVehicles()
  }, [])

  // Cleanup blob URL when modal closes
  useEffect(() => {
    if (!pdfModalReg && pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }
  }, [pdfModalReg, pdfBlobUrl])

  const loadRegistraties = async () => {
    try {
      setLoading(true)
      const response = await getTolRegistraties({ page_size: 100, ordering: '-datum' })
      setRegistraties(response.results)
    } catch {
      toast.error('Fout bij laden van tolregistraties')
    } finally {
      setLoading(false)
    }
  }

  const loadVehicles = async () => {
    try {
      const data = await getVehiclesForDropdown()
      setVehicles(data)
    } catch {
      // not critical
    }
  }

  const handleBedragChange = (value: string) => {
    const converted = value.replace(/\./g, ',')
    const cleaned = converted.replace(/[^0-9,]/g, '')
    const parts = cleaned.split(',')
    const result = parts.length > 2 ? parts[0] + ',' + parts.slice(1).join('') : cleaned
    setTotaalBedrag(result)
  }

  const normalizeBedrag = (value: string): string => {
    return value.replace(',', '.')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!bijlage) {
      setFormError('Bijlage is verplicht. Upload de tolfactuur.')
      return
    }
    if (!kenteken.trim()) {
      setFormError('Selecteer of voer een kenteken in.')
      return
    }
    if (!totaalBedrag) {
      setFormError('Voer het totaalbedrag in.')
      return
    }

    setSubmitting(true)
    try {
      await createTolRegistratie({
        datum,
        kenteken: kenteken.toUpperCase(),
        totaal_bedrag: normalizeBedrag(totaalBedrag),
        bijlage,
      })
      toast.success('Tolregistratie ingediend!')
      setDatum(new Date().toISOString().split('T')[0])
      setKenteken('')
      setTotaalBedrag('')
      setBijlage(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadRegistraties()
    } catch (err: any) {
      const msg = err.response?.data?.bijlage?.[0] || err.response?.data?.detail || 'Fout bij indienen'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = (id: string) => {
    setDeleteTarget(id)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteTolRegistratie(deleteTarget)
      toast.success('Verwijderd')
      setRegistraties(prev => prev.filter(r => r.id !== deleteTarget))
      setDeleteTarget(null)
    } catch {
      toast.error('Fout bij verwijderen')
    } finally {
      setDeleting(false)
    }
  }

  const handleViewBijlage = async (reg: TolRegistratie) => {
    if (!reg.bijlage_url) return
    setPdfModalReg(reg)
    setPdfLoading(true)
    try {
      const response = await api.get(getTolDownloadUrl(reg.id), { responseType: 'blob' })
      const blob = new Blob([response.data], { type: response.headers['Content-Type'] || response.headers['content-type'] || 'application/pdf' })
      const url = URL.createObjectURL(blob)
      setPdfBlobUrl(url)
    } catch {
      toast.error('Fout bij laden van bijlage')
      setPdfModalReg(null)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleClosePdfModal = () => {
    setPdfModalReg(null)
  }

  const handleDownload = async (reg: TolRegistratie) => {
    try {
      const response = await api.get(getTolDownloadUrl(reg.id), { responseType: 'blob' })
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = reg.bijlage_naam || `tol-${reg.id}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Fout bij downloaden')
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Tolregistratie</h1>
        <p className="text-sm text-gray-500">Registreer tolkosten en upload de tolfactuur</p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Nieuwe tolregistratie</h2>
        <form onSubmit={handleSubmit}>
          {formError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Datum */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
              <input
                type="date"
                value={datum}
                onChange={e => setDatum(e.target.value)}
                required
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2 px-3 border"
              />
            </div>

            {/* Kenteken / Wagen */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Wagen *</label>
              {vehicles.length > 0 ? (
                <select
                  value={kenteken}
                  onChange={e => setKenteken(e.target.value)}
                  required
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2 px-3 border"
                >
                  <option value="">Selecteer wagen...</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.kenteken}>{v.kenteken}{v.ritnummer ? ` (${v.ritnummer})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={kenteken}
                  onChange={e => setKenteken(e.target.value.toUpperCase())}
                  placeholder="Bijv. AB-123-CD"
                  required
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2 px-3 border"
                />
              )}
            </div>

            {/* Bedrag */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Totaal bedrag *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={totaalBedrag}
                  onChange={e => handleBedragChange(e.target.value)}
                  placeholder="0,00"
                  required
                  className="w-full pl-7 rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm py-2 px-3 border"
                />
              </div>
            </div>

            {/* Bijlage */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tolfactuur (bijlage) *</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                onChange={e => setBijlage(e.target.files?.[0] || null)}
                required
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 border border-gray-300 rounded-md py-1.5 px-2"
              />
              {bijlage && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <PaperClipIcon className="w-3 h-3" /> {bijlage.name}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              <PlusIcon className="w-4 h-4" />
              {submitting ? 'Indienen...' : 'Indienen'}
            </button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Mijn tolregistraties</h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : registraties.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <PaperClipIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nog geen tolregistraties</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Wagen</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Bijlage</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {registraties.map(reg => (
                    <tr key={reg.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(reg.datum)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{reg.kenteken}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatBedrag(reg.totaal_bedrag)}</td>
                      <td className="px-4 py-2 text-center">
                        {reg.bijlage_url ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleViewBijlage(reg)}
                              className="p-1 text-blue-600 hover:text-blue-800"
                              title="Bekijken"
                            >
                              <EyeIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDownload(reg)}
                              className="p-1 text-gray-500 hover:text-gray-700"
                              title="Downloaden"
                            >
                              <ArrowDownTrayIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          reg.gefactureerd
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {reg.gefactureerd ? 'Gefactureerd' : 'Ingediend'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => handleDelete(reg.id)}
                          className="p-1 text-gray-400 hover:text-red-600"
                          title="Verwijderen"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-gray-100">
              {registraties.map(reg => (
                <div key={reg.id} className="px-3 py-2 hover:bg-gray-50">
                  {/* Row 1: datum, kenteken, bedrag */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 shrink-0">{formatDate(reg.datum)}</span>
                      <span className="text-xs font-mono text-gray-600 truncate">{reg.kenteken}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 shrink-0">{formatBedrag(reg.totaal_bedrag)}</span>
                  </div>

                  {/* Row 2: status + actions */}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      reg.gefactureerd
                        ? 'bg-green-100 text-green-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {reg.gefactureerd ? 'Gefactureerd' : 'Ingediend'}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {reg.bijlage_url && (
                        <>
                          <button
                            onClick={() => handleViewBijlage(reg)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                            title="Bekijken"
                          >
                            <EyeIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDownload(reg)}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                            title="Downloaden"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(reg.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Verwijderen"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      <Transition appear show={!!deleteTarget} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => !deleting && setDeleteTarget(null)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
                    </div>
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      Tolregistratie verwijderen
                    </Dialog.Title>
                  </div>
                  <p className="text-gray-600 mb-6">
                    Weet je zeker dat je deze tolregistratie wilt verwijderen?
                  </p>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Annuleren
                    </button>
                    <button
                      onClick={handleDeleteConfirm}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? 'Bezig...' : 'Verwijderen'}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* PDF viewer modal */}
      <Transition appear show={!!pdfModalReg} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleClosePdfModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col" style={{ maxHeight: '90vh' }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <Dialog.Title className="text-base font-semibold text-gray-900">
                      Bijlage — {pdfModalReg && `${formatDate(pdfModalReg.datum)} · ${pdfModalReg.kenteken}`}
                    </Dialog.Title>
                    <div className="flex items-center gap-2">
                      {pdfModalReg && (
                        <button
                          onClick={() => handleDownload(pdfModalReg)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" /> Download
                        </button>
                      )}
                      <button
                        onClick={handleClosePdfModal}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden" style={{ minHeight: '60vh' }}>
                    {pdfLoading ? (
                      <div className="flex items-center justify-center h-full py-16">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                      </div>
                    ) : pdfBlobUrl ? (
                      <iframe
                        src={pdfBlobUrl}
                        className="w-full h-full border-0"
                        style={{ minHeight: '60vh' }}
                        title="Tolfactuur bijlage"
                      />
                    ) : null}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
