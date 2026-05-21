/**
 * Email Profiles API
 * CRUD for multiple SMTP/OAuth email profiles with user authorization
 */
import api from './client'

export interface EmailProfileUserInfo {
  id: string
  name: string
  email: string
}

export interface EmailProfile {
  id: string
  name: string
  description: string
  is_default: boolean
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_use_tls: boolean
  smtp_from_email: string
  has_smtp_password: boolean
  oauth_enabled: boolean
  oauth_client_id: string
  oauth_tenant_id: string
  email_signature: string
  allowed_users: string[]              // UUIDs (write)
  allowed_users_info: EmailProfileUserInfo[]  // (read)
  has_oauth_secret: boolean
  created_by_name: string
  created_at: string
  updated_at: string
}

export interface EmailProfileWrite {
  name: string
  description?: string
  is_default?: boolean
  smtp_host?: string
  smtp_port?: number
  smtp_username?: string
  smtp_password?: string
  smtp_use_tls?: boolean
  smtp_from_email?: string
  oauth_enabled?: boolean
  oauth_client_id?: string
  oauth_client_secret?: string
  oauth_tenant_id?: string
  email_signature?: string
  allowed_users?: string[]             // UUIDs
}

export async function listEmailProfiles(): Promise<EmailProfile[]> {
  const response = await api.get('/core/email-profiles/')
  return response.data.results ?? response.data
}

export async function getEmailProfile(id: string): Promise<EmailProfile> {
  const response = await api.get(`/core/email-profiles/${id}/`)
  return response.data
}

export async function createEmailProfile(data: EmailProfileWrite): Promise<EmailProfile> {
  const response = await api.post('/core/email-profiles/', data)
  return response.data
}

export async function updateEmailProfile(id: string, data: Partial<EmailProfileWrite>): Promise<EmailProfile> {
  const response = await api.patch(`/core/email-profiles/${id}/`, data)
  return response.data
}

export async function deleteEmailProfile(id: string): Promise<void> {
  await api.delete(`/core/email-profiles/${id}/`)
}

export async function testEmailProfile(id: string, email: string): Promise<{ message: string }> {
  const response = await api.post(`/core/email-profiles/${id}/test_email/`, { email })
  return response.data
}
