/**
 * Administraties API
 * CRUD for Administraties (grouping companies with user access rights for invoices)
 */
import api from './client'
import type { Company } from '@/types'

export interface AdministratieUserInfo {
  id: string
  name: string
  email: string
}

export interface AdministratieBedrijfInfo {
  id: string
  naam: string
}

export interface Administratie {
  id: string
  naam: string
  beschrijving: string
  bedrijven: string[]                          // UUIDs (write)
  bedrijven_info: AdministratieBedrijfInfo[]   // (read)
  allowed_users: string[]                      // UUIDs (write)
  allowed_users_info: AdministratieUserInfo[]  // (read)
  bedrijf_count: number
  user_count: number
  gebruik_eigen_facturatie: boolean
  invoice_prefix: string
  invoice_start_number_verkoop: number
  invoice_start_number_inkoop: number
  invoice_start_number_credit: number
  created_by_name: string
  created_at: string
  updated_at: string
}

export interface AdministratieWrite {
  naam: string
  beschrijving?: string
  bedrijven?: string[]      // Company UUIDs
  allowed_users?: string[]  // User UUIDs
  gebruik_eigen_facturatie?: boolean
  invoice_prefix?: string
  invoice_start_number_verkoop?: number
  invoice_start_number_inkoop?: number
  invoice_start_number_credit?: number
}

/** Admin: list all administraties */
export async function listAdministraties(): Promise<Administratie[]> {
  const response = await api.get('/core/administraties/')
  return response.data.results ?? response.data
}

/** Admin: get single administratie */
export async function getAdministratie(id: string): Promise<Administratie> {
  const response = await api.get(`/core/administraties/${id}/`)
  return response.data
}

/** Admin: create administratie */
export async function createAdministratie(data: AdministratieWrite): Promise<Administratie> {
  const response = await api.post('/core/administraties/', data)
  return response.data
}

/** Admin: update administratie */
export async function updateAdministratie(id: string, data: Partial<AdministratieWrite>): Promise<Administratie> {
  const response = await api.patch(`/core/administraties/${id}/`, data)
  return response.data
}

/** Admin: delete administratie */
export async function deleteAdministratie(id: string): Promise<void> {
  await api.delete(`/core/administraties/${id}/`)
}

/**
 * Any authenticated user: returns the companies they may access via
 * Administraties (admins get all companies).
 */
export async function getMijnBedrijven(): Promise<Company[]> {
  const response = await api.get('/core/administraties/mijn-bedrijven/')
  return response.data.results ?? response.data
}

/**
 * Any authenticated user: returns the administraties they may access
 * (admins get all administraties).
 */
export async function getMijnAdministraties(): Promise<Administratie[]> {
  const response = await api.get('/core/administraties/mijn-administraties/')
  return response.data.results ?? response.data
}
