import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { portaalOpdrachten } from '@/api/opdrachten'

export default function MailInstellingModal({ onSluiten }: { onSluiten: () => void }) {
  const { t } = useTranslation()
  const [ontvangers, setOntvangers] = useState('')
  const [bijStart, setBijStart] = useState(true)
  const [bijAflevering, setBijAflevering] = useState(true)
  const [bijNietGeleverd, setBijNietGeleverd] = useState(true)
  const [taal, setTaal] = useState<'nl' | 'en' | 'tr'>('nl')

  const { data, isLoading } = useQuery({
    queryKey: ['portaal-mailinstelling'],
    queryFn: portaalOpdrachten.mailinstelling,
  })

  useEffect(() => {
    if (!data) return
    setOntvangers(data.ontvangers.join(', '))
    setBijStart(data.mail_bij_start)
    setBijAflevering(data.mail_bij_aflevering)
    setBijNietGeleverd(data.mail_bij_niet_geleverd)
    setTaal(data.taal || 'nl')
  }, [data])

  const opslaan = useMutation({
    mutationFn: () =>
      portaalOpdrachten.mailinstellingOpslaan({
        ontvangers: ontvangers.split(/[,;\s]+/).map(a => a.trim()).filter(Boolean),
        mail_bij_start: bijStart,
        mail_bij_aflevering: bijAflevering,
        mail_bij_niet_geleverd: bijNietGeleverd,
        taal,
      }),
    onSuccess: () => { toast.success(t('common.saved', 'Opgeslagen')); onSluiten() },
    onError: () => toast.error(t('orders.mailInvalid', 'Controleer de e-mailadressen')),
  })

  return (
    <div className="modal-overlay">
      <div className="modal-panel w-full p-5 sm:max-w-lg">
        <h2 className="section-title">
          {t('orders.mailSettings', 'Mailmeldingen')}
        </h2>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted">{t('common.loading', 'Laden...')}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">
              {t('orders.mailSender', 'Afzender')}: <span className="font-medium">{data?.afzender}</span>
            </p>

            <div>
              <label className="label">{t('orders.mailLanguage', 'Taal van de mail')}</label>
              <select value={taal} onChange={e => setTaal(e.target.value as 'nl' | 'en' | 'tr')} className="input-field">
                <option value="nl">Nederlands</option>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>

            <div>
              <label className="label">{t('orders.mailRecipients', 'Ontvangers')}</label>
              <textarea
                rows={3}
                value={ontvangers}
                onChange={e => setOntvangers(e.target.value)}
                placeholder="naam@bedrijf.nl, planning@bedrijf.nl"
                className="input-field"
              />
              <span className="text-xs text-muted">
                {t('orders.mailRecipientsHelp', 'Scheid meerdere adressen met een komma.')}
              </span>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bijStart} onChange={e => setBijStart(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300" />
              {t('orders.mailOnStart', 'Mail zodra de chauffeur de opdracht start')}
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bijAflevering} onChange={e => setBijAflevering(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300" />
              {t('orders.mailOnDelivery', 'Mail zodra de opdracht is afgeleverd')}
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bijNietGeleverd} onChange={e => setBijNietGeleverd(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300" />
              {t('orders.mailOnNotDelivered', 'Mail zodra de opdracht niet geleverd kon worden')}
            </label>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onSluiten} className="btn-secondary">
            {t('common.cancel', 'Annuleren')}
          </button>
          <button onClick={() => opslaan.mutate()} disabled={opslaan.isPending || isLoading} className="btn-primary">
            {t('common.save', 'Opslaan')}
          </button>
        </div>
      </div>
    </div>
  )
}
