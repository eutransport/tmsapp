import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'

export const PAGE_SIZE_OPTIONS = [30, 50, 100] as const
export type PageSize = typeof PAGE_SIZE_OPTIONS[number]

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: PageSize
  onPageChange: (page: number) => void
  onPageSizeChange: (size: PageSize) => void
  showPageSizeSelector?: boolean
}

export default function Pagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  showPageSizeSelector = true,
}: PaginationProps) {
  const { t } = useTranslation()

  if (totalCount === 0) return null

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalCount)

  return (
    <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
      {/* Left: Count info */}
      <div className="text-sm text-gray-500 flex flex-col xs:flex-row items-center gap-2 xs:gap-4 w-full sm:w-auto justify-center sm:justify-start">
        <span className="whitespace-nowrap">
          {startItem}-{endItem} {t('common.of')} {totalCount}
        </span>
        
        {showPageSizeSelector && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 hidden xs:inline">|</span>
            <label htmlFor="pageSize" className="text-gray-500 hidden sm:inline">{t('common.show')}:</label>
            <select
              id="pageSize"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
              className="text-sm border-gray-300 rounded-md shadow-sm focus:border-primary-500 focus:ring-primary-500 py-2 pl-3 pr-8 min-h-[44px]"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} {t('common.perPage')}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Pagination controls */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-2 min-w-[44px] min-h-[44px] text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
          title={t('common.firstPage')}
        >
          ««
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-2 min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
          title={t('common.previousPage')}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        
        {/* Mobile: Simple page indicator */}
        <span className="xs:hidden px-3 py-2 text-sm text-gray-600">
          {currentPage} / {totalPages}
        </span>
        
        {/* Desktop: Page numbers */}
        <div className="hidden xs:flex items-center gap-1">
          {generatePageNumbers(currentPage, totalPages).map((pageNum, idx) => (
            pageNum === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
            ) : (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum as number)}
                className={`min-w-[44px] min-h-[44px] px-3 py-2 text-sm rounded ${
                  pageNum === currentPage
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {pageNum}
              </button>
            )
          ))}
        </div>
        
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-2 min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
          title={t('common.nextPage')}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-2 min-w-[44px] min-h-[44px] text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed rounded hover:bg-gray-100"
          title={t('common.lastPage')}
        >
          »»
        </button>
      </div>
    </div>
  )
}

// Helper function to generate page numbers with ellipsis
function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  
  const pages: (number | '...')[] = []
  
  // Always show first page
  pages.push(1)
  
  if (current > 3) {
    pages.push('...')
  }
  
  // Show pages around current
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  
  for (let i = start; i <= end; i++) {
    if (!pages.includes(i)) {
      pages.push(i)
    }
  }
  
  if (current < total - 2) {
    pages.push('...')
  }
  
  // Always show last page
  if (!pages.includes(total)) {
    pages.push(total)
  }
  
  return pages
}
