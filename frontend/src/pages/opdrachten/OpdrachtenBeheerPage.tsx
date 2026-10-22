import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Pagination, { PageSize } from '@/components/common/Pagination'
import OpdrachtStatusBadge from '@/components/opdrachten/OpdrachtStatusBadge'
import { beheerOpdrachten } from '@/api/opdrachten'
import { getAllCompanies } from '@/api/companies'
import { Company } from '@/types'

export default function OpdrachtenBeheerPage() {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [bedrijf, setBedrijf] = useState('')
  const [status, setStatus] = useState('')
  const [zoek, setZoek] = useState('')

  const filters = { page, page_size: pageSize, bedrijf, status, search: zoek }

  const { data, isLoading } = useQuery({
    queryKey: ['beheer-opdrachten', filters],
    queryFn: () => beheerOpdrachten.lijst(filters),
  })

  const { data: bedrijven = [] } = useQuery<Company[]>({
    queryKey: ['companies-all'],
    queryFn: getAllCompanies,
  })

  const opdrachten = data?.results || []
  const totaal = data?.count || 0

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : '-'

  return (
    <div className="space-y-4">
      <h1 className="page-title">
        {t('orders.adminTitle', 'Opdrachten opdrachtgevers')}
      </h1>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <input
          type="search"
          value={zoek}
          onChange={e => { setZoek(e.target.value); setPage(1) }}
          placeholder={t('common.search', 'Zoeken')}
          className="input-field"
        />
        <select value={bedrijf} onChange={e => { setBedrijf(e.target.value); setPage(1) }}
          className="input-field">
          <option value="">{t('orders.allClients', 'Alle opdrachtgevers')}</option>
          {bedrijven.map(b => <option key={b.id} value={b.id}>{b.naam}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="input-field">
          <option value="">{t('orders.allStatuses', 'Alle statussen')}</option>
          <option value="nieuw">{t('orders.statusNew', 'Nieuw')}</option>
          <option value="gestart">{t('orders.statusStarted', 'Onderweg')}</option>
          <option value="afgeleverd">{t('orders.statusDelivered', 'Afgeleverd')}</option>
          <option value="ingetrokken">{t('orders.statusWithdrawn', 'Ingetrokken')}</option>
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : opdrachten.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('orders.empty', 'Nog geen opdrachten.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('orders.client', 'Opdrachtgever')}</th>
                  <th className="px-4 py-3">{t('orders.customerName', 'Bedrijfsnaam')}</th>
                  <th className="px-4 py-3">{t('orders.city', 'Plaats')}</th>
                  <th className="px-4 py-3">{t('orders.driver', 'Chauffeur')}</th>
                  <th className="px-4 py-3">{t('common.status', 'Status')}</th>
                  <th className="px-4 py-3">{t('orders.deliveredAt', 'Aflevermoment')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {opdrachten.map(o => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{o.bedrijf_naam}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{o.klant_naam}</td>
                    <td className="px-4 py-3 text-gray-700">{o.plaats}</td>
                    <td className="px-4 py-3 text-gray-700">{o.chauffeur_naam}</td>
                    <td className="px-4 py-3"><OpdrachtStatusBadge status={o.status} label={o.status_label} /></td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">{tijd(o.afgeleverd_op)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(totaal / pageSize))}
          totalCount={totaal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={size => { setPageSize(size); setPage(1) }}
        />
      </div>
    </div>
  )
}
