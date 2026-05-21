/**
 * EmailProfileSelector
 * Dropdown to select an email profile when sending emails.
 * Shows "Standaard (globale instellingen)" as default option.
 */
import { useState, useEffect } from 'react'
import { listEmailProfiles, type EmailProfile } from '@/api/emailProfiles'
import { EnvelopeIcon } from '@heroicons/react/24/outline'

interface Props {
  value: string            // profile id or '' for default
  onChange: (id: string) => void
  className?: string
}

export default function EmailProfileSelector({ value, onChange, className = '' }: Props) {
  const [profiles, setProfiles] = useState<EmailProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listEmailProfiles()
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || profiles.length === 0) return null

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
        <EnvelopeIcon className="h-4 w-4 text-gray-400" />
        E-mail profiel
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
      >
        <option value="">Standaard (globale instellingen)</option>
        {profiles.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}{p.smtp_from_email ? ` — ${p.smtp_from_email}` : ''}
            {p.is_default ? ' ★' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
