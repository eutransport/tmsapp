/**
 * Navixy-koppeling: één API-sleutel, met daaronder de trackers per kenteken.
 * De sleutel is write-only; de server geeft alleen terug of er één is ingesteld.
 */
import api from './client'

export interface NavixyTracker {
  id: string
  koppeling: string
  tracker_id: number
  kenteken: string
  omschrijving: string
  actief: boolean
  created_at: string
  updated_at: string
}

export interface NavixyKoppeling {
  id: string
  naam: string
  heeft_sleutel: boolean
  basis_url: string
  actief: boolean
  laatste_controle: string | null
  laatste_resultaat: string
  trackers: NavixyTracker[]
  created_at: string
  updated_at: string
}

export interface NavixyKoppelingInvoer {
  naam: string
  /** Leeg laten bij een wijziging betekent: huidige sleutel behouden. */
  api_key?: string
  basis_url?: string
  actief?: boolean
}

export interface NavixyTrackerInvoer {
  koppeling: string
  tracker_id: number
  kenteken: string
  omschrijving?: string
  actief?: boolean
}

export interface NavixyBeschikbareTracker {
  tracker_id: number
  label: string
  model: string
  geblokkeerd: boolean
}

const KOPPELINGEN = '/tracking/navixy/koppelingen/'
const TRACKERS = '/tracking/navixy/trackers/'

export async function getNavixyKoppelingen(): Promise<NavixyKoppeling[]> {
  const response = await api.get<NavixyKoppeling[] | { results: NavixyKoppeling[] }>(KOPPELINGEN)
  const data = response.data
  return Array.isArray(data) ? data : data.results
}

export async function maakNavixyKoppeling(
  invoer: NavixyKoppelingInvoer,
): Promise<NavixyKoppeling> {
  const response = await api.post<NavixyKoppeling>(KOPPELINGEN, invoer)
  return response.data
}

export async function wijzigNavixyKoppeling(
  id: string,
  invoer: Partial<NavixyKoppelingInvoer>,
): Promise<NavixyKoppeling> {
  const response = await api.patch<NavixyKoppeling>(`${KOPPELINGEN}${id}/`, invoer)
  return response.data
}

export async function verwijderNavixyKoppeling(id: string): Promise<void> {
  await api.delete(`${KOPPELINGEN}${id}/`)
}

export async function testNavixyKoppeling(
  id: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await api.post<{ ok: boolean; detail: string }>(`${KOPPELINGEN}${id}/test/`)
    return response.data
  } catch (error: any) {
    return { ok: false, detail: error?.response?.data?.detail || 'Verbinding mislukt' }
  }
}

export async function getBeschikbareTrackers(
  id: string,
): Promise<NavixyBeschikbareTracker[]> {
  const response = await api.get<{ resultaten: NavixyBeschikbareTracker[] }>(
    `${KOPPELINGEN}${id}/beschikbaar/`,
  )
  return response.data.resultaten
}

export async function maakNavixyTracker(invoer: NavixyTrackerInvoer): Promise<NavixyTracker> {
  const response = await api.post<NavixyTracker>(TRACKERS, invoer)
  return response.data
}

export async function wijzigNavixyTracker(
  id: string,
  invoer: Partial<NavixyTrackerInvoer>,
): Promise<NavixyTracker> {
  const response = await api.patch<NavixyTracker>(`${TRACKERS}${id}/`, invoer)
  return response.data
}

export async function verwijderNavixyTracker(id: string): Promise<void> {
  await api.delete(`${TRACKERS}${id}/`)
}
