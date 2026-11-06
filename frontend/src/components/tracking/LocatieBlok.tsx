import { MapPinIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import type { VoertuigLocatie } from '@/api/tracking'

/** Regel 1: straat + nummer (of de weg). Regel 2: postcode plaats, land. */
export function locatieRegels(l: VoertuigLocatie) {
  const regel1 = [l.straat, l.huisnummer].filter(Boolean).join(' ')
  const regel2 = [[l.postcode, l.plaats].filter(Boolean).join(' '), l.land].filter(Boolean).join(', ')
  return { regel1, regel2 }
}

export default function LocatieBlok({ locatie, fallback, tijd }: {
  locatie: VoertuigLocatie | null | undefined
  fallback?: string
  tijd?: string
}) {
  if (!locatie) {
    return fallback ? (
      <p className="flex items-center gap-2 text-sm text-gray-700">
        <MapPinIcon className="h-4 w-4 flex-shrink-0 text-primary-600" />{fallback}
      </p>
    ) : null
  }
  const { regel1, regel2 } = locatieRegels(locatie)
  const coords = `${locatie.latitude.toFixed(6)}, ${locatie.longitude.toFixed(6)}`

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-primary-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <MapPinIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-gray-900">
            {regel1 || regel2 || 'Adres onbekend'}
            {locatie.op_weg && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Onderweg</span>
            )}
          </p>
          {regel1 && regel2 && <p className="text-gray-700">{regel2}</p>}
          <p className="text-xs text-gray-500">
            <span className="select-all font-mono">{coords}</span>
            {tijd && <> &middot; {tijd}</>}
          </p>
        </div>
      </div>
      <a
        href={locatie.google_maps_url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary inline-flex flex-shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-sm"
      >
        Open in Google Maps
        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
      </a>
    </div>
  )
}
