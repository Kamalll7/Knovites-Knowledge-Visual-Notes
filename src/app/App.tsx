import { HashRouter, Link, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/app/AppShell'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ThemeProvider } from '@/app/ThemeProvider'
import { ToastHost } from '@/app/ToastHost'
import { MapPlaceholder } from '@/features/map/MapPlaceholder'
import { NodePagePlaceholder } from '@/features/page/NodePagePlaceholder'
import { SettingsPlaceholder } from '@/features/settings/SettingsPlaceholder'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

function NotFoundPlaceholder() {
  return (
    <section className="mx-auto my-12 max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-foreground">{en.notFound.title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{en.notFound.description}</p>
      <Button asChild size="sm" className="mt-4">
        <Link to="/">{en.notFound.backToMap}</Link>
      </Button>
    </section>
  )
}

function AppRoutes() {
  const location = useLocation()

  return (
    <Routes>
      <Route
        path="/"
        element={
          <ErrorBoundary resetKey={location.pathname}>
            <MapPlaceholder />
          </ErrorBoundary>
        }
      />
      <Route
        path="/n/:nodeId"
        element={
          <ErrorBoundary resetKey={location.pathname}>
            <NodePagePlaceholder />
          </ErrorBoundary>
        }
      />
      <Route
        path="/settings"
        element={
          <ErrorBoundary resetKey={location.pathname}>
            <SettingsPlaceholder />
          </ErrorBoundary>
        }
      />
      <Route
        path="*"
        element={
          <ErrorBoundary resetKey={location.pathname}>
            <NotFoundPlaceholder />
          </ErrorBoundary>
        }
      />
    </Routes>
  )
}

export function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <ToastHost>
        <HashRouter>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </HashRouter>
      </ToastHost>
    </ThemeProvider>
  )
}
