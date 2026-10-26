import { MaintenanceConfig, MonitorState, MonitorTarget } from '@/types/config'
import {
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import {
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconServer,
  IconShieldCheck,
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import MaintenanceAlert from './MaintenanceAlert'
import { pageConfig } from '@/uptime.config'
import { useTranslation } from 'react-i18next'
import { codeToCountry } from '@/util/iata'

function useWindowVisibility() {
  const [isVisible, setIsVisible] = useState(true)
  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])
  return isVisible
}

export default function OverallStatus({
  state,
  maintenances,
  monitors,
  onRefresh,
  isRefreshing = false,
}: {
  state: MonitorState
  maintenances: MaintenanceConfig[]
  monitors: MonitorTarget[]
  onRefresh?: () => void
  isRefreshing?: boolean
}) {
  const { t } = useTranslation('common')
  const [currentTime, setCurrentTime] = useState(Math.round(Date.now() / 1000))
  const isWindowVisible = useWindowVisibility()
  const [expandUpcoming, setExpandUpcoming] = useState(false)

  // Compute aggregated KPI metrics across all monitors
  const kpiMetrics = useMemo(() => {
    const nowSec = Math.round(Date.now() / 1000)
    let totalWeightedUpRatio = 0
    let countedMonitors = 0
    const latestPings: number[] = []
    const allRecentPings: number[] = []
    let latestColo = 'CF'
    let totalIncidents90d = 0
    let activeIncidents = 0

    for (const mon of monitors) {
      const incidents = state.incident?.[mon.id]
      if (incidents && incidents.length > 0) {
        const startTime = incidents[0].start[0]
        const totalTime = Math.max(1, nowSec - startTime)
        let downTime = 0
        for (const inc of incidents) {
          const isDummy = inc.error?.[0] === 'dummy' && inc.start[0] === inc.end
          if (!isDummy) {
            totalIncidents90d++
          }
          if (inc.end === null) {
            activeIncidents++
          }
          downTime += (inc.end ?? nowSec) - inc.start[0]
        }
        const ratio = Math.max(0, Math.min(100, ((totalTime - downTime) / totalTime) * 100))
        totalWeightedUpRatio += ratio
        countedMonitors++
      }

      const latArr = state.latency?.[mon.id]
      if (latArr && latArr.length > 0) {
        const last = latArr[latArr.length - 1]
        if (last.ping > 0) latestPings.push(last.ping)
        if (last.loc) latestColo = last.loc
        // take last 24 points (~2 hours) for P95 calculation
        const recentSlice = latArr.slice(-24)
        for (const pt of recentSlice) {
          if (pt.ping > 0) allRecentPings.push(pt.ping)
        }
      }
    }

    const overallSla =
      countedMonitors > 0 ? (totalWeightedUpRatio / countedMonitors).toFixed(2) : '100.00'
    const avgPing =
      latestPings.length > 0
        ? Math.round(latestPings.reduce((a, b) => a + b, 0) / latestPings.length)
        : 0
    const sortedRecent = [...allRecentPings].sort((a, b) => a - b)
    const p95Ping =
      sortedRecent.length > 0
        ? sortedRecent[Math.min(sortedRecent.length - 1, Math.floor(sortedRecent.length * 0.95))]
        : avgPing

    return {
      overallSla,
      avgPing,
      p95Ping,
      latestColo,
      totalIncidents90d,
      activeIncidents,
    }
  }, [state, monitors])

  let statusString = ''
  let statusColor: 'teal' | 'red' | 'orange' | 'gray' = 'teal'
  let icon = <IconCircleCheck style={{ width: 44, height: 44, color: '#10b981' }} />

  if (state.overallUp === 0 && state.overallDown === 0) {
    statusString = t('No data yet')
    statusColor = 'gray'
    icon = <IconClock style={{ width: 44, height: 44, color: '#6b7280' }} />
  } else if (state.overallUp === 0) {
    statusString = t('All systems not operational')
    statusColor = 'red'
    icon = <IconAlertCircle style={{ width: 44, height: 44, color: '#ef4444' }} />
  } else if (state.overallDown === 0) {
    statusString = t('All systems operational')
    statusColor = 'teal'
    icon = <IconCircleCheck style={{ width: 44, height: 44, color: '#10b981' }} />
  } else {
    statusString = t('Some systems not operational', {
      down: state.overallDown,
      total: state.overallUp + state.overallDown,
    })
    statusColor = 'orange'
    icon = <IconAlertTriangle style={{ width: 44, height: 44, color: '#f59e0b' }} />
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isWindowVisible) return
      setCurrentTime(Math.round(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isWindowVisible])

  const now = new Date()

  const activeMaintenances: (Omit<MaintenanceConfig, 'monitors'> & {
    monitors?: MonitorTarget[]
  })[] = maintenances
    .filter((m) => now >= new Date(m.start) && (!m.end || now <= new Date(m.end)))
    .map((maintenance) => ({
      ...maintenance,
      monitors: maintenance.monitors?.map(
        (monitorId) => monitors.find((mon) => monitorId === mon.id)!
      ),
    }))

  const upcomingMaintenances: (Omit<MaintenanceConfig, 'monitors'> & {
    monitors?: (MonitorTarget | undefined)[]
  })[] = maintenances
    .filter((m) => now < new Date(m.start))
    .map((maintenance) => ({
      ...maintenance,
      monitors: maintenance.monitors?.map(
        (monitorId) => monitors.find((mon) => monitorId === mon.id)!
      ),
    }))

  const secondsAgo = Math.max(0, currentTime - state.lastUpdate)
  const borderAccent =
    statusColor === 'teal'
      ? 'rgba(16, 185, 129, 0.35)'
      : statusColor === 'orange'
      ? 'rgba(245, 158, 11, 0.45)'
      : statusColor === 'red'
      ? 'rgba(239, 68, 68, 0.45)'
      : 'rgba(156, 163, 175, 0.3)'

  const bgAccent =
    statusColor === 'teal'
      ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.09) 0%, rgba(5, 150, 105, 0.02) 100%)'
      : statusColor === 'orange'
      ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(217, 119, 6, 0.03) 100%)'
      : statusColor === 'red'
      ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(185, 28, 28, 0.03) 100%)'
      : undefined

  return (
    <Container size="lg" mt="md">
      {/* Hero Status Banner */}
      <Paper
        radius="lg"
        p={{ base: 'md', sm: 'xl' }}
        withBorder
        style={{
          borderColor: borderAccent,
          background: bgAccent,
        }}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Group align="center" gap="md" wrap="nowrap">
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 64,
                height: 64,
                borderRadius: '16px',
                background:
                  statusColor === 'teal'
                    ? 'rgba(16, 185, 129, 0.14)'
                    : statusColor === 'orange'
                    ? 'rgba(245, 158, 11, 0.16)'
                    : 'rgba(239, 68, 68, 0.16)',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
            <div>
              <Group gap="xs" align="center">
                <Title order={2} style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.65rem)' }}>
                  {statusString}
                </Title>
                <Badge color={statusColor} variant="filled" size="sm" radius="sm">
                  {state.overallUp} / {state.overallUp + state.overallDown} {t('Operational')}
                </Badge>
              </Group>
              {pageConfig.subtitle && (
                <Text size="sm" c="dimmed" mt={4}>
                  {pageConfig.subtitle}
                </Text>
              )}
              <Text size="xs" c="dimmed" mt={6} fw={500}>
                {t('Last updated on', {
                  date: new Date(state.lastUpdate * 1000).toLocaleString(),
                  seconds: secondsAgo,
                })}{' '}
                · {t('Auto Refresh Hint', { sec: pageConfig.autoRefreshSeconds ?? 60 })}
              </Text>
            </div>
          </Group>

          {onRefresh && (
            <Button
              variant="light"
              color={statusColor}
              size="sm"
              radius="md"
              leftSection={<IconRefresh size={16} />}
              loading={isRefreshing}
              onClick={onRefresh}
            >
              {isRefreshing ? t('Refreshing') : t('Refresh Now')}
            </Button>
          )}
        </Group>
      </Paper>

      {/* 4-Card Executive KPI Summary */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md" mt="md">
        <Card withBorder radius="md" padding="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {t('KPI SLA Title')}
              </Text>
              <Title order={3} mt={4} c={Number(kpiMetrics.overallSla) >= 99.5 ? 'teal' : 'orange'}>
                {kpiMetrics.overallSla}%
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {t('KPI SLA Sub')}
              </Text>
            </div>
            <ThemeIcon variant="light" color="teal" size="lg" radius="md">
              <IconShieldCheck size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card withBorder radius="md" padding="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {t('KPI Online Title')}
              </Text>
              <Title order={3} mt={4}>
                {state.overallUp}{' '}
                <Text span size="sm" c="dimmed" fw={500}>
                  / {state.overallUp + state.overallDown}
                </Text>
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {t('KPI Online Sub', { total: monitors.length })}
              </Text>
            </div>
            <ThemeIcon variant="light" color="blue" size="lg" radius="md">
              <IconServer size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card withBorder radius="md" padding="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {t('KPI Latency Title')}
              </Text>
              <Title order={3} mt={4}>
                {kpiMetrics.avgPing}
                <Text span size="sm" fw={500} ml={2}>
                  ms
                </Text>
              </Title>
              <Text
                size="xs"
                c="dimmed"
                mt={4}
                title={codeToCountry(kpiMetrics.latestColo)}
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {t('KPI Latency Sub', {
                  p95: kpiMetrics.p95Ping,
                  colo: kpiMetrics.latestColo,
                })}
              </Text>
            </div>
            <ThemeIcon variant="light" color="indigo" size="lg" radius="md">
              <IconActivity size={20} />
            </ThemeIcon>
          </Group>
        </Card>

        <Card withBorder radius="md" padding="md" shadow="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {t('KPI Incidents Title')}
              </Text>
              <Title order={3} mt={4} c={kpiMetrics.activeIncidents > 0 ? 'red' : undefined}>
                {kpiMetrics.totalIncidents90d}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                {t('KPI Incidents Sub', { active: kpiMetrics.activeIncidents })}
              </Text>
            </div>
            <ThemeIcon
              variant="light"
              color={kpiMetrics.activeIncidents > 0 ? 'red' : 'gray'}
              size="lg"
              radius="md"
            >
              <IconClock size={20} />
            </ThemeIcon>
          </Group>
        </Card>
      </SimpleGrid>

      {/* Upcoming Maintenance */}
      {upcomingMaintenances.length > 0 && (
        <>
          <Title mt="md" style={{ textAlign: 'center', color: '#70778c' }} order={5}>
            {t('upcoming maintenance', { count: upcomingMaintenances.length })}{' '}
            <span
              style={{ textDecoration: 'underline', cursor: 'pointer' }}
              onClick={() => setExpandUpcoming(!expandUpcoming)}
            >
              {expandUpcoming ? t('Hide') : t('Show')}
            </span>
          </Title>

          <Collapse in={expandUpcoming}>
            {upcomingMaintenances.map((maintenance, idx) => (
              <MaintenanceAlert key={`upcoming-${idx}`} maintenance={maintenance} upcoming />
            ))}
          </Collapse>
        </>
      )}

      {/* Active Maintenance */}
      {activeMaintenances.map((maintenance, idx) => (
        <MaintenanceAlert key={`active-${idx}`} maintenance={maintenance} />
      ))}
    </Container>
  )
}
