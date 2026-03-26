/**
 * Invoicing API service
 * CRUD operations for invoice management
 */
import api from './client'
import { Invoice, InvoiceTemplate, InvoiceLine } from '@/types'

// Types
export interface InvoiceCreate {
  template: string
  bedrijf: string
  type: 'inkoop' | 'verkoop' | 'credit'
  factuurdatum: string
  vervaldatum: string
  btw_percentage?: number
  opmerkingen?: string
}

export interface InvoiceUpdate {
  status?: 'concept' | 'definitief' | 'verzonden' | 'betaald'
  btw_percentage?: number
  opmerkingen?: string
  vervaldatum?: string
}

export interface InvoiceLineCreate {
  invoice: string
  omschrijving: string
  aantal: number
  eenheid?: string
  prijs_per_eenheid: number
  time_entry?: string | null
}

export interface InvoiceLineUpdate {
  omschrijving?: string
  aantal?: number
  eenheid?: string
  prijs_per_eenheid?: number
}

export interface InvoicesResponse {
  count: number
  next: string | null
  previous: string | null
  results: Invoice[]
}

export interface InvoiceFilters {
  type?: 'inkoop' | 'verkoop' | 'credit'
  status?: 'concept' | 'definitief' | 'verzonden' | 'betaald'
  bedrijf?: string
  search?: string
  page?: number
  page_size?: number
  ordering?: string
  week_number?: number
  week_year?: number
  chauffeur?: string
  jaar?: number
}

export interface TemplatesResponse {
  count: number
  next: string | null
  previous: string | null
  results: InvoiceTemplate[]
}

// Invoice Templates API

export async function getTemplates(activeOnly = true): Promise<TemplatesResponse> {
  const params = activeOnly ? '?is_active=true' : ''
  const response = await api.get(`/invoicing/templates/${params}`)
  return response.data
}

export async function getTemplate(id: string): Promise<InvoiceTemplate> {
  const response = await api.get(`/invoicing/templates/${id}/`)
  return response.data
}

export interface TemplateCreate {
  naam: string
  beschrijving?: string
  layout?: Record<string, unknown>
  variables?: Record<string, unknown>
  is_active?: boolean
}

export interface TemplateUpdate {
  naam?: string
  beschrijving?: string
  layout?: Record<string, unknown>
  variables?: Record<string, unknown>
  is_active?: boolean
}

export async function createTemplate(data: TemplateCreate): Promise<InvoiceTemplate> {
  const response = await api.post('/invoicing/templates/', data)
  return response.data
}

export async function updateTemplate(id: string, data: TemplateUpdate): Promise<InvoiceTemplate> {
  const response = await api.patch(`/invoicing/templates/${id}/`, data)
  return response.data
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.delete(`/invoicing/templates/${id}/`)
}

export async function copyTemplate(id: string, naam?: string, beschrijving?: string): Promise<InvoiceTemplate> {
  const data: { naam?: string; beschrijving?: string } = {}
  if (naam) data.naam = naam
  if (beschrijving) data.beschrijving = beschrijving
  const response = await api.post(`/invoicing/templates/${id}/copy/`, data)
  return response.data
}

export async function exportTemplate(id: string): Promise<void> {
  const response = await api.get(`/invoicing/templates/${id}/export/`, {
    responseType: 'blob',
  })
  
  // Get filename from content-disposition header or use default
  const contentDisposition = response.headers['content-disposition']
  let filename = 'template.json'
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/)
    if (match) filename = match[1]
  }
  
  // Download the file
  const blob = new Blob([response.data], { type: 'application/json' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export async function importTemplate(file: File): Promise<InvoiceTemplate> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/invoicing/templates/import_template/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data
}

// Invoices API

export async function getInvoices(filters?: InvoiceFilters): Promise<InvoicesResponse> {
  const params = new URLSearchParams()
  
  if (filters?.type) params.append('type', filters.type)
  if (filters?.status) params.append('status', filters.status)
  if (filters?.bedrijf) params.append('bedrijf', filters.bedrijf)
  if (filters?.search) params.append('search', filters.search)
  if (filters?.page) params.append('page', filters.page.toString())
  if (filters?.page_size) params.append('page_size', filters.page_size.toString())
  if (filters?.ordering) params.append('ordering', filters.ordering)
  if (filters?.week_number) params.append('week_number', filters.week_number.toString())
  if (filters?.week_year) params.append('week_year', filters.week_year.toString())
  if (filters?.chauffeur) params.append('chauffeur', filters.chauffeur)
  if (filters?.jaar) params.append('jaar', filters.jaar.toString())
  
  const response = await api.get(`/invoicing/invoices/?${params.toString()}`)
  return response.data
}

export async function getInvoice(id: string): Promise<Invoice> {
  const response = await api.get(`/invoicing/invoices/${id}/`)
  return response.data
}

export async function createInvoice(data: InvoiceCreate): Promise<Invoice> {
  const response = await api.post('/invoicing/invoices/', data)
  return response.data
}

export async function uploadInvoiceBijlage(id: string, bijlage: File): Promise<Invoice> {
  const formData = new FormData()
  formData.append('bijlage', bijlage)
  const response = await api.patch(`/invoicing/invoices/${id}/`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function updateInvoice(id: string, data: InvoiceUpdate): Promise<Invoice> {
  const response = await api.patch(`/invoicing/invoices/${id}/`, data)
  return response.data
}

export async function deleteInvoice(id: string): Promise<void> {
  await api.delete(`/invoicing/invoices/${id}/`)
}

export async function bulkDeleteInvoices(ids: string[]): Promise<{ deleted: number; errors: string[] }> {
  const response = await api.post('/invoicing/invoices/bulk_delete/', { ids })
  return response.data
}

export async function bulkStatusChange(
  ids: string[], 
  status: 'concept' | 'definitief' | 'verzonden' | 'betaald'
): Promise<{ updated: number; errors: string[]; message: string }> {
  const response = await api.post('/invoicing/invoices/bulk_status/', { ids, status })
  return response.data
}

// Invoice actions

export async function recalculateInvoice(id: string): Promise<Invoice> {
  const response = await api.post(`/invoicing/invoices/${id}/recalculate/`)
  return response.data
}

export async function markDefinitief(id: string): Promise<Invoice> {
  const response = await api.post(`/invoicing/invoices/${id}/mark_definitief/`)
  return response.data
}

export async function changeStatus(id: string, status: 'concept' | 'definitief' | 'verzonden' | 'betaald'): Promise<Invoice> {
  const response = await api.post(`/invoicing/invoices/${id}/change_status/`, { status })
  return response.data
}

export async function markVerzonden(id: string): Promise<Invoice> {
  const response = await api.post(`/invoicing/invoices/${id}/mark_verzonden/`)
  return response.data
}

export async function markBetaald(id: string): Promise<Invoice> {
  const response = await api.post(`/invoicing/invoices/${id}/mark_betaald/`)
  return response.data
}

export async function generatePdf(id: string, download = true): Promise<void> {
  const url = `/invoicing/invoices/${id}/generate_pdf/?download=${download}`
  const response = await api.get(url, { responseType: 'blob' })
  
  // Get filename from Content-Disposition header or use default
  const contentDisposition = response.headers['content-disposition']
  let filename = `factuur_${id}.pdf`
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\n]+)"?/)
    if (match) filename = match[1]
  }
  
  // Create download link
  const blob = new Blob([response.data], { type: 'application/pdf' })
  const link = document.createElement('a')
  link.href = window.URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(link.href)
}

export async function openPdfInNewTab(id: string): Promise<void> {
  const url = `/invoicing/invoices/${id}/generate_pdf/`
  const response = await api.get(url, { responseType: 'blob' })
  
  const blob = new Blob([response.data], { type: 'application/pdf' })
  const pdfUrl = window.URL.createObjectURL(blob)
  window.open(pdfUrl, '_blank')
}

export async function sendInvoiceEmail(
  id: string,
  email?: string,
  emails?: string[],
  useMailingList?: boolean
): Promise<{ message: string }> {
  const data: Record<string, unknown> = {}
  if (email) data.email = email
  if (emails && emails.length > 0) data.emails = emails
  if (useMailingList) data.use_mailing_list = true
  const response = await api.post(`/invoicing/invoices/${id}/send_email/`, data)
  return response.data
}

export async function getNextInvoiceNumber(type: 'verkoop' | 'inkoop' | 'credit'): Promise<{
  factuurnummer: string
  type: string
  jaar: number
}> {
  const response = await api.get(`/invoicing/invoices/next_number/?type=${type}`)
  return response.data
}

// Invoice Lines API

export async function getInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const response = await api.get(`/invoicing/lines/?invoice=${invoiceId}`)
  return response.data.results || response.data
}

export async function createInvoiceLine(data: InvoiceLineCreate): Promise<InvoiceLine> {
  const response = await api.post('/invoicing/lines/', data)
  return response.data
}

export async function updateInvoiceLine(id: string, data: InvoiceLineUpdate): Promise<InvoiceLine> {
  const response = await api.patch(`/invoicing/lines/${id}/`, data)
  return response.data
}

export async function deleteInvoiceLine(id: string): Promise<void> {
  await api.delete(`/invoicing/lines/${id}/`)
}
