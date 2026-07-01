/**
 * Vehicle Detail Panel — Shows trip history & live info for a selected FM-Track vehicle.
 * Displayed below the map when a vehicle is selected on the Track & Trace page.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  MapPinIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { trackingApi, type VehicleDetail, type VehicleDetailTrip, type FuelChartPoint, type RouteCoordinate } from '@/api/tracking'

interface VehicleDetailPanelProps {
  objectId: string
  platNumber: string
  onClose: () => void
  onRouteChange?: (route: RouteCoordinate[]) => void
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(dtStr: string): string {
  if (!dtStr) return '-'
  const d = new Date(dtStr)
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function VehicleDetailPanel({ objectId, platNumber, onClose, onRouteChange }: VehicleDetailPanelProps) {
  const [date, setDate] = useState(todayStr())
  const [detail, setDetail] = useState<VehicleDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isToday = date === todayStr()

  const loadDetail = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await trackingApi.getVehicleDetail(objectId, date)
      setDetail(data)
      onRouteChange?.(data.route_coordinates || [])
    } catch {
      setError('Kan voertuiggegevens niet laden.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [objectId, date])

  useEffect(() => {
    loadDetail()
    return () => { onRouteChange?.([]) }
  }, [loadDetail])

  const goBack = () => setDate(prev => shiftDate(prev, -1))
  const goForward = () => {
    if (!isToday) setDate(prev => shiftDate(prev, 1))
  }
  const goToday = () => setDate(todayStr())

  const statusLabels: Record<string, { label: string; color: string }> = {
    driving: { label: 'Rijdend', color: 'text-green-600' },
    idle: { label: 'Stationair', color: 'text-amber-600' },
    parked: { label: 'Geparkeerd', color: 'text-gray-500' },
  }

  const pos = detail?.current_position
  const statusInfo = pos ? statusLabels[pos.vehicle_status] || statusLabels.parked : null

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <MapPinIcon className="h-5 w-5 text-primary-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              {detail?.vehicle?.plate_number || platNumber}
            </h3>
            {detail?.vehicle && (
              <p className="text-xs text-gray-500 truncate">
                {detail.vehicle.make} {detail.vehicle.model}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => loadDetail(true)}
            disabled={refreshing || loading}
            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
            title="Ververs voertuigdata"
          >
            <ArrowPathIcon className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="px-4 py-2 border-b flex items-center justify-between bg-white">
        <button onClick={goBack} className="p-1 text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 capitalize">{formatDate(date)}</span>
          {!isToday && (
            <button
              onClick={goToday}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              Vandaag
            </button>
          )}
        </div>
        <button
          onClick={goForward}
          disabled={isToday}
          className={`p-1 rounded hover:bg-gray-100 ${isToday ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="p-6 flex items-center justify-center">
          <ArrowPathIcon className="h-5 w-5 animate-spin text-primary-600" />
          <span className="ml-2 text-sm text-gray-500">Laden...</span>
        </div>
      )}

      {error && (
        <div className="p-4 text-sm text-red-600 flex items-center gap-2">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && detail && (
        <div className="divide-y">
          {/* Summary cards */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Current speed / status */}
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Snelheid</p>
              <p className="text-lg font-bold text-gray-900">
                {pos ? Math.round(pos.speed) : '0'}
                <span className="text-xs font-normal text-gray-500 ml-0.5">km/h</span>
              </p>
              {pos && pos.speed_source !== 'live' && pos.speed > 0 && (
                <p className="text-[10px] text-blue-500 mt-0.5">~gemiddeld</p>
              )}
              {statusInfo && isToday && (
                <p className={`text-xs font-medium mt-0.5 ${statusInfo.color}`}>
                  {statusInfo.label}
                </p>
              )}
            </div>

            {/* Max speed today */}
            <div className={`rounded-lg p-3 text-center ${detail.max_speed > 130 ? 'bg-red-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500 mb-1">Max snelheid</p>
              <p className={`text-lg font-bold ${detail.max_speed > 130 ? 'text-red-600' : 'text-gray-900'}`}>
                {detail.max_speed > 0 ? detail.max_speed : '-'}
                {detail.max_speed > 0 && <span className="text-xs font-normal text-gray-500 ml-0.5">km/h</span>}
              </p>
              {detail.max_speed > 130 && (
                <p className="text-xs text-red-500 mt-0.5 flex items-center justify-center gap-0.5">
                  <ExclamationTriangleIcon className="h-3 w-3" />
                  Te hard
                </p>
              )}
            </div>

            {/* Day distance */}
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Gereden</p>
              <p className="text-lg font-bold text-gray-900">
                {detail.total_distance_km}
                <span className="text-xs font-normal text-gray-500 ml-0.5">km</span>
              </p>
            </div>

            {/* Day duration + remaining drive time */}
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Rijtijd</p>
              <p className="text-lg font-bold text-gray-900">
                {detail.total_duration_display || '00:00'}
              </p>
              <p className="text-xs text-gray-400">{detail.trip_count} rit(ten)</p>
            </div>
          </div>

          {/* Remaining drive time bar (EU 561/2006) */}
          {detail.total_duration_seconds > 0 && (
            <div className="px-4 py-2 bg-gray-50 border-t">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">Resterende rijtijd (EU max 9u)</span>
                <span className={`text-xs font-bold ${detail.remaining_drive_seconds <= 1800 ? 'text-red-600' : detail.remaining_drive_seconds <= 3600 ? 'text-amber-600' : 'text-green-600'}`}>
                  {detail.remaining_drive_display}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full">
                <div
                  className={`h-2 rounded-full transition-all ${
                    detail.remaining_drive_seconds <= 1800 ? 'bg-red-500' :
                    detail.remaining_drive_seconds <= 3600 ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, (detail.total_duration_seconds / (9 * 3600)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Fuel info (only on today) */}
          {isToday && pos && pos.fuel_level > 0 && (
            <div className="px-4 py-2 flex items-center gap-3 bg-gray-50">
              <span className="text-sm text-gray-600">⛽ Brandstof:</span>
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1 h-2 bg-gray-200 rounded-full max-w-[120px]">
                  <div
                    className={`h-2 rounded-full ${pos.fuel_level > 25 ? 'bg-green-500' : pos.fuel_level > 10 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(pos.fuel_level, 100)}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-700">{Math.round(pos.fuel_level)}%</span>
                {pos.fuel_remaining_km && (
                  <span className="text-xs text-gray-400">~{pos.fuel_remaining_km} km</span>
                )}
              </div>
            </div>
          )}

          {/* Fuel consumption stats */}
          {(detail.total_fuel_used_pct != null && detail.total_fuel_used_pct > 0) && (
            <div className="px-4 py-2 bg-gray-50 border-t">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Verbruikt</p>
                  <p className="text-sm font-bold text-gray-900">
                    {detail.total_fuel_used_liters != null
                      ? <>{detail.total_fuel_used_liters} <span className="text-xs font-normal text-gray-500">L</span></>
                      : <>{detail.total_fuel_used_pct} <span className="text-xs font-normal text-gray-500">%</span></>
                    }
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Gem. verbruik</p>
                  <p className="text-sm font-bold text-gray-900">
                    {detail.avg_fuel_consumption != null
                      ? <>{detail.avg_fuel_consumption} <span className="text-xs font-normal text-gray-500">L/100km</span></>
                      : detail.avg_fuel_consumption_pct != null
                        ? <>{detail.avg_fuel_consumption_pct} <span className="text-xs font-normal text-gray-500">%/100km</span></>
                        : <span className="text-gray-400">-</span>
                    }
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Per uur</p>
                  <p className="text-sm font-bold text-gray-900">
                    {detail.fuel_per_hour != null
                      ? <>{detail.fuel_per_hour} <span className="text-xs font-normal text-gray-500">L/u</span></>
                      : detail.fuel_per_hour_pct != null
                        ? <>{detail.fuel_per_hour_pct} <span className="text-xs font-normal text-gray-500">%/u</span></>
                        : <span className="text-gray-400">-</span>
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Fuel consumption chart */}
          {detail.fuel_chart_data && detail.fuel_chart_data.length >= 2 && (
            <FuelChart data={detail.fuel_chart_data} tankCapacity={detail.fuel_tank_capacity} />
          )}

          {/* Current location (only on today) */}
          {isToday && pos && pos.address && (
            <div className="px-4 py-2 flex items-center gap-2 text-sm text-gray-600 bg-gray-50">
              <MapPinIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate">{pos.address}</span>
            </div>
          )}

          {/* Trip table */}
          <div className="p-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <ClockIcon className="h-4 w-4 text-gray-500" />
              Ritten ({detail.trip_count})
            </h4>

            {detail.trips.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                Geen ritten op deze dag
              </p>
            ) : (
              <div className="space-y-2">
                {detail.trips.map((trip: VehicleDetailTrip, idx: number) => (
                  <TripRow key={idx} trip={trip} index={idx + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TripRow({ trip, index }: { trip: VehicleDetailTrip; index: number }) {
  return (
    <div className={`rounded-lg border p-3 ${trip.is_speeding ? 'border-red-200 bg-red-50/50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-gray-400 shrink-0">#{index}</span>
          <span className="text-xs text-gray-500">
            {formatTime(trip.start_time)} → {formatTime(trip.end_time)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">{trip.duration_display}</span>
          <span className="text-xs font-medium text-gray-700">{trip.distance_km} km</span>
        </div>
      </div>

      {/* Route A → B */}
      <div className="flex items-start gap-2 text-xs">
        <div className="flex flex-col items-center mt-0.5 shrink-0">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <div className="w-px h-4 bg-gray-300" />
          <div className="h-2 w-2 rounded-full bg-red-500" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-gray-700 truncate">{trip.start_address || 'Onbekend'}</p>
          <p className="text-gray-700 truncate">{trip.end_address || 'Onbekend'}</p>
        </div>
      </div>

      {/* Speed + km stand + fuel */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200/50">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>📍 {trip.start_km.toLocaleString('nl-NL')} → {trip.end_km.toLocaleString('nl-NL')} km</span>
          {trip.fuel_used_liters != null && trip.fuel_used_liters > 0 && (
            <span>⛽ -{trip.fuel_used_liters} L</span>
          )}
        </div>
        {trip.max_speed > 0 && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trip.is_speeding ? 'text-red-600' : 'text-gray-600'}`}>
            {trip.is_speeding && <ExclamationTriangleIcon className="h-3.5 w-3.5" />}
            <span>Max {trip.max_speed} km/h</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Interactive fuel consumption chart with hover tooltips */
function FuelChart({ data, tankCapacity }: { data: FuelChartPoint[]; tankCapacity: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; point: typeof parsed[0] } | null>(null)

  const W = 360
  const H = 130
  const PAD = { top: 16, right: 14, bottom: 26, left: 36 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom

  const useLiters = tankCapacity > 0 && data.every(p => p.fuel_liters != null)
  const maxVal = useLiters ? tankCapacity : 100
  const unit = useLiters ? 'L' : '%'

  const times = data.map(p => new Date(p.timestamp).getTime())
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const rangeT = maxT - minT || 1

  const parsed = data.map((p, i) => {
    const x = PAD.left + ((times[i] - minT) / rangeT) * cw
    const val = useLiters ? (p.fuel_liters ?? 0) : p.fuel_level
    const y = PAD.top + ch - (val / maxVal) * ch
    return { x, y, val, time: new Date(p.timestamp), event: p.event, fuel_level: p.fuel_level, fuel_liters: p.fuel_liters }
  })

  const linePoints = parsed.map(p => `${p.x},${p.y}`).join(' ')
  const areaPoints = `${PAD.left},${PAD.top + ch} ${linePoints} ${parsed[parsed.length - 1].x},${PAD.top + ch}`

  const yLabels = [0, Math.round(maxVal * 0.25), Math.round(maxVal * 0.5), Math.round(maxVal * 0.75), maxVal]
  const fmtTime = (d: Date) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  // Generate intermediate x-axis time labels
  const xLabels: { x: number; label: string }[] = []
  if (parsed.length >= 2) {
    xLabels.push({ x: PAD.left, label: fmtTime(parsed[0].time) })
    if (parsed.length >= 4) {
      const mid = parsed[Math.floor(parsed.length / 2)]
      xLabels.push({ x: mid.x, label: fmtTime(mid.time) })
    }
    xLabels.push({ x: W - PAD.right, label: fmtTime(parsed[parsed.length - 1].time) })
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const mouseX = (e.clientX - rect.left) * scaleX

    // Find nearest point
    let nearest = parsed[0]
    let minDist = Infinity
    for (const p of parsed) {
      const dist = Math.abs(p.x - mouseX)
      if (dist < minDist) {
        minDist = dist
        nearest = p
      }
    }

    // Convert SVG coords to pixel coords for tooltip
    const pixelX = nearest.x / scaleX + rect.left - (containerRef.current?.getBoundingClientRect().left ?? 0)
    const pixelY = nearest.y / (H / rect.height) + rect.top - (containerRef.current?.getBoundingClientRect().top ?? 0)

    setHover({ x: pixelX, y: pixelY, point: nearest })
  }, [parsed])

  const handleMouseLeave = useCallback(() => setHover(null), [])

  return (
    <div className="px-4 py-3 border-t" ref={containerRef}>
      <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        ⛽ Brandstofverloop
      </h4>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair"
          style={{ maxHeight: 180 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Grid lines */}
          {yLabels.map(v => {
            const y = PAD.top + ch - (v / maxVal) * ch
            return (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={v > 0 && v < maxVal ? '2,2' : 'none'} />
                <text x={PAD.left - 4} y={y + 3} textAnchor="end" className="text-[7px] fill-gray-400" style={{ fontSize: '7px' }}>
                  {v}{unit}
                </text>
              </g>
            )
          })}

          {/* Chart border */}
          <rect x={PAD.left} y={PAD.top} width={cw} height={ch} fill="none" stroke="#e5e7eb" strokeWidth={0.5} />

          {/* Area fill */}
          <polygon points={areaPoints} fill="url(#fuelGradInteractive)" opacity={0.2} />

          {/* Line */}
          <polyline points={linePoints} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Data points */}
          {parsed.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3.5}
              fill={p.event === 'trip_start' ? '#22c55e' : '#ef4444'}
              stroke="white" strokeWidth={1.5}
            />
          ))}

          {/* Hover vertical line */}
          {hover && (
            <line
              x1={hover.point.x} x2={hover.point.x}
              y1={PAD.top} y2={PAD.top + ch}
              stroke="#6b7280" strokeWidth={0.8} strokeDasharray="3,2"
            />
          )}

          {/* Hover highlight circle */}
          {hover && (
            <circle cx={hover.point.x} cy={hover.point.y} r={5}
              fill={hover.point.event === 'trip_start' ? '#22c55e' : '#ef4444'}
              stroke="white" strokeWidth={2}
            />
          )}

          {/* X-axis labels */}
          {xLabels.map((lbl, i) => (
            <text key={i} x={lbl.x} y={H - 4}
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
              className="text-[7px] fill-gray-400" style={{ fontSize: '7px' }}>
              {lbl.label}
            </text>
          ))}

          <defs>
            <linearGradient id="fuelGradInteractive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
        </svg>

        {/* Tooltip overlay */}
        {hover && (
          <div
            className="absolute z-10 pointer-events-none bg-gray-900 text-white rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{
              left: Math.min(hover.x, (containerRef.current?.offsetWidth ?? 300) - 150),
              top: Math.max(0, hover.y - 70),
              minWidth: 130,
            }}
          >
            <p className="font-semibold mb-1">{fmtTime(hover.point.time)}</p>
            <p>
              <span className="text-gray-300">Niveau:</span>{' '}
              <span className="font-medium">{hover.point.fuel_level}%</span>
            </p>
            {hover.point.fuel_liters != null && (
              <p>
                <span className="text-gray-300">In tank:</span>{' '}
                <span className="font-medium">{hover.point.fuel_liters} L</span>
              </p>
            )}
            <p className="mt-0.5">
              <span className={`inline-block w-2 h-2 rounded-full mr-1 ${hover.point.event === 'trip_start' ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-gray-300">{hover.point.event === 'trip_start' ? 'Start rit' : 'Einde rit'}</span>
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" /> Start rit
        </span>
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> Einde rit
        </span>
        <span className="flex items-center gap-1 text-[11px] text-gray-400 ml-auto">
          Beweeg muis over grafiek
        </span>
      </div>
    </div>
  )
}
