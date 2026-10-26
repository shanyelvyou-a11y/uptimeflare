import Head from 'next/head'
import { Inter } from 'next/font/google'
import { MonitorTarget } from '@/types/config'
import { maintenances, pageConfig } from '@/uptime.config'
import OverallStatus from '@/components/OverallStatus'
import Header from '@/components/Header'
import MonitorList from '@/components/MonitorList'
import { Center, Container, Paper, Text } from '@mantine/core'
import MonitorDetail from '@/components/MonitorDetail'
import Footer from '@/components/Footer'
import { useTranslation } from 'react-i18next'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'
import { useCallback, useEffect, useMemo, useState } from 'react'

export const runtime = 'experimental-edge'
const inter = Inter({ subsets: ['latin'] })

export default function Home({
  compactedStateStr,
  monitors,
}: {
  compactedStateStr: string | null
  monitors: MonitorTarget[]
  tooltip?: string
  statusPageLink?: string
}) {
  const { t } = useTranslation('common')
  const [liveStateStr, setLiveStateStr] = useState<string | null>(compactedStateStr)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const state = useMemo(
    () => new CompactedMonitorStateWrapper(liveStateStr).uncompact(),
    [liveStateStr]
  )

  const refreshState = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      if (res.ok) {
        const json = (await res.json()) as { compactedStateStr?: string | null }
        if (json.compactedStateStr) {
          setLiveStateStr(json.compactedStateStr)
        }
      }
    } catch (e) {
      console.warn('Silent state refresh failed:', e)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const intervalSec = pageConfig.autoRefreshSeconds ?? 60
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshState()
      }
    }, intervalSec * 1000)
    return () => clearInterval(timer)
  }, [refreshState])

  // Specify monitorId in URL hash to view a specific monitor (can be used in iframe)
  const monitorId = typeof window !== 'undefined' ? window.location.hash.substring(1) : ''
  if (monitorId) {
    const monitor = monitors.find((monitor) => monitor.id === monitorId)
    if (!monitor || !state) {
      return <Text fw={700}>{t('Monitor not found', { id: monitorId })}</Text>
    }
    return (
      <div style={{ maxWidth: '810px', padding: '12px' }}>
        <MonitorDetail monitor={monitor} state={state} />
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>{pageConfig.title}</title>
        <link rel="icon" href={pageConfig.favicon ?? '/favicon.png'} />
      </Head>

      <main className={inter.className}>
        <Header onRefresh={refreshState} isRefreshing={isRefreshing} />

        {state.lastUpdate === 0 ? (
          <Container size="md" mt="xl">
            <Paper withBorder p="xl" radius="md">
              <Center>
                <Text fw={700}>{t('Monitor State not defined')}</Text>
              </Center>
            </Paper>
          </Container>
        ) : (
          <div>
            <OverallStatus
              state={state}
              monitors={monitors}
              maintenances={maintenances}
              onRefresh={refreshState}
              isRefreshing={isRefreshing}
            />
            <MonitorList monitors={monitors} state={state} />
          </div>
        )}

        <Footer />
      </main>
    </>
  )
}

export async function getServerSideProps() {
  const { workerConfig } = await import('@/uptime.config')
  const compactedStateStr = await getFromStore(process.env as any, 'state')

  const monitors = workerConfig.monitors.map((monitor) => {
    return {
      id: monitor.id,
      name: monitor.name,
      tooltip: monitor?.tooltip ?? null,
      statusPageLink: monitor?.statusPageLink ?? null,
      hideLatencyChart: monitor?.hideLatencyChart ?? false,
    }
  })

  return { props: { compactedStateStr, monitors } }
}
