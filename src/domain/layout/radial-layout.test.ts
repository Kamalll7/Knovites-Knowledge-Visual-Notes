import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeRadialGeometryDiagnostics,
  computeRadialLayout,
  computeVisible,
  resolveScreenZoomTier,
  type ComputeVisibleResult,
  type CollisionStats,
  type RadialLayoutResult,
  type TextMeasurerFn,
  type VisibleMapNode,
} from '@/domain/layout'
import {
  computeRadialLayoutReference,
  resolveCollisionsAndCrossingsReference,
} from '@/domain/layout/__reference__/collision-reference'
import { resolveCollisionsAndCrossings } from '@/domain/layout/collision'
import { type PlacedMutableNode } from '@/domain/layout/types'
import { clipRayToNodeEdge } from '@/domain/layout/edges'
import { finalizeRadialResult } from '@/domain/layout/radial-layout'
import { assignInitialPolarNodes } from '@/domain/layout/rings'
import { prepareSpecsAndWeights } from '@/domain/layout/weights'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'

const MIN_REQUIRED_GAP_PX = 12
const MIN_REQUIRED_SCREEN_FONT_PX = 11

/**
 * GOLDEN HASH UPDATE PROCEDURE (T3.2c):
 * - NEVER modify `GOLDEN_RADIAL_SHA256` or `GOLDEN_WORST300_SHA256` during performance refactors.
 * - Updating golden hashes is ONLY permitted after an explicitly approved behavioral change:
 *   1. Stop and report the behavioral diff before touching hashes.
 *   2. Run manually once: `UPDATE_GOLDEN=1 pnpm vitest run src/domain/layout/radial-layout.test.ts -t "golden"`
 *   3. Inspect and commit the approved hash map update (CI never sets `UPDATE_GOLDEN`).
 */
const GOLDEN_WORST300_SHA256 = '2c91e249b3bea508ec838a70339fd779e695c78320452a7078b4f9e54f5cf773'

function buildWorstCaseVisible(maxVisibleNodes = 300): ComputeVisibleResult {
  const worstEntries: TreeBuildEntry[] = []
  let seq = 0
  const addNode = (id: string, parentPath: string | null, title: string): string => {
    seq += 1
    const path = parentPath ? `${parentPath}/${id}` : id
    worstEntries.push({
      node: {
        schema: 1,
        id,
        title,
        type: 'concept',
        status: 'none',
        tags: [],
        order: `k${String(seq).padStart(5, '0')}`,
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path,
    })
    return path
  }
  let parentPath: string | null = null
  for (let d = 0; d < 6; d += 1) {
    const chainId = `chain_${d}`
    const nextChainPath = addNode(chainId, parentPath, `Hierarchy Backbone Concept ${d} Long`)
    for (let s = 0; s < 24; s += 1) {
      addNode(`sib_${d}_${s}`, parentPath, `Ancestor Sibling Branch ${d}-${s} Expanded`)
    }
    parentPath = nextChainPath
  }
  for (let c = 0; c < 24; c += 1) {
    const cid = `fc_${c}`
    const cPath = addNode(cid, parentPath, `Primary Focus Child ${c} Extended Label`)
    for (let g = 0; g < 6; g += 1) {
      addNode(`fg_${c}_${g}`, cPath, `Grandchild Detail Item ${c}-${g} Label`)
    }
  }
  const { state: worstTree } = buildTree(worstEntries)
  return computeVisible({
    tree: worstTree,
    rootTitle: 'Worst Case 300 Root',
    focusId: 'chain_5',
    zoomTier: 2,
    config: { maxVisibleNodes },
  })
}

const fixedWidthMeasure = (pxPerChar: number): TextMeasurerFn => {
  return (text) => text.length * pxPerChar
}

function makeVisibleNode(
  partial: Partial<VisibleMapNode> & Pick<VisibleMapNode, 'id' | 'parentId' | 'title' | 'depth'>,
): VisibleMapNode {
  return {
    kind: partial.kind ?? (partial.id === MAP_ROOT_ID ? 'root' : 'node'),
    type: partial.type ?? (partial.id === MAP_ROOT_ID ? 'root' : 'concept'),
    status: partial.status ?? 'none',
    tags: partial.tags ?? [],
    order: partial.order ?? `a_${partial.id}`,
    color: partial.color ?? null,
    branchRootId: partial.branchRootId ?? (partial.depth === 1 ? partial.id : null),
    isOnFocusPath: partial.isOnFocusPath ?? partial.id === MAP_ROOT_ID,
    isFocus: partial.isFocus ?? partial.id === MAP_ROOT_ID,
    isGrandchildPreview: partial.isGrandchildPreview ?? false,
    isCollapsedWithChildren: partial.isCollapsedWithChildren ?? (partial.hiddenCount ?? 0) > 0,
    totalDescendants: partial.totalDescendants ?? 0,
    visibleDescendants: partial.visibleDescendants ?? 0,
    hiddenCount: partial.hiddenCount ?? 0,
    visibleChildIds: partial.visibleChildIds ?? [],
    ...partial,
  }
}

function buildSyntheticVisible(
  nodesList: VisibleMapNode[],
  focusId = MAP_ROOT_ID,
): ComputeVisibleResult {
  const nodes: Record<string, VisibleMapNode> = {}
  const childMap = new Map<string, string[]>()
  for (const n of nodesList) {
    nodes[n.id] = n
    if (n.parentId) {
      const list = childMap.get(n.parentId) ?? []
      list.push(n.id)
      childMap.set(n.parentId, list)
    }
  }
  for (const [parentId, ids] of childMap.entries()) {
    const parent = nodes[parentId]
    if (parent && parent.visibleChildIds.length === 0) {
      nodes[parentId] = { ...parent, visibleChildIds: ids }
    }
  }
  const totalSubtreeCounts: Record<string, number> = {}
  for (const n of nodesList) {
    totalSubtreeCounts[n.id] = n.totalDescendants
  }
  return {
    rootId: MAP_ROOT_ID,
    focusId,
    nodes,
    orderedIds: nodesList.map((n) => n.id),
    focusPathIds: new Set(nodesList.filter((n) => n.isOnFocusPath).map((n) => n.id)),
    totalSubtreeCounts,
  }
}

function makeStarVisible(
  rootChildrenCount: number,
  options?: { hiddenAtIndex?: ReadonlyMap<number, number>; nonRootChildrenCount?: number },
): ComputeVisibleResult {
  const nodes: VisibleMapNode[] = [
    makeVisibleNode({
      id: MAP_ROOT_ID,
      parentId: null,
      title: 'Root Hub',
      depth: 0,
      isOnFocusPath: true,
      isFocus: true,
    }),
  ]
  for (let i = 0; i < rootChildrenCount; i += 1) {
    const id = `c_${String(i).padStart(3, '0')}`
    const hidden = options?.hiddenAtIndex?.get(i) ?? 0
    nodes.push(
      makeVisibleNode({
        id,
        parentId: MAP_ROOT_ID,
        title: `Topic ${i + 1}`,
        depth: 1,
        order: `a${String(i).padStart(4, '0')}`,
        hiddenCount: hidden,
        totalDescendants: hidden,
      }),
    )
  }
  if (options?.nonRootChildrenCount && rootChildrenCount >= 1) {
    const parentId = 'c_000'
    for (let j = 0; j < options.nonRootChildrenCount; j += 1) {
      nodes.push(
        makeVisibleNode({
          id: `gc_${String(j).padStart(3, '0')}`,
          parentId,
          title: `Subtopic ${j + 1}`,
          depth: 2,
          order: `b${String(j).padStart(4, '0')}`,
        }),
      )
    }
  }
  return buildSyntheticVisible(nodes)
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Set || obj instanceof Map) return Object.freeze(obj)
  Object.freeze(obj)
  for (const val of Object.values(obj as Record<string, unknown>)) {
    deepFreeze(val)
  }
  return obj
}

function assertRadialInvariants(layout: RadialLayoutResult): void {
  expect(layout.rootId).toBe(MAP_ROOT_ID)
  const geom = computeRadialGeometryDiagnostics(layout)
  expect(geom.overlapCount).toBe(0)
  const minGap = MIN_REQUIRED_GAP_PX
  const allNodes = Object.values(layout.nodes)
  const eps = 1e-6
  let crossingDetail = ''
  if (geom.edgeCrossingsCount > 0) {
    for (const e of layout.edges) {
      for (const n of allNodes) {
        if (n.id === e.sourceId || n.id === e.targetId) continue
        const minX = Math.min(n.x - n.width / 2, n.labelBox ? n.labelBox.x : n.x - n.width / 2)
        const maxX = Math.max(
          n.x + n.width / 2,
          n.labelBox ? n.labelBox.x + n.labelBox.width : n.x + n.width / 2,
        )
        const minY = Math.min(n.y - n.height / 2, n.labelBox ? n.labelBox.y : n.y - n.height / 2)
        const maxY = Math.max(
          n.y + n.height / 2,
          n.labelBox ? n.labelBox.y + n.labelBox.height : n.y + n.height / 2,
        )
        let t0 = 0
        let t1 = 1
        const dx = e.targetX - e.sourceX
        const dy = e.targetY - e.sourceY
        let hit = true
        for (const [p, q] of [
          [-dx, e.sourceX - minX],
          [dx, maxX - e.sourceX],
          [-dy, e.sourceY - minY],
          [dy, maxY - e.sourceY],
        ] as const) {
          if (p === 0) {
            if (q < 0) {
              hit = false
              break
            }
          } else {
            const r = q / p
            if (p < 0) {
              if (r > t1) {
                hit = false
                break
              }
              if (r > t0) t0 = r
            } else {
              if (r < t0) {
                hit = false
                break
              }
              if (r < t1) t1 = r
            }
          }
        }
        if (hit && t0 <= t1) {
          const src = layout.nodes[e.sourceId]!
          const dst = layout.nodes[e.targetId]!
          crossingDetail += `[${src.id}(d=${src.depth},r=${src.r.toFixed(0)},t=${src.theta.toFixed(2)})->${dst.id}(d=${dst.depth},r=${dst.r.toFixed(0)},t=${dst.theta.toFixed(2)}) hits ${n.id}(d=${n.depth},r=${n.r.toFixed(0)},t=${n.theta.toFixed(2)})]; `
        }
      }
    }
  }
  expect(
    geom.edgeCrossingsCount,
    `nodes=${layout.diagnostics.nodeCount} tier=${layout.tier} scale=${layout.scale} ${crossingDetail}`,
  ).toBe(0)

  for (const n of allNodes) {
    if (n.labelVisible) {
      expect(n.effectiveFontPx).toBeGreaterThanOrEqual(MIN_REQUIRED_SCREEN_FONT_PX)
    }
    if (n.id === layout.rootId) {
      expect(n.r).toBe(0)
      expect(n.x).toBe(0)
      expect(n.y).toBe(0)
    } else {
      // Clock-12 polar coordinate contract: x = r*sin(theta), y = -r*cos(theta)
      expect(Math.abs(n.x - n.r * Math.sin(n.theta))).toBeLessThan(1e-5)
      expect(Math.abs(n.y + n.r * Math.cos(n.theta))).toBeLessThan(1e-5)
      expect(n.theta).toBeGreaterThanOrEqual(n.wedgeStart - eps)
      expect(n.theta).toBeLessThanOrEqual(n.wedgeEnd + eps)

      if (n.parentId) {
        const parent = layout.nodes[n.parentId]!
        expect(n.r).toBeGreaterThan(parent.r)
        expect(n.theta).toBeGreaterThanOrEqual(parent.wedgeStart - eps)
        expect(n.theta).toBeLessThanOrEqual(parent.wedgeEnd + eps)
        if (parent.id !== layout.rootId) {
          const span = n.wedgeEnd - n.wedgeStart
          expect(span).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.maxNonRootFanRadians + 1e-6)
        }
      }
    }

    if (n.shape === 'capsule') {
      expect(n.width).toBeGreaterThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx)
      expect(n.width).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx)
    }
  }

  for (let i = 0; i < allNodes.length; i += 1) {
    const a = allNodes[i]!
    const aBox = {
      x: Math.min(a.x - a.width / 2, a.labelBox ? a.labelBox.x : a.x - a.width / 2),
      y: Math.min(a.y - a.height / 2, a.labelBox ? a.labelBox.y : a.y - a.height / 2),
      maxX: Math.max(
        a.x + a.width / 2,
        a.labelBox ? a.labelBox.x + a.labelBox.width : a.x + a.width / 2,
      ),
      maxY: Math.max(
        a.y + a.height / 2,
        a.labelBox ? a.labelBox.y + a.labelBox.height : a.y + a.height / 2,
      ),
    }
    for (let j = i + 1; j < allNodes.length; j += 1) {
      const b = allNodes[j]!
      const bBox = {
        x: Math.min(b.x - b.width / 2, b.labelBox ? b.labelBox.x : b.x - b.width / 2),
        y: Math.min(b.y - b.height / 2, b.labelBox ? b.labelBox.y : b.y - b.height / 2),
        maxX: Math.max(
          b.x + b.width / 2,
          b.labelBox ? b.labelBox.x + b.labelBox.width : b.x + b.width / 2,
        ),
        maxY: Math.max(
          b.y + b.height / 2,
          b.labelBox ? b.labelBox.y + b.labelBox.height : b.y + b.height / 2,
        ),
      }
      const xSeparated = aBox.maxX + minGap <= bBox.x + 1e-6 || bBox.maxX + minGap <= aBox.x + 1e-6
      const ySeparated = aBox.maxY + minGap <= bBox.y + 1e-6 || bBox.maxY + minGap <= aBox.y + 1e-6
      expect(xSeparated || ySeparated).toBe(true)
    }
  }

  for (const edge of layout.edges) {
    const src = layout.nodes[edge.sourceId]!
    const dst = layout.nodes[edge.targetId]!
    expect(Math.hypot(edge.sourceX - src.x, edge.sourceY - src.y)).toBeGreaterThan(1)
    expect(Math.hypot(edge.targetX - dst.x, edge.targetY - dst.y)).toBeGreaterThan(1)
    if (src.shape === 'circle' && src.radius !== null) {
      expect(
        Math.abs(Math.hypot(edge.sourceX - src.x, edge.sourceY - src.y) - src.radius),
      ).toBeLessThan(1e-4)
    } else {
      const rx = Math.abs(edge.sourceX - src.x) / (src.width / 2)
      const ry = Math.abs(edge.sourceY - src.y) / (src.height / 2)
      expect(Math.abs(Math.max(rx, ry) - 1)).toBeLessThan(1e-4)
    }
    if (dst.shape === 'circle' && dst.radius !== null) {
      expect(
        Math.abs(Math.hypot(edge.targetX - dst.x, edge.targetY - dst.y) - dst.radius),
      ).toBeLessThan(1e-4)
    } else {
      const rx = Math.abs(edge.targetX - dst.x) / (dst.width / 2)
      const ry = Math.abs(edge.targetY - dst.y) / (dst.height / 2)
      expect(Math.abs(Math.max(rx, ry) - 1)).toBeLessThan(1e-4)
    }
  }
}

const GOLDEN_RADIAL_SHA256: Readonly<Record<string, string>> = {
  'unbalanced150:root:t1:s1': '85878e25389bc9ee986ae63ba307ff5613132b030803eb36426a97a996c80bd0',
  'unbalanced150:root:t2:s1': '52c21eb3d21a1b5a2d2b1d950f8c03f58cdfb38cb7fdf4944a0305bad08602ab',
  'unbalanced150:root:t0:s0.85': '8b0fc8e0704cc033333a3fc846f4f88f6c015f94a71e116ed77021357baa7975',
  'unbalanced150:root:t0:s0.35': '20ff2fc56c16ac7744ca689d4d62e7239025daa7c1606c1d2e43063373124356',
  'unbalanced150:middle:t1:s1': '18f92442c8362115c66821fc2bb9408b8ee86449dc8146f86c7d41e2d56680f9',
  'unbalanced150:middle:t2:s1': '650f56d25f96078af5f1c24d7c81e67b6ce8feea92295195ad33e289e18f9d68',
  'unbalanced150:middle:t0:s0.85':
    '2cfe9d9617837eaad2ef0227c834126ee66af6ad94ee437a9ce677ee2a7ecf8e',
  'unbalanced150:middle:t0:s0.35':
    'ef0dc509de02fe8f0dd5eec8d400e5bc8bb07de452169dc8bd7501788b0f5b8d',
  'unbalanced150:leaf:t1:s1': '3b12f48db3d9dab53b273ac129f31b2150e8aca3ee47e8ce5a2ba995b974d998',
  'unbalanced150:leaf:t2:s1': '653dd5554dcbf5f0c12c538c49cae5c405d49214b87975a82828e579efe3f5c2',
  'unbalanced150:leaf:t0:s0.85': 'de3bad5d36edf789b44d757a8dfeb89ec778e7c95b925f6848975a16ae05410f',
  'unbalanced150:leaf:t0:s0.35': '3facf7cefb8e5bf40e3da0921bd4b8d9ffe732126b7462cdca95d67dd4967e20',
  'unbalanced150:withChildren:t1:s1':
    '889324f53a16f4c412ad8cf599598e072f4d52326b55b90e92a0e5f8571c3e33',
  'unbalanced150:withChildren:t2:s1':
    'eef96a5a132c88274fd958c8498822bc7c3015bfda452cb4bac7a8c903021520',
  'unbalanced150:withChildren:t0:s0.85':
    '1e6e6c4da64665837f42748cce76b8a2e63ff87a3c3531fca7618ef26694c449',
  'unbalanced150:withChildren:t0:s0.35':
    '563333e964a42085ef2b11c7a253ddd3fd94e20c2347d56d388b9f1a120a717f',
  'wide60Children:root:t1:s1': 'a7b0c968cfa6f940ce2c00fb56e58251ad17672250cb6481091e16d2be3d16bf',
  'wide60Children:root:t2:s1': '5e244d5ba9bb4e6cb10f1e5772fb7930087526448942c018b2f3f743bc370297',
  'wide60Children:root:t0:s0.85':
    'd13132c75cf6c8e6f0e769b4c67215a33c6d3bef9461fe185d4d80d198e7e5dd',
  'wide60Children:root:t0:s0.35':
    'bd6364abdef69c51a6ca350d73c32012a81fe2c2773d4fa99216d8f04ec2e39e',
  'wide60Children:middle:t1:s1': '19d7d6853c159bcf15b0a6fb895d92f546a6255ae3a337b22052aa8639fba4f1',
  'wide60Children:middle:t2:s1': '5ccd2f877b60457cf759db017fca6eb15398e0cd18be9e10fb85793ff5c911af',
  'wide60Children:middle:t0:s0.85':
    '779b4a95f02cdf7c112414bac651a07aabcad988a83b8a68fc5ee250a507b250',
  'wide60Children:middle:t0:s0.35':
    '7f9dc0785915ae8a48d728723db0fb560647021f88f50af7d11bfaad4f9fb093',
  'wide60Children:leaf:t1:s1': 'e22f8d490e178ea948afe08eb56534b42c99427ff48b5184a077b0d56e27fe51',
  'wide60Children:leaf:t2:s1': '21125476c747296bf579ca68804b375af3e14b6b64702b9391246260305bc2b8',
  'wide60Children:leaf:t0:s0.85':
    '305c42bd171c84bea7bd797e3e1053c219c5f5490b0c541aa707203ce111369d',
  'wide60Children:leaf:t0:s0.35':
    'a33a0ee0506dec88bf20b07f8dec0c47670e1849dbf4370dda95b66d65b082e3',
  'wide60Children:withChildren:t1:s1':
    '12abc3bdeff96905c9deba28c671f7a5c62b8de83eb1db70af382efcac5e8c08',
  'wide60Children:withChildren:t2:s1':
    '15d101b21f4fae5f2b4759df04a349d438e17f45df6f13b6e8914fc4963a6c60',
  'wide60Children:withChildren:t0:s0.85':
    '58cb868f798d534432730d9060151e74806c73709b06284d1fe34258abfe5da1',
  'wide60Children:withChildren:t0:s0.35':
    '75d9b00ea17f1be6da39b144ce570fbcc3a13d30d39c1d2bb66fe7c03750963b',
  'chainDepth12:root:t1:s1': 'f046e7fbcc7e28272ca4857cfad4f88ad96aff6d496644854fa0ae841ea501b3',
  'chainDepth12:root:t2:s1': 'c26ad401470a976b7ff7eeec9ef03d9dd4133eeb29a098401bc2d83d5ba60a63',
  'chainDepth12:root:t0:s0.85': '85520764f624b762bd2408ece33922ac5b6af3e2032d3e2ddedc2537fe9e7d4a',
  'chainDepth12:root:t0:s0.35': '1a685a66d74ce9ce24fbb994d7b79f325106276b1b1194c42a1ce166e4c1f974',
  'chainDepth12:middle:t1:s1': '88862eee46b3fc8eaa45a0e3d7797597a1b8a3290463bba72d8d7307d22bac99',
  'chainDepth12:middle:t2:s1': '43a6e6bf9201b1f33178f3615c73cf5b93a6d3b5ea0d72bfb8fa5e06e31ddf3e',
  'chainDepth12:middle:t0:s0.85':
    '6d77ba909a295004a8d783773a83c17e7534ba328a659b3670808997df54359a',
  'chainDepth12:middle:t0:s0.35':
    '15c989642454f8805acd7eac02822f059181fae3a68e971d5b23bb26e48aba06',
  'chainDepth12:leaf:t1:s1': '9645844be7332b21cb41f51850adf69aec8fa4c90f81767d090ca32330d372c8',
  'chainDepth12:leaf:t2:s1': '6a91ed04539f3dd1b714bc59da0d0a40ee3a7516a0fb32a17b3a51a1f28272b9',
  'chainDepth12:leaf:t0:s0.85': '71e965f592b96a1be77b88e6cf2c37ac64613b3352f5d35cb57b7788ee727f73',
  'chainDepth12:leaf:t0:s0.35': '342de8800783ba5f56b60669a5fd865edd003c0c11f335853b23c051944d4927',
  'chainDepth12:withChildren:t1:s1':
    '1139287cb178f77321512565416e8a9b30c823bae0ec203edef6e9fed36bf21f',
  'chainDepth12:withChildren:t2:s1':
    '8fcb943cd89562c37de1e2f67f8baf1f8d0a0ebd1ab2da7da543e02344b52655',
  'chainDepth12:withChildren:t0:s0.85':
    '6d69d9bbc46d95eabc8e9d230e725f89383aa4fa300b4ad2a211a4f485334002',
  'chainDepth12:withChildren:t0:s0.35':
    'c0dc4c0438390b19a73582ad1a96302305af2191b024da5115bbc9d0eb66b054',
  'root20Children:root:t1:s1': '7afca6e7769d60feea16b78bb57e08e0aa5f33328f36b3e2f78fcf8ff931e6ee',
  'root20Children:root:t2:s1': 'c4f7186fb90411dab403f9a4e44069c206cdbad84f7dc63ad9ab1030c0942cd5',
  'root20Children:root:t0:s0.85':
    'fbe6a0ca8bd25e70b3c1e71ef45999b61725182844932e27ba0e3b04bb696127',
  'root20Children:root:t0:s0.35':
    '3b08075a3ceb658e270c5976bb2cacdfb4414a7a23041a319952fada8ce59fd4',
  'root20Children:middle:t1:s1': '2b3a373f2e73f7eca274a8462eba2f190d27c992dde95fd71dc7572006ae66a7',
  'root20Children:middle:t2:s1': '32caecef674bb6210f1a570bc80955ee0b07f264ccc3c27e1c58397fd4021f4b',
  'root20Children:middle:t0:s0.85':
    'b17e8d182ed234787c8ad4fd229fd1943fc3b12d7ce0bfd43cea3c97b7f86088',
  'root20Children:middle:t0:s0.35':
    'fc86fd23ffd5d854873f40dfb6300b21196581c6e709c01ed1ccc8b7d2044fd4',
  'root20Children:leaf:t1:s1': '5c23ae5a277039b9c965f489b8677ab6aa938770fc347318a0586f4010cab427',
  'root20Children:leaf:t2:s1': 'deb7f6ad472f7559d6d08a4c751127f9418ab54f389695eeeaa8c03339c3f995',
  'root20Children:leaf:t0:s0.85':
    'fc92956a79a054b61b894990329a7e61493f8a66bd80cd8bb9b0920637777455',
  'root20Children:leaf:t0:s0.35':
    '51ad212cf08acb071072f0d273b793c5663696f62971852298d71b66695b9088',
  'root20Children:withChildren:t1:s1':
    '7afca6e7769d60feea16b78bb57e08e0aa5f33328f36b3e2f78fcf8ff931e6ee',
  'root20Children:withChildren:t2:s1':
    'c4f7186fb90411dab403f9a4e44069c206cdbad84f7dc63ad9ab1030c0942cd5',
  'root20Children:withChildren:t0:s0.85':
    'fbe6a0ca8bd25e70b3c1e71ef45999b61725182844932e27ba0e3b04bb696127',
  'root20Children:withChildren:t0:s0.35':
    '3b08075a3ceb658e270c5976bb2cacdfb4414a7a23041a319952fada8ce59fd4',
  'large2000:root:t1:s1': '4a61089e1065ebae633cb989a6df4aaa7a2de153b93bcaea3352f41ec4dc348e',
  'large2000:root:t2:s1': 'd23a803853346c23e9db3293803509801e03a289b0f90e323f527063d309e53f',
  'large2000:root:t0:s0.85': '0a6fb46c64050dab7aedd8a40c6c78eff93eb0192535fcfe37f7a67719d0956e',
  'large2000:root:t0:s0.35': 'd32e82c9ad4be9a1282d5ba12af017e2e5d52a2ac9a22eaceeeca4823e344f0d',
  'large2000:middle:t1:s1': '04c9f7ed8c0b2d3933dc3f92fb6f5ccf313bbf6a27ec42472e8b24a3b194db50',
  'large2000:middle:t2:s1': '0c629ec46f75974289800bf2dad65278225b990fa5df845889be061ee9a37a3d',
  'large2000:middle:t0:s0.85': '2f9571ca8b991b89282e763a021bcfb200fd38ce35c1cb290a1f64cca7049fe4',
  'large2000:middle:t0:s0.35': '03886af9c43f45f0c4c36ea0146f91bac15c5c932563be37a017ec0485319b75',
  'large2000:leaf:t1:s1': '53a1deab8027f7542f31b85b488f99a40b60f3fffa953e97b0842c0476d77d98',
  'large2000:leaf:t2:s1': 'b97ba9680f7d88ae3c922bca54682f24aaff22569b7ba707457b4ca8ba69fa56',
  'large2000:leaf:t0:s0.85': '56ef035262daecf8fd2eaa054662f04bb67ae6ca75c21a9c588390d4cc3230a1',
  'large2000:leaf:t0:s0.35': '54914925ea0b52318351039a4cc98af212a86bbd21ca4a2ce4416f0d88a0441b',
  'large2000:withChildren:t1:s1':
    '88c2752530656d8330f08be4c272007263a0bb12bcb9f18461ab0427b867ebfa',
  'large2000:withChildren:t2:s1':
    '507d271717680b79e09873089c5cadfc6de815b675a9ad9a239bbe38ff696e8e',
  'large2000:withChildren:t0:s0.85':
    'a267dfb4b79a5e21910c4dba55211b2fb0736803c7ddb1929d7ce89f8aa82209',
  'large2000:withChildren:t0:s0.35':
    'e2d20743dd38a80e7cc5774722a4be94f1e1f6f0fa152cdf5516b3564ab9d86b',
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('computeRadialLayout (FR-MAP-03)', () => {
  it('matches pre-refactor golden SHA-256 hashes across all 5 mandatory datasets, focuses, tiers, and scales', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasets = Object.values(createMandatoryDatasets())
    expect(datasets).toHaveLength(5)

    let checked = 0
    for (const ds of datasets) {
      const { state: tree } = buildTree(ds.entries)
      const middleId = ds.entries[Math.floor(ds.entries.length / 2)]?.node?.id ?? MAP_ROOT_ID
      let leafId = ds.entries[ds.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
      for (const e of ds.entries) {
        const id = e.node?.id
        if (id && (tree.nodes[id]?.childrenIds.length ?? 0) === 0) {
          leafId = id
          break
        }
      }
      let withChildrenId = MAP_ROOT_ID
      let maxChildren = 0
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxChildren) {
          maxChildren = n.childrenIds.length
          withChildrenId = n.id
        }
      }

      const focuses = {
        root: MAP_ROOT_ID,
        middle: middleId,
        leaf: leafId,
        withChildren: withChildrenId,
      }
      for (const [focusKind, focusId] of Object.entries(focuses)) {
        for (const [scale, tier] of [
          [1, 1] as const,
          [1, 2] as const,
          [0.85, 0] as const,
          [0.35, 0] as const,
        ]) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId,
            zoomTier: tier,
          })
          const layout = computeRadialLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          const geom = computeRadialGeometryDiagnostics(layout)
          const canonicalGoldenPayload = {
            rootId: layout.rootId,
            tier: layout.tier,
            scale: layout.scale,
            nodes: layout.nodes,
            orderedIds: layout.orderedIds,
            edges: layout.edges,
            diagnostics: {
              nodeCount: layout.diagnostics.nodeCount,
              edgeCount: layout.diagnostics.edgeCount,
              overlapCount: geom.overlapCount,
              edgeCrossingsCount: geom.edgeCrossingsCount,
              truncatedCount: layout.diagnostics.truncatedCount,
              hiddenLabelCount: layout.diagnostics.hiddenLabelCount,
              minEffectiveFontPx: layout.diagnostics.minEffectiveFontPx,
              collisionPassesUsed: layout.diagnostics.collisionPassesUsed,
            },
          }
          const key = `${ds.id}:${focusKind}:t${tier}:s${scale}`
          const actualHash = await sha256Hex(JSON.stringify(canonicalGoldenPayload))
          expect(actualHash, `golden hash mismatch for ${key}`).toBe(GOLDEN_RADIAL_SHA256[key])
          checked += 1
        }
      }
    }
    expect(checked).toBe(80)

    const worstVisible = buildWorstCaseVisible(300)
    const worstLayout = computeRadialLayout({
      visible: worstVisible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 2,
    })
    const worstHash = await sha256Hex(JSON.stringify(worstLayout))
    if (process.env.UPDATE_GOLDEN === '1' && !process.env.CI) {
      console.info(`[UPDATE_GOLDEN] GOLDEN_WORST300_SHA256=${worstHash}`)
    }
    expect(worstHash, 'golden hash mismatch for worstCase300').toBe(GOLDEN_WORST300_SHA256)
  })

  it('preserves exact candidate pre-order tie-breaking across multiple grid cells', () => {
    const capsule = {
      shape: 'capsule' as const,
      displayTitle: 'Node',
      isTruncated: false,
      labelVisible: true,
      width: 120,
      height: 40,
      radius: null,
      localLabelBox: null,
    }
    const makePlacedMap = (): Map<string, PlacedMutableNode> => {
      const entries: [string, PlacedMutableNode][] = [
        [
          MAP_ROOT_ID,
          {
            id: MAP_ROOT_ID,
            parentId: null,
            depth: 0,
            kind: 'root',
            spec: { ...capsule, shape: 'circle', width: 104, height: 104, radius: 52 },
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 4,
            r: 0,
            theta: 0,
            x: 0,
            y: -400,
            wedgeStart: 0,
            wedgeEnd: Math.PI * 2,
          },
        ],
        [
          'p',
          {
            id: 'p',
            parentId: MAP_ROOT_ID,
            depth: 1,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 2,
            r: 1200,
            theta: -Math.PI / 2,
            x: -1200,
            y: 0,
            wedgeStart: -Math.PI,
            wedgeEnd: 0,
          },
        ],
        [
          'c',
          {
            id: 'c',
            parentId: 'p',
            depth: 2,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: 1200,
            theta: Math.PI / 2,
            x: 1200,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI,
          },
        ],
        [
          'earlierFar',
          {
            id: 'earlierFar',
            parentId: MAP_ROOT_ID,
            depth: 2,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: 700,
            theta: Math.PI / 2,
            x: 700,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI,
          },
        ],
        [
          'laterNear',
          {
            id: 'laterNear',
            parentId: MAP_ROOT_ID,
            depth: 2,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: 700,
            theta: -Math.PI / 2,
            x: -700,
            y: 0,
            wedgeStart: -Math.PI,
            wedgeEnd: 0,
          },
        ],
      ]
      return new Map(entries)
    }

    const order = [MAP_ROOT_ID, 'p', 'c', 'earlierFar', 'laterNear']
    const children = new Map<string, string[]>([
      [MAP_ROOT_ID, ['p', 'earlierFar', 'laterNear']],
      ['p', ['c']],
      ['c', []],
      ['earlierFar', []],
      ['laterNear', []],
    ])
    const cfg = { ...DEFAULT_RADIAL_LAYOUT_CONFIG, maxCollisionPasses: 1 }
    const actualPlaced = makePlacedMap()
    const refPlaced = makePlacedMap()

    resolveCollisionsAndCrossings(MAP_ROOT_ID, order, children, actualPlaced, cfg)
    resolveCollisionsAndCrossingsReference(MAP_ROOT_ID, order, children, refPlaced, cfg)
    expect(Array.from(actualPlaced.entries())).toEqual(Array.from(refPlaced.entries()))
  })

  it('matches frozen reference implementation byte-for-byte on all mandatory datasets and >= 200 random trees', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasetMap = createMandatoryDatasets()
    for (const ds of Object.values(datasetMap)) {
      const { state: tree } = buildTree(ds.entries)
      const middleId = ds.entries[Math.floor(ds.entries.length / 2)]?.node?.id ?? MAP_ROOT_ID
      const deepId = ds.entries[ds.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
      for (const focusId of [MAP_ROOT_ID, middleId, deepId]) {
        for (const [scale, tier] of [[1, 1] as const, [1, 2] as const, [0.85, 0] as const]) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId,
            zoomTier: tier,
          })
          const actual = computeRadialLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          const expected = computeRadialLayoutReference({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
        }
      }
    }

    const worstVisible = buildWorstCaseVisible(300)
    expect(
      JSON.stringify(
        computeRadialLayout({
          visible: worstVisible,
          measureText: fixedWidthMeasure(7.5),
          scale: 1,
          tier: 2,
        }),
      ),
    ).toBe(
      JSON.stringify(
        computeRadialLayoutReference({
          visible: worstVisible,
          measureText: fixedWidthMeasure(7.5),
          scale: 1,
          tier: 2,
        }),
      ),
    )

    const diffTreeArb = fc.array(
      fc.record({
        parentPick: fc.nat(200),
        titleLen: fc.integer({ min: 2, max: 45 }),
        hiddenCount: fc.integer({ min: 0, max: 30 }),
      }),
      { minLength: 1, maxLength: 60 },
    )
    fc.assert(
      fc.property(diffTreeArb, (specs) => {
        const ids = [MAP_ROOT_ID]
        const list: VisibleMapNode[] = [
          makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
        ]
        const depths = new Map<string, number>([[MAP_ROOT_ID, 0]])
        specs.forEach((s, idx) => {
          const parentId = ids[s.parentPick % ids.length]!
          const depth = (depths.get(parentId) ?? 0) + 1
          const id = `d_${idx}`
          ids.push(id)
          depths.set(id, depth)
          list.push(
            makeVisibleNode({
              id,
              parentId,
              title: 'W'.repeat(s.titleLen),
              depth,
              order: `o_${String(idx).padStart(4, '0')}`,
              hiddenCount: s.hiddenCount,
              totalDescendants: s.hiddenCount,
            }),
          )
        })
        const visible = computeVisibleFromNodes(list)
        const actual = computeRadialLayout({
          visible,
          measureText: fixedWidthMeasure(8),
          scale: 1,
          tier: 1,
        })
        const expected = computeRadialLayoutReference({
          visible,
          measureText: fixedWidthMeasure(8),
          scale: 1,
          tier: 1,
        })
        expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
      }),
      { numRuns: 220 },
    )
  })

  it('enforces exact stagger thresholds at >= 12 (2 rings) and >= 34 (3 rings)', () => {
    const s11 = computeRadialLayout({
      visible: makeStarVisible(11),
      measureText: fixedWidthMeasure(8),
    })
    const s12 = computeRadialLayout({
      visible: makeStarVisible(12),
      measureText: fixedWidthMeasure(8),
    })
    const s33 = computeRadialLayout({
      visible: makeStarVisible(33),
      measureText: fixedWidthMeasure(8),
    })
    const s34 = computeRadialLayout({
      visible: makeStarVisible(34),
      measureText: fixedWidthMeasure(8),
    })

    expect(s11.nodes.c_000!.staggerRingCount).toBe(1)
    expect(s12.nodes.c_000!.staggerRingCount).toBe(2)
    expect(s12.nodes.c_001!.staggerIndex).toBe(1)
    expect(s12.nodes.c_001!.r - s12.nodes.c_000!.r).toBeCloseTo(
      DEFAULT_RADIAL_LAYOUT_CONFIG.staggerRadialStepPx,
      4,
    )
    expect(s33.nodes.c_000!.staggerRingCount).toBe(2)
    expect(s34.nodes.c_000!.staggerRingCount).toBe(3)
    expect(s34.nodes.c_001!.staggerIndex).toBe(1)
    expect(s34.nodes.c_002!.staggerIndex).toBe(2)
    expect(s34.nodes.c_001!.r - s34.nodes.c_000!.r).toBeCloseTo(
      DEFAULT_RADIAL_LAYOUT_CONFIG.staggerRadialStepPx,
      4,
    )
    expect(s34.nodes.c_002!.r - s34.nodes.c_001!.r).toBeCloseTo(
      DEFAULT_RADIAL_LAYOUT_CONFIG.staggerRadialStepPx,
      4,
    )
  })

  it('computes bottom-up subtree angular weights on a hand-calculated 2-level tree (M1) and applies focus boost (M5)', () => {
    // Branch A has 1 direct child (a_mid) -> 3 leaves; Branch B has 1 direct child (b_mid) -> 1 leaf.
    // Direct-child count would treat A == B (1 vs 1), whereas bottom-up weights yield 3 : 1.
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 'a', parentId: MAP_ROOT_ID, title: 'Branch A', depth: 1, order: 'a0' }),
      makeVisibleNode({ id: 'b', parentId: MAP_ROOT_ID, title: 'Branch B', depth: 1, order: 'a1' }),
      makeVisibleNode({ id: 'a_mid', parentId: 'a', title: 'A Mid', depth: 2, order: 'b0' }),
      makeVisibleNode({ id: 'b_mid', parentId: 'b', title: 'B Mid', depth: 2, order: 'b0' }),
      makeVisibleNode({ id: 'a1', parentId: 'a_mid', title: 'A1', depth: 3, order: 'c0' }),
      makeVisibleNode({ id: 'a2', parentId: 'a_mid', title: 'A2', depth: 3, order: 'c1' }),
      makeVisibleNode({ id: 'a3', parentId: 'a_mid', title: 'A3', depth: 3, order: 'c2' }),
      makeVisibleNode({ id: 'b1', parentId: 'b_mid', title: 'B1', depth: 3, order: 'c0' }),
    ])
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const wA = layout.nodes.a!.subtreeWeight
    const wB = layout.nodes.b!.subtreeWeight
    expect(wA).toBe(3)
    expect(wB).toBe(1)
    const spanA = layout.nodes.a!.wedgeEnd - layout.nodes.a!.wedgeStart
    const spanB = layout.nodes.b!.wedgeEnd - layout.nodes.b!.wedgeStart
    expect(spanA / spanB).toBeCloseTo(3, 5)

    // Focus-path leaf sibling vs identical non-focus leaf sibling: weights 3.5 vs 1.
    const focusVisible = buildSyntheticVisible(
      [
        makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
        makeVisibleNode({
          id: 'focused',
          parentId: MAP_ROOT_ID,
          title: 'Focused Leaf',
          depth: 1,
          order: 'a0',
          isOnFocusPath: true,
          isFocus: true,
        }),
        makeVisibleNode({
          id: 'plain',
          parentId: MAP_ROOT_ID,
          title: 'Plain Leaf',
          depth: 1,
          order: 'a1',
          isOnFocusPath: false,
          isFocus: false,
        }),
      ],
      'focused',
    )
    const focusLayout = computeRadialLayout({
      visible: focusVisible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })
    expect(focusLayout.nodes.focused!.subtreeWeight).toBeCloseTo(3.5, 6)
    expect(focusLayout.nodes.plain!.subtreeWeight).toBeCloseTo(1, 6)
    const fSpan = focusLayout.nodes.focused!.wedgeEnd - focusLayout.nodes.focused!.wedgeStart
    const pSpan = focusLayout.nodes.plain!.wedgeEnd - focusLayout.nodes.plain!.wedgeStart
    expect(fSpan / pSpan).toBeCloseTo(3.5, 5)
  })

  it('places edge start and end anchors strictly on node capsule/circle perimeter within epsilon (M4)', () => {
    const circleSpec = {
      shape: 'circle' as const,
      displayTitle: 'Root',
      isTruncated: false,
      labelVisible: true,
      width: 104,
      height: 104,
      radius: 52,
      localLabelBox: null,
    }
    const capsuleSpec = {
      shape: 'capsule' as const,
      displayTitle: 'Leaf',
      isTruncated: false,
      labelVisible: true,
      width: 160,
      height: 40,
      radius: null,
      localLabelBox: null,
    }

    const cPt = clipRayToNodeEdge(0, 0, circleSpec, 100, 100)
    expect(Math.hypot(cPt.x, cPt.y)).toBeCloseTo(52, 6)

    const capRight = clipRayToNodeEdge(10, 20, capsuleSpec, 200, 40)
    expect(capRight.x - 10).toBeCloseTo(80, 6)
    expect(capRight.y - 20).toBeCloseTo(16, 6)

    const capTop = clipRayToNodeEdge(10, 20, capsuleSpec, 10, -100)
    expect(capTop.x - 10).toBeCloseTo(2, 6)
    expect(capTop.y - 20).toBeCloseTo(-20, 6)

    const layout = computeRadialLayout({
      visible: makeStarVisible(4),
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })
    for (const e of layout.edges) {
      const src = layout.nodes[e.sourceId]!
      const dst = layout.nodes[e.targetId]!
      expect(Math.hypot(e.sourceX - src.x, e.sourceY - src.y)).toBeCloseTo(src.radius!, 5)
      const capRx = Math.abs(e.targetX - dst.x) / (dst.width / 2)
      const capRy = Math.abs(e.targetY - dst.y) / (dst.height / 2)
      expect(Math.max(capRx, capRy)).toBeCloseTo(1, 5)
    }
  })

  it('caps non-root child fan arc at <= 255 degrees even when parent owns a 360 degree wedge', () => {
    const visible = makeStarVisible(1, { nonRootChildrenCount: 6 })
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const children = Object.values(layout.nodes).filter((n) => n.parentId === 'c_000')
    expect(children).toHaveLength(6)
    const minStart = Math.min(...children.map((c) => c.wedgeStart))
    const maxEnd = Math.max(...children.map((c) => c.wedgeEnd))
    const totalFanSpan = maxEnd - minStart
    expect(totalFanSpan).toBeLessThanOrEqual((255 * Math.PI) / 180 + 1e-6)
    expect(totalFanSpan).toBeCloseTo((255 * Math.PI) / 180, 5)
    assertRadialInvariants(layout)
  })

  it('allocates angular weight proportionally using 0.35 * log2(1 + hiddenCount)', () => {
    const visible = makeStarVisible(2, {
      hiddenAtIndex: new Map([
        [0, 15],
        [1, 0],
      ]),
    })
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const c0 = layout.nodes.c_000!
    const c1 = layout.nodes.c_001!
    const span0 = c0.wedgeEnd - c0.wedgeStart
    const span1 = c1.wedgeEnd - c1.wedgeStart
    const expectedW0 = 1 + 0.35 * Math.log2(16)
    expect(c0.subtreeWeight).toBeCloseTo(expectedW0, 6)
    expect(c1.subtreeWeight).toBeCloseTo(1, 6)
    expect(span0 / span1).toBeCloseTo(expectedW0, 5)
  })

  it('uses injected measureText for adaptive capsule width and only truncates titles at the end', () => {
    const longTitle = 'Hyperbolic Geometry Fundamentals For Knowledge Graphs'
    const shortTitle = 'Alpha Beta Gamma'
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 'a', parentId: MAP_ROOT_ID, title: shortTitle, depth: 1, order: 'a0' }),
      makeVisibleNode({ id: 'b', parentId: MAP_ROOT_ID, title: longTitle, depth: 1, order: 'a1' }),
    ])

    const narrow = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(4),
      scale: 1,
      tier: 1,
    })
    const wide = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(11),
      scale: 1,
      tier: 1,
    })

    expect(wide.nodes.a!.width).toBeGreaterThan(narrow.nodes.a!.width)
    expect(wide.nodes.a!.width).toBe(
      shortTitle.length * 11 + DEFAULT_RADIAL_LAYOUT_CONFIG.capsulePaddingXPx,
    )
    expect(wide.nodes.b!.width).toBeLessThanOrEqual(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx)
    expect(wide.nodes.b!.width).toBeGreaterThan(DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx)
    expect(wide.nodes.b!.isTruncated).toBe(true)
    expect(wide.nodes.b!.displayTitle.endsWith('…')).toBe(true)
    const preservedPrefix = wide.nodes.b!.displayTitle.slice(0, -1)
    expect(longTitle.startsWith(preservedPrefix)).toBe(true)
  })

  it('enforces minimum 11 px effective on-screen font across zoom scales and tiers', () => {
    const rLow = resolveScreenZoomTier(0.5, 2)
    expect(rLow.tier).toBe(0)
    expect(rLow.labelVisible).toBe(false)

    // At scale 0.7: 13 * 0.7 = 9.1 (< 11) and 14 * 0.7 = 9.8 (< 11) -> must reject font >= 8 cheat.
    const rBoundaryBelow = resolveScreenZoomTier(0.7, 1)
    expect(rBoundaryBelow.tier).toBe(0)
    expect(rBoundaryBelow.labelVisible).toBe(false)

    const rBoundaryPass = resolveScreenZoomTier(0.85, 1)
    expect(rBoundaryPass.tier).toBe(1)
    expect(rBoundaryPass.labelVisible).toBe(true)
    expect(rBoundaryPass.effectiveFontPx).toBeGreaterThanOrEqual(11)

    const rTier0Visible = resolveScreenZoomTier(0.8, 0)
    expect(rTier0Visible.tier).toBe(0)
    expect(rTier0Visible.labelVisible).toBe(true)
    expect(rTier0Visible.effectiveFontPx).toBeGreaterThanOrEqual(11)

    const visible = makeStarVisible(5)
    const layoutLow = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 0.7,
      tier: 1,
    })
    expect(layoutLow.tier).toBe(0)
    expect(layoutLow.diagnostics.hiddenLabelCount).toBe(layoutLow.diagnostics.nodeCount)
    assertRadialInvariants(layoutLow)
  })

  it('is completely deterministic and invariant to input node key, orderedIds, and visibleChildIds permutation', () => {
    const canonical = makeStarVisible(8, { hiddenAtIndex: new Map([[2, 7]]) })
    const reversedEntries = Object.entries(canonical.nodes)
      .reverse()
      .map(([id, n]) => [id, { ...n, visibleChildIds: [...n.visibleChildIds].reverse() }])
    const scrambled: ComputeVisibleResult = {
      ...canonical,
      orderedIds: [...canonical.orderedIds].reverse(),
      nodes: Object.fromEntries(reversedEntries),
    }

    const r1 = computeRadialLayout({
      visible: deepFreeze(canonical),
      measureText: fixedWidthMeasure(8),
    })
    const r2 = computeRadialLayout({
      visible: deepFreeze(scrambled),
      measureText: fixedWidthMeasure(8),
    })
    expect(r2).toEqual(r1)
  })

  it('validates all 5 mandatory datasets cleanly across tiers and measures large2000 compute time', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasetMap = createMandatoryDatasets()
    const datasets = Object.values(datasetMap)
    expect(datasets).toHaveLength(5)

    const extents: Array<Record<string, number | string>> = []
    for (const ds of datasets) {
      const { state: tree } = buildTree(ds.entries)
      // Pick the node with the most children or deepest entry so visible sets exercise dense fans & paths.
      let richestFocus = ds.entries[Math.floor(ds.entries.length / 2)]?.node?.id ?? MAP_ROOT_ID
      let maxChildren = -1
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxChildren) {
          maxChildren = n.childrenIds.length
          richestFocus = n.id
        }
      }
      const deepFocus = ds.entries[ds.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
      for (const focusTarget of [MAP_ROOT_ID, richestFocus, deepFocus]) {
        for (const [scale, tier] of [
          [1, 1] as const,
          [1, 2] as const,
          [0.85, 0] as const,
          [0.35, 0] as const,
        ]) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId: focusTarget,
            zoomTier: tier,
          })
          const layout = computeRadialLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          assertRadialInvariants(layout)

          if (
            focusTarget === MAP_ROOT_ID ||
            (ds.id === 'wide60Children' && focusTarget === richestFocus)
          ) {
            let maxR = 0
            let minX = Number.POSITIVE_INFINITY
            let maxX = Number.NEGATIVE_INFINITY
            let minY = Number.POSITIVE_INFINITY
            let maxY = Number.NEGATIVE_INFINITY
            for (const n of Object.values(layout.nodes)) {
              if (n.r > maxR) maxR = n.r
              minX = Math.min(minX, n.x - n.width / 2)
              maxX = Math.max(maxX, n.x + n.width / 2)
              minY = Math.min(minY, n.y - n.height / 2)
              maxY = Math.max(maxY, n.y + n.height / 2)
            }
            extents.push({
              dataset: ds.id,
              focus: focusTarget === MAP_ROOT_ID ? 'root' : 'withChildren',
              tier,
              scale,
              visibleNodes: layout.diagnostics.nodeCount,
              maxRadiusPx: Math.round(maxR),
              bboxW: Math.round(maxX - minX),
              bboxH: Math.round(maxY - minY),
            })
          }
        }
      }
      if (ds.id === 'wide60Children') {
        const expandedVisible = computeVisible({
          tree,
          rootTitle: ds.manifest.title,
          focusId: richestFocus,
          zoomTier: 1,
          expandedOverflowParentIds: new Set([richestFocus]),
        })
        const expandedLayout = computeRadialLayout({
          visible: expandedVisible,
          measureText: fixedWidthMeasure(7.5),
          scale: 1,
          tier: 1,
        })
        assertRadialInvariants(expandedLayout)
        let maxR = 0
        let minX = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY
        for (const n of Object.values(expandedLayout.nodes)) {
          if (n.r > maxR) maxR = n.r
          minX = Math.min(minX, n.x - n.width / 2)
          maxX = Math.max(maxX, n.x + n.width / 2)
          minY = Math.min(minY, n.y - n.height / 2)
          maxY = Math.max(maxY, n.y + n.height / 2)
        }
        extents.push({
          dataset: ds.id,
          focus: 'withChildren_expanded60',
          tier: 1,
          scale: 1,
          visibleNodes: expandedLayout.diagnostics.nodeCount,
          maxRadiusPx: Math.round(maxR),
          bboxW: Math.round(maxX - minX),
          bboxH: Math.round(maxY - minY),
        })
      }
    }
    console.info(`[T3_2B_EXTENT] ${JSON.stringify(extents)}`)
  })

  it('benchmarks phase breakdown and enforces compute performance on large2000 & 300-node worst case', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const { large2000 } = createMandatoryDatasets()
    const { state: largeTree } = buildTree(large2000.entries)
    const largeDeepFocus = large2000.entries[large2000.entries.length - 1]?.node?.id ?? MAP_ROOT_ID

    const largeRootVisible = computeVisible({
      tree: largeTree,
      rootTitle: large2000.manifest.title,
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    const largeDeepVisible = computeVisible({
      tree: largeTree,
      rootTitle: large2000.manifest.title,
      focusId: largeDeepFocus,
      zoomTier: 2,
    })

    const worstVisible = buildWorstCaseVisible(300)
    expect(worstVisible.orderedIds.length).toBe(300)

    const measureScenario = (name: string, visible: ComputeVisibleResult, tier: 1 | 2) => {
      const measure = fixedWidthMeasure(7.5)
      const resolution = resolveScreenZoomTier(1, tier)
      const totals: number[] = []
      const phases = {
        weights: [] as number[],
        rings: [] as number[],
        collision: [] as number[],
        edges: [] as number[],
        diagnostics: [] as number[],
      }
      for (let i = 0; i < 5; i += 1) {
        const res = computeRadialLayout({ visible, measureText: measure, scale: 1, tier })
        computeRadialGeometryDiagnostics(res)
      }
      for (let i = 0; i < 20; i += 1) {
        const tStart = performance.now()
        const full = computeRadialLayout({ visible, measureText: measure, scale: 1, tier })
        totals.push(performance.now() - tStart)

        const t0 = performance.now()
        const prepared = prepareSpecsAndWeights(
          full.rootId,
          visible,
          resolution,
          measure,
          DEFAULT_RADIAL_LAYOUT_CONFIG,
        )
        const t1 = performance.now()
        const { placed, placedPreOrder } = assignInitialPolarNodes(
          full.rootId,
          visible,
          prepared,
          DEFAULT_RADIAL_LAYOUT_CONFIG,
        )
        const t2 = performance.now()
        const passes = resolveCollisionsAndCrossings(
          full.rootId,
          placedPreOrder,
          prepared.childrenMap,
          placed,
          DEFAULT_RADIAL_LAYOUT_CONFIG,
        )
        const t3 = performance.now()
        const built = finalizeRadialResult(
          full.rootId,
          1,
          resolution,
          placedPreOrder,
          placed,
          passes,
        )
        const t4 = performance.now()
        computeRadialGeometryDiagnostics(built)
        const t5 = performance.now()

        phases.weights.push(t1 - t0)
        phases.rings.push(t2 - t1)
        phases.collision.push(t3 - t2)
        phases.edges.push(t4 - t3)
        phases.diagnostics.push(t5 - t4)
      }
      const summarize = (arr: number[]) => {
        const sorted = [...arr].sort((a, b) => a - b)
        const med = sorted[Math.floor(sorted.length / 2)]!
        const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!
        const max = sorted[sorted.length - 1]!
        return {
          medianMs: Number(med.toFixed(3)),
          p95Ms: Number(p95.toFixed(3)),
          maxMs: Number(max.toFixed(3)),
        }
      }
      return {
        name,
        visibleCount: visible.orderedIds.length,
        total: summarize(totals),
        phases: {
          weights: summarize(phases.weights),
          rings: summarize(phases.rings),
          collision: summarize(phases.collision),
          edges: summarize(phases.edges),
          diagnostics: summarize(phases.diagnostics),
        },
      }
    }

    const pRoot = measureScenario('large2000_root', largeRootVisible, 1)
    const pDeep = measureScenario('large2000_deep', largeDeepVisible, 2)
    const pWorst = measureScenario('worstCase300', worstVisible, 2)
    console.info(`[T3_2B_PERF_PROFILE] ${JSON.stringify([pRoot, pDeep, pWorst])}`)
    if (process.env.KNOVITES_PERF === '1') {
      expect(pRoot.total.medianMs).toBeLessThan(30)
      expect(pDeep.total.medianMs).toBeLessThan(30)
      expect(pWorst.total.medianMs).toBeLessThan(30)
    }
    expect(pWorst.visibleCount).toBe(300)
    expect(pWorst.total.medianMs).toBeGreaterThan(0)
  }, 60_000)

  it('enforces deterministic spatial-grid pair-check and zero-allocation bounds in CI (no wall-clock)', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const measure = fixedWidthMeasure(7.5)
    const runWithStats = (visible: ComputeVisibleResult, tier: 0 | 1 | 2) => {
      const stats: CollisionStats = {
        passesUsed: 0,
        overlapChecks: 0,
        edgeCrossChecks: 0,
        allocations: 0,
      }
      computeRadialLayout({ visible, measureText: measure, scale: 1, tier, stats })
      return stats
    }

    const largeDs = createMandatoryDatasets().large2000
    const { state: largeTree } = buildTree(largeDs.entries)
    const largeDeepId = largeDs.entries[Math.floor(largeDs.entries.length / 2)]!.node!.id
    const largeDeepVisible = computeVisible({
      tree: largeTree,
      rootTitle: largeDs.manifest.title,
      focusId: largeDeepId,
      zoomTier: 2,
    })
    const largeDeepStats = runWithStats(largeDeepVisible, 2)
    expect(largeDeepStats.allocations).toBe(0)
    expect(largeDeepStats.overlapChecks).toBeLessThanOrEqual(2_000)
    expect(largeDeepStats.edgeCrossChecks).toBeLessThanOrEqual(8_000)

    const scalingProfile = [50, 100, 200, 300].map((count) => {
      const vis = buildWorstCaseVisible(count)
      const st = runWithStats(vis, 2)
      return { n: vis.orderedIds.length, ...st }
    })
    console.info(
      `[T3_2C_OPT_SCALING] ${JSON.stringify({ largeDeep: largeDeepStats, scaling: scalingProfile })}`,
    )

    const worstStats = scalingProfile[scalingProfile.length - 1]!
    expect(worstStats.n).toBe(300)
    expect(worstStats.allocations).toBe(0)
    expect(worstStats.overlapChecks).toBeLessThanOrEqual(500)
    expect(worstStats.edgeCrossChecks).toBeLessThanOrEqual(50_000)
  })

  it('satisfies radial invariants under fast-check randomized trees', () => {
    const specArb = fc.array(
      fc.record({
        parentPick: fc.nat(100),
        titleLen: fc.integer({ min: 2, max: 45 }),
        hiddenCount: fc.integer({ min: 0, max: 40 }),
      }),
      { minLength: 1, maxLength: 38 },
    )

    fc.assert(
      fc.property(specArb, (specs) => {
        const ids = [MAP_ROOT_ID]
        const list: VisibleMapNode[] = [
          makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
        ]
        const depths = new Map<string, number>([[MAP_ROOT_ID, 0]])

        specs.forEach((s, idx) => {
          const parentId = ids[s.parentPick % ids.length]!
          const depth = (depths.get(parentId) ?? 0) + 1
          const id = `n_${idx}`
          ids.push(id)
          depths.set(id, depth)
          list.push(
            makeVisibleNode({
              id,
              parentId,
              title: 'X'.repeat(s.titleLen),
              depth,
              order: `k_${String(idx).padStart(4, '0')}`,
              hiddenCount: s.hiddenCount,
              totalDescendants: s.hiddenCount,
            }),
          )
        })

        const visible = computeVisibleFromNodes(list)
        const layout = computeRadialLayout({
          visible,
          measureText: fixedWidthMeasure(8),
          scale: 1,
          tier: 1,
        })
        assertRadialInvariants(layout)
      }),
      { numRuns: 35 },
    )
  })
})

function computeVisibleFromNodes(list: VisibleMapNode[]): ComputeVisibleResult {
  const entries: TreeBuildEntry[] = list
    .filter((n) => n.id !== MAP_ROOT_ID)
    .map((n) => ({
      node: {
        schema: 1,
        id: n.id,
        parentId: n.parentId === MAP_ROOT_ID ? null : n.parentId,
        slug: n.id,
        title: n.title,
        type: 'concept',
        status: 'none',
        tags: [],
        order: n.order,
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path: n.id,
    }))
  const { state: tree } = buildTree(entries)
  const computed = computeVisible({
    tree,
    rootTitle: 'Root',
    focusId: MAP_ROOT_ID,
    zoomTier: 1,
  })
  // Inject hidden counts directly for testing hiddenWeightCoeff invariance cleanly.
  const nodes: Record<string, VisibleMapNode> = {}
  const hiddenById = new Map(list.map((n) => [n.id, n.hiddenCount]))
  for (const [id, v] of Object.entries(computed.nodes)) {
    const h = hiddenById.get(id) ?? v.hiddenCount
    nodes[id] = { ...v, hiddenCount: h, isCollapsedWithChildren: h > 0 }
  }
  return { ...computed, nodes }
}
