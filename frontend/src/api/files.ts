import api from './client'

export interface FolderMember {
  id: string
  naam: string
  username: string
  email: string
}

export interface FolderPermissionEntry {
  id: string
  user: FolderMember
  can_edit: boolean
  created_at: string
}

export interface FolderAncestor {
  id: string
  name: string
}

export interface Folder {
  id: string
  name: string
  parent: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  can_edit: boolean
  member_count: number
  file_count: number
  child_count: number
}

export interface FolderDetail extends Folder {
  members: FolderPermissionEntry[]
  ancestors: FolderAncestor[]
}

export interface FileEntry {
  id: string
  folder: string | null
  folder_name?: string | null
  name: string
  original_filename: string
  size: number
  mime_type: string
  extension: string
  uploaded_by: string | null
  uploaded_by_name: string | null
  uploaded_at: string
  download_url: string
}

export interface FilePreview {
  kind: 'pdf' | 'image' | 'text' | 'office' | 'other'
  extension: string
  mime_type: string
  name: string
  size: number
  text: string
}

const BASE = '/documents'

export const filesApi = {
  listFolders: async (parent?: string | null): Promise<Folder[]> => {
    const params: Record<string, string> = {}
    if (parent) params.parent = parent
    const { data } = await api.get<Folder[]>(`${BASE}/folders/`, { params })
    return data
  },
  getFolder: async (id: string): Promise<FolderDetail> => {
    const { data } = await api.get<FolderDetail>(`${BASE}/folders/${id}/`)
    return data
  },
  createFolder: async (payload: {
    name: string
    parent?: string | null
    member_ids?: string[]
    members_can_edit?: boolean
  }): Promise<FolderDetail> => {
    const { data } = await api.post<FolderDetail>(`${BASE}/folders/`, payload)
    return data
  },
  renameFolder: async (id: string, name: string): Promise<FolderDetail> => {
    const { data } = await api.patch<FolderDetail>(`${BASE}/folders/${id}/`, { name })
    return data
  },
  deleteFolder: async (id: string): Promise<void> => {
    await api.delete(`${BASE}/folders/${id}/`)
  },
  listMembers: async (id: string): Promise<FolderPermissionEntry[]> => {
    const { data } = await api.get<FolderPermissionEntry[]>(`${BASE}/folders/${id}/members/`)
    return data
  },
  addMembers: async (
    id: string,
    userIds: string[],
    canEdit: boolean,
  ): Promise<FolderPermissionEntry[]> => {
    const { data } = await api.post<FolderPermissionEntry[]>(
      `${BASE}/folders/${id}/members/`,
      { user_ids: userIds, can_edit: canEdit },
    )
    return data
  },
  removeMember: async (id: string, userId: string): Promise<void> => {
    await api.delete(`${BASE}/folders/${id}/members/`, { data: { user_id: userId } })
  },
  availableUsers: async (): Promise<FolderMember[]> => {
    const { data } = await api.get<FolderMember[]>(`${BASE}/folders/available-users/`)
    return data
  },
  listFiles: async (params: { folder?: string | null; q?: string }): Promise<FileEntry[]> => {
    const query: Record<string, string> = {}
    if (params.q) query.q = params.q
    else if (params.folder) query.folder = params.folder
    else query.folder = 'root'
    const { data } = await api.get<FileEntry[]>(`${BASE}/files/`, { params: query })
    return data
  },
  uploadFile: async (
    file: File,
    folder: string | null,
    onProgress?: (percent: number) => void,
  ): Promise<FileEntry> => {
    const form = new FormData()
    form.append('file', file)
    if (folder) form.append('folder', folder)
    const { data } = await api.post<FileEntry>(`${BASE}/files/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: evt => {
        if (onProgress && evt.total) {
          onProgress(Math.round((evt.loaded / evt.total) * 100))
        }
      },
    })
    return data
  },
  renameFile: async (id: string, name: string): Promise<FileEntry> => {
    const { data } = await api.patch<FileEntry>(`${BASE}/files/${id}/`, { name })
    return data
  },
  deleteFile: async (id: string): Promise<void> => {
    await api.delete(`${BASE}/files/${id}/`)
  },
  downloadUrl: (id: string, inline = false) =>
    `${BASE}/files/${id}/download/${inline ? '?inline=1' : ''}`,
  getPreview: async (id: string): Promise<FilePreview> => {
    const { data } = await api.get<FilePreview>(`${BASE}/files/${id}/preview/`)
    return data
  },
}

export default filesApi
