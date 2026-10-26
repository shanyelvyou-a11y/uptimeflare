import Head from 'next/head'
import { Inter } from 'next/font/google'
import { MaintenanceConfig, MonitorTarget } from '@/types/config'
import { maintenances, pageConfig } from '@/uptime.config'
import Header from '@/components/Header'
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import Footer from '@/components/Footer'
import { useEffect, useMemo, useState } from 'react'
import MaintenanceAlert from '@/components/MaintenanceAlert'
import NoIncidentsAlert from '@/components/NoIncidents'
import { useTranslation } from 'react-i18next'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'
import { IconAlertCircle, IconCircleCheck, IconClock } from '@tabler/icons-react'

export const runtime = 'experimental-edge'
const inter = Inter({ subsets: ['latin'] })

function getSelectedMonth() {
  const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''
  if (!hash) {
    const now = new Date()
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  }
  return hash.split('-').splice(0, 2).join('-')
}

function filterMaintenancesByMonth(
  incidents: MaintenanceConfig[],
  monthStr: string,
  monitors: MonitorTarget[]
): (Omit<MaintenanceConfig, 'monitors'> & { monitors: MonitorTarget[] })[] {
  return incidents
    .filter((incident) => {
      const d = new Date(incident.start)
      const incidentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      return incidentMonth === monthStr
    })
    .map((e) => ({
      ...e,
      monitors: (e.monitors || []).map((id) => monitors.find((mon) => mon.id === id)!),
    }))
    .sort((a, b) => (new Date(a.start) > new Date(b.start) ? -1 : 1))
}

function getPrevNextMonth(monthStr: string) {
  const [year, month] = monthStr.split('-').map(Number)
  const date = new Date(year, month - 1)
  const prev = new Date(date)
  prev.setMonth(prev.getMonth() - 1)
  const next = new Date(date)
  next.setMonth(next.getMonth() + 1)
  return {
    prev: prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0'),
    next: next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0'),
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const mins = Math.floor(seconds / 60)
  const hrs = Math.floor(mins / 60)
  if (hrs === 0) return `${mins}m`
  const remMins = mins % 60
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`
}

export default function IncidentsPage({
  monitors,
  compactedStateStr,
}: {
  monitors: MonitorTarget[]
  compactedStateStr: string | null
}) {
  const { t } = useTranslation('common')
  const [selectedMonitor, setSelectedMonitor] = useState<string | null>('')
  const [selectedMonth, setSelectedMonth] = useState(getSelectedMonth())

  const state = useMemo(
    () => new CompactedMonitorStateWrapper(compactedStateStr).uncompact(),
    [compactedStateStr]
  )

  useEffect(() => {
    const onHashChange = () => setSelectedMonth(getSelectedMonth())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Extract real historical downtime incidents from D1 state
  const realIncidentsInMonth = useMemo(() => {
    const list: {
      monitorId: string
      monitorName: string
      startSec: number
      endSec: number | null
      errors: { time: number; msg: string }[]
    }[] = []

    for (const mon of monitors) {
      const records = state.incident?.[mon.id] || []
      for (const rec of records) {
        if (!rec.start || rec.start.length === 0) continue
        // Skip internal dummy start marker
        if (rec.error?.[0] === 'dummy' && rec.start[0] === rec.end) continue

        const d = new Date(rec.start[0] * 1000)
        const recMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        if (recMonth !== selectedMonth) continue
        if (selectedMonitor && mon.id !== selectedMonitor) continue

        const errors = rec.error
          .map((msg, idx) => ({
            time: rec.start[idx] ?? rec.start[0],
            msg,
          }))
          .filter((e) => e.msg !== 'dummy')

        list.push({
          monitorId: mon.id,
          monitorName: mon.name,
          startSec: rec.start[0],
          endSec: rec.end,
          errors,
        })
      }
    }

    return list.sort((a, b) => b.startSec - a.startSec)
  }, [state, monitors, selectedMonth, selectedMonitor])

  const filteredMaintenances = filterMaintenancesByMonth(maintenances, selectedMonth, monitors)
  const monitorFilteredMaintenances = selectedMonitor
    ? filteredMaintenances.filter((i) => i.monitors.find((e) => e?.id === selectedMonitor))
    : filteredMaintenances

  const { prev, next } = getPrevNextMonth(selectedMonth)

  const monitorOptions = [
    { value: '', label: t('All') },
    ...monitors.map((monitor) => ({
      value: monitor.id,
      label: monitor.name,
    })),
  ]

  const hasAnyEvent =
    realIncidentsInMonth.length > 0 || monitorFilteredMaintenances.length > 0

  return (
    <>
      <Head>
        <title>{`${t('Incidents')} · ${pageConfig.title}`}</title>
        <link rel="icon" href={pageConfig.favicon ?? '/favicon.png'} />
      </Head>

      <main className={inter.className}>
        <Header />
        <Container size="lg" mt="md">
          <Paper withBorder radius="md" p="lg" mb="md">
            <Group justify="space-between" align="center" wrap="wrap" gap="md">
              <div>
                <Title order={3}>{t('Incident Timeline')}</Title>
                <Text size="sm" c="dimmed" mt={4}>
                  {t('Incident Subtitle')}
                </Text>
              </div>
              <Select
                placeholder={t('Select monitor')}
                data={monitorOptions}
                value={selectedMonitor}
                onChange={setSelectedMonitor}
                clearable
                radius="md"
                style={{ minWidth: 240 }}
              />
            </Group>
          </Paper>

          <Box>
            {!hasAnyEvent ? (
              <NoIncidentsAlert />
            ) : (
              <Stack gap="md">
                {monitorFilteredMaintenances.map((incident, i) => (
                  <MaintenanceAlert key={`maint-${i}`} maintenance={incident} />
                ))}

                {realIncidentsInMonth.map((inc, idx) => {
                  const isOngoing = inc.endSec === null
                  const nowSec = Math.round(Date.now() / 1000)
                  const durationSec = (inc.endSec ?? nowSec) - inc.startSec

                  return (
                    <Card
                      key={`inc-${inc.monitorId}-${inc.startSec}-${idx}`}
                      withBorder
                      radius="md"
                      padding="md"
                      shadow="xs"
                      style={{
                        borderColor: isOngoing
                          ? 'rgba(239, 68, 68, 0.5)'
                          : 'rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                        <Group gap="xs" align="center">
                          {isOngoing ? (
                            <IconAlertCircle size={20} color="#ef4444" />
                          ) : (
                            <IconCircleCheck size={20} color="#10b981" />
                          )}
                          <Text fw={700} size="md">
                            {inc.monitorName}
                          </Text>
                          <Badge
                            color={isOngoing ? 'red' : 'teal'}
                            variant="light"
                            size="sm"
                            radius="sm"
                          >
                            {isOngoing ? t('Ongoing') : t('Resolved')}
                          </Badge>
                        </Group>

                        <Group gap="xs">
                          <Badge
                            color="gray"
                            variant="outline"
                            size="sm"
                            leftSection={<IconClock size={12} />}
                          >
                            {t('Duration')}: {formatDuration(durationSec)}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {new Date(inc.startSec * 1000).toLocaleString()} —{' '}
                            {inc.endSec
                              ? new Date(inc.endSec * 1000).toLocaleString()
                              : t('Ongoing')}
                          </Text>
                        </Group>
                      </Group>

                      {inc.errors.length > 0 && (
                        <Stack gap={6} mt="sm">
                          {inc.errors.map((err, eIdx) => (
                            <Paper key={eIdx} withBorder p="xs" radius="sm">
                              <Group gap="xs" wrap="nowrap">
                                <Badge color="red" variant="dot" size="xs">
                                  {new Date(err.time * 1000).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </Badge>
                                <Text
                                  size="xs"
                                  style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                                >
                                  {err.msg}
                                </Text>
                              </Group>
                            </Paper>
                          ))}
                        </Stack>
                      )}
                    </Card>
                  )
                })}
              </Stack>
            )}
          </Box>

          <Group justify="space-between" mt="lg">
            <Button
              variant="default"
              radius="md"
              onClick={() => (window.location.hash = prev)}
            >
              {t('Backwards')}
            </Button>
            <Badge size="lg" variant="light" color="gray" radius="sm">
              {selectedMonth}
            </Badge>
            <Button
              variant="default"
              radius="md"
              onClick={() => (window.location.hash = next)}
            >
              {t('Forward')}
            </Button>
          </Group>
        </Container>
        <Footer />
      </main>
    </>
  )
}

export async function getServerSideProps() {
  const { workerConfig } = await import('@/uptime.config')
  const compactedStateStr = await getFromStore(process.env as any, 'state')
  const monitors: MonitorTarget[] = workerConfig.monitors.map((monitor) => ({
    id: monitor.id,
    name: monitor.name,
  })) as MonitorTarget[]
  return { props: { monitors, compactedStateStr } }
}
