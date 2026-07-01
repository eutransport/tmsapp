import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { TimeEntry } from '@/types'
import { getKilometerheffingen, KilometerheffingFilters } from '@/api/timetracking'
import { useAuthStore } from '@/stores/authStore'

function formatBedrag(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return '-'
  return n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleDateString('nl-NL')
}

export default function KilometerheffingPage() {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const isAdmin = user?.rol === 'admin' || user?.rol === 'gebruiker'

  const currentYear = new Date().getFullYear()
  const [jaar, setJaar] = useState<number>(currentYear)
  const [ingediend, setIngediend] = useState<'all' | 'ja' | 'nee'>('all')
  const [gefactureerd, setGefactureerd] = useState<'all' | 'ja' | 'nee'>('all')
  const [datumVan, setDatumVan] = useState('')
  const [datumTot, setDatumTot] = useState('')
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const filters: KilometerheffingFilters = { jaar, ingediend, gefactureerd }
      if (datumVan) filters.datum__gte = datumVan
      if (datumTot) filters.datum__lte = datumTot
      const data = await getKilometerheffingen(filters)
      setEntries(data)
    } catch {
      toast.error('Fout bij laden van kilometerheffingen')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jaar, ingediend, gefactureerd, datumVan, datumTot])

  const totaal = useMemo(
    () => entries.reduce((sum, e) => sum + (parseFloat(String(e.kilometerheffing_bedrag ?? 0)) || 0), 0),
    [entries]
  )

  const years = Array.from({ length: 6 }, (_, i) => currentYear - i)

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title">
          {t('nav.kilometerheffing', 'Kilometerheffing')}
        </h1>
        <button
          type="button"
          onClick={load}
          className="btn btn-secondary flex items-center gap-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          {t('common.refresh', 'Vernieuwen')}
        </button>
      </div>

      <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Jaar</label>
          <select value={jaar} onChange={(e) => setJaar(parseInt(e.target.value))} className="input">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum van</label>
          <input type="date" value={datumVan} onChange={(e) => setDatumVan(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum tot</label>
          <input type="date" value={datumTot} onChange={(e) => setDatumTot(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ingediend</label>
          <select value={ingediend} onChange={(e) => setIngediend(e.target.value as 'all' | 'ja' | 'nee')} className="input">
            <option value="all">Alle</option>
            <option value="ja">Ja</option>
            <option value="nee">Nee</option>
          </select>
        </div>
        {isAdmin && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Gefactureerd</label>
            <select value={gefactureerd} onChange={(e) => setGefactureerd(e.target.value as 'all' | 'ja' | 'nee')} className="input">
              <option value="all">Alle</option>
              <option value="ja">Ja</option>
              <option value="nee">Nee</option>
            </select>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ritnummer</th>
                {isAdmin && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chauffeur</th>}
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Bedrag (€)</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Ingediend</th>
                {isAdmin && <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Gefactureerd</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && (
                <tr><td colSpan={isAdmin ? 7 : 5} className="px-4 py-6 text-center text-gray-500">Laden...</td></tr>
              )}
              {!loading && entries.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 5} className="px-4 py-6 text-center text-gray-500">Geen kilometerheffingen gevonden</td></tr>
              )}
              {!loading && entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900">{e.weeknummer}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{formatDate(e.datum)}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{e.ritnummer}</td>
                  {isAdmin && <td className="px-4 py-2 text-sm text-gray-900">{e.user_naam}</td>}
                  <td className="px-4 py-2 text-sm text-right font-mono text-gray-900">{formatBedrag(e.kilometerheffing_bedrag)}</td>
                  <td className="px-4 py-2 text-center">
                    {e.status === 'ingediend' ? (
                      <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800">Ja</span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">Nee</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-center">
                      {e.kilometerheffing_gefactureerd_at ? (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800">
                          {formatDate(e.kilometerheffing_gefactureerd_at)}
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">Nee</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={isAdmin ? 4 : 3} className="px-4 py-2 text-sm font-semibold text-gray-900 text-right">Totaal:</td>
                  <td className="px-4 py-2 text-sm text-right font-mono font-semibold text-gray-900">€ {formatBedrag(totaal)}</td>
                  <td colSpan={isAdmin ? 2 : 1}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
