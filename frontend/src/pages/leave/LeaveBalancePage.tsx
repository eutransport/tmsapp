/**
 * Leave Balance Page
 * Standalone page showing remaining leave hours for all employees.
 */
import { useTranslation } from 'react-i18next'
import { ScaleIcon } from '@heroicons/react/24/outline'
import LeaveBalanceTab from './LeaveBalanceTab'

export default function LeaveBalancePage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScaleIcon className="w-7 h-7 text-primary-600" />
        <div>
          <h1 className="page-title">{t('nav.leaveBalance')}</h1>
          <p className="text-gray-500">{t('leave.balanceOverview', 'Overzicht van verlofsaldo per medewerker')}</p>
        </div>
      </div>

      <LeaveBalanceTab />
    </div>
  )
}
