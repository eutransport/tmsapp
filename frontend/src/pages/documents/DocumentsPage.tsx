/**
 * Documenten overzicht pagina - lijst van alle documenten
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  DocumentIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { getDocuments, deleteDocument, SignedDocumentList } from '../../api/documents';

export default function DocumentsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const statusConfig = {
    pending: {
      label: t('documents.signatureRequired'),
      icon: ClockIcon,
      className: 'bg-yellow-100 text-yellow-800',
    },
    signed: {
      label: t('documents.signed'),
      icon: CheckCircleIcon,
      className: 'bg-green-100 text-green-800',
    },
    expired: {
      label: t('common.expired', 'Verlopen'),
      icon: ExclamationCircleIcon,
      className: 'bg-red-100 text-red-800',
    },
  };
  const [documents, setDocuments] = useState<SignedDocumentList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const data = await getDocuments();
      setDocuments(data);
      setError(null);
    } catch (err) {
      setError(t('errors.loadError', 'Kon documenten niet laden'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm(t('documents.deleteConfirm'))) {
      return;
    }

    try {
      await deleteDocument(id);
      setDocuments(documents.filter(d => d.id !== id));
    } catch (err) {
      console.error('Fout bij verwijderen:', err);
      alert(t('errors.deleteError', 'Kon document niet verwijderen'));
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900">{t('documents.title')}</h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-gray-500 truncate">
            {t('documents.uploadViewSign', 'Upload, bekijk en onderteken PDF documenten')}
          </p>
        </div>
        <Link
          to="/documents/upload"
          className="inline-flex items-center flex-shrink-0 px-2.5 py-1.5 sm:px-4 sm:py-2 border border-transparent rounded-md shadow-sm text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" />
          <span className="hidden sm:inline">{t('documents.uploadDocument')}</span>
          <span className="sm:hidden">Upload</span>
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {/* Documents list */}
      {documents.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <DocumentIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">{t('documents.noDocuments')}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t('documents.uploadToStart', 'Upload een PDF document om te beginnen')}
          </p>
          <div className="mt-6">
            <Link
              to="/documents/upload"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <PlusIcon className="h-5 w-5 mr-2" />
              {t('documents.uploadDocument')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.name')}</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('common.createdAt', 'Aangemaakt')}</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('documents.signed')}</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {documents.map((doc) => {
                  const status = statusConfig[doc.status];
                  const StatusIcon = status.icon;
                  return (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5">
                        <Link to={`/documents/${doc.id}`} className="flex items-center gap-2 min-w-0">
                          <DocumentIcon className="h-4 w-4 text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-blue-600 truncate">{doc.title}</p>
                            <p className="text-xs text-gray-500 truncate">{doc.original_filename}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                          <StatusIcon className="h-3.5 w-3.5 mr-1" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{formatDate(doc.created_at)}</td>
                      <td className="px-2 py-1.5 text-gray-600">{doc.signed_at ? formatDate(doc.signed_at) : '-'}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-1">
                          {doc.status === 'pending' && (
                            <button
                              onClick={() => navigate(`/documents/${doc.id}/sign`)}
                              className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                              title={t('documents.sign')}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDelete(doc.id, e)}
                            className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                            title={t('common.delete')}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden divide-y divide-gray-200">
            {documents.map((doc) => {
              const status = statusConfig[doc.status];
              const StatusIcon = status.icon;

              return (
                <li key={doc.id}>
                  <Link
                    to={`/documents/${doc.id}`}
                    className="block hover:bg-gray-50 transition-colors"
                  >
                    <div className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start min-w-0 flex-1">
                          <DocumentIcon className="h-7 w-7 text-gray-400 flex-shrink-0 mt-0.5" />
                          <div className="ml-2 min-w-0 flex-1">
                            <p className="text-sm font-medium text-blue-600 truncate">
                              {doc.title}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {doc.original_filename}
                            </p>
                            <div className="mt-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                                <StatusIcon className="h-3 w-3 mr-0.5" />
                                {status.label}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {doc.status === 'pending' && (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                navigate(`/documents/${doc.id}/sign`);
                              }}
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md"
                              title={t('documents.sign')}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDelete(doc.id, e)}
                            className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md"
                            title={t('common.delete')}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 ml-9 flex flex-wrap items-center text-xs text-gray-500 gap-x-2">
                        <span>{doc.uploaded_by_name}</span>
                        <span>•</span>
                        <span>{formatDate(doc.created_at)}</span>
                        {doc.signed_at && (
                          <>
                            <span>•</span>
                            <span>{t('documents.signed')}: {formatDate(doc.signed_at)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
