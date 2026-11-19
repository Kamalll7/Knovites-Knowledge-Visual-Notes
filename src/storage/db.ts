import Dexie, { type DexieOptions, type EntityTable, type Table } from 'dexie'
import { applyDatabaseMigrations } from '@/storage/migrations'
import {
  CURRENT_DB_SCHEMA_VERSION,
  DEFAULT_DB_NAME,
  type ErrorLogRecord,
  type PendingDeleteRecord,
  type SettingRecord,
  type StoredAssetRecord,
  type StoredCanvasRecord,
  type StoredNodeRecord,
  type SyncStateRecord,
} from '@/storage/types'

export class KnovitesDatabase extends Dexie {
  declare nodes: EntityTable<StoredNodeRecord, 'id'>
  declare canvases: EntityTable<StoredCanvasRecord, 'nodeId'>
  declare assets: Table<StoredAssetRecord, [string, string]>
  declare pendingDeletes: EntityTable<PendingDeleteRecord, 'path'>
  declare syncState: EntityTable<SyncStateRecord, 'id'>
  declare settings: EntityTable<SettingRecord, 'key'>
  declare errorLog: EntityTable<ErrorLogRecord, 'id'>

  constructor(name: string = DEFAULT_DB_NAME, options?: DexieOptions) {
    super(name, options)
    applyDatabaseMigrations(this, CURRENT_DB_SCHEMA_VERSION)
  }
}

export function createKnovitesDatabase(
  name: string = DEFAULT_DB_NAME,
  options?: DexieOptions,
): KnovitesDatabase {
  return new KnovitesDatabase(name, options)
}
