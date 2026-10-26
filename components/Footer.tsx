import { Container, Divider, Group, Text } from '@mantine/core'
import Link from 'next/link'
import { pageConfig } from '@/uptime.config'

export default function Footer() {
  if (pageConfig.customFooter) {
    return (
      <>
        <Divider mt="xl" />
        <div dangerouslySetInnerHTML={{ __html: pageConfig.customFooter }} />
      </>
    )
  }

  return (
    <footer style={{ marginTop: '48px', paddingBottom: '36px' }}>
      <Divider mb="lg" />
      <Container size="lg">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Text size="xs" c="dimmed">
            Powered by{' '}
            <a
              href="https://github.com/shanyelvyou-a11y"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none' }}
            >
              UptimeFlare Pro 2.0
            </a>{' '}
            · Running on Cloudflare Workers & D1 Edge SQLite
          </Text>
          <Group gap="md">
            <a
              href="/api/data"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '12px', color: 'var(--mantine-color-dimmed)', textDecoration: 'none' }}
            >
              JSON API (/api/data)
            </a>
            <Link
              href="/incidents"
              style={{ fontSize: '12px', color: 'var(--mantine-color-dimmed)', textDecoration: 'none' }}
            >
              故障归档 (/incidents)
            </Link>
          </Group>
        </Group>
      </Container>
    </footer>
  )
}
