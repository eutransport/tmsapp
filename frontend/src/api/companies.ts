/**
 * Companies API service
 * CRUD operations for company management
 */
import api from './client'
import { Company, MailingListContact } from '@/types'

export interface CompanyCreate {
  naam: string
  kvk?: string
  telefoon?: string
  contactpersoon?: string
  email?: string
  adres?: string
  postcode?: string
  stad?: string
  land?: string
}

export interface CompanyUpdate extends Partial<CompanyCreate> {}

export interface CompaniesResponse {
  count: number
  next: string | null
  previous: string | null
  results: Company[]
}

export interface CompanyFilters {
  search?: string
  page?: number
  page_size?: number
  ordering?: string
}

// Get all companies with optional filters
export async function getCompanies(filters?: CompanyFilters): Promise<CompaniesResponse> {
  const params = new URLSearchParams()
  
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  
  const response = await api.get(`/companies/?${params.toString()}`)
  return response.data
}

// Get all companies (without pagination, for dropdowns)
export async function getAllCompanies(): Promise<Company[]> {
  const response = await api.get('/companies/?page_size=1000')
  return response.data.results || response.data
}

// Get single company by ID
export async function getCompany(id: string): Promise<Company> {
  const response = await api.get(`/companies/${id}/`)
  return response.data
}

// Create new company
export async function createCompany(data: CompanyCreate): Promise<Company> {
  const response = await api.post('/companies/', data)
  return response.data
}

// Update company
export async function updateCompany(id: string, data: CompanyUpdate): Promise<Company> {
  const response = await api.patch(`/companies/${id}/`, data)
  return response.data
}

// Delete company
export async function deleteCompany(id: string): Promise<void> {
  await api.delete(`/companies/${id}/`)
}

// ---- Mailing List Contacts ----

export interface MailingListContactCreate {
  bedrijf: string
  naam: string
  email: string
  functie?: string
  is_active?: boolean
}

export interface MailingListContactUpdate {
  naam?: string
  email?: string
  functie?: string
  is_active?: boolean
}

export interface MailingListContactsResponse {
  count: number
  next: string | null
  previous: string | null
  results: MailingListContact[]
}

// Get mailing list contacts for a company
export async function getMailingContacts(bedrijfId: string): Promise<MailingListContact[]> {
  const response = await api.get(`/companies/mailing-contacts/?bedrijf=${bedrijfId}&page_size=100`)
  return response.data.results || response.data
}

// Create a new mailing list contact
export async function createMailingContact(data: MailingListContactCreate): Promise<MailingListContact> {
  const response = await api.post('/companies/mailing-contacts/', data)
  return response.data
}

// Update a mailing list contact
export async function updateMailingContact(id: string, data: MailingListContactUpdate): Promise<MailingListContact> {
  const response = await api.patch(`/companies/mailing-contacts/${id}/`, data)
  return response.data
}

// Delete a mailing list contact
export async function deleteMailingContact(id: string): Promise<void> {
  await api.delete(`/companies/mailing-contacts/${id}/`)
}
