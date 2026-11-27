import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/app/ThemeProvider'
import { ToastHost } from '@/app/ToastHost'
import {
  createWorkspaceStore,
  type WorkspaceStorageAdapter,
  type WorkspaceStoreApi,
} from '@/app/store'
import { WorkspaceStoreContext } from '@/app/workspace-context'
import { parseCanvasJson, parseNodeJson, type CanvasJson, type NodeJson } from '@/domain/schema'
import {
  VIRTUAL_ROOT_ID,
  buildTree,
  parseCanvasFilePath,
  parseNodeFilePath,
  type TreeBuildEntry,
} from '@/domain/tree'
import { MapRoute } from '@/features/map/MapRoute'
import {
  buildInitialExpandedIds,
  flattenOutlineRows,
  resolveOutlineKeyCommand,
} from '@/features/map/map-outline'

function makeMeta(id: string, title: string, order: string): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'concept',
    status: 'none',
    tags: [],
    order,
    color: null,
    links: [],
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
  }
}

function createInMemoryStorageAdapter(): WorkspaceStorageAdapter {
  const files = new Map<string, string>()

  return {
    loadEntries: async (): Promise<TreeBuildEntry[]> => {
      const folderHasCanvas = new Set<string>()
      let rootHasCanvas = false
      for (const path of files.keys()) {
        const c = parseCanvasFilePath(path)
        if (!c) continue
        if (c.isRoot) rootHasCanvas = true
        else folderHasCanvas.add(c.ownerPath)
      }
      const entries: TreeBuildEntry[] = []
      if (rootHasCanvas) {
        entries.push({ path: '', isVirtualRoot: true, hasCanvas: true })
      }
      for (const [path, content] of files.entries()) {
        const folder = parseNodeFilePath(path)
        if (folder === null) continue
        entries.push({
          path: folder,
          parseResult: parseNodeJson(content),
          hasCanvas: folderHasCanvas.has(folder),
        })
      }
      return entries
    },
    loadCanvas: async (nodeId: string) => {
      const targetPath = nodeId === VIRTUAL_ROOT_ID ? 'canvas.json' : null
      if (targetPath && files.has(targetPath)) {
        const parsed = parseCanvasJson(files.get(targetPath)!)
        const doc: CanvasJson = parsed.status === 'ok' ? parsed.data : { schema: 1, elements: {} }
        return {
          nodeId,
          path: '',
          doc,
          rawJson: files.get(targetPath)!,
          corrupt: parsed.status !== 'ok',
          loaded: true,
          baseBlobSha: null,
          basePath: null,
          dirty: 1,
          deletedAt: 0,
        }
      }
      return undefined
    },
    applyChangeset: async (changeset) => {
      for (const del of changeset.deletes) files.delete(del)
      const moved = new Map<string, string>()
      for (const mv of changeset.moves) {
        const existing = files.get(mv.from)
        if (existing !== undefined) {
          moved.set(mv.to, existing)
          files.delete(mv.from)
        }
      }
      for (const [to, content] of moved.entries()) files.set(to, content)
      for (const up of changeset.upserts) files.set(up.path, up.content)
    },
    softDeleteSubtree: async () => {},
    restoreSoftDeletedSubtree: async (nodeIds) => ({
      restored: true,
      rootNodeId: nodeIds[0] ?? '',
      oldPath: '',
      parentId: null,
      restoredNodeIds: [...nodeIds],
      restoredPath: null,
      slugChanged: false,
      promotedToRoot: false,
      parentPathChanged: false,
    }),
    finalizeSoftDeletes: async () => {},
    appendErrorLog: async () => {},
  }
}

function PageRouteSpy() {
  const { nodeId } = useParams()
  return <div data-testid="opened-page-id">{nodeId}</div>
}

async function createSeededStore(): Promise<{
  store: WorkspaceStoreApi
  ids: { pwn: string; stack: string; ret2win: string; re: string }
}> {
  let counter = 1
  const store = createWorkspaceStore({
    storage: createInMemoryStorageAdapter(),
    now: () => `2026-11-27T10:00:${String(counter++).padStart(2, '0')}Z`,
  })
  await store.getState().hydrate()
  const pwn = await store.getState().createNode({ title: 'PWN', parentId: null, type: 'category' })
  const re = await store.getState().createNode({ title: 'RE', parentId: null, type: 'category' })
  if (!pwn.ok || !re.ok) throw new Error('Seed root failed')
  const stack = await store
    .getState()
    .createNode({ title: 'Stack', parentId: pwn.nodeId, type: 'concept' })
  if (!stack.ok) throw new Error('Seed child failed')
  const ret2win = await store
    .getState()
    .createNode({ title: 'ret2win', parentId: stack.nodeId, type: 'challenge' })
  if (!ret2win.ok) throw new Error('Seed grandchild failed')

  return {
    store,
    ids: { pwn: pwn.nodeId, stack: stack.nodeId, ret2win: ret2win.nodeId, re: re.nodeId },
  }
}

function renderMap(store: WorkspaceStoreApi) {
  return render(
    <WorkspaceStoreContext.Provider value={store}>
      <ThemeProvider defaultTheme="dark">
        <ToastHost>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<MapRoute />} />
              <Route path="/n/:nodeId" element={<PageRouteSpy />} />
            </Routes>
          </MemoryRouter>
        </ToastHost>
      </ThemeProvider>
    </WorkspaceStoreContext.Provider>,
  )
}

describe('map-outline pure helpers & accessible Outline TreeView [T3.9a, FR-MAP-14]', () => {
  it('flattens tree rows with accurate WAI-ARIA levels, descendant counts, and keyboard commands', () => {
    const idPwn = '01JC8ZQ4M7X2K9T50000000011'
    const idStack = '01JC8ZQ4M7X2K9T50000000012'
    const idRet2win = '01JC8ZQ4M7X2K9T50000000013'
    const idRe = '01JC8ZQ4M7X2K9T50000000014'
    const built = buildTree([
      { path: 'pwn', node: makeMeta(idPwn, 'PWN', 'a0'), hasCanvas: true },
      { path: 'pwn/stack', node: makeMeta(idStack, 'Stack', 'a0'), hasCanvas: true },
      { path: 'pwn/stack/ret2win', node: makeMeta(idRet2win, 'ret2win', 'a0'), hasCanvas: true },
      { path: 're', node: makeMeta(idRe, 'RE', 'a1'), hasCanvas: true },
    ])

    const initialExpanded = buildInitialExpandedIds(built.state, VIRTUAL_ROOT_ID)
    const rows = flattenOutlineRows(built.state, 'Home', initialExpanded)
    // Home (expanded) -> PWN (expanded) -> Stack (collapsed) -> RE
    expect(rows.map((r) => r.id)).toEqual([VIRTUAL_ROOT_ID, idPwn, idStack, idRe])
    expect(rows[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 1, descendantCount: 4 })
    expect(rows[1]).toMatchObject({ level: 2, posInSet: 1, setSize: 2, descendantCount: 2 })
    expect(rows[2]).toMatchObject({
      level: 3,
      posInSet: 1,
      setSize: 1,
      hasChildren: true,
      isExpanded: false,
      descendantCount: 1,
    })

    // ArrowDown moves from Home -> PWN
    expect(resolveOutlineKeyCommand('ArrowDown', rows, VIRTUAL_ROOT_ID)).toEqual({
      type: 'focus',
      nodeId: idPwn,
    })
    // ArrowRight on collapsed Stack expands it
    expect(resolveOutlineKeyCommand('ArrowRight', rows, idStack)).toEqual({
      type: 'expand',
      nodeId: idStack,
    })
    // ArrowRight on expanded PWN moves to first child Stack
    expect(resolveOutlineKeyCommand('ArrowRight', rows, idPwn)).toEqual({
      type: 'focus',
      nodeId: idStack,
    })
    // ArrowLeft on expanded PWN collapses it; ArrowLeft on collapsed Stack moves to parent PWN
    expect(resolveOutlineKeyCommand('ArrowLeft', rows, idPwn)).toEqual({
      type: 'collapse',
      nodeId: idPwn,
    })
    expect(resolveOutlineKeyCommand('ArrowLeft', rows, idStack)).toEqual({
      type: 'focus',
      nodeId: idPwn,
    })
    // Home / End / Enter
    expect(resolveOutlineKeyCommand('End', rows, VIRTUAL_ROOT_ID)).toEqual({
      type: 'focus',
      nodeId: idRe,
    })
    expect(resolveOutlineKeyCommand('Home', rows, idRe)).toEqual({
      type: 'focus',
      nodeId: VIRTUAL_ROOT_ID,
    })
    expect(resolveOutlineKeyCommand('Enter', rows, idStack)).toEqual({
      type: 'open',
      nodeId: idStack,
    })
  })

  it('toggles Map <-> Outline, enforces WAI-ARIA tree roles, syncs focus/toolbar/breadcrumb, and enforces __root__ lock', async () => {
    const { store, ids } = await createSeededStore()
    renderMap(store)

    // Switch to Outline via HUD toggle
    fireEvent.click(screen.getByTestId('map-view-mode-outline'))
    const treeEl = screen.getByRole('tree', { name: /outline/i })
    expect(treeEl).toBeInTheDocument()
    // Map minimap and orientation buttons are hidden in Outline mode
    expect(screen.queryByTestId('map-minimap')).toBeNull()
    expect(screen.queryByTestId('map-orientation-radial')).toBeNull()

    // Focused on __root__ initially -> strict UI lock in toolbar (no Rename/Delete)
    const toolbar = screen.getByTestId('node-action-toolbar')
    expect(within(toolbar).queryByTestId('node-action-rename')).toBeNull()
    expect(within(toolbar).getByTestId('node-action-add-child')).toBeInTheDocument()

    // Navigate Outline via keyboard: Home -> ArrowDown -> PWN -> ArrowDown -> Stack -> ArrowRight (expand) -> ArrowRight (ret2win)
    const homeItem = within(treeEl)
      .getAllByRole('treeitem')
      .find((el) => el.getAttribute('data-node-id') === VIRTUAL_ROOT_ID)!
    expect(homeItem).toHaveAttribute('aria-selected', 'true')
    expect(homeItem).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(homeItem, { key: 'ArrowDown' })
    const pwnItem = await waitFor(() => {
      const el = within(treeEl)
        .getAllByRole('treeitem')
        .find((item) => item.getAttribute('data-node-id') === ids.pwn)
      expect(el).toHaveAttribute('aria-selected', 'true')
      return el!
    })

    // Synced with NodeActionToolbar & MapBreadcrumb!
    expect(
      within(screen.getByTestId('node-action-toolbar')).getByTestId('node-action-rename'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('map-breadcrumb')).toHaveTextContent('PWN')

    // ArrowDown to Stack, ArrowRight to expand Stack revealing ret2win
    fireEvent.keyDown(pwnItem, { key: 'ArrowDown' })
    const stackItem = await waitFor(() => {
      const el = within(treeEl)
        .getAllByRole('treeitem')
        .find((item) => item.getAttribute('data-node-id') === ids.stack)
      expect(el).toHaveAttribute('aria-selected', 'true')
      expect(el).toHaveAttribute('aria-expanded', 'false')
      return el!
    })

    fireEvent.keyDown(stackItem, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(stackItem).toHaveAttribute('aria-expanded', 'true')
      expect(
        within(treeEl)
          .getAllByRole('treeitem')
          .some((item) => item.getAttribute('data-node-id') === ids.ret2win),
      ).toBe(true)
    })

    // Rename Stack directly from toolbar while in Outline mode
    fireEvent.click(screen.getByTestId('node-action-rename'))
    fireEvent.change(screen.getByTestId('rename-node-input'), {
      target: { value: 'Stack Overflow' },
    })
    fireEvent.click(screen.getByTestId('rename-node-submit'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.stack]?.meta.title).toBe('Stack Overflow')
      expect(treeEl).toHaveTextContent('Stack Overflow')
    })

    // Return to Map -> focus remains synced on Stack Overflow and minimap is back
    fireEvent.click(screen.getByTestId('map-view-mode-map'))
    expect(screen.getByTestId('map-minimap')).toBeInTheDocument()
    expect(screen.getByTestId('map-breadcrumb')).toHaveTextContent('Stack Overflow')

    // Switch back to Outline and press Enter on focused Stack Overflow -> opens page route
    fireEvent.click(screen.getByTestId('map-view-mode-outline'))
    const focusedStackItem = within(screen.getByRole('tree'))
      .getAllByRole('treeitem')
      .find((item) => item.getAttribute('data-node-id') === ids.stack)!
    fireEvent.keyDown(focusedStackItem, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByTestId('opened-page-id').textContent).toBe(ids.stack)
    })

    store.getState().dispose()
  })
})
