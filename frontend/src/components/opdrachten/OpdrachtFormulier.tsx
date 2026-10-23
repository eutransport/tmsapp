import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  BuildingOffice2Icon,
  ClipboardDocumentListIcon,
  LockOpenIcon,
  PaperClipIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  BIJLAGE_ACCEPT,
  ChauffeurKeuze,
  Opdracht,
  OpdrachtInvoer,
  OpdrachtKlant,
  portaalKlanten,
  portaalOpdrachten,
} from '@/api/opdrachten'

interface Props {
  opdracht: Opdracht | null
  chauffeurs: ChauffeurKeuze[]
  bezig: boolean
  onSluiten: () => void
  onOpslaan: (invoer: OpdrachtInvoer, bijlagen: File[]) => void
}

const KLANTVELDEN: (keyof OpdrachtInvoer)[] = [
  'adres', 'postcode', 'plaats', 'contactpersoon', 'telefoon', 'geopend_tot',
]

export default function OpdrachtFormulier({ opdracht, chauffeurs, bezig, onSluiten, onOpslaan }: Props) {
  const { t } = useTranslation()
  const bestandKiezer = useRef<HTMLInputElement>(null)
  const [fouten, setFouten] = useState<Record<string, string>>({})
  const [bijlagen, setBijlagen] = useState<File[]>([])
  const [gekozenKlant, setGekozenKlant] = useState<OpdrachtKlant | null>(null)
  const [suggestiesOpen, setSuggestiesOpen] = useState(false)
  const [zoekterm, setZoekterm] = useState('')
  const [ritVrij, setRitVrij] = useState(false)
  const [ritnummerLaadt, setRitnummerLaadt] = useState(!opdracht)
  const [waarden, setWaarden] = useState<OpdrachtInvoer>({
    chauffeur: opdracht?.chauffeur || '',
    ritnummer: opdracht?.ritnummer || '',
    klant_naam: opdracht?.klant_naam || '',
    adres: opdracht?.adres || '',
    postcode: opdracht?.postcode || '',
    plaats: opdracht?.plaats || '',
    contactpersoon: opdracht?.contactpersoon || '',
    telefoon: opdracht?.telefoon || '',
    notitie: opdracht?.notitie || '',
    geopend_tot: opdracht?.geopend_tot?.slice(0, 5) || '',
  })

  const zet = (sleutel: keyof OpdrachtInvoer, waarde: string) =>
    setWaarden(vorig => ({ ...vorig, [sleutel]: waarde }))

  useEffect(() => {
    if (opdracht) return
    let actief = true
    portaalOpdrachten.volgendRitnummer()
      .then(nummer => {
        // Niet overschrijven als de gebruiker intussen zelf iets heeft getypt.
        if (actief) setWaarden(vorig => (vorig.ritnummer ? vorig : { ...vorig, ritnummer: nummer }))
      })
      .catch(() => undefined)
      .finally(() => { if (actief) setRitnummerLaadt(false) })
    return () => { actief = false }
  }, [opdracht])

  // Zoeken pas na een korte pauze, anders vuurt elk toetsaanslag een verzoek af.
  useEffect(() => {
    const timer = setTimeout(() => setZoekterm(waarden.klant_naam.trim()), 250)
    return () => clearTimeout(timer)
  }, [waarden.klant_naam])

  const { data: suggesties = [] } = useQuery({
    queryKey: ['portaal-klant-zoek', zoekterm],
    queryFn: () => portaalKlanten.zoeken(zoekterm),
    enabled: suggestiesOpen && zoekterm.length >= 2,
  })

  const kiesKlant = (klant: OpdrachtKlant) => {
    setGekozenKlant(klant)
    setSuggestiesOpen(false)
    setWaarden(vorig => ({
      ...vorig,
      klant_naam: klant.naam,
      adres: klant.adres || '',
      postcode: klant.postcode || '',
      plaats: klant.plaats || '',
      contactpersoon: klant.contactpersoon || '',
      telefoon: klant.telefoon || '',
      geopend_tot: klant.geopend_tot?.slice(0, 5) || '',
    }))
  }

  const klantGewijzigd = () => {
    if (!gekozenKlant) return false
    return KLANTVELDEN.some(veld => {
      const nieuw = (waarden[veld] || '') as string
      const oud = veld === 'geopend_tot'
        ? (gekozenKlant.geopend_tot?.slice(0, 5) || '')
        : ((gekozenKlant[veld as keyof OpdrachtKlant] as string) || '')
      return nieuw !== oud
    })
  }

  const versturen = async (e: React.FormEvent) => {
    e.preventDefault()
    const nieuw: Record<string, string> = {}
    if (!waarden.chauffeur) nieuw.chauffeur = t('errors.required', 'Verplicht')
    if (!waarden.klant_naam.trim()) nieuw.klant_naam = t('errors.required', 'Verplicht')
    if (!waarden.adres.trim()) nieuw.adres = t('errors.required', 'Verplicht')
    setFouten(nieuw)
    if (Object.keys(nieuw).length) return

    if (gekozenKlant && klantGewijzigd()) {
      const bevestigd = window.confirm(
        t('orders.saveToCustomer', 'Deze gegevens ook bijwerken bij de klant {{naam}}?', {
          naam: gekozenKlant.naam,
        })
      )
      if (bevestigd) {
        try {
          await portaalKlanten.bijwerken(gekozenKlant.id, {
            adres: waarden.adres,
            postcode: waarden.postcode,
            plaats: waarden.plaats,
            contactpersoon: waarden.contactpersoon,
            telefoon: waarden.telefoon,
            geopend_tot: waarden.geopend_tot || null,
          })
        } catch {
          // De opdracht zelf mag hier niet op stranden.
        }
      }
    }

    onOpslaan({ ...waarden, geopend_tot: waarden.geopend_tot || null }, bijlagen)
  }

  const veld = 'input-field'
  const fout = 'text-xs text-danger-600'
  // De zijbalk duwt de inhoud naar rechts; het venster volgt dat zodat het gecentreerd oogt.
  const ingeklapt = localStorage.getItem('tms.sidebar.collapsed') === 'true'

  return (
    <div className={`modal-overlay ${ingeklapt ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
      <form
        onSubmit={versturen}
        className="modal-panel flex max-h-[90vh] w-full flex-col sm:max-w-4xl"
      >
        <div className="flex items-start justify-between gap-4 bg-gradient-to-r from-slate-900 to-primary-800 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-white/10 p-2 text-white">
              <ClipboardDocumentListIcon className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {opdracht ? t('orders.edit', 'Opdracht bewerken') : t('orders.new', 'Nieuwe opdracht')}
              </h2>
              <p className="text-sm text-white/70">
                {t('orders.formSubtitle', 'Vul de afleverlocatie in en wijs een chauffeur toe.')}
              </p>
            </div>
          </div>
          <button type="button" onClick={onSluiten} className="rounded-md p-1 text-white/70 transition hover:bg-white/10 hover:text-white">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-5">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <ClipboardDocumentListIcon className="h-4 w-4 text-primary-600" />
            {t('orders.sectionAssignment', 'Opdracht')}
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label className="label">{t('orders.driver', 'Chauffeur')}</label>
              <select value={waarden.chauffeur} onChange={e => zet('chauffeur', e.target.value)} className={veld}>
                <option value="">{t('common.select', 'Kies...')}</option>
                {chauffeurs.map(c => <option key={c.id} value={c.id}>{c.naam}</option>)}
              </select>
              {fouten.chauffeur && <span className={fout}>{fouten.chauffeur}</span>}
            </div>

            <div className="sm:col-span-3">
              <label className="label">{t('orders.tripNumber', 'Ritnummer')}</label>
              <div className="flex items-center gap-2">
                <input
                  value={waarden.ritnummer || ''}
                  onChange={e => zet('ritnummer', e.target.value)}
                  readOnly={!ritVrij}
                  className={`${veld} ${ritVrij ? '' : 'cursor-default bg-gray-50 font-mono text-gray-600'}`}
                  placeholder={ritnummerLaadt ? t('common.loading', 'Laden...') : ''}
                />
                <button
                  type="button"
                  onClick={() => setRitVrij(v => !v)}
                  title={t('orders.editTripNumber', 'Ritnummer wijzigen')}
                  className="btn btn-secondary btn-icon shrink-0"
                >
                  {ritVrij
                    ? <LockOpenIcon className="h-4 w-4" />
                    : <PencilSquareIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          </section>

          <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <BuildingOffice2Icon className="h-4 w-4 text-primary-600" />
            {t('orders.sectionCustomer', 'Afleveradres')}
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6">
            <div className="relative sm:col-span-6">
              <label className="label">{t('orders.customerName', 'Bedrijfsnaam')}</label>
              <input
                value={waarden.klant_naam}
                onChange={e => { zet('klant_naam', e.target.value); setGekozenKlant(null); setSuggestiesOpen(true) }}
                onFocus={() => setSuggestiesOpen(true)}
                onBlur={() => setTimeout(() => setSuggestiesOpen(false), 150)}
                autoComplete="off"
                className={veld}
              />
              {fouten.klant_naam && <span className={fout}>{fouten.klant_naam}</span>}
              {suggestiesOpen && suggesties.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {suggesties.map(k => (
                    <li key={k.id}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => kiesKlant(k)}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <BuildingOffice2Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-gray-900">{k.naam}</span>
                          <span className="block truncate text-xs text-gray-500">
                            {[k.adres, k.postcode, k.plaats].filter(Boolean).join(', ') || '-'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {gekozenKlant && (
                <p className="mt-1 text-xs text-primary-700">
                  {t('orders.customerLinked', 'Gegevens overgenomen van {{naam}}', { naam: gekozenKlant.naam })}
                </p>
              )}
            </div>

            <div className="sm:col-span-3">
              <label className="label">{t('orders.address', 'Adres')}</label>
              <input value={waarden.adres} onChange={e => zet('adres', e.target.value)} className={veld} />
              {fouten.adres && <span className={fout}>{fouten.adres}</span>}
            </div>

            <div className="sm:col-span-1">
              <label className="label">{t('orders.postcode', 'Postcode')}</label>
              <input value={waarden.postcode} onChange={e => zet('postcode', e.target.value)} className={veld} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">{t('orders.city', 'Plaats')}</label>
              <input value={waarden.plaats} onChange={e => zet('plaats', e.target.value)} className={veld} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">{t('orders.contact', 'Contactpersoon')}</label>
              <input value={waarden.contactpersoon} onChange={e => zet('contactpersoon', e.target.value)} className={veld} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">{t('orders.phone', 'Telefoonnummer')}</label>
              <input value={waarden.telefoon} onChange={e => zet('telefoon', e.target.value)} className={veld} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">{t('orders.openUntil', 'Geopend tot')}</label>
              {/* lang=nl-NL dwingt het 24-uursformaat af in Chrome */}
              <input
                type="time"
                lang="nl-NL"
                step={300}
                value={waarden.geopend_tot || ''}
                onChange={e => zet('geopend_tot', e.target.value)}
                className={veld}
              />
            </div>
          </div>
          </section>

          <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <PaperClipIcon className="h-4 w-4 text-primary-600" />
            {t('orders.sectionExtra', 'Toelichting')}
          </p>
          <div className="space-y-3">
            <div>
              <label className="label">{t('orders.note', 'Notitie')}</label>
              <textarea rows={3} value={waarden.notitie} onChange={e => zet('notitie', e.target.value)} className={veld} />
            </div>

            <div>
              <label className="label">{t('orders.attachments', 'Bijlagen')}</label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => bestandKiezer.current?.click()} className="btn-secondary btn-sm">
                  <PaperClipIcon className="h-4 w-4" />
                  {t('orders.addAttachment', 'Bijlage toevoegen')}
                </button>
                <input
                  ref={bestandKiezer}
                  type="file"
                  multiple
                  accept={BIJLAGE_ACCEPT}
                  className="sr-only"
                  onChange={e => {
                    setBijlagen(vorig => [...vorig, ...Array.from(e.target.files || [])])
                    e.target.value = ''
                  }}
                />
                {bijlagen.map((b, i) => (
                  <span key={`${b.name}-${i}`} className="chip chip-primary">
                    {b.name}
                    <button
                      type="button"
                      onClick={() => setBijlagen(vorig => vorig.filter((_, j) => j !== i))}
                      aria-label={t('common.delete', 'Verwijderen')}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4">
          <button type="button" onClick={onSluiten} className="btn-secondary">
            {t('common.cancel', 'Annuleren')}
          </button>
          <button type="submit" disabled={bezig} className="btn-primary">
            {t('common.save', 'Opslaan')}
          </button>
        </div>
      </form>
    </div>
  )
}
