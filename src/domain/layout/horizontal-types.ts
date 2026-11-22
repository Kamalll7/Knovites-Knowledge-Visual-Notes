import type { ComputeVisibleResult, ZoomTier } from '@/domain/layout/compute-visible'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  mergeLayoutConfig,
  type MapLayoutDiagnostics,
  type MapLayoutEdge,
  type MapLayoutNode,
  type MapLayoutResult,
  type NodeBoxConfig,
  type TextMeasurerFn,
} from '@/domain/layout/types'

/**
 * Single centralized configuration for T3.3a horizontal left-to-right layout.
 * Directional spacing constants cite `spec-map.md`, `plan.md`, and `S3`.
 */
export interface HorizontalLayoutConfig extends NodeBoxConfig {
  /** spec-map.md FR-MAP-03 / plan.md T3.3: strict minimum vertical gap between node boxes (px). */
  readonly minGapPx: number
  /** plan.md T3.3 / FR-MAP-04: horizontal gap between adjacent depth columns (px). */
  readonly columnGapPx: number
  /** spec-map.md FR-MAP-04 / plan.md T3.3: proportional vertical allowance per visible descendant (px). */
  readonly descendantSpacingPx: number
  /** docs/spikes/s3-radial.md FR-MAP-09: sibling count threshold (>= 12) engaging wide-fan source fade. */
  readonly wideFanFadeThreshold: number
}

export const DEFAULT_HORIZONTAL_LAYOUT_CONFIG: HorizontalLayoutConfig = {
  capsuleMinWidthPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMinWidthPx,
  capsuleMaxWidthPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMaxWidthPx,
  capsuleTier1HeightPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleTier1HeightPx,
  capsuleTier2HeightPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleTier2HeightPx,
  capsulePaddingXPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsulePaddingXPx,
  capsuleMetaWidthPx: DEFAULT_RADIAL_LAYOUT_CONFIG.capsuleMetaWidthPx,
  rootRadiusPx: DEFAULT_RADIAL_LAYOUT_CONFIG.rootRadiusPx,
  tier0CircleMinRadiusPx: DEFAULT_RADIAL_LAYOUT_CONFIG.tier0CircleMinRadiusPx,
  tier0CircleMaxRadiusPx: DEFAULT_RADIAL_LAYOUT_CONFIG.tier0CircleMaxRadiusPx,
  tier0LabelOffsetPx: DEFAULT_RADIAL_LAYOUT_CONFIG.tier0LabelOffsetPx,
  minGapPx: DEFAULT_RADIAL_LAYOUT_CONFIG.minGapPx,
  columnGapPx: 64,
  descendantSpacingPx: 12,
  wideFanFadeThreshold: DEFAULT_RADIAL_LAYOUT_CONFIG.staggerThreshold2,
  minScreenFontPx: DEFAULT_RADIAL_LAYOUT_CONFIG.minScreenFontPx,
  tier0ScaleThreshold: DEFAULT_RADIAL_LAYOUT_CONFIG.tier0ScaleThreshold,
  tier2ScaleThreshold: DEFAULT_RADIAL_LAYOUT_CONFIG.tier2ScaleThreshold,
  fonts: DEFAULT_RADIAL_LAYOUT_CONFIG.fonts,
}

export interface HorizontalLayoutStats {
  nodesVisited: number
  edgeAnchorsComputed: number
}

export interface HorizontalLayoutInput {
  readonly visible: ComputeVisibleResult
  readonly measureText: TextMeasurerFn
  /** Viewport scale factor (`screenPx / modelPx`). Defaults to `1`. */
  readonly scale?: number
  /** Optional requested tier; downgraded if effective on-screen font `< 11 px`. */
  readonly tier?: ZoomTier
  readonly config?: Partial<HorizontalLayoutConfig>
  /** Optional deterministic operation counter sink for CI non-quadratic checks. */
  readonly stats?: HorizontalLayoutStats
}

export interface HorizontalLayoutDiagnostics extends MapLayoutDiagnostics {
  readonly columnCount: number
}

export interface HorizontalLayoutNode extends MapLayoutNode {
  readonly columnIndex: number
  readonly visibleDescendants: number
  readonly bandHeightPx: number
}

export interface HorizontalLayoutEdge extends MapLayoutEdge {
  /** Number of visible sibling edges originating from `sourceId`. */
  readonly sourceFanCount: number
  /** True when `sourceFanCount >= wideFanFadeThreshold` so T3.4 fades the edge base near parent. */
  readonly fadeSourceBase: boolean
}

export type HorizontalLayoutResult = MapLayoutResult<
  HorizontalLayoutNode,
  HorizontalLayoutDiagnostics,
  HorizontalLayoutEdge
>

export function mergeHorizontalConfig(
  partial?: Partial<HorizontalLayoutConfig>,
): HorizontalLayoutConfig {
  return mergeLayoutConfig(DEFAULT_HORIZONTAL_LAYOUT_CONFIG, partial)
}
