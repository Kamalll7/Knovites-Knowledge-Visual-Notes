import {
  ASSETS_DIR,
  CANVAS_FILE,
  HEX_COLOR_REGEX,
  KNOVITES_META_FILE,
  TAG_REGEX,
  ULID_REGEX,
  type NodeJson,
  type NodeStatus,
  type NodeType,
  type SchemaIssue,
} from '@/domain/schema'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import { compareLexicographical, compareSiblings, generateOrderBetween } from '@/domain/tree/order'
import {
  normalizeRepoRelativePath,
  resolveAssetFilePath,
  resolveCanvasFilePath,
  resolveExtraFilePath,
  resolveNodeFilePath,
} from '@/domain/tree/paths'
import { deriveNodePath, normalizeFolderPath, resolveUniqueSlug, slugify } from '@/domain/tree/slug'
import {
  EMPTY_CHANGESET,
  FORBIDDEN_SLUGS,
  ROOT_RESERVED_NAMES,
  VIRTUAL_ROOT_ID,
  isVirtualRootId,
  type BuildTreeOptions,
  type BuildTreeResult,
  type Changeset,
  type CreateNodeInput,
  type DeleteNodeInput,
  type FileMove,
  type MoveNodeInput,
  type RenameNodeInput,
  type ReorderNodeInput,
  type TreeBuildEntry,
  type TreeIssue,
  type TreeNode,
  type TreeOperationErrorReason,
  type TreeOperationResult,
  type TreeState,
  type UpdateNodeMetaInput,
} from '@/domain/tree/types'

const VALID_NODE_TYPES = new Set<NodeType>(['category', 'concept', 'technique', 'challenge', 'lab'])
const VALID_NODE_STATUSES = new Set<NodeStatus>(['none', 'learning', 'practiced', 'mastered'])
const MAX_NODE_TAGS = 20

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function encodeFallbackUlid(counter: number): string {
  let n = counter
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = CROCKFORD_ALPHABET[n % 32]! + suffix
    n = Math.floor(n / 32)
  }
  return `01KN0V1TE5000000${suffix}`
}

function makeFallbackMeta(id: string): NodeJson {
  return {
    schema: 1,
    id,
    title: '',
    type: 'concept',
    status: 'none',
    tags: [],
    order: 'a0',
    color: null,
    links: [],
    createdAt: '1970-01-01T00:00:00Z',
    updatedAt: '1970-01-01T00:00:00Z',
  }
}

function fail(
  state: TreeState,
  reason: TreeOperationErrorReason,
  message: string,
): TreeOperationResult {
  return {
    ok: false,
    reason,
    message,
    state,
    changeset: EMPTY_CHANGESET,
  }
}

function preserveRootFields(
  state: TreeState,
  nodes: Record<string, TreeNode>,
  rootIds: string[],
): TreeState {
  const next: TreeState = { nodes, rootIds }
  if (state.rootHasCanvas !== undefined) next.rootHasCanvas = state.rootHasCanvas
  if (state.rootAssets !== undefined) next.rootAssets = state.rootAssets
  if (state.rootExtraFiles !== undefined) next.rootExtraFiles = state.rootExtraFiles
  if (state.rootCanvasCorrupt !== undefined) next.rootCanvasCorrupt = state.rootCanvasCorrupt
  if (state.rootCanvasCorruptErrors !== undefined) {
    next.rootCanvasCorruptErrors = state.rootCanvasCorruptErrors
  }
  if (state.rootCanvasNewerSchemaVersion !== undefined) {
    next.rootCanvasNewerSchemaVersion = state.rootCanvasNewerSchemaVersion
  }
  return next
}

function normalizeParentId(parentId: string | null): string | null {
  return parentId === null || isVirtualRootId(parentId) ? null : parentId
}

function cloneStateWithNodes(state: TreeState): {
  nodes: Record<string, TreeNode>
  rootIds: string[]
} {
  return {
    nodes: { ...state.nodes },
    rootIds: [...state.rootIds],
  }
}

function getSiblingIds(state: TreeState, parentId: string | null): string[] {
  if (parentId === null) {
    return state.rootIds
  }
  return state.nodes[parentId]?.childrenIds ?? []
}

function sortSiblingIds(nodes: Record<string, TreeNode>, ids: readonly string[]): string[] {
  return [...ids].sort((idA, idB) => {
    const nodeA = nodes[idA]!
    const nodeB = nodes[idB]!
    return compareSiblings(
      { order: nodeA.meta.order, id: nodeA.id },
      { order: nodeB.meta.order, id: nodeB.id },
    )
  })
}

function collectSubtreeIds(state: TreeState, rootId: string): string[] {
  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const currId = stack.pop()!
    const curr = state.nodes[currId]
    if (!curr) continue
    result.push(currId)
    for (let i = curr.childrenIds.length - 1; i >= 0; i -= 1) {
      stack.push(curr.childrenIds[i]!)
    }
  }
  return result
}

function isDescendant(state: TreeState, ancestorId: string, candidateId: string): boolean {
  let curr: TreeNode | undefined = state.nodes[candidateId]
  let guard = 0
  const maxHops = Object.keys(state.nodes).length + 1
  while (curr && curr.parentId !== null && guard < maxHops) {
    if (curr.parentId === ancestorId) {
      return true
    }
    curr = state.nodes[curr.parentId]
    guard += 1
  }
  return false
}

function findBlockingNodeInSubtree(state: TreeState, rootId: string): TreeNode | null {
  for (const id of collectSubtreeIds(state, rootId)) {
    const node = state.nodes[id]
    if (!node) continue
    if (node.corrupt || node.newerSchemaVersion !== undefined) {
      return node
    }
  }
  return null
}

function failReadOnlyNode(
  state: TreeState,
  action: 'create child inside' | 'rename' | 'update' | 'move' | 'move into' | 'reorder' | 'delete',
  target: TreeNode,
  blocker: TreeNode,
): TreeOperationResult {
  const isSelf = blocker.id === target.id
  if (blocker.newerSchemaVersion !== undefined) {
    const msg = isSelf
      ? `Cannot ${action} read-only node "${target.path}" (uses newer schema v${blocker.newerSchemaVersion}).`
      : `Cannot ${action} "${target.path}" because descendant "${blocker.path}" uses newer schema v${blocker.newerSchemaVersion}.`
    return fail(state, 'newer_schema_node', msg)
  }
  const msg = isSelf
    ? `Cannot ${action} corrupt read-only node "${target.path}".`
    : `Cannot ${action} "${target.path}" because descendant "${blocker.path}" is corrupt.`
  return fail(state, 'corrupt_node', msg)
}

function cleanRelativeFilePath(raw: string): string {
  return normalizeRepoRelativePath(raw)
}

function normalizeNodeFiles(
  rawAssets: readonly string[] | undefined,
  rawExtraFiles: readonly string[] | undefined,
): { assets: string[]; extraFiles: string[] } {
  const assetSet = new Set<string>()
  const extraSet = new Set<string>()

  if (rawAssets) {
    for (const raw of rawAssets) {
      const clean = cleanRelativeFilePath(raw)
      if (clean.length === 0 || clean === ASSETS_DIR) continue
      assetSet.add(clean.startsWith(`${ASSETS_DIR}/`) ? clean : `${ASSETS_DIR}/${clean}`)
    }
  }

  if (rawExtraFiles) {
    for (const raw of rawExtraFiles) {
      const clean = cleanRelativeFilePath(raw)
      if (
        clean.length === 0 ||
        clean === 'node.json' ||
        clean === CANVAS_FILE ||
        clean === ASSETS_DIR
      ) {
        continue
      }
      if (clean.startsWith(`${ASSETS_DIR}/`)) {
        assetSet.add(clean)
      } else {
        extraSet.add(clean)
      }
    }
  }

  return {
    assets: [...assetSet].sort(compareLexicographical),
    extraFiles: [...extraSet].sort(compareLexicographical),
  }
}

function collectRootFiles(
  rootEntries: readonly TreeBuildEntry[],
  options: BuildTreeOptions,
  issues: TreeIssue[],
): {
  rootHasCanvas: boolean
  rootAssets: string[]
  rootExtraFiles: string[]
  rootCanvasCorrupt: boolean
  rootCanvasCorruptErrors?: SchemaIssue[]
  rootCanvasNewerSchemaVersion?: number
} {
  let rootHasCanvas = Boolean(options.root?.hasCanvas)
  const assetSet = new Set<string>()
  const extraSet = new Set<string>()
  let rootCanvasCorrupt = Boolean(options.root?.corrupt)
  let rootCanvasCorruptErrors = options.root?.corruptErrors
  let rootCanvasNewerSchemaVersion = options.root?.newerSchemaVersion

  const addAsset = (raw: string) => {
    const clean = cleanRelativeFilePath(raw)
    if (clean.length === 0 || clean === ASSETS_DIR) return
    assetSet.add(clean.startsWith(`${ASSETS_DIR}/`) ? clean : `${ASSETS_DIR}/${clean}`)
  }

  const classifyRootFile = (raw: string) => {
    const clean = cleanRelativeFilePath(raw)
    if (clean.length === 0 || clean === KNOVITES_META_FILE || clean === ASSETS_DIR) {
      return
    }
    if (clean === CANVAS_FILE) {
      rootHasCanvas = true
      return
    }
    if (clean.startsWith(`${ASSETS_DIR}/`)) {
      assetSet.add(clean)
      return
    }
    extraSet.add(clean)
  }

  if (options.root?.assets) {
    for (const raw of options.root.assets) addAsset(raw)
  }
  if (options.root?.extraFiles) {
    for (const raw of options.root.extraFiles) classifyRootFile(raw)
  }
  if (options.rootFiles) {
    for (const raw of options.rootFiles) classifyRootFile(raw)
  }

  for (const entry of rootEntries) {
    if (entry.hasCanvas) rootHasCanvas = true
    if (entry.assets) {
      for (const raw of entry.assets) addAsset(raw)
    }
    if (entry.extraFiles) {
      for (const raw of entry.extraFiles) classifyRootFile(raw)
    }
    if (entry.newerSchemaVersion !== undefined) {
      rootCanvasCorrupt = true
      rootCanvasNewerSchemaVersion = entry.newerSchemaVersion
    } else if (entry.corrupt) {
      rootCanvasCorrupt = true
      if (entry.corruptErrors) {
        rootCanvasCorruptErrors = entry.corruptErrors
      }
    }
  }

  if (rootCanvasNewerSchemaVersion !== undefined) {
    rootCanvasCorrupt = true
    issues.push({
      path: CANVAS_FILE,
      code: 'newer_schema_root_canvas',
      message: `Root home canvas "${CANVAS_FILE}" uses newer schema version ${rootCanvasNewerSchemaVersion} and is read-only.`,
    })
  } else if (rootCanvasCorrupt) {
    issues.push({
      path: CANVAS_FILE,
      code: 'corrupt_root_canvas',
      message: `Root home canvas "${CANVAS_FILE}" is corrupt and marked read-only.`,
    })
  }

  return {
    rootHasCanvas,
    rootAssets: [...assetSet].sort(compareLexicographical),
    rootExtraFiles: [...extraSet].sort(compareLexicographical),
    rootCanvasCorrupt,
    ...(rootCanvasCorruptErrors ? { rootCanvasCorruptErrors } : {}),
    ...(rootCanvasNewerSchemaVersion !== undefined ? { rootCanvasNewerSchemaVersion } : {}),
  }
}

function isValidTimestamp(now: string): boolean {
  return ISO_UTC_REGEX.test(now) && !Number.isNaN(Date.parse(now))
}

export function buildTree(
  entries: readonly TreeBuildEntry[],
  options: BuildTreeOptions = {},
): BuildTreeResult {
  const issues: TreeIssue[] = []
  const upserts: Changeset['upserts'] = []

  const virtualRootEntries: TreeBuildEntry[] = []
  const regularEntries: TreeBuildEntry[] = []
  for (const entry of entries) {
    if (entry.isVirtualRoot) {
      virtualRootEntries.push(entry)
    } else {
      regularEntries.push(entry)
    }
  }

  const rootMeta = collectRootFiles(virtualRootEntries, options, issues)

  const normalizedEntries = regularEntries
    .map((entry) => ({
      entry,
      path: normalizeFolderPath(entry.path),
    }))
    .sort((a, b) => compareLexicographical(a.path, b.path))

  const seenPaths = new Set<string>()
  const validPathEntries: Array<{
    path: string
    slug: string
    parentPath: string | null
    entry: TreeBuildEntry
    meta: NodeJson | null
    corrupt: boolean
    corruptErrors?: TreeNode['corruptErrors']
    newerSchemaVersion?: number
  }> = []

  for (const { entry, path } of normalizedEntries) {
    const segments = path.split('/')
    if (
      path.length === 0 ||
      ROOT_RESERVED_NAMES.has(segments[0]!) ||
      segments.some((seg) => seg.length === 0 || FORBIDDEN_SLUGS.has(seg))
    ) {
      issues.push({
        path,
        code: 'forbidden_folder_ignored',
        message: `Ignored folder "${path}" because it uses an empty, reserved, or forbidden segment.`,
      })
      continue
    }

    if (seenPaths.has(path)) {
      issues.push({
        path,
        code: 'duplicate_path_ignored',
        message: `Ignored duplicate entry for folder "${path}".`,
      })
      continue
    }
    seenPaths.add(path)

    const slug = segments[segments.length - 1]!
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : null

    let meta: NodeJson | null = entry.node ?? null
    let corrupt = Boolean(entry.corrupt)
    let corruptErrors = entry.corruptErrors
    let newerSchemaVersion = entry.newerSchemaVersion

    if (entry.parseResult) {
      if (entry.parseResult.status === 'ok') {
        meta = entry.parseResult.data
      } else if (entry.parseResult.status === 'corrupt') {
        corrupt = true
        corruptErrors = entry.parseResult.errors
      } else {
        corrupt = true
        newerSchemaVersion = entry.parseResult.schemaVersion
      }
    } else if (!corrupt && newerSchemaVersion === undefined && !meta) {
      corrupt = true
      corruptErrors = [
        { path: '', code: 'missing_node_meta', message: 'Missing parsed node data.' },
      ]
    }

    if (newerSchemaVersion !== undefined) {
      corrupt = true
      issues.push({
        path,
        code: 'newer_schema_node',
        message: `Node at "${path}" uses newer schema version ${newerSchemaVersion} and is read-only.`,
      })
    } else if (corrupt) {
      issues.push({
        path,
        code: 'corrupt_node',
        message: `Node at "${path}" is corrupt and marked read-only.`,
      })
    }

    validPathEntries.push({
      path,
      slug,
      parentPath,
      entry,
      meta,
      corrupt,
      corruptErrors,
      newerSchemaVersion,
    })
  }

  // Keep only entries whose ancestor folders all exist as nodes
  const acceptedByPath = new Map<string, (typeof validPathEntries)[number]>()
  for (const item of validPathEntries) {
    if (item.parentPath !== null && !acceptedByPath.has(item.parentPath)) {
      issues.push({
        path: item.path,
        code: 'missing_parent_ignored',
        message: `Ignored node "${item.path}" because parent folder "${item.parentPath}" is not a node.`,
      })
      continue
    }
    acceptedByPath.set(item.path, item)
  }

  const usedIds = new Set<string>()
  let fallbackCounter = 1
  function allocateUniqueId(): string {
    if (options.generateId) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = options.generateId()
        if (ULID_REGEX.test(candidate) && !usedIds.has(candidate)) {
          usedIds.add(candidate)
          return candidate
        }
      }
    }
    while (true) {
      const candidate = encodeFallbackUlid(fallbackCounter)
      fallbackCounter += 1
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate)
        return candidate
      }
    }
  }

  const nodes: Record<string, TreeNode> = {}
  const pathToId = new Map<string, string>()

  // Process corrupt entries first to reserve their placeholder IDs cleanly,
  // or process all entries in deterministic path order (note valid IDs must take precedence over placeholder IDs).
  // Pass 1: assign IDs for valid nodes in sorted path order so earlier path keeps duplicate ID (§5.3)
  for (const item of acceptedByPath.values()) {
    if (item.corrupt || !item.meta) continue
    let nodeId = item.meta.id
    let meta = item.meta

    if (usedIds.has(nodeId)) {
      const oldId = nodeId
      nodeId = allocateUniqueId()
      meta = { ...meta, id: nodeId }
      issues.push({
        path: item.path,
        code: 'duplicate_id_repaired',
        message: `Repaired duplicate node ID "${oldId}" at "${item.path}" to "${nodeId}".`,
        oldId,
        newId: nodeId,
      })
      upserts.push({
        path: resolveNodeFilePath(item.path),
        content: serializeNodeJson(meta),
      })
    } else {
      usedIds.add(nodeId)
    }

    const normalizedFiles = normalizeNodeFiles(item.entry.assets, item.entry.extraFiles)

    pathToId.set(item.path, nodeId)
    nodes[nodeId] = {
      id: nodeId,
      slug: item.slug,
      path: item.path,
      parentId: null,
      meta,
      corrupt: false,
      childrenIds: [],
      assets: normalizedFiles.assets,
      extraFiles: normalizedFiles.extraFiles,
      hasCanvas: item.entry.hasCanvas ?? false,
    }
  }

  // Pass 2: assign deterministic read-only IDs for corrupt / newer-schema nodes
  for (const item of acceptedByPath.values()) {
    if (!item.corrupt) continue
    let nodeId = `__corrupt__:${item.path}`
    while (usedIds.has(nodeId) || nodeId in nodes) {
      nodeId = `${nodeId}_dup`
    }
    usedIds.add(nodeId)

    const normalizedFiles = normalizeNodeFiles(item.entry.assets, item.entry.extraFiles)

    pathToId.set(item.path, nodeId)
    nodes[nodeId] = {
      id: nodeId,
      slug: item.slug,
      path: item.path,
      parentId: null,
      meta: item.meta ?? makeFallbackMeta(nodeId),
      corrupt: true,
      ...(item.corruptErrors ? { corruptErrors: item.corruptErrors } : {}),
      ...(item.newerSchemaVersion !== undefined
        ? { newerSchemaVersion: item.newerSchemaVersion }
        : {}),
      childrenIds: [],
      assets: normalizedFiles.assets,
      extraFiles: normalizedFiles.extraFiles,
      hasCanvas: item.entry.hasCanvas ?? false,
    }
  }

  // Pass 3: wire parent-child links
  const rootIds: string[] = []
  for (const item of acceptedByPath.values()) {
    const id = pathToId.get(item.path)!
    const node = nodes[id]!
    if (item.parentPath === null) {
      node.parentId = null
      rootIds.push(id)
    } else {
      const parentId = pathToId.get(item.parentPath)!
      node.parentId = parentId
      nodes[parentId]!.childrenIds.push(id)
    }
  }

  // Pass 4: sort rootIds and every node's childrenIds deterministically
  const sortedRootIds = sortSiblingIds(nodes, rootIds)
  for (const node of Object.values(nodes)) {
    node.childrenIds = sortSiblingIds(nodes, node.childrenIds)
  }

  const state: TreeState = {
    nodes,
    rootIds: sortedRootIds,
    rootHasCanvas: rootMeta.rootHasCanvas,
    rootAssets: rootMeta.rootAssets,
    rootExtraFiles: rootMeta.rootExtraFiles,
    ...(rootMeta.rootCanvasCorrupt ? { rootCanvasCorrupt: true } : {}),
    ...(rootMeta.rootCanvasCorruptErrors
      ? { rootCanvasCorruptErrors: rootMeta.rootCanvasCorruptErrors }
      : {}),
    ...(rootMeta.rootCanvasNewerSchemaVersion !== undefined
      ? { rootCanvasNewerSchemaVersion: rootMeta.rootCanvasNewerSchemaVersion }
      : {}),
  }

  return {
    state,
    rootHasCanvas: rootMeta.rootHasCanvas,
    rootAssets: rootMeta.rootAssets,
    rootExtraFiles: rootMeta.rootExtraFiles,
    issues,
    changeset: {
      upserts,
      moves: [],
      deletes: [],
    },
  }
}

export function createNode(state: TreeState, input: CreateNodeInput): TreeOperationResult {
  if (input.title.length < 1 || input.title.length > 200) {
    return fail(state, 'invalid_title', 'Node title must be between 1 and 200 characters.')
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  const effectiveParentId = normalizeParentId(input.parentId)
  let parentPath: string | null = null
  if (effectiveParentId !== null) {
    const parent = state.nodes[effectiveParentId]
    if (!parent) {
      return fail(state, 'parent_not_found', `Parent node "${effectiveParentId}" does not exist.`)
    }
    if (parent.corrupt || parent.newerSchemaVersion !== undefined) {
      return failReadOnlyNode(state, 'create child inside', parent, parent)
    }
    parentPath = parent.path
  }

  const id = input.generateId()
  if (isVirtualRootId(id) || !ULID_REGEX.test(id) || id in state.nodes) {
    return fail(state, 'invalid_id', 'Generated node ID must be a unique valid ULID.')
  }

  const siblingIds = getSiblingIds(state, effectiveParentId)
  const siblingSlugs = siblingIds.map((sid) => state.nodes[sid]!.slug)
  const slug = resolveUniqueSlug(slugify(input.title), siblingSlugs)
  const path = deriveNodePath(parentPath, slug)

  const lastSibling = siblingIds.length > 0 ? state.nodes[siblingIds[siblingIds.length - 1]!] : null
  const order = generateOrderBetween(lastSibling?.meta.order ?? null, null)

  const meta: NodeJson = {
    schema: 1,
    id,
    title: input.title,
    type: input.type ?? 'concept',
    status: input.status ?? 'none',
    tags: input.tags ? [...input.tags] : [],
    order,
    color: input.color ?? null,
    links: [],
    createdAt: input.now,
    updatedAt: input.now,
  }

  const newNode: TreeNode = {
    id,
    slug,
    path,
    parentId: effectiveParentId,
    meta,
    corrupt: false,
    childrenIds: [],
    assets: [],
    extraFiles: [],
    hasCanvas: true,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)
  nodes[id] = newNode

  let nextRootIds = rootIds
  if (effectiveParentId === null) {
    nextRootIds = sortSiblingIds(nodes, [...rootIds, id])
  } else {
    const parent = nodes[effectiveParentId]!
    nodes[effectiveParentId] = {
      ...parent,
      childrenIds: sortSiblingIds(nodes, [...parent.childrenIds, id]),
    }
  }

  const emptyCanvas = serializeCanvasJson({ schema: 1, elements: {} })
  return {
    ok: true,
    nodeId: id,
    state: preserveRootFields(state, nodes, nextRootIds),
    changeset: {
      upserts: [
        { path: resolveNodeFilePath(path), content: serializeNodeJson(meta) },
        { path: resolveCanvasFilePath(path), content: emptyCanvas },
      ],
      moves: [],
      deletes: [],
    },
  }
}

export function renameNode(state: TreeState, input: RenameNodeInput): TreeOperationResult {
  if (isVirtualRootId(input.nodeId)) {
    return fail(state, 'cannot_mutate_root', `Cannot rename virtual root "${VIRTUAL_ROOT_ID}".`)
  }
  const existing = state.nodes[input.nodeId]
  if (!existing) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (existing.corrupt || existing.newerSchemaVersion !== undefined) {
    return failReadOnlyNode(state, 'rename', existing, existing)
  }
  if (input.title.length < 1 || input.title.length > 200) {
    return fail(state, 'invalid_title', 'Node title must be between 1 and 200 characters.')
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  const updatedMeta: NodeJson = {
    ...existing.meta,
    title: input.title,
    updatedAt: input.now,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)
  nodes[input.nodeId] = {
    ...existing,
    meta: updatedMeta,
  }

  return {
    ok: true,
    nodeId: input.nodeId,
    state: preserveRootFields(state, nodes, rootIds),
    changeset: {
      upserts: [
        { path: resolveNodeFilePath(existing.path), content: serializeNodeJson(updatedMeta) },
      ],
      moves: [],
      deletes: [],
    },
  }
}

export function updateNodeMeta(state: TreeState, input: UpdateNodeMetaInput): TreeOperationResult {
  if (isVirtualRootId(input.nodeId)) {
    return fail(state, 'cannot_mutate_root', `Cannot update virtual root "${VIRTUAL_ROOT_ID}".`)
  }
  const existing = state.nodes[input.nodeId]
  if (!existing) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (existing.corrupt || existing.newerSchemaVersion !== undefined) {
    return failReadOnlyNode(state, 'update', existing, existing)
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  let nextType = existing.meta.type
  if (input.type !== undefined) {
    if (!VALID_NODE_TYPES.has(input.type)) {
      return fail(state, 'invalid_meta', `Unsupported node type "${String(input.type)}".`)
    }
    nextType = input.type
  }

  let nextStatus = existing.meta.status
  if (input.status !== undefined) {
    if (!VALID_NODE_STATUSES.has(input.status)) {
      return fail(state, 'invalid_meta', `Unsupported node status "${String(input.status)}".`)
    }
    nextStatus = input.status
  }

  let nextColor = existing.meta.color
  if (input.color !== undefined) {
    if (input.color !== null && !HEX_COLOR_REGEX.test(input.color)) {
      return fail(state, 'invalid_meta', 'Node color must be null or a valid #rrggbb hex string.')
    }
    nextColor = input.color
  }

  let nextTags = existing.meta.tags
  if (input.tags !== undefined) {
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const raw of input.tags) {
      if (!TAG_REGEX.test(raw)) {
        return fail(state, 'invalid_meta', `Tag "${raw}" must match [a-z0-9_-]{1,32}.`)
      }
      if (!seen.has(raw)) {
        seen.add(raw)
        deduped.push(raw)
      }
    }
    if (deduped.length > MAX_NODE_TAGS) {
      return fail(state, 'invalid_meta', `A node can have at most ${MAX_NODE_TAGS} tags.`)
    }
    nextTags = deduped
  }

  const updatedMeta: NodeJson = {
    ...existing.meta,
    type: nextType,
    status: nextStatus,
    color: nextColor,
    tags: [...nextTags],
    updatedAt: input.now,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)
  nodes[input.nodeId] = {
    ...existing,
    meta: updatedMeta,
  }

  return {
    ok: true,
    nodeId: input.nodeId,
    state: preserveRootFields(state, nodes, rootIds),
    changeset: {
      upserts: [
        { path: resolveNodeFilePath(existing.path), content: serializeNodeJson(updatedMeta) },
      ],
      moves: [],
      deletes: [],
    },
  }
}

export function moveNode(state: TreeState, input: MoveNodeInput): TreeOperationResult {
  if (isVirtualRootId(input.nodeId)) {
    return fail(state, 'cannot_mutate_root', `Cannot move virtual root "${VIRTUAL_ROOT_ID}".`)
  }
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  const subtreeBlocker = findBlockingNodeInSubtree(state, input.nodeId)
  if (subtreeBlocker) {
    return failReadOnlyNode(state, 'move', target, subtreeBlocker)
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  const effectiveNewParentId = normalizeParentId(input.newParentId)
  let newParentPath: string | null = null
  if (effectiveNewParentId !== null) {
    const newParent = state.nodes[effectiveNewParentId]
    if (!newParent) {
      return fail(
        state,
        'parent_not_found',
        `Destination parent "${effectiveNewParentId}" not found.`,
      )
    }
    if (newParent.corrupt || newParent.newerSchemaVersion !== undefined) {
      return failReadOnlyNode(state, 'move into', newParent, newParent)
    }
    if (
      effectiveNewParentId === input.nodeId ||
      isDescendant(state, input.nodeId, effectiveNewParentId)
    ) {
      return fail(state, 'cycle_detected', 'Cannot move a node into itself or its own descendant.')
    }
    newParentPath = newParent.path
  }

  if (target.parentId === effectiveNewParentId) {
    return {
      ok: true,
      nodeId: input.nodeId,
      state,
      changeset: EMPTY_CHANGESET,
    }
  }

  const destSiblingIds = getSiblingIds(state, effectiveNewParentId)
  const destSiblingSlugs = destSiblingIds.map((id) => state.nodes[id]!.slug)
  const newSlug = resolveUniqueSlug(target.slug, destSiblingSlugs)
  const newPath = deriveNodePath(newParentPath, newSlug)

  const lastDestSibling =
    destSiblingIds.length > 0 ? state.nodes[destSiblingIds[destSiblingIds.length - 1]!] : null
  const newOrder = generateOrderBetween(lastDestSibling?.meta.order ?? null, null)

  const updatedMeta: NodeJson = {
    ...target.meta,
    order: newOrder,
    updatedAt: input.now,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)

  // Detach from old parent
  let nextRootIds = rootIds
  if (target.parentId === null) {
    nextRootIds = rootIds.filter((id) => id !== input.nodeId)
  } else {
    const oldParent = nodes[target.parentId]!
    nodes[target.parentId] = {
      ...oldParent,
      childrenIds: oldParent.childrenIds.filter((id) => id !== input.nodeId),
    }
  }

  // Update target node
  nodes[input.nodeId] = {
    ...target,
    parentId: effectiveNewParentId,
    slug: newSlug,
    path: newPath,
    meta: updatedMeta,
  }

  // Attach to new parent
  if (effectiveNewParentId === null) {
    nextRootIds = sortSiblingIds(nodes, [...nextRootIds, input.nodeId])
  } else {
    const newParent = nodes[effectiveNewParentId]!
    nodes[effectiveNewParentId] = {
      ...newParent,
      childrenIds: sortSiblingIds(nodes, [...newParent.childrenIds, input.nodeId]),
    }
  }

  // Re-derive descendant paths and record { from, to } moves for the whole subtree
  const moves: FileMove[] = []
  const visited = new Set<string>()
  const queue: Array<{ id: string; oldPath: string; newPath: string }> = [
    { id: input.nodeId, oldPath: target.path, newPath },
  ]

  while (queue.length > 0) {
    const curr = queue.shift()!
    if (visited.has(curr.id)) continue
    visited.add(curr.id)
    const currNode = nodes[curr.id]!
    if (curr.oldPath !== curr.newPath) {
      moves.push({
        from: resolveNodeFilePath(curr.oldPath),
        to: resolveNodeFilePath(curr.newPath),
      })
      if (currNode.hasCanvas) {
        moves.push({
          from: resolveCanvasFilePath(curr.oldPath),
          to: resolveCanvasFilePath(curr.newPath),
        })
      }
      for (const asset of currNode.assets) {
        moves.push({
          from: resolveAssetFilePath(curr.oldPath, asset),
          to: resolveAssetFilePath(curr.newPath, asset),
        })
      }
      for (const extraFile of currNode.extraFiles) {
        moves.push({
          from: resolveExtraFilePath(curr.oldPath, extraFile),
          to: resolveExtraFilePath(curr.newPath, extraFile),
        })
      }
    }

    for (const childId of currNode.childrenIds) {
      const child = nodes[childId]!
      const nextChildPath = deriveNodePath(curr.newPath, child.slug)
      const oldChildPath = child.path
      nodes[childId] = {
        ...child,
        path: nextChildPath,
      }
      queue.push({ id: childId, oldPath: oldChildPath, newPath: nextChildPath })
    }
  }

  return {
    ok: true,
    nodeId: input.nodeId,
    state: preserveRootFields(state, nodes, nextRootIds),
    changeset: {
      upserts: [{ path: resolveNodeFilePath(newPath), content: serializeNodeJson(updatedMeta) }],
      moves,
      deletes: [],
    },
  }
}

export function reorderNode(state: TreeState, input: ReorderNodeInput): TreeOperationResult {
  if (isVirtualRootId(input.nodeId)) {
    return fail(state, 'cannot_mutate_root', `Cannot reorder virtual root "${VIRTUAL_ROOT_ID}".`)
  }
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (target.corrupt || target.newerSchemaVersion !== undefined) {
    return failReadOnlyNode(state, 'reorder', target, target)
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  const siblingIds = getSiblingIds(state, target.parentId)
  const currentIndex = siblingIds.indexOf(input.nodeId)
  if (currentIndex === -1 || siblingIds.length <= 1) {
    return {
      ok: true,
      nodeId: input.nodeId,
      state,
      changeset: EMPTY_CHANGESET,
    }
  }

  const rawTargetIndex =
    'direction' in input
      ? input.direction === 'earlier'
        ? currentIndex - 1
        : currentIndex + 1
      : Math.trunc(input.targetIndex)

  const clampedIndex = Math.max(0, Math.min(siblingIds.length - 1, rawTargetIndex))
  if (clampedIndex === currentIndex) {
    return {
      ok: true,
      nodeId: input.nodeId,
      state,
      changeset: EMPTY_CHANGESET,
    }
  }

  const withoutSelf = siblingIds.filter((id) => id !== input.nodeId)
  const prevId = clampedIndex > 0 ? withoutSelf[clampedIndex - 1]! : null
  const nextId = clampedIndex < withoutSelf.length ? withoutSelf[clampedIndex]! : null

  const prevOrder = prevId ? state.nodes[prevId]!.meta.order : null
  const nextOrder = nextId ? state.nodes[nextId]!.meta.order : null
  if (prevOrder !== null && nextOrder !== null && prevOrder >= nextOrder) {
    return fail(
      state,
      'order_collision',
      `Cannot reorder "${target.path}" between siblings with identical or non-increasing order ("${prevOrder}" and "${nextOrder}").`,
    )
  }

  const newOrder = generateOrderBetween(prevOrder, nextOrder)
  if (
    (prevOrder !== null && newOrder <= prevOrder) ||
    (nextOrder !== null && newOrder >= nextOrder)
  ) {
    return fail(
      state,
      'order_collision',
      `Cannot generate a strictly ordered key between "${prevOrder ?? 'null'}" and "${nextOrder ?? 'null'}".`,
    )
  }

  const updatedMeta: NodeJson = {
    ...target.meta,
    order: newOrder,
    updatedAt: input.now,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)
  nodes[input.nodeId] = {
    ...target,
    meta: updatedMeta,
  }

  let nextRootIds = rootIds
  if (target.parentId === null) {
    nextRootIds = sortSiblingIds(nodes, rootIds)
  } else {
    const parent = nodes[target.parentId]!
    nodes[target.parentId] = {
      ...parent,
      childrenIds: sortSiblingIds(nodes, parent.childrenIds),
    }
  }

  return {
    ok: true,
    nodeId: input.nodeId,
    state: preserveRootFields(state, nodes, nextRootIds),
    changeset: {
      upserts: [
        { path: resolveNodeFilePath(target.path), content: serializeNodeJson(updatedMeta) },
      ],
      moves: [],
      deletes: [],
    },
  }
}

export function deleteNode(state: TreeState, input: DeleteNodeInput): TreeOperationResult {
  if (isVirtualRootId(input.nodeId)) {
    return fail(state, 'cannot_mutate_root', `Cannot delete virtual root "${VIRTUAL_ROOT_ID}".`)
  }
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  const subtreeBlocker = findBlockingNodeInSubtree(state, input.nodeId)
  if (subtreeBlocker) {
    return failReadOnlyNode(state, 'delete', target, subtreeBlocker)
  }

  const subtreeIds = collectSubtreeIds(state, input.nodeId)
  const deletes: string[] = []
  for (const id of subtreeIds) {
    const node = state.nodes[id]!
    deletes.push(resolveNodeFilePath(node.path))
    if (node.hasCanvas) {
      deletes.push(resolveCanvasFilePath(node.path))
    }
    for (const asset of node.assets) {
      deletes.push(resolveAssetFilePath(node.path, asset))
    }
    for (const extraFile of node.extraFiles) {
      deletes.push(resolveExtraFilePath(node.path, extraFile))
    }
  }
  deletes.sort(compareLexicographical)

  const { nodes, rootIds } = cloneStateWithNodes(state)
  for (const id of subtreeIds) {
    delete nodes[id]
  }

  let nextRootIds = rootIds
  if (target.parentId === null) {
    nextRootIds = rootIds.filter((id) => id !== input.nodeId)
  } else {
    const parent = nodes[target.parentId]!
    nodes[target.parentId] = {
      ...parent,
      childrenIds: parent.childrenIds.filter((id) => id !== input.nodeId),
    }
  }

  return {
    ok: true,
    nodeId: input.nodeId,
    state: preserveRootFields(state, nodes, nextRootIds),
    changeset: {
      upserts: [],
      moves: [],
      deletes,
    },
  }
}
