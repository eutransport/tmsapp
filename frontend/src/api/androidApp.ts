import api from './client'

export interface AndroidAppInfo {
  available: boolean
  version?: string
  size?: number
  updated_at?: string
}

export const androidApp = {
  info: async (): Promise<AndroidAppInfo> => {
    const { data } = await api.get<AndroidAppInfo>('/core/app/android/')
    return data
  },

  // De APK zelf komt via een kortlevende ondertekende URL; een <a href> kan
  // geen JWT-header meesturen.
  downloadLink: async (): Promise<string> => {
    const { data } = await api.get<{ url: string }>('/core/app/android/download/')
    return data.url
  },
}
