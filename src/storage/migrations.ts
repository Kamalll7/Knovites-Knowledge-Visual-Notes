import type Dexie from 'dexie'
import type { Transaction } from 'dexie'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import {
  VIRTUAL_ROOT_ID,
  isVirtualRootId,
  normalizeAssetRelativePath,
  normalizeRepoRelativePath,
  resolveAssetFilePath,
} from '@/domain/tree'
import { CURRENT_DB_SCHEMA_VERSION } from '@/storage/types'

export const DB_V1_STORES: Record<string, string> = {
  nodes: 'id, path, parentId',
  canvases: 'nodeId, path',
  assets: '[nodeId+path], nodeId, path',
  pendingDeletes: 'path, deletedAt',
  syncState: 'id',
  settings: 'key',
  errorLog: '++id, timestamp, level, code',
}

export const DB_V2_STORES: Record<string, string> = {
  nodes: 'id, path, parentId, dirty, deletedAt',
  canvases: 'nodeId, path, dirty, deletedAt',
  assets: '[nodeId+path], nodeId, path, dirty, deletedAt',
  pendingDeletes: 'path, deletedAt',
  syncState: 'id',
  settings: 'key',
  errorLog: '++id, timestamp, level, code',
}

/**
 * Dexie v3 keeps all 7 M2 tables and indexes intact (non-destructive upgrade)
 * while normalizing virtual root (`'__root__'`) canvas/asset contracts without leading slashes.
 */
export const DB_V3_STORES: Record<string, string> = {
  ...DB_V2_STORES,
}

function toIndexedFlag(value: unknown): 0 | 1 {
  return value === true || value === 1 ? 1 : 0
}

function toDeletedEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }
  return 0
}

async function upgradeV1ToV2(tx: Transaction): Promise<void> {
  const canvasNodeIds = new Set<unknown>(await tx.table('canvases').toCollection().primaryKeys())
  const nodePathById = new Map<unknown, string>()

  await tx
    .table('nodes')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (typeof record['path'] === 'string') {
        nodePathById.set(record['id'], record['path'])
      }
      if (record['basePath'] === undefined) {
        record['basePath'] =
          record['baseBlobSha'] != null && typeof record['path'] === 'string'
            ? record['path']
            : null
      }
      record['dirty'] = toIndexedFlag(record['dirty'])
      record['deletedAt'] = toDeletedEpochMs(record['deletedAt'])
      if (record['extraFiles'] === undefined) {
        record['extraFiles'] = []
      }
      record['hasCanvas'] = Boolean(record['hasCanvas']) || canvasNodeIds.has(record['id'])
      if (record['rawNodeJson'] === undefined && record['meta'] !== undefined) {
        record['rawNodeJson'] = serializeNodeJson(
          record['meta'] as Parameters<typeof serializeNodeJson>[0],
        )
      }
    })

  await tx
    .table('canvases')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (record['basePath'] === undefined) {
        record['basePath'] =
          record['baseBlobSha'] != null && typeof record['path'] === 'string'
            ? record['path']
            : null
      }
      record['dirty'] = toIndexedFlag(record['dirty'])
      record['deletedAt'] = toDeletedEpochMs(record['deletedAt'])
      if (record['corrupt'] === undefined) {
        record['corrupt'] = false
      }
      if (record['rawJson'] === undefined && record['doc'] != null) {
        record['rawJson'] = serializeCanvasJson(
          record['doc'] as Parameters<typeof serializeCanvasJson>[0],
        )
      }
    })

  await tx
    .table('assets')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (record['basePath'] === undefined) {
        const nodeId = record['nodeId']
        const ownerPath =
          typeof nodeId === 'string' && isVirtualRootId(nodeId) ? '' : nodePathById.get(nodeId)
        record['basePath'] =
          record['sha'] != null && ownerPath !== undefined && typeof record['path'] === 'string'
            ? resolveAssetFilePath(ownerPath, record['path'])
            : null
      }
      record['dirty'] = toIndexedFlag(record['dirty'])
      record['deletedAt'] = toDeletedEpochMs(record['deletedAt'])
    })
}

async function upgradeV2ToV3(tx: Transaction): Promise<void> {
  // Non-destructive normalization: only touches __root__ canvas/asset records if present;
  // all existing M2 nodes, canvases, assets, pendingDeletes, syncState, settings, and errorLog survive intact.
  const rootCanvas = (await tx.table('canvases').get(VIRTUAL_ROOT_ID)) as
    Record<string, unknown> | undefined
  if (rootCanvas) {
    const rawBasePath = rootCanvas['basePath']
    const normalizedBasePath =
      typeof rawBasePath === 'string' ? '' : rootCanvas['baseBlobSha'] != null ? '' : null
    await tx.table('canvases').put({
      ...rootCanvas,
      nodeId: VIRTUAL_ROOT_ID,
      path: '',
      basePath: normalizedBasePath,
      deletedAt: 0,
    })
  }

  const rootAssets = (await tx
    .table('assets')
    .where('nodeId')
    .equals(VIRTUAL_ROOT_ID)
    .toArray()) as Array<Record<string, unknown>>
  for (const asset of rootAssets) {
    const rawPath = asset['path']
    if (typeof rawPath !== 'string' || rawPath.length === 0) continue
    const normalizedPath = normalizeAssetRelativePath(rawPath)
    const rawBasePath = asset['basePath']
    const normalizedBasePath =
      typeof rawBasePath === 'string' && rawBasePath.length > 0
        ? normalizeRepoRelativePath(rawBasePath)
        : asset['sha'] != null
          ? resolveAssetFilePath('', normalizedPath)
          : null

    if (normalizedPath !== rawPath) {
      await tx.table('assets').delete([VIRTUAL_ROOT_ID, rawPath])
    }
    await tx.table('assets').put({
      ...asset,
      nodeId: VIRTUAL_ROOT_ID,
      path: normalizedPath,
      basePath: normalizedBasePath,
      deletedAt: 0,
    })
  }
}

/**
 * Registers all Dexie schema versions and upgrade hooks up to `targetVersion`.
 */
export function applyDatabaseMigrations(
  db: Dexie,
  targetVersion: number = CURRENT_DB_SCHEMA_VERSION,
): void {
  db.version(1).stores(DB_V1_STORES)

  if (targetVersion >= 2) {
    db.version(2).stores(DB_V2_STORES).upgrade(upgradeV1ToV2)
  }

  if (targetVersion >= 3) {
    db.version(3).stores(DB_V3_STORES).upgrade(upgradeV2ToV3)
  }
}
