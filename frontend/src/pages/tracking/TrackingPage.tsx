/**
 * Track & Trace Page — Real-time vehicle tracking with Leaflet/OpenStreetMap
 * 
 * Features:
 * - Live map with vehicle positions
 * - Start/stop tracking (driver mode)
 * - Route history viewer
 * - Vehicle assignment
 * 
 * Security:
 * - All data via authenticated API only
 * - GPS permission requested only when driver starts tracking
 * - No location data stored locally
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MapPinIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  TruckIcon,
  ClockIcon,
  SignalIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/authStore'
import { trackingApi, type LiveVehicle, type TrackingSession, type TrackingVehicle, type RouteHistory } from '@/api/tracking'
import { useGPSTracking } from '@/hooks/useGPSTracking'
import { useLocationPermission } from '@/hooks/useLocationPermission'
import { LocationPermissionDialog, LocationDeniedBanner } from '@/components/tracking/LocationPermission'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default marker icon issue with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Custom truck marker icon
function createTruckIcon(color: string = '#1e3a5f') {
  return L.divIcon({
    className: 'custom-truck-marker',
    html: `<div style="
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
        <path d="M15 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 13.52 9H12v9"/>
        <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
      </svg>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })
}

// ====== Map Component ======
function TrackingMap({
  vehicles,
  selectedRoute,
  onVehicleClick,
}: {
  vehicles: LiveVehicle[]
  selectedRoute: RouteHistory | null
  onVehicleClick?: (v: LiveVehicle) => void
}) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const routeLayerRef = useRef<L.Polyline | null>(null)

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [52.0907, 5.1214], // Netherlands center
      zoom: 8,
      zoomControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update vehicle markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(vehicles.map(v => v.session_id))

    // Remove markers for sessions no longer active
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    })

    // Add/update markers
    vehicles.forEach(v => {
      const existing = markersRef.current.get(v.session_id)
      const latlng: L.LatLngExpression = [v.latitude, v.longitude]

      if (existing) {
        existing.setLatLng(latlng)
        existing.setPopupContent(createPopupContent(v))
      } else {
        const marker = L.marker(latlng, {
          icon: createTruckIcon(v.is_active ? '#1e3a5f' : '#9ca3af'),
        }).addTo(map)

        marker.bindPopup(createPopupContent(v))
        if (onVehicleClick) {
          marker.on('click', () => onVehicleClick(v))
        }
        markersRef.current.set(v.session_id, marker)
      }
    })

    // Auto-fit bounds if vehicles exist
    if (vehicles.length > 0 && !selectedRoute) {
      const bounds = L.latLngBounds(vehicles.map(v => [v.latitude, v.longitude] as L.LatLngExpression))
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
    }
  }, [vehicles, onVehicleClick, selectedRoute])

  // Draw route when selected
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear previous route
    if (routeLayerRef.current) {
      routeLayerRef.current.remove()
      routeLayerRef.current = null
    }

    if (selectedRoute && selectedRoute.points.length > 0) {
      const latlngs = selectedRoute.points.map(
        p => [p.latitude, p.longitude] as L.LatLngExpression
      )
      
      const polyline = L.polyline(latlngs, {
        color: '#1e3a5f',
        weight: 4,
        opacity: 0.8,
      }).addTo(map)
      
      routeLayerRef.current = polyline
      map.fitBounds(polyline.getBounds(), { padding: [50, 50] })

      // Add start/end markers
      if (latlngs.length > 0) {
        L.circleMarker(latlngs[0], {
          radius: 8, fillColor: '#22c55e', fillOpacity: 1, color: 'white', weight: 2,
        }).addTo(map).bindPopup('Start')
        
        L.circleMarker(latlngs[latlngs.length - 1], {
          radius: 8, fillColor: '#ef4444', fillOpacity: 1, color: 'white', weight: 2,
        }).addTo(map).bindPopup('Einde')
      }
    }
  }, [selectedRoute])

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full rounded-lg min-h-[300px] sm:min-h-[400px]"
    />
  )
}

function createPopupContent(v: LiveVehicle): string {
  const speed = v.speed != null ? `${Math.round(v.speed)} km/h` : '-'
  const time = new Date(v.recorded_at).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  return `
    <div style="min-width:160px">
      <strong>${v.vehicle_kenteken || v.user_name}</strong><br/>
      ${v.vehicle_ritnummer ? `<span style="color:#666">Rit: ${v.vehicle_ritnummer}</span><br/>` : ''}
      <span style="color:#666">${v.user_name}</span><br/>
      <span>🚀 ${speed}</span><br/>
      <span>🕐 ${time}</span>
    </div>
  `
}

// ====== Driver Tracking Controls ======
function DriverTrackingPanel({
  vehicles,
  locationPermission,
}: {
  vehicles: TrackingVehicle[]
  locationPermission: ReturnType<typeof useLocationPermission>
}) {
  const { t } = useTranslation()
  const [selectedVehicle, setSelectedVehicle] = useState<string>('')
  const [session, setSession] = useState<TrackingSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [showPermissionDialog, setShowPermissionDialog] = useState(false)
  const [permissionLoading, setPermissionLoading] = useState(false)

  const gps = useGPSTracking({ minInterval: 10000, maxAccuracy: 100 })

  // Check for existing session on mount
  useEffect(() => {
    const check = async () => {
      try {
        const result = await trackingApi.getActiveSession()
        if ('id' in result) {
          setSession(result)
          if (!gps.isTracking) {
            gps.startTracking()
          }
        }
      } catch {}
    }
    check()
  }, [])

  const handleStart = async () => {
    // Check if we need to ask for permission first
    if (locationPermission.status === 'denied') {
      // Already denied — banner will show help
      return
    }
    if (locationPermission.status !== 'granted') {
      // Show our custom dialog first
      setShowPermissionDialog(true)
      return
    }
    // Permission already granted — start directly
    await doStartTracking()
  }

  const handlePermissionAllow = async () => {
    setPermissionLoading(true)
    const result = await locationPermission.requestPermission()
    setPermissionLoading(false)
    setShowPermissionDialog(false)
    if (result === 'granted') {
      await doStartTracking()
    }
  }

  const handlePermissionDeny = () => {
    locationPermission.markAsAsked()
    setShowPermissionDialog(false)
  }

  const doStartTracking = async () => {
    setStarting(true)
    try {
      const newSession = await trackingApi.startSession(selectedVehicle || undefined)
      setSession(newSession)
      gps.startTracking()
    } catch (err: any) {
      console.error('Failed to start tracking:', err)
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    setStopping(true)
    try {
      gps.stopTracking()
      await trackingApi.stopSession()
      setSession(null)
    } catch (err: any) {
      console.error('Failed to stop tracking:', err)
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-3 sm:p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <SignalIcon className="h-4 w-4 text-primary-600" />
        {t('tracking.myTracking')}
      </h3>

      {/* GPS Denied Banner */}
      {locationPermission.status === 'denied' && (
        <LocationDeniedBanner platform={locationPermission.platform} />
      )}

      {/* Permission Dialog */}
      <LocationPermissionDialog
        isOpen={showPermissionDialog}
        onAllow={handlePermissionAllow}
        onDeny={handlePermissionDeny}
        platform={locationPermission.platform}
        loading={permissionLoading}
      />

      {!session ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t('tracking.selectVehicle')}
            </label>
            <select
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">{t('tracking.autoDetect')}</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.kenteken} — {v.ritnummer}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleStart}
            disabled={starting}
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
          >
            {starting ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}
            {t('tracking.startTracking')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-green-700">{t('tracking.active')}</span>
          </div>
          
          {session.vehicle_kenteken && (
            <div className="text-xs text-gray-600">
              <TruckIcon className="h-3.5 w-3.5 inline mr-1" />
              {session.vehicle_kenteken} — {session.vehicle_ritnummer}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div>
              📡 {t('tracking.sent')}: {gps.pointsSent}
            </div>
            <div>
              📦 {t('tracking.buffered')}: {gps.pointsBuffered}
            </div>
            {gps.accuracy != null && (
              <div>
                🎯 {t('tracking.accuracy')}: {Math.round(gps.accuracy)}m
              </div>
            )}
            {gps.lastPosition?.coords.speed != null && (
              <div>
                🚀 {Math.round(gps.lastPosition.coords.speed * 3.6)} km/h
              </div>
            )}
          </div>

          {gps.error && (
            <div className="text-xs text-amber-600 flex items-center gap-1">
              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
              {gps.error}
            </div>
          )}

          <button
            onClick={handleStop}
            disabled={stopping}
            className="w-full px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
          >
            {stopping ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <StopIcon className="h-4 w-4" />
            )}
            {t('tracking.stopTracking')}
          </button>
        </div>
      )}
    </div>
  )
}

// ====== History Panel ======
function HistoryPanel({
  onSelectRoute,
}: {
  onSelectRoute: (route: RouteHistory | null) => void
}) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<TrackingSession[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingRoute, setLoadingRoute] = useState(false)

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    setLoading(true)
    try {
      const data = await trackingApi.getSessionHistory()
      setSessions(data)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    if (selectedId === sessionId) {
      setSelectedId(null)
      onSelectRoute(null)
      return
    }
    
    setSelectedId(sessionId)
    setLoadingRoute(true)
    try {
      const route = await trackingApi.getSessionRoute(sessionId)
      onSelectRoute(route)
    } catch (err) {
      console.error('Failed to load route:', err)
    } finally {
      setLoadingRoute(false)
    }
  }

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('nl-NL', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <ClockIcon className="h-4 w-4 text-gray-500" />
          {t('tracking.routeHistory')}
        </h3>
        <button
          onClick={loadSessions}
          className="p-1 text-gray-500 hover:text-gray-700 rounded"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="divide-y max-h-[200px] sm:max-h-[300px] overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">
            <ArrowPathIcon className="h-5 w-5 animate-spin mx-auto mb-1" />
            {t('common.loading')}
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            {t('tracking.noHistory')}
          </div>
        ) : (
          sessions.map(s => (
            <button
              key={s.id}
              onClick={() => handleSelectSession(s.id)}
              className={`w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                selectedId === s.id ? 'bg-primary-50 border-l-2 border-primary-600' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">
                    {s.vehicle_kenteken || s.user_name}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {formatTime(s.started_at)}
                    {s.ended_at && ` — ${formatTime(s.ended_at)}`}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {Math.round(s.duration_minutes)} {t('tracking.minutes')}
                  </div>
                </div>
                {loadingRoute && selectedId === s.id ? (
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary-600 shrink-0" />
                ) : (
                  <ChevronRightIcon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ====== Main Tracking Page ======
export default function TrackingPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const [liveVehicles, setLiveVehicles] = useState<LiveVehicle[]>([])
  const [trackingVehicles, setTrackingVehicles] = useState<TrackingVehicle[]>([])
  const [selectedRoute, setSelectedRoute] = useState<RouteHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAdmin = user?.rol === 'admin' || user?.rol === 'gebruiker'
  const locationPermission = useLocationPermission()

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [vehicles, live] = await Promise.all([
          trackingApi.getTrackingVehicles(),
          trackingApi.getLivePositions(),
        ])
        setTrackingVehicles(vehicles)
        setLiveVehicles(live)
      } catch (err) {
        console.error('Failed to load tracking data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // Poll live positions every 10s
  useEffect(() => {
    const poll = async () => {
      try {
        const live = await trackingApi.getLivePositions()
        setLiveVehicles(live)
      } catch {}
    }

    pollIntervalRef.current = setInterval(poll, 10000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  const handleClearRoute = () => {
    setSelectedRoute(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <MapPinIcon className="h-6 w-6 sm:h-7 sm:w-7 text-primary-600" />
            {t('tracking.title')}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {liveVehicles.length} {t('tracking.activeVehicles')}
          </p>
        </div>
      </div>

      {/* Route info bar */}
      {selectedRoute && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg px-3 py-2 flex items-start sm:items-center justify-between gap-2 text-sm">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-primary-900 block sm:inline truncate">
              {t('tracking.route')}: {selectedRoute.session.vehicle_kenteken || selectedRoute.session.user_name}
            </span>
            <span className="text-primary-700 block sm:inline sm:ml-2 text-xs sm:text-sm">
              {selectedRoute.total_points} {t('tracking.points')} · {selectedRoute.distance_km} km
            </span>
          </div>
          <button
            onClick={handleClearRoute}
            className="p-1 text-primary-600 hover:text-primary-800 rounded shrink-0"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main layout: Map + Sidebar */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Map */}
        <div className="flex-1 bg-white rounded-lg shadow-sm border overflow-hidden min-h-[300px] sm:min-h-[400px] lg:min-h-[500px]">
          <TrackingMap
            vehicles={liveVehicles}
            selectedRoute={selectedRoute}
            onVehicleClick={(v) => {
              // Could open a detail panel
            }}
          />
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-80 space-y-4">
          {/* Driver tracking controls */}
          <DriverTrackingPanel vehicles={trackingVehicles} locationPermission={locationPermission} />

          {/* Active vehicles list (admin only) */}
          {isAdmin && liveVehicles.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <div className="px-3 py-2 border-b bg-gray-50">
                <h3 className="text-xs sm:text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <TruckIcon className="h-4 w-4 text-gray-500 shrink-0" />
                  <span className="truncate">{t('tracking.liveVehicles')} ({liveVehicles.length})</span>
                </h3>
              </div>
              <div className="divide-y max-h-[200px] sm:max-h-[250px] overflow-y-auto">
                {liveVehicles.map(v => (
                  <div key={v.session_id} className="px-3 py-2 hover:bg-gray-50">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-gray-900 truncate">
                          {v.vehicle_kenteken || v.user_name}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {v.user_name}
                          {v.speed != null && ` · ${Math.round(v.speed)} km/h`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Route history (admin only) */}
          {isAdmin && (
            <HistoryPanel onSelectRoute={setSelectedRoute} />
          )}
        </div>
      </div>
    </div>
  )
}
