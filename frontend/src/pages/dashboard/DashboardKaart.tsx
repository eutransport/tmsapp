import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPinIcon, ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { trackingApi } from '@/api/tracking'

interface Wagen {
  id: string
  kenteken: string
  naam: string
  lat: number
  lng: number
  snelheid: number | null
  status: 'driving' | 'idle' | 'parked'
  adres: string
  tijd: string
}

const STATUS = {
  driving: { label: 'Rijdt', kleur: '#16a34a' },
  idle: { label: 'Stationair', kleur: '#FE8500' },
  parked: { label: 'Geparkeerd', kleur: '#94a3b8' },
}

const norm = (k: string) => k.replace(/-/g, '').toUpperCase()

function useWagens() {
  const [wagens, setWagens] = useState<Wagen[]>([])
  const [laden, setLaden] = useState(true)

  useEffect(() => {
    let actief = true
    const ophalen = async () => {
      const [fm, live] = await Promise.all([
        trackingApi.getFMTrackPositions().catch(() => []),
        trackingApi.getLivePositions().catch(() => []),
      ])
      const lijst: Wagen[] = live.map(v => ({
        id: v.session_id, kenteken: v.vehicle_kenteken || v.user_name, naam: v.user_name,
        lat: v.latitude, lng: v.longitude, snelheid: v.speed,
        status: v.speed && v.speed > 0 ? 'driving' : 'idle', adres: '', tijd: v.recorded_at,
      }))
      for (const f of fm) {
        if (lijst.some(w => norm(w.kenteken) === norm(f.plate_number))) continue
        lijst.push({
          id: `fm-${f.object_id}`, kenteken: f.plate_number, naam: f.vehicle_name,
          lat: f.latitude, lng: f.longitude, snelheid: f.speed, status: f.vehicle_status,
          adres: f.address, tijd: f.timestamp,
        })
      }
      const volgorde = { driving: 0, idle: 1, parked: 2 }
      lijst.sort((a, b) => volgorde[a.status] - volgorde[b.status] || a.kenteken.localeCompare(b.kenteken))
      if (actief) { setWagens(lijst.filter(w => w.lat && w.lng)); setLaden(false) }
    }
    ophalen()
    const t = setInterval(ophalen, 60_000)
    return () => { actief = false; clearInterval(t) }
  }, [])

  return { wagens, laden }
}

function useIsDesktop() {
  const q = '(min-width: 1024px)'
  const [desktop, setDesktop] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const h = () => setDesktop(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return desktop
}

function markerIcoon(w: Wagen) {
  const kleur = STATUS[w.status].kleur
  return L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${kleur};border:3px solid #fff;box-shadow:0 2px 8px rgba(33,35,62,.45)"></div>`,
  })
}

function tegels(map: L.Map) {
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(map)
}

/** Kleine, statische kaart rond één wagen. */
function MiniKaart({ wagen, className = '' }: { wagen: Wagen; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const map = L.map(ref.current, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false,
    }).setView([wagen.lat, wagen.lng], 13)
    tegels(map)
    L.marker([wagen.lat, wagen.lng], { icon: markerIcoon(wagen) }).addTo(map)
    return () => { map.remove() }
  }, [wagen.lat, wagen.lng, wagen.status])
  return <div ref={ref} className={className} />
}

function WagenInfo({ w }: { w: Wagen }) {
  const s = STATUS[w.status]
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.kleur }} />
        <p className="truncate text-sm font-semibold text-gray-900">{w.kenteken}</p>
      </div>
      <p className="truncate text-xs text-gray-500">
        {s.label}{w.status === 'driving' && w.snelheid ? ` · ${Math.round(w.snelheid)} km/h` : ''}
        {w.adres ? ` · ${w.adres}` : ''}
      </p>
    </div>
  )
}

function GroteKaart({ wagens }: { wagens: Wagen[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const laagRef = useRef<L.LayerGroup | null>(null)
  const eersteKeer = useRef(true)

  useEffect(() => {
    if (!ref.current) return
    const map = L.map(ref.current, { zoomControl: true, scrollWheelZoom: false }).setView([52.2, 5.3], 7)
    tegels(map)
    mapRef.current = map
    laagRef.current = L.layerGroup().addTo(map)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current, laag = laagRef.current
    if (!map || !laag) return
    laag.clearLayers()
    wagens.forEach(w => {
      L.marker([w.lat, w.lng], { icon: markerIcoon(w) })
        .bindTooltip(`<strong>${w.kenteken}</strong><br/>${STATUS[w.status].label}`, { direction: 'top', offset: [0, -8] })
        .addTo(laag)
    })
    if (eersteKeer.current && wagens.length) {
      map.fitBounds(L.latLngBounds(wagens.map(w => [w.lat, w.lng])), { padding: [30, 30], maxZoom: 12 })
      eersteKeer.current = false
    }
  }, [wagens])

  return <div ref={ref} className="h-[420px] w-full" />
}

/** Desktop: lijst met hover-popup met minikaart. */
function DesktopLijst({ wagens }: { wagens: Wagen[] }) {
  const [hover, setHover] = useState<{ w: Wagen; top: number; left: number } | null>(null)

  const toon = (w: Wagen, e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const breedte = 320, hoogte = 260
    const left = r.left - breedte - 12 > 8 ? r.left - breedte - 12 : r.right + 12
    const top = Math.min(Math.max(8, r.top + r.height / 2 - hoogte / 2), window.innerHeight - hoogte - 8)
    setHover({ w, top, left })
  }

  return (
    <>
      <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
        {wagens.map(w => (
          <Link
            key={w.id}
            to="/track-trace"
            onMouseEnter={e => toon(w, e)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[#105BFF]/5"
          >
            <WagenInfo w={w} />
            <MapPinIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
          </Link>
        ))}
      </div>
      {hover && createPortal(
        <div
          className="pointer-events-none fixed z-[1000] w-80 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-[0_20px_50px_-12px_rgba(33,35,62,0.45)] backdrop-blur-xl"
          style={{ top: hover.top, left: hover.left }}
        >
          <MiniKaart wagen={hover.w} className="h-48 w-full" />
          <div className="p-3"><WagenInfo w={hover.w} /></div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Mobiel: tik = actieblad met knop naar volledige kaart, lang indrukken = popup met kaart. */
function MobieleLijst({ wagens }: { wagens: Wagen[] }) {
  const navigate = useNavigate()
  const [blad, setBlad] = useState<Wagen | null>(null)
  const [kaart, setKaart] = useState<Wagen | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lang = useRef(false)

  const start = (w: Wagen) => {
    lang.current = false
    timer.current = setTimeout(() => {
      lang.current = true
      navigator.vibrate?.(15)
      setKaart(w)
    }, 450)
  }
  const stop = () => { if (timer.current) clearTimeout(timer.current) }

  const sluit = () => { setBlad(null); setKaart(null) }

  return (
    <>
      <div className="divide-y divide-gray-100">
        {wagens.map(w => (
          <button
            key={w.id}
            type="button"
            onTouchStart={() => start(w)}
            onTouchEnd={stop}
            onTouchMove={stop}
            onContextMenu={e => e.preventDefault()}
            onClick={() => { if (!lang.current) setBlad(w) }}
            className="flex w-full select-none items-center justify-between gap-3 px-4 py-3 text-left active:bg-[#105BFF]/5"
          >
            <WagenInfo w={w} />
            <MapPinIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
          </button>
        ))}
      </div>

      {(blad || kaart) && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-[#21233E]/40 backdrop-blur-sm sm:items-center" onClick={sluit}>
          <div
            className="w-full max-w-md overflow-hidden rounded-t-3xl border border-white/60 bg-white/95 shadow-2xl sm:rounded-3xl"
            onClick={e => e.stopPropagation()}
          >
            {kaart && <MiniKaart wagen={kaart} className="h-72 w-full" />}
            <div className="flex items-center justify-between gap-3 p-4">
              <WagenInfo w={(kaart || blad)!} />
              <button type="button" onClick={sluit} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 pb-5">
              <button type="button" onClick={() => navigate('/track-trace')} className="btn-primary flex w-full items-center justify-center gap-2 py-3">
                <ArrowsPointingOutIcon className="h-5 w-5" />
                Volledige kaart openen
              </button>
              {!kaart && <p className="mt-2 text-center text-[11px] text-gray-400">Tip: houd een wagen ingedrukt om direct de kaart te zien</p>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export default function DashboardKaart({ user }: { user: any }) {
  const desktop = useIsDesktop()
  const { wagens, laden } = useWagens()
  const magZien = user?.rol === 'admin' || (user?.module_permissions || []).includes('view_track_trace')
  if (!magZien) return null

  const rijdend = wagens.filter(w => w.status === 'driving').length

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <MapPinIcon className="h-5 w-5 text-[#105BFF]" />
          Wagens onderweg
        </h2>
        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
          {rijdend} rijdend · {wagens.length} totaal
        </span>
      </div>
      {laden ? (
        <div className="p-8 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-[#105BFF]" />
        </div>
      ) : wagens.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">Geen posities beschikbaar.</p>
      ) : desktop ? (
        <>
          <GroteKaart wagens={wagens} />
          <DesktopLijst wagens={wagens} />
        </>
      ) : (
        <MobieleLijst wagens={wagens} />
      )}
    </div>
  )
}
