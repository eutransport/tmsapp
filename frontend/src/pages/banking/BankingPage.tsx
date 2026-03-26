import { useState, useEffect, useRef, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Transition } from '@headlessui/react'
import {
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowUpTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  CreditCardIcon,
  PencilSquareIcon,
  LinkIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import {
  BankAccount,
  BankTransaction,
  BankImport,
  BankAccountType,
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getBankTypes,
  getBankImports,
  getBankTransactions,
  importBankStatement,
  manualMatchTransaction,
  unmatchTransaction,
  rematchTransactions,
} from '@/api/banking'
import { getInvoices } from '@/api/invoices'
import { Invoice } from '@/types'
import clsx from '@/utils/clsx'

const MATCH_STATUS_COLORS: Record<string, string> = {
  nieuw: 'bg-gray-100 text-gray-700',
  gematcht: 'bg-green-100 text-green-800',
  handmatig: 'bg-blue-100 text-blue-800',
  geen_match: 'bg-red-100 text-red-700',
}

type Tab = 'accounts' | 'transactions' | 'imports'

export default function BankingPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const isAdmin = user?.rol === 'admin'

  const [activeTab, setActiveTab] = useState<Tab>('accounts')

  // ── Accounts state ──────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [bankTypes, setBankTypes] = useState<BankAccountType[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState<BankAccount | null>(null)
  const [accountForm, setAccountForm] = useState({ naam: '', bank: 'ing', iban: '', is_active: true })
  const [accountSaving, setAccountSaving] = useState(false)

  // ── Transactions state ──────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [transactionsCount, setTransactionsCount] = useState(0)
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [txPage, setTxPage] = useState(1)
  const [txSearch, setTxSearch] = useState('')
  const [txAccountFilter, setTxAccountFilter] = useState('')
  const [txStatusFilter, setTxStatusFilter] = useState('')
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [matchingTx, setMatchingTx] = useState<BankTransaction | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [matchSaving, setMatchSaving] = useState(false)

  // ── Imports state ───────────────────────────────────────────────────────
  const [imports, setImports] = useState<BankImport[]>([])
  const [importsLoading, setImportsLoading] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importAccount, setImportAccount] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [rematchLoading, setRematchLoading] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAccounts()
    loadBankTypes()
  }, [])

  useEffect(() => {
    if (activeTab === 'transactions') loadTransactions()
  }, [activeTab, txPage, txSearch, txAccountFilter, txStatusFilter])

  useEffect(() => {
    if (activeTab === 'imports') loadImports()
  }, [activeTab])

  async function loadAccounts() {
    setAccountsLoading(true)
    try {
      const data = await getBankAccounts()
      setAccounts(data)
    } catch {
      toast.error(t('errors.loadFailed'))
    } finally {
      setAccountsLoading(false)
    }
  }

  async function loadBankTypes() {
    try {
      const data = await getBankTypes()
      setBankTypes(data)
    } catch {
      // ignore
    }
  }

  async function loadTransactions() {
    setTransactionsLoading(true)
    try {
      const result = await getBankTransactions({
        bankrekening: txAccountFilter || undefined,
        match_status: txStatusFilter || undefined,
        search: txSearch || undefined,
        page: txPage,
      })
      setTransactions(result.results)
      setTransactionsCount(result.count)
    } catch {
      toast.error(t('errors.loadFailed'))
    } finally {
      setTransactionsLoading(false)
    }
  }

  async function loadImports() {
    setImportsLoading(true)
    try {
      const data = await getBankImports()
      setImports(data)
    } catch {
      toast.error(t('errors.loadFailed'))
    } finally {
      setImportsLoading(false)
    }
  }

  // ── Account CRUD ─────────────────────────────────────────────────────────
  function openCreateAccount() {
    setEditingAccount(null)
    setAccountForm({ naam: '', bank: 'ing', iban: '', is_active: true })
    setShowAccountModal(true)
  }

  function openEditAccount(account: BankAccount) {
    setEditingAccount(account)
    setAccountForm({ naam: account.naam, bank: account.bank, iban: account.iban, is_active: account.is_active })
    setShowAccountModal(true)
  }

  async function saveAccount() {
    if (!accountForm.naam.trim() || !accountForm.iban.trim()) {
      toast.error(t('banking.fillRequired'))
      return
    }
    setAccountSaving(true)
    try {
      if (editingAccount) {
        const updated = await updateBankAccount(editingAccount.id, accountForm)
        setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
        toast.success(t('banking.accountUpdated'))
      } else {
        const created = await createBankAccount(accountForm)
        setAccounts(prev => [...prev, created])
        toast.success(t('banking.accountCreated'))
      }
      setShowAccountModal(false)
    } catch (err: any) {
      const msg = err.response?.data?.iban?.[0] || err.response?.data?.detail || t('errors.saveFailed')
      toast.error(msg)
    } finally {
      setAccountSaving(false)
    }
  }

  async function deleteAccount() {
    if (!deleteAccountConfirm) return
    try {
      await deleteBankAccount(deleteAccountConfirm.id)
      setAccounts(prev => prev.filter(a => a.id !== deleteAccountConfirm.id))
      toast.success(t('banking.accountDeleted'))
    } catch {
      toast.error(t('errors.deleteFailed'))
    } finally {
      setDeleteAccountConfirm(null)
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!importAccount || !importFile) {
      toast.error(t('banking.fillRequired'))
      return
    }
    setImporting(true)
    try {
      const result = await importBankStatement(importAccount, importFile)
      toast.success(result.bericht)
      setShowImportModal(false)
      setImportFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      loadImports()
      if (activeTab === 'transactions') loadTransactions()
    } catch (err: any) {
      const msg = err.response?.data?.error || t('errors.saveFailed')
      toast.error(msg)
    } finally {
      setImporting(false)
    }
  }

  async function handleRematch(accountId: string) {
    setRematchLoading(accountId)
    try {
      const result = await rematchTransactions(accountId)
      toast.success(t('banking.rematchDone', { count: result.matched }))
      if (activeTab === 'transactions') loadTransactions()
    } catch {
      toast.error(t('errors.saveFailed'))
    } finally {
      setRematchLoading(null)
    }
  }

  // ── Matching ─────────────────────────────────────────────────────────────
  async function openMatchModal(tx: BankTransaction) {
    setMatchingTx(tx)
    setInvoiceSearch('')
    setShowMatchModal(true)
    try {
      const data = await getInvoices({ status: 'verzonden' })
      setInvoices(data.results)
    } catch {
      toast.error(t('errors.loadFailed'))
    }
  }

  async function handleManualMatch(invoiceId: string) {
    if (!matchingTx) return
    setMatchSaving(true)
    try {
      const updated = await manualMatchTransaction(matchingTx.id, invoiceId)
      setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t))
      toast.success(t('banking.matched'))
      setShowMatchModal(false)
      setMatchingTx(null)
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('errors.saveFailed'))
    } finally {
      setMatchSaving(false)
    }
  }

  async function handleUnmatch(txId: string) {
    try {
      const updated = await unmatchTransaction(txId)
      setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t))
      toast.success(t('banking.unmatched'))
    } catch {
      toast.error(t('errors.saveFailed'))
    }
  }

  const filteredInvoices = invoices.filter(inv =>
    !invoiceSearch ||
    inv.factuurnummer.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
    (inv as any).bedrijf_naam?.toLowerCase().includes(invoiceSearch.toLowerCase())
  )

  const formatCurrency = (val: string | number) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Number(val))

  const totalPages = Math.ceil(transactionsCount / 25)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('banking.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('banking.subtitle')}</p>
        </div>
        {isAdmin && activeTab === 'accounts' && (
          <button
            onClick={openCreateAccount}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <PlusIcon className="h-4 w-4" />
            {t('banking.addAccount')}
          </button>
        )}
        {isAdmin && activeTab === 'imports' && (
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            {t('banking.importStatement')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px space-x-8">
          {(['accounts', 'transactions', 'imports'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'py-2 px-1 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {t(`banking.tab_${tab}`)}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab: Accounts ─────────────────────────────────────────────────── */}
      {activeTab === 'accounts' && (
        <div>
          {accountsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <BanknotesIcon className="h-12 w-12 mx-auto mb-3" />
              <p className="text-lg font-medium">{t('banking.noAccounts')}</p>
              <p className="text-sm mt-1">{t('banking.noAccountsHint')}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map(account => (
                <div key={account.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCardIcon className="h-5 w-5 text-primary-600" />
                      <span className="font-semibold text-gray-900">{account.naam}</span>
                    </div>
                    <span className={clsx(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    )}>
                      {account.is_active ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-mono">{account.iban}</p>
                  <p className="text-xs text-gray-400">{account.bank_display}</p>
                  {isAdmin && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => openEditAccount(account)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" />
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={() => handleRematch(account.id)}
                        disabled={rematchLoading === account.id}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 disabled:opacity-50"
                      >
                        <ArrowPathIcon className={clsx('h-3.5 w-3.5', rematchLoading === account.id && 'animate-spin')} />
                        {t('banking.rematch')}
                      </button>
                      <button
                        onClick={() => setDeleteAccountConfirm(account)}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 ml-auto"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Transactions ──────────────────────────────────────────────── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder={t('common.search')}
                value={txSearch}
                onChange={e => { setTxSearch(e.target.value); setTxPage(1) }}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <select
              value={txAccountFilter}
              onChange={e => { setTxAccountFilter(e.target.value); setTxPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t('banking.allAccounts')}</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.naam}</option>
              ))}
            </select>
            <select
              value={txStatusFilter}
              onChange={e => { setTxStatusFilter(e.target.value); setTxPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t('banking.allStatuses')}</option>
              <option value="nieuw">{t('banking.status_nieuw')}</option>
              <option value="gematcht">{t('banking.status_gematcht')}</option>
              <option value="handmatig">{t('banking.status_handmatig')}</option>
              <option value="geen_match">{t('banking.status_geen_match')}</option>
            </select>
          </div>

          {transactionsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <BanknotesIcon className="h-12 w-12 mx-auto mb-3" />
              <p className="text-lg font-medium">{t('banking.noTransactions')}</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.datum')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.tegenpartij')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.omschrijving')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('banking.bedrag')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.matchStatus')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.factuur')}</th>
                        {isAdmin && <th className="px-4 py-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {transactions.map(tx => (
                        <tr key={tx.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{tx.datum}</td>
                          <td className="px-4 py-3 text-gray-900 max-w-xs truncate">{tx.naam_tegenpartij || '—'}</td>
                          <td className="px-4 py-3 text-gray-500 max-w-xs truncate" title={tx.omschrijving}>{tx.omschrijving || '—'}</td>
                          <td className={clsx(
                            'px-4 py-3 text-right font-medium whitespace-nowrap',
                            Number(tx.bedrag) >= 0 ? 'text-green-700' : 'text-red-600'
                          )}>
                            {formatCurrency(tx.bedrag)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx(
                              'px-2 py-0.5 rounded-full text-xs font-medium',
                              MATCH_STATUS_COLORS[tx.match_status] || 'bg-gray-100 text-gray-600'
                            )}>
                              {tx.match_status_display}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {tx.gekoppelde_factuur_nummer || tx.gevonden_factuurnummer || '—'}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                                {tx.match_status !== 'gematcht' && tx.match_status !== 'handmatig' && Number(tx.bedrag) > 0 && (
                                  <button
                                    onClick={() => openMatchModal(tx)}
                                    className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                    title={t('banking.matchManually')}
                                  >
                                    <LinkIcon className="h-4 w-4" />
                                  </button>
                                )}
                                {(tx.match_status === 'gematcht' || tx.match_status === 'handmatig') && (
                                  <button
                                    onClick={() => handleUnmatch(tx.id)}
                                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                    title={t('banking.unmatch')}
                                  >
                                    <XCircleIcon className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {t('banking.transactionCount', { count: transactionsCount })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={txPage <= 1}
                      onClick={() => setTxPage(p => p - 1)}
                      className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50"
                    >
                      {t('common.previous')}
                    </button>
                    <span className="px-3 py-1.5 text-sm text-gray-600">{txPage} / {totalPages}</span>
                    <button
                      disabled={txPage >= totalPages}
                      onClick={() => setTxPage(p => p + 1)}
                      className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50"
                    >
                      {t('common.next')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Imports ───────────────────────────────────────────────────── */}
      {activeTab === 'imports' && (
        <div>
          {importsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : imports.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <ArrowUpTrayIcon className="h-12 w-12 mx-auto mb-3" />
              <p className="text-lg font-medium">{t('banking.noImports')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.datum')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.account')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('banking.bestand')}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('banking.status')}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('banking.transacties')}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('banking.gematcht')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {imports.map(imp => (
                    <tr key={imp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{new Date(imp.created_at).toLocaleDateString('nl-NL')}</td>
                      <td className="px-4 py-3 text-gray-900">{imp.bankrekening_naam}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{imp.bestandsnaam}</td>
                      <td className="px-4 py-3 text-center">
                        {imp.status === 'verwerkt' ? (
                          <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" />
                        ) : (
                          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 mx-auto" title={imp.foutmelding} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{imp.aantal_transacties}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-medium text-green-700">{imp.aantal_gematcht}</span>
                        <span className="text-gray-400"> / {imp.aantal_transacties}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Modal: Add/Edit Account ─────────────────────────────────────────── */}
      <Transition.Root show={showAccountModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowAccountModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500/75" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {editingAccount ? t('banking.editAccount') : t('banking.addAccount')}
                  </Dialog.Title>
                  <button onClick={() => setShowAccountModal(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('banking.accountName')} *</label>
                    <input
                      type="text"
                      value={accountForm.naam}
                      onChange={e => setAccountForm(f => ({ ...f, naam: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder={t('banking.accountNamePlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('banking.bank')} *</label>
                    <select
                      value={accountForm.bank}
                      onChange={e => setAccountForm(f => ({ ...f, bank: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {bankTypes.map(bt => (
                        <option key={bt.value} value={bt.value}>{bt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('banking.iban')} *</label>
                    <input
                      type="text"
                      value={accountForm.iban}
                      onChange={e => setAccountForm(f => ({ ...f, iban: e.target.value.toUpperCase() }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                      placeholder="NL00 INGB 0000 0000 00"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={accountForm.is_active}
                      onChange={e => setAccountForm(f => ({ ...f, is_active: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label htmlFor="is_active" className="text-sm text-gray-700">{t('banking.active')}</label>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setShowAccountModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={saveAccount}
                    disabled={accountSaving}
                    className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    {accountSaving ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* ── Modal: Import Statement ─────────────────────────────────────────── */}
      <Transition.Root show={showImportModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowImportModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500/75" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {t('banking.importStatement')}
                  </Dialog.Title>
                  <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('banking.selectAccount')} *</label>
                    <select
                      value={importAccount}
                      onChange={e => setImportAccount(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">{t('banking.chooseAccount')}</option>
                      {accounts.filter(a => a.is_active).map(a => (
                        <option key={a.id} value={a.id}>{a.naam} ({a.iban})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('banking.selectFile')} *</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.mt940,.sta,.940"
                      onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                      className="w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                    />
                    <p className="text-xs text-gray-400 mt-1">{t('banking.fileHint')}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {importing ? (
                      <><ArrowPathIcon className="h-4 w-4 animate-spin" />{t('common.loading')}</>
                    ) : (
                      <><ArrowUpTrayIcon className="h-4 w-4" />{t('banking.import')}</>
                    )}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* ── Modal: Manual Match ─────────────────────────────────────────────── */}
      <Transition.Root show={showMatchModal} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowMatchModal(false)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500/75" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {t('banking.matchManually')}
                  </Dialog.Title>
                  <button onClick={() => setShowMatchModal(false)} className="text-gray-400 hover:text-gray-600">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                {matchingTx && (
                  <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
                    <p className="font-medium text-gray-900">{matchingTx.naam_tegenpartij}</p>
                    <p className="text-gray-500">{matchingTx.omschrijving}</p>
                    <p className="text-green-700 font-medium mt-1">{formatCurrency(matchingTx.bedrag)}</p>
                  </div>
                )}
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder={t('banking.searchInvoice')}
                    value={invoiceSearch}
                    onChange={e => setInvoiceSearch(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredInvoices.length === 0 ? (
                    <p className="text-center text-gray-400 py-4 text-sm">{t('banking.noInvoicesFound')}</p>
                  ) : (
                    filteredInvoices.map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => handleManualMatch(inv.id)}
                        disabled={matchSaving}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-primary-50 text-left disabled:opacity-50"
                      >
                        <span>
                          <span className="font-medium text-gray-900">{inv.factuurnummer}</span>
                          <span className="text-gray-500 ml-2">{inv.bedrijf_naam}</span>
                        </span>
                        <span className="text-green-700 font-medium">{formatCurrency(inv.totaal)}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex justify-end mt-4">
                  <button
                    onClick={() => setShowMatchModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* ── Modal: Delete Confirm ───────────────────────────────────────────── */}
      <Transition.Root show={!!deleteAccountConfirm} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setDeleteAccountConfirm(null)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
            leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500/75" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {t('banking.deleteAccount')}
                  </Dialog.Title>
                </div>
                <p className="text-sm text-gray-500">
                  {t('banking.deleteAccountConfirm', { naam: deleteAccountConfirm?.naam })}
                </p>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setDeleteAccountConfirm(null)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={deleteAccount}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>
    </div>
  )
}
