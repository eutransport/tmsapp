import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PortaalRit, portaalTracking } from '@/api/portaalTracking'

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

  const tijd = (waarde: string | null) =>
    waarde ? new Date(waarde).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : '-'

  const plaats = (rit: PortaalRit, kant: 'start' | 'eind') =>
    (kant === 'start' ? rit.start_plaats || rit.start_adres : rit.eind_plaats || rit.eind_adres) || '-'

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

      <div className="card">
        <h2 className="section-title border-b border-gray-200 px-4 py-3">
          {t('portaalMap.history', 'Waar is de wagen geweest')}
        </h2>
        {ritten.length === 0 ? (
          <p className="p-4 text-sm text-muted">{t('portaalMap.noTrips', 'Geen ritten in deze periode.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('portaalMap.date', 'Datum')}</th>
                  <th className="px-4 py-3">{t('orders.plate', 'Kenteken')}</th>
                  <th className="px-4 py-3">{t('portaalMap.from', 'Van')}</th>
                  <th className="px-4 py-3">{t('portaalMap.to', 'Naar')}</th>
                  <th className="px-4 py-3">{t('portaalMap.distance', 'Afstand')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ritten.map(rit => (
                  <tr key={rit.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {new Date(rit.datum).toLocaleDateString(i18n.language)}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{rit.kenteken}</td>
                      <td className="px-4 py-3 text-gray-700">{tijd(rit.start_tijd)} &middot; {plaats(rit, 'start')}</td>
                      <td className="px-4 py-3 text-gray-700">{tijd(rit.eind_tijd)} &middot; {plaats(rit, 'eind')}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{rit.afstand_km} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
