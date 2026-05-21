import api from './client'

export interface Contactpersoon {
  id: string
  organisatie: string
  naam: string
  email: string
  telefoon: string
  functie: string
  created_at: string
}

export interface OrganisatieListItem {
  id: string
  naam: string
  email: string
  telefoon: string
  contactpersoon_count: number
  created_at: string
}

export interface Organisatie extends OrganisatieListItem {
  opmerkingen: string
  contactpersonen: Contactpersoon[]
  updated_at: string
}

export interface CreateOrganisatieData {
  naam: string
  email?: string
  telefoon?: string
  opmerkingen?: string
  contactpersonen?: Omit<Contactpersoon, 'id' | 'organisatie' | 'created_at'>[]
}

export async function getOrganisaties(): Promise<OrganisatieListItem[]> {
  const res = await api.get('/dossiers/organisaties/')
  return res.data
}

export async function getOrganisatie(id: string): Promise<Organisatie> {
  const res = await api.get(`/dossiers/organisaties/${id}/`)
  return res.data
}

export async function createOrganisatie(data: CreateOrganisatieData): Promise<Organisatie> {
  const res = await api.post('/dossiers/organisaties/', data)
  return res.data
}

export async function updateOrganisatie(id: string, data: Partial<CreateOrganisatieData>): Promise<Organisatie> {
  const res = await api.patch(`/dossiers/organisaties/${id}/`, data)
  return res.data
}

export async function deleteOrganisatie(id: string): Promise<void> {
  await api.delete(`/dossiers/organisaties/${id}/`)
}

export async function createContactpersoon(data: Omit<Contactpersoon, 'id' | 'created_at'>): Promise<Contactpersoon> {
  const res = await api.post('/dossiers/contactpersonen/', data)
  return res.data
}

export async function updateContactpersoon(id: string, data: Partial<Omit<Contactpersoon, 'id' | 'created_at'>>): Promise<Contactpersoon> {
  const res = await api.patch(`/dossiers/contactpersonen/${id}/`, data)
  return res.data
}

export async function deleteContactpersoon(id: string): Promise<void> {
  await api.delete(`/dossiers/contactpersonen/${id}/`)
}

export interface StuurMailData {
  ontvangers: string[]  // contactpersoon IDs
  handmatig: string[]   // manual email addresses
  onderwerp: string
  inhoud: string
  type?: string | null
  bijlage_ids?: string[]   // bestaande dossier-bijlage IDs
  extra_bijlagen?: File[]  // nieuw te uploaden bestanden
  email_profile_id?: string
}

export async function stuurDossierMail(dossierId: string, data: StuurMailData): Promise<{ detail: string }> {
  const formData = new FormData()
  data.ontvangers.forEach(id => formData.append('ontvangers', id))
  data.handmatig.forEach(email => formData.append('handmatig', email))
  formData.append('onderwerp', data.onderwerp)
  formData.append('inhoud', data.inhoud)
  if (data.type) formData.append('type', data.type)
  data.bijlage_ids?.forEach(id => formData.append('bijlage_ids', id))
  data.extra_bijlagen?.forEach(f => formData.append('extra_bijlagen', f, f.name))
  if (data.email_profile_id) formData.append('email_profile_id', data.email_profile_id)

  const res = await api.post(`/dossiers/${dossierId}/stuur-mail/`, formData)
  return res.data
}
