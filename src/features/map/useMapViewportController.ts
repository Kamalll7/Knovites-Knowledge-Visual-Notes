import { select } from 'd3-selection'
import { ZoomTransform, zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { ComputeVisibleResult, MapLayoutResult, ZoomTier } from '@/domain/layout'
import type { EdgeDomRefs } from '@/features/map/MapEdges'
import type { MapBoundingBox } from '@/features/map/map-bounds'
import {
  MAP_FOCUS_TRANSITION_MS,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  ZERO_HUD_INSETS,
  buildTransitionStartPositions,
  centerCameraOnWorldPoint,
  clampCameraTransform,
  computeCameraForFocus,
  interpolateCamera,
  interpolateNodePositions,
  resolveViewportZoomTier,
  stepZoomCamera,
  type CameraHudInsets,
  type CameraTransform,
  type NodeTransitionState,
} from '@/features/map/map-camera'
import {
  computeLiveEdgePath,
  type MapEdgeOrientation,
  type RenderedMapEdge,
} from '@/features/map/map-edge-path'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function applyEdgeFrameToDom(
  edgeDomMap: ReadonlyMap<string, EdgeDomRefs>,
  posMap: ReadonlyMap<string, NodeTransitionState>,
  currentLayout: MapLayoutResult,
  currentEdges: readonly RenderedMapEdge[],
  currentOrientation: MapEdgeOrientation,
  settled: boolean,
): void {
  for (const edge of currentEdges) {
    const dom = edgeDomMap.get(edge.id)
    if (!dom) continue
    if (settled) {
      dom.path?.setAttribute('d', edge.d)
      dom.halo?.setAttribute('d', edge.d)
      if (dom.group) dom.group.style.opacity = ''
      if (dom.gradient) {
        const { sx, sy, tx, ty } = edge.controlPoints
        dom.gradient.setAttribute('x1', String(sx))
        dom.gradient.setAttribute('y1', String(sy))
        dom.gradient.setAttribute('x2', String(tx))
        dom.gradient.setAttribute('y2', String(ty))
      }
      continue
    }
    const srcNode = currentLayout.nodes[edge.sourceId]
    const dstNode = currentLayout.nodes[edge.targetId]
    const srcPos = posMap.get(edge.sourceId)
    const dstPos = posMap.get(edge.targetId)
    if (!srcNode || !dstNode || !srcPos || !dstPos) continue
    const live = computeLiveEdgePath(srcNode, dstNode, srcPos, dstPos, currentOrientation)
    dom.path?.setAttribute('d', live.d)
    dom.halo?.setAttribute('d', live.d)
    if (dom.group) {
      const edgeOpacity = Math.min(srcPos.opacity, dstPos.opacity)
      dom.group.style.opacity = edgeOpacity < 1 ? edgeOpacity.toFixed(3) : ''
    }
    if (dom.gradient) {
      const { sx, sy, tx, ty } = live.controlPoints
      dom.gradient.setAttribute('x1', String(sx))
      dom.gradient.setAttribute('y1', String(sy))
      dom.gradient.setAttribute('x2', String(tx))
      dom.gradient.setAttribute('y2', String(ty))
    }
  }
}

export interface UseMapViewportControllerOptions {
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly svgRef: React.RefObject<SVGSVGElement | null>
  readonly cameraGroupRef: React.RefObject<SVGGElement | null>
  readonly nodeGroupRefs: React.RefObject<Map<string, SVGGElement>>
  readonly edgeRefs: React.RefObject<Map<string, EdgeDomRefs>>
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly renderedEdges: readonly RenderedMapEdge[]
  readonly bbox: MapBoundingBox
  readonly focusId: string
  readonly orientation: MapEdgeOrientation
  readonly nonRootCount: number
  readonly hudInsets?: CameraHudInsets
  readonly onScaleTierChange?: (scale: number, tier: ZoomTier) => void
  readonly onFrameSample?: (dtMs: number) => void
  readonly onCameraChange?: (
    transform: CameraTransform,
    viewport: { width: number; height: number },
  ) => void
}

/**
 * Manages `d3-zoom` pan/zoom clamping (via `.constrain`), `requestAnimationFrame` focus
 * transitions for camera, nodes, and edges via DOM refs (zero React re-renders per frame,
 * `FR-MAP-05`, `FR-MAP-17`), and transition-frozen semantic zoom tier feedback.
 */
export function useMapViewportController({
  containerRef,
  svgRef,
  cameraGroupRef,
  nodeGroupRefs,
  edgeRefs,
  layout,
  visible,
  renderedEdges,
  bbox,
  focusId,
  orientation,
  nonRootCount,
  hudInsets = ZERO_HUD_INSETS,
  onScaleTierChange,
  onFrameSample,
  onCameraChange,
}: UseMapViewportControllerOptions) {
  const hasNodes = nonRootCount > 0

  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const cameraRef = useRef<CameraTransform>({ x: 640, y: 360, k: 1 })
  const liveNodePositionsRef = useRef<Map<string, NodeTransitionState>>(new Map())
  const rafIdRef = useRef<number | null>(null)
  const interactionPerfRafRef = useRef<number | null>(null)
  const isTransitioningRef = useRef(false)
  const isAnimatingNodesRef = useRef(false)
  const transitionLayoutRef = useRef<MapLayoutResult | null>(null)
  const isSyncingZoomRef = useRef(false)
  const prevTransitionKeyRef = useRef<{
    readonly focusId: string
    readonly orientation: MapEdgeOrientation
    readonly rootId: string
    readonly hasNodes: boolean
  } | null>(null)
  const lastReportedRef = useRef<{ scale: number; tier: ZoomTier }>({ scale: 1, tier: layout.tier })

  // Keep latest props accessible inside stable d3-zoom / RAF callbacks without tearing down listeners
  const bboxRef = useRef(bbox)
  const layoutRef = useRef(layout)
  const visibleRef = useRef(visible)
  const renderedEdgesRef = useRef(renderedEdges)
  const orientationRef = useRef(orientation)
  const focusIdRef = useRef(focusId)
  const hudInsetsRef = useRef(hudInsets)
  const onScaleTierChangeRef = useRef(onScaleTierChange)
  const onFrameSampleRef = useRef(onFrameSample)
  const onCameraChangeRef = useRef(onCameraChange)
  const viewportSizeRef = useRef<{ width: number; height: number }>({ width: 1280, height: 700 })

  useLayoutEffect(() => {
    bboxRef.current = bbox
    layoutRef.current = layout
    visibleRef.current = visible
    renderedEdgesRef.current = renderedEdges
    orientationRef.current = orientation
    focusIdRef.current = focusId
    hudInsetsRef.current = hudInsets
    onScaleTierChangeRef.current = onScaleTierChange
    onFrameSampleRef.current = onFrameSample
    onCameraChangeRef.current = onCameraChange
  })

  const getViewportSize = useCallback((): { width: number; height: number } => {
    const rect = containerRef.current?.getBoundingClientRect()
    const size = {
      width: rect && rect.width > 0 ? rect.width : 1280,
      height: rect && rect.height > 0 ? rect.height : 700,
    }
    viewportSizeRef.current = size
    return size
  }, [containerRef])

  const applyCameraToDom = useCallback(
    (next: CameraTransform) => {
      cameraRef.current = next
      cameraGroupRef.current?.setAttribute(
        'transform',
        `translate(${next.x.toFixed(2)}, ${next.y.toFixed(2)}) scale(${next.k.toFixed(4)})`,
      )
      onCameraChangeRef.current?.(next, viewportSizeRef.current)
    },
    [cameraGroupRef],
  )

  const syncZoomBehaviorTransform = useCallback(
    (next: CameraTransform) => {
      const svg = svgRef.current
      const behavior = zoomBehaviorRef.current
      if (!svg || !behavior) return
      isSyncingZoomRef.current = true
      select(svg).call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.k))
      isSyncingZoomRef.current = false
    },
    [svgRef],
  )

  const notifyScaleTier = useCallback((scale: number, force = false) => {
    if (isTransitioningRef.current && !force) return
    const resolved = resolveViewportZoomTier(scale)
    const prev = lastReportedRef.current
    if (force || Math.abs(scale - prev.scale) >= 0.015 || resolved.tier !== prev.tier) {
      lastReportedRef.current = { scale, tier: resolved.tier }
      onScaleTierChangeRef.current?.(scale, resolved.tier)
    }
  }, [])

  const stopInteractionPerfRaf = useCallback(() => {
    if (interactionPerfRafRef.current !== null) {
      cancelAnimationFrame(interactionPerfRafRef.current)
      interactionPerfRafRef.current = null
    }
  }, [])

  const startInteractionPerfRaf = useCallback(() => {
    if (!onFrameSampleRef.current || interactionPerfRafRef.current !== null) return
    let lastTs: number | null = null
    const tick = (now: number) => {
      if (lastTs !== null) {
        onFrameSampleRef.current?.(now - lastTs)
      }
      lastTs = now
      interactionPerfRafRef.current = requestAnimationFrame(tick)
    }
    interactionPerfRafRef.current = requestAnimationFrame(tick)
  }, [])

  const cancelAnimation = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    isTransitioningRef.current = false
    isAnimatingNodesRef.current = false
    transitionLayoutRef.current = null
  }, [])

  const animateCameraAndNodes = useCallback(
    (targetCam: CameraTransform, animateNodes: boolean) => {
      cancelAnimation()
      const reduced = prefersReducedMotion()
      const currentLayout = layoutRef.current
      const currentVisible = visibleRef.current
      const currentEdges = renderedEdgesRef.current
      const currentOrientation = orientationRef.current
      const startCam = cameraRef.current
      const startPositions = animateNodes
        ? buildTransitionStartPositions(liveNodePositionsRef.current, currentLayout, currentVisible)
        : liveNodePositionsRef.current

      const applyFrame = (rawT: number) => {
        const cam = interpolateCamera(startCam, targetCam, rawT, reduced)
        applyCameraToDom(cam)
        if (
          animateNodes &&
          (reduced ||
            (isAnimatingNodesRef.current && transitionLayoutRef.current === currentLayout))
        ) {
          const posMap = interpolateNodePositions(startPositions, currentLayout, rawT, reduced)
          liveNodePositionsRef.current = posMap
          const groupMap = nodeGroupRefs.current
          for (const [id, st] of posMap.entries()) {
            const el = groupMap.get(id)
            if (!el) continue
            const scalePart = st.scale !== 1 ? ` scale(${st.scale.toFixed(3)})` : ''
            el.setAttribute(
              'transform',
              `translate(${st.x.toFixed(2)}, ${st.y.toFixed(2)})${scalePart}`,
            )
            el.style.opacity = st.opacity < 1 ? st.opacity.toFixed(3) : ''
          }
          applyEdgeFrameToDom(
            edgeRefs.current,
            posMap,
            currentLayout,
            currentEdges,
            currentOrientation,
            reduced || rawT >= 1,
          )
        }
      }

      if (reduced) {
        applyFrame(1)
        syncZoomBehaviorTransform(targetCam)
        notifyScaleTier(targetCam.k, true)
        return
      }

      isTransitioningRef.current = true
      isAnimatingNodesRef.current = animateNodes
      transitionLayoutRef.current = animateNodes ? currentLayout : null
      stopInteractionPerfRaf()
      applyFrame(0)
      const tStart = performance.now()
      let lastRafTs: number | null = null

      const step = (now: number) => {
        if (lastRafTs !== null) {
          onFrameSampleRef.current?.(now - lastRafTs)
        }
        lastRafTs = now
        const rawT = Math.min(1, (now - tStart) / MAP_FOCUS_TRANSITION_MS)
        applyFrame(rawT)
        if (rawT < 1) {
          rafIdRef.current = requestAnimationFrame(step)
        } else {
          rafIdRef.current = null
          isTransitioningRef.current = false
          isAnimatingNodesRef.current = false
          transitionLayoutRef.current = null
          syncZoomBehaviorTransform(targetCam)
          notifyScaleTier(targetCam.k, true)
        }
      }
      rafIdRef.current = requestAnimationFrame(step)
    },
    [
      applyCameraToDom,
      cancelAnimation,
      edgeRefs,
      nodeGroupRefs,
      notifyScaleTier,
      stopInteractionPerfRaf,
      syncZoomBehaviorTransform,
    ],
  )

  // Setup d3-zoom ONCE per empty<->non-empty lifecycle (reads bbox via ref, enforces pan clamp in .constrain)
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || !hasNodes) return

    const behavior = zoom<SVGSVGElement, unknown>()
      .extent(() => {
        const { width, height } = getViewportSize()
        return [
          [0, 0],
          [width, height],
        ]
      })
      .scaleExtent([MAP_ZOOM_MIN, MAP_ZOOM_MAX])
      .constrain((transform, extent) => {
        const width = extent[1][0] - extent[0][0]
        const height = extent[1][1] - extent[0][1]
        const clamped = clampCameraTransform(
          { x: transform.x, y: transform.y, k: transform.k },
          bboxRef.current,
          width,
          height,
        )
        if (clamped.x === transform.x && clamped.y === transform.y && clamped.k === transform.k) {
          return transform
        }
        return new ZoomTransform(clamped.k, clamped.x, clamped.y)
      })
      .filter((event: Event) => event.type !== 'dblclick')
      .on('start', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isSyncingZoomRef.current || !event.sourceEvent) return
        if (isTransitioningRef.current) {
          cancelAnimation()
        }
        startInteractionPerfRaf()
      })
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isSyncingZoomRef.current) return
        if (event.sourceEvent && isTransitioningRef.current) {
          cancelAnimation()
        }
        const next: CameraTransform = {
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        }
        applyCameraToDom(next)
        notifyScaleTier(next.k)
      })
      .on('end', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isSyncingZoomRef.current || !event.sourceEvent) return
        stopInteractionPerfRaf()
      })

    zoomBehaviorRef.current = behavior
    select(svg).call(behavior)
    if (prevTransitionKeyRef.current !== null) {
      syncZoomBehaviorTransform(cameraRef.current)
    }
    return () => {
      stopInteractionPerfRaf()
      cancelAnimation()
      select(svg).on('.zoom', null)
      zoomBehaviorRef.current = null
    }
  }, [
    applyCameraToDom,
    cancelAnimation,
    getViewportSize,
    hasNodes,
    notifyScaleTier,
    startInteractionPerfRaf,
    stopInteractionPerfRaf,
    svgRef,
    syncZoomBehaviorTransform,
  ])

  // Initial fit-all camera & smooth focus/orientation/root transitions (runs BEFORE layout sync!)
  useLayoutEffect(() => {
    if (!hasNodes) {
      prevTransitionKeyRef.current = null
      return
    }
    const { width, height } = getViewportSize()
    const currentLayout = layoutRef.current
    const prev = prevTransitionKeyRef.current
    const nextKey = { focusId, orientation, rootId: layout.rootId, hasNodes }
    if (prev === null) {
      prevTransitionKeyRef.current = nextKey
      const targetCam = computeCameraForFocus(
        currentLayout,
        focusId,
        width,
        height,
        'fit-all',
        hudInsetsRef.current,
        cameraRef.current.k,
      )
      const initialPositions = new Map<string, NodeTransitionState>()
      for (const id of currentLayout.orderedIds) {
        const n = currentLayout.nodes[id]
        if (n) initialPositions.set(id, { x: n.x, y: n.y, scale: 1, opacity: 1 })
      }
      liveNodePositionsRef.current = initialPositions
      applyCameraToDom(targetCam)
      syncZoomBehaviorTransform(targetCam)
      notifyScaleTier(targetCam.k, true)
      return
    }
    if (
      prev.focusId === nextKey.focusId &&
      prev.orientation === nextKey.orientation &&
      prev.rootId === nextKey.rootId &&
      prev.hasNodes === nextKey.hasNodes
    ) {
      // React StrictMode effect re-invocation with identical props: keep camera synced without a bogus transition
      applyCameraToDom(cameraRef.current)
      syncZoomBehaviorTransform(cameraRef.current)
      return
    }
    prevTransitionKeyRef.current = nextKey
    const targetCam = computeCameraForFocus(
      currentLayout,
      focusId,
      width,
      height,
      'focus',
      hudInsetsRef.current,
      cameraRef.current.k,
    )
    animateCameraAndNodes(targetCam, true)
    // Intentionally triggered ONLY on focus, orientation, root, or empty->non-empty transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, orientation, layout.rootId, hasNodes])

  // Always sync DOM nodes & edges whenever layout changes without a matching active node transition
  // (e.g. semantic zoom tier T1 <-> T2 <-> T0, +N overflow expand, or font re-measure — even during camera zoom/fit)
  useLayoutEffect(() => {
    if (!hasNodes) return
    if (isAnimatingNodesRef.current && transitionLayoutRef.current === layout) return
    // Disarm any stale node interpolation from a previous layout/tier so RAF cannot overwrite new-tier DOM nodes/edges
    isAnimatingNodesRef.current = false
    transitionLayoutRef.current = null
    const synced = new Map<string, NodeTransitionState>()
    for (const id of layout.orderedIds) {
      const n = layout.nodes[id]
      if (!n) continue
      synced.set(id, { x: n.x, y: n.y, scale: 1, opacity: 1 })
      const el = nodeGroupRefs.current.get(id)
      if (el) {
        el.setAttribute('transform', `translate(${n.x}, ${n.y})`)
        el.style.opacity = ''
      }
    }
    liveNodePositionsRef.current = synced
    applyEdgeFrameToDom(edgeRefs.current, synced, layout, renderedEdges, orientation, true)
  }, [edgeRefs, hasNodes, layout, nodeGroupRefs, orientation, renderedEdges])

  const zoomIn = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      stepZoomCamera(cameraRef.current, 'in', width, height, bboxRef.current),
      false,
    )
  }, [animateCameraAndNodes, getViewportSize])

  const zoomOut = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      stepZoomCamera(cameraRef.current, 'out', width, height, bboxRef.current),
      false,
    )
  }, [animateCameraAndNodes, getViewportSize])

  const fitAll = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      computeCameraForFocus(
        layoutRef.current,
        focusIdRef.current,
        width,
        height,
        'fit-all',
        hudInsetsRef.current,
        cameraRef.current.k,
      ),
      false,
    )
  }, [animateCameraAndNodes, getViewportSize])

  const recenterFocus = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      computeCameraForFocus(
        layoutRef.current,
        focusIdRef.current,
        width,
        height,
        'focus',
        hudInsetsRef.current,
        cameraRef.current.k,
      ),
      false,
    )
  }, [animateCameraAndNodes, getViewportSize])

  const panToWorldPoint = useCallback(
    (worldX: number, worldY: number, options?: { immediate?: boolean }) => {
      const { width, height } = getViewportSize()
      const targetCam = centerCameraOnWorldPoint(
        worldX,
        worldY,
        cameraRef.current.k,
        width,
        height,
        bboxRef.current,
        hudInsetsRef.current,
      )
      if (options?.immediate) {
        cancelAnimation()
        applyCameraToDom(targetCam)
        syncZoomBehaviorTransform(targetCam)
        notifyScaleTier(targetCam.k, true)
        return
      }
      animateCameraAndNodes(targetCam, false)
    },
    [
      animateCameraAndNodes,
      applyCameraToDom,
      cancelAnimation,
      getViewportSize,
      notifyScaleTier,
      syncZoomBehaviorTransform,
    ],
  )

  const getTransform = useCallback(() => cameraRef.current, [])

  return { zoomIn, zoomOut, fitAll, recenterFocus, panToWorldPoint, getTransform }
}
