import api from './client'
import type { Contactpersoon } from './organisaties'

export interface DossierType {
  id: string
  naam: string
  actief: boolean
  in_gebruik: boolean
  created_at: string
}

export interface DossierBijlage {
  id: string
  bestandsnaam: string
  mimetype: string
  grootte: number
  uploaded_at: string
  bestand_url: string | null
}

export interface DossierReactie {
  id: string
  dossier: string
  auteur: string | null
  auteur_naam: string | null
  tekst: string
  intern: boolean
  created_at: string
  bijlagen: DossierBijlage[]
}

export interface DossierMailLog {
  id: string
  ontvangers: string
  onderwerp: string
  verzonden_door: string | null
  verzonden_door_naam: string | null
  verzonden_op: string
}

export interface DossierListItem {
  id: string
  onderwerp: string
  type: string
  type_naam: string
  instuurder: string | null
  instuurder_naam: string | null
  betreft_user: string | null
  betreft_chauffeur: string | null
  betreft_naam: string | null
  organisatie: string | null
  organisatie_naam: string | null
  heeft_bijlage: boolean
  reactie_count: number
  created_at: string
  updated_at: string
}

export interface DossierDetail extends DossierListItem {
  inhoud: string
  bijlagen: DossierBijlage[]
  reacties: DossierReactie[]
  organisatie_contactpersonen: Contactpersoon[]
  maillogs: DossierMailLog[]
}

export interface DossierListResponse {
  count: number
  page: number
  page_size: number
  total_pages: number
  results: DossierListItem[]
}

export interface CreateDossierData {
  onderwerp: string
  inhoud: string
  type: string
  betreft_user?: string | null
  betreft_chauffeur?: string | null
  organisatie?: string | null
}

export async function getDossierTypes(): Promise<DossierType[]> {
  const res = await api.get('/dossiers/types/')
  // Defensive: handle both array and paginated {results: [...]} responses
  return Array.isArray(res.data) ? res.data : (res.data?.results ?? [])
}

export async function createDossierType(naam: string): Promise<DossierType> {
  const res = await api.post('/dossiers/types/', { naam })
  return res.data
}

export async function updateDossierType(id: string, data: Partial<DossierType>): Promise<DossierType> {
  const res = await api.patch(`/dossiers/types/${id}/`, data)
  return res.data
}

export async function deleteDossierType(id: string): Promise<void> {
  await api.delete(`/dossiers/types/${id}/`)
}

export async function getDossiers(params?: { page?: number; type?: string; search?: string }): Promise<DossierListResponse> {
  const res = await api.get('/dossiers/', { params })
  return res.data
}

export async function getDossier(id: string): Promise<DossierDetail> {
  const res = await api.get(`/dossiers/${id}/`)
  return res.data
}

export async function createDossier(data: CreateDossierData, bijlagen?: File[]): Promise<DossierDetail> {
  const formData = new FormData()
  Object.entries(data).forEach(([k, v]) => {
    if (v != null) formData.append(k, String(v))
  })
  if (bijlagen) {
    bijlagen.forEach(f => formData.append('bijlagen', f))
  }
  const res = await api.post('/dossiers/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function addReactie(dossierId: string, data: { tekst: string; intern?: boolean }, bijlagen?: File[]): Promise<DossierReactie> {
  const formData = new FormData()
  formData.append('tekst', data.tekst)
  if (data.intern !== undefined) formData.append('intern', String(data.intern))
  if (bijlagen) {
    bijlagen.forEach(f => formData.append('bijlagen', f))
  }
  const res = await api.post(`/dossiers/${dossierId}/reacties/`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function getReacties(dossierId: string): Promise<DossierReactie[]> {
  const res = await api.get(`/dossiers/${dossierId}/reacties/`)
  return res.data
}

export function getDossierBijlageDownloadUrl(dossierId: string, bijlageId: string): string {
  return `/dossiers/${dossierId}/bijlagen/${bijlageId}/download/`
}
