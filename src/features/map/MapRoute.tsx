import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMapOrientationPreference } from '@/app/map-preferences'
import { useTheme } from '@/app/theme-context'
import { useWorkspaceStore } from '@/app/workspace-context'
import {
  MAP_ROOT_ID,
  OVERFLOW_NODE_PREFIX,
  computeHorizontalLayout,
  computeRadialLayout,
  computeVisible,
  type MapLayoutResult,
  type ZoomTier,
} from '@/domain/layout'
import { MapHudControls } from '@/features/map/MapHudControls'
import { MapViewport, type MapViewportHandle } from '@/features/map/MapViewport'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'

/**
 * Main map route (`/`) wired to `useWorkspaceStore`, theme, persisted orientation (`T3.3b`),
 * interactive pan/zoom/semantic-zoom viewport (`T3.5`), and empty state (`FR-MAP-12`).
 */
export function MapRoute() {
  const tree = useWorkspaceStore((s) => s.tree)
  const createNode = useWorkspaceStore((s) => s.createNode)
  const { resolvedTheme } = useTheme()
  const { orientation, setOrientation } = useMapOrientationPreference()
  const navigate = useNavigate()

  const viewportRef = useRef<MapViewportHandle | null>(null)
  const [focusId, setFocusId] = useState<string>(MAP_ROOT_ID)
  const [expandedOverflowParentIds, setExpandedOverflowParentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [zoomScale, setZoomScale] = useState<number>(1)
  const [zoomTier, setZoomTier] = useState<ZoomTier>(1)
  const [fontVersion, setFontVersion] = useState(0)

  const measurer = useMemo(() => createCanvasTextMeasurer(), [])

  useEffect(() => {
    return measurer.subscribeFontChange((version) => {
      setFontVersion(version)
    })
  }, [measurer])

  const effectiveFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID
  const hasNodes = tree.rootIds.length > 0

  const visible = useMemo(
    () =>
      computeVisible({
        tree,
        rootTitle: 'Knowledge Map',
        focusId: effectiveFocusId,
        expandedOverflowParentIds,
        zoomTier,
      }),
    [tree, effectiveFocusId, expandedOverflowParentIds, zoomTier],
  )

  const layout = useMemo<MapLayoutResult>(() => {
    void fontVersion
    if (orientation === 'horizontal') {
      return computeHorizontalLayout({
        visible,
        measureText: measurer.measure,
        scale: zoomScale,
        tier: zoomTier,
        config: MAP_CAPSULE_BOX_CONFIG,
      })
    }
    return computeRadialLayout({
      visible,
      measureText: measurer.measure,
      scale: zoomScale,
      tier: zoomTier,
      config: MAP_CAPSULE_BOX_CONFIG,
    })
  }, [visible, measurer, fontVersion, orientation, zoomScale, zoomTier])

  const handleSelectNode = useCallback((nodeId: string) => {
    if (nodeId.startsWith(OVERFLOW_NODE_PREFIX)) {
      const parentId = nodeId.slice(OVERFLOW_NODE_PREFIX.length)
      setExpandedOverflowParentIds((prev) => {
        const next = new Set(prev)
        next.add(parentId)
        return next
      })
      return
    }
    setFocusId(nodeId)
  }, [])

  const handleOpenNode = useCallback(
    (nodeId: string) => {
      if (nodeId.startsWith(OVERFLOW_NODE_PREFIX) || nodeId === MAP_ROOT_ID) return
      void navigate(`/n/${nodeId}`)
    },
    [navigate],
  )

  const handleCreateFirstNode = useCallback(() => {
    void createNode({ parentId: null, title: 'First Topic', type: 'concept' })
  }, [createNode])

  const handleScaleTierChange = useCallback((nextScale: number, nextTier: ZoomTier) => {
    setZoomScale(nextScale)
    setZoomTier(nextTier)
  }, [])

  return (
    <section className="flex h-[calc(100vh-3.5rem)] w-full flex-1 flex-col overflow-hidden">
      {hasNodes ? (
        <MapHudControls
          orientation={orientation}
          zoomScale={zoomScale}
          zoomTier={zoomTier}
          onOrientationChange={setOrientation}
          onZoomIn={() => viewportRef.current?.zoomIn()}
          onZoomOut={() => viewportRef.current?.zoomOut()}
          onFitAll={() => viewportRef.current?.fitAll()}
          onRecenterFocus={() => viewportRef.current?.recenterFocus()}
        />
      ) : null}
      <MapViewport
        ref={viewportRef}
        layout={layout}
        visible={visible}
        focusId={effectiveFocusId}
        orientation={orientation}
        theme={resolvedTheme}
        measureText={measurer.measure}
        onSelectNode={handleSelectNode}
        onOpenNode={handleOpenNode}
        onCreateFirstNode={handleCreateFirstNode}
        onScaleTierChange={handleScaleTierChange}
      />
    </section>
  )
}
