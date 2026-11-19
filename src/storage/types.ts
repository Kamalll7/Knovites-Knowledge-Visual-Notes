import type { CanvasJson, NodeJson, SchemaIssue } from '@/domain/schema'

export const CURRENT_DB_SCHEMA_VERSION = 1
export const DEFAULT_DB_NAME = 'knovites-local'
export const MAX_ERROR_LOG_ENTRIES = 100

export interface StoredNodeRecord {
  id: string
  path: string
  parentId: string | null
  meta: NodeJson
  rawNodeJson: string
  baseBlobSha: string | null
  dirty: boolean
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  extraFiles: string[]
  hasCanvas: boolean
  deletedAt: string | null
}

export interface StoredCanvasRecord {
  nodeId: string
  path: string
  doc: CanvasJson | null
  rawJson: string
  baseBlobSha: string | null
  dirty: boolean
  loaded: boolean
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  deletedAt: string | null
}

export interface StoredAssetRecord {
  nodeId: string
  /** Relative to the node folder, e.g. `assets/3fa9c1d2e4b5a671.webp` */
  path: string
  blob: Uint8Array | Blob
  sha: string | null
  dirty: boolean
  deletedAt: string | null
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

export interface SoftDeleteInput {
  nodeIds: readonly string[]
  deletedAt: string
}
