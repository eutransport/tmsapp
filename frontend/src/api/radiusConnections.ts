/**
 * Losse Radius-koppelingen: een eigen token per soort.
 * Telematica levert GPS en ritten, tankkaarten leveren de facturen en tol.
 */
import api from './client'

export type RadiusKoppelingSoort = 'telematics' | 'fuel'

export interface RadiusKoppeling {
  id: string
  naam: string
  soort: RadiusKoppelingSoort
  soort_label: string
  heeft_token: boolean
  customer_id: string
  start_datum: string | null
  actief: boolean
  laatste_controle: string | null
  laatste_resultaat: string
  created_at: string
  updated_at: string
}

export interface RadiusKoppelingInvoer {
  naam: string
  soort: RadiusKoppelingSoort
  /** Leeg laten bij een wijziging betekent: huidige token behouden. */
  api_token?: string
  customer_id?: string
  start_datum?: string | null
  actief?: boolean
}

const BASIS = '/tracking/radius/koppelingen/'

export async function getRadiusKoppelingen(): Promise<RadiusKoppeling[]> {
  const response = await api.get<RadiusKoppeling[] | { results: RadiusKoppeling[] }>(BASIS)
  const data = response.data
  return Array.isArray(data) ? data : data.results
}

export async function maakRadiusKoppeling(invoer: RadiusKoppelingInvoer): Promise<RadiusKoppeling> {
  const response = await api.post<RadiusKoppeling>(BASIS, invoer)
  return response.data
}

export async function wijzigRadiusKoppeling(
  id: string,
  invoer: Partial<RadiusKoppelingInvoer>,
): Promise<RadiusKoppeling> {
  const response = await api.patch<RadiusKoppeling>(`${BASIS}${id}/`, invoer)
  return response.data
}

export async function verwijderRadiusKoppeling(id: string): Promise<void> {
  await api.delete(`${BASIS}${id}/`)
}

export async function testRadiusKoppeling(
  id: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await api.post<{ ok: boolean; detail: string }>(`${BASIS}${id}/test/`)
    return response.data
  } catch (error: any) {
    return { ok: false, detail: error?.response?.data?.detail || 'Verbinding mislukt' }
  }
}
