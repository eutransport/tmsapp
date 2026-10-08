/**
 * Chatbot API
 * Handles chat sessions and messaging with the AI assistant.
 */
import api from './client'

// ---- Types ----

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: ChatData | null
  created_at: string
}

export interface ChatData {
  title?: string
  columns?: string[]
  rows?: unknown[][]
  total_rows?: number
  truncated?: boolean
  model?: string
  count?: number
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  message_count: number
  messages?: ChatMessage[]
  created_at: string
  updated_at: string
}

export interface SendMessageResponse {
  session_id: string
  session_title: string
  user_message: ChatMessage
  assistant_message: ChatMessage
}

// ---- API functions ----

export async function getChatSessions(): Promise<ChatSession[]> {
  const res = await api.get('/chat/sessions/')
  return res.data
}

export async function getChatSession(id: string): Promise<ChatSession> {
  const res = await api.get(`/chat/sessions/${id}/`)
  return res.data
}

export async function createChatSession(title?: string): Promise<ChatSession> {
  const res = await api.post('/chat/sessions/', { title: title || '' })
  return res.data
}

export async function deleteChatSession(id: string): Promise<void> {
  await api.delete(`/chat/sessions/${id}/`)
}

export async function sendMessage(
  message: string,
  sessionId?: string | null,
): Promise<SendMessageResponse> {
  const res = await api.post('/chat/message/', {
    message,
    session_id: sessionId || null,
  })
  return res.data
}

/** Export chat data (columns + rows) to Excel or PDF and trigger download */
export async function exportChatData(
  data: { title: string; columns: string[]; rows: unknown[][] },
  format: 'excel' | 'pdf',
): Promise<void> {
  const res = await api.post(
    '/chat/sessions/export/',
    { ...data, format },
    { responseType: 'blob' },
  )
  const ext = format === 'excel' ? 'xlsx' : 'pdf'
  const rawContentType = res.headers?.['content-type']
  const contentType = typeof rawContentType === 'string' ? rawContentType : undefined
  const blob = new Blob([res.data], { type: contentType })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${data.title || 'export'}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}
