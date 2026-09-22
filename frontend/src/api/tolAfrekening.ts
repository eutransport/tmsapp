/**
 * Tolafrekening van de opdrachtgever — PDF inlezen en vergelijken met onze tolheffing.
 *
 * De opdrachtgever vergoedt per periode een bedrag aan tolheffing (de 'Maut').
 * Hier lezen we die afrekening in en zetten we er naast wat wij werkelijk
 * betaald hebben, gesplitst naar binnen de werkdag, weekend en avond/nacht.
 */
import api from './client'

/** Waarom een regel aandacht vraagt. */
export type AfrekeningSignaal =
  | 'ok'
  | 'tekort'
  | 'niet_gekoppeld'
  | 'geen_tolregels'
  | 'geen_vergoeding'

export type AfrekeningKoppeling = 'gekoppeld' | 'geen_voertuig' | 'meerdere'

export interface AfrekeningRegel {
  id: string
  regelnummer: string
  voertuig_label: string
  ritnummer: string
  kenteken: string
  koppeling: AfrekeningKoppeling
  vehicle_id: string | null
  inzetdagen: number
  ritten: number
  kilometers_afrekening: number
  netto_bedrag: number
  dagforfait: number
  brandstoftoeslag: number
  maut_gevonden: boolean

  /** Tolvergoeding die wij van de opdrachtgever kregen. */
  ontvangen: number
  /** Tolheffing die wij werkelijk betaald hebben. */
  betaald: number
  /** Positief = wij betaalden meer tol dan we vergoed kregen. */
  verschil: number
  passages: number
  km_tol: number
  signaal: AfrekeningSignaal

  binnen_bedrag: number
  binnen_aantal: number
  weekend_bedrag: number
  weekend_aantal: number
  avond_bedrag: number
  avond_aantal: number
  buiten_bedrag: number
  buiten_aantal: number
  tekort_binnen: number

  prive_bedrag: number
  prive_aantal: number
  gefactureerd_bedrag: number
  open_binnen_aantal: number
}

export interface AfrekeningTotalen {
  voertuigen: number
  ongekoppeld: number
  aandacht: number
  ontvangen: number
  betaald: number
  verschil: number
  binnen_bedrag: number
  binnen_aantal: number
  weekend_bedrag: number
  weekend_aantal: number
  avond_bedrag: number
  avond_aantal: number
  buiten_bedrag: number
  buiten_aantal: number
  tekort_binnen: number
  prive_bedrag: number
  prive_aantal: number
  gefactureerd_bedrag: number
  netto_bedrag: number
  dagforfait: number
  brandstoftoeslag: number
  kilometers_afrekening: number
  km_tol: number
  passages: number
  inzetdagen: number
  ritten: number
  open_binnen_aantal: number
}

export interface AfrekeningDetail {
  id: string
  bestandsnaam: string
  bonnummer: string
  klantnummer: string
  factuurdatum: string | null
  periode_van: string
  periode_tot: string
  werktijd_van: string
  werktijd_tot: string
  bedrijf_id: string | null
  bedrijf_naam: string
  geuploaded_door: string
  created_at: string
  waarschuwingen: string[]
  regels: AfrekeningRegel[]
  totalen: AfrekeningTotalen
}

export interface AfrekeningRij {
  id: string
  bestandsnaam: string
  bonnummer: string
  klantnummer: string
  factuurdatum: string | null
  periode_van: string
  periode_tot: string
  bedrijf_naam: string
  totaal_netto: number
  totaal_maut: number
  voertuigen: number
  ongekoppeld: number
  waarschuwingen: number
  werktijd_van: string
  werktijd_tot: string
  geuploaded_door: string
  created_at: string
}

export interface AfrekeningPassage {
  id: string
  start_at: string
  bedrag: number
  km: number
  kenteken: string
  prive: boolean
  gefactureerd: boolean
  tijdvak: 'binnen' | 'weekend' | 'avond'
}

export interface AfrekeningPassages {
  regel: { id: string; voertuig_label: string; ritnummer: string; kenteken: string }
  passages: AfrekeningPassage[]
}

export interface MarkeerResultaat {
  gemarkeerd?: number
  teruggedraaid?: number
  analyse: AfrekeningDetail
}

const BASIS = '/tolling/afrekeningen'

export const tolAfrekeningApi = {
  async lijst(): Promise<AfrekeningRij[]> {
    const { data } = await api.get<AfrekeningRij[]>(`${BASIS}/`)
    return data
  },

  async detail(id: string): Promise<AfrekeningDetail> {
    const { data } = await api.get<AfrekeningDetail>(`${BASIS}/${id}/`)
    return data
  },

  async upload(
    bestand: File,
    werktijd?: { van: string; tot: string },
  ): Promise<AfrekeningDetail> {
    const body = new FormData()
    body.append('bestand', bestand)
    if (werktijd) {
      body.append('werktijd_van', werktijd.van)
      body.append('werktijd_tot', werktijd.tot)
    }
    const { data } = await api.post<AfrekeningDetail>(`${BASIS}/`, body, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Een afrekening met veel voertuigen mag wat langer duren dan de standaard.
      timeout: 120000,
    })
    return data
  },

  async verwijder(id: string): Promise<void> {
    await api.delete(`${BASIS}/${id}/`)
  },

  async werktijden(id: string, van: string, tot: string): Promise<AfrekeningDetail> {
    const { data } = await api.post<AfrekeningDetail>(`${BASIS}/${id}/werktijden/`, {
      werktijd_van: van,
      werktijd_tot: tot,
    })
    return data
  },

  async markeerGefactureerd(id: string, regels?: string[]): Promise<MarkeerResultaat> {
    const { data } = await api.post<MarkeerResultaat>(
      `${BASIS}/${id}/markeer-gefactureerd/`, { regels: regels ?? [] })
    return data
  },

  async markeringOngedaan(id: string, regels?: string[]): Promise<MarkeerResultaat> {
    const { data } = await api.post<MarkeerResultaat>(
      `${BASIS}/${id}/markering-ongedaan/`, { regels: regels ?? [] })
    return data
  },

  async passages(id: string, regel: string): Promise<AfrekeningPassages> {
    const { data } = await api.get<AfrekeningPassages>(
      `${BASIS}/${id}/passages/`, { params: { regel } })
    return data
  },
}
