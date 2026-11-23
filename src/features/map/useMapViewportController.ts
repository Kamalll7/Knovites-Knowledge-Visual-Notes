import { select } from 'd3-selection'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom'
import { useCallback, useEffect, useRef } from 'react'
import type { ComputeVisibleResult, MapLayoutResult, ZoomTier } from '@/domain/layout'
import type { MapBoundingBox } from '@/features/map/map-bounds'
import {
  MAP_FOCUS_TRANSITION_MS,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  buildTransitionStartPositions,
  clampCameraTransform,
  computeCameraForFocus,
  interpolateCamera,
  interpolateNodePositions,
  resolveViewportZoomTier,
  stepZoomCamera,
  type CameraTransform,
  type NodeTransitionState,
} from '@/features/map/map-camera'
import type { MapEdgeOrientation } from '@/features/map/map-edge-path'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface UseMapViewportControllerOptions {
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly svgRef: React.RefObject<SVGSVGElement | null>
  readonly cameraGroupRef: React.RefObject<SVGGElement | null>
  readonly nodeGroupRefs: React.RefObject<Map<string, SVGGElement>>
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly bbox: MapBoundingBox
  readonly focusId: string
  readonly orientation: MapEdgeOrientation
  readonly nonRootCount: number
  readonly onScaleTierChange?: (scale: number, tier: ZoomTier) => void
  readonly onFrameSample?: (dtMs: number) => void
}

/**
 * Manages `d3-zoom` pan/zoom clamping, `requestAnimationFrame` focus transitions via DOM refs
 * (zero React re-renders per frame, `FR-MAP-17`), and transition-frozen semantic zoom tier feedback.
 */
export function useMapViewportController({
  containerRef,
  svgRef,
  cameraGroupRef,
  nodeGroupRefs,
  layout,
  visible,
  bbox,
  focusId,
  orientation,
  nonRootCount,
  onScaleTierChange,
  onFrameSample,
}: UseMapViewportControllerOptions) {
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const cameraRef = useRef<CameraTransform>({ x: 640, y: 360, k: 1 })
  const liveNodePositionsRef = useRef<Map<string, NodeTransitionState>>(new Map())
  const rafIdRef = useRef<number | null>(null)
  const isTransitioningRef = useRef(false)
  const hasInitializedCameraRef = useRef(false)
  const lastReportedRef = useRef<{ scale: number; tier: ZoomTier }>({ scale: 1, tier: layout.tier })

  const getViewportSize = useCallback((): { width: number; height: number } => {
    const rect = containerRef.current?.getBoundingClientRect()
    return {
      width: rect && rect.width > 0 ? rect.width : 1280,
      height: rect && rect.height > 0 ? rect.height : 700,
    }
  }, [containerRef])

  const applyCameraToDom = useCallback(
    (next: CameraTransform) => {
      cameraRef.current = next
      cameraGroupRef.current?.setAttribute(
        'transform',
        `translate(${next.x.toFixed(2)}, ${next.y.toFixed(2)}) scale(${next.k.toFixed(4)})`,
      )
    },
    [cameraGroupRef],
  )

  const syncZoomBehaviorTransform = useCallback(
    (next: CameraTransform) => {
      const svg = svgRef.current
      const behavior = zoomBehaviorRef.current
      if (!svg || !behavior) return
      isTransitioningRef.current = true
      select(svg).call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.k))
      isTransitioningRef.current = false
    },
    [svgRef],
  )

  const notifyScaleTier = useCallback(
    (scale: number, force = false) => {
      if (isTransitioningRef.current && !force) return
      const resolved = resolveViewportZoomTier(scale)
      const prev = lastReportedRef.current
      if (force || Math.abs(scale - prev.scale) >= 0.015 || resolved.tier !== prev.tier) {
        lastReportedRef.current = { scale, tier: resolved.tier }
        onScaleTierChange?.(scale, resolved.tier)
      }
    },
    [onScaleTierChange],
  )

  const cancelAnimation = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    isTransitioningRef.current = false
  }, [])

  const animateCameraAndNodes = useCallback(
    (targetCam: CameraTransform, animateNodes: boolean) => {
      cancelAnimation()
      const reduced = prefersReducedMotion()
      const startCam = cameraRef.current
      const startPositions = animateNodes
        ? buildTransitionStartPositions(liveNodePositionsRef.current, layout, visible)
        : liveNodePositionsRef.current

      const applyFrame = (rawT: number) => {
        const cam = interpolateCamera(startCam, targetCam, rawT, reduced)
        applyCameraToDom(cam)
        if (animateNodes) {
          const posMap = interpolateNodePositions(startPositions, layout, rawT, reduced)
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
        }
      }

      if (reduced) {
        applyFrame(1)
        syncZoomBehaviorTransform(targetCam)
        notifyScaleTier(targetCam.k, true)
        return
      }

      isTransitioningRef.current = true
      const tStart = performance.now()
      let lastTs = tStart

      const step = (now: number) => {
        onFrameSample?.(now - lastTs)
        lastTs = now
        const rawT = Math.min(1, (now - tStart) / MAP_FOCUS_TRANSITION_MS)
        applyFrame(rawT)
        if (rawT < 1) {
          rafIdRef.current = requestAnimationFrame(step)
        } else {
          rafIdRef.current = null
          isTransitioningRef.current = false
          syncZoomBehaviorTransform(targetCam)
          notifyScaleTier(targetCam.k, true)
        }
      }
      rafIdRef.current = requestAnimationFrame(step)
    },
    [
      applyCameraToDom,
      cancelAnimation,
      layout,
      nodeGroupRefs,
      notifyScaleTier,
      onFrameSample,
      syncZoomBehaviorTransform,
      visible,
    ],
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || nonRootCount === 0) return

    let lastZoomTs = performance.now()
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent(() => {
        const { width, height } = getViewportSize()
        return [
          [0, 0],
          [width, height],
        ]
      })
      .scaleExtent([MAP_ZOOM_MIN, MAP_ZOOM_MAX])
      .filter((event: Event) => event.type !== 'dblclick')
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isTransitioningRef.current) return
        const now = performance.now()
        onFrameSample?.(now - lastZoomTs)
        lastZoomTs = now
        const { width, height } = getViewportSize()
        const clamped = clampCameraTransform(
          { x: event.transform.x, y: event.transform.y, k: event.transform.k },
          bbox,
          width,
          height,
        )
        applyCameraToDom(clamped)
        notifyScaleTier(clamped.k)
      })

    zoomBehaviorRef.current = behavior
    select(svg).call(behavior)
    return () => {
      cancelAnimation()
      select(svg).on('.zoom', null)
      zoomBehaviorRef.current = null
    }
  }, [
    applyCameraToDom,
    bbox,
    cancelAnimation,
    getViewportSize,
    nonRootCount,
    notifyScaleTier,
    onFrameSample,
    svgRef,
  ])

  useEffect(() => {
    if (nonRootCount === 0) return
    const { width, height } = getViewportSize()
    const mode = hasInitializedCameraRef.current ? 'focus' : 'fit-all'
    const targetCam = computeCameraForFocus(layout, visible, focusId, width, height, mode)
    if (!hasInitializedCameraRef.current) {
      hasInitializedCameraRef.current = true
      const initialPositions = new Map<string, NodeTransitionState>()
      for (const id of layout.orderedIds) {
        const n = layout.nodes[id]
        if (n) initialPositions.set(id, { x: n.x, y: n.y, scale: 1, opacity: 1 })
      }
      liveNodePositionsRef.current = initialPositions
      applyCameraToDom(targetCam)
      syncZoomBehaviorTransform(targetCam)
      notifyScaleTier(targetCam.k, true)
      return
    }
    animateCameraAndNodes(targetCam, true)
    // Intentionally triggered on focus/orientation/root transitions, not every semantic zoom tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, orientation, layout.rootId, nonRootCount])

  const zoomIn = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(stepZoomCamera(cameraRef.current, 'in', width, height, bbox), false)
  }, [animateCameraAndNodes, bbox, getViewportSize])

  const zoomOut = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(stepZoomCamera(cameraRef.current, 'out', width, height, bbox), false)
  }, [animateCameraAndNodes, bbox, getViewportSize])

  const fitAll = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      computeCameraForFocus(layout, visible, focusId, width, height, 'fit-all'),
      false,
    )
  }, [animateCameraAndNodes, focusId, getViewportSize, layout, visible])

  const recenterFocus = useCallback(() => {
    const { width, height } = getViewportSize()
    animateCameraAndNodes(
      computeCameraForFocus(layout, visible, focusId, width, height, 'focus'),
      false,
    )
  }, [animateCameraAndNodes, focusId, getViewportSize, layout, visible])

  const getTransform = useCallback(() => cameraRef.current, [])

  return { zoomIn, zoomOut, fitAll, recenterFocus, getTransform }
}
