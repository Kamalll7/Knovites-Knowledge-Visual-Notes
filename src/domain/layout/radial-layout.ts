import { compareSiblings } from '@/domain/tree'

import {
  MAP_ROOT_ID,
  type ComputeVisibleResult,
  type VisibleMapNode,
  type ZoomTier,
} from './compute-visible'

/**
 * Injected text measurement contract for pure domain layout computation.
 * Returns rendered width in logical pixels for a single line of `text` in `font`.
 */
export type TextMeasurerFn = (text: string, font: string) => number

export interface RadialFontSpec {
  readonly family: string
  readonly tier0LabelPx: number
  readonly tier1Px: number
  readonly tier2Px: number
  readonly badgePx: number
  readonly weight: number
}

/**
 * Single centralized configuration for M3 radial layout geometry and typography.
 * Every threshold records its design origin (`spec-map.md` or `docs/spikes/s3-radial.md`).
 */
export interface RadialLayoutConfig {
  /** FR-MAP-09 / S3: minimum adaptive capsule width (px). */
  readonly capsuleMinWidthPx: number
  /** FR-MAP-09 / S3: maximum adaptive capsule width (px). */
  readonly capsuleMaxWidthPx: number
  /** FR-MAP-09 / S3: capsule height in zoom tier 1 (px). */
  readonly capsuleTier1HeightPx: number
  /** FR-MAP-09 / S3: capsule height in zoom tier 2 (px). */
  readonly capsuleTier2HeightPx: number
  /** S3: horizontal padding + status indicator budget inside a capsule (px). */
  readonly capsulePaddingXPx: number
  /** S3: extra width reserved for trailing `· N` hidden-child count (px). */
  readonly capsuleMetaWidthPx: number
  /** S3: virtual/root hub circle radius within 38–56 px range. */
  readonly rootRadiusPx: number
  /** S3: minimum tier 0 circle radius (px). */
  readonly tier0CircleMinRadiusPx: number
  /** S3: maximum tier 0 circle radius (px). */
  readonly tier0CircleMaxRadiusPx: number
  /** S3: gap between tier 0 circle edge and its external label box (px). */
  readonly tier0LabelOffsetPx: number
  /** spec-map.md FR-MAP-03: strict minimum node-to-node gap (px). */
  readonly minGapPx: number
  /** S3: baseline concentric radial distance between rings (px). */
  readonly ringBaseGapPx: number
  /** S3: incremental radial growth per tree depth level (px). */
  readonly ringDepthStepPx: number
  /** S3: sibling count >= 12 engages 2 staggered sub-rings. */
  readonly staggerThreshold2: number
  /** S3: sibling count >= 34 engages 3 staggered sub-rings. */
  readonly staggerThreshold3: number
  /** S3: radial spacing between staggered sibling sub-rings (px). */
  readonly staggerRadialStepPx: number
  /** S3: 255° fan cap on non-root parents to prevent angular wrap-back overlaps. */
  readonly maxNonRootFanRadians: number
  /** S3: extra angular weight added along the active focus path. */
  readonly focusPathWeightBoost: number
  /** S3: hidden descendant angular boost coefficient: 0.35 * log2(1 + hiddenCount). */
  readonly hiddenWeightCoeff: number
  /** Syarat M3: minimum effective on-screen font size (px) for visible labels. */
  readonly minScreenFontPx: number
  /** S3: viewport scale below this threshold resolves to zoom tier 0. */
  readonly tier0ScaleThreshold: number
  /** S3: viewport scale at or above this threshold resolves to zoom tier 2. */
  readonly tier2ScaleThreshold: number
  /** Bounded pass count for deterministic radial overlap resolution. */
  readonly maxCollisionPasses: number
  readonly fonts: RadialFontSpec
}

export const DEFAULT_RADIAL_LAYOUT_CONFIG: RadialLayoutConfig = {
  capsuleMinWidthPx: 118,
  capsuleMaxWidthPx: 268,
  capsuleTier1HeightPx: 40,
  capsuleTier2HeightPx: 44,
  capsulePaddingXPx: 24,
  capsuleMetaWidthPx: 26,
  rootRadiusPx: 52,
  tier0CircleMinRadiusPx: 38,
  tier0CircleMaxRadiusPx: 56,
  tier0LabelOffsetPx: 8,
  minGapPx: 12,
  ringBaseGapPx: 88,
  ringDepthStepPx: 18,
  staggerThreshold2: 12,
  staggerThreshold3: 34,
  staggerRadialStepPx: 56,
  maxNonRootFanRadians: (255 * Math.PI) / 180,
  focusPathWeightBoost: 2.5,
  hiddenWeightCoeff: 0.35,
  minScreenFontPx: 11,
  tier0ScaleThreshold: 0.45,
  tier2ScaleThreshold: 0.8,
  maxCollisionPasses: 36,
  fonts: {
    family: 'Inter, system-ui, sans-serif',
    tier0LabelPx: 14,
    tier1Px: 13,
    tier2Px: 14,
    badgePx: 11,
    weight: 500,
  },
}

export interface ScreenTierResolution {
  readonly tier: ZoomTier
  readonly labelVisible: boolean
  readonly modelFontPx: number
  readonly effectiveFontPx: number
}

export interface RadialLayoutInput {
  readonly visible: ComputeVisibleResult
  readonly measureText: TextMeasurerFn
  /** Viewport scale factor (`screenPx / modelPx`). Defaults to `1`. */
  readonly scale?: number
  /** Optional requested tier; downgraded if effective on-screen font `< 11 px`. */
  readonly tier?: ZoomTier
  readonly config?: Partial<RadialLayoutConfig>
}

export interface BoxBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RadialLayoutNode {
  readonly id: string
  readonly parentId: string | null
  readonly depth: number
  readonly kind: VisibleMapNode['kind']
  readonly shape: 'circle' | 'capsule'
  readonly tier: ZoomTier
  readonly displayTitle: string
  readonly isTruncated: boolean
  readonly labelVisible: boolean
  readonly modelFontPx: number
  readonly effectiveFontPx: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly radius: number | null
  readonly labelBox: BoxBounds | null
  readonly r: number
  readonly theta: number
  readonly wedgeStart: number
  readonly wedgeEnd: number
  readonly staggerRingCount: 1 | 2 | 3
  readonly staggerIndex: number
  readonly subtreeWeight: number
}

export interface RadialLayoutEdge {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
}

export interface RadialLayoutDiagnostics {
  readonly nodeCount: number
  readonly edgeCount: number
  readonly overlapCount: number
  readonly edgeCrossingsCount: number
  readonly truncatedCount: number
  readonly hiddenLabelCount: number
  readonly minEffectiveFontPx: number
  readonly collisionPassesUsed: number
}

export interface RadialLayoutResult {
  readonly rootId: string
  readonly tier: ZoomTier
  readonly scale: number
  readonly nodes: Readonly<Record<string, RadialLayoutNode>>
  readonly orderedIds: readonly string[]
  readonly edges: readonly RadialLayoutEdge[]
  readonly diagnostics: RadialLayoutDiagnostics
}

/** Formats a CSS-compatible font string passed to `TextMeasurerFn`. */
export function formatLayoutFont(px: number, fonts: RadialFontSpec): string {
  return `${fonts.weight} ${px}px ${fonts.family}`
}

/**
 * Resolves the zoom tier and on-screen font legibility gate (`>= minScreenFontPx`).
 * Tier 1/2 downgrade to Tier 0 if zoomed out below 11 px; Tier 0 hides external labels
 * below 11 px so no rendered label violates legibility.
 */
export function resolveScreenZoomTier(
  scale: number,
  requestedTier: ZoomTier | undefined,
  config: RadialLayoutConfig = DEFAULT_RADIAL_LAYOUT_CONFIG,
): ScreenTierResolution {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const initialTier: ZoomTier =
    requestedTier ??
    (safeScale < config.tier0ScaleThreshold ? 0 : safeScale >= config.tier2ScaleThreshold ? 2 : 1)

  const modelPxForTier = (t: ZoomTier): number =>
    t === 2 ? config.fonts.tier2Px : t === 1 ? config.fonts.tier1Px : config.fonts.tier0LabelPx

  if (initialTier > 0) {
    const px = modelPxForTier(initialTier)
    const effective = px * safeScale
    if (effective >= config.minScreenFontPx) {
      return {
        tier: initialTier,
        labelVisible: true,
        modelFontPx: px,
        effectiveFontPx: effective,
      }
    }
  }

  const tier0Px = modelPxForTier(0)
  const tier0Effective = tier0Px * safeScale
  const labelVisible = tier0Effective >= config.minScreenFontPx
  return {
    tier: 0,
    labelVisible,
    modelFontPx: tier0Px,
    effectiveFontPx: labelVisible ? tier0Effective : 0,
  }
}

function mergeConfig(partial?: Partial<RadialLayoutConfig>): RadialLayoutConfig {
  if (!partial) return DEFAULT_RADIAL_LAYOUT_CONFIG
  return {
    ...DEFAULT_RADIAL_LAYOUT_CONFIG,
    ...partial,
    fonts: partial.fonts
      ? { ...DEFAULT_RADIAL_LAYOUT_CONFIG.fonts, ...partial.fonts }
      : DEFAULT_RADIAL_LAYOUT_CONFIG.fonts,
  }
}

function truncateEndToWidth(
  title: string,
  maxTextWidth: number,
  font: string,
  measureText: TextMeasurerFn,
): { readonly text: string; readonly measuredWidth: number; readonly truncated: boolean } {
  const clean = title.trim().length > 0 ? title.trim() : 'Untitled'
  const fullWidth = measureText(clean, font)
  if (fullWidth <= maxTextWidth) {
    return { text: clean, measuredWidth: fullWidth, truncated: false }
  }

  const ellipsis = '…'
  const ellipsisW = measureText(ellipsis, font)
  if (maxTextWidth <= ellipsisW) {
    return { text: ellipsis, measuredWidth: ellipsisW, truncated: true }
  }

  let lo = 1
  let hi = clean.length - 1
  let best = ellipsis
  let bestW = ellipsisW

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const candidate = `${clean.slice(0, mid).trimEnd()}${ellipsis}`
    const w = measureText(candidate, font)
    if (w <= maxTextWidth) {
      best = candidate
      bestW = w
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return { text: best, measuredWidth: bestW, truncated: true }
}

interface SizedNodeSpec {
  readonly shape: 'circle' | 'capsule'
  readonly displayTitle: string
  readonly isTruncated: boolean
  readonly labelVisible: boolean
  readonly width: number
  readonly height: number
  readonly radius: number | null
  readonly localLabelBox: BoxBounds | null
}

function computeNodeBoxSpec(
  node: VisibleMapNode,
  resolution: ScreenTierResolution,
  measureText: TextMeasurerFn,
  config: RadialLayoutConfig,
): SizedNodeSpec {
  const font = formatLayoutFont(resolution.modelFontPx, config.fonts)

  if (node.kind === 'root' || resolution.tier === 0) {
    const radius =
      node.kind === 'root'
        ? config.rootRadiusPx
        : Math.max(
            config.tier0CircleMinRadiusPx,
            Math.min(
              config.tier0CircleMaxRadiusPx,
              config.tier0CircleMinRadiusPx + Math.round(Math.log2(1 + node.totalDescendants) * 3),
            ),
          )
    const diameter = radius * 2
    if (!resolution.labelVisible) {
      return {
        shape: 'circle',
        displayTitle: '',
        isTruncated: false,
        labelVisible: false,
        width: diameter,
        height: diameter,
        radius,
        localLabelBox: null,
      }
    }

    const maxLabelTextW = config.capsuleMaxWidthPx - config.capsulePaddingXPx
    const fitted = truncateEndToWidth(node.title, maxLabelTextW, font, measureText)
    const labelW = Math.max(48, Math.ceil(fitted.measuredWidth + 12))
    const labelH = Math.ceil(resolution.modelFontPx * 1.4)
    return {
      shape: 'circle',
      displayTitle: fitted.text,
      isTruncated: fitted.truncated,
      labelVisible: true,
      width: diameter,
      height: diameter,
      radius,
      localLabelBox: {
        x: -labelW / 2,
        y: radius + config.tier0LabelOffsetPx,
        width: labelW,
        height: labelH,
      },
    }
  }

  const badgeReserve = node.hiddenCount > 0 ? config.capsuleMetaWidthPx : 0
  const maxTextW = config.capsuleMaxWidthPx - config.capsulePaddingXPx - badgeReserve
  const fitted = truncateEndToWidth(node.title, maxTextW, font, measureText)
  const rawW = fitted.measuredWidth + config.capsulePaddingXPx + badgeReserve
  const width = Math.max(
    config.capsuleMinWidthPx,
    Math.min(config.capsuleMaxWidthPx, Math.ceil(rawW)),
  )
  const height = resolution.tier === 2 ? config.capsuleTier2HeightPx : config.capsuleTier1HeightPx

  return {
    shape: 'capsule',
    displayTitle: fitted.text,
    isTruncated: fitted.truncated,
    labelVisible: true,
    width,
    height,
    radius: null,
    localLabelBox: null,
  }
}

interface PlacedMutableNode {
  readonly id: string
  readonly parentId: string | null
  readonly depth: number
  readonly kind: VisibleMapNode['kind']
  readonly spec: SizedNodeSpec
  readonly staggerRingCount: 1 | 2 | 3
  readonly staggerIndex: number
  readonly subtreeWeight: number
  r: number
  theta: number
  x: number
  y: number
  wedgeStart: number
  wedgeEnd: number
}

function updateCartesian(n: PlacedMutableNode): void {
  if (n.r === 0) {
    n.x = 0
    n.y = 0
    return
  }
  // Clock-12 polar coordinates: theta=0 points North (0, -r), positive clockwise.
  n.x = n.r * Math.sin(n.theta)
  n.y = -n.r * Math.cos(n.theta)
}

function occupiedBounds(n: PlacedMutableNode): BoxBounds {
  const minX = n.x - n.spec.width / 2
  const maxX = n.x + n.spec.width / 2
  const minY = n.y - n.spec.height / 2
  const maxY = n.y + n.spec.height / 2
  const lb = n.spec.localLabelBox
  if (!lb) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  const uMinX = Math.min(minX, n.x + lb.x)
  const uMaxX = Math.max(maxX, n.x + lb.x + lb.width)
  const uMinY = Math.min(minY, n.y + lb.y)
  const uMaxY = Math.max(maxY, n.y + lb.y + lb.height)
  return { x: uMinX, y: uMinY, width: uMaxX - uMinX, height: uMaxY - uMinY }
}

function boxesOverlapWithGap(a: BoxBounds, b: BoxBounds, minGapPx: number): boolean {
  const halfGap = minGapPx / 2
  return !(
    a.x + a.width + halfGap <= b.x - halfGap ||
    b.x + b.width + halfGap <= a.x - halfGap ||
    a.y + a.height + halfGap <= b.y - halfGap ||
    b.y + b.height + halfGap <= a.y - halfGap
  )
}

function clipRayToNodeEdge(
  cx: number,
  cy: number,
  spec: SizedNodeSpec,
  dx: number,
  dy: number,
): { readonly x: number; readonly y: number } {
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: cx, y: cy }

  if (spec.shape === 'circle' && spec.radius !== null) {
    const ux = dx / len
    const uy = dy / len
    return { x: cx + ux * spec.radius, y: cy + uy * spec.radius }
  }

  const halfW = spec.width / 2
  const halfH = spec.height / 2
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY
  const t = Math.min(tx, ty)
  return { x: cx + dx * t, y: cy + dy * t }
}

function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: BoxBounds,
): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const checks: readonly [number, number][] = [
    [-dx, x1 - box.x],
    [dx, box.x + box.width - x1],
    [-dy, y1 - box.y],
    [dy, box.y + box.height - y1],
  ]

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t0 <= t1
}

function buildSortedChildrenMap(visible: ComputeVisibleResult): Map<string, string[]> {
  const grouped = new Map<string, VisibleMapNode[]>()
  for (const node of Object.values(visible.nodes)) {
    if (!node.parentId || !(node.parentId in visible.nodes)) continue
    let list = grouped.get(node.parentId)
    if (!list) {
      list = []
      grouped.set(node.parentId, list)
    }
    list.push(node)
  }
  const sorted = new Map<string, string[]>()
  for (const [parentId, list] of grouped.entries()) {
    list.sort(compareSiblings)
    sorted.set(
      parentId,
      list.map((n) => n.id),
    )
  }
  return sorted
}

function computePostOrderIds(rootId: string, childrenMap: Map<string, string[]>): string[] {
  const postOrder: string[] = []
  const stack: Array<{ readonly id: string; expanded: boolean }> = [{ id: rootId, expanded: false }]
  while (stack.length > 0) {
    const top = stack.pop()!
    if (top.expanded) {
      postOrder.push(top.id)
      continue
    }
    stack.push({ id: top.id, expanded: true })
    const children = childrenMap.get(top.id) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ id: children[i]!, expanded: false })
    }
  }
  return postOrder
}

function pushSubtreeOutward(
  subtreeRootId: string,
  deltaR: number,
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
): void {
  const queue: string[] = [subtreeRootId]
  while (queue.length > 0) {
    const curId = queue.pop()!
    const node = placed.get(curId)
    if (!node) continue
    node.r += deltaR
    updateCartesian(node)
    for (const childId of childrenMap.get(curId) ?? []) {
      queue.push(childId)
    }
  }
}

interface LayoutPrepared {
  readonly childrenMap: Map<string, string[]>
  readonly specs: Map<string, SizedNodeSpec>
  readonly weights: Map<string, number>
  readonly maxHalfRadialByDepth: Map<number, number>
}

function prepareSpecsAndWeights(
  rootId: string,
  visible: ComputeVisibleResult,
  resolution: ScreenTierResolution,
  measureText: TextMeasurerFn,
  config: RadialLayoutConfig,
): LayoutPrepared {
  const childrenMap = buildSortedChildrenMap(visible)
  const postOrder = computePostOrderIds(rootId, childrenMap)
  const specs = new Map<string, SizedNodeSpec>()
  const weights = new Map<string, number>()
  const maxHalfRadialByDepth = new Map<number, number>()

  for (const id of postOrder) {
    const vNode = visible.nodes[id]!
    const spec = computeNodeBoxSpec(vNode, resolution, measureText, config)
    specs.set(id, spec)
    const halfDiag = Math.hypot(spec.width, spec.height) / 2
    maxHalfRadialByDepth.set(
      vNode.depth,
      Math.max(maxHalfRadialByDepth.get(vNode.depth) ?? 0, halfDiag),
    )

    const children = childrenMap.get(id) ?? []
    const focusBoost = vNode.isOnFocusPath ? config.focusPathWeightBoost : 0
    const hiddenBonus = config.hiddenWeightCoeff * Math.log2(1 + vNode.hiddenCount)
    if (children.length === 0) {
      weights.set(id, 1 + focusBoost + hiddenBonus)
    } else {
      let childWeightSum = 0
      for (const childId of children) {
        childWeightSum += weights.get(childId) ?? 1
      }
      weights.set(id, childWeightSum + focusBoost * 0.25 + hiddenBonus)
    }
  }

  return { childrenMap, specs, weights, maxHalfRadialByDepth }
}

function assignInitialPolarNodes(
  rootId: string,
  visible: ComputeVisibleResult,
  prepared: LayoutPrepared,
  config: RadialLayoutConfig,
): { readonly placed: Map<string, PlacedMutableNode>; readonly placedPreOrder: string[] } {
  const { childrenMap, specs, weights, maxHalfRadialByDepth } = prepared
  const placed = new Map<string, PlacedMutableNode>()
  const placedPreOrder: string[] = []
  interface WedgeAssignment {
    readonly id: string
    readonly wedgeStart: number
    readonly wedgeEnd: number
    readonly staggerRingCount: 1 | 2 | 3
    readonly staggerIndex: number
    readonly depthRadiusMin: number
  }

  const bfsQueue: WedgeAssignment[] = [
    {
      id: rootId,
      wedgeStart: 0,
      wedgeEnd: Math.PI * 2,
      staggerRingCount: 1,
      staggerIndex: 0,
      depthRadiusMin: 0,
    },
  ]

  while (bfsQueue.length > 0) {
    const current = bfsQueue.shift()!
    const vNode = visible.nodes[current.id]!
    const spec = specs.get(current.id)!
    const midTheta = (current.wedgeStart + current.wedgeEnd) / 2
    const nodeRadius =
      current.id === rootId
        ? 0
        : current.depthRadiusMin + current.staggerIndex * config.staggerRadialStepPx

    const mutable: PlacedMutableNode = {
      id: current.id,
      parentId: current.id === rootId ? null : vNode.parentId,
      depth: vNode.depth,
      kind: vNode.kind,
      spec,
      staggerRingCount: current.staggerRingCount,
      staggerIndex: current.staggerIndex,
      subtreeWeight: weights.get(current.id) ?? 1,
      r: nodeRadius,
      theta: midTheta,
      x: 0,
      y: 0,
      wedgeStart: current.wedgeStart,
      wedgeEnd: current.wedgeEnd,
    }
    updateCartesian(mutable)
    placed.set(current.id, mutable)
    placedPreOrder.push(current.id)

    const children = childrenMap.get(current.id) ?? []
    if (children.length === 0) continue

    const rawSpan = current.wedgeEnd - current.wedgeStart
    const usableSpan =
      current.id === rootId ? rawSpan : Math.min(rawSpan, config.maxNonRootFanRadians)
    const fanStart = midTheta - usableSpan / 2
    const staggerRingCount: 1 | 2 | 3 =
      children.length >= config.staggerThreshold3
        ? 3
        : children.length >= config.staggerThreshold2
          ? 2
          : 1

    let totalChildW = 0
    for (const cId of children) {
      totalChildW += weights.get(cId) ?? 1
    }

    const effectiveRingDivisor = staggerRingCount === 1 ? 1 : staggerRingCount === 2 ? 1.6 : 2.15
    let totalSiblingChord = 0
    for (const cId of children) {
      totalSiblingChord += specs.get(cId)!.width + config.minGapPx
    }
    const minGroupArcRadius =
      usableSpan > 0 ? totalSiblingChord / (usableSpan * effectiveRingDivisor) : 0

    let sameRingPairArcNeeded = 0
    for (let i = 0; i + staggerRingCount < children.length; i += 1) {
      const aId = children[i]!
      const bId = children[i + staggerRingCount]!
      const halfSum = specs.get(aId)!.width / 2 + specs.get(bId)!.width / 2 + config.minGapPx
      let betweenWeight = ((weights.get(aId) ?? 1) + (weights.get(bId) ?? 1)) * 0.5
      for (let m = i + 1; m < i + staggerRingCount; m += 1) {
        betweenWeight += weights.get(children[m]!) ?? 1
      }
      const pairAngle = totalChildW > 0 ? (usableSpan * betweenWeight) / totalChildW : 0
      if (pairAngle > 0.01) {
        sameRingPairArcNeeded = Math.max(sameRingPairArcNeeded, halfSum / pairAngle)
      }
    }

    const parentHalf = Math.hypot(spec.width, spec.height) / 2
    const childHalf = maxHalfRadialByDepth.get(vNode.depth + 1) ?? 40
    const nextMinR = Math.max(
      nodeRadius +
        parentHalf +
        childHalf +
        config.ringBaseGapPx +
        vNode.depth * config.ringDepthStepPx,
      minGroupArcRadius,
      sameRingPairArcNeeded,
    )

    let cursor = fanStart
    children.forEach((childId, idx) => {
      const cWeight = weights.get(childId) ?? 1
      const cSpan = (usableSpan * cWeight) / totalChildW
      bfsQueue.push({
        id: childId,
        wedgeStart: cursor,
        wedgeEnd: cursor + cSpan,
        staggerRingCount,
        staggerIndex: staggerRingCount === 1 ? 0 : idx % staggerRingCount,
        depthRadiusMin: nextMinR,
      })
      cursor += cSpan
    })
  }

  return { placed, placedPreOrder }
}

function resolveCollisionsAndCrossings(
  rootId: string,
  placedPreOrder: readonly string[],
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
  config: RadialLayoutConfig,
): number {
  let passesUsed = 0
  for (let pass = 0; pass < config.maxCollisionPasses; pass += 1) {
    let adjusted = false

    for (let i = 0; i < placedPreOrder.length; i += 1) {
      const a = placed.get(placedPreOrder[i]!)!
      const boxA = occupiedBounds(a)
      for (let j = i + 1; j < placedPreOrder.length; j += 1) {
        const b = placed.get(placedPreOrder[j]!)!
        if (b.id === rootId) continue
        const boxB = occupiedBounds(b)
        if (!boxesOverlapWithGap(boxA, boxB, config.minGapPx)) continue

        if (a.parentId !== null && a.parentId === b.parentId) {
          // Siblings in one concentric fan: expand the whole sibling ring together
          // so tangential arc widens without stranding one sibling behind another.
          for (const sibId of childrenMap.get(a.parentId) ?? []) {
            pushSubtreeOutward(sibId, config.staggerRadialStepPx, childrenMap, placed)
          }
          adjusted = true
          break
        }

        const pushTarget = b.r >= a.r ? b : a
        const stationary = pushTarget === b ? a : b
        const sBox = stationary === a ? boxA : boxB
        const pBox = pushTarget === b ? boxB : boxA
        const radialClearanceNeeded = Math.min(
          Math.max(
            0,
            (sBox.width + pBox.width) / 2 + config.minGapPx - Math.abs(stationary.x - pushTarget.x),
          ),
          Math.max(
            0,
            (sBox.height + pBox.height) / 2 +
              config.minGapPx -
              Math.abs(stationary.y - pushTarget.y),
          ),
        )
        const deltaR = Math.max(config.minGapPx, Math.ceil(radialClearanceNeeded) + config.minGapPx)
        pushSubtreeOutward(pushTarget.id, deltaR, childrenMap, placed)
        adjusted = true
      }
      if (adjusted) break
    }

    // Ensure every parent->child segment clears unrelated node boxes.
    for (const childId of placedPreOrder) {
      const child = placed.get(childId)!
      if (!child.parentId) continue
      const parent = placed.get(child.parentId)
      if (!parent) continue
      const pAnchor = clipRayToNodeEdge(
        parent.x,
        parent.y,
        parent.spec,
        child.x - parent.x,
        child.y - parent.y,
      )
      const cAnchor = clipRayToNodeEdge(
        child.x,
        child.y,
        child.spec,
        parent.x - child.x,
        parent.y - child.y,
      )

      for (const otherId of placedPreOrder) {
        if (otherId === child.id || otherId === parent.id) continue
        const other = placed.get(otherId)!
        if (
          !segmentIntersectsBox(pAnchor.x, pAnchor.y, cAnchor.x, cAnchor.y, occupiedBounds(other))
        ) {
          continue
        }
        if (other.depth < parent.depth && parent.id !== rootId) {
          // Secant chord dipped back onto an inner ancestor ring: lift parent & subtree outward.
          pushSubtreeOutward(parent.id, config.staggerRadialStepPx, childrenMap, placed)
        } else if (other.parentId === child.parentId) {
          // Expand sibling fan ring uniformly so tangential arc clears intermediate siblings.
          for (const sibId of childrenMap.get(other.parentId!) ?? []) {
            pushSubtreeOutward(sibId, config.staggerRadialStepPx, childrenMap, placed)
          }
        } else if (other.id !== rootId && other.depth >= child.depth) {
          const jump = Math.max(
            config.staggerRadialStepPx,
            Math.ceil(child.r - other.r) + config.staggerRadialStepPx,
          )
          pushSubtreeOutward(other.id, jump, childrenMap, placed)
        } else {
          pushSubtreeOutward(child.id, config.staggerRadialStepPx, childrenMap, placed)
        }
        adjusted = true
        break
      }
    }

    passesUsed = pass + 1
    if (!adjusted) break
  }
  return passesUsed
}

function finalizeRadialResult(
  rootId: string,
  scale: number,
  resolution: ScreenTierResolution,
  placedPreOrder: readonly string[],
  placed: Map<string, PlacedMutableNode>,
  passesUsed: number,
  config: RadialLayoutConfig,
): RadialLayoutResult {
  const outNodes: Record<string, RadialLayoutNode> = {}
  const edges: RadialLayoutEdge[] = []
  let truncatedCount = 0
  let hiddenLabelCount = 0
  let minEffectiveFontPx = Number.POSITIVE_INFINITY

  for (const id of placedPreOrder) {
    const m = placed.get(id)!
    const lb = m.spec.localLabelBox
      ? {
          x: m.x + m.spec.localLabelBox.x,
          y: m.y + m.spec.localLabelBox.y,
          width: m.spec.localLabelBox.width,
          height: m.spec.localLabelBox.height,
        }
      : null

    if (m.spec.isTruncated) truncatedCount += 1
    if (!m.spec.labelVisible) {
      hiddenLabelCount += 1
    } else if (resolution.effectiveFontPx < minEffectiveFontPx) {
      minEffectiveFontPx = resolution.effectiveFontPx
    }

    outNodes[id] = {
      id: m.id,
      parentId: m.parentId,
      depth: m.depth,
      kind: m.kind,
      shape: m.spec.shape,
      tier: resolution.tier,
      displayTitle: m.spec.displayTitle,
      isTruncated: m.spec.isTruncated,
      labelVisible: m.spec.labelVisible,
      modelFontPx: resolution.modelFontPx,
      effectiveFontPx: resolution.effectiveFontPx,
      x: m.x,
      y: m.y,
      width: m.spec.width,
      height: m.spec.height,
      radius: m.spec.radius,
      labelBox: lb,
      r: m.r,
      theta: m.theta,
      wedgeStart: m.wedgeStart,
      wedgeEnd: m.wedgeEnd,
      staggerRingCount: m.staggerRingCount,
      staggerIndex: m.staggerIndex,
      subtreeWeight: m.subtreeWeight,
    }

    if (m.parentId) {
      const parent = placed.get(m.parentId)
      if (parent) {
        const sAnchor = clipRayToNodeEdge(
          parent.x,
          parent.y,
          parent.spec,
          m.x - parent.x,
          m.y - parent.y,
        )
        const tAnchor = clipRayToNodeEdge(m.x, m.y, m.spec, parent.x - m.x, parent.y - m.y)
        edges.push({
          id: `${parent.id}->${m.id}`,
          sourceId: parent.id,
          targetId: m.id,
          sourceX: sAnchor.x,
          sourceY: sAnchor.y,
          targetX: tAnchor.x,
          targetY: tAnchor.y,
        })
      }
    }
  }

  let overlapCount = 0
  for (let i = 0; i < placedPreOrder.length; i += 1) {
    const aBox = occupiedBounds(placed.get(placedPreOrder[i]!)!)
    for (let j = i + 1; j < placedPreOrder.length; j += 1) {
      const bBox = occupiedBounds(placed.get(placedPreOrder[j]!)!)
      if (boxesOverlapWithGap(aBox, bBox, config.minGapPx)) {
        overlapCount += 1
      }
    }
  }

  let edgeCrossingsCount = 0
  for (const edge of edges) {
    for (const id of placedPreOrder) {
      if (id === edge.sourceId || id === edge.targetId) continue
      if (
        segmentIntersectsBox(
          edge.sourceX,
          edge.sourceY,
          edge.targetX,
          edge.targetY,
          occupiedBounds(placed.get(id)!),
        )
      ) {
        edgeCrossingsCount += 1
      }
    }
  }

  return {
    rootId,
    tier: resolution.tier,
    scale,
    nodes: outNodes,
    orderedIds: placedPreOrder,
    edges,
    diagnostics: {
      nodeCount: placedPreOrder.length,
      edgeCount: edges.length,
      overlapCount,
      edgeCrossingsCount,
      truncatedCount,
      hiddenLabelCount,
      minEffectiveFontPx: Number.isFinite(minEffectiveFontPx) ? minEffectiveFontPx : 0,
      collisionPassesUsed: passesUsed,
    },
  }
}

/** Computes a pure deterministic radial tree layout for visible map nodes. */
export function computeRadialLayout(input: RadialLayoutInput): RadialLayoutResult {
  const config = mergeConfig(input.config)
  const scale =
    input.scale !== undefined && Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1
  const resolution = resolveScreenZoomTier(scale, input.tier, config)
  const rootId = input.visible.nodes[input.visible.rootId] ? input.visible.rootId : MAP_ROOT_ID

  if (!input.visible.nodes[rootId]) {
    return {
      rootId,
      tier: resolution.tier,
      scale,
      nodes: {},
      orderedIds: [],
      edges: [],
      diagnostics: {
        nodeCount: 0,
        edgeCount: 0,
        overlapCount: 0,
        edgeCrossingsCount: 0,
        truncatedCount: 0,
        hiddenLabelCount: 0,
        minEffectiveFontPx: 0,
        collisionPassesUsed: 0,
      },
    }
  }

  const prepared = prepareSpecsAndWeights(
    rootId,
    input.visible,
    resolution,
    input.measureText,
    config,
  )
  const { placed, placedPreOrder } = assignInitialPolarNodes(
    rootId,
    input.visible,
    prepared,
    config,
  )
  const passesUsed = resolveCollisionsAndCrossings(
    rootId,
    placedPreOrder,
    prepared.childrenMap,
    placed,
    config,
  )
  return finalizeRadialResult(rootId, scale, resolution, placedPreOrder, placed, passesUsed, config)
}
