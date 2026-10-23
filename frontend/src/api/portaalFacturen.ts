import api from './client'

export interface PortaalFactuur {
  id: string
  factuurnummer: string
  factuurdatum: string
  vervaldatum: string
  totaal: string
  credit: boolean
  betaald: boolean
  te_laat: boolean
  dagen_tot_vervaldatum: number | null
  heeft_tol: boolean
}

export interface PortaalFactuurSamenvatting {
  open_aantal: number
  open_bedrag: string
  te_laat_aantal: number
  te_laat_bedrag: string
  eerstvolgende: { factuurnummer: string; vervaldatum: string; totaal: string } | null
}

export type FactuurFilter = '' | 'open' | 'te_laat' | 'betaald'

export const portaalFacturen = {
  lijst: async (params: {
    filter?: FactuurFilter
    zoek?: string
    jaar?: string
    page?: number
    page_size?: number
  }): Promise<{ count: number; results: PortaalFactuur[] }> => {
    const { data } = await api.get('/portaal/facturen/', { params })
    return data
  },

  samenvatting: async (): Promise<PortaalFactuurSamenvatting> => {
    const { data } = await api.get('/portaal/facturen/samenvatting/')
    return data
  },

  pdf: async (id: string): Promise<Blob> => {
    const { data } = await api.get(`/portaal/facturen/${id}/pdf/`, { responseType: 'blob' })
    return data
  },

  tol: async (id: string): Promise<Blob> => {
    const { data } = await api.get(`/portaal/facturen/${id}/tol/`, { responseType: 'blob' })
    return data
  },
}
