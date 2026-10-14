/**
 * Backup maken vlak voor een tolimport, en per week terugzetten.
 *
 * Een backup legt de laatste weken vast. Terugzetten gaat per week, zodat een
 * foute import van één week de rest van de periode niet raakt. Tolregels die
 * al op een factuur staan blijven altijd ongemoeid.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import {
  haalBackups,
  haalWeekVerschil,
  maakBackup,
  verwijderBackup,
  zetWeekTerug,
  type TolBackup,
  type TolBackupOverzicht,
  type TolBackupWeek,
  type WeekVerschil,
} from '@/api/tolBackup'

function euro(waarde: string | number): string {
  return Number(waarde).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })
}

function tijdstip(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function dagMaand(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}-${m}`
}

interface Props {
  opKlaar?: () => void
}

export default function TolBackupPaneel({ opKlaar }: Props) {
  const [overzicht, setOverzicht] = useState<TolBackupOverzicht | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [verschil, setVerschil] = useState<Record<string, WeekVerschil>>({})
  const [bevestig, setBevestig] = useState<{ backup: TolBackup; week: TolBackupWeek } | null>(null)

  const laad = () => {
    setLaden(true)
    haalBackups()
      .then((data) => {
        setOverzicht(data)
        if (data.backups.length && open === null) setOpen(data.backups[0].id)
      })
      .catch(() => toast.error('Backups ophalen is niet gelukt'))
      .finally(() => setLaden(false))
  }

  useEffect(laad, [])

  const nieuweBackup = async () => {
    setBezig(true)
    try {
      const backup = await maakBackup('Handmatig, voor een import')
      toast.success(`Backup gemaakt: ${backup.aantal_regels} tolregels vastgelegd`)
      setOpen(backup.id)
      setVerschil({})
      laad()
    } catch {
      toast.error('Backup maken is niet gelukt')
    } finally {
      setBezig(false)
    }
  }

  const toonVerschil = async (backup: TolBackup, week: TolBackupWeek) => {
    try {
      const data = await haalWeekVerschil(backup.id, week.id)
      setVerschil((vorig) => ({ ...vorig, [week.id]: data }))
      setBevestig({ backup, week })
    } catch {
      toast.error('Het verschil bepalen is niet gelukt')
    }
  }

  const terugzetten = async () => {
    if (!bevestig) return
    setBezig(true)
    try {
      const r = await zetWeekTerug(bevestig.backup.id, bevestig.week.id)
      toast.success(
        `Week ${r.weeknummer} teruggezet: ${r.hersteld} hersteld, ` +
        `${r.bijgewerkt} bijgewerkt, ${r.verwijderd} verwijderd`,
      )
      setBevestig(null)
      setVerschil({})
      laad()
      opKlaar?.()
    } catch {
      toast.error('Terugzetten is niet gelukt')
    } finally {
      setBezig(false)
    }
  }

  const weggooien = async (backup: TolBackup) => {
    setBezig(true)
    try {
      await verwijderBackup(backup.id)
      toast.success('Backup verwijderd')
      laad()
    } catch {
      toast.error('Verwijderen is niet gelukt')
    } finally {
      setBezig(false)
    }
  }

  const v = bevestig ? verschil[bevestig.week.id] : null

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-primary-600" />
          <div>
            <h3 className="font-medium text-gray-900">Backup van de tolregels</h3>
            <p className="text-sm text-gray-500">
              Maak een backup voordat je importeert. Je kunt daarna per week terug.
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary" disabled={bezig} onClick={nieuweBackup}>
          {bezig ? 'Bezig…' : 'Backup maken'}
        </button>
      </div>

      {laden && <p className="mt-4 text-sm text-gray-500">Laden…</p>}

      {!laden && overzicht && overzicht.backups.length === 0 && (
        <p className="mt-4 rounded bg-gray-50 p-3 text-sm text-gray-600">
          Er is nog geen backup. Maak er een voordat je de eerstvolgende import draait.
        </p>
      )}

      {!laden && overzicht && overzicht.backups.length > 0 && (
        <>
          <p className="mt-4 text-xs text-gray-500">
            Elke backup legt {overzicht.weken_per_backup} weken vast. De laatste{' '}
            {overzicht.maximaal_bewaard} backups blijven bewaard.
          </p>
          <div className="mt-2 divide-y divide-gray-200 rounded border border-gray-200">
            {overzicht.backups.map((backup) => {
              const uitgeklapt = open === backup.id
              return (
                <div key={backup.id}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(uitgeklapt ? null : backup.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      {uitgeklapt
                        ? <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                        : <ChevronRightIcon className="h-4 w-4 text-gray-400" />}
                      <span className="text-sm font-medium text-gray-900">
                        {tijdstip(backup.gemaakt_op)}
                      </span>
                      <span className="text-sm text-gray-500">
                        {backup.aantal_regels} regels · {euro(backup.totaal_bedrag)}
                      </span>
                      {backup.gemaakt_door && (
                        <span className="text-xs text-gray-400">door {backup.gemaakt_door}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Backup verwijderen"
                      disabled={bezig}
                      onClick={() => weggooien(backup)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {uitgeklapt && (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Week</th>
                          <th className="px-3 py-1.5 text-left">Periode</th>
                          <th className="px-3 py-1.5 text-right">Regels</th>
                          <th className="px-3 py-1.5 text-right">Bedrag</th>
                          <th className="px-3 py-1.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {backup.weken.map((week) => (
                          <tr key={week.id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-medium">
                              {week.weeknummer} <span className="text-gray-400">{week.jaar}</span>
                            </td>
                            <td className="px-3 py-1.5 text-gray-600">
                              {dagMaand(week.van_datum)} t/m {dagMaand(week.tot_datum)}
                            </td>
                            <td className="px-3 py-1.5 text-right">{week.aantal_regels}</td>
                            <td className="px-3 py-1.5 text-right">{euro(week.totaal_bedrag)}</td>
                            <td className="px-3 py-1.5 text-right">
                              {week.teruggezet_op && (
                                <span className="mr-2 text-xs text-gray-400">
                                  teruggezet {tijdstip(week.teruggezet_op)}
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={bezig}
                                onClick={() => toonVerschil(backup, week)}
                                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
                              >
                                <ArrowUturnLeftIcon className="h-3 w-3" />
                                Terugzetten
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {bevestig && v && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="h-6 w-6 flex-shrink-0 text-amber-500" />
              <div>
                <h4 className="font-medium text-gray-900">
                  Week {v.weeknummer} terugzetten naar {tijdstip(bevestig.backup.gemaakt_op)}?
                </h4>
                <p className="mt-1 text-sm text-gray-600">
                  Periode {dagMaand(v.van_datum)} t/m {dagMaand(v.tot_datum)}. Dit raakt alleen
                  deze week.
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-1 rounded bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Nu in de administratie</dt>
                <dd>{v.nu_aanwezig} regels · {euro(v.bedrag_nu)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">In de backup</dt>
                <dd>{v.in_backup} regels · {euro(v.bedrag_backup)}</dd>
              </div>
              <div className="flex justify-between text-red-700">
                <dt>Wordt verwijderd</dt>
                <dd>{v.wordt_verwijderd} regels</dd>
              </div>
              <div className="flex justify-between text-green-700">
                <dt>Wordt hersteld</dt>
                <dd>{v.wordt_hersteld} regels</dd>
              </div>
              <div className="flex justify-between text-gray-600">
                <dt>Blijft staan omdat het gefactureerd is</dt>
                <dd>{v.blijft_staan_gefactureerd} regels</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setBevestig(null)}>
                Annuleren
              </button>
              <button type="button" className="btn-primary" disabled={bezig} onClick={terugzetten}>
                {bezig ? 'Bezig…' : 'Terugzetten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
