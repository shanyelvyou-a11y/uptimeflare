import {
  ActionIcon,
  Badge,
  Container,
  Group,
  Image,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { IconMoon, IconRefresh, IconSun, IconWorld } from '@tabler/icons-react'
import classes from '@/styles/Header.module.css'
import { pageConfig } from '@/uptime.config'
import { PageConfigLink } from '@/types/config'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'

export default function Header({
  style,
  onRefresh,
  isRefreshing = false,
}: {
  style?: React.CSSProperties
  onRefresh?: () => void
  isRefreshing?: boolean
}) {
  const { t, i18n } = useTranslation('common')
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true })

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'

  const linkToElement = (link: PageConfigLink, i: number) => {
    const isInternal = link.link.startsWith('/')
    const isActive = isInternal ? currentPath === link.link : link.highlight
    return (
      <a
        key={i}
        href={link.link}
        target={isInternal ? undefined : '_blank'}
        rel={isInternal ? undefined : 'noreferrer'}
        className={classes.link}
        data-active={isActive || undefined}
      >
        {link.label}
      </a>
    )
  }

  const links: PageConfigLink[] = [
    { label: t('Status Overview'), link: '/' },
    { label: t('Incidents'), link: '/incidents' },
    ...(pageConfig.links || []),
  ]

  const toggleLanguage = () => {
    const nextLang = i18n.language?.startsWith('zh') ? 'en' : 'zh-CN'
    i18n.changeLanguage(nextLang)
  }

  const toggleTheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <header className={classes.header} style={style}>
      <Container size="lg" className={classes.inner}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/" className={classes.brandLink}>
            <Image
              src={pageConfig.logo ?? '/logo.svg'}
              h={42}
              w={{ base: 120, sm: 155 }}
              fit="contain"
              alt="UptimeFlare Logo"
            />
          </Link>
          <Badge
            variant="light"
            color="teal"
            size="sm"
            radius="sm"
             visibleFrom="md"
            style={{ textTransform: 'none', fontWeight: 600 }}
          >
            Cloudflare Edge Pro
          </Badge>
        </div>

        <Group gap={6} visibleFrom="sm">
          {links.map(linkToElement)}
        </Group>

        <Group gap={6}>
          <Group gap={4} hiddenFrom="sm">
            {links.filter((l) => l.link.startsWith('/')).map(linkToElement)}
          </Group>

          {onRefresh && (
            <Tooltip label={isRefreshing ? t('Refreshing') : t('Refresh Now')}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                radius="md"
                onClick={onRefresh}
                loading={isRefreshing}
                aria-label="Refresh status"
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
          )}

          <Tooltip label={i18n.language?.startsWith('zh') ? 'Switch to English' : '切换为中文'}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              radius="md"
              onClick={toggleLanguage}
              aria-label="Toggle language"
            >
              <IconWorld size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label={computedColorScheme === 'dark' ? '切换浅色模式' : '切换深色模式'}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              radius="md"
              onClick={toggleTheme}
              aria-label="Toggle color scheme"
            >
              {computedColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Container>
    </header>
  )
}
