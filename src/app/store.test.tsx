import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import {
  UNDO_DELETE_TIMEOUT_MS,
  createDexieWorkspaceAdapter,
  createUnavailableStorageAdapter,
  createWorkspaceStore,
  type WorkspaceStorageAdapter,
} from '@/app/store'
import { serializeCanvasJson } from '@/domain/serialize'
import {
  createFakeTabLockRegistry,
  createKnovitesDatabase,
  getPendingDeletes,
  loadTreeBuildEntries,
  saveAsset,
} from '@/storage'

function createDeterministicClock(startIso = '2026-11-19T10:00:00Z') {
  let step = 0
  const baseMs = Date.parse(startIso)
  return () => {
    const iso = new Date(baseMs + step * 1000).toISOString().replace('.000Z', 'Z')
    step += 1
    return iso
  }
}

describe('app/store (Zustand + immer + IndexedDB persistence) [T2.2]', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates from IndexedDB via buildTree and persists create, rename, move, and reorder across reload', async () => {
    const indexedDB = new IDBFactory()
    const db1 = createKnovitesDatabase('store-crud-test', { indexedDB, IDBKeyRange })
    const store1 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db1),
      now: createDeterministicClock(),
    })

    await store1.getState().hydrate()
    expect(store1.getState().hydrated).toBe(true)
    expect(store1.getState().tree.rootIds).toEqual([])

    const pwn = await store1.getState().createNode({ title: 'PWN', parentId: null })
    expect(pwn.ok).toBe(true)
    const re = await store1.getState().createNode({ title: 'RE', parentId: null })
    expect(re.ok).toBe(true)
    if (!pwn.ok || !re.ok) return

    const rop = await store1.getState().createNode({ title: 'ROP', parentId: pwn.nodeId })
    expect(rop.ok).toBe(true)
    if (!rop.ok) return

    await store1.getState().renameNode({ nodeId: pwn.nodeId, title: 'Binary PWN' })
    await store1.getState().moveNode({ nodeId: rop.nodeId, newParentId: re.nodeId })
    await store1.getState().reorderNode({ nodeId: re.nodeId, direction: 'earlier' })

    expect(store1.getState().tree.rootIds).toEqual([re.nodeId, pwn.nodeId])
    expect(store1.getState().tree.nodes[rop.nodeId]?.path).toBe('re/rop')
    expect(store1.getState().hasUnsavedChanges).toBe(false)
    expect(store1.getState().storageError).toBeNull()

    store1.getState().dispose()
    db1.close()

    // Simulate reload with fresh DB wrapper and fresh store against same IndexedDB
    const db2 = createKnovitesDatabase('store-crud-test', { indexedDB, IDBKeyRange })
    const store2 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db2),
      now: createDeterministicClock(),
    })
    await store2.getState().hydrate()

    expect(store2.getState().tree.rootIds).toEqual([re.nodeId, pwn.nodeId])
    expect(store2.getState().tree.nodes[pwn.nodeId]?.meta.title).toBe('Binary PWN')
    expect(store2.getState().tree.nodes[pwn.nodeId]?.slug).toBe('pwn')
    expect(store2.getState().tree.nodes[rop.nodeId]?.path).toBe('re/rop')
    store2.getState().dispose()
    db2.close()
  })

  it('soft-deletes subtree immediately and restores entire subtree (nodes, canvas, assets) on Undo within 10 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-undo-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const parent = await store.getState().createNode({ title: 'PWN', parentId: null })
    expect(parent.ok).toBe(true)
    if (!parent.ok) return

    const child = await store.getState().createNode({ title: 'Stack', parentId: parent.nodeId })
    expect(child.ok).toBe(true)
    if (!child.ok) return

    // Seed custom canvas element + binary asset on child
    const customCanvas = serializeCanvasJson({
      schema: 1,
      elements: {
        e_12345678: {
          type: 'text',
          x: 20,
          y: 30,
          w: 240,
          z: 'a0',
          style: { bg: null, border: null },
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved note' }] }],
          },
          updatedAt: '2026-11-19T10:00:00Z',
        },
      },
    })
    await db.canvases.update(child.nodeId, {
      rawJson: customCanvas,
      doc: JSON.parse(customCanvas),
      baseBlobSha: 'canvassha',
    })
    await saveAsset(db, {
      nodeId: child.nodeId,
      path: 'assets/abcdef0123456789.png',
      blob: new Uint8Array([1, 2, 3, 4]),
      sha: 'assetsha',
      dirty: false,
      deletedAt: null,
    })

    // Delete subtree -> immediately written to IndexedDB with deletedAt !== null
    const deleted = await store.getState().deleteNode(parent.nodeId)
    expect(deleted.ok).toBe(true)
    expect(store.getState().storageError).toBeNull()
    expect(store.getState().tree.nodes[parent.nodeId]).toBeUndefined()
    expect(store.getState().tree.nodes[child.nodeId]).toBeUndefined()
    expect(store.getState().pendingUndoDelete?.rootNodeId).toBe(parent.nodeId)
    expect((await db.nodes.get(child.nodeId))?.deletedAt).not.toBeNull()
    expect((await db.canvases.get(child.nodeId))?.deletedAt).not.toBeNull()
    expect(
      (await db.assets.get([child.nodeId, 'assets/abcdef0123456789.png']))?.deletedAt,
    ).not.toBeNull()
    expect(await getPendingDeletes(db)).toEqual([])

    // Undo at t = 5s restores everything in memory AND IndexedDB
    await vi.advanceTimersByTimeAsync(5000)
    const undone = await store.getState().undoDelete()
    expect(undone).toBe(true)
    expect(store.getState().pendingUndoDelete).toBeNull()
    expect(store.getState().tree.nodes[parent.nodeId]).toBeDefined()
    expect(store.getState().tree.nodes[child.nodeId]?.assets).toEqual([
      'assets/abcdef0123456789.png',
    ])
    expect((await db.nodes.get(child.nodeId))?.deletedAt).toBeNull()
    expect((await db.canvases.get(child.nodeId))?.rawJson).toBe(customCanvas)
    expect(await getPendingDeletes(db)).toEqual([])

    // Delete again and wait full 10 seconds -> finalizes into pendingDeletes
    await store.getState().deleteNode(parent.nodeId)
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_TIMEOUT_MS)

    await vi.waitFor(() => {
      expect(store.getState().pendingUndoDelete).toBeNull()
    })
    expect(await loadTreeBuildEntries(db)).toEqual([])
    expect((await getPendingDeletes(db)).map((p) => p.path)).toEqual([
      'pwn/canvas.json',
      'pwn/node.json',
      'pwn/stack/assets/abcdef0123456789.png',
      'pwn/stack/canvas.json',
      'pwn/stack/node.json',
    ])

    store.getState().dispose()
    db.close()
  })

  it('finalizes in-flight soft-deleted subtree to pendingDeletes on reload within the 10-second window without losing data', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db1 = createKnovitesDatabase('store-crash-test', { indexedDB, IDBKeyRange })
    const store1 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db1),
      now: createDeterministicClock(),
    })

    await store1.getState().hydrate()
    expect(store1.getState().storageError).toBeNull()
    const root = await store1.getState().createNode({ title: 'Crypto', parentId: null })
    expect(root.ok).toBe(true)
    expect(store1.getState().storageError).toBeNull()
    if (!root.ok) return

    await store1.getState().deleteNode(root.nodeId)
    expect(store1.getState().storageError).toBeNull()
    // Tab closes at t = 3s before 10s timer fires
    await vi.advanceTimersByTimeAsync(3000)
    store1.getState().dispose()
    db1.close()

    // Reload: new store hydrates on same IndexedDB -> must finalize pending soft-delete
    const db2 = createKnovitesDatabase('store-crash-test', { indexedDB, IDBKeyRange })
    const store2 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db2),
      now: createDeterministicClock('2026-11-19T10:05:00Z'),
    })
    await store2.getState().hydrate()
    expect(store2.getState().storageError).toBeNull()

    expect(store2.getState().tree.nodes).toEqual({})
    expect(await db2.nodes.toArray()).toEqual([])
    expect((await getPendingDeletes(db2)).map((p) => p.path)).toEqual([
      'crypto/canvas.json',
      'crypto/node.json',
    ])
    store2.getState().dispose()
    db2.close()
  })

  it('keeps in-memory edits, marks unsaved state, and renders blocking banner when IndexedDB write fails (FR-LOC-04)', async () => {
    const failingAdapter: WorkspaceStorageAdapter = {
      loadEntries: async () => [],
      applyChangeset: async () => {
        throw new Error('QuotaExceededError: storage quota exceeded')
      },
      softDeleteSubtree: async () => {
        throw new Error('QuotaExceededError')
      },
      restoreSoftDeletedSubtree: async () => {},
      finalizeSoftDeletes: async () => {},
      appendErrorLog: async () => {},
    }

    const store = createWorkspaceStore({
      storage: failingAdapter,
      now: createDeterministicClock(),
    })
    await store.getState().hydrate()

    const created = await store.getState().createNode({ title: 'Important Note', parentId: null })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Edit MUST remain in memory, NOT discarded!
    expect(store.getState().tree.nodes[created.nodeId]?.meta.title).toBe('Important Note')
    expect(store.getState().hasUnsavedChanges).toBe(true)
    expect(store.getState().storageError?.message).toContain('QuotaExceededError')

    render(<App workspaceStore={store} />)
    const banner = await screen.findByTestId('storage-error-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner.textContent).toContain('Changes are kept in memory')
    expect(banner.textContent).toContain('QuotaExceededError')

    store.getState().dispose()
  })

  it('sets storageError and renders blocking banner when IndexedDB is unavailable during hydrate', async () => {
    const store = createWorkspaceStore({
      storage: createUnavailableStorageAdapter('IndexedDB disabled in private mode'),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    expect(store.getState().hydrated).toBe(true)
    expect(store.getState().storageError?.message).toContain('IndexedDB disabled')

    render(<App workspaceStore={store} />)
    const banner = await screen.findByTestId('storage-error-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner.textContent).toContain('IndexedDB disabled in private mode')
    store.getState().dispose()
  })

  it('blocks writes on non-leader read-only tab and transfers writer role cleanly on Take over (FR-LOC-05)', async () => {
    const indexedDB = new IDBFactory()
    const registry = createFakeTabLockRegistry()
    const lock1 = registry.createClient('tab-1')
    const lock2 = registry.createClient('tab-2')

    const db1 = createKnovitesDatabase('multi-tab-store-test', { indexedDB, IDBKeyRange })
    const db2 = createKnovitesDatabase('multi-tab-store-test', { indexedDB, IDBKeyRange })

    let store1Ref: ReturnType<typeof createWorkspaceStore> | null = null
    let store2Ref: ReturnType<typeof createWorkspaceStore> | null = null

    const store1 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db1),
      now: createDeterministicClock('2026-11-19T12:00:00Z'),
      onTakeOverWriter: async () => {
        await lock1.takeOver()
        await store1Ref?.getState().hydrate()
      },
    })
    store1Ref = store1

    const store2 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db2),
      now: createDeterministicClock('2026-11-19T12:01:00Z'),
      onTakeOverWriter: async () => {
        await lock2.takeOver()
        await store2Ref?.getState().hydrate()
      },
    })
    store2Ref = store2

    await lock1.acquire((role) => store1.getState().setReadOnlyTab(role === 'readonly'))
    await store1.getState().hydrate()
    const createdByTab1 = await store1.getState().createNode({ title: 'PWN', parentId: null })
    expect(createdByTab1.ok).toBe(true)
    if (!createdByTab1.ok) return

    // Second tab starts in read-only mode
    await lock2.acquire((role) => store2.getState().setReadOnlyTab(role === 'readonly'))
    await store2.getState().hydrate()
    expect(store2.getState().isReadOnlyTab).toBe(true)

    // Non-leader writes MUST be blocked cleanly
    const blockedCreate = await store2
      .getState()
      .createNode({ title: 'Blocked Node', parentId: null })
    expect(blockedCreate.ok).toBe(false)
    if (!blockedCreate.ok) expect(blockedCreate.reason).toBe('readonly_tab')

    const blockedRename = await store2
      .getState()
      .renameNode({ nodeId: createdByTab1.nodeId, title: 'Blocked Rename' })
    expect(blockedRename.ok).toBe(false)
    if (!blockedRename.ok) expect(blockedRename.reason).toBe('readonly_tab')

    const blockedDelete = await store2.getState().deleteNode(createdByTab1.nodeId)
    expect(blockedDelete.ok).toBe(false)
    if (!blockedDelete.ok) expect(blockedDelete.reason).toBe('readonly_tab')

    // IndexedDB must still hold only Tab 1's untouched 'PWN' node
    expect(store2.getState().tree.nodes[createdByTab1.nodeId]?.meta.title).toBe('PWN')

    render(<App workspaceStore={store2} />)
    expect(screen.getByTestId('readonly-tab-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('take-over-button'))

    await waitFor(() => {
      expect(store2.getState().isReadOnlyTab).toBe(false)
      expect(screen.queryByTestId('readonly-tab-banner')).toBeNull()
    })
    expect(store1.getState().isReadOnlyTab).toBe(true)

    // Former writer Tab 1 is now blocked; new writer Tab 2 succeeds
    const blockedAfterTakeOver = await store1
      .getState()
      .createNode({ title: 'Stale Write', parentId: null })
    expect(blockedAfterTakeOver.ok).toBe(false)
    if (!blockedAfterTakeOver.ok) expect(blockedAfterTakeOver.reason).toBe('readonly_tab')

    const allowedAfterTakeOver = await store2.getState().createNode({ title: 'RE', parentId: null })
    expect(allowedAfterTakeOver.ok).toBe(true)

    await lock1.release()
    await lock2.release()
    store1.getState().dispose()
    store2.getState().dispose()
    db1.close()
    db2.close()
  })
})
