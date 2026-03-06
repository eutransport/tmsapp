/**
 * Revenue Dashboard Page
 * Shows income, expenses and profit charts with period filters
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CurrencyEuroIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BanknotesIcon,
  CalendarIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ReceiptRefundIcon,
} from '@heroicons/react/24/outline'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
} from 'recharts'
import { revenueApi, RevenueResponse } from '@/api/revenue'
import toast from 'react-hot-toast'

type PeriodType = 'week' | 'month' | 'quarter' | 'year'

// Format currency
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

// Stat Card Component
interface StatCardProps {
  title: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  color: 'green' | 'red' | 'blue' | 'orange' | 'purple' | 'emerald'
  subtitle?: string
}

function StatCard({ title, value, icon: Icon, color, subtitle }: StatCardProps) {
  const colorClasses = {
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  }
  
  const iconClasses = {
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    orange: 'bg-orange-100 text-orange-600',
    purple: 'bg-purple-100 text-purple-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  }

  return (
    <div className={`rounded-xl border p-6 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(value)}</p>
          {subtitle && <p className="text-xs opacity-60 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${iconClasses[color]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  )
}

// Custom tooltip for charts
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
      <p className="font-medium text-gray-900 mb-2">{label}</p>
      {payload.map((item: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-gray-600">{item.name}:</span>
          <span className="font-medium">{formatCurrency(item.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function RevenuePage() {
  const { t } = useTranslation()
  
  // Translated period options
  const PERIOD_OPTIONS = [
    { value: 'week' as const, label: t('revenue.perWeek', 'Per Week') },
    { value: 'month' as const, label: t('revenue.perMonth', 'Per Maand') },
    { value: 'quarter' as const, label: t('revenue.perQuarter', 'Per Kwartaal') },
    { value: 'year' as const, label: t('revenue.perYear', 'Per Jaar') },
  ]

  // State
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodType>('month')
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [years, setYears] = useState<number[]>([])
  const [data, setData] = useState<RevenueResponse | null>(null)

  // Load available years
  useEffect(() => {
    const loadYears = async () => {
      try {
        const availableYears = await revenueApi.getYears()
        setYears(availableYears.length > 0 ? availableYears : [new Date().getFullYear()])
      } catch (error) {
        console.error('Failed to load years:', error)
        setYears([new Date().getFullYear()])
      }
    }
    loadYears()
  }, [])

  // Load revenue data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const response = await revenueApi.getData({ period, year })
        setData(response)
      } catch (error) {
        console.error('Failed to load revenue data:', error)
        toast.error(t('revenue.loadError', 'Kon omzetgegevens niet laden'))
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [period, year])

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!data?.data) return []
    return data.data.map(item => ({
      ...item,
      name: item.label,
    }))
  }, [data])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('revenue.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('revenue.revenueOverview', 'Inkomsten, uitgaven en winst overzicht')}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Year selector */}
          <div className="relative">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Period selector */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setPeriod(option.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  period === option.value
                    ? 'bg-white text-primary-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <ArrowPathIcon className="h-8 w-8 text-primary-600 animate-spin" />
        </div>
      )}

      {/* Content */}
      {!loading && data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title={t('revenue.totalIncome', 'Totale Inkomsten')}
              value={data.totals.income}
              icon={ArrowTrendingUpIcon}
              color="green"
              subtitle={`${t('revenue.avg', 'Gem.')} ${formatCurrency(data.summary.avg_income)} ${t('common.per')} ${period === 'week' ? t('common.week').toLowerCase() : period === 'month' ? t('common.month').toLowerCase() : period === 'quarter' ? t('revenue.quarter', 'kwartaal') : t('common.year').toLowerCase()}`}
            />
            <StatCard
              title={t('revenue.creditInvoices', 'Creditfacturen')}
              value={data.totals.credit}
              icon={ReceiptRefundIcon}
              color="orange"
              subtitle={t('revenue.creditSubtitle', 'Creditfacturen als uitgaven')}
            />
            <StatCard
              title={t('revenue.totalExpenses', 'Totale Uitgaven')}
              value={data.totals.expenses}
              icon={ArrowTrendingDownIcon}
              color="red"
              subtitle={`${t('revenue.avg', 'Gem.')} ${formatCurrency(data.summary.avg_expenses)} ${t('common.per')} ${period === 'week' ? t('common.week').toLowerCase() : period === 'month' ? t('common.month').toLowerCase() : period === 'quarter' ? t('revenue.quarter', 'kwartaal') : t('common.year').toLowerCase()}`}
            />
            <StatCard
              title={t('revenue.profit', 'Winst')}
              value={data.totals.profit}
              icon={BanknotesIcon}
              color={data.totals.profit >= 0 ? 'blue' : 'red'}
              subtitle={`${t('revenue.profitMargin', 'Winstmarge')}: ${data.summary.profit_margin}%`}
            />
            <StatCard
              title={t('revenue.totalCollected', 'Totaal Gevorderd')}
              value={data.totals.collected}
              icon={CheckCircleIcon}
              color="emerald"
              subtitle={t('revenue.collectedSubtitle', 'Facturen gemarkeerd als betaald')}
            />
            <StatCard
              title={t('revenue.totalOutstanding', 'Totaal Nog Te Vorderen')}
              value={data.totals.outstanding}
              icon={ClockIcon}
              color="purple"
              subtitle={t('revenue.outstandingSubtitle', 'Facturen nog niet betaald')}
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <ArrowTrendingUpIcon className="inline h-5 w-5 mr-2 text-green-500" />
                {t('revenue.income', 'Inkomsten')}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `€${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar 
                      dataKey="income" 
                      name={t('revenue.income', 'Inkomsten')}
                      fill="#22c55e" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Expenses Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <ArrowTrendingDownIcon className="inline h-5 w-5 mr-2 text-red-500" />
                {t('revenue.expenses', 'Uitgaven')}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `€${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar 
                      dataKey="expenses" 
                      name={t('revenue.expenses', 'Uitgaven')}
                      fill="#ef4444" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Profit Chart - Full Width */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <BanknotesIcon className="inline h-5 w-5 mr-2 text-blue-500" />
                {t('revenue.profitOverview', 'Winst Overzicht')}
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `€${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="profit"
                      name={t('revenue.profit', 'Winst')}
                      fill="#3b82f6"
                      fillOpacity={0.2}
                      stroke="#3b82f6"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="income"
                      name={t('revenue.income', 'Inkomsten')}
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ fill: '#22c55e', strokeWidth: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="expenses"
                      name={t('revenue.expenses', 'Uitgaven')}
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ fill: '#ef4444', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{t('revenue.detailOverview', 'Detail Overzicht')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.period', 'Periode')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.income', 'Inkomsten')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.creditInvoices', 'Creditfacturen')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.expenses', 'Uitgaven')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.profit', 'Winst')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t('revenue.margin', 'Marge')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.data.map((item, index) => {
                    const margin = item.income > 0 
                      ? ((item.profit / item.income) * 100).toFixed(1) 
                      : '0.0'
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.label}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                          {formatCurrency(item.income)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-600 font-medium">
                          {formatCurrency(item.credit)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-600 font-medium">
                          {formatCurrency(item.expenses)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-bold ${
                          item.profit >= 0 ? 'text-blue-600' : 'text-red-600'
                        }`}>
                          {formatCurrency(item.profit)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                          {margin}%
                        </td>
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr className="bg-gray-100 font-bold">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t('common.total')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-700">
                      {formatCurrency(data.totals.income)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-orange-700">
                      {formatCurrency(data.totals.credit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-red-700">
                      {formatCurrency(data.totals.expenses)}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${
                      data.totals.profit >= 0 ? 'text-blue-700' : 'text-red-700'
                    }`}>
                      {formatCurrency(data.totals.profit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700">
                      {data.summary.profit_margin}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Empty state */}
          {data.data.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-200">
              <CurrencyEuroIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">{t('common.noData')}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('revenue.noDataForYear', 'Er zijn nog geen facturen of uitgaven voor {{year}}.', { year })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
