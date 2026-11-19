import { CloudOff, Compass, FileText, Moon, Settings, Sun } from 'lucide-react'
import { NavLink } from 'react-router'
import type { ReactNode } from 'react'
import { StorageStatusBanner } from '@/app/StorageStatusBanner'
import { useTheme } from '@/app/theme-context'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'
import { cn } from '@/ui/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: en.nav.map, icon: Compass, end: true },
  { to: '/n/demo-ret2win', label: en.nav.sampleNode, icon: FileText, end: false },
  { to: '/settings', label: en.nav.settings, icon: Settings, end: true },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {en.app.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <NavLink
              to="/"
              className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
            >
              <span
                className="size-2.5 rounded-full bg-primary shadow-[0_0_10px_var(--accent-glow)]"
                aria-hidden="true"
              />
              <span>{en.app.name}</span>
            </NavLink>

            <nav aria-label={en.nav.primaryNavLabel} className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'border-primary/40 bg-primary/15 text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <span
              title={en.sync.localOnlyHint}
              className="hidden items-center gap-1.5 rounded-sm border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex"
            >
              <CloudOff className="size-3.5" aria-hidden="true" />
              <span>{en.sync.localOnly}</span>
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={isDark ? en.theme.switchToLight : en.theme.switchToDark}
              onClick={toggleTheme}
            >
              {isDark ? (
                <>
                  <Sun className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{en.theme.light}</span>
                </>
              ) : (
                <>
                  <Moon className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{en.theme.dark}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <StorageStatusBanner />

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
    </div>
  )
}
