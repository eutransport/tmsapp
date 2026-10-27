import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  PaperClipIcon,
  PhoneIcon,
  PlayIcon,
} from '@heroicons/react/24/outline'
import { BIJLAGE_ACCEPT, MijnOpdracht, OpdrachtEta, mijnOpdrachten } from '@/api/opdrachten'
import OpdrachtStatusBadge from '@/components/opdrachten/OpdrachtStatusBadge'
import EtaBalk from '@/components/opdrachten/EtaBalk'
import AfmeldModal from '@/components/opdrachten/AfmeldModal'
import NietGeleverdModal from '@/components/opdrachten/NietGeleverdModal'
import Pagination, { PageSize } from '@/components/common/Pagination'

const PER_PAGINA = 10 as PageSize

interface Props {
  archief?: boolean
}

export default function MijnOpdrachtenPage({ archief = false }: Props) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [afmelden, setAfmelden] = useState<MijnOpdracht | null>(null)
  const [nietGeleverd, setNietGeleverd] = useState<MijnOpdracht | null>(null)
  const [zoek, setZoek] = useState('')
  const [zoekterm, setZoekterm] = useState('')
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => { setZoekterm(zoek.trim()); setPagina(1) }, 300)
    return () => clearTimeout(timer)
  }, [zoek])

  // Opdrachtgevers kunnen opdrachten toevoegen of intrekken terwijl de app openstaat.
  const { data, isLoading } = useQuery({
    queryKey: ['mijn-opdrachten', archief, zoekterm, pagina],
    queryFn: () => mijnOpdrachten.lijst({
      archief,
      search: zoekterm || undefined,
      ...(archief ? { page: pagina, page_size: PER_PAGINA } : {}),
    }),
    refetchInterval: archief ? 60000 : 10000,
    refetchIntervalInBackground: !archief,
  })
  const opdrachten = data?.results ?? []
  const totaal = data?.count ?? 0

  // De server rekent hooguit eens per tien minuten opnieuw; vaker pollen heeft geen zin.
  const { data: etas = [] } = useQuery<OpdrachtEta[]>({
    queryKey: ['mijn-opdracht-eta'],
    queryFn: mijnOpdrachten.eta,
    enabled: !archief,
    refetchInterval: 600000,
    refetchIntervalInBackground: true,
  })
  const etaPer = Object.fromEntries(etas.map(e => [e.id, e]))

  const ververs = () => queryClient.invalidateQueries({ queryKey: ['mijn-opdrachten'] })

  const starten = useMutation({
    mutationFn: mijnOpdrachten.starten,
    onSuccess: () => { toast.success(t('myOrders.started', 'Opdracht gestart')); ververs() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  const foutMelden = (fout: unknown) => {
    const bericht = (fout as { response?: { data?: unknown } })?.response?.data
    const tekst = Array.isArray(bericht)
      ? String(bericht[0])
      : typeof bericht === 'string'
        ? bericht
        : ''
    toast.error(tekst || t('common.error', 'Er ging iets mis'))
  }

  const aangekomen = useMutation({
    mutationFn: (id: string) => mijnOpdrachten.aangekomen(id),
    onSuccess: () => { toast.success(t('myOrders.arrivedDone', 'Aangekomen gemeld')); ververs() },
    onError: foutMelden,
  })

  const wachten = useMutation({
    mutationFn: (id: string) => mijnOpdrachten.wachtenOpKlant(id),
    onSuccess: () => { toast.success(t('myOrders.waitingDone', 'Wachten doorgegeven')); ververs() },
    onError: foutMelden,
  })

  const begonnen = useMutation({
    mutationFn: ({ id, soort }: { id: string; soort: 'laden' | 'lossen' }) =>
      mijnOpdrachten.begonnen(id, { soort }),
    onSuccess: () => { toast.success(t('myOrders.startedWork', 'Doorgegeven')); ververs() },
    onError: foutMelden,
  })

  const bijlage = useMutation({
    mutationFn: ({ id, bestand }: { id: string; bestand: File }) =>
      mijnOpdrachten.bijlageToevoegen(id, bestand),
    onSuccess: () => { toast.success(t('orders.attachmentAdded', 'Bijlage toegevoegd')); ververs() },
    onError: () => toast.error(t('orders.attachmentFailed', 'Bijlage uploaden mislukt')),
  })

  const navigatieLink = (o: MijnOpdracht) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      [o.adres, o.postcode, o.plaats].filter(Boolean).join(' ')
    )}`

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' }) : ''

  const terPlaatse = (o: MijnOpdracht) =>
    ['aangekomen', 'wachten_op_klant', 'bezig_laden', 'bezig_lossen'].includes(o.fase)

  const bezig = (o: MijnOpdracht) => o.fase === 'bezig_laden' || o.fase === 'bezig_lossen'

  // Bij een laadopdracht heet afronden 'geladen', bij bezorgen 'afgeleverd'.
  const klaarLabel = (o: MijnOpdracht) =>
    o.werksoort === 'laden'
      ? t('myOrders.loaded', 'Geladen melden')
      : o.werksoort === 'beide'
        ? t('myOrders.done', 'Klaar melden')
        : t('myOrders.deliver', 'Afgeleverd melden')

  const nietGeluktLabel = (o: MijnOpdracht) =>
    o.werksoort === 'laden'
      ? t('myOrders.notLoaded', 'Niet geladen')
      : t('myOrders.notDelivered', 'Niet geleverd')

  return (
    <div className="space-y-3">
      <h1 className="page-title">
        {archief
          ? t('myOrders.archiveTitle', 'Voltooide opdrachten')
          : t('myOrders.title', 'Mijn opdrachten')}
      </h1>

      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={zoek}
          onChange={e => setZoek(e.target.value)}
          placeholder={t('myOrders.searchPlaceholder', 'Zoek op ritnummer, klant of plaats')}
          className="input pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">{t('common.loading', 'Laden...')}</p>
      ) : opdrachten.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          {archief
            ? t('myOrders.archiveEmpty', 'U heeft nog geen afgehandelde opdrachten.')
            : t('myOrders.empty', 'U heeft op dit moment geen opdrachten.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {opdrachten.map(o => {
            const uitgeklapt = open === o.id
            return (
              <li key={o.id} className="card">
                <button
                  onClick={() => setOpen(uitgeklapt ? null : o.id)}
                  className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {o.ritnummer && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                          {o.ritnummer}
                        </span>
                      )}
                      <span className="truncate font-semibold text-gray-900">{o.klant_naam}</span>
                      <OpdrachtStatusBadge status={o.status} label={o.status_label} />
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {o.werk_omschrijving}
                      </span>
                      {o.status === 'gestart' && o.fase !== 'onderweg' && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {o.fase_label}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-gray-600">
                      {[o.adres, o.postcode, o.plaats].filter(Boolean).join(', ')}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {o.opdrachtgever_naam}
                      {o.geopend_tot && ` · ${t('orders.openUntil', 'Geopend tot')} ${o.geopend_tot.slice(0, 5)}`}
                      {o.afgeleverd_op && ` · ${tijd(o.afgeleverd_op)}`}
                      {o.niet_geleverd_op && ` · ${tijd(o.niet_geleverd_op)}`}
                    </span>
                    {o.status === 'gestart' && (
                      <span className="mt-1.5 block max-w-xs">
                        <EtaBalk eta={etaPer[o.id]} />
                      </span>
                    )}
                  </span>
                  {uitgeklapt
                    ? <ChevronUpIcon className="h-5 w-5 shrink-0 text-gray-400" />
                    : <ChevronDownIcon className="h-5 w-5 shrink-0 text-gray-400" />}
                </button>

                {uitgeklapt && (
                  <div className="space-y-3 border-t border-gray-100 px-3 py-3">
                    {o.contactpersoon && (
                      <p className="text-sm">
                        <span className="text-gray-500">{t('orders.contact', 'Contactpersoon')}: </span>
                        {o.contactpersoon}
                      </p>
                    )}
                    {o.notitie && (
                      <p className="rounded bg-gray-50 px-2 py-1.5 text-sm text-gray-700">{o.notitie}</p>
                    )}
                    {o.regels.length > 0 && (
                      <div className="rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between border-b border-gray-100 px-2 py-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {t('orders.sectionLines', 'Orderregels')}
                          </span>
                          <span className="text-xs font-semibold text-gray-700">
                            {t('orders.totalPallets', '{{aantal}} pallets', {
                              aantal: o.regels.reduce((s, r) => s + (r.aantal_pallets || 0), 0),
                            })}
                          </span>
                        </div>
                        <ul className="divide-y divide-gray-100">
                          {o.regels.map((r, i) => (
                            <li key={r.id || i} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-xs text-gray-600">
                                  {r.ordernummer || '-'}
                                </span>
                                <span className="block truncate text-gray-800">{r.omschrijving}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                {r.aantal_pallets !== null && (
                                  <span className="block text-sm font-semibold text-gray-900">
                                    {r.aantal_pallets} PLT
                                  </span>
                                )}
                                {r.soort && (
                                  <span className="block text-xs text-gray-500">
                                    {r.soort === 'laden'
                                      ? t('orders.load', 'Laden')
                                      : t('orders.unload', 'Lossen')}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {o.niet_geleverd_reden && (
                      <p className="rounded bg-warning-50 px-2 py-1.5 text-sm text-warning-700">
                        {t('orders.reason', 'Reden')}: {o.niet_geleverd_reden}
                      </p>
                    )}
                    {o.chauffeur_reactie && (
                      <p className="rounded bg-gray-50 px-2 py-1.5 text-sm text-gray-700">{o.chauffeur_reactie}</p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <a href={navigatieLink(o)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                        <MapPinIcon className="h-4 w-4" />
                        {t('myOrders.navigate', 'Navigeer')}
                      </a>
                      {o.telefoon && (
                        <a href={`tel:${o.telefoon}`} className="btn-secondary btn-sm">
                          <PhoneIcon className="h-4 w-4" />
                          {o.telefoon}
                        </a>
                      )}
                      {o.status !== 'ingetrokken' && (
                        <label className="btn-secondary btn-sm cursor-pointer">
                          <PaperClipIcon className="h-4 w-4" />
                          {t('orders.addAttachment', 'Bijlage toevoegen')}
                          <input type="file" accept={BIJLAGE_ACCEPT} capture="environment" className="sr-only"
                            onChange={e => {
                              const bestand = e.target.files?.[0]
                              if (bestand) bijlage.mutate({ id: o.id, bestand })
                              e.target.value = ''
                            }} />
                        </label>
                      )}
                    </div>

                    {o.bijlagen.length > 0 && (
                      <div className="flex flex-wrap gap-1">
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

                    {!archief && (
                      <div className="space-y-2">
                        {o.status === 'nieuw' && (
                          <button onClick={() => starten.mutate(o.id)} disabled={starten.isPending}
                            className="btn-primary w-full">
                            <PlayIcon className="h-5 w-5" />
                            {t('myOrders.start', 'Opdracht starten')}
                          </button>
                        )}

                        {o.status === 'gestart' && o.fase === 'onderweg' && (
                          <button onClick={() => aangekomen.mutate(o.id)} disabled={aangekomen.isPending}
                            className="btn-primary w-full">
                            <MapPinIcon className="h-5 w-5" />
                            {t('myOrders.arrived', 'Aangekomen bij klant')}
                          </button>
                        )}

                        {o.status === 'gestart' && terPlaatse(o) && (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            {o.fase !== 'wachten_op_klant' && !bezig(o) && (
                              <button onClick={() => wachten.mutate(o.id)} disabled={wachten.isPending}
                                className="btn-secondary flex-1">
                                <ClockIcon className="h-5 w-5" />
                                {t('myOrders.waitForCustomer', 'Wachten op klant')}
                              </button>
                            )}
                            {o.werk_laden && o.fase !== 'bezig_laden' && (
                              <button onClick={() => begonnen.mutate({ id: o.id, soort: 'laden' })}
                                disabled={begonnen.isPending} className="btn-primary flex-1">
                                <ArrowUpTrayIcon className="h-5 w-5" />
                                {t('myOrders.startLoading', 'Begonnen met laden')}
                              </button>
                            )}
                            {o.werk_lossen && o.fase !== 'bezig_lossen' && (
                              <button onClick={() => begonnen.mutate({ id: o.id, soort: 'lossen' })}
                                disabled={begonnen.isPending} className="btn-primary flex-1">
                                <ArrowDownTrayIcon className="h-5 w-5" />
                                {t('myOrders.startUnloading', 'Begonnen met lossen')}
                              </button>
                            )}
                          </div>
                        )}

                        {bezig(o) ? (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button onClick={() => setAfmelden(o)} className="btn-success flex-1">
                              <CheckCircleIcon className="h-5 w-5" />
                              {klaarLabel(o)}
                            </button>
                            <button onClick={() => setNietGeleverd(o)} className="btn-warning flex-1">
                              <NoSymbolIcon className="h-5 w-5" />
                              {nietGeluktLabel(o)}
                            </button>
                          </div>
                        ) : terPlaatse(o) ? (
                          <button onClick={() => setNietGeleverd(o)} className="btn-warning w-full">
                            <NoSymbolIcon className="h-5 w-5" />
                            {nietGeluktLabel(o)}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {archief && totaal > PER_PAGINA && (
        <Pagination
          currentPage={pagina}
          totalPages={Math.ceil(totaal / PER_PAGINA)}
          totalCount={totaal}
          pageSize={PER_PAGINA}
          onPageChange={setPagina}
          onPageSizeChange={() => undefined}
          showPageSizeSelector={false}
        />
      )}

      {afmelden && (
        <AfmeldModal
          opdracht={afmelden}
          onSluiten={() => setAfmelden(null)}
          onKlaar={() => { setAfmelden(null); ververs() }}
        />
      )}

      {nietGeleverd && (
        <NietGeleverdModal
          opdracht={nietGeleverd}
          onSluiten={() => setNietGeleverd(null)}
          onKlaar={() => { setNietGeleverd(null); ververs() }}
        />
      )}
    </div>
  )
}
