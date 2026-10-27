import { useTranslation } from 'react-i18next'
import { OpdrachtFase, Werksoort } from '@/api/opdrachten'

/** Wat er op dit adres moet gebeuren: laden, lossen of allebei. */
export function WerkBadge({ werksoort, label }: { werksoort: Werksoort; label?: string }) {
  const { t } = useTranslation()
  return (
    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
      {t(`orderWork.${werksoort}`, label || werksoort)}
    </span>
  )
}

/** Voortgang binnen een lopende rit; onderweg tonen we niets extra's. */
export function FaseBadge({ fase, label }: { fase: OpdrachtFase; label?: string }) {
  const { t } = useTranslation()
  if (fase === 'onderweg') return null
  const kleur = fase === 'wachten_op_klant'
    ? 'bg-amber-50 text-amber-700'
    : 'bg-emerald-50 text-emerald-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${kleur}`}>
      {t(`orderPhase.${fase}`, label || fase)}
    </span>
  )
}
