import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ChevronRightIcon,
  DocumentIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  TableCellsIcon,
  TrashIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import filesApi, {
  FileEntry,
  FilePreview,
  Folder,
  FolderDetail,
  FolderMember,
} from '@/api/files'
import api from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

// ---------- helpers ----------
function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

function iconForExtension(ext: string) {
  const e = (ext || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg', 'heic'].includes(e))
    return PhotoIcon
  if (['xlsx', 'xls', 'xlsm', 'csv', 'ods'].includes(e)) return TableCellsIcon
  if (['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(e)) return DocumentTextIcon
  return DocumentIcon
}

// ---------- new folder dialog ----------
interface NewFolderDialogProps {
  parent: Folder | null
  onClose: () => void
  onCreated: (folder: FolderDetail) => void
}

function NewFolderDialog({ parent, onClose, onCreated }: NewFolderDialogProps) {
  const [name, setName] = useState('')
  const [users, setUsers] = useState<FolderMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [canEdit, setCanEdit] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    filesApi
      .availableUsers()
      .then(setUsers)
      .catch(() => toast.error('Kon gebruikerslijst niet laden.'))
  }, [])

  const filteredUsers = useMemo(() => {
    const q = filter.toLowerCase().trim()
    if (!q) return users
    return users.filter(u =>
      [u.naam, u.username, u.email].some(v => (v || '').toLowerCase().includes(q)),
    )
  }, [users, filter])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Geef de map een naam.')
      return
    }
    setBusy(true)
    try {
      const folder = await filesApi.createFolder({
        name: trimmed,
        parent: parent?.id ?? null,
        member_ids: Array.from(selected),
        members_can_edit: canEdit,
      })
      toast.success(`Map "${folder.name}" aangemaakt.`)
      onCreated(folder)
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.name ||
        err?.response?.data?.parent ||
        'Aanmaken mislukt.'
      toast.error(String(msg))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">
            Nieuwe map {parent ? `in "${parent.name}"` : 'in hoofdmap'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Naam</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              maxLength={255}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Bijv. Facturen 2025"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Toegang voor gebruikers ({selected.size} geselecteerd)
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={canEdit}
                  onChange={e => setCanEdit(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                mag ook wijzigen
              </label>
            </div>
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Zoek gebruiker..."
              className="mb-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200">
              {filteredUsers.length === 0 && (
                <div className="p-3 text-center text-xs text-gray-500">Geen gebruikers gevonden.</div>
              )}
              {filteredUsers.map(u => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-sm last:border-b-0 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="flex-1 truncate">
                    <span className="font-medium">{u.naam || u.username}</span>
                    {u.email && <span className="ml-2 text-xs text-gray-500">{u.email}</span>}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Beheerders hebben altijd toegang. Deze lijst is aanvullend.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Annuleren
          </button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? 'Bezig...' : 'Aanmaken'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- members dialog ----------
interface MembersDialogProps {
  folder: FolderDetail
  onClose: () => void
  onChanged: () => void
}

function MembersDialog({ folder, onClose, onChanged }: MembersDialogProps) {
  const [users, setUsers] = useState<FolderMember[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [canEdit, setCanEdit] = useState(true)

  useEffect(() => {
    filesApi.availableUsers().then(setUsers).catch(() => toast.error('Kon gebruikers niet laden.'))
  }, [])

  const currentIds = useMemo(
    () => new Set(folder.members.map(m => m.user.id)),
    [folder.members],
  )

  const filteredUsers = useMemo(() => {
    const q = filter.toLowerCase().trim()
    return users
      .filter(u => !currentIds.has(u.id))
      .filter(u =>
        !q
          ? true
          : [u.naam, u.username, u.email].some(v => (v || '').toLowerCase().includes(q)),
      )
  }, [users, filter, currentIds])

  const addSelected = async () => {
    if (selected.size === 0) return
    try {
      await filesApi.addMembers(folder.id, Array.from(selected), canEdit)
      toast.success('Toegang toegevoegd.')
      setSelected(new Set())
      onChanged()
    } catch {
      toast.error('Kon toegang niet toevoegen.')
    }
  }

  const removeMember = async (userId: string) => {
    try {
      await filesApi.removeMember(folder.id, userId)
      onChanged()
    } catch {
      toast.error('Verwijderen mislukt.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">
            Toegang beheren â€“ {folder.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div>
            <h4 className="mb-1 text-sm font-medium text-gray-700">Huidige toegang</h4>
            {folder.members.length === 0 && (
              <p className="text-xs text-gray-500">
                Nog geen expliciete gebruikers. Alleen beheerders en de aanmaker hebben toegang.
              </p>
            )}
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {folder.members.map(m => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">
                    <span className="font-medium">{m.user.naam || m.user.username}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      {m.can_edit ? 'kan wijzigen' : 'alleen bekijken'}
                    </span>
                  </span>
                  <button
                    onClick={() => removeMember(m.user.id)}
                    className="text-red-600 hover:text-red-700"
                    title="Verwijderen"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">
                Nieuwe gebruikers toevoegen ({selected.size})
              </h4>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={canEdit}
                  onChange={e => setCanEdit(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                mag wijzigen
              </label>
            </div>
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Zoek gebruiker..."
              className="mb-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
              {filteredUsers.map(u => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-sm last:border-b-0 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() =>
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (next.has(u.id)) next.delete(u.id)
                        else next.add(u.id)
                        return next
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="flex-1 truncate">
                    {u.naam || u.username}
                    {u.email && <span className="ml-2 text-xs text-gray-500">{u.email}</span>}
                  </span>
                </label>
              ))}
              {filteredUsers.length === 0 && (
                <div className="p-3 text-center text-xs text-gray-500">Geen resultaten.</div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Sluiten
          </button>
          <button
            onClick={addSelected}
            disabled={selected.size === 0}
            className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            Toevoegen
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- page ----------
type ViewMode = 'folder' | 'search'

export default function FilesExplorerPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = !!user && (user.rol === 'admin' || (user as any).is_superuser)

  const [currentFolder, setCurrentFolder] = useState<FolderDetail | null>(null)
  const [childFolders, setChildFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('folder')

  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [showMobileTree, setShowMobileTree] = useState(false)
  const [rootFolders, setRootFolders] = useState<Folder[]>([])
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    onConfirm: () => void | Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Debounce zoekterm.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Load root folders for sidebar.
  const loadRoot = useCallback(async () => {
    try {
      const list = await filesApi.listFolders(null)
      setRootFolders(list)
    } catch {
      /* stil */
    }
  }, [])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  const loadFolder = useCallback(async (folder: FolderDetail | null) => {
    setLoading(true)
    try {
      const [children, fileList] = await Promise.all([
        filesApi.listFolders(folder?.id ?? null),
        filesApi.listFiles({ folder: folder?.id ?? null }),
      ])
      setChildFolders(children)
      setFiles(fileList)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Kon inhoud niet laden.')
      setChildFolders([])
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSearch = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const results = await filesApi.listFiles({ q })
      setChildFolders([])
      setFiles(results)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Zoeken mislukt.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (searchQuery) {
      setViewMode('search')
      loadSearch(searchQuery)
    } else {
      setViewMode('folder')
      loadFolder(currentFolder)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  useEffect(() => {
    if (viewMode === 'folder') loadFolder(currentFolder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder?.id])

  const openFolder = async (folder: Folder | null) => {
    setSearchInput('')
    setSearchQuery('')
    setShowMobileTree(false)
    if (folder === null) {
      setCurrentFolder(null)
      return
    }
    try {
      const detail = await filesApi.getFolder(folder.id)
      setCurrentFolder(detail)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Kon map niet openen.')
    }
  }

  const refreshCurrent = async () => {
    if (currentFolder) {
      const detail = await filesApi.getFolder(currentFolder.id)
      setCurrentFolder(detail)
    }
    loadFolder(currentFolder)
    loadRoot()
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      setUploadProgress(0)
      try {
        await filesApi.uploadFile(f, currentFolder?.id ?? null, p => setUploadProgress(p))
        toast.success(`"${f.name}" geÃ¼pload (${i + 1}/${list.length})`)
      } catch (err: any) {
        const msg = err?.response?.data?.file || err?.response?.data?.detail || 'Upload mislukt.'
        toast.error(`${f.name}: ${msg}`)
      }
    }
    setUploadProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    loadFolder(currentFolder)
  }

  const handleDeleteFile = (entry: FileEntry) => {
    setConfirmState({
      title: 'Bestand verwijderen',
      message: `Weet je zeker dat je "${entry.name}" wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`,
      confirmLabel: 'Verwijderen',
      danger: true,
      onConfirm: async () => {
        try {
          await filesApi.deleteFile(entry.id)
          toast.success('Verwijderd.')
          setFiles(prev => prev.filter(f => f.id !== entry.id))
        } catch (err: any) {
          toast.error(err?.response?.data?.detail || 'Verwijderen mislukt.')
        }
      },
    })
  }

  const handleDeleteFolder = (folder: Folder) => {
    setConfirmState({
      title: 'Map verwijderen',
      message: `Weet je zeker dat je map "${folder.name}" met alle inhoud (${folder.file_count} bestand${folder.file_count === 1 ? '' : 'en'}, ${folder.child_count} submap${folder.child_count === 1 ? '' : 'pen'}) wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`,
      confirmLabel: 'Verwijderen',
      danger: true,
      onConfirm: async () => {
        try {
          await filesApi.deleteFolder(folder.id)
          toast.success('Map verwijderd.')
          loadFolder(currentFolder)
          loadRoot()
        } catch (err: any) {
          toast.error(err?.response?.data?.detail || 'Verwijderen mislukt.')
        }
      },
    })
  }

  const handleDownload = async (entry: FileEntry) => {
    try {
      const res = await api.get(filesApi.downloadUrl(entry.id), { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.original_filename || entry.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Downloaden mislukt.')
    }
  }

  const canEditCurrent = isAdmin || (currentFolder?.can_edit ?? false)
  const canManagePermissions =
    !!currentFolder &&
    (isAdmin || currentFolder.created_by === (user?.id ? String(user.id) : ''))
  const canCreateFolderHere = isAdmin || canEditCurrent || currentFolder === null

  const ancestors: FolderAncestorItem[] = useMemo(() => {
    if (!currentFolder) return []
    return [...currentFolder.ancestors.map(a => ({ id: a.id, name: a.name })), {
      id: currentFolder.id,
      name: currentFolder.name,
    }]
  }, [currentFolder])

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shadow-sm md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <button
              className="md:hidden inline-flex items-center rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              onClick={() => setShowMobileTree(true)}
            >
              <FolderIcon className="h-4 w-4" />
            </button>
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Zoeken in bestandsnamen Ã©n inhoud..."
                className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreateFolderHere && (
              <button
                onClick={() => setShowNewFolder(true)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FolderPlusIcon className="h-4 w-4" /> Nieuwe map
              </button>
            )}
            {canEditCurrent && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => handleUpload(e.target.files)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                >
                  <ArrowUpTrayIcon className="h-4 w-4" /> Upload
                </button>
              </>
            )}
            {canManagePermissions && (
              <button
                onClick={() => setShowMembers(true)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <UsersIcon className="h-4 w-4" /> Toegang
              </button>
            )}
          </div>
        </div>
        {uploadProgress !== null && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded bg-gray-100">
            <div className="h-full bg-primary-600 transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 flex-shrink-0 overflow-y-auto border-r bg-white p-3 md:block">
          <SidebarTree
            rootFolders={rootFolders}
            currentId={currentFolder?.id ?? null}
            onOpen={openFolder}
          />
        </aside>

        {/* Sidebar (mobile drawer) */}
        {showMobileTree && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="flex-1 bg-black/40" onClick={() => setShowMobileTree(false)} />
            <aside className="w-72 max-w-[85vw] overflow-y-auto bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Mappen</h3>
                <button onClick={() => setShowMobileTree(false)}>
                  <XMarkIcon className="h-5 w-5 text-gray-400" />
                </button>
              </div>
              <SidebarTree
                rootFolders={rootFolders}
                currentId={currentFolder?.id ?? null}
                onOpen={openFolder}
              />
            </aside>
          </div>
        )}

        {/* Main area */}
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          {/* Breadcrumb */}
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-gray-600">
            <button
              className="rounded px-1.5 py-0.5 hover:bg-gray-100"
              onClick={() => openFolder(null)}
            >
              Hoofdmap
            </button>
            {viewMode === 'search' && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                Zoekresultaten voor "{searchQuery}"
              </span>
            )}
            {viewMode === 'folder' &&
              ancestors.map(a => (
                <span key={a.id} className="flex items-center gap-1">
                  <span className="text-gray-400">/</span>
                  <button
                    onClick={async () => {
                      if (a.id === currentFolder?.id) return
                      try {
                        const detail = await filesApi.getFolder(a.id)
                        setCurrentFolder(detail)
                      } catch {
                        /* niks */
                      }
                    }}
                    className="rounded px-1.5 py-0.5 font-medium hover:bg-gray-100"
                  >
                    {a.name}
                  </button>
                </span>
              ))}
          </nav>

          {loading && <div className="py-8 text-center text-sm text-gray-500">Bezig met laden...</div>}

          {!loading && viewMode === 'folder' && childFolders.length === 0 && files.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <FolderIcon className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">Deze map is leeg.</p>
              {canEditCurrent && (
                <p className="mt-1 text-xs text-gray-400">
                  Gebruik "Upload" of "Nieuwe map" om te beginnen.
                </p>
              )}
            </div>
          )}

          {!loading && viewMode === 'search' && files.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              Geen bestanden gevonden voor "{searchQuery}".
            </div>
          )}

          {/* Folders */}
          {viewMode === 'folder' && childFolders.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Mappen
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                {childFolders.map(f => (
                  <div
                    key={f.id}
                    className="group relative flex flex-col rounded-md border bg-white p-1.5 shadow-sm hover:shadow-md"
                  >
                    <button
                      onClick={() => openFolder(f)}
                      className="flex flex-1 flex-col items-center gap-0.5 text-center"
                    >
                      <FolderIcon className="h-6 w-6 text-yellow-500" />
                      <span className="line-clamp-2 break-words text-xs font-medium text-gray-800">
                        {f.name}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {f.file_count} bestand{f.file_count === 1 ? '' : 'en'}
                      </span>
                    </button>
                    {(isAdmin || f.can_edit) && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          handleDeleteFolder(f)
                        }}
                        className="absolute right-0.5 top-0.5 rounded p-0.5 text-gray-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        title="Map verwijderen"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Files */}
          {files.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bestanden
              </h3>
              <div className="overflow-hidden rounded-lg border bg-white">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Naam</th>
                      <th className="hidden px-3 py-2 md:table-cell">Map</th>
                      <th className="hidden px-3 py-2 sm:table-cell">Grootte</th>
                      <th className="hidden px-3 py-2 md:table-cell">Toegevoegd</th>
                      <th className="px-3 py-2 text-right">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {files.map(f => {
                      const Icon = iconForExtension(f.extension)
                      return (
                        <tr key={f.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setPreviewEntry(f)}
                              className="flex items-center gap-2 text-left"
                            >
                              <Icon className="h-5 w-5 flex-shrink-0 text-gray-500" />
                              <span className="truncate text-sm font-medium text-gray-800 hover:text-primary-700">
                                {f.name}
                              </span>
                            </button>
                          </td>
                          <td className="hidden px-3 py-2 text-xs text-gray-500 md:table-cell">
                            {f.folder_name || (f.folder ? '' : 'Hoofdmap')}
                          </td>
                          <td className="hidden px-3 py-2 text-xs text-gray-500 sm:table-cell">
                            {formatSize(f.size)}
                          </td>
                          <td className="hidden px-3 py-2 text-xs text-gray-500 md:table-cell">
                            {new Date(f.uploaded_at).toLocaleString('nl-NL')}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setPreviewEntry(f)}
                                className="rounded p-1 text-gray-400 hover:bg-primary-50 hover:text-primary-600"
                                title="Voorbeeld bekijken"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDownload(f)}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                title="Downloaden"
                              >
                                <ArrowDownTrayIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteFile(f)}
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="Verwijderen"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      {showNewFolder && (
        <NewFolderDialog
          parent={currentFolder}
          onClose={() => setShowNewFolder(false)}
          onCreated={folder => {
            setShowNewFolder(false)
            loadFolder(currentFolder)
            loadRoot()
            // Als de nieuwe map in de huidige map is aangemaakt, blijven we hier;
            // anders (in root) navigeren we er direct heen.
            if (!currentFolder) {
              setCurrentFolder(folder)
            }
          }}
        />
      )}

      {showMembers && currentFolder && (
        <MembersDialog
          folder={currentFolder}
          onClose={() => setShowMembers(false)}
          onChanged={refreshCurrent}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          busy={confirmBusy}
          onCancel={() => (confirmBusy ? undefined : setConfirmState(null))}
          onConfirm={async () => {
            setConfirmBusy(true)
            try {
              await confirmState.onConfirm()
            } finally {
              setConfirmBusy(false)
              setConfirmState(null)
            }
          }}
        />
      )}

      {previewEntry && (
        <PreviewDialog
          entry={previewEntry}
          onClose={() => setPreviewEntry(null)}
          onDownload={() => handleDownload(previewEntry)}
        />
      )}
    </div>
  )
}

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Bevestigen',
  danger,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
              danger ? 'bg-red-100 text-red-600' : 'bg-primary-100 text-primary-600'
            }`}
          >
            <ExclamationTriangleIcon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-600">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {busy ? 'Bezig...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface FolderAncestorItem {
  id: string
  name: string
}

interface SidebarTreeProps {
  rootFolders: Folder[]
  currentId: string | null
  onOpen: (folder: Folder | null) => void
}

function SidebarTree({ rootFolders, currentId, onOpen }: SidebarTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [childrenMap, setChildrenMap] = useState<Record<string, Folder[]>>({})
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  const toggle = async (folder: Folder) => {
    const isOpen = expanded.has(folder.id)
    const next = new Set(expanded)
    if (isOpen) {
      next.delete(folder.id)
      setExpanded(next)
      return
    }
    next.add(folder.id)
    setExpanded(next)
    if (!childrenMap[folder.id]) {
      setLoadingIds(prev => new Set(prev).add(folder.id))
      try {
        const kids = await filesApi.listFolders(folder.id)
        setChildrenMap(prev => ({ ...prev, [folder.id]: kids }))
      } catch {
        /* stil */
      } finally {
        setLoadingIds(prev => {
          const n = new Set(prev)
          n.delete(folder.id)
          return n
        })
      }
    }
  }

  const renderNode = (folder: Folder, depth: number) => {
    const isOpen = expanded.has(folder.id)
    const kids = childrenMap[folder.id]
    const hasKids = folder.child_count > 0
    const isLoading = loadingIds.has(folder.id)
    return (
      <li key={folder.id}>
        <div
          className={`group flex items-center rounded ${
            currentId === folder.id
              ? 'bg-primary-50 text-primary-700'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          <button
            type="button"
            onClick={() => hasKids && toggle(folder)}
            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded ${
              hasKids ? 'text-gray-500 hover:bg-gray-200' : 'text-transparent'
            }`}
            aria-label={isOpen ? 'Inklappen' : 'Uitklappen'}
            disabled={!hasKids}
          >
            <ChevronRightIcon
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
          </button>
          <button
            onClick={() => onOpen(folder)}
            className="flex flex-1 items-center gap-2 truncate rounded px-1 py-1.5 text-left text-sm"
          >
            <FolderIcon className="h-4 w-4 flex-shrink-0 text-yellow-500" />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
        {isOpen && (
          <ul className="space-y-0.5">
            {isLoading && !kids && (
              <li
                className="px-2 py-1 text-xs text-gray-400"
                style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
              >
                Bezig...
              </li>
            )}
            {kids && kids.length === 0 && (
              <li
                className="px-2 py-1 text-xs text-gray-400"
                style={{ paddingLeft: `${(depth + 1) * 12 + 24}px` }}
              >
                (leeg)
              </li>
            )}
            {kids && kids.map(child => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div>
      <button
        onClick={() => onOpen(null)}
        className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm ${
          currentId === null ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <FolderIcon className="h-4 w-4" /> Hoofdmap
      </button>
      <ul className="space-y-0.5">
        {rootFolders.map(f => renderNode(f, 0))}
      </ul>
      {rootFolders.length === 0 && (
        <p className="mt-2 px-2 text-xs text-gray-500">Nog geen mappen aangemaakt.</p>
      )}
    </div>
  )
}

interface PreviewDialogProps {
  entry: FileEntry
  onClose: () => void
  onDownload: () => void
}

function PreviewDialog({ entry, onClose, onDownload }: PreviewDialogProps) {
  const [meta, setMeta] = useState<FilePreview | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let revoke: string | null = null
    let cancelled = false
    setLoading(true)
    setError(null)
    setMeta(null)
    setBlobUrl(null)

    ;(async () => {
      try {
        const m = await filesApi.getPreview(entry.id)
        if (cancelled) return
        setMeta(m)
        if (m.kind === 'pdf' || m.kind === 'image') {
          const resp = await api.get(filesApi.downloadUrl(entry.id, true), {
            responseType: 'blob',
          })
          if (cancelled) return
          const mimeFromBlob =
            (resp.data as Blob).type || m.mime_type || 'application/octet-stream'
          const blob = new Blob([resp.data as Blob], { type: mimeFromBlob })
          const url = URL.createObjectURL(blob)
          revoke = url
          setBlobUrl(url)
        }
      } catch (err: any) {
        if (!cancelled)
          setError(err?.response?.data?.detail || 'Voorbeeld kon niet worden geladen.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [entry.id])

  const isPdf = meta?.kind === 'pdf'
  const isImage = meta?.kind === 'image'
  const isText = meta?.kind === 'text' || meta?.kind === 'office'
  const isOther = meta?.kind === 'other'

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-white shadow-xl sm:h-[85vh] sm:rounded-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
            {entry.name}
          </h3>
          <div className="flex items-center gap-1">
            {blobUrl && (
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                title="Openen in nieuw tabblad"
              >
                Nieuw tabblad
              </a>
            )}
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700"
              title="Downloaden"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              title="Sluiten"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              Voorbeeld laden...
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
              {error}
            </div>
          )}
          {!loading && !error && meta && (
            <>
              {isImage && blobUrl && (
                <div className="flex h-full items-center justify-center p-2">
                  <img
                    src={blobUrl}
                    alt={entry.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
              {isPdf && blobUrl && (
                <div className="h-full">
                  {/* Desktop: inline iframe. Mobiel: valt terug op knop, want
                     mobiele browsers renderen PDF's vaak niet in een iframe. */}
                  <iframe
                    src={blobUrl}
                    title={entry.name}
                    className="hidden h-full w-full border-0 md:block"
                  />
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
                    <DocumentTextIcon className="h-10 w-10 text-gray-400" />
                    <p className="text-sm text-gray-600">
                      PDF-voorbeeld wordt op mobiel niet inline getoond.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <a
                        href={blobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Openen in nieuw tabblad
                      </a>
                      <button
                        onClick={onDownload}
                        className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" /> Downloaden
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {isText && (
                <div className="h-full overflow-auto bg-white p-3">
                  {meta.kind === 'office' && (
                    <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Tekst-voorbeeld uit een {entry.extension.toUpperCase()}-bestand.
                      Opmaak, afbeeldingen en formules worden niet getoond — download
                      het bestand voor de volledige weergave.
                    </div>
                  )}
                  {meta.text ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-800">
                      {meta.text}
                    </pre>
                  ) : (
                    <div className="text-center text-sm text-gray-500">
                      Geen tekst beschikbaar voor voorbeeld.
                    </div>
                  )}
                </div>
              )}
              {isOther && (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <DocumentIcon className="h-12 w-12 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    Geen voorbeeld beschikbaar voor .{meta.extension || '?'}-bestanden.
                  </p>
                  <button
                    onClick={onDownload}
                    className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" /> Downloaden
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

