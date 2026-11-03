/**
 * Charters API (alleen admin)
 * Beheer van charters, hun volgbare wagens en de periodes per chauffeur.
 */
import api from './client'

export interface Charter {
  id: string
  naam: string
  kvk: string
  contactpersoon: string
  email: string
  telefoon: string
  voertuigen: string[]
  voertuig_kentekens: string[]
  aantal_chauffeurs: number
  created_at: string
  updated_at: string
}

export type CharterInput = Pick<Charter, 'naam' | 'kvk' | 'contactpersoon' | 'email' | 'telefoon' | 'voertuigen'>

export interface CharterPeriode {
  id: string
  driver: string
  driver_naam: string
  charter: string
  charter_naam: string
  vanaf: string | null
  tot: string | null
}

const lijst = <T,>(data: T[] | { results: T[] }): T[] => (Array.isArray(data) ? data : data.results)

export const chartersApi = {
  lijst: async (): Promise<Charter[]> => {
    const { data } = await api.get('/drivers/charters/')
    return lijst<Charter>(data)
  },
  maak: async (invoer: CharterInput): Promise<Charter> => {
    const { data } = await api.post('/drivers/charters/', invoer)
    return data
  },
  wijzig: async (id: string, invoer: Partial<CharterInput>): Promise<Charter> => {
    const { data } = await api.patch(`/drivers/charters/${id}/`, invoer)
    return data
  },
  verwijder: async (id: string): Promise<void> => {
    await api.delete(`/drivers/charters/${id}/`)
  },
  periodes: async (charter: string): Promise<CharterPeriode[]> => {
    const { data } = await api.get('/drivers/charter-periodes/', { params: { charter } })
    return lijst<CharterPeriode>(data)
  },
  wijzigPeriode: async (id: string, invoer: { vanaf: string | null; tot: string | null }): Promise<CharterPeriode> => {
    const { data } = await api.patch(`/drivers/charter-periodes/${id}/`, invoer)
    return data
  },
  verwijderPeriode: async (id: string): Promise<void> => {
    await api.delete(`/drivers/charter-periodes/${id}/`)
  },
}
