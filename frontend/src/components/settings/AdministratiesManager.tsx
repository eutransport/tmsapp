/**
 * AdministratiesManager
 * Admin UI for creating/editing/deleting Administraties:
 * group companies together and assign users who can view invoices for those companies.
 */
import { useState, useEffect } from 'react'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  BuildingOffice2Icon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import {
  listAdministraties,
  createAdministratie,
  updateAdministratie,
  deleteAdministratie,
  type Administratie,
  type AdministratieWrite,
} from '@/api/administraties'
import { getCompanies } from '@/api/companies'
import { getUsers } from '@/api/users'
import type { Company, User } from '@/types'
import { useAuthStore } from '@/stores/authStore'

interface FormState {
  naam: string
  beschrijving: string
  bedrijven: string[]
  allowed_users: string[]
  gebruik_eigen_facturatie: boolean
  invoice_prefix: string
  invoice_start_number_verkoop: number
  invoice_start_number_inkoop: number
  invoice_start_number_credit: number
}

const emptyForm = (): FormState => ({
  naam: '',
  beschrijving: '',
  bedrijven: [],
  allowed_users: [],
  gebruik_eigen_facturatie: false,
  invoice_prefix: '',
  invoice_start_number_verkoop: 1,
  invoice_start_number_inkoop: 1,
  invoice_start_number_credit: 1,
})

export default function AdministratiesManager() {
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.rol === 'admin'

  const [administraties, setAdministraties] = useState<Administratie[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [list, companiesResp, usersResp] = await Promise.all([
        listAdministraties(),
        getCompanies({ page_size: 500 }),
        getUsers({ page_size: 500 }),
      ])
      setAdministraties(list)
      setAllCompanies(companiesResp.results ?? [])
      setAllUsers((usersResp.results ?? []).filter((u: User) => u.is_active))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fout bij laden')
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  const openEdit = (adm: Administratie) => {
    setEditingId(adm.id)
    setForm({
      naam: adm.naam,
      beschrijving: adm.beschrijving,
      bedrijven: adm.bedrijven_info.map(b => b.id),
      allowed_users: adm.allowed_users_info.map(u => u.id),
      gebruik_eigen_facturatie: adm.gebruik_eigen_facturatie ?? false,
      invoice_prefix: adm.invoice_prefix ?? '',
      invoice_start_number_verkoop: adm.invoice_start_number_verkoop ?? 1,
      invoice_start_number_inkoop: adm.invoice_start_number_inkoop ?? 1,
      invoice_start_number_credit: adm.invoice_start_number_credit ?? 1,
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  const handleSave = async () => {
    if (!form.naam.trim()) {
      setError('Naam is verplicht')
      return
    }
    try {
      setSaving(true)
      setError(null)
      if (form.gebruik_eigen_facturatie && !form.invoice_prefix.trim()) {
        setError('Vul een prefix in wanneer eigen factuurnummering actief is')
        setSaving(false)
        return
      }
      const payload: AdministratieWrite = {
        naam: form.naam.trim(),
        beschrijving: form.beschrijving.trim(),
        bedrijven: form.bedrijven,
        allowed_users: form.allowed_users,
        gebruik_eigen_facturatie: form.gebruik_eigen_facturatie,
        invoice_prefix: form.invoice_prefix.trim(),
        invoice_start_number_verkoop: form.invoice_start_number_verkoop || 1,
        invoice_start_number_inkoop: form.invoice_start_number_inkoop || 1,
        invoice_start_number_credit: form.invoice_start_number_credit || 1,
      }
      if (editingId) {
        await updateAdministratie(editingId, payload)
        setSuccess('Administratie bijgewerkt')
      } else {
        await createAdministratie(payload)
        setSuccess('Administratie aangemaakt')
      }
      closeModal()
      await loadData()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      setSaving(true)
      await deleteAdministratie(id)
      setDeleteConfirmId(null)
      setSuccess('Administratie verwijderd')
      await loadData()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally {
      setSaving(false)
    }
  }

  const toggleItem = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  if (!isAdmin) return null

  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Administraties</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Groepeer bedrijven en geef gebruikers inzagerechten op hun facturen.
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm">
          <PlusIcon className="h-4 w-4" />
          Nieuw
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)}><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}
      {success && (
        <div className="mb-3 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm">
          <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          Laden…
        </div>
      ) : administraties.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Nog geen administraties aangemaakt.</p>
      ) : (
        <div className="space-y-2">
          {administraties.map(adm => (
            <div key={adm.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{adm.naam}</p>
                  {adm.beschrijving && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{adm.beschrijving}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <BuildingOffice2Icon className="h-3.5 w-3.5" />
                      {adm.bedrijf_count} {adm.bedrijf_count === 1 ? 'bedrijf' : 'bedrijven'}
                    </span>
                    <span className="flex items-center gap-1">
                      <UsersIcon className="h-3.5 w-3.5" />
                      {adm.user_count} {adm.user_count === 1 ? 'gebruiker' : 'gebruikers'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => openEdit(adm)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="Bewerken"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  {deleteConfirmId === adm.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-600">Zeker?</span>
                      <button
                        onClick={() => handleDelete(adm.id)}
                        disabled={saving}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Ja
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Nee
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(adm.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Verwijderen"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">
                {editingId ? 'Administratie bewerken' : 'Nieuwe administratie'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              {error && (
                <div className="flex items-center justify-between bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                  <span>{error}</span>
                  <button onClick={() => setError(null)}><XMarkIcon className="h-4 w-4" /></button>
                </div>
              )}

              {/* Naam */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Naam <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="input-field w-full"
                  value={form.naam}
                  onChange={e => setForm(f => ({ ...f, naam: e.target.value }))}
                  placeholder="bijv. Transport NL"
                  maxLength={100}
                />
              </div>

              {/* Beschrijving */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
                <textarea
                  className="input-field w-full"
                  rows={2}
                  value={form.beschrijving}
                  onChange={e => setForm(f => ({ ...f, beschrijving: e.target.value }))}
                  placeholder="Optionele toelichting"
                />
              </div>

              {/* Bedrijven */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1">
                    <BuildingOffice2Icon className="h-4 w-4" />
                    Gekoppelde bedrijven
                    <span className="ml-1 text-xs text-gray-400 font-normal">
                      ({form.bedrijven.length} geselecteerd)
                    </span>
                  </span>
                </label>
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {allCompanies.length === 0 ? (
                      <p className="text-sm text-gray-400 p-3">Geen bedrijven gevonden</p>
                    ) : (
                      allCompanies.map(c => (
                        <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={form.bedrijven.includes(c.id.toString())}
                            onChange={() => setForm(f => ({ ...f, bedrijven: toggleItem(f.bedrijven, c.id.toString()) }))}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-gray-800">{c.naam}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Gebruikers */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1">
                    <UsersIcon className="h-4 w-4" />
                    Gebruikers met toegang
                    <span className="ml-1 text-xs text-gray-400 font-normal">
                      ({form.allowed_users.length} geselecteerd)
                    </span>
                  </span>
                </label>
                <p className="text-xs text-gray-500 mb-1.5">
                  Geselecteerde gebruikers mogen facturen inzien van de gekoppelde bedrijven.
                  Admins hebben altijd toegang.
                </p>
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {allUsers.filter(u => u.rol !== 'admin').length === 0 ? (
                      <p className="text-sm text-gray-400 p-3">Geen gebruikers gevonden</p>
                    ) : (
                      allUsers
                        .filter(u => u.rol !== 'admin')
                        .map(u => (
                          <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={form.allowed_users.includes(u.id.toString())}
                              onChange={() => setForm(f => ({ ...f, allowed_users: toggleItem(f.allowed_users, u.id.toString()) }))}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-gray-800">
                              {`${u.voornaam} ${u.achternaam}`.trim() || u.email}
                            </span>
                            <span className="text-xs text-gray-400 ml-auto">{u.email}</span>
                          </label>
                        ))
                    )}
                  </div>
                </div>
              </div>

              {/* Eigen factuurnummering */}
              <div className="border-t border-gray-200 pt-4">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.gebruik_eigen_facturatie}
                    onChange={e => setForm(f => ({ ...f, gebruik_eigen_facturatie: e.target.checked }))}
                    className="h-4 w-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-700">
                      Eigen factuurnummering gebruiken
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Anders worden de algemene instellingen onder Facturatie gebruikt.
                      Vereist een unieke prefix om botsing met andere administraties te voorkomen.
                    </span>
                  </span>
                </label>

                {form.gebruik_eigen_facturatie && (
                  <div className="mt-3 space-y-3 pl-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Prefix <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        className="input-field w-full"
                        value={form.invoice_prefix}
                        onChange={e => setForm(f => ({ ...f, invoice_prefix: e.target.value.toUpperCase() }))}
                        placeholder="bijv. MOV"
                        maxLength={10}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Resulteert in factuurnummers zoals <code>{(form.invoice_prefix || 'PFX')}-F-{new Date().getFullYear()}-0001</code>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Verkoop start</label>
                        <input
                          type="number"
                          min={1}
                          className="input-field w-full"
                          value={form.invoice_start_number_verkoop}
                          onChange={e => setForm(f => ({ ...f, invoice_start_number_verkoop: parseInt(e.target.value, 10) || 1 }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Inkoop start</label>
                        <input
                          type="number"
                          min={1}
                          className="input-field w-full"
                          value={form.invoice_start_number_inkoop}
                          onChange={e => setForm(f => ({ ...f, invoice_start_number_inkoop: parseInt(e.target.value, 10) || 1 }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Credit start</label>
                        <input
                          type="number"
                          min={1}
                          className="input-field w-full"
                          value={form.invoice_start_number_credit}
                          onChange={e => setForm(f => ({ ...f, invoice_start_number_credit: parseInt(e.target.value, 10) || 1 }))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200">
              <button onClick={closeModal} className="btn-secondary" disabled={saving}>
                Annuleren
              </button>
              <button onClick={handleSave} className="btn-primary" disabled={saving}>
                {saving ? (
                  <><ArrowPathIcon className="h-4 w-4 animate-spin mr-1.5" /> Opslaan…</>
                ) : (
                  <><CheckCircleIcon className="h-4 w-4 mr-1.5" /> Opslaan</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
