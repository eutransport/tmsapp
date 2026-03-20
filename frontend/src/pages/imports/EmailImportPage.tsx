import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Settings, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle,
  Loader2, Plus, Trash2, Eye, ChevronLeft, ChevronRight, FileText, Inbox,
  ChevronDown, ChevronUp, ArrowLeft, Square, CheckSquare
} from 'lucide-react';
import {
  getMailboxConfigs,
  getEmailImports,
  fetchMailboxEmails,
  testMailboxConnection,
  deleteMailboxConfig,
  reviewEmailImport,
  getEmailImportStats,
  bulkDeleteEmailImports,
} from '../../api/emailImport';

// Status config will be initialized in component with translations

const EmailImportPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-4 h-4" />, label: t('imports.statusPending', 'In wachtrij') },
    processing: { color: 'bg-blue-100 text-blue-800', icon: <Loader2 className="w-4 h-4 animate-spin" />, label: t('imports.statusProcessing', 'Verwerken') },
    awaiting_review: { color: 'bg-orange-100 text-orange-800', icon: <AlertCircle className="w-4 h-4" />, label: t('imports.statusAwaitingReview', 'Wacht op Review') },
    approved: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-4 h-4" />, label: t('leave.approved') },
    rejected: { color: 'bg-red-100 text-red-800', icon: <XCircle className="w-4 h-4" />, label: t('leave.rejected') },
    completed: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-4 h-4" />, label: t('imports.statusCompleted', 'Voltooid') },
    failed: { color: 'bg-red-100 text-red-800', icon: <AlertCircle className="w-4 h-4" />, label: t('imports.statusFailed', 'Mislukt') },
  };

  const mailboxStatusConfig: Record<string, { color: string; label: string }> = {
    active: { color: 'bg-green-100 text-green-800', label: t('common.active') },
    inactive: { color: 'bg-gray-100 text-gray-800', label: t('common.inactive') },
    error: { color: 'bg-red-100 text-red-800', label: t('common.error') },
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [invoiceTypes, setInvoiceTypes] = useState<Record<string, 'purchase' | 'credit' | 'sales'>>({});

  // Fetch mailbox configs
  const { data: mailboxes = [], isLoading: mailboxesLoading } = useQuery({
    queryKey: ['mailboxConfigs'],
    queryFn: getMailboxConfigs,
  });

  // Fetch email imports with pagination
  const { data: importsData, isLoading: importsLoading } = useQuery({
    queryKey: ['emailImports', currentPage, statusFilter],
    queryFn: () => getEmailImports({ page: currentPage, page_size: 20, status: statusFilter || undefined }),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['emailImportStats'],
    queryFn: getEmailImportStats,
    refetchInterval: 30000,
  });

  // Fetch emails mutation
  const fetchEmailsMutation = useMutation({
    mutationFn: (mailboxId: string) => fetchMailboxEmails(mailboxId, 50),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailImports'] });
      queryClient.invalidateQueries({ queryKey: ['emailImportStats'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxConfigs'] });
    },
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: testMailboxConnection,
  });

  // Delete mailbox mutation
  const deleteMailboxMutation = useMutation({
    mutationFn: deleteMailboxConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mailboxConfigs'] });
    },
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: ({ id, action, notes, invoiceType }: { id: string; action: 'approve' | 'reject'; notes?: string; invoiceType?: 'purchase' | 'credit' | 'sales' }) =>
      reviewEmailImport(id, action, notes, invoiceType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailImports'] });
      queryClient.invalidateQueries({ queryKey: ['emailImportStats'] });
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteEmailImports(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailImports'] });
      queryClient.invalidateQueries({ queryKey: ['emailImportStats'] });
      setSelectedIds(new Set());
    },
  });

  const toggleRowExpanded = (id: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === imports.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(imports.map(i => i.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(t('imports.bulkDeleteConfirm', `Weet je zeker dat je ${selectedIds.size} e-mail import(s) wilt verwijderen?`))) {
      bulkDeleteMutation.mutate(Array.from(selectedIds));
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const imports = importsData?.results || [];
  const totalPages = importsData ? Math.ceil(importsData.count / 20) : 0;

  return (
    <div className="max-w-7xl mx-auto py-4 sm:py-8">
      {/* Header with Back Button */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/imports')}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('imports.backToImports', 'Terug naar Imports')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t('imports.emailInvoiceImport', 'E-mail Factuur Import')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('imports.emailImportDescription', 'Importeer facturen automatisch uit shared mailboxen')}
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">{t('common.total', 'Totaal')}</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">{t('common.today', 'Vandaag')}</div>
            <div className="text-2xl font-bold text-gray-900">{stats.today}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">{t('imports.toReview', 'Te Reviewen')}</div>
            <div className="text-2xl font-bold text-orange-600">{stats.by_status.awaiting_review}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm font-medium text-gray-500">{t('leave.approved', 'Goedgekeurd')}</div>
            <div className="text-2xl font-bold text-green-600">{stats.by_status.approved}</div>
          </div>
        </div>
      )}

      {/* Mailbox Configurations */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t('imports.mailboxConfigurations', 'Mailbox Configuraties')}</h2>
          <button
            onClick={() => navigate('/imports/email/mailbox/new')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            {t('imports.newMailbox', 'Nieuwe Mailbox')}
          </button>
        </div>

        {mailboxesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : mailboxes.length === 0 ? (
          <div className="text-center py-12">
            <Inbox className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-4 text-gray-500">{t('imports.noMailboxesConfigured', 'Nog geen mailboxen geconfigureerd')}</p>
            <button
              onClick={() => navigate('/imports/email/mailbox/new')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              {t('imports.addFirstMailbox', 'Eerste Mailbox Toevoegen')}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {mailboxes.map((mailbox) => {
              const statusInfo = mailboxStatusConfig[mailbox.status] || mailboxStatusConfig.inactive;

              return (
                <div key={mailbox.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <Mail className="w-6 h-6 text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{mailbox.name}</h3>
                      <p className="text-sm text-gray-500">{mailbox.email_address}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                        <span>{mailbox.protocol_display}</span>
                        <span>•</span>
                        <span>{mailbox.total_emails_processed} verwerkt</span>
                        {mailbox.last_fetch_at && (
                          <>
                            <span>•</span>
                            <span>Laatst: {formatDate(mailbox.last_fetch_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>

                    <button
                      onClick={() => testConnectionMutation.mutate(mailbox.id)}
                      disabled={testConnectionMutation.isPending}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      title="Test Verbinding"
                    >
                      {testConnectionMutation.isPending && testConnectionMutation.variables === mailbox.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Settings className="w-5 h-5" />
                      )}
                    </button>

                    <button
                      onClick={() => fetchEmailsMutation.mutate(mailbox.id)}
                      disabled={fetchEmailsMutation.isPending}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                      title="E-mails Ophalen"
                    >
                      {fetchEmailsMutation.isPending && fetchEmailsMutation.variables === mailbox.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-5 h-5" />
                      )}
                    </button>

                    <button
                      onClick={() => navigate(`/imports/email/mailbox/${mailbox.id}`)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                      title={t('common.edit')}
                    >
                      <Eye className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => {
                        if (window.confirm(t('imports.deleteMailboxConfirm', 'Weet je zeker dat je deze mailbox configuratie wilt verwijderen?'))) {
                          deleteMailboxMutation.mutate(mailbox.id);
                        }
                      }}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Fetch results toast */}
        {fetchEmailsMutation.isSuccess && (
          <div className="px-6 py-3 bg-green-50 border-t border-green-200">
            <p className="text-sm text-green-800">
              ✅ {fetchEmailsMutation.data.stats.emails_processed} e-mails verwerkt,{' '}
              {fetchEmailsMutation.data.stats.attachments_processed} bijlages geïmporteerd
            </p>
          </div>
        )}
      </div>

      {/* Email Imports Queue */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Geïmporteerde E-mails</h2>

          <div className="flex items-center gap-4">
            {/* Bulk Delete */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleteMutation.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                {bulkDeleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Verwijder ({selectedIds.size})
              </button>
            )}

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Alle statussen</option>
              <option value="awaiting_review">Wacht op Review</option>
              <option value="approved">Goedgekeurd</option>
              <option value="rejected">Afgewezen</option>
              <option value="completed">Voltooid</option>
              <option value="failed">Mislukt</option>
            </select>
          </div>
        </div>

        {importsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-12">
            <Mail className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-4 text-gray-500">{t('imports.noEmailsImported', 'Nog geen e-mails geïmporteerd')}</p>
          </div>
        ) : (
          <>
            {/* Select All Header */}
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-4">
              <button
                onClick={toggleSelectAll}
                className="text-gray-500 hover:text-gray-700"
              >
                {selectedIds.size === imports.length ? (
                  <CheckSquare className="w-5 h-5 text-blue-600" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </button>
              <span className="text-sm text-gray-500">
                {selectedIds.size > 0 ? `${selectedIds.size} geselecteerd` : 'Selecteer alles'}
              </span>
            </div>

            <div className="divide-y divide-gray-200">
              {imports.map((emailImport) => {
                const statusInfo = statusConfig[emailImport.status] || statusConfig.pending;
                const isExpanded = expandedRows.has(emailImport.id);
                const isSelected = selectedIds.has(emailImport.id);

                return (
                  <div key={emailImport.id} className={`${isSelected ? 'bg-blue-50' : ''}`}>
                    <div className="px-6 py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {/* Selection Checkbox */}
                          <button
                            onClick={() => toggleSelection(emailImport.id)}
                            className="mt-1 text-gray-500 hover:text-gray-700"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-5 h-5 text-blue-600" />
                            ) : (
                              <Square className="w-5 h-5" />
                            )}
                          </button>

                          {/* Expand/Collapse Button */}
                          <button
                            onClick={() => toggleRowExpanded(emailImport.id)}
                            className="mt-1 text-gray-400 hover:text-gray-600"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <h3 className="font-medium text-gray-900 truncate">
                                {emailImport.email_subject || t('imports.noSubject', '(Geen onderwerp)')}
                              </h3>
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                                {statusInfo.icon}
                                {statusInfo.label}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                              <span>Van: {emailImport.email_from}</span>
                              <span>•</span>
                              <span>{formatDate(emailImport.email_date)}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                {emailImport.attachment_count} bijlage(s)
                              </span>
                            </div>
                            {!isExpanded && emailImport.email_body_preview && (
                              <p className="mt-2 text-sm text-gray-400 truncate max-w-2xl">
                                {emailImport.email_body_preview}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Review Actions */}
                        {emailImport.status === 'awaiting_review' && (
                          <div className="flex items-center gap-2 ml-4">
                            {/* Invoice Type Selection */}
                            <select
                              value={invoiceTypes[emailImport.id] || emailImport.default_invoice_type || 'purchase'}
                              onChange={(e) =>
                                setInvoiceTypes((prev) => ({
                                  ...prev,
                                  [emailImport.id]: e.target.value as 'purchase' | 'credit' | 'sales'
                                }))
                              }
                              className="border border-gray-300 rounded px-2 py-1 text-sm"
                            >
                              <option value="purchase">Inkoop</option>
                              <option value="credit">Credit</option>
                              <option value="sales">Verkoop</option>
                            </select>
                            <input
                              type="text"
                              placeholder="Notities..."
                              value={reviewNotes[emailImport.id] || ''}
                              onChange={(e) =>
                                setReviewNotes((prev) => ({ ...prev, [emailImport.id]: e.target.value }))
                              }
                              className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
                            />
                            <button
                              onClick={() =>
                                reviewMutation.mutate({
                                  id: emailImport.id,
                                  action: 'approve',
                                  notes: reviewNotes[emailImport.id],
                                  invoiceType: invoiceTypes[emailImport.id] || emailImport.default_invoice_type || 'purchase',
                                })
                              }
                              disabled={reviewMutation.isPending}
                              className="p-2 text-green-600 hover:bg-green-50 rounded"
                              title="Goedkeuren"
                            >
                              <CheckCircle className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() =>
                                reviewMutation.mutate({
                                  id: emailImport.id,
                                  action: 'reject',
                                  notes: reviewNotes[emailImport.id],
                                })
                              }
                              disabled={reviewMutation.isPending}
                              className="p-2 text-red-600 hover:bg-red-50 rounded"
                              title="Afwijzen"
                            >
                              <XCircle className="w-5 h-5" />
                            </button>
                          </div>
                        )}

                        {emailImport.status !== 'awaiting_review' && (
                          <button
                            onClick={() => {
                              // Navigate to invoice import detail if available, otherwise to email import list
                              if (emailImport.first_invoice_import_id) {
                                navigate(`/imports/${emailImport.first_invoice_import_id}`);
                              } else {
                                // Show toast or stay on page - no detail page available
                                alert(t('imports.noInvoiceDetails', 'Geen factuur details beschikbaar'));
                              }
                            }}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                            title="Details bekijken"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Section - Extracted Data */}
                    {isExpanded && (
                      <div className="px-6 pb-4 bg-gray-50 border-t border-gray-100">
                        {emailImport.attachments && emailImport.attachments.length > 0 ? (
                          <div className="space-y-4 pt-4">
                            {emailImport.attachments.map((attachment) => (
                              <div key={attachment.id} className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="flex items-center gap-2 mb-3">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="font-medium text-gray-700">{attachment.original_filename}</span>
                                  <span className="text-xs text-gray-400">
                                    ({(attachment.file_size / 1024).toFixed(1)} KB)
                                  </span>
                                  {attachment.is_processed && (
                                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                      Verwerkt
                                    </span>
                                  )}
                                </div>

                                {attachment.extracted_data ? (
                                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
                                    {attachment.extracted_data.invoice_number && (
                                      <div>
                                        <span className="text-gray-500 block">Factuurnummer</span>
                                        <span className="font-medium">{attachment.extracted_data.invoice_number}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.invoice_date && (
                                      <div>
                                        <span className="text-gray-500 block">Factuurdatum</span>
                                        <span className="font-medium">{attachment.extracted_data.invoice_date}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.due_date && (
                                      <div>
                                        <span className="text-gray-500 block">Vervaldatum</span>
                                        <span className="font-medium">{attachment.extracted_data.due_date}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.supplier_name && (
                                      <div>
                                        <span className="text-gray-500 block">Leverancier</span>
                                        <span className="font-medium">{attachment.extracted_data.supplier_name}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.supplier_vat && (
                                      <div>
                                        <span className="text-gray-500 block">BTW-nummer</span>
                                        <span className="font-medium">{attachment.extracted_data.supplier_vat}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.supplier_kvk && (
                                      <div>
                                        <span className="text-gray-500 block">KVK</span>
                                        <span className="font-medium">{attachment.extracted_data.supplier_kvk}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.supplier_iban && (
                                      <div>
                                        <span className="text-gray-500 block">IBAN</span>
                                        <span className="font-medium">{attachment.extracted_data.supplier_iban}</span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.net_amount !== undefined && (
                                      <div>
                                        <span className="text-gray-500 block">Netto bedrag</span>
                                        <span className="font-medium">
                                          {attachment.extracted_data.currency || '€'} {attachment.extracted_data.net_amount?.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.vat_amount !== undefined && (
                                      <div>
                                        <span className="text-gray-500 block">BTW</span>
                                        <span className="font-medium">
                                          {attachment.extracted_data.currency || '€'} {attachment.extracted_data.vat_amount?.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                    {attachment.extracted_data.total_amount !== undefined && (
                                      <div>
                                        <span className="text-gray-500 block">Totaal</span>
                                        <span className="font-medium text-lg">
                                          {attachment.extracted_data.currency || '€'} {attachment.extracted_data.total_amount?.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-400 italic">
                                    {t('imports.noExtractedData', 'Geen geëxtraheerde gegevens beschikbaar')}
                                  </p>
                                )}

                                {/* Line items if present */}
                                {attachment.extracted_data?.line_items && attachment.extracted_data.line_items.length > 0 && (
                                  <div className="mt-4">
                                    <span className="text-gray-500 text-sm block mb-2">Factuurregels</span>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-sm">
                                        <thead>
                                          <tr className="bg-gray-50">
                                            <th className="px-3 py-2 text-left text-gray-500">Omschrijving</th>
                                            <th className="px-3 py-2 text-right text-gray-500">Aantal</th>
                                            <th className="px-3 py-2 text-right text-gray-500">Prijs</th>
                                            <th className="px-3 py-2 text-right text-gray-500">BTW %</th>
                                            <th className="px-3 py-2 text-right text-gray-500">Totaal</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {attachment.extracted_data.line_items.map((item, lineIdx) => (
                                            <tr key={lineIdx}>
                                              <td className="px-3 py-2">{item.description || '-'}</td>
                                              <td className="px-3 py-2 text-right">{item.quantity || '-'}</td>
                                              <td className="px-3 py-2 text-right">
                                                {item.unit_price !== undefined ? `€ ${item.unit_price.toFixed(2)}` : '-'}
                                              </td>
                                              <td className="px-3 py-2 text-right">
                                                {item.vat_rate !== undefined ? `${item.vat_rate}%` : '-'}
                                              </td>
                                              <td className="px-3 py-2 text-right">
                                                {item.total !== undefined ? `€ ${item.total.toFixed(2)}` : '-'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="pt-4 text-sm text-gray-400 italic">
                            {t('imports.noAttachments', 'Geen bijlagen beschikbaar')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-500">
                  Pagina {currentPage} van {totalPages} ({importsData?.count || 0} totaal)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default EmailImportPage;
