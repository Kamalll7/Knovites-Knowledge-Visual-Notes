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

async function upgradeV1ToV2(tx: Transaction): Promise<void> {
  await tx
    .table('nodes')
    .toCollection()
    .modify((record: Record<string, unknown>) => {
      if (record['extraFiles'] === undefined) {
        record['extraFiles'] = []
      }
      if (record['deletedAt'] === undefined) {
        record['deletedAt'] = null
      }
      if (record['hasCanvas'] === undefined) {
        record['hasCanvas'] = false
      }
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
      if (record['corrupt'] === undefined) {
        record['corrupt'] = false
      }
      if (record['deletedAt'] === undefined) {
        record['deletedAt'] = null
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
      if (record['deletedAt'] === undefined) {
        record['deletedAt'] = null
      }
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
    db.version(2).stores(DB_V1_STORES).upgrade(upgradeV1ToV2)
  }
}
