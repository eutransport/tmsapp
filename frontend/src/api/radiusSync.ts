/**
 * Synchroniseren met Radius: GPS-ritten en de tol van de tank- en laadkaarten.
 */
import api from './client'

export interface GpsSyncResultaat {
  date_from: string
  date_to: string
  journeys_fetched: number
  journeys_created: number
  journeys_updated: number
  vehicles: number
  connections?: Array<{
    connection: string
    customer_name?: string
    journeys_fetched?: number
    journeys_created?: number
    error?: string
  }>
}

export interface TolRegelVoorbeeld {
  datum: string
  tijdstip: string
  kenteken: string
  bedrag: string
  kaartnummer: string
  product: string
  land: string
  land_bron: string
  afstand_km: string | null
  km_bron: string
  gps_km: string | null
  rit_venster: string
  voertuig_bekend: boolean
  ritnummer: string
  bedrijf: string
  bestaat_al: boolean
  opmerking: string
}

export interface TolAnalyse {
  date_from: string | null
  date_to: string | null
  aantal_regels: number
  totaal_bedrag: string
  per_land: Record<string, { regels: number; bedrag: string; km: string }>
  koppelingen: Array<{ connection: string; tolregels?: number; transacties?: number; error?: string }>
  overgeslagen: Array<{ koppeling: string; datum: string; kaart: string; bedrag: string; reden: string }>
  regels: TolRegelVoorbeeld[]
}

export interface TolImportResultaat {
  batch_id: string
  totaal: number
  geimporteerd: number
  duplicaten: number
  ongeldig: number
  zonder_bedrag: number
  zonder_gps: number
  koppelingen: TolAnalyse['koppelingen']
  overgeslagen: TolAnalyse['overgeslagen']
}

export async function syncGps(dagen: number): Promise<GpsSyncResultaat> {
  const { data } = await api.post<GpsSyncResultaat>('/tracking/radius/sync/', { days: dagen })
  return data
}

export interface GpsStap extends Partial<GpsSyncResultaat> {
  gelukt: boolean
  begrensd: boolean
  melding?: string
}

export interface OpenstaandSamenvatting {
  gereden_dagen: number
  gefactureerde_dagen: number
  nieuw_openstaand: number
  opnieuw_gecontroleerd: number
  alsnog_aangevuld: number
  totaal_openstaand: number
  oudste_openstaand: string | null
}

export interface RondeVoorbeeld extends TolAnalyse {
  date_from: string
  date_to: string
  gps: GpsStap
  openstaand: OpenstaandSamenvatting
}

export interface RondeResultaat {
  date_from: string
  date_to: string
  gps: GpsStap
  openstaand: OpenstaandSamenvatting
  koppelingen: TolAnalyse['koppelingen']
  overgeslagen: TolAnalyse['overgeslagen']
  import: {
    batch_id: string
    totaal: number
    geimporteerd: number
    duplicaten: number
    ongeldig: number
    zonder_bedrag: number
    zonder_gps: number
    zonder_km: number
  }
}

export interface OpenstaandeDag {
  id: string
  kenteken: string
  datum: string
  gps_ritten: number
  gps_km: string
  pogingen: number
  in_vloot: boolean
  laatst_gecontroleerd: string
}

type Periode = { date_from?: string; date_to?: string }

/** Facturen ophalen, GPS erbij synchroniseren en tonen wat het oplevert. */
export async function haalFacturenOp(periode: Periode): Promise<RondeVoorbeeld> {
  const { data } = await api.post<RondeVoorbeeld>('/tolling/radius-factuur/ophalen/', periode)
  return data
}

/** Dezelfde ronde, maar de tolregels worden ook echt ingelezen. */
export async function verwerkFacturen(periode: Periode): Promise<RondeResultaat> {
  const { data } = await api.post<RondeResultaat>(
    '/tolling/radius-factuur/ophalen-verwerken/', periode,
  )
  return data
}

export async function haalOpenstaand(): Promise<{ aantal: number; regels: OpenstaandeDag[] }> {
  const { data } = await api.get('/tolling/radius-factuur/openstaand/')
  return data
}

export async function analyseerTolUitApi(
  periode: { date_from?: string; date_to?: string },
): Promise<TolAnalyse> {
  const { data } = await api.post<TolAnalyse>('/tolling/radius-factuur/api-analyse/', periode)
  return data
}

export async function importeerTolUitApi(
  periode: { date_from?: string; date_to?: string },
): Promise<TolImportResultaat> {
  const { data } = await api.post<TolImportResultaat>(
    '/tolling/radius-factuur/api-importeren/', periode,
  )
  return data
}
