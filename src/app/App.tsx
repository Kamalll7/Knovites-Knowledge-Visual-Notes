import { useEffect, useState } from 'react'
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/app/AppShell'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ThemeProvider } from '@/app/ThemeProvider'
import { ToastHost } from '@/app/ToastHost'
import {
  createDexieWorkspaceAdapter,
  createUnavailableStorageAdapter,
  createWorkspaceStore,
  type WorkspaceStoreApi,
} from '@/app/store'
import { WorkspaceStoreContext } from '@/app/workspace-context'
import { MapPlaceholder } from '@/features/map/MapPlaceholder'
import { NodePagePlaceholder } from '@/features/page/NodePagePlaceholder'
import { SettingsPlaceholder } from '@/features/settings/SettingsPlaceholder'
import { en } from '@/i18n/en'
import { createKnovitesDatabase } from '@/storage'
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

function detectIndexedDb(): boolean {
  try {
    return typeof window !== 'undefined' && window.indexedDB != null
  } catch {
    return false
  }
}

function createDefaultWorkspaceStore(): {
  store: WorkspaceStoreApi
  shouldHydrateOnMount: boolean
} {
  if (!detectIndexedDb()) {
    return {
      store: createWorkspaceStore({
        storage: createUnavailableStorageAdapter('IndexedDB is unavailable in this environment.'),
      }),
      shouldHydrateOnMount: false,
    }
  }

  return {
    store: createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(createKnovitesDatabase()),
    }),
    shouldHydrateOnMount: true,
  }
}

export interface AppProps {
  workspaceStore?: WorkspaceStoreApi
}

export function App({ workspaceStore }: AppProps) {
  const [{ store, shouldHydrateOnMount }] = useState(() => {
    if (workspaceStore) {
      return { store: workspaceStore, shouldHydrateOnMount: false }
    }
    return createDefaultWorkspaceStore()
  })

  useEffect(() => {
    if (!shouldHydrateOnMount || store.getState().hydrated) return
    void store.getState().hydrate()
    return () => {
      store.getState().dispose()
    }
  }, [store, shouldHydrateOnMount])

  return (
    <WorkspaceStoreContext.Provider value={store}>
      <ThemeProvider defaultTheme="dark">
        <ToastHost>
          <HashRouter>
            <AppShell>
              <AppRoutes />
            </AppShell>
          </HashRouter>
        </ToastHost>
      </ThemeProvider>
    </WorkspaceStoreContext.Provider>
  )
}
