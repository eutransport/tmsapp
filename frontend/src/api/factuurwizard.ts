/**
 * API voor de factuurwizard.
 *
 * De wizard heeft twee kanten: de beheerkant (welke bedrijven, welke template,
 * welke diensten) en de wizard zelf (keuzelijsten ophalen en de factuur maken).
 */
import api from './client'
import { Invoice } from '@/types'

/** Een routenummer zoals het in de vloot staat. */
export interface WizardRitnummer {
  ritnummer: string
  kenteken: string
  type_wagen: string
  bedrijf: string | null
  bedrijf_naam: string
}

/** Een dienst die voor een bedrijf gefactureerd mag worden. */
export interface WizardDienst {
  id?: string
  ritnummer: string
  omschrijving: string
  actief?: boolean
  volgorde?: number
}

/** De volledige instelling van een bedrijf (beheerkant). */
export interface WizardBedrijfConfig {
  id: string
  bedrijf: string
  bedrijf_naam: string
  template: string
  template_naam: string
  administratie: string | null
  administratie_naam: string
  btw_percentage: string
  betaaltermijn_dagen: number
  actief: boolean
  volgorde: number
  diensten: WizardDienst[]
  created_at: string
  updated_at: string
}

export interface WizardBedrijfConfigInput {
  bedrijf: string
  template: string
  administratie?: string | null
  btw_percentage?: string | number
  betaaltermijn_dagen?: number
  actief?: boolean
  volgorde?: number
  diensten?: WizardDienst[]
}

/** Wat de wizard zelf nodig heeft om de keuzelijsten te vullen. */
export interface WizardOptie {
  id: string
  bedrijf: string
  bedrijf_naam: string
  template: string
  template_naam: string
  administratie: string | null
  administratie_naam: string
  btw_percentage: string
  betaaltermijn_dagen: number
  diensten: { id: string; ritnummer: string; omschrijving: string }[]
}

export interface WizardRegelInput {
  /** Nul, één of meerdere routes; meerdere als ze samen op één regel staan. */
  ritnummers: string[]
  datum_van?: string | null
  datum_tot?: string | null
  omschrijving: string
  bedrag: string
}

export interface WizardFactuurInput {
  bedrijf: string
  factuurdatum: string
  regels: WizardRegelInput[]
  opmerkingen?: string
  definitief?: boolean
}

// ---------------------------------------------------------------- beheerkant

export async function getWizardConfigs(): Promise<WizardBedrijfConfig[]> {
  const response = await api.get('/invoicing/wizard-bedrijven/')
  return response.data.results ?? response.data
}

/** De keuzelijsten voor het beheerscherm. */
export interface WizardKeuzelijsten {
  bedrijven: { id: string; naam: string }[]
  templates: { id: string; naam: string }[]
  administraties: { id: string; naam: string }[]
}

export async function getWizardKeuzelijsten(): Promise<WizardKeuzelijsten> {
  const response = await api.get('/invoicing/wizard-bedrijven/keuzelijsten/')
  return response.data
}

export async function getWizardRitnummers(): Promise<WizardRitnummer[]> {
  const response = await api.get('/invoicing/wizard-bedrijven/ritnummers/')
  return response.data
}

export async function createWizardConfig(
  data: WizardBedrijfConfigInput
): Promise<WizardBedrijfConfig> {
  const response = await api.post('/invoicing/wizard-bedrijven/', data)
  return response.data
}

export async function updateWizardConfig(
  id: string,
  data: Partial<WizardBedrijfConfigInput>
): Promise<WizardBedrijfConfig> {
  const response = await api.patch(`/invoicing/wizard-bedrijven/${id}/`, data)
  return response.data
}

export async function deleteWizardConfig(id: string): Promise<void> {
  await api.delete(`/invoicing/wizard-bedrijven/${id}/`)
}

// -------------------------------------------------------------- de wizard

export async function getWizardOpties(): Promise<WizardOptie[]> {
  const response = await api.get('/invoicing/wizard/opties/')
  return response.data
}

export async function maakWizardFactuur(data: WizardFactuurInput): Promise<Invoice> {
  const response = await api.post('/invoicing/wizard/aanmaken/', data)
  return response.data
}
