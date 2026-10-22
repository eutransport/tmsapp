import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowTopRightOnSquareIcon,
  BuildingOffice2Icon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { Link, useNavigate } from 'react-router-dom'
import Pagination, { PageSize } from '@/components/common/Pagination'
import { KlantInvoer, OpdrachtKlant, portaalKlanten, portaalOpdrachten } from '@/api/opdrachten'
import OpdrachtStatusBadge from '@/components/opdrachten/OpdrachtStatusBadge'

const LEEG: KlantInvoer = {
  naam: '', adres: '', postcode: '', plaats: '',
  contactpersoon: '', telefoon: '', notitie: '', geopend_tot: '',
}

const ORDERS_PER_PAGINA = 10 as PageSize

export default function PortaalKlantenPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [zoek, setZoek] = useState('')
  const [zoekterm, setZoekterm] = useState('')
  const [bewerken, setBewerken] = useState<OpdrachtKlant | null>(null)
  const [formulierOpen, setFormulierOpen] = useState(false)
  const [waarden, setWaarden] = useState<KlantInvoer>(LEEG)
  const [ordersVan, setOrdersVan] = useState<OpdrachtKlant | null>(null)
  const [orderPage, setOrderPage] = useState(1)
  const [orderZoek, setOrderZoek] = useState('')
  const [orderTerm, setOrderTerm] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => { setOrderTerm(orderZoek.trim()); setOrderPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [orderZoek])

  useEffect(() => {
    const timer = setTimeout(() => { setZoekterm(zoek.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [zoek])

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-klanten', page, pageSize, zoekterm],
    queryFn: () => portaalKlanten.lijst({ page, page_size: pageSize, search: zoekterm }),
  })

  const klanten = data?.results || []
  const totaal = data?.count || 0
  const totalPages = Math.max(1, Math.ceil(totaal / pageSize))

  const ververs = () => queryClient.invalidateQueries({ queryKey: ['portaal-klanten'] })

  const { data: orders, isLoading: ordersLaden } = useQuery({
    queryKey: ['portaal-klant-orders', ordersVan?.naam, orderPage, orderTerm],
    queryFn: () => portaalOpdrachten.lijst({
      klant: ordersVan!.naam, page: orderPage, page_size: ORDERS_PER_PAGINA, search: orderTerm,
    }),
    enabled: !!ordersVan,
  })

  const ordersOpenen = (klant: OpdrachtKlant) => {
    setOrdersVan(klant)
    setOrderPage(1)
    setOrderZoek('')
    setOrderTerm('')
  }

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : '-'

  const opslaan = useMutation({
    mutationFn: (invoer: KlantInvoer) => {
      const data = { ...invoer, geopend_tot: invoer.geopend_tot || null }
      return bewerken
        ? portaalKlanten.bijwerken(bewerken.id, data)
        : portaalKlanten.aanmaken(data)
    },
    onSuccess: () => {
      toast.success(t('common.saved', 'Opgeslagen'))
      setFormulierOpen(false)
      setBewerken(null)
      ververs()
    },
    onError: () => toast.error(t('common.saveError', 'Opslaan mislukt')),
  })

  const verwijderen = useMutation({
    mutationFn: portaalKlanten.verwijderen,
    onSuccess: () => { toast.success(t('common.deleted', 'Verwijderd')); ververs() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const openen = (klant: OpdrachtKlant | null) => {
    setBewerken(klant)
    setWaarden(klant
      ? {
          naam: klant.naam, adres: klant.adres, postcode: klant.postcode,
          plaats: klant.plaats, contactpersoon: klant.contactpersoon,
          telefoon: klant.telefoon, notitie: klant.notitie,
          geopend_tot: klant.geopend_tot?.slice(0, 5) || '',
        }
      : LEEG)
    setFormulierOpen(true)
  }

  const zet = (sleutel: keyof KlantInvoer, waarde: string) =>
    setWaarden(vorig => ({ ...vorig, [sleutel]: waarde }))

  const ingeklapt = localStorage.getItem('tms.sidebar.collapsed') === 'true'

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('customers.title', 'Mijn klanten')}</h1>
          <p className="text-sm text-muted">
            {t('customers.subtitle', 'Adresboek dat automatisch wordt gevuld vanuit uw opdrachten.')}
          </p>
        </div>
        <button onClick={() => openen(null)} className="btn-primary">
          <PlusIcon className="h-5 w-5" />
          {t('customers.new', 'Nieuwe klant')}
        </button>
      </div>

      <div className="relative mb-4 max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={zoek}
          onChange={e => setZoek(e.target.value)}
          placeholder={t('common.search', 'Zoeken...')}
          className="input-field pl-9"
        />
      </div>

      <div className="card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : klanten.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('customers.empty', 'Nog geen klanten.')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {klanten.map(k => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <BuildingOffice2Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <span className="truncate font-semibold text-gray-900">{k.naam}</span>
                  <p className="truncate text-xs text-gray-500">
                    {[k.adres, k.postcode, k.plaats].filter(Boolean).join(', ') || '-'}
                  </p>
                </div>

                <div className="hidden min-w-0 flex-1 text-xs text-gray-500 md:block">
                  <span className="truncate">{k.contactpersoon || '-'}</span>
                  {k.telefoon && <span className="ml-3">{k.telefoon}</span>}
                </div>

                <span className="hidden w-24 shrink-0 text-xs text-gray-500 lg:inline">
                  {k.geopend_tot ? `${t('orders.openUntil', 'Geopend tot')} ${k.geopend_tot.slice(0, 5)}` : ''}
                </span>

                <button
                  onClick={() => ordersOpenen(k)}
                  className="chip chip-primary shrink-0 hover:brightness-95"
                  title={t('customers.showOrders', 'Opdrachten bekijken')}
                >
                  {k.aantal_opdrachten} {t('customers.orders', 'opdrachten')}
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => openen(k)}
                    className="rounded-md bg-primary-50 p-1.5 text-primary-700 hover:bg-primary-100"
                    title={t('common.edit', 'Bewerken')}>
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => {
                    if (window.confirm(t('customers.confirmDelete', 'Deze klant verwijderen?'))) verwijderen.mutate(k.id)
                  }}
                    className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                    title={t('common.delete', 'Verwijderen')}>
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totaal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={grootte => { setPageSize(grootte); setPage(1) }}
        />
      </div>

      {formulierOpen && (
        <div className={`modal-overlay ${ingeklapt ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
          <form
            onSubmit={e => { e.preventDefault(); if (waarden.naam.trim()) opslaan.mutate(waarden) }}
            className="modal-panel flex max-h-[90vh] w-full flex-col sm:max-w-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {bewerken ? t('customers.edit', 'Klant bewerken') : t('customers.new', 'Nieuwe klant')}
              </h2>
              <button type="button" onClick={() => setFormulierOpen(false)} className="btn-icon text-gray-400 hover:text-gray-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6">
                <div className="sm:col-span-6">
                  <label className="label">{t('orders.customerName', 'Bedrijfsnaam')}</label>
                  <input value={waarden.naam} onChange={e => zet('naam', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-3">
                  <label className="label">{t('orders.address', 'Adres')}</label>
                  <input value={waarden.adres} onChange={e => zet('adres', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-1">
                  <label className="label">{t('orders.postcode', 'Postcode')}</label>
                  <input value={waarden.postcode} onChange={e => zet('postcode', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('orders.city', 'Plaats')}</label>
                  <input value={waarden.plaats} onChange={e => zet('plaats', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('orders.contact', 'Contactpersoon')}</label>
                  <input value={waarden.contactpersoon} onChange={e => zet('contactpersoon', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('orders.phone', 'Telefoonnummer')}</label>
                  <input value={waarden.telefoon} onChange={e => zet('telefoon', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">{t('orders.openUntil', 'Geopend tot')}</label>
                  <input type="time" lang="nl-NL" step={300} value={waarden.geopend_tot || ''}
                    onChange={e => zet('geopend_tot', e.target.value)} className="input-field" />
                </div>
                <div className="sm:col-span-6">
                  <label className="label">{t('orders.note', 'Notitie')}</label>
                  <textarea rows={3} value={waarden.notitie} onChange={e => zet('notitie', e.target.value)} className="input-field" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button type="button" onClick={() => setFormulierOpen(false)} className="btn-secondary">
                {t('common.cancel', 'Annuleren')}
              </button>
              <button type="submit" disabled={opslaan.isPending} className="btn-primary">
                {t('common.save', 'Opslaan')}
              </button>
            </div>
          </form>
        </div>
      )}
      {ordersVan && (
        <div className={`modal-overlay ${ingeklapt ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
          <div className="modal-panel flex max-h-[85vh] w-full flex-col sm:max-w-4xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-gray-900">{ordersVan.naam}</h2>
                <p className="text-sm text-muted">
                  {t('customers.ordersFor', 'Opdrachten voor deze klant')}
                </p>
              </div>
              <button onClick={() => setOrdersVan(null)} className="btn-icon text-gray-400 hover:text-gray-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-6 py-3">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={orderZoek}
                  onChange={e => setOrderZoek(e.target.value)}
                  placeholder={t('common.search', 'Zoeken...')}
                  className="input-field pl-9"
                />
              </div>
              <Link
                to={`/portaal/opdrachten?klant=${encodeURIComponent(ordersVan.naam)}`}
                className="btn-secondary shrink-0"
              >
                {t('customers.openInOrders', 'In opdrachtenoverzicht')}
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </Link>
            </div>

            <div className="flex-1 overflow-auto">
              {ordersLaden ? (
                <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
              ) : !orders?.results.length ? (
                <p className="p-6 text-sm text-muted">{t('customers.noOrders', 'Nog geen opdrachten voor deze klant.')}</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5">{t('orders.tripNumber', 'Ritnummer')}</th>
                      <th className="px-4 py-2.5">{t('orders.driver', 'Chauffeur')}</th>
                      <th className="hidden px-4 py-2.5 md:table-cell">{t('orders.address', 'Adres')}</th>
                      <th className="px-4 py-2.5">{t('common.status', 'Status')}</th>
                      <th className="px-4 py-2.5">{t('orders.created', 'Aangemaakt')}</th>
                      <th className="px-4 py-2.5">{t('orders.moment', 'Moment')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orders.results.map(o => (
                      <tr
                        key={o.id}
                        onClick={() => navigate(`/portaal/opdrachten?search=${encodeURIComponent(o.ritnummer || o.klant_naam)}`)}
                        className="cursor-pointer align-top hover:bg-primary-50/60"
                      >
                        <td className="px-4 py-2 font-mono text-xs">{o.ritnummer || '-'}</td>
                        <td className="px-4 py-2">{o.chauffeur_naam || '-'}</td>
                        <td className="hidden px-4 py-2 text-xs text-gray-500 md:table-cell">
                          {[o.adres, o.postcode, o.plaats].filter(Boolean).join(', ') || '-'}
                        </td>
                        <td className="px-4 py-2">
                          <OpdrachtStatusBadge status={o.status} label={o.status_label} />
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{tijd(o.created_at)}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {tijd(o.afgeleverd_op || o.niet_geleverd_op || o.gestart_op)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <Pagination
              currentPage={orderPage}
              totalPages={Math.max(1, Math.ceil((orders?.count || 0) / ORDERS_PER_PAGINA))}
              totalCount={orders?.count || 0}
              pageSize={ORDERS_PER_PAGINA}
              onPageChange={setOrderPage}
              onPageSizeChange={() => {}}
              showPageSizeSelector={false}
            />

            <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-3">
              <button onClick={() => setOrdersVan(null)} className="btn-secondary">
                {t('common.close', 'Sluiten')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
