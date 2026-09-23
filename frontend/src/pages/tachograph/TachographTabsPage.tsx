/**
 * Tachograaf / ritgegevens met een tabblad per aanbieder.
 *
 * Linqo toont de bestaande tachograafpagina (live + archief); Radius toont de
 * ritgeschiedenis en het eigen archief.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ProviderTabs from '@/components/common/ProviderTabs'
import TachographPage from './TachographPage'
import RadiusJourneysPanel from './RadiusJourneysPanel'

const OPSLAG_SLEUTEL = 'tms-tachograph-provider-v2'

export default function TachographTabsPage() {
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
      {provider === 'linqo' ? <TachographPage /> : <RadiusJourneysPanel />}
    </div>
  )
}
