import api from './client'

export interface PortaalVoertuig {
  id: string
  kenteken: string
  type_wagen: string
}

export interface PortaalPositie {
  kenteken: string
  type_wagen: string
  latitude: number | null
  longitude: number | null
  speed: number | null
  direction: number | null
  timestamp: string | null
  address: string
}

export interface PortaalRit {
  id: string
  kenteken: string
  datum: string
  start_tijd: string
  eind_tijd: string | null
  start_adres: string
  start_plaats: string
  eind_adres: string
  eind_plaats: string
  start_latitude: number | null
  start_longitude: number | null
  eind_latitude: number | null
  eind_longitude: number | null
  afstand_km: number
  km_start: number | null
  km_eind: number | null
  bron: 'linqo' | 'radius'
}

export interface PortaalVoertuigDag {
  kenteken: string
  datum: string
  bron: 'linqo' | 'radius'
  ritten: PortaalRit[]
  aantal_ritten: number
  km_start: number | null
  km_eind: number | null
  km_gereden: number
  eerste_start: string | null
  laatste_eind: string | null
  rijdt: boolean
  snelheid: number
  motor_aan: boolean
  positie_adres: string
  positie_moment: string | null
  latitude: number | null
  longitude: number | null
}

export interface PortaalChauffeurUren {
  id: string
  naam: string
  kenteken: string
  uren_vandaag: number
  rijdt: boolean
  ritten_vandaag: number
  opdrachten_vandaag: number
  opdrachten_afgeleverd: number
}

export interface PortaalDashboard {
  opdrachten_totaal: number
  opdrachten_open: number
  opdrachten_vandaag_aangemaakt: number
  opdrachten_vandaag_afgeleverd: number
  chauffeurs: PortaalChauffeurUren[]
}

export const portaalTracking = {
  dashboard: async (): Promise<PortaalDashboard> => {
    const response = await api.get('/portaal/dashboard/')
    return response.data
  },
  voertuigen: async (): Promise<PortaalVoertuig[]> => {
    const response = await api.get('/portaal/voertuigen/')
    return response.data
  },
  posities: async (): Promise<{ positions: PortaalPositie[]; count: number }> => {
    const response = await api.get('/portaal/posities/')
    return response.data
  },
  ritten: async (params?: { kenteken?: string; dagen?: number }): Promise<PortaalRit[]> => {
    const response = await api.get('/portaal/ritten/', { params })
    return response.data
  },
  voertuigDag: async (kenteken: string, datum?: string): Promise<PortaalVoertuigDag> => {
    const response = await api.get(`/portaal/voertuigen/${encodeURIComponent(kenteken)}/dag/`, {
      params: datum ? { datum } : undefined,
    })
    return response.data
  },
}
