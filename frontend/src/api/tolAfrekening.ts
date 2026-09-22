/**
 * Tolafrekening van de opdrachtgever — PDF inlezen en vergelijken met onze tolheffing.
 *
 * De opdrachtgever vergoedt per periode een bedrag aan tolheffing (de 'Maut').
 * Hier lezen we die afrekeningen in en zetten we er naast wat wij werkelijk
 * betaald hebben, gesplitst naar binnen de werkdag, weekend en avond/nacht.
 *
 * Het overzicht kan over één bon gaan of over een week, maand, kwartaal of jaar.
 * Een afrekening telt mee in de periode waarin hij *begint*, zodat een bon nooit
 * over twee perioden verdeeld of dubbel geteld wordt.
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

export type PeriodeSoort = 'week' | 'maand' | 'kwartaal' | 'jaar' | 'alles' | 'afrekening'

/** Eén wagen binnen de gekozen periode, opgeteld over alle bonnen. */
export interface AfrekeningRegel {
  /** Het ritnummer, of bij ontbreken het voertuiglabel van de bon. */
  id: string
  regel_ids: string[]
  ritnummer: string
  voertuig_label: string
  kenteken: string
  kentekens: string[]
  /** Kenteken(s) waar dit ritnummer nu in de vloot op staat. */
  huidig_kenteken: string
  /** De koppeling is verouderd doordat de vloot daarna gewijzigd is. */
  koppeling_verouderd: boolean
  koppeling: AfrekeningKoppeling
  vehicle_id: string | null
  /** Op hoeveel bonnen deze wagen in de periode voorkomt. */
  afrekeningen: number
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

/** Een bon die in de gekozen periode meetelt. */
export interface AfrekeningBron {
  id: string
  bestandsnaam: string
  bonnummer: string
  klantnummer: string
  factuurdatum: string | null
  periode_van: string
  periode_tot: string
  totaal_netto: number
  totaal_maut: number
  voertuigen: number
  werktijd_van: string
  werktijd_tot: string
  geuploaded_door: string
  created_at: string
}

export interface AfrekeningFilter {
  soort: PeriodeSoort
  jaar: number | null
  index: number | null
  label: string
  van: string | null
  tot: string | null
  afrekening?: string
  vorige?: { jaar: number; index: number }
  volgende?: { jaar: number; index: number }
}

export interface PeriodeKeuze {
  jaar: number
  index: number
  label: string
  aantal: number
}

/** Het volledige overzicht over de gekozen periode. */
export interface AfrekeningOverzicht {
  filter: AfrekeningFilter
  beschikbaar: PeriodeKeuze[]
  afrekeningen: AfrekeningBron[]
  periode_van: string | null
  periode_tot: string | null
  werktijd_van: string
  werktijd_tot: string
  bedrijf_naam: string
  waarschuwingen: string[]
  regels: AfrekeningRegel[]
  totalen: AfrekeningTotalen
  verouderde_koppelingen: number
}

/** Regel uit de eenvoudige lijst van ingelezen bonnen. */
export interface AfrekeningRij extends AfrekeningBron {
  bedrijf_naam: string
  ongekoppeld: number
  waarschuwingen: number
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
  regel: { ritnummer: string; voertuig_label: string; kenteken: string } | null
  passages: AfrekeningPassage[]
}

/** Wat het inlezen van één PDF teruggeeft. */
export interface UploadResultaat {
  id: string
  bonnummer: string
  bestandsnaam: string
  periode_van: string
  periode_tot: string
  totalen: AfrekeningTotalen
}

export interface MarkeerResultaat {
  gemarkeerd?: number
  teruggedraaid?: number
  aangepast?: number
  analyse: AfrekeningOverzicht
}

/** De parameters die de gekozen periode beschrijven. */
export interface SelectieParams {
  periode?: PeriodeSoort
  jaar?: number | null
  index?: number | null
  afrekening?: string
}

const BASIS = '/tolling/afrekeningen'

/** Lege waarden weglaten, anders stuurt axios 'null' als tekst mee. */
function schoon(params: SelectieParams): Record<string, string> {
  const uit: Record<string, string> = {}
  if (params.afrekening) return { afrekening: params.afrekening }
  if (params.periode) uit.periode = params.periode
  if (params.jaar != null) uit.jaar = String(params.jaar)
  if (params.index != null) uit.index = String(params.index)
  return uit
}

export const tolAfrekeningApi = {
  async lijst(): Promise<AfrekeningRij[]> {
    const { data } = await api.get<AfrekeningRij[]>(`${BASIS}/`)
    return data
  },

  async overzicht(params: SelectieParams = {}): Promise<AfrekeningOverzicht> {
    const { data } = await api.get<AfrekeningOverzicht>(`${BASIS}/overzicht/`, {
      params: schoon(params),
    })
    return data
  },

  async upload(
    bestand: File,
    werktijd?: { van: string; tot: string },
  ): Promise<UploadResultaat> {
    const body = new FormData()
    body.append('bestand', bestand)
    if (werktijd) {
      body.append('werktijd_van', werktijd.van)
      body.append('werktijd_tot', werktijd.tot)
    }
    const { data } = await api.post<UploadResultaat>(`${BASIS}/`, body, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Een afrekening met veel voertuigen mag wat langer duren dan de standaard.
      timeout: 120000,
    })
    return data
  },

  async verwijder(id: string): Promise<void> {
    await api.delete(`${BASIS}/${id}/`)
  },

  async werktijden(
    params: SelectieParams,
    van: string,
    tot: string,
  ): Promise<AfrekeningOverzicht> {
    const { data } = await api.post<AfrekeningOverzicht>(`${BASIS}/werktijden/`, {
      ...schoon(params),
      werktijd_van: van,
      werktijd_tot: tot,
    })
    return data
  },

  async markeerGefactureerd(params: SelectieParams): Promise<MarkeerResultaat> {
    const { data } = await api.post<MarkeerResultaat>(
      `${BASIS}/markeer-gefactureerd/`, schoon(params))
    return data
  },

  async markeringOngedaan(params: SelectieParams): Promise<MarkeerResultaat> {
    const { data } = await api.post<MarkeerResultaat>(
      `${BASIS}/markering-ongedaan/`, schoon(params))
    return data
  },

  async herkoppel(params: SelectieParams): Promise<MarkeerResultaat> {
    const { data } = await api.post<MarkeerResultaat>(
      `${BASIS}/herkoppel/`, schoon(params))
    return data
  },

  async passages(params: SelectieParams, rit: string): Promise<AfrekeningPassages> {
    const { data } = await api.get<AfrekeningPassages>(`${BASIS}/passages/`, {
      params: { ...schoon(params), rit },
    })
    return data
  },
}

export default tolAfrekeningApi
