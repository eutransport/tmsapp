import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowDownIcon,
  ArrowDownTrayIcon,
  ArrowUpIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import Pagination, { PageSize } from '@/components/common/Pagination'
import {
  BIJLAGE_ACCEPT,
  ChauffeurKeuze,
  Opdracht,
  OpdrachtEta,
  OpdrachtInvoer,
  portaalOpdrachten,
} from '@/api/opdrachten'
import OpdrachtStatusBadge from '@/components/opdrachten/OpdrachtStatusBadge'
import EtaBalk from '@/components/opdrachten/EtaBalk'
import OpdrachtFormulier from '@/components/opdrachten/OpdrachtFormulier'
import MailInstellingModal from '@/components/opdrachten/MailInstellingModal'
import OpdrachtNotitieModal from '@/components/opdrachten/OpdrachtNotitieModal'

export default function PortaalOpdrachtenPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [zoekParams, setZoekParams] = useSearchParams()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(30)
  const [chauffeurFilter, setChauffeurFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(zoekParams.get('status') || '')
  const [zoek, setZoek] = useState('')
  const [formulierOpen, setFormulierOpen] = useState(false)
  const [bewerken, setBewerken] = useState<Opdracht | null>(null)
  const [mailOpen, setMailOpen] = useState(false)
  const [notitieId, setNotitieId] = useState<string | null>(null)
  const [verwijderDoel, setVerwijderDoel] = useState<Opdracht | null>(null)
  // De lijst ververst elke vijftien seconden; een invoerveld in een rij overleeft
  // het openstaande bestandsvenster niet, daarom staat het hier los van de lijst.
  const bijlageDoel = useRef<string | null>(null)
  const bijlageKiezer = useRef<HTMLInputElement>(null)

  const vandaagFilter = zoekParams.get('vandaag') || ''
  const openFilter = zoekParams.get('open') || ''
  const klantFilter = zoekParams.get('klant') || ''

  // Het scherm wordt vanaf het dashboard en het klantenoverzicht voorgefilterd.
  useEffect(() => {
    setStatusFilter(zoekParams.get('status') || '')
    setPage(1)
  }, [zoekParams])

  const wisUrlFilters = () => setZoekParams({})

  const filters = {
    page, page_size: pageSize, chauffeur: chauffeurFilter, status: statusFilter, search: zoek,
    vandaag: vandaagFilter, open: openFilter, klant: klantFilter,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-opdrachten', filters],
    queryFn: () => portaalOpdrachten.lijst(filters),
    // De chauffeur werkt de status bij; zonder pollen loopt dit scherm achter.
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  })

  // De server rekent hooguit eens per tien minuten opnieuw; vaker pollen heeft geen zin.
  const { data: etas = [] } = useQuery<OpdrachtEta[]>({
    queryKey: ['portaal-opdracht-eta'],
    queryFn: portaalOpdrachten.eta,
    refetchInterval: 600000,
    refetchIntervalInBackground: true,
  })
  const etaPer = Object.fromEntries(etas.map(e => [e.id, e]))

  const { data: chauffeurs = [] } = useQuery<ChauffeurKeuze[]>({
    queryKey: ['portaal-chauffeurs'],
    queryFn: portaalOpdrachten.chauffeurs,
  })

  const opdrachten = data?.results || []
  // Uit de lijst halen, zodat het pollen de open notitie meteen bijwerkt.
  const notitieVan = opdrachten.find(o => o.id === notitieId) || null
  const totaal = data?.count || 0
  const totalPages = Math.max(1, Math.ceil(totaal / pageSize))

  const ververs = () => queryClient.invalidateQueries({ queryKey: ['portaal-opdrachten'] })

  const opslaan = useMutation({
    mutationFn: async ({ invoer, bijlagen }: { invoer: OpdrachtInvoer; bijlagen: File[] }) => {
      const opdracht = bewerken
        ? await portaalOpdrachten.bijwerken(bewerken.id, invoer)
        : await portaalOpdrachten.aanmaken(invoer)
      for (const bestand of bijlagen) {
        await portaalOpdrachten.bijlageToevoegen(opdracht.id, bestand)
      }
      return opdracht
    },
    onSuccess: () => {
      toast.success(t('common.saved', 'Opgeslagen'))
      setFormulierOpen(false)
      setBewerken(null)
      ververs()
    },
    onError: (fout: any) => {
      const data = fout?.response?.data
      const eerste = data && typeof data === 'object'
        ? Object.values(data).flat()[0]
        : null
      toast.error(String(eerste || t('common.saveError', 'Opslaan mislukt')))
    },
  })

  const mailOpnieuw = useMutation({
    mutationFn: portaalOpdrachten.mailOpnieuw,
    onSuccess: resultaat => {
      if (resultaat.verstuurd) toast.success(t('orders.mailResent', 'Melding opnieuw verstuurd'))
      else toast.error(resultaat.fout || t('common.error', 'Er ging iets mis'))
      ververs()
    },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const intrekken = useMutation({
    mutationFn: portaalOpdrachten.intrekken,
    onSuccess: () => { toast.success(t('orders.withdrawn', 'Opdracht ingetrokken')); ververs() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const verwijderen = useMutation({
    mutationFn: portaalOpdrachten.verwijderen,
    onSuccess: () => { toast.success(t('common.deleted', 'Verwijderd')); ververs() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const rangschikken = useMutation({
    mutationFn: portaalOpdrachten.rangschikken,
    onSuccess: ververs,
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const bijlage = useMutation({
    mutationFn: ({ id, bestand }: { id: string; bestand: File }) =>
      portaalOpdrachten.bijlageToevoegen(id, bestand),
    onSuccess: () => { toast.success(t('orders.attachmentAdded', 'Bijlage toegevoegd')); ververs() },
    onError: () => toast.error(t('orders.attachmentFailed', 'Bijlage uploaden mislukt')),
  })

  // Verschuiven werkt binnen de zichtbare pagina; de server hernummert de hele lijst.
  const verschuif = (index: number, richting: -1 | 1) => {
    const doel = index + richting
    if (doel < 0 || doel >= opdrachten.length) return
    const ids = opdrachten.map(o => o.id)
    ;[ids[index], ids[doel]] = [ids[doel], ids[index]]
    rangschikken.mutate(ids)
  }

  const kanAanpassen = (o: Opdracht) => o.status === 'nieuw' || o.status === 'gestart'

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : '-'

  const statusOpties = useMemo(
    () => [
      { waarde: 'nieuw', label: t('orders.statusNew', 'Nieuw') },
      { waarde: 'gestart', label: t('orders.statusStarted', 'Onderweg') },
      { waarde: 'afgeleverd', label: t('orders.statusDelivered', 'Afgeleverd') },
      { waarde: 'niet_geleverd', label: t('orders.statusNotDelivered', 'Niet geleverd') },
      { waarde: 'ingetrokken', label: t('orders.statusWithdrawn', 'Ingetrokken') },
    ],
    [t]
  )

  return (
    <div className="space-y-4">
      <input
        ref={bijlageKiezer}
        type="file"
        accept={BIJLAGE_ACCEPT}
        className="sr-only"
        onChange={e => {
          const bestand = e.target.files?.[0]
          const id = bijlageDoel.current
          if (bestand && id) bijlage.mutate({ id, bestand })
          e.target.value = ''
          bijlageDoel.current = null
        }}
      />
      <div className="page-header">
        <h1 className="page-title">
          {t('orders.title', 'Opdrachten')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMailOpen(true)} className="btn-secondary">
            <EnvelopeIcon className="h-5 w-5" />
            {t('orders.mailSettings', 'Mailmeldingen')}
          </button>
          <button
            onClick={() => { setBewerken(null); setFormulierOpen(true) }}
            className="btn-primary"
          >
            <PlusIcon className="h-5 w-5" />
            {t('orders.new', 'Nieuwe opdracht')}
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <input
          type="search"
          value={zoek}
          onChange={e => { setZoek(e.target.value); setPage(1) }}
          placeholder={t('common.search', 'Zoeken')}
          className="input-field"
        />
        <select
          value={chauffeurFilter}
          onChange={e => { setChauffeurFilter(e.target.value); setPage(1) }}
          className="input-field"
        >
          <option value="">{t('orders.allDrivers', 'Alle chauffeurs')}</option>
          {chauffeurs.map(c => <option key={c.id} value={c.id}>{c.naam}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="input-field"
        >
          <option value="">{t('orders.allStatuses', 'Alle statussen')}</option>
          {statusOpties.map(o => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}
        </select>
      </div>

      {(vandaagFilter || openFilter || klantFilter) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800">
          <span className="font-medium">{t('orders.activeFilter', 'Actief filter')}:</span>
          {vandaagFilter === 'aangemaakt' && <span>{t('portaalDash.createdToday', 'Opdrachten vandaag')}</span>}
          {vandaagFilter === 'afgeleverd' && <span>{t('portaalDash.deliveredToday', 'Vandaag afgeleverd')}</span>}
          {openFilter === '1' && <span>{t('portaalDash.stillOpen', 'Nog open')}</span>}
          {klantFilter && <span>{klantFilter}</span>}
          <button onClick={wisUrlFilters} className="ml-auto inline-flex items-center gap-1 font-medium hover:underline">
            <XCircleIcon className="h-4 w-4" />
            {t('orders.clearFilter', 'Filter wissen')}
          </button>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : opdrachten.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('orders.empty', 'Nog geen opdrachten.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">{t('orders.tripNumber', 'Ritnummer')}</th>
                  <th className="px-4 py-2.5">{t('orders.customerName', 'Bedrijfsnaam')}</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">{t('orders.driver', 'Chauffeur')}</th>
                  <th className="px-4 py-2.5">{t('common.status', 'Status')}</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">{t('orders.moment', 'Moment')}</th>
                  <th className="px-4 py-2.5 text-right">{t('common.actions', 'Acties')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {opdrachten.map((o, index) => (
                  <tr key={o.id} className="align-top hover:bg-gray-50/70">
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                        {o.ritnummer || '-'}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{o.klant_naam}</div>
                      <div className="text-xs text-gray-500">
                        {[o.adres, o.postcode, o.plaats].filter(Boolean).join(', ') || '-'}
                      </div>
                      <div className="mt-1">
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {o.werk_omschrijving}
                        </span>
                      </div>
                      {o.regels.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {o.regels.map((r, i) => (
                            <li key={r.id || i} className="text-xs text-gray-600">
                              <span className="font-mono">{r.ordernummer || '-'}</span>
                              {r.omschrijving && ` - ${r.omschrijving}`}
                              {r.aantal_pallets !== null && (
                                <span className="font-semibold text-gray-800"> - {r.aantal_pallets} PLT</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {o.geopend_tot && (
                        <div className="text-xs text-gray-400">
                          {t('orders.openUntil', 'Geopend tot')} {o.geopend_tot.slice(0, 5)}
                        </div>
                      )}
                      {o.niet_geleverd_reden && (
                        <p className="mt-1 rounded bg-warning-50 px-2 py-1 text-xs text-warning-700">
                          {t('orders.reason', 'Reden')}: {o.niet_geleverd_reden}
                        </p>
                      )}
                      {o.laatste_mail_fout && (
                        <p className="mt-1 text-xs text-danger-600">
                          {t('orders.mailFailed', 'Mail niet verstuurd')}: {o.laatste_mail_fout}
                        </p>
                      )}
                      {o.bijlagen.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {o.bijlagen.map(b => (
                            <span key={b.id} className="chip gap-1">
                              <a href={b.url || '#'} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:opacity-80">
                                <PaperClipIcon className="h-3.5 w-3.5" />
                                {b.bestandsnaam}
                              </a>
                              {b.url && (
                                <a href={`${b.url}&dl=1&naam=${encodeURIComponent(b.bestandsnaam)}`} download
                                  title={t('orders.download', 'Downloaden')}
                                  className="text-gray-500 hover:text-primary-600">
                                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="hidden whitespace-nowrap px-4 py-3 lg:table-cell">
                      <div className="text-gray-900">{o.chauffeur_naam}</div>
                      {o.kenteken && <div className="text-xs text-gray-500">{o.kenteken}</div>}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <OpdrachtStatusBadge status={o.status} label={o.status_label} />
                      {o.status === 'gestart' && o.fase !== 'onderweg' && (
                        <div className="mt-1">
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            {o.fase_label}
                          </span>
                        </div>
                      )}
                      {o.status === 'gestart' && o.fase === 'onderweg' && (
                        <div className="mt-1.5"><EtaBalk eta={etaPer[o.id]} compact /></div>
                      )}
                    </td>

                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-gray-500 md:table-cell">
                      {o.afgeleverd_op
                        ? `${t('orders.deliveredAt', 'Aflevermoment')} ${tijd(o.afgeleverd_op)}`
                        : o.niet_geleverd_op
                          ? `${t('orders.notDeliveredAt', 'Gemeld')} ${tijd(o.niet_geleverd_op)}`
                          : '-'}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <button onClick={() => verschuif(index, -1)} disabled={index === 0}
                          className="rounded-md bg-gray-100 p-1.5 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                          title={t('orders.moveUp', 'Omhoog')}>
                          <ArrowUpIcon className="h-4 w-4" />
                        </button>
                        <button onClick={() => verschuif(index, 1)} disabled={index === opdrachten.length - 1}
                          className="rounded-md bg-gray-100 p-1.5 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                          title={t('orders.moveDown', 'Omlaag')}>
                          <ArrowDownIcon className="h-4 w-4" />
                        </button>
                        <button onClick={() => setNotitieId(o.id)}
                          className="relative rounded-md bg-sky-50 p-1.5 text-sky-700 hover:bg-sky-100"
                          title={t('orders.notes', 'Notities')}>
                          <ChatBubbleLeftRightIcon className="h-4 w-4" />
                          {(o.chauffeur_reactie || o.niet_geleverd_reden) && (
                            <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-sky-600" />
                          )}
                        </button>
                        {(o.status === 'afgeleverd' || o.status === 'niet_geleverd' || o.status === 'gestart') && (
                          <button onClick={() => mailOpnieuw.mutate(o.id)} disabled={mailOpnieuw.isPending}
                            className="rounded-md bg-indigo-50 p-1.5 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                            title={t('orders.resendMail', 'Melding opnieuw versturen')}>
                            <EnvelopeIcon className="h-4 w-4" />
                          </button>
                        )}
                        {o.status !== 'ingetrokken' && (
                          <button type="button"
                            onClick={() => { bijlageDoel.current = o.id; bijlageKiezer.current?.click() }}
                            className="rounded-md bg-teal-50 p-1.5 text-teal-700 hover:bg-teal-100"
                            title={t('orders.addAttachment', 'Bijlage toevoegen')}>
                            <PaperClipIcon className="h-4 w-4" />
                          </button>
                        )}
                        {kanAanpassen(o) && (
                          <>
                            <button onClick={() => { setBewerken(o); setFormulierOpen(true) }}
                              className="rounded-md bg-primary-50 p-1.5 text-primary-700 hover:bg-primary-100"
                              title={t('common.edit', 'Bewerken')}>
                              <PencilSquareIcon className="h-4 w-4" />
                            </button>
                            <button onClick={() => intrekken.mutate(o.id)}
                              className="rounded-md bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100"
                              title={t('orders.withdraw', 'Intrekken')}>
                              <XCircleIcon className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button onClick={() => setVerwijderDoel(o)}
                          className="rounded-md bg-red-50 p-1.5 text-red-700 hover:bg-red-100"
                          title={t('common.delete', 'Verwijderen')}>
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totaal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={size => { setPageSize(size); setPage(1) }}
        />
      </div>

      {formulierOpen && (
        <OpdrachtFormulier
          opdracht={bewerken}
          chauffeurs={chauffeurs}
          bezig={opslaan.isPending}
          onSluiten={() => { setFormulierOpen(false); setBewerken(null) }}
          onOpslaan={(invoer, bijlagen) => opslaan.mutate({ invoer, bijlagen })}
        />
      )}

      {mailOpen && <MailInstellingModal onSluiten={() => setMailOpen(false)} />}
      {notitieVan && (
        <OpdrachtNotitieModal opdracht={notitieVan} onSluiten={() => setNotitieId(null)} />
      )}

      {verwijderDoel && (
        <div className="modal-overlay" onClick={() => setVerwijderDoel(null)}>
          <div className="modal-panel w-full p-5 sm:max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="section-title">{t('orders.deleteTitle', 'Opdracht verwijderen')}</h2>
                <p className="mt-1 text-sm text-muted">
                  {t('orders.deleteBody', 'Weet u zeker dat u opdracht {{ritnummer}} voor {{klant}} wilt verwijderen?', {
                    ritnummer: verwijderDoel.ritnummer,
                    klant: verwijderDoel.klant_naam,
                  })}
                </p>
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {t('orders.deleteWarning', 'De opdracht en de bijlagen verdwijnen definitief. Dit kan niet ongedaan worden gemaakt.')}
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn btn-secondary" onClick={() => setVerwijderDoel(null)}>
                {t('common.cancel', 'Annuleren')}
              </button>
              <button
                className="btn btn-danger"
                disabled={verwijderen.isPending}
                onClick={() => { verwijderen.mutate(verwijderDoel.id); setVerwijderDoel(null) }}
              >
                <TrashIcon className="h-4 w-4" />
                {t('common.delete', 'Verwijderen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
