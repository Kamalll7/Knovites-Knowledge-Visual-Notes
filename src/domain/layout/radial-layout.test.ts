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
 * GOLDEN HASH UPDATE PROCEDURE (T3.2c / updated for owner-approved T3.2f Opsi B):
 * - NEVER modify `GOLDEN_RADIAL_SHA256` or `GOLDEN_WORST300_SHA256` during performance refactors.
 * - Updating golden hashes is ONLY permitted after an explicitly approved behavioral change:
 *   1. Stop and report the behavioral diff before touching hashes.
 *   2. Run manually once: `UPDATE_GOLDEN=1 pnpm vitest run src/domain/layout/radial-layout.test.ts -t "golden"`
 *   3. Inspect and commit the approved hash map update (CI never sets `UPDATE_GOLDEN`).
 */
const GOLDEN_WORST300_SHA256 = '7c98ef7a8eea43593432e26de43e0a972a6fa143bfd140df119a98a1aa9134cd'

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
  'unbalanced150:root:t2:s1': '072e13cfed8393d75ec10788e4e0bfa88e8860f3a62485196cd86efbc58d02ef',
  'unbalanced150:root:t0:s0.85': '8b0fc8e0704cc033333a3fc846f4f88f6c015f94a71e116ed77021357baa7975',
  'unbalanced150:root:t0:s0.35': '20ff2fc56c16ac7744ca689d4d62e7239025daa7c1606c1d2e43063373124356',
  'unbalanced150:middle:t1:s1': 'd60f3b464cf2e4d3f343229e8b7c5854f88ca79b54e808871bd2aad19114e2b0',
  'unbalanced150:middle:t2:s1': 'e4f44918d3312807d5fde1138347dd3ab0bbffae332a48d4dd799bbd693dc97c',
  'unbalanced150:middle:t0:s0.85':
    '69cecb2b158d4ff8b9d4b80868375abd85c571432fd2007f9a37f68a3151ed39',
  'unbalanced150:middle:t0:s0.35':
    '43bec67b3a2f2ec2845007905595f615ca4c140e1e7cf07f34b58df3f56b4f24',
  'unbalanced150:leaf:t1:s1': '49331e1ecf8fc21f911e778e8759ce3eb8fa394e6558fc94290ba6ccd2bad5a6',
  'unbalanced150:leaf:t2:s1': 'baab12edd5e145dc108c5e90fcc0a9f932631da19c4380b1ce67999f0434d889',
  'unbalanced150:leaf:t0:s0.85': 'cae334469718f26062d8e84cb8092f08698797185d32eb99d327005cf9deeb97',
  'unbalanced150:leaf:t0:s0.35': '11755f283fdd9f3e53be84f873e555ecfd6db6bd1db474a4bcb1fe86f5fd51e8',
  'unbalanced150:withChildren:t1:s1':
    'abf034f9938c72572e256e24ed84711c8d94bc1e025a6048154d2d42f827097f',
  'unbalanced150:withChildren:t2:s1':
    'e043e6657bfecc476a3c78cb1645650ef2f8f5f083bdcaaaf514a27406400996',
  'unbalanced150:withChildren:t0:s0.85':
    'da011800a0fed930bc08ef1af9e8611ae409a8d116e32fae19575085b8912488',
  'unbalanced150:withChildren:t0:s0.35':
    '5e7a4d50d99919f9837293aac6ccd775c578471b4c26ec1287772b71a958e9ea',
  'wide60Children:root:t1:s1': 'a7b0c968cfa6f940ce2c00fb56e58251ad17672250cb6481091e16d2be3d16bf',
  'wide60Children:root:t2:s1': '5e244d5ba9bb4e6cb10f1e5772fb7930087526448942c018b2f3f743bc370297',
  'wide60Children:root:t0:s0.85':
    'd13132c75cf6c8e6f0e769b4c67215a33c6d3bef9461fe185d4d80d198e7e5dd',
  'wide60Children:root:t0:s0.35':
    'bd6364abdef69c51a6ca350d73c32012a81fe2c2773d4fa99216d8f04ec2e39e',
  'wide60Children:middle:t1:s1': 'ba5b802a5a309d57cd2053779b37e9a1972d470b02f18fde2f99ea09224c4d7d',
  'wide60Children:middle:t2:s1': 'a80e9d9911a56c6b0d31340acc483bee03880290022a9190705a2e5c949e629c',
  'wide60Children:middle:t0:s0.85':
    '8341b7b7b3e581e66477bdf331bfa33884f24dfaa1e48aeb625cc10826a108b1',
  'wide60Children:middle:t0:s0.35':
    'd77bdcb012d8967930dcc2257597a1922f2c5686ff15da43e7a7bca786c2898b',
  'wide60Children:leaf:t1:s1': 'fa0143ee2802baec113dc1e2774b14ee1146c13dcceaeb15e8a24ef1709b3641',
  'wide60Children:leaf:t2:s1': 'e9cc0cd96586e99a87351d2ab7981d32d99d09004e586bbed53870cf852512a4',
  'wide60Children:leaf:t0:s0.85':
    '38987747ff1864fe5b6226d20d8c4580aa43db46c5a891c7c28335c5a9aca439',
  'wide60Children:leaf:t0:s0.35':
    '18e5720ea78c5d2d27777beaf89f3ee61f8c26763a54336e0076126aa7bd78f8',
  'wide60Children:withChildren:t1:s1':
    'a16937279a86aa02f9e2349ccc55124338b854531dd4e04cc2c68fdb94c0115d',
  'wide60Children:withChildren:t2:s1':
    '06d322d66406f243da259df079ab28c3fec7b5f4eeb18ae8750c03eaeb75bb62',
  'wide60Children:withChildren:t0:s0.85':
    '38c9e6de0b5a18269c88dac03e4d5d796cc2c3843e577fa3d3b796b31a26311d',
  'wide60Children:withChildren:t0:s0.35':
    'e98d9add36968be63fc2bb6ef78275efbdf36008761738c3f08ec46b011f1242',
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
  'root20Children:root:t1:s1': '97f7594e06048ba0decc2ed74744d45d0b5ad416dcbaeee8a5ef0968d094773b',
  'root20Children:root:t2:s1': '8c463f705106b86bc792c82443d54b5e0935f41c5a3eb451257c377ae494b420',
  'root20Children:root:t0:s0.85':
    '0afb2c739c7cbdc2d0ae25487c6d0ed2efbda839f76a969fe5dbf832ef927784',
  'root20Children:root:t0:s0.35':
    'c9eae60d97cb92c3e5942e3ae3fc5afe014a6b096f0917eb743ed5ec2fbb60ae',
  'root20Children:middle:t1:s1': '54d96e4d0e6be0201a06a3ccc56176e8c9ebddc1a930274ee0464d8da0f4b683',
  'root20Children:middle:t2:s1': '833607906f8545f80b0de4dd1a5f382dd20cc23c0fc20452fcc16a10eef57350',
  'root20Children:middle:t0:s0.85':
    '0c8bd8fe6fbb7ae0e6c6f08f8541882ca4becc2a06f9960fd13974be5974c690',
  'root20Children:middle:t0:s0.35':
    '8f4e34664fec0fb8574187718ea7889677e695e6af6078ad70c97a3fb7a17ecb',
  'root20Children:leaf:t1:s1': '03cac8c9e217ffdca36025b55daae28af53f71dcae555fde4b99de3481e1fc4e',
  'root20Children:leaf:t2:s1': 'a38abdc355df77836d9589ebc49169bb11de94c4e583a0184072395a52ac03ee',
  'root20Children:leaf:t0:s0.85':
    'c2ba402e157026e2cbfef9c10607fa0eae8cc20c6f76a86edafa62740531badd',
  'root20Children:leaf:t0:s0.35':
    '5895cd03aac8efdfc11a5f61fd6e3be2971c15f75bc591ba535c1809f98732da',
  'root20Children:withChildren:t1:s1':
    '97f7594e06048ba0decc2ed74744d45d0b5ad416dcbaeee8a5ef0968d094773b',
  'root20Children:withChildren:t2:s1':
    '8c463f705106b86bc792c82443d54b5e0935f41c5a3eb451257c377ae494b420',
  'root20Children:withChildren:t0:s0.85':
    '0afb2c739c7cbdc2d0ae25487c6d0ed2efbda839f76a969fe5dbf832ef927784',
  'root20Children:withChildren:t0:s0.35':
    'c9eae60d97cb92c3e5942e3ae3fc5afe014a6b096f0917eb743ed5ec2fbb60ae',
  'large2000:root:t1:s1': '4a61089e1065ebae633cb989a6df4aaa7a2de153b93bcaea3352f41ec4dc348e',
  'large2000:root:t2:s1': '53d04247e93810e72137784ec965708ce596f6520eae50f81e5d2d6ddc1760d5',
  'large2000:root:t0:s0.85': '0a6fb46c64050dab7aedd8a40c6c78eff93eb0192535fcfe37f7a67719d0956e',
  'large2000:root:t0:s0.35': 'd32e82c9ad4be9a1282d5ba12af017e2e5d52a2ac9a22eaceeeca4823e344f0d',
  'large2000:middle:t1:s1': 'c6663a99f5553469d99d3ac44d5f5c4b40ee4b7f6335d903edfd69b548d6d5ff',
  'large2000:middle:t2:s1': '07a750acf049ef131a7505799d6e7a4ee571c2dd10a5688a90ca1a4de3063d40',
  'large2000:middle:t0:s0.85': '33af20513a0aae36791bd60075a08b26249b8cbdb1a7e99eae63e7892c22c636',
  'large2000:middle:t0:s0.35': 'ee2c2a43cd483cd7c805a2d42eaa5b0380e5dd72ffe72a418b791daffd96d767',
  'large2000:leaf:t1:s1': '52ef3ddf5da00b324c71236b9a69ec36e96a2ec6ec7bf7dd415cd59b9e4323ef',
  'large2000:leaf:t2:s1': '36cb806a4c879fecb06b72f55444e307584b05972a109a2affe23468b54269a2',
  'large2000:leaf:t0:s0.85': '0cfb0f8b0fb0faf335dbcf7e41fb5557936c65d05af1bf3bae8535321c307a86',
  'large2000:leaf:t0:s0.35': '5f1a656b8b1c772ba3674d67fa24c923e5d1634e2087ccc5ef9b5133d08290f4',
  'large2000:withChildren:t1:s1':
    '5edd7b038f131a479dcd40721d6b28d48d5284962b2871b857936ea7e1febbea',
  'large2000:withChildren:t2:s1':
    'd5477d533c3547d895775f71d45a9b3ce4f922b9e82d436a267ec293df19fdd1',
  'large2000:withChildren:t0:s0.85':
    '44b8a42bac5211a616b5efe4d8a4aea4e7b736fbb3738a7c909e4caba762ec1b',
  'large2000:withChildren:t0:s0.35':
    'e799417a83d0052d3e3d3a575ca11374ef47795bf9d9d69c54358dee318189f0',
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
    const actualHashes: Record<string, string> = {}
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
          actualHashes[key] = actualHash
          if (!(process.env.UPDATE_GOLDEN === '1' && !process.env.CI)) {
            expect(actualHash, `golden hash mismatch for ${key}`).toBe(GOLDEN_RADIAL_SHA256[key])
          }
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
      console.info(`[UPDATE_GOLDEN] GOLDEN_RADIAL_SHA256=${JSON.stringify(actualHashes, null, 2)}`)
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

  it('invalidates clean edges on both prevRects and currRects across passes (Mutation e)', () => {
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
    const polarNode = (
      id: string,
      parentId: string | null,
      depth: number,
      x: number,
      y: number,
      width = 120,
    ): [string, PlacedMutableNode] => [
      id,
      {
        id,
        parentId,
        depth,
        kind: parentId === null ? 'root' : 'node',
        spec: { ...capsule, width },
        staggerRingCount: 1,
        staggerIndex: 0,
        subtreeWeight: 1,
        r: Math.hypot(x, y),
        theta: Math.atan2(x, -y),
        x,
        y,
        wedgeStart: 0,
        wedgeEnd: Math.PI,
      },
    ]

    // Pass 0 marks c0 (y=500) clean, then p1->c1 (y=415) pushes mover (0,415)->(0,513) into prevRects.
    // Pass 1 must invalidate c0 via dirty rects and push mover past y=500; `isDirty => false` misses it.
    const makePlaced = (): Map<string, PlacedMutableNode> =>
      new Map([
        polarNode(MAP_ROOT_ID, null, 0, 0, 0, 104),
        polarNode('p0', MAP_ROOT_ID, 1, -300, 500),
        polarNode('c0', 'p0', 2, 300, 500),
        polarNode('p1', MAP_ROOT_ID, 1, -190, 415, 60),
        polarNode('c1', 'p1', 2, 190, 415, 60),
        polarNode('mover', MAP_ROOT_ID, 3, 0, 415, 60),
      ])
    const order = [MAP_ROOT_ID, 'p0', 'c0', 'p1', 'c1', 'mover']
    const children = new Map<string, string[]>([
      [MAP_ROOT_ID, ['p0', 'p1', 'mover']],
      ['p0', ['c0']],
      ['c0', []],
      ['p1', ['c1']],
      ['c1', []],
      ['mover', []],
    ])
    const actual = makePlaced()
    const ref = makePlaced()
    resolveCollisionsAndCrossings(
      MAP_ROOT_ID,
      order,
      children,
      actual,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    resolveCollisionsAndCrossingsReference(
      MAP_ROOT_ID,
      order,
      children,
      ref,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    expect(Array.from(actual.entries())).toEqual(Array.from(ref.entries()))
  })

  it('matches frozen reference under extreme multi-cell outward subtree push triggering rebuildGrid', () => {
    const capsule = {
      shape: 'capsule' as const,
      displayTitle: 'Wide',
      isTruncated: false,
      labelVisible: true,
      width: 220,
      height: 44,
      radius: null,
      localLabelBox: null,
    }
    const makeExtreme = (): Map<string, PlacedMutableNode> =>
      new Map([
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
            subtreeWeight: 3,
            r: 0,
            theta: 0,
            x: 0,
            y: 0,
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
            subtreeWeight: 1,
            r: 120,
            theta: Math.PI / 2,
            x: 120,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI,
          },
        ],
        [
          'cFar',
          {
            id: 'cFar',
            parentId: 'p',
            depth: 2,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: 4800,
            theta: Math.PI / 2,
            x: 4800,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI,
          },
        ],
        [
          'blocker',
          {
            id: 'blocker',
            parentId: MAP_ROOT_ID,
            depth: 3,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: 180,
            theta: Math.PI / 2,
            x: 180,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI,
          },
        ],
      ])
    const order = [MAP_ROOT_ID, 'p', 'cFar', 'blocker']
    const children = new Map<string, string[]>([
      [MAP_ROOT_ID, ['p', 'blocker']],
      ['p', ['cFar']],
      ['cFar', []],
      ['blocker', []],
    ])
    const actual = makeExtreme()
    const ref = makeExtreme()
    resolveCollisionsAndCrossings(
      MAP_ROOT_ID,
      order,
      children,
      actual,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    resolveCollisionsAndCrossingsReference(
      MAP_ROOT_ID,
      order,
      children,
      ref,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    expect(Array.from(actual.entries())).toEqual(Array.from(ref.entries()))
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

  it('eliminates North/South stagger dead-zone overlaps at initial polar placement via 2D AABB [T3.2f]', () => {
    const nodes: VisibleMapNode[] = [
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root Hub', depth: 0 }),
    ]
    for (let i = 0; i < 24; i += 1) {
      nodes.push(
        makeVisibleNode({
          id: `fan_${String(i).padStart(2, '0')}`,
          parentId: MAP_ROOT_ID,
          title: `Dense Staggered Sibling Topic ${i} Extended`,
          depth: 1,
          order: `a${String(i).padStart(4, '0')}`,
        }),
      )
    }
    const visible = buildSyntheticVisible(nodes)
    const resolution = resolveScreenZoomTier(1, 2, DEFAULT_RADIAL_LAYOUT_CONFIG)
    const prepared = prepareSpecsAndWeights(
      MAP_ROOT_ID,
      visible,
      resolution,
      fixedWidthMeasure(7.5),
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    const { placed, placedPreOrder } = assignInitialPolarNodes(
      MAP_ROOT_ID,
      visible,
      prepared,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    const pass0 = finalizeRadialResult(MAP_ROOT_ID, 1, resolution, placedPreOrder, placed, 0)
    const pass0Geom = computeRadialGeometryDiagnostics(pass0)
    expect(pass0Geom.overlapCount).toBe(0)

    const full = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 2,
    })
    expect(full.diagnostics.collisionPassesUsed).toBeLessThanOrEqual(2)
    assertRadialInvariants(full)
  })

  it('reclaims wasted >255-deg root angular span for siblings when root has >= 3 children and heavy branch has children [T3.2f]', () => {
    const nodes: VisibleMapNode[] = [
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({
        id: 'heavy',
        parentId: MAP_ROOT_ID,
        title: 'Heavy Branch',
        depth: 1,
        order: 'a0',
        isOnFocusPath: true,
      }),
      makeVisibleNode({
        id: 's1',
        parentId: MAP_ROOT_ID,
        title: 'Sibling 1',
        depth: 1,
        order: 'a1',
      }),
      makeVisibleNode({
        id: 's2',
        parentId: MAP_ROOT_ID,
        title: 'Sibling 2',
        depth: 1,
        order: 'a2',
      }),
    ]
    for (let i = 0; i < 16; i += 1) {
      nodes.push(
        makeVisibleNode({
          id: `hc_${i}`,
          parentId: 'heavy',
          title: `Heavy Child ${i}`,
          depth: 2,
          order: `b${String(i).padStart(3, '0')}`,
        }),
      )
    }
    const visible = buildSyntheticVisible(nodes, 'heavy')
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(8),
      scale: 1,
      tier: 1,
    })

    const heavy = layout.nodes.heavy!
    const s1 = layout.nodes.s1!
    const s2 = layout.nodes.s2!
    const heavySpan = heavy.wedgeEnd - heavy.wedgeStart
    const siblingsSpan = s1.wedgeEnd - s1.wedgeStart + (s2.wedgeEnd - s2.wedgeStart)

    expect(heavySpan).toBeCloseTo(DEFAULT_RADIAL_LAYOUT_CONFIG.maxNonRootFanRadians, 5)
    expect(siblingsSpan).toBeCloseTo(
      Math.PI * 2 - DEFAULT_RADIAL_LAYOUT_CONFIG.maxNonRootFanRadians,
      5,
    )
    // True bottom-up subtreeWeight on the node itself remains unmodified
    expect(heavy.subtreeWeight).toBeGreaterThan(16)
    assertRadialInvariants(layout)
  })

  it('resolves multiple independent dense sibling fans in parallel via analytical deltaR jumps [T3.2f]', () => {
    const nodes: VisibleMapNode[] = [
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
    ]
    for (let f = 0; f < 6; f += 1) {
      const fId = `fan_${f}`
      nodes.push(
        makeVisibleNode({
          id: fId,
          parentId: MAP_ROOT_ID,
          title: `Branch Fan ${f}`,
          depth: 1,
          order: `a${String(f).padStart(2, '0')}`,
        }),
      )
      for (let c = 0; c < 24; c += 1) {
        nodes.push(
          makeVisibleNode({
            id: `gc_${f}_${c}`,
            parentId: fId,
            title: `Grandchild ${f}-${c} Extended Label`,
            depth: 2,
            order: `b${String(c).padStart(3, '0')}`,
          }),
        )
      }
    }
    const visible = buildSyntheticVisible(nodes)
    const layout = computeRadialLayout({
      visible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 2,
    })
    expect(layout.diagnostics.collisionPassesUsed).toBeLessThanOrEqual(6)
    assertRadialInvariants(layout)
  })

  it('clears a North dead-zone staggered sibling overlap in <= 5 passes analytically (vs ~141 baseline) and matches reference [T3.2f]', () => {
    const capsule = {
      shape: 'capsule' as const,
      displayTitle: 'DeadZone Sibling',
      isTruncated: false,
      labelVisible: true,
      width: 240,
      height: 44,
      radius: null,
      localLabelBox: null,
    }
    const makeDeadZone = (): Map<string, PlacedMutableNode> => {
      const rA = 2200
      const tA = 0.02
      const rB = 2256
      const tB = 0.045
      return new Map([
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
            subtreeWeight: 2,
            r: 0,
            theta: 0,
            x: 0,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI * 2,
          },
        ],
        [
          'sibA',
          {
            id: 'sibA',
            parentId: MAP_ROOT_ID,
            depth: 1,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 2,
            staggerIndex: 0,
            subtreeWeight: 1,
            r: rA,
            theta: tA,
            x: rA * Math.sin(tA),
            y: -rA * Math.cos(tA),
            wedgeStart: 0.01,
            wedgeEnd: 0.03,
          },
        ],
        [
          'sibB',
          {
            id: 'sibB',
            parentId: MAP_ROOT_ID,
            depth: 1,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 2,
            staggerIndex: 1,
            subtreeWeight: 1,
            r: rB,
            theta: tB,
            x: rB * Math.sin(tB),
            y: -rB * Math.cos(tB),
            wedgeStart: 0.03,
            wedgeEnd: 0.06,
          },
        ],
      ])
    }
    const order = [MAP_ROOT_ID, 'sibA', 'sibB']
    const children = new Map<string, string[]>([
      [MAP_ROOT_ID, ['sibA', 'sibB']],
      ['sibA', []],
      ['sibB', []],
    ])
    const actual = makeDeadZone()
    const ref = makeDeadZone()
    const actualPasses = resolveCollisionsAndCrossings(
      MAP_ROOT_ID,
      order,
      children,
      actual,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    const refPasses = resolveCollisionsAndCrossingsReference(
      MAP_ROOT_ID,
      order,
      children,
      ref,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    // Needs ~7,880 px radial expansion (~141 passes with +56px baseline); clamped analytical jump
    // (<= 64 * stepR per pass) clears cleanly in 4 passes and matches O(n^2) reference bit-for-bit.
    expect(actualPasses).toBeLessThanOrEqual(5)
    expect(actualPasses).toBe(refPasses)
    expect(Array.from(actual.entries())).toEqual(Array.from(ref.entries()))
  })

  it('resolves overlaps across multiple unrelated parent groups in the same pass without cross-parent break [T3.2f]', () => {
    const capsule = {
      shape: 'capsule' as const,
      displayTitle: 'Parallel Sibling',
      isTruncated: false,
      labelVisible: true,
      width: 200,
      height: 44,
      radius: null,
      localLabelBox: null,
    }
    const baseAngles = [-0.55, 0.55, Math.PI - 0.55, Math.PI + 0.55]
    const buildMultiParentOverlaps = (): {
      placed: Map<string, PlacedMutableNode>
      order: string[]
      children: Map<string, string[]>
    } => {
      const placed = new Map<string, PlacedMutableNode>([
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
            subtreeWeight: 8,
            r: 0,
            theta: 0,
            x: 0,
            y: 0,
            wedgeStart: 0,
            wedgeEnd: Math.PI * 2,
          },
        ],
      ])
      const order: string[] = [MAP_ROOT_ID]
      const children = new Map<string, string[]>([[MAP_ROOT_ID, []]])

      baseAngles.forEach((base, k) => {
        const pId = `p_${k}`
        const pR = 600
        placed.set(pId, {
          id: pId,
          parentId: MAP_ROOT_ID,
          depth: 1,
          kind: 'node',
          spec: capsule,
          staggerRingCount: 1,
          staggerIndex: 0,
          subtreeWeight: 2,
          r: pR,
          theta: base,
          x: pR * Math.sin(base),
          y: -pR * Math.cos(base),
          wedgeStart: base - 0.1,
          wedgeEnd: base + 0.1,
        })
        order.push(pId)
        children.get(MAP_ROOT_ID)!.push(pId)
        children.set(pId, [])
      })

      baseAngles.forEach((base, k) => {
        const pId = `p_${k}`
        const specs: ReadonlyArray<readonly [string, number, number]> = [
          [`c_${k}_0`, 1200, base - 0.025],
          [`c_${k}_1`, 1200, base + 0.025],
        ]
        for (const [cId, r, theta] of specs) {
          placed.set(cId, {
            id: cId,
            parentId: pId,
            depth: 2,
            kind: 'node',
            spec: capsule,
            staggerRingCount: 1,
            staggerIndex: 0,
            subtreeWeight: 1,
            r,
            theta,
            x: r * Math.sin(theta),
            y: -r * Math.cos(theta),
            wedgeStart: theta - 0.02,
            wedgeEnd: theta + 0.02,
          })
          order.push(cId)
          children.get(pId)!.push(cId)
          children.set(cId, [])
        }
      })

      return { placed, order, children }
    }

    const actualSetup = buildMultiParentOverlaps()
    const refSetup = buildMultiParentOverlaps()
    const actualPasses = resolveCollisionsAndCrossings(
      MAP_ROOT_ID,
      actualSetup.order,
      actualSetup.children,
      actualSetup.placed,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )
    const refPasses = resolveCollisionsAndCrossingsReference(
      MAP_ROOT_ID,
      refSetup.order,
      refSetup.children,
      refSetup.placed,
      DEFAULT_RADIAL_LAYOUT_CONFIG,
    )

    // Parallel multi-parent sweep resolves all 4 independent sibling groups in pass 0 (2 passes
    // total including clean verification pass); serialized `if (adjusted) break` would take 5.
    expect(actualPasses).toBeLessThanOrEqual(2)
    expect(actualPasses).toBe(refPasses)
    expect(Array.from(actualSetup.placed.entries())).toEqual(Array.from(refSetup.placed.entries()))
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

  it('enforces deterministic spatial-grid pair-check bounds in CI without wall-clock (reports pass exhaustion and geometry)', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const measure = fixedWidthMeasure(7.5)
    // Note: `stats.allocations` is an unincremented counter stub (`0`), NOT a V8 heap allocation measurement.
    // `resolveCollisionsAndCrossings` allocates typed arrays and grid buckets at setup / `rebuildGrid`,
    // while keeping per-edge ray clipping and segment-box checks free of temporary `{}` objects.
    const runWithStats = (visible: ComputeVisibleResult, tier: 0 | 1 | 2) => {
      const stats: CollisionStats = {
        passesUsed: 0,
        overlapChecks: 0,
        edgeCrossChecks: 0,
        allocations: 0,
      }
      const layout = computeRadialLayout({ visible, measureText: measure, scale: 1, tier, stats })
      return { stats, layout }
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
    const { stats: largeDeepStats } = runWithStats(largeDeepVisible, 2)
    expect(largeDeepStats.overlapChecks).toBeLessThanOrEqual(2_000)
    expect(largeDeepStats.edgeCrossChecks).toBeLessThanOrEqual(8_000)

    const scalingProfile = [50, 100, 200, 300].map((count) => {
      const vis = buildWorstCaseVisible(count)
      const { stats: st } = runWithStats(vis, 2)
      return { n: vis.orderedIds.length, ...st }
    })
    console.info(
      `[T3_2C_OPT_SCALING] ${JSON.stringify({ largeDeep: largeDeepStats, scaling: scalingProfile })}`,
    )

    const worstStats = scalingProfile[scalingProfile.length - 1]!
    expect(worstStats.n).toBe(300)
    // T3.2f Opsi B: multi-parent parallel sweep converges cleanly in 11 passes (~16.2k overlap checks,
    // ~13.2k edge-crossing checks) vs baseline's unconverged early-break 36-pass artifact (36 overlap,
    // 35.4k edge checks, 17 unresolved overlaps).
    expect(worstStats.passesUsed).toBeLessThanOrEqual(16)
    expect(worstStats.overlapChecks).toBeLessThanOrEqual(22_000)
    expect(worstStats.edgeCrossChecks).toBeLessThanOrEqual(20_000)

    const passReport: {
      dataset: string
      focus: string
      tier: number
      passesUsed: number
      hitMaxPasses: boolean
      overlapCount: number
      edgeCrossingsCount: number
    }[] = []
    for (const ds of Object.values(createMandatoryDatasets())) {
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
      let maxCh = 0
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxCh) {
          maxCh = n.childrenIds.length
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
        for (const [scale, tier] of [[1, 1] as const, [1, 2] as const, [0.85, 0] as const]) {
          const vis = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId,
            zoomTier: tier,
          })
          const { stats: st, layout } = (() => {
            const s: CollisionStats = {
              passesUsed: 0,
              overlapChecks: 0,
              edgeCrossChecks: 0,
              allocations: 0,
            }
            const l = computeRadialLayout({
              visible: vis,
              measureText: measure,
              scale,
              tier,
              stats: s,
            })
            return { stats: s, layout: l }
          })()
          const geom = computeRadialGeometryDiagnostics(layout)
          passReport.push({
            dataset: ds.id,
            focus: focusKind,
            tier,
            passesUsed: st.passesUsed,
            hitMaxPasses: st.passesUsed >= DEFAULT_RADIAL_LAYOUT_CONFIG.maxCollisionPasses,
            overlapCount: geom.overlapCount,
            edgeCrossingsCount: geom.edgeCrossingsCount,
          })
        }
      }
    }
    const worstDiag = computeRadialGeometryDiagnostics(
      runWithStats(buildWorstCaseVisible(300), 2).layout,
    )
    passReport.push({
      dataset: 'worstCase300',
      focus: 'root',
      tier: 2,
      passesUsed: worstStats.passesUsed,
      hitMaxPasses: worstStats.passesUsed >= DEFAULT_RADIAL_LAYOUT_CONFIG.maxCollisionPasses,
      overlapCount: worstDiag.overlapCount,
      edgeCrossingsCount: worstDiag.edgeCrossingsCount,
    })
    console.info(`[T3_2D_PASS_REPORT] ${JSON.stringify(passReport)}`)
    for (const entry of passReport) {
      expect(
        entry.hitMaxPasses,
        `${entry.dataset}:${entry.focus}:t${entry.tier} hitMaxPasses`,
      ).toBe(false)
      expect(entry.overlapCount, `${entry.dataset}:${entry.focus}:t${entry.tier} overlaps`).toBe(0)
      expect(
        entry.edgeCrossingsCount,
        `${entry.dataset}:${entry.focus}:t${entry.tier} edgeCrossings`,
      ).toBe(0)
    }
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
