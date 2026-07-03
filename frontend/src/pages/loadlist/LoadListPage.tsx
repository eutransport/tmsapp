import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  MapPinIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import clsx from '@/utils/clsx'
import { loadlistApi, LoadList, LoadStop, StopWrite } from '@/api/loadlist'

const STATUS_LABELS: Record<LoadList['status'], string> = {
  uploaded: 'Geüpload',
  parsing: 'Bezig met inlezen…',
  parsed: 'Ingelezen',
  optimizing: 'Bezig met optimaliseren…',
  optimized: 'Geoptimaliseerd',
  error: 'Fout',
}

const STATUS_COLORS: Record<LoadList['status'], string> = {
  uploaded: 'bg-gray-100 text-gray-700',
  parsing: 'bg-blue-100 text-blue-700',
  parsed: 'bg-indigo-100 text-indigo-700',
  optimizing: 'bg-blue-100 text-blue-700',
  optimized: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
}

function formatKm(m: number | null): string {
  if (m === null || m === undefined) return '—'
  return `${(m / 1000).toFixed(1)} km`
}

export default function LoadListPage() {
  const [lists, setLists] = useState<LoadList[]>([])
  const [selected, setSelected] = useState<LoadList | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [name, setName] = useState('')
  const [startAddress, setStartAddress] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [zoomOpen, setZoomOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function refresh() {
    setLoading(true)
    try {
      const data = await loadlistApi.list()
      setLists(data)
      if (!selected && data.length) {
        const first = await loadlistApi.get(data[0].id)
        setSelected(first)
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon laadlijsten niet ophalen.')
    } finally {
      setLoading(false)
    }
  }

  async function pickAndUpload() {
    if (!file) {
      toast.error('Kies eerst een foto.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Bestand is te groot (max 10 MB).')
      return
    }
    setUploading(true)
    try {
      const created = await loadlistApi.upload({
        photo: file,
        name: name.trim(),
        start_address: startAddress.trim(),
      })
      toast.success(created.status_message || 'Lijst ingelezen.')
      setLists(prev => [created, ...prev.filter(l => l.id !== created.id)])
      setSelected(created)
      setFile(null); setName(''); setStartAddress('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Uploaden mislukt.')
    } finally {
      setUploading(false)
    }
  }

  async function selectList(id: string) {
    try {
      const full = await loadlistApi.get(id)
      setSelected(full)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon lijst niet openen.')
    }
  }

  async function removeList(id: string) {
    if (!confirm('Deze laadlijst verwijderen?')) return
    try {
      await loadlistApi.remove(id)
      setLists(prev => prev.filter(l => l.id !== id))
      if (selected?.id === id) setSelected(null)
      toast.success('Verwijderd.')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Verwijderen mislukt.')
    }
  }

  async function saveDepot(newStart: string) {
    if (!selected) return
    try {
      const updated = await loadlistApi.update(selected.id, { start_address: newStart })
      // Preserve stops
      setSelected({ ...updated, stops: selected.stops })
      setLists(prev => prev.map(l => l.id === updated.id ? { ...l, start_address: updated.start_address } : l))
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon startadres niet opslaan.')
    }
  }

  async function runOptimize() {
    if (!selected) return
    if (!selected.start_address.trim()) {
      toast.error('Vul eerst een startadres in.')
      return
    }
    setOptimizing(true)
    try {
      const updated = await loadlistApi.optimize(selected.id)
      setSelected(updated)
      setLists(prev => prev.map(l => l.id === updated.id ? { ...l, status: updated.status, total_distance_m: updated.total_distance_m } : l))
      toast.success(updated.status_message || 'Route berekend.')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Optimaliseren mislukt.')
    } finally {
      setOptimizing(false)
    }
  }

  async function updateStop(stopId: string, patch: StopWrite) {
    if (!selected) return
    try {
      const updated = await loadlistApi.updateStop(selected.id, stopId, patch)
      setSelected({
        ...selected,
        stops: selected.stops.map(s => s.id === stopId ? updated : s),
        status: 'parsed',
      })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon stop niet bijwerken.')
    }
  }

  async function deleteStop(stopId: string) {
    if (!selected) return
    if (!confirm('Deze stop verwijderen?')) return
    try {
      await loadlistApi.deleteStop(selected.id, stopId)
      setSelected({ ...selected, stops: selected.stops.filter(s => s.id !== stopId) })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Verwijderen mislukt.')
    }
  }

  async function addStop() {
    if (!selected) return
    const addr = prompt('Adres van nieuwe stop:')?.trim()
    if (!addr) return
    try {
      const created = await loadlistApi.addStop(selected.id, { address_raw: addr })
      setSelected({ ...selected, stops: [...selected.stops, created], status: 'parsed' })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Toevoegen mislukt.')
    }
  }

  const loadOrder = useMemo(() => {
    if (!selected) return []
    // Sort by load_sequence ascending: 0 = load LAST (closest to back door → first off).
    return [...selected.stops]
      .filter(s => s.load_sequence !== null && s.load_sequence !== undefined)
      .sort((a, b) => (a.load_sequence! - b.load_sequence!))
  }, [selected])

  const deliveryOrder = useMemo(() => {
    if (!selected) return []
    return [...selected.stops]
      .filter(s => s.delivery_sequence !== null && s.delivery_sequence !== undefined)
      .sort((a, b) => (a.delivery_sequence! - b.delivery_sequence!))
  }, [selected])

  return (
    <div className="page-container">
      <h1 className="page-title mb-2 flex items-center gap-2">
        <TruckIcon className="h-7 w-7 text-primary-600" />
        Laadlijsten
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Upload een foto van een adressenlijst. Het systeem leest de adressen,
        geocodeert ze en berekent de beste rijvolgorde. De laadvolgorde is
        omgekeerd: <strong>eerste levering achterin, laatste levering vooraan</strong>.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <ArrowUpTrayIcon className="h-5 w-5" /> Nieuwe lijst
            </h2>
            <label className="block text-xs text-gray-600 mb-1">Naam (optioneel)</label>
            <input
              type="text"
              className="input w-full mb-3"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="bv. Rit maandag"
              maxLength={120}
            />
            <label className="block text-xs text-gray-600 mb-1">Startadres (depot)</label>
            <input
              type="text"
              className="input w-full mb-3"
              value={startAddress}
              onChange={e => setStartAddress(e.target.value)}
              placeholder="Straat, postcode plaats, land"
              maxLength={250}
              autoComplete="street-address"
            />
            <label className="block text-xs text-gray-600 mb-1">Foto van adressenlijst</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs mb-3"
            />
            {preview && (
              <img src={preview} alt="Voorbeeld" className="w-full max-h-48 object-contain rounded-md border border-gray-200 mb-3" />
            )}
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!file || uploading}
              onClick={pickAndUpload}
            >
              {uploading ? 'Bezig…' : 'Inlezen'}
            </button>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Mijn lijsten</h2>
              <button type="button" onClick={refresh} className="text-gray-500 hover:text-gray-700" aria-label="Vernieuwen">
                <ArrowPathIcon className="h-4 w-4" />
              </button>
            </div>
            {loading && <p className="text-xs text-gray-500">Laden…</p>}
            {!loading && lists.length === 0 && (
              <p className="text-xs text-gray-500">Nog geen lijsten.</p>
            )}
            <ul className="space-y-1">
              {lists.map(l => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => selectList(l.id)}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-md text-sm transition-colors touch-manipulation',
                      selected?.id === l.id ? 'bg-primary-50 text-primary-800' : 'hover:bg-gray-50 text-gray-700'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{l.name || `Lijst ${l.id.slice(0, 6)}`}</span>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', STATUS_COLORS[l.status])}>
                        {STATUS_LABELS[l.status]}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {new Date(l.created_at).toLocaleDateString('nl-NL')} · {l.stop_count} stops
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Detail */}
        <div>
          {!selected && (
            <div className="card p-8 text-center text-gray-500">
              <PhotoIcon className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              Selecteer of upload een lijst.
            </div>
          )}

          {selected && (
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">
                      {selected.name || `Lijst ${selected.id.slice(0, 8)}`}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {STATUS_LABELS[selected.status]} · {selected.stops.length} stops
                      {selected.total_distance_m !== null && ` · ${formatKm(selected.total_distance_m)}`}
                      {selected.extraction_provider && ` · ${selected.extraction_provider.split(':')[0]}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeList(selected.id)}
                    className="text-red-600 hover:bg-red-50 rounded-md p-2 touch-manipulation"
                    aria-label="Verwijderen"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>

                {selected.status_message && (
                  <div className={clsx(
                    'text-xs px-3 py-2 rounded-md mb-3',
                    selected.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                  )}>
                    {selected.status_message}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <input
                    type="text"
                    className="input flex-1"
                    value={selected.start_address}
                    onChange={e => setSelected({ ...selected, start_address: e.target.value })}
                    onBlur={e => saveDepot(e.target.value)}
                    placeholder="Startadres (depot)"
                    maxLength={250}
                    autoComplete="street-address"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={runOptimize}
                    disabled={optimizing || !selected.start_address.trim() || selected.stops.length === 0}
                  >
                    <SparklesIcon className="h-4 w-4 mr-1.5" />
                    {optimizing ? 'Bezig…' : 'Bereken laadvolgorde'}
                  </button>
                </div>

                {selected.photo_url && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Toon originele foto</summary>
                    <img
                      src={selected.photo_url}
                      alt="Origineel"
                      className="w-full max-h-96 object-contain rounded-md border border-gray-200 mt-2 cursor-zoom-in"
                      onClick={() => setZoomOpen(true)}
                      title="Klik om te vergroten"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Klik op de foto om te vergroten.</p>
                  </details>
                )}
              </div>

              {loadOrder.length > 0 && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                    <TruckIcon className="h-5 w-5 text-primary-600" />
                    Laadvolgorde ({loadOrder.length})
                    <span className="text-xs font-normal text-gray-500">1 = eerst laden (vooraan) → laatst lossen</span>
                  </h3>
                  <ol className="space-y-1.5">
                    {loadOrder.map((s, idx) => (
                      <li key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-gray-50">
                        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-600 text-white text-sm font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{s.address_raw}</div>
                          {s.address_formatted && s.address_formatted !== s.address_raw && (
                            <div className="text-[11px] text-gray-500 truncate">{s.address_formatted}</div>
                          )}
                        </div>
                        {s.reference && <span className="text-[11px] text-gray-500">{s.reference}</span>}
                        <span className="text-[11px] text-gray-400 tabular-nums">
                          lever #{(s.delivery_sequence ?? 0) + 1}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {deliveryOrder.length !== loadOrder.length && (
                    <p className="text-xs text-amber-700 mt-2">
                      Sommige adressen konden niet worden gevonden en zijn niet in de route opgenomen.
                    </p>
                  )}
                </div>
              )}

              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <MapPinIcon className="h-5 w-5" />
                    Stops ({selected.stops.length})
                  </h3>
                  <button type="button" onClick={addStop} className="btn btn-secondary btn-sm">
                    <PlusIcon className="h-4 w-4 mr-1" />
                    Toevoegen
                  </button>
                </div>

                {selected.stops.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-6">Geen stops. Voeg er handmatig een toe.</p>
                )}

                <ul className="divide-y divide-gray-100">
                  {[...selected.stops].sort((a, b) => a.original_sequence - b.original_sequence).map(s => (
                    <StopRow
                      key={s.id}
                      stop={s}
                      onSave={patch => updateStop(s.id, patch)}
                      onDelete={() => deleteStop(s.id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {zoomOpen && selected?.photo_url && (
        <ImageZoomViewer src={selected.photo_url} onClose={() => setZoomOpen(false)} />
      )}
    </div>
  )
}

interface StopRowProps {
  stop: LoadStop
  onSave: (patch: StopWrite) => void
  onDelete: () => void
}

function StopRow({ stop, onSave, onDelete }: StopRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<StopWrite>({
    address_raw: stop.address_raw,
    postcode: stop.postcode,
    city: stop.city,
    country: stop.country,
    reference: stop.reference,
    colli: stop.colli,
    pallets: stop.pallets,
    weight_kg: stop.weight_kg,
    notes: stop.notes,
  })

  function save() {
    onSave(draft)
    setEditing(false)
  }

  if (!editing) {
    return (
      <li className="py-3 flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold flex items-center justify-center mt-0.5">
          {stop.original_sequence + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900">{stop.address_raw}</div>
          <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {stop.postcode && <span>{stop.postcode}</span>}
            {stop.city && <span>{stop.city}</span>}
            {stop.reference && <span>#{stop.reference}</span>}
            {stop.colli !== null && <span>{stop.colli} colli</span>}
            {stop.pallets !== null && <span>{stop.pallets} pallets</span>}
            {stop.weight_kg !== null && <span>{stop.weight_kg} kg</span>}
            {stop.geocode_error && <span className="text-red-600">⚠ {stop.geocode_error}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setEditing(true)} className="p-1.5 text-gray-500 hover:text-gray-800 touch-manipulation" aria-label="Bewerk">
            <PencilSquareIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} className="p-1.5 text-red-500 hover:text-red-700 touch-manipulation" aria-label="Verwijder">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className="input sm:col-span-2" value={draft.address_raw ?? ''}
          onChange={e => setDraft({ ...draft, address_raw: e.target.value })} placeholder="Adres" maxLength={300} />
        <input className="input" value={draft.postcode ?? ''}
          onChange={e => setDraft({ ...draft, postcode: e.target.value })} placeholder="Postcode" maxLength={20} />
        <input className="input" value={draft.city ?? ''}
          onChange={e => setDraft({ ...draft, city: e.target.value })} placeholder="Plaats" maxLength={120} />
        <input className="input" value={draft.country ?? ''}
          onChange={e => setDraft({ ...draft, country: e.target.value })} placeholder="Land (bv. NL)" maxLength={80} />
        <input className="input" value={draft.reference ?? ''}
          onChange={e => setDraft({ ...draft, reference: e.target.value })} placeholder="Referentie" maxLength={80} />
        <input className="input" type="number" min={0} value={draft.colli ?? ''}
          onChange={e => setDraft({ ...draft, colli: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Colli" />
        <input className="input" type="number" min={0} value={draft.pallets ?? ''}
          onChange={e => setDraft({ ...draft, pallets: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Pallets" />
        <input className="input" type="number" step="0.1" min={0} value={draft.weight_kg ?? ''}
          onChange={e => setDraft({ ...draft, weight_kg: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Gewicht (kg)" />
        <input className="input sm:col-span-2" value={draft.notes ?? ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Notities" maxLength={250} />
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Annuleren</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>Opslaan</button>
      </div>
    </li>
  )
}

interface ImageZoomViewerProps { src: string; onClose: () => void }

function ImageZoomViewer({ src, onClose }: ImageZoomViewerProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef<{ x: number; y: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(8, s * 1.25))
      if (e.key === '-') setScale(s => Math.max(0.5, s / 1.25))
      if (e.key === '0') { setScale(1); setOffset({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setScale(s => Math.max(0.5, Math.min(8, s * factor)))
  }

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y })
  }
  const endDrag = () => { dragging.current = null }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinch.current = { dist: Math.hypot(dx, dy), scale }
    } else if (e.touches.length === 1) {
      dragging.current = { x: e.touches[0].clientX - offset.x, y: e.touches[0].clientY - offset.y }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const d = Math.hypot(dx, dy)
      const next = Math.max(0.5, Math.min(8, pinch.current.scale * (d / pinch.current.dist)))
      setScale(next)
    } else if (e.touches.length === 1 && dragging.current) {
      setOffset({ x: e.touches[0].clientX - dragging.current.x, y: e.touches[0].clientY - dragging.current.y })
    }
  }
  const onTouchEnd = () => { dragging.current = null; pinch.current = null }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center touch-none"
      onClick={onClose}
    >
      <div className="absolute top-3 right-3 flex gap-2 z-10" onClick={e => e.stopPropagation()}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScale(s => Math.max(0.5, s / 1.25))}>−</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>100%</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScale(s => Math.min(8, s * 1.25))}>+</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Sluiten</button>
      </div>
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt="Origineel vergroot"
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: dragging.current || pinch.current ? 'none' : 'transform 0.05s linear',
            maxWidth: 'none',
            maxHeight: 'none',
          }}
          className="pointer-events-none"
        />
      </div>
    </div>
  )
}
