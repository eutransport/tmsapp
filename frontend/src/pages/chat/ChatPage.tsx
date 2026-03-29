/**
 * Smart AI Chatbot Page
 * Allows users to interact with the TMS AI assistant.
 * The assistant can query data, run reports and answer questions.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PlusIcon,
  TrashIcon,
  SparklesIcon,
  TableCellsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  getChatSessions,
  getChatSession,
  deleteChatSession,
  sendMessage,
  ChatSession,
  ChatMessage,
  ChatData,
} from '@/api/chatbot'

// ---- Data table component (for structured AI results) ----
function DataTable({ data }: { data: ChatData }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!data.columns || !data.rows) return null

  return (
    <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden text-sm">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <TableCellsIcon className="w-4 h-4 text-indigo-500" />
          {data.title || 'Resultaat'}
          <span className="text-xs text-gray-400 font-normal">
            ({data.total_rows ?? data.rows.length} rijen)
          </span>
          {data.truncated && (
            <span className="text-xs text-amber-600 font-normal">(eerste 50 getoond)</span>
          )}
        </span>
        {collapsed ? (
          <ChevronDownIcon className="w-4 h-4" />
        ) : (
          <ChevronUpIcon className="w-4 h-4" />
        )}
      </button>
      {!collapsed && (
        <div className="overflow-x-auto max-h-80">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {data.columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {data.rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-gray-50">
                  {(row as unknown[]).map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                      {cell === null || cell === undefined ? '' : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---- Single message bubble ----
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold
          ${isUser ? 'bg-indigo-500' : 'bg-emerald-500'}`}
      >
        {isUser ? 'J' : <SparklesIcon className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed
            ${isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
            }`}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
        {msg.data && !msg.data.error && <DataTable data={msg.data} />}
        <span className="text-xs text-gray-400 px-1">
          {new Date(msg.created_at).toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  )
}

// ---- Typing indicator ----
function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
        <SparklesIcon className="w-4 h-4 text-white" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Suggested questions ----
const SUGGESTIONS = [
  'Hoeveel chauffeurs zijn er actief?',
  'Geef een overzicht van alle voertuigen',
  'Hoeveel verlofaanvragen zijn er dit jaar?',
  'Wat is het verlof saldo overzicht?',
  'Toon de facturen van dit jaar',
  'Welke APK keuringen verlopen binnenkort?',
]

// ---- Main page ----
export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  // Load sessions on mount
  useEffect(() => {
    getChatSessions()
      .then(setSessions)
      .catch(() => {})
  }, [])

  const loadSession = useCallback(async (session: ChatSession) => {
    try {
      const full = await getChatSession(session.id)
      setActiveSession(full)
      setMessages(full.messages || [])
    } catch {
      toast.error('Sessie laden mislukt')
    }
  }, [])

  const startNewChat = useCallback(() => {
    setActiveSession(null)
    setMessages([])
    setInput('')
  }, [])

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await deleteChatSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (activeSession?.id === id) startNewChat()
      toast.success('Sessie verwijderd')
    } catch {
      toast.error('Verwijderen mislukt')
    }
  }, [activeSession, startNewChat])

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || loading) return

    setInput('')
    setLoading(true)

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: 'temp-user',
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const response = await sendMessage(msg, activeSession?.id ?? null)

      // Update session
      const updatedSession: ChatSession = {
        id: response.session_id,
        title: response.session_title,
        message_count: messages.length + 2,
        created_at: activeSession?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setActiveSession(updatedSession)

      // Replace temp message with real ones
      setMessages(prev => [
        ...prev.filter(m => m.id !== 'temp-user'),
        response.user_message,
        response.assistant_message,
      ])

      // Update sessions list
      setSessions(prev => {
        const exists = prev.find(s => s.id === response.session_id)
        if (exists) {
          return [
            { ...exists, title: response.session_title, updated_at: new Date().toISOString() },
            ...prev.filter(s => s.id !== response.session_id),
          ]
        }
        return [updatedSession, ...prev]
      })
    } catch {
      // Remove temp user message on error
      setMessages(prev => prev.filter(m => m.id !== 'temp-user'))
      toast.error('Bericht versturen mislukt')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, activeSession, messages.length])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-gray-50">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-indigo-500" />
              Gesprekken
            </h2>
            <button
              onClick={startNewChat}
              className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50"
              title="Nieuw gesprek"
            >
              <PlusIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-4 text-center">
                Nog geen gesprekken
              </p>
            )}
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => loadSession(session)}
                className={`group flex items-start justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors
                  ${activeSession?.id === session.id
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <span className="flex-1 truncate">
                  {session.title || 'Nieuw gesprek'}
                </span>
                <button
                  onClick={e => handleDelete(session.id, e)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            <ChatBubbleLeftRightIcon className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-emerald-500" />
            <h1 className="font-semibold text-gray-800">
              {activeSession?.title || 'TMS AI Assistent'}
            </h1>
          </div>
          <span className="text-xs text-gray-400 ml-auto">
            Stel me een vraag over uw TMS data
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {messages.length === 0 && !loading && (
            <div className="max-w-2xl mx-auto text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-400 to-emerald-400 flex items-center justify-center">
                  <SparklesIcon className="w-8 h-8 text-white" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">TMS AI Assistent</h2>
                <p className="text-gray-500 text-sm">
                  Ik kan uw TMS data opvragen, analyseren en overzichten tonen.
                  Stel me een vraag of kies een van de suggesties hieronder.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="text-left px-4 py-3 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50 text-sm text-gray-700 transition-colors shadow-sm"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {loading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="bg-white border-t border-gray-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Stel een vraag... (Enter om te sturen, Shift+Enter voor nieuwe regel)"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-60 max-h-40 overflow-y-auto"
              style={{ minHeight: '42px' }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-2">
            AI-assistent kan fouten maken. Controleer altijd belangrijke gegevens.
          </p>
        </div>
      </div>
    </div>
  )
}
