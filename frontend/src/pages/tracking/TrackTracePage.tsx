/**
 * Track & Trace met een tabblad per telematics-aanbieder.
 *
 * De Linqo-weergave is de bestaande pagina en blijft ongewijzigd; Radius
 * heeft zijn eigen paneel.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ProviderTabs from '@/components/common/ProviderTabs'
import TrackingPage from './TrackingPage'
import RadiusTrackingPanel from './RadiusTrackingPanel'

const OPSLAG_SLEUTEL = 'tms-track-trace-provider-v2'

export default function TrackTracePage() {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<string>(
    () => localStorage.getItem(OPSLAG_SLEUTEL) || 'radius',
  )

  const wissel = (id: string) => {
    setProvider(id)
    localStorage.setItem(OPSLAG_SLEUTEL, id)
  }

  return (
    <div className="space-y-4">
      <ProviderTabs
        tabs={[
          { id: 'radius', label: t('providers.radius', 'Radius') },
          { id: 'linqo', label: t('providers.linqo', 'Linqo') },
        ]}
        active={provider}
        onChange={wissel}
      />
      {provider === 'linqo' ? <TrackingPage /> : <RadiusTrackingPanel />}
    </div>
  )
}
