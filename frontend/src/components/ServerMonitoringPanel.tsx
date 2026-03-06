/**
 * ServerMonitoringPanel - Live server monitoring dashboard
 * Shows CPU, RAM, disk usage, historical graphs, container status and logs.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CpuChipIcon,
  CircleStackIcon,
  ServerIcon,
  CommandLineIcon,
  ChartBarIcon,
  ArrowPathIcon,
  SignalIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { settingsApi } from '@/api/settings'
import type {
  ServerStats,
  MetricsPoint,
  ContainerInfo,
  ContainerLogsResponse,
} from '@/api/settings'

// Sub-tabs for the monitoring panel
type MonitoringTab = 'overview' | 'history' | 'containers' | 'logs'
type HistoryPeriod = '1h' | '12h' | '1d' | '1w' | '1m'

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}u ${mins}m`
  if (hours > 0) return `${hours}u ${mins}m`
  return `${mins}m`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Gauge component for showing percentages
function GaugeCard({
  label,
  value,
  icon: Icon,
  color,
  detail,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  color: string
  detail?: string
}) {
  const getBarColor = (v: number) => {
    if (v >= 90) return 'bg-red-500'
    if (v >= 70) return 'bg-yellow-500'
    return color
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5 text-gray-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        {value.toFixed(1)}%
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-1">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${getBarColor(value)}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      {detail && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{detail}</p>
      )}
    </div>
  )
}

// Container status row
function ContainerRow({
  container,
  onViewLogs,
}: {
  container: ContainerInfo
  onViewLogs: (id: string, name: string) => void
}) {
  const stateColors: Record<string, string> = {
    running: 'bg-green-500',
    exited: 'bg-red-500',
    paused: 'bg-yellow-500',
    restarting: 'bg-blue-500',
  }

  return (
    <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${stateColors[container.state] || 'bg-gray-400'}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {container.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {container.image}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
          {container.status}
        </span>
        {container.stats && (
          <span className="text-xs text-gray-500 hidden md:inline">
            CPU: {container.stats.cpu_percent.toFixed(1)}% | RAM: {formatBytes(container.stats.memory_usage)}
          </span>
        )}
        {container.state === 'running' && (
          <button
            onClick={() => onViewLogs(container.id, container.name)}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
            title="Logs bekijken"
          >
            <CommandLineIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export default function ServerMonitoringPanel() {
  const [activeTab, setActiveTab] = useState<MonitoringTab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Overview data
  const [stats, setStats] = useState<ServerStats | null>(null)

  // History data
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('1h')
  const [historyData, setHistoryData] = useState<MetricsPoint[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Containers
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [dockerAvailable, setDockerAvailable] = useState(true)

  // Logs
  const [selectedContainer, setSelectedContainer] = useState<{ id: string; name: string } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-refresh interval
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const data = await settingsApi.getServerStats()
      setStats(data)
      setError(null)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Kan servergegevens niet ophalen')
    }
  }, [])

  const fetchHistory = useCallback(async (period: HistoryPeriod) => {
    setHistoryLoading(true)
    try {
      const data = await settingsApi.getServerHistory(period)
      setHistoryData(data.points || [])
    } catch {
      setHistoryData([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const fetchContainers = useCallback(async () => {
    try {
      const data = await settingsApi.getServerContainers(true)
      setDockerAvailable(data.available)
      setContainers(data.containers || [])
    } catch {
      setDockerAvailable(false)
    }
  }, [])

  const fetchLogs = useCallback(async (containerId: string) => {
    setLogsLoading(true)
    try {
      const data: ContainerLogsResponse = await settingsApi.getContainerLogs(containerId, 200)
      setLogs(data.lines || [])
    } catch {
      setLogs(['Fout bij ophalen van logs.'])
    } finally {
      setLogsLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      setLoading(true)
      await Promise.all([fetchStats(), fetchContainers()])
      setLoading(false)
    }
    loadInitial()
  }, [fetchStats, fetchContainers])

  // Auto-refresh every 10 seconds for overview
  useEffect(() => {
    if (activeTab === 'overview') {
      refreshInterval.current = setInterval(fetchStats, 10000)
    } else if (activeTab === 'containers') {
      refreshInterval.current = setInterval(fetchContainers, 15000)
    }
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current)
    }
  }, [activeTab, fetchStats, fetchContainers])

  // Fetch history when period changes
  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory(historyPeriod)
    }
  }, [activeTab, historyPeriod, fetchHistory])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleViewLogs = (id: string, name: string) => {
    setSelectedContainer({ id, name })
    setActiveTab('logs')
    fetchLogs(id)
  }

  const handleRefresh = () => {
    if (activeTab === 'overview') fetchStats()
    else if (activeTab === 'history') fetchHistory(historyPeriod)
    else if (activeTab === 'containers') fetchContainers()
    else if (activeTab === 'logs' && selectedContainer) fetchLogs(selectedContainer.id)
  }

  const subTabs: { id: MonitoringTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overzicht', icon: ChartBarIcon },
    { id: 'history', label: 'Activiteit', icon: SignalIcon },
    { id: 'containers', label: 'Containers', icon: ServerIcon },
    { id: 'logs', label: 'Logboek', icon: CommandLineIcon },
  ]

  const periodLabels: Record<HistoryPeriod, string> = {
    '1h': '1 uur',
    '12h': '12 uur',
    '1d': '1 dag',
    '1w': '1 week',
    '1m': '1 maand',
  }

  // Chart color scheme
  const chartColors = {
    cpu: '#3B82F6',
    ram: '#10B981',
    disk: '#F59E0B',
    diskRead: '#6366F1',
    diskWrite: '#EC4899',
    netSent: '#8B5CF6',
    netRecv: '#14B8A6',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <ArrowPathIcon className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Monitoring laden...</span>
      </div>
    )
  }

  if (error && !stats) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        <button onClick={fetchStats} className="mt-2 text-sm text-red-600 underline">
          Opnieuw proberen
        </button>
      </div>
    )
  }

  // Prepare history chart data with computed I/O rates
  const chartData = historyData.map((point, idx) => {
    const prev = idx > 0 ? historyData[idx - 1] : null
    const timeDiff = prev ? point.t - prev.t : 60

    return {
      time: historyPeriod === '1h' || historyPeriod === '12h'
        ? formatTime(point.t)
        : formatDateTime(point.t),
      cpu: point.cpu,
      ram: point.ram_pct,
      disk: point.disk_pct,
      // I/O rates (bytes/sec)
      dioRead: prev && timeDiff > 0
        ? Math.max(0, Math.round((point.dio_r - prev.dio_r) / timeDiff))
        : 0,
      dioWrite: prev && timeDiff > 0
        ? Math.max(0, Math.round((point.dio_w - prev.dio_w) / timeDiff))
        : 0,
      netSent: prev && timeDiff > 0
        ? Math.max(0, Math.round((point.net_s - prev.net_s) / timeDiff))
        : 0,
      netRecv: prev && timeDiff > 0
        ? Math.max(0, Math.round((point.net_r - prev.net_r) / timeDiff))
        : 0,
    }
  })

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 gap-1">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          title="Vernieuwen"
        >
          <ArrowPathIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Vernieuwen</span>
        </button>
      </div>

      {/* ==================== OVERVIEW TAB ==================== */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-4">
          {/* Gauges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <GaugeCard
              label="CPU"
              value={stats.cpu.percent}
              icon={CpuChipIcon}
              color="bg-blue-500"
              detail={`${stats.cpu.cores} cores | Load: ${stats.cpu.load.load_1.toFixed(2)}`}
            />
            <GaugeCard
              label="RAM"
              value={stats.memory.percent}
              icon={ChartBarIcon}
              color="bg-green-500"
              detail={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
            />
            <GaugeCard
              label="Schijf"
              value={stats.disk.percent}
              icon={CircleStackIcon}
              color="bg-yellow-500"
              detail={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)} (${formatBytes(stats.disk.free)} vrij)`}
            />
          </div>

          {/* System info */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Systeem info</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Uptime</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatUptime(stats.uptime)}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Load (1/5/15m)</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {stats.cpu.load.load_1.toFixed(2)} / {stats.cpu.load.load_5.toFixed(2)} / {stats.cpu.load.load_15.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Netwerk verzonden</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatBytes(stats.network.bytes_sent)}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Netwerk ontvangen</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatBytes(stats.network.bytes_recv)}</p>
              </div>
            </div>
          </div>

          {/* Quick container status */}
          {containers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Containers</h4>
              <div className="space-y-2">
                {containers.map((c) => (
                  <ContainerRow key={c.id} container={c} onViewLogs={handleViewLogs} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== HISTORY TAB ==================== */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Period selector */}
          <div className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-500">Periode:</span>
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 gap-0.5">
              {(Object.keys(periodLabels) as HistoryPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setHistoryPeriod(p)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    historyPeriod === p
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  {periodLabels[p]}
                </button>
              ))}
            </div>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <ArrowPathIcon className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <SignalIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Nog geen historische data beschikbaar.</p>
              <p className="text-xs text-gray-400 mt-1">
                Data wordt elke minuut verzameld. Wacht even tot de eerste datapunten zijn opgeslagen.
              </p>
            </div>
          ) : (
            <>
              {/* CPU & RAM Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">CPU & RAM gebruik (%)</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={((value: any, name: any) => [
                        `${Number(value).toFixed(1)}%`,
                        name === 'cpu' ? 'CPU' : name === 'ram' ? 'RAM' : 'Schijf',
                      ]) as any}
                    />
                    <Legend
                      formatter={(value) =>
                        value === 'cpu' ? 'CPU' : value === 'ram' ? 'RAM' : 'Schijf'
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cpu"
                      stroke={chartColors.cpu}
                      fill={chartColors.cpu}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="ram"
                      stroke={chartColors.ram}
                      fill={chartColors.ram}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Disk Usage Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Schijfgebruik (%)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={((value: any) => [`${Number(value).toFixed(1)}%`, 'Schijf']) as any} />
                    <Area
                      type="monotone"
                      dataKey="disk"
                      stroke={chartColors.disk}
                      fill={chartColors.disk}
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Disk I/O Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Schijf I/O (bytes/sec)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData.slice(1)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatBytes(v)} />
                    <Tooltip
                      formatter={((value: any, name: any) => [
                        `${formatBytes(Number(value))}/s`,
                        name === 'dioRead' ? 'Lezen' : 'Schrijven',
                      ]) as any}
                    />
                    <Legend formatter={(v) => (v === 'dioRead' ? 'Lezen' : 'Schrijven')} />
                    <Area
                      type="monotone"
                      dataKey="dioRead"
                      stroke={chartColors.diskRead}
                      fill={chartColors.diskRead}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="dioWrite"
                      stroke={chartColors.diskWrite}
                      fill={chartColors.diskWrite}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Network I/O Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Netwerk I/O (bytes/sec)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData.slice(1)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatBytes(v)} />
                    <Tooltip
                      formatter={((value: any, name: any) => [
                        `${formatBytes(Number(value))}/s`,
                        name === 'netSent' ? 'Verzonden' : 'Ontvangen',
                      ]) as any}
                    />
                    <Legend formatter={(v) => (v === 'netSent' ? 'Verzonden' : 'Ontvangen')} />
                    <Area
                      type="monotone"
                      dataKey="netSent"
                      stroke={chartColors.netSent}
                      fill={chartColors.netSent}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="netRecv"
                      stroke={chartColors.netRecv}
                      fill={chartColors.netRecv}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* ==================== CONTAINERS TAB ==================== */}
      {activeTab === 'containers' && (
        <div className="space-y-3">
          {!dockerAvailable ? (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Docker socket niet beschikbaar. Zorg dat <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">/var/run/docker.sock</code> gemount is in de backend container.
              </p>
            </div>
          ) : containers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">Geen containers gevonden.</p>
          ) : (
            containers.map((c) => (
              <ContainerRow key={c.id} container={c} onViewLogs={handleViewLogs} />
            ))
          )}
        </div>
      )}

      {/* ==================== LOGS TAB ==================== */}
      {activeTab === 'logs' && (
        <div className="space-y-3">
          {/* Container selector */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-500">Container:</label>
            <select
              value={selectedContainer?.id || ''}
              onChange={(e) => {
                const c = containers.find((c) => c.id === e.target.value)
                if (c) {
                  setSelectedContainer({ id: c.id, name: c.name })
                  fetchLogs(c.id)
                }
              }}
              className="input-field text-sm py-1 max-w-xs"
            >
              <option value="">Selecteer container...</option>
              {containers
                .filter((c) => c.state === 'running')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            {selectedContainer && (
              <button
                onClick={() => fetchLogs(selectedContainer.id)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                Vernieuwen
              </button>
            )}
          </div>

          {/* Log viewer */}
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <ArrowPathIcon className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : !selectedContainer ? (
            <div className="text-center py-8 text-gray-500">
              <CommandLineIcon className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Selecteer een container om logs te bekijken.</p>
            </div>
          ) : (
            <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-[500px] overflow-y-auto font-mono text-xs">
              {logs.length === 0 ? (
                <p className="text-gray-500">Geen logs beschikbaar.</p>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all py-0.5 ${
                      line.includes('[stderr]')
                        ? 'text-red-400'
                        : line.includes('ERROR') || line.includes('error')
                        ? 'text-red-300'
                        : line.includes('WARNING') || line.includes('warning')
                        ? 'text-yellow-300'
                        : 'text-green-300'
                    }`}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
