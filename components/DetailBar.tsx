import { MonitorState, MonitorTarget } from '@/types/config'
import { getColor } from '@/util/color'
import { Badge, Box, Group, Modal, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
const moment = require('moment')
require('moment-precise-range-plugin')

export default function DetailBar({
  monitor,
  state,
}: {
  monitor: MonitorTarget
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const [modalOpened, setModalOpened] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalReasons, setModalReasons] = useState<string[]>([])

  const overlapLen = (x1: number, x2: number, y1: number, y2: number) => {
    return Math.max(0, Math.min(x2, y2) - Math.max(x1, y1))
  }

  const incidents = state.incident?.[monitor.id] || []
  if (incidents.length === 0) return null

  const uptimePercentBars = []
  const currentTime = Math.round(Date.now() / 1000)
  const monitorStartTime = incidents[0].start[0]

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  for (let i = 89; i >= 0; i--) {
    const dayStart = Math.round(todayStart.getTime() / 1000) - i * 86400
    const dayEnd = dayStart + 86400

    const dayMonitorTime = overlapLen(dayStart, dayEnd, monitorStartTime, currentTime)
    let dayDownTime = 0
    const incidentReasons: string[] = []

    for (const incident of incidents) {
      const incidentStart = incident.start[0]
      const incidentEnd = incident.end ?? currentTime

      const overlap = overlapLen(dayStart, dayEnd, incidentStart, incidentEnd)
      dayDownTime += overlap

      if (overlap > 0) {
        for (let j = 0; j < incident.error.length; j++) {
          let partStart = incident.start[j]
          let partEnd =
            j === incident.error.length - 1 ? incident.end ?? currentTime : incident.start[j + 1]
          partStart = Math.max(partStart, dayStart)
          partEnd = Math.min(partEnd, dayEnd)

          if (overlapLen(dayStart, dayEnd, partStart, partEnd) > 0 && incident.error[j] !== 'dummy') {
            const startStr = new Date(partStart * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            const endStr = new Date(partEnd * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            incidentReasons.push(`[${startStr} - ${endStr}] ${incident.error[j]}`)
          }
        }
      }
    }

    const dayPercent = (((dayMonitorTime - dayDownTime) / dayMonitorTime) * 100).toPrecision(4)
    const isNoData = Number.isNaN(Number(dayPercent))

    uptimePercentBars.push(
      <Tooltip
        multiline
        key={i}
        withArrow
        events={{ hover: true, focus: false, touch: true }}
        label={
          isNoData ? (
            t('No Data')
          ) : (
            <div>
              <div style={{ fontWeight: 600 }}>
                {t('percent at date', {
                  percent: dayPercent,
                  date: new Date(dayStart * 1000).toLocaleDateString(),
                })}
              </div>
              {dayDownTime > 0 && (
                <div style={{ color: '#fca5a5', marginTop: 2 }}>
                  {t('Down for', {
                    duration: moment.preciseDiff(moment(0), moment(dayDownTime * 1000)),
                  })}
                </div>
              )}
            </div>
          )
        }
      >
        <div
          style={{
            flex: '1 1 0%',
            height: '22px',
            minWidth: '2px',
            background: getColor(dayPercent, false),
            borderRadius: '2px',
            cursor: dayDownTime > 0 ? 'pointer' : 'default',
            opacity: isNoData ? 0.35 : 0.92,
            transition: 'opacity 0.15s ease',
          }}
          onClick={() => {
            if (dayDownTime > 0) {
              setModalTitle(
                t('incidents at', {
                  name: monitor.name,
                  date: new Date(dayStart * 1000).toLocaleDateString(),
                })
              )
              setModalReasons(incidentReasons)
              setModalOpened(true)
            }
          }}
        />
      </Tooltip>
    )
  }

  return (
    <>
      <Modal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        title={<Text fw={700}>{modalTitle}</Text>}
        size="lg"
        radius="md"
      >
        <Stack gap="xs">
          {modalReasons.map((reason, index) => (
            <Paper key={index} withBorder p="xs" radius="sm">
              <Group gap="xs" wrap="nowrap">
                <Badge color="red" variant="light" size="sm">
                  ERR #{index + 1}
                </Badge>
                <Text size="sm" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {reason}
                </Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Modal>
      <Box mt={10} mb={4}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            gap: '2px',
            width: '100%',
            alignItems: 'center',
          }}
        >
          {uptimePercentBars}
        </div>
        <Group justify="space-between" mt={4}>
          <Text size="11px" c="dimmed">
            {t('90 Days Ago')}
          </Text>
          <Text size="11px" c="dimmed">
            {t('Today')}
          </Text>
        </Group>
      </Box>
    </>
  )
}
