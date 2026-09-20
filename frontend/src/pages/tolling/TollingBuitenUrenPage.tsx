/**
 * Administratief overzicht: tolheffing die buiten de gewerkte uren valt.
 *
 * Achteraf terugkijken, los van de facturatie: per bedrijf en per wagen zie je
 * welke tolregels niet binnen de geregistreerde rittijd van die dag vallen, en
 * welke dagen helemaal geen uren hebben. Te filteren per bedrijf en te
 * exporteren naar Excel, PDF of CSV.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import {
  tollingBuitenUrenApi,
  TollingBuitenUrenBedrijf,
  TollingBuitenUrenOverzicht,
  TollingBuitenUrenRegel,
  TollingBuitenUrenTotalen,
} from '@/api/tolling'

function currency(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function kmFmt(n: number): string {
  return `${(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km`
}

function korteDatum(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function isoDatum(d: Date): string {
  const maand = String(d.getMonth() + 1).padStart(2, '0')
  const dag = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${maand}-${dag}`
}

/** Maandag van de week waarin `d` valt. */
function weekStart(d: Date): Date {
  const kopie = new Date(d)
  const dagNr = (kopie.getDay() + 6) % 7
  kopie.setDate(kopie.getDate() - dagNr)
  return kopie
}

type Preset = 'deze-week' | 'vorige-week' | 'deze-maand' | 'vorige-maand' | 'dit-jaar'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'deze-week', label: 'Deze week' },
  { value: 'vorige-week', label: 'Vorige week' },
  { value: 'deze-maand', label: 'Deze maand' },
  { value: 'vorige-maand', label: 'Vorige maand' },
  { value: 'dit-jaar', label: 'Dit jaar' },
]

function presetBereik(preset: Preset): { van: string; tot: string } {
  const nu = new Date()
  switch (preset) {
    case 'deze-week': {
      const start = weekStart(nu)
      return { van: isoDatum(start), tot: isoDatum(nu) }
    }
    case 'vorige-week': {
      const start = weekStart(nu)
      start.setDate(start.getDate() - 7)
      const eind = new Date(start)
      eind.setDate(eind.getDate() + 6)
      return { van: isoDatum(start), tot: isoDatum(eind) }
    }
    case 'vorige-maand': {
      const start = new Date(nu.getFullYear(), nu.getMonth() - 1, 1)
      const eind = new Date(nu.getFullYear(), nu.getMonth(), 0)
      return { van: isoDatum(start), tot: isoDatum(eind) }
    }
    case 'dit-jaar':
      return { van: isoDatum(new Date(nu.getFullYear(), 0, 1)), tot: isoDatum(nu) }
    default:
      return { van: isoDatum(new Date(nu.getFullYear(), nu.getMonth(), 1)), tot: isoDatum(nu) }
  }
}

const STATUS_STIJL: Record<string, { label: string; klasse: string; uitleg: string }> = {
  buiten: {
    label: 'Buiten de uren',
    klasse: 'bg-orange-100 text-orange-800 border-orange-200',
    uitleg: 'Er zijn uren voor deze dag, maar de passage valt er (ruim) buiten.',
  },
  onbekend: {
    label: 'Geen uren',
    klasse: 'bg-gray-100 text-gray-700 border-gray-200',
    uitleg: 'Voor deze wagen zijn op deze dag helemaal geen uren geregistreerd.',
  },
  marge: {
    label: 'Randgeval',
    klasse: 'bg-blue-100 text-blue-800 border-blue-200',
    uitleg: 'Valt net buiten de rittijd, maar binnen de ingestelde marge.',
  },
  binnen: {
    label: 'Binnen de uren',
    klasse: 'bg-green-100 text-green-800 border-green-200',
    uitleg: 'Valt binnen de geregistreerde rittijd.',
  },
}

function StatusBadge({ status }: { status: string }) {
  const stijl = STATUS_STIJL[status] ?? STATUS_STIJL.onbekend
  return (
    <span
      title={stijl.uitleg}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${stijl.klasse}`}
    >
      {stijl.label}
    </span>
  )
}

function bronLabel(bron: string, definitief = true): string {
  if (bron === 'urenimport') return 'Urenimport'
  if (bron === 'ingediende uren') return definitief ? 'Ingediend' : 'Concept'
  return '—'
}

function afwijkingTekst(regel: TollingBuitenUrenRegel): string {
  if (regel.afwijking_minuten == null) return '—'
  if (regel.afwijking_minuten === 0) return 'binnen'
  const uren = Math.floor(regel.afwijking_minuten / 60)
  const minuten = regel.afwijking_minuten % 60
  const duur = uren > 0 ? `${uren}u ${String(minuten).padStart(2, '0')}m` : `${minuten} min`
  return `${duur} ${regel.afwijking_richting === 'voor' ? 'vóór' : 'na'} de rit`
}

/**
 * Een cel voor het CSV-bestand. Waarden die met =, + of @ beginnen worden door
 * Excel als formule uitgevoerd; die zetten we eerst stil.
 */
function csvCel(waarde: string): string {
  const tekst = waarde || ''
  const veilig = /^[=+@\t\r]/.test(tekst) ? `'${tekst}` : tekst
  return `"${veilig.replace(/"/g, '""')}"`
}

/** Bedrag als platte tekst, zonder euroteken (PDF-lettertype kent die niet). */
function bedragNl(n: number): string {
  return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Sleutel om een bedrijf mee te herkennen; regels zonder bedrijf krijgen er één. */
function bedrijfSleutel(bedrijf: TollingBuitenUrenBedrijf): string {
  return bedrijf.bedrijf_id ?? '__geen__'
}

const LEGE_TOTALEN: TollingBuitenUrenTotalen = {
  events: 0, km: 0, bedrag: 0,
  binnen_events: 0, binnen_km: 0, binnen_bedrag: 0,
  marge_events: 0, marge_km: 0, marge_bedrag: 0,
  buiten_events: 0, buiten_km: 0, buiten_bedrag: 0,
  onbekend_events: 0, onbekend_km: 0, onbekend_bedrag: 0,
  gefactureerd_events: 0, gefactureerd_km: 0, gefactureerd_bedrag: 0,
  open_events: 0, open_km: 0, open_bedrag: 0,
  afwijkend_gefactureerd_events: 0, afwijkend_gefactureerd_km: 0, afwijkend_gefactureerd_bedrag: 0,
  afwijkend_open_events: 0, afwijkend_open_km: 0, afwijkend_open_bedrag: 0,
}

/** Telt de totalen van meerdere bedrijven bij elkaar op. */
function telOp(bedrijven: TollingBuitenUrenBedrijf[]): TollingBuitenUrenTotalen {
  const uit = { ...LEGE_TOTALEN }
  bedrijven.forEach(bedrijf => {
    ;(Object.keys(LEGE_TOTALEN) as (keyof TollingBuitenUrenTotalen)[]).forEach(sleutel => {
      uit[sleutel] += bedrijf.totalen[sleutel] || 0
    })
  })
  ;(Object.keys(uit) as (keyof TollingBuitenUrenTotalen)[]).forEach(sleutel => {
    uit[sleutel] = Math.round(uit[sleutel] * 100) / 100
  })
  return uit
}

/** "12 van 40" — hoeveel passages zitten er achter dit bedrag. */
function passages(aantal: number, totaal: number): string {
  return `${aantal} van ${totaal} passages`
}

function StatCard({
  label,
  waarde,
  sub,
  accent,
}: {
  label: string
  waarde: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-gray-900'}`}>{waarde}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

export default function TollingBuitenUrenPage() {
  const standaard = presetBereik('deze-maand')
  const [van, setVan] = useState(standaard.van)
  const [tot, setTot] = useState(standaard.tot)
  const [preset, setPreset] = useState<Preset | null>('deze-maand')
  const [marge, setMarge] = useState(15)
  const [alleenOpen, setAlleenOpen] = useState(false)
  const [toonMarge, setToonMarge] = useState(false)
  const [alleenDefinitief, setAlleenDefinitief] = useState(false)
  const [bedrijfFilter, setBedrijfFilter] = useState('')
  const [data, setData] = useState<TollingBuitenUrenOverzicht | null>(null)
  const [laden, setLaden] = useState(false)
  const [openBedrijven, setOpenBedrijven] = useState<Record<string, boolean>>({})
  const [openWagens, setOpenWagens] = useState<Record<string, boolean>>({})
  const [exportOpen, setExportOpen] = useState(false)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const resultaat = await tollingBuitenUrenApi.overzicht({
        date_from: van,
        date_to: tot,
        marge_minuten: marge,
        alleen_open: alleenOpen,
        toon_marge: toonMarge,
        alleen_definitief: alleenDefinitief,
      })
      setData(resultaat)
      // Bedrijven standaard open, wagens dicht: eerst het overzicht.
      setOpenBedrijven(
        Object.fromEntries(resultaat.bedrijven.map(b => [b.bedrijf_id ?? '__geen__', true])),
      )
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Overzicht laden mislukt')
    } finally {
      setLaden(false)
    }
  }, [van, tot, marge, alleenOpen, toonMarge, alleenDefinitief])

  useEffect(() => {
    void laad()
  }, [laad])

  // Komen er nieuwe uren of tolregels binnen terwijl dit scherm openstaat, dan
  // is het genoeg om terug te klikken naar dit tabblad: hij haalt zichzelf op.
  useEffect(() => {
    const bijTerugkomst = () => {
      if (document.visibilityState === 'visible') void laad()
    }
    window.addEventListener('focus', bijTerugkomst)
    document.addEventListener('visibilitychange', bijTerugkomst)
    return () => {
      window.removeEventListener('focus', bijTerugkomst)
      document.removeEventListener('visibilitychange', bijTerugkomst)
    }
  }, [laad])

  const kiesPreset = (waarde: Preset) => {
    const bereik = presetBereik(waarde)
    setPreset(waarde)
    setVan(bereik.van)
    setTot(bereik.tot)
  }

  /** Alle bedrijven uit de periode, ook als het filter aanstaat: vult de keuzelijst. */
  const alleBedrijven = useMemo(() => {
    if (!data) return []
    return [...data.bedrijven]
      .filter(b => b.totalen.events > 0)
      .sort((a, b) => b.totalen.bedrag - a.totalen.bedrag)
  }, [data])

  // Staat het gekozen bedrijf niet meer in de nieuwe periode, dan vervalt het filter.
  useEffect(() => {
    if (!data || !bedrijfFilter) return
    if (!data.bedrijven.some(b => bedrijfSleutel(b) === bedrijfFilter)) setBedrijfFilter('')
  }, [data, bedrijfFilter])

  /** De bedrijven waar dit scherm nu over gaat (alles, of alleen het gekozen bedrijf). */
  const zichtbareBedrijven = useMemo(() => {
    if (!data) return []
    if (!bedrijfFilter) return data.bedrijven
    return data.bedrijven.filter(b => bedrijfSleutel(b) === bedrijfFilter)
  }, [data, bedrijfFilter])

  const gekozenBedrijf = bedrijfFilter
    ? alleBedrijven.find(b => bedrijfSleutel(b) === bedrijfFilter) ?? null
    : null

  const bedrijvenMetRegels = useMemo(() => {
    // Alleen bedrijven waar ook echt regels van te zien zijn, anders krijg je
    // een lege uitklap.
    return zichtbareBedrijven.filter(b => b.wagens.some(w => w.regels.length > 0))
  }, [zichtbareBedrijven])

  /** Alle bedrijven met passages in de periode, op bedrag aflopend. */
  const bedrijvenOverzicht = useMemo(() => {
    return [...zichtbareBedrijven]
      .filter(b => b.totalen.events > 0)
      .sort((a, b) => b.totalen.bedrag - a.totalen.bedrag)
  }, [zichtbareBedrijven])

  const totalen = useMemo(() => {
    if (!data) return undefined
    return bedrijfFilter ? telOp(zichtbareBedrijven) : data.totalen
  }, [data, bedrijfFilter, zichtbareBedrijven])

  // --- Exporteren ---------------------------------------------------------
  // Alle exports gebruiken dezelfde twee tabellen, zodat CSV, Excel en PDF
  // altijd hetzelfde laten zien als het scherm (inclusief het bedrijfsfilter).

  const bestandsnaam = (soort: string) => {
    const stuk = gekozenBedrijf
      ? `_${gekozenBedrijf.bedrijf_naam.replace(/[^\w-]+/g, '-').replace(/-+/g, '-')}`
      : ''
    return `tol-${soort}${stuk}_${van}_${tot}`
  }

  const ondertitel = [
    `Periode ${korteDatum(van)} t/m ${korteDatum(tot)}`,
    gekozenBedrijf ? `Bedrijf: ${gekozenBedrijf.bedrijf_naam}` : 'Alle bedrijven',
    `Marge ${data?.marge_minuten ?? marge} min`,
    alleenOpen ? 'alleen nog niet gefactureerd' : null,
    alleenDefinitief ? 'concept-uren tellen niet mee' : null,
  ].filter(Boolean).join(' · ')

  const BEDRIJF_KOP = [
    'Bedrijf', 'Passages totaal', 'Totaal EUR',
    'Gefactureerd EUR', 'Passages gefactureerd',
    'Niet gefactureerd EUR', 'Passages niet gefactureerd',
    'Buiten/geen uren gefactureerd EUR', 'Passages buiten/geen uren gefactureerd',
    'Buiten/geen uren open EUR', 'Passages buiten/geen uren open',
  ]

  /** Per bedrijf: bedragen als getal, zodat Excel ermee kan rekenen. */
  const bedrijfRijen = () =>
    bedrijvenOverzicht.map(b => [
      b.bedrijf_naam,
      b.totalen.events,
      b.totalen.bedrag,
      b.totalen.gefactureerd_bedrag,
      b.totalen.gefactureerd_events,
      b.totalen.open_bedrag,
      b.totalen.open_events,
      b.totalen.afwijkend_gefactureerd_bedrag,
      b.totalen.afwijkend_gefactureerd_events,
      b.totalen.afwijkend_open_bedrag,
      b.totalen.afwijkend_open_events,
    ] as (string | number)[])

  const bedrijfTotaalRij = (): (string | number)[] =>
    totalen
      ? [
          'Totaal', totalen.events, totalen.bedrag,
          totalen.gefactureerd_bedrag, totalen.gefactureerd_events,
          totalen.open_bedrag, totalen.open_events,
          totalen.afwijkend_gefactureerd_bedrag, totalen.afwijkend_gefactureerd_events,
          totalen.afwijkend_open_bedrag, totalen.afwijkend_open_events,
        ]
      : []

  const REGEL_KOP = [
    'Bedrijf', 'Kenteken', 'Ritnummer wagen', 'Datum', 'Tijd', 'Status',
    'Uren chauffeur', 'Chauffeur', 'Bron uren', 'Afwijking', 'KM', 'Bedrag', 'Gefactureerd',
  ]

  const regelRijen = () => {
    const rijen: (string | number)[][] = []
    zichtbareBedrijven.forEach(bedrijf => {
      bedrijf.wagens.forEach(wagen => {
        wagen.regels.forEach(regel => {
          rijen.push([
            bedrijf.bedrijf_naam,
            wagen.plate_display,
            wagen.ritnummer,
            korteDatum(regel.datum),
            regel.tijd,
            STATUS_STIJL[regel.status]?.label ?? regel.status,
            regel.dag_uren,
            regel.dag_chauffeur,
            bronLabel(regel.dag_bron, regel.dag_definitief),
            afwijkingTekst(regel),
            regel.distance_km,
            regel.amount,
            regel.invoiced ? 'ja' : 'nee',
          ])
        })
      })
    })
    return rijen
  }

  const bewaar = (blob: Blob, naam: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = naam
    link.click()
    URL.revokeObjectURL(url)
  }

  /** Getallen in CSV met komma, zodat Excel-NL ze als bedrag herkent. */
  const csvRij = (rij: (string | number)[]) =>
    rij
      .map(cel => (typeof cel === 'number' ? csvCel(String(cel).replace('.', ',')) : csvCel(cel)))
      .join(';')

  const exporteerCsvPerBedrijf = () => {
    if (bedrijvenOverzicht.length === 0) return toast('Niets te exporteren voor deze selectie')
    const csv = [csvRij(BEDRIJF_KOP), ...bedrijfRijen().map(csvRij), csvRij(bedrijfTotaalRij())].join('\r\n')
    bewaar(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${bestandsnaam('per-bedrijf')}.csv`)
  }

  const exporteerCsvRegels = () => {
    const rijen = regelRijen()
    if (rijen.length === 0) return toast('Niets te exporteren voor deze selectie')
    const csv = [csvRij(REGEL_KOP), ...rijen.map(csvRij)].join('\r\n')
    bewaar(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${bestandsnaam('buiten-uren')}.csv`)
  }

  const exporteerExcel = async () => {
    const regels = regelRijen()
    if (bedrijvenOverzicht.length === 0 && regels.length === 0) {
      return toast('Niets te exporteren voor deze selectie')
    }
    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'TMS'
      workbook.created = new Date()

      const kopStijl = (rij: any, kleur: string) => {
        rij.eachCell((cel: any) => {
          cel.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kleur } }
          cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        })
        rij.height = 28
      }
      const euro = '#,##0.00'

      // Blad 1: totalen per bedrijf
      const blad = workbook.addWorksheet('Per bedrijf')
      blad.mergeCells('A1:K1')
      blad.getCell('A1').value = 'Tol buiten de uren — per bedrijf'
      blad.getCell('A1').font = { size: 14, bold: true }
      blad.mergeCells('A2:K2')
      blad.getCell('A2').value = ondertitel
      blad.getCell('A2').font = { size: 10, color: { argb: '666666' } }
      blad.addRow([])
      kopStijl(blad.addRow(BEDRIJF_KOP), '0F766E')
      bedrijfRijen().forEach((rij, i) => {
        const r = blad.addRow(rij)
        if (i % 2 === 1) {
          r.eachCell((cel: any) => {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } }
          })
        }
      })
      const totaalRij = blad.addRow(bedrijfTotaalRij())
      totaalRij.eachCell((cel: any) => {
        cel.font = { bold: true }
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } }
      })
      blad.columns = [
        { width: 34 }, { width: 10 }, { width: 13 }, { width: 14 }, { width: 13 },
        { width: 16 }, { width: 13 }, { width: 16 }, { width: 11 }, { width: 18 }, { width: 11 },
      ]
      ;[3, 4, 6, 8, 10].forEach(kol => {
        blad.getColumn(kol).numFmt = euro
      })
      blad.views = [{ state: 'frozen', ySplit: 4 }]

      // Blad 2: de losse regels
      const blad2 = workbook.addWorksheet('Regels')
      blad2.mergeCells('A1:M1')
      blad2.getCell('A1').value = 'Tol buiten de uren — regels'
      blad2.getCell('A1').font = { size: 14, bold: true }
      blad2.mergeCells('A2:M2')
      blad2.getCell('A2').value = ondertitel
      blad2.getCell('A2').font = { size: 10, color: { argb: '666666' } }
      blad2.addRow([])
      kopStijl(blad2.addRow(REGEL_KOP), 'C2410C')
      regels.forEach((rij, i) => {
        const r = blad2.addRow(rij)
        if (i % 2 === 1) {
          r.eachCell((cel: any) => {
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7ED' } }
          })
        }
      })
      blad2.columns = [
        { width: 30 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 8 }, { width: 16 },
        { width: 16 }, { width: 22 }, { width: 12 }, { width: 18 }, { width: 10 }, { width: 11 },
        { width: 13 },
      ]
      blad2.getColumn(12).numFmt = euro
      blad2.getColumn(11).numFmt = '#,##0.0'
      blad2.views = [{ state: 'frozen', ySplit: 4 }]
      blad2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + regels.length, column: 13 } }

      const buffer = await workbook.xlsx.writeBuffer()
      bewaar(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${bestandsnaam('buiten-uren')}.xlsx`,
      )
      toast.success('Excel geëxporteerd')
    } catch (err) {
      console.error(err)
      toast.error('Excel-export mislukt')
    }
  }

  const exporteerPdf = () => {
    const regels = regelRijen()
    if (bedrijvenOverzicht.length === 0 && regels.length === 0) {
      return toast('Niets te exporteren voor deze selectie')
    }
    // Het standaardlettertype van jsPDF kent het euroteken niet; daarom staan
    // bedragen in het PDF als kale getallen met EUR in de kolomkop.
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    doc.setFontSize(16)
    doc.text('Tol buiten de uren', 14, 14)
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(ondertitel, 14, 20)
    if (totalen) {
      doc.text(
        `Totaal ${totalen.events} passages / EUR ${bedragNl(totalen.bedrag)} — ` +
          `gefactureerd ${totalen.gefactureerd_events} (EUR ${bedragNl(totalen.gefactureerd_bedrag)}), ` +
          `nog niet gefactureerd ${totalen.open_events} (EUR ${bedragNl(totalen.open_bedrag)})`,
        14,
        25,
      )
    }
    doc.setTextColor(0)

    doc.setFontSize(11)
    doc.text('Per bedrijf', 14, 33)
    autoTable(doc, {
      head: [[
        'Bedrijf', 'Passages', 'Totaal EUR', 'Gefactureerd EUR', 'Pass.',
        'Niet gefact. EUR', 'Pass.', 'Buiten/geen uren gefact. EUR', 'Pass.',
        'Buiten/geen uren open EUR', 'Pass.',
      ]],
      body: bedrijfRijen().map(rij =>
        rij.map((cel, i) => (typeof cel === 'number' && [2, 3, 5, 7, 9].includes(i) ? bedragNl(cel) : String(cel))),
      ),
      foot: totalen
        ? [bedrijfTotaalRij().map((cel, i) =>
            typeof cel === 'number' && [2, 3, 5, 7, 9].includes(i) ? bedragNl(cel) : String(cel),
          )]
        : undefined,
      startY: 36,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
    })

    if (regels.length > 0) {
      const vorigeY = (doc as any).lastAutoTable?.finalY || 36
      doc.setFontSize(11)
      doc.text('Passages buiten de uren of zonder uren', 14, vorigeY + 10)
      autoTable(doc, {
        head: [[
          'Bedrijf', 'Kenteken', 'Rit', 'Datum', 'Tijd', 'Status', 'Uren chauffeur',
          'Chauffeur', 'Bron', 'Afwijking', 'KM', 'EUR', 'Gefact.',
        ]],
        body: regels.map(rij =>
          rij.map((cel, i) => (typeof cel === 'number' ? (i === 11 ? bedragNl(cel) : String(cel)) : cel)),
        ),
        startY: vorigeY + 13,
        styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { fillColor: [194, 65, 12], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [255, 247, 237] },
        columnStyles: { 10: { halign: 'right' }, 11: { halign: 'right' } },
      })
    }

    const paginas = doc.getNumberOfPages()
    for (let i = 1; i <= paginas; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setTextColor(130)
      doc.text(
        `Gemaakt op ${new Date().toLocaleString('nl-NL')}`,
        14,
        doc.internal.pageSize.getHeight() - 8,
      )
      doc.text(
        `Pagina ${i} / ${paginas}`,
        doc.internal.pageSize.getWidth() - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'right' },
      )
    }
    doc.save(`${bestandsnaam('buiten-uren')}.pdf`)
    toast.success('PDF geëxporteerd')
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <ClockIcon className="h-6 w-6 text-primary-600" />
            Tol buiten de uren
          </h1>
          <p className="text-sm text-gray-500">
            Welke tolpassages vallen niet binnen de geregistreerde rittijd van die wagen op die
            dag? Gegroepeerd per bedrijf en per wagen. Dit scherm leest alleen; er wordt niets
            gefactureerd of gewijzigd.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-col">
            <button type="button" className="btn btn-secondary" onClick={() => void laad()} disabled={laden}>
              <ArrowPathIcon className={`h-4 w-4 mr-1.5 ${laden ? 'animate-spin' : ''}`} />
              Vernieuwen
            </button>
            {data?.gegenereerd_op && (
              <span className="text-[11px] text-gray-400 mt-0.5 text-center">
                bijgewerkt {new Date(data.gegenereerd_op).toLocaleTimeString('nl-NL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={exporteerExcel} disabled={!data || laden}>
            <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
            Excel
          </button>
          <button type="button" className="btn btn-secondary" onClick={exporteerPdf} disabled={!data || laden}>
            <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
            PDF
          </button>
          <div className="relative">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setExportOpen(o => !o)}
              disabled={!data || laden}
            >
              CSV
              <ChevronDownIcon className="h-4 w-4 ml-1.5" />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    onClick={() => {
                      setExportOpen(false)
                      exporteerCsvRegels()
                    }}
                  >
                    Regels (CSV)
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    onClick={() => {
                      setExportOpen(false)
                      exporteerCsvPerBedrijf()
                    }}
                  >
                    Totalen per bedrijf (CSV)
                  </button>
                </div>
              </>
            )}
          </div>
          <Link to="/tolheffing" className="btn btn-secondary">
            Tolheffing import
          </Link>
        </div>
      </header>

      <section className="rounded-lg border bg-white px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-gray-500 uppercase mr-0.5">Periode:</span>
          {PRESETS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => kiesPreset(opt.value)}
              className={`px-2 py-1 md:px-3 md:py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors ${
                preset === opt.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Van</span>
            <input
              type="date"
              value={van}
              onChange={e => {
                setVan(e.target.value)
                setPreset(null)
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Tot en met</span>
            <input
              type="date"
              value={tot}
              onChange={e => {
                setTot(e.target.value)
                setPreset(null)
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1" title="Toont alleen de kentekens en bedragen van dit bedrijf">
              Bedrijf
            </span>
            <select
              value={bedrijfFilter}
              onChange={e => setBedrijfFilter(e.target.value)}
              className="min-w-[14rem] max-w-xs rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Alle bedrijven</option>
              {alleBedrijven.map(b => (
                <option key={bedrijfSleutel(b)} value={bedrijfSleutel(b)}>
                  {b.bedrijf_naam} ({b.totalen.events})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1" title="Speling rond begin- en eindtijd van de rit">
              Marge (min)
            </span>
            <input
              type="number"
              min={0}
              max={240}
              value={marge}
              onChange={e => setMarge(Math.max(0, Math.min(240, Number(e.target.value) || 0)))}
              className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
            <input
              type="checkbox"
              checked={alleenOpen}
              onChange={e => setAlleenOpen(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Alleen nog niet gefactureerd
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
            <input
              type="checkbox"
              checked={toonMarge}
              onChange={e => setToonMarge(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Randgevallen ook tonen
          </label>
          <label
            className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5"
            title="Uren die de chauffeur nog niet heeft ingediend tellen dan niet mee; die dagen gelden als 'geen uren'"
          >
            <input
              type="checkbox"
              checked={alleenDefinitief}
              onChange={e => setAlleenDefinitief(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Concept-uren niet meetellen
          </label>
        </div>

        {gekozenBedrijf && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
            <span className="text-gray-500">Gefilterd op:</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-1 font-medium text-primary-700">
              {gekozenBedrijf.bedrijf_naam}
              <button
                type="button"
                onClick={() => setBedrijfFilter('')}
                className="rounded-full p-0.5 hover:bg-primary-100"
                title="Filter wissen"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
            <span className="text-gray-500">
              alleen de kentekens van dit bedrijf; totalen, tabel en export volgen dit filter
            </span>
          </div>
        )}
      </section>

      {totalen && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Binnen de uren"
            waarde={currency(totalen.binnen_bedrag)}
            sub={`${totalen.binnen_events} van ${totalen.events} passages`}
            accent="text-green-700"
          />
          <StatCard
            label="Buiten de uren"
            waarde={currency(totalen.buiten_bedrag)}
            sub={`${totalen.buiten_events} passages · ${kmFmt(totalen.buiten_km)}`}
            accent="text-orange-700"
          />
          <StatCard
            label="Geen uren bekend"
            waarde={currency(totalen.onbekend_bedrag)}
            sub={`${totalen.onbekend_events} passages · ${kmFmt(totalen.onbekend_km)}`}
            accent="text-gray-700"
          />
          <StatCard
            label="Randgevallen"
            waarde={currency(totalen.marge_bedrag)}
            sub={`${totalen.marge_events} passages binnen ${data?.marge_minuten ?? marge} min`}
            accent="text-blue-700"
          />
        </section>
      )}

      {totalen && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Totaal tolheffing"
            waarde={currency(totalen.bedrag)}
            sub={`${totalen.events} passages · ${kmFmt(totalen.km)}`}
          />
          <StatCard
            label="Gefactureerd"
            waarde={currency(totalen.gefactureerd_bedrag)}
            sub={passages(totalen.gefactureerd_events, totalen.events)}
            accent="text-green-700"
          />
          <StatCard
            label="Nog niet gefactureerd"
            waarde={currency(totalen.open_bedrag)}
            sub={passages(totalen.open_events, totalen.events)}
            accent="text-primary-700"
          />
          <StatCard
            label="Buiten/geen uren nog open"
            waarde={currency(totalen.afwijkend_open_bedrag)}
            sub={`${totalen.afwijkend_open_events} passages · al gefactureerd: ${totalen.afwijkend_gefactureerd_events} (${currency(totalen.afwijkend_gefactureerd_bedrag)})`}
            accent="text-orange-700"
          />
        </section>
      )}

      {bedrijvenOverzicht.length > 0 && (
        <section className="rounded-lg border bg-white">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-gray-900">Per bedrijf</h2>
            <p className="text-xs text-gray-500">
              Wat is er in deze periode aan tolheffing gereden, en wat staat er nog niet op een
              factuur? Onder elk bedrag staat om hoeveel van de passages het gaat. De laatste twee
              kolommen gaan alleen over passages buiten de uren of zonder geregistreerde uren.
              Klik op een bedrijf om alleen dat bedrijf te tonen.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 border-b">
                  <th className="px-4 py-2">Bedrijf</th>
                  <th className="px-3 py-2 text-right">Passages</th>
                  <th className="px-3 py-2 text-right">Totaal</th>
                  <th className="px-3 py-2 text-right">Gefactureerd</th>
                  <th className="px-3 py-2 text-right">Niet gefactureerd</th>
                  <th className="px-3 py-2 text-right">Buiten/geen uren · gefact.</th>
                  <th className="px-4 py-2 text-right">Buiten/geen uren · open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bedrijvenOverzicht.map(bedrijf => {
                  const sleutel = bedrijfSleutel(bedrijf)
                  const t = bedrijf.totalen
                  return (
                    <tr
                      key={sleutel}
                      onClick={() => setBedrijfFilter(bedrijfFilter === sleutel ? '' : sleutel)}
                      title={
                        bedrijfFilter === sleutel
                          ? 'Klik om het filter te wissen'
                          : 'Klik om alleen dit bedrijf te tonen'
                      }
                      className={`cursor-pointer ${
                        bedrijfFilter === sleutel ? 'bg-primary-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {bedrijf.bedrijf_naam}
                        {bedrijf.afgeleid_events > 0 && (
                          <span
                            className="block text-[11px] font-normal text-gray-500"
                            title="Op deze tolregels stond geen bedrijf; toegewezen op basis van het kenteken in de vloot"
                          >
                            waarvan {currency(bedrijf.afgeleid_bedrag)} via de vloot toegewezen
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{t.events}</td>
                      <td className="px-3 py-2 text-right">{currency(t.bedrag)}</td>
                      <td className="px-3 py-2 text-right text-green-700">
                        {currency(t.gefactureerd_bedrag)}
                        <span className="block text-[11px] font-normal text-gray-500">
                          {passages(t.gefactureerd_events, t.events)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-primary-700">
                        {currency(t.open_bedrag)}
                        <span className="block text-[11px] font-normal text-gray-500">
                          {passages(t.open_events, t.events)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {currency(t.afwijkend_gefactureerd_bedrag)}
                        <span className="block text-[11px] text-gray-500">
                          {t.afwijkend_gefactureerd_events} passages
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-orange-700">
                        {currency(t.afwijkend_open_bedrag)}
                        <span className="block text-[11px] font-normal text-gray-500">
                          {t.afwijkend_open_events} passages
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {totalen && (
                <tfoot>
                  <tr className="border-t bg-gray-50 font-semibold">
                    <td className="px-4 py-2">Totaal</td>
                    <td className="px-3 py-2 text-right">{totalen.events}</td>
                    <td className="px-3 py-2 text-right">{currency(totalen.bedrag)}</td>
                    <td className="px-3 py-2 text-right text-green-700">
                      {currency(totalen.gefactureerd_bedrag)}
                      <span className="block text-[11px] font-normal text-gray-500">
                        {passages(totalen.gefactureerd_events, totalen.events)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-primary-700">
                      {currency(totalen.open_bedrag)}
                      <span className="block text-[11px] font-normal text-gray-500">
                        {passages(totalen.open_events, totalen.events)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {currency(totalen.afwijkend_gefactureerd_bedrag)}
                      <span className="block text-[11px] font-normal text-gray-500">
                        {totalen.afwijkend_gefactureerd_events} passages
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-orange-700">
                      {currency(totalen.afwijkend_open_bedrag)}
                      <span className="block text-[11px] font-normal text-gray-500">
                        {totalen.afwijkend_open_events} passages
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}

      {data?.afgekapt && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Er zijn meer regels dan dit scherm toont. De totalen kloppen wel; kies een kortere
          periode om alle regels te zien.
        </div>
      )}

      {laden ? (
        <div className="py-10 text-center text-gray-400">Laden…</div>
      ) : bedrijvenMetRegels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center text-gray-500">
          {!data || data.totalen.events === 0
            ? 'Geen tolpassages in deze periode.'
            : gekozenBedrijf && gekozenBedrijf.totalen.events === 0
              ? `Geen tolpassages voor ${gekozenBedrijf.bedrijf_naam} in deze periode.`
              : alleenOpen
                ? 'Alle tolpassages buiten de uren in deze selectie staan al op een factuur.'
                : 'Alle tolpassages in deze selectie vallen binnen de geregistreerde uren.'}
        </div>
      ) : (
        <div className="space-y-3">
          {bedrijvenMetRegels.map(bedrijf => {
            const sleutel = bedrijf.bedrijf_id ?? '__geen__'
            const open = !!openBedrijven[sleutel]
            const wagens = bedrijf.wagens.filter(w => w.regels.length > 0)
            return (
              <section key={sleutel} className="rounded-lg border bg-white">
                <button
                  type="button"
                  onClick={() => setOpenBedrijven(prev => ({ ...prev, [sleutel]: !prev[sleutel] }))}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-gray-50"
                >
                  {open ? (
                    <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                  )}
                  <span className="font-semibold text-gray-900">{bedrijf.bedrijf_naam}</span>
                  <span className="text-xs text-gray-500">
                    {wagens.length} wagen{wagens.length === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-orange-700">
                      buiten: {bedrijf.totalen.buiten_events} · {currency(bedrijf.totalen.buiten_bedrag)}
                    </span>
                    <span className="text-gray-600">
                      geen uren: {bedrijf.totalen.onbekend_events} ·{' '}
                      {currency(bedrijf.totalen.onbekend_bedrag)}
                    </span>
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">
                      gefactureerd {bedrijf.totalen.afwijkend_gefactureerd_events} ·{' '}
                      {currency(bedrijf.totalen.afwijkend_gefactureerd_bedrag)}
                    </span>
                    <span className="rounded bg-primary-50 px-1.5 py-0.5 text-primary-700">
                      open {bedrijf.totalen.afwijkend_open_events} ·{' '}
                      {currency(bedrijf.totalen.afwijkend_open_bedrag)}
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="border-t divide-y">
                    {wagens.map(wagen => {
                      const wagenSleutel = `${sleutel}:${wagen.plate_normalized}`
                      const wagenOpen = !!openWagens[wagenSleutel]
                      return (
                        <div key={wagenSleutel}>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenWagens(prev => ({ ...prev, [wagenSleutel]: !prev[wagenSleutel] }))
                            }
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                          >
                            {wagenOpen ? (
                              <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                            )}
                            <span className="font-medium text-gray-900">{wagen.plate_display}</span>
                            {wagen.ritnummer && (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                                rit {wagen.ritnummer}
                              </span>
                            )}
                            <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-gray-600">
                              <span>
                                {wagen.regels.length} van {wagen.totalen.events} passages
                              </span>
                              <span className="text-green-700">
                                gefact. {wagen.totalen.afwijkend_gefactureerd_events} ·{' '}
                                {currency(wagen.totalen.afwijkend_gefactureerd_bedrag)}
                              </span>
                              <span className="font-semibold text-orange-700">
                                open {wagen.totalen.afwijkend_open_events} ·{' '}
                                {currency(wagen.totalen.afwijkend_open_bedrag)}
                              </span>
                            </span>
                          </button>

                          {wagenOpen && (
                            <div className="overflow-x-auto px-4 pb-4">
                              <table className="min-w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs uppercase text-gray-500">
                                    <th className="py-2 pr-3">Datum / tijd tol</th>
                                    <th className="py-2 pr-3">Status</th>
                                    <th className="py-2 pr-3">Uren chauffeur</th>
                                    <th className="py-2 pr-3">Bron</th>
                                    <th className="py-2 pr-3">Afwijking</th>
                                    <th className="py-2 pr-3 text-right">KM</th>
                                    <th className="py-2 pr-3 text-right">Bedrag</th>
                                    <th className="py-2">Factuur</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {wagen.regels.map(regel => (
                                    <tr key={regel.id} className={regel.weekend ? 'bg-amber-50/40' : ''}>
                                      <td className="py-2 pr-3 whitespace-nowrap">
                                        {korteDatum(regel.datum)} {regel.tijd}
                                        {regel.weekend && (
                                          <span className="ml-1 text-[11px] text-amber-700">weekend</span>
                                        )}
                                      </td>
                                      <td className="py-2 pr-3">
                                        <StatusBadge status={regel.status} />
                                      </td>
                                      <td className="py-2 pr-3 whitespace-nowrap">
                                        {regel.dag_uren ? (
                                          <>
                                            <span className="text-gray-900">{regel.dag_uren}</span>
                                            {regel.dag_chauffeur && (
                                              <span className="text-gray-500"> · {regel.dag_chauffeur}</span>
                                            )}
                                          </>
                                        ) : (
                                          <span className="text-gray-400">geen uren geregistreerd</span>
                                        )}
                                      </td>
                                      <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                                        {bronLabel(regel.dag_bron, regel.dag_definitief)}
                                      </td>
                                      <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                                        {afwijkingTekst(regel)}
                                      </td>
                                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                                        {kmFmt(regel.distance_km)}
                                      </td>
                                      <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                                        {currency(regel.amount)}
                                      </td>
                                      <td className="py-2 whitespace-nowrap text-xs">
                                        {regel.invoiced ? (
                                          <span className="text-gray-500">gefactureerd</span>
                                        ) : (
                                          <span className="text-primary-700">open</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
