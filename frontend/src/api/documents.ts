/**
 * API voor documenten en digitale handtekeningen.
 */
import api from './client';

export interface SavedSignature {
  id: string;
  name: string;
  signature_image: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignedDocument {
  id: string;
  title: string;
  description: string;
  original_file: string;
  original_file_url: string;
  original_filename: string;
  signed_file: string | null;
  signed_file_url: string | null;
  signature_data: {
    page: number;
    x: number;
    y: number;
    width: number;
    signed_at: string;
    signed_by: string;
  } | null;
  status: 'pending' | 'signed' | 'expired';
  status_display: string;
  uploaded_by: string;
  uploaded_by_name: string;
  signed_by: string | null;
  signed_by_name: string | null;
  created_at: string;
  updated_at: string;
  signed_at: string | null;
}

export interface SignedDocumentList {
  id: string;
  title: string;
  description: string;
  original_filename: string;
  status: 'pending' | 'signed' | 'expired';
  status_display: string;
  uploaded_by: string;
  uploaded_by_name: string;
  signed_by: string | null;
  signed_by_name: string | null;
  created_at: string;
  signed_at: string | null;
}

export interface PdfInfo {
  page_count: number;
  pages: {
    number: number;
    width: number;
    height: number;
  }[];
}

export interface SignDocumentRequest {
  signature_image: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  save_signature?: boolean;
  signature_name?: string;
}

// === Documents API ===

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export async function getDocuments(): Promise<SignedDocumentList[]> {
  const response = await api.get<PaginatedResponse<SignedDocumentList>>('/documents/documents/');
  return response.data.results;
}

export async function getDocument(id: string): Promise<SignedDocument> {
  const response = await api.get(`/documents/documents/${id}/`);
  return response.data;
}

export async function uploadDocument(
  file: File,
  title: string,
  description?: string
): Promise<SignedDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  if (description) {
    formData.append('description', description);
  }
  
  const response = await api.post('/documents/documents/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/documents/${id}/`);
}

export async function getPdfInfo(id: string): Promise<PdfInfo> {
  const response = await api.get(`/documents/documents/${id}/info/`);
  return response.data;
}

export function getPdfPageImageUrl(id: string, pageNumber: number, dpi: number = 150): string {
  return `${api.defaults.baseURL}/documents/documents/${id}/page/${pageNumber}/?dpi=${dpi}`;
}

export async function getPdfPageImage(id: string, pageNumber: number, dpi: number = 150): Promise<Blob> {
  const response = await api.get(`/documents/documents/${id}/page/${pageNumber}/`, {
    params: { dpi },
    responseType: 'blob',
  });
  return response.data;
}

export async function signDocument(
  id: string,
  data: SignDocumentRequest
): Promise<SignedDocument> {
  const response = await api.post(`/documents/documents/${id}/sign/`, data);
  return response.data;
}

export async function downloadSignedDocument(id: string): Promise<Blob> {
  const response = await api.get(`/documents/documents/${id}/download/`, {
    responseType: 'blob',
  });
  return response.data;
}

export async function downloadOriginalDocument(id: string): Promise<Blob> {
  const response = await api.get(`/documents/documents/${id}/download_original/`, {
    responseType: 'blob',
  });
  return response.data;
}

// === Saved Signatures API ===

export async function getSavedSignatures(): Promise<SavedSignature[]> {
  const response = await api.get('/documents/signatures/');
  return response.data;
}

export async function getSavedSignature(id: string): Promise<SavedSignature> {
  const response = await api.get(`/documents/signatures/${id}/`);
  return response.data;
}

export async function createSavedSignature(
  name: string,
  signatureImage: File
): Promise<SavedSignature> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('signature_image', signatureImage);
  
  const response = await api.post('/documents/signatures/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

export async function deleteSavedSignature(id: string): Promise<void> {
  await api.delete(`/documents/signatures/${id}/`);
}

export async function setDefaultSignature(id: string): Promise<SavedSignature> {
  const response = await api.post(`/documents/signatures/${id}/set_default/`);
  return response.data;
}

// === Email API ===

export interface EmailDocumentRequest {
  email: string;
  subject?: string;
  message?: string;
  email_profile_id?: string;
}

export async function emailSignedDocument(
  id: string,
  data: EmailDocumentRequest
): Promise<{ message: string }> {
  const response = await api.post(`/documents/documents/${id}/send_email/`, data);
  return response.data;
}
