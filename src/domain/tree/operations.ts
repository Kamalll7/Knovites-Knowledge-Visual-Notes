import { ULID_REGEX, type NodeJson } from '@/domain/schema'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import { compareLexicographical, compareSiblings, generateOrderBetween } from '@/domain/tree/order'
import { deriveNodePath, normalizeFolderPath, resolveUniqueSlug, slugify } from '@/domain/tree/slug'
import {
  EMPTY_CHANGESET,
  FORBIDDEN_SLUGS,
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
} from '@/domain/tree/types'

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

function hasCorruptInSubtree(state: TreeState, rootId: string): boolean {
  for (const id of collectSubtreeIds(state, rootId)) {
    if (state.nodes[id]?.corrupt) {
      return true
    }
  }
  return false
}

function normalizeAssets(assets: readonly string[] | undefined): string[] {
  if (!assets || assets.length === 0) return []
  const unique = new Set<string>()
  for (const raw of assets) {
    const clean = raw.replace(/^\/+|\/+$/g, '')
    if (clean.length > 0) {
      unique.add(clean.startsWith('assets/') ? clean : `assets/${clean}`)
    }
  }
  return [...unique].sort(compareLexicographical)
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

  const normalizedEntries = entries
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
    if (path.length === 0 || segments.some((seg) => seg.length === 0 || FORBIDDEN_SLUGS.has(seg))) {
      issues.push({
        path,
        code: 'forbidden_folder_ignored',
        message: `Ignored folder "${path}" because it uses an empty or forbidden segment.`,
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
        path: `${item.path}/node.json`,
        content: serializeNodeJson(meta),
      })
    } else {
      usedIds.add(nodeId)
    }

    pathToId.set(item.path, nodeId)
    nodes[nodeId] = {
      id: nodeId,
      slug: item.slug,
      path: item.path,
      parentId: null,
      meta,
      corrupt: false,
      childrenIds: [],
      assets: normalizeAssets(item.entry.assets),
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
      assets: normalizeAssets(item.entry.assets),
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

  return {
    state: {
      nodes,
      rootIds: sortedRootIds,
    },
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

  let parentPath: string | null = null
  if (input.parentId !== null) {
    const parent = state.nodes[input.parentId]
    if (!parent) {
      return fail(state, 'parent_not_found', `Parent node "${input.parentId}" does not exist.`)
    }
    if (parent.corrupt) {
      return fail(state, 'corrupt_node', 'Cannot create a child inside a corrupt node.')
    }
    parentPath = parent.path
  }

  const id = input.generateId()
  if (!ULID_REGEX.test(id) || id in state.nodes) {
    return fail(state, 'invalid_id', 'Generated node ID must be a unique valid ULID.')
  }

  const siblingIds = getSiblingIds(state, input.parentId)
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
    parentId: input.parentId,
    meta,
    corrupt: false,
    childrenIds: [],
    assets: [],
    hasCanvas: true,
  }

  const { nodes, rootIds } = cloneStateWithNodes(state)
  nodes[id] = newNode

  let nextRootIds = rootIds
  if (input.parentId === null) {
    nextRootIds = sortSiblingIds(nodes, [...rootIds, id])
  } else {
    const parent = nodes[input.parentId]!
    nodes[input.parentId] = {
      ...parent,
      childrenIds: sortSiblingIds(nodes, [...parent.childrenIds, id]),
    }
  }

  const emptyCanvas = serializeCanvasJson({ schema: 1, elements: {} })
  return {
    ok: true,
    nodeId: id,
    state: { nodes, rootIds: nextRootIds },
    changeset: {
      upserts: [
        { path: `${path}/node.json`, content: serializeNodeJson(meta) },
        { path: `${path}/canvas.json`, content: emptyCanvas },
      ],
      moves: [],
      deletes: [],
    },
  }
}

export function renameNode(state: TreeState, input: RenameNodeInput): TreeOperationResult {
  const existing = state.nodes[input.nodeId]
  if (!existing) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (existing.corrupt) {
    return fail(state, 'corrupt_node', 'Cannot rename a corrupt or read-only node.')
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
    state: { nodes, rootIds },
    changeset: {
      upserts: [{ path: `${existing.path}/node.json`, content: serializeNodeJson(updatedMeta) }],
      moves: [],
      deletes: [],
    },
  }
}

export function moveNode(state: TreeState, input: MoveNodeInput): TreeOperationResult {
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (target.corrupt || hasCorruptInSubtree(state, input.nodeId)) {
    return fail(state, 'corrupt_node', 'Cannot move a corrupt node or subtree containing one.')
  }
  if (!isValidTimestamp(input.now)) {
    return fail(state, 'invalid_timestamp', 'Timestamp must be a valid ISO 8601 UTC string.')
  }

  let newParentPath: string | null = null
  if (input.newParentId !== null) {
    const newParent = state.nodes[input.newParentId]
    if (!newParent) {
      return fail(state, 'parent_not_found', `Destination parent "${input.newParentId}" not found.`)
    }
    if (newParent.corrupt) {
      return fail(state, 'corrupt_node', 'Cannot move a node into a corrupt parent.')
    }
    if (
      input.newParentId === input.nodeId ||
      isDescendant(state, input.nodeId, input.newParentId)
    ) {
      return fail(state, 'cycle_detected', 'Cannot move a node into itself or its own descendant.')
    }
    newParentPath = newParent.path
  }

  if (target.parentId === input.newParentId) {
    return {
      ok: true,
      nodeId: input.nodeId,
      state,
      changeset: EMPTY_CHANGESET,
    }
  }

  const destSiblingIds = getSiblingIds(state, input.newParentId)
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
    parentId: input.newParentId,
    slug: newSlug,
    path: newPath,
    meta: updatedMeta,
  }

  // Attach to new parent
  if (input.newParentId === null) {
    nextRootIds = sortSiblingIds(nodes, [...nextRootIds, input.nodeId])
  } else {
    const newParent = nodes[input.newParentId]!
    nodes[input.newParentId] = {
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
        from: `${curr.oldPath}/node.json`,
        to: `${curr.newPath}/node.json`,
      })
      if (currNode.hasCanvas) {
        moves.push({
          from: `${curr.oldPath}/canvas.json`,
          to: `${curr.newPath}/canvas.json`,
        })
      }
      for (const asset of currNode.assets) {
        moves.push({
          from: `${curr.oldPath}/${asset}`,
          to: `${curr.newPath}/${asset}`,
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
    state: { nodes, rootIds: nextRootIds },
    changeset: {
      upserts: [{ path: `${newPath}/node.json`, content: serializeNodeJson(updatedMeta) }],
      moves,
      deletes: [],
    },
  }
}

export function reorderNode(state: TreeState, input: ReorderNodeInput): TreeOperationResult {
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (target.corrupt) {
    return fail(state, 'corrupt_node', 'Cannot reorder a corrupt or read-only node.')
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
  const newOrder = generateOrderBetween(prevOrder, nextOrder)

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
    state: { nodes, rootIds: nextRootIds },
    changeset: {
      upserts: [{ path: `${target.path}/node.json`, content: serializeNodeJson(updatedMeta) }],
      moves: [],
      deletes: [],
    },
  }
}

export function deleteNode(state: TreeState, input: DeleteNodeInput): TreeOperationResult {
  const target = state.nodes[input.nodeId]
  if (!target) {
    return fail(state, 'not_found', `Node "${input.nodeId}" does not exist.`)
  }
  if (target.corrupt || hasCorruptInSubtree(state, input.nodeId)) {
    return fail(state, 'corrupt_node', 'Cannot delete a corrupt node or subtree containing one.')
  }

  const subtreeIds = collectSubtreeIds(state, input.nodeId)
  const deletes: string[] = []
  for (const id of subtreeIds) {
    const node = state.nodes[id]!
    deletes.push(`${node.path}/node.json`)
    if (node.hasCanvas) {
      deletes.push(`${node.path}/canvas.json`)
    }
    for (const asset of node.assets) {
      deletes.push(`${node.path}/${asset}`)
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
    state: { nodes, rootIds: nextRootIds },
    changeset: {
      upserts: [],
      moves: [],
      deletes,
    },
  }
}
