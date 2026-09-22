/**
 * Tolafrekening van de opdrachtgever inlezen en controleren.
 *
 * Upload de PDF die de opdrachtgever per periode stuurt. De pagina leest het
 * ritnummer en de tolvergoeding (Maut) per voertuig, zoekt het bijbehorende
 * kenteken in de vloot en zet daar de tolheffing naast die wij in dezelfde
 * periode werkelijk betaald hebben.
 *
 * Passages worden verdeeld over drie tijdvakken: binnen de werkdag (standaard
 * 06:00-18:00, maandag t/m vrijdag), in het weekend en 's avonds of 's nachts.
 * De vergoeding van de opdrachtgever hoort de werkdag te dekken; wat daarbuiten
 * gereden is, is het bedrag dat wij te weinig ontvangen hebben.
 *
 * De tolheffing binnen de werkdag kan in één keer als gefactureerd gemarkeerd
 * worden, en dat is ook weer terug te draaien.
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
  ChevronRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  TableCellsIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'

import {
  AfrekeningDetail,
  AfrekeningPassage,
  AfrekeningRegel,
  AfrekeningRij,
  AfrekeningSignaal,
  tolAfrekeningApi,
} from '@/api/tolAfrekening'

const MAX_UPLOAD_MB = 25

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

function periodeLabel(van: string, tot: string): string {
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

export default function TolAfrekeningPage() {
  const [lijst, setLijst] = useState<AfrekeningRij[]>([])
  const [detail, setDetail] = useState<AfrekeningDetail | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [uploaden, setUploaden] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [passages, setPassages] = useState<Record<string, AfrekeningPassage[]>>({})
  const [bevestigVerwijder, setBevestigVerwijder] = useState<string | null>(null)
  const [werktijdVan, setWerktijdVan] = useState('06:00')
  const [werktijdTot, setWerktijdTot] = useState('18:00')
  const bestandRef = useRef<HTMLInputElement>(null)

  const haalLijst = useCallback(async () => {
    try {
      const rijen = await tolAfrekeningApi.lijst()
      setLijst(rijen)
      return rijen
    } catch (fout) {
      meldFout(fout, 'De afrekeningen konden niet worden opgehaald.')
      return []
    }
  }, [])

  useEffect(() => {
    let actief = true
    ;(async () => {
      const rijen = await haalLijst()
      if (!actief) return
      if (rijen.length > 0) {
        try {
          setDetail(await tolAfrekeningApi.detail(rijen[0].id))
        } catch (fout) {
          meldFout(fout, 'Het overzicht kon niet worden geladen.')
        }
      }
      if (actief) setLaden(false)
    })()
    return () => { actief = false }
  }, [haalLijst])

  useEffect(() => {
    if (!detail) return
    setWerktijdVan(detail.werktijd_van)
    setWerktijdTot(detail.werktijd_tot)
  }, [detail?.id, detail?.werktijd_van, detail?.werktijd_tot])

  const kiesAfrekening = async (id: string) => {
    if (detail?.id === id) return
    setBezig(true)
    setOpen(null)
    setPassages({})
    try {
      setDetail(await tolAfrekeningApi.detail(id))
    } catch (fout) {
      meldFout(fout, 'Het overzicht kon niet worden geladen.')
    } finally {
      setBezig(false)
    }
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
      setDetail(nieuw)
      setOpen(null)
      setPassages({})
      await haalLijst()
      toast.success(
        `Afrekening ingelezen: ${nieuw.totalen.voertuigen} voertuigen, `
        + `${currency(nieuw.totalen.ontvangen)} vergoeding.`,
      )
    } catch (fout) {
      meldFout(fout, 'Het bestand kon niet worden ingelezen.')
    } finally {
      setUploaden(false)
      if (bestandRef.current) bestandRef.current.value = ''
    }
  }

  const pasWerktijdenAan = async () => {
    if (!detail) return
    if (werktijdVan === werktijdTot) {
      toast.error('Begin- en eindtijd mogen niet gelijk zijn.')
      return
    }
    setBezig(true)
    try {
      setDetail(await tolAfrekeningApi.werktijden(detail.id, werktijdVan, werktijdTot))
      setPassages({})
      await haalLijst()
      toast.success('Werktijden aangepast.')
    } catch (fout) {
      meldFout(fout, 'De werktijden konden niet worden aangepast.')
    } finally {
      setBezig(false)
    }
  }

  const ververs = async () => {
    if (!detail) return
    setBezig(true)
    try {
      setDetail(await tolAfrekeningApi.detail(detail.id))
      setPassages({})
      toast.success('Overzicht bijgewerkt.')
    } catch (fout) {
      meldFout(fout, 'Het overzicht kon niet worden ververst.')
    } finally {
      setBezig(false)
    }
  }

  const markeer = async () => {
    if (!detail) return
    setBezig(true)
    try {
      const uitkomst = await tolAfrekeningApi.markeerGefactureerd(detail.id)
      setDetail(uitkomst.analyse)
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
    if (!detail) return
    setBezig(true)
    try {
      const uitkomst = await tolAfrekeningApi.markeringOngedaan(detail.id)
      setDetail(uitkomst.analyse)
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
      const rijen = await haalLijst()
      if (detail?.id === id) {
        setDetail(rijen.length ? await tolAfrekeningApi.detail(rijen[0].id) : null)
        setOpen(null)
        setPassages({})
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
    if (passages[regel.id] || !detail) return
    try {
      const uitkomst = await tolAfrekeningApi.passages(detail.id, regel.id)
      setPassages((vorig) => ({ ...vorig, [regel.id]: uitkomst.passages }))
    } catch (fout) {
      meldFout(fout, 'De tolpassages konden niet worden opgehaald.')
    }
  }

  const exportKolommen = useMemo(() => ([
    'Rit', 'Voertuig', 'Kenteken', 'Status', 'Dagen', 'Ritten',
    'Km afrekening', 'Ontvangen', 'Betaald', 'Verschil',
    'Werkdag', 'Weekend', 'Avond/nacht', 'Passages',
  ]), [])

  const exportRijen = useCallback((rijen: AfrekeningRegel[]) => rijen.map((r) => ([
    r.ritnummer,
    r.voertuig_label,
    r.kenteken || '—',
    SIGNAAL[r.signaal].label,
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

  const naarExcel = async () => {
    if (!detail) return
    try {
      const ExcelJS = await import('exceljs')
      const werkboek = new ExcelJS.Workbook()
      const blad = werkboek.addWorksheet('Tolafrekening')
      blad.addRow([`Tolafrekening ${detail.bonnummer || detail.bestandsnaam}`])
      blad.addRow([`Periode: ${periodeLabel(detail.periode_van, detail.periode_tot)}`])
      blad.addRow([`Werktijd: ${detail.werktijd_van} - ${detail.werktijd_tot}`])
      blad.addRow([`Opdrachtgever: ${detail.bedrijf_naam || '—'}`])
      blad.addRow([])
      blad.getRow(1).font = { bold: true, size: 14 }

      const kop = blad.addRow(exportKolommen)
      kop.font = { bold: true }
      exportRijen(detail.regels).forEach((rij) => blad.addRow(rij))

      const t = detail.totalen
      const totaal = blad.addRow([
        'Totaal', '', '', '', t.inzetdagen, t.ritten, t.kilometers_afrekening,
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
      link.download = `tolafrekening-${detail.bonnummer || 'export'}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('De Excel-export is niet gelukt.')
    }
  }

  const naarPdf = () => {
    if (!detail) return
    try {
      const doc = new jsPDF({ orientation: 'landscape' })
      doc.setFontSize(14)
      doc.text(`Tolafrekening ${detail.bonnummer || detail.bestandsnaam}`, 14, 16)
      doc.setFontSize(10)
      doc.text(
        `Periode ${periodeLabel(detail.periode_van, detail.periode_tot)}  •  `
        + `werktijd ${detail.werktijd_van}-${detail.werktijd_tot}  •  `
        + `${detail.bedrijf_naam || 'onbekende opdrachtgever'}`,
        14, 23,
      )
      const t = detail.totalen
      autoTable(doc, {
        startY: 28,
        head: [exportKolommen],
        body: exportRijen(detail.regels).map((rij) => rij.map((cel, i) => (
          i >= 7 && i <= 12 ? currency(Number(cel)) : String(cel)
        ))),
        foot: [[
          'Totaal', '', '', '', String(t.inzetdagen), String(t.ritten),
          kmFmt(t.kilometers_afrekening), currency(t.ontvangen), currency(t.betaald),
          currency(t.verschil), currency(t.binnen_bedrag), currency(t.weekend_bedrag),
          currency(t.avond_bedrag), String(t.passages),
        ]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [31, 41, 55] },
      })
      doc.save(`tolafrekening-${detail.bonnummer || 'export'}.pdf`)
    } catch {
      toast.error('De PDF-export is niet gelukt.')
    }
  }

  if (laden) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-32 rounded bg-gray-200" />
        </div>
      </div>
    )
  }

  const t = detail?.totalen

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tolafrekening opdrachtgever</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Lees de afrekening van de opdrachtgever in en vergelijk de ontvangen
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

      {lijst.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
            Ingelezen afrekeningen
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
            {lijst.map((rij) => {
              const gekozen = detail?.id === rij.id
              return (
                <div
                  key={rij.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${
                    gekozen ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void kiesAfrekening(rij.id)}
                    className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left"
                  >
                    <span className="font-medium text-gray-900">
                      Bon {rij.bonnummer || rij.bestandsnaam}
                    </span>
                    <span className="text-gray-600">
                      {periodeLabel(rij.periode_van, rij.periode_tot)}
                    </span>
                    <span className="text-gray-600">{rij.bedrijf_naam || '—'}</span>
                    <span className="text-gray-600">{rij.voertuigen} voertuigen</span>
                    <span className="font-medium text-gray-900">
                      {currency(rij.totaal_maut)} vergoeding
                    </span>
                    {rij.waarschuwingen > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        {rij.waarschuwingen}
                      </span>
                    )}
                  </button>
                  {bevestigVerwijder === rij.id ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void verwijder(rij.id)}
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
                      onClick={() => setBevestigVerwijder(rij.id)}
                      title="Afrekening verwijderen"
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!detail && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-10 text-center">
          <DocumentTextIcon className="mx-auto h-10 w-10 text-gray-400" />
          <p className="mt-3 text-sm font-medium text-gray-900">
            Nog geen afrekening ingelezen
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Upload de PDF die u van de opdrachtgever ontvangt. Het ritnummer en de
            tolvergoeding worden automatisch herkend.
          </p>
        </div>
      )}

      {detail && t && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1 text-sm">
                <p className="text-base font-semibold text-gray-900">
                  Bon {detail.bonnummer || detail.bestandsnaam}
                  {detail.bedrijf_naam && ` — ${detail.bedrijf_naam}`}
                </p>
                <p className="text-gray-600">
                  Periode {periodeLabel(detail.periode_van, detail.periode_tot)}
                  {detail.factuurdatum && ` • factuurdatum ${korteDatum(detail.factuurdatum)}`}
                  {detail.klantnummer && ` • klantnummer ${detail.klantnummer}`}
                </p>
                <p className="text-xs text-gray-500">
                  Ingelezen op {tijdstip(detail.created_at)}
                  {detail.geuploaded_door && ` door ${detail.geuploaded_door}`}
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
                    || (werktijdVan === detail.werktijd_van && werktijdTot === detail.werktijd_tot)}
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
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kaart
              titel="Ontvangen vergoeding"
              waarde={currency(t.ontvangen)}
              bijschrift={`${t.voertuigen} voertuigen op de afrekening`}
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

          {detail.waarschuwingen.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <ExclamationTriangleIcon className="h-5 w-5" />
                Let op ({detail.waarschuwingen.length})
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-900">
                {detail.waarschuwingen.map((melding) => (
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
                  {detail.regels.map((regel) => {
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
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-700">
                            {regel.kenteken || '—'}
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
                    <td className="px-3 py-2" colSpan={3}>Totaal</td>
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
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-900">Hoe lees ik dit overzicht?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Ontvangen</strong> is de tolvergoeding (Maut) die op de afrekening
                van de opdrachtgever staat.
              </li>
              <li>
                <strong>Betaald</strong> is de tolheffing die in dezelfde periode op het
                gekoppelde kenteken geboekt is. Privéritten tellen niet mee.
              </li>
              <li>
                <strong>Weekend</strong> en <strong>avond/nacht</strong> vallen buiten de
                werkdag van {detail.werktijd_van} tot {detail.werktijd_tot}. Samen
                {' '}{currency(t.buiten_bedrag)} — dat is gereden voor de opdrachtgever
                zonder dat de dagvergoeding daarop van toepassing is.
              </li>
              <li>
                <strong>Markeren als gefactureerd</strong> zet alleen de tolregels binnen
                de werkdag op afgerekend. Weekend en avond blijven open zodat ze nog
                nagefactureerd kunnen worden.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
