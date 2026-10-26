import { MonitorState, MonitorTarget } from '@/types/config'
import {
  Accordion,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import {
  IconChartAreaLine,
  IconChevronDown,
  IconChevronUp,
  IconLayoutList,
  IconSearch,
} from '@tabler/icons-react'
import MonitorDetail from './MonitorDetail'
import { pageConfig } from '@/uptime.config'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function isMonitorDown(state: MonitorState, id: string): boolean {
  const incidents = state.incident?.[id]
  if (!incidents || incidents.length === 0) return false
  return incidents[incidents.length - 1].end === null
}

function countDownCount(state: MonitorState, ids: string[]) {
  let downCount = 0
  for (const id of ids) {
    if (isMonitorDown(state, id)) {
      downCount++
    }
  }
  return downCount
}

function getGroupBadgeColor(state: MonitorState, ids: string[]): 'teal' | 'red' | 'orange' {
  const downCount = countDownCount(state, ids)
  if (downCount === 0) return 'teal'
  if (downCount === ids.length) return 'red'
  return 'orange'
}

export default function MonitorList({
  monitors,
  state,
}: {
  monitors: MonitorTarget[]
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const group = pageConfig.group
  const groupedMonitor = Boolean(group && Object.keys(group).length > 0)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down'>('all')
  const [compactMode, setCompactMode] = useState<boolean>(pageConfig.defaultCompactView ?? false)

  const defaultGroupKeys = useMemo(() => Object.keys(group || {}), [group])
  const [expandedGroups, setExpandedGroups] = useState<string[]>(defaultGroupKeys)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('uf_expanded_groups_v2')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setExpandedGroups(parsed)
        }
      }
      const savedCompact = localStorage.getItem('uf_compact_mode_v2')
      if (savedCompact !== null) {
        setCompactMode(savedCompact === 'true')
      }
    } catch (e) {}
  }, [])

  const handleGroupChange = (values: string[]) => {
    setExpandedGroups(values)
    try {
      localStorage.setItem('uf_expanded_groups_v2', JSON.stringify(values))
    } catch (e) {}
  }

  const handleCompactChange = (val: string) => {
    const isCompact = val === 'compact'
    setCompactMode(isCompact)
    try {
      localStorage.setItem('uf_compact_mode_v2', String(isCompact))
    } catch (e) {}
  }

  const matchesFilter = (monitor: MonitorTarget) => {
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase()
      const matchName = monitor.name.toLowerCase().includes(q)
      const matchId = monitor.id.toLowerCase().includes(q)
      const matchLink = (monitor.statusPageLink || '').toLowerCase().includes(q)
      if (!matchName && !matchId && !matchLink) return false
    }
    if (statusFilter === 'up' && isMonitorDown(state, monitor.id)) return false
    if (statusFilter === 'down' && !isMonitorDown(state, monitor.id)) return false
    return true
  }

  const filteredMonitors = monitors.filter(matchesFilter)

  let content
  if (filteredMonitors.length === 0) {
    content = (
      <Paper withBorder radius="md" p="xl" ta="center" mt="md">
        <Text c="dimmed" fw={500}>
          {t('No matching monitors')}
        </Text>
      </Paper>
    )
  } else if (groupedMonitor && group) {
    content = (
      <Accordion
        multiple
        variant="separated"
        radius="md"
        value={expandedGroups}
        onChange={handleGroupChange}
      >
        {Object.keys(group).map((groupName) => {
          const groupIds = group[groupName]
          const groupMonitors = filteredMonitors
            .filter((monitor) => groupIds.includes(monitor.id))
            .sort((a, b) => groupIds.indexOf(a.id) - groupIds.indexOf(b.id))

          if (groupMonitors.length === 0) return null

          const totalInGroup = groupIds.length
          const downInGroup = countDownCount(state, groupIds)
          const badgeColor = getGroupBadgeColor(state, groupIds)

          return (
            <Accordion.Item key={groupName} value={groupName}>
              <Accordion.Control>
                <Group justify="space-between" align="center" pr="xs" wrap="nowrap">
                  <Text fw={700} size="md">
                    {groupName}
                  </Text>
                  <Badge color={badgeColor} variant="light" size="md" radius="sm">
                    {totalInGroup - downInGroup} / {totalInGroup} {t('Operational')}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm" pt="xs">
                  {groupMonitors.map((monitor) => (
                    <Card
                      key={monitor.id}
                      withBorder
                      radius="md"
                      padding="md"
                      shadow="none"
                      style={{
                        borderColor: isMonitorDown(state, monitor.id)
                          ? 'rgba(239, 68, 68, 0.45)'
                          : undefined,
                      }}
                    >
                      <MonitorDetail
                        monitor={monitor}
                        state={state}
                        compactMode={compactMode}
                      />
                    </Card>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          )
        })}
      </Accordion>
    )
  } else {
    content = (
      <Stack gap="sm">
        {filteredMonitors.map((monitor) => (
          <Card key={monitor.id} withBorder radius="md" padding="md" shadow="xs">
            <MonitorDetail monitor={monitor} state={state} compactMode={compactMode} />
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Container size="lg" mt="lg">
      {/* Control Toolbar: Search + Status Filter + View Switcher + Expand/Collapse */}
      <Paper withBorder radius="md" p="sm" mb="md">
        <Group justify="space-between" align="center" gap="sm" wrap="wrap">
          <TextInput
            placeholder={t('Search monitors')}
            leftSection={<IconSearch size={16} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            radius="md"
            size="sm"
            style={{ flex: '1 1 220px', maxWidth: '340px' }}
          />

          <Group gap="xs" wrap="wrap">
            <SegmentedControl
              size="xs"
              radius="md"
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as 'all' | 'up' | 'down')}
              data={[
                { label: t('All'), value: 'all' },
                { label: t('Operational Only'), value: 'up' },
                { label: t('Issues Only'), value: 'down' },
              ]}
            />

            <SegmentedControl
              size="xs"
              radius="md"
              value={compactMode ? 'compact' : 'detailed'}
              onChange={handleCompactChange}
              data={[
                {
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconChartAreaLine size={14} />
                      <span>{t('Detailed View')}</span>
                    </Group>
                  ),
                  value: 'detailed',
                },
                {
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconLayoutList size={14} />
                      <span>{t('Compact View')}</span>
                    </Group>
                  ),
                  value: 'compact',
                },
              ]}
            />

            {groupedMonitor && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                radius="md"
                leftSection={
                  expandedGroups.length === defaultGroupKeys.length ? (
                    <IconChevronUp size={14} />
                  ) : (
                    <IconChevronDown size={14} />
                  )
                }
                onClick={() =>
                  handleGroupChange(
                    expandedGroups.length === defaultGroupKeys.length ? [] : defaultGroupKeys
                  )
                }
              >
                {expandedGroups.length === defaultGroupKeys.length
                  ? t('Collapse All')
                  : t('Expand All')}
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {content}
    </Container>
  )
}
