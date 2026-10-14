import api from './client'

export interface TolBackupWeek {
  id: string
  jaar: number
  weeknummer: number
  van_datum: string
  tot_datum: string
  aantal_regels: number
  totaal_bedrag: string
  teruggezet_op: string | null
}

export interface TolBackup {
  id: string
  omschrijving: string
  van_datum: string
  tot_datum: string
  aantal_regels: number
  totaal_bedrag: string
  gemaakt_op: string
  gemaakt_door: string
  weken: TolBackupWeek[]
}

export interface TolBackupOverzicht {
  weken_per_backup: number
  maximaal_bewaard: number
  backups: TolBackup[]
}

export interface WeekVerschil {
  jaar: number
  weeknummer: number
  van_datum: string
  tot_datum: string
  in_backup: number
  nu_aanwezig: number
  bedrag_backup: string
  bedrag_nu: string
  wordt_verwijderd: number
  wordt_hersteld: number
  blijft_staan_gefactureerd: number
}

export interface TerugzetResultaat {
  jaar: number
  weeknummer: number
  hersteld: number
  bijgewerkt: number
  verwijderd: number
  overgeslagen_gefactureerd: number
}

export const haalBackups = async (): Promise<TolBackupOverzicht> => {
  const { data } = await api.get('/tolling/backups/')
  return data
}

export const maakBackup = async (omschrijving = ''): Promise<TolBackup> => {
  const { data } = await api.post('/tolling/backups/', { omschrijving })
  return data
}

export const haalWeekVerschil = async (backupId: string, weekId: string): Promise<WeekVerschil> => {
  const { data } = await api.get(`/tolling/backups/${backupId}/week/${weekId}/verschil/`)
  return data
}

export const zetWeekTerug = async (backupId: string, weekId: string): Promise<TerugzetResultaat> => {
  const { data } = await api.post(`/tolling/backups/${backupId}/week/${weekId}/terugzetten/`)
  return data
}

export const verwijderBackup = async (backupId: string): Promise<void> => {
  await api.delete(`/tolling/backups/${backupId}/`)
}
