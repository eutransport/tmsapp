/**
 * Een tolperiode dichtzetten en, als het moet, weer openen.
 *
 * Afsluiten verwijdert niets: alles wat meegaat krijgt een verwijzing naar de
 * afsluiting en valt daarmee uit de gewone overzichten. De tellers beginnen
 * daarna weer bij nul, terwijl het archief gewoon te corrigeren blijft.
 */
import api from './client'

/** Wat er met de gekozen datum zou gebeuren. Vraagt alleen op, verandert niets. */
export interface AfsluitingVoorbeeld {
  tot_datum: string
  gefactureerd: { aantal: number; bedrag: number }
  openstaand: {
    aantal: number
    bedrag: number
    per_wagen: { kenteken: string; aantal: number; bedrag: number }[]
  }
  afrekeningen: { aantal: number; bedrag: number }
  toldagen: number
  prive_registraties: number
  /** Datum van de vorige afsluiting; nieuwe datum moet daarna liggen. */
  eerdere_afsluiting: string | null
}

export interface Afsluiting {
  id: string
  tot_datum: string
  omschrijving: string
  openstaand_meegenomen: boolean
  uitgevoerd_op: string
  uitgevoerd_door: string
  teruggedraaid_op: string | null
  teruggedraaid_door: string
  actief: boolean
  passages: number
  bedrag: number
  samenvatting: Partial<AfsluitingVoorbeeld>
}

export interface AfsluitingOverzicht {
  afsluitingen: Afsluiting[]
  /** Heeft deze gebruiker 2FA? Zo niet, dan vragen we het wachtwoord. */
  tweefactor: boolean
}

/** De extra bevestiging die bij elke onomkeerbare actie hoort. */
export interface Bevestiging {
  bevestigd: boolean
  code?: string
  wachtwoord?: string
}

export const tolAfsluitingApi = {
  async overzicht(): Promise<AfsluitingOverzicht> {
    const { data } = await api.get('/tolling/afsluitingen/')
    return data
  },

  async voorbeeld(totDatum: string): Promise<AfsluitingVoorbeeld> {
    const { data } = await api.get('/tolling/afsluitingen/voorbeeld/', {
      params: { tot_datum: totDatum },
    })
    return data
  },

  async afsluiten(payload: Bevestiging & {
    tot_datum: string
    omschrijving?: string
    openstaand_meenemen?: boolean
  }): Promise<{ id: string; afsluitingen: Afsluiting[] }> {
    const { data } = await api.post('/tolling/afsluitingen/afsluiten/', payload)
    return data
  },

  async terugdraaien(id: string, payload: Bevestiging): Promise<{ passages: number; afsluitingen: Afsluiting[] }> {
    const { data } = await api.post(`/tolling/afsluitingen/${id}/terugdraaien/`, payload)
    return data
  },
}
