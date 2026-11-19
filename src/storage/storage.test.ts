import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import {
  buildTree,
  createNode,
  deleteNode,
  moveNode,
  renameNode,
  type Changeset,
} from '@/domain/tree'
import {
  MAX_ERROR_LOG_ENTRIES,
  appendErrorLog,
  applyChangeset,
  applyDatabaseMigrations,
  collectDirtyFiles,
  createKnovitesDatabase,
  finalizeSoftDeletes,
  getErrorLogs,
  getPendingDeletes,
  loadTreeBuildEntries,
  restoreSoftDeletedSubtree,
  saveAsset,
  saveInvalidNode,
  softDeleteSubtree,
  type ErrorLogRecord,
} from '@/storage'

function makeUlid(n: number): string {
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let v = n
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = crockford[v % 32]! + suffix
    v = Math.floor(v / 32)
  }
  return `01KN0V1TE5000000${suffix}`
}

function makeTestDb(name = 'knovites-test') {
  const indexedDB = new IDBFactory()
  const db = createKnovitesDatabase(name, { indexedDB, IDBKeyRange })
  return { db, indexedDB }
}

describe('storage (Dexie repository & migrations) [T2.1]', () => {
  it('applies Changeset in a single atomic transaction and rolls back completely on mid-transaction failure', async () => {
    const { db } = makeTestDb()
    const now = '2026-11-19T09:00:00Z'

    let state = buildTree([]).state
    const c1 = createNode(state, {
      title: 'PWN',
      parentId: null,
      now,
      generateId: () => makeUlid(1),
    })
    expect(c1.ok).toBe(true)
    state = c1.state
    await applyChangeset(db, c1.changeset, { now })

    const c2 = createNode(state, {
      title: 'Stack',
      parentId: makeUlid(1),
      now,
      generateId: () => makeUlid(2),
    })
    expect(c2.ok).toBe(true)
    state = c2.state
    await applyChangeset(db, c2.changeset, { now })

    // Combined Changeset: delete pwn/stack/canvas.json, move pwn/stack -> stack-moved, upsert pwn/stack-moved/node.json
    const moved = moveNode(state, {
      nodeId: makeUlid(2),
      newParentId: null,
      now: '2026-11-19T09:05:00Z',
    })
    expect(moved.ok).toBe(true)

    const syntheticAtomicBatch: Changeset = {
      deletes: ['pwn/node.json'],
      moves: moved.changeset.moves,
      upserts: moved.changeset.upserts,
    }

    const beforeNodes = await db.nodes.toArray()
    const beforeCanvases = await db.canvases.toArray()
    const beforeDeletes = await db.pendingDeletes.toArray()

    // Inject failure right after 'moves' before 'upserts' completes
    await expect(
      applyChangeset(db, syntheticAtomicBatch, {
        now: '2026-11-19T09:06:00Z',
        onAfterStep: (step) => {
          if (step === 'moves') {
            throw new Error('Injected mid-transaction failure')
          }
        },
      }),
    ).rejects.toThrow('Injected mid-transaction failure')

    // All deletes and moves inside the failed transaction must be 100% rolled back
    expect(await db.nodes.toArray()).toEqual(beforeNodes)
    expect(await db.canvases.toArray()).toEqual(beforeCanvases)
    expect(await db.pendingDeletes.toArray()).toEqual(beforeDeletes)
    await db.close()
  })

  it('marks dirty flags on upserts/moves, updates path in place on move without duplicating rows, and populates pendingDeletes', async () => {
    const { db } = makeTestDb()
    const now = '2026-11-19T09:00:00Z'

    const cRoot = createNode(buildTree([]).state, {
      title: 'PWN',
      parentId: null,
      now,
      generateId: () => makeUlid(1),
    })
    const cChild = createNode(cRoot.state, {
      title: 'ROP',
      parentId: makeUlid(1),
      now,
      generateId: () => makeUlid(2),
    })
    const cTarget = createNode(cChild.state, {
      title: 'RE',
      parentId: null,
      now,
      generateId: () => makeUlid(3),
    })

    await applyChangeset(db, cRoot.changeset, { now })
    await applyChangeset(db, cChild.changeset, { now })
    await applyChangeset(db, cTarget.changeset, { now })

    expect((await db.nodes.get(makeUlid(1)))?.dirty).toBe(1)
    expect((await db.canvases.get(makeUlid(1)))?.dirty).toBe(1)

    // Attach an asset + extraFile to ROP and clear dirty flags to simulate synced state
    await saveAsset(db, {
      nodeId: makeUlid(2),
      path: 'assets/deadbeef12345678.png',
      blob: new Uint8Array([137, 80, 78, 71]),
      sha: 'assetsha1',
      dirty: 0,
      deletedAt: 0,
    })
    await db.nodes.update(makeUlid(2), {
      dirty: 0,
      baseBlobSha: 'nodesha2',
      extraFiles: ['exploit.py'],
    })
    await db.canvases.update(makeUlid(2), { dirty: 0, baseBlobSha: 'canvassha2' })

    // Re-load from storage -> buildTree -> rename & move ROP under RE
    const loadedEntries = await loadTreeBuildEntries(db)
    const built = buildTree(loadedEntries)
    expect(built.issues).toEqual([])
    expect(built.state.nodes[makeUlid(2)]?.assets).toEqual(['assets/deadbeef12345678.png'])
    expect(built.state.nodes[makeUlid(2)]?.extraFiles).toEqual(['exploit.py'])

    const moved = moveNode(built.state, {
      nodeId: makeUlid(2),
      newParentId: makeUlid(3),
      now: '2026-11-19T09:10:00Z',
    })
    expect(moved.ok).toBe(true)
    await applyChangeset(db, moved.changeset, { now: '2026-11-19T09:10:00Z' })

    // Move must update existing row in place (still 3 rows total, no duplicate row)
    const allNodes = await db.nodes.toArray()
    expect(allNodes).toHaveLength(3)

    const movedNode = await db.nodes.get(makeUlid(2))
    expect(movedNode?.path).toBe('re/rop')
    expect(movedNode?.parentId).toBe(makeUlid(3))
    expect(movedNode?.dirty).toBe(1)
    expect(movedNode?.extraFiles).toEqual(['exploit.py'])

    const movedCanvas = await db.canvases.get(makeUlid(2))
    expect(movedCanvas?.path).toBe('re/rop')
    expect(movedCanvas?.dirty).toBe(1)

    const movedAsset = await db.assets.get([makeUlid(2), 'assets/deadbeef12345678.png'])
    expect(movedAsset?.dirty).toBe(1)

    // Delete RE subtree (including RE + re/rop + canvas + asset + exploit.py)
    const renamed = renameNode(moved.state, {
      nodeId: makeUlid(3),
      title: 'Reverse',
      now: '2026-11-19T09:11:00Z',
    })
    await applyChangeset(db, renamed.changeset, { now: '2026-11-19T09:11:00Z' })

    const deleted = deleteNode(renamed.state, { nodeId: makeUlid(3) })
    expect(deleted.ok).toBe(true)
    await applyChangeset(db, deleted.changeset, { now: '2026-11-19T09:12:00Z' })

    const remainingNodes = await db.nodes.toArray()
    expect(remainingNodes.map((n) => n.id)).toEqual([makeUlid(1)])

    const pendingDeletes = await getPendingDeletes(db)
    expect(pendingDeletes.map((p) => p.path)).toEqual(
      expect.arrayContaining([
        're/node.json',
        're/canvas.json',
        're/rop/node.json',
        're/rop/canvas.json',
        're/rop/assets/deadbeef12345678.png',
        're/rop/exploit.py',
        // Old remote paths from the moved synced node are also scheduled for delete
        'pwn/rop/node.json',
        'pwn/rop/canvas.json',
        'pwn/rop/assets/deadbeef12345678.png',
      ]),
    )
    await db.close()
  })

  it('stores corrupt and newer-schema nodes intact with raw JSON and refuses to overwrite or delete them', async () => {
    const { db } = makeTestDb()
    const validId = makeUlid(1)
    const now = '2026-11-19T09:00:00Z'

    const cValid = createNode(buildTree([]).state, {
      title: 'Healthy Parent',
      parentId: null,
      now,
      generateId: () => validId,
    })
    await applyChangeset(db, cValid.changeset, { now })

    const rawBroken = '{"schema":1,"title":""}\n'
    const rawNewer = '{"schema":99,"id":"01KN0V1TE50000000000000099","title":"Future"}\n'

    await saveInvalidNode(db, {
      path: 'healthy-parent/broken',
      rawNodeJson: rawBroken,
      corrupt: true,
      corruptErrors: [{ path: 'title', code: 'too_small', message: 'Empty title' }],
      baseBlobSha: 'brokensha',
      extraFiles: ['raw-dump.bin'],
    })

    await saveInvalidNode(db, {
      path: 'future-node',
      rawNodeJson: rawNewer,
      corrupt: true,
      newerSchemaVersion: 99,
      baseBlobSha: 'newersha',
    })

    const entries = await loadTreeBuildEntries(db)
    const built = buildTree(entries)
    expect(built.issues.some((i) => i.code === 'corrupt_node')).toBe(true)
    expect(built.issues.some((i) => i.code === 'newer_schema_node')).toBe(true)

    // Verify raw text & extraFiles survived intact in IndexedDB
    const storedRows = await db.nodes.toArray()
    const brokenRow = storedRows.find((r) => r.path === 'healthy-parent/broken')
    const newerRow = storedRows.find((r) => r.path === 'future-node')
    expect(brokenRow?.rawNodeJson).toBe(rawBroken)
    expect(brokenRow?.extraFiles).toEqual(['raw-dump.bin'])
    expect(newerRow?.rawNodeJson).toBe(rawNewer)
    expect(newerRow?.newerSchemaVersion).toBe(99)

    // Attempting to overwrite or delete corrupt/newer-schema paths via applyChangeset must reject and leave DB unchanged
    await expect(
      applyChangeset(db, {
        deletes: ['healthy-parent/broken/node.json'],
        moves: [],
        upserts: [],
      }),
    ).rejects.toThrow(/corrupt|newer-schema/i)

    await expect(
      applyChangeset(db, {
        deletes: [],
        moves: [],
        upserts: [
          {
            path: 'future-node/node.json',
            content: serializeNodeJson({
              schema: 1,
              id: makeUlid(99),
              title: 'Overwrite',
              type: 'concept',
              status: 'none',
              tags: [],
              order: 'a0',
              color: null,
              links: [],
              createdAt: now,
              updatedAt: now,
            }),
          },
        ],
      }),
    ).rejects.toThrow(/corrupt|newer-schema/i)

    expect((await db.nodes.get(brokenRow!.id))?.rawNodeJson).toBe(rawBroken)
    expect((await db.nodes.get(newerRow!.id))?.rawNodeJson).toBe(rawNewer)
    await db.close()
  })

  it('caps errorLog at 100 entries keeping the newest entries', async () => {
    const { db } = makeTestDb()

    for (let i = 1; i <= MAX_ERROR_LOG_ENTRIES + 15; i += 1) {
      const entry: ErrorLogRecord = {
        timestamp: `2026-11-19T09:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
        level: 'error',
        code: `ERR_${i}`,
        message: `Simulated error #${i}`,
      }
      await appendErrorLog(db, entry)
    }

    const logs = await getErrorLogs(db)
    expect(logs).toHaveLength(MAX_ERROR_LOG_ENTRIES)
    expect(logs[0]?.code).toBe('ERR_16')
    expect(logs[logs.length - 1]?.code).toBe('ERR_115')
    await db.close()
  })

  it('migration harness: opens legacy v1 database with seeded data and upgrades cleanly to newer version without losing records', async () => {
    const dbName = 'knovites-migration-test'
    const indexedDB = new IDBFactory()
    const nodeId = makeUlid(10)
    const now = '2026-11-19T09:00:00Z'

    const legacyMeta = {
      schema: 1 as const,
      id: nodeId,
      title: 'Legacy Stack Note',
      type: 'concept' as const,
      status: 'learning' as const,
      tags: ['pwn'],
      order: 'a0',
      color: null,
      links: [],
      createdAt: now,
      updatedAt: now,
    }
    const legacyCanvas = { schema: 1 as const, elements: {} }

    // 1. Open legacy v1 database and insert pre-migration rows lacking new v2 fields
    const legacyDb = new Dexie(dbName, { indexedDB, IDBKeyRange })
    legacyDb.version(1).stores({
      nodes: 'id, path, parentId',
      canvases: 'nodeId, path',
      assets: '[nodeId+path], nodeId, path',
      pendingDeletes: 'path, deletedAt',
      syncState: 'id',
      settings: 'key',
      errorLog: '++id, timestamp, level, code',
    })
    await legacyDb.open()
    await legacyDb.table('nodes').put({
      id: nodeId,
      path: 'legacy-stack-note',
      parentId: null,
      meta: legacyMeta,
      baseBlobSha: 'legacysha1',
      dirty: true,
      corrupt: false,
    })
    await legacyDb.table('canvases').put({
      nodeId,
      path: 'legacy-stack-note',
      doc: legacyCanvas,
      baseBlobSha: 'legacycanvassha1',
      dirty: false,
      loaded: true,
    })
    await legacyDb.table('settings').put({
      key: 'theme',
      value: 'dark',
      updatedAt: now,
    })
    legacyDb.close()

    // 2. Open the same IndexedDB database using migration harness targeting version 2
    const migratedDb = new Dexie(dbName, { indexedDB, IDBKeyRange })
    applyDatabaseMigrations(migratedDb, 2)
    await migratedDb.open()

    expect(migratedDb.verno).toBe(2)

    const migratedNode = await migratedDb.table('nodes').get(nodeId)
    expect(migratedNode?.meta).toEqual(legacyMeta)
    expect(migratedNode?.baseBlobSha).toBe('legacysha1')
    expect(migratedNode?.dirty).toBe(1)
    expect(migratedNode?.extraFiles).toEqual([])
    expect(migratedNode?.deletedAt).toBe(0)
    expect(migratedNode?.rawNodeJson).toBe(serializeNodeJson(legacyMeta))

    const migratedCanvas = await migratedDb.table('canvases').get(nodeId)
    expect(migratedCanvas?.doc).toEqual(legacyCanvas)
    expect(migratedCanvas?.dirty).toBe(0)
    expect(migratedCanvas?.deletedAt).toBe(0)
    expect(migratedCanvas?.rawJson).toBe(serializeCanvasJson(legacyCanvas))

    const migratedSetting = await migratedDb.table('settings').get('theme')
    expect(migratedSetting?.value).toBe('dark')
    migratedDb.close()
  })

  it('soft-deletes subtree atomically, restores via Undo, or finalizes to pendingDeletes', async () => {
    const { db } = makeTestDb()
    const idRoot = makeUlid(1)
    const idChild = makeUlid(2)
    const now = '2026-11-19T09:00:00Z'

    const c1 = createNode(buildTree([]).state, {
      title: 'PWN',
      parentId: null,
      now,
      generateId: () => idRoot,
    })
    const c2 = createNode(c1.state, {
      title: 'ROP',
      parentId: idRoot,
      now,
      generateId: () => idChild,
    })
    await applyChangeset(db, c1.changeset, { now })
    await applyChangeset(db, c2.changeset, { now })
    await saveAsset(db, {
      nodeId: idChild,
      path: 'assets/0011223344556677.png',
      blob: new Uint8Array([1, 2, 3]),
      sha: 'assetsha99',
      dirty: 0,
      deletedAt: 0,
    })
    await db.nodes.update(idChild, { baseBlobSha: 'nodesha99', extraFiles: ['notes.txt'] })

    await softDeleteSubtree(db, { nodeIds: [idRoot, idChild], deletedAt: '2026-11-19T09:05:00Z' })
    // Soft-deleted records are excluded from active tree load, but still retained in IDB
    expect(await loadTreeBuildEntries(db)).toEqual([])
    expect((await db.nodes.get(idChild))?.deletedAt).toBe(Date.parse('2026-11-19T09:05:00Z'))

    // Undo restores all nodes, canvases, and assets
    await restoreSoftDeletedSubtree(db, [idRoot, idChild])
    expect(await loadTreeBuildEntries(db)).toHaveLength(2)
    expect((await db.assets.get([idChild, 'assets/0011223344556677.png']))?.deletedAt).toBe(0)

    // Soft-delete again and finalize into pendingDeletes
    await softDeleteSubtree(db, { nodeIds: [idRoot, idChild], deletedAt: '2026-11-19T09:06:00Z' })
    await finalizeSoftDeletes(db, '2026-11-19T09:06:10Z')

    expect(await db.nodes.toArray()).toEqual([])
    expect(await db.canvases.toArray()).toEqual([])
    expect(await db.assets.toArray()).toEqual([])
    const pending = await getPendingDeletes(db)
    expect(pending.map((p) => p.path)).toEqual([
      'pwn/canvas.json',
      'pwn/node.json',
      'pwn/rop/assets/0011223344556677.png',
      'pwn/rop/canvas.json',
      'pwn/rop/node.json',
      'pwn/rop/notes.txt',
    ])
    await db.close()
  })

  it('benchmarks large2000 (2,000 nodes) hydrate and collectDirtyFiles within performance budget', async () => {
    const { db } = makeTestDb('knovites-large2000-bench')
    // Dynamic import strictly inside test so production bundle never includes datasets unless needed
    const { MANDATORY_MAP_DATASETS } = await import('@/domain/datasets')
    const dataset = MANDATORY_MAP_DATASETS.large2000
    expect(dataset.entries).toHaveLength(2000)

    const initialBuild = buildTree(dataset.entries)
    expect(initialBuild.issues).toEqual([])
    const nodeList = Object.values(initialBuild.state.nodes)
    expect(nodeList).toHaveLength(2000)

    const now = '2026-11-19T12:00:00Z'
    const nodeRows = nodeList.map((n, index) => ({
      id: n.id,
      path: n.path,
      parentId: n.parentId,
      meta: n.meta,
      rawNodeJson: serializeNodeJson(n.meta),
      baseBlobSha: `sha-${index}`,
      dirty: (index < 25 ? 1 : 0) as 0 | 1,
      corrupt: false,
      extraFiles: [],
      hasCanvas: true,
      deletedAt: 0,
    }))
    const emptyCanvas = { schema: 1 as const, elements: {} }
    const rawCanvasJson = serializeCanvasJson(emptyCanvas)
    const canvasRows = nodeList.map((n, index) => ({
      nodeId: n.id,
      path: n.path,
      doc: emptyCanvas,
      rawJson: rawCanvasJson,
      baseBlobSha: `csha-${index}`,
      dirty: (index < 10 ? 1 : 0) as 0 | 1,
      loaded: true,
      corrupt: false,
      deletedAt: 0,
    }))

    await db.nodes.bulkPut(nodeRows)
    await db.canvases.bulkPut(canvasRows)

    // Warm up once before timing so JIT doesn't skew steady-state measurement
    await finalizeSoftDeletes(db, now)
    await loadTreeBuildEntries(db)

    const t0 = performance.now()
    await finalizeSoftDeletes(db, now)
    const entries = await loadTreeBuildEntries(db)
    const built = buildTree(entries)
    const hydrateMs = performance.now() - t0

    const dirtyStart = performance.now()
    const dirtyFiles = await collectDirtyFiles(db)
    const dirtyMs = performance.now() - dirtyStart

    expect(Object.keys(built.state.nodes)).toHaveLength(2000)
    expect(dirtyFiles.nodes).toHaveLength(25)
    expect(dirtyFiles.canvases).toHaveLength(10)
    expect(hydrateMs).toBeLessThan(350)
    expect(dirtyMs).toBeLessThan(100)
    await db.close()
  })
})
