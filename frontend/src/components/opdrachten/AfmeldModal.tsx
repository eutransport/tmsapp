import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { PaperClipIcon } from '@heroicons/react/24/outline'
import { BIJLAGE_ACCEPT, MijnOpdracht, mijnOpdrachten } from '@/api/opdrachten'

interface Props {
  opdracht: MijnOpdracht
  onSluiten: () => void
  onKlaar: () => void
}

function nuAlsInvoer() {
  const nu = new Date()
  nu.setMinutes(nu.getMinutes() - nu.getTimezoneOffset())
  return nu.toISOString().slice(0, 16)
}

export default function AfmeldModal({ opdracht, onSluiten, onKlaar }: Props) {
  const { t } = useTranslation()
  const [moment, setMoment] = useState(nuAlsInvoer())
  const [reactie, setReactie] = useState(opdracht.chauffeur_reactie || '')
  const [bestanden, setBestanden] = useState<File[]>([])

  const afmelden = useMutation({
    mutationFn: async () => {
      // Bijlagen eerst, zodat ze meegaan in de afleverbevestiging.
      for (const bestand of bestanden) {
        await mijnOpdrachten.bijlageToevoegen(opdracht.id, bestand)
      }
      return mijnOpdrachten.afmelden(opdracht.id, {
        afgeleverd_op: new Date(moment).toISOString(),
        chauffeur_reactie: reactie,
      })
    },
    onSuccess: () => { toast.success(t('myOrders.delivered', 'Opdracht afgemeld')); onKlaar() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-h-[90vh] w-full overflow-y-auto p-5 sm:max-w-md">
        <h2 className="section-title">
          {t('myOrders.deliver', 'Afgeleverd melden')}
        </h2>
        <p className="mt-1 text-sm text-muted">{opdracht.klant_naam}</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">{t('myOrders.deliveryTime', 'Tijd van levering')}</label>
            <input type="datetime-local" lang="nl-NL" value={moment} onChange={e => setMoment(e.target.value)}
              className="input-field" />
          </div>

          <div>
            <label className="label">{t('myOrders.remark', 'Opmerking')}</label>
            <textarea rows={3} value={reactie} onChange={e => setReactie(e.target.value)}
              className="input-field" />
          </div>

          <label className="btn-secondary cursor-pointer">
            <PaperClipIcon className="h-5 w-5" />
            {t('myOrders.addPhoto', 'Foto of bestand toevoegen')}
            <input type="file" multiple accept={BIJLAGE_ACCEPT} capture="environment" className="hidden"
              onChange={e => setBestanden(Array.from(e.target.files || []))} />
          </label>
          {bestanden.length > 0 && (
            <ul className="text-xs text-muted">
              {bestanden.map(b => <li key={b.name}>{b.name}</li>)}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onSluiten} className="btn-secondary">
            {t('common.cancel', 'Annuleren')}
          </button>
          <button onClick={() => afmelden.mutate()} disabled={afmelden.isPending} className="btn-success">
            {t('myOrders.confirmDeliver', 'Afmelden')}
          </button>
        </div>
      </div>
    </div>
  )
}
