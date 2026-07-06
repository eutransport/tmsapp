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
  time_window_start: string | null   // 'HH:MM:SS' from Django TimeField
  time_window_end: string | null
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
  start_time: string | null   // 'HH:MM:SS'
  end_time: string | null
  photo_url: string | null
  extraction_provider: string
  total_distance_m: number | null
  total_duration_s: number | null
  stop_count: number
  stops: LoadStop[]
  created_at: string
  updated_at: string
}

export interface Depot {
  id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  is_default: boolean
  is_active: boolean
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
  time_window_start?: string | null   // 'HH:MM'
  time_window_end?: string | null
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

  upload: async (payload: { photo: File; name?: string; start_address?: string; start_time?: string; end_time?: string }): Promise<LoadList> => {
    const form = new FormData()
    form.append('photo', payload.photo)
    if (payload.name) form.append('name', payload.name)
    if (payload.start_address) form.append('start_address', payload.start_address)
    if (payload.start_time) form.append('start_time', payload.start_time)
    if (payload.end_time) form.append('end_time', payload.end_time)
    const { data } = await api.post('/loadlist/lists/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  appendPhoto: async (id: string, photo: File): Promise<LoadList> => {
    const form = new FormData()
    form.append('photo', photo)
    const { data } = await api.post(`/loadlist/lists/${id}/append/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return data
  },

  update: async (id: string, patch: { name?: string; start_address?: string; start_time?: string | null; end_time?: string | null }): Promise<LoadList> => {
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

  // -- depots (admin manages, everyone reads) -----------------------------
  depots: {
    list: async (): Promise<Depot[]> => {
      const { data } = await api.get('/loadlist/depots/')
      return Array.isArray(data) ? data : (data.results ?? [])
    },
    create: async (payload: { name: string; address: string; is_default?: boolean; is_active?: boolean }): Promise<Depot> => {
      const { data } = await api.post('/loadlist/depots/', payload)
      return data
    },
    update: async (id: string, patch: Partial<{ name: string; address: string; is_default: boolean; is_active: boolean }>): Promise<Depot> => {
      const { data } = await api.patch(`/loadlist/depots/${id}/`, patch)
      return data
    },
    remove: async (id: string): Promise<void> => {
      await api.delete(`/loadlist/depots/${id}/`)
    },
  },
}

export interface AddressSuggestion {
  label: string
  lat: number
  lng: number
}
