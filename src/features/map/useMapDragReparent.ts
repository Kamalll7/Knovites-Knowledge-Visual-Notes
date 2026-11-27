import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ComputeVisibleResult, MapLayoutResult } from '@/domain/layout'
import type { TreeState } from '@/domain/tree'
import type { CameraTransform } from '@/features/map/map-camera'
import {
  DRAG_REPARENT_THRESHOLD_PX,
  canStartNodeDrag,
  evaluateDragDropTarget,
  findDropTargetAtWorldPoint,
  screenPointToWorldPoint,
  type DragDropEvaluation,
} from '@/features/map/map-drag-reparent'

export interface ActiveDragReparentState {
  readonly draggedNodeId: string
  readonly draggedTitle: string
  readonly worldX: number
  readonly worldY: number
  readonly evaluation: DragDropEvaluation
}

export interface UseMapDragReparentOptions {
  readonly tree?: TreeState
  readonly layout: MapLayoutResult
  readonly visible: ComputeVisibleResult
  readonly svgRef: React.RefObject<SVGSVGElement | null>
  readonly getCameraTransform: () => CameraTransform
  readonly writeDisabled?: boolean
  readonly onReparentNode?: (nodeId: string, newParentId: string | null) => void | Promise<void>
}

interface PendingDragSession {
  readonly pointerId: number
  readonly nodeId: string
  readonly title: string
  readonly startClientX: number
  readonly startClientY: number
  active: boolean
  evaluation: DragDropEvaluation
}

/**
 * Manages thresholded pointer drag-and-drop node reparenting (`FR-MAP-15`) without disturbing
 * clicks, double-clicks, or `d3-zoom` background panning. Supports `Escape` cancel and clean no-op
 * on invalid or empty-space drops.
 */
export function useMapDragReparent({
  tree,
  layout,
  visible,
  svgRef,
  getCameraTransform,
  writeDisabled = false,
  onReparentNode,
}: UseMapDragReparentOptions) {
  const [dragState, setDragState] = useState<ActiveDragReparentState | null>(null)
  const sessionRef = useRef<PendingDragSession | null>(null)
  const suppressClickRef = useRef(false)

  const treeRef = useRef(tree)
  const layoutRef = useRef(layout)
  const visibleRef = useRef(visible)
  const getCameraRef = useRef(getCameraTransform)
  const onReparentRef = useRef(onReparentNode)

  useEffect(() => {
    treeRef.current = tree
    layoutRef.current = layout
    visibleRef.current = visible
    getCameraRef.current = getCameraTransform
    onReparentRef.current = onReparentNode
  })

  const clearSession = useCallback(() => {
    sessionRef.current = null
    setDragState(null)
  }, [])

  const isNodeDraggable = useCallback(
    (nodeId: string): boolean => {
      if (!tree || !onReparentNode) return false
      return canStartNodeDrag(tree, nodeId, writeDisabled)
    },
    [onReparentNode, tree, writeDisabled],
  )

  const handleNodePointerDown = useCallback(
    (nodeId: string, event: ReactPointerEvent<SVGGElement>) => {
      if (event.button !== 0) return
      const currentTree = treeRef.current
      if (!currentTree || !onReparentRef.current) return
      if (!canStartNodeDrag(currentTree, nodeId, writeDisabled)) return

      const vNode = visibleRef.current.nodes[nodeId]
      const nodeMeta = currentTree.nodes[nodeId]
      const title = vNode?.title ?? nodeMeta?.meta.title ?? nodeId

      sessionRef.current = {
        pointerId: event.pointerId,
        nodeId,
        title,
        startClientX: event.clientX,
        startClientY: event.clientY,
        active: false,
        evaluation: { status: 'none', targetId: null },
      }
    },
    [writeDisabled],
  )

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = sessionRef.current
      const currentTree = treeRef.current
      const svg = svgRef.current
      if (!session || !currentTree || !svg) return

      const dist = Math.hypot(
        event.clientX - session.startClientX,
        event.clientY - session.startClientY,
      )
      if (!session.active) {
        if (dist < DRAG_REPARENT_THRESHOLD_PX) return
        session.active = true
      }

      const rect = svg.getBoundingClientRect()
      const world = screenPointToWorldPoint(
        event.clientX,
        event.clientY,
        rect,
        getCameraRef.current(),
      )
      const hitTargetId = findDropTargetAtWorldPoint(
        world.x,
        world.y,
        layoutRef.current,
        session.nodeId,
      )
      const evaluation = evaluateDragDropTarget(currentTree, session.nodeId, hitTargetId)
      session.evaluation = evaluation

      setDragState({
        draggedNodeId: session.nodeId,
        draggedTitle: session.title,
        worldX: world.x,
        worldY: world.y,
        evaluation,
      })
    }

    const handlePointerUp = () => {
      const session = sessionRef.current
      if (!session) return
      const wasActive = session.active
      const evalResult = session.evaluation
      const nodeId = session.nodeId
      clearSession()

      if (wasActive) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        if (evalResult.status === 'valid') {
          void onReparentRef.current?.(nodeId, evalResult.newParentId)
        }
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const session = sessionRef.current
      if (!session || !session.active) return
      event.preventDefault()
      event.stopImmediatePropagation()
      clearSession()
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [clearSession, svgRef])

  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }, [])

  return {
    dragState,
    isNodeDraggable,
    handleNodePointerDown,
    consumeSuppressedClick,
  }
}
