import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeRadialGeometryDiagnostics,
  computeRadialLayout,
  computeVisible,
  resolveScreenZoomTier,
  type ComputeVisibleResult,
  type TextMeasurerFn,
} from '@/domain/layout'
import { resolveCollisionsAndCrossings } from '@/domain/layout/collision'
import { finalizeRadialResult } from '@/domain/layout/radial-layout'
import { assignInitialPolarNodes } from '@/domain/layout/rings'
import { prepareSpecsAndWeights } from '@/domain/layout/weights'
import { buildTree, type TreeBuildEntry, type TreeState } from '@/domain/tree'

const PASS_BUDGETS = [36, 72, 144, 400] as const

const measure75: TextMeasurerFn = (text) => text.length * 7.5

function makeEntry(
  id: string,
  parentPath: string | null,
  title: string,
  seq: number,
): TreeBuildEntry {
  const path = parentPath ? `${parentPath}/${id}` : id
  return {
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
  }
}

function buildWorstCase300Tree(): { tree: TreeState; focusId: string } {
  const entries: TreeBuildEntry[] = []
  let seq = 0
  let parentPath: string | null = null
  for (let d = 0; d < 6; d += 1) {
    const chainId = `chain_${d}`
    const e = makeEntry(chainId, parentPath, `Hierarchy Backbone Concept ${d} Long`, ++seq)
    entries.push(e)
    for (let s = 0; s < 24; s += 1) {
      entries.push(
        makeEntry(`sib_${d}_${s}`, parentPath, `Ancestor Sibling Branch ${d}-${s} Expanded`, ++seq),
      )
    }
    parentPath = e.path
  }
  for (let c = 0; c < 24; c += 1) {
    const cEntry = makeEntry(
      `fc_${c}`,
      parentPath,
      `Primary Focus Child ${c} Extended Label`,
      ++seq,
    )
    entries.push(cEntry)
    for (let g = 0; g < 6; g += 1) {
      entries.push(
        makeEntry(`fg_${c}_${g}`, cEntry.path, `Grandchild Detail Item ${c}-${g} Label`, ++seq),
      )
    }
  }
  return { tree: buildTree(entries).state, focusId: 'chain_5' }
}

function buildWideFan300Tree(): { tree: TreeState; focusId: string } {
  const entries: TreeBuildEntry[] = []
  for (let i = 0; i < 299; i += 1) {
    entries.push(makeEntry(`fan_${i}`, null, `Wide Fan Topic ${i} Extended`, i + 1))
  }
  return { tree: buildTree(entries).state, focusId: MAP_ROOT_ID }
}

function buildFans12x24Tree(): { tree: TreeState; focusId: string; fanIds: string[] } {
  const entries: TreeBuildEntry[] = []
  const fanIds: string[] = []
  let seq = 0
  for (let f = 0; f < 12; f += 1) {
    const fId = `fan_${f}`
    fanIds.push(fId)
    const fEntry = makeEntry(fId, null, `Top Branch Fan ${f} Title`, ++seq)
    entries.push(fEntry)
    for (let c = 0; c < 24; c += 1) {
      entries.push(makeEntry(`gc_${f}_${c}`, fEntry.path, `Sub Branch Item ${f}-${c}`, ++seq))
    }
  }
  return { tree: buildTree(entries).state, focusId: MAP_ROOT_ID, fanIds }
}

function buildDeepChainPlusFanTree(): { tree: TreeState; focusId: string } {
  const entries: TreeBuildEntry[] = []
  let seq = 0
  let parentPath: string | null = null
  for (let d = 0; d < 10; d += 1) {
    const id = `deep_${d}`
    const e = makeEntry(id, parentPath, `Deep Backbone Level ${d} Node`, ++seq)
    entries.push(e)
    for (let s = 0; s < 24; s += 1) {
      entries.push(makeEntry(`dsib_${d}_${s}`, parentPath, `Deep Sibling ${d}-${s} Label`, ++seq))
    }
    parentPath = e.path
  }
  for (let c = 0; c < 24; c += 1) {
    const cEntry = makeEntry(`dfc_${c}`, parentPath, `Deep Focus Child ${c} Label`, ++seq)
    entries.push(cEntry)
    for (let g = 0; g < 6; g += 1) {
      entries.push(makeEntry(`dfg_${c}_${g}`, cEntry.path, `Deep Grandchild ${c}-${g}`, ++seq))
    }
  }
  return { tree: buildTree(entries).state, focusId: 'deep_9' }
}

function buildRandomSeededTree(seed = 20261122): {
  tree: TreeState
  focusId: string
  allIds: string[]
} {
  let state = seed >>> 0
  const nextRand = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const entries: TreeBuildEntry[] = []
  const paths: Array<{ id: string; path: string; depth: number }> = []
  let seq = 0
  for (let r = 0; r < 24; r += 1) {
    const id = `r_${r}`
    const e = makeEntry(id, null, `Random Root Topic ${r}`, ++seq)
    entries.push(e)
    paths.push({ id, path: e.path, depth: 1 })
  }
  for (let i = 0; i < 650; i += 1) {
    const parent = paths[Math.floor(nextRand() * paths.length)]!
    const id = `rn_${i}`
    const e = makeEntry(id, parent.path, `Random Node ${i} Detail`, ++seq)
    entries.push(e)
    paths.push({ id, path: e.path, depth: parent.depth + 1 })
  }
  const tree = buildTree(entries).state
  // Pick the deepest node that has children (maximizes default visible footprint)
  let bestFocus = paths[0]!.id
  let bestScore = -1
  for (const p of paths) {
    const cCount = tree.nodes[p.id]?.childrenIds.length ?? 0
    const score = p.depth * 10 + Math.min(24, cCount)
    if (score > bestScore) {
      bestScore = score
      bestFocus = p.id
    }
  }
  return { tree, focusId: bestFocus, allIds: paths.map((p) => p.id) }
}

function positionKey(
  orderedIds: readonly string[],
  nodes: Readonly<Record<string, { x: number; y: number; r: number }>>,
): string {
  return orderedIds
    .map((id) => {
      const n = nodes[id]!
      return `${id}:${n.x.toFixed(4)},${n.y.toFixed(4)},${n.r.toFixed(4)}`
    })
    .join('|')
}

/** Deterministic synchronous 64-bit FNV-1a hex hash of exact node positions per pass. */
function hashPositionsSync(payload: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x9e3779b9
  for (let i = 0; i < payload.length; i += 1) {
    const ch = payload.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 0x01000193)
    h2 = Math.imul(h2 ^ ((ch + i) & 0xff), 0x01000193)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

interface PassSample {
  pass: number
  overlapCount: number
  edgeCrossingsCount: number
  maxRadiusPx: number
}

interface ScenarioReport {
  scenario: string
  reachableByDefaultComputeVisible: boolean
  defaultVisibleCount: number
  testedVisibleCount: number
  budgets: Array<{
    maxCollisionPasses: number
    passesUsed: number
    hitMaxPasses: boolean
    overlapCount: number
    edgeCrossingsCount: number
    maxRadiusPx: number
  }>
  cycleDetected: boolean
  cycleAtPasses: [number, number] | null
  steppedMatchesBudget400: boolean
  perPassTrend: PassSample[]
}

function positionKeyFromMap(
  orderedIds: readonly string[],
  placed: ReadonlyMap<string, { x: number; y: number; r: number }>,
): string {
  return orderedIds
    .map((id) => {
      const n = placed.get(id)!
      return `${id}:${n.x.toFixed(4)},${n.y.toFixed(4)},${n.r.toFixed(4)}`
    })
    .join('|')
}

function investigateScenario(
  scenario: string,
  visible: ComputeVisibleResult,
  reachableByDefaultComputeVisible: boolean,
  defaultVisibleCount: number,
): ScenarioReport {
  let direct400Key = ''
  const budgets = PASS_BUDGETS.map((maxCollisionPasses) => {
    const layout = computeRadialLayout({
      visible,
      measureText: measure75,
      scale: 1,
      tier: 2,
      config: { maxCollisionPasses },
    })
    if (maxCollisionPasses === 400) {
      direct400Key = hashPositionsSync(positionKey(layout.orderedIds, layout.nodes))
    }
    const geom = computeRadialGeometryDiagnostics(layout)
    let maxRadiusPx = 0
    for (const id of layout.orderedIds) {
      maxRadiusPx = Math.max(maxRadiusPx, layout.nodes[id]!.r)
    }
    return {
      maxCollisionPasses,
      passesUsed: layout.diagnostics.collisionPassesUsed,
      hitMaxPasses:
        layout.diagnostics.collisionPassesUsed === maxCollisionPasses &&
        (geom.overlapCount > 0 || geom.edgeCrossingsCount > 0),
      overlapCount: geom.overlapCount,
      edgeCrossingsCount: geom.edgeCrossingsCount,
      maxRadiusPx: Math.round(maxRadiusPx),
    }
  })

  // Step 1 pass at a time on placed nodes up to 400 passes for exact per-pass trend & cycle detection
  const resolution = resolveScreenZoomTier(1, 2, DEFAULT_RADIAL_LAYOUT_CONFIG)
  const rootId = visible.nodes[visible.rootId] ? visible.rootId : MAP_ROOT_ID
  const prepared = prepareSpecsAndWeights(
    rootId,
    visible,
    resolution,
    measure75,
    DEFAULT_RADIAL_LAYOUT_CONFIG,
  )
  const { placed, placedPreOrder } = assignInitialPolarNodes(
    rootId,
    visible,
    prepared,
    DEFAULT_RADIAL_LAYOUT_CONFIG,
  )
  const singlePassConfig = { ...DEFAULT_RADIAL_LAYOUT_CONFIG, maxCollisionPasses: 1 }

  const seenHashes = new Map<string, number>()
  let cycleDetected = false
  let cycleAtPasses: [number, number] | null = null
  const perPassTrend: PassSample[] = []
  const samplePasses = new Set([
    0, 1, 2, 5, 10, 18, 24, 30, 36, 48, 60, 72, 100, 144, 200, 280, 400,
  ])

  const recordPass = (passNum: number, hash: string, checkCycle: boolean) => {
    if (checkCycle) {
      const prevPass = seenHashes.get(hash)
      if (prevPass !== undefined && !cycleDetected) {
        cycleDetected = true
        cycleAtPasses = [prevPass, passNum]
      } else if (prevPass === undefined) {
        seenHashes.set(hash, passNum)
      }
    }
    if (samplePasses.has(passNum)) {
      const snap = finalizeRadialResult(rootId, 1, resolution, placedPreOrder, placed, passNum)
      const geom = computeRadialGeometryDiagnostics(snap)
      let maxRadiusPx = 0
      for (const id of snap.orderedIds) maxRadiusPx = Math.max(maxRadiusPx, snap.nodes[id]!.r)
      perPassTrend.push({
        pass: passNum,
        overlapCount: geom.overlapCount,
        edgeCrossingsCount: geom.edgeCrossingsCount,
        maxRadiusPx: Math.round(maxRadiusPx),
      })
    }
  }

  let currentHash = hashPositionsSync(positionKeyFromMap(placedPreOrder, placed))
  recordPass(0, currentHash, true)
  for (let p = 1; p <= 400; p += 1) {
    resolveCollisionsAndCrossings(
      rootId,
      placedPreOrder,
      prepared.childrenMap,
      placed,
      singlePassConfig,
    )
    const afterHash = hashPositionsSync(positionKeyFromMap(placedPreOrder, placed))
    if (afterHash === currentHash) {
      if (!samplePasses.has(p - 1)) {
        samplePasses.add(p - 1)
        recordPass(p - 1, afterHash, false)
      }
      break
    }
    currentHash = afterHash
    recordPass(p, afterHash, true)
  }

  const steppedMatchesBudget400 = currentHash === direct400Key

  return {
    scenario,
    reachableByDefaultComputeVisible,
    defaultVisibleCount,
    testedVisibleCount: visible.orderedIds.length,
    budgets,
    cycleDetected,
    cycleAtPasses,
    steppedMatchesBudget400,
    perPassTrend,
  }
}

describe('T3.2f worstCase300 & 300-node radial collision convergence (FR-MAP-03)', () => {
  it('converges worstCase300 and all 300-node shapes within default maxCollisionPasses = 36 with 0 overlaps and 0 edge crossings', () => {
    const reports: ScenarioReport[] = []

    // 0. worstCase300 (strictly default computeVisible!)
    const wc = buildWorstCase300Tree()
    const wcDefault = computeVisible({
      tree: wc.tree,
      rootTitle: 'Worst Case 300 Root',
      focusId: wc.focusId,
      zoomTier: 2,
    })
    reports.push(
      investigateScenario('worstCase300_default', wcDefault, true, wcDefault.orderedIds.length),
    )

    // 1. One wide fan (299 children under root): check default vs expanded overflow
    const wf = buildWideFan300Tree()
    const wfDefault = computeVisible({
      tree: wf.tree,
      rootTitle: 'Wide Fan 300 Root',
      focusId: wf.focusId,
      zoomTier: 2,
    })
    const wfExpanded300 = computeVisible({
      tree: wf.tree,
      rootTitle: 'Wide Fan 300 Root',
      focusId: wf.focusId,
      zoomTier: 2,
      expandedOverflowParentIds: new Set([MAP_ROOT_ID]),
    })
    reports.push(
      investigateScenario('wideFan300_default', wfDefault, true, wfDefault.orderedIds.length),
    )
    reports.push(
      investigateScenario(
        'wideFan300_expandedOverflow',
        wfExpanded300,
        false,
        wfDefault.orderedIds.length,
      ),
    )

    // 2. 12 fans x 24 grandchildren: check default vs all-12 pinned
    const f12 = buildFans12x24Tree()
    const f12Default = computeVisible({
      tree: f12.tree,
      rootTitle: 'Fans 12x24 Root',
      focusId: f12.focusId,
      zoomTier: 2,
    })
    const f12Pinned300 = computeVisible({
      tree: f12.tree,
      rootTitle: 'Fans 12x24 Root',
      focusId: f12.focusId,
      zoomTier: 2,
      pinnedIds: new Set(f12.fanIds),
    })
    reports.push(
      investigateScenario('fans12x24_default', f12Default, true, f12Default.orderedIds.length),
    )
    reports.push(
      investigateScenario('fans12x24_pinned300', f12Pinned300, false, f12Default.orderedIds.length),
    )

    // 3. Deep chain (depth 10) + 24 siblings per level + focus children/grandchildren (default!)
    const dc = buildDeepChainPlusFanTree()
    const dcDefault = computeVisible({
      tree: dc.tree,
      rootTitle: 'Deep Chain + Fan Root',
      focusId: dc.focusId,
      zoomTier: 2,
    })
    reports.push(
      investigateScenario('deepChainPlusFan_default', dcDefault, true, dcDefault.orderedIds.length),
    )

    // 4. Random seeded tree: default computeVisible AND pinned-to-300 variant
    const rnd = buildRandomSeededTree(20261122)
    const rndDefault = computeVisible({
      tree: rnd.tree,
      rootTitle: 'Random Seeded Root',
      focusId: rnd.focusId,
      zoomTier: 2,
    })
    const rndPinned300 = computeVisible({
      tree: rnd.tree,
      rootTitle: 'Random Seeded Root',
      focusId: rnd.focusId,
      zoomTier: 2,
      pinnedIds: new Set(rnd.allIds),
    })
    reports.push(
      investigateScenario('random300_default', rndDefault, true, rndDefault.orderedIds.length),
    )
    reports.push(
      investigateScenario('random300_pinned', rndPinned300, false, rndDefault.orderedIds.length),
    )

    console.info(`[T3_2F_REPORT] ${JSON.stringify(reports, null, 2)}`)

    // T3.2f convergence guarantee: every 300-node scenario must converge within default 36 passes
    expect(reports).toHaveLength(8)
    for (const r of reports) {
      expect(r.steppedMatchesBudget400, `${r.scenario} stepped vs direct 400`).toBe(true)
      expect(r.cycleDetected, `${r.scenario} cycle detected`).toBe(false)
      const b36 = r.budgets[0]!
      expect(b36.maxCollisionPasses).toBe(DEFAULT_RADIAL_LAYOUT_CONFIG.maxCollisionPasses)
      expect(b36.overlapCount, `${r.scenario} overlaps @36 passes`).toBe(0)
      expect(b36.edgeCrossingsCount, `${r.scenario} edge crossings @36 passes`).toBe(0)
      expect(b36.hitMaxPasses, `${r.scenario} hit maxCollisionPasses=36`).toBe(false)
      expect(b36.passesUsed, `${r.scenario} passesUsed`).toBeLessThanOrEqual(
        DEFAULT_RADIAL_LAYOUT_CONFIG.maxCollisionPasses,
      )
    }

    const byScenario = new Map(reports.map((r) => [r.scenario, r]))
    expect(byScenario.get('worstCase300_default')!.budgets[0]!.maxRadiusPx).toBeLessThanOrEqual(
      22_000,
    )
    expect(byScenario.get('deepChainPlusFan_default')!.budgets[0]!.maxRadiusPx).toBeLessThanOrEqual(
      26_000,
    )

    expect(wcDefault.orderedIds.length).toBe(300)
    expect(wfDefault.orderedIds.length).toBe(26)
    expect(wfExpanded300.orderedIds.length).toBe(300)
    expect(f12Default.orderedIds.length).toBe(97)
    expect(f12Pinned300.orderedIds.length).toBe(300)
    expect(dcDefault.orderedIds.length).toBe(300)
    expect(rndPinned300.orderedIds.length).toBe(300)
  }, 30_000)
})
