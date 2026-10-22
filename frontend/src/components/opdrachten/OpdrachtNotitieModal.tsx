import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Opdracht } from '@/api/opdrachten'

interface Props {
  opdracht: Opdracht
  onSluiten: () => void
}

export default function OpdrachtNotitieModal({ opdracht, onSluiten }: Props) {
  const { t } = useTranslation()

  const blok = (titel: string, tekst: string, kleur: string) => (
    <div>
      <p className="label">{titel}</p>
      <p className={`whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${kleur}`}>{tekst}</p>
    </div>
  )

  const leeg = !opdracht.notitie && !opdracht.chauffeur_reactie && !opdracht.niet_geleverd_reden

  return (
    <div className="modal-overlay">
      <div className="modal-panel w-full max-h-[85vh] overflow-y-auto p-5 sm:max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="section-title">{t('orders.notes', 'Notities')}</h2>
            <p className="text-sm text-muted">
              {opdracht.ritnummer ? `${opdracht.ritnummer} · ` : ''}{opdracht.klant_naam}
            </p>
          </div>
          <button onClick={onSluiten} className="btn-icon text-gray-400 hover:text-gray-700">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {leeg && <p className="text-sm text-muted">{t('orders.noNotes', 'Er zijn nog geen notities.')}</p>}
          {opdracht.notitie &&
            blok(t('orders.noteFromClient', 'Notitie van de opdrachtgever'), opdracht.notitie, 'bg-gray-50 text-gray-700')}
          {opdracht.chauffeur_reactie &&
            blok(t('orders.noteFromDriver', 'Reactie van de chauffeur'), opdracht.chauffeur_reactie, 'bg-primary-50 text-primary-800')}
          {opdracht.niet_geleverd_reden &&
            blok(t('orders.reason', 'Reden'), opdracht.niet_geleverd_reden, 'bg-warning-50 text-warning-700')}
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onSluiten} className="btn btn-secondary">{t('common.close', 'Sluiten')}</button>
        </div>
      </div>
    </div>
  )
}
