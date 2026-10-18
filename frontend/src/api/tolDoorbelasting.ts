/**
 * Tol betaald versus alles wat we ervoor terugkregen, per opdrachtgever en wagen.
 *
 * Een klant vergoedt tol op twee manieren: als tolregel op onze eigen factuur
 * (Mainfreight) of als Maut-vergoeding op een afrekening die de klant stuurt
 * (Dachser). Beide staan hier naast de betaalde tol.
 *
 * De bronnen zijn niet op dezelfde dag geboekt: een passage telt op zijn
 * rijdatum, een factuurregel op de factuurdatum en een afrekening op het begin
 * van de bon. Over een hele periode horen de totalen gelijk te zijn, per maand
 * niet.
 */
import api from './client'

/** Eén wagen binnen de gekozen periode. */
export interface DoorbelastingWagen {
  /** Genormaliseerd kenteken; leeg bij regels zonder kenteken. */
  kenteken: string
  kenteken_display: string
  betaald: number
  betaald_aantal: number
  /** Deel van `betaald` dat nog niet als gefactureerd gemarkeerd staat. */
  open_bedrag: number
  doorbelast: number
  doorbelast_aantal: number
  /** Maut-vergoeding uit de tolafrekeningen van de opdrachtgever. */
  vergoed: number
  vergoed_aantal: number
  /** Betaald min doorbelast min vergoed; positief = wij draaien ervoor op. */
  verschil: number
  in_vloot: boolean
}

export interface DoorbelastingMaand {
  /** 'YYYY-MM' */
  maand: string
  betaald: number
  doorbelast: number
  vergoed: number
  verschil: number
}

export interface DoorbelastingTotalen {
  betaald: number
  betaald_aantal: number
  open_bedrag: number
  doorbelast: number
  doorbelast_aantal: number
  vergoed: number
  vergoed_aantal: number
  verschil: number
}

export interface DoorbelastingOverzicht {
  periode: { van: string; tot: string }
  bedrijf_id: string | null
  wagens: DoorbelastingWagen[]
  maanden: DoorbelastingMaand[]
  totalen: DoorbelastingTotalen
  waarschuwingen: string[]
}

export interface DoorbelastingParams {
  date_from: string
  date_to: string
  bedrijf_id?: string
}

export const tolDoorbelastingApi = {
  async overzicht(params: DoorbelastingParams): Promise<DoorbelastingOverzicht> {
    const { data } = await api.get('/tolling/doorbelasting/overzicht/', { params })
    return data
  },
}
