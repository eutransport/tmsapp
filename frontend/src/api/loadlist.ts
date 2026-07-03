/**
 * Laadlijsten API — upload photo, edit stops, optimize route.
 */
import api from './client'

export type LoadListStatus =
  | 'uploaded' | 'parsing' | 'parsed'
  | 'optimizing' | 'optimized' | 'error'

export interface LoadStop {
  id: string
  original_sequence: number
  delivery_sequence: number | null
  load_sequence: number | null
  address_raw: string
  address_formatted: string
  postcode: string
  city: string
  country: string
  reference: string
  colli: number | null
  pallets: number | null
  weight_kg: number | null
  notes: string
  lat: number | null
  lng: number | null
  geocode_confidence: string
  geocode_error: string
}

export interface LoadList {
  id: string
  name: string
  status: LoadListStatus
  status_message: string
  start_address: string
  start_lat: number | null
  start_lng: number | null
  photo_url: string | null
  extraction_provider: string
  total_distance_m: number | null
  total_duration_s: number | null
  stop_count: number
  stops: LoadStop[]
  created_at: string
  updated_at: string
}

export interface StopWrite {
  address_raw?: string
  postcode?: string
  city?: string
  country?: string
  reference?: string
  colli?: number | null
  pallets?: number | null
  weight_kg?: number | null
  notes?: string
}

export const loadlistApi = {
  list: async (): Promise<LoadList[]> => {
    const { data } = await api.get('/loadlist/lists/')
    return Array.isArray(data) ? data : (data.results ?? [])
  },

  get: async (id: string): Promise<LoadList> => {
    const { data } = await api.get(`/loadlist/lists/${id}/`)
    return data
  },

  upload: async (payload: { photo: File; name?: string; start_address?: string }): Promise<LoadList> => {
    const form = new FormData()
    form.append('photo', payload.photo)
    if (payload.name) form.append('name', payload.name)
    if (payload.start_address) form.append('start_address', payload.start_address)
    const { data } = await api.post('/loadlist/lists/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  update: async (id: string, patch: { name?: string; start_address?: string }): Promise<LoadList> => {
    const { data } = await api.patch(`/loadlist/lists/${id}/`, patch)
    return data
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/loadlist/lists/${id}/`)
  },

  updateStop: async (id: string, stopId: string, patch: StopWrite): Promise<LoadStop> => {
    const { data } = await api.patch(`/loadlist/lists/${id}/stops/${stopId}/`, patch)
    return data
  },

  deleteStop: async (id: string, stopId: string): Promise<void> => {
    await api.delete(`/loadlist/lists/${id}/stops/${stopId}/remove/`)
  },

  addStop: async (id: string, stop: StopWrite & { address_raw: string }): Promise<LoadStop> => {
    const { data } = await api.post(`/loadlist/lists/${id}/stops/add/`, stop)
    return data
  },

  optimize: async (id: string): Promise<LoadList> => {
    const { data } = await api.post(`/loadlist/lists/${id}/optimize/`, {}, { timeout: 120000 })
    return data
  },

  suggestAddress: async (q: string): Promise<AddressSuggestion[]> => {
    const { data } = await api.get('/loadlist/lists/suggest/', { params: { q } })
    return Array.isArray(data) ? data : []
  },
}

export interface AddressSuggestion {
  label: string
  lat: number
  lng: number
}
