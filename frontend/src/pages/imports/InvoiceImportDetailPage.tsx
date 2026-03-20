import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Save,
  CheckCircle,
  AlertCircle,
  Edit2,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CreditCard,
  ShoppingCart,
} from 'lucide-react';
import {
  getInvoiceImport,
  submitCorrections,
  extractFromRegion,
  convertToInvoice,
  downloadImportFile,
  getImportPageImageUrl,
  reextractLines,
  BoundingBox,
} from '../../api/ocr';
import { getTemplates } from '../../api/invoices';
import { getAllCompanies } from '../../api/companies';
import { useAuthStore } from '../../stores/authStore';

// Helper function to parse Dutch formatted amounts (1.234,56 → 1234.56)
const parseAmount = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'string') return 0;
  
  // Remove currency symbols and whitespace
  let cleaned = value.replace(/[€$\s]/g, '').trim();
  
  // Dutch format: 1.234,56 → remove dots, replace comma with dot
  // Also handle cases where there's only comma as decimal
  if (cleaned.includes(',')) {
    // Remove thousand separators (dots) and replace decimal comma with dot
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
};

// Field labels and invoice types will be initialized in component with translations

interface Selection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const InvoiceImportDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Field type labels
  const fieldLabels: Record<string, string> = {
    invoice_number: t('invoices.invoiceNumber'),
    invoice_date: t('invoices.invoiceDate'),
    due_date: t('invoices.dueDate'),
    supplier_name: t('imports.supplierCustomer', 'Leverancier/Klant'),
    supplier_address: t('common.address'),
    supplier_vat: t('companies.vatNumber'),
    supplier_kvk: t('companies.kvkNumber', 'KVK'),
    subtotal: t('invoices.subtotal'),
    vat_amount: t('imports.vatAmount', 'BTW Bedrag'),
    vat_percentage: t('imports.vatPercentage', 'BTW %'),
    total: t('common.total'),
    iban: t('companies.iban', 'IBAN'),
    reference: t('imports.reference', 'Referentie'),
    description: t('common.description'),
  };

  // Invoice type options
  const invoiceTypes = [
    { value: 'inkoop', label: t('imports.purchaseInvoice', 'Inkoopfactuur'), icon: ShoppingCart, color: 'blue', description: t('imports.purchaseDescription', 'Factuur van leverancier') },
    { value: 'verkoop', label: t('imports.salesInvoice', 'Verkoopfactuur'), icon: Receipt, color: 'green', description: t('imports.salesDescription', 'Factuur aan klant') },
    { value: 'credit', label: t('imports.creditNote', 'Creditnota'), icon: CreditCard, color: 'orange', description: t('imports.creditDescription', 'Credit/terugbetaling') },
  ];

  // State
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1.0); // Manual zoom adjustment
  const [baseScale, setBaseScale] = useState(1.0); // Auto-fit scale
  const [editingField, setEditingField] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [corrections, setCorrections] = useState<Record<string, { value: unknown; region?: BoundingBox }>>({});
  const [extractedValues, setExtractedValues] = useState<Record<string, unknown>>({});
  const [selectedInvoiceType, setSelectedInvoiceType] = useState<string>('inkoop');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedBedrijfId, setSelectedBedrijfId] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [editableLines, setEditableLines] = useState<Array<{
    id: string;
    omschrijving: string;
    aantal: number;
    prijs_per_eenheid: number;
    totaal: number;
    raw_text: string;
  }>>([]);

  // Fetch import data
  const { data: importData, isLoading, error } = useQuery({
    queryKey: ['invoiceImport', id],
    queryFn: () => getInvoiceImport(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      // Auto refresh while processing
      if (query.state.data?.status === 'processing') return 2000;
      return false;
    },
  });

  // Fetch available templates
  const { data: templatesData } = useQuery({
    queryKey: ['invoiceTemplates'],
    queryFn: () => getTemplates(true),
  });

  // Fetch available companies
  const { data: companiesData } = useQuery({
    queryKey: ['allCompanies'],
    queryFn: () => getAllCompanies(),
  });

  // Initialize extracted values from import data
  useEffect(() => {
    if (importData?.extracted_data?.fields) {
      setExtractedValues(importData.extracted_data.fields);
    }
  }, [importData]);

  // Initialize editable lines from import data
  useEffect(() => {
    if (importData?.lines) {
      setEditableLines(importData.lines.map(line => ({
        id: line.id,
        omschrijving: line.omschrijving || line.raw_text || '',
        aantal: line.aantal || 1,
        prijs_per_eenheid: line.prijs_per_eenheid || 0,
        totaal: line.totaal || 0,
        raw_text: line.raw_text || '',
      })));
    }
  }, [importData]);

  // Line editing helpers
  const updateLine = (index: number, field: string, value: string | number) => {
    setEditableLines(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Auto-calculate totaal
      if (field === 'aantal' || field === 'prijs_per_eenheid') {
        updated[index].totaal = (updated[index].aantal || 0) * (updated[index].prijs_per_eenheid || 0);
      }
      return updated;
    });
  };

  const removeLine = (index: number) => {
    setEditableLines(prev => prev.filter((_, i) => i !== index));
  };

  // Mutations
  const correctionMutation = useMutation({
    mutationFn: (data: { corrections: Record<string, { value: unknown; region?: BoundingBox }> }) =>
      submitCorrections(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoiceImport', id] });
    },
  });

  const regionMutation = useMutation({
    mutationFn: (region: { page: number; x: number; y: number; width: number; height: number }) =>
      extractFromRegion(id!, region),
  });

  const convertMutation = useMutation({
    mutationFn: () => {
      const data = { ...extractedValues, ...Object.fromEntries(
        Object.entries(corrections).map(([k, v]) => [k, v.value])
      )};
      return convertToInvoice(id!, {
        invoice_type: selectedInvoiceType as 'inkoop' | 'verkoop' | 'credit',
        template_id: selectedTemplateId,
        bedrijf_id: selectedBedrijfId,
        factuurnummer: data.invoice_number as string,
        factuurdatum: data.invoice_date as string,
        vervaldatum: data.due_date as string,
        omschrijving: data.description as string || importData?.file_name,
        leverancier: data.supplier_name as string,
        totaal: parseAmount(data.total),
        btw_bedrag: parseAmount(data.vat_amount),
        subtotaal: parseAmount(data.subtotal),
        btw_percentage: parseAmount(data.vat_percentage) || 21,
        line_items: editableLines.map(line => ({
          omschrijving: line.omschrijving,
          aantal: line.aantal,
          prijs_per_eenheid: line.prijs_per_eenheid,
          totaal: line.totaal,
        })),
      });
    },
    onSuccess: () => {
      // Navigate to the appropriate list based on type
      navigate('/invoices');
    },
  });

  const reextractMutation = useMutation({
    mutationFn: () => reextractLines(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoiceImport', id] });
      // Update editable lines from refreshed data
      if (data?.lines) {
        setEditableLines(data.lines.map((line: { id: string; omschrijving?: string; raw_text?: string; aantal?: number; prijs_per_eenheid?: number; totaal?: number; }) => ({
          id: line.id,
          omschrijving: line.omschrijving || line.raw_text || '',
          aantal: line.aantal || 1,
          prijs_per_eenheid: line.prijs_per_eenheid || 0,
          totaal: line.totaal || 0,
          raw_text: line.raw_text || '',
        })));
      }
    },
  });

  // Load PDF blob for iframe fallback
  useEffect(() => {
    let currentBlobUrl: string | null = null;

    const loadBlob = async () => {
      if (!id || !importData) return;
      try {
        const blob = await downloadImportFile(id);
        const url = URL.createObjectURL(blob);
        currentBlobUrl = url;
        setPdfBlobUrl(url);
      } catch (err) {
        console.error('Could not load PDF blob:', err);
      }
    };

    loadBlob();

    return () => {
      // Clean up blob URL on unmount using the correct reference
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  }, [importData?.id, id]);

  // Draw image on canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const image = imageRef.current;

    if (!canvas || !ctx || !image) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw OCR lines if available
    const page = importData?.extracted_data?.ocr_pages?.[currentPage];
    if (page?.lines) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.lineWidth = 1;
      
      for (const line of page.lines) {
        const scaleX = canvas.width / page.width;
        const scaleY = canvas.height / page.height;
        
        ctx.strokeRect(
          line.bbox.x * scaleX * zoom,
          line.bbox.y * scaleY * zoom,
          line.bbox.width * scaleX * zoom,
          line.bbox.height * scaleY * zoom
        );
      }
    }

    // Draw current selection
    if (selection) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.lineWidth = 2;
      
      const x = Math.min(selection.startX, selection.endX);
      const y = Math.min(selection.startY, selection.endY);
      const width = Math.abs(selection.endX - selection.startX);
      const height = Math.abs(selection.endY - selection.startY);
      
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
    }
  }, [importData, currentPage, zoom, selection]);

  // Load page image and auto-fit to container
  useEffect(() => {
    // Reset error state when page changes
    setImageLoadError(false);
    let imageBlobUrl: string | null = null;
    
    const page = importData?.extracted_data?.ocr_pages?.[currentPage];
    if (page?.image_path) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Help with CORS
      img.onload = () => {
        imageRef.current = img;
        setImageLoadError(false);
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (canvas && container) {
          // Calculate scale to fit container (with some padding)
          const containerWidth = container.clientWidth - 32; // 16px padding each side
          const containerHeight = container.clientHeight - 32;
          const scaleX = containerWidth / img.width;
          const scaleY = containerHeight / img.height;
          const fitScale = Math.min(scaleX, scaleY, 1.5); // Max 150%
          setBaseScale(fitScale);
          
          // Apply both base scale and manual zoom
          const totalScale = fitScale * zoom;
          canvas.width = img.width * totalScale;
          canvas.height = img.height * totalScale;
          drawCanvas();
        }
      };
      img.onerror = () => {
        console.log('Image load failed, showing PDF fallback');
        setImageLoadError(true);
        imageRef.current = null;
      };
      // Use authenticated API endpoint for page images
      const imageUrl = getImportPageImageUrl(id!, currentPage);
      // Add auth token for image loading
      const accessToken = useAuthStore.getState().accessToken;
      if (accessToken) {
        // Fetch image through API with auth header, then create object URL
        fetch(imageUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
          .then(res => {
            if (!res.ok) throw new Error('Image fetch failed');
            return res.blob();
          })
          .then(blob => {
            const url = URL.createObjectURL(blob);
            imageBlobUrl = url;
            img.src = url;
          })
          .catch(() => {
            console.log('Image fetch failed, showing PDF fallback');
            setImageLoadError(true);
            imageRef.current = null;
          });
      } else {
        img.src = imageUrl;
      }
    } else {
      // No image path available, show PDF fallback
      console.log('No image path, showing PDF fallback');
      setImageLoadError(true);
    }

    return () => {
      // Clean up image blob URL when page changes or component unmounts
      if (imageBlobUrl) {
        URL.revokeObjectURL(imageBlobUrl);
      }
    };
  }, [importData, currentPage, zoom, drawCanvas]);

  // Canvas event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editingField) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    setIsSelecting(true);
    setSelection({
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      endX: e.clientX - rect.left,
      endY: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !selection) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    setSelection({
      ...selection,
      endX: e.clientX - rect.left,
      endY: e.clientY - rect.top,
    });
    
    drawCanvas();
  };

  const handleMouseUp = async () => {
    if (!isSelecting || !selection || !editingField) return;
    
    setIsSelecting(false);
    
    const page = importData?.extracted_data?.ocr_pages?.[currentPage];
    if (!page) return;
    
    // Convert canvas coordinates to image coordinates
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const scaleX = page.width / canvas.width;
    const scaleY = page.height / canvas.height;
    
    const region: BoundingBox = {
      page: currentPage,
      x: Math.min(selection.startX, selection.endX) * scaleX,
      y: Math.min(selection.startY, selection.endY) * scaleY,
      width: Math.abs(selection.endX - selection.startX) * scaleX,
      height: Math.abs(selection.endY - selection.startY) * scaleY,
    };
    
    // Extract text from region
    try {
      const result = await regionMutation.mutateAsync({
        page: region.page,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      });
      
      // Update corrections with the extracted text and region
      setCorrections(prev => ({
        ...prev,
        [editingField]: { value: result.text, region },
      }));
      setExtractedValues(prev => ({
        ...prev,
        [editingField]: result.text,
      }));
      
      setEditingField(null);
      setSelection(null);
    } catch (err) {
      console.error('Failed to extract text from region:', err);
    }
  };

  const handleSaveCorrections = () => {
    if (Object.keys(corrections).length > 0) {
      correctionMutation.mutate({ corrections });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !importData) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 bg-red-50 rounded-lg text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="mt-4 text-lg font-medium text-red-800">{t('imports.importNotFound', 'Import niet gevonden')}</h2>
        <button
          onClick={() => navigate('/imports')}
          className="mt-4 text-sm text-red-600 hover:text-red-800"
        >
          {t('imports.backToOverview', 'Terug naar overzicht')}
        </button>
      </div>
    );
  }

  const totalPages = importData.extracted_data?.ocr_pages?.length || 1;

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/imports')}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{importData.file_name}</h1>
              <p className="text-sm text-gray-500">
                {importData.pattern_name ? `${t('imports.pattern', 'Patroon')}: ${importData.pattern_name}` : t('imports.noPatternRecognized', 'Geen patroon herkend')}
                {importData.ocr_confidence !== undefined && (
                  <span className="ml-2">
                    • OCR: {(importData.ocr_confidence * 100).toFixed(0)}%
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {Object.keys(corrections).length > 0 && (
              <button
                onClick={handleSaveCorrections}
                disabled={correctionMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
              >
                {correctionMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t('imports.saveCorrections', 'Correcties Opslaan')}
              </button>
            )}
            
            <button
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              {convertMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              {t('imports.saveAsInvoice', 'Opslaan als Factuur')}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Grid Layout */}
      <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* Document Preview - Left Column */}
        <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
          {/* Preview Toolbar */}
          <div className="bg-gray-800 px-4 py-2 flex items-center justify-between text-white text-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="p-1 hover:bg-gray-700 rounded disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-1 hover:bg-gray-700 rounded disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(baseScale * zoom * 100)}%</span>
              <button
                onClick={() => setZoom(Math.min(2, zoom + 0.25))}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom(1.0)}
                className="p-1 hover:bg-gray-700 rounded ml-1"
                title="Fit to window"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Canvas Container - Full Height */}
          <div ref={containerRef} className="flex-1 min-h-[750px] overflow-auto bg-gray-100 p-4 flex items-center justify-center">
            {importData.status === 'processing' ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p className="text-sm">{t('imports.statusProcessing', 'Verwerken...')}</p>
              </div>
            ) : imageLoadError && pdfBlobUrl ? (
              // Fallback to PDF embed when OCR image is not available
              <iframe
                src={pdfBlobUrl}
                className="w-full h-full min-h-[700px] bg-white"
                title="PDF Preview"
              />
            ) : imageLoadError ? (
              // Still loading PDF blob or no preview available
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p className="text-sm">{t('imports.loadingPreview', 'Preview laden...')}</p>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className={`bg-white shadow-lg mx-auto ${editingField ? 'cursor-crosshair' : 'cursor-default'}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            )}
          </div>

          {/* Selection Mode Indicator */}
          {editingField && (
            <div className="bg-blue-600 text-white px-4 py-2 text-center text-xs">
              <MousePointer2 className="w-3 h-3 inline mr-1" />
              {t('imports.selectOnDocument', 'Selecteer "{{field}}" op document', { field: fieldLabels[editingField] })}
              <button
                onClick={() => {
                  setEditingField(null);
                  setSelection(null);
                }}
                className="ml-3 underline hover:no-underline"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>

        {/* Right Column - Form & Data */}
        <div className="lg:col-span-5 space-y-4">
          {/* Invoice Type Selection */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('imports.documentType', 'Type Document')}</h3>
            <div className="grid grid-cols-3 gap-3">
              {invoiceTypes.map((type) => {
                const Icon = type.icon;
                const isSelected = selectedInvoiceType === type.value;
                return (
                  <button
                    key={type.value}
                    onClick={() => setSelectedInvoiceType(type.value)}
                    className={`p-3 rounded-lg border-2 transition-all text-left ${
                      isSelected
                        ? type.color === 'blue' 
                          ? 'border-blue-500 bg-blue-50' 
                          : type.color === 'green'
                          ? 'border-green-500 bg-green-50'
                          : 'border-orange-500 bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Icon className={`w-5 h-5 mb-1 ${
                      isSelected
                        ? type.color === 'blue' 
                          ? 'text-blue-600' 
                          : type.color === 'green'
                          ? 'text-green-600'
                          : 'text-orange-600'
                        : 'text-gray-400'
                    }`} />
                    <div className="font-medium text-sm text-gray-900">{type.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{type.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Company Selection */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('imports.company', 'Bedrijf')}</h3>
            <select
              value={selectedBedrijfId || ''}
              onChange={(e) => setSelectedBedrijfId(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">{t('imports.autoCreateCompany', 'Automatisch aanmaken vanuit leverancier')}</option>
              {companiesData?.map((company: { id: string; naam: string }) => (
                <option key={company.id} value={company.id}>{company.naam}</option>
              ))}
            </select>
          </div>

          {/* Template Selection */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('imports.template', 'Template')}</h3>
            <select
              value={selectedTemplateId || ''}
              onChange={(e) => setSelectedTemplateId(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">{t('imports.noTemplate', 'Geen template')}</option>
              {templatesData?.results?.map((tmpl: { id: string; naam: string }) => (
                <option key={tmpl.id} value={tmpl.id}>{tmpl.naam}</option>
              ))}
            </select>
          </div>

          {/* Extracted Fields - Compact Grid */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">{t('imports.extractedData', 'Geëxtraheerde Gegevens')}</h3>
              <p className="text-xs text-gray-500">{t('imports.clickToSelectField', 'Klik op ✏️ om veld te selecteren')}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(fieldLabels).map(([key, label]) => {
                const value = extractedValues[key];
                const hasCorrection = key in corrections;
                
                return (
                  <div
                    key={key}
                    className={`relative ${hasCorrection ? 'ring-2 ring-blue-200 rounded-lg' : ''}`}
                  >
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {label}
                      {hasCorrection && <span className="text-blue-600 ml-1">✓</span>}
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={(value as string) || ''}
                        onChange={(e) => {
                          setExtractedValues(prev => ({ ...prev, [key]: e.target.value }));
                          setCorrections(prev => ({ ...prev, [key]: { value: e.target.value } }));
                        }}
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder={`${label}...`}
                      />
                      <button
                        onClick={() => setEditingField(editingField === key ? null : key)}
                        className={`p-1.5 rounded border transition-colors ${
                          editingField === key 
                            ? 'bg-blue-100 border-blue-300 text-blue-600' 
                            : 'border-gray-300 text-gray-400 hover:bg-gray-50'
                        }`}
                        title="Selecteer op document"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Line Items - Editable */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('invoices.lines', 'Factuurregels')} ({editableLines.length})
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => reextractMutation.mutate()}
                  disabled={reextractMutation.isPending}
                  className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 flex items-center gap-1 disabled:opacity-50"
                  title="Factuurregels opnieuw uitlezen uit OCR tekst"
                >
                  {reextractMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  {t('imports.reextractLines', 'Opnieuw uitlezen')}
                </button>
                <button
                  onClick={() => {
                    const newLine = {
                      id: `new-${Date.now()}`,
                      omschrijving: '',
                      aantal: 1,
                      prijs_per_eenheid: 0,
                      totaal: 0,
                      raw_text: '',
                    };
                    setEditableLines(prev => [...prev, newLine]);
                  }}
                  className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                >
                  + {t('invoices.addLine', 'Regel toevoegen')}
                </button>
              </div>
            </div>
            
            {editableLines.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-auto">
                {editableLines.map((line, index) => (
                  <div key={line.id} className="p-2 bg-gray-50 rounded-lg border">
                    <div className="grid grid-cols-12 gap-2 items-center text-sm">
                      <div className="col-span-5">
                        <input
                          type="text"
                          value={line.omschrijving || ''}
                          onChange={(e) => updateLine(index, 'omschrijving', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Omschrijving"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={line.aantal || ''}
                          onChange={(e) => updateLine(index, 'aantal', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right"
                          placeholder="Aantal"
                          step="0.01"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={line.prijs_per_eenheid || ''}
                          onChange={(e) => updateLine(index, 'prijs_per_eenheid', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right"
                          placeholder="Prijs"
                          step="0.01"
                        />
                      </div>
                      <div className="col-span-2">
                        <span className="block px-2 py-1 bg-white border border-gray-200 rounded text-sm text-right font-medium">
                          € {((line.aantal || 0) * (line.prijs_per_eenheid || 0)).toFixed(2)}
                        </span>
                      </div>
                      <div className="col-span-1">
                        <button
                          onClick={() => removeLine(index)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                          title={t('common.delete')}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {line.raw_text && (
                      <div className="mt-1 text-xs text-gray-400 truncate">
                        OCR: {line.raw_text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">{t('imports.noLinesFound', "Geen factuurregels gevonden. Klik op '+ Regel toevoegen' om handmatig toe te voegen.")}</p>
            )}
          </div>

          {/* Raw OCR Text (Collapsible) */}
          <details className="bg-white rounded-xl shadow-sm border">
            <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50 font-medium text-sm text-gray-700">
              <FileText className="w-4 h-4 inline mr-2" />
              {t('imports.rawOcrText', 'Ruwe OCR Tekst')}
            </summary>
            <div className="px-4 pb-4">
              <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg max-h-48 overflow-auto">
                {importData.ocr_text || t('imports.noTextAvailable', 'Geen tekst beschikbaar')}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};

export default InvoiceImportDetailPage;
