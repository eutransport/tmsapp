/**
 * Tolafrekening van de opdrachtgever inlezen en controleren.
 *
 * Upload de PDF die de opdrachtgever per periode stuurt. De pagina leest het
 * ritnummer en de tolvergoeding (Maut) per voertuig, zoekt het bijbehorende
 * kenteken in de vloot en zet daar de tolheffing naast die wij in dezelfde
 * periode werkelijk betaald hebben.
 *
 * Het overzicht is te bekijken per week, maand, kwartaal, jaar, over alles of
 * over één losse bon. Een bon telt mee in de periode waarin hij *begint*, zodat
 * een bon nooit over twee perioden verdeeld of dubbel geteld wordt. Vallen er
 * meerdere bonnen in de periode, dan worden de vergoedingen opgeteld en worden
 * de tolpassages één keer over het geheel van de perioden geteld.
 *
 * Passages worden verdeeld over drie tijdvakken: binnen de werkdag (standaard
 * 06:00-18:00, maandag t/m vrijdag), in het weekend en 's avonds of 's nachts.
 * De vergoeding van de opdrachtgever hoort de werkdag te dekken; wat daarbuiten
 * gereden is, is het bedrag dat wij te weinig ontvangen hebben.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  TableCellsIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

import {
  AfrekeningOverzicht,
  AfrekeningPassage,
  AfrekeningRegel,
  AfrekeningSignaal,
  PassageGroep,
  PeriodeSoort,
  SelectieParams,
  tolAfrekeningApi,
} from '@/api/tolAfrekening'

const MAX_UPLOAD_MB = 25
/** Aantal voertuigregels per pagina. */
const PER_PAGINA = 10

const SOORTEN: { waarde: PeriodeSoort; label: string }[] = [
  { waarde: 'week', label: 'Week' },
  { waarde: 'maand', label: 'Maand' },
  { waarde: 'kwartaal', label: 'Kwartaal' },
  { waarde: 'jaar', label: 'Jaar' },
  { waarde: 'alles', label: 'Alles' },
]

function currency(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function kmFmt(n: number): string {
  return `${(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 0 })} km`
}

function korteDatum(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function tijdstip(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function periodeLabel(van: string | null, tot: string | null): string {
  if (!van || !tot) return '—'
  return `${korteDatum(van)} t/m ${korteDatum(tot)}`
}

/** Foutmelding van de server tonen, met een leesbare terugval. */
function meldFout(fout: unknown, terugval: string): void {
  const detail = (fout as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  toast.error(detail || terugval)
}

const SIGNAAL: Record<AfrekeningSignaal, { label: string; klasse: string; uitleg: string }> = {
  ok: {
    label: 'Gedekt',
    klasse: 'bg-green-100 text-green-800 border-green-200',
    uitleg: 'De vergoeding dekt de tolheffing van deze wagen.',
  },
  tekort: {
    label: 'Tekort',
    klasse: 'bg-amber-100 text-amber-800 border-amber-200',
    uitleg: 'Wij betaalden meer tolheffing dan de opdrachtgever vergoedde.',
  },
  geen_tolregels: {
    label: 'Geen tolregels',
    klasse: 'bg-red-100 text-red-800 border-red-200',
    uitleg: 'Er is wel vergoed, maar er staat geen enkele tolpassage op dit kenteken. '
      + 'Controleer of het kenteken in de tolimport klopt.',
  },
  geen_vergoeding: {
    label: 'Niet vergoed',
    klasse: 'bg-orange-100 text-orange-800 border-orange-200',
    uitleg: 'Deze wagen kostte tolheffing maar staat zonder vergoeding op de afrekening.',
  },
  niet_gekoppeld: {
    label: 'Geen wagen',
    klasse: 'bg-gray-100 text-gray-700 border-gray-200',
    uitleg: 'Dit ritnummer hoort bij geen enkele wagen in de vloot.',
  },
}

const TIJDVAK_LABEL: Record<AfrekeningPassage['tijdvak'], string> = {
  binnen: 'Werkdag',
  weekend: 'Weekend',
  avond: 'Avond/nacht',
}

const TIJDVAK_KLASSE: Record<AfrekeningPassage['tijdvak'], string> = {
  binnen: 'bg-green-50 text-green-700',
  weekend: 'bg-purple-50 text-purple-700',
  avond: 'bg-blue-50 text-blue-700',
}

interface KaartProps {
  titel: string
  waarde: string
  bijschrift?: string
  klasse?: string
}

function Kaart({ titel, waarde, bijschrift, klasse = 'text-gray-900' }: KaartProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{titel}</p>
      <p className={`mt-1 text-xl font-semibold ${klasse}`}>{waarde}</p>
      {bijschrift && <p className="mt-1 text-xs text-gray-500">{bijschrift}</p>}
    </div>
  )
}

/** Kolommen van de passagelijst; het ritnummer staat voorop zodat in het
 *  bestand altijd duidelijk is bij welke wagen een passage hoort. */
const PASSAGE_KOLOMMEN = [
  'Rit', 'Voertuig', 'Kenteken wagen', 'Datum', 'Tijd', 'Tijdvak',
  'Kenteken passage', 'Km', 'Bedrag', 'Soort', 'Status',
]

function passageRijen(groep: PassageGroep): (string | number)[][] {
  return groep.passages.map((p) => {
    const moment = new Date(p.start_at)
    return [
      groep.ritnummer,
      groep.voertuig_label,
      groep.kenteken || '—',
      moment.toLocaleDateString('nl-NL'),
      moment.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
      TIJDVAK_LABEL[p.tijdvak],
      p.kenteken,
      p.km,
      p.bedrag,
      p.prive ? 'privé' : 'zakelijk',
      p.gefactureerd ? 'gefactureerd' : 'open',
    ]
  })
}

/** Telling per wagen, voor het samenvattingsblad van de export. */
function groepTotaal(groep: PassageGroep) {
  const zakelijk = groep.passages.filter((p) => !p.prive)
  const som = (vak: AfrekeningPassage['tijdvak']) => zakelijk
    .filter((p) => p.tijdvak === vak)
    .reduce((totaal, p) => totaal + p.bedrag, 0)
  return {
    aantal: zakelijk.length,
    bedrag: zakelijk.reduce((totaal, p) => totaal + p.bedrag, 0),
    binnen: som('binnen'),
    weekend: som('weekend'),
    avond: som('avond'),
  }
}

async function passagesNaarExcel(
  groepen: PassageGroep[],
  titel: string,
  werktijd: string,
  naam: string,
): Promise<void> {
  const ExcelJS = await import('exceljs')
  const werkboek = new ExcelJS.Workbook()

  const blad = werkboek.addWorksheet('Tolpassages')
  blad.addRow([`Tolpassages ${titel}`])
  blad.addRow([`Werkdag: ${werktijd}`])
  blad.addRow([`${groepen.length} voertuig(en), `
    + `${groepen.reduce((n, g) => n + g.passages.length, 0)} passages`])
  blad.addRow([])
  blad.getRow(1).font = { bold: true, size: 14 }

  const kop = blad.addRow(PASSAGE_KOLOMMEN)
  kop.font = { bold: true }
  groepen.forEach((groep) => passageRijen(groep).forEach((rij) => blad.addRow(rij)))
  // Filterknoppen op de kop, zodat er in Excel per rit gefilterd kan worden.
  blad.autoFilter = {
    from: { row: kop.number, column: 1 },
    to: { row: kop.number, column: PASSAGE_KOLOMMEN.length },
  }
  blad.views = [{ state: 'frozen', ySplit: kop.number }]
  blad.columns.forEach((kolom) => { kolom.width = 17 })

  const samenvatting = werkboek.addWorksheet('Per rit')
  samenvatting.addRow([`Samenvatting ${titel}`])
  samenvatting.getRow(1).font = { bold: true, size: 14 }
  samenvatting.addRow([])
  const kop2 = samenvatting.addRow([
    'Rit', 'Voertuig', 'Kenteken', 'Periode van', 'Periode tot',
    'Passages', 'Totaal', 'Werkdag', 'Weekend', 'Avond/nacht',
  ])
  kop2.font = { bold: true }
  groepen.forEach((groep) => {
    const t = groepTotaal(groep)
    samenvatting.addRow([
      groep.ritnummer, groep.voertuig_label, groep.kenteken || '—',
      groep.periode_van ? korteDatum(groep.periode_van) : '—',
      groep.periode_tot ? korteDatum(groep.periode_tot) : '—',
      t.aantal, t.bedrag, t.binnen, t.weekend, t.avond,
    ])
  })
  samenvatting.columns.forEach((kolom) => { kolom.width = 15 })

  const buffer = await werkboek.xlsx.writeBuffer()
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  link.href = url
  link.download = `${naam}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

function passagesNaarPdf(
  groepen: PassageGroep[],
  titel: string,
  werktijd: string,
  naam: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(`Tolpassages ${titel}`, 14, 16)
  doc.setFontSize(10)
  doc.text(`Werkdag ${werktijd}  •  ${groepen.length} voertuig(en)  •  `
    + `${groepen.reduce((n, g) => n + g.passages.length, 0)} passages`, 14, 23)

  let y = 30
  groepen.forEach((groep, nummer) => {
    const t = groepTotaal(groep)
    if (nummer > 0) doc.addPage()
    y = nummer > 0 ? 16 : y
    doc.setFontSize(12)
    doc.text(
      `Rit ${groep.ritnummer} — ${groep.voertuig_label}`
      + `${groep.kenteken ? ` (${groep.kenteken})` : ''}`,
      14, y,
    )
    doc.setFontSize(9)
    doc.text(
      `${periodeLabel(groep.periode_van, groep.periode_tot)}  •  `
      + `${t.aantal} passages  •  ${currency(t.bedrag)} `
      + `(werkdag ${currency(t.binnen)}, weekend ${currency(t.weekend)}, `
      + `avond/nacht ${currency(t.avond)})`,
      14, y + 5,
    )
    autoTable(doc, {
      startY: y + 9,
      // Het ritnummer blijft in de tabel staan, ook na een paginawissel.
      head: [PASSAGE_KOLOMMEN],
      body: passageRijen(groep).map((rij) => rij.map((cel, i) => (
        i === 8 ? currency(Number(cel))
          : i === 7 ? Number(cel).toLocaleString('nl-NL', { maximumFractionDigits: 1 })
            : String(cel)
      ))),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [31, 41, 55] },
    })
  })
  doc.save(`${naam}.pdf`)
}

export default function TolAfrekeningPage() {
  const [selectie, setSelectie] = useState<SelectieParams>({ periode: 'maand' })
  const [data, setData] = useState<AfrekeningOverzicht | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [uploaden, setUploaden] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [passages, setPassages] = useState<Record<string, AfrekeningPassage[]>>({})
  const [bevestigVerwijder, setBevestigVerwijder] = useState<string | null>(null)
  const [werktijdVan, setWerktijdVan] = useState('06:00')
  const [werktijdTot, setWerktijdTot] = useState('18:00')
  const [pagina, setPagina] = useState(1)
  const bestandRef = useRef<HTMLInputElement>(null)

  /** Het overzicht opnieuw ophalen; dit is ook de terugval na elke bewerking. */
  const haalOp = useCallback(async (keuze: SelectieParams) => {
    const uitkomst = await tolAfrekeningApi.overzicht(keuze)
    setData(uitkomst)
    setOpen(null)
    setPassages({})
    return uitkomst
  }, [])

  useEffect(() => {
    let actief = true
    setBezig(true)
    ;(async () => {
      try {
        const uitkomst = await tolAfrekeningApi.overzicht(selectie)
        if (!actief) return
        setData(uitkomst)
        setOpen(null)
        setPassages({})
        setPagina(1)
      } catch (fout) {
        if (actief) meldFout(fout, 'Het overzicht kon niet worden geladen.')
      } finally {
        if (actief) {
          setLaden(false)
          setBezig(false)
        }
      }
    })()
    return () => { actief = false }
  }, [selectie])

  useEffect(() => {
    if (!data) return
    setWerktijdVan(data.werktijd_van)
    setWerktijdTot(data.werktijd_tot)
  }, [data?.werktijd_van, data?.werktijd_tot])

  const regels = data?.regels ?? []
  const paginas = Math.max(1, Math.ceil(regels.length / PER_PAGINA))
  const huidigePagina = Math.min(pagina, paginas)
  const zichtbaar = useMemo(
    () => regels.slice((huidigePagina - 1) * PER_PAGINA, huidigePagina * PER_PAGINA),
    [regels, huidigePagina],
  )

  const kiesSoort = (nieuw: PeriodeSoort) => {
    // Zonder jaar en index kiest de server zelf de periode van de nieuwste bon.
    setSelectie(nieuw === 'alles' ? { periode: 'alles' } : { periode: nieuw })
  }

  const verschuif = (richting: 'vorige' | 'volgende') => {
    const doel = data?.filter[richting]
    if (!doel || !data) return
    setSelectie({ periode: data.filter.soort, jaar: doel.jaar, index: doel.index })
  }

  const upload = async (bestand: File) => {
    if (!bestand.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Kies een PDF-bestand.')
      return
    }
    if (bestand.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`Het bestand is te groot (maximaal ${MAX_UPLOAD_MB} MB).`)
      return
    }
    setUploaden(true)
    try {
      const nieuw = await tolAfrekeningApi.upload(bestand)
      toast.success(
        `Bon ${nieuw.bonnummer || nieuw.bestandsnaam} ingelezen: `
        + `${nieuw.totalen.voertuigen} voertuigen, `
        + `${currency(nieuw.totalen.ontvangen)} vergoeding.`,
      )
      // Meteen naar de zojuist ingelezen bon, ook als die in een andere
      // periode valt dan het huidige filter.
      setSelectie({ afrekening: nieuw.id })
    } catch (fout) {
      meldFout(fout, 'Het bestand kon niet worden ingelezen.')
    } finally {
      setUploaden(false)
      if (bestandRef.current) bestandRef.current.value = ''
    }
  }

  const pasWerktijdenAan = async () => {
    if (!data) return
    if (werktijdVan === werktijdTot) {
      toast.error('Begin- en eindtijd mogen niet gelijk zijn.')
      return
    }
    setBezig(true)
    try {
      setData(await tolAfrekeningApi.werktijden(selectie, werktijdVan, werktijdTot))
      setPassages({})
      toast.success('Werktijden aangepast voor alle bonnen in deze periode.')
    } catch (fout) {
      meldFout(fout, 'De werktijden konden niet worden aangepast.')
    } finally {
      setBezig(false)
    }
  }

  const ververs = async () => {
    setBezig(true)
    try {
      await haalOp(selectie)
      toast.success('Overzicht bijgewerkt.')
    } catch (fout) {
      meldFout(fout, 'Het overzicht kon niet worden ververst.')
    } finally {
      setBezig(false)
    }
  }

  const herkoppel = async () => {
    setBezig(true)
    try {
      const uitkomst = await tolAfrekeningApi.herkoppel(selectie)
      setData(uitkomst.analyse)
      setPassages({})
      toast.success(uitkomst.aangepast
        ? `${uitkomst.aangepast} regels opnieuw aan de vloot gekoppeld.`
        : 'De koppeling was al bij de tijd.')
    } catch (fout) {
      meldFout(fout, 'Het opnieuw koppelen is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const markeer = async () => {
    setBezig(true)
    try {
      const uitkomst = await tolAfrekeningApi.markeerGefactureerd(selectie)
      setData(uitkomst.analyse)
      setPassages({})
      toast.success(uitkomst.gemarkeerd
        ? `${uitkomst.gemarkeerd} tolregels binnen de werktijd op gefactureerd gezet.`
        : 'Er stond niets meer open binnen de werktijd.')
    } catch (fout) {
      meldFout(fout, 'Het markeren is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const draaiTerug = async () => {
    setBezig(true)
    try {
      const uitkomst = await tolAfrekeningApi.markeringOngedaan(selectie)
      setData(uitkomst.analyse)
      setPassages({})
      toast.success(uitkomst.teruggedraaid
        ? `${uitkomst.teruggedraaid} tolregels weer opengezet.`
        : 'Er was niets terug te draaien.')
    } catch (fout) {
      meldFout(fout, 'Het terugdraaien is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const verwijder = async (id: string) => {
    setBezig(true)
    try {
      await tolAfrekeningApi.verwijder(id)
      setBevestigVerwijder(null)
      if (selectie.afrekening === id) {
        // De getoonde bon bestaat niet meer; terug naar het maandoverzicht.
        setSelectie({ periode: 'maand' })
      } else {
        await haalOp(selectie)
      }
      toast.success('Afrekening verwijderd.')
    } catch (fout) {
      meldFout(fout, 'Verwijderen is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const klapUit = async (regel: AfrekeningRegel) => {
    if (open === regel.id) {
      setOpen(null)
      return
    }
    setOpen(regel.id)
    if (passages[regel.id]) return
    try {
      const uitkomst = await tolAfrekeningApi.passages(selectie, regel.ritnummer || regel.id)
      setPassages((vorig) => ({ ...vorig, [regel.id]: uitkomst.passages }))
    } catch (fout) {
      meldFout(fout, 'De tolpassages konden niet worden opgehaald.')
    }
  }

  const exportKolommen = useMemo(() => ([
    'Rit', 'Voertuig', 'Kenteken', 'Status', 'Bonnen', 'Dagen', 'Ritten',
    'Km afrekening', 'Ontvangen', 'Betaald', 'Verschil',
    'Werkdag', 'Weekend', 'Avond/nacht', 'Passages',
  ]), [])

  const exportRijen = useCallback((rijen: AfrekeningRegel[]) => rijen.map((r) => ([
    r.ritnummer,
    r.voertuig_label,
    r.kenteken || '—',
    SIGNAAL[r.signaal].label,
    r.afrekeningen,
    r.inzetdagen,
    r.ritten,
    r.kilometers_afrekening,
    r.ontvangen,
    r.betaald,
    r.verschil,
    r.binnen_bedrag,
    r.weekend_bedrag,
    r.avond_bedrag,
    r.passages,
  ])), [])

  const bestandsnaam = data
    ? `tolafrekening-${data.filter.label.replace(/[^\w]+/g, '-').toLowerCase()}`
    : 'tolafrekening'

  /** De passages van één wagen exporteren; die staan al op het scherm. */
  const exporteerRegel = async (regel: AfrekeningRegel, soort: 'excel' | 'pdf') => {
    const rijen = passages[regel.id]
    if (!rijen || !data) return
    const groep: PassageGroep = {
      ritnummer: regel.ritnummer,
      voertuig_label: regel.voertuig_label,
      kenteken: regel.kenteken,
      periode_van: regel.periode_van,
      periode_tot: regel.periode_tot,
      passages: rijen,
    }
    const titel = `rit ${regel.ritnummer} — ${data.filter.label}`
    const werktijd = `${data.werktijd_van} - ${data.werktijd_tot}`
    const naam = `tolpassages-rit-${regel.ritnummer}-`
      + `${data.filter.label.replace(/[^\w]+/g, '-').toLowerCase()}`
    try {
      if (soort === 'excel') await passagesNaarExcel([groep], titel, werktijd, naam)
      else passagesNaarPdf([groep], titel, werktijd, naam)
    } catch {
      toast.error('De export van de passages is niet gelukt.')
    }
  }

  /** Alle passages van de periode exporteren, gegroepeerd per ritnummer. */
  const exporteerAllePassages = async (soort: 'excel' | 'pdf') => {
    if (!data) return
    setBezig(true)
    try {
      const alles = await tolAfrekeningApi.allePassages(selectie)
      const gevuld = alles.groepen.filter((g) => g.passages.length > 0)
      if (gevuld.length === 0) {
        toast.error('Er zijn geen tolpassages in deze periode.')
        return
      }
      const werktijd = `${alles.werktijd_van} - ${alles.werktijd_tot}`
      const naam = `tolpassages-${alles.label.replace(/[^\w]+/g, '-').toLowerCase()}`
      if (soort === 'excel') await passagesNaarExcel(gevuld, alles.label, werktijd, naam)
      else passagesNaarPdf(gevuld, alles.label, werktijd, naam)
      toast.success(
        `${gevuld.reduce((n, g) => n + g.passages.length, 0)} passages van `
        + `${gevuld.length} voertuigen geëxporteerd.`,
      )
    } catch (fout) {
      meldFout(fout, 'De export van de passages is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  const naarExcel = async () => {
    if (!data) return
    try {
      const ExcelJS = await import('exceljs')
      const werkboek = new ExcelJS.Workbook()
      const blad = werkboek.addWorksheet('Tolafrekening')
      blad.addRow([`Tolafrekening ${data.filter.label}`])
      blad.addRow([`Periode: ${periodeLabel(data.periode_van, data.periode_tot)}`])
      blad.addRow([`Werktijd: ${data.werktijd_van} - ${data.werktijd_tot}`])
      blad.addRow([`Opdrachtgever: ${data.bedrijf_naam || '—'}`])
      blad.addRow([`Bonnen: ${data.afrekeningen.map((a) => a.bonnummer).join(', ') || '—'}`])
      blad.addRow([])
      blad.getRow(1).font = { bold: true, size: 14 }

      const kop = blad.addRow(exportKolommen)
      kop.font = { bold: true }
      // De export bevat alle regels, niet alleen de zichtbare pagina.
      exportRijen(data.regels).forEach((rij) => blad.addRow(rij))

      const t = data.totalen
      const totaal = blad.addRow([
        'Totaal', '', '', '', '', t.inzetdagen, t.ritten, t.kilometers_afrekening,
        t.ontvangen, t.betaald, t.verschil, t.binnen_bedrag, t.weekend_bedrag,
        t.avond_bedrag, t.passages,
      ])
      totaal.font = { bold: true }
      blad.columns.forEach((kolom) => { kolom.width = 16 })

      const buffer = await werkboek.xlsx.writeBuffer()
      const link = document.createElement('a')
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      )
      link.href = url
      link.download = `${bestandsnaam}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('De Excel-export is niet gelukt.')
    }
  }

  const naarPdf = () => {    if (!data) return
    try {
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(`Tolafrekening ${data.filter.label}`, 14, 16)
      doc.setFontSize(10)
      doc.text(
        `Periode ${periodeLabel(data.periode_van, data.periode_tot)}  •  `
        + `werktijd ${data.werktijd_van}-${data.werktijd_tot}  •  `
        + `${data.bedrijf_naam || 'onbekende opdrachtgever'}  •  `
        + `${data.afrekeningen.length} bon(nen)`,
        14, 23,
      )
      const t = data.totalen
      autoTable(doc, {
        startY: 28,
        head: [exportKolommen],
        body: exportRijen(data.regels).map((rij) => rij.map((cel, i) => (
          i >= 8 && i <= 13 ? currency(Number(cel)) : String(cel)
        ))),
        foot: [[
          'Totaal', '', '', '', '', String(t.inzetdagen), String(t.ritten),
          kmFmt(t.kilometers_afrekening), currency(t.ontvangen), currency(t.betaald),
          currency(t.verschil), currency(t.binnen_bedrag), currency(t.weekend_bedrag),
          currency(t.avond_bedrag), String(t.passages),
        ]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [31, 41, 55] },
      })
      doc.save(`${bestandsnaam}.pdf`)
    } catch {
      toast.error('De PDF-export is niet gelukt.')
    }
  }

  if (laden) {    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-32 rounded bg-gray-200" />
        </div>
      </div>
    )
  }

  const t = data?.totalen
  const filter = data?.filter
  const kanVerschuiven = filter && filter.soort !== 'alles' && filter.soort !== 'afrekening'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tolafrekening opdrachtgever</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Lees de afrekeningen van de opdrachtgever in en vergelijk de ontvangen
            tolvergoeding met de tolheffing die wij werkelijk betaald hebben.
            Ritten in het weekend en na werktijd worden apart geteld: dat is wat
            wij te weinig ontvangen hebben.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={bestandRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const bestand = e.target.files?.[0]
              if (bestand) void upload(bestand)
            }}
          />
          <button
            type="button"
            onClick={() => bestandRef.current?.click()}
            disabled={uploaden}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <ArrowUpTrayIcon className="h-5 w-5" />
            {uploaden ? 'Bezig met inlezen…' : 'Afrekening uploaden'}
          </button>
        </div>
      </div>

      {/* Filterbalk: per week, maand, kwartaal, jaar of alles. */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-300">
            {SOORTEN.map((soort) => (
              <button
                key={soort.waarde}
                type="button"
                onClick={() => kiesSoort(soort.waarde)}
                className={`px-3 py-1.5 text-sm ${
                  filter?.soort === soort.waarde
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {soort.label}
              </button>
            ))}
          </div>

          {kanVerschuiven && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => verschuif('vorige')}
                disabled={bezig}
                title="Vorige periode"
                className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="min-w-[14rem] text-center text-sm font-medium text-gray-900">
                {filter?.label}
              </span>
              <button
                type="button"
                onClick={() => verschuif('volgende')}
                disabled={bezig}
                title="Volgende periode"
                className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          {!kanVerschuiven && (
            <span className="text-sm font-medium text-gray-900">{filter?.label}</span>
          )}

          {data && data.beschikbaar.length > 0 && (
            <label className="text-xs text-gray-600">
              Spring naar
              <select
                value={filter?.jaar != null && filter?.index != null
                  ? `${filter.jaar}-${filter.index}` : ''}
                onChange={(e) => {
                  const [jaar, index] = e.target.value.split('-').map(Number)
                  if (!Number.isNaN(jaar)) {
                    setSelectie({ periode: filter?.soort as PeriodeSoort, jaar, index })
                  }
                }}
                className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="">Periode met afrekeningen…</option>
                {data.beschikbaar.map((keuze) => (
                  <option key={`${keuze.jaar}-${keuze.index}`} value={`${keuze.jaar}-${keuze.index}`}>
                    {keuze.label} ({keuze.aantal})
                  </option>
                ))}
              </select>
            </label>
          )}

          {filter?.soort === 'afrekening' && (
            <button
              type="button"
              onClick={() => setSelectie({ periode: 'maand' })}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            >
              Terug naar maandoverzicht
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Een afrekening telt mee in de periode waarin hij <strong>begint</strong>. Zo wordt
          een bon die over twee maanden loopt nooit gesplitst of dubbel geteld. De
          tolpassages worden één keer geteld over alle bonperioden samen.
        </p>
      </div>

      {data && data.afrekeningen.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-10 text-center">
          <DocumentTextIcon className="mx-auto h-10 w-10 text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-900">
            Geen afrekening in {filter?.label}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Kies een andere periode of upload de PDF die u van de opdrachtgever ontvangt.
          </p>
        </div>
      )}

      {data && t && data.afrekeningen.length > 0 && (
        <>
          {/* Welke bonnen tellen mee, met hun eigen periode. */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
              {data.afrekeningen.length} afrekening(en) in {filter?.label}
              <span className="ml-2 font-normal text-gray-500">
                samen {periodeLabel(data.periode_van, data.periode_tot)}
              </span>
            </div>
            <div className="max-h-56 divide-y divide-gray-100 overflow-y-auto">
              {data.afrekeningen.map((bon) => (
                <div
                  key={bon.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50"
                >
                  <button
                    type="button"
                    onClick={() => setSelectie({ afrekening: bon.id })}
                    title="Alleen deze bon tonen"
                    className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left"
                  >
                    <span className="font-medium text-gray-900">
                      Bon {bon.bonnummer || bon.bestandsnaam}
                    </span>
                    <span className="text-gray-600">
                      {periodeLabel(bon.periode_van, bon.periode_tot)}
                    </span>
                    <span className="text-gray-600">{bon.voertuigen} voertuigen</span>
                    <span className="font-medium text-gray-900">
                      {currency(bon.totaal_maut)} vergoeding
                    </span>
                    <span className="text-xs text-gray-500">
                      ingelezen {tijdstip(bon.created_at)}
                      {bon.geuploaded_door && ` door ${bon.geuploaded_door}`}
                    </span>
                  </button>
                  {bevestigVerwijder === bon.id ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void verwijder(bon.id)}
                        disabled={bezig}
                        className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Definitief verwijderen
                      </button>
                      <button
                        type="button"
                        onClick={() => setBevestigVerwijder(null)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                      >
                        Annuleren
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBevestigVerwijder(bon.id)}
                      title="Afrekening verwijderen"
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1 text-sm">
                <p className="text-base font-semibold text-gray-900">
                  {filter?.label}
                  {data.bedrijf_naam && ` — ${data.bedrijf_naam}`}
                </p>
                <p className="text-gray-600">
                  Tolpassages van {periodeLabel(data.periode_van, data.periode_tot)}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-600">
                  Werkdag van
                  <input
                    type="time"
                    value={werktijdVan}
                    onChange={(e) => setWerktijdVan(e.target.value)}
                    className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-600">
                  tot
                  <input
                    type="time"
                    value={werktijdTot}
                    onChange={(e) => setWerktijdTot(e.target.value)}
                    className="ml-2 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void pasWerktijdenAan()}
                  disabled={bezig
                    || (werktijdVan === data.werktijd_van && werktijdTot === data.werktijd_tot)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Toepassen
                </button>
                <button
                  type="button"
                  onClick={() => void ververs()}
                  disabled={bezig}
                  title="Opnieuw berekenen met de huidige tolgegevens"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${bezig ? 'animate-spin' : ''}`} />
                  Verversen
                </button>
                <button
                  type="button"
                  onClick={() => void naarExcel()}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <TableCellsIcon className="h-4 w-4" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={naarPdf}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  PDF
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <span className="text-xs text-gray-600">
                Alle tolpassages van deze periode, per ritnummer gegroepeerd:
              </span>
              <button
                type="button"
                onClick={() => void exporteerAllePassages('excel')}
                disabled={bezig}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                <TableCellsIcon className="h-4 w-4" />
                Passages naar Excel
              </button>
              <button
                type="button"
                onClick={() => void exporteerAllePassages('pdf')}
                disabled={bezig}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                Passages naar PDF
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kaart
              titel="Ontvangen vergoeding"
              waarde={currency(t.ontvangen)}
              bijschrift={`${t.voertuigen} voertuigen • ${data.afrekeningen.length} bon(nen)`}
            />
            <Kaart
              titel="Zelf betaalde tolheffing"
              waarde={currency(t.betaald)}
              bijschrift={`${t.passages} passages • ${kmFmt(t.km_tol)}`}
            />
            <Kaart
              titel="Verschil"
              waarde={currency(t.verschil)}
              bijschrift={t.verschil > 0
                ? 'Wij betaalden méér tol dan vergoed is'
                : 'De vergoeding dekt de betaalde tolheffing'}
              klasse={t.verschil > 0 ? 'text-red-600' : 'text-green-700'}
            />
            <Kaart
              titel="Buiten werktijd gereden"
              waarde={currency(t.buiten_bedrag)}
              bijschrift={`weekend ${currency(t.weekend_bedrag)} • `
                + `avond/nacht ${currency(t.avond_bedrag)}`}
              klasse={t.buiten_bedrag > 0 ? 'text-purple-700' : 'text-gray-900'}
            />
          </div>

          {data.waarschuwingen.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <ExclamationTriangleIcon className="h-5 w-5" />
                  Let op ({data.waarschuwingen.length})
                </p>
                {data.verouderde_koppelingen > 0 && (
                  <button
                    type="button"
                    onClick={() => void herkoppel()}
                    disabled={bezig}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    <LinkIcon className="h-4 w-4" />
                    Opnieuw koppelen ({data.verouderde_koppelingen})
                  </button>
                )}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-900">
                {data.waarschuwingen.map((melding) => (
                  <li key={melding}>{melding}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Per voertuig</p>
                <p className="text-xs text-gray-600">
                  Klik op een regel voor de onderliggende tolpassages.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-600">
                  {t.open_binnen_aantal} tolregels binnen de werktijd nog niet gefactureerd
                </span>
                <button
                  type="button"
                  onClick={() => void markeer()}
                  disabled={bezig || t.open_binnen_aantal === 0}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  Werktijd markeren als gefactureerd
                </button>
                <button
                  type="button"
                  onClick={() => void draaiTerug()}
                  disabled={bezig || t.gefactureerd_bedrag === 0}
                  title="Zet de markering van deze periode weer terug"
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" />
                  Terugdraaien
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Rit / voertuig</th>
                    <th className="px-3 py-2 text-left">Kenteken</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Ontvangen</th>
                    <th className="px-3 py-2 text-right">Betaald</th>
                    <th className="px-3 py-2 text-right">Verschil</th>
                    <th className="px-3 py-2 text-right">Werkdag</th>
                    <th className="px-3 py-2 text-right">Weekend</th>
                    <th className="px-3 py-2 text-right">Avond/nacht</th>
                    <th className="px-3 py-2 text-right">Passages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {zichtbaar.map((regel) => {
                    const stijl = SIGNAAL[regel.signaal]
                    const uitgeklapt = open === regel.id
                    const rijen = passages[regel.id]
                    return (
                      <Fragment key={regel.id}>
                        <tr
                          onClick={() => void klapUit(regel)}
                          className="cursor-pointer hover:bg-gray-50"
                        >
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-1 font-medium text-gray-900">
                              {uitgeklapt
                                ? <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                                : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                              {regel.voertuig_label}
                            </span>
                            <span className="ml-5 text-xs text-gray-500">
                              {regel.inzetdagen} dagen • {regel.ritten} ritten •{' '}
                              {kmFmt(regel.kilometers_afrekening)}
                              {regel.afrekeningen > 1 && ` • ${regel.afrekeningen} bonnen`}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">
                            {regel.kenteken || '—'}
                            {regel.koppeling_verouderd && (
                              <span
                                title={`Staat in de vloot nu op ${regel.huidig_kenteken}`}
                                className="ml-1 rounded bg-amber-100 px-1 text-amber-800"
                              >
                                verouderd
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              title={stijl.uitleg}
                              className={`inline-block rounded-full border px-2 py-0.5 text-xs ${stijl.klasse}`}
                            >
                              {stijl.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{currency(regel.ontvangen)}</td>
                          <td className="px-3 py-2 text-right">{currency(regel.betaald)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${
                            regel.verschil > 0 ? 'text-red-600' : 'text-green-700'
                          }`}
                          >
                            {currency(regel.verschil)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {currency(regel.binnen_bedrag)}
                          </td>
                          <td className="px-3 py-2 text-right text-purple-700">
                            {currency(regel.weekend_bedrag)}
                          </td>
                          <td className="px-3 py-2 text-right text-blue-700">
                            {currency(regel.avond_bedrag)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{regel.passages}</td>
                        </tr>
                        {uitgeklapt && (
                          <tr className="bg-gray-50">
                            <td colSpan={10} className="px-6 py-3">
                              {!rijen && (
                                <p className="text-xs text-gray-500">Tolpassages laden…</p>
                              )}
                              {rijen && rijen.length === 0 && (
                                <p className="text-xs text-gray-600">
                                  Er staan geen tolpassages op dit kenteken in deze periode.
                                </p>
                              )}
                              {rijen && rijen.length > 0 && (
                                <>
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs text-gray-600">
                                      {rijen.length} passages van rit {regel.ritnummer}
                                      {' '}({periodeLabel(regel.periode_van, regel.periode_tot)})
                                    </p>
                                    <span className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void exporteerRegel(regel, 'excel')
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                                      >
                                        <TableCellsIcon className="h-3.5 w-3.5" />
                                        Excel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void exporteerRegel(regel, 'pdf')
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                                      >
                                        <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                                        PDF
                                      </button>
                                    </span>
                                  </div>
                                  <div className="max-h-72 overflow-y-auto">
                                    <table className="min-w-full text-xs">
                                    <thead className="text-left text-gray-500">
                                      <tr>
                                        <th className="py-1 pr-4">Moment</th>
                                        <th className="py-1 pr-4">Tijdvak</th>
                                        <th className="py-1 pr-4">Kenteken</th>
                                        <th className="py-1 pr-4 text-right">Km</th>
                                        <th className="py-1 pr-4 text-right">Bedrag</th>
                                        <th className="py-1">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {rijen.map((passage) => (
                                        <tr key={passage.id}>
                                          <td className="py-1 pr-4 text-gray-700">
                                            {tijdstip(passage.start_at)}
                                          </td>
                                          <td className="py-1 pr-4">
                                            <span className={`rounded px-1.5 py-0.5 ${
                                              TIJDVAK_KLASSE[passage.tijdvak]
                                            }`}
                                            >
                                              {TIJDVAK_LABEL[passage.tijdvak]}
                                            </span>
                                          </td>
                                          <td className="py-1 pr-4 font-mono text-gray-600">
                                            {passage.kenteken}
                                          </td>
                                          <td className="py-1 pr-4 text-right text-gray-700">
                                            {passage.km.toLocaleString('nl-NL', {
                                              maximumFractionDigits: 1,
                                            })}
                                          </td>
                                          <td className="py-1 pr-4 text-right text-gray-900">
                                            {currency(passage.bedrag)}
                                          </td>
                                          <td className="py-1 text-gray-600">
                                            {passage.prive && (
                                              <span className="mr-1 rounded bg-gray-200 px-1.5 py-0.5">
                                                privé
                                              </span>
                                            )}
                                            {passage.gefactureerd ? 'gefactureerd' : 'open'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    </table>
                                  </div>
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 font-medium text-gray-900">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>
                      Totaal
                      <span className="ml-1 font-normal text-xs text-gray-500">
                        (alle {regels.length} voertuigen)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{currency(t.ontvangen)}</td>
                    <td className="px-3 py-2 text-right">{currency(t.betaald)}</td>
                    <td className={`px-3 py-2 text-right ${
                      t.verschil > 0 ? 'text-red-600' : 'text-green-700'
                    }`}
                    >
                      {currency(t.verschil)}
                    </td>
                    <td className="px-3 py-2 text-right">{currency(t.binnen_bedrag)}</td>
                    <td className="px-3 py-2 text-right text-purple-700">
                      {currency(t.weekend_bedrag)}
                    </td>
                    <td className="px-3 py-2 text-right text-blue-700">
                      {currency(t.avond_bedrag)}
                    </td>
                    <td className="px-3 py-2 text-right">{t.passages}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Paginering: tien voertuigen per pagina. */}
            {regels.length > PER_PAGINA && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-600">
                  Regel {(huidigePagina - 1) * PER_PAGINA + 1} t/m{' '}
                  {Math.min(huidigePagina * PER_PAGINA, regels.length)} van {regels.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPagina(huidigePagina - 1)}
                    disabled={huidigePagina <= 1}
                    className="rounded border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  {Array.from({ length: paginas }, (_, i) => i + 1).map((nummer) => (
                    <button
                      key={nummer}
                      type="button"
                      onClick={() => setPagina(nummer)}
                      className={`min-w-[2rem] rounded border px-2 py-1 text-sm ${
                        nummer === huidigePagina
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {nummer}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPagina(huidigePagina + 1)}
                    disabled={huidigePagina >= paginas}
                    className="rounded border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-900">Hoe lees ik dit overzicht?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Ontvangen</strong> is de tolvergoeding (Maut) die op de afrekeningen
                van de opdrachtgever staat, opgeteld over alle bonnen in deze periode.
              </li>
              <li>
                <strong>Betaald</strong> is de tolheffing die in dezelfde periode op het
                gekoppelde kenteken geboekt is. Privéritten tellen niet mee, en een passage
                telt maar één keer mee, ook als twee bonnen elkaar overlappen.
              </li>
              <li>
                <strong>Weekend</strong> en <strong>avond/nacht</strong> vallen buiten de
                werkdag van {data.werktijd_van} tot {data.werktijd_tot}. Samen
                {' '}{currency(t.buiten_bedrag)} — dat is gereden voor de opdrachtgever
                zonder dat de dagvergoeding daarop van toepassing is.
              </li>
              <li>
                <strong>Markeren als gefactureerd</strong> zet alleen de tolregels binnen
                de werkdag op afgerekend. Weekend en avond blijven open zodat ze nog
                nagefactureerd kunnen worden.
              </li>
              <li>
                <strong>Opnieuw koppelen</strong> haalt de kentekens opnieuw uit de vloot.
                Gebruik dit als een kenteken of ritnummer in de vloot gecorrigeerd is nadat
                de afrekening al ingelezen was.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
