import {
  ASSETS_DIR,
  CANVAS_FILE,
  KNOVITES_META_FILE,
  NODE_META_FILE,
  parseCanvasJson,
  parseNodeJson,
  type CanvasJson,
  type NodeJson,
} from '@/domain/schema'
import {
  VIRTUAL_ROOT_ID,
  compareLexicographical,
  deriveNodePath,
  isRootAssetFilePath,
  isValidRepoFilePath,
  isVirtualRootId,
  normalizeAssetRelativePath,
  normalizeRepoRelativePath,
  parseCanvasFilePath,
  parseNodeFilePath,
  resolveAssetFilePath,
  resolveCanvasFilePath,
  resolveExtraFilePath,
  resolveNodeFilePath,
  resolveUniqueSlug,
  type Changeset,
  type TreeBuildEntry,
} from '@/domain/tree'
import type { KnovitesDatabase } from '@/storage/db'
import {
  MAX_ERROR_LOG_ENTRIES,
  ROOT_EXTRA_FILES_SETTING_KEY,
  type ApplyChangesetOptions,
  type CollectedDirtyFiles,
  type ErrorLogRecord,
  type InvalidNodeInput,
  type InvalidRootCanvasInput,
  type PendingDeleteRecord,
  type RestoreSoftDeleteResult,
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

function parseStoredRootExtraFiles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const extras = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const clean = normalizeRepoRelativePath(item)
    if (
      clean.length === 0 ||
      clean === KNOVITES_META_FILE ||
      clean === CANVAS_FILE ||
      clean === ASSETS_DIR ||
      clean.startsWith(`${ASSETS_DIR}/`)
    ) {
      continue
    }
    extras.add(clean)
  }
  return [...extras].sort(compareLexicographical)
}

function assertValidChangesetPath(filePath: string): void {
  if (!isValidRepoFilePath(filePath)) {
    throw new Error(
      `Invalid repository file path "${filePath}" (leading/trailing slashes and traversal segments are forbidden).`,
    )
  }
}

/**
 * Applies a `Changeset` from `domain/tree` in a SINGLE atomic Dexie transaction.
 * Execution order strictly follows `Changeset` semantics: `deletes` -> `moves` -> `upserts`.
 * Refuses to modify or delete `corrupt` / `newer-schema` nodes or canvases.
 * Supports virtual root (`'__root__'`) `'canvas.json'` and `'assets/...'` without a row in `db.nodes`.
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
        const keyPath = isVirtualRootId(canvas.nodeId) ? '' : canvas.path
        canvasByPath.set(keyPath, { ...canvas, path: keyPath })
      }
    }

    for (const asset of allAssets) {
      if (asset.deletedAt !== 0) continue
      if (isVirtualRootId(asset.nodeId)) {
        assetByFullPath.set(resolveAssetFilePath('', asset.path), { ...asset })
        continue
      }
      const owner = initialNodeById.get(asset.nodeId)
      if (owner && owner.deletedAt === 0) {
        assetByFullPath.set(resolveAssetFilePath(owner.path, asset.path), { ...asset })
      }
    }

    // 1. DELETES
    for (const filePath of changeset.deletes) {
      assertValidChangesetPath(filePath)

      if (filePath === NODE_META_FILE) {
        throw new Error(
          `Refusing to delete ${NODE_META_FILE} at virtual root "${VIRTUAL_ROOT_ID}".`,
        )
      }

      const deletedNodePath = parseNodeFilePath(filePath)
      if (deletedNodePath !== null) {
        const existing = nodeByPath.get(deletedNodePath)
        assertWritableNode(existing, filePath)
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: existing?.baseBlobSha ?? null,
          deletedAt: now,
        })
        if (existing?.basePath && existing.basePath !== deletedNodePath) {
          await db.pendingDeletes.put({
            path: resolveNodeFilePath(existing.basePath),
            baseBlobSha: existing.baseBlobSha,
            deletedAt: now,
          })
        }
        if (existing) {
          await db.nodes.delete(existing.id)
          nodeByPath.delete(deletedNodePath)
          nodeById.delete(existing.id)
        }
        continue
      }

      const parsedCanvas = parseCanvasFilePath(filePath)
      if (parsedCanvas !== null) {
        if (parsedCanvas.isRoot) {
          const existingRootCanvas =
            canvasByPath.get('') ?? (await db.canvases.get(VIRTUAL_ROOT_ID))
          assertWritableCanvas(existingRootCanvas, filePath)
          await db.pendingDeletes.put({
            path: resolveCanvasFilePath(''),
            baseBlobSha: existingRootCanvas?.baseBlobSha ?? null,
            deletedAt: now,
          })
          if (existingRootCanvas) {
            await db.canvases.delete(VIRTUAL_ROOT_ID)
            canvasByPath.delete('')
          }
          continue
        }

        const nodePath = parsedCanvas.ownerPath
        const ownerNode = nodeByPath.get(nodePath) ?? initialNodeByPath.get(nodePath)
        const existingCanvas = canvasByPath.get(nodePath)
        assertWritableNode(ownerNode, filePath)
        assertWritableCanvas(existingCanvas, filePath)
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: existingCanvas?.baseBlobSha ?? null,
          deletedAt: now,
        })
        if (existingCanvas?.basePath && existingCanvas.basePath !== nodePath) {
          await db.pendingDeletes.put({
            path: resolveCanvasFilePath(existingCanvas.basePath),
            baseBlobSha: existingCanvas.baseBlobSha,
            deletedAt: now,
          })
        }
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
      if (assetRec && isVirtualRootId(assetRec.nodeId)) {
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: assetRec.sha ?? null,
          deletedAt: now,
        })
        if (assetRec.basePath && assetRec.basePath !== filePath) {
          await db.pendingDeletes.put({
            path: assetRec.basePath,
            baseBlobSha: assetRec.sha,
            deletedAt: now,
          })
        }
        await db.assets.delete([VIRTUAL_ROOT_ID, assetRec.path])
        assetByFullPath.delete(filePath)
        continue
      }

      if (!assetRec && isRootAssetFilePath(filePath)) {
        await db.pendingDeletes.put({
          path: filePath,
          baseBlobSha: null,
          deletedAt: now,
        })
        continue
      }

      const ownerInfo =
        findOwnerByFilePath(filePath, initialNodeByPath) ??
        findOwnerByFilePath(filePath, nodeByPath)
      assertWritableNode(ownerInfo?.owner, filePath)

      await db.pendingDeletes.put({
        path: filePath,
        baseBlobSha: assetRec?.sha ?? null,
        deletedAt: now,
      })
      if (assetRec?.basePath && assetRec.basePath !== filePath) {
        await db.pendingDeletes.put({
          path: assetRec.basePath,
          baseBlobSha: assetRec.sha,
          deletedAt: now,
        })
      } else if (
        !assetRec &&
        ownerInfo?.owner.basePath &&
        ownerInfo.owner.basePath !== ownerInfo.owner.path
      ) {
        await db.pendingDeletes.put({
          path: resolveExtraFilePath(ownerInfo.owner.basePath, ownerInfo.relativePath),
          baseBlobSha: null,
          deletedAt: now,
        })
      }

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
        assertValidChangesetPath(mv.from)
        assertValidChangesetPath(mv.to)
        const oldNodePath = parseNodeFilePath(mv.from)
        const newNodePath = parseNodeFilePath(mv.to)
        if (oldNodePath !== null && newNodePath !== null) {
          oldToNewNodePath.set(oldNodePath, newNodePath)
        }
      }

      for (const mv of changeset.moves) {
        const oldNodePath = parseNodeFilePath(mv.from)
        const newNodePath = parseNodeFilePath(mv.to)
        if (oldNodePath !== null && newNodePath !== null) {
          const source = nodeByPath.get(oldNodePath)
          assertWritableNode(source, mv.from)
          assertWritableNode(nodeByPath.get(newNodePath), mv.to)

          if (source) {
            if (source.baseBlobSha !== null || source.basePath !== null) {
              const remoteOldPath = source.basePath ?? oldNodePath
              pendingMoveDeletes.push({
                path: resolveNodeFilePath(remoteOldPath),
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
                basePath: source.basePath,
                dirty: 1,
              },
            })
          }
          continue
        }

        const fromCanvas = parseCanvasFilePath(mv.from)
        const toCanvas = parseCanvasFilePath(mv.to)
        if (fromCanvas !== null && toCanvas !== null && !fromCanvas.isRoot && !toCanvas.isRoot) {
          const oldPath = fromCanvas.ownerPath
          const newPath = toCanvas.ownerPath
          const source = canvasByPath.get(oldPath)
          assertWritableCanvas(source, mv.from)
          assertWritableCanvas(canvasByPath.get(newPath), mv.to)

          if (source) {
            if (source.baseBlobSha !== null || source.basePath !== null) {
              const remoteOldPath = source.basePath ?? oldPath
              pendingMoveDeletes.push({
                path: resolveCanvasFilePath(remoteOldPath),
                baseBlobSha: source.baseBlobSha,
                deletedAt: now,
              })
            }
            movedCanvases.push({
              oldPath,
              newPath,
              record: {
                ...source,
                path: newPath,
                basePath: source.basePath,
                dirty: 1,
              },
            })
          }
          continue
        }

        const assetSource = assetByFullPath.get(mv.from)
        if (assetSource && !isVirtualRootId(assetSource.nodeId)) {
          const oldOwner = nodeById.get(assetSource.nodeId)
          assertWritableNode(oldOwner, mv.from)
          if (assetSource.sha !== null || assetSource.basePath !== null) {
            pendingMoveDeletes.push({
              path: assetSource.basePath ?? mv.from,
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
              basePath: assetSource.basePath,
              dirty: 1,
            },
          })
          continue
        }

        // Handle extraFiles moved with a synced node
        const extraOwnerInfo = findOwnerByFilePath(mv.from, nodeByPath)
        if (
          extraOwnerInfo &&
          (extraOwnerInfo.owner.baseBlobSha !== null || extraOwnerInfo.owner.basePath !== null)
        ) {
          const remoteBaseDir = extraOwnerInfo.owner.basePath ?? extraOwnerInfo.owner.path
          pendingMoveDeletes.push({
            path: resolveExtraFilePath(remoteBaseDir, extraOwnerInfo.relativePath),
            baseBlobSha: null,
            deletedAt: now,
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
      assertValidChangesetPath(upsert.path)

      if (upsert.path === NODE_META_FILE) {
        throw new Error(`Refusing to store ${NODE_META_FILE} at virtual root "${VIRTUAL_ROOT_ID}".`)
      }

      const upsertedNodePath = parseNodeFilePath(upsert.path)
      if (upsertedNodePath !== null) {
        const existingAtPath = nodeByPath.get(upsertedNodePath)
        assertWritableNode(existingAtPath, upsert.path)

        const parsed = parseNodeJson(upsert.content)
        if (parsed.status !== 'ok') {
          throw new Error(`Invalid node.json upsert at "${upsert.path}".`)
        }

        const existingById = nodeById.get(parsed.data.id)
        assertWritableNode(existingById, upsert.path)

        const parentPath = resolveParentPath(upsertedNodePath)
        const parentId = parentPath === null ? null : (nodeByPath.get(parentPath)?.id ?? null)

        const nextRecord: StoredNodeRecord = {
          id: parsed.data.id,
          path: upsertedNodePath,
          basePath: existingById?.basePath ?? null,
          parentId,
          meta: parsed.data,
          rawNodeJson: upsert.content,
          baseBlobSha: existingById?.baseBlobSha ?? null,
          dirty: 1,
          corrupt: false,
          extraFiles: existingById?.extraFiles ?? existingAtPath?.extraFiles ?? [],
          hasCanvas: existingById?.hasCanvas ?? existingAtPath?.hasCanvas ?? false,
          deletedAt: 0,
        }

        nodeByPath.set(upsertedNodePath, nextRecord)
        nodeById.set(nextRecord.id, nextRecord)
        await db.nodes.put(nextRecord)
        continue
      }

      const parsedCanvas = parseCanvasFilePath(upsert.path)
      if (parsedCanvas !== null) {
        if (parsedCanvas.isRoot) {
          const existingRootCanvas =
            canvasByPath.get('') ?? (await db.canvases.get(VIRTUAL_ROOT_ID))
          assertWritableCanvas(existingRootCanvas, upsert.path)

          const parsed = parseCanvasJson(upsert.content)
          if (parsed.status !== 'ok') {
            throw new Error(`Invalid canvas.json upsert at "${upsert.path}".`)
          }

          const nextRootCanvas: StoredCanvasRecord = {
            nodeId: VIRTUAL_ROOT_ID,
            path: '',
            basePath: existingRootCanvas?.basePath ?? null,
            doc: parsed.data,
            rawJson: upsert.content,
            baseBlobSha: existingRootCanvas?.baseBlobSha ?? null,
            dirty: 1,
            loaded: true,
            corrupt: false,
            deletedAt: 0,
          }

          canvasByPath.set('', nextRootCanvas)
          await db.canvases.put(nextRootCanvas)
          continue
        }

        const nodePath = parsedCanvas.ownerPath
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

        const existingCanvasById = existingCanvas ?? (await db.canvases.get(ownerNode.id))

        const nextCanvas: StoredCanvasRecord = {
          nodeId: ownerNode.id,
          path: nodePath,
          basePath: existingCanvasById?.basePath ?? null,
          doc: parsed.data,
          rawJson: upsert.content,
          baseBlobSha: existingCanvasById?.baseBlobSha ?? null,
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
      basePath: input.baseBlobSha ? input.path : (existing?.basePath ?? null),
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

export async function getCanvasRecord(
  db: KnovitesDatabase,
  nodeId: string,
): Promise<StoredCanvasRecord | undefined> {
  return db.canvases.get(nodeId)
}

/**
 * Lightweight read-only scan of active (`deletedAt === 0`, non-corrupt) canvas documents
 * for deriving `knovites:<ulid>` cross-links without changing Dexie schema or migrations (`FR-MAP-16`).
 */
export async function loadActiveCanvasDocs(
  db: KnovitesDatabase,
): Promise<Array<{ nodeId: string; doc: CanvasJson }>> {
  const records = await db.canvases.toArray()
  const result: Array<{ nodeId: string; doc: CanvasJson }> = []
  for (const record of records) {
    if (record.deletedAt !== 0 || record.corrupt || !record.doc) continue
    result.push({ nodeId: record.nodeId, doc: record.doc })
  }
  return result
}

/**
 * Persists a corrupt or newer-schema root `canvas.json` intact (`nodeId = '__root__'`, `path = ''`)
 * without creating any fake row in `db.nodes`.
 */
export async function saveInvalidRootCanvas(
  db: KnovitesDatabase,
  input: InvalidRootCanvasInput,
): Promise<StoredCanvasRecord> {
  return db.transaction('rw', db.canvases, async () => {
    const existing = await db.canvases.get(VIRTUAL_ROOT_ID)
    const record: StoredCanvasRecord = {
      nodeId: VIRTUAL_ROOT_ID,
      path: '',
      basePath: input.baseBlobSha ? '' : (existing?.basePath ?? null),
      doc: null,
      rawJson: input.rawJson,
      baseBlobSha: input.baseBlobSha ?? existing?.baseBlobSha ?? null,
      dirty: 0,
      loaded: true,
      corrupt: true,
      ...(input.corruptErrors ? { corruptErrors: input.corruptErrors } : {}),
      ...(input.newerSchemaVersion !== undefined
        ? { newerSchemaVersion: input.newerSchemaVersion }
        : {}),
      deletedAt: 0,
    }
    await db.canvases.put(record)
    return record
  })
}

export async function saveRootExtraFiles(
  db: KnovitesDatabase,
  extraFiles: readonly string[],
  now: string = new Date().toISOString(),
): Promise<string[]> {
  const normalized = parseStoredRootExtraFiles(extraFiles)
  await db.settings.put({
    key: ROOT_EXTRA_FILES_SETTING_KEY,
    value: normalized,
    updatedAt: now,
  })
  return normalized
}

export async function loadRootExtraFiles(db: KnovitesDatabase): Promise<string[]> {
  const setting = await db.settings.get(ROOT_EXTRA_FILES_SETTING_KEY)
  return parseStoredRootExtraFiles(setting?.value)
}

export async function saveAsset(db: KnovitesDatabase, asset: StoredAssetRecord): Promise<void> {
  const normalizedPath = normalizeAssetRelativePath(asset.path)
  const normalizedBasePath =
    asset.basePath !== null ? normalizeRepoRelativePath(asset.basePath) : null
  await db.assets.put({
    ...asset,
    path: normalizedPath,
    basePath: normalizedBasePath,
  })
}

/**
 * Loads all active (`deletedAt === 0`) records from IndexedDB into `TreeBuildEntry[]`
 * ready for `domain/tree.buildTree()`.
 * Uses primary-store `nodes.toArray()` plus `node.hasCanvas` (maintained on canvas
 * upsert/delete and backfilled during v1->v2 migration) to avoid redundant canvas scans.
 * Only emits a virtual root entry (`isVirtualRoot: true`) when root canvas, root assets,
 * or `rootExtraFiles` actually exist (preserving lazy creation on empty workspaces).
 */
export async function loadTreeBuildEntries(db: KnovitesDatabase): Promise<TreeBuildEntry[]> {
  const [nodes, assets, rootCanvas, rootExtraSetting] = await Promise.all([
    db.nodes.toArray(),
    db.assets.where('deletedAt').equals(0).toArray(),
    db.canvases.get(VIRTUAL_ROOT_ID),
    db.settings.get(ROOT_EXTRA_FILES_SETTING_KEY),
  ])

  const assetsByNodeId = new Map<string, string[]>()
  for (const asset of assets) {
    const list = assetsByNodeId.get(asset.nodeId) ?? []
    list.push(asset.path)
    assetsByNodeId.set(asset.nodeId, list)
  }

  const entries: TreeBuildEntry[] = []

  const activeRootCanvas = rootCanvas && rootCanvas.deletedAt === 0 ? rootCanvas : undefined
  const rootAssets = assetsByNodeId.get(VIRTUAL_ROOT_ID) ?? []
  const rootExtraFiles = parseStoredRootExtraFiles(rootExtraSetting?.value)
  if (activeRootCanvas !== undefined || rootAssets.length > 0 || rootExtraFiles.length > 0) {
    entries.push({
      path: '',
      isVirtualRoot: true,
      hasCanvas: activeRootCanvas !== undefined,
      assets: rootAssets,
      extraFiles: rootExtraFiles,
      ...(activeRootCanvas?.corrupt ? { corrupt: true } : {}),
      ...(activeRootCanvas?.corruptErrors ? { corruptErrors: activeRootCanvas.corruptErrors } : {}),
      ...(activeRootCanvas?.newerSchemaVersion !== undefined
        ? { newerSchemaVersion: activeRootCanvas.newerSchemaVersion }
        : {}),
    })
  }

  for (const node of nodes
    .filter((node) => node.deletedAt === 0)
    .sort((a, b) => compareLexicographical(a.path, b.path))) {
    const nodeAssets = assetsByNodeId.get(node.id) ?? []
    const hasCanvas = node.hasCanvas

    if (node.newerSchemaVersion !== undefined) {
      entries.push({
        path: node.path,
        parseResult: {
          status: 'newer-schema',
          schemaVersion: node.newerSchemaVersion,
        },
        assets: nodeAssets,
        extraFiles: [...node.extraFiles],
        hasCanvas,
      })
      continue
    }

    if (node.corrupt) {
      entries.push({
        path: node.path,
        parseResult: {
          status: 'corrupt',
          errors: node.corruptErrors ?? [],
        },
        assets: nodeAssets,
        extraFiles: [...node.extraFiles],
        hasCanvas,
      })
      continue
    }

    entries.push({
      path: node.path,
      node: node.meta,
      assets: nodeAssets,
      extraFiles: [...node.extraFiles],
      hasCanvas,
    })
  }

  return entries
}

/**
 * Marks a subtree (`nodes`, `canvases`, `assets`) as soft-deleted in a single transaction
 * for the 10-second Undo window without losing any local or remote SHA data.
 * Rejects attempts to soft-delete virtual root `'__root__'`.
 */
export async function softDeleteSubtree(
  db: KnovitesDatabase,
  input: SoftDeleteInput,
): Promise<void> {
  const targetIds = new Set(input.nodeIds)
  if (targetIds.size === 0) return
  if (targetIds.has(VIRTUAL_ROOT_ID)) {
    throw new Error(`Refusing to soft-delete virtual root "${VIRTUAL_ROOT_ID}".`)
  }

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

const EMPTY_RESTORE_RESULT: RestoreSoftDeleteResult = {
  restored: false,
  rootNodeId: null,
  oldPath: null,
  restoredPath: null,
  parentId: null,
  promotedToRoot: false,
  slugChanged: false,
  parentPathChanged: false,
}

/**
 * Restores a previously soft-deleted subtree (Undo within 10s window) atomically.
 * - If the original parent still exists by ID (even at a new path), restores under that parent.
 * - Only promotes to root (`parentId: null`) when the parent no longer exists.
 * - Resolves any sibling slug collision with `resolveUniqueSlug`, records old synced remote paths
 *   (`basePath`) into `pendingDeletes` when paths change, and returns details for Undo UI toasts.
 */
export async function restoreSoftDeletedSubtree(
  db: KnovitesDatabase,
  nodeIds: readonly string[],
  now: string = new Date().toISOString(),
): Promise<RestoreSoftDeleteResult> {
  if (nodeIds.length === 0) return EMPTY_RESTORE_RESULT

  return db.transaction(
    'rw',
    [db.nodes, db.canvases, db.assets, db.pendingDeletes],
    async (): Promise<RestoreSoftDeleteResult> => {
      const targetIdSet = new Set(nodeIds)
      const [activeNodes, softDeletedCandidates] = await Promise.all([
        db.nodes.where('deletedAt').equals(0).toArray(),
        db.nodes.bulkGet([...targetIdSet]),
      ])
      const softDeletedNodes = softDeletedCandidates.filter(
        (n): n is StoredNodeRecord => n !== undefined && n.deletedAt > 0,
      )

      if (softDeletedNodes.length === 0) return EMPTY_RESTORE_RESULT

      const activeById = new Map(activeNodes.map((n) => [n.id, n]))
      const restoredIdSet = new Set(softDeletedNodes.map((n) => n.id))

      const rootNode =
        softDeletedNodes.find((n) => n.parentId === null || !restoredIdSet.has(n.parentId)) ??
        softDeletedNodes[0]!

      const originalParentPath = resolveParentPath(rootNode.path)
      const activeParent =
        rootNode.parentId !== null ? activeById.get(rootNode.parentId) : undefined
      const effectiveParentId = activeParent ? activeParent.id : null
      const parentPath = activeParent ? activeParent.path : null
      const promotedToRoot = rootNode.parentId !== null && activeParent === undefined
      const parentPathChanged =
        activeParent !== undefined && activeParent.path !== originalParentPath

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
        if (moved && (node.baseBlobSha !== null || node.basePath !== null)) {
          const remoteOldPath = node.basePath ?? node.path
          oldPathsToPendingDelete.push({
            path: `${remoteOldPath}/node.json`,
            baseBlobSha: node.baseBlobSha,
            deletedAt: now,
          })
          for (const extraFile of node.extraFiles) {
            oldPathsToPendingDelete.push({
              path: `${remoteOldPath}/${extraFile}`,
              baseBlobSha: null,
              deletedAt: now,
            })
          }
        }
        return {
          ...node,
          parentId: node.id === rootNode.id ? effectiveParentId : node.parentId,
          path: nextPath,
          basePath: node.basePath,
          dirty: moved ? 1 : node.dirty,
          deletedAt: 0,
        }
      })
      await db.nodes.bulkPut(restoredNodes)

      const canvases = await db.canvases.bulkGet([...targetIdSet])
      const restoredCanvases: StoredCanvasRecord[] = []
      for (const canvas of canvases) {
        if (!canvas || canvas.deletedAt === 0) continue
        const nextPath = remapPath(canvas.path)
        const moved = nextPath !== canvas.path
        if (moved && (canvas.baseBlobSha !== null || canvas.basePath !== null)) {
          const remoteOldPath = canvas.basePath ?? canvas.path
          oldPathsToPendingDelete.push({
            path: `${remoteOldPath}/canvas.json`,
            baseBlobSha: canvas.baseBlobSha,
            deletedAt: now,
          })
        }
        restoredCanvases.push({
          ...canvas,
          path: nextPath,
          basePath: canvas.basePath,
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
        if (ownerPathChanged && oldOwner && (asset.sha !== null || asset.basePath !== null)) {
          oldPathsToPendingDelete.push({
            path: asset.basePath ?? `${oldOwner.path}/${asset.path}`,
            baseBlobSha: asset.sha,
            deletedAt: now,
          })
        }
        restoredAssets.push({
          ...asset,
          basePath: asset.basePath,
          dirty: ownerPathChanged ? 1 : asset.dirty,
          deletedAt: 0,
        })
      }
      if (restoredAssets.length > 0) {
        await db.assets.bulkPut(restoredAssets)
      }

      if (oldPathsToPendingDelete.length > 0) {
        await db.pendingDeletes.bulkPut(oldPathsToPendingDelete)
      }

      return {
        restored: true,
        rootNodeId: rootNode.id,
        oldPath: oldRootPath,
        restoredPath: targetRootPath,
        parentId: effectiveParentId,
        promotedToRoot,
        slugChanged: uniqueSlug !== originalSlug,
        parentPathChanged,
      }
    },
  )
}

/**
 * Finalizes all soft-deleted rows (or only the specified `nodeIds`) into `pendingDeletes`
 * and removes their soft-deleted records in one atomic transaction.
 * Unconditionally records both current paths and any prior synced `basePath` paths
 * so sync (`getEffectiveDeletes`) can clean up all obsolete remote files.
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
      pendingMap.set(resolveNodeFilePath(node.path), {
        path: resolveNodeFilePath(node.path),
        baseBlobSha: node.baseBlobSha,
        deletedAt,
      })
      if (node.hasCanvas) {
        pendingMap.set(resolveCanvasFilePath(node.path), {
          path: resolveCanvasFilePath(node.path),
          baseBlobSha: null,
          deletedAt,
        })
      }
      for (const extraFile of node.extraFiles) {
        const extraPath = resolveExtraFilePath(node.path, extraFile)
        pendingMap.set(extraPath, {
          path: extraPath,
          baseBlobSha: null,
          deletedAt,
        })
      }
      if (node.basePath !== null && node.basePath !== node.path) {
        pendingMap.set(resolveNodeFilePath(node.basePath), {
          path: resolveNodeFilePath(node.basePath),
          baseBlobSha: node.baseBlobSha,
          deletedAt,
        })
        if (node.hasCanvas) {
          pendingMap.set(resolveCanvasFilePath(node.basePath), {
            path: resolveCanvasFilePath(node.basePath),
            baseBlobSha: null,
            deletedAt,
          })
        }
        for (const extraFile of node.extraFiles) {
          const extraPath = resolveExtraFilePath(node.basePath, extraFile)
          pendingMap.set(extraPath, {
            path: extraPath,
            baseBlobSha: null,
            deletedAt,
          })
        }
      }
    }

    for (const canvas of canvasesToFinalize) {
      const deletedAt = toIsoUtc(canvas.deletedAt, now)
      const canvasOwnerPath = isVirtualRootId(canvas.nodeId) ? '' : canvas.path
      const canvasFilePath = resolveCanvasFilePath(canvasOwnerPath)
      pendingMap.set(canvasFilePath, {
        path: canvasFilePath,
        baseBlobSha: canvas.baseBlobSha,
        deletedAt,
      })
      if (canvas.basePath !== null && canvas.basePath !== canvasOwnerPath) {
        const baseCanvasPath = resolveCanvasFilePath(canvas.basePath)
        pendingMap.set(baseCanvasPath, {
          path: baseCanvasPath,
          baseBlobSha: canvas.baseBlobSha,
          deletedAt,
        })
      }
    }

    for (const asset of assetsToFinalize) {
      const ownerPath = isVirtualRootId(asset.nodeId) ? '' : nodeById.get(asset.nodeId)?.path
      if (ownerPath === undefined) continue
      const fullPath = resolveAssetFilePath(ownerPath, asset.path)
      const deletedAt = toIsoUtc(asset.deletedAt, now)
      pendingMap.set(fullPath, {
        path: fullPath,
        baseBlobSha: asset.sha,
        deletedAt,
      })
      if (asset.basePath !== null && asset.basePath !== fullPath) {
        pendingMap.set(asset.basePath, {
          path: asset.basePath,
          baseBlobSha: asset.sha,
          deletedAt,
        })
      }
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

async function loadActiveStateForDiff(db: KnovitesDatabase): Promise<{
  nodes: StoredNodeRecord[]
  canvases: StoredCanvasRecord[]
  assets: StoredAssetRecord[]
  activeNodeById: Map<string, StoredNodeRecord>
  activePaths: Set<string>
}> {
  const [nodes, canvases, assets, rootExtraSetting] = await Promise.all([
    db.nodes.toArray(),
    db.canvases.toArray(),
    db.assets.where('deletedAt').equals(0).toArray(),
    db.settings.get(ROOT_EXTRA_FILES_SETTING_KEY),
  ])

  const activePaths = new Set<string>()
  const activeNodeById = new Map<string, StoredNodeRecord>()

  for (const node of nodes) {
    if (node.deletedAt !== 0) continue
    activeNodeById.set(node.id, node)
    activePaths.add(resolveNodeFilePath(node.path))
    if (node.hasCanvas) {
      activePaths.add(resolveCanvasFilePath(node.path))
    }
    for (const extraFile of node.extraFiles) {
      activePaths.add(resolveExtraFilePath(node.path, extraFile))
    }
  }

  for (const canvas of canvases) {
    if (canvas.deletedAt !== 0) continue
    activePaths.add(resolveCanvasFilePath(isVirtualRootId(canvas.nodeId) ? '' : canvas.path))
  }

  for (const asset of assets) {
    if (isVirtualRootId(asset.nodeId)) {
      activePaths.add(resolveAssetFilePath('', asset.path))
      continue
    }
    const owner = activeNodeById.get(asset.nodeId)
    if (owner) {
      activePaths.add(resolveAssetFilePath(owner.path, asset.path))
    }
  }

  for (const rootExtra of parseStoredRootExtraFiles(rootExtraSetting?.value)) {
    activePaths.add(resolveExtraFilePath('', rootExtra))
  }

  return { nodes, canvases, assets, activeNodeById, activePaths }
}

/**
 * Computes the effective remote deletions (`pendingDeletes` minus paths present in the current
 * active local state).
 *
 * `finalizeSoftDeletes`, moves of synced records (`basePath`), and path-changing Undos record
 * obsolete remote paths into `pendingDeletes` unconditionally, even when a new node later occupies
 * the same path (because the replacement node might subsequently be moved or deleted before sync).
 * Sync calls `getEffectiveDeletes` so remote commits only delete paths absent in the final state.
 */
export async function getEffectiveDeletes(db: KnovitesDatabase): Promise<PendingDeleteRecord[]> {
  const pendingDeletes = await db.pendingDeletes.orderBy('path').toArray()
  if (pendingDeletes.length === 0) {
    return []
  }

  const { activePaths } = await loadActiveStateForDiff(db)
  return pendingDeletes.filter((entry) => !activePaths.has(entry.path))
}

/**
 * Returns old remote `basePath` file paths for active records whose current path differs
 * from `basePath` and whose old path is not occupied by any active file in the final state.
 */
export async function getMovedBasePaths(db: KnovitesDatabase): Promise<string[]> {
  const { nodes, canvases, assets, activeNodeById, activePaths } = await loadActiveStateForDiff(db)
  const movedPaths = new Set<string>()

  for (const node of nodes) {
    if (node.deletedAt !== 0 || node.basePath === null || node.basePath === node.path) continue
    const nodeJsonPath = resolveNodeFilePath(node.basePath)
    if (!activePaths.has(nodeJsonPath)) movedPaths.add(nodeJsonPath)
    for (const extraFile of node.extraFiles) {
      const extraPath = resolveExtraFilePath(node.basePath, extraFile)
      if (!activePaths.has(extraPath)) movedPaths.add(extraPath)
    }
  }

  for (const canvas of canvases) {
    if (canvas.deletedAt !== 0 || canvas.basePath === null) continue
    const currentOwnerPath = isVirtualRootId(canvas.nodeId) ? '' : canvas.path
    if (canvas.basePath === currentOwnerPath) continue
    const canvasPath = resolveCanvasFilePath(canvas.basePath)
    if (!activePaths.has(canvasPath)) movedPaths.add(canvasPath)
  }

  for (const asset of assets) {
    if (asset.basePath === null) continue
    const ownerPath = isVirtualRootId(asset.nodeId) ? '' : activeNodeById.get(asset.nodeId)?.path
    if (ownerPath === undefined) continue
    const currentFullPath = resolveAssetFilePath(ownerPath, asset.path)
    if (asset.basePath !== currentFullPath && !activePaths.has(asset.basePath)) {
      movedPaths.add(asset.basePath)
    }
  }

  return [...movedPaths].sort(compareLexicographical)
}

/**
 * Collects all dirty active local records (`dirty === 1 && deletedAt === 0`)
 * plus effective remote deletions (`getEffectiveDeletes`) ready for sync.
 * Supports virtual root (`'__root__'`) canvases (`'canvas.json'`) and assets (`'assets/<file>'`)
 * without requiring a `db.nodes` row and never emitting a leading slash.
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
      path: resolveNodeFilePath(node.path),
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
      path: resolveCanvasFilePath(isVirtualRootId(canvas.nodeId) ? '' : canvas.path),
      rawJson: canvas.rawJson,
      baseBlobSha: canvas.baseBlobSha,
    })
  }

  const dirtyAssets: CollectedDirtyFiles['assets'] = []
  if (dirtyAssetRows.length > 0) {
    const activeDirtyAssets = dirtyAssetRows.filter((a) => a.deletedAt === 0)
    const nonRootOwnerIds = [
      ...new Set(activeDirtyAssets.filter((a) => !isVirtualRootId(a.nodeId)).map((a) => a.nodeId)),
    ]
    const owners = nonRootOwnerIds.length > 0 ? await db.nodes.bulkGet(nonRootOwnerIds) : []
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
      if (isVirtualRootId(asset.nodeId)) {
        dirtyAssets.push({
          nodeId: asset.nodeId,
          path: resolveAssetFilePath('', asset.path),
          blob: asset.blob,
          sha: asset.sha,
        })
        continue
      }
      const owner = ownerById.get(asset.nodeId)
      if (!owner) continue
      dirtyAssets.push({
        nodeId: asset.nodeId,
        path: resolveAssetFilePath(owner.path, asset.path),
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
