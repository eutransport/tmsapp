import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { portaalTracking } from '@/api/portaalTracking'
import PortaalRittenPerDag from '@/components/portaal/PortaalRittenPerDag'
import PortaalWagenStatus from '@/components/portaal/PortaalWagenStatus'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const wagenIcoon = (kenteken: string) =>
  L.divIcon({
    className: 'portaal-wagen-marker',
    html: `<span class="inline-flex items-center rounded-md bg-primary-600 px-2 py-1 text-xs font-semibold text-white shadow">${kenteken}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })

export default function PortaalKaartPage() {
  const { t, i18n } = useTranslation()
  const kaartElement = useRef<HTMLDivElement>(null)
  const kaart = useRef<L.Map | null>(null)
  const markers = useRef<Map<string, L.Marker>>(new Map())
  const [kenteken, setKenteken] = useState('')
  const [dagen, setDagen] = useState(1)

  const { data: voertuigen = [] } = useQuery({
    queryKey: ['portaal-voertuigen'],
    queryFn: portaalTracking.voertuigen,
  })

  const { data: posities, error: positieFout } = useQuery({
    queryKey: ['portaal-posities'],
    queryFn: portaalTracking.posities,
    refetchInterval: 30000,
  })

  const { data: ritten = [] } = useQuery({
    queryKey: ['portaal-ritten', kenteken, dagen],
    queryFn: () => portaalTracking.ritten({ kenteken: kenteken || undefined, dagen }),
  })

  const { data: wagenDag } = useQuery({
    queryKey: ['portaal-voertuig-dag', kenteken],
    queryFn: () => portaalTracking.voertuigDag(kenteken),
    enabled: Boolean(kenteken),
    refetchInterval: 60000,
  })

  useEffect(() => {
    if (!kaartElement.current || kaart.current) return
    const map = L.map(kaartElement.current, { center: [52.1, 5.3], zoom: 7 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    kaart.current = map
    return () => { map.remove(); kaart.current = null }
  }, [])

  const zichtbaar = useMemo(
    () => (posities?.positions || []).filter(p =>
      p.latitude != null && p.longitude != null && (!kenteken || p.kenteken === kenteken)
    ),
    [posities, kenteken]
  )

  useEffect(() => {
    const map = kaart.current
    if (!map) return

    const bestaand = new Set<string>()
    zichtbaar.forEach(positie => {
      const punt: L.LatLngExpression = [positie.latitude as number, positie.longitude as number]
      bestaand.add(positie.kenteken)
      const bestaande = markers.current.get(positie.kenteken)
      if (bestaande) {
        bestaande.setLatLng(punt)
      } else {
        const marker = L.marker(punt, { icon: wagenIcoon(positie.kenteken) }).addTo(map)
        marker.on('click', () => setKenteken(positie.kenteken))
        markers.current.set(positie.kenteken, marker)
      }
      markers.current.get(positie.kenteken)?.bindPopup(
        `<strong>${positie.kenteken}</strong><br>${positie.address || ''}`
      )
    })

    markers.current.forEach((marker, sleutel) => {
      if (!bestaand.has(sleutel)) {
        marker.remove()
        markers.current.delete(sleutel)
      }
    })

    if (zichtbaar.length > 0) {
      map.fitBounds(
        L.latLngBounds(zichtbaar.map(p => [p.latitude as number, p.longitude as number])),
        { padding: [40, 40], maxZoom: 13 }
      )
    }
  }, [zichtbaar])

  const totaalKm = useMemo(() => ritten.reduce((som, rit) => som + (rit.afstand_km || 0), 0), [ritten])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">
          {t('portaal.map', 'Waar is mijn wagen')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <select
            value={kenteken}
            onChange={e => setKenteken(e.target.value)}
            className="input-field"
          >
            <option value="">{t('portaalMap.allVehicles', 'Alle wagens')}</option>
            {voertuigen.map(v => <option key={v.id} value={v.kenteken}>{v.kenteken}</option>)}
          </select>
          <select
            value={dagen}
            onChange={e => setDagen(Number(e.target.value))}
            className="input-field"
          >
            <option value={1}>{t('portaalMap.today', 'Vandaag')}</option>
            <option value={7}>{t('portaalMap.week', 'Laatste 7 dagen')}</option>
            <option value={31}>{t('portaalMap.month', 'Laatste 31 dagen')}</option>
          </select>
        </div>
      </div>

      {voertuigen.length === 0 && (
        <p className="card bg-warning-50 p-4 text-sm text-warning-700">
          {t('portaalMap.noVehicles', 'Er zijn nog geen wagens aan u toegewezen. Neem contact op met Moveo.')}
        </p>
      )}

      {positieFout && (
        <p className="card bg-danger-50 p-4 text-sm text-danger-700">
          {t('portaalMap.unavailable', 'De volgdienst is tijdelijk niet beschikbaar.')}
        </p>
      )}

      <div ref={kaartElement} className="h-[50vh] w-full card sm:h-[60vh]" />

      {wagenDag && <PortaalWagenStatus dag={wagenDag} />}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="section-title">
            {t('portaalMap.history', 'Waar is de wagen geweest')}
          </h2>
          {ritten.length > 0 && (
            <span className="text-sm text-muted">
              {ritten.length} {t('radius.journeyCount', 'Ritten').toLowerCase()} &middot;{' '}
              {totaalKm.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} km
            </span>
          )}
        </div>
        <PortaalRittenPerDag ritten={ritten} />
      </div>
    </div>
  )
}
