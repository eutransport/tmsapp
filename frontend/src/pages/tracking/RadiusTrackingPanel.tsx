/**
 * Radius Velocity — live posities van de wagens op de kaart.
 *
 * Radius levert alleen de laatst bekende positie per tracker. De ververs-
 * snelheid die Radius zelf adviseert wordt aangehouden.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getRadiusVehicles, type RadiusVehicle } from '@/api/radius'

/** Marker met de kleur afhankelijk van contact aan/uit. */
function maakMarkerIcoon(rijdt: boolean, contactAan: boolean) {
  const kleur = rijdt ? '#16a34a' : contactAan ? '#f59e0b' : '#6b7280'
  return L.divIcon({
    className: 'radius-truck-marker',
    html: `<div style="
      background: ${kleur};
      border: 2px solid white;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
        <path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 9H12v9"/>
        <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

function tijdstipTekst(timestamp: number | null): string {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RadiusKaart({
  voertuigen,
  focusKenteken,
}: {
  voertuigen: RadiusVehicle[]
  focusKenteken: string | null
}) {
  const kaartRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<globalThis.Map<string, L.Marker>>(new globalThis.Map())
  const eersteFitRef = useRef(false)

  useEffect(() => {
    if (!containerRef.current || kaartRef.current) return

    const kaart = L.map(containerRef.current, {
      center: [52.0907, 5.1214],
      zoom: 8,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(kaart)
    kaartRef.current = kaart

    return () => {
      kaart.remove()
      kaartRef.current = null
      markersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const kaart = kaartRef.current
    if (!kaart) return

    const huidig = new Set<string>()

    voertuigen.forEach((voertuig) => {
      if (voertuig.latitude === null || voertuig.longitude === null) return
      const sleutel = voertuig.plate_number || String(voertuig.device_id)
      huidig.add(sleutel)

      const positie: L.LatLngExpression = [voertuig.latitude, voertuig.longitude]
      const rijdt = voertuig.speed > 3
      const icoon = maakMarkerIcoon(rijdt, voertuig.ignition)
      const popup = `
        <div style="min-width:180px">
          <strong>${voertuig.plate_number || '-'}</strong><br/>
          ${voertuig.address || '-'}<br/>
          <span style="color:#666">${voertuig.speed} ${voertuig.speed_unit}</span> ·
          <span style="color:#666">${tijdstipTekst(voertuig.timestamp)}</span>
        </div>`

      const bestaand = markersRef.current.get(sleutel)
      if (bestaand) {
        bestaand.setLatLng(positie)
        bestaand.setIcon(icoon)
        bestaand.setPopupContent(popup)
      } else {
        const marker = L.marker(positie, { icon: icoon }).addTo(kaart).bindPopup(popup)
        markersRef.current.set(sleutel, marker)
      }
    })

    markersRef.current.forEach((marker, sleutel) => {
      if (!huidig.has(sleutel)) {
        kaart.removeLayer(marker)
        markersRef.current.delete(sleutel)
      }
    })

    if (!eersteFitRef.current && markersRef.current.size > 0) {
      const grenzen = L.latLngBounds(
        Array.from(markersRef.current.values()).map((m) => m.getLatLng()),
      )
      kaart.fitBounds(grenzen, { padding: [40, 40], maxZoom: 12 })
      eersteFitRef.current = true
    }
  }, [voertuigen])

  useEffect(() => {
    const kaart = kaartRef.current
    if (!kaart || !focusKenteken) return
    const marker = markersRef.current.get(focusKenteken)
    if (marker) {
      kaart.setView(marker.getLatLng(), 14, { animate: true })
      marker.openPopup()
    }
  }, [focusKenteken])

  return <div ref={containerRef} className="h-full w-full" style={{ minHeight: 400 }} />
}

export default function RadiusTrackingPanel() {
  const { t } = useTranslation()
  const [voertuigen, setVoertuigen] = useState<RadiusVehicle[]>([])
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string | null>(null)
  const [zoekterm, setZoekterm] = useState('')
  const [focusKenteken, setFocusKenteken] = useState<string | null>(null)
  const [ververstOp, setVerverstOp] = useState<Date | null>(null)
  const [intervalMs, setIntervalMs] = useState(60000)

  const laadVoertuigen = useCallback(async () => {
    try {
      const data = await getRadiusVehicles()
      setVoertuigen(data.vehicles)
      setVerverstOp(new Date())
      setFout(null)
      // Radius geeft de geadviseerde ververssnelheid in milliseconden.
      if (data.refresh_rate_ms && data.refresh_rate_ms >= 15000) {
        setIntervalMs(data.refresh_rate_ms)
      }
    } catch (err: any) {
      setFout(
        err?.response?.data?.detail ||
          t('radius.loadFailed', 'De Radius-gegevens konden niet worden opgehaald.'),
      )
    } finally {
      setLaden(false)
    }
  }, [t])

  useEffect(() => {
    laadVoertuigen()
  }, [laadVoertuigen])

  useEffect(() => {
    const timer = window.setInterval(laadVoertuigen, intervalMs)
    return () => window.clearInterval(timer)
  }, [laadVoertuigen, intervalMs])

  const gefilterd = useMemo(() => {
    const term = zoekterm.trim().toLowerCase()
    if (!term) return voertuigen
    return voertuigen.filter(
      (v) =>
        v.plate_number.toLowerCase().includes(term) ||
        v.address.toLowerCase().includes(term) ||
        v.driver_name.toLowerCase().includes(term),
    )
  }, [voertuigen, zoekterm])

  const rijdend = useMemo(() => voertuigen.filter((v) => v.speed > 3).length, [voertuigen])

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <MapPinIcon className="h-6 w-6 sm:h-7 sm:w-7 text-primary-600" />
            {t('radius.liveTitle', 'Radius live posities')}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            {voertuigen.length} {t('radius.vehicles', 'wagens')} · {rijdend}{' '}
            {t('radius.driving', 'rijdend')}
            {ververstOp && (
              <>
                {' · '}
                {t('radius.updatedAt', 'bijgewerkt')}{' '}
                {ververstOp.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={laadVoertuigen}
          disabled={laden}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowPathIcon className={`h-4 w-4 ${laden ? 'animate-spin' : ''}`} />
          {t('common.refresh', 'Vernieuwen')}
        </button>
      </div>

      {fout && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          <span>{fout}</span>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="card relative z-0 min-h-[300px] flex-1 overflow-hidden sm:min-h-[400px] lg:min-h-[500px]">
          <RadiusKaart voertuigen={gefilterd} focusKenteken={focusKenteken} />
        </div>

        <div className="w-full space-y-3 lg:w-80">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={zoekterm}
              onChange={(e) => setZoekterm(e.target.value)}
              placeholder={t('radius.search', 'Zoek op kenteken of plaats') as string}
              className="input w-full pl-9"
            />
          </div>

          <div className="card max-h-[520px] divide-y divide-gray-100 overflow-y-auto p-0">
            {laden && voertuigen.length === 0 && (
              <p className="p-4 text-sm text-gray-500">{t('common.loading', 'Laden...')}</p>
            )}
            {!laden && gefilterd.length === 0 && (
              <p className="p-4 text-sm text-gray-500">
                {t('radius.noVehicles', 'Geen wagens gevonden.')}
              </p>
            )}
            {gefilterd.map((voertuig) => {
              const rijdt = voertuig.speed > 3
              return (
                <button
                  key={voertuig.plate_number || voertuig.device_id}
                  type="button"
                  onClick={() => setFocusKenteken(voertuig.plate_number)}
                  className={`flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-gray-50 ${
                    focusKenteken === voertuig.plate_number ? 'bg-primary-50' : ''
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      rijdt
                        ? 'bg-green-100 text-green-700'
                        : voertuig.ignition
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <TruckIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {voertuig.plate_number || '-'}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {voertuig.address || '-'}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      {voertuig.speed} {voertuig.speed_unit} · {tijdstipTekst(voertuig.timestamp)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
