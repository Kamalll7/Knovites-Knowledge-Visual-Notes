import { parseCanvasJson, parseNodeJson, type NodeJson } from '@/domain/schema'
import {
  compareLexicographical,
  deriveNodePath,
  resolveUniqueSlug,
  type Changeset,
  type TreeBuildEntry,
} from '@/domain/tree'
import type { KnovitesDatabase } from '@/storage/db'
import {
  MAX_ERROR_LOG_ENTRIES,
  type ApplyChangesetOptions,
  type CollectedDirtyFiles,
  type ErrorLogRecord,
  type InvalidNodeInput,
  type PendingDeleteRecord,
  type SoftDeleteInput,
  type StoredAssetRecord,
  type StoredCanvasRecord,
  type StoredNodeRecord,
} from '@/storage/types'

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function makePlaceholderId(seed: number): string {
  let n = seed
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = CROCKFORD_ALPHABET[n % 32]! + suffix
    n = Math.floor(n / 32)
  }
  return `07INVALID0000000${suffix}`
}

function makePlaceholderMeta(id: string): NodeJson {
  return {
    schema: 1,
    id,
    title: '',
    type: 'concept',
    status: 'none',
    tags: [],
    order: 'a0',
    color: null,
    links: [],
    createdAt: '1970-01-01T00:00:00Z',
    updatedAt: '1970-01-01T00:00:00Z',
  }
}

function toEpochMs(isoOrMs: string | number): number {
  if (typeof isoOrMs === 'number') {
    return Number.isFinite(isoOrMs) && isoOrMs > 0 ? isoOrMs : 1
  }
  const parsed = Date.parse(isoOrMs)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function toIsoUtc(epochMs: number, fallbackIso: string): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallbackIso
  }
  return new Date(epochMs).toISOString().replace('.000Z', 'Z')
}

function resolveParentPath(nodePath: string): string | null {
  const slashIdx = nodePath.lastIndexOf('/')
  return slashIdx === -1 ? null : nodePath.slice(0, slashIdx)
}

function findOwnerByFilePath(
  filePath: string,
  nodesByPath: ReadonlyMap<string, StoredNodeRecord>,
): { owner: StoredNodeRecord; relativePath: string } | null {
  let bestOwner: StoredNodeRecord | null = null
  for (const node of nodesByPath.values()) {
    const prefix = `${node.path}/`
    if (filePath.startsWith(prefix)) {
      if (!bestOwner || node.path.length > bestOwner.path.length) {
        bestOwner = node
      }
    }
  }
  if (!bestOwner) return null
  return {
    owner: bestOwner,
    relativePath: filePath.slice(bestOwner.path.length + 1),
  }
}

function assertWritableNode(node: StoredNodeRecord | undefined, targetPath: string): void {
  if (!node) return
  if (node.newerSchemaVersion !== undefined) {
    throw new Error(
      `Refusing to modify newer-schema node at "${targetPath}" (schema v${node.newerSchemaVersion}).`,
    )
  }
  if (node.corrupt) {
    throw new Error(`Refusing to modify corrupt node at "${targetPath}".`)
  }
}

function assertWritableCanvas(canvas: StoredCanvasRecord | undefined, targetPath: string): void {
  if (!canvas) return
  if (canvas.newerSchemaVersion !== undefined) {
    throw new Error(
      `Refusing to modify newer-schema canvas at "${targetPath}" (schema v${canvas.newerSchemaVersion}).`,
    )
  }
  if (canvas.corrupt) {
    throw new Error(`Refusing to modify corrupt canvas at "${targetPath}".`)
  }
}

/**
 * Applies a `Changeset` from `domain/tree` in a SINGLE atomic Dexie transaction.
 * Execution order strictly follows `Changeset` semantics: `deletes` -> `moves` -> `upserts`.
 * Refuses to modify or delete `corrupt` / `newer-schema` nodes.
 */
export async function applyChangeset(
  db: KnovitesDatabase,
  changeset: Changeset,
  options?: ApplyChangesetOptions,
): Promise<void> {
  const now = options?.now ?? new Date().toISOString()

  await db.transaction('rw', [db.nodes, db.canvases, db.assets, db.pendingDeletes], async () => {
    const allNodes = await db.nodes.toArray()
    const allCanvases = await db.canvases.toArray()
    const allAssets = await db.assets.toArray()

    const initialNodeByPath = new Map<string, StoredNodeRecord>()
    const initialNodeById = new Map<string, StoredNodeRecord>()
    const nodeByPath = new Map<string, StoredNodeRecord>()
    const nodeById = new Map<string, StoredNodeRecord>()
    const canvasByPath = new Map<string, StoredCanvasRecord>()
    const assetByFullPath = new Map<string, StoredAssetRecord>()

    for (const node of allNodes) {
      initialNodeById.set(node.id, node)
      if (node.deletedAt === 0) {
        initialNodeByPath.set(node.path, node)
        nodeByPath.set(node.path, { ...node, extraFiles: [...node.extraFiles] })
        nodeById.set(node.id, nodeByPath.get(node.path)!)
      }
    }

    for (const canvas of allCanvases) {
      if (canvas.deletedAt === 0) {
        canvasByPath.set(canvas.path, { ...canvas })
      }
    }

    for (const asset of allAssets) {
      if (asset.deletedAt !== 0) continue
      const owner = initialNodeById.get(asset.nodeId)
      if (owner && owner.deletedAt === 0) {
        assetByFullPath.set(`${owner.path}/${asset.path}`, { ...asset })
      }
    }

    // 1. DELETES
    for (const filePath of changeset.deletes) {
      if (filePath.endsWith('/node.json')) {
        const nodePath = filePath.slice(0, -'/node.json'.length)
        const existing = nodeByPath.get(nodePath)
        assertWritableNode(existing, filePath)
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: existing?.baseBlobSha ?? null,
          deletedAt: now,
        })
        if (existing) {
          await db.nodes.delete(existing.id)
          nodeByPath.delete(nodePath)
          nodeById.delete(existing.id)
        }
        continue
      }

      if (filePath.endsWith('/canvas.json')) {
        const nodePath = filePath.slice(0, -'/canvas.json'.length)
        const ownerNode = nodeByPath.get(nodePath) ?? initialNodeByPath.get(nodePath)
        const existingCanvas = canvasByPath.get(nodePath)
        assertWritableNode(ownerNode, filePath)
        assertWritableCanvas(existingCanvas, filePath)
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: existingCanvas?.baseBlobSha ?? null,
          deletedAt: now,
        })
        if (existingCanvas) {
          await db.canvases.delete(existingCanvas.nodeId)
          canvasByPath.delete(nodePath)
        }
        if (ownerNode && nodeById.has(ownerNode.id)) {
          ownerNode.hasCanvas = false
          await db.nodes.put(ownerNode)
        }
        continue
      }

      const assetRec = assetByFullPath.get(filePath)
      const ownerInfo =
        findOwnerByFilePath(filePath, initialNodeByPath) ??
        findOwnerByFilePath(filePath, nodeByPath)
      assertWritableNode(ownerInfo?.owner, filePath)

      await db.pendingDeletes.put({
        path: filePath,
        baseBlobSha: assetRec?.sha ?? null,
        deletedAt: now,
      })

      if (assetRec) {
        await db.assets.delete([assetRec.nodeId, assetRec.path])
        assetByFullPath.delete(filePath)
      } else if (ownerInfo && nodeById.has(ownerInfo.owner.id)) {
        const activeOwner = nodeById.get(ownerInfo.owner.id)!
        const nextExtras = activeOwner.extraFiles.filter((f) => f !== ownerInfo.relativePath)
        if (nextExtras.length !== activeOwner.extraFiles.length) {
          activeOwner.extraFiles = nextExtras
          await db.nodes.put(activeOwner)
        }
      }
    }

    options?.onAfterStep?.('deletes')

    // 2. MOVES (stage reads first so subtree / permutation moves never clobber each other)
    if (changeset.moves.length > 0) {
      const moveTargets = new Set(changeset.moves.map((mv) => mv.to))
      const movedNodes: Array<{ oldPath: string; newPath: string; record: StoredNodeRecord }> = []
      const movedCanvases: Array<{
        oldPath: string
        newPath: string
        record: StoredCanvasRecord
      }> = []
      const movedAssets: Array<{
        oldFullPath: string
        newFullPath: string
        oldKey: [string, string]
        record: StoredAssetRecord
      }> = []
      const pendingMoveDeletes: PendingDeleteRecord[] = []

      const oldToNewNodePath = new Map<string, string>()
      for (const mv of changeset.moves) {
        if (mv.from.endsWith('/node.json') && mv.to.endsWith('/node.json')) {
          const oldNodePath = mv.from.slice(0, -'/node.json'.length)
          const newNodePath = mv.to.slice(0, -'/node.json'.length)
          oldToNewNodePath.set(oldNodePath, newNodePath)
        }
      }

      for (const mv of changeset.moves) {
        await db.pendingDeletes.delete(mv.to)

        if (mv.from.endsWith('/node.json') && mv.to.endsWith('/node.json')) {
          const oldNodePath = mv.from.slice(0, -'/node.json'.length)
          const newNodePath = mv.to.slice(0, -'/node.json'.length)
          const source = nodeByPath.get(oldNodePath)
          assertWritableNode(source, mv.from)
          assertWritableNode(nodeByPath.get(newNodePath), mv.to)

          if (source) {
            if (source.baseBlobSha !== null && !moveTargets.has(mv.from)) {
              pendingMoveDeletes.push({
                path: mv.from,
                baseBlobSha: source.baseBlobSha,
                deletedAt: now,
              })
            }
            movedNodes.push({
              oldPath: oldNodePath,
              newPath: newNodePath,
              record: {
                ...source,
                path: newNodePath,
                dirty: 1,
              },
            })
          }
          continue
        }

        if (mv.from.endsWith('/canvas.json') && mv.to.endsWith('/canvas.json')) {
          const oldNodePath = mv.from.slice(0, -'/canvas.json'.length)
          const newNodePath = mv.to.slice(0, -'/canvas.json'.length)
          const source = canvasByPath.get(oldNodePath)
          assertWritableCanvas(source, mv.from)
          assertWritableCanvas(canvasByPath.get(newNodePath), mv.to)

          if (source) {
            if (source.baseBlobSha !== null && !moveTargets.has(mv.from)) {
              pendingMoveDeletes.push({
                path: mv.from,
                baseBlobSha: source.baseBlobSha,
                deletedAt: now,
              })
            }
            movedCanvases.push({
              oldPath: oldNodePath,
              newPath: newNodePath,
              record: {
                ...source,
                path: newNodePath,
                dirty: 1,
              },
            })
          }
          continue
        }

        const assetSource = assetByFullPath.get(mv.from)
        if (assetSource) {
          const oldOwner = nodeById.get(assetSource.nodeId)
          assertWritableNode(oldOwner, mv.from)
          if (assetSource.sha !== null && !moveTargets.has(mv.from)) {
            pendingMoveDeletes.push({
              path: mv.from,
              baseBlobSha: assetSource.sha,
              deletedAt: now,
            })
          }
          const newOwnerPath = oldOwner
            ? (oldToNewNodePath.get(oldOwner.path) ?? oldOwner.path)
            : ''
          const newRelPath =
            newOwnerPath && mv.to.startsWith(`${newOwnerPath}/`)
              ? mv.to.slice(newOwnerPath.length + 1)
              : assetSource.path
          movedAssets.push({
            oldFullPath: mv.from,
            newFullPath: mv.to,
            oldKey: [assetSource.nodeId, assetSource.path],
            record: {
              ...assetSource,
              path: newRelPath,
              dirty: 1,
            },
          })
        }
      }

      // Apply staged node moves atomically inside transaction
      for (const item of movedNodes) {
        nodeByPath.delete(item.oldPath)
      }
      for (const item of movedNodes) {
        nodeByPath.set(item.newPath, item.record)
        nodeById.set(item.record.id, item.record)
      }
      for (const item of movedNodes) {
        const parentPath = resolveParentPath(item.newPath)
        item.record.parentId = parentPath === null ? null : (nodeByPath.get(parentPath)?.id ?? null)
      }
      if (movedNodes.length > 0) {
        await db.nodes.bulkDelete(movedNodes.map((m) => m.record.id))
        await db.nodes.bulkPut(movedNodes.map((m) => m.record))
      }

      // Apply staged canvas moves
      for (const item of movedCanvases) {
        canvasByPath.delete(item.oldPath)
      }
      for (const item of movedCanvases) {
        canvasByPath.set(item.newPath, item.record)
      }
      if (movedCanvases.length > 0) {
        await db.canvases.bulkDelete(movedCanvases.map((m) => m.record.nodeId))
        await db.canvases.bulkPut(movedCanvases.map((m) => m.record))
      }

      // Apply staged asset moves
      for (const item of movedAssets) {
        assetByFullPath.delete(item.oldFullPath)
      }
      for (const item of movedAssets) {
        assetByFullPath.set(item.newFullPath, item.record)
      }
      if (movedAssets.length > 0) {
        for (const item of movedAssets) {
          await db.assets.delete(item.oldKey)
        }
        await db.assets.bulkPut(movedAssets.map((m) => m.record))
      }

      if (pendingMoveDeletes.length > 0) {
        await db.pendingDeletes.bulkPut(pendingMoveDeletes)
      }
    }

    options?.onAfterStep?.('moves')

    // 3. UPSERTS
    for (const upsert of changeset.upserts) {
      await db.pendingDeletes.delete(upsert.path)

      if (upsert.path.endsWith('/node.json')) {
        const nodePath = upsert.path.slice(0, -'/node.json'.length)
        const existingAtPath = nodeByPath.get(nodePath)
        assertWritableNode(existingAtPath, upsert.path)

        const parsed = parseNodeJson(upsert.content)
        if (parsed.status !== 'ok') {
          throw new Error(`Invalid node.json upsert at "${upsert.path}".`)
        }

        const existingById = nodeById.get(parsed.data.id)
        assertWritableNode(existingById, upsert.path)

        const parentPath = resolveParentPath(nodePath)
        const parentId = parentPath === null ? null : (nodeByPath.get(parentPath)?.id ?? null)

        const nextRecord: StoredNodeRecord = {
          id: parsed.data.id,
          path: nodePath,
          parentId,
          meta: parsed.data,
          rawNodeJson: upsert.content,
          baseBlobSha: existingById?.baseBlobSha ?? existingAtPath?.baseBlobSha ?? null,
          dirty: 1,
          corrupt: false,
          extraFiles: existingById?.extraFiles ?? existingAtPath?.extraFiles ?? [],
          hasCanvas: existingById?.hasCanvas ?? existingAtPath?.hasCanvas ?? false,
          deletedAt: 0,
        }

        nodeByPath.set(nodePath, nextRecord)
        nodeById.set(nextRecord.id, nextRecord)
        await db.nodes.put(nextRecord)
        continue
      }

      if (upsert.path.endsWith('/canvas.json')) {
        const nodePath = upsert.path.slice(0, -'/canvas.json'.length)
        const ownerNode = nodeByPath.get(nodePath)
        const existingCanvas = canvasByPath.get(nodePath)
        assertWritableNode(ownerNode, upsert.path)
        assertWritableCanvas(existingCanvas, upsert.path)
        if (!ownerNode) {
          throw new Error(`Cannot store canvas.json without node at "${nodePath}".`)
        }

        const parsed = parseCanvasJson(upsert.content)
        if (parsed.status !== 'ok') {
          throw new Error(`Invalid canvas.json upsert at "${upsert.path}".`)
        }

        const nextCanvas: StoredCanvasRecord = {
          nodeId: ownerNode.id,
          path: nodePath,
          doc: parsed.data,
          rawJson: upsert.content,
          baseBlobSha: existingCanvas?.baseBlobSha ?? null,
          dirty: 1,
          loaded: true,
          corrupt: false,
          deletedAt: 0,
        }

        canvasByPath.set(nodePath, nextCanvas)
        await db.canvases.put(nextCanvas)

        if (!ownerNode.hasCanvas) {
          ownerNode.hasCanvas = true
          await db.nodes.put(ownerNode)
        }
      }
    }

    options?.onAfterStep?.('upserts')
  })
}

/**
 * Persists a corrupt or newer-schema node intact (including raw JSON text and errors)
 * so remote/invalid content is preserved read-only and never overwritten.
 */
export async function saveInvalidNode(
  db: KnovitesDatabase,
  input: InvalidNodeInput,
): Promise<StoredNodeRecord> {
  return db.transaction('rw', db.nodes, async () => {
    const existing = await db.nodes.where('path').equals(input.path).first()
    let id = existing?.id
    if (!id) {
      let counter = (await db.nodes.count()) + 1
      id = makePlaceholderId(counter)
      while (await db.nodes.get(id)) {
        counter += 1
        id = makePlaceholderId(counter)
      }
    }

    const parentPath = resolveParentPath(input.path)
    const parent =
      parentPath === null ? undefined : await db.nodes.where('path').equals(parentPath).first()

    const record: StoredNodeRecord = {
      id,
      path: input.path,
      parentId: parent?.id ?? null,
      meta: makePlaceholderMeta(id),
      rawNodeJson: input.rawNodeJson,
      baseBlobSha: input.baseBlobSha ?? existing?.baseBlobSha ?? null,
      dirty: 0,
      corrupt: true,
      ...(input.corruptErrors ? { corruptErrors: input.corruptErrors } : {}),
      ...(input.newerSchemaVersion !== undefined
        ? { newerSchemaVersion: input.newerSchemaVersion }
        : {}),
      extraFiles: input.extraFiles ? [...input.extraFiles] : (existing?.extraFiles ?? []),
      hasCanvas: input.hasCanvas ?? existing?.hasCanvas ?? false,
      deletedAt: 0,
    }

    await db.nodes.put(record)
    return record
  })
}

export async function saveAsset(db: KnovitesDatabase, asset: StoredAssetRecord): Promise<void> {
  await db.assets.put(asset)
}

/**
 * Loads all active (`deletedAt === 0`) records from IndexedDB into `TreeBuildEntry[]`
 * ready for `domain/tree.buildTree()`.
 * Uses primary-store `nodes.toArray()` plus `node.hasCanvas` (maintained on canvas
 * upsert/delete and backfilled during v1->v2 migration) to avoid redundant canvas scans.
 */
export async function loadTreeBuildEntries(db: KnovitesDatabase): Promise<TreeBuildEntry[]> {
  const [nodes, assets] = await Promise.all([
    db.nodes.toArray(),
    db.assets.where('deletedAt').equals(0).toArray(),
  ])

  const assetsByNodeId = new Map<string, string[]>()
  for (const asset of assets) {
    const list = assetsByNodeId.get(asset.nodeId) ?? []
    list.push(asset.path)
    assetsByNodeId.set(asset.nodeId, list)
  }

  return nodes
    .filter((node) => node.deletedAt === 0)
    .sort((a, b) => compareLexicographical(a.path, b.path))
    .map((node): TreeBuildEntry => {
      const nodeAssets = assetsByNodeId.get(node.id) ?? []
      const hasCanvas = node.hasCanvas

      if (node.newerSchemaVersion !== undefined) {
        return {
          path: node.path,
          parseResult: {
            status: 'newer-schema',
            schemaVersion: node.newerSchemaVersion,
          },
          assets: nodeAssets,
          extraFiles: [...node.extraFiles],
          hasCanvas,
        }
      }

      if (node.corrupt) {
        return {
          path: node.path,
          parseResult: {
            status: 'corrupt',
            errors: node.corruptErrors ?? [],
          },
          assets: nodeAssets,
          extraFiles: [...node.extraFiles],
          hasCanvas,
        }
      }

      return {
        path: node.path,
        node: node.meta,
        assets: nodeAssets,
        extraFiles: [...node.extraFiles],
        hasCanvas,
      }
    })
}

/**
 * Marks a subtree (`nodes`, `canvases`, `assets`) as soft-deleted in a single transaction
 * for the 10-second Undo window without losing any local or remote SHA data.
 */
export async function softDeleteSubtree(
  db: KnovitesDatabase,
  input: SoftDeleteInput,
): Promise<void> {
  const targetIds = new Set(input.nodeIds)
  if (targetIds.size === 0) return

  const deletedAtMs = toEpochMs(input.deletedAt)

  await db.transaction('rw', [db.nodes, db.canvases, db.assets], async () => {
    const nodes = await db.nodes.bulkGet([...targetIds])
    for (const node of nodes) {
      if (node && (node.corrupt || node.newerSchemaVersion !== undefined)) {
        throw new Error(`Refusing to soft-delete read-only node "${node.path}".`)
      }
    }

    const updatedNodes: StoredNodeRecord[] = []
    for (const node of nodes) {
      if (node) {
        updatedNodes.push({ ...node, deletedAt: deletedAtMs })
      }
    }
    if (updatedNodes.length > 0) {
      await db.nodes.bulkPut(updatedNodes)
    }

    const canvases = await db.canvases.bulkGet([...targetIds])
    const updatedCanvases: StoredCanvasRecord[] = []
    for (const canvas of canvases) {
      if (canvas) {
        updatedCanvases.push({ ...canvas, deletedAt: deletedAtMs })
      }
    }
    if (updatedCanvases.length > 0) {
      await db.canvases.bulkPut(updatedCanvases)
    }

    const assets = await db.assets
      .where('nodeId')
      .anyOf([...targetIds])
      .toArray()
    if (assets.length > 0) {
      await db.assets.bulkPut(
        assets.map((asset) => ({
          ...asset,
          deletedAt: deletedAtMs,
        })),
      )
    }
  })
}

/**
 * Restores a previously soft-deleted subtree (Undo within 10s window) atomically.
 * If another active node occupied the restored root's path during the window,
 * assigns a unique sibling slug (`resolveUniqueSlug`) and rewrites subtree paths
 * so two active nodes never share the same path.
 */
export async function restoreSoftDeletedSubtree(
  db: KnovitesDatabase,
  nodeIds: readonly string[],
  now: string = new Date().toISOString(),
): Promise<void> {
  if (nodeIds.length === 0) return

  await db.transaction('rw', [db.nodes, db.canvases, db.assets, db.pendingDeletes], async () => {
    const targetIdSet = new Set(nodeIds)
    const [activeNodes, softDeletedCandidates] = await Promise.all([
      db.nodes.where('deletedAt').equals(0).toArray(),
      db.nodes.bulkGet([...targetIdSet]),
    ])
    const softDeletedNodes = softDeletedCandidates.filter(
      (n): n is StoredNodeRecord => n !== undefined && n.deletedAt > 0,
    )

    if (softDeletedNodes.length === 0) return

    const activeById = new Map(activeNodes.map((n) => [n.id, n]))
    const activeNodePaths = new Set(activeNodes.map((n) => n.path))
    const restoredIdSet = new Set(softDeletedNodes.map((n) => n.id))

    const rootNode =
      softDeletedNodes.find((n) => n.parentId === null || !restoredIdSet.has(n.parentId)) ??
      softDeletedNodes[0]!

    const originalParentPath = resolveParentPath(rootNode.path)
    const activeParent = rootNode.parentId !== null ? activeById.get(rootNode.parentId) : undefined
    const parentIntact = activeParent !== undefined && activeParent.path === originalParentPath
    const effectiveParentId = parentIntact ? activeParent.id : null
    const parentPath = parentIntact ? activeParent.path : null

    const activeSiblingSlugs = activeNodes
      .filter((n) => n.parentId === effectiveParentId)
      .map((n) => {
        const slash = n.path.lastIndexOf('/')
        return slash === -1 ? n.path : n.path.slice(slash + 1)
      })

    const lastSlash = rootNode.path.lastIndexOf('/')
    const originalSlug = lastSlash === -1 ? rootNode.path : rootNode.path.slice(lastSlash + 1)
    const uniqueSlug = resolveUniqueSlug(originalSlug, activeSiblingSlugs)
    const oldRootPath = rootNode.path
    const targetRootPath = deriveNodePath(parentPath, uniqueSlug)
    const pathChanged = targetRootPath !== oldRootPath

    const remapPath = (path: string): string => {
      if (!pathChanged) return path
      if (path === oldRootPath) return targetRootPath
      if (path.startsWith(`${oldRootPath}/`)) {
        return `${targetRootPath}${path.slice(oldRootPath.length)}`
      }
      return path
    }

    const oldPathsToPendingDelete: PendingDeleteRecord[] = []
    const restoredNodes: StoredNodeRecord[] = softDeletedNodes.map((node) => {
      const nextPath = remapPath(node.path)
      const moved = nextPath !== node.path
      if (moved && node.baseBlobSha !== null && !activeNodePaths.has(node.path)) {
        oldPathsToPendingDelete.push({
          path: `${node.path}/node.json`,
          baseBlobSha: node.baseBlobSha,
          deletedAt: now,
        })
      }
      return {
        ...node,
        parentId: node.id === rootNode.id ? effectiveParentId : node.parentId,
        path: nextPath,
        dirty: moved ? 1 : node.dirty,
        deletedAt: 0,
      }
    })
    await db.nodes.bulkPut(restoredNodes)

    const [canvases, activeCanvases] = await Promise.all([
      db.canvases.bulkGet([...targetIdSet]),
      db.canvases.where('deletedAt').equals(0).toArray(),
    ])
    const activeCanvasPaths = new Set(activeCanvases.map((c) => c.path))

    const restoredCanvases: StoredCanvasRecord[] = []
    for (const canvas of canvases) {
      if (!canvas || canvas.deletedAt === 0) continue
      const nextPath = remapPath(canvas.path)
      const moved = nextPath !== canvas.path
      if (moved && canvas.baseBlobSha !== null && !activeCanvasPaths.has(canvas.path)) {
        oldPathsToPendingDelete.push({
          path: `${canvas.path}/canvas.json`,
          baseBlobSha: canvas.baseBlobSha,
          deletedAt: now,
        })
      }
      restoredCanvases.push({
        ...canvas,
        path: nextPath,
        dirty: moved ? 1 : canvas.dirty,
        deletedAt: 0,
      })
    }
    if (restoredCanvases.length > 0) {
      await db.canvases.bulkPut(restoredCanvases)
    }

    const assets = await db.assets
      .where('nodeId')
      .anyOf([...targetIdSet])
      .toArray()
    const nodeByIdAfterRestore = new Map(restoredNodes.map((n) => [n.id, n]))
    const restoredAssets: StoredAssetRecord[] = []
    for (const asset of assets) {
      if (asset.deletedAt === 0) continue
      const restoredOwner = nodeByIdAfterRestore.get(asset.nodeId)
      const oldOwner = softDeletedNodes.find((n) => n.id === asset.nodeId)
      const ownerPathChanged =
        restoredOwner !== undefined &&
        oldOwner !== undefined &&
        restoredOwner.path !== oldOwner.path
      if (
        ownerPathChanged &&
        oldOwner &&
        asset.sha !== null &&
        !activeNodePaths.has(oldOwner.path)
      ) {
        oldPathsToPendingDelete.push({
          path: `${oldOwner.path}/${asset.path}`,
          baseBlobSha: asset.sha,
          deletedAt: now,
        })
      }
      restoredAssets.push({
        ...asset,
        dirty: ownerPathChanged ? 1 : asset.dirty,
        deletedAt: 0,
      })
    }
    if (restoredAssets.length > 0) {
      await db.assets.bulkPut(restoredAssets)
    }

    for (const node of restoredNodes) {
      await db.pendingDeletes.delete(`${node.path}/node.json`)
    }
    for (const canvas of restoredCanvases) {
      await db.pendingDeletes.delete(`${canvas.path}/canvas.json`)
    }
    if (oldPathsToPendingDelete.length > 0) {
      await db.pendingDeletes.bulkPut(oldPathsToPendingDelete)
    }
  })
}

/**
 * Finalizes all soft-deleted rows (or only the specified `nodeIds`) into `pendingDeletes`
 * and removes their soft-deleted records in one atomic transaction.
 * Unconditionally records every path of the finalized subtree (including descendants, canvases,
 * extra files, and assets) in `pendingDeletes` even if a new active node now uses the same path;
 * call `getEffectiveDeletes(db)` during sync to subtract active paths from the final state.
 */
export async function finalizeSoftDeletes(
  db: KnovitesDatabase,
  now: string,
  onlyNodeIds?: readonly string[],
): Promise<PendingDeleteRecord[]> {
  const filterSet = onlyNodeIds ? new Set(onlyNodeIds) : null

  return db.transaction('rw', [db.nodes, db.canvases, db.assets, db.pendingDeletes], async () => {
    const [softNodes, softCanvases, softAssets] = await Promise.all([
      db.nodes.where('deletedAt').above(0).toArray(),
      db.canvases.where('deletedAt').above(0).toArray(),
      db.assets.where('deletedAt').above(0).toArray(),
    ])

    const nodesToFinalize = softNodes.filter((n) => !filterSet || filterSet.has(n.id))
    const canvasesToFinalize = softCanvases.filter((c) => !filterSet || filterSet.has(c.nodeId))
    const assetsToFinalize = softAssets.filter((a) => !filterSet || filterSet.has(a.nodeId))

    if (
      nodesToFinalize.length === 0 &&
      canvasesToFinalize.length === 0 &&
      assetsToFinalize.length === 0
    ) {
      return []
    }

    const nodeById = new Map<string, StoredNodeRecord>()
    for (const n of softNodes) nodeById.set(n.id, n)

    if (assetsToFinalize.length > 0) {
      const missingOwnerIds = [
        ...new Set(assetsToFinalize.map((a) => a.nodeId).filter((id) => !nodeById.has(id))),
      ]
      if (missingOwnerIds.length > 0) {
        const extraOwners = await db.nodes.bulkGet(missingOwnerIds)
        for (const owner of extraOwners) {
          if (owner) nodeById.set(owner.id, owner)
        }
      }
    }

    const pendingMap = new Map<string, PendingDeleteRecord>()

    for (const node of nodesToFinalize) {
      const deletedAt = toIsoUtc(node.deletedAt, now)
      pendingMap.set(`${node.path}/node.json`, {
        path: `${node.path}/node.json`,
        baseBlobSha: node.baseBlobSha,
        deletedAt,
      })
      if (node.hasCanvas) {
        pendingMap.set(`${node.path}/canvas.json`, {
          path: `${node.path}/canvas.json`,
          baseBlobSha: null,
          deletedAt,
        })
      }
      for (const extraFile of node.extraFiles) {
        pendingMap.set(`${node.path}/${extraFile}`, {
          path: `${node.path}/${extraFile}`,
          baseBlobSha: null,
          deletedAt,
        })
      }
    }

    for (const canvas of canvasesToFinalize) {
      const deletedAt = toIsoUtc(canvas.deletedAt, now)
      pendingMap.set(`${canvas.path}/canvas.json`, {
        path: `${canvas.path}/canvas.json`,
        baseBlobSha: canvas.baseBlobSha,
        deletedAt,
      })
    }

    for (const asset of assetsToFinalize) {
      const owner = nodeById.get(asset.nodeId)
      if (!owner) continue
      const fullPath = `${owner.path}/${asset.path}`
      pendingMap.set(fullPath, {
        path: fullPath,
        baseBlobSha: asset.sha,
        deletedAt: toIsoUtc(asset.deletedAt, now),
      })
    }

    const finalized = [...pendingMap.values()]
    if (finalized.length > 0) {
      await db.pendingDeletes.bulkPut(finalized)
    }
    if (nodesToFinalize.length > 0) {
      await db.nodes.bulkDelete(nodesToFinalize.map((n) => n.id))
    }
    if (canvasesToFinalize.length > 0) {
      await db.canvases.bulkDelete(canvasesToFinalize.map((c) => c.nodeId))
    }
    if (assetsToFinalize.length > 0) {
      for (const asset of assetsToFinalize) {
        await db.assets.delete([asset.nodeId, asset.path])
      }
    }

    return finalized
  })
}

export async function getPendingDeletes(db: KnovitesDatabase): Promise<PendingDeleteRecord[]> {
  return db.pendingDeletes.orderBy('path').toArray()
}

/**
 * Computes the effective remote deletions (`pendingDeletes` minus paths present in the current
 * active local state).
 *
 * `finalizeSoftDeletes` records every deleted subtree path into `pendingDeletes` unconditionally,
 * even when a new node was created at the same path during the 10-second Undo window (because the
 * replacement node might later be moved or deleted before sync runs). Sync calls
 * `getEffectiveDeletes` so remote commits only delete paths that are truly absent in the final state.
 */
export async function getEffectiveDeletes(db: KnovitesDatabase): Promise<PendingDeleteRecord[]> {
  const pendingDeletes = await db.pendingDeletes.orderBy('path').toArray()
  if (pendingDeletes.length === 0) {
    return []
  }

  const [nodes, canvases, assets] = await Promise.all([
    db.nodes.toArray(),
    db.canvases.toArray(),
    db.assets.where('deletedAt').equals(0).toArray(),
  ])

  const activePaths = new Set<string>()
  const activeNodeById = new Map<string, StoredNodeRecord>()

  for (const node of nodes) {
    if (node.deletedAt !== 0) continue
    activeNodeById.set(node.id, node)
    activePaths.add(`${node.path}/node.json`)
    if (node.hasCanvas) {
      activePaths.add(`${node.path}/canvas.json`)
    }
    for (const extraFile of node.extraFiles) {
      activePaths.add(`${node.path}/${extraFile}`)
    }
  }

  for (const canvas of canvases) {
    if (canvas.deletedAt !== 0) continue
    activePaths.add(`${canvas.path}/canvas.json`)
  }

  for (const asset of assets) {
    const owner = activeNodeById.get(asset.nodeId)
    if (owner) {
      activePaths.add(`${owner.path}/${asset.path}`)
    }
  }

  return pendingDeletes.filter((entry) => !activePaths.has(entry.path))
}

/**
 * Collects all dirty active local records (`dirty === 1 && deletedAt === 0`)
 * plus effective remote deletions (`getEffectiveDeletes`) ready for sync.
 */
export async function collectDirtyFiles(db: KnovitesDatabase): Promise<CollectedDirtyFiles> {
  const [dirtyNodeRows, dirtyCanvasRows, dirtyAssetRows, pendingDeletes] = await Promise.all([
    db.nodes.where('dirty').equals(1).toArray(),
    db.canvases.where('dirty').equals(1).toArray(),
    db.assets.where('dirty').equals(1).toArray(),
    getEffectiveDeletes(db),
  ])

  const dirtyNodes: CollectedDirtyFiles['nodes'] = []
  for (const node of dirtyNodeRows) {
    if (node.deletedAt !== 0 || node.corrupt || node.newerSchemaVersion !== undefined) continue
    dirtyNodes.push({
      nodeId: node.id,
      path: `${node.path}/node.json`,
      rawNodeJson: node.rawNodeJson,
      baseBlobSha: node.baseBlobSha,
    })
  }

  const dirtyCanvases: CollectedDirtyFiles['canvases'] = []
  for (const canvas of dirtyCanvasRows) {
    if (canvas.deletedAt !== 0 || canvas.corrupt || canvas.newerSchemaVersion !== undefined)
      continue
    dirtyCanvases.push({
      nodeId: canvas.nodeId,
      path: `${canvas.path}/canvas.json`,
      rawJson: canvas.rawJson,
      baseBlobSha: canvas.baseBlobSha,
    })
  }

  const dirtyAssets: CollectedDirtyFiles['assets'] = []
  if (dirtyAssetRows.length > 0) {
    const activeDirtyAssets = dirtyAssetRows.filter((a) => a.deletedAt === 0)
    const ownerIds = [...new Set(activeDirtyAssets.map((a) => a.nodeId))]
    const owners = ownerIds.length > 0 ? await db.nodes.bulkGet(ownerIds) : []
    const ownerById = new Map<string, StoredNodeRecord>()
    for (const owner of owners) {
      if (
        owner &&
        owner.deletedAt === 0 &&
        !owner.corrupt &&
        owner.newerSchemaVersion === undefined
      ) {
        ownerById.set(owner.id, owner)
      }
    }
    for (const asset of activeDirtyAssets) {
      const owner = ownerById.get(asset.nodeId)
      if (!owner) continue
      dirtyAssets.push({
        nodeId: asset.nodeId,
        path: `${owner.path}/${asset.path}`,
        blob: asset.blob,
        sha: asset.sha,
      })
    }
  }

  dirtyNodes.sort((a, b) => compareLexicographical(a.path, b.path))
  dirtyCanvases.sort((a, b) => compareLexicographical(a.path, b.path))
  dirtyAssets.sort((a, b) => compareLexicographical(a.path, b.path))

  return {
    nodes: dirtyNodes,
    canvases: dirtyCanvases,
    assets: dirtyAssets,
    pendingDeletes,
  }
}

/**
 * Appends a log entry and caps `errorLog` at `MAX_ERROR_LOG_ENTRIES` (100) atomically.
 */
export async function appendErrorLog(db: KnovitesDatabase, entry: ErrorLogRecord): Promise<void> {
  await db.transaction('rw', db.errorLog, async () => {
    await db.errorLog.add(entry)
    const count = await db.errorLog.count()
    if (count > MAX_ERROR_LOG_ENTRIES) {
      const excess = count - MAX_ERROR_LOG_ENTRIES
      const oldestKeys = await db.errorLog.orderBy('id').limit(excess).primaryKeys()
      await db.errorLog.bulkDelete(oldestKeys)
    }
  })
}

export async function getErrorLogs(db: KnovitesDatabase): Promise<ErrorLogRecord[]> {
  return db.errorLog.orderBy('id').toArray()
}
