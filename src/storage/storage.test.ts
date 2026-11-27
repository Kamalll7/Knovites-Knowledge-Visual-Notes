import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { CANVAS_SCHEMA_VERSION, createEmptyCanvas, parseCanvasJson } from '@/domain/schema'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import {
  VIRTUAL_ROOT_ID,
  buildTree,
  createNode,
  deleteNode,
  moveNode,
  renameNode,
  type Changeset,
} from '@/domain/tree'
import {
  CURRENT_DB_SCHEMA_VERSION,
  DB_V2_STORES,
  MAX_ERROR_LOG_ENTRIES,
  appendErrorLog,
  applyChangeset,
  applyDatabaseMigrations,
  collectDirtyFiles,
  createKnovitesDatabase,
  finalizeSoftDeletes,
  getCanvasRecord,
  getEffectiveDeletes,
  getErrorLogs,
  getMovedBasePaths,
  getPendingDeletes,
  loadTreeBuildEntries,
  restoreSoftDeletedSubtree,
  saveAsset,
  saveInvalidNode,
  saveInvalidRootCanvas,
  saveRootExtraFiles,
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
      basePath: 'pwn/rop/assets/deadbeef12345678.png',
      blob: new Uint8Array([137, 80, 78, 71]),
      sha: 'assetsha1',
      dirty: 0,
      deletedAt: 0,
    })
    await db.nodes.update(makeUlid(2), {
      dirty: 0,
      baseBlobSha: 'nodesha2',
      basePath: 'pwn/rop',
      extraFiles: ['exploit.py'],
    })
    await db.canvases.update(makeUlid(2), {
      dirty: 0,
      baseBlobSha: 'canvassha2',
      basePath: 'pwn/rop',
    })

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
    expect(movedNode?.basePath).toBe('pwn/rop')
    expect(movedNode?.parentId).toBe(makeUlid(3))
    expect(movedNode?.dirty).toBe(1)
    expect(movedNode?.extraFiles).toEqual(['exploit.py'])

    const movedCanvas = await db.canvases.get(makeUlid(2))
    expect(movedCanvas?.path).toBe('re/rop')
    expect(movedCanvas?.basePath).toBe('pwn/rop')
    expect(movedCanvas?.dirty).toBe(1)

    const movedAsset = await db.assets.get([makeUlid(2), 'assets/deadbeef12345678.png'])
    expect(movedAsset?.basePath).toBe('pwn/rop/assets/deadbeef12345678.png')
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
    expect(migratedNode?.basePath).toBe('legacy-stack-note')
    expect(migratedNode?.dirty).toBe(1)
    expect(migratedNode?.extraFiles).toEqual([])
    expect(migratedNode?.hasCanvas).toBe(true)
    expect(migratedNode?.deletedAt).toBe(0)
    expect(migratedNode?.rawNodeJson).toBe(serializeNodeJson(legacyMeta))

    const migratedCanvas = await migratedDb.table('canvases').get(nodeId)
    expect(migratedCanvas?.doc).toEqual(legacyCanvas)
    expect(migratedCanvas?.basePath).toBe('legacy-stack-note')
    expect(migratedCanvas?.dirty).toBe(0)
    expect(migratedCanvas?.deletedAt).toBe(0)
    expect(migratedCanvas?.rawJson).toBe('{\n  "elements": {},\n  "schema": 1\n}\n')
    const upgradedFromLegacyRaw = parseCanvasJson(migratedCanvas?.rawJson)
    expect(upgradedFromLegacyRaw).toEqual({
      status: 'ok',
      data: createEmptyCanvas(),
      issues: [],
    })

    // Also confirm legacy v1 raw canvas JSON with hex colors migrates safely to v2
    const legacyHexCanvasRaw = JSON.stringify({
      schema: 1,
      elements: {
        e_11223344: {
          type: 'text',
          x: 10,
          y: 20,
          w: 240,
          z: 'a0',
          style: { bg: '#fef3c7', border: '#d97706' },
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Legacy note',
                    marks: [{ type: 'textStyle', attrs: { color: '#7c9cff' } }],
                  },
                ],
              },
            ],
          },
          updatedAt: now,
        },
      },
    })
    const upgradedHex = parseCanvasJson(legacyHexCanvasRaw)
    expect(upgradedHex.status).toBe('ok')
    if (upgradedHex.status === 'ok') {
      expect(upgradedHex.data.schema).toBe(CANVAS_SCHEMA_VERSION)
      const el = upgradedHex.data.elements['e_11223344']
      expect(el?.type).toBe('text')
      if (el?.type === 'text') {
        expect(el.style).toEqual({ bg: 'auto', border: 'auto' })
        expect(el.content.content?.[0]?.content?.[0]?.marks).toBeUndefined()
      }
    }

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
      basePath: 'pwn/rop/assets/0011223344556677.png',
      blob: new Uint8Array([1, 2, 3]),
      sha: 'assetsha99',
      dirty: 0,
      deletedAt: 0,
    })
    await db.nodes.update(idChild, {
      baseBlobSha: 'nodesha99',
      basePath: 'pwn/rop',
      extraFiles: ['notes.txt'],
    })

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
      basePath: index < 25 ? null : n.path,
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
    const emptyCanvas = createEmptyCanvas()
    const rawCanvasJson = serializeCanvasJson(emptyCanvas)
    const canvasRows = nodeList.map((n, index) => ({
      nodeId: n.id,
      path: n.path,
      basePath: index < 10 ? null : n.path,
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

    console.info(
      `[BENCH large2000] hydrate=${hydrateMs.toFixed(2)}ms, collectDirtyFiles=${dirtyMs.toFixed(2)}ms`,
    )

    expect(Object.keys(built.state.nodes)).toHaveLength(2000)
    expect(dirtyFiles.nodes).toHaveLength(25)
    expect(dirtyFiles.canvases).toHaveLength(10)
    expect(hydrateMs).toBeLessThan(500)
    expect(dirtyMs).toBeLessThan(500)
    await db.close()
  })

  describe('virtual root ("__root__") home canvas, assets, lazy creation, and M2->v3 migration [M3-HomeRoot]', () => {
    it('keeps root canvas.json lazy on empty workspace and supports __root__ canvas & assets without any db.nodes row', async () => {
      const { db } = makeTestDb('knovites-root-lazy-test')
      const now = '2026-11-26T10:00:00Z'

      // 1. Lazy creation: empty workspace has no __root__ canvas row and empty entries/dirty files
      expect(await getCanvasRecord(db, VIRTUAL_ROOT_ID)).toBeUndefined()
      expect(await loadTreeBuildEntries(db)).toEqual([])
      expect(await collectDirtyFiles(db)).toEqual({
        nodes: [],
        canvases: [],
        assets: [],
        pendingDeletes: [],
      })

      // Creating a regular node must NOT eagerly create a __root__ canvas
      const cPwn = createNode(buildTree([]).state, {
        title: 'PWN',
        parentId: null,
        now,
        generateId: () => makeUlid(1),
      })
      expect(cPwn.ok).toBe(true)
      await applyChangeset(db, cPwn.changeset, { now })
      expect(await getCanvasRecord(db, VIRTUAL_ROOT_ID)).toBeUndefined()
      expect(await db.nodes.get(VIRTUAL_ROOT_ID)).toBeUndefined()

      // 2. First edit on home root: upsert 'canvas.json' + save root asset + save rootExtraFiles
      const rootCanvasJson = serializeCanvasJson({
        schema: CANVAS_SCHEMA_VERSION,
        elements: {
          e_home0001: {
            type: 'text',
            x: 24,
            y: 36,
            w: 320,
            z: 'a0',
            style: { bg: 'auto', border: 'auto' },
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Home note' }] }],
            },
            updatedAt: now,
          },
        },
      })

      await applyChangeset(
        db,
        {
          upserts: [{ path: 'canvas.json', content: rootCanvasJson }],
          moves: [],
          deletes: [],
        },
        { now },
      )
      await saveAsset(db, {
        nodeId: VIRTUAL_ROOT_ID,
        path: 'assets/7ab1c2d3e4f50987.webp',
        basePath: null,
        blob: new Uint8Array([82, 73, 70, 70]),
        sha: null,
        dirty: 1,
        deletedAt: 0,
      })
      await saveRootExtraFiles(db, ['README.md', '.gitignore'], now)

      // No fake row in db.nodes for __root__
      expect(await db.nodes.get(VIRTUAL_ROOT_ID)).toBeUndefined()
      expect((await db.nodes.toArray()).map((n) => n.id)).toEqual([makeUlid(1)])

      const storedRootCanvas = await getCanvasRecord(db, VIRTUAL_ROOT_ID)
      expect(storedRootCanvas?.nodeId).toBe(VIRTUAL_ROOT_ID)
      expect(storedRootCanvas?.path).toBe('')
      expect(storedRootCanvas?.rawJson).toBe(rootCanvasJson)
      expect(storedRootCanvas?.dirty).toBe(1)

      // 3. loadTreeBuildEntries -> buildTree restores root home metadata + regular nodes cleanly
      const entries = await loadTreeBuildEntries(db)
      const built = buildTree(entries)
      expect(built.issues).toEqual([])
      expect(built.rootHasCanvas).toBe(true)
      expect(built.rootAssets).toEqual(['assets/7ab1c2d3e4f50987.webp'])
      expect(built.rootExtraFiles).toEqual(['.gitignore', 'README.md'])
      expect(built.state.nodes[VIRTUAL_ROOT_ID]).toBeUndefined()
      expect(built.state.rootIds).toEqual([makeUlid(1)])

      // 4. collectDirtyFiles produces slash-free 'canvas.json' and 'assets/<file>' for __root__
      const dirty = await collectDirtyFiles(db)
      expect(dirty.canvases.map((c) => ({ nodeId: c.nodeId, path: c.path }))).toEqual([
        { nodeId: VIRTUAL_ROOT_ID, path: 'canvas.json' },
        { nodeId: makeUlid(1), path: 'pwn/canvas.json' },
      ])
      expect(dirty.assets.map((a) => ({ nodeId: a.nodeId, path: a.path }))).toEqual([
        { nodeId: VIRTUAL_ROOT_ID, path: 'assets/7ab1c2d3e4f50987.webp' },
      ])
      for (const p of [
        ...dirty.nodes.map((x) => x.path),
        ...dirty.canvases.map((x) => x.path),
        ...dirty.assets.map((x) => x.path),
        ...dirty.pendingDeletes.map((x) => x.path),
      ]) {
        expect(p.startsWith('/')).toBe(false)
      }

      await db.close()
    })

    it('handles applyChangeset deletes, getEffectiveDeletes, getMovedBasePaths, and read-only guards for __root__', async () => {
      const { db } = makeTestDb('knovites-root-diff-test')
      const now = '2026-11-26T10:00:00Z'
      const rootCanvasJson = serializeCanvasJson(createEmptyCanvas())

      // Seed synced __root__ canvas, asset, and rootExtraFiles
      await applyChangeset(
        db,
        { upserts: [{ path: 'canvas.json', content: rootCanvasJson }], moves: [], deletes: [] },
        { now },
      )
      await db.canvases.update(VIRTUAL_ROOT_ID, {
        baseBlobSha: 'rootcanvassha',
        basePath: '',
        dirty: 0,
      })
      await saveAsset(db, {
        nodeId: VIRTUAL_ROOT_ID,
        path: 'assets/7ab1c2d3e4f50987.webp',
        basePath: 'assets/7ab1c2d3e4f50987.webp',
        blob: new Uint8Array([1, 2, 3]),
        sha: 'rootassetsha',
        dirty: 0,
        deletedAt: 0,
      })
      await saveRootExtraFiles(db, ['README.md'], now)

      // Unmoved synced root canvas & asset must report ZERO moved base paths (never '/canvas.json')
      expect(await getMovedBasePaths(db)).toEqual([])

      // Root asset whose basePath differs from active path must be reported by getMovedBasePaths
      await db.assets.update([VIRTUAL_ROOT_ID, 'assets/7ab1c2d3e4f50987.webp'], {
        basePath: 'assets/0000111122223333.png',
      })
      expect(await getMovedBasePaths(db)).toEqual(['assets/0000111122223333.png'])
      await db.assets.update([VIRTUAL_ROOT_ID, 'assets/7ab1c2d3e4f50987.webp'], {
        basePath: 'assets/7ab1c2d3e4f50987.webp',
      })

      // Deleting 'canvas.json' & root asset via applyChangeset records slash-free pendingDeletes
      await applyChangeset(
        db,
        {
          deletes: ['canvas.json', 'assets/7ab1c2d3e4f50987.webp'],
          moves: [],
          upserts: [],
        },
        { now: '2026-11-26T10:05:00Z' },
      )
      expect(await getCanvasRecord(db, VIRTUAL_ROOT_ID)).toBeUndefined()
      expect(await db.assets.get([VIRTUAL_ROOT_ID, 'assets/7ab1c2d3e4f50987.webp'])).toBeUndefined()
      expect((await getEffectiveDeletes(db)).map((d) => d.path)).toEqual([
        'assets/7ab1c2d3e4f50987.webp',
        'canvas.json',
      ])

      // Re-creating active 'canvas.json' & root asset filters them out of getEffectiveDeletes;
      // user rootExtraFiles ('README.md') is also never returned as an effective delete.
      await db.pendingDeletes.put({
        path: 'README.md',
        baseBlobSha: 'readmesha',
        deletedAt: '2026-11-26T10:05:00Z',
      })
      await applyChangeset(
        db,
        { upserts: [{ path: 'canvas.json', content: rootCanvasJson }], moves: [], deletes: [] },
        { now: '2026-11-26T10:06:00Z' },
      )
      await saveAsset(db, {
        nodeId: VIRTUAL_ROOT_ID,
        path: 'assets/7ab1c2d3e4f50987.webp',
        basePath: null,
        blob: new Uint8Array([4, 5, 6]),
        sha: null,
        dirty: 1,
        deletedAt: 0,
      })
      expect(await getEffectiveDeletes(db)).toEqual([])

      // Guard: softDeleteSubtree refuses VIRTUAL_ROOT_ID and applyChangeset refuses root node.json
      await expect(
        softDeleteSubtree(db, { nodeIds: [VIRTUAL_ROOT_ID], deletedAt: now }),
      ).rejects.toThrow(/__root__/i)
      await expect(
        applyChangeset(db, {
          upserts: [{ path: 'node.json', content: '{}' }],
          moves: [],
          deletes: [],
        }),
      ).rejects.toThrow(/root|node\.json/i)
      await expect(
        applyChangeset(db, {
          upserts: [{ path: '/canvas.json', content: rootCanvasJson }],
          moves: [],
          deletes: [],
        }),
      ).rejects.toThrow(/leading|invalid/i)

      // Corrupt root canvas is preserved read-only and refuses overwrite or delete
      await db.canvases.delete(VIRTUAL_ROOT_ID)
      const rawBrokenRoot = '{"schema":1,"elements":"bad"}\n'
      await saveInvalidRootCanvas(db, {
        rawJson: rawBrokenRoot,
        corrupt: true,
        corruptErrors: [{ path: 'elements', code: 'invalid_type', message: 'Expected object' }],
        baseBlobSha: 'brokenrootsha',
      })
      const corruptBuilt = buildTree(await loadTreeBuildEntries(db))
      expect(corruptBuilt.issues.some((i) => i.code === 'corrupt_root_canvas')).toBe(true)
      expect(corruptBuilt.state.rootCanvasCorrupt).toBe(true)
      await expect(
        applyChangeset(db, {
          upserts: [{ path: 'canvas.json', content: rootCanvasJson }],
          moves: [],
          deletes: [],
        }),
      ).rejects.toThrow(/corrupt/i)
      await expect(
        applyChangeset(db, {
          upserts: [],
          moves: [],
          deletes: ['canvas.json'],
        }),
      ).rejects.toThrow(/corrupt/i)
      expect((await getCanvasRecord(db, VIRTUAL_ROOT_ID))?.rawJson).toBe(rawBrokenRoot)

      await db.close()
    })

    it('migration M2 (v2) -> v3 preserves all existing M2 records intact and normalizes __root__ paths without leading slash', async () => {
      const dbName = 'knovites-m2-to-v3-migration-test'
      const indexedDB = new IDBFactory()
      const nodeId = makeUlid(20)
      const now = '2026-11-20T09:00:00Z'

      const existingMeta = {
        schema: 1 as const,
        id: nodeId,
        title: 'M2 Existing Note',
        type: 'technique' as const,
        status: 'practiced' as const,
        tags: ['pwn'],
        order: 'a0',
        color: '#7c9cff',
        links: [],
        createdAt: now,
        updatedAt: now,
      }
      const existingCanvas = createEmptyCanvas()
      const rawNode = serializeNodeJson(existingMeta)
      const rawCanvas = serializeCanvasJson(existingCanvas)

      // 1. Seed a genuine M2 v2 database
      const m2Db = new Dexie(dbName, { indexedDB, IDBKeyRange })
      m2Db.version(1).stores({
        nodes: 'id, path, parentId',
        canvases: 'nodeId, path',
        assets: '[nodeId+path], nodeId, path',
        pendingDeletes: 'path, deletedAt',
        syncState: 'id',
        settings: 'key',
        errorLog: '++id, timestamp, level, code',
      })
      m2Db.version(2).stores(DB_V2_STORES)
      await m2Db.open()
      await m2Db.table('nodes').put({
        id: nodeId,
        path: 'pwn',
        basePath: 'pwn',
        parentId: null,
        meta: existingMeta,
        rawNodeJson: rawNode,
        baseBlobSha: 'm2nodesha',
        dirty: 0,
        corrupt: false,
        extraFiles: ['exploit.py'],
        hasCanvas: true,
        deletedAt: 0,
      })
      await m2Db.table('canvases').put({
        nodeId,
        path: 'pwn',
        basePath: 'pwn',
        doc: existingCanvas,
        rawJson: rawCanvas,
        baseBlobSha: 'm2canvassha',
        dirty: 0,
        loaded: true,
        corrupt: false,
        deletedAt: 0,
      })
      await m2Db.table('assets').put({
        nodeId,
        path: 'assets/1122334455667788.png',
        basePath: 'pwn/assets/1122334455667788.png',
        blob: new Uint8Array([9, 8, 7]),
        sha: 'm2assetsha',
        dirty: 0,
        deletedAt: 0,
      })
      // Also seed legacy pre-normalized __root__ rows to verify v2->v3 normalization
      await m2Db.table('canvases').put({
        nodeId: VIRTUAL_ROOT_ID,
        path: '/canvas.json',
        basePath: '/canvas.json',
        doc: existingCanvas,
        rawJson: rawCanvas,
        baseBlobSha: 'm2rootcanvassha',
        dirty: 1,
        loaded: true,
        corrupt: false,
        deletedAt: 0,
      })
      await m2Db.table('assets').put({
        nodeId: VIRTUAL_ROOT_ID,
        path: '/assets/aabbccddeeff0011.webp',
        basePath: null,
        blob: new Uint8Array([1, 3, 3, 7]),
        sha: 'm2rootassetsha',
        dirty: 1,
        deletedAt: 0,
      })
      await m2Db.table('pendingDeletes').put({
        path: 'old/node.json',
        baseBlobSha: 'oldsha',
        deletedAt: now,
      })
      await m2Db.table('syncState').put({
        id: 'singleton',
        repo: 'owner/repo',
        branch: 'main',
        baseCommitSha: 'commitsha',
        lastSyncedAt: now,
        pendingMerge: null,
      })
      await m2Db.table('settings').put({
        key: 'mapLayout',
        value: 'radial',
        updatedAt: now,
      })
      await m2Db.table('errorLog').add({
        timestamp: now,
        level: 'info',
        code: 'M2_BOOT',
        message: 'M2 initialized',
      })
      m2Db.close()

      // 2. Open with current KnovitesDatabase (CURRENT_DB_SCHEMA_VERSION = 3)
      const upgradedDb = createKnovitesDatabase(dbName, { indexedDB, IDBKeyRange })
      await upgradedDb.open()
      expect(upgradedDb.verno).toBe(CURRENT_DB_SCHEMA_VERSION)
      expect(CURRENT_DB_SCHEMA_VERSION).toBe(3)

      // All M2 rows must survive completely intact
      const nodeAfter = await upgradedDb.nodes.get(nodeId)
      expect(nodeAfter?.meta).toEqual(existingMeta)
      expect(nodeAfter?.extraFiles).toEqual(['exploit.py'])
      expect(nodeAfter?.baseBlobSha).toBe('m2nodesha')
      expect(await upgradedDb.canvases.get(nodeId)).toMatchObject({
        path: 'pwn',
        basePath: 'pwn',
        baseBlobSha: 'm2canvassha',
      })
      expect(await upgradedDb.assets.get([nodeId, 'assets/1122334455667788.png'])).toMatchObject({
        basePath: 'pwn/assets/1122334455667788.png',
        sha: 'm2assetsha',
      })
      expect((await upgradedDb.pendingDeletes.get('old/node.json'))?.baseBlobSha).toBe('oldsha')
      expect((await upgradedDb.syncState.get('singleton'))?.repo).toBe('owner/repo')
      expect((await upgradedDb.settings.get('mapLayout'))?.value).toBe('radial')
      expect((await upgradedDb.errorLog.toArray()).map((e) => e.code)).toEqual(['M2_BOOT'])

      // Legacy __root__ rows normalized cleanly without leading slash
      const rootCanvasAfter = await upgradedDb.canvases.get(VIRTUAL_ROOT_ID)
      expect(rootCanvasAfter?.path).toBe('')
      expect(rootCanvasAfter?.basePath).toBe('')
      expect(rootCanvasAfter?.baseBlobSha).toBe('m2rootcanvassha')

      const rootAssetAfter = await upgradedDb.assets.get([
        VIRTUAL_ROOT_ID,
        'assets/aabbccddeeff0011.webp',
      ])
      expect(rootAssetAfter?.path).toBe('assets/aabbccddeeff0011.webp')
      expect(rootAssetAfter?.basePath).toBe('assets/aabbccddeeff0011.webp')

      const dirtyAfterUpgrade = await collectDirtyFiles(upgradedDb)
      expect(dirtyAfterUpgrade.canvases.map((c) => c.path)).toEqual(['canvas.json'])
      expect(dirtyAfterUpgrade.assets.map((a) => a.path)).toEqual(['assets/aabbccddeeff0011.webp'])

      upgradedDb.close()
    })
  })
})
