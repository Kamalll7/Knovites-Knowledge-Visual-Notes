import { castDraft } from 'immer'
import { createStore, type StoreApi } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createIdGenerator, nowUtcIso } from '@/app/clock-id'
import type { NodeStatus, NodeType } from '@/domain/schema'
import {
  buildTree,
  createNode as domainCreateNode,
  deleteNode as domainDeleteNode,
  moveNode as domainMoveNode,
  renameNode as domainRenameNode,
  reorderNode as domainReorderNode,
  type Changeset,
  type ReorderNodeInput,
  type TreeBuildEntry,
  type TreeIssue,
  type TreeOperationErrorReason,
  type TreeState,
} from '@/domain/tree'
import {
  appendErrorLog,
  applyChangeset,
  finalizeSoftDeletes,
  loadTreeBuildEntries,
  restoreSoftDeletedSubtree,
  softDeleteSubtree,
  type ErrorLogRecord,
  type KnovitesDatabase,
} from '@/storage'

export const UNDO_DELETE_TIMEOUT_MS = 10_000

export interface StorageErrorState {
  code: string
  message: string
}

export interface PendingUndoDelete {
  rootNodeId: string
  title: string
  nodeIds: string[]
  deletedAt: string
}

export type StoreActionErrorReason = TreeOperationErrorReason | 'readonly_tab' | 'storage_error'

export type StoreOperationResult =
  | {
      ok: true
      nodeId: string
    }
  | {
      ok: false
      reason: StoreActionErrorReason
      message: string
    }

export interface WorkspaceStorageAdapter {
  loadEntries: () => Promise<TreeBuildEntry[]>
  applyChangeset: (changeset: Changeset, options?: { now?: string }) => Promise<void>
  softDeleteSubtree: (nodeIds: readonly string[], deletedAt: string) => Promise<void>
  restoreSoftDeletedSubtree: (nodeIds: readonly string[], now?: string) => Promise<void>
  finalizeSoftDeletes: (now: string, nodeIds?: readonly string[]) => Promise<void>
  appendErrorLog: (entry: ErrorLogRecord) => Promise<void>
}

export interface WorkspaceStoreDeps {
  storage: WorkspaceStorageAdapter
  now?: () => string
  generateId?: () => string
  undoTimeoutMs?: number
  initialReadOnly?: boolean
  initialLockSupported?: boolean
  onTakeOverWriter?: () => Promise<void>
}

export interface WorkspaceStoreState {
  hydrated: boolean
  tree: TreeState
  issues: TreeIssue[]
  pendingUndoDelete: PendingUndoDelete | null
  hasUnsavedChanges: boolean
  storageError: StorageErrorState | null
  isReadOnlyTab: boolean
  isLockSupported: boolean
  hydrate: () => Promise<void>
  createNode: (input: {
    title: string
    parentId: string | null
    type?: NodeType
    status?: NodeStatus
    tags?: string[]
    color?: string | null
  }) => Promise<StoreOperationResult>
  renameNode: (input: { nodeId: string; title: string }) => Promise<StoreOperationResult>
  moveNode: (input: { nodeId: string; newParentId: string | null }) => Promise<StoreOperationResult>
  reorderNode: (
    input:
      { nodeId: string; direction: 'earlier' | 'later' } | { nodeId: string; targetIndex: number },
  ) => Promise<StoreOperationResult>
  deleteNode: (nodeId: string) => Promise<StoreOperationResult>
  undoDelete: () => Promise<boolean>
  finalizePendingDelete: () => Promise<void>
  retrySave: () => Promise<boolean>
  setReadOnlyTab: (readOnly: boolean) => void
  setLockSupported: (supported: boolean) => void
  takeOverWriterLock: () => Promise<void>
  dispose: () => void
}

export type WorkspaceStoreApi = StoreApi<WorkspaceStoreState>

export function createDexieWorkspaceAdapter(db: KnovitesDatabase): WorkspaceStorageAdapter {
  return {
    loadEntries: () => loadTreeBuildEntries(db),
    applyChangeset: (changeset, options) => applyChangeset(db, changeset, options),
    softDeleteSubtree: (nodeIds, deletedAt) => softDeleteSubtree(db, { nodeIds, deletedAt }),
    restoreSoftDeletedSubtree: (nodeIds, now) => restoreSoftDeletedSubtree(db, nodeIds, now),
    finalizeSoftDeletes: async (now, nodeIds) => {
      await finalizeSoftDeletes(db, now, nodeIds)
    },
    appendErrorLog: (entry) => appendErrorLog(db, entry),
  }
}

export function createUnavailableStorageAdapter(reasonMessage: string): WorkspaceStorageAdapter {
  const rejectUnavailable = async (): Promise<never> => {
    throw new Error(reasonMessage)
  }
  return {
    loadEntries: rejectUnavailable,
    applyChangeset: rejectUnavailable,
    softDeleteSubtree: rejectUnavailable,
    restoreSoftDeletedSubtree: rejectUnavailable,
    finalizeSoftDeletes: rejectUnavailable,
    appendErrorLog: async () => {},
  }
}

function collectSubtreeIds(tree: TreeState, rootId: string): string[] {
  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = tree.nodes[id]
    if (!node) continue
    result.push(id)
    for (let i = node.childrenIds.length - 1; i >= 0; i -= 1) {
      stack.push(node.childrenIds[i]!)
    }
  }
  return result
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'IndexedDB write failed.'
}

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStoreApi {
  const getNow = deps.now ?? nowUtcIso
  const generateId = deps.generateId ?? createIdGenerator()
  const undoTimeoutMs = deps.undoTimeoutMs ?? UNDO_DELETE_TIMEOUT_MS
  let undoTimer: ReturnType<typeof setTimeout> | null = null
  let pendingRetryOp: (() => Promise<void>) | null = null

  const clearUndoTimer = () => {
    if (undoTimer !== null) {
      clearTimeout(undoTimer)
      undoTimer = null
    }
  }

  return createStore<WorkspaceStoreState>()(
    immer((set, get) => {
      const startUndoTimer = () => {
        clearUndoTimer()
        undoTimer = setTimeout(() => {
          undoTimer = null
          void get().finalizePendingDelete()
        }, undoTimeoutMs)
      }

      const recordStorageFailure = async (code: string, error: unknown) => {
        const message = extractErrorMessage(error)
        set((draft) => {
          draft.hasUnsavedChanges = true
          draft.storageError = { code, message }
        })
        try {
          await deps.storage.appendErrorLog({
            timestamp: getNow(),
            level: 'error',
            code,
            message,
          })
        } catch {
          // Storage itself may be unavailable or full; do not mask primary state
        }
      }

      const executeTreeMutation = async (
        runDomain: (tree: TreeState, now: string) => ReturnType<typeof domainCreateNode>,
      ): Promise<StoreOperationResult> => {
        if (get().isReadOnlyTab) {
          return {
            ok: false,
            reason: 'readonly_tab',
            message: 'This tab is read-only because another tab holds write access.',
          }
        }
        if (get().storageError !== null) {
          return {
            ok: false,
            reason: 'storage_error',
            message:
              'Cannot modify workspace while local storage has unsaved changes. Retry saving first.',
          }
        }

        const now = getNow()
        const result = runDomain(get().tree, now)
        if (!result.ok) {
          return {
            ok: false,
            reason: result.reason,
            message: result.message,
          }
        }

        set((draft) => {
          draft.tree = castDraft(result.state)
        })

        try {
          await deps.storage.applyChangeset(result.changeset, { now })
        } catch (error) {
          pendingRetryOp = async () => {
            await deps.storage.applyChangeset(result.changeset, { now })
          }
          await recordStorageFailure('storage_write_failed', error)
        }

        return {
          ok: true,
          nodeId: result.nodeId,
        }
      }

      return {
        hydrated: false,
        tree: { nodes: {}, rootIds: [] },
        issues: [],
        pendingUndoDelete: null,
        hasUnsavedChanges: false,
        storageError: null,
        isReadOnlyTab: deps.initialReadOnly ?? false,
        isLockSupported: deps.initialLockSupported ?? true,

        hydrate: async () => {
          const now = getNow()
          try {
            // Finalize any soft-deleted subtrees left behind if previous tab closed within 10s window
            await deps.storage.finalizeSoftDeletes(now)
            const entries = await deps.storage.loadEntries()
            const built = buildTree(entries, { generateId })

            if (built.changeset.upserts.length > 0 && !get().isReadOnlyTab) {
              await deps.storage.applyChangeset(built.changeset, { now })
            }

            pendingRetryOp = null
            set((draft) => {
              draft.tree = castDraft(built.state)
              draft.issues = built.issues
              draft.pendingUndoDelete = null
              draft.hydrated = true
              draft.storageError = null
              draft.hasUnsavedChanges = false
            })
          } catch (error) {
            const message = extractErrorMessage(error)
            set((draft) => {
              draft.hydrated = true
              draft.storageError = { code: 'storage_unavailable', message }
            })
          }
        },

        createNode: (input) =>
          executeTreeMutation((tree, now) =>
            domainCreateNode(tree, {
              ...input,
              now,
              generateId,
            }),
          ),

        renameNode: (input) =>
          executeTreeMutation((tree, now) =>
            domainRenameNode(tree, {
              ...input,
              now,
            }),
          ),

        moveNode: (input) =>
          executeTreeMutation((tree, now) =>
            domainMoveNode(tree, {
              ...input,
              now,
            }),
          ),

        reorderNode: (input) =>
          executeTreeMutation((tree, now) => {
            const domainInput: ReorderNodeInput =
              'direction' in input
                ? { nodeId: input.nodeId, direction: input.direction, now }
                : { nodeId: input.nodeId, targetIndex: input.targetIndex, now }
            return domainReorderNode(tree, domainInput)
          }),

        deleteNode: async (nodeId: string): Promise<StoreOperationResult> => {
          if (get().isReadOnlyTab) {
            return {
              ok: false,
              reason: 'readonly_tab',
              message: 'This tab is read-only because another tab holds write access.',
            }
          }
          if (get().storageError !== null) {
            return {
              ok: false,
              reason: 'storage_error',
              message:
                'Cannot modify workspace while local storage has unsaved changes. Retry saving first.',
            }
          }

          if (get().pendingUndoDelete !== null) {
            await get().finalizePendingDelete()
            if (get().storageError !== null) {
              return {
                ok: false,
                reason: 'storage_error',
                message:
                  'Cannot modify workspace while local storage has unsaved changes. Retry saving first.',
              }
            }
          }

          const currentTree = get().tree
          const targetNode = currentTree.nodes[nodeId]
          const subtreeIds = targetNode ? collectSubtreeIds(currentTree, nodeId) : []
          const result = domainDeleteNode(currentTree, { nodeId })
          if (!result.ok) {
            return {
              ok: false,
              reason: result.reason,
              message: result.message,
            }
          }

          const now = getNow()
          const title = targetNode?.meta.title ?? ''

          clearUndoTimer()
          set((draft) => {
            draft.tree = castDraft(result.state)
            draft.pendingUndoDelete = {
              rootNodeId: nodeId,
              title,
              nodeIds: subtreeIds,
              deletedAt: now,
            }
          })

          try {
            await deps.storage.softDeleteSubtree(subtreeIds, now)
            startUndoTimer()
          } catch (error) {
            pendingRetryOp = async () => {
              await deps.storage.softDeleteSubtree(subtreeIds, now)
              startUndoTimer()
            }
            await recordStorageFailure('storage_soft_delete_failed', error)
          }

          return {
            ok: true,
            nodeId,
          }
        },

        undoDelete: async () => {
          if (get().isReadOnlyTab || get().storageError !== null) {
            return false
          }
          const pending = get().pendingUndoDelete
          if (!pending) return false

          clearUndoTimer()
          const performRestore = async () => {
            const now = getNow()
            await deps.storage.restoreSoftDeletedSubtree(pending.nodeIds, now)
            const entries = await deps.storage.loadEntries()
            const built = buildTree(entries, { generateId })
            if (built.changeset.upserts.length > 0) {
              await deps.storage.applyChangeset(built.changeset, { now })
            }
            set((draft) => {
              draft.tree = castDraft(built.state)
              draft.issues = built.issues
              draft.pendingUndoDelete = null
            })
          }

          try {
            await performRestore()
            return true
          } catch (error) {
            pendingRetryOp = performRestore
            await recordStorageFailure('storage_undo_failed', error)
            return false
          }
        },

        finalizePendingDelete: async () => {
          clearUndoTimer()
          const pending = get().pendingUndoDelete
          if (!pending) return

          const performFinalize = async () => {
            await deps.storage.finalizeSoftDeletes(getNow(), pending.nodeIds)
            set((draft) => {
              draft.pendingUndoDelete = null
            })
          }

          try {
            await performFinalize()
          } catch (error) {
            pendingRetryOp = performFinalize
            await recordStorageFailure('storage_finalize_delete_failed', error)
          }
        },

        retrySave: async () => {
          if (get().isReadOnlyTab) {
            return false
          }
          if (pendingRetryOp !== null) {
            try {
              await pendingRetryOp()
              pendingRetryOp = null
              set((draft) => {
                draft.storageError = null
                draft.hasUnsavedChanges = false
              })
              return true
            } catch (error) {
              await recordStorageFailure(get().storageError?.code ?? 'storage_retry_failed', error)
              return false
            }
          }

          if (get().storageError !== null) {
            await get().hydrate()
            return get().storageError === null
          }

          return true
        },

        setReadOnlyTab: (readOnly) => {
          set((draft) => {
            draft.isReadOnlyTab = readOnly
          })
        },

        setLockSupported: (supported) => {
          set((draft) => {
            draft.isLockSupported = supported
          })
        },

        takeOverWriterLock: async () => {
          if (deps.onTakeOverWriter) {
            await deps.onTakeOverWriter()
          } else {
            set((draft) => {
              draft.isReadOnlyTab = false
            })
          }
        },

        dispose: () => {
          clearUndoTimer()
        },
      }
    }),
  )
}
