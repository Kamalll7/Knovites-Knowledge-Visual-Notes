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
import {
  createEmptyCanvas,
  parseCanvasJson,
  parseNodeJson,
  type CanvasJson,
  type NodeJson,
} from '@/domain/schema'
import {
  VIRTUAL_ROOT_ID,
  parseCanvasFilePath,
  parseNodeFilePath,
  type TreeBuildEntry,
} from '@/domain/tree'
import { MapRoute } from '@/features/map/MapRoute'

function createInMemoryStorageAdapter(): WorkspaceStorageAdapter {
  const files = new Map<string, string>()
  const softDeletedNodes = new Map<string, { path: string; content: string }>()
  const softDeletedCanvases = new Map<string, { path: string; content: string }>()

  const getNodeIdFromContent = (raw: string): string | null => {
    const parsed = parseNodeJson(raw)
    return parsed.status === 'ok' ? parsed.data.id : null
  }

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
        const parsed = parseNodeJson(content)
        entries.push({
          path: folder,
          parseResult: parsed,
          hasCanvas: folderHasCanvas.has(folder),
        })
      }
      return entries
    },
    loadCanvas: async (nodeId: string) => {
      const targetPath = nodeId === VIRTUAL_ROOT_ID ? 'canvas.json' : null
      if (targetPath && files.has(targetPath)) {
        const parsed = parseCanvasJson(files.get(targetPath)!)
        const doc: CanvasJson = parsed.status === 'ok' ? parsed.data : createEmptyCanvas()
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
    softDeleteSubtree: async (nodeIds) => {
      const idSet = new Set(nodeIds)
      const removedFolders = new Map<string, string>()
      for (const [path, content] of [...files.entries()]) {
        const folder = parseNodeFilePath(path)
        if (folder === null) continue
        const id = getNodeIdFromContent(content)
        if (id && idSet.has(id)) {
          softDeletedNodes.set(id, { path, content })
          removedFolders.set(folder, id)
          files.delete(path)
        }
      }
      for (const [path, content] of [...files.entries()]) {
        const c = parseCanvasFilePath(path)
        if (!c || c.isRoot) continue
        const ownerId = removedFolders.get(c.ownerPath)
        if (ownerId) {
          softDeletedCanvases.set(ownerId, { path, content })
          files.delete(path)
        }
      }
    },
    restoreSoftDeletedSubtree: async (nodeIds) => {
      let restoredPath: string | undefined
      for (const id of nodeIds) {
        const n = softDeletedNodes.get(id)
        if (n) {
          files.set(n.path, n.content)
          if (!restoredPath) restoredPath = parseNodeFilePath(n.path) ?? undefined
          softDeletedNodes.delete(id)
        }
        const c = softDeletedCanvases.get(id)
        if (c) {
          files.set(c.path, c.content)
          softDeletedCanvases.delete(id)
        }
      }
      return {
        restored: true,
        rootNodeId: nodeIds[0] ?? '',
        oldPath: restoredPath ?? '',
        parentId: null,
        restoredNodeIds: [...nodeIds],
        restoredPath: restoredPath ?? null,
        slugChanged: false,
        promotedToRoot: false,
        parentPathChanged: false,
      }
    },
    finalizeSoftDeletes: async (_now, nodeIds) => {
      if (!nodeIds) {
        softDeletedNodes.clear()
        softDeletedCanvases.clear()
        return
      }
      for (const id of nodeIds) {
        softDeletedNodes.delete(id)
        softDeletedCanvases.delete(id)
      }
    },
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
    now: () => `2026-11-26T10:00:${String(counter++).padStart(2, '0')}Z`,
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

describe('Map NodeActionToolbar & CRUD dialogs [T3.7, FR-MAP-10, FR-NODE-01..06]', () => {
  it('enforces strict __root__ UI lock: shows ONLY Open and Add child, never Rename/Status/More/Delete', async () => {
    const { store } = await createSeededStore()
    renderMap(store)

    const toolbar = screen.getByTestId('node-action-toolbar')
    expect(within(toolbar).getByTestId('node-action-open')).toBeInTheDocument()
    expect(within(toolbar).getByTestId('node-action-add-child')).toBeInTheDocument()
    expect(within(toolbar).queryByTestId('node-action-rename')).toBeNull()
    expect(within(toolbar).queryByTestId('node-action-status')).toBeNull()
    expect(within(toolbar).queryByTestId('node-action-more')).toBeNull()
    expect(within(toolbar).queryByTestId('node-action-delete')).toBeNull()
    expect(within(toolbar).queryByTestId('node-action-move-to')).toBeNull()

    // Add child directly from __root__ toolbar creates a root child and rejects empty title
    fireEvent.click(within(toolbar).getByTestId('node-action-add-child'))
    fireEvent.click(screen.getByTestId('add-child-submit'))
    expect(screen.getByRole('alert')).toHaveTextContent(/title/i)

    fireEvent.change(screen.getByTestId('add-child-title-input'), { target: { value: 'Crypto' } })
    fireEvent.click(screen.getByTestId('add-child-submit'))

    await waitFor(() => {
      const titles = Object.values(store.getState().tree.nodes).map((n) => n.meta.title)
      expect(titles).toContain('Crypto')
    })

    // Return focus to Home via breadcrumb and open Home page
    fireEvent.click(screen.getAllByTestId('map-breadcrumb-item')[0]!)
    await waitFor(() => {
      expect(
        within(screen.getByTestId('node-action-toolbar')).queryByTestId('node-action-delete'),
      ).toBeNull()
    })
    fireEvent.click(screen.getByTestId('node-action-open'))
    await waitFor(() => {
      expect(screen.getByTestId('opened-page-id').textContent).toBe(VIRTUAL_ROOT_ID)
    })

    store.getState().dispose()
  })

  it('supports Rename, Status, Type, Color (incl. Auto reset), Tags, and sibling Reorder from toolbar', async () => {
    const { store, ids } = await createSeededStore()
    renderMap(store)

    // Focus PWN via keyboard ArrowDown
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByTestId('node-action-rename')).toBeInTheDocument()
    })

    // Rename PWN -> Binary Exploitation
    fireEvent.click(screen.getByTestId('node-action-rename'))
    fireEvent.change(screen.getByTestId('rename-node-input'), {
      target: { value: 'Binary Exploitation' },
    })
    fireEvent.click(screen.getByTestId('rename-node-submit'))

    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.title).toBe('Binary Exploitation')
    })

    // Change Status -> practiced
    fireEvent.click(screen.getByTestId('node-action-status'))
    fireEvent.click(screen.getByTestId('status-option-practiced'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.status).toBe('practiced')
    })

    // Open More popover -> change Type, Color, reset Color to Auto, add & remove Tag, Move later
    fireEvent.click(screen.getByTestId('node-action-more'))
    fireEvent.click(screen.getByTestId('type-option-technique'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.type).toBe('technique')
    })

    fireEvent.click(screen.getByTestId('color-swatch-2'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.color).toMatch(/^#[0-9a-f]{6}$/i)
    })
    fireEvent.click(screen.getByTestId('color-option-auto'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.color).toBeNull()
    })

    // Tags validation + add + remove
    fireEvent.change(screen.getByTestId('tag-add-input'), { target: { value: 'INVALID TAG!' } })
    fireEvent.click(screen.getByTestId('tag-add-submit'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('tag-add-input'), { target: { value: 'rop_chain' } })
    fireEvent.click(screen.getByTestId('tag-add-submit'))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.tags).toEqual(['rop_chain'])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag rop_chain' }))
    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.meta.tags).toEqual([])
    })

    // Reorder: PWN is first root child (index 0), Move earlier disabled, Move later moves after RE
    expect(screen.getByTestId('node-action-move-earlier')).toBeDisabled()
    fireEvent.click(screen.getByTestId('node-action-move-later'))
    await waitFor(() => {
      expect(store.getState().tree.rootIds).toEqual([ids.re, ids.pwn])
    })

    store.getState().dispose()
  })

  it('blocks self and descendants in Move to dialog and moves node to valid destination', async () => {
    const { store, ids } = await createSeededStore()
    renderMap(store)

    // Focus PWN
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByTestId('node-action-more')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('node-action-more'))
    fireEvent.click(screen.getByTestId('node-action-move-to'))

    const dialog = await screen.findByTestId('move-node-dialog')
    expect(dialog).toHaveTextContent(/2 descendant/i)

    const options = within(dialog).getAllByTestId('move-target-option')
    const byTargetId = new Map(options.map((el) => [el.getAttribute('data-target-id'), el]))

    // Self (PWN) and descendants (Stack, ret2win) and current parent (Home) MUST be disabled
    expect(byTargetId.get(ids.pwn)).toBeDisabled()
    expect(byTargetId.get(ids.stack)).toBeDisabled()
    expect(byTargetId.get(ids.ret2win)).toBeDisabled()
    expect(byTargetId.get(VIRTUAL_ROOT_ID)).toBeDisabled()
    expect(byTargetId.get(ids.re)).not.toBeDisabled()

    // Select RE and confirm move
    fireEvent.click(byTargetId.get(ids.re)!)
    fireEvent.click(within(dialog).getByTestId('move-node-confirm'))

    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.parentId).toBe(ids.re)
    })

    store.getState().dispose()
  })

  it('shows descendant count in Delete confirmation and soft-deletes subtree on confirm', async () => {
    const { store, ids } = await createSeededStore()
    renderMap(store)

    // Focus PWN (has 2 descendants: Stack, ret2win)
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByTestId('node-action-more')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('node-action-more'))
    fireEvent.click(screen.getByTestId('node-action-delete'))

    const dialog = await screen.findByTestId('delete-node-dialog')
    expect(dialog).toHaveTextContent(/2 descendant/i)

    fireEvent.click(within(dialog).getByTestId('delete-node-confirm'))

    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]).toBeUndefined()
      expect(store.getState().pendingUndoDelete?.rootNodeId).toBe(ids.pwn)
      expect(store.getState().pendingUndoDelete?.nodeIds).toHaveLength(3)
    })

    // Type check helper usage for strict TS
    const metaCheck: NodeJson | undefined = store.getState().tree.nodes[ids.re]?.meta
    expect(metaCheck?.title).toBe('RE')

    store.getState().dispose()
  })
})
