import { useTranslation } from 'react-i18next'
import { OpdrachtStatus } from '@/api/opdrachten'

const kleuren: Record<OpdrachtStatus, string> = {
  nieuw: 'chip',
  gestart: 'chip chip-primary',
  afgeleverd: 'chip chip-success',
  niet_geleverd: 'chip chip-warning',
  ingetrokken: 'chip chip-danger',
}

export default function OpdrachtStatusBadge({
  status,
  label,
}: {
  status: OpdrachtStatus
  label?: string
}) {
  const { t } = useTranslation()
  // Het label uit de backend is Nederlands en dient alleen als terugval.
  return <span className={kleuren[status]}>{t(`orderStatus.${status}`, label || status)}</span>
}
