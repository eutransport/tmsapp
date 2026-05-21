/**
 * Document detail pagina
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DocumentIcon,
  ArrowDownTrayIcon,
  PencilSquareIcon,
  TrashIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowLeftIcon,
  EnvelopeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  getDocument,
  deleteDocument,
  downloadSignedDocument,
  downloadOriginalDocument,
  emailSignedDocument,
  SignedDocument,
} from '../../api/documents';
import EmailProfileSelector from '@/components/EmailProfileSelector';

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [document, setDocument] = useState<SignedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  
  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailProfileId, setEmailProfileId] = useState('');

  useEffect(() => {
    if (id) {
      loadDocument();
    }
    
    // Cleanup blob URL on unmount
    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [id]);

  // Load PDF blob for preview when document changes
  useEffect(() => {
    if (document) {
      loadPdfPreview();
    }
  }, [document?.id, document?.status]);

  const loadPdfPreview = async () => {
    if (!document) return;
    
    try {
      // Clean up old blob URL
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
      
      const blob = document.status === 'signed' && document.signed_file_url
        ? await downloadSignedDocument(document.id)
        : await downloadOriginalDocument(document.id);
      
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
    } catch (err) {
      console.error('Could not load PDF preview:', err);
    }
  };

  const loadDocument = async () => {
    try {
      setLoading(true);
      const data = await getDocument(id!);
      setDocument(data);
      setError(null);
    } catch (err) {
      setError(t('errors.loadError', 'Kon document niet laden'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('documents.deleteConfirm'))) {
      return;
    }

    try {
      await deleteDocument(id!);
      navigate('/documents');
    } catch (err) {
      console.error('Fout bij verwijderen:', err);
      alert(t('errors.deleteError', 'Kon document niet verwijderen'));
    }
  };

  const handleDownload = async (signed: boolean) => {
    if (!document) return;
    
    try {
      setDownloading(true);
      const blob = signed 
        ? await downloadSignedDocument(id!)
        : await downloadOriginalDocument(id!);
      
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = signed 
        ? `ondertekend_${document.original_filename}`
        : document.original_filename;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert(t('errors.downloadError', 'Kon bestand niet downloaden'));
    } finally {
      setDownloading(false);
    }
  };

  const openEmailModal = () => {
    setEmailAddress('');
    setEmailSubject(document ? t('documents.signedDocumentSubject', { title: document.title, defaultValue: `Ondertekend document: ${document.title}` }) : '');
    setEmailMessage('');
    setEmailError(null);
    setEmailSuccess(null);
    setShowEmailModal(true);
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document || !emailAddress) return;

    try {
      setSendingEmail(true);
      setEmailError(null);
      
      const result = await emailSignedDocument(document.id, {
        email: emailAddress,
        subject: emailSubject || undefined,
        message: emailMessage || undefined,
        email_profile_id: emailProfileId || undefined,
      });
      
      setEmailSuccess(result.message);
      setTimeout(() => {
        setShowEmailModal(false);
        setEmailSuccess(null);
      }, 2000);
    } catch (err: any) {
      console.error('Email error:', err);
      setEmailError(err.response?.data?.error || t('errors.emailError', 'Kon e-mail niet verzenden'));
    } finally {
      setSendingEmail(false);
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

  if (error || !document) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || t('documents.notFound', 'Document niet gevonden')}</p>
        <Link to="/documents" className="mt-4 text-blue-600 hover:text-blue-800">
          {t('documents.backToDocuments', 'Terug naar documenten')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        to="/documents"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeftIcon className="h-4 w-4 mr-1" />
        {t('documents.backToDocuments', 'Terug naar documenten')}
      </Link>

      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start">
            <DocumentIcon className="h-12 w-12 text-gray-400" />
            <div className="ml-4">
              <h1 className="text-2xl font-bold text-gray-900">{document.title}</h1>
              <p className="text-sm text-gray-500">{document.original_filename}</p>
              {document.description && (
                <p className="mt-2 text-gray-600">{document.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {document.status === 'pending' ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                <ClockIcon className="h-4 w-4 mr-1" />
                {t('documents.signatureRequired')}
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                <CheckCircleIcon className="h-4 w-4 mr-1" />
                {t('documents.signed')}
              </span>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">{t('documents.uploadedBy')}</dt>
            <dd className="mt-1 text-sm text-gray-900">{document.uploaded_by_name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">{t('documents.uploadDate')}</dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDate(document.created_at)}</dd>
          </div>
          {document.signed_by_name && (
            <>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t('documents.signedBy', 'Ondertekend door')}</dt>
                <dd className="mt-1 text-sm text-gray-900">{document.signed_by_name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">{t('documents.signedOn', 'Ondertekend op')}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(document.signed_at)}</dd>
              </div>
            </>
          )}
        </div>

        {/* Signature details */}
        {document.signature_data && (
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">{t('documents.signatureDetails', 'Handtekening details')}</h3>
            <div className="text-sm text-gray-600">
              Pagina {document.signature_data.page}, positie ({document.signature_data.x.toFixed(1)}%, {document.signature_data.y.toFixed(1)}%)
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">{t('common.actions')}</h2>
        <div className="flex flex-wrap gap-3">
          {document.status === 'pending' && (
            <Link
              to={`/documents/${document.id}/sign`}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <PencilSquareIcon className="h-5 w-5 mr-2" />
              {t('documents.sign')}
            </Link>
          )}
          
          {document.status === 'signed' && document.signed_file_url && (
            <>
              <button
                onClick={() => handleDownload(true)}
                disabled={downloading}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
                {t('documents.downloadSigned', 'Download ondertekend')}
              </button>
              
              <button
                onClick={openEmailModal}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
              >
                <EnvelopeIcon className="h-5 w-5 mr-2" />
                {t('documents.sendEmail', 'E-mail verzenden')}
              </button>
              
              <Link
                to={`/documents/${document.id}/sign`}
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-700 bg-white hover:bg-blue-50"
              >
                <PencilSquareIcon className="h-5 w-5 mr-2" />
                {t('documents.resignDocument', 'Opnieuw ondertekenen')}
              </Link>
            </>
          )}
          
          <button
            onClick={() => handleDownload(false)}
            disabled={downloading}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
            {t('documents.downloadOriginal', 'Download origineel')}
          </button>
          
          <button
            onClick={handleDelete}
            className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
          >
            <TrashIcon className="h-5 w-5 mr-2" />
            {t('common.delete')}
          </button>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-medium text-gray-900">
                {t('documents.emailDocument', 'Document e-mailen')}
              </h3>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <form onSubmit={handleSendEmail} className="p-4 space-y-4">
              {emailError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                  {emailError}
                </div>
              )}
              
              {emailSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">
                  {emailSuccess}
                </div>
              )}
              
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {t('common.email')} *
                </label>
                <input
                  type="email"
                  id="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder={t('documents.emailPlaceholder', 'ontvanger@voorbeeld.nl')}
                />
              </div>
              
              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700">
                  {t('documents.subject', 'Onderwerp')}
                </label>
                <input
                  type="text"
                  id="subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
              
              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700">
                  {t('documents.messageOptional', 'Bericht (optioneel)')}
                </label>
                <textarea
                  id="message"
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  placeholder={t('documents.messagePlaceholder', 'Voeg een persoonlijk bericht toe...')}
                />
              </div>

              <EmailProfileSelector
                value={emailProfileId}
                onChange={setEmailProfileId}
              />
              
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={sendingEmail || !emailAddress}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                >
                  {sendingEmail ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      {t('common.sending')}
                    </>
                  ) : (
                    <>
                      <EnvelopeIcon className="h-5 w-5 mr-2" />
                      {t('common.send')}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview section */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">{t('common.preview')}</h2>
        <div className="border rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center min-h-96">
          {pdfBlobUrl ? (
            <iframe
              src={pdfBlobUrl}
              className="w-full h-[600px]"
              title="PDF Preview"
            />
          ) : (
            <div className="flex items-center justify-center h-[600px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
