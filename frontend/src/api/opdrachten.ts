import api from './client'

export type OpdrachtStatus =
  | 'nieuw'
  | 'gestart'
  | 'afgeleverd'
  | 'niet_geleverd'
  | 'ingetrokken'

export interface OpdrachtBijlage {
  id: string
  bestandsnaam: string
  url: string | null
  geupload_door_naam: string | null
  created_at: string
}

export interface Opdracht {
  id: string
  bedrijf: string
  bedrijf_naam: string
  aangemaakt_door: string
  aangemaakt_door_naam: string
  chauffeur: string
  chauffeur_naam: string
  ritnummer: string | null
  klant_naam: string
  adres: string
  postcode: string
  plaats: string
  contactpersoon: string
  telefoon: string
  notitie: string
  geopend_tot: string | null
  volgorde: number
  status: OpdrachtStatus
  status_label: string
  gestart_op: string | null
  afgeleverd_op: string | null
  ingetrokken_op: string | null
  niet_geleverd_op: string | null
  niet_geleverd_reden: string
  laatste_mail_fout: string
  chauffeur_reactie: string
  kenteken: string
  bijlagen: OpdrachtBijlage[]
  created_at: string
  updated_at: string
}

export interface OpdrachtEta {
  id: string
  eta_aankomst: string | null
  eta_minuten: number | null
  eta_start_minuten: number | null
  eta_afstand_km: number | null
  eta_bijgewerkt_op: string | null
  eta_fout: string
}

export interface OpdrachtInvoer {
  chauffeur: string
  ritnummer?: string
  klant_naam: string
  adres: string
  postcode?: string
  plaats?: string
  contactpersoon?: string
  telefoon?: string
  notitie?: string
  geopend_tot?: string | null
}

export interface ChauffeurKeuze {
  id: string
  naam: string
  telefoon: string
}

export interface MailInstelling {
  id: string
  bedrijf: string
  afzender: string
  ontvangers: string[]
  mail_bij_start: boolean
  mail_bij_aflevering: boolean
  mail_bij_niet_geleverd: boolean
  taal: 'nl' | 'en' | 'tr'
}

export interface OpdrachtenPagina {
  count: number
  results: Opdracht[]
}

export const BIJLAGE_ACCEPT =
  'image/*,application/pdf,.pdf,.xls,.xlsx,.xlsm,.csv'

export interface OpdrachtFilters {
  [sleutel: string]: string | number | undefined
  page?: number
  page_size?: number
  status?: string
  chauffeur?: string
  bedrijf?: string
  search?: string
  ordering?: string
  archief?: string
  vandaag?: string
  open?: string
  klant?: string
}

function schoon(filters?: Record<string, unknown>) {
  const params: Record<string, string | number> = {}
  Object.entries(filters || {}).forEach(([sleutel, waarde]) => {
    if (waarde !== undefined && waarde !== null && waarde !== '') {
      params[sleutel] = waarde as string | number
    }
  })
  return params
}

const PORTAAL = '/portaal/opdrachten'
const KLANTEN = '/portaal/klanten'

export interface OpdrachtKlant {
  id: string
  naam: string
  adres: string
  postcode: string
  plaats: string
  contactpersoon: string
  telefoon: string
  notitie: string
  geopend_tot: string | null
  aantal_opdrachten: number
  created_at: string
  updated_at: string
}

export type KlantInvoer = Omit<
  OpdrachtKlant, 'id' | 'aantal_opdrachten' | 'created_at' | 'updated_at'
>

export interface KlantenPagina {
  count: number
  results: OpdrachtKlant[]
}

export const portaalKlanten = {
  lijst: async (params?: { page?: number; page_size?: number; search?: string; ordering?: string }): Promise<KlantenPagina> => {
    const response = await api.get(`${KLANTEN}/`, { params: schoon(params) })
    return response.data
  },
  zoeken: async (term: string): Promise<OpdrachtKlant[]> => {
    const response = await api.get(`${KLANTEN}/`, { params: { search: term, page_size: 8 } })
    return response.data.results || response.data
  },
  aanmaken: async (data: Partial<KlantInvoer>): Promise<OpdrachtKlant> => {
    const response = await api.post(`${KLANTEN}/`, data)
    return response.data
  },
  bijwerken: async (id: string, data: Partial<KlantInvoer>): Promise<OpdrachtKlant> => {
    const response = await api.patch(`${KLANTEN}/${id}/`, data)
    return response.data
  },
  verwijderen: async (id: string): Promise<void> => {
    await api.delete(`${KLANTEN}/${id}/`)
  },
}

export interface UrenDag {
  id: string
  datum: string
  ritnummer: string
  kenteken: string
  aanvang: string
  eind: string
  km_start: number
  km_eind: number
  totaal_km: number
  uren: number
}

export interface UrenWeek {
  id: string
  chauffeur: string
  jaar: number
  week: number
  totaal_km: number
  totaal_uren: number
  aantal_dagen: number
  dagen: UrenDag[]
}

export const portaalUren = {
  lijst: async (params?: { search?: string; page?: number; page_size?: number }):
    Promise<{ count: number; results: UrenWeek[]; totaal_uren: number; totaal_km: number }> => {
    const response = await api.get('/portaal/uren/', { params: schoon(params) })
    return response.data
  },
}

export interface TolPassage {
  id: string
  moment: string
  land: string
  ritnummer: string
  km: number
  bedrag: number
}

export interface TolWeek {
  id: string
  kenteken: string
  jaar: number
  week: number
  aantal: number
  totaal_bedrag: number
  totaal_km: number
  passages: TolPassage[]
}

export const portaalTol = {
  lijst: async (params?: { kenteken?: string; week?: string; page?: number; page_size?: number }):
    Promise<{ count: number; results: TolWeek[]; totaal_bedrag: number; totaal_km: number }> => {
    const response = await api.get('/portaal/tol/', { params: schoon(params) })
    return response.data
  },
}

export const portaalOpdrachten = {
  lijst: async (filters?: OpdrachtFilters): Promise<OpdrachtenPagina> => {
    const response = await api.get(`${PORTAAL}/`, { params: schoon(filters) })
    return response.data
  },
  eta: async (): Promise<OpdrachtEta[]> => {
    const response = await api.get(`${PORTAAL}/eta/`)
    return response.data
  },
  aanmaken: async (data: OpdrachtInvoer): Promise<Opdracht> => {
    const response = await api.post(`${PORTAAL}/`, data)
    return response.data
  },
  bijwerken: async (id: string, data: Partial<OpdrachtInvoer>): Promise<Opdracht> => {
    const response = await api.patch(`${PORTAAL}/${id}/`, data)
    return response.data
  },
  verwijderen: async (id: string): Promise<void> => {
    await api.delete(`${PORTAAL}/${id}/`)
  },
  intrekken: async (id: string): Promise<Opdracht> => {
    const response = await api.post(`${PORTAAL}/${id}/intrekken/`)
    return response.data
  },
  rangschikken: async (volgorde: string[]): Promise<void> => {
    await api.post(`${PORTAAL}/rangschikken/`, { volgorde })
  },
  bijlageToevoegen: async (id: string, bestand: File): Promise<OpdrachtBijlage> => {
    const body = new FormData()
    body.append('bestand', bestand)
    const response = await api.post(`${PORTAAL}/${id}/bijlagen/`, body)
    return response.data
  },
  mailOpnieuw: async (id: string): Promise<{ verstuurd: boolean; fout: string }> => {
    const response = await api.post(`${PORTAAL}/${id}/mail-opnieuw/`)
    return response.data
  },
  chauffeurs: async (): Promise<ChauffeurKeuze[]> => {
    const response = await api.get(`${PORTAAL}/chauffeurs/`)
    return response.data
  },
  volgendRitnummer: async (): Promise<string> => {
    const response = await api.get(`${PORTAAL}/volgend-ritnummer/`)
    return response.data.ritnummer
  },
  mailinstelling: async (): Promise<MailInstelling> => {
    const response = await api.get(`${PORTAAL}/mailinstelling/`)
    return response.data
  },
  mailinstellingOpslaan: async (data: Partial<MailInstelling>): Promise<MailInstelling> => {
    const response = await api.patch(`${PORTAAL}/mailinstelling/`, data)
    return response.data
  },
}

export const beheerOpdrachten = {
  lijst: async (filters?: OpdrachtFilters): Promise<OpdrachtenPagina> => {
    const response = await api.get('/opdrachten/opdrachten/', { params: schoon(filters) })
    return response.data
  },
}

export interface MijnOpdracht {
  id: string
  opdrachtgever_naam: string
  ritnummer: string | null
  klant_naam: string
  adres: string
  postcode: string
  plaats: string
  contactpersoon: string
  telefoon: string
  notitie: string
  geopend_tot: string | null
  volgorde: number
  status: OpdrachtStatus
  status_label: string
  gestart_op: string | null
  afgeleverd_op: string | null
  niet_geleverd_op: string | null
  niet_geleverd_reden: string
  chauffeur_reactie: string
  kenteken: string
  bijlagen: OpdrachtBijlage[]
  created_at: string
  updated_at: string
  eta_aankomst: string | null
  eta_minuten: number | null
  eta_start_minuten: number | null
  eta_afstand_km: number | null
  eta_fout: string
}

export const mijnOpdrachten = {
  lijst: async (
    opties?: { status?: string; archief?: boolean; search?: string; page?: number; page_size?: number }
  ): Promise<{ count: number; results: MijnOpdracht[] }> => {
    const response = await api.get('/opdrachten/mijn/', {
      params: schoon({
        status: opties?.status,
        search: opties?.search,
        page: opties?.page,
        page_size: opties?.page_size,
        ...(opties?.archief ? { archief: '1' } : {}),
      } as OpdrachtFilters),
    })
    // De lopende lijst komt ongepagineerd terug, het archief met tellers.
    const data = response.data
    return Array.isArray(data) ? { count: data.length, results: data } : data
  },
  eta: async (): Promise<OpdrachtEta[]> => {
    const response = await api.get('/opdrachten/mijn/eta/')
    return response.data
  },
  starten: async (id: string): Promise<MijnOpdracht> => {
    const response = await api.post(`/opdrachten/mijn/${id}/starten/`)
    return response.data
  },
  afmelden: async (
    id: string,
    data: { afgeleverd_op?: string; chauffeur_reactie?: string }
  ): Promise<MijnOpdracht> => {
    const response = await api.post(`/opdrachten/mijn/${id}/afmelden/`, data)
    return response.data
  },
  reactie: async (id: string, chauffeur_reactie: string): Promise<MijnOpdracht> => {
    const response = await api.post(`/opdrachten/mijn/${id}/reactie/`, { chauffeur_reactie })
    return response.data
  },
  nietGeleverd: async (
    id: string,
    data: { niet_geleverd_reden: string; niet_geleverd_op?: string }
  ): Promise<MijnOpdracht> => {
    const response = await api.post(`/opdrachten/mijn/${id}/niet-geleverd/`, data)
    return response.data
  },
  bijlageToevoegen: async (id: string, bestand: File): Promise<OpdrachtBijlage> => {
    const body = new FormData()
    body.append('bestand', bestand)
    const response = await api.post(`/opdrachten/mijn/${id}/bijlagen/`, body)
    return response.data
  },
}
