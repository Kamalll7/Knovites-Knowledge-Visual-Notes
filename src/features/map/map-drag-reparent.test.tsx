import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/app/ThemeProvider'
import { ToastHost } from '@/app/ToastHost'
import {
  createWorkspaceStore,
  type WorkspaceStorageAdapter,
  type WorkspaceStoreApi,
} from '@/app/store'
import { WorkspaceStoreContext } from '@/app/workspace-context'
import {
  MAP_ROOT_ID,
  OVERFLOW_NODE_PREFIX,
  computeRadialLayout,
  computeVisible,
} from '@/domain/layout'
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
  DRAG_REPARENT_THRESHOLD_PX,
  canStartNodeDrag,
  evaluateDragDropTarget,
  findDropTargetAtWorldPoint,
} from '@/features/map/map-drag-reparent'

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

async function createSeededStore() {
  let counter = 1
  const store = createWorkspaceStore({
    storage: createInMemoryStorageAdapter(),
    now: () => `2026-11-27T12:00:${String(counter++).padStart(2, '0')}Z`,
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

function mockSvgRect(svg: SVGSVGElement) {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1280,
    bottom: 700,
    width: 1280,
    height: 700,
    toJSON: () => ({}),
  })
}

function parseCamera(svg: SVGSVGElement): { x: number; y: number; k: number } {
  const g = svg.querySelector<SVGGElement>('[data-testid="map-camera-group"]')
  const raw = g?.getAttribute('transform') ?? ''
  const match = raw.match(/translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/)
  if (!match) return { x: 640, y: 350, k: 1 }
  return { x: Number(match[1]), y: Number(match[2]), k: Number(match[3]) }
}

function parseNodeWorldPos(el: Element): { x: number; y: number } {
  const raw = el.getAttribute('transform') ?? ''
  const match = raw.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/)
  if (!match) throw new Error(`Missing translate transform on node: ${raw}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

function worldToClient(
  world: { x: number; y: number },
  cam: { x: number; y: number; k: number },
): { clientX: number; clientY: number } {
  return {
    clientX: world.x * cam.k + cam.x,
    clientY: world.y * cam.k + cam.y,
  }
}

describe('map-drag-reparent pure guards & MapRoute drag-and-drop reparent [T3.9b, FR-MAP-15]', () => {
  it('blocks dragging __root__ and +N overflow bubbles, enforces cycle/self/same-parent guards, and allows valid drop onto __root__ or sibling', () => {
    const idPwn = '01JC8ZQ4M7X2K9T50000000021'
    const idStack = '01JC8ZQ4M7X2K9T50000000022'
    const idRet2win = '01JC8ZQ4M7X2K9T50000000023'
    const idRe = '01JC8ZQ4M7X2K9T50000000024'
    const built = buildTree([
      { path: 'pwn', node: makeMeta(idPwn, 'PWN', 'a0'), hasCanvas: true },
      { path: 'pwn/stack', node: makeMeta(idStack, 'Stack', 'a0'), hasCanvas: true },
      { path: 'pwn/stack/ret2win', node: makeMeta(idRet2win, 'ret2win', 'a0'), hasCanvas: true },
      { path: 're', node: makeMeta(idRe, 'RE', 'a1'), hasCanvas: true },
    ])
    const tree = built.state

    // __root__ and overflow bubbles cannot start drag; read-only tab blocks all drags
    expect(canStartNodeDrag(tree, VIRTUAL_ROOT_ID, false)).toBe(false)
    expect(canStartNodeDrag(tree, `${OVERFLOW_NODE_PREFIX}${idPwn}`, false)).toBe(false)
    expect(canStartNodeDrag(tree, idPwn, true)).toBe(false)
    expect(canStartNodeDrag(tree, idPwn, false)).toBe(true)

    // Self, direct child, deep descendant, and current parent are rejected
    expect(evaluateDragDropTarget(tree, idPwn, idPwn)).toMatchObject({
      status: 'invalid',
      reason: 'self',
    })
    expect(evaluateDragDropTarget(tree, idPwn, idStack)).toMatchObject({
      status: 'invalid',
      reason: 'descendant',
    })
    expect(evaluateDragDropTarget(tree, idPwn, idRet2win)).toMatchObject({
      status: 'invalid',
      reason: 'descendant',
    })
    expect(evaluateDragDropTarget(tree, idPwn, VIRTUAL_ROOT_ID)).toMatchObject({
      status: 'invalid',
      reason: 'same_parent',
    })

    // Valid drops: PWN -> RE, and Stack -> __root__ (promote to root child)
    expect(evaluateDragDropTarget(tree, idPwn, idRe)).toEqual({
      status: 'valid',
      targetId: idRe,
      newParentId: idRe,
    })
    expect(evaluateDragDropTarget(tree, idStack, VIRTUAL_ROOT_ID)).toEqual({
      status: 'valid',
      targetId: VIRTUAL_ROOT_ID,
      newParentId: null,
    })

    // Hit-testing finds node at its laid-out coordinates
    const visible = computeVisible({ tree, rootTitle: 'Home', focusId: MAP_ROOT_ID, zoomTier: 2 })
    const layout = computeRadialLayout({
      visible,
      measureText: (t) => t.length * 7.5,
      scale: 1,
      tier: 2,
    })
    const reNode = layout.nodes[idRe]!
    expect(findDropTargetAtWorldPoint(reNode.x, reNode.y, layout, idPwn)).toBe(idRe)
    expect(findDropTargetAtWorldPoint(99_999, 99_999, layout, idPwn)).toBeNull()
  })

  it('keeps sub-threshold click as focus, supports Escape cancel, rejects descendant drop, and reparents on valid drop', async () => {
    const { store, ids } = await createSeededStore()
    renderMap(store)

    const svg = screen.getByTestId('map-svg') as unknown as SVGSVGElement
    mockSvgRect(svg)
    const cam = parseCamera(svg)

    const getNodeEl = (id: string) =>
      svg.querySelector<SVGGElement>(`[data-testid="map-node"][data-node-id="${id}"]`)!

    // 1. Sub-threshold pointer jitter + click still focuses PWN (not drag)
    const pwnEl = getNodeEl(ids.pwn)
    const pwnClient = worldToClient(parseNodeWorldPos(pwnEl), cam)
    fireEvent.pointerDown(pwnEl, {
      button: 0,
      clientX: pwnClient.clientX,
      clientY: pwnClient.clientY,
    })
    fireEvent.pointerMove(window, {
      clientX: pwnClient.clientX + Math.floor(DRAG_REPARENT_THRESHOLD_PX / 2),
      clientY: pwnClient.clientY,
    })
    fireEvent.pointerUp(window, {
      clientX: pwnClient.clientX + Math.floor(DRAG_REPARENT_THRESHOLD_PX / 2),
      clientY: pwnClient.clientY,
    })
    expect(screen.queryByTestId('map-drag-ghost')).toBeNull()
    fireEvent.click(pwnEl)
    await waitFor(() => {
      expect(screen.getByTestId('map-breadcrumb')).toHaveTextContent('PWN')
    })

    // 2. Dragging __root__ never activates ghost
    const rootEl = getNodeEl(VIRTUAL_ROOT_ID)
    expect(rootEl).toHaveAttribute('data-draggable', 'false')
    const rootClient = worldToClient(parseNodeWorldPos(rootEl), parseCamera(svg))
    fireEvent.pointerDown(rootEl, {
      button: 0,
      clientX: rootClient.clientX,
      clientY: rootClient.clientY,
    })
    fireEvent.pointerMove(window, {
      clientX: rootClient.clientX + 80,
      clientY: rootClient.clientY + 80,
    })
    expect(screen.queryByTestId('map-drag-ghost')).toBeNull()
    fireEvent.pointerUp(window)

    // 3. Drag PWN over its child Stack -> shows invalid drop state, releasing performs NO mutation
    const camNow = parseCamera(svg)
    const pwnNow = getNodeEl(ids.pwn)
    const stackNow = getNodeEl(ids.stack)
    const pwnStart = worldToClient(parseNodeWorldPos(pwnNow), camNow)
    const stackDest = worldToClient(parseNodeWorldPos(stackNow), camNow)

    fireEvent.pointerDown(pwnNow, {
      button: 0,
      clientX: pwnStart.clientX,
      clientY: pwnStart.clientY,
    })
    fireEvent.pointerMove(window, {
      clientX: stackDest.clientX,
      clientY: stackDest.clientY,
    })
    expect(screen.getByTestId('map-drag-ghost')).toBeInTheDocument()
    expect(getNodeEl(ids.stack)).toHaveAttribute('data-drop-state', 'invalid')
    fireEvent.pointerUp(window, { clientX: stackDest.clientX, clientY: stackDest.clientY })
    expect(screen.queryByTestId('map-drag-ghost')).toBeNull()
    expect(store.getState().tree.nodes[ids.pwn]?.parentId).toBeNull()

    // 4. Drag PWN over RE, press Escape -> cancels cleanly with NO mutation
    const reDest = worldToClient(parseNodeWorldPos(getNodeEl(ids.re)), camNow)
    fireEvent.pointerDown(pwnNow, {
      button: 0,
      clientX: pwnStart.clientX,
      clientY: pwnStart.clientY,
    })
    fireEvent.pointerMove(window, { clientX: reDest.clientX, clientY: reDest.clientY })
    expect(getNodeEl(ids.re)).toHaveAttribute('data-drop-state', 'valid')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('map-drag-ghost')).toBeNull()
    fireEvent.pointerUp(window, { clientX: reDest.clientX, clientY: reDest.clientY })
    expect(store.getState().tree.nodes[ids.pwn]?.parentId).toBeNull()

    // 5. Drag PWN onto RE and release -> calls moveNode and reparents PWN under RE
    fireEvent.pointerDown(pwnNow, {
      button: 0,
      clientX: pwnStart.clientX,
      clientY: pwnStart.clientY,
    })
    fireEvent.pointerMove(window, { clientX: reDest.clientX, clientY: reDest.clientY })
    expect(getNodeEl(ids.re)).toHaveAttribute('data-drop-state', 'valid')
    fireEvent.pointerUp(window, { clientX: reDest.clientX, clientY: reDest.clientY })

    await waitFor(() => {
      expect(store.getState().tree.nodes[ids.pwn]?.parentId).toBe(ids.re)
    })

    store.getState().dispose()
  })
})
