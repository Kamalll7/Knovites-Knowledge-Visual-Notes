import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { NodePageRoute } from '@/app/NodePageRoute'
import { ThemeProvider } from '@/app/ThemeProvider'
import {
  createDexieWorkspaceAdapter,
  createWorkspaceStore,
  type WorkspaceStoreApi,
} from '@/app/store'
import { WorkspaceStoreContext } from '@/app/workspace-context'
import { VIRTUAL_ROOT_ID } from '@/domain/tree'
import { createKnovitesDatabase, getCanvasRecord, saveInvalidRootCanvas } from '@/storage'

function renderNodeRoute(store: WorkspaceStoreApi, initialEntry: string) {
  return render(
    <WorkspaceStoreContext.Provider value={store}>
      <ThemeProvider defaultTheme="dark">
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/" element={<div data-testid="map-route-stub">Map View</div>} />
            <Route path="/home" element={<NodePageRoute forcedNodeId={VIRTUAL_ROOT_ID} />} />
            <Route path="/n/:nodeId" element={<NodePageRoute />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </WorkspaceStoreContext.Provider>,
  )
}

async function createSeededTestEnv(dbName: string) {
  const indexedDB = new IDBFactory()
  const db = createKnovitesDatabase(dbName, { indexedDB, IDBKeyRange })
  const store = createWorkspaceStore({
    storage: createDexieWorkspaceAdapter(db),
    now: () => '2026-11-27T10:00:00Z',
  })
  await store.getState().hydrate()
  return { db, store }
}

describe('T4.1 NodePageShell & NodePageRoute [T4.1, FR-PAGE]', () => {
  it('loads Home ("__root__") lazily without writing root canvas.json to IndexedDB', async () => {
    const { db, store } = await createSeededTestEnv('t41-home-lazy-test')
    const saveSpy = vi.spyOn(store.getState(), 'savePageCanvas')

    renderNodeRoute(store, '/n/__root__')

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument()
    })

    // Opening Home without editing MUST NOT trigger lazy write to IndexedDB
    expect(saveSpy).not.toHaveBeenCalled()
    expect(await getCanvasRecord(db, VIRTUAL_ROOT_ID)).toBeUndefined()
    expect(store.getState().rootHome.hasCanvas).toBe(false)

    store.getState().dispose()
    db.close()
  })

  it('loads a valid persisted node with full breadcrumb, metadata, and navigates back to Map', async () => {
    const { db, store } = await createSeededTestEnv('t41-valid-node-test')
    const pwn = await store.getState().createNode({
      title: 'PWN',
      parentId: null,
      type: 'category',
    })
    if (!pwn.ok) throw new Error(pwn.message)
    const ret2win = await store.getState().createNode({
      title: 'ret2win',
      parentId: pwn.nodeId,
      type: 'technique',
      status: 'practiced',
      tags: ['stack', 'rop'],
    })
    if (!ret2win.ok) throw new Error(ret2win.message)

    renderNodeRoute(store, `/n/${ret2win.nodeId}`)

    expect(screen.getByRole('heading', { name: 'ret2win' })).toBeInTheDocument()
    expect(screen.getByTestId('node-page-breadcrumb')).toHaveTextContent('Home')
    expect(screen.getByTestId('node-page-breadcrumb')).toHaveTextContent('PWN')
    expect(screen.getByTestId('node-page-breadcrumb')).toHaveTextContent('ret2win')
    expect(screen.getByText('#stack')).toBeInTheDocument()
    expect(screen.getByText('#rop')).toBeInTheDocument()
    expect(screen.getByTestId('node-page-save-status')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('canvas-workspace')).toBeInTheDocument()
    })

    // Back to Map link returns cleanly to '/'
    fireEvent.click(screen.getByRole('link', { name: 'Back to map' }))
    expect(screen.getByTestId('map-route-stub')).toBeInTheDocument()

    store.getState().dispose()
    db.close()
  })

  it('renders a clean Not Found state with Back to map for missing node IDs without loading/saving canvas', async () => {
    const { db, store } = await createSeededTestEnv('t41-not-found-test')
    const loadSpy = vi.spyOn(store.getState(), 'loadPageCanvas')
    const saveSpy = vi.spyOn(store.getState(), 'savePageCanvas')

    renderNodeRoute(store, '/n/01JC8ZQ4M7X2K9T5VB3N6D8ZZZ')

    expect(screen.getByTestId('node-page-not-found')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-workspace')).not.toBeInTheDocument()
    expect(loadSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('link', { name: 'Back to map' }))
    expect(screen.getByTestId('map-route-stub')).toBeInTheDocument()

    store.getState().dispose()
    db.close()
  })

  it('toggles collapsible right side panel and switches between Links, Children, and Info tabs', async () => {
    const { db, store } = await createSeededTestEnv('t41-panel-toggle-test')
    const node = await store.getState().createNode({ title: 'Heap', parentId: null })
    if (!node.ok) throw new Error(node.message)

    renderNodeRoute(store, `/n/${node.nodeId}`)

    const toggleBtn = screen.getByTestId('node-page-panel-toggle')
    const initialExpanded = toggleBtn.getAttribute('aria-expanded') === 'true'
    if (!initialExpanded) {
      fireEvent.click(toggleBtn)
    }

    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByTestId('node-page-side-panel')
    expect(panel).toBeInTheDocument()

    const linksTab = screen.getByRole('tab', { name: 'Links' })
    const childrenTab = screen.getByRole('tab', { name: 'Children' })
    const infoTab = screen.getByRole('tab', { name: 'Info' })

    expect(linksTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(childrenTab)
    expect(childrenTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('node-page-tab-panel-children')).toBeInTheDocument()

    fireEvent.click(infoTab)
    expect(infoTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('node-page-tab-panel-info')).toBeInTheDocument()

    // Collapse panel
    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('node-page-side-panel')).not.toBeInTheDocument()

    store.getState().dispose()
    db.close()
  })

  it('shows read-only banner for corrupt/newer-schema canvas and preserves demo-ret2win sample route', async () => {
    const { db, store } = await createSeededTestEnv('t41-corrupt-and-sample-test')
    await saveInvalidRootCanvas(db, {
      rawJson: '{"schema":99,"elements":{}}',
      corrupt: true,
      newerSchemaVersion: 99,
    })
    await store.getState().hydrate()

    const { unmount } = renderNodeRoute(store, '/n/__root__')
    expect(screen.getByTestId('node-page-readonly-banner')).toBeInTheDocument()
    unmount()

    renderNodeRoute(store, '/n/demo-ret2win')
    expect(screen.getByRole('heading', { name: 'Node: demo-ret2win' })).toBeInTheDocument()
    expect(screen.queryByTestId('node-page-not-found')).not.toBeInTheDocument()

    store.getState().dispose()
    db.close()
  })
})
