import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/app/ThemeProvider'
import { ToastHost } from '@/app/ToastHost'
import { createWorkspaceStore, type WorkspaceStorageAdapter } from '@/app/store'
import { WorkspaceStoreContext } from '@/app/workspace-context'
import { VIRTUAL_ROOT_ID, buildTree, type TreeBuildEntry } from '@/domain/tree'
import { MapBreadcrumb } from '@/features/map/MapBreadcrumb'
import { MapRoute } from '@/features/map/MapRoute'
import { buildBreadcrumbTrail } from '@/features/map/map-breadcrumb'
import {
  isTextInputTarget,
  resolveMapKeyboardCommand,
  useMapKeyboard,
} from '@/features/map/useMapKeyboard'

function createInMemoryStorageAdapter(): WorkspaceStorageAdapter {
  return {
    loadEntries: async () => [],
    loadCanvas: async () => undefined,
    applyChangeset: async () => {},
    softDeleteSubtree: async () => {},
    restoreSoftDeletedSubtree: async () => ({
      restored: false,
      rootNodeId: null,
      oldPath: null,
      restoredPath: null,
      parentId: null,
      promotedToRoot: false,
      slugChanged: false,
      parentPathChanged: false,
    }),
    finalizeSoftDeletes: async () => {},
    appendErrorLog: async () => {},
  }
}

function PageRouteSpy() {
  const { nodeId } = useParams<{ nodeId: string }>()
  return <div data-testid="opened-page-id">{nodeId}</div>
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function makeUlid(n: number): string {
  let num = n
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = CROCKFORD[num % 32]! + suffix
    num = Math.floor(num / 32)
  }
  return `01KN0V1TE5000000${suffix}`
}

function buildSampleTree() {
  const idPwn = makeUlid(1)
  const idRe = makeUlid(2)
  const idStack = makeUlid(3)
  const idHeap = makeUlid(4)
  const idRet2win = makeUlid(5)

  const entries: TreeBuildEntry[] = [
    {
      path: 'pwn',
      node: {
        schema: 1,
        id: idPwn,
        title: 'PWN',
        type: 'category',
        status: 'none',
        tags: [],
        order: 'a0',
        color: null,
        links: [],
        createdAt: '2026-11-26T10:00:00Z',
        updatedAt: '2026-11-26T10:00:00Z',
      },
      hasCanvas: true,
    },
    {
      path: 're',
      node: {
        schema: 1,
        id: idRe,
        title: 'Reverse Engineering',
        type: 'category',
        status: 'learning',
        tags: [],
        order: 'a1',
        color: null,
        links: [],
        createdAt: '2026-11-26T10:00:00Z',
        updatedAt: '2026-11-26T10:00:00Z',
      },
      hasCanvas: true,
    },
    {
      path: 'pwn/stack',
      node: {
        schema: 1,
        id: idStack,
        title: 'Stack Exploitation',
        type: 'concept',
        status: 'practiced',
        tags: ['stack'],
        order: 'a0',
        color: null,
        links: [],
        createdAt: '2026-11-26T10:00:00Z',
        updatedAt: '2026-11-26T10:00:00Z',
      },
      hasCanvas: true,
    },
    {
      path: 'pwn/heap',
      node: {
        schema: 1,
        id: idHeap,
        title: 'Heap',
        type: 'concept',
        status: 'none',
        tags: [],
        order: 'a1',
        color: null,
        links: [],
        createdAt: '2026-11-26T10:00:00Z',
        updatedAt: '2026-11-26T10:00:00Z',
      },
      hasCanvas: true,
    },
    {
      path: 'pwn/stack/ret2win',
      node: {
        schema: 1,
        id: idRet2win,
        title: 'ret2win',
        type: 'technique',
        status: 'mastered',
        tags: ['pwn', 'rop'],
        order: 'a0',
        color: null,
        links: [],
        createdAt: '2026-11-26T10:00:00Z',
        updatedAt: '2026-11-26T10:00:00Z',
      },
      hasCanvas: true,
    },
  ]

  return {
    tree: buildTree(entries).state,
    ids: { idPwn, idRe, idStack, idHeap, idRet2win },
  }
}

describe('MapBreadcrumb & useMapKeyboard [T3.7, FR-MAP-07, FR-MAP-11]', () => {
  it('builds breadcrumb trail Home > ... > focus and fires onSelectNode on click with full-title tooltips', () => {
    const { tree, ids } = buildSampleTree()
    const trail = buildBreadcrumbTrail(tree, ids.idRet2win)
    expect(trail.map((item) => item.id)).toEqual([
      VIRTUAL_ROOT_ID,
      ids.idPwn,
      ids.idStack,
      ids.idRet2win,
    ])
    expect(trail.map((item) => item.title)).toEqual([
      'Home',
      'PWN',
      'Stack Exploitation',
      'ret2win',
    ])
    expect(trail[trail.length - 1]?.isCurrent).toBe(true)

    const onSelect = vi.fn()
    render(<MapBreadcrumb items={trail} onSelectNode={onSelect} />)

    const buttons = screen.getAllByTestId('map-breadcrumb-item')
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toHaveAttribute('title', 'Home')
    expect(buttons[2]).toHaveAttribute('title', 'Stack Exploitation')
    expect(buttons[3]).toHaveAttribute('aria-current', 'location')

    fireEvent.click(buttons[1]!)
    expect(onSelect).toHaveBeenCalledWith(ids.idPwn)

    fireEvent.click(buttons[0]!)
    expect(onSelect).toHaveBeenCalledWith(VIRTUAL_ROOT_ID)
  })

  it('resolves radial and horizontal keyboard navigation commands cleanly (arrows, Enter, Escape)', () => {
    const { tree, ids } = buildSampleTree()

    // Radial orientation (FR-MAP-07): Left/Right = siblings, Down = first child, Up = parent
    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowDown',
        tree,
        focusId: VIRTUAL_ROOT_ID,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idPwn })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowRight',
        tree,
        focusId: ids.idPwn,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idRe })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowLeft',
        tree,
        focusId: ids.idRe,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idPwn })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowDown',
        tree,
        focusId: ids.idPwn,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idStack })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowUp',
        tree,
        focusId: ids.idStack,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idPwn })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowUp',
        tree,
        focusId: ids.idPwn,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: VIRTUAL_ROOT_ID })

    expect(
      resolveMapKeyboardCommand({
        key: 'Escape',
        tree,
        focusId: ids.idRet2win,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idStack })

    expect(
      resolveMapKeyboardCommand({
        key: 'Enter',
        tree,
        focusId: VIRTUAL_ROOT_ID,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'open', nodeId: VIRTUAL_ROOT_ID })

    expect(
      resolveMapKeyboardCommand({
        key: 'Enter',
        tree,
        focusId: ids.idRet2win,
        orientation: 'radial',
      }),
    ).toEqual({ type: 'open', nodeId: ids.idRet2win })

    // Horizontal orientation: Left = parent, Right = first child, Up/Down = siblings
    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowRight',
        tree,
        focusId: ids.idPwn,
        orientation: 'horizontal',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idStack })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowDown',
        tree,
        focusId: ids.idStack,
        orientation: 'horizontal',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idHeap })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowUp',
        tree,
        focusId: ids.idHeap,
        orientation: 'horizontal',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idStack })

    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowLeft',
        tree,
        focusId: ids.idStack,
        orientation: 'horizontal',
      }),
    ).toEqual({ type: 'focus', nodeId: ids.idPwn })

    // Modifier keys are never hijacked
    expect(
      resolveMapKeyboardCommand({
        key: 'ArrowLeft',
        tree,
        focusId: ids.idRe,
        orientation: 'radial',
        hasModKey: true,
      }),
    ).toEqual({ type: 'none' })
  })

  it('ignores map shortcuts while typing in input, textarea, contenteditable, or when disabled', () => {
    const { tree, ids } = buildSampleTree()
    const onFocusNode = vi.fn()
    const onOpenNode = vi.fn()

    function Harness({ disabled = false }: { disabled?: boolean }) {
      useMapKeyboard({
        tree,
        focusId: ids.idPwn,
        orientation: 'radial',
        disabled,
        onFocusNode,
        onOpenNode,
      })
      return (
        <div>
          <input data-testid="text-input" />
          <textarea data-testid="text-area" />
          <div data-testid="editable" contentEditable suppressContentEditableWarning />
          <div data-testid="map-surface" tabIndex={0} />
        </div>
      )
    }

    const { rerender } = render(<Harness />)

    const inputEl = screen.getByTestId('text-input')
    const textareaEl = screen.getByTestId('text-area')
    const editableEl = screen.getByTestId('editable')
    const surfaceEl = screen.getByTestId('map-surface')

    expect(isTextInputTarget(inputEl)).toBe(true)
    expect(isTextInputTarget(textareaEl)).toBe(true)
    expect(isTextInputTarget(editableEl)).toBe(true)
    expect(isTextInputTarget(surfaceEl)).toBe(false)

    // Typing arrows / Enter / Escape inside text controls must NOT trigger map navigation
    fireEvent.keyDown(inputEl, { key: 'ArrowRight' })
    fireEvent.keyDown(inputEl, { key: 'Enter' })
    fireEvent.keyDown(textareaEl, { key: 'ArrowDown' })
    fireEvent.keyDown(editableEl, { key: 'Escape' })
    expect(onFocusNode).not.toHaveBeenCalled()
    expect(onOpenNode).not.toHaveBeenCalled()

    // On map surface, shortcuts work cleanly
    fireEvent.keyDown(surfaceEl, { key: 'ArrowRight' })
    expect(onFocusNode).toHaveBeenCalledWith(ids.idRe)

    fireEvent.keyDown(surfaceEl, { key: 'Enter' })
    expect(onOpenNode).toHaveBeenCalledWith(ids.idPwn)

    // When disabled (e.g. dialog open), shortcuts are suppressed everywhere
    onFocusNode.mockClear()
    onOpenNode.mockClear()
    rerender(<Harness disabled />)
    fireEvent.keyDown(surfaceEl, { key: 'ArrowDown' })
    fireEvent.keyDown(surfaceEl, { key: 'Enter' })
    expect(onFocusNode).not.toHaveBeenCalled()
    expect(onOpenNode).not.toHaveBeenCalled()
  })

  it('connects MapRoute to WorkspaceStore for empty-state creation, Home ("__root__") route opening, and breadcrumb/keyboard navigation', async () => {
    const store = createWorkspaceStore({
      storage: createInMemoryStorageAdapter(),
      now: () => '2026-11-26T10:00:00Z',
    })
    await store.getState().hydrate()

    render(
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

    // Empty state -> create first node via store
    expect(screen.getByTestId('map-empty-state')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('create-first-node'))
    fireEvent.change(screen.getByTestId('create-first-node-input'), { target: { value: 'PWN' } })
    fireEvent.click(screen.getByTestId('create-first-node-submit'))

    await waitFor(() => {
      expect(Object.keys(store.getState().tree.nodes)).toHaveLength(1)
    })

    // Newly created node is focused and breadcrumb shows Home > PWN
    await waitFor(() => {
      const crumbs = screen.getAllByTestId('map-breadcrumb-item')
      expect(crumbs.map((b) => b.textContent)).toEqual(['Home', 'PWN'])
    })

    // Click Home breadcrumb -> focuses __root__, Enter opens Home page (/n/__root__)
    fireEvent.click(screen.getAllByTestId('map-breadcrumb-item')[0]!)
    await waitFor(() => {
      expect(screen.getAllByTestId('map-breadcrumb-item')).toHaveLength(1)
    })

    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('opened-page-id').textContent).toBe(VIRTUAL_ROOT_ID)
    })

    store.getState().dispose()
  })
})
