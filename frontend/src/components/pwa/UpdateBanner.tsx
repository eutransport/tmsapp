/**
 * Banner voor een aangekondigde update.
 *
 * Het updatescript kondigt de update aan; deze banner telt af tot het
 * startmoment, toont daarna dat er bijgewerkt wordt en laadt de pagina
 * opnieuw zodra de server weer bereikbaar is.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowPathIcon, SparklesIcon } from '@heroicons/react/24/outline'
import api from '@/api/client'

interface UpdateStatus {
  gepland: boolean
  start_om: string | null
  server_tijd: string
}

const POLL_RUST = 30_000
const POLL_ACTIEF = 5_000

export default function UpdateBanner() {
  const { t } = useTranslation()
  const [startOm, setStartOm] = useState<number | null>(null)
  const [nu, setNu] = useState(() => Date.now())
  const [bezig, setBezig] = useState(false)
  // Verschil tussen de klok van de server en die van dit toestel.
  const verschil = useRef(0)
  const aangekondigd = useRef(false)

  useEffect(() => {
    let actief = true
    let timer: ReturnType<typeof setTimeout>

    const controleer = async () => {
      let volgende = POLL_RUST
      try {
        const { data } = await api.get<UpdateStatus>('/core/update-status/', { timeout: 8000 })
        if (!actief) return
        verschil.current = new Date(data.server_tijd).getTime() - Date.now()

        if (data.gepland && data.start_om) {
          aangekondigd.current = true
          setStartOm(new Date(data.start_om).getTime())
          volgende = POLL_ACTIEF
        } else if (aangekondigd.current) {
          // De update is klaar: opnieuw laden haalt de nieuwe versie op.
          window.location.reload()
          return
        } else {
          setStartOm(null)
          setBezig(false)
        }
      } catch {
        if (!actief) return
        // Server weg na een aankondiging betekent: de update loopt.
        if (aangekondigd.current) {
          setBezig(true)
          volgende = POLL_ACTIEF
        }
      }
      timer = setTimeout(controleer, volgende)
    }

    controleer()
    return () => {
      actief = false
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (startOm === null) return
    const tik = setInterval(() => setNu(Date.now()), 1000)
    return () => clearInterval(tik)
  }, [startOm])

  if (startOm === null && !bezig) return null

  const resterend = startOm === null ? 0 : Math.max(0, Math.ceil((startOm - (nu + verschil.current)) / 1000))
  const loopt = bezig || resterend === 0
  const minuten = Math.floor(resterend / 60)
  const seconden = String(resterend % 60).padStart(2, '0')

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[100] px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6"
    >
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-gradient-to-r from-primary-600 via-primary-700 to-indigo-700 text-white shadow-2xl ring-1 ring-white/20">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
            {loopt ? (
              <ArrowPathIcon className="h-6 w-6 animate-spin" />
            ) : (
              <SparklesIcon className="h-6 w-6 animate-pulse" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold sm:text-lg">
              {loopt
                ? t('appUpdate.busyTitle', 'De applicatie wordt bijgewerkt')
                : t('appUpdate.title', 'Er komt een update aan')}
            </p>
            <p className="mt-0.5 text-sm text-white/85">
              {loopt
                ? t('appUpdate.busyText', 'Even geduld; de pagina laadt vanzelf opnieuw zodra de update klaar is.')
                : t('appUpdate.text', 'Sla je werk op. De app is tijdens de update enkele minuten niet bereikbaar.')}
            </p>
          </div>

          {!loopt && (
            <div className="flex-shrink-0 rounded-xl bg-white/15 px-3 py-2 text-center">
              <div className="font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl">
                {minuten}:{seconden}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-white/75">
                {t('appUpdate.countdown', 'tot update')}
              </div>
            </div>
          )}
        </div>

        {!loopt && startOm !== null && (
          <div className="h-1 bg-white/20">
            <div
              className="h-full bg-white transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.min(100, (resterend / 60) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
