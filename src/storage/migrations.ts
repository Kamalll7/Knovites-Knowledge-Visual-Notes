import type Dexie from 'dexie'
import type { Transaction } from 'dexie'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
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

  await tx
    .table('nodes')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
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
      record['dirty'] = toIndexedFlag(record['dirty'])
      record['deletedAt'] = toDeletedEpochMs(record['deletedAt'])
    })
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
}
