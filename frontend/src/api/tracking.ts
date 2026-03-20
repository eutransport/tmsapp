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
}
