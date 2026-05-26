/**
 * EmailProfilesManager
 * Admin UI for creating/editing/deleting email profiles with user authorization.
 */
import { useState, useEffect } from 'react'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  PaperAirplaneIcon,
  StarIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid'
import {listEmailProfiles,
  createEmailProfile,
  updateEmailProfile,
  deleteEmailProfile,
  testEmailProfile,
  type EmailProfile,
  type EmailProfileWrite,
} from '@/api/emailProfiles'
import { getUsers } from '@/api/users'
import type { User } from '@/types'
import { useAuthStore } from '@/stores/authStore'

interface ProfileFormState {
  name: string
  description: string
  is_default: boolean
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password: string
  smtp_use_tls: boolean
  smtp_from_email: string
  oauth_enabled: boolean
  oauth_client_id: string
  oauth_client_secret: string
  oauth_tenant_id: string
  email_signature: string
  allowed_users: string[]
}

const emptyForm = (): ProfileFormState => ({
  name: '',
  description: '',
  is_default: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password: '',
  smtp_use_tls: true,
  smtp_from_email: '',
  oauth_enabled: false,
  oauth_client_id: '',
  oauth_client_secret: '',
  oauth_tenant_id: '',
  email_signature: '',
  allowed_users: [],
})

export default function EmailProfilesManager() {
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.rol === 'admin'

  const [profiles, setProfiles] = useState<EmailProfile[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileFormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  // Password visibility
  const [showSmtp, setShowSmtp] = useState(false)
  const [showOAuth, setShowOAuth] = useState(false)

  // Test email
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const getErrorMessage = (err: unknown, fallback: string): string => {
    const maybeError = err as {
      response?: {
        data?: {
          error?: string
          message?: string
          detail?: string
        }
      }
      message?: string
    }

    return (
      maybeError?.response?.data?.error ||
      maybeError?.response?.data?.message ||
      maybeError?.response?.data?.detail ||
      maybeError?.message ||
      fallback
    )
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [profileList, usersResp] = await Promise.all([
        listEmailProfiles(),
        isAdmin ? getUsers({ page_size: 500 }) : Promise.resolve({ results: [] }),
      ])
      setProfiles(profileList)
      setAllUsers(usersResp.results ?? [])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Fout bij laden'))
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setShowSmtp(false)
    setShowOAuth(false)
    setModalOpen(true)
  }

  const openEdit = (profile: EmailProfile) => {
    setEditingId(profile.id)
    setForm({
      name: profile.name,
      description: profile.description,
      is_default: profile.is_default,
      smtp_host: profile.smtp_host,
      smtp_port: profile.smtp_port,
      smtp_username: profile.smtp_username,
      smtp_password: '',          // never pre-fill sensitive fields
      smtp_use_tls: profile.smtp_use_tls,
      smtp_from_email: profile.smtp_from_email,
      oauth_enabled: profile.oauth_enabled,
      oauth_client_id: profile.oauth_client_id,
      oauth_client_secret: '',    // never pre-fill
      oauth_tenant_id: profile.oauth_tenant_id,
      email_signature: profile.email_signature,
      allowed_users: profile.allowed_users,
    })
    setShowSmtp(false)
    setShowOAuth(false)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Naam is verplicht')
      return
    }
    try {
      setSaving(true)
      setError(null)
      const payload: EmailProfileWrite = {
        name: form.name.trim(),
        description: form.description,
        is_default: form.is_default,
        smtp_host: form.smtp_host,
        smtp_port: form.smtp_port,
        smtp_username: form.smtp_username,
        smtp_use_tls: form.smtp_use_tls,
        smtp_from_email: form.smtp_from_email,
        oauth_enabled: form.oauth_enabled,
        oauth_client_id: form.oauth_client_id,
        oauth_tenant_id: form.oauth_tenant_id,
        email_signature: form.email_signature,
        allowed_users: form.allowed_users,
      }
      // Only send password if non-empty
      if (form.smtp_password) payload.smtp_password = form.smtp_password
      if (form.oauth_client_secret) payload.oauth_client_secret = form.oauth_client_secret

      if (editingId) {
        await updateEmailProfile(editingId, payload)
        setSuccess('E-mail profiel bijgewerkt')
      } else {
        await createEmailProfile(payload)
        setSuccess('E-mail profiel aangemaakt')
      }
      setModalOpen(false)
      await loadData()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Opslaan mislukt'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteEmailProfile(id)
      setDeleteConfirmId(null)
      setSuccess('Profiel verwijderd')
      await loadData()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Verwijderen mislukt'))
    }
  }

  const handleTestEmail = async (id: string) => {
    if (!testEmailAddr) return
    try {
      setTestingId(id)
      const result = await testEmailProfile(id, testEmailAddr)
      setSuccess(result.message)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Test mislukt'))
    } finally {
      setTestingId(null)
    }
  }

  const toggleUser = (userId: string) => {
    setForm(f => ({
      ...f,
      allowed_users: f.allowed_users.includes(userId)
        ? f.allowed_users.filter(u => u !== userId)
        : [...f.allowed_users, userId],
    }))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <ArrowPathIcon className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">E-mail profielen</h2>
          <p className="text-sm text-gray-500 mt-1">
            Meerdere SMTP/OAuth profielen configureren. Kies bij het verzenden welk profiel gebruikt wordt.
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <PlusIcon className="h-4 w-4" />
            Nieuw profiel
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <XMarkIcon className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <CheckCircleIcon className="h-5 w-5 flex-shrink-0" />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Test email input (shared) */}
      <div className="flex gap-2 items-center">
        <input
          type="email"
          value={testEmailAddr}
          onChange={e => setTestEmailAddr(e.target.value)}
          className="input-field max-w-xs text-sm"
          placeholder="Test e-mailadres"
        />
        <span className="text-xs text-gray-400">Voer een adres in om profiel te testen</span>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
          <p className="text-sm">Nog geen e-mail profielen aangemaakt.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map(profile => (
            <div
              key={profile.id}
              className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{profile.name}</span>
                    {profile.is_default && (
                      <StarSolidIcon className="h-4 w-4 text-yellow-400 flex-shrink-0" title="Standaard profiel" />
                    )}
                    {profile.oauth_enabled && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">OAuth</span>
                    )}
                  </div>
                  {profile.description && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{profile.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    {profile.smtp_from_email && <span>{profile.smtp_from_email}</span>}
                    {profile.smtp_host && !profile.oauth_enabled && <span>{profile.smtp_host}:{profile.smtp_port}</span>}
                    <span className="flex items-center gap-1">
                      <UsersIcon className="h-3 w-3" />
                      {profile.allowed_users_info.length === 0
                        ? 'Iedereen'
                        : `${profile.allowed_users_info.length} gebruiker(s)`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Test button */}
                  <button
                    onClick={() => handleTestEmail(profile.id)}
                    disabled={!testEmailAddr || testingId === profile.id}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Test versturen"
                  >
                    {testingId === profile.id ? (
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <PaperAirplaneIcon className="h-4 w-4" />
                    )}
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        onClick={() => openEdit(profile)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                        title="Bewerken"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      {deleteConfirmId === profile.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(profile.id)}
                            className="text-xs text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded"
                          >
                            Verwijder
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
                          >
                            Annuleer
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(profile.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Verwijderen"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'E-mail profiel bewerken' : 'Nieuw e-mail profiel'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Errors inside modal */}
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {/* Basic info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Naam *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input-field"
                    placeholder="bijv. Factuurmail, Klantenservice"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Omschrijving</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="input-field"
                    placeholder="Optionele omschrijving"
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_default"
                    checked={form.is_default}
                    onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="is_default" className="text-sm text-gray-700 flex items-center gap-1">
                    <StarIcon className="h-4 w-4 text-yellow-400" />
                    Standaard profiel
                  </label>
                </div>
              </div>

              {/* OAuth toggle */}
              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.oauth_enabled}
                    onChange={e => setForm(f => ({ ...f, oauth_enabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Microsoft OAuth (Exchange Online)</span>
                </label>
              </div>

              {form.oauth_enabled ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-4 border-l-2 border-primary-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                    <input type="text" value={form.oauth_client_id}
                      onChange={e => setForm(f => ({ ...f, oauth_client_id: e.target.value }))}
                      className="input-field" placeholder="xxxxxxxx-xxxx-…" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
                    <input type="text" value={form.oauth_tenant_id}
                      onChange={e => setForm(f => ({ ...f, oauth_tenant_id: e.target.value }))}
                      className="input-field" placeholder="xxxxxxxx-xxxx-…" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Verzender e-mail</label>
                    <input type="email" value={form.smtp_from_email}
                      onChange={e => setForm(f => ({ ...f, smtp_from_email: e.target.value }))}
                      className="input-field" placeholder="noreply@bedrijf.nl" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client Secret {editingId && <span className="text-gray-400 font-normal">(leeg = ongewijzigd)</span>}
                    </label>
                    <div className="relative">
                      <input type={showOAuth ? 'text' : 'password'} value={form.oauth_client_secret}
                        onChange={e => setForm(f => ({ ...f, oauth_client_secret: e.target.value }))}
                        className="input-field pr-10" placeholder="••••••••••" />
                      <button type="button" onClick={() => setShowOAuth(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showOAuth ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* SMTP fields */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
                    <input type="text" value={form.smtp_host}
                      onChange={e => setForm(f => ({ ...f, smtp_host: e.target.value }))}
                      className="input-field" placeholder="smtp.example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Poort</label>
                    <input type="number" value={form.smtp_port}
                      onChange={e => setForm(f => ({ ...f, smtp_port: parseInt(e.target.value) || 587 }))}
                      className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gebruikersnaam</label>
                    <input type="text" value={form.smtp_username}
                      onChange={e => setForm(f => ({ ...f, smtp_username: e.target.value }))}
                      className="input-field" placeholder="user@example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Wachtwoord {editingId && <span className="text-gray-400 font-normal">(leeg = ongewijzigd)</span>}
                    </label>
                    <div className="relative">
                      <input type={showSmtp ? 'text' : 'password'} value={form.smtp_password}
                        onChange={e => setForm(f => ({ ...f, smtp_password: e.target.value }))}
                        className="input-field pr-10" placeholder="••••••••" />
                      <button type="button" onClick={() => setShowSmtp(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showSmtp ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Verzender e-mail</label>
                    <input type="email" value={form.smtp_from_email}
                      onChange={e => setForm(f => ({ ...f, smtp_from_email: e.target.value }))}
                      className="input-field" placeholder="noreply@bedrijf.nl" />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input type="checkbox" id="smtp_tls" checked={form.smtp_use_tls}
                      onChange={e => setForm(f => ({ ...f, smtp_use_tls: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <label htmlFor="smtp_tls" className="text-sm text-gray-700">TLS gebruiken</label>
                  </div>
                </div>
              )}

              {/* Email signature */}
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail handtekening</label>
                <textarea
                  value={form.email_signature}
                  onChange={e => setForm(f => ({ ...f, email_signature: e.target.value }))}
                  rows={4}
                  className="input-field"
                  placeholder="Met vriendelijke groet,&#10;&#10;Naam&#10;Functie"
                />
              </div>

              {/* Authorized users (admin only) */}
              {isAdmin && allUsers.length > 0 && (
                <div className="border-t pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Toegestane gebruikers
                  </label>
                  <p className="text-xs text-gray-400 mb-3">
                    Laat leeg om iedereen toegang te geven. Selecteer specifieke gebruikers om toegang te beperken.
                  </p>
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                    {allUsers.map(u => (
                      <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.allowed_users.includes(u.id)}
                          onChange={() => toggleUser(u.id)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">
                          {u.voornaam} {u.achternaam}
                          <span className="text-gray-400 ml-1">({u.email})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50 rounded-b-2xl">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Annuleren</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
                {editingId ? 'Opslaan' : 'Aanmaken'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
