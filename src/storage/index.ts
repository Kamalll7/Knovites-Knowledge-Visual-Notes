export { KnovitesDatabase, createKnovitesDatabase } from '@/storage/db'
export { DB_V1_STORES, DB_V2_STORES, applyDatabaseMigrations } from '@/storage/migrations'
export {
  appendErrorLog,
  applyChangeset,
  collectDirtyFiles,
  finalizeSoftDeletes,
  getErrorLogs,
  getPendingDeletes,
  loadTreeBuildEntries,
  restoreSoftDeletedSubtree,
  saveAsset,
  saveInvalidNode,
  softDeleteSubtree,
} from '@/storage/repository'
export {
  CURRENT_DB_SCHEMA_VERSION,
  DEFAULT_DB_NAME,
  MAX_ERROR_LOG_ENTRIES,
  type ApplyChangesetOptions,
  type CollectedDirtyFiles,
  type DirtyAssetFile,
  type DirtyCanvasFile,
  type DirtyNodeFile,
  type ErrorLogLevel,
  type ErrorLogRecord,
  type IndexedFlag,
  type InvalidNodeInput,
  type PendingDeleteRecord,
  type SettingRecord,
  type SoftDeleteInput,
  type StoredAssetRecord,
  type StoredCanvasRecord,
  type StoredNodeRecord,
  type SyncStateRecord,
} from '@/storage/types'
export { requestPersistentStorage, type StoragePersistNavigator } from '@/storage/persist'
export {
  createBrowserTabLockCoordinator,
  createFakeTabLockRegistry,
  type BrowserTabLockOptions,
  type FakeTabLockRegistry,
  type TabLockCoordinator,
  type TabLockRole,
} from '@/storage/tab-lock'
