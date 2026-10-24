import api from './client'

export type RuleAction = 'allow' | 'block'
export type EnforcementMode = 'monitor' | 'enforce'
export type LogDecision = 'allowed' | 'blocked' | 'would_block'

export interface GeoBlockSettings {
  enabled: boolean
  mode: EnforcementMode
  default_action: RuleAction
  block_unknown_country: boolean
  allow_superuser_bypass: boolean
  log_allowed: boolean
  log_retention_days: number
  updated_at?: string
  updated_by_naam?: string
  database_beschikbaar?: boolean
  database_pad?: string
}

export interface GeoRule {
  id: number
  country_code: string
  role: string
  action: RuleAction
  priority: number
  active: boolean
  notes: string
  created_at?: string
}

export interface IPRule {
  id: number
  cidr: string
  action: RuleAction
  label: string
  active: boolean
  created_at?: string
}

export interface GeoAccessLog {
  id: number
  created_at: string
  ip_address: string | null
  country_code: string
  role: string
  gebruiker: string
  path: string
  method: string
  decision: LogDecision
  reason: string
}

export interface GeoKeuze {
  waarde: string
  label: string
}

export interface GeoStatus {
  jouw_ip: string
  jouw_land: string
  jouw_rol: string
  huidige_uitkomst: {
    toegestaan: boolean
    zou_blokkeren: boolean
    reden: string
  }
  database_beschikbaar: boolean
  database_pad: string
  rollen: GeoKeuze[]
  acties: GeoKeuze[]
  modi: GeoKeuze[]
}

export interface GeoTestResultaat {
  ip: string
  rol: string
  land: string
  toegestaan: boolean
  reden: string
}

export interface GeoSamenvatting {
  periode_dagen: number
  totaal: number
  per_land: { country_code: string; aantal: number }[]
  per_beslissing: { decision: LogDecision; aantal: number }[]
}

export const geoBlockingApi = {
  getStatus: async (): Promise<GeoStatus> => {
    const response = await api.get('/geoblocking/status/')
    return response.data
  },

  getSettings: async (): Promise<GeoBlockSettings> => {
    const response = await api.get('/geoblocking/settings/')
    return response.data
  },

  updateSettings: async (
    data: Partial<GeoBlockSettings> & { force?: boolean }
  ): Promise<GeoBlockSettings> => {
    const response = await api.put('/geoblocking/settings/', data)
    return response.data
  },

  listRules: async (): Promise<GeoRule[]> => {
    const response = await api.get('/geoblocking/rules/')
    return response.data
  },

  createRule: async (data: Partial<GeoRule>): Promise<GeoRule> => {
    const response = await api.post('/geoblocking/rules/', data)
    return response.data
  },

  updateRule: async (id: number, data: Partial<GeoRule>): Promise<GeoRule> => {
    const response = await api.patch(`/geoblocking/rules/${id}/`, data)
    return response.data
  },

  deleteRule: async (id: number): Promise<void> => {
    await api.delete(`/geoblocking/rules/${id}/`)
  },

  listIpRules: async (): Promise<IPRule[]> => {
    const response = await api.get('/geoblocking/ip-rules/')
    return response.data
  },

  createIpRule: async (data: Partial<IPRule>): Promise<IPRule> => {
    const response = await api.post('/geoblocking/ip-rules/', data)
    return response.data
  },

  deleteIpRule: async (id: number): Promise<void> => {
    await api.delete(`/geoblocking/ip-rules/${id}/`)
  },

  listLogs: async (params?: { decision?: string; country?: string }) => {
    const response = await api.get('/geoblocking/logs/', { params })
    return response.data
  },

  samenvatting: async (): Promise<GeoSamenvatting> => {
    const response = await api.get('/geoblocking/logs/samenvatting/')
    return response.data
  },

  test: async (ip: string, rol: string): Promise<GeoTestResultaat> => {
    const response = await api.post('/geoblocking/test/', { ip, rol })
    return response.data
  },
}
