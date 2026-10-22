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

function nuLokaal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function NietGeleverdModal({ opdracht, onSluiten, onKlaar }: Props) {
  const { t } = useTranslation()
  const [reden, setReden] = useState('')
  const [moment, setMoment] = useState(nuLokaal())
  const [bestanden, setBestanden] = useState<File[]>([])

  const melden = useMutation({
    mutationFn: async () => {
      for (const bestand of bestanden) {
        await mijnOpdrachten.bijlageToevoegen(opdracht.id, bestand)
      }
      return mijnOpdrachten.nietGeleverd(opdracht.id, {
        niet_geleverd_reden: reden,
        niet_geleverd_op: new Date(moment).toISOString(),
      })
    },
    onSuccess: () => { toast.success(t('myOrders.notDeliveredDone', 'Gemeld als niet geleverd')); onKlaar() },
    onError: () => toast.error(t('common.error', 'Er ging iets mis')),
  })

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-h-[90vh] w-full overflow-y-auto p-5 sm:max-w-md">
        <h2 className="section-title">{t('myOrders.notDelivered', 'Niet geleverd')}</h2>
        <p className="mt-1 text-sm text-muted">{opdracht.klant_naam}</p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="label">{t('myOrders.reason', 'Reden')} *</label>
            <textarea rows={3} value={reden} onChange={e => setReden(e.target.value)} className="input-field" />
          </div>

          <div>
            <label className="label">{t('myOrders.reportedAt', 'Tijdstip')}</label>
            <input type="datetime-local" lang="nl-NL" value={moment}
              onChange={e => setMoment(e.target.value)} className="input-field" />
          </div>

          <label className="btn-secondary btn-sm cursor-pointer">
            <PaperClipIcon className="h-4 w-4" />
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
          <button onClick={() => melden.mutate()} disabled={melden.isPending || !reden.trim()}
            className="btn-warning">
            {t('myOrders.confirmNotDelivered', 'Melden')}
          </button>
        </div>
      </div>
    </div>
  )
}
