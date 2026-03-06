import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Upload, FileText, AlertCircle, CheckCircle, Clock, Loader2, Mail, Trash2, FileCheck, Square, CheckSquare } from 'lucide-react';
import { uploadInvoice, getInvoiceImports, deleteInvoiceImport, bulkDeleteInvoiceImports, bulkConvertInvoiceImports, InvoiceImport } from '../../api/ocr';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Status config will be initialized in component with translations

// Tab Navigation Component
const ImportTabs: React.FC = () => {
  const location = useLocation();
  const isUploadTab = location.pathname === '/imports';
  const isEmailTab = location.pathname.startsWith('/imports/email');
  
  return (
    <div className="border-b border-gray-200 mb-8">
      <nav className="-mb-px flex space-x-8">
        <Link
          to="/imports"
          className={`py-4 px-1 border-b-2 font-medium text-sm ${
            isUploadTab && !isEmailTab
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload
          </span>
        </Link>
        <Link
          to="/imports/email"
          className={`py-4 px-1 border-b-2 font-medium text-sm ${
            isEmailTab
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            E-mail Import
          </span>
        </Link>
      </nav>
    </div>
  );
};

const InvoiceImportPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    pending: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-4 h-4" />, label: t('imports.statusPending', 'In wachtrij') },
    processing: { color: 'bg-blue-100 text-blue-800', icon: <Loader2 className="w-4 h-4 animate-spin" />, label: t('imports.statusProcessing', 'Verwerken') },
    extracted: { color: 'bg-purple-100 text-purple-800', icon: <FileText className="w-4 h-4" />, label: t('imports.statusExtracted', 'Geëxtraheerd') },
    review: { color: 'bg-orange-100 text-orange-800', icon: <AlertCircle className="w-4 h-4" />, label: t('imports.statusReviewNeeded', 'Review nodig') },
    completed: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-4 h-4" />, label: t('imports.statusCompleted', 'Voltooid') },
    failed: { color: 'bg-red-100 text-red-800', icon: <AlertCircle className="w-4 h-4" />, label: t('imports.statusFailed', 'Mislukt') },
  };
  const [uploadProgress, setUploadProgress] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkInvoiceType, setBulkInvoiceType] = useState<'inkoop' | 'verkoop' | 'credit'>('inkoop');

  // Fetch imports
  const { data: imports = [], isLoading } = useQuery({
    queryKey: ['invoiceImports'],
    queryFn: () => getInvoiceImports(),
    refetchInterval: 5000, // Auto refresh to check processing status
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: uploadInvoice,
    onMutate: () => {
      setUploadProgress(true);
      setUploadError(null);
    },
    onSuccess: (data) => {
      setUploadProgress(false);
      queryClient.invalidateQueries({ queryKey: ['invoiceImports'] });
      // Navigate to the import detail page
      navigate(`/imports/${data.id}`);
    },
    onError: (error: Error) => {
      setUploadProgress(false);
      setUploadError(error.message || t('imports.uploadError', 'Er ging iets mis bij het uploaden'));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteInvoiceImport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceImports'] });
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteInvoiceImports(ids),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoiceImports'] });
      setSelectedIds(new Set());
      alert(data.message);
    },
    onError: (error: Error) => {
      alert(t('imports.deleteError', `Fout bij verwijderen: ${error.message}`));
    },
  });

  // Bulk convert mutation
  const bulkConvertMutation = useMutation({
    mutationFn: ({ ids, invoice_type }: { ids: string[]; invoice_type: 'inkoop' | 'verkoop' | 'credit' }) => 
      bulkConvertInvoiceImports(ids, invoice_type),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoiceImports'] });
      setSelectedIds(new Set());
      alert(data.message);
    },
    onError: (error: Error) => {
      alert(t('imports.convertError', `Fout bij omzetten: ${error.message}`));
    },
  });

  // Selection handlers
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === imports.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(imports.map((imp: InvoiceImport) => imp.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(t('imports.bulkDeleteImportConfirm', `Weet je zeker dat je ${selectedIds.size} import(s) wilt verwijderen?`))) {
      bulkDeleteMutation.mutate(Array.from(selectedIds));
    }
  };

  const handleBulkConvert = () => {
    if (selectedIds.size === 0) return;
    const typeLabel = bulkInvoiceType === 'inkoop' ? t('imports.purchaseInvoices', 'inkoopfacturen') : bulkInvoiceType === 'verkoop' ? t('imports.salesInvoices', 'verkoopfacturen') : t('imports.creditNotes', "creditnota's");
    if (window.confirm(t('imports.bulkConvertConfirm', `Weet je zeker dat je ${selectedIds.size} import(s) wilt omzetten naar ${typeLabel}?`))) {
      bulkConvertMutation.mutate({ ids: Array.from(selectedIds), invoice_type: bulkInvoiceType });
    }
  };

  // Dropzone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      uploadMutation.mutate(acceptedFiles[0]);
    }
  }, [uploadMutation]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tiff', '.tif'],
    },
    maxSize: 20 * 1024 * 1024, // 20MB
    multiple: false,
  });

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('imports.invoiceImport')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('imports.invoiceImportDescription', 'Upload inkoopfacturen om automatisch gegevens te extraheren met OCR')}
        </p>
      </div>

      {/* Tabs */}
      <ImportTabs />

      {/* Upload Zone */}
      <div
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }
          ${uploadProgress ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {uploadProgress ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <p className="mt-4 text-lg font-medium text-gray-900">
              {t('imports.processingInvoice', 'Factuur wordt verwerkt...')}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {t('imports.ocrProcessing', 'OCR herkenning kan even duren')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <Upload className={`w-12 h-12 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`} />
            <p className="mt-4 text-lg font-medium text-gray-900">
              {isDragActive ? t('imports.dropToUpload', 'Laat los om te uploaden') : t('imports.dragInvoice', 'Sleep een factuur hierheen')}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {t('imports.clickToSelect', 'of klik om een bestand te selecteren')}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              {t('imports.allowedFormats', 'PDF, JPG, PNG of TIFF (max. 20MB)')}
            </p>
          </div>
        )}
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">{t('imports.uploadFailed', 'Upload mislukt')}</p>
            <p className="text-sm text-red-600">{uploadError}</p>
          </div>
        </div>
      )}

      {/* Recent Imports */}
      <div className="mt-12">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('imports.recentImports', 'Recente Imports')}</h2>
          
          {/* Bulk Actions */}
          {imports.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-sm text-gray-600">{selectedIds.size} {t('common.selected', 'geselecteerd')}</span>
                  
                  <select
                    value={bulkInvoiceType}
                    onChange={(e) => setBulkInvoiceType(e.target.value as 'inkoop' | 'verkoop' | 'credit')}
                    className="text-sm border-gray-300 rounded-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="inkoop">{t('imports.purchaseInvoice', 'Inkoopfactuur')}</option>
                    <option value="verkoop">{t('imports.salesInvoice', 'Verkoopfactuur')}</option>
                    <option value="credit">{t('imports.creditNote', 'Creditnota')}</option>
                  </select>
                  
                  <button
                    onClick={handleBulkConvert}
                    disabled={bulkConvertMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50"
                  >
                    {bulkConvertMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileCheck className="w-4 h-4" />
                    )}
                    {t('imports.saveAsInvoice', 'Opslaan als factuur')}
                  </button>
                  
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleteMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
                  >
                    {bulkDeleteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {t('common.delete')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <FileText className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="mt-4 text-gray-500">{t('imports.noInvoicesImported', 'Nog geen facturen geïmporteerd')}</p>
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            {/* Desktop Table */}
            <table className="hidden md:table min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
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
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Bestand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Patroon
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vertrouwen
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Datum
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acties
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {imports.map((imp: InvoiceImport) => {
                  const status = statusConfig[imp.status] || statusConfig.pending;
                  const isSelected = selectedIds.has(imp.id);
                  
                  return (
                    <tr 
                      key={imp.id} 
                      className={`hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-blue-50' : ''}`}
                      onClick={() => navigate(`/imports/${imp.id}`)}
                    >
                      <td className="px-4 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => toggleSelect(imp.id)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FileText className="w-5 h-5 text-gray-400 mr-3" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {imp.file_name}
                            </div>
                            <div className="text-sm text-gray-500">
                              {formatFileSize(imp.file_size)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          {status.icon}
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {imp.pattern_name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {imp.ocr_confidence !== undefined && imp.ocr_confidence !== null ? (
                          <div className="flex items-center">
                            <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                              <div 
                                className={`h-2 rounded-full ${
                                  imp.ocr_confidence >= 0.8 ? 'bg-green-500' :
                                  imp.ocr_confidence >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${imp.ocr_confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-sm text-gray-600">
                              {(imp.ocr_confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(imp.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(t('imports.deleteImportConfirm', 'Weet je zeker dat je deze import wilt verwijderen?'))) {
                              deleteMutation.mutate(imp.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile Card Layout */}
            <div className="md:hidden">
              {/* Mobile Select All */}
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b">
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
                <span className="text-xs text-gray-500 uppercase font-medium">{t('common.selectAll', 'Alles selecteren')}</span>
              </div>
              <div className="divide-y divide-gray-200">
                {imports.map((imp: InvoiceImport) => {
                  const status = statusConfig[imp.status] || statusConfig.pending;
                  const isSelected = selectedIds.has(imp.id);
                  
                  return (
                    <div
                      key={imp.id}
                      className={`p-4 space-y-3 ${isSelected ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleSelect(imp.id)}
                          className="text-gray-500 hover:text-gray-700 mt-0.5 flex-shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => navigate(`/imports/${imp.id}`)}
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 truncate">{imp.file_name}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{formatFileSize(imp.file_size)}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 ml-8">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          {status.icon}
                          {status.label}
                        </span>
                        {imp.pattern_name && (
                          <span className="text-xs text-gray-500">{imp.pattern_name}</span>
                        )}
                        {imp.ocr_confidence !== undefined && imp.ocr_confidence !== null && (
                          <div className="flex items-center gap-1">
                            <div className="w-12 bg-gray-200 rounded-full h-1.5">
                              <div 
                                className={`h-1.5 rounded-full ${
                                  imp.ocr_confidence >= 0.8 ? 'bg-green-500' :
                                  imp.ocr_confidence >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${imp.ocr_confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{(imp.ocr_confidence * 100).toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between ml-8">
                        <span className="text-xs text-gray-400">{formatDate(imp.created_at)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(t('imports.deleteImportConfirm', 'Weet je zeker dat je deze import wilt verwijderen?'))) {
                              deleteMutation.mutate(imp.id);
                            }
                          }}
                          className="text-xs text-red-600 hover:text-red-900 font-medium"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceImportPage;
