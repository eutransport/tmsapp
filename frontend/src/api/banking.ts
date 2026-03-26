import api from './client'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BankAccount {
  id: string
  naam: string
  bank: string
  bank_display: string
  iban: string
  is_active: boolean
  created_by: string | null
  created_by_naam: string | null
  created_at: string
  updated_at: string
}

export interface BankImport {
  id: string
  bankrekening: string
  bankrekening_naam: string
  bestandsnaam: string
  bestandsformaat: string
  status: 'verwerkt' | 'fout'
  aantal_transacties: number
  aantal_gematcht: number
  foutmelding: string
  geimporteerd_door: string | null
  geimporteerd_door_naam: string | null
  created_at: string
}

export interface BankTransaction {
  id: string
  bankrekening: string
  bankrekening_naam: string
  datum: string
  bedrag: string
  naam_tegenpartij: string
  rekeningnummer_tegenpartij: string
  omschrijving: string
  mutatiesoort: string
  referentie: string
  match_status: 'nieuw' | 'gematcht' | 'handmatig' | 'geen_match'
  match_status_display: string
  gekoppelde_factuur: string | null
  gekoppelde_factuur_nummer: string | null
  gevonden_factuurnummer: string
  importbestand: string
  created_at: string
  updated_at: string
}

export interface BankAccountType {
  value: string
  label: string
}

export interface ImportResult {
  import_id: string
  aantal_transacties: number
  aantal_gematcht: number
  aantal_overgeslagen: number
  bericht: string
}

// ─── Bank Accounts ───────────────────────────────────────────────────────────

export async function getBankAccounts(): Promise<BankAccount[]> {
  const response = await api.get('/banking/accounts/')
  return Array.isArray(response.data) ? response.data : (response.data.results ?? [])
}

export async function createBankAccount(
  data: Partial<BankAccount>
): Promise<BankAccount> {
  const response = await api.post('/banking/accounts/', data)
  return response.data
}

export async function updateBankAccount(
  id: string,
  data: Partial<BankAccount>
): Promise<BankAccount> {
  const response = await api.patch(`/banking/accounts/${id}/`, data)
  return response.data
}

export async function deleteBankAccount(id: string): Promise<void> {
  await api.delete(`/banking/accounts/${id}/`)
}

export async function getBankTypes(): Promise<BankAccountType[]> {
  const response = await api.get('/banking/accounts/bank_types/')
  return response.data
}

export async function rematchTransactions(bankrekeningId: string): Promise<{ matched: number }> {
  const response = await api.post(`/banking/accounts/${bankrekeningId}/rematch/`)
  return response.data
}

// ─── Imports ─────────────────────────────────────────────────────────────────

export async function getBankImports(bankrekening?: string): Promise<BankImport[]> {
  const params = bankrekening ? `?bankrekening=${bankrekening}` : ''
  const response = await api.get(`/banking/imports/${params}`)
  return Array.isArray(response.data) ? response.data : (response.data.results ?? [])
}

export async function importBankStatement(
  bankrekening: string,
  file: File
): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('bankrekening', bankrekening)
  formData.append('bestand', file)
  const response = await api.post('/banking/import/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface TransactionFilters {
  bankrekening?: string
  match_status?: string
  search?: string
  page?: number
}

export async function getBankTransactions(
  filters: TransactionFilters = {}
): Promise<{ results: BankTransaction[]; count: number }> {
  const params = new URLSearchParams()
  if (filters.bankrekening) params.append('bankrekening', filters.bankrekening)
  if (filters.match_status) params.append('match_status', filters.match_status)
  if (filters.search) params.append('search', filters.search)
  if (filters.page) params.append('page', String(filters.page))

  const response = await api.get(`/banking/transactions/?${params}`)
  if (Array.isArray(response.data)) {
    return { results: response.data, count: response.data.length }
  }
  return { results: response.data.results ?? [], count: response.data.count ?? 0 }
}

export async function manualMatchTransaction(
  transactionId: string,
  factuurId: string
): Promise<BankTransaction> {
  const response = await api.post(`/banking/transactions/${transactionId}/manual_match/`, {
    factuur_id: factuurId,
  })
  return response.data
}

export async function unmatchTransaction(transactionId: string): Promise<BankTransaction> {
  const response = await api.post(`/banking/transactions/${transactionId}/unmatch/`)
  return response.data
}
