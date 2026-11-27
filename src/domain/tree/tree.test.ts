import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createEmptyCanvas, parseNodeJson, type NodeJson } from '@/domain/schema'
import { serializeCanvasJson, serializeNodeJson } from '@/domain/serialize'
import {
  EMPTY_CHANGESET,
  FORBIDDEN_SLUGS,
  VIRTUAL_ROOT_ID,
  buildTree,
  compareSiblings,
  createNode,
  deleteNode,
  deriveNodePath,
  generateOrderBetween,
  isRootAssetFilePath,
  isValidRepoFilePath,
  moveNode,
  normalizeRepoRelativePath,
  parseCanvasFilePath,
  parseNodeFilePath,
  renameNode,
  reorderNode,
  resolveAssetFilePath,
  resolveCanvasFilePath,
  resolveExtraFilePath,
  resolveNodeFilePath,
  resolveUniqueSlug,
  slugify,
  updateNodeMeta,
  type Changeset,
  type TreeBuildEntry,
  type TreeNode,
  type TreeState,
} from '@/domain/tree'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function makeUlid(n: number): string {
  let num = n
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = CROCKFORD[num % 32]! + suffix
    num = Math.floor(num / 32)
  }
  return `01JC8ZQ4M7X2K9T5${suffix}`
}

function makeIdGenerator(start = 1): () => string {
  let counter = start
  return () => {
    const id = makeUlid(counter)
    counter += 1
    return id
  }
}

function makeNodeMeta(
  id: string,
  title: string,
  order: string,
  now = '2026-11-18T10:00:00Z',
): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'technique',
    status: 'none',
    tags: [],
    order,
    color: null,
    links: [],
    createdAt: now,
    updatedAt: now,
  }
}

function stateToVirtualRepo(state: TreeState): Map<string, string> {
  const files = new Map<string, string>()
  for (const node of Object.values(state.nodes)) {
    if (node.corrupt) {
      files.set(`${node.path}/node.json`, '__CORRUPT__')
      if (node.hasCanvas) {
        files.set(`${node.path}/canvas.json`, '__CORRUPT_CANVAS__')
      }
    } else {
      files.set(`${node.path}/node.json`, serializeNodeJson(node.meta))
      if (node.hasCanvas) {
        files.set(`${node.path}/canvas.json`, serializeCanvasJson(createEmptyCanvas()))
      }
    }
    for (const asset of node.assets) {
      files.set(`${node.path}/${asset}`, `__ASSET__:${asset}`)
    }
    for (const extraFile of node.extraFiles) {
      files.set(`${node.path}/${extraFile}`, `__EXTRA__:${extraFile}`)
    }
  }
  return files
}

function applyChangeset(prevFiles: Map<string, string>, changeset: Changeset): Map<string, string> {
  const next = new Map(prevFiles)

  // 1. deletes first
  for (const del of changeset.deletes) {
    if (!next.has(del)) {
      throw new Error(`Changeset delete target missing: ${del}`)
    }
    next.delete(del)
  }

  // 2. moves next (read all sources before mutating so subtree/chain moves do not clobber each other)
  const movedPayloads: Array<{ from: string; to: string; content: string }> = []
  for (const mv of changeset.moves) {
    const content = next.get(mv.from)
    if (content === undefined) {
      throw new Error(`Changeset move source missing: ${mv.from}`)
    }
    movedPayloads.push({ from: mv.from, to: mv.to, content })
  }
  for (const mv of movedPayloads) {
    next.delete(mv.from)
  }
  for (const mv of movedPayloads) {
    next.set(mv.to, mv.content)
  }

  // 3. upserts last (content in upserts wins over content moved to the same target path)
  for (const up of changeset.upserts) {
    next.set(up.path, up.content)
  }

  return next
}

function assertTreeInvariants(state: TreeState): void {
  const nodeIds = Object.keys(state.nodes)
  const visitedFromRoots = new Set<string>()

  // 1 & 2. No cycles, every node key matches node.id, reachable from rootIds once
  function walk(id: string, expectedParentId: string | null) {
    expect(visitedFromRoots.has(id)).toBe(false)
    visitedFromRoots.add(id)
    const node = state.nodes[id]
    expect(node).toBeDefined()
    if (!node) return
    expect(node.id).toBe(id)
    expect(node.parentId).toBe(expectedParentId)

    const expectedPath =
      expectedParentId === null
        ? node.slug
        : deriveNodePath(state.nodes[expectedParentId]!.path, node.slug)
    expect(node.path).toBe(expectedPath)

    // 3 & 4. Children slugs unique & not forbidden, children sorted & stable
    const childSlugs = new Set<string>()
    for (let i = 0; i < node.childrenIds.length; i += 1) {
      const childId = node.childrenIds[i]!
      const child = state.nodes[childId]!
      expect(child).toBeDefined()
      expect(FORBIDDEN_SLUGS.has(child.slug)).toBe(false)
      expect(childSlugs.has(child.slug)).toBe(false)
      childSlugs.add(child.slug)

      if (i > 0) {
        const prevChild = state.nodes[node.childrenIds[i - 1]!]!
        expect(
          compareSiblings(
            { order: prevChild.meta.order, id: prevChild.id },
            { order: child.meta.order, id: child.id },
          ),
        ).toBeLessThan(0)
      }
      walk(childId, id)
    }
  }

  const rootSlugs = new Set<string>()
  for (let i = 0; i < state.rootIds.length; i += 1) {
    const rootId = state.rootIds[i]!
    const rootNode = state.nodes[rootId]!
    expect(rootNode).toBeDefined()
    expect(FORBIDDEN_SLUGS.has(rootNode.slug)).toBe(false)
    expect(rootSlugs.has(rootNode.slug)).toBe(false)
    rootSlugs.add(rootNode.slug)

    if (i > 0) {
      const prevRoot = state.nodes[state.rootIds[i - 1]!]!
      expect(
        compareSiblings(
          { order: prevRoot.meta.order, id: prevRoot.id },
          { order: rootNode.meta.order, id: rootNode.id },
        ),
      ).toBeLessThan(0)
    }
    walk(rootId, null)
  }

  expect(visitedFromRoots.size).toBe(nodeIds.length)

  // Parent pointer termination check
  for (const id of nodeIds) {
    let curr: TreeNode | undefined = state.nodes[id]
    let steps = 0
    while (curr && curr.parentId !== null) {
      curr = state.nodes[curr.parentId]
      steps += 1
      expect(steps).toBeLessThanOrEqual(nodeIds.length)
    }
    expect(curr).toBeDefined()
  }
}

describe('domain/tree [T1.3]', () => {
  describe('slugify and resolveUniqueSlug', () => {
    it('normalizes ASCII, collapses hyphens, truncates at 48 chars, and avoids forbidden slugs', () => {
      expect(slugify('Ret2Win — Stack Overflow!!')).toBe('ret2win-stack-overflow')
      expect(slugify('Café & Résumé')).toBe('cafe-resume')
      expect(slugify('   ...   ')).toBe('node')
      expect(slugify('')).toBe('node')
      expect(slugify('a'.repeat(80))).toHaveLength(48)
      expect(slugify(`${'a'.repeat(47)}-b`)).toHaveLength(47)

      expect(slugify('assets')).toBe('node')
      expect(slugify('ASSETS')).toBe('node')
      for (const forbidden of ['assets', '.git', '.github', 'node_modules', 'ASSETS']) {
        expect(FORBIDDEN_SLUGS.has(slugify(forbidden))).toBe(false)
        expect(FORBIDDEN_SLUGS.has(resolveUniqueSlug(forbidden, []))).toBe(false)
      }
      expect(resolveUniqueSlug('.git', [])).toBe('node')
      expect(resolveUniqueSlug('node_modules', [])).toBe('node')
    })

    it('appends -2, -3 on sibling slug collisions', () => {
      expect(resolveUniqueSlug('stack', [])).toBe('stack')
      expect(resolveUniqueSlug('stack', ['stack'])).toBe('stack-2')
      expect(resolveUniqueSlug('stack', ['stack', 'stack-2'])).toBe('stack-3')
      expect(resolveUniqueSlug('assets', ['node'])).toBe('node-2')
    })
  })

  describe('buildTree and bad-input resilience', () => {
    it('builds hierarchy from flat parsed entries, sorts by (order, id), and repairs duplicate IDs deterministically', () => {
      const idA = makeUlid(1)
      const idB = makeUlid(2)
      const dupId = makeUlid(3)

      const entries: TreeBuildEntry[] = [
        { path: 'pwn/b-node', node: makeNodeMeta(idB, 'B', 'a1'), hasCanvas: true },
        { path: 'pwn/a-node', node: makeNodeMeta(dupId, 'A', 'a0'), hasCanvas: true },
        { path: 'pwn', node: makeNodeMeta(idA, 'PWN', 'a0'), hasCanvas: true },
        { path: 'zzz', node: makeNodeMeta(dupId, 'ZZZ', 'a1'), hasCanvas: true },
      ]

      const built = buildTree(entries, { generateId: makeIdGenerator(100) })
      expect(built.issues.some((i) => i.code === 'duplicate_id_repaired')).toBe(true)

      const repairIssue = built.issues.find((i) => i.code === 'duplicate_id_repaired')!
      expect(repairIssue.path).toBe('zzz')
      expect(repairIssue.oldId).toBe(dupId)
      expect(repairIssue.newId).toBe(makeUlid(100))

      // First path ('pwn/a-node') keeps dupId; later path ('zzz') gets repaired ID
      expect(built.state.nodes[dupId]?.path).toBe('pwn/a-node')
      expect(built.state.nodes[makeUlid(100)]?.path).toBe('zzz')
      expect(built.changeset.upserts).toHaveLength(1)
      expect(built.changeset.upserts[0]?.path).toBe('zzz/node.json')
      expect(built.state.nodes[idA]?.childrenIds).toEqual([dupId, idB])
      assertTreeInvariants(built.state)
    })

    it('handles invalid fractional-indexing order strings and preserves corrupt nodes as read-only', () => {
      const id1 = makeUlid(1)
      const id2 = makeUlid(2)
      const entries: TreeBuildEntry[] = [
        { path: 'alpha', node: makeNodeMeta(id1, 'Alpha', '001-bad-order!'), hasCanvas: true },
        { path: 'beta', node: makeNodeMeta(id2, 'Beta', 'a00'), hasCanvas: true },
        {
          path: 'broken-node',
          corrupt: true,
          corruptErrors: [{ path: 'id', code: 'invalid_string', message: 'Invalid ULID' }],
          hasCanvas: true,
        },
      ]

      const built = buildTree(entries, { generateId: makeIdGenerator(50) })
      expect(built.issues.some((i) => i.code === 'corrupt_node')).toBe(true)
      assertTreeInvariants(built.state)

      const corruptNode = Object.values(built.state.nodes).find((n) => n.corrupt)!
      expect(corruptNode.slug).toBe('broken-node')

      // Operations targeting corrupt node are rejected without modifying state or changeset
      const r1 = renameNode(built.state, {
        nodeId: corruptNode.id,
        title: 'Hack',
        now: '2026-11-18T12:00:00Z',
      })
      expect(r1.ok).toBe(false)
      if (!r1.ok) expect(r1.reason).toBe('corrupt_node')

      const r2 = deleteNode(built.state, { nodeId: corruptNode.id })
      expect(r2.ok).toBe(false)

      const r3 = moveNode(built.state, {
        nodeId: id1,
        newParentId: corruptNode.id,
        now: '2026-11-18T12:00:00Z',
      })
      expect(r3.ok).toBe(false)

      // Sibling reorder next to malformed order strings still succeeds deterministically
      const r4 = reorderNode(built.state, {
        nodeId: id2,
        targetIndex: 0,
        now: '2026-11-18T12:00:00Z',
      })
      expect(r4.ok).toBe(true)
      if (r4.ok) {
        assertTreeInvariants(r4.state)
        expect(r4.state.rootIds[0]).toBe(id2)
        expect(r4.state.nodes[id2]!.meta.order < r4.state.nodes[id1]!.meta.order).toBe(true)
      }
    })
  })

  describe('pure tree operations (create, rename, move, reorder, delete)', () => {
    it('creates nodes with unique slugs, default fields, canvas.json, and fractional order', () => {
      const gen = makeIdGenerator(1)
      const now = '2026-11-18T10:00:00Z'
      let state = buildTree([]).state

      const c1 = createNode(state, { title: 'PWN', parentId: null, now, generateId: gen })
      expect(c1.ok).toBe(true)
      state = c1.state
      expect(c1.changeset.upserts.map((u) => u.path)).toEqual(['pwn/node.json', 'pwn/canvas.json'])
      expect(c1.changeset.moves).toEqual([])
      expect(c1.changeset.deletes).toEqual([])

      const c2 = createNode(state, { title: 'PWN', parentId: null, now, generateId: gen })
      expect(c2.ok).toBe(true)
      state = c2.state
      if (c2.ok) {
        expect(state.nodes[c2.nodeId]?.slug).toBe('pwn-2')
        expect(state.nodes[c2.nodeId]?.path).toBe('pwn-2')
        const parsed = parseNodeJson(c2.changeset.upserts[0]!.content)
        expect(parsed.status).toBe('ok')
      }

      const c3 = createNode(state, {
        title: 'Stack',
        type: 'category',
        parentId: c1.ok ? c1.nodeId : null,
        now,
        generateId: gen,
      })
      expect(c3.ok).toBe(true)
      state = c3.state
      if (c3.ok) {
        expect(state.nodes[c3.nodeId]?.path).toBe('pwn/stack')
      }
      assertTreeInvariants(state)
    })

    it('renames only title and updatedAt without changing slug or path', () => {
      const gen = makeIdGenerator(1)
      const c1 = createNode(buildTree([]).state, {
        title: 'Old Title',
        parentId: null,
        now: '2026-11-18T10:00:00Z',
        generateId: gen,
      })
      expect(c1.ok).toBe(true)
      if (!c1.ok) return

      const renamed = renameNode(c1.state, {
        nodeId: c1.nodeId,
        title: 'New Completely Different Title',
        now: '2026-11-18T11:00:00Z',
      })
      expect(renamed.ok).toBe(true)
      const node = renamed.state.nodes[c1.nodeId]!
      expect(node.meta.title).toBe('New Completely Different Title')
      expect(node.meta.updatedAt).toBe('2026-11-18T11:00:00Z')
      expect(node.meta.createdAt).toBe('2026-11-18T10:00:00Z')
      expect(node.slug).toBe('old-title')
      expect(node.path).toBe('old-title')
      expect(renamed.changeset.upserts.map((u) => u.path)).toEqual(['old-title/node.json'])
      expect(renamed.changeset.moves).toEqual([])
      expect(renamed.changeset.deletes).toEqual([])
      assertTreeInvariants(renamed.state)
    })

    it('moves subtree with {from, to} moves, resolves slug collisions, and prevents cycles', () => {
      const idPwn = makeUlid(1)
      const idStack = makeUlid(2)
      const idRet = makeUlid(3)
      const idRe = makeUlid(4)
      const idReStack = makeUlid(5)

      const built = buildTree([
        { path: 'pwn', node: makeNodeMeta(idPwn, 'PWN', 'a0'), hasCanvas: true },
        {
          path: 'pwn/stack',
          node: makeNodeMeta(idStack, 'Stack', 'a0'),
          hasCanvas: true,
          assets: ['assets/1234567890abcdef.png'],
        },
        { path: 'pwn/stack/ret2win', node: makeNodeMeta(idRet, 'ret2win', 'a0'), hasCanvas: true },
        { path: 're', node: makeNodeMeta(idRe, 'RE', 'a1'), hasCanvas: true },
        { path: 're/stack', node: makeNodeMeta(idReStack, 'Stack', 'a0'), hasCanvas: true },
      ])

      // Cycle checks: self and descendant must be rejected
      const selfMove = moveNode(built.state, {
        nodeId: idPwn,
        newParentId: idPwn,
        now: '2026-11-18T11:00:00Z',
      })
      expect(selfMove.ok).toBe(false)
      if (!selfMove.ok) expect(selfMove.reason).toBe('cycle_detected')

      const descendantMove = moveNode(built.state, {
        nodeId: idPwn,
        newParentId: idRet,
        now: '2026-11-18T11:00:00Z',
      })
      expect(descendantMove.ok).toBe(false)
      if (!descendantMove.ok) expect(descendantMove.reason).toBe('cycle_detected')

      // Move pwn/stack under re (which already has 'stack')
      const prevFiles = stateToVirtualRepo(built.state)
      const moved = moveNode(built.state, {
        nodeId: idStack,
        newParentId: idRe,
        now: '2026-11-18T12:00:00Z',
      })
      expect(moved.ok).toBe(true)
      expect(moved.state.nodes[idStack]?.slug).toBe('stack-2')
      expect(moved.state.nodes[idStack]?.path).toBe('re/stack-2')
      expect(moved.state.nodes[idRet]?.path).toBe('re/stack-2/ret2win')
      expect(moved.changeset.deletes).toEqual([])
      expect(moved.changeset.upserts.map((u) => u.path)).toEqual(['re/stack-2/node.json'])
      expect(moved.changeset.moves).toEqual(
        expect.arrayContaining([
          { from: 'pwn/stack/node.json', to: 're/stack-2/node.json' },
          { from: 'pwn/stack/canvas.json', to: 're/stack-2/canvas.json' },
          {
            from: 'pwn/stack/assets/1234567890abcdef.png',
            to: 're/stack-2/assets/1234567890abcdef.png',
          },
          { from: 'pwn/stack/ret2win/node.json', to: 're/stack-2/ret2win/node.json' },
          { from: 'pwn/stack/ret2win/canvas.json', to: 're/stack-2/ret2win/canvas.json' },
        ]),
      )
      expect(applyChangeset(prevFiles, moved.changeset)).toEqual(stateToVirtualRepo(moved.state))
      assertTreeInvariants(moved.state)
    })

    it('reorders siblings earlier/later/by index and updates only the moved node.json', () => {
      const idA = makeUlid(1)
      const idB = makeUlid(2)
      const idC = makeUlid(3)
      const built = buildTree([
        { path: 'a', node: makeNodeMeta(idA, 'A', 'a0'), hasCanvas: true },
        { path: 'b', node: makeNodeMeta(idB, 'B', 'a1'), hasCanvas: true },
        { path: 'c', node: makeNodeMeta(idC, 'C', 'a2'), hasCanvas: true },
      ])

      const moveEarlier = reorderNode(built.state, {
        nodeId: idC,
        direction: 'earlier',
        now: '2026-11-18T12:00:00Z',
      })
      expect(moveEarlier.ok).toBe(true)
      expect(moveEarlier.state.rootIds).toEqual([idA, idC, idB])
      expect(moveEarlier.changeset.upserts.map((u) => u.path)).toEqual(['c/node.json'])
      expect(moveEarlier.changeset.moves).toEqual([])
      expect(moveEarlier.changeset.deletes).toEqual([])
      assertTreeInvariants(moveEarlier.state)

      const moveLater = reorderNode(moveEarlier.state, {
        nodeId: idA,
        direction: 'later',
        now: '2026-11-18T12:01:00Z',
      })
      expect(moveLater.ok).toBe(true)
      expect(moveLater.state.rootIds).toEqual([idC, idA, idB])
      expect(moveLater.changeset.upserts.map((u) => u.path)).toEqual(['a/node.json'])
      assertTreeInvariants(moveLater.state)

      const moveToStart = reorderNode(moveLater.state, {
        nodeId: idB,
        targetIndex: 0,
        now: '2026-11-18T12:02:00Z',
      })
      expect(moveToStart.ok).toBe(true)
      expect(moveToStart.state.rootIds).toEqual([idB, idC, idA])
      assertTreeInvariants(moveToStart.state)
    })

    it('deletes subtree, emits all subtree files in deletes, and leaves remaining links intact', () => {
      const idA = makeUlid(1)
      const idB = makeUlid(2)
      const idC = makeUlid(3)
      const metaC = {
        ...makeNodeMeta(idC, 'C', 'a1'),
        links: [{ to: idA, label: 'parent' }],
      }
      const built = buildTree([
        {
          path: 'a',
          node: makeNodeMeta(idA, 'A', 'a0'),
          hasCanvas: true,
          assets: ['assets/1111222233334444.webp'],
        },
        { path: 'a/b', node: makeNodeMeta(idB, 'B', 'a0'), hasCanvas: true },
        { path: 'c', node: metaC, hasCanvas: true },
      ])

      const prevFiles = stateToVirtualRepo(built.state)
      const deleted = deleteNode(built.state, { nodeId: idA })
      expect(deleted.ok).toBe(true)
      expect(deleted.state.rootIds).toEqual([idC])
      expect(deleted.state.nodes[idA]).toBeUndefined()
      expect(deleted.state.nodes[idB]).toBeUndefined()
      expect(deleted.state.nodes[idC]?.meta.links).toEqual([{ to: idA, label: 'parent' }])
      expect(deleted.changeset.deletes.sort()).toEqual([
        'a/assets/1111222233334444.webp',
        'a/b/canvas.json',
        'a/b/node.json',
        'a/canvas.json',
        'a/node.json',
      ])
      expect(applyChangeset(prevFiles, deleted.changeset)).toEqual(
        stateToVirtualRepo(deleted.state),
      )
      assertTreeInvariants(deleted.state)
    })

    it('rejects reorderNode with order_collision when target neighbors share an identical order (e.g. corrupt sibling) and allows valid positions', () => {
      const idA = makeUlid(1)
      const idC = makeUlid(3)
      // idA ('a0') and broken-node (fallback 'a0') share identical order 'a0'; idC has 'a1'
      const built = buildTree([
        { path: 'alpha', node: makeNodeMeta(idA, 'Alpha', 'a0'), hasCanvas: true },
        {
          path: 'broken-node',
          corrupt: true,
          corruptErrors: [{ path: 'order', code: 'invalid', message: 'corrupt' }],
          hasCanvas: false,
        },
        { path: 'charlie', node: makeNodeMeta(idC, 'Charlie', 'a1'), hasCanvas: true },
      ])

      const corruptId = Object.values(built.state.nodes).find((n) => n.corrupt)!.id
      expect(built.state.rootIds).toEqual([idA, corruptId, idC])

      // Moving charlie earlier targets index 1 (between alpha='a0' and broken-node='a0')
      const tiedReorder = reorderNode(built.state, {
        nodeId: idC,
        direction: 'earlier',
        now: '2026-11-18T12:00:00Z',
      })
      expect(tiedReorder.ok).toBe(false)
      if (!tiedReorder.ok) {
        expect(tiedReorder.reason).toBe('order_collision')
        expect(tiedReorder.message).toContain('"a0"')
      }
      expect(tiedReorder.state).toBe(built.state)
      expect(tiedReorder.changeset).toEqual({ upserts: [], moves: [], deletes: [] })

      // Moving charlie to index 0 (before alpha='a0') has a strict open bound and succeeds cleanly
      const validMoveToFront = reorderNode(built.state, {
        nodeId: idC,
        targetIndex: 0,
        now: '2026-11-18T12:01:00Z',
      })
      expect(validMoveToFront.ok).toBe(true)
      expect(validMoveToFront.state.rootIds).toEqual([idC, idA, corruptId])
      expect(validMoveToFront.state.nodes[idC]!.meta.order < 'a0').toBe(true)
      assertTreeInvariants(validMoveToFront.state)
    })

    it('lexicographical ordering wrapper never throws on pathological bounds', () => {
      const k1 = generateOrderBetween(null, '001')
      expect(k1 < '001').toBe(true)
      const k2 = generateOrderBetween('a00', 'a01')
      expect(k2 > 'a00' && k2 < 'a01').toBe(true)
      const k3 = generateOrderBetween('bad key', null)
      expect(k3 > 'bad key').toBe(true)
    })

    it('moves and deletes unreferenced node folder files (orphan assets and unknown extraFiles)', () => {
      const idRoot = makeUlid(1)
      const idChild = makeUlid(2)
      const idDest = makeUlid(3)

      const built = buildTree([
        {
          path: 'pwn',
          node: makeNodeMeta(idRoot, 'PWN', 'a0'),
          hasCanvas: false,
          assets: ['assets/deadbeef12345678.png', 'assets/orphan-note-diagram.svg'],
          extraFiles: ['README.local.md', 'attachments/exploit.py'],
        },
        {
          path: 'pwn/rop',
          node: makeNodeMeta(idChild, 'ROP', 'a0'),
          hasCanvas: true,
          assets: ['assets/cafebabe00001111.webp'],
          extraFiles: ['gadgets.txt'],
        },
        {
          path: 'archive',
          node: makeNodeMeta(idDest, 'Archive', 'a1'),
          hasCanvas: true,
        },
      ])

      const initialRepo = stateToVirtualRepo(built.state)

      // Move pwn subtree under archive
      const moved = moveNode(built.state, {
        nodeId: idRoot,
        newParentId: idDest,
        now: '2026-11-18T12:00:00Z',
      })
      expect(moved.ok).toBe(true)
      expect(moved.changeset.moves).toEqual(
        expect.arrayContaining([
          { from: 'pwn/node.json', to: 'archive/pwn/node.json' },
          {
            from: 'pwn/assets/deadbeef12345678.png',
            to: 'archive/pwn/assets/deadbeef12345678.png',
          },
          {
            from: 'pwn/assets/orphan-note-diagram.svg',
            to: 'archive/pwn/assets/orphan-note-diagram.svg',
          },
          { from: 'pwn/README.local.md', to: 'archive/pwn/README.local.md' },
          { from: 'pwn/attachments/exploit.py', to: 'archive/pwn/attachments/exploit.py' },
          { from: 'pwn/rop/node.json', to: 'archive/pwn/rop/node.json' },
          { from: 'pwn/rop/canvas.json', to: 'archive/pwn/rop/canvas.json' },
          {
            from: 'pwn/rop/assets/cafebabe00001111.webp',
            to: 'archive/pwn/rop/assets/cafebabe00001111.webp',
          },
          { from: 'pwn/rop/gadgets.txt', to: 'archive/pwn/rop/gadgets.txt' },
        ]),
      )
      expect(moved.changeset.upserts).toEqual([
        {
          path: 'archive/pwn/node.json',
          content: serializeNodeJson(moved.state.nodes[idRoot]!.meta),
        },
      ])

      // Verify Changeset semantics: deletes -> moves -> upserts, and upserts overwrites moved node.json
      const repoAfterMove = applyChangeset(initialRepo, moved.changeset)
      expect(repoAfterMove).toEqual(stateToVirtualRepo(moved.state))
      expect(repoAfterMove.get('archive/pwn/node.json')).toBe(
        serializeNodeJson(moved.state.nodes[idRoot]!.meta),
      )

      // Delete moved subtree and verify all orphan assets and extraFiles are listed in deletes
      const deleted = deleteNode(moved.state, { nodeId: idRoot })
      expect(deleted.ok).toBe(true)
      expect(deleted.changeset.deletes).toEqual([
        'archive/pwn/README.local.md',
        'archive/pwn/assets/deadbeef12345678.png',
        'archive/pwn/assets/orphan-note-diagram.svg',
        'archive/pwn/attachments/exploit.py',
        'archive/pwn/node.json',
        'archive/pwn/rop/assets/cafebabe00001111.webp',
        'archive/pwn/rop/canvas.json',
        'archive/pwn/rop/gadgets.txt',
        'archive/pwn/rop/node.json',
      ])
      expect(applyChangeset(repoAfterMove, deleted.changeset)).toEqual(
        stateToVirtualRepo(deleted.state),
      )
    })

    it('rejects moveNode and deleteNode on valid parents when subtree contains corrupt or newer-schema descendants', () => {
      const idParentWithCorrupt = makeUlid(10)
      const idParentWithNewer = makeUlid(11)
      const idDest = makeUlid(12)

      const built = buildTree([
        { path: 'group-corrupt', node: makeNodeMeta(idParentWithCorrupt, 'Group Corrupt', 'a0') },
        {
          path: 'group-corrupt/bad-child',
          parseResult: {
            status: 'corrupt',
            errors: [{ path: 'title', code: 'too_small', message: 'Empty title' }],
          },
          hasCanvas: true,
        },
        { path: 'group-newer', node: makeNodeMeta(idParentWithNewer, 'Group Newer', 'a1') },
        {
          path: 'group-newer/future-child',
          parseResult: {
            status: 'newer-schema',
            schemaVersion: 2,
          },
          hasCanvas: true,
        },
        { path: 'dest', node: makeNodeMeta(idDest, 'Destination', 'a2') },
      ])

      const moveCorruptParent = moveNode(built.state, {
        nodeId: idParentWithCorrupt,
        newParentId: idDest,
        now: '2026-11-18T12:00:00Z',
      })
      expect(moveCorruptParent.ok).toBe(false)
      if (!moveCorruptParent.ok) {
        expect(moveCorruptParent.reason).toBe('corrupt_node')
        expect(moveCorruptParent.message).toContain('group-corrupt/bad-child')
      }
      expect(moveCorruptParent.state).toBe(built.state)
      expect(moveCorruptParent.changeset).toEqual({ upserts: [], moves: [], deletes: [] })

      const deleteCorruptParent = deleteNode(built.state, { nodeId: idParentWithCorrupt })
      expect(deleteCorruptParent.ok).toBe(false)
      if (!deleteCorruptParent.ok) {
        expect(deleteCorruptParent.reason).toBe('corrupt_node')
        expect(deleteCorruptParent.message).toContain('group-corrupt/bad-child')
      }
      expect(deleteCorruptParent.state).toBe(built.state)
      expect(deleteCorruptParent.changeset).toEqual({ upserts: [], moves: [], deletes: [] })

      const moveNewerParent = moveNode(built.state, {
        nodeId: idParentWithNewer,
        newParentId: idDest,
        now: '2026-11-18T12:00:00Z',
      })
      expect(moveNewerParent.ok).toBe(false)
      if (!moveNewerParent.ok) {
        expect(moveNewerParent.reason).toBe('newer_schema_node')
        expect(moveNewerParent.message).toContain('v2')
        expect(moveNewerParent.message).toContain('group-newer/future-child')
      }
      expect(moveNewerParent.state).toBe(built.state)
      expect(moveNewerParent.changeset).toEqual({ upserts: [], moves: [], deletes: [] })

      const deleteNewerParent = deleteNode(built.state, { nodeId: idParentWithNewer })
      expect(deleteNewerParent.ok).toBe(false)
      if (!deleteNewerParent.ok) {
        expect(deleteNewerParent.reason).toBe('newer_schema_node')
        expect(deleteNewerParent.message).toContain('v2')
        expect(deleteNewerParent.message).toContain('group-newer/future-child')
      }
      expect(deleteNewerParent.state).toBe(built.state)
      expect(deleteNewerParent.changeset).toEqual({ upserts: [], moves: [], deletes: [] })
    })
  })

  describe('model-based property test with fast-check', () => {
    it('maintains all tree invariants and exact changeset diffs across random operation sequences', () => {
      type OpCmd =
        | { kind: 'create'; parentIdx: number; title: string; type: NodeJson['type'] }
        | { kind: 'rename'; nodeIdx: number; title: string }
        | { kind: 'move'; nodeIdx: number; parentIdx: number }
        | { kind: 'reorder'; nodeIdx: number; direction: 'earlier' | 'later' }
        | { kind: 'delete'; nodeIdx: number }

      const titleArb = fc.oneof(
        fc.constantFrom('PWN', 'Stack', 'Heap', 'ROP', 'assets', '.git', 'Café', 'A'),
        fc.string({ minLength: 1, maxLength: 60 }),
      )

      const opArb: fc.Arbitrary<OpCmd> = fc.oneof(
        fc.record({
          kind: fc.constant('create' as const),
          parentIdx: fc.integer({ min: -1, max: 20 }),
          title: titleArb,
          type: fc.constantFrom('category', 'concept', 'technique', 'challenge'),
        }),
        fc.record({
          kind: fc.constant('rename' as const),
          nodeIdx: fc.integer({ min: 0, max: 20 }),
          title: titleArb,
        }),
        fc.record({
          kind: fc.constant('move' as const),
          nodeIdx: fc.integer({ min: 0, max: 20 }),
          parentIdx: fc.integer({ min: -1, max: 20 }),
        }),
        fc.record({
          kind: fc.constant('reorder' as const),
          nodeIdx: fc.integer({ min: 0, max: 20 }),
          direction: fc.constantFrom('earlier' as const, 'later' as const),
        }),
        fc.record({
          kind: fc.constant('delete' as const),
          nodeIdx: fc.integer({ min: 0, max: 20 }),
        }),
      )

      fc.assert(
        fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
          const gen = makeIdGenerator(1)
          const corruptId = makeUlid(9000)
          const initialBuilt = buildTree([
            {
              path: 'locked-corrupt',
              corrupt: true,
              corruptErrors: [{ path: 'schema', code: 'invalid_schema', message: 'bad' }],
              hasCanvas: true,
            },
            {
              path: 'seed-root',
              node: makeNodeMeta(
                corruptId === makeUlid(1) ? makeUlid(2) : makeUlid(1000),
                'Seed',
                'a0',
              ),
              hasCanvas: true,
              assets: ['assets/abcdef0123456789.png'],
              extraFiles: ['notes.local.txt'],
            },
          ])
          let state = initialBuilt.state
          let virtualRepo = stateToVirtualRepo(state)

          for (let step = 0; step < ops.length; step += 1) {
            const op = ops[step]!
            const now = new Date(Date.UTC(2026, 10, 18, 10, 0, step)).toISOString()
            const allIds = Object.keys(state.nodes).sort()
            const prevState = state

            let result
            if (op.kind === 'create') {
              const parentId =
                op.parentIdx < 0 || allIds.length === 0
                  ? null
                  : allIds[op.parentIdx % allIds.length]!
              result = createNode(state, {
                title: op.title,
                type: op.type,
                parentId,
                now,
                generateId: gen,
              })
            } else if (allIds.length === 0) {
              continue
            } else if (op.kind === 'rename') {
              const nodeId = allIds[op.nodeIdx % allIds.length]!
              result = renameNode(state, { nodeId, title: op.title, now })
            } else if (op.kind === 'move') {
              const nodeId = allIds[op.nodeIdx % allIds.length]!
              const newParentId = op.parentIdx < 0 ? null : allIds[op.parentIdx % allIds.length]!
              result = moveNode(state, { nodeId, newParentId, now })
            } else if (op.kind === 'reorder') {
              const nodeId = allIds[op.nodeIdx % allIds.length]!
              const target = prevState.nodes[nodeId]!
              const prevSiblings =
                target.parentId === null
                  ? prevState.rootIds
                  : prevState.nodes[target.parentId]!.childrenIds
              const prevIdx = prevSiblings.indexOf(nodeId)
              const expectedIdx =
                op.direction === 'earlier'
                  ? Math.max(0, prevIdx - 1)
                  : Math.min(prevSiblings.length - 1, prevIdx + 1)
              result = reorderNode(state, { nodeId, direction: op.direction, now })
              if (result.ok) {
                const nextSiblings =
                  target.parentId === null
                    ? result.state.rootIds
                    : result.state.nodes[target.parentId]!.childrenIds
                expect(nextSiblings.indexOf(nodeId)).toBe(expectedIdx)
              }
            } else {
              const nodeId = allIds[op.nodeIdx % allIds.length]!
              result = deleteNode(state, { nodeId })
            }

            state = result.state
            assertTreeInvariants(state)

            const nextVirtualRepo = applyChangeset(virtualRepo, result.changeset)
            expect(nextVirtualRepo).toEqual(stateToVirtualRepo(state))
            virtualRepo = nextVirtualRepo

            if (!result.ok) {
              expect(state).toBe(prevState)
              expect(result.changeset).toEqual({ upserts: [], moves: [], deletes: [] })
            }
          }
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('home root ("__root__") paths, rootExtraFiles/rootAssets, and root mutation guards [M3-HomeRoot]', () => {
    it('resolves slash-free repo file paths for both virtual root and regular nodes', () => {
      expect(normalizeRepoRelativePath('/canvas.json')).toBe('canvas.json')
      expect(normalizeRepoRelativePath('./assets/7ab1c2d3e4f50987.webp')).toBe(
        'assets/7ab1c2d3e4f50987.webp',
      )

      expect(resolveCanvasFilePath('')).toBe('canvas.json')
      expect(resolveCanvasFilePath('/')).toBe('canvas.json')
      expect(resolveCanvasFilePath('pwn')).toBe('pwn/canvas.json')
      expect(resolveCanvasFilePath('/pwn/rop/')).toBe('pwn/rop/canvas.json')

      expect(resolveAssetFilePath('', 'assets/7ab1c2d3e4f50987.webp')).toBe(
        'assets/7ab1c2d3e4f50987.webp',
      )
      expect(resolveAssetFilePath('', '/assets/7ab1c2d3e4f50987.webp')).toBe(
        'assets/7ab1c2d3e4f50987.webp',
      )
      expect(resolveAssetFilePath('', '7ab1c2d3e4f50987.webp')).toBe('assets/7ab1c2d3e4f50987.webp')
      expect(resolveAssetFilePath('pwn/rop', 'assets/3fa9c1d2e4b5a671.webp')).toBe(
        'pwn/rop/assets/3fa9c1d2e4b5a671.webp',
      )
      expect(resolveAssetFilePath('/pwn/', '3fa9c1d2e4b5a671.webp')).toBe(
        'pwn/assets/3fa9c1d2e4b5a671.webp',
      )

      expect(resolveExtraFilePath('', 'README.md')).toBe('README.md')
      expect(resolveExtraFilePath('', '/.gitignore')).toBe('.gitignore')
      expect(resolveExtraFilePath('pwn', 'exploit.py')).toBe('pwn/exploit.py')

      expect(resolveNodeFilePath('pwn/rop')).toBe('pwn/rop/node.json')
      expect(() => resolveNodeFilePath('')).toThrow()
      expect(() => resolveNodeFilePath('/')).toThrow()

      expect(parseCanvasFilePath('canvas.json')).toEqual({ isRoot: true, ownerPath: '' })
      expect(parseCanvasFilePath('pwn/canvas.json')).toEqual({ isRoot: false, ownerPath: 'pwn' })
      expect(parseCanvasFilePath('pwn/rop/canvas.json')).toEqual({
        isRoot: false,
        ownerPath: 'pwn/rop',
      })
      expect(parseCanvasFilePath('/canvas.json')).toBeNull()
      expect(parseCanvasFilePath('/pwn/canvas.json')).toBeNull()
      expect(parseCanvasFilePath('pwn/node.json')).toBeNull()

      expect(parseNodeFilePath('pwn/node.json')).toBe('pwn')
      expect(parseNodeFilePath('node.json')).toBeNull()
      expect(parseNodeFilePath('/pwn/node.json')).toBeNull()

      expect(isRootAssetFilePath('assets/7ab1c2d3e4f50987.webp')).toBe(true)
      expect(isRootAssetFilePath('/assets/7ab1c2d3e4f50987.webp')).toBe(false)
      expect(isRootAssetFilePath('pwn/assets/7ab1c2d3e4f50987.webp')).toBe(false)
      expect(isRootAssetFilePath('assets/')).toBe(false)
      expect(isRootAssetFilePath('assets/../secret.txt')).toBe(false)

      expect(isValidRepoFilePath('canvas.json')).toBe(true)
      expect(isValidRepoFilePath('assets/7ab1c2d3e4f50987.webp')).toBe(true)
      expect(isValidRepoFilePath('/canvas.json')).toBe(false)
      expect(isValidRepoFilePath('pwn//canvas.json')).toBe(false)
      expect(isValidRepoFilePath('')).toBe(false)
    })

    it('separates rootExtraFiles and rootAssets, detects optional root canvas.json, and preserves missing_parent_ignored in buildTree', () => {
      const idPwn = makeUlid(1)
      const idOrphanChild = makeUlid(2)
      const idAssetsNode = makeUlid(3)
      const idReservedCanvas = makeUlid(4)

      const built = buildTree(
        [
          {
            path: 'pwn',
            node: makeNodeMeta(idPwn, 'PWN', 'a0'),
            hasCanvas: true,
            assets: ['assets/3fa9c1d2e4b5a671.webp'],
            extraFiles: ['notes.local.md'],
          },
          {
            path: 'ghost-dir/orphan-child',
            node: makeNodeMeta(idOrphanChild, 'Orphan', 'a0'),
            hasCanvas: true,
          },
          {
            path: 'assets',
            node: makeNodeMeta(idAssetsNode, 'Assets Folder', 'a1'),
            hasCanvas: true,
          },
          {
            path: 'canvas.json',
            node: makeNodeMeta(idReservedCanvas, 'Fake Canvas Folder', 'a2'),
            hasCanvas: false,
          },
          {
            path: '',
            node: makeNodeMeta(makeUlid(5), 'Illegal Root NodeJson', 'a3'),
          },
        ],
        {
          rootFiles: [
            'knovites.json',
            'canvas.json',
            'assets/7ab1c2d3e4f50987.webp',
            'assets/1122334455667788.png',
            'README.md',
            '.gitignore',
            'LICENSE',
          ],
        },
      )

      expect(built.rootHasCanvas).toBe(true)
      expect(built.state.rootHasCanvas).toBe(true)
      expect(built.rootAssets).toEqual([
        'assets/1122334455667788.png',
        'assets/7ab1c2d3e4f50987.webp',
      ])
      expect(built.state.rootAssets).toEqual([
        'assets/1122334455667788.png',
        'assets/7ab1c2d3e4f50987.webp',
      ])
      expect(built.rootExtraFiles).toEqual(['.gitignore', 'LICENSE', 'README.md'])
      expect(built.state.rootExtraFiles).toEqual(['.gitignore', 'LICENSE', 'README.md'])

      // Virtual root must NOT become a TreeNode in state.nodes or rootIds
      expect(built.state.nodes[VIRTUAL_ROOT_ID]).toBeUndefined()
      expect(built.state.rootIds).toEqual([idPwn])
      expect(Object.keys(built.state.nodes)).toEqual([idPwn])
      expect(built.state.nodes[idPwn]?.extraFiles).toEqual(['notes.local.md'])

      // missing_parent_ignored & forbidden_folder_ignored must remain intact
      expect(
        built.issues.some(
          (i) => i.code === 'missing_parent_ignored' && i.path === 'ghost-dir/orphan-child',
        ),
      ).toBe(true)
      expect(
        built.issues.some((i) => i.code === 'forbidden_folder_ignored' && i.path === 'assets'),
      ).toBe(true)
      expect(
        built.issues.some((i) => i.code === 'forbidden_folder_ignored' && i.path === 'canvas.json'),
      ).toBe(true)
      expect(built.issues.some((i) => i.code === 'forbidden_folder_ignored' && i.path === '')).toBe(
        true,
      )
      assertTreeInvariants(built.state)
    })

    it('accepts virtual-root TreeBuildEntry (including lazy absent canvas and corrupt root canvas)', () => {
      const idA = makeUlid(10)

      // Lazy workspace without root canvas
      const lazyBuilt = buildTree([{ path: 'pwn', node: makeNodeMeta(idA, 'PWN', 'a0') }])
      expect(lazyBuilt.rootHasCanvas).toBe(false)
      expect(lazyBuilt.rootAssets).toEqual([])
      expect(lazyBuilt.rootExtraFiles).toEqual([])
      expect(lazyBuilt.state.rootCanvasCorrupt).toBeFalsy()

      // Virtual root entry supplied by storage/loadTreeBuildEntries
      const withRootEntry = buildTree([
        {
          path: '',
          isVirtualRoot: true,
          hasCanvas: true,
          assets: ['assets/7ab1c2d3e4f50987.webp'],
          extraFiles: ['README.md', '.gitignore'],
          corrupt: true,
          corruptErrors: [{ path: 'elements', code: 'invalid_type', message: 'Bad root canvas' }],
        },
        { path: 'pwn', node: makeNodeMeta(idA, 'PWN', 'a0') },
      ])

      expect(withRootEntry.rootHasCanvas).toBe(true)
      expect(withRootEntry.rootAssets).toEqual(['assets/7ab1c2d3e4f50987.webp'])
      expect(withRootEntry.rootExtraFiles).toEqual(['.gitignore', 'README.md'])
      expect(withRootEntry.state.rootCanvasCorrupt).toBe(true)
      expect(withRootEntry.state.nodes[VIRTUAL_ROOT_ID]).toBeUndefined()
      expect(withRootEntry.issues.some((i) => i.code === 'corrupt_root_canvas')).toBe(true)
      assertTreeInvariants(withRootEntry.state)
    })

    it('rejects deleteNode, renameNode, moveNode, and reorderNode targeting VIRTUAL_ROOT_ID ("__root__")', () => {
      const idA = makeUlid(1)
      const idB = makeUlid(2)
      const built = buildTree(
        [
          { path: 'pwn', node: makeNodeMeta(idA, 'PWN', 'a0'), hasCanvas: true },
          { path: 're', node: makeNodeMeta(idB, 'RE', 'a1'), hasCanvas: true },
        ],
        {
          rootFiles: ['knovites.json', 'canvas.json', 'assets/7ab1c2d3e4f50987.webp', 'README.md'],
        },
      )
      const now = '2026-11-26T10:00:00Z'

      const delRoot = deleteNode(built.state, { nodeId: VIRTUAL_ROOT_ID })
      expect(delRoot.ok).toBe(false)
      if (!delRoot.ok) expect(delRoot.reason).toBe('cannot_mutate_root')
      expect(delRoot.state).toBe(built.state)
      expect(delRoot.changeset).toEqual(EMPTY_CHANGESET)

      const renameRoot = renameNode(built.state, {
        nodeId: VIRTUAL_ROOT_ID,
        title: 'Hacked Root',
        now,
      })
      expect(renameRoot.ok).toBe(false)
      if (!renameRoot.ok) expect(renameRoot.reason).toBe('cannot_mutate_root')
      expect(renameRoot.state).toBe(built.state)
      expect(renameRoot.changeset).toEqual(EMPTY_CHANGESET)

      const moveRootToChild = moveNode(built.state, {
        nodeId: VIRTUAL_ROOT_ID,
        newParentId: idA,
        now,
      })
      expect(moveRootToChild.ok).toBe(false)
      if (!moveRootToChild.ok) expect(moveRootToChild.reason).toBe('cannot_mutate_root')
      expect(moveRootToChild.state).toBe(built.state)
      expect(moveRootToChild.changeset).toEqual(EMPTY_CHANGESET)

      const moveRootToNull = moveNode(built.state, {
        nodeId: VIRTUAL_ROOT_ID,
        newParentId: null,
        now,
      })
      expect(moveRootToNull.ok).toBe(false)
      if (!moveRootToNull.ok) expect(moveRootToNull.reason).toBe('cannot_mutate_root')

      const reorderRoot = reorderNode(built.state, {
        nodeId: VIRTUAL_ROOT_ID,
        direction: 'earlier',
        now,
      })
      expect(reorderRoot.ok).toBe(false)
      if (!reorderRoot.ok) expect(reorderRoot.reason).toBe('cannot_mutate_root')
      expect(reorderRoot.state).toBe(built.state)
      expect(reorderRoot.changeset).toEqual(EMPTY_CHANGESET)

      // Even if a caller artificially injects __root__ into state.nodes, mutations MUST still be rejected
      const poisonedState: TreeState = {
        ...built.state,
        nodes: {
          ...built.state.nodes,
          [VIRTUAL_ROOT_ID]: {
            id: VIRTUAL_ROOT_ID,
            slug: 'root',
            path: '',
            parentId: null,
            meta: makeNodeMeta(VIRTUAL_ROOT_ID, 'Root', 'a0'),
            corrupt: false,
            childrenIds: [],
            assets: [],
            extraFiles: [],
            hasCanvas: true,
          },
        },
      }
      for (const res of [
        deleteNode(poisonedState, { nodeId: VIRTUAL_ROOT_ID }),
        renameNode(poisonedState, { nodeId: VIRTUAL_ROOT_ID, title: 'X', now }),
        moveNode(poisonedState, { nodeId: VIRTUAL_ROOT_ID, newParentId: idA, now }),
        reorderNode(poisonedState, { nodeId: VIRTUAL_ROOT_ID, direction: 'later', now }),
      ]) {
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.reason).toBe('cannot_mutate_root')
        expect(res.state).toBe(poisonedState)
        expect(res.changeset).toEqual(EMPTY_CHANGESET)
      }
    })

    it('forbids slug "assets" on direct root children and preserves root home metadata across child operations', () => {
      const gen = makeIdGenerator(1)
      const now = '2026-11-26T10:00:00Z'
      const built = buildTree([], {
        rootFiles: ['knovites.json', 'canvas.json', 'assets/7ab1c2d3e4f50987.webp', 'README.md'],
      })

      // Direct child titled "assets" under null or VIRTUAL_ROOT_ID must NOT get slug "assets"
      const c1 = createNode(built.state, {
        title: 'assets',
        parentId: null,
        now,
        generateId: gen,
      })
      expect(c1.ok).toBe(true)
      if (!c1.ok) return
      expect(c1.state.nodes[c1.nodeId]?.slug).toBe('node')
      expect(c1.state.nodes[c1.nodeId]?.path).toBe('node')
      expect(c1.state.nodes[c1.nodeId]?.parentId).toBeNull()
      expect(c1.state.rootHasCanvas).toBe(true)
      expect(c1.state.rootAssets).toEqual(['assets/7ab1c2d3e4f50987.webp'])
      expect(c1.state.rootExtraFiles).toEqual(['README.md'])

      const c2 = createNode(c1.state, {
        title: 'ASSETS',
        parentId: VIRTUAL_ROOT_ID,
        now,
        generateId: gen,
      })
      expect(c2.ok).toBe(true)
      if (!c2.ok) return
      expect(c2.state.nodes[c2.nodeId]?.slug).toBe('node-2')
      expect(c2.state.nodes[c2.nodeId]?.parentId).toBeNull()

      const child = createNode(c2.state, {
        title: 'Nested',
        parentId: c1.nodeId,
        now,
        generateId: gen,
      })
      expect(child.ok).toBe(true)
      if (!child.ok) return

      // Move child to VIRTUAL_ROOT_ID promotes to top-level (parentId: null) while keeping root metadata
      const promoted = moveNode(child.state, {
        nodeId: child.nodeId,
        newParentId: VIRTUAL_ROOT_ID,
        now: '2026-11-26T10:01:00Z',
      })
      expect(promoted.ok).toBe(true)
      expect(promoted.state.nodes[child.nodeId]?.parentId).toBeNull()
      expect(promoted.state.nodes[child.nodeId]?.path).toBe('nested')
      expect(promoted.state.rootHasCanvas).toBe(true)
      expect(promoted.state.rootExtraFiles).toEqual(['README.md'])

      // Deleting a top-level node must NOT delete root canvas.json, root assets, or rootExtraFiles
      const deleted = deleteNode(promoted.state, { nodeId: c1.nodeId })
      expect(deleted.ok).toBe(true)
      expect(deleted.changeset.deletes).not.toContain('canvas.json')
      expect(deleted.changeset.deletes).not.toContain('README.md')
      expect(deleted.changeset.deletes).not.toContain('assets/7ab1c2d3e4f50987.webp')
      expect(deleted.state.rootHasCanvas).toBe(true)
      expect(deleted.state.rootAssets).toEqual(['assets/7ab1c2d3e4f50987.webp'])
      expect(deleted.state.rootExtraFiles).toEqual(['README.md'])
      assertTreeInvariants(deleted.state)
    })

    it('property (fast-check): slash-free path helpers and rootExtraFiles/rootAssets separation hold for arbitrary inputs', () => {
      const slugSegArb = fc
        .stringMatching(/^[a-z0-9][a-z0-9-]{0,12}$/)
        .filter((s) => !FORBIDDEN_SLUGS.has(s))
      const ownerPathArb = fc.oneof(
        fc.constant(''),
        fc.constant('/'),
        fc.array(slugSegArb, { minLength: 1, maxLength: 3 }).map((segs) => segs.join('/')),
      )
      const hex16Arb = fc.stringMatching(/^[0-9a-f]{16}$/)
      const extArb = fc.constantFrom('png', 'jpg', 'jpeg', 'webp', 'gif')
      const assetRelArb = fc
        .tuple(fc.boolean(), hex16Arb, extArb)
        .map(([withPrefix, hex, ext]) => (withPrefix ? `assets/${hex}.${ext}` : `${hex}.${ext}`))
      const extraNameArb = fc.constantFrom(
        'README.md',
        '.gitignore',
        'LICENSE',
        'notes/todo.txt',
        'CONTRIBUTING.md',
      )

      fc.assert(
        fc.property(
          ownerPathArb,
          assetRelArb,
          extraNameArb,
          fc.boolean(),
          fc.uniqueArray(extraNameArb, { maxLength: 5 }),
          fc.uniqueArray(
            fc.tuple(hex16Arb, extArb).map(([h, e]) => `assets/${h}.${e}`),
            { maxLength: 4 },
          ),
          (ownerPath, assetRel, extraName, includeRootCanvas, userRootExtras, rootAssetsInput) => {
            const canvasPath = resolveCanvasFilePath(ownerPath)
            const assetPath = resolveAssetFilePath(ownerPath, assetRel)
            const extraPath = resolveExtraFilePath(ownerPath, extraName)

            for (const p of [canvasPath, assetPath, extraPath]) {
              expect(p.startsWith('/')).toBe(false)
              expect(p.includes('//')).toBe(false)
              expect(isValidRepoFilePath(p)).toBe(true)
            }
            if (ownerPath === '' || ownerPath === '/') {
              expect(canvasPath).toBe('canvas.json')
              expect(assetPath.startsWith('assets/')).toBe(true)
              expect(parseCanvasFilePath(canvasPath)).toEqual({ isRoot: true, ownerPath: '' })
              expect(isRootAssetFilePath(assetPath)).toBe(true)
            } else {
              expect(parseCanvasFilePath(canvasPath)).toEqual({ isRoot: false, ownerPath })
            }

            const rootFiles = [
              'knovites.json',
              ...(includeRootCanvas ? ['canvas.json'] : []),
              ...rootAssetsInput,
              ...userRootExtras,
            ]
            const built = buildTree(
              [
                { path: 'assets', node: makeNodeMeta(makeUlid(50), 'assets', 'a0') },
                { path: 'missing-parent/child', node: makeNodeMeta(makeUlid(51), 'child', 'a0') },
              ],
              { rootFiles },
            )

            expect(built.rootHasCanvas).toBe(includeRootCanvas)
            expect(built.rootAssets).toEqual([...rootAssetsInput].sort())
            expect(built.rootExtraFiles).toEqual([...userRootExtras].sort())
            expect(built.rootExtraFiles).not.toContain('knovites.json')
            expect(built.rootExtraFiles).not.toContain('canvas.json')
            for (const extra of built.rootExtraFiles) {
              expect(extra.startsWith('assets/')).toBe(false)
            }
            expect(built.state.rootIds).toEqual([])
            expect(built.issues.some((i) => i.code === 'forbidden_folder_ignored')).toBe(true)
            expect(built.issues.some((i) => i.code === 'missing_parent_ignored')).toBe(true)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('updateNodeMeta [T3.7, FR-NODE-06]', () => {
    it('updates type, status, color (incl. reset to null), and tags with strict validation and __root__ protection', () => {
      const idA = makeUlid(301)
      const built = buildTree([
        { path: 'pwn', node: makeNodeMeta(idA, 'PWN', 'a0'), hasCanvas: true },
        {
          path: 'broken',
          corrupt: true,
          corruptErrors: [{ path: 'schema', code: 'invalid_schema', message: 'corrupt' }],
        },
        {
          path: 'future',
          newerSchemaVersion: 2,
        },
      ])

      const now = '2026-11-26T12:00:00Z'
      const updated = updateNodeMeta(built.state, {
        nodeId: idA,
        now,
        type: 'technique',
        status: 'practiced',
        color: '#7c9cff',
        tags: ['pwn', 'rop_chain', 'pwn'],
      })
      expect(updated.ok).toBe(true)
      if (!updated.ok) throw new Error(updated.message)
      expect(updated.state.nodes[idA]?.meta.type).toBe('technique')
      expect(updated.state.nodes[idA]?.meta.status).toBe('practiced')
      expect(updated.state.nodes[idA]?.meta.color).toBe('#7c9cff')
      expect(updated.state.nodes[idA]?.meta.tags).toEqual(['pwn', 'rop_chain'])
      expect(updated.state.nodes[idA]?.meta.updatedAt).toBe(now)
      expect(updated.changeset.upserts).toHaveLength(1)
      expect(updated.changeset.upserts[0]?.path).toBe('pwn/node.json')
      expect(parseNodeJson(updated.changeset.upserts[0]!.content).status).toBe('ok')

      // Reset color back to Auto (null)
      const resetColor = updateNodeMeta(updated.state, {
        nodeId: idA,
        now: '2026-11-26T12:01:00Z',
        color: null,
      })
      expect(resetColor.ok).toBe(true)
      if (resetColor.ok) {
        expect(resetColor.state.nodes[idA]?.meta.color).toBeNull()
      }

      // Rejects virtual root __root__
      const rootAttempt = updateNodeMeta(built.state, {
        nodeId: VIRTUAL_ROOT_ID,
        now,
        status: 'mastered',
      })
      expect(rootAttempt.ok).toBe(false)
      if (!rootAttempt.ok) expect(rootAttempt.reason).toBe('cannot_mutate_root')

      // Rejects invalid hex color & invalid tags & >20 tags
      const badColor = updateNodeMeta(built.state, { nodeId: idA, now, color: 'red' })
      expect(badColor.ok).toBe(false)
      if (!badColor.ok) expect(badColor.reason).toBe('invalid_meta')

      const badTag = updateNodeMeta(built.state, { nodeId: idA, now, tags: ['BAD TAG!'] })
      expect(badTag.ok).toBe(false)
      if (!badTag.ok) expect(badTag.reason).toBe('invalid_meta')

      const tooManyTags = updateNodeMeta(built.state, {
        nodeId: idA,
        now,
        tags: Array.from({ length: 21 }, (_, idx) => `tag${idx}`),
      })
      expect(tooManyTags.ok).toBe(false)
      if (!tooManyTags.ok) expect(tooManyTags.reason).toBe('invalid_meta')

      // Rejects corrupt and newer-schema nodes
      const corruptNodeId = Object.keys(built.state.nodes).find((k) => k.includes('broken'))!
      const newerNodeId = Object.keys(built.state.nodes).find((k) => k.includes('future'))!
      const corruptAttempt = updateNodeMeta(built.state, {
        nodeId: corruptNodeId,
        now,
        status: 'learning',
      })
      expect(corruptAttempt.ok).toBe(false)
      if (!corruptAttempt.ok) expect(corruptAttempt.reason).toBe('corrupt_node')

      const newerAttempt = updateNodeMeta(built.state, {
        nodeId: newerNodeId,
        now,
        status: 'learning',
      })
      expect(newerAttempt.ok).toBe(false)
      if (!newerAttempt.ok) expect(newerAttempt.reason).toBe('newer_schema_node')
    })
  })
})
