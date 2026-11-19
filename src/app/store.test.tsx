import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import fc from 'fast-check'
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
  collectDirtyFiles,
  createBrowserTabLockCoordinator,
  createFakeTabLockRegistry,
  createKnovitesDatabase,
  getEffectiveDeletes,
  getMovedBasePaths,
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
      basePath: null,
      blob: new Uint8Array([1, 2, 3, 4]),
      sha: 'assetsha',
      dirty: 0,
      deletedAt: 0,
    })

    // Delete subtree -> immediately written to IndexedDB with deletedAt > 0
    const deleted = await store.getState().deleteNode(parent.nodeId)
    expect(deleted.ok).toBe(true)
    expect(store.getState().storageError).toBeNull()
    expect(store.getState().tree.nodes[parent.nodeId]).toBeUndefined()
    expect(store.getState().tree.nodes[child.nodeId]).toBeUndefined()
    expect(store.getState().pendingUndoDelete?.rootNodeId).toBe(parent.nodeId)
    expect((await db.nodes.get(child.nodeId))?.deletedAt).toBeGreaterThan(0)
    expect((await db.canvases.get(child.nodeId))?.deletedAt).toBeGreaterThan(0)
    expect(
      (await db.assets.get([child.nodeId, 'assets/abcdef0123456789.png']))?.deletedAt,
    ).toBeGreaterThan(0)
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
    expect((await db.nodes.get(child.nodeId))?.deletedAt).toBe(0)
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

  it('keeps initial edit, blocks subsequent mutations during storageError, and recovers via Retry button (FR-LOC-04)', async () => {
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-retry-test', { indexedDB, IDBKeyRange })
    const baseAdapter = createDexieWorkspaceAdapter(db)

    let shouldFailWrite = true
    const applyChangesetSpy = vi.fn(async (cs, options) => {
      if (shouldFailWrite) {
        throw new Error('QuotaExceededError: storage quota exceeded')
      }
      return baseAdapter.applyChangeset(cs, options)
    })

    const failingThenRecoveringAdapter: WorkspaceStorageAdapter = {
      ...baseAdapter,
      applyChangeset: applyChangesetSpy,
    }

    const store = createWorkspaceStore({
      storage: failingThenRecoveringAdapter,
      now: createDeterministicClock(),
    })
    await store.getState().hydrate()

    // First write fails: edit stays in memory, storageError & hasUnsavedChanges are set
    const firstEdit = await store.getState().createNode({ title: 'Important Note', parentId: null })
    expect(firstEdit.ok).toBe(true)
    if (!firstEdit.ok) return

    expect(store.getState().tree.nodes[firstEdit.nodeId]?.meta.title).toBe('Important Note')
    expect(store.getState().hasUnsavedChanges).toBe(true)
    expect(store.getState().storageError?.message).toContain('QuotaExceededError')
    expect(applyChangesetSpy).toHaveBeenCalledTimes(1)

    // Subsequent mutations MUST be rejected while storageError is active (no new Changeset computed)
    const secondCreate = await store
      .getState()
      .createNode({ title: 'Should Be Blocked', parentId: null })
    expect(secondCreate.ok).toBe(false)
    if (!secondCreate.ok) expect(secondCreate.reason).toBe('storage_error')

    const blockedRename = await store
      .getState()
      .renameNode({ nodeId: firstEdit.nodeId, title: 'Blocked Rename' })
    expect(blockedRename.ok).toBe(false)
    if (!blockedRename.ok) expect(blockedRename.reason).toBe('storage_error')

    const blockedMove = await store
      .getState()
      .moveNode({ nodeId: firstEdit.nodeId, newParentId: null })
    expect(blockedMove.ok).toBe(false)
    if (!blockedMove.ok) expect(blockedMove.reason).toBe('storage_error')

    const blockedReorder = await store
      .getState()
      .reorderNode({ nodeId: firstEdit.nodeId, direction: 'earlier' })
    expect(blockedReorder.ok).toBe(false)
    if (!blockedReorder.ok) expect(blockedReorder.reason).toBe('storage_error')

    const blockedDelete = await store.getState().deleteNode(firstEdit.nodeId)
    expect(blockedDelete.ok).toBe(false)
    if (!blockedDelete.ok) expect(blockedDelete.reason).toBe('storage_error')

    // Neither tree nor IndexedDB received a second mutation
    expect(Object.keys(store.getState().tree.nodes)).toEqual([firstEdit.nodeId])
    expect(applyChangesetSpy).toHaveBeenCalledTimes(1)

    render(<App workspaceStore={store} />)
    const banner = await screen.findByTestId('storage-error-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner.textContent).toContain('Do not close this tab until Retry succeeds')
    expect(banner.textContent).toContain('QuotaExceededError')

    // Storage recovers -> user clicks Retry button -> pending Changeset is flushed and mutations reopen
    shouldFailWrite = false
    fireEvent.click(screen.getByTestId('retry-storage-button'))

    await waitFor(() => {
      expect(store.getState().storageError).toBeNull()
      expect(store.getState().hasUnsavedChanges).toBe(false)
      expect(screen.queryByTestId('storage-error-banner')).toBeNull()
    })
    expect(applyChangesetSpy).toHaveBeenCalledTimes(2)
    expect((await db.nodes.get(firstEdit.nodeId))?.meta.title).toBe('Important Note')

    const thirdCreate = await store
      .getState()
      .createNode({ title: 'After Recovery', parentId: null })
    expect(thirdCreate.ok).toBe(true)

    store.getState().dispose()
    db.close()
  })

  it('assigns a unique slug when Undo restores a node whose path was taken by a new node during the 10s window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-undo-collision-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const origParent = await store.getState().createNode({ title: 'PWN', parentId: null })
    expect(origParent.ok).toBe(true)
    if (!origParent.ok) return

    const origChild = await store
      .getState()
      .createNode({ title: 'Stack', parentId: origParent.nodeId })
    expect(origChild.ok).toBe(true)
    if (!origChild.ok) return

    const customCanvas = serializeCanvasJson({
      schema: 1,
      elements: {
        e_deadbeef: {
          type: 'text',
          x: 10,
          y: 20,
          w: 200,
          z: 'a0',
          style: { bg: null, border: null },
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original Stack' }] }],
          },
          updatedAt: '2026-11-19T10:00:00Z',
        },
      },
    })
    await db.canvases.update(origChild.nodeId, {
      rawJson: customCanvas,
      doc: JSON.parse(customCanvas),
    })

    // Soft-delete 'PWN' (path 'pwn' + child 'pwn/stack')
    expect((await store.getState().deleteNode(origParent.nodeId)).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)

    // Create a brand new node titled 'PWN' while the 10s Undo window is still open
    const replacement = await store.getState().createNode({ title: 'PWN', parentId: null })
    expect(replacement.ok).toBe(true)
    if (!replacement.ok) return
    expect(store.getState().tree.nodes[replacement.nodeId]?.path).toBe('pwn')
    expect(store.getState().pendingUndoDelete?.rootNodeId).toBe(origParent.nodeId)

    // Undo within 10s window: must NOT collide at 'pwn', must give restored root a unique slug 'pwn-2'
    await vi.advanceTimersByTimeAsync(2000)
    const undone = await store.getState().undoDelete()
    expect(undone).toBe(true)

    const allNodes = Object.values(store.getState().tree.nodes)
    const allPaths = allNodes.map((n) => n.path).sort()
    expect(allPaths).toEqual(['pwn', 'pwn-2', 'pwn-2/stack'])
    expect(new Set(allPaths).size).toBe(allPaths.length)
    expect(store.getState().tree.nodes[replacement.nodeId]?.path).toBe('pwn')
    expect(store.getState().tree.nodes[origParent.nodeId]?.path).toBe('pwn-2')
    expect(store.getState().tree.nodes[origChild.nodeId]?.path).toBe('pwn-2/stack')
    expect((await db.canvases.get(origChild.nodeId))?.path).toBe('pwn-2/stack')
    expect((await db.canvases.get(origChild.nodeId))?.rawJson).toBe(customCanvas)

    store.getState().dispose()
    db.close()

    // Reloading from IndexedDB confirms zero duplicate-path issues and all 3 nodes intact
    const db2 = createKnovitesDatabase('store-undo-collision-test', { indexedDB, IDBKeyRange })
    const store2 = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db2),
      now: createDeterministicClock('2026-11-19T11:00:00Z'),
    })
    await store2.getState().hydrate()
    expect(store2.getState().issues).toEqual([])
    expect(Object.keys(store2.getState().tree.nodes)).toHaveLength(3)
    store2.getState().dispose()
    db2.close()
  })

  it('records all finalized paths in pendingDeletes and filters out re-created active paths in getEffectiveDeletes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-effective-deletes-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const origPwn = await store.getState().createNode({ title: 'PWN', parentId: null })
    expect(origPwn.ok).toBe(true)
    if (!origPwn.ok) return

    const origStack = await store
      .getState()
      .createNode({ title: 'Stack', parentId: origPwn.nodeId })
    expect(origStack.ok).toBe(true)
    if (!origStack.ok) return

    await saveAsset(db, {
      nodeId: origStack.nodeId,
      path: 'assets/1122334455667788.png',
      basePath: null,
      blob: new Uint8Array([1, 2, 3]),
      sha: 'stackassetsha',
      dirty: 0,
      deletedAt: 0,
    })

    // Soft-delete PWN (pwn + pwn/stack + stack asset)
    expect((await store.getState().deleteNode(origPwn.nodeId)).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)

    // Recreate a new node at path 'pwn' within the 10-second Undo window
    const newPwn = await store.getState().createNode({ title: 'PWN', parentId: null })
    expect(newPwn.ok).toBe(true)

    // Let the 10-second window expire without Undo -> finalizes deleted subtree into pendingDeletes
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_TIMEOUT_MS)
    await vi.waitFor(() => {
      expect(store.getState().pendingUndoDelete).toBeNull()
    })

    // Raw pendingDeletes MUST retain ALL finalized paths of the deleted subtree
    const rawDeletes = await getPendingDeletes(db)
    expect(rawDeletes.map((d) => d.path)).toEqual([
      'pwn/canvas.json',
      'pwn/node.json',
      'pwn/stack/assets/1122334455667788.png',
      'pwn/stack/canvas.json',
      'pwn/stack/node.json',
    ])

    // Effective deletes MUST keep pwn/stack/* and exclude re-created pwn/node.json & pwn/canvas.json
    const effectiveDeletes = await getEffectiveDeletes(db)
    expect(effectiveDeletes.map((d) => d.path)).toEqual([
      'pwn/stack/assets/1122334455667788.png',
      'pwn/stack/canvas.json',
      'pwn/stack/node.json',
    ])

    store.getState().dispose()
    db.close()
  })

  it('finalizes the first soft-deleted node into pendingDeletes when a second node is deleted within the 10s window and undoes the second delete without data loss', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-double-delete-undo-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const cryptoNode = await store.getState().createNode({ title: 'Crypto', parentId: null })
    const webNode = await store.getState().createNode({ title: 'Web', parentId: null })
    const keepNode = await store.getState().createNode({ title: 'Forensics', parentId: null })
    expect(cryptoNode.ok && webNode.ok && keepNode.ok).toBe(true)
    if (!cryptoNode.ok || !webNode.ok || !keepNode.ok) return

    // Delete #1 ('Crypto'), then 3s later delete #2 ('Web') within the 10s Undo window
    expect((await store.getState().deleteNode(cryptoNode.nodeId)).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)

    expect((await store.getState().deleteNode(webNode.nodeId)).ok).toBe(true)
    expect(store.getState().pendingUndoDelete?.rootNodeId).toBe(webNode.nodeId)

    // Delete #1 is finalized cleanly to pendingDeletes when Delete #2 supersedes the Undo slot
    expect((await getPendingDeletes(db)).map((d) => d.path)).toEqual([
      'crypto/canvas.json',
      'crypto/node.json',
    ])

    // Undo restores Delete #2 ('Web') cleanly while preserving 'Forensics' and Crypto's pending delete
    await vi.advanceTimersByTimeAsync(2000)
    expect(await store.getState().undoDelete()).toBe(true)
    expect(store.getState().pendingUndoDelete).toBeNull()
    expect(store.getState().tree.nodes[webNode.nodeId]?.meta.title).toBe('Web')
    expect(store.getState().tree.nodes[keepNode.nodeId]?.meta.title).toBe('Forensics')
    expect(store.getState().tree.nodes[cryptoNode.nodeId]).toBeUndefined()
    expect((await getEffectiveDeletes(db)).map((d) => d.path)).toEqual([
      'crypto/canvas.json',
      'crypto/node.json',
    ])

    store.getState().dispose()
    db.close()
  })

  it('restores soft-deleted child under moved parent at new path, or to root with unique slug if parent was deleted, returning restore details', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-parent-moved-undo-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const pwn = await store.getState().createNode({ title: 'PWN', parentId: null })
    const archive = await store.getState().createNode({ title: 'Archive', parentId: null })
    const rootRop = await store.getState().createNode({ title: 'ROP', parentId: null })
    expect(pwn.ok && archive.ok && rootRop.ok).toBe(true)
    if (!pwn.ok || !archive.ok || !rootRop.ok) return

    const childRop = await store.getState().createNode({ title: 'ROP', parentId: pwn.nodeId })
    expect(childRop.ok).toBe(true)
    if (!childRop.ok) return

    const gadget = await store.getState().createNode({ title: 'Gadget', parentId: childRop.nodeId })
    expect(gadget.ok).toBe(true)
    if (!gadget.ok) return

    // Simulate childRop was previously synced at 'pwn/rop'
    await db.nodes.update(childRop.nodeId, { baseBlobSha: 'sha-rop', basePath: 'pwn/rop' })
    await db.nodes.update(gadget.nodeId, {
      baseBlobSha: 'sha-gadget',
      basePath: 'pwn/rop/gadget',
    })

    // Case 1: soft-delete 'pwn/rop', move parent 'pwn' -> 'archive/pwn', then Undo
    expect((await store.getState().deleteNode(childRop.nodeId)).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)

    const movedParent = await store
      .getState()
      .moveNode({ nodeId: pwn.nodeId, newParentId: archive.nodeId })
    expect(movedParent.ok).toBe(true)
    expect(store.getState().tree.nodes[pwn.nodeId]?.path).toBe('archive/pwn')

    expect(await store.getState().undoDelete()).toBe(true)
    // Parent still exists by ID -> child restores under moved parent at 'archive/pwn/rop'
    expect(store.getState().tree.nodes[childRop.nodeId]?.parentId).toBe(pwn.nodeId)
    expect(store.getState().tree.nodes[childRop.nodeId]?.path).toBe('archive/pwn/rop')
    expect(store.getState().tree.nodes[gadget.nodeId]?.path).toBe('archive/pwn/rop/gadget')
    expect(store.getState().lastUndoResult).toEqual({
      restored: true,
      rootNodeId: childRop.nodeId,
      oldPath: 'pwn/rop',
      restoredPath: 'archive/pwn/rop',
      parentId: pwn.nodeId,
      promotedToRoot: false,
      slugChanged: false,
      parentPathChanged: true,
    })
    expect((await getEffectiveDeletes(db)).map((d) => d.path)).toEqual(
      expect.arrayContaining(['pwn/rop/node.json', 'pwn/rop/gadget/node.json']),
    )

    // Case 2: parent is missing (deleted) when child subtree Undo executes -> promotes to root with unique slug 'rop-2'
    const folder = await store.getState().createNode({ title: 'Folder', parentId: null })
    expect(folder.ok).toBe(true)
    if (!folder.ok) return
    const leafRop = await store.getState().createNode({ title: 'ROP', parentId: folder.nodeId })
    expect(leafRop.ok).toBe(true)
    if (!leafRop.ok) return

    expect((await store.getState().deleteNode(leafRop.nodeId)).ok).toBe(true)
    // Simulate parent no longer present in active DB before Undo executes
    await db.nodes.delete(folder.nodeId)

    expect(await store.getState().undoDelete()).toBe(true)
    expect(store.getState().tree.nodes[leafRop.nodeId]?.parentId).toBeNull()
    expect(store.getState().tree.nodes[leafRop.nodeId]?.path).toBe('rop-2')
    expect(store.getState().lastUndoResult).toEqual({
      restored: true,
      rootNodeId: leafRop.nodeId,
      oldPath: 'folder/rop',
      restoredPath: 'rop-2',
      parentId: null,
      promotedToRoot: true,
      slugChanged: true,
      parentPathChanged: false,
    })
    expect(store.getState().issues).toEqual([])

    store.getState().dispose()
    db.close()
  })

  it('dismisses first Undo toast when a second delete finalizes it and shows relocation toast on Undo', async () => {
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-undo-toast-lifecycle-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
    })

    await store.getState().hydrate()
    const cryptoNode = await store.getState().createNode({ title: 'Crypto', parentId: null })
    const webNode = await store.getState().createNode({ title: 'Web', parentId: null })
    expect(cryptoNode.ok && webNode.ok).toBe(true)
    if (!cryptoNode.ok || !webNode.ok) return

    render(<App workspaceStore={store} />)

    // Delete #1 -> shows Undo toast for Crypto
    expect((await store.getState().deleteNode(cryptoNode.nodeId)).ok).toBe(true)
    expect(await screen.findByText('Deleted "Crypto"')).toBeInTheDocument()

    // Delete #2 -> finalizes #1 and MUST dismiss Crypto's Undo toast immediately
    expect((await store.getState().deleteNode(webNode.nodeId)).ok).toBe(true)
    await waitFor(() => {
      expect(screen.queryByText('Deleted "Crypto"')).toBeNull()
      expect(screen.getByText('Deleted "Web"')).toBeInTheDocument()
    })

    // Occupy 'web' while Undo window is open, then Undo -> relocation toast shown
    const replacementWeb = await store.getState().createNode({ title: 'Web', parentId: null })
    expect(replacementWeb.ok).toBe(true)
    expect(await store.getState().undoDelete()).toBe(true)

    await waitFor(() => {
      expect(screen.queryByText('Deleted "Web"')).toBeNull()
      expect(screen.getByText('Restored to "web-2"')).toBeInTheDocument()
    })

    store.getState().dispose()
    db.close()
  })

  it('model-based (fast-check): random sequences of create, rename, move, reorder, delete, undo, and finalize preserve remote snapshot invariants', async () => {
    type SimCmd =
      | { kind: 'create'; parentChoice: number; titleChoice: number }
      | { kind: 'rename'; targetChoice: number; titleChoice: number }
      | { kind: 'move'; targetChoice: number; parentChoice: number }
      | { kind: 'reorder'; targetChoice: number; direction: 'earlier' | 'later' }
      | { kind: 'delete'; targetChoice: number }
      | { kind: 'undo' }
      | { kind: 'finalize' }

    const cmdArb: fc.Arbitrary<SimCmd> = fc.oneof(
      fc.record({
        kind: fc.constant('create' as const),
        parentChoice: fc.nat(20),
        titleChoice: fc.nat(10),
      }),
      fc.record({
        kind: fc.constant('rename' as const),
        targetChoice: fc.nat(20),
        titleChoice: fc.nat(10),
      }),
      fc.record({
        kind: fc.constant('move' as const),
        targetChoice: fc.nat(20),
        parentChoice: fc.nat(20),
      }),
      fc.record({
        kind: fc.constant('reorder' as const),
        targetChoice: fc.nat(20),
        direction: fc.constantFrom('earlier' as const, 'later' as const),
      }),
      fc.record({
        kind: fc.constant('delete' as const),
        targetChoice: fc.nat(20),
      }),
      fc.record({ kind: fc.constant('undo' as const) }),
      fc.record({ kind: fc.constant('finalize' as const) }),
    )

    const TITLES = ['PWN', 'ROP', 'Gadget', 'Heap', 'Kernel', 'Crypto', 'Reverse', 'Notes']

    let runIdx = 0
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 5, maxLength: 24 }), async (cmds) => {
        runIdx += 1
        const indexedDB = new IDBFactory()
        const db = createKnovitesDatabase(`store-model-check-${runIdx}`, {
          indexedDB,
          IDBKeyRange,
        })
        const seedClock = createDeterministicClock('2026-11-19T14:00:00Z')
        let idCounter = 0
        const generateId = () => {
          idCounter += 1
          const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
          let v = idCounter
          let suffix = ''
          for (let i = 0; i < 10; i += 1) {
            suffix = crockford[v % 32]! + suffix
            v = Math.floor(v / 32)
          }
          return `01KN0V1TE5000000${suffix}`
        }

        const initialStore = createWorkspaceStore({
          storage: createDexieWorkspaceAdapter(db),
          now: seedClock,
          generateId,
        })
        await initialStore.getState().hydrate()

        // Seed 5 initial nodes across 3 levels (including an asset and extraFile)
        const nPwn = await initialStore.getState().createNode({ title: 'PWN', parentId: null })
        const nRe = await initialStore.getState().createNode({ title: 'RE', parentId: null })
        const nCrypto = await initialStore
          .getState()
          .createNode({ title: 'Crypto', parentId: null })
        if (!nPwn.ok || !nRe.ok || !nCrypto.ok) throw new Error('Seed root failed')
        const nRop = await initialStore
          .getState()
          .createNode({ title: 'ROP', parentId: nPwn.nodeId })
        if (!nRop.ok) throw new Error('Seed child failed')
        const nGadget = await initialStore
          .getState()
          .createNode({ title: 'Gadget', parentId: nRop.nodeId })
        if (!nGadget.ok) throw new Error('Seed grandchild failed')

        await saveAsset(db, {
          nodeId: nRop.nodeId,
          path: 'assets/0102030405060708.png',
          basePath: 'pwn/rop/assets/0102030405060708.png',
          blob: new Uint8Array([1, 2, 3, 4]),
          sha: 'asset-sha-1',
          dirty: 0,
          deletedAt: 0,
        })

        // Mark all initial rows as synced with baseBlobSha and basePath = path
        const seedNodes = await db.nodes.toArray()
        for (const rec of seedNodes) {
          await db.nodes.update(rec.id, {
            dirty: 0,
            baseBlobSha: `node-sha-${rec.id}`,
            basePath: rec.path,
            extraFiles: rec.id === nRop.nodeId ? ['exploit.py'] : [],
          })
        }
        const seedCanvases = await db.canvases.toArray()
        for (const rec of seedCanvases) {
          await db.canvases.update(rec.nodeId, {
            dirty: 0,
            baseBlobSha: `canvas-sha-${rec.nodeId}`,
            basePath: rec.path,
          })
        }
        initialStore.getState().dispose()

        // Snapshot initial remote baseline `pathBase`
        interface RemoteEntry {
          kind: 'node' | 'canvas' | 'asset' | 'extra'
          nodeId: string
        }
        const pathBase = new Map<string, RemoteEntry>()
        for (const rec of await db.nodes.toArray()) {
          pathBase.set(`${rec.path}/node.json`, { kind: 'node', nodeId: rec.id })
          pathBase.set(`${rec.path}/canvas.json`, { kind: 'canvas', nodeId: rec.id })
          for (const extra of rec.extraFiles) {
            pathBase.set(`${rec.path}/${extra}`, { kind: 'extra', nodeId: rec.id })
          }
        }
        for (const asset of await db.assets.toArray()) {
          if (asset.basePath) {
            pathBase.set(asset.basePath, { kind: 'asset', nodeId: asset.nodeId })
          }
        }

        // Re-hydrate live store from synced DB and execute random command sequence
        const store = createWorkspaceStore({
          storage: createDexieWorkspaceAdapter(db),
          now: seedClock,
          generateId,
        })
        await store.getState().hydrate()
        const seenNodeIds = new Set(Object.keys(store.getState().tree.nodes))

        for (const cmd of cmds) {
          const activeIds = Object.keys(store.getState().tree.nodes).sort()
          if (cmd.kind === 'create') {
            const parentId =
              activeIds.length === 0 || cmd.parentChoice % 3 === 0
                ? null
                : activeIds[cmd.parentChoice % activeIds.length]!
            const res = await store.getState().createNode({
              title: TITLES[cmd.titleChoice % TITLES.length]!,
              parentId,
            })
            if (res.ok) seenNodeIds.add(res.nodeId)
          } else if (cmd.kind === 'rename' && activeIds.length > 0) {
            const nodeId = activeIds[cmd.targetChoice % activeIds.length]!
            await store.getState().renameNode({
              nodeId,
              title: TITLES[cmd.titleChoice % TITLES.length]!,
            })
          } else if (cmd.kind === 'move' && activeIds.length > 0) {
            const nodeId = activeIds[cmd.targetChoice % activeIds.length]!
            const newParentId =
              cmd.parentChoice % 4 === 0 ? null : activeIds[cmd.parentChoice % activeIds.length]!
            await store.getState().moveNode({ nodeId, newParentId })
          } else if (cmd.kind === 'reorder' && activeIds.length > 0) {
            const nodeId = activeIds[cmd.targetChoice % activeIds.length]!
            await store.getState().reorderNode({ nodeId, direction: cmd.direction })
          } else if (cmd.kind === 'delete' && activeIds.length > 0) {
            const nodeId = activeIds[cmd.targetChoice % activeIds.length]!
            await store.getState().deleteNode(nodeId)
          } else if (cmd.kind === 'undo') {
            await store.getState().undoDelete()
          } else if (cmd.kind === 'finalize') {
            await store.getState().finalizePendingDelete()
          }
        }

        await store.getState().finalizePendingDelete()

        // Simulate remote commit snapshot:
        // remoteAkhir = (pathBase - effectiveDeletes - pathLamaYangPindah) + upserts
        // Note: effectiveDeletes MUST already contain all deleted & moved synced basePaths!
        const effectiveDeletes = await getEffectiveDeletes(db)
        const movedBasePaths = await getMovedBasePaths(db)
        const effectiveDeletePaths = new Set(effectiveDeletes.map((d) => d.path))
        for (const movedOldPath of movedBasePaths) {
          expect(effectiveDeletePaths.has(movedOldPath)).toBe(true)
        }

        const dirty = await collectDirtyFiles(db)
        const activeDbNodes = await db.nodes.where('deletedAt').equals(0).toArray()

        const remoteAkhir = new Map(pathBase)
        for (const del of effectiveDeletes) {
          remoteAkhir.delete(del.path)
        }
        for (const n of dirty.nodes) {
          remoteAkhir.set(n.path, { kind: 'node', nodeId: n.nodeId })
        }
        for (const c of dirty.canvases) {
          remoteAkhir.set(c.path, { kind: 'canvas', nodeId: c.nodeId })
        }
        for (const a of dirty.assets) {
          remoteAkhir.set(a.path, { kind: 'asset', nodeId: a.nodeId })
        }
        for (const n of activeDbNodes) {
          if (n.basePath !== null && n.basePath !== n.path) {
            for (const extra of n.extraFiles) {
              remoteAkhir.set(`${n.path}/${extra}`, { kind: 'extra', nodeId: n.id })
            }
          }
        }

        const finalTreeNodes = store.getState().tree.nodes

        // Invariant 1: Every active node ID appears at EXACTLY ONE path matching node.path
        for (const activeNode of Object.values(finalTreeNodes)) {
          const matchingNodeFiles = [...remoteAkhir.entries()].filter(
            ([, entry]) => entry.kind === 'node' && entry.nodeId === activeNode.id,
          )
          expect(matchingNodeFiles).toHaveLength(1)
          expect(matchingNodeFiles[0]?.[0]).toBe(`${activeNode.path}/node.json`)
          expect(remoteAkhir.get(`${activeNode.path}/canvas.json`)?.nodeId).toBe(activeNode.id)
          for (const assetRel of activeNode.assets) {
            expect(remoteAkhir.get(`${activeNode.path}/${assetRel}`)?.nodeId).toBe(activeNode.id)
          }
          for (const extraRel of activeNode.extraFiles) {
            expect(remoteAkhir.get(`${activeNode.path}/${extraRel}`)?.nodeId).toBe(activeNode.id)
          }
        }

        // Invariant 2 & 3: Every remote path belongs to an existing active node at its current path
        // (no deleted node file and no stale pre-move path remains)
        const activeIdsSet = new Set(Object.keys(finalTreeNodes))
        for (const [remotePath, entry] of remoteAkhir.entries()) {
          expect(seenNodeIds.has(entry.nodeId)).toBe(true)
          expect(activeIdsSet.has(entry.nodeId)).toBe(true)
          const activeNode = finalTreeNodes[entry.nodeId]!
          expect(remotePath.startsWith(`${activeNode.path}/`)).toBe(true)
        }

        store.getState().dispose()
        await db.close()
      }),
      { numRuns: 35 },
    )
  })

  it('displays single-session notice when navigator.locks is unavailable while permitting local edits', async () => {
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('store-no-locks-test', { indexedDB, IDBKeyRange })
    const coordinator = createBrowserTabLockCoordinator({ locks: undefined })
    expect(coordinator.isSupported()).toBe(false)

    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: createDeterministicClock(),
      initialLockSupported: coordinator.isSupported(),
    })

    const role = await coordinator.acquire((nextRole) => {
      store.getState().setReadOnlyTab(nextRole === 'readonly')
    })
    expect(role).toBe('writer')
    await store.getState().hydrate()

    render(<App workspaceStore={store} />)
    const notice = await screen.findByTestId('locks-unsupported-banner')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice.textContent).toContain('Web Locks unavailable')

    // Local editing still works in single-session mode
    const created = await store.getState().createNode({ title: 'Solo Note', parentId: null })
    expect(created.ok).toBe(true)

    await coordinator.release()
    store.getState().dispose()
    db.close()
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
