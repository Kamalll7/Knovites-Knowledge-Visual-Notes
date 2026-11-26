import { castDraft } from 'immer'
import { createStore, type StoreApi } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createIdGenerator, nowUtcIso } from '@/app/clock-id'
import type { CanvasJson, NodeStatus, NodeType, SchemaIssue, VirtualRootId } from '@/domain/schema'
import { serializeCanvasJson } from '@/domain/serialize'
import {
  VIRTUAL_ROOT_ID,
  buildTree,
  createNode as domainCreateNode,
  deleteNode as domainDeleteNode,
  isVirtualRootId,
  moveNode as domainMoveNode,
  renameNode as domainRenameNode,
  reorderNode as domainReorderNode,
  resolveCanvasFilePath,
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
  getCanvasRecord,
  loadTreeBuildEntries,
  restoreSoftDeletedSubtree,
  softDeleteSubtree,
  type ErrorLogRecord,
  type KnovitesDatabase,
  type RestoreSoftDeleteResult,
  type StoredCanvasRecord,
} from '@/storage'

export const UNDO_DELETE_TIMEOUT_MS = 10_000
export const HOME_PAGE_TITLE = 'Home' as const
export const HOME_PAGE_ROUTE = `/n/${VIRTUAL_ROOT_ID}` as const

export function getPageRouteForNode(nodeId: string): string {
  return isVirtualRootId(nodeId) ? HOME_PAGE_ROUTE : `/n/${nodeId}`
}

export function canMutateTreeNode(nodeId: string): boolean {
  return !isVirtualRootId(nodeId)
}

export interface RootHomeState {
  id: VirtualRootId
  title: string
  hasCanvas: boolean
  assets: string[]
  extraFiles: string[]
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
}

export type PageTarget =
  | {
      kind: 'home'
      nodeId: VirtualRootId
      title: string
      route: string
      hasCanvas: boolean
      assets: string[]
      extraFiles: string[]
      canMutateTree: false
      corrupt: boolean
      corruptErrors?: SchemaIssue[]
      newerSchemaVersion?: number
    }
  | {
      kind: 'node'
      nodeId: string
      title: string
      path: string
      route: string
      hasCanvas: boolean
      assets: string[]
      extraFiles: string[]
      canMutateTree: boolean
      corrupt: boolean
      corruptErrors?: SchemaIssue[]
      newerSchemaVersion?: number
    }

export interface LoadedPageCanvas {
  nodeId: string
  exists: boolean
  doc: CanvasJson
  corrupt: boolean
  corruptErrors?: SchemaIssue[]
  newerSchemaVersion?: number
}

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
  loadCanvas: (nodeId: string) => Promise<StoredCanvasRecord | undefined>
  applyChangeset: (changeset: Changeset, options?: { now?: string }) => Promise<void>
  softDeleteSubtree: (nodeIds: readonly string[], deletedAt: string) => Promise<void>
  restoreSoftDeletedSubtree: (
    nodeIds: readonly string[],
    now?: string,
  ) => Promise<RestoreSoftDeleteResult>
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
  rootHome: RootHomeState
  issues: TreeIssue[]
  pendingUndoDelete: PendingUndoDelete | null
  lastUndoResult: RestoreSoftDeleteResult | null
  hasUnsavedChanges: boolean
  storageError: StorageErrorState | null
  isReadOnlyTab: boolean
  isLockSupported: boolean
  hydrate: () => Promise<void>
  resolvePageTarget: (nodeId: string) => PageTarget | null
  loadPageCanvas: (nodeId: string) => Promise<LoadedPageCanvas>
  savePageCanvas: (nodeId: string, doc: CanvasJson) => Promise<StoreOperationResult>
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
  clearLastUndoResult: () => void
  finalizePendingDelete: () => Promise<void>
  retrySave: () => Promise<boolean>
  setReadOnlyTab: (readOnly: boolean) => void
  setLockSupported: (supported: boolean) => void
  takeOverWriterLock: () => Promise<void>
  dispose: () => void
}

export type WorkspaceStoreApi = StoreApi<WorkspaceStoreState>

export function selectPageTarget(
  state: Pick<WorkspaceStoreState, 'tree' | 'rootHome'>,
  nodeId: string,
): PageTarget | null {
  if (isVirtualRootId(nodeId)) {
    return {
      kind: 'home',
      nodeId: VIRTUAL_ROOT_ID,
      title: state.rootHome.title,
      route: HOME_PAGE_ROUTE,
      hasCanvas: state.rootHome.hasCanvas,
      assets: state.rootHome.assets,
      extraFiles: state.rootHome.extraFiles,
      canMutateTree: false,
      corrupt: state.rootHome.corrupt,
      ...(state.rootHome.corruptErrors ? { corruptErrors: state.rootHome.corruptErrors } : {}),
      ...(state.rootHome.newerSchemaVersion !== undefined
        ? { newerSchemaVersion: state.rootHome.newerSchemaVersion }
        : {}),
    }
  }

  const node = state.tree.nodes[nodeId]
  if (!node) return null
  return {
    kind: 'node',
    nodeId: node.id,
    title: node.meta.title,
    path: node.path,
    route: getPageRouteForNode(node.id),
    hasCanvas: node.hasCanvas,
    assets: node.assets,
    extraFiles: node.extraFiles,
    canMutateTree: !node.corrupt && node.newerSchemaVersion === undefined,
    corrupt: node.corrupt,
    ...(node.corruptErrors ? { corruptErrors: node.corruptErrors } : {}),
    ...(node.newerSchemaVersion !== undefined
      ? { newerSchemaVersion: node.newerSchemaVersion }
      : {}),
  }
}

export function createDexieWorkspaceAdapter(db: KnovitesDatabase): WorkspaceStorageAdapter {
  return {
    loadEntries: () => loadTreeBuildEntries(db),
    loadCanvas: (nodeId) => getCanvasRecord(db, nodeId),
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
    loadCanvas: rejectUnavailable,
    applyChangeset: rejectUnavailable,
    softDeleteSubtree: rejectUnavailable,
    restoreSoftDeletedSubtree: rejectUnavailable,
    finalizeSoftDeletes: rejectUnavailable,
    appendErrorLog: async () => {},
  }
}

function makeEmptyRootHomeState(): RootHomeState {
  return {
    id: VIRTUAL_ROOT_ID,
    title: HOME_PAGE_TITLE,
    hasCanvas: false,
    assets: [],
    extraFiles: [],
    corrupt: false,
  }
}

function buildRootHomeState(tree: TreeState): RootHomeState {
  return {
    id: VIRTUAL_ROOT_ID,
    title: HOME_PAGE_TITLE,
    hasCanvas: tree.rootHasCanvas ?? false,
    assets: tree.rootAssets ? [...tree.rootAssets] : [],
    extraFiles: tree.rootExtraFiles ? [...tree.rootExtraFiles] : [],
    corrupt: Boolean(tree.rootCanvasCorrupt),
    ...(tree.rootCanvasCorruptErrors ? { corruptErrors: tree.rootCanvasCorruptErrors } : {}),
    ...(tree.rootCanvasNewerSchemaVersion !== undefined
      ? { newerSchemaVersion: tree.rootCanvasNewerSchemaVersion }
      : {}),
  }
}

function guardNotVirtualRoot(
  nodeId: string,
  action: 'delete' | 'rename' | 'move' | 'reorder',
): StoreOperationResult | null {
  if (isVirtualRootId(nodeId)) {
    return {
      ok: false,
      reason: 'cannot_mutate_root',
      message: `Cannot ${action} virtual root "${VIRTUAL_ROOT_ID}".`,
    }
  }
  return null
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
        tree: { nodes: {}, rootIds: [], rootHasCanvas: false, rootAssets: [], rootExtraFiles: [] },
        rootHome: makeEmptyRootHomeState(),
        issues: [],
        pendingUndoDelete: null,
        lastUndoResult: null,
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
              draft.rootHome = castDraft(buildRootHomeState(built.state))
              draft.issues = built.issues
              draft.pendingUndoDelete = null
              draft.lastUndoResult = null
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

        resolvePageTarget: (nodeId: string) => selectPageTarget(get(), nodeId),

        loadPageCanvas: async (nodeId: string): Promise<LoadedPageCanvas> => {
          const record = await deps.storage.loadCanvas(nodeId)
          if (!record || record.deletedAt !== 0) {
            return {
              nodeId,
              exists: false,
              doc: { schema: 1, elements: {} },
              corrupt: false,
            }
          }
          return {
            nodeId,
            exists: true,
            doc: record.doc ?? { schema: 1, elements: {} },
            corrupt: record.corrupt,
            ...(record.corruptErrors ? { corruptErrors: record.corruptErrors } : {}),
            ...(record.newerSchemaVersion !== undefined
              ? { newerSchemaVersion: record.newerSchemaVersion }
              : {}),
          }
        },

        savePageCanvas: async (nodeId: string, doc: CanvasJson): Promise<StoreOperationResult> => {
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

          let canvasFilePath: string
          if (isVirtualRootId(nodeId)) {
            const rootHome = get().rootHome
            if (rootHome.newerSchemaVersion !== undefined) {
              return {
                ok: false,
                reason: 'newer_schema_node',
                message: `Cannot edit home canvas (uses newer schema v${rootHome.newerSchemaVersion}).`,
              }
            }
            if (rootHome.corrupt) {
              return {
                ok: false,
                reason: 'corrupt_node',
                message: 'Cannot edit corrupt read-only home canvas.',
              }
            }
            canvasFilePath = resolveCanvasFilePath('')
          } else {
            const node = get().tree.nodes[nodeId]
            if (!node) {
              return {
                ok: false,
                reason: 'not_found',
                message: `Node "${nodeId}" does not exist.`,
              }
            }
            if (node.newerSchemaVersion !== undefined) {
              return {
                ok: false,
                reason: 'newer_schema_node',
                message: `Cannot edit canvas for read-only node "${node.path}" (schema v${node.newerSchemaVersion}).`,
              }
            }
            if (node.corrupt) {
              return {
                ok: false,
                reason: 'corrupt_node',
                message: `Cannot edit canvas for corrupt read-only node "${node.path}".`,
              }
            }
            canvasFilePath = resolveCanvasFilePath(node.path)
          }

          const now = getNow()
          const serialized = serializeCanvasJson(doc)
          const changeset: Changeset = {
            upserts: [{ path: canvasFilePath, content: serialized }],
            moves: [],
            deletes: [],
          }

          set((draft) => {
            if (isVirtualRootId(nodeId)) {
              draft.tree.rootHasCanvas = true
              draft.rootHome.hasCanvas = true
            } else if (draft.tree.nodes[nodeId]) {
              draft.tree.nodes[nodeId]!.hasCanvas = true
            }
          })

          try {
            await deps.storage.applyChangeset(changeset, { now })
          } catch (error) {
            pendingRetryOp = async () => {
              await deps.storage.applyChangeset(changeset, { now })
            }
            await recordStorageFailure('storage_write_failed', error)
          }

          return {
            ok: true,
            nodeId,
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

        renameNode: async (input) => {
          const rootBlocked = guardNotVirtualRoot(input.nodeId, 'rename')
          if (rootBlocked) return rootBlocked
          return executeTreeMutation((tree, now) =>
            domainRenameNode(tree, {
              ...input,
              now,
            }),
          )
        },

        moveNode: async (input) => {
          const rootBlocked = guardNotVirtualRoot(input.nodeId, 'move')
          if (rootBlocked) return rootBlocked
          return executeTreeMutation((tree, now) =>
            domainMoveNode(tree, {
              ...input,
              now,
            }),
          )
        },

        reorderNode: async (input) => {
          const rootBlocked = guardNotVirtualRoot(input.nodeId, 'reorder')
          if (rootBlocked) return rootBlocked
          return executeTreeMutation((tree, now) => {
            const domainInput: ReorderNodeInput =
              'direction' in input
                ? { nodeId: input.nodeId, direction: input.direction, now }
                : { nodeId: input.nodeId, targetIndex: input.targetIndex, now }
            return domainReorderNode(tree, domainInput)
          })
        },

        deleteNode: async (nodeId: string): Promise<StoreOperationResult> => {
          const rootBlocked = guardNotVirtualRoot(nodeId, 'delete')
          if (rootBlocked) return rootBlocked
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
            const restoreResult = await deps.storage.restoreSoftDeletedSubtree(pending.nodeIds, now)
            const entries = await deps.storage.loadEntries()
            const built = buildTree(entries, { generateId })
            if (built.changeset.upserts.length > 0) {
              await deps.storage.applyChangeset(built.changeset, { now })
            }
            set((draft) => {
              draft.tree = castDraft(built.state)
              draft.rootHome = castDraft(buildRootHomeState(built.state))
              draft.issues = built.issues
              draft.pendingUndoDelete = null
              draft.lastUndoResult = restoreResult
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

        clearLastUndoResult: () => {
          set((draft) => {
            draft.lastUndoResult = null
          })
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
