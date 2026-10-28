/**
 * Track & Trace API service
 * GPS location tracking, live vehicle positions, and route history.
 */
import api from './client'

// ============ Types ============

export interface TrackingSession {
  id: string
  user_name: string
  vehicle: string | null
  vehicle_kenteken: string | null
  vehicle_ritnummer: string | null
  vehicle_type: string | null
  started_at: string
  ended_at: string | null
  is_active: boolean
  last_location: LocationPoint | null
  duration_minutes: number
}

export interface LocationPoint {
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  recorded_at: string
}

export interface LiveVehicle {
  session_id: string
  user_name: string
  vehicle_id: string | null
  vehicle_kenteken: string | null
  vehicle_ritnummer: string | null
  vehicle_type: string | null
  latitude: number
  longitude: number
  speed: number | null
  heading: number | null
  accuracy: number | null
  recorded_at: string
  is_active: boolean
  vehicle_status?: 'driving' | 'idle' | 'parked'
}

export interface RouteHistory {
  session: TrackingSession
  points: LocationPoint[]
  total_points: number
  distance_km: number | null
}

export interface TrackingVehicle {
  id: string
  kenteken: string
  type_wagen: string
  ritnummer: string
}

export interface FMTrackPosition {
  object_id: string
  vehicle_name: string
  plate_number: string
  latitude: number
  longitude: number
  address: string
  timestamp: string
  speed: number
  heading: number
  ignition: boolean | null
  vehicle_status: 'driving' | 'idle' | 'parked'
  fuel_level: number
  fuel_remaining_km: number | null
  tms_vehicle: {
    id: string
    kenteken: string
    ritnummer: string
  } | null
}

export interface LocationSubmitData {
  latitude: number
  longitude: number
  accuracy?: number | null
  speed?: number | null
  heading?: number | null
  altitude?: number | null
  recorded_at: string
}

export interface LocationSubmitResult {
  accepted: number
  rejected: number
}

export interface RouteCoordinate {
  lat: number
  lng: number
  speed: number
  timestamp: string
}

export interface VehicleDetailTrip {
  start_time: string
  end_time: string
  start_address: string
  end_address: string
  start_lat: number | null
  start_lng: number | null
  end_lat: number | null
  end_lng: number | null
  start_km: number
  end_km: number
  distance_km: number
  duration_seconds: number
  duration_display: string
  /** Motor aan zonder afgelegde afstand: stilstand, geen rit. */
  is_idle: boolean
  max_speed: number
  is_speeding: boolean
  start_fuel_level: number
  end_fuel_level: number
  fuel_used_liters: number | null
}

export interface FuelChartPoint {
  timestamp: string
  fuel_level: number
  fuel_liters: number | null
  event: 'trip_start' | 'trip_end'
}

export interface VehicleDetail {
  object_id: string
  date: string
  vehicle: {
    name: string
    plate_number: string
    make: string
    model: string
  } | null
  current_position: {
    latitude: number
    longitude: number
    speed: number
    speed_source: 'live' | 'trip_avg' | 'day_avg'
    address: string
    vehicle_status: 'driving' | 'idle' | 'parked'
    fuel_level: number
    fuel_remaining_km: number | null
    heading: number | null
    timestamp: string
  } | null
  odometer_km: number
  total_distance_km: number
  total_duration_seconds: number
  total_duration_display: string
  /** Tijd met draaiende motor zonder dat er een meter is gereden. */
  idle_duration_seconds: number
  idle_duration_display: string
  /** Rijtijd plus stilstand: de totale tijd dat de motor aan stond. */
  engine_duration_seconds: number
  engine_duration_display: string
  max_speed: number
  trip_count: number
  trips: VehicleDetailTrip[]
  fuel_tank_capacity: number
  total_fuel_used_liters: number | null
  total_fuel_used_pct: number | null
  avg_fuel_consumption: number | null
  avg_fuel_consumption_pct: number | null
  fuel_per_hour: number | null
  fuel_per_hour_pct: number | null
  remaining_drive_seconds: number
  remaining_drive_display: string
  fuel_chart_data: FuelChartPoint[]
  route_coordinates: RouteCoordinate[]
}

// ============ API Functions ============

export const trackingApi = {
  // Session management
  getActiveSession: async (): Promise<TrackingSession | { active: false }> => {
    const response = await api.get('/tracking/session/')
    return response.data
  },

  startSession: async (vehicleId?: string): Promise<TrackingSession> => {
    const response = await api.post('/tracking/session/', {
      vehicle_id: vehicleId || null,
    })
    return response.data
  },

  stopSession: async (): Promise<{ stopped: boolean }> => {
    const response = await api.delete('/tracking/session/')
    return response.data
  },

  // Location submission
  submitLocation: async (data: LocationSubmitData): Promise<LocationSubmitResult> => {
    const response = await api.post('/tracking/location/', data)
    return response.data
  },

  submitLocationBatch: async (points: LocationSubmitData[]): Promise<LocationSubmitResult> => {
    const response = await api.post('/tracking/location/', { points })
    return response.data
  },

  // Live tracking
  getLivePositions: async (): Promise<LiveVehicle[]> => {
    const response = await api.get('/tracking/live/')
    return response.data
  },

  // Route history
  getSessionHistory: async (params?: {
    vehicle?: string
    date_from?: string
    date_to?: string
  }): Promise<TrackingSession[]> => {
    const response = await api.get('/tracking/history/', { params })
    return response.data
  },

  getSessionRoute: async (sessionId: string): Promise<RouteHistory> => {
    const response = await api.get(`/tracking/history/${sessionId}/`)
    return response.data
  },

  // Available vehicles for tracking
  getTrackingVehicles: async (): Promise<TrackingVehicle[]> => {
    const response = await api.get('/tracking/vehicles/')
    return response.data
  },

  // Get vehicle assigned to the current logged-in driver
  getMyVehicle: async (): Promise<{
    assigned: boolean
    vehicle?: TrackingVehicle
    driver_naam?: string
  }> => {
    const response = await api.get('/tracking/my-vehicle/')
    return response.data
  },

  // FM-Track vehicle positions
  getFMTrackPositions: async (): Promise<FMTrackPosition[]> => {
    const response = await api.get('/tracking/fm-positions/')
    return response.data.positions || []
  },

  // FM-Track vehicle detail with trip history
  getVehicleDetail: async (objectId: string, date?: string): Promise<VehicleDetail> => {
    const params: Record<string, string> = {}
    if (date) params.date = date
    const response = await api.get(`/tracking/fm-positions/${objectId}/detail/`, { params })
    return response.data
  },
}
