import type { ComputeVisibleResult, VisibleMapNode, ZoomTier } from './compute-visible'

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

export interface SizedNodeSpec {
  readonly shape: 'circle' | 'capsule'
  readonly displayTitle: string
  readonly isTruncated: boolean
  readonly labelVisible: boolean
  readonly width: number
  readonly height: number
  readonly radius: number | null
  readonly localLabelBox: BoxBounds | null
}

export interface PlacedMutableNode {
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

export interface LayoutPrepared {
  readonly childrenMap: Map<string, string[]>
  readonly specs: Map<string, SizedNodeSpec>
  readonly weights: Map<string, number>
  readonly maxHalfRadialByDepth: Map<number, number>
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

export function mergeRadialConfig(partial?: Partial<RadialLayoutConfig>): RadialLayoutConfig {
  if (!partial) return DEFAULT_RADIAL_LAYOUT_CONFIG
  return {
    ...DEFAULT_RADIAL_LAYOUT_CONFIG,
    ...partial,
    fonts: partial.fonts
      ? { ...DEFAULT_RADIAL_LAYOUT_CONFIG.fonts, ...partial.fonts }
      : DEFAULT_RADIAL_LAYOUT_CONFIG.fonts,
  }
}
