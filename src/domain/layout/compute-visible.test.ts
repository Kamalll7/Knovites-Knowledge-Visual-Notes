import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBILITY_CONFIG,
  MAP_ROOT_ID,
  computeVisible,
  overflowBubbleId,
  type ZoomTier,
} from '@/domain/layout'
import type { NodeJson } from '@/domain/schema'
import { buildTree, type TreeBuildEntry, type TreeNode, type TreeState } from '@/domain/tree'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeUlid(seedIndex: number): string {
  let n = seedIndex
  let suffix = ''
  for (let i = 0; i < 10; i += 1) {
    suffix = CROCKFORD[n % 32]! + suffix
    n = Math.floor(n / 32)
  }
  return `01KN0V1TE5000000${suffix}`
}

function makeMeta(id: string, title: string, order: string): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'concept',
    status: 'none',
    tags: ['tag1'],
    order,
    color: null,
    links: [],
    createdAt: '2026-11-21T00:00:00Z',
    updatedAt: '2026-11-21T00:00:00Z',
  }
}

function makeOrderKey(index: number): string {
  const hi = String.fromCharCode(97 + (Math.floor(index / 26) % 26))
  const lo = String.fromCharCode(97 + (index % 26))
  return `a${hi}${lo}${index}`
}

function buildRandomTree(
  parentIndices: readonly number[],
  orderOffsets: readonly number[],
): TreeState {
  const entries: TreeBuildEntry[] = []
  const paths: string[] = []

  for (let i = 0; i < parentIndices.length; i += 1) {
    const rawParent = parentIndices[i]!
    const pIdx = i === 0 || rawParent < 0 ? -1 : rawParent % i
    const slug = `node-${i}`
    const path = pIdx === -1 ? slug : `${paths[pIdx]!}/${slug}`
    paths.push(path)

    const orderNum = (orderOffsets[i] ?? i) % 10_000
    entries.push({
      path,
      node: makeMeta(encodeUlid(i + 1), `Node ${i}`, makeOrderKey(orderNum)),
      hasCanvas: false,
    })
  }

  return buildTree(entries).state
}

function shuffleWithPrng<T>(arr: readonly T[], seedInput: number): T[] {
  const copy = [...arr]
  let state = seedInput >>> 0 || 1
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    const j = state % (i + 1)
    const tmp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = tmp
  }
  return copy
}

function scrambleTreeOrder(tree: TreeState, seed: number): TreeState {
  const entries = shuffleWithPrng(Object.entries(tree.nodes), seed + 17)
  const nodes: Record<string, TreeNode> = {}
  for (const [id, node] of entries) {
    nodes[id] = {
      ...node,
      childrenIds: shuffleWithPrng(node.childrenIds, seed + id.charCodeAt(id.length - 1)),
    }
  }
  return {
    rootIds: shuffleWithPrng(tree.rootIds, seed + 5),
    nodes,
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Set) {
    for (const item of value) {
      deepFreeze(item)
    }
    return Object.freeze(value)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item)
    }
    return Object.freeze(value)
  }
  for (const prop of Object.values(value as Record<string, unknown>)) {
    deepFreeze(prop)
  }
  return Object.freeze(value)
}

function snapshotResult(res: ReturnType<typeof computeVisible>) {
  return {
    rootId: res.rootId,
    focusId: res.focusId,
    orderedIds: res.orderedIds,
    focusPathIds: [...res.focusPathIds],
    totalSubtreeCounts: res.totalSubtreeCounts,
    nodes: res.nodes,
  }
}

describe('computeVisible [T3.1, FR-MAP-02]', () => {
  it('uses MAP_ROOT_ID === "__root__" and DEFAULT_VISIBILITY_CONFIG defaults', () => {
    expect(MAP_ROOT_ID).toBe('__root__')
    expect(DEFAULT_VISIBILITY_CONFIG.maxChildrenShown).toBe(24)
    expect(DEFAULT_VISIBILITY_CONFIG.maxVisibleNodes).toBe(300)
    expect(DEFAULT_VISIBILITY_CONFIG.minZoomTierForGrandchildren).toBe(2)
    expect(DEFAULT_VISIBILITY_CONFIG.maxGrandchildrenPerChild).toBe(6)
  })

  it('satisfies determinism, focus-path, parent closure, count conservation, bounds, input order invariance, and immutability on random trees', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1, max: 60 }), { minLength: 0, maxLength: 60 }),
        fc.array(fc.integer({ min: 0, max: 9999 }), { minLength: 60, maxLength: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.constantFrom<ZoomTier>(0, 1, 2),
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: 1, max: 99999 }),
        (parents, orderOffsets, focusPick, zoomTier, pinPicks, expandPicks, permSeed) => {
          const tree = buildRandomTree(parents, orderOffsets)
          const allIds = Object.keys(tree.nodes).sort()
          const focusId =
            allIds.length === 0 || focusPick % 7 === 0
              ? MAP_ROOT_ID
              : allIds[focusPick % allIds.length]!

          const pinnedList = pinPicks
            .filter(() => allIds.length > 0)
            .map((p) => allIds[p % allIds.length]!)
          const pinnedIds = new Set(pinnedList)

          const expandList = expandPicks
            .filter(() => allIds.length > 0)
            .map((e) => (e % 9 === 0 ? MAP_ROOT_ID : allIds[e % allIds.length]!))
          const expandedOverflow = new Set(expandList)

          const frozenTree = deepFreeze(tree)
          const frozenPinned = deepFreeze(new Set(pinnedIds))
          const frozenExpanded = deepFreeze(new Set(expandedOverflow))
          const frozenConfig = deepFreeze({ ...DEFAULT_VISIBILITY_CONFIG })

          const resA = computeVisible({
            tree: frozenTree,
            rootTitle: 'Test Vault',
            focusId,
            pinnedIds: frozenPinned,
            expandedOverflowParentIds: frozenExpanded,
            zoomTier,
            config: frozenConfig,
          })
          const resB = computeVisible({
            tree: frozenTree,
            rootTitle: 'Test Vault',
            focusId,
            pinnedIds: frozenPinned,
            expandedOverflowParentIds: frozenExpanded,
            zoomTier,
            config: frozenConfig,
          })

          // 1. Determinism (byte-identical)
          expect(JSON.stringify(snapshotResult(resA))).toBe(JSON.stringify(snapshotResult(resB)))

          // 2. Input-order invariance (scrambled rootIds, childrenIds, nodes object keys, pinned & expanded sets)
          const scrambledTree = scrambleTreeOrder(tree, permSeed)
          const resScrambled = computeVisible({
            tree: scrambledTree,
            rootTitle: 'Test Vault',
            focusId,
            pinnedIds: new Set(shuffleWithPrng(pinnedList, permSeed + 1)),
            expandedOverflowParentIds: new Set(shuffleWithPrng(expandList, permSeed + 2)),
            zoomTier,
          })
          expect(JSON.stringify(snapshotResult(resScrambled))).toBe(
            JSON.stringify(snapshotResult(resA)),
          )

          // 3. Focus node & entire Root -> Focus path always present
          expect(resA.nodes[MAP_ROOT_ID]).toBeDefined()
          expect(resA.nodes[resA.focusId]).toBeDefined()
          expect(resA.focusPathIds.has(MAP_ROOT_ID)).toBe(true)
          expect(resA.focusPathIds.has(resA.focusId)).toBe(true)
          for (const pathId of resA.focusPathIds) {
            const pathNode = resA.nodes[pathId]
            expect(pathNode).toBeDefined()
            expect(pathNode!.isOnFocusPath).toBe(true)
          }

          // 4. Parent closure: every non-root visible node has its parentId in resA.nodes and in parent.visibleChildIds
          for (const id of resA.orderedIds) {
            const n = resA.nodes[id]
            expect(n).toBeDefined()
            if (id === MAP_ROOT_ID) {
              expect(n!.parentId).toBeNull()
            } else {
              expect(n!.parentId).not.toBeNull()
              const parent = resA.nodes[n!.parentId!]
              expect(parent).toBeDefined()
              expect(parent!.visibleChildIds).toContain(id)
            }
          }

          // 5. Subtree count conservation: hiddenCount + visibleDescendants === totalDescendants
          for (const n of Object.values(resA.nodes)) {
            if (n.kind !== 'overflow') {
              expect(n.hiddenCount + n.visibleDescendants).toBe(n.totalDescendants)
            }
          }

          // 6. Hard node-count ceiling (when focus path itself <= maxVisibleNodes)
          expect(resA.orderedIds.length).toBeLessThanOrEqual(
            Math.max(DEFAULT_VISIBILITY_CONFIG.maxVisibleNodes, resA.focusPathIds.size),
          )

          // 7. Depth bound & grandchild suppression below tier 2 (verified when no pins widen branches)
          if (pinnedIds.size === 0) {
            const focusDepth = resA.nodes[resA.focusId]!.depth
            const maxExpectedDepth =
              focusDepth +
              (zoomTier >= DEFAULT_VISIBILITY_CONFIG.minZoomTierForGrandchildren
                ? DEFAULT_VISIBILITY_CONFIG.focusExpandDepthAtTier2
                : DEFAULT_VISIBILITY_CONFIG.focusExpandDepthBelowTier2)

            for (const n of Object.values(resA.nodes)) {
              expect(n.depth).toBeLessThanOrEqual(maxExpectedDepth)
              if (zoomTier < DEFAULT_VISIBILITY_CONFIG.minZoomTierForGrandchildren) {
                expect(n.isGrandchildPreview).toBe(false)
              }
            }
          }
        },
      ),
      { numRuns: 150 },
    )
  })

  it('caps direct children at MAX_CHILDREN_SHOWN = 24 with +N bubble and includes focus child even beyond index 24', async () => {
    const { createWide60ChildrenDataset } = await import('@/domain/datasets')
    const wide = createWide60ChildrenDataset()
    const tree = buildTree(wide.entries).state
    const hubId = tree.rootIds[0]!
    const hubChildren = tree.nodes[hubId]!.childrenIds

    // Hub focus at tier 1 -> 24 real children + 1 overflow '+36'
    const resHub = computeVisible({
      tree,
      rootTitle: wide.manifest.title,
      focusId: hubId,
      zoomTier: 1,
    })

    const hubVisible = resHub.nodes[hubId]!
    const realShown = hubVisible.visibleChildIds.filter((id) => resHub.nodes[id]!.kind === 'node')
    expect(realShown).toHaveLength(24)
    expect(hubVisible.hiddenCount).toBe(36)
    expect(hubVisible.hiddenCount + hubVisible.visibleDescendants).toBe(hubVisible.totalDescendants)

    const bubbleId = overflowBubbleId(hubId)
    expect(resHub.nodes[bubbleId]).toMatchObject({
      kind: 'overflow',
      overflowParentId: hubId,
      overflowCount: 36,
      title: '+36',
    })

    // Focus on 50th child (index 49, past index 24) -> still visible + in sibling path!
    const deepSiblingId = hubChildren[49]!
    const resDeepSibling = computeVisible({
      tree,
      rootTitle: wide.manifest.title,
      focusId: deepSiblingId,
      zoomTier: 1,
    })
    expect(resDeepSibling.nodes[deepSiblingId]).toBeDefined()
    expect(resDeepSibling.nodes[deepSiblingId]!.isFocus).toBe(true)
    expect(resDeepSibling.nodes[hubId]!.visibleChildIds).toContain(deepSiblingId)

    // Expanding '+36' overflow reveals all 60 children cleanly
    const resExpanded = computeVisible({
      tree,
      rootTitle: wide.manifest.title,
      focusId: hubId,
      expandedOverflowParentIds: new Set([hubId]),
      zoomTier: 1,
    })
    expect(
      resExpanded.nodes[hubId]!.visibleChildIds.filter(
        (id) => resExpanded.nodes[id]!.kind === 'node',
      ),
    ).toHaveLength(60)
    expect(resExpanded.nodes[bubbleId]).toBeUndefined()
    expect(resExpanded.nodes[hubId]!.hiddenCount).toBe(0)
  })

  it('reveals focus grandchildren only at zoomTier >= 2 and ignores unreachable pinned IDs without leaking budget', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasets = createMandatoryDatasets()

    // Chain depth 12: focus depth 6 has child (depth 7) & grandchild (depth 8)
    const chain = datasets.chainDepth12
    const chainTree = buildTree(chain.entries).state
    let cursor = chainTree.rootIds[0]!
    for (let i = 0; i < 6; i += 1) {
      cursor = chainTree.nodes[cursor]!.childrenIds[0]!
    }
    const midId = cursor
    const childId = chainTree.nodes[midId]!.childrenIds[0]!
    const grandchildId = chainTree.nodes[childId]!.childrenIds[0]!

    const tier1 = computeVisible({
      tree: chainTree,
      rootTitle: chain.manifest.title,
      focusId: midId,
      zoomTier: 1,
    })
    expect(tier1.nodes[childId]).toBeDefined()
    expect(tier1.nodes[grandchildId]).toBeUndefined()

    const tier2 = computeVisible({
      tree: chainTree,
      rootTitle: chain.manifest.title,
      focusId: midId,
      zoomTier: 2,
    })
    expect(tier2.nodes[grandchildId]).toBeDefined()
    expect(tier2.nodes[grandchildId]!.isGrandchildPreview).toBe(true)

    // Unbalanced 150 & Root 20 & Large 2000 mandatory datasets
    const u150 = datasets.unbalanced150
    const uTree = buildTree(u150.entries).state
    // Find an unreachable deep node under a sibling branch when focused on another root child
    const rootChildren = uTree.rootIds
    expect(rootChildren.length).toBeGreaterThanOrEqual(2)
    const focusBranch = rootChildren[0]!
    const hiddenBranch = rootChildren[1]!
    const hiddenChild = uTree.nodes[hiddenBranch]!.childrenIds[0]

    if (hiddenChild) {
      // Pinning an unreachable node (hiddenChild whose parent hiddenBranch is collapsed, not pinned)
      // must NOT expand hiddenChild's descendants into visible nodes or corrupt parent closure
      const resWithHiddenPin = computeVisible({
        tree: uTree,
        rootTitle: u150.manifest.title,
        focusId: focusBranch,
        pinnedIds: new Set([hiddenChild]),
        zoomTier: 1,
      })
      for (const gid of uTree.nodes[hiddenChild]!.childrenIds) {
        expect(resWithHiddenPin.nodes[gid]).toBeUndefined()
      }
      // Also pinning the visible collapsed node `hiddenBranch` itself DOES reveal hiddenChild
      const resWithVisiblePin = computeVisible({
        tree: uTree,
        rootTitle: u150.manifest.title,
        focusId: focusBranch,
        pinnedIds: new Set([hiddenBranch]),
        zoomTier: 1,
      })
      expect(resWithVisiblePin.nodes[hiddenChild]).toBeDefined()
    }

    const r20 = datasets.root20Children
    const r20Tree = buildTree(r20.entries).state
    const resR20 = computeVisible({
      tree: r20Tree,
      rootTitle: r20.manifest.title,
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    expect(resR20.nodes[MAP_ROOT_ID]!.visibleChildIds).toHaveLength(20)

    const large = datasets.large2000
    const largeTree = buildTree(large.entries).state
    const resLarge = computeVisible({
      tree: largeTree,
      rootTitle: large.manifest.title,
      focusId: largeTree.rootIds[0]!,
      zoomTier: 2,
    })
    expect(resLarge.orderedIds.length).toBeLessThanOrEqual(
      DEFAULT_VISIBILITY_CONFIG.maxVisibleNodes,
    )
    expect(resLarge.nodes[MAP_ROOT_ID]!.totalDescendants).toBe(2000)
  })

  it('bounds total visible nodes strictly to maxVisibleNodes even when multiple parents overflow', () => {
    // Build a hub with 140 children + 150 another-level children, with smaller maxVisibleNodes cap
    const entries: TreeBuildEntry[] = [
      { path: 'branch-a', node: makeMeta(encodeUlid(1), 'Branch A', 'a0'), hasCanvas: false },
      { path: 'branch-b', node: makeMeta(encodeUlid(2), 'Branch B', 'a1'), hasCanvas: false },
    ]
    for (let i = 0; i < 40; i += 1) {
      entries.push({
        path: `branch-a/item-${i}`,
        node: makeMeta(encodeUlid(10 + i), `Item ${i}`, makeOrderKey(i)),
        hasCanvas: false,
      })
    }
    const tree = buildTree(entries).state
    const branchA = tree.rootIds[0]!

    const res = computeVisible({
      tree,
      rootTitle: 'Small Budget Vault',
      focusId: branchA,
      zoomTier: 1,
      config: { maxVisibleNodes: 15 },
    })

    expect(res.orderedIds.length).toBeLessThanOrEqual(15)
    expect(res.nodes[overflowBubbleId(branchA)]).toBeDefined()
    expect(res.nodes[branchA]!.hiddenCount + res.nodes[branchA]!.visibleDescendants).toBe(40)
  })

  it('enforces default maxVisibleNodes = 300 without leaking budget to unreachable pinned nodes (M3 & M6)', () => {
    // 1) M3 check: > 300 reachable children strictly clamp to default 300
    const largeEntries: TreeBuildEntry[] = [
      { path: 'big-hub', node: makeMeta(encodeUlid(1), 'Big Hub', 'a0'), hasCanvas: false },
    ]
    for (let i = 0; i < 350; i += 1) {
      largeEntries.push({
        path: `big-hub/c-${i}`,
        node: makeMeta(encodeUlid(10 + i), `C ${i}`, makeOrderKey(i)),
        hasCanvas: false,
      })
    }
    const largeTree = buildTree(largeEntries).state
    const bigHubId = largeTree.rootIds[0]!
    const cappedRes = computeVisible({
      tree: largeTree,
      rootTitle: 'Large Root',
      focusId: bigHubId,
      expandedOverflowParentIds: new Set([bigHubId]),
      zoomTier: 1,
    })
    expect(cappedRes.orderedIds.length).toBe(300)
    expect(cappedRes.nodes[overflowBubbleId(bigHubId)]).toMatchObject({ overflowCount: 53 })

    // 2) M6 check: unreachable pinned node must not steal remaining budget from reachable pinned sibling
    const leakEntries: TreeBuildEntry[] = [
      { path: 'hub', node: makeMeta(encodeUlid(1), 'Hub', 'a0'), hasCanvas: false },
      { path: 'visible-pin', node: makeMeta(encodeUlid(2), 'Visible Pin', 'a1'), hasCanvas: false },
      {
        path: 'collapsed-branch',
        node: makeMeta(encodeUlid(3), 'Collapsed Branch', 'a2'),
        hasCanvas: false,
      },
      {
        path: 'collapsed-branch/unreachable-pin',
        node: makeMeta(encodeUlid(4), 'Unreachable Pin', 'a0'),
        hasCanvas: false,
      },
    ]
    for (let i = 0; i < 270; i += 1) {
      leakEntries.push({
        path: `hub/c-${i}`,
        node: makeMeta(encodeUlid(10 + i), `C ${i}`, makeOrderKey(i)),
        hasCanvas: false,
      })
    }
    for (let i = 0; i < 20; i += 1) {
      leakEntries.push({
        path: `visible-pin/v-${i}`,
        node: makeMeta(encodeUlid(300 + i), `V ${i}`, makeOrderKey(i)),
        hasCanvas: false,
      })
    }
    for (let i = 0; i < 24; i += 1) {
      leakEntries.push({
        path: `collapsed-branch/unreachable-pin/leak-${i}`,
        node: makeMeta(encodeUlid(400 + i), `Leak ${i}`, makeOrderKey(i)),
        hasCanvas: false,
      })
    }

    const leakTree = buildTree(leakEntries).state
    const hubId = leakTree.rootIds[0]!
    const visiblePinId = leakTree.rootIds[1]!
    const collapsedId = leakTree.rootIds[2]!
    const unreachablePinId = leakTree.nodes[collapsedId]!.childrenIds[0]!

    const res = computeVisible({
      tree: leakTree,
      rootTitle: 'Budget Isolation Root',
      focusId: hubId,
      pinnedIds: new Set([unreachablePinId, visiblePinId]),
      expandedOverflowParentIds: new Set([hubId]),
      zoomTier: 1,
    })

    expect(res.nodes[visiblePinId]!.visibleChildIds).toHaveLength(20)
    expect(res.nodes[unreachablePinId]).toBeUndefined()
  })
})
