import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { MapSvgView } from '@/features/map/MapSvgView'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'

const DEFAULT_MAP_TIER: ZoomTier = 1
const DEFAULT_MAP_SCALE = 1

/**
 * Main map route (`/`) wired to `useWorkspaceStore` and active theme (`T3.4b`, `FR-MAP-01`, `FR-MAP-12`).
 * Recomputes text measurements and layout automatically when web fonts finish loading.
 */
export function MapRoute() {
  const tree = useWorkspaceStore((s) => s.tree)
  const createNode = useWorkspaceStore((s) => s.createNode)
  const { resolvedTheme } = useTheme()
  const { orientation } = useMapOrientationPreference()
  const navigate = useNavigate()

  const [focusId, setFocusId] = useState<string>(MAP_ROOT_ID)
  const [expandedOverflowParentIds, setExpandedOverflowParentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [fontVersion, setFontVersion] = useState(0)

  const measurer = useMemo(() => createCanvasTextMeasurer(), [])

  useEffect(() => {
    return measurer.subscribeFontChange((version) => {
      setFontVersion(version)
    })
  }, [measurer])

  const effectiveFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID

  const visible = useMemo(
    () =>
      computeVisible({
        tree,
        rootTitle: 'Knowledge Map',
        focusId: effectiveFocusId,
        expandedOverflowParentIds,
        zoomTier: DEFAULT_MAP_TIER,
      }),
    [tree, effectiveFocusId, expandedOverflowParentIds],
  )

  const layout = useMemo<MapLayoutResult>(() => {
    void fontVersion
    if (orientation === 'horizontal') {
      return computeHorizontalLayout({
        visible,
        measureText: measurer.measure,
        scale: DEFAULT_MAP_SCALE,
        tier: DEFAULT_MAP_TIER,
        config: MAP_CAPSULE_BOX_CONFIG,
      })
    }
    return computeRadialLayout({
      visible,
      measureText: measurer.measure,
      scale: DEFAULT_MAP_SCALE,
      tier: DEFAULT_MAP_TIER,
      config: MAP_CAPSULE_BOX_CONFIG,
    })
  }, [visible, measurer, fontVersion, orientation])

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

  return (
    <section className="flex h-[calc(100vh-3.5rem)] w-full flex-1 flex-col">
      <MapSvgView
        layout={layout}
        visible={visible}
        orientation={orientation}
        theme={resolvedTheme}
        measureText={measurer.measure}
        onSelectNode={handleSelectNode}
        onOpenNode={handleOpenNode}
        onCreateFirstNode={handleCreateFirstNode}
      />
    </section>
  )
}
