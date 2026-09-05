/**
 * Factuurwizard: in vijf stappen een factuur maken.
 *
 *   1. Kies het bedrijf (de template volgt automatisch uit de instellingen).
 *   2. Kies de dienst(en) en de periode, of voeg een lege regel toe.
 *   3. Vul per regel het bedrag exclusief BTW in.
 *   4. Bekijk de voorbeeldfactuur.
 *   5. Mail de factuur, of sla hem alleen op.
 *
 * De wizard maakt een gewone factuur aan; alles wat daarna volgt (PDF, mailen,
 * overzichten) loopt via de bestaande factuurmodule.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BuildingOfficeIcon,
  CheckCircleIcon,
  CheckIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  MapIcon,
  PaperAirplaneIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

import {
  getWizardOpties,
  maakWizardFactuur,
  type WizardOptie,
  type WizardRegelInput,
} from '@/api/factuurwizard'
import {
  generatePdf,
  getNextInvoiceNumber,
  openPdfInNewTab,
  sendInvoiceEmail,
} from '@/api/invoices'
import { getMailingContacts } from '@/api/companies'
import { listEmailProfiles, type EmailProfile } from '@/api/emailProfiles'
import ConfirmDialog, { type ConfirmState } from '@/components/common/ConfirmDialog'
import type { Invoice, MailingListContact } from '@/types'
import clsx from '@/utils/clsx'

/** Een regel zoals hij in de wizard wordt samengesteld. */
interface WizardRegel {
  key: string
  /** Leeg betekent: vrije regel zonder route. Meerdere routes horen bij een
   *  samengevoegde regel. */
  ritnummers: string[]
  datumVan: string
  datumTot: string
  omschrijving: string
  /** Heeft de gebruiker de omschrijving zelf aangepast? Dan niet meer overschrijven. */
  omschrijvingHandmatig: boolean
  bedrag: string
}

const STAPPEN = [
  { nummer: 1, label: 'Bedrijf' },
  { nummer: 2, label: 'Diensten' },
  { nummer: 3, label: 'Bedragen' },
  { nummer: 4, label: 'Controle' },
  { nummer: 5, label: 'Afronden' },
]

const euro = (bedrag: number): string =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(bedrag || 0)

/** jjjj-mm-dd uit een Date, in de tijdzone van de browser.
 *
 * Bewust niet via toISOString(): die rekent naar UTC en levert in Nederland
 * een dag te vroeg op.
 */
const naarIso = (datum: Date): string => {
  const jaar = datum.getFullYear()
  const maand = String(datum.getMonth() + 1).padStart(2, '0')
  const dag = String(datum.getDate()).padStart(2, '0')
  return `${jaar}-${maand}-${dag}`
}

const vandaag = (): string => naarIso(new Date())

/** jjjj-mm-dd naar dd-mm-jjjj; lege of onvolledige waarden blijven leeg. */
const nlDatum = (iso: string): string => {
  if (!iso || iso.length < 10) return ''
  const [jaar, maand, dag] = iso.split('-')
  return `${dag}-${maand}-${jaar}`
}

/** De vaste omschrijving voor een dienstregel.
 *
 * Bij meerdere routes op één regel komen de routenummers achter elkaar aan het
 * eind van de tekst te staan.
 */
const maakOmschrijving = (ritnummers: string[], van: string, tot: string): string => {
  if (ritnummers.length === 0) return ''
  const periode = van && tot ? `${nlDatum(van)} - ${nlDatum(tot)}` : ''
  const woord = ritnummers.length === 1 ? 'route' : 'routes'
  return `Transportdiensten periode ${periode} voor ${woord} ${ritnummers.join(', ')}`
}

/** Korte aanduiding van een regel, voor boven het regelblok. */
const regelKop = (ritnummers: string[]): string => {
  if (ritnummers.length === 0) return 'Losse regel'
  if (ritnummers.length === 1) return `Route ${ritnummers[0]}`
  return `Routes ${ritnummers.join(', ')}`
}

const nieuweSleutel = (): string =>
  `regel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Keuze van het e-mailprofiel waarmee verstuurd wordt.
 *
 * Bewust zonder voorselectie: de gebruiker geeft zelf aan vanaf welk adres de
 * factuur de deur uit gaat.
 */
function EmailProfielKeuze({
  profielen,
  waarde,
  onKies,
}: {
  profielen: EmailProfile[]
  waarde: string
  onKies: (id: string) => void
}) {
  if (profielen.length === 0) return null
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
        <EnvelopeIcon className="h-4 w-4 text-gray-400" />
        Verstuur vanaf welk profiel? *
      </label>
      <select
        className="input w-full"
        value={waarde}
        onChange={(e) => onKies(e.target.value)}
      >
        <option value="">— Kies een profiel —</option>
        {profielen.map((profiel) => (
          <option key={profiel.id} value={profiel.id}>
            {profiel.name}
            {profiel.smtp_from_email ? ` — ${profiel.smtp_from_email}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export default function FactuurWizardPage() {
  const navigate = useNavigate()

  const [opties, setOpties] = useState<WizardOptie[]>([])
  const [laden, setLaden] = useState(true)
  const [stap, setStap] = useState(1)

  // Stap 1
  const [bedrijfId, setBedrijfId] = useState('')
  const [factuurdatum, setFactuurdatum] = useState(vandaag())

  // Stap 2 en 3
  const [regels, setRegels] = useState<WizardRegel[]>([])
  const [opmerkingen, setOpmerkingen] = useState('')
  /** Staan alle gekozen routes samen op één factuurregel? */
  const [samenvoegen, setSamenvoegen] = useState(false)
  /** Is de vraag over samenvoegen al gesteld voor de huidige selectie? */
  const [samenvoegGevraagd, setSamenvoegGevraagd] = useState(false)

  // Stap 4
  const [verwachtNummer, setVerwachtNummer] = useState('')
  const [aanmaken, setAanmaken] = useState(false)
  const [bevestiging, setBevestiging] = useState<ConfirmState | null>(null)

  // Stap 5
  const [factuur, setFactuur] = useState<Invoice | null>(null)
  const [contacten, setContacten] = useState<MailingListContact[]>([])
  const [gekozenMails, setGekozenMails] = useState<Set<string>>(new Set())
  const [extraMail, setExtraMail] = useState('')
  const [profielen, setProfielen] = useState<EmailProfile[]>([])
  /** Leeg betekent: nog niets gekozen. De gebruiker moet zelf een profiel kiezen. */
  const [mailProfiel, setMailProfiel] = useState('')
  const [downloaden, setDownloaden] = useState(false)
  const [mailenOpen, setMailenOpen] = useState(false)
  const [versturen, setVersturen] = useState(false)
  const [verzonden, setVerzonden] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setOpties(await getWizardOpties())
      } catch (err) {
        console.error(err)
        toast.error('De instellingen van de wizard konden niet worden geladen')
      } finally {
        setLaden(false)
      }
    })()
  }, [])

  const gekozenConfig = useMemo(
    () => opties.find((o) => o.bedrijf === bedrijfId) ?? null,
    [opties, bedrijfId]
  )

  const gekozenRoutes = useMemo(
    () => new Set(regels.flatMap((r) => r.ritnummers)),
    [regels]
  )

  const subtotaal = useMemo(
    () => regels.reduce((som, r) => som + (Number(r.bedrag) || 0), 0),
    [regels]
  )
  const btwPercentage = Number(gekozenConfig?.btw_percentage ?? 21)
  const btwBedrag = useMemo(
    () => Math.round(subtotaal * (btwPercentage / 100) * 100) / 100,
    [subtotaal, btwPercentage]
  )
  const totaal = subtotaal + btwBedrag

  const vervaldatum = useMemo(() => {
    if (!gekozenConfig || !factuurdatum) return ''
    const datum = new Date(`${factuurdatum}T00:00:00`)
    if (Number.isNaN(datum.getTime())) return ''
    datum.setDate(datum.getDate() + gekozenConfig.betaaltermijn_dagen)
    return naarIso(datum)
  }, [gekozenConfig, factuurdatum])

  // Verwacht factuurnummer ophalen zodra we bij de controlestap komen.
  useEffect(() => {
    if (stap !== 4 || !gekozenConfig) return
    let afgebroken = false
    void (async () => {
      try {
        const antwoord = await getNextInvoiceNumber('verkoop', gekozenConfig.administratie)
        if (!afgebroken) setVerwachtNummer(antwoord.factuurnummer)
      } catch {
        if (!afgebroken) setVerwachtNummer('')
      }
    })()
    return () => {
      afgebroken = true
    }
  }, [stap, gekozenConfig])

  // ------------------------------------------------------------------ regels

  const dienstAanUit = (ritnummer: string) => {
    setRegels((vorig) => {
      const staatErAl = vorig.some((r) => r.ritnummers.includes(ritnummer))

      if (staatErAl) {
        // Route uit de regel halen. Hield die regel alleen deze ene route vast,
        // dan verdwijnt de regel helemaal.
        return vorig.flatMap((regel) => {
          if (!regel.ritnummers.includes(ritnummer)) return [regel]
          const over = regel.ritnummers.filter((r) => r !== ritnummer)
          if (over.length === 0) return []
          return [maakRegelBij(regel, over)]
        })
      }

      if (samenvoegen) {
        // Alles bij de bestaande routeregel, of een nieuwe als die er nog niet is.
        const bestaandeIndex = vorig.findIndex((r) => r.ritnummers.length > 0)
        if (bestaandeIndex >= 0) {
          return vorig.map((regel, index) =>
            index === bestaandeIndex
              ? maakRegelBij(regel, [...regel.ritnummers, ritnummer])
              : regel
          )
        }
      }

      return [
        ...vorig,
        {
          key: nieuweSleutel(),
          ritnummers: [ritnummer],
          datumVan: '',
          datumTot: '',
          omschrijving: '',
          omschrijvingHandmatig: false,
          bedrag: '',
        },
      ]
    })
  }

  /** Werkt de routes van een regel bij en houdt de omschrijving in de pas. */
  const maakRegelBij = (regel: WizardRegel, ritnummers: string[]): WizardRegel => ({
    ...regel,
    ritnummers,
    omschrijving: regel.omschrijvingHandmatig
      ? regel.omschrijving
      : maakOmschrijving(ritnummers, regel.datumVan, regel.datumTot),
  })

  /** Zet de gekozen routes op één regel, of juist weer los uit elkaar. */
  const samenvoegenZetten = (aan: boolean) => {
    setSamenvoegen(aan)
    setRegels((vorig) => {
      const routeRegels = vorig.filter((r) => r.ritnummers.length > 0)
      const losseRegels = vorig.filter((r) => r.ritnummers.length === 0)
      if (routeRegels.length === 0) return vorig

      if (aan) {
        const alleRoutes = routeRegels.flatMap((r) => r.ritnummers)
        const eerste = routeRegels[0]
        // De bedragen die al ingevuld waren tellen we bij elkaar op.
        const somBedrag = routeRegels.reduce((som, r) => som + (Number(r.bedrag) || 0), 0)
        const heeftBedrag = routeRegels.some((r) => r.bedrag !== '')
        const samen: WizardRegel = {
          key: eerste.key,
          ritnummers: alleRoutes,
          datumVan: eerste.datumVan,
          datumTot: eerste.datumTot,
          omschrijving: maakOmschrijving(alleRoutes, eerste.datumVan, eerste.datumTot),
          omschrijvingHandmatig: false,
          bedrag: heeftBedrag ? String(somBedrag) : '',
        }
        return [samen, ...losseRegels]
      }

      // Uit elkaar halen: de verdeling van het bedrag is onbekend, dus leeg.
      const losgetrokken = routeRegels.flatMap((regel) =>
        regel.ritnummers.map((rit) => ({
          key: nieuweSleutel(),
          ritnummers: [rit],
          datumVan: regel.datumVan,
          datumTot: regel.datumTot,
          omschrijving: maakOmschrijving([rit], regel.datumVan, regel.datumTot),
          omschrijvingHandmatig: false,
          bedrag: regel.ritnummers.length === 1 ? regel.bedrag : '',
        }))
      )
      return [...losgetrokken, ...losseRegels]
    })
  }

  // Zodra er meer dan twee routes gekozen zijn, vragen we hoe ze op de factuur
  // moeten komen. Zakt de selectie weer onder de drie, dan mag de vraag later
  // opnieuw gesteld worden.
  useEffect(() => {
    if (gekozenRoutes.size <= 2) {
      if (samenvoegGevraagd) setSamenvoegGevraagd(false)
      return
    }
    if (samenvoegGevraagd || samenvoegen) return
    setSamenvoegGevraagd(true)
    setBevestiging({
      title: 'Routes op één factuurregel?',
      message: (
        <>
          Je hebt <strong>{gekozenRoutes.size} routes</strong> gekozen. Wil je die
          samen op één factuurregel zetten, of krijgt elke route een eigen regel?
          <br />
          <br />
          Op één regel komen de routenummers achter elkaar in de omschrijving te
          staan.
        </>
      ),
      confirmLabel: 'Samen op één regel',
      cancelLabel: 'Elk een eigen regel',
      variant: 'info',
      onConfirm: () => samenvoegenZetten(true),
    })
  }, [gekozenRoutes.size, samenvoegGevraagd, samenvoegen])

  const legeRegelToevoegen = () => {
    setRegels((vorig) => [
      ...vorig,
      {
        key: nieuweSleutel(),
        ritnummers: [],
        datumVan: '',
        datumTot: '',
        omschrijving: '',
        omschrijvingHandmatig: true,
        bedrag: '',
      },
    ])
  }

  const regelWeg = (key: string) => {
    setRegels((vorig) => vorig.filter((r) => r.key !== key))
  }

  const regelWijzigen = (key: string, wijziging: Partial<WizardRegel>) => {
    setRegels((vorig) =>
      vorig.map((regel) => {
        if (regel.key !== key) return regel
        const nieuw = { ...regel, ...wijziging }
        // Zolang de gebruiker de tekst niet zelf heeft aangepast, houden we de
        // omschrijving gelijk aan de gekozen routes en periode.
        if (!nieuw.omschrijvingHandmatig && nieuw.ritnummers.length > 0) {
          nieuw.omschrijving = maakOmschrijving(
            nieuw.ritnummers,
            nieuw.datumVan,
            nieuw.datumTot
          )
        }
        return nieuw
      })
    )
  }

  // ------------------------------------------------------------- navigeren

  const stapGeldig = (nummer: number): string | null => {
    if (nummer === 1) {
      if (!bedrijfId) return 'Kies eerst een bedrijf.'
      if (!factuurdatum) return 'Vul een factuurdatum in.'
      return null
    }
    if (nummer === 2) {
      if (regels.length === 0) return 'Kies minstens één dienst of voeg een lege regel toe.'
      for (const regel of regels) {
        if (regel.ritnummers.length > 0 && (!regel.datumVan || !regel.datumTot)) {
          return `Vul de periode in voor ${regelKop(regel.ritnummers).toLowerCase()}.`
        }
        if (regel.datumVan && regel.datumTot && regel.datumTot < regel.datumVan) {
          return 'De einddatum mag niet voor de begindatum liggen.'
        }
        if (!regel.omschrijving.trim()) {
          return 'Elke regel heeft een omschrijving nodig.'
        }
      }
      return null
    }
    if (nummer === 3) {
      for (const regel of regels) {
        const bedrag = Number(regel.bedrag)
        if (regel.bedrag === '' || !isFinite(bedrag)) {
          return 'Vul bij elke regel een bedrag in.'
        }
      }
      return null
    }
    return null
  }

  const volgende = () => {
    const fout = stapGeldig(stap)
    if (fout) {
      toast.error(fout)
      return
    }
    setStap((s) => Math.min(5, s + 1))
  }

  const vorige = () => setStap((s) => Math.max(1, s - 1))

  const bedrijfWisselen = (nieuwId: string) => {
    if (regels.length > 0 && nieuwId !== bedrijfId) {
      setBevestiging({
        title: 'Ander bedrijf kiezen?',
        message: 'De regels die je al hebt gekozen worden dan gewist.',
        confirmLabel: 'Wissen en doorgaan',
        variant: 'warning',
        onConfirm: () => {
          setRegels([])
          setSamenvoegen(false)
          setSamenvoegGevraagd(false)
          setBedrijfId(nieuwId)
        },
      })
      return
    }
    setBedrijfId(nieuwId)
  }

  // ------------------------------------------------------------- aanmaken

  const vraagAanmaken = () => {
    if (!gekozenConfig) return
    setBevestiging({
      title: 'Factuur definitief maken?',
      message: (
        <>
          Je maakt een factuur van <strong>{euro(totaal)}</strong> voor{' '}
          <strong>{gekozenConfig.bedrijf_naam}</strong>. De factuur wordt meteen
          definitief en kan daarna niet meer gewijzigd worden.
        </>
      ),
      confirmLabel: 'Ja, aanmaken',
      variant: 'info',
      onConfirm: doeAanmaken,
    })
  }

  const doeAanmaken = async () => {
    if (!gekozenConfig) return
    const invoerRegels: WizardRegelInput[] = regels.map((regel) => ({
      ritnummers: regel.ritnummers,
      datum_van: regel.datumVan || null,
      datum_tot: regel.datumTot || null,
      omschrijving: regel.omschrijving.trim(),
      bedrag: String(Number(regel.bedrag)),
    }))

    try {
      setAanmaken(true)
      const nieuw = await maakWizardFactuur({
        bedrijf: gekozenConfig.bedrijf,
        factuurdatum,
        regels: invoerRegels,
        opmerkingen,
        definitief: true,
      })
      setFactuur(nieuw)
      setStap(5)
      toast.success(`Factuur ${nieuw.factuurnummer} is aangemaakt`)

      try {
        const lijst = await getMailingContacts(gekozenConfig.bedrijf)
        // Bewust niets voorselecteren: de gebruiker kiest zelf naar wie de
        // factuur gaat.
        setContacten(lijst.filter((c) => c.is_active))
      } catch {
        setContacten([])
      }
    } catch (err: unknown) {
      console.error(err)
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data
      const melding =
        data && typeof data === 'object'
          ? Object.values(data).flat().join(' ')
          : 'De factuur kon niet worden aangemaakt'
      toast.error(String(melding).slice(0, 200))
    } finally {
      setAanmaken(false)
    }
  }

  // --------------------------------------------------------------- mailen

  const mailAanUit = (adres: string) => {
    setGekozenMails((vorig) => {
      const nieuw = new Set(vorig)
      if (nieuw.has(adres)) nieuw.delete(adres)
      else nieuw.add(adres)
      return nieuw
    })
  }

  const extraMailToevoegen = () => {
    const adres = extraMail.trim()
    if (!adres) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) {
      toast.error('Dat is geen geldig e-mailadres')
      return
    }
    setGekozenMails((vorig) => new Set(vorig).add(adres))
    setExtraMail('')
  }

  const versturenNu = async () => {
    if (!factuur) return
    const adressen = Array.from(gekozenMails)
    if (adressen.length === 0) {
      toast.error('Kies minstens één e-mailadres')
      return
    }
    if (profielen.length > 0 && !mailProfiel) {
      toast.error('Kies eerst het profiel waarmee je wilt mailen')
      return
    }
    try {
      setVersturen(true)
      await sendInvoiceEmail(factuur.id, undefined, adressen, false, mailProfiel || undefined)
      setVerzonden(true)
      toast.success('De factuur is verstuurd')
    } catch (err) {
      console.error(err)
      toast.error('Versturen is mislukt')
    } finally {
      setVersturen(false)
    }
  }

  // ------------------------------------------------------------- downloaden

  const factuurDownloaden = async () => {
    if (!factuur) return
    try {
      setDownloaden(true)
      await generatePdf(factuur.id, true)
      toast.success('De factuur is gedownload')
    } catch (err) {
      console.error(err)
      toast.error('Downloaden is mislukt')
    } finally {
      setDownloaden(false)
    }
  }

  /** Opent het mailgedeelte en haalt daarbij de profielen op. */
  const mailenOpenen = async () => {
    setMailenOpen(true)
    if (profielen.length > 0) return
    try {
      setProfielen(await listEmailProfiles())
    } catch {
      setProfielen([])
    }
  }

  // ----------------------------------------------------------------- beeld

  if (laden) {
    return <div className="card py-12 text-center text-gray-500">Bezig met laden…</div>
  }

  if (opties.length === 0) {
    return (
      <div className="card py-12 text-center">
        <BuildingOfficeIcon className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-3 text-sm text-gray-500">
          Er is nog geen bedrijf voor de wizard ingesteld. Vraag een beheerder om dit
          onder <span className="font-medium">Factuurwizard instellen</span> te doen.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Factuur maken</h1>
        <p className="mt-1 text-sm text-gray-500">
          Loop de stappen door om in een paar handelingen een factuur te maken.
        </p>
      </div>

      {/* Stappenbalk */}
      <ol className="card flex items-center gap-1 overflow-x-auto py-3 sm:gap-2">
        {STAPPEN.map((s, index) => {
          const gedaan = s.nummer < stap
          const nu = s.nummer === stap
          return (
            <li key={s.nummer} className="flex flex-1 items-center gap-1 sm:gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={clsx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    gedaan
                      ? 'bg-primary-600 text-white'
                      : nu
                        ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-500'
                        : 'bg-gray-100 text-gray-400'
                  )}
                >
                  {gedaan ? <CheckIcon className="h-4 w-4" /> : s.nummer}
                </span>
                <span
                  className={clsx(
                    'hidden truncate text-sm sm:inline',
                    nu ? 'font-semibold text-gray-900' : 'text-gray-500'
                  )}
                >
                  {s.label}
                </span>
              </div>
              {index < STAPPEN.length - 1 && (
                <span
                  className={clsx(
                    'h-0.5 flex-1 rounded',
                    gedaan ? 'bg-primary-600' : 'bg-gray-200'
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>

      {/* Stap 1: bedrijf */}
      {stap === 1 && (
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-gray-900">
            1. Kies het bedrijf aan wie je wilt factureren
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {opties.map((optie) => (
              <button
                key={optie.id}
                type="button"
                onClick={() => bedrijfWisselen(optie.bedrijf)}
                className={clsx(
                  'rounded-lg border p-4 text-left transition-colors',
                  optie.bedrijf === bedrijfId
                    ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">
                      {optie.bedrijf_naam}
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-500">
                      Template: {optie.template_naam}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {optie.diensten.length} dienst
                      {optie.diensten.length === 1 ? '' : 'en'} · BTW{' '}
                      {Number(optie.btw_percentage)}%
                    </span>
                  </span>
                  {optie.bedrijf === bedrijfId && (
                    <CheckCircleIcon className="h-5 w-5 shrink-0 text-primary-600" />
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t pt-4 sm:max-w-xs">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Factuurdatum
            </label>
            <input
              type="date"
              className="input w-full"
              value={factuurdatum}
              onChange={(e) => setFactuurdatum(e.target.value)}
            />
            {vervaldatum && (
              <p className="mt-1 text-xs text-gray-500">
                Vervaldatum wordt {nlDatum(vervaldatum)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stap 2: diensten */}
      {stap === 2 && gekozenConfig && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="text-base font-semibold text-gray-900">
              2. Voor welke dienst(en) factureer je {gekozenConfig.bedrijf_naam}?
            </h2>
            {gekozenConfig.diensten.length === 0 ? (
              <p className="text-sm text-gray-500">
                Voor dit bedrijf zijn geen diensten ingesteld. Je kunt wel losse regels
                toevoegen.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {gekozenConfig.diensten.map((dienst) => {
                  const aan = gekozenRoutes.has(dienst.ritnummer)
                  return (
                    <button
                      key={dienst.id}
                      type="button"
                      onClick={() => dienstAanUit(dienst.ritnummer)}
                      className={clsx(
                        'flex items-center gap-2 rounded-lg border p-3 text-left transition-colors',
                        aan
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      <MapIcon
                        className={clsx(
                          'h-5 w-5 shrink-0',
                          aan ? 'text-primary-600' : 'text-gray-400'
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {dienst.ritnummer}
                        </span>
                        {dienst.omschrijving && (
                          <span className="block truncate text-xs text-gray-500">
                            {dienst.omschrijving}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <button type="button" onClick={legeRegelToevoegen} className="btn-secondary">
              <PlusIcon className="mr-2 h-5 w-5" />
              Lege regel toevoegen
            </button>
          </div>

          {/* Keuze: alles op één regel of elk een eigen regel */}
          {gekozenRoutes.size > 2 && (
            <div className="card space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Hoe komen de {gekozenRoutes.size} routes op de factuur?
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  Op één regel komen de routenummers achter elkaar in de omschrijving
                  te staan.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  { aan: false, titel: 'Elk een eigen regel', uitleg: 'Per route een eigen bedrag' },
                  { aan: true, titel: 'Samen op één regel', uitleg: 'Eén bedrag voor alle routes' },
                ].map((keuze) => (
                  <button
                    key={String(keuze.aan)}
                    type="button"
                    onClick={() => samenvoegenZetten(keuze.aan)}
                    className={clsx(
                      'rounded-lg border p-3 text-left transition-colors',
                      samenvoegen === keuze.aan
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    )}
                  >
                    <span className="block text-sm font-medium text-gray-900">
                      {keuze.titel}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {keuze.uitleg}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {regels.length > 0 && (
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Regels op de factuur ({regels.length})
              </h3>
              {regels.map((regel) => (
                <div key={regel.key} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {regelKop(regel.ritnummers)}
                    </span>
                    <button
                      type="button"
                      onClick={() => regelWeg(regel.key)}
                      className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Regel verwijderen"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Periode van {regel.ritnummers.length > 0 && '*'}
                      </label>
                      <input
                        type="date"
                        className="input w-full"
                        value={regel.datumVan}
                        onChange={(e) =>
                          regelWijzigen(regel.key, { datumVan: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Periode tot en met {regel.ritnummers.length > 0 && '*'}
                      </label>
                      <input
                        type="date"
                        className="input w-full"
                        value={regel.datumTot}
                        onChange={(e) =>
                          regelWijzigen(regel.key, { datumTot: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Omschrijving
                    </label>
                    <input
                      type="text"
                      className="input w-full"
                      maxLength={500}
                      placeholder="Omschrijving op de factuur"
                      value={regel.omschrijving}
                      onChange={(e) =>
                        regelWijzigen(regel.key, {
                          omschrijving: e.target.value,
                          omschrijvingHandmatig: true,
                        })
                      }
                    />
                    {regel.ritnummers.length > 0 && regel.omschrijvingHandmatig && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-primary-600 hover:underline"
                        onClick={() =>
                          regelWijzigen(regel.key, {
                            omschrijvingHandmatig: false,
                            omschrijving: maakOmschrijving(
                              regel.ritnummers,
                              regel.datumVan,
                              regel.datumTot
                            ),
                          })
                        }
                      >
                        Standaardtekst terugzetten
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stap 3: bedragen */}
      {stap === 3 && (
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-gray-900">
            3. Bedrag exclusief BTW
          </h2>
          <div className="space-y-3">
            {regels.map((regel) => (
              <div
                key={regel.key}
                className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {regel.omschrijving || '(geen omschrijving)'}
                  </p>
                  <p className="text-xs text-gray-500">Aantal: 1</p>
                </div>
                <div className="sm:w-44">
                  <label className="mb-1 block text-xs font-medium text-gray-600 sm:sr-only">
                    Bedrag excl. BTW
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      €
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      className="input w-full pl-7 text-right"
                      placeholder="0,00"
                      value={regel.bedrag}
                      onChange={(e) =>
                        regelWijzigen(regel.key, { bedrag: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t pt-3">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Opmerking op de factuur (optioneel)
            </label>
            <textarea
              className="input w-full"
              rows={2}
              maxLength={2000}
              value={opmerkingen}
              onChange={(e) => setOpmerkingen(e.target.value)}
            />
          </div>

          <dl className="ml-auto w-full space-y-1 border-t pt-3 text-sm sm:w-64">
            <div className="flex justify-between">
              <dt className="text-gray-500">Subtotaal</dt>
              <dd className="font-medium text-gray-900">{euro(subtotaal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">BTW {btwPercentage}%</dt>
              <dd className="font-medium text-gray-900">{euro(btwBedrag)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 text-base">
              <dt className="font-semibold text-gray-900">Totaal</dt>
              <dd className="font-semibold text-gray-900">{euro(totaal)}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Stap 4: controle */}
      {stap === 4 && gekozenConfig && (
        <div className="card space-y-5">
          <h2 className="text-base font-semibold text-gray-900">
            4. Controleer de factuur
          </h2>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Factuur aan
                </p>
                <p className="truncate text-lg font-semibold text-gray-900">
                  {gekozenConfig.bedrijf_naam}
                </p>
                <p className="text-xs text-gray-500">
                  Template: {gekozenConfig.template_naam}
                  {gekozenConfig.administratie_naam
                    ? ` · ${gekozenConfig.administratie_naam}`
                    : ''}
                </p>
              </div>
              <dl className="shrink-0 space-y-0.5 text-sm sm:text-right">
                <div className="flex gap-2 sm:justify-end">
                  <dt className="text-gray-500">Factuurnummer</dt>
                  <dd className="font-medium text-gray-900">
                    {verwachtNummer || '…'}
                  </dd>
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <dt className="text-gray-500">Factuurdatum</dt>
                  <dd className="font-medium text-gray-900">{nlDatum(factuurdatum)}</dd>
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <dt className="text-gray-500">Vervaldatum</dt>
                  <dd className="font-medium text-gray-900">{nlDatum(vervaldatum)}</dd>
                </div>
              </dl>
            </div>

            {/* Regels: tabel op desktop, lijst op mobiel */}
            <div className="hidden py-2 sm:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-2 font-medium">Omschrijving</th>
                    <th className="w-20 py-2 pr-2 text-right font-medium">Aantal</th>
                    <th className="w-32 py-2 text-right font-medium">Bedrag</th>
                  </tr>
                </thead>
                <tbody>
                  {regels.map((regel) => (
                    <tr key={regel.key} className="border-b border-gray-100">
                      <td className="py-2 pr-2 text-gray-900">{regel.omschrijving}</td>
                      <td className="py-2 pr-2 text-right text-gray-700">1</td>
                      <td className="py-2 text-right text-gray-900">
                        {euro(Number(regel.bedrag) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 py-3 sm:hidden">
              {regels.map((regel) => (
                <div
                  key={regel.key}
                  className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2"
                >
                  <span className="min-w-0 text-sm text-gray-900">{regel.omschrijving}</span>
                  <span className="shrink-0 text-sm font-medium text-gray-900">
                    {euro(Number(regel.bedrag) || 0)}
                  </span>
                </div>
              ))}
            </div>

            <dl className="ml-auto w-full space-y-1 pt-2 text-sm sm:w-64">
              <div className="flex justify-between">
                <dt className="text-gray-500">Subtotaal</dt>
                <dd className="text-gray-900">{euro(subtotaal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">BTW {btwPercentage}%</dt>
                <dd className="text-gray-900">{euro(btwBedrag)}</dd>
              </div>
              <div className="flex justify-between border-t border-gray-300 pt-1 text-base">
                <dt className="font-semibold text-gray-900">Totaal</dt>
                <dd className="font-semibold text-gray-900">{euro(totaal)}</dd>
              </div>
            </dl>

            {opmerkingen && (
              <p className="mt-3 border-t border-gray-200 pt-3 text-sm text-gray-600">
                {opmerkingen}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stap 5: afronden */}
      {stap === 5 && factuur && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-start gap-3">
              <CheckCircleIcon className="h-8 w-8 shrink-0 text-green-600" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">
                  Factuur {factuur.factuurnummer} is opgeslagen en definitief
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {factuur.bedrijf_naam} · {euro(Number(factuur.totaal))}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn-primary"
                onClick={factuurDownloaden}
                disabled={downloaden}
              >
                <ArrowDownTrayIcon className="mr-2 h-5 w-5" />
                {downloaden ? 'Bezig…' : 'Factuur downloaden'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void mailenOpenen()}
                disabled={verzonden}
              >
                <EnvelopeIcon className="mr-2 h-5 w-5" />
                Factuur mailen
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void openPdfInNewTab(factuur.id)}
              >
                <DocumentTextIcon className="mr-2 h-5 w-5" />
                PDF bekijken
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => navigate(`/invoices?bedrijf=${factuur.bedrijf}`)}
              >
                Naar het factuuroverzicht
              </button>
            </div>
          </div>

          {verzonden ? (
            <div className="card flex items-start gap-3">
              <PaperAirplaneIcon className="h-6 w-6 shrink-0 text-green-600" />
              <p className="text-sm text-gray-700">
                De factuur is gemaild naar {Array.from(gekozenMails).join(', ')}.
              </p>
            </div>
          ) : mailenOpen ? (
            <div className="card space-y-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  5. Factuur mailen (optioneel)
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Kies naar wie de factuur gestuurd moet worden, of sla deze stap over.
                </p>
              </div>

              {contacten.length > 0 ? (
                <div className="space-y-1">
                  {contacten.map((contact) => (
                    <label
                      key={contact.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg p-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        checked={gekozenMails.has(contact.email)}
                        onChange={() => mailAanUit(contact.email)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900">
                          {contact.naam || contact.email}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {contact.email}
                          {contact.functie ? ` · ${contact.functie}` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Voor dit bedrijf staan geen contactpersonen in de mailinglijst.
                </p>
              )}

              {/* Handmatig toegevoegde adressen */}
              {Array.from(gekozenMails)
                .filter((adres) => !contacten.some((c) => c.email === adres))
                .map((adres) => (
                  <div
                    key={adres}
                    className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <span className="truncate text-sm text-gray-700">{adres}</span>
                    <button
                      type="button"
                      onClick={() => mailAanUit(adres)}
                      className="shrink-0 rounded p-1 text-gray-400 hover:text-red-600"
                      aria-label="Adres verwijderen"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  className="input w-full sm:flex-1"
                  placeholder="Extra e-mailadres"
                  value={extraMail}
                  onChange={(e) => setExtraMail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      extraMailToevoegen()
                    }
                  }}
                />
                <button type="button" className="btn-secondary" onClick={extraMailToevoegen}>
                  <PlusIcon className="mr-2 h-5 w-5" />
                  Toevoegen
                </button>
              </div>

              <EmailProfielKeuze
                profielen={profielen}
                waarde={mailProfiel}
                onKies={setMailProfiel}
              />

              <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setMailenOpen(false)}
                >
                  Toch niet mailen
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={versturenNu}
                  disabled={versturen || gekozenMails.size === 0}
                >
                  <EnvelopeIcon className="mr-2 h-5 w-5" />
                  {versturen ? 'Bezig met versturen…' : 'Versturen'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                Klaar. Je kunt de factuur downloaden, mailen of teruggaan naar het
                overzicht.
              </p>
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => navigate('/invoices')}
              >
                Ik ben klaar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navigatieknoppen */}
      {stap < 5 && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button
            type="button"
            className="btn-secondary"
            onClick={stap === 1 ? () => navigate('/invoices') : vorige}
            disabled={aanmaken}
          >
            <ArrowLeftIcon className="mr-2 h-5 w-5" />
            {stap === 1 ? 'Annuleren' : 'Vorige'}
          </button>
          {stap < 4 ? (
            <button type="button" className="btn-primary" onClick={volgende}>
              Volgende
              <ArrowRightIcon className="ml-2 h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={vraagAanmaken}
              disabled={aanmaken}
            >
              <CheckCircleIcon className="mr-2 h-5 w-5" />
              {aanmaken ? 'Bezig…' : 'Factuur aanmaken'}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog state={bevestiging} onClose={() => setBevestiging(null)} />
    </div>
  )
}
