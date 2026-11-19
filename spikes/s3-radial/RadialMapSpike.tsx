import { easeCubicOut } from 'd3-ease'
import { interpolateNumber } from 'd3-interpolate'
import { select } from 'd3-selection'
import { linkRadial } from 'd3-shape'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeState } from '@/domain/tree'
import {
  computeVisible,
  VIRTUAL_ROOT_ID,
  type ComputeVisibleResult,
  type ZoomTier,
} from './compute-visible'
import {
  computeRadialLayout,
  polarToCartesian,
  type PositionedMapEdge,
  type PositionedMapNode,
  type RadialLayoutResult,
} from './radial-layout'

export interface TransitionBenchmarkResult {
  layoutMs: number
  durationMs: number
  frameCount: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export interface RadialMapMetrics {
  visibleCount: number
  totalNodes: number
  overlapCount: number
  layoutMs: number
  zoomScale: number
  zoomTier: ZoomTier
  focusId: string
}

export interface RadialMapSpikeProps {
  tree: TreeState
  rootTitle: string
  focusId: string
  onFocusChange: (nextFocusId: string) => void
  zoomTier: ZoomTier
  onZoomTierChange: (nextTier: ZoomTier) => void
  expandedOverflowParentIds: ReadonlySet<string>
  onExpandOverflow: (parentId: string) => void
  onMetricsChange?: (metrics: RadialMapMetrics) => void
  onRegisterControls?: (controls: {
    zoomIn: () => void
    zoomOut: () => void
    fitAll: () => void
    recenterFocus: () => void
    measureTransition: (targetFocusId: string) => Promise<TransitionBenchmarkResult>
  }) => void
}

const BRANCH_VARS = [
  'var(--branch-1)',
  'var(--branch-2)',
  'var(--branch-3)',
  'var(--branch-4)',
  'var(--branch-5)',
  'var(--branch-6)',
  'var(--branch-7)',
  'var(--branch-8)',
] as const

const TRANSITION_DURATION_MS = 520

function tierForScale(k: number): ZoomTier {
  if (k < 0.5) return 0
  if (k < 1.2) return 1
  return 2
}

function measureLayoutTime(run: () => void): number {
  const t0 = performance.now()
  run()
  return performance.now() - t0
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function resolveBranchColors(
  visible: ComputeVisibleResult,
  rootChildrenIds: readonly string[],
): Map<string, string> {
  const paletteByBranchRoot = new Map<string, string>()
  let lastIndex = -1
  rootChildrenIds.forEach((cid, idx) => {
    let colorIdx = (hashString(cid) + idx) % BRANCH_VARS.length
    if (colorIdx === lastIndex) {
      colorIdx = (colorIdx + 1) % BRANCH_VARS.length
    }
    lastIndex = colorIdx
    paletteByBranchRoot.set(cid, BRANCH_VARS[colorIdx]!)
  })

  const out = new Map<string, string>()
  for (const id of visible.orderedIds) {
    const node = visible.nodes[id]!
    if (node.color) {
      out.set(id, node.color)
    } else if (node.branchRootId && paletteByBranchRoot.has(node.branchRootId)) {
      out.set(id, paletteByBranchRoot.get(node.branchRootId)!)
    } else {
      out.set(id, 'var(--accent)')
    }
  }
  return out
}

function truncateTitle(title: string, maxChars: number): string {
  if (title.length <= maxChars) return title
  if (maxChars <= 2) return title.slice(0, maxChars)
  return `${title.slice(0, maxChars - 1)}…`
}

function statusStrokeColor(status: PositionedMapNode['status']): string | null {
  switch (status) {
    case 'learning':
      return 'var(--status-learning)'
    case 'practiced':
      return 'var(--status-practiced)'
    case 'mastered':
      return 'var(--status-mastered)'
    default:
      return null
  }
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))
  return sorted[idx]!
}

const radialEdgeGenerator = linkRadial<
  unknown,
  {
    source: [number, number]
    target: [number, number]
  },
  [number, number]
>()
  .angle((d) => d[0])
  .radius((d) => d[1])

function buildEdgePath(srcTheta: number, srcR: number, dstTheta: number, dstR: number): string {
  return (
    radialEdgeGenerator({
      source: [srcTheta, srcR],
      target: [dstTheta, dstR],
    }) ?? `M0,0L0,0`
  )
}

function computeCameraForFocus(
  layout: RadialLayoutResult,
  focusId: string,
  viewportW: number,
  viewportH: number,
  mode: 'focus' | 'fit-all',
): { k: number; x: number; y: number } {
  const safeW = Math.max(320, viewportW)
  const safeH = Math.max(240, viewportH)
  const padding = 56

  let minX = layout.bounds.minX
  let maxX = layout.bounds.maxX
  let minY = layout.bounds.minY
  let maxY = layout.bounds.maxY

  if (mode === 'focus' && focusId !== VIRTUAL_ROOT_ID && layout.nodes[focusId]) {
    const focusNode = layout.nodes[focusId]!
    const targetIds = new Set<string>([focusId])
    if (focusNode.parentId && layout.nodes[focusNode.parentId]) {
      targetIds.add(focusNode.parentId)
    }
    for (const cid of focusNode.visibleChildIds) {
      if (layout.nodes[cid]) targetIds.add(cid)
    }
    // Include one more ancestor if chain is thin so orientation toward Root stays obvious
    const parentNode = focusNode.parentId ? layout.nodes[focusNode.parentId] : undefined
    if (parentNode?.parentId && layout.nodes[parentNode.parentId]) {
      targetIds.add(parentNode.parentId)
    }

    minX = Infinity
    maxX = -Infinity
    minY = Infinity
    maxY = -Infinity
    for (const tid of targetIds) {
      const n = layout.nodes[tid]!
      minX = Math.min(minX, n.x - n.width / 2)
      maxX = Math.max(maxX, n.x + n.width / 2)
      minY = Math.min(minY, n.y - n.height / 2)
      maxY = Math.max(maxY, n.y + n.height / 2)
    }
  }

  const boxW = Math.max(240, maxX - minX)
  const boxH = Math.max(180, maxY - minY)
  const availW = Math.max(180, safeW - padding * 2)
  const availH = Math.max(140, safeH - padding * 2)

  const maxK = mode === 'focus' && focusId !== VIRTUAL_ROOT_ID ? 1.15 : 1.05
  const minK = mode === 'focus' && focusId !== VIRTUAL_ROOT_ID ? 0.54 : 0.25
  const fitK = Math.min(availW / boxW, availH / boxH)
  const k = Math.max(minK, Math.min(maxK, fitK))
  const focusAnchor = layout.nodes[focusId]
  const cx =
    mode === 'focus' && focusId !== VIRTUAL_ROOT_ID && focusAnchor && fitK < minK
      ? focusAnchor.x
      : (minX + maxX) / 2
  const cy =
    mode === 'focus' && focusId !== VIRTUAL_ROOT_ID && focusAnchor && fitK < minK
      ? focusAnchor.y
      : (minY + maxY) / 2
  const x = safeW / 2 - cx * k
  const y = safeH / 2 - cy * k

  return { k, x, y }
}

export function RadialMapSpike({
  tree,
  rootTitle,
  focusId,
  onFocusChange,
  zoomTier,
  onZoomTierChange,
  expandedOverflowParentIds,
  onExpandOverflow,
  onMetricsChange,
  onRegisterControls,
}: RadialMapSpikeProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cameraGroupRef = useRef<SVGGElement | null>(null)
  const nodeGroupRefs = useRef<Map<string, SVGGElement>>(new Map())
  const edgePathRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const edgeGlowRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const zoomBadgeRef = useRef<HTMLSpanElement | null>(null)

  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 })

  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const currentZoomRef = useRef<{ k: number; x: number; y: number }>({ k: 1, x: 640, y: 360 })
  const zoomTierRef = useRef<ZoomTier>(zoomTier)

  const liveCoordsRef = useRef<Map<string, { theta: number; r: number }>>(new Map())
  const prevLayoutRef = useRef<RadialLayoutResult | null>(null)
  const animRafRef = useRef<number | null>(null)
  const isAnimatingRef = useRef(false)
  const isProgrammaticZoomRef = useRef(false)
  const benchmarkResolveRef = useRef<((res: TransitionBenchmarkResult) => void) | null>(null)
  const isFirstMountRef = useRef(true)

  // Compute computeVisible + radialLayout purely during render
  const { visible, layout, branchColors } = useMemo(() => {
    const vis = computeVisible({
      tree,
      rootTitle,
      focusId,
      expandedOverflowParentIds,
      zoomTier,
    })
    const lay = computeRadialLayout(vis, zoomTier)
    const colors = resolveBranchColors(vis, vis.nodes[VIRTUAL_ROOT_ID]?.visibleChildIds ?? [])
    return {
      visible: vis,
      layout: lay,
      branchColors: colors,
    }
  }, [tree, rootTitle, focusId, expandedOverflowParentIds, zoomTier])

  const layoutRef = useRef(layout)
  const focusIdRef = useRef(focusId)
  const layoutMsRef = useRef(0)

  useEffect(() => {
    zoomTierRef.current = zoomTier
    layoutRef.current = layout
    focusIdRef.current = focusId
  }, [zoomTier, layout, focusId])

  // Measure SVG viewport size cleanly
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const updateSize = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ w: rect.width, h: rect.height })
      }
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  // Bind d3-zoom once to SVG element; mutate camera group transform directly via ref (no React per frame!)
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .filter((event: Event) => {
        // Allow wheel and primary pointer drags on background / nodes without trapping button clicks
        if (event.type === 'dblclick') return false
        return true
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        const { k, x, y } = event.transform
        currentZoomRef.current = { k, x, y }
        if (cameraGroupRef.current) {
          cameraGroupRef.current.setAttribute('transform', `translate(${x},${y}) scale(${k})`)
        }
        const effectiveTier =
          isProgrammaticZoomRef.current || isAnimatingRef.current
            ? zoomTierRef.current
            : tierForScale(k)
        if (zoomBadgeRef.current) {
          zoomBadgeRef.current.textContent = `${Math.round(k * 100)}% · Tier ${effectiveTier}`
        }
        if (!isProgrammaticZoomRef.current && !isAnimatingRef.current && event.sourceEvent) {
          if (effectiveTier !== zoomTierRef.current) {
            onZoomTierChange(effectiveTier)
          }
        }
      })

    zoomBehaviorRef.current = behavior
    const svgSel = select<SVGSVGElement, unknown>(svgEl)
    svgSel.call(behavior)

    return () => {
      svgSel.on('.zoom', null)
    }
  }, [onZoomTierChange])

  // Measure computeVisible + computeRadialLayout cleanly inside effect and emit metrics
  useEffect(() => {
    const measuredMs = measureLayoutTime(() => {
      const vis = computeVisible({
        tree,
        rootTitle,
        focusId: visible.focusId,
        expandedOverflowParentIds,
        zoomTier,
      })
      computeRadialLayout(vis, zoomTier)
    })
    layoutMsRef.current = measuredMs
    onMetricsChange?.({
      visibleCount: layout.orderedIds.length,
      totalNodes: Object.keys(tree.nodes).length,
      overlapCount: layout.overlapCount,
      layoutMs: measuredMs,
      zoomScale: currentZoomRef.current.k,
      zoomTier,
      focusId: visible.focusId,
    })
  }, [
    expandedOverflowParentIds,
    layout,
    onMetricsChange,
    rootTitle,
    tree,
    visible.focusId,
    zoomTier,
  ])

  const applyCameraInstant = useCallback((cam: { k: number; x: number; y: number }) => {
    const svgEl = svgRef.current
    const behavior = zoomBehaviorRef.current
    currentZoomRef.current = cam
    if (cameraGroupRef.current) {
      cameraGroupRef.current.setAttribute(
        'transform',
        `translate(${cam.x},${cam.y}) scale(${cam.k})`,
      )
    }
    if (zoomBadgeRef.current) {
      zoomBadgeRef.current.textContent = `${Math.round(cam.k * 100)}% · Tier ${zoomTierRef.current}`
    }
    if (svgEl && behavior) {
      isProgrammaticZoomRef.current = true
      try {
        select<SVGSVGElement, unknown>(svgEl).call(
          behavior.transform,
          zoomIdentity.translate(cam.x, cam.y).scale(cam.k),
        )
      } finally {
        isProgrammaticZoomRef.current = false
      }
    }
  }, [])

  // Animate node positions, edge bezier paths, and camera focus via DOM refs & RAF (interruptible!)
  useEffect(() => {
    if (animRafRef.current !== null) {
      cancelAnimationFrame(animRafRef.current)
      animRafRef.current = null
    }

    const prevLayout = prevLayoutRef.current
    const reducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const targetCam = computeCameraForFocus(
      layout,
      visible.focusId,
      viewportSize.w,
      viewportSize.h,
      'focus',
    )

    const paintPositions = (
      coords: Map<string, { theta: number; r: number }>,
      edges: readonly PositionedMapEdge[],
    ) => {
      for (const id of layout.orderedIds) {
        const g = nodeGroupRefs.current.get(id)
        const c = coords.get(id)
        if (g && c) {
          const { x, y } = polarToCartesian(c.theta, c.r)
          g.setAttribute('transform', `translate(${x},${y})`)
        }
      }
      for (const edge of edges) {
        const pathEl = edgePathRefs.current.get(edge.id)
        const glowEl = edgeGlowRefs.current.get(edge.id)
        const src = coords.get(edge.sourceId)
        const dst = coords.get(edge.targetId)
        if ((pathEl || glowEl) && src && dst) {
          const d = buildEdgePath(src.theta, src.r, dst.theta, dst.r)
          if (pathEl) pathEl.setAttribute('d', d)
          if (glowEl) glowEl.setAttribute('d', d)
        }
      }
    }

    if (isFirstMountRef.current || !prevLayout || reducedMotion) {
      isFirstMountRef.current = false
      const finalCoords = new Map<string, { theta: number; r: number }>()
      for (const id of layout.orderedIds) {
        const n = layout.nodes[id]!
        finalCoords.set(id, { theta: n.theta, r: n.r })
      }
      liveCoordsRef.current = finalCoords
      paintPositions(finalCoords, layout.edges)
      applyCameraInstant(targetCam)
      prevLayoutRef.current = layout

      if (benchmarkResolveRef.current) {
        const resolve = benchmarkResolveRef.current
        benchmarkResolveRef.current = null
        resolve({
          layoutMs: layoutMsRef.current,
          durationMs: 0,
          frameCount: 1,
          p50Ms: 0,
          p95Ms: 0,
          maxMs: 0,
        })
      }
      return
    }

    // Build per-node start -> end polar interpolators from current live coordinates (interruptible!)
    const startCoords = new Map<string, { theta: number; r: number }>()
    const endCoords = new Map<string, { theta: number; r: number }>()

    for (const id of layout.orderedIds) {
      const targetNode = layout.nodes[id]!
      endCoords.set(id, { theta: targetNode.theta, r: targetNode.r })

      const live = liveCoordsRef.current.get(id)
      if (live) {
        startCoords.set(id, live)
      } else if (targetNode.parentId) {
        const parentLive =
          liveCoordsRef.current.get(targetNode.parentId) ??
          prevLayout.nodes[targetNode.parentId] ??
          layout.nodes[targetNode.parentId]
        startCoords.set(id, {
          theta: parentLive?.theta ?? targetNode.theta,
          r: parentLive?.r ?? targetNode.r,
        })
      } else {
        startCoords.set(id, { theta: targetNode.theta, r: targetNode.r })
      }
    }

    const startCam = { ...currentZoomRef.current }
    const interpK = interpolateNumber(startCam.k, targetCam.k)
    const interpX = interpolateNumber(startCam.x, targetCam.x)
    const interpY = interpolateNumber(startCam.y, targetCam.y)

    const nodeInterps = new Map<
      string,
      { theta: (t: number) => number; r: (t: number) => number }
    >()
    for (const id of layout.orderedIds) {
      const s = startCoords.get(id)!
      const e = endCoords.get(id)!
      // Shortest circular angle delta if needed, while preserving monotonic sector transition
      let dTheta = e.theta - s.theta
      while (dTheta > Math.PI) dTheta -= Math.PI * 2
      while (dTheta < -Math.PI) dTheta += Math.PI * 2
      const targetThetaAdjusted = s.theta + dTheta

      nodeInterps.set(id, {
        theta: interpolateNumber(s.theta, targetThetaAdjusted),
        r: interpolateNumber(s.r, e.r),
      })
    }

    const tStart = performance.now()
    let prevFrameTs = tStart
    const frameDeltas: number[] = []
    isAnimatingRef.current = true

    const tick = (now: number) => {
      const dt = now - prevFrameTs
      if (frameDeltas.length > 0 || dt > 0.1) {
        frameDeltas.push(dt)
      }
      prevFrameTs = now

      const elapsed = now - tStart
      const rawT = Math.min(1, elapsed / TRANSITION_DURATION_MS)
      const easedT = easeCubicOut(rawT)

      const frameCoords = new Map<string, { theta: number; r: number }>()
      for (const id of layout.orderedIds) {
        const ip = nodeInterps.get(id)!
        frameCoords.set(id, {
          theta: ip.theta(easedT),
          r: ip.r(easedT),
        })
      }
      liveCoordsRef.current = frameCoords
      paintPositions(frameCoords, layout.edges)

      const nextCam = {
        k: interpK(easedT),
        x: interpX(easedT),
        y: interpY(easedT),
      }
      applyCameraInstant(nextCam)

      if (rawT < 1) {
        animRafRef.current = requestAnimationFrame(tick)
      } else {
        animRafRef.current = null
        isAnimatingRef.current = false
        liveCoordsRef.current = endCoords
        paintPositions(endCoords, layout.edges)
        applyCameraInstant(targetCam)
        prevLayoutRef.current = layout

        const sorted = [...frameDeltas].sort((a, b) => a - b)
        if (benchmarkResolveRef.current) {
          const resolve = benchmarkResolveRef.current
          benchmarkResolveRef.current = null
          resolve({
            layoutMs: layoutMsRef.current,
            durationMs: elapsed,
            frameCount: sorted.length,
            p50Ms: percentile(sorted, 0.5),
            p95Ms: percentile(sorted, 0.95),
            maxMs: sorted[sorted.length - 1] ?? 0,
          })
        }
      }
    }

    prevLayoutRef.current = layout
    animRafRef.current = requestAnimationFrame(tick)

    return () => {
      isAnimatingRef.current = false
      if (animRafRef.current !== null) {
        cancelAnimationFrame(animRafRef.current)
        animRafRef.current = null
      }
    }
  }, [applyCameraInstant, layout, viewportSize.h, viewportSize.w, visible.focusId])

  // Register imperative zoom / fit / benchmark controls for HUD & Playwright
  useEffect(() => {
    if (!onRegisterControls) return

    const smoothZoomTo = (factor: number) => {
      const svgEl = svgRef.current
      const behavior = zoomBehaviorRef.current
      if (!svgEl || !behavior) return
      const cur = currentZoomRef.current
      const nextK = Math.max(0.2, Math.min(3, cur.k * factor))
      const ratio = nextK / cur.k
      const cx = viewportSize.w / 2
      const cy = viewportSize.h / 2
      const nextX = cx - (cx - cur.x) * ratio
      const nextY = cy - (cy - cur.y) * ratio
      applyCameraInstant({ k: nextK, x: nextX, y: nextY })
    }

    onRegisterControls({
      zoomIn: () => smoothZoomTo(1.25),
      zoomOut: () => smoothZoomTo(0.8),
      fitAll: () => {
        const cam = computeCameraForFocus(
          layoutRef.current,
          focusIdRef.current,
          viewportSize.w,
          viewportSize.h,
          'fit-all',
        )
        applyCameraInstant(cam)
      },
      recenterFocus: () => {
        const cam = computeCameraForFocus(
          layoutRef.current,
          focusIdRef.current,
          viewportSize.w,
          viewportSize.h,
          'focus',
        )
        applyCameraInstant(cam)
      },
      measureTransition: (targetFocusId: string) =>
        new Promise<TransitionBenchmarkResult>((resolve) => {
          benchmarkResolveRef.current = resolve
          onFocusChange(targetFocusId)
        }),
    })
  }, [applyCameraInstant, onFocusChange, onRegisterControls, viewportSize.h, viewportSize.w])

  return (
    <div className="relative h-full w-full overflow-hidden bg-background select-none">
      <svg
        ref={svgRef}
        data-testid="radial-map-svg"
        className="h-full w-full cursor-grab active:cursor-grabbing"
        role="application"
        aria-label="Radial knowledge map canvas"
      >
        <g ref={cameraGroupRef} data-testid="radial-camera-group">
          {/* Subtle concentric depth rings */}
          <g className="pointer-events-none">
            {layout.ringRadii.slice(1).map((r, i) => (
              <circle
                key={`ring-${i + 1}`}
                cx={0}
                cy={0}
                r={r}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="4 6"
                opacity={0.45}
              />
            ))}
          </g>

          {/* Tapered bezier edges (non-focus first, active focus path + soft stroke halo on top) */}
          <g data-testid="radial-edges">
            {layout.edges
              .slice()
              .sort((a, b) => Number(a.isOnFocusPath) - Number(b.isOnFocusPath))
              .map((edge) => {
                const branchColor =
                  (edge.branchRootId && branchColors.get(edge.targetId)) || 'var(--accent)'
                const d = buildEdgePath(
                  edge.sourceTheta,
                  edge.sourceR,
                  edge.targetTheta,
                  edge.targetR,
                )
                return (
                  <g key={edge.id}>
                    {edge.isOnFocusPath ? (
                      <path
                        ref={(el) => {
                          if (el) edgeGlowRefs.current.set(edge.id, el)
                          else edgeGlowRefs.current.delete(edge.id)
                        }}
                        d={d}
                        fill="none"
                        stroke={branchColor}
                        strokeWidth={edge.strokeWidth + 7}
                        strokeLinecap="round"
                        opacity={0.22}
                      />
                    ) : null}
                    <path
                      ref={(el) => {
                        if (el) edgePathRefs.current.set(edge.id, el)
                        else edgePathRefs.current.delete(edge.id)
                      }}
                      d={d}
                      fill="none"
                      stroke={branchColor}
                      strokeWidth={edge.strokeWidth}
                      strokeLinecap="round"
                      opacity={edge.isOnFocusPath ? 0.96 : 0.34}
                    />
                  </g>
                )
              })}
          </g>

          {/* Node pills / circles */}
          <g data-testid="radial-nodes">
            {layout.orderedIds.map((id) => {
              const node = layout.nodes[id]!
              const branchColor = branchColors.get(id) ?? 'var(--accent)'
              const statusColor = statusStrokeColor(node.status)
              const hasBadge = node.kind === 'node' && node.totalDescendants > 0
              const badgeStr = hasBadge ? `· ${node.totalDescendants}` : ''
              const fillColor =
                node.kind === 'root'
                  ? 'var(--surface-2)'
                  : node.kind === 'overflow'
                    ? 'var(--surface-2)'
                    : `color-mix(in srgb, ${branchColor} ${node.isFocus ? '22%' : '11%'}, var(--surface))`

              const borderColor = node.isFocus
                ? branchColor
                : node.isOnFocusPath
                  ? `color-mix(in srgb, ${branchColor} 72%, var(--border))`
                  : `color-mix(in srgb, ${branchColor} 42%, var(--border))`

              const badgeReserve = hasBadge ? 26 + badgeStr.length * 6.5 : 16
              const titleAvailPx = Math.max(40, node.width - 25 - badgeReserve)
              const avgCharPx = node.kind === 'root' ? 7.8 : node.isFocus ? 7.5 : 7.0
              const maxTitleChars =
                node.kind === 'root'
                  ? Math.max(10, Math.floor((node.width - 42) / avgCharPx))
                  : Math.max(6, Math.floor(titleAvailPx / avgCharPx))
              const displayTitle = truncateTitle(node.title, maxTitleChars)

              // Tier 0 compact circle when zoomed far out
              if (zoomTier === 0 && node.kind === 'node') {
                const circleR = Math.max(
                  14,
                  Math.min(24, Math.round(14 + Math.log2(1 + node.totalDescendants) * 2)),
                )
                return (
                  <g
                    key={id}
                    ref={(el) => {
                      if (el) nodeGroupRefs.current.set(id, el)
                      else nodeGroupRefs.current.delete(id)
                    }}
                    data-node-id={id}
                    transform={`translate(${node.x},${node.y})`}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      onFocusChange(id)
                    }}
                  >
                    {node.isFocus ? (
                      <circle
                        r={circleR + 5}
                        fill="none"
                        stroke={branchColor}
                        strokeWidth={5}
                        opacity={0.26}
                      />
                    ) : null}
                    <circle
                      r={circleR}
                      fill={fillColor}
                      stroke={node.isFocus ? 'var(--fg)' : borderColor}
                      strokeWidth={node.isFocus ? 2.5 : 1.75}
                    />
                    {statusColor ? (
                      <circle cx={circleR - 3} cy={-circleR + 3} r={4.5} fill={statusColor} />
                    ) : null}
                    {(node.depth === 1 || node.isFocus) && (
                      <text
                        y={circleR + 14}
                        textAnchor="middle"
                        fill="var(--fg)"
                        fontSize={11}
                        fontWeight={600}
                        className="pointer-events-none"
                      >
                        {truncateTitle(node.title, 18)}
                        {badgeStr ? ` ${badgeStr}` : ''}
                      </text>
                    )}
                    <title>
                      {node.title} ({node.totalDescendants} descendants)
                    </title>
                  </g>
                )
              }

              // Overflow +N bubble
              if (node.kind === 'overflow') {
                return (
                  <g
                    key={id}
                    ref={(el) => {
                      if (el) nodeGroupRefs.current.set(id, el)
                      else nodeGroupRefs.current.delete(id)
                    }}
                    data-node-id={id}
                    data-testid={`overflow-bubble-${node.overflowParentId}`}
                    transform={`translate(${node.x},${node.y})`}
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (node.overflowParentId) {
                        onExpandOverflow(node.overflowParentId)
                      }
                    }}
                  >
                    <rect
                      x={-node.width / 2}
                      y={-node.height / 2}
                      width={node.width}
                      height={node.height}
                      rx={16}
                      ry={16}
                      fill="var(--surface-2)"
                      stroke="var(--accent)"
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                    />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill="var(--accent)"
                      fontSize={12}
                      fontWeight={700}
                    >
                      {node.title}
                    </text>
                    <title>Show {node.overflowCount} hidden sibling nodes</title>
                  </g>
                )
              }

              // Tier 1 & Tier 2 Pill Card (comfortable size to read & click)
              const rx = node.kind === 'root' ? 22 : 12
              return (
                <g
                  key={id}
                  ref={(el) => {
                    if (el) nodeGroupRefs.current.set(id, el)
                    else nodeGroupRefs.current.delete(id)
                  }}
                  data-node-id={id}
                  transform={`translate(${node.x},${node.y})`}
                  className="cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation()
                    onFocusChange(id)
                  }}
                >
                  {node.isFocus ? (
                    <rect
                      x={-node.width / 2 - 4}
                      y={-node.height / 2 - 4}
                      width={node.width + 8}
                      height={node.height + 8}
                      rx={rx + 4}
                      ry={rx + 4}
                      fill="none"
                      stroke={borderColor}
                      strokeWidth={5}
                      opacity={0.26}
                    />
                  ) : null}
                  <rect
                    x={-node.width / 2}
                    y={-node.height / 2}
                    width={node.width}
                    height={node.height}
                    rx={rx}
                    ry={rx}
                    fill={fillColor}
                    stroke={borderColor}
                    strokeWidth={node.isFocus ? 2.4 : node.isOnFocusPath ? 1.8 : 1.3}
                  />

                  {/* Branch accent dot / mastery status dot */}
                  <circle
                    cx={-node.width / 2 + 14}
                    cy={zoomTier === 2 && node.kind === 'node' ? -5 : 0}
                    r={node.kind === 'root' ? 5.5 : 4.5}
                    fill={statusColor ?? branchColor}
                  />

                  {/* Title text */}
                  <text
                    x={-node.width / 2 + 25}
                    y={zoomTier === 2 && node.kind === 'node' ? -1 : 4}
                    fill="var(--fg)"
                    fontSize={node.kind === 'root' ? 13 : node.isGrandchildPreview ? 11.5 : 12.5}
                    fontWeight={node.isFocus || node.kind === 'root' ? 700 : 500}
                  >
                    {displayTitle}
                  </text>

                  {/* Descendant count badge '· N' */}
                  {hasBadge ? (
                    <text
                      x={node.width / 2 - 10}
                      y={zoomTier === 2 && node.kind === 'node' ? -1 : 4}
                      textAnchor="end"
                      fill="var(--fg-muted)"
                      fontSize={11}
                      fontWeight={600}
                    >
                      {badgeStr}
                    </text>
                  ) : null}

                  {/* Tier 2 extra metadata row: status label + type */}
                  {zoomTier === 2 && node.kind === 'node' ? (
                    <text
                      x={-node.width / 2 + 25}
                      y={14}
                      fill={statusColor ?? 'var(--fg-muted)'}
                      fontSize={10}
                      fontWeight={600}
                    >
                      {truncateTitle(
                        `${node.type}${node.status !== 'none' ? ` · ${node.status}` : ''}${
                          node.tags[0] ? ` · #${node.tags[0]}` : ''
                        }`,
                        Math.max(8, Math.floor((node.width - 36) / 5.8)),
                      )}
                    </text>
                  ) : null}

                  <title>
                    {node.title}
                    {node.totalDescendants > 0 ? ` (${node.totalDescendants} descendants)` : ''}
                    {node.status !== 'none' ? ` [${node.status}]` : ''}
                  </title>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {/* Bottom-left subtle live zoom readout updated directly via DOM ref */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
        <span ref={zoomBadgeRef}>100% · Tier {zoomTier}</span>
      </div>
    </div>
  )
}
