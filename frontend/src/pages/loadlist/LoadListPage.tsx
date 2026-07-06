/**
 * Laadlijst wizard — step-by-step flow to build an optimised loading list.
 *
 * Steps:
 *   1. Startpunt (depot)  — dropdown of admin-configured depots
 *   2. Begintijd          — HH:MM
 *   3. Eindtijd           — HH:MM (optional)
 *   4. Ritlijsten         — one or more photo uploads (extraction accumulates stops)
 *   5. Optimaliseren      — trigger + show loading order (last drop first)
 *
 * Mobile-first, single column on phone, two columns on desktop.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowLeftIcon, ArrowRightIcon, ArrowUpTrayIcon, BuildingOffice2Icon,
  CheckCircleIcon, ClockIcon, MapPinIcon, PhotoIcon, PlusIcon,
  SparklesIcon, TrashIcon, TruckIcon, XMarkIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import clsx from '@/utils/clsx'
import { loadlistApi, LoadList, LoadStop, Depot } from '@/api/loadlist'
import { AddressAutocomplete } from './AddressAutocomplete'
import { ImageZoomViewer } from './ImageZoomViewer'

const STEPS = [
  { id: 1, title: 'Startpunt', icon: BuildingOffice2Icon },
  { id: 2, title: 'Begintijd', icon: ClockIcon },
  { id: 3, title: 'Eindtijd', icon: ClockIcon },
  { id: 4, title: 'Ritlijst', icon: PhotoIcon },
  { id: 5, title: 'Optimaliseren', icon: SparklesIcon },
] as const

function hhmm(v: string | null | undefined): string {
  if (!v) return ''
  return v.length >= 5 ? v.slice(0, 5) : v
}

function formatKm(m: number | null): string {
  if (m === null || m === undefined) return '—'
  return `${(m / 1000).toFixed(1)} km`
}

/** Add `minutes` to a 'HH:MM' string and return the resulting 'HH:MM'. */
function addMinutes(hhmmStr: string, minutes: number): string {
  const [h, m] = hhmmStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = Math.floor(wrapped / 60).toString().padStart(2, '0')
  const mm = (wrapped % 60).toString().padStart(2, '0')
  return `${hh}:${mm}`
}

export default function LoadListPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.rol === 'admin'

  // ── Wizard state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(1)
  const [depots, setDepots] = useState<Depot[]>([])
  const [depotId, setDepotId] = useState<string>('')
  const [customAddress, setCustomAddress] = useState<string>('')
  const [startTime, setStartTime] = useState<string>('08:00')
  const [endTime, setEndTime] = useState<string>('')
  const [uploads, setUploads] = useState<File[]>([])
  const [loadlist, setLoadlist] = useState<LoadList | null>(null)
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)

  const [showDepotAdmin, setShowDepotAdmin] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)

  // ── History ───────────────────────────────────────────────────────────
  const [history, setHistory] = useState<LoadList[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  async function refreshHistory() {
    try {
      const all = await loadlistApi.list()
      // Newest first, cap to 30 for the UI
      const sorted = [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30)
      setHistory(sorted)
    } catch { /* ignore */ }
  }

  // ── Load depots + history on mount ────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const list = await loadlistApi.depots.list()
        setDepots(list)
        const def = list.find(d => d.is_default && d.is_active) ?? list.find(d => d.is_active)
        if (def) setDepotId(def.id)
      } catch {
        if (isAdmin) toast.error('Depots konden niet worden geladen.')
      }
      refreshHistory()
    })()
  }, [isAdmin])

  // Refresh history whenever a loadlist changes (create / optimize / delete)
  useEffect(() => { refreshHistory() }, [loadlist?.id, loadlist?.updated_at])

  async function openFromHistory(id: string) {
    try {
      const full = await loadlistApi.get(id)
      setLoadlist(full)
      setUploads([])
      if (full.start_time) setStartTime(hhmm(full.start_time))
      if (full.end_time) setEndTime(hhmm(full.end_time))
      // Pre-select the matching depot if this list came from one
      const match = depots.find(d => d.address === full.start_address)
      if (match) { setDepotId(match.id); setCustomAddress('') }
      else { setDepotId(''); setCustomAddress(full.start_address) }
      setStep(5)
      setHistoryOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon lijst niet openen.')
    }
  }

  async function deleteFromHistory(id: string, name: string) {
    if (!confirm(`Laadlijst "${name}" definitief verwijderen?`)) return
    try {
      await loadlistApi.remove(id)
      toast.success('Verwijderd.')
      if (loadlist?.id === id) {
        setLoadlist(null)
        setStep(1)
      }
      refreshHistory()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Verwijderen mislukt.')
    }
  }

  const selectedDepot = useMemo(
    () => depots.find(d => d.id === depotId) ?? null,
    [depots, depotId],
  )
  const startAddress = selectedDepot?.address ?? customAddress
  const canGoNext = (() => {
    if (step === 1) return startAddress.trim().length > 3
    if (step === 2) return /^\d{2}:\d{2}$/.test(startTime)
    if (step === 3) return endTime === '' || /^\d{2}:\d{2}$/.test(endTime)
    if (step === 4) return uploads.length > 0 || (loadlist && loadlist.stops.length > 0)
    return true
  })()

  async function performUploads() {
    if (uploads.length === 0) return loadlist
    setUploading(true)
    let current = loadlist
    try {
      for (let i = 0; i < uploads.length; i++) {
        const f = uploads[i]
        if (i === 0 && !current) {
          current = await loadlistApi.upload({
            photo: f,
            start_address: startAddress,
            start_time: startTime,
            end_time: endTime || undefined,
            name: `Rit ${new Date().toLocaleDateString('nl-NL')}`,
          })
        } else if (current) {
          current = await loadlistApi.appendPhoto(current.id, f)
        }
      }
      setLoadlist(current)
      setUploads([])
      toast.success(current?.status_message || `${current?.stops.length ?? 0} stops ingelezen.`)
      return current
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Uploaden mislukt.')
      return current
    } finally {
      setUploading(false)
    }
  }

  async function performOptimize() {
    if (!loadlist) return
    setOptimizing(true)
    try {
      const updated = await loadlistApi.optimize(loadlist.id)
      // Defensive: some setups may return the list without stops — re-fetch.
      const withStops = (updated.stops && updated.stops.length > 0)
        ? updated
        : await loadlistApi.get(loadlist.id)
      setLoadlist(withStops)
      toast.success(withStops.status_message || 'Route berekend.')
      // Scroll to the top of the result panel after a beat.
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Optimaliseren mislukt.')
    } finally {
      setOptimizing(false)
    }
  }

  async function handleNext() {
    if (!canGoNext) return
    if (step === 4) {
      const ll = await performUploads()
      if (!ll) return
      setStep(5)
      return
    }
    setStep(s => Math.min(5, s + 1))
  }

  function handleBack() { setStep(s => Math.max(1, s - 1)) }

  function resetWizard() {
    if (loadlist && !confirm('Huidige laadlijst weggooien en opnieuw beginnen?')) return
    setLoadlist(null)
    setUploads([])
    setStep(1)
  }

  const deliveryOrder = useMemo(() => {
    if (!loadlist) return []
    return [...loadlist.stops]
      .filter(s => s.delivery_sequence !== null)
      .sort((a, b) => (a.delivery_sequence! - b.delivery_sequence!))
  }, [loadlist])

  const loadOrder = useMemo(() => {
    if (!loadlist) return []
    return [...loadlist.stops]
      .filter(s => s.load_sequence !== null)
      .sort((a, b) => (a.load_sequence! - b.load_sequence!))
  }, [loadlist])

  return (
    <div className="page-container">
      <h1 className="page-title mb-2 flex items-center gap-2">
        <TruckIcon className="h-7 w-7 text-primary-600" />
        Laadlijst maken
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Volg de stappen. Aan het eind zie je in welke volgorde je moet laden
        (laatste levering achterin, eerste levering vooraan bij de deur).
      </p>

      <HistoryPanel
        history={history}
        isOpen={historyOpen}
        onToggle={() => setHistoryOpen(v => !v)}
        onOpen={openFromHistory}
        onDelete={deleteFromHistory}
        currentId={loadlist?.id ?? null}
      />

      <StepIndicator current={step} />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="card p-4 sm:p-6">
          {step === 1 && (
            <Step1Depot
              depots={depots}
              depotId={depotId}
              onDepotIdChange={setDepotId}
              customAddress={customAddress}
              onCustomAddressChange={setCustomAddress}
              isAdmin={isAdmin}
              onOpenAdmin={() => setShowDepotAdmin(true)}
            />
          )}
          {step === 2 && (
            <StepTime
              title="Stap 2 · Begintijd"
              description="Om hoe laat vertrek je vanaf het depot?"
              value={startTime}
              onChange={setStartTime}
              required
            />
          )}
          {step === 3 && (
            <StepTime
              title="Stap 3 · Eindtijd (optioneel)"
              description="Om hoe laat moet je uiterlijk terug zijn op het depot? Laat leeg als er geen deadline is."
              value={endTime}
              onChange={setEndTime}
            />
          )}
          {step === 4 && (
            <Step4Upload
              uploads={uploads}
              setUploads={setUploads}
              existingCount={loadlist?.stops.length ?? 0}
              uploading={uploading}
            />
          )}
          {step === 5 && (
            <Step5Result
              loadlist={loadlist}
              deliveryOrder={deliveryOrder}
              loadOrder={loadOrder}
              startTime={startTime}
              endTime={endTime}
              optimizing={optimizing}
              onOptimize={performOptimize}
              onOpenZoom={() => setZoomOpen(true)}
            />
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleBack}
              disabled={step === 1 || uploading || optimizing}
            >
              <ArrowLeftIcon className="h-4 w-4 mr-1.5" />
              Terug
            </button>
            {step < 5 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleNext}
                disabled={!canGoNext || uploading}
              >
                {step === 4 && uploading ? 'Bezig…' : 'Volgende'}
                <ArrowRightIcon className="h-4 w-4 ml-1.5" />
              </button>
            )}
            {step === 5 && loadlist?.status === 'optimized' && (
              <button type="button" className="btn btn-primary" onClick={resetWizard}>
                Nieuwe lijst
                <PlusIcon className="h-4 w-4 ml-1.5" />
              </button>
            )}
          </div>
        </div>

        <aside className="card p-4 h-fit lg:sticky lg:top-4 text-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Overzicht</h3>
          <dl className="space-y-2 text-xs">
            <SummaryRow label="Startpunt" value={startAddress || <em className="text-gray-400">nog niet gekozen</em>} />
            <SummaryRow label="Begintijd" value={startTime || <em className="text-gray-400">—</em>} />
            <SummaryRow label="Eindtijd" value={endTime || <em className="text-gray-400">optioneel</em>} />
            <SummaryRow label="Ritlijsten" value={
              (loadlist?.stops.length ?? 0) === 0 && uploads.length === 0
                ? <em className="text-gray-400">nog niet</em>
                : `${uploads.length} nieuw · ${loadlist?.stops.length ?? 0} stops ingelezen`
            } />
            {loadlist?.total_distance_m != null && (
              <SummaryRow label="Afstand" value={formatKm(loadlist.total_distance_m)} />
            )}
          </dl>
        </aside>
      </div>

      {showDepotAdmin && (
        <DepotAdminModal
          depots={depots}
          onClose={() => setShowDepotAdmin(false)}
          onChange={setDepots}
        />
      )}

      {zoomOpen && loadlist?.photo_url && (
        <ImageZoomViewer src={loadlist.photo_url} onClose={() => setZoomOpen(false)} />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
function HistoryPanel({
  history, isOpen, onToggle, onOpen, onDelete, currentId,
}: {
  history: LoadList[]
  isOpen: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onDelete: (id: string, name: string) => void
  currentId: string | null
}) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <ClockIcon className="h-5 w-5 text-gray-500" />
          Eerdere laadlijsten
          <span className="text-xs text-gray-500">({history.length})</span>
        </span>
        <ArrowRightIcon className={clsx('h-4 w-4 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
          {history.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-500">
              Nog geen laadlijsten opgeslagen.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map(item => {
                const isCurrent = item.id === currentId
                const km = item.total_distance_m != null ? `${(item.total_distance_m / 1000).toFixed(1)} km` : null
                const when = new Date(item.updated_at).toLocaleString('nl-NL', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })
                return (
                  <li
                    key={item.id}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-2.5 text-sm',
                      isCurrent && 'bg-primary-50',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {item.name || 'Zonder naam'}
                        {isCurrent && <span className="ml-2 text-xs text-primary-700">(open)</span>}
                      </div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-2 mt-0.5">
                        <span>{when}</span>
                        <span>·</span>
                        <span>{item.stop_count} stops</span>
                        {km && <><span>·</span><span>{km}</span></>}
                        <span>·</span>
                        <span className={clsx(
                          item.status === 'optimized' ? 'text-green-700'
                            : item.status === 'error' ? 'text-red-700'
                            : 'text-blue-700',
                        )}>{item.status}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm text-xs px-2 py-1"
                      onClick={() => onOpen(item.id)}
                    >
                      Openen
                    </button>
                    <button
                      type="button"
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Verwijderen"
                      onClick={() => onDelete(item.id, item.name || 'Zonder naam')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1">
      {STEPS.map(s => {
        const done = s.id < current
        const active = s.id === current
        const Icon = s.icon
        return (
          <li key={s.id} className="flex-1 min-w-[70px]">
            <div className={clsx(
              'flex items-center gap-2 px-2 py-2 rounded-md border text-xs sm:text-sm',
              active ? 'border-primary-500 bg-primary-50 text-primary-800'
                : done ? 'border-green-300 bg-green-50 text-green-800'
                : 'border-gray-200 bg-white text-gray-500',
            )}>
              <div className={clsx(
                'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold',
                active ? 'bg-primary-600 text-white' : done ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600',
              )}>
                {done ? <CheckCircleIcon className="h-4 w-4" /> : s.id}
              </div>
              <span className="hidden sm:inline truncate">{s.title}</span>
              <Icon className="h-4 w-4 sm:hidden" />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-100 pb-1.5">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right break-words min-w-0 flex-1">{value}</dd>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
interface Step1Props {
  depots: Depot[]
  depotId: string
  onDepotIdChange: (v: string) => void
  customAddress: string
  onCustomAddressChange: (v: string) => void
  isAdmin: boolean
  onOpenAdmin: () => void
}

function Step1Depot({ depots, depotId, onDepotIdChange, customAddress, onCustomAddressChange, isAdmin, onOpenAdmin }: Step1Props) {
  const active = depots.filter(d => d.is_active)
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <BuildingOffice2Icon className="h-5 w-5 text-primary-600" />
        Stap 1 · Kies je startpunt
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Selecteer het depot waar je vandaag vertrekt. Je komt aan het eind van
        de route hier ook weer terug.
      </p>

      {active.length === 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 mb-3">
          Er zijn nog geen depots ingesteld.{' '}
          {isAdmin
            ? <button type="button" className="underline font-medium" onClick={onOpenAdmin}>Voeg er een toe →</button>
            : <span>Vraag een beheerder om er één aan te maken.</span>}
        </div>
      )}

      {active.length > 0 && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">Depot</label>
          <select
            className="input w-full mb-3"
            value={depotId}
            onChange={e => onDepotIdChange(e.target.value)}
          >
            <option value="">— Ander adres invoeren —</option>
            {active.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} {d.is_default ? '★' : ''}
              </option>
            ))}
          </select>
          {depotId && (
            <p className="text-xs text-gray-500 mb-3 pl-1">
              📍 {depots.find(d => d.id === depotId)?.address}
            </p>
          )}
        </div>
      )}

      {depotId === '' && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Adres van startpunt
          </label>
          <AddressAutocomplete
            value={customAddress}
            onChange={onCustomAddressChange}
            placeholder="Straat, postcode plaats, land"
          />
        </div>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={onOpenAdmin}
          className="mt-4 text-xs text-primary-700 hover:text-primary-900 font-medium inline-flex items-center gap-1"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Depots beheren…
        </button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
function StepTime({ title, description, value, onChange, required }: {
  title: string; description: string; value: string; onChange: (v: string) => void; required?: boolean
}) {
  const quickTimes = required
    ? ['06:00', '07:00', '08:00', '09:00', '10:00']
    : ['', '16:00', '17:00', '18:00', '19:00']
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <ClockIcon className="h-5 w-5 text-primary-600" />
        {title}
      </h2>
      <p className="text-sm text-gray-600 mb-4">{description}</p>

      <input
        type="time"
        className="input text-xl w-full sm:w-40 tabular-nums"
        value={value}
        onChange={e => onChange(e.target.value)}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {quickTimes.map(t => (
          <button
            key={t || 'none'}
            type="button"
            onClick={() => onChange(t)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-full border transition-colors',
              value === t
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400',
            )}
          >
            {t || 'Geen deadline'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
function Step4Upload({ uploads, setUploads, existingCount, uploading }: {
  uploads: File[]
  setUploads: (fs: File[]) => void
  existingCount: number
  uploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(fs: FileList | null) {
    if (!fs || fs.length === 0) return
    const list = [...uploads]
    for (const f of Array.from(fs)) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name}: te groot (max 10 MB).`)
        continue
      }
      list.push(f)
    }
    setUploads(list)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <PhotoIcon className="h-5 w-5 text-primary-600" />
        Stap 4 · Upload je ritlijst(en)
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Maak een foto of upload er meerdere. Alle stops worden samengevoegd tot één laadlijst.
      </p>

      <label
        htmlFor="loadlist-files"
        className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
      >
        <ArrowUpTrayIcon className="h-8 w-8 text-gray-400 mb-2" />
        <span className="text-sm font-medium text-gray-700">Tik om een foto te kiezen of te maken</span>
        <span className="text-xs text-gray-500 mt-1">Meerdere foto&apos;s tegelijk mag</span>
        <input
          ref={inputRef}
          id="loadlist-files"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          onChange={e => addFiles(e.target.files)}
          className="hidden"
        />
      </label>

      {uploads.length > 0 && (
        <ul className="mt-4 space-y-2">
          {uploads.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 bg-gray-50 rounded-md p-2">
              <PhotoIcon className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 truncate">{f.name}</div>
                <div className="text-[11px] text-gray-500">{(f.size / 1024).toFixed(0)} kB</div>
              </div>
              <button
                type="button"
                onClick={() => setUploads(uploads.filter((_, j) => j !== i))}
                className="p-1 text-red-500 hover:bg-red-50 rounded-md"
                aria-label="Verwijderen"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {existingCount > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          Er zijn al {existingCount} stops ingelezen. Nieuwe uploads worden hieraan toegevoegd.
        </p>
      )}
      {uploading && (
        <p className="text-sm text-primary-700 mt-3 animate-pulse">
          Bezig met inlezen van foto&apos;s… dit kan een halve minuut duren.
        </p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
function Step5Result({
  loadlist, deliveryOrder, loadOrder, startTime, endTime,
  optimizing, onOptimize, onOpenZoom,
}: {
  loadlist: LoadList | null
  deliveryOrder: LoadStop[]
  loadOrder: LoadStop[]
  startTime: string
  endTime: string
  optimizing: boolean
  onOptimize: () => void
  onOpenZoom: () => void
}) {
  const [view, setView] = useState<'load' | 'delivery'>('load')

  if (!loadlist) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-primary-600" />
          Stap 5 · Optimaliseren
        </h2>
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
          Er is nog geen laadlijst. Ga terug naar stap 4 en upload een foto.
        </div>
      </div>
    )
  }

  const notOptimised = loadlist.status !== 'optimized'
  const legMinutes = 12
  const totalMinutes = deliveryOrder.length * legMinutes
  const failedCount = loadlist.stops.filter(s => s.geocode_error).length

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <SparklesIcon className="h-5 w-5 text-primary-600" />
        Stap 5 · Bereken en bekijk je laadvolgorde
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        {loadlist.stops.length} stops ingelezen. Klik op &quot;Berekenen&quot; om
        de kortste route te bepalen.
      </p>

      {notOptimised && (
        <button
          type="button"
          className="btn btn-primary w-full text-base py-3"
          onClick={onOptimize}
          disabled={optimizing || loadlist.stops.length === 0}
        >
          <SparklesIcon className="h-5 w-5 mr-2" />
          {optimizing ? 'Bezig met berekenen… (kan tot 30 sec duren)' : 'Bereken route'}
        </button>
      )}

      {loadlist.status_message && (
        <div className={clsx(
          'text-xs px-3 py-2 rounded-md mt-3',
          loadlist.status === 'error' ? 'bg-red-50 text-red-700'
            : loadlist.status === 'optimized' ? 'bg-green-50 text-green-800'
            : 'bg-blue-50 text-blue-700',
        )}>
          {loadlist.status === 'optimized' && '✓ '}
          {loadlist.status_message}
        </div>
      )}

      {/* Optimized but no results — geocoder failed on everything */}
      {loadlist.status === 'optimized' && loadOrder.length === 0 && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm p-3">
          <strong>Geen enkel adres kon worden gevonden.</strong> Controleer de
          adressen op de originele foto — de OCR heeft er waarschijnlijk typo&apos;s
          in gemaakt (bv. huisnummers verkeerd gelezen). Bewerk de foutieve
          stops en probeer opnieuw, of upload een scherpere foto.
        </div>
      )}

      {loadlist.status === 'optimized' && loadOrder.length > 0 && (
        <div className="mt-5">
          {failedCount > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs p-2 mb-3">
              ⚠ {failedCount} adres{failedCount === 1 ? '' : 'sen'} niet gevonden en overgeslagen.
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="text-xs text-gray-600">
              Afstand: <strong>{formatKm(loadlist.total_distance_m)}</strong>
              {startTime && <> · vertrek {startTime}</>}
              {endTime && <> · terug uiterlijk {endTime}</>}
              {startTime && <> · geschatte aankomst laatste stop ~{addMinutes(startTime, totalMinutes)}</>}
            </div>
            <div className="inline-flex rounded-md border border-gray-300 p-0.5 bg-white text-xs">
              <button
                type="button"
                onClick={() => setView('load')}
                className={clsx('px-3 py-1 rounded', view === 'load' ? 'bg-primary-600 text-white' : 'text-gray-600')}
              >
                Laadvolgorde
              </button>
              <button
                type="button"
                onClick={() => setView('delivery')}
                className={clsx('px-3 py-1 rounded', view === 'delivery' ? 'bg-primary-600 text-white' : 'text-gray-600')}
              >
                Losvolgorde
              </button>
            </div>
          </div>

          {view === 'load' && (
            <>
              <div className="rounded-md bg-primary-50 border border-primary-200 p-3 text-xs text-primary-800 mb-3">
                <strong>Hoe te laden:</strong> begin met #1 (die zet je vooraan / bij de cabine).
                #{loadOrder.length} laad je als laatste bij de achterdeuren → dat wordt jouw eerste stop.
              </div>
              <StopList stops={loadOrder} accent="primary" showLoadNumber />
            </>
          )}

          {view === 'delivery' && (
            <>
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-800 mb-3">
                <strong>Rijvolgorde:</strong> stop #1 lever je als eerste af.
                {startTime && <> Vertrek om {startTime}.</>}
              </div>
              <StopList stops={deliveryOrder} accent="green" showEta baseTime={startTime} />
            </>
          )}

          {/* Allow re-run in case user tweaks a stop */}
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-4"
            onClick={onOptimize}
            disabled={optimizing}
          >
            <SparklesIcon className="h-4 w-4 mr-1.5" />
            {optimizing ? 'Bezig…' : 'Opnieuw berekenen'}
          </button>
        </div>
      )}

      {loadlist.photo_url && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer">Originele foto tonen</summary>
          <img
            src={loadlist.photo_url}
            alt="Originele foto"
            className="mt-2 w-full max-h-64 object-contain rounded-md border border-gray-200 cursor-zoom-in"
            onClick={onOpenZoom}
          />
        </details>
      )}
    </div>
  )
}

function StopList({ stops, accent, showLoadNumber, showEta, baseTime }: {
  stops: LoadStop[]
  accent: 'primary' | 'green'
  showLoadNumber?: boolean
  showEta?: boolean
  baseTime?: string
}) {
  const badge = accent === 'primary' ? 'bg-primary-600' : 'bg-green-600'
  return (
    <ol className="space-y-1.5">
      {stops.map((s, idx) => {
        const eta = showEta && baseTime && /^\d{2}:\d{2}$/.test(baseTime)
          ? addMinutes(baseTime, (idx + 1) * 12)
          : null
        const num = showLoadNumber ? idx + 1 : (s.delivery_sequence ?? 0) + 1
        return (
          <li key={s.id} className="flex items-start gap-3 px-3 py-2 rounded-md bg-gray-50">
            <span className={clsx('flex-shrink-0 w-8 h-8 rounded-full text-white text-sm font-bold flex items-center justify-center', badge)}>
              {num}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">{s.address_raw}</div>
              <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3">
                {s.postcode && <span>{s.postcode}</span>}
                {s.city && <span>{s.city}</span>}
                {s.reference && <span>#{s.reference}</span>}
                {(s.time_window_start || s.time_window_end) && (
                  <span className="text-primary-700 font-medium">
                    🕒 {hhmm(s.time_window_start) || '…'}–{hhmm(s.time_window_end) || '…'}
                  </span>
                )}
                {eta && <span className="text-gray-600">~{eta}</span>}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ────────────────────────────────────────────────────────────────────────
function DepotAdminModal({ depots, onClose, onChange }: {
  depots: Depot[]
  onClose: () => void
  onChange: (d: Depot[]) => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  async function refresh() {
    try { onChange(await loadlistApi.depots.list()) } catch { /* ignore */ }
  }

  async function add() {
    if (!name.trim() || address.trim().length < 5) {
      toast.error('Vul naam en adres in.')
      return
    }
    setSaving(true)
    try {
      await loadlistApi.depots.create({ name: name.trim(), address: address.trim(), is_default: isDefault })
      setName(''); setAddress(''); setIsDefault(false)
      await refresh()
      toast.success('Depot toegevoegd.')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon depot niet toevoegen.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Dit depot verwijderen?')) return
    try {
      await loadlistApi.depots.remove(id)
      await refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon niet verwijderen.')
    }
  }

  async function toggle(d: Depot, patch: Partial<Pick<Depot, 'is_active' | 'is_default'>>) {
    try {
      await loadlistApi.depots.update(d.id, patch)
      await refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Kon niet bijwerken.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <BuildingOffice2Icon className="h-5 w-5 text-primary-600" />
            Depots beheren
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
            <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Nieuw depot</h4>
            <input
              className="input w-full mb-2"
              placeholder="Naam (bv. DACHSER Waddinxveen)"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
            />
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              placeholder="Volledig adres uit Google Maps"
              className="mb-2"
            />
            <label className="flex items-center gap-2 text-xs text-gray-700 mb-2">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="rounded"
              />
              Standaard depot (automatisch voorgeselecteerd)
            </label>
            <button type="button" className="btn btn-primary btn-sm w-full" disabled={saving} onClick={add}>
              <PlusIcon className="h-4 w-4 mr-1" />
              {saving ? 'Bezig…' : 'Toevoegen'}
            </button>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Bestaande depots</h4>
            {depots.length === 0 && <p className="text-sm text-gray-500">Nog geen depots.</p>}
            <ul className="space-y-2">
              {depots.map(d => (
                <li key={d.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                        {d.name}
                        {d.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-800">standaard</span>}
                        {!d.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-700">inactief</span>}
                      </div>
                      <div className="text-xs text-gray-600 flex items-center gap-1 mt-0.5">
                        <MapPinIcon className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{d.address}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(d.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-md flex-shrink-0"
                      aria-label="Verwijderen"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 mt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggle(d, { is_default: !d.is_default })}
                      className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      {d.is_default ? 'Standaard verwijderen' : 'Maak standaard'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(d, { is_active: !d.is_active })}
                      className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      {d.is_active ? 'Deactiveren' : 'Activeren'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
