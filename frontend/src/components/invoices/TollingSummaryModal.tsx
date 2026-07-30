import { useEffect, useState } from 'react'
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import {
  getTollingSummary,
  downloadTollingPdf,
  type TollingSummary,
} from '../../api/invoices'

interface Props {
  invoiceId: string
  invoiceNumber?: string
  onClose: () => void
}

function formatDateTimeNl(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}-${mm}-${yy} ${hh}:${mi}`
}

function fmtNumber(n: number, decimals = 2): string {
  return n.toLocaleString('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtEuro(n: number): string {
  return `€ ${fmtNumber(n)}`
}

export default function TollingSummaryModal({ invoiceId, invoiceNumber, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<TollingSummary | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await getTollingSummary(invoiceId)
        if (!cancelled) setSummary(data)
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Onbekende fout'
          setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  const handleDownload = async () => {
    try {
      setDownloading(true)
      await downloadTollingPdf(invoiceId, invoiceNumber)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Downloaden mislukt'
      setError(msg)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Toloverzicht</h2>
            {invoiceNumber && (
              <p className="text-xs text-gray-500">Factuur {invoiceNumber}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            title="Sluiten"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          {loading && (
            <div className="py-10 text-center text-sm text-gray-500">Laden…</div>
          )}

          {!loading && error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && summary && !summary.has_events && (
            <div className="py-10 text-center text-sm text-gray-500">
              Geen tolheffing-events gekoppeld aan deze factuur.
            </div>
          )}

          {!loading && !error && summary && summary.has_events && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b text-left text-xs font-semibold uppercase text-gray-600">
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Kenteken</th>
                  <th className="px-3 py-2 text-right">Km</th>
                  <th className="px-3 py-2 text-right">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {summary.events.map((ev) => (
                  <tr key={ev.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">
                      {formatDateTimeNl(ev.start_at)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                      {ev.license_plate || '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-900">{fmtNumber(ev.km)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-900">{fmtEuro(ev.kosten)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-gray-900" colSpan={2}>
                    Totaal ({summary.totals.count})
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900">
                    {fmtNumber(summary.totals.km)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900">
                    {fmtEuro(summary.totals.kosten)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-gray-50 px-5 py-3">
          <div className="text-xs text-gray-500">
            {summary?.has_events && (
              <>
                {summary.totals.count} event{summary.totals.count === 1 ? '' : 's'}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              Sluiten
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading || !summary?.has_events}
              className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {downloading ? 'Bezig…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
