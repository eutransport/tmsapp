import { useEffect, useRef, useState } from 'react'
import type { CalendarLeaveEntry } from '@/api/leave'

const KLEUREN = [
  'from-[#105BFF] to-[#4f86ff]',
  'from-[#FE8500] to-[#ffa94d]',
  'from-[#21233E] to-[#4a4f80]',
  'from-[#105BFF] to-[#21233E]',
  'from-[#FE8500] to-[#105BFF]',
]

function initialen(naam: string) {
  const delen = naam.trim().split(/\s+/)
  return ((delen[0]?.[0] || '') + (delen.length > 1 ? delen[delen.length - 1][0] : '')).toUpperCase()
}

function periode(e: CalendarLeaveEntry) {
  const fmt = (d: string) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return e.start_date === e.end_date ? fmt(e.start_date) : `${fmt(e.start_date)} – ${fmt(e.end_date)}`
}

function vandaagAfwezig(e: CalendarLeaveEntry) {
  const v = new Date().toISOString().slice(0, 10)
  return e.start_date <= v && v <= e.end_date
}

export default function VerlofCarousel({ entries }: { entries: CalendarLeaveEntry[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const sleep = useRef<{ x: number; scroll: number; bewogen: boolean } | null>(null)
  const [actief, setActief] = useState(0)

  // Kaarten schalen mee met hun afstand tot het midden van de strook.
  const bijwerken = () => {
    const el = ref.current
    if (!el) return
    const midden = el.scrollLeft + el.clientWidth / 2
    let dichtst = 0, minAfstand = Infinity
    Array.from(el.children).forEach((c, i) => {
      const kaart = c as HTMLElement
      const afstand = Math.abs(kaart.offsetLeft + kaart.offsetWidth / 2 - midden)
      const f = Math.min(afstand / el.clientWidth, 1)
      kaart.style.transform = `scale(${1 - f * 0.18})`
      kaart.style.opacity = String(1 - f * 0.5)
      if (afstand < minAfstand) { minAfstand = afstand; dichtst = i }
    })
    setActief(dichtst)
  }

  useEffect(() => {
    bijwerken()
    window.addEventListener('resize', bijwerken)
    return () => window.removeEventListener('resize', bijwerken)
  }, [entries])

  const naarKaart = (i: number) => {
    const el = ref.current
    const kaart = el?.children[i] as HTMLElement | undefined
    if (el && kaart) el.scrollTo({ left: kaart.offsetLeft + kaart.offsetWidth / 2 - el.clientWidth / 2, behavior: 'smooth' })
  }

  // Slepen met de muis; touch gebruikt de native scroll-snap.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !ref.current) return
    sleep.current = { x: e.clientX, scroll: ref.current.scrollLeft, bewogen: false }
    ref.current.style.scrollSnapType = 'none'
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!sleep.current || !ref.current) return
    const dx = e.clientX - sleep.current.x
    if (Math.abs(dx) > 3) sleep.current.bewogen = true
    ref.current.scrollLeft = sleep.current.scroll - dx
  }
  const stopSlepen = () => {
    if (!sleep.current || !ref.current) return
    sleep.current = null
    ref.current.style.scrollSnapType = ''
    naarKaart(actief)
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={bijwerken}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopSlepen}
        onPointerLeave={stopSlepen}
        className="verlof-carousel flex snap-x snap-mandatory gap-4 overflow-x-auto px-[calc(50%-5.5rem)] py-6 cursor-grab active:cursor-grabbing select-none"
      >
        {entries.map((e, i) => (
          <div
            key={e.id}
            onClick={() => naarKaart(i)}
            className="snap-center flex-shrink-0 w-44 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl p-5 text-center shadow-[0_12px_40px_-12px_rgba(33,35,62,0.35)] transition-[transform,opacity] duration-200 ease-out"
          >
            <div className="relative mx-auto h-20 w-20">
              <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${KLEUREN[i % KLEUREN.length]} blur-md opacity-50`} />
              <div className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br ${KLEUREN[i % KLEUREN.length]} ring-4 ring-white text-2xl font-bold text-white`}>
                {initialen(e.user_naam)}
              </div>
              {vandaagAfwezig(e) && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#FE8500] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
                  Vandaag
                </span>
              )}
            </div>
            <p className="mt-4 truncate text-sm font-semibold text-gray-900">{e.user_naam}</p>
            <p className="mt-1 text-xs font-medium text-[#105BFF]">{periode(e)}</p>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">{e.leave_type_display}</p>
          </div>
        ))}
      </div>

      {entries.length > 1 && (
        <div className="flex justify-center gap-1.5 pb-4">
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-label={e.user_naam}
              onClick={() => naarKaart(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === actief ? 'w-6 bg-[#105BFF]' : 'w-1.5 bg-gray-300'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
