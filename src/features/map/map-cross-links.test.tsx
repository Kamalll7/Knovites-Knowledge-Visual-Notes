import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
  CANVAS_SCHEMA_VERSION,
  extractKnovitesLinkTargetsFromCanvas,
  parseCanvasJson,
  parseNodeJson,
  type CanvasJson,
  type NodeJson,
} from '@/domain/schema'
import {
  VIRTUAL_ROOT_ID,
  buildTree,
  parseCanvasFilePath,
  parseNodeFilePath,
  type TreeBuildEntry,
} from '@/domain/tree'
import { MapRoute } from '@/features/map/MapRoute'
import { collectWorkspaceCrossLinks, selectActiveCrossLinks } from '@/features/map/map-cross-links'
import { computeRadialLayout, computeVisible, MAP_ROOT_ID } from '@/domain/layout'

function makeMeta(
  id: string,
  title: string,
  order: string,
  links: NodeJson['links'] = [],
): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'concept',
    status: 'none',
    tags: [],
    order,
    color: null,
    links,
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
  }
}

function makeCanvasWithLinks(hrefs: readonly string[]): CanvasJson {
  return {
    schema: CANVAS_SCHEMA_VERSION,
    elements: {
      e_1234abcd: {
        type: 'text',
        x: 0,
        y: 0,
        w: 240,
        z: 'a0',
        style: { bg: 'auto', border: 'auto' },
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: hrefs.map((href, idx) => ({
                type: 'text',
                text: `Link ${idx}`,
                marks: [{ type: 'link', attrs: { href } }],
              })),
            },
          ],
        },
        updatedAt: '2026-11-27T00:00:00Z',
      },
    },
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
    loadCanvas: async () => undefined,
    loadActiveCanvases: async () => {
      const folderToNodeId = new Map<string, string>()
      for (const [path, content] of files.entries()) {
        const folder = parseNodeFilePath(path)
        if (folder === null) continue
        const parsed = parseNodeJson(content)
        if (parsed.status === 'ok') folderToNodeId.set(folder, parsed.data.id)
      }
      const out: Array<{ nodeId: string; doc: CanvasJson }> = []
      for (const [path, content] of files.entries()) {
        const c = parseCanvasFilePath(path)
        if (!c) continue
        const parsed = parseCanvasJson(content)
        if (parsed.status !== 'ok') continue
        const nodeId = c.isRoot ? VIRTUAL_ROOT_ID : folderToNodeId.get(c.ownerPath)
        if (nodeId) out.push({ nodeId, doc: parsed.data })
      }
      return out
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

function renderMap(store: WorkspaceStoreApi) {
  return render(
    <WorkspaceStoreContext.Provider value={store}>
      <ThemeProvider defaultTheme="dark">
        <ToastHost>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<MapRoute />} />
            </Routes>
          </MemoryRouter>
        </ToastHost>
      </ThemeProvider>
    </WorkspaceStoreContext.Provider>,
  )
}

describe('map-cross-links extraction & MapCrossLinks focus/hover arcs [T3.9b, FR-MAP-16]', () => {
  it('extracts knovites:<ulid> targets, deduplicates, ignores self-links/broken links, and filters strictly by active focus/hover', () => {
    const idA = '01JC8ZQ4M7X2K9T50000000031'
    const idB = '01JC8ZQ4M7X2K9T50000000032'
    const idC = '01JC8ZQ4M7X2K9T50000000033'
    const idMissing = '01JC8ZQ4M7X2K9T50000000099'

    const canvasA = makeCanvasWithLinks([
      `knovites:${idB}`,
      `knovites:${idB}`, // duplicate
      `knovites:${idA}`, // self-link
      `knovites:${idMissing}`, // broken link
      'https://example.com', // external URL ignored
    ])

    const extracted = extractKnovitesLinkTargetsFromCanvas(canvasA)
    expect(extracted).toEqual([idB, idA, idMissing])

    const built = buildTree([
      {
        path: 'pwn',
        node: makeMeta(idA, 'PWN', 'a0', [{ to: idB, label: 'related' }]),
        hasCanvas: true,
      },
      { path: 're', node: makeMeta(idB, 'RE', 'a1'), hasCanvas: true },
      { path: 'crypto', node: makeMeta(idC, 'Crypto', 'a2'), hasCanvas: true },
    ])

    const allLinks = collectWorkspaceCrossLinks(built.state, {
      [idA]: extracted,
    })

    // Deduplicated, no self-link, no broken link
    expect(allLinks).toEqual([
      { id: `${idA}->${idB}`, sourceId: idA, targetId: idB, label: 'related' },
    ])

    const visible = computeVisible({
      tree: built.state,
      rootTitle: 'Home',
      focusId: MAP_ROOT_ID,
      zoomTier: 2,
    })
    const layout = computeRadialLayout({
      visible,
      measureText: (t) => t.length * 7.5,
      scale: 1,
      tier: 2,
    })

    // Unrelated focus (Crypto or Home) shows 0 arcs
    expect(selectActiveCrossLinks(allLinks, new Set([MAP_ROOT_ID]), layout)).toEqual([])
    expect(selectActiveCrossLinks(allLinks, new Set([idC]), layout)).toEqual([])
    // Focus/hover on source (PWN) or target (RE) shows the arc (outgoing + incoming)
    expect(selectActiveCrossLinks(allLinks, new Set([idA]), layout)).toHaveLength(1)
    expect(selectActiveCrossLinks(allLinks, new Set([idB]), layout)).toHaveLength(1)
  })

  it('renders dashed cross-link arcs in MapRoute ONLY when source or target is focused or hovered, with zero <filter>', async () => {
    let counter = 1
    const store = createWorkspaceStore({
      storage: createInMemoryStorageAdapter(),
      now: () => `2026-11-27T12:30:${String(counter++).padStart(2, '0')}Z`,
    })
    await store.getState().hydrate()
    const pwn = await store
      .getState()
      .createNode({ title: 'PWN', parentId: null, type: 'category' })
    const re = await store.getState().createNode({ title: 'RE', parentId: null, type: 'category' })
    const crypto = await store
      .getState()
      .createNode({ title: 'Crypto', parentId: null, type: 'category' })
    if (!pwn.ok || !re.ok || !crypto.ok) throw new Error('Seed failed')

    // Persist a canvas on PWN containing a knovites:<re.nodeId> link
    await store
      .getState()
      .savePageCanvas(pwn.nodeId, makeCanvasWithLinks([`knovites:${re.nodeId}`]))

    const { container } = renderMap(store)

    // Initially focused on Home (__root__) -> 0 cross-link arcs rendered!
    expect(screen.queryAllByTestId('map-cross-link')).toHaveLength(0)
    expect(container.querySelectorAll('filter')).toHaveLength(0)

    const svg = screen.getByTestId('map-svg')
    const getNode = (id: string) =>
      svg.querySelector<SVGGElement>(`[data-testid="map-node"][data-node-id="${id}"]`)!

    // Hover PWN -> outgoing cross-link arc appears with stroke-dasharray
    fireEvent.mouseEnter(getNode(pwn.nodeId))
    await waitFor(() => {
      const arcs = screen.getAllByTestId('map-cross-link')
      expect(arcs).toHaveLength(1)
      expect(arcs[0]).toHaveAttribute('data-source-id', pwn.nodeId)
      expect(arcs[0]).toHaveAttribute('data-target-id', re.nodeId)
    })
    const pathEl = screen.getByTestId('map-cross-link-path')
    expect(pathEl.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(container.querySelectorAll('filter')).toHaveLength(0)

    // Leave hover -> arc hides again
    fireEvent.mouseLeave(getNode(pwn.nodeId))
    await waitFor(() => {
      expect(screen.queryAllByTestId('map-cross-link')).toHaveLength(0)
    })

    // Click RE (incoming endpoint) -> arc appears while RE is focused
    fireEvent.click(getNode(re.nodeId))
    await waitFor(() => {
      expect(screen.getAllByTestId('map-cross-link')).toHaveLength(1)
    })

    // Click unrelated Crypto -> arc disappears cleanly
    fireEvent.click(getNode(crypto.nodeId))
    await waitFor(() => {
      expect(screen.queryAllByTestId('map-cross-link')).toHaveLength(0)
    })

    store.getState().dispose()
  })
})
