import { useEffect, useRef, useState } from 'react'
import { loadlistApi, AddressSuggestion } from '@/api/loadlist'

interface AddressAutocompleteProps {
  value: string
  onChange: (v: string) => void
  onCommit?: (v: string) => void
  placeholder?: string
  className?: string
}

/** Address input with Nominatim/Google-based suggestions from the backend. */
export function AddressAutocomplete({ value, onChange, onCommit, placeholder, className }: AddressAutocompleteProps) {
  const [items, setItems] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const lastQuery = useRef<string>('')

  useEffect(() => {
    const q = value.trim()
    if (q.length < 3 || q === lastQuery.current) {
      setItems([])
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true)
        const res = await loadlistApi.suggestAddress(q)
        lastQuery.current = q
        setItems(res)
        setOpen(res.length > 0)
        setHighlight(-1)
      } catch {
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [value])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (s: AddressSuggestion) => {
    onChange(s.label)
    lastQuery.current = s.label
    setOpen(false)
    setItems([])
    onCommit?.(s.label)
  }

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <input
        type="text"
        className="input w-full"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => onCommit?.(value)}
        onKeyDown={e => {
          if (!open || items.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, items.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); pick(items[highlight >= 0 ? highlight : 0]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
      />
      {open && (
        <ul className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {loading && <li className="px-3 py-2 text-xs text-gray-500">Zoeken…</li>}
          {items.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(s) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-50 ${i === highlight ? 'bg-primary-50' : ''}`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
