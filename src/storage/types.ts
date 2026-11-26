import type { CanvasJson, NodeJson, SchemaIssue } from '@/domain/schema'

export const CURRENT_DB_SCHEMA_VERSION = 3
export const DEFAULT_DB_NAME = 'knovites-local'
export const MAX_ERROR_LOG_ENTRIES = 100
export const ROOT_EXTRA_FILES_SETTING_KEY = 'workspace.rootExtraFiles' as const

/** Numeric flag stored in IndexedDB because W3C IndexedDB forbids booleans as index keys. */
export type IndexedFlag = 0 | 1

export interface StoredNodeRecord {
  id: string
  path: string
  /** Last synced folder path (`null` if never synced to remote). Preserved across local moves/undos. */
  basePath: string | null
  parentId: string | null
  meta: NodeJson
  rawNodeJson: string
  baseBlobSha: string | null
  dirty: IndexedFlag
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  extraFiles: string[]
  hasCanvas: boolean
  /** `0` when active, positive epoch ms when soft-deleted awaiting 10s Undo window. */
  deletedAt: number
}

export interface StoredCanvasRecord {
  /** Node ULID, or `VIRTUAL_ROOT_ID` (`'__root__'`) for the optional home canvas at repo root. */
  nodeId: string
  /** Node folder path, or `''` when `nodeId === '__root__'` (repo file `'canvas.json'`). */
  path: string
  /** Last synced node folder path (`''` for synced `'__root__'`, `null` if never synced). */
  basePath: string | null
  doc: CanvasJson | null
  rawJson: string
  baseBlobSha: string | null
  dirty: IndexedFlag
  loaded: boolean
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  /** `0` when active, positive epoch ms when soft-deleted awaiting 10s Undo window. */
  deletedAt: number
}

export interface StoredAssetRecord {
  /** Node ULID, or `VIRTUAL_ROOT_ID` (`'__root__'`) for home root assets under `assets/`. */
  nodeId: string
  /** Relative to the owner folder (without leading slash), e.g. `assets/3fa9c1d2e4b5a671.webp` */
  path: string
  /** Full repo-relative asset path at last sync (without leading slash), or `null` if never synced. */
  basePath: string | null
  blob: Uint8Array | Blob
  sha: string | null
  dirty: IndexedFlag
  /** `0` when active, positive epoch ms when soft-deleted awaiting 10s Undo window. */
  deletedAt: number
}

export interface PendingDeleteRecord {
  path: string
  baseBlobSha: string | null
  deletedAt: string
}

export interface SyncStateRecord {
  id: 'singleton'
  repo: string | null
  branch: string | null
  baseCommitSha: string | null
  lastSyncedAt: string | null
  pendingMerge: unknown | null
}

export interface SettingRecord {
  key: string
  value: unknown
  updatedAt: string
}

export type ErrorLogLevel = 'info' | 'warn' | 'error'

export interface ErrorLogRecord {
  id?: number
  timestamp: string
  level: ErrorLogLevel
  code: string
  message: string
  context?: string
}

export interface ApplyChangesetOptions {
  now?: string
  /** Optional hook executed inside the Dexie transaction for failure-injection tests. */
  onAfterStep?: (step: 'deletes' | 'moves' | 'upserts') => void
}

export interface InvalidNodeInput {
  path: string
  rawNodeJson: string
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  baseBlobSha?: string | null
  extraFiles?: string[]
  hasCanvas?: boolean
}

export interface InvalidRootCanvasInput {
  rawJson: string
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  baseBlobSha?: string | null
}

export interface SoftDeleteInput {
  nodeIds: readonly string[]
  deletedAt: string
}

export interface DirtyNodeFile {
  nodeId: string
  path: string
  rawNodeJson: string
  baseBlobSha: string | null
}

export interface DirtyCanvasFile {
  nodeId: string
  path: string
  rawJson: string
  baseBlobSha: string | null
}

export interface DirtyAssetFile {
  nodeId: string
  path: string
  blob: Uint8Array | Blob
  sha: string | null
}

export interface CollectedDirtyFiles {
  nodes: DirtyNodeFile[]
  canvases: DirtyCanvasFile[]
  assets: DirtyAssetFile[]
  pendingDeletes: PendingDeleteRecord[]
}

export interface RestoreSoftDeleteResult {
  restored: boolean
  rootNodeId: string | null
  oldPath: string | null
  restoredPath: string | null
  parentId: string | null
  promotedToRoot: boolean
  slugChanged: boolean
  parentPathChanged: boolean
}
