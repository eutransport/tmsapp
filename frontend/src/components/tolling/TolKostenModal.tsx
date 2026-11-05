/**
 * Tolkosten per kenteken: kies een week of maand en exporteer per wagen
 * alleen het totaal, zonder losse passages.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import { tollingApi } from '@/api/tolling'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type Soort = 'week' | 'month'
type Data = Awaited<ReturnType<typeof tollingApi.kostenPerKenteken>>

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december']

function euro(bedrag: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(bedrag || 0)
}

function isoWeek(d: Date): { jaar: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dag = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dag)
  const jaarStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { jaar: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - jaarStart.getTime()) / 86400000 + 1) / 7) }
}

/** Keuzelijst met verschuivingen t.o.v. nu; 0 = huidige week/maand. */
function keuzes(soort: Soort): { offset: number; label: string }[] {
  const nu = new Date()
  if (soort === 'month') {
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(nu.getFullYear(), nu.getMonth() - i, 1)
      return { offset: -i, label: `${MAANDEN[d.getMonth()]} ${d.getFullYear()}` }
    })
  }
  return Array.from({ length: 60 }, (_, i) => {
    const d = new Date(nu)
    d.setDate(d.getDate() - 7 * i)
    const { jaar, week } = isoWeek(d)
    return { offset: -i, label: `Week ${String(week).padStart(2, '0')} ${jaar}` }
  })
}

export default function TolKostenModal({ isOpen, onClose }: Props) {
  const [soort, setSoort] = useState<Soort>('month')
  const [offset, setOffset] = useState(-1)
  const [data, setData] = useState<Data | null>(null)
  const [bezig, setBezig] = useState(false)
  const [exporteren, setExporteren] = useState<'' | 'xlsx' | 'pdf'>('')
  const opties = useMemo(() => keuzes(soort), [soort])

  useEffect(() => {
    if (!isOpen) return
    let actief = true
    setBezig(true)
    tollingApi.kostenPerKenteken({ period: soort, offset })
      .then(d => { if (actief) setData(d) })
      .catch((e: any) => { if (actief) { setData(null); toast.error(e?.response?.data?.detail || 'Ophalen mislukt') } })
      .finally(() => { if (actief) setBezig(false) })
    return () => { actief = false }
  }, [isOpen, soort, offset])

  const exporteer = async (formaat: 'xlsx' | 'pdf') => {
    setExporteren(formaat)
    try {
      const blob = await tollingApi.downloadKostenPerKenteken({ period: soort, offset }, formaat)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const naam = opties.find(o => o.offset === offset)?.label ?? 'periode'
      link.download = `tolkosten-per-kenteken-${naam.replace(/\s+/g, '-').toLowerCase()}.${formaat}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export mislukt')
    } finally {
      setExporteren('')
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <div className="fixed inset-0 bg-black/40" />
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Dialog.Panel className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <Dialog.Title className="text-lg font-semibold">Tolkosten per kenteken</Dialog.Title>
                <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Per</label>
                    <select
                      className="input mt-1"
                      value={soort}
                      onChange={(e) => { setSoort(e.target.value as Soort); setOffset(-1) }}
                    >
                      <option value="month">Maand</option>
                      <option value="week">Week</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-[12rem]">
                    <label className="block text-sm font-medium text-gray-700">Periode</label>
                    <select
                      className="input mt-1 w-full"
                      value={offset}
                      onChange={(e) => setOffset(Number(e.target.value))}
                    >
                      {opties.map(o => <option key={o.offset} value={o.offset}>{o.label}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center"
                    onClick={() => exporteer('pdf')}
                    disabled={!!exporteren || bezig || !data?.rijen.length}
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
                    {exporteren === 'pdf' ? 'Bezig…' : 'PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center"
                    onClick={() => exporteer('xlsx')}
                    disabled={!!exporteren || bezig || !data?.rijen.length}
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1.5" />
                    {exporteren === 'xlsx' ? 'Bezig…' : 'Excel'}
                  </button>
                </div>

                <div className="max-h-[55vh] overflow-y-auto rounded-md border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Kenteken</th>
                        <th className="px-3 py-2 text-right font-medium">Passages</th>
                        <th className="px-3 py-2 text-right font-medium">Totaal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {bezig && (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">Laden…</td></tr>
                      )}
                      {!bezig && !data?.rijen.length && (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">Geen tolheffing in deze periode.</td></tr>
                      )}
                      {!bezig && data?.rijen.map(r => (
                        <tr key={r.kenteken}>
                          <td className="px-3 py-1.5 font-mono">{r.kenteken}</td>
                          <td className="px-3 py-1.5 text-right">{r.passages}</td>
                          <td className="px-3 py-1.5 text-right">{euro(r.bedrag)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {!bezig && !!data?.rijen.length && (
                      <tfoot>
                        <tr className="border-t font-semibold">
                          <td className="px-3 py-2">Totaal</td>
                          <td className="px-3 py-2 text-right">{data.rijen.reduce((s, r) => s + r.passages, 0)}</td>
                          <td className="px-3 py-2 text-right">{euro(data.totaal)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
