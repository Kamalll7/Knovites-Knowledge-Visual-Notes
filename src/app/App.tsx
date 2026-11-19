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
import {
  createBrowserTabLockCoordinator,
  createKnovitesDatabase,
  requestPersistentStorage,
  type TabLockCoordinator,
} from '@/storage'
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

function createDefaultWorkspaceRuntime(): {
  store: WorkspaceStoreApi
  coordinator: TabLockCoordinator | null
} {
  if (!detectIndexedDb()) {
    return {
      store: createWorkspaceStore({
        storage: createUnavailableStorageAdapter('IndexedDB is unavailable in this environment.'),
      }),
      coordinator: null,
    }
  }

  const db = createKnovitesDatabase()
  const coordinator = createBrowserTabLockCoordinator()
  let storeRef: WorkspaceStoreApi | null = null

  const store = createWorkspaceStore({
    storage: createDexieWorkspaceAdapter(db),
    onTakeOverWriter: async () => {
      await coordinator.takeOver()
      await storeRef?.getState().hydrate()
    },
  })
  storeRef = store

  return {
    store,
    coordinator,
  }
}

export interface AppProps {
  workspaceStore?: WorkspaceStoreApi
}

export function App({ workspaceStore }: AppProps) {
  const [{ store, coordinator }] = useState(() => {
    if (workspaceStore) {
      return { store: workspaceStore, coordinator: null }
    }
    return createDefaultWorkspaceRuntime()
  })

  useEffect(() => {
    if (!coordinator) return

    let active = true
    void requestPersistentStorage()

    const handlePageHide = () => {
      void coordinator.release()
    }
    window.addEventListener('pagehide', handlePageHide)

    void coordinator.acquire((role) => {
      if (!active) return
      const isReadOnly = role === 'readonly'
      store.getState().setReadOnlyTab(isReadOnly)
      if (!store.getState().hydrated || !isReadOnly) {
        void store.getState().hydrate()
      }
    })

    return () => {
      active = false
      window.removeEventListener('pagehide', handlePageHide)
      store.getState().dispose()
      void coordinator.release()
    }
  }, [store, coordinator])

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
