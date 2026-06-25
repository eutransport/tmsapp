import api from './client'

export interface TolRit {
  id: string
  ritnummer: string
  volgorde: number
  rit_datum: string | null
}

export interface TolRegistratie {
  id: string
  user: string
  user_naam: string
  datum: string | null
  kenteken: string
  totaal_bedrag: string
  bijlage_url: string | null
  bijlage_naam: string | null
  ritten: TolRit[]
  status: 'ingediend' | 'gefactureerd'
  gefactureerd: boolean
  created_at: string
  updated_at: string
}

export interface TolRegistratieCreate {
  datum?: string
  kenteken?: string
  totaal_bedrag: string
  ritnummers?: string[]
  bijlage?: File | null
}

export interface TolRegistratieFilters {
  user?: string
  status?: string
  gefactureerd?: boolean
  datum__gte?: string
  datum__lte?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

export interface TolRegistratieListResponse {
  count: number
  next: string | null
  previous: string | null
  results: TolRegistratie[]
}

export async function getTolRegistraties(filters?: TolRegistratieFilters): Promise<TolRegistratieListResponse> {
  const params = new URLSearchParams()
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value))
      }
    })
  }
  const response = await api.get(`/time-entries/tol/?${params.toString()}`)
  return response.data
}

export async function createTolRegistratie(data: TolRegistratieCreate): Promise<TolRegistratie> {
  const formData = new FormData()
  if (data.datum) formData.append('datum', data.datum)
  if (data.kenteken) formData.append('kenteken', data.kenteken)
  formData.append('totaal_bedrag', data.totaal_bedrag)
  ;(data.ritnummers || []).forEach(rit => {
    const trimmed = rit.trim()
    if (trimmed) formData.append('ritnummers', trimmed)
  })
  if (data.bijlage) formData.append('bijlage', data.bijlage)

  const response = await api.post('/time-entries/tol/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function deleteTolRegistratie(id: string): Promise<void> {
  await api.delete(`/time-entries/tol/${id}/`)
}

export async function markTolGefactureerd(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => api.post(`/time-entries/tol/${id}/mark_gefactureerd/`)))
}

export async function markTolIngediend(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => api.post(`/time-entries/tol/${id}/mark_ingediend/`)))
}

export function getTolDownloadUrl(id: string): string {
  return `/time-entries/tol/${id}/download/`
}
