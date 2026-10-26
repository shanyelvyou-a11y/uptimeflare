import { Badge, Button, Collapse, Group, Text, Tooltip } from '@mantine/core'
import { MonitorState, MonitorTarget } from '@/types/config'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChartAreaLine,
  IconCircleCheck,
  IconExternalLink,
} from '@tabler/icons-react'
import DetailChart from './DetailChart'
import DetailBar from './DetailBar'
import { getColor } from '@/util/color'
import { maintenances } from '@/uptime.config'
import { useTranslation } from 'react-i18next'
import { codeToCountry } from '@/util/iata'
import { useMemo, useState } from 'react'

export default function MonitorDetail({
  monitor,
  state,
  compactMode = false,
}: {
  monitor: MonitorTarget
  state: MonitorState
  compactMode?: boolean
}) {
  const { t } = useTranslation('common')
  const [manualShowChart, setManualShowChart] = useState(false)

  const incidents = state.incident?.[monitor.id]
  const latencies = state.latency?.[monitor.id]

  const latencyStats = useMemo(() => {
    if (!latencies || latencies.length === 0) {
      return { latest: 0, avg: 0, p95: 0, loc: 'CF' }
    }
    const latestRec = latencies[latencies.length - 1]
    const validPings = latencies.map((l) => l.ping).filter((p) => p > 0)
    if (validPings.length === 0) {
      return { latest: latestRec.ping || 0, avg: 0, p95: 0, loc: latestRec.loc || 'CF' }
    }
    const avg = Math.round(validPings.reduce((a, b) => a + b, 0) / validPings.length)
    const sorted = [...validPings].sort((a, b) => a - b)
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    return {
      latest: latestRec.ping,
      avg,
      p95,
      loc: latestRec.loc || 'CF',
    }
  }, [latencies])

  if (!latencies || !incidents || incidents.length === 0) {
    return (
      <Group justify="space-between" align="center">
        <Text fw={700}>{monitor.name}</Text>
        <Badge color="gray" variant="light">
          {t('No data available')}
        </Badge>
      </Group>
    )
  }

  const isDown = incidents[incidents.length - 1].end === null

  const now = new Date()
  const hasMaintenance = maintenances
    .filter((m) => now >= new Date(m.start) && (!m.end || now <= new Date(m.end)))
    .find((maintenance) => maintenance.monitors?.includes(monitor.id))

  let statusIcon = isDown ? (
    <IconAlertCircle style={{ width: '1.3em', height: '1.3em', color: '#ef4444', flexShrink: 0 }} />
  ) : (
    <IconCircleCheck style={{ width: '1.3em', height: '1.3em', color: '#10b981', flexShrink: 0 }} />
  )

  let statusBadge = isDown ? (
    <Badge color="red" variant="light" size="sm" radius="sm">
      {t('Down')}
    </Badge>
  ) : (
    <Badge color="teal" variant="light" size="sm" radius="sm">
      {t('Operational')}
    </Badge>
  )

  if (hasMaintenance) {
    statusIcon = (
      <IconAlertTriangle
        style={{ width: '1.3em', height: '1.3em', color: '#f59e0b', flexShrink: 0 }}
      />
    )
    statusBadge = (
      <Badge color="yellow" variant="light" size="sm" radius="sm">
        {t('Maintenance')}
      </Badge>
    )
  }

  const totalTime = Math.max(1, Date.now() / 1000 - incidents[0].start[0])
  let downTime = 0
  for (const incident of incidents) {
    downTime += (incident.end ?? Date.now() / 1000) - incident.start[0]
  }

  const uptimePercent = Math.max(0, Math.min(100, ((totalTime - downTime) / totalTime) * 100)).toPrecision(4)

  const monitorNameElement = (
    <Group gap={8} align="center" wrap="nowrap">
      {statusIcon}
      {monitor.statusPageLink ? (
        <a
          href={monitor.statusPageLink}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            color: 'inherit',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          <span>{monitor.name}</span>
          <IconExternalLink size={14} style={{ opacity: 0.55 }} />
        </a>
      ) : (
        <Text fw={700} size="md">
          {monitor.name}
        </Text>
      )}
      {statusBadge}
    </Group>
  )

  const showChart = !monitor.hideLatencyChart && (!compactMode || manualShowChart)

  return (
    <div>
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <div>
          {monitor.tooltip ? (
            <Tooltip label={monitor.tooltip} withArrow multiline maw={340}>
              <div style={{ display: 'inline-block', cursor: 'help' }}>{monitorNameElement}</div>
            </Tooltip>
          ) : (
            monitorNameElement
          )}
        </div>

        <Group gap={8} align="center" wrap="wrap">
          {latencyStats.latest > 0 && (
            <Tooltip label={`${t('Edge Node')}: ${codeToCountry(latencyStats.loc)}`} withArrow>
              <Badge
                variant="outline"
                color={latencyStats.latest < 300 ? 'teal' : latencyStats.latest < 800 ? 'yellow' : 'red'}
                size="sm"
                radius="sm"
                style={{ textTransform: 'none', fontWeight: 600 }}
              >
                {t('Latest Ping')} {latencyStats.latest}ms · {latencyStats.loc}
              </Badge>
            </Tooltip>
          )}

          {latencyStats.avg > 0 && (
            <Badge
              variant="default"
              size="sm"
              radius="sm"
              visibleFrom="sm"
              style={{ textTransform: 'none', fontWeight: 500 }}
            >
              {t('Avg Ping')} {latencyStats.avg}ms / {t('P95 Ping')} {latencyStats.p95}ms
            </Badge>
          )}

          <Text fw={700} size="sm" style={{ color: getColor(uptimePercent, true) }}>
            {t('Overall', { percent: uptimePercent })}
          </Text>

          {compactMode && !monitor.hideLatencyChart && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              leftSection={<IconChartAreaLine size={13} />}
              onClick={() => setManualShowChart(!manualShowChart)}
            >
              {manualShowChart ? t('Hide Chart') : t('Show Chart')}
            </Button>
          )}
        </Group>
      </Group>

      <DetailBar monitor={monitor} state={state} />

      {!monitor.hideLatencyChart && (
        <Collapse in={showChart}>
          <DetailChart monitor={monitor} state={state} />
        </Collapse>
      )}
    </div>
  )
}
