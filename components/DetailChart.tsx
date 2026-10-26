import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  TimeScale,
  Filler,
} from 'chart.js'
import 'chartjs-adapter-moment'
import { MonitorState, MonitorTarget } from '@/types/config'
import { codeToCountry } from '@/util/iata'
import { useTranslation } from 'react-i18next'
import { useComputedColorScheme } from '@mantine/core'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  ChartTooltip,
  Legend,
  TimeScale,
  Filler
)

export default function DetailChart({
  monitor,
  state,
}: {
  monitor: MonitorTarget
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true })
  const isDark = colorScheme === 'dark'

  const rawLatencies = state.latency?.[monitor.id] || []
  const latencyData = rawLatencies.map((point) => ({
    x: point.time * 1000,
    y: point.ping,
    loc: point.loc,
  }))

  const data = {
    datasets: [
      {
        data: latencyData,
        borderColor: isDark ? '#34d399' : '#059669',
        backgroundColor: isDark ? 'rgba(52, 211, 153, 0.12)' : 'rgba(16, 185, 129, 0.10)',
        borderWidth: 2,
        radius: 0,
        hoverRadius: 4,
        fill: true,
        cubicInterpolationMode: 'monotone' as const,
        tension: 0.35,
      },
    ],
  }

  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)'
  const textColor = isDark ? '#9ca3af' : '#6b7280'

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    animation: {
      duration: 0,
    },
    plugins: {
      tooltip: {
        backgroundColor: isDark ? 'rgba(17, 24, 39, 0.94)' : 'rgba(255, 255, 255, 0.96)',
        titleColor: isDark ? '#f9fafb' : '#111827',
        bodyColor: isDark ? '#d1d5db' : '#374151',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (item: any) => {
            if (item.parsed.y !== undefined) {
              return ` ${item.parsed.y} ms · ${item.raw.loc} (${codeToCountry(item.raw.loc)})`
            }
            return ''
          },
        },
      },
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: t('Response times'),
        align: 'start' as const,
        color: textColor,
        font: {
          size: 11,
          weight: 'normal' as const,
        },
      },
    },
    scales: {
      x: {
        type: 'time' as const,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
          source: 'auto' as const,
          maxRotation: 0,
          autoSkip: true,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
          font: { size: 10 },
        },
      },
    },
  }

  return (
    <div style={{ height: '145px', marginTop: '6px' }}>
      <Line options={options} data={data} />
    </div>
  )
}
