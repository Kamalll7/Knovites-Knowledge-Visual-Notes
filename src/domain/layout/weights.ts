import { compareSiblings } from '@/domain/tree'

import type { ComputeVisibleResult, VisibleMapNode } from './compute-visible'
import {
  formatLayoutFont,
  type LayoutPrepared,
  type NodeBoxConfig,
  type RadialLayoutConfig,
  type ScreenTierResolution,
  type SizedNodeSpec,
  type TextMeasurerFn,
} from './types'

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

export function computeNodeBoxSpec(
  node: VisibleMapNode,
  resolution: ScreenTierResolution,
  measureText: TextMeasurerFn,
  config: NodeBoxConfig,
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

export function buildSortedChildrenMap(visible: ComputeVisibleResult): Map<string, string[]> {
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

export function computePostOrderIds(rootId: string, childrenMap: Map<string, string[]>): string[] {
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

/** Computes node box dimensions, sorted sibling children, and bottom-up subtree angular weights. */
export function prepareSpecsAndWeights(
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
