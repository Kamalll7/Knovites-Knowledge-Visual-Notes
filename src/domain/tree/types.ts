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
  assets: string[]
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
  assets?: string[]
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
