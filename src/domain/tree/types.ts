import type { NodeJson, NodeStatus, NodeType, ParseResult, SchemaIssue } from '@/domain/schema'

export const FORBIDDEN_SLUGS = new Set(['assets', '.git', '.github', 'node_modules'])

export interface FileUpsert {
  path: string
  content: string
}

export interface FileMove {
  from: string
  to: string
}

/**
 * Atomic set of repository file mutations returned by pure tree operations.
 *
 * Semantik penerapan `Changeset` oleh applier (`storage/` / `sync/`):
 * 1. **Urutan eksekusi wajib:** terapkan `deletes` terlebih dahulu, lalu `moves`,
 *    lalu `upserts` (`deletes` -> `moves` -> `upserts`). Saat menerapkan `moves`,
 *    baca semua sumber `from` sebelum menulis ke `to` agar pemindahan subtree atau
 *    pertukaran path di dalam satu changeset tidak saling menimpa.
 * 2. **Path yang sama di `moves` dan `upserts`:** path target yang sama **boleh**
 *    muncul sekaligus sebagai `moves[i].to` dan `upserts[j].path` — misalnya pada
 *    `moveNode`, di mana `<oldPath>/node.json -> <newPath>/node.json` dicatat di
 *    `moves` (memindahkan entri file) dan `<newPath>/node.json` juga dicatat di
 *    `upserts` dengan `order` dan `updatedAt` baru.
 * 3. **Isi `upserts` menang:** karena `upserts` selalu dijalankan terakhir, isi
 *    file di `upserts` menimpa dan mengalahkan isi hasil `moves` pada path yang sama.
 */
export interface Changeset {
  upserts: FileUpsert[]
  moves: FileMove[]
  deletes: string[]
}

export const EMPTY_CHANGESET: Changeset = {
  upserts: [],
  moves: [],
  deletes: [],
}

export interface TreeIssue {
  path: string
  code:
    | 'duplicate_id_repaired'
    | 'corrupt_node'
    | 'newer_schema_node'
    | 'forbidden_folder_ignored'
    | 'missing_parent_ignored'
    | 'duplicate_path_ignored'
  message: string
  oldId?: string
  newId?: string
}

export interface TreeNode {
  id: string
  slug: string
  path: string
  parentId: string | null
  meta: NodeJson
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  childrenIds: string[]
  /** All files inside `<nodePath>/assets/`, including orphan assets not referenced by `canvas.json`. */
  assets: string[]
  /** Unreferenced or unknown relative files inside `<nodePath>/` (outside `node.json`, `canvas.json`, and `assets/`). */
  extraFiles: string[]
  hasCanvas: boolean
}

export interface TreeState {
  nodes: Record<string, TreeNode>
  rootIds: string[]
}

export interface TreeBuildEntry {
  path: string
  node?: NodeJson
  parseResult?: ParseResult<NodeJson>
  corrupt?: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
  /** Files under `<nodePath>/assets/` supplied by the repository scanner (including orphan assets). */
  assets?: string[]
  /** Other unknown files directly or nested under `<nodePath>/` supplied by the repository scanner. */
  extraFiles?: string[]
  hasCanvas?: boolean
}

export interface BuildTreeOptions {
  generateId?: () => string
}

export interface BuildTreeResult {
  state: TreeState
  issues: TreeIssue[]
  changeset: Changeset
}

export type TreeOperationErrorReason =
  | 'not_found'
  | 'parent_not_found'
  | 'corrupt_node'
  | 'newer_schema_node'
  | 'cycle_detected'
  | 'invalid_title'
  | 'invalid_timestamp'
  | 'invalid_id'

export type TreeOperationResult =
  | {
      ok: true
      state: TreeState
      changeset: Changeset
      nodeId: string
    }
  | {
      ok: false
      reason: TreeOperationErrorReason
      message: string
      state: TreeState
      changeset: Changeset
    }

export interface CreateNodeInput {
  title: string
  parentId: string | null
  now: string
  generateId: () => string
  type?: NodeType
  status?: NodeStatus
  tags?: string[]
  color?: string | null
}

export interface RenameNodeInput {
  nodeId: string
  title: string
  now: string
}

export interface MoveNodeInput {
  nodeId: string
  newParentId: string | null
  now: string
}

export type ReorderNodeInput =
  | {
      nodeId: string
      direction: 'earlier' | 'later'
      now: string
    }
  | {
      nodeId: string
      targetIndex: number
      now: string
    }

export interface DeleteNodeInput {
  nodeId: string
}
