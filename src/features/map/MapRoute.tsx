import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate } from 'react-router'
import { useMapOrientationPreference } from '@/app/map-preferences'
import { getPageRouteForNode } from '@/app/store'
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
import type { NodeStatus, NodeType } from '@/domain/schema'
import { MapBreadcrumb } from '@/features/map/MapBreadcrumb'
import { MapHudControls, type MapViewMode } from '@/features/map/MapHudControls'
import { MapMinimap, type MapMinimapHandle } from '@/features/map/MapMinimap'
import { MapOutlineView } from '@/features/map/MapOutlineView'
import { MapViewport, type MapViewportHandle } from '@/features/map/MapViewport'
import { NodeActionToolbar } from '@/features/map/NodeActionToolbar'
import { DeleteNodeDialog, MoveNodeDialog } from '@/features/map/NodeCrudDialogs'
import { computeMapBoundingBox } from '@/features/map/map-bounds'
import { buildBreadcrumbTrail } from '@/features/map/map-breadcrumb'
import type { CameraTransform } from '@/features/map/map-camera'
import { collectWorkspaceCrossLinks } from '@/features/map/map-cross-links'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'
import { useMapKeyboard } from '@/features/map/useMapKeyboard'
import { Button } from '@/ui/components/button'

const PHASE1_NODE_TYPES: readonly Exclude<NodeType, 'lab'>[] = [
  'concept',
  'category',
  'technique',
  'challenge',
]

/**
 * Main map route (`/`) wired to `useWorkspaceStore`, theme, persisted orientation (`T3.3b`),
 * interactive pan/zoom/semantic-zoom viewport (`T3.5`), breadcrumb + keyboard navigation (`T3.7`),
 * Home (`__root__`) navigation (`M3-HomeRoot`), and empty state (`FR-MAP-12`).
 */
export function MapRoute() {
  const tree = useWorkspaceStore((s) => s.tree)
  const rootHome = useWorkspaceStore((s) => s.rootHome)
  const canvasCrossLinks = useWorkspaceStore((s) => s.canvasCrossLinks)
  const isReadOnlyTab = useWorkspaceStore((s) => s.isReadOnlyTab)
  const storageError = useWorkspaceStore((s) => s.storageError)
  const createNode = useWorkspaceStore((s) => s.createNode)
  const renameNode = useWorkspaceStore((s) => s.renameNode)
  const updateNodeMeta = useWorkspaceStore((s) => s.updateNodeMeta)
  const moveNode = useWorkspaceStore((s) => s.moveNode)
  const reorderNode = useWorkspaceStore((s) => s.reorderNode)
  const deleteNode = useWorkspaceStore((s) => s.deleteNode)
  const { resolvedTheme } = useTheme()
  const { orientation, setOrientation } = useMapOrientationPreference()
  const navigate = useNavigate()

  const viewportRef = useRef<MapViewportHandle | null>(null)
  const minimapRef = useRef<MapMinimapHandle | null>(null)
  const lastCameraRef = useRef<{
    transform: CameraTransform
    viewport: { width: number; height: number }
  } | null>(null)
  const [focusId, setFocusId] = useState<string>(MAP_ROOT_ID)
  const [viewMode, setViewMode] = useState<MapViewMode>('map')
  const [expandedOverflowParentIds, setExpandedOverflowParentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [zoomScale, setZoomScale] = useState<number>(1)
  const [zoomTier, setZoomTier] = useState<ZoomTier>(1)
  const [fontVersion, setFontVersion] = useState(0)
  const [keyboardFocusActive, setKeyboardFocusActive] = useState(false)
  const [toolbarInteractiveOpen, setToolbarInteractiveOpen] = useState(false)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Inline empty-state first-node creation form (FR-MAP-12, FR-NODE-01)
  const [creatingFirstNode, setCreatingFirstNode] = useState(false)
  const [firstNodeTitle, setFirstNodeTitle] = useState('')
  const [firstNodeType, setFirstNodeType] = useState<Exclude<NodeType, 'lab'>>('concept')
  const [firstNodeError, setFirstNodeError] = useState<string | null>(null)

  const measurer = useMemo(() => createCanvasTextMeasurer(), [])

  useEffect(() => {
    return measurer.subscribeFontChange((version) => {
      setFontVersion(version)
    })
  }, [measurer])

  const effectiveFocusId = focusId === MAP_ROOT_ID || tree.nodes[focusId] ? focusId : MAP_ROOT_ID
  const focusedNode =
    effectiveFocusId === MAP_ROOT_ID ? null : (tree.nodes[effectiveFocusId] ?? null)
  const siblingIds =
    focusedNode === null
      ? []
      : focusedNode.parentId === null
        ? tree.rootIds
        : (tree.nodes[focusedNode.parentId]?.childrenIds ?? [])
  const siblingIndex = focusedNode === null ? -1 : siblingIds.indexOf(focusedNode.id)
  const hasNodes = tree.rootIds.length > 0
  const writeDisabled = isReadOnlyTab || storageError !== null

  const breadcrumbItems = useMemo(
    () => buildBreadcrumbTrail(tree, effectiveFocusId, rootHome.title),
    [tree, effectiveFocusId, rootHome.title],
  )

  const visible = useMemo(
    () =>
      computeVisible({
        tree,
        rootTitle: rootHome.title,
        focusId: effectiveFocusId,
        expandedOverflowParentIds,
        zoomTier,
      }),
    [tree, rootHome.title, effectiveFocusId, expandedOverflowParentIds, zoomTier],
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

  const bbox = useMemo(() => computeMapBoundingBox(layout), [layout])
  const crossLinks = useMemo(
    () => collectWorkspaceCrossLinks(tree, canvasCrossLinks),
    [tree, canvasCrossLinks],
  )

  const handleCameraChange = useCallback(
    (transform: CameraTransform, viewport: { width: number; height: number }) => {
      lastCameraRef.current = { transform, viewport }
      minimapRef.current?.updateViewportRect(transform, viewport)
    },
    [],
  )

  const handleMinimapNavigate = useCallback(
    (worldX: number, worldY: number, options?: { immediate?: boolean }) => {
      viewportRef.current?.panToWorldPoint(worldX, worldY, options)
    },
    [],
  )

  useLayoutEffect(() => {
    if (hasNodes && viewMode === 'map' && lastCameraRef.current) {
      minimapRef.current?.updateViewportRect(
        lastCameraRef.current.transform,
        lastCameraRef.current.viewport,
      )
    }
  }, [hasNodes, viewMode])

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
    setKeyboardFocusActive(false)
    setFocusId(nodeId)
  }, [])

  const handleKeyboardFocusNode = useCallback((nodeId: string) => {
    setFocusId(nodeId)
  }, [])

  const handleKeyboardNavigate = useCallback(() => {
    setKeyboardFocusActive(true)
  }, [])

  const handleOpenNode = useCallback(
    (nodeId: string) => {
      if (nodeId.startsWith(OVERFLOW_NODE_PREFIX)) return
      void navigate(getPageRouteForNode(nodeId))
    },
    [navigate],
  )

  const handleOpenFirstNodeForm = useCallback(() => {
    setFirstNodeTitle('')
    setFirstNodeType('concept')
    setFirstNodeError(null)
    setCreatingFirstNode(true)
  }, [])

  const handleSubmitFirstNode = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const trimmed = firstNodeTitle.trim()
      if (trimmed.length === 0) {
        setFirstNodeError('Title is required.')
        return
      }
      const result = await createNode({
        parentId: null,
        title: trimmed,
        type: firstNodeType,
      })
      if (!result.ok) {
        setFirstNodeError(result.message)
        return
      }
      setCreatingFirstNode(false)
      setFirstNodeTitle('')
      setFirstNodeError(null)
      setFocusId(result.nodeId)
    },
    [createNode, firstNodeTitle, firstNodeType],
  )

  const handleCreateChild = useCallback(
    async (title: string, type: Exclude<NodeType, 'lab'>) => {
      const parentId = effectiveFocusId === MAP_ROOT_ID ? null : effectiveFocusId
      const result = await createNode({ parentId, title, type })
      if (!result.ok) return { ok: false, message: result.message }
      setFocusId(result.nodeId)
      return { ok: true }
    },
    [createNode, effectiveFocusId],
  )

  const handleRenameFocused = useCallback(
    async (title: string) => {
      const result = await renameNode({ nodeId: effectiveFocusId, title })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
    [effectiveFocusId, renameNode],
  )

  const handleUpdateFocusedMeta = useCallback(
    async (patch: {
      type?: NodeType
      status?: NodeStatus
      color?: string | null
      tags?: readonly string[]
    }) => {
      const result = await updateNodeMeta({ nodeId: effectiveFocusId, ...patch })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
    [effectiveFocusId, updateNodeMeta],
  )

  const handleReorderFocused = useCallback(
    async (direction: 'earlier' | 'later') => {
      await reorderNode({ nodeId: effectiveFocusId, direction })
    },
    [effectiveFocusId, reorderNode],
  )

  const handleConfirmMove = useCallback(
    async (newParentId: string | null) => {
      const result = await moveNode({ nodeId: effectiveFocusId, newParentId })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
    [effectiveFocusId, moveNode],
  )

  const handleDragReparent = useCallback(
    async (nodeId: string, newParentId: string | null) => {
      const result = await moveNode({ nodeId, newParentId })
      if (result.ok) {
        setFocusId(nodeId)
      }
    },
    [moveNode],
  )

  const handleConfirmDelete = useCallback(async () => {
    const fallbackFocusId = focusedNode?.parentId ?? MAP_ROOT_ID
    const result = await deleteNode(effectiveFocusId)
    if (!result.ok) return { ok: false, message: result.message }
    setFocusId(fallbackFocusId)
    return { ok: true }
  }, [deleteNode, effectiveFocusId, focusedNode])

  const handleScaleTierChange = useCallback((nextScale: number, nextTier: ZoomTier) => {
    setZoomScale(nextScale)
    setZoomTier(nextTier)
  }, [])

  useMapKeyboard({
    tree,
    focusId: effectiveFocusId,
    orientation,
    disabled:
      !hasNodes ||
      viewMode === 'outline' ||
      creatingFirstNode ||
      toolbarInteractiveOpen ||
      moveDialogOpen ||
      deleteDialogOpen,
    onFocusNode: handleKeyboardFocusNode,
    onOpenNode: handleOpenNode,
    onKeyboardNavigate: handleKeyboardNavigate,
  })

  return (
    <section className="flex h-[calc(100vh-3.5rem)] w-full flex-1 flex-col overflow-hidden">
      {hasNodes ? (
        <MapHudControls
          leading={<MapBreadcrumb items={breadcrumbItems} onSelectNode={handleSelectNode} />}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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

      {!hasNodes && creatingFirstNode ? (
        <div
          data-testid="create-first-node-panel"
          className="border-b border-border bg-card px-4 py-3"
        >
          <form
            onSubmit={(e) => void handleSubmitFirstNode(e)}
            className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2"
          >
            <label htmlFor="first-node-title" className="sr-only">
              First node title
            </label>
            <input
              id="first-node-title"
              data-testid="create-first-node-input"
              type="text"
              autoFocus
              maxLength={200}
              value={firstNodeTitle}
              onChange={(e) => {
                setFirstNodeTitle(e.target.value)
                setFirstNodeError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCreatingFirstNode(false)
                }
              }}
              placeholder="Topic title (e.g. PWN)"
              className="h-8 min-w-[14rem] rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <select
              aria-label="Node type"
              data-testid="create-first-node-type"
              value={firstNodeType}
              onChange={(e) => setFirstNodeType(e.target.value as Exclude<NodeType, 'lab'>)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {PHASE1_NODE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              size="sm"
              disabled={writeDisabled}
              data-testid="create-first-node-submit"
            >
              Create
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCreatingFirstNode(false)}
            >
              Cancel
            </Button>
            {firstNodeError ? (
              <p role="alert" className="w-full text-center text-xs text-destructive">
                {firstNodeError}
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      {hasNodes && viewMode === 'outline' ? (
        <MapOutlineView
          tree={tree}
          rootTitle={rootHome.title}
          focusId={effectiveFocusId}
          theme={resolvedTheme}
          onSelectNode={handleSelectNode}
          onOpenNode={handleOpenNode}
        />
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <MapViewport
            ref={viewportRef}
            layout={layout}
            visible={visible}
            tree={tree}
            crossLinks={crossLinks}
            focusId={effectiveFocusId}
            orientation={orientation}
            theme={resolvedTheme}
            measureText={measurer.measure}
            keyboardFocusActive={keyboardFocusActive}
            writeDisabled={writeDisabled}
            onSelectNode={handleSelectNode}
            onOpenNode={handleOpenNode}
            onReparentNode={handleDragReparent}
            onCreateFirstNode={handleOpenFirstNodeForm}
            onScaleTierChange={handleScaleTierChange}
            onCameraChange={handleCameraChange}
          />
          {hasNodes ? (
            <MapMinimap
              ref={minimapRef}
              layout={layout}
              visible={visible}
              bbox={bbox}
              theme={resolvedTheme}
              onNavigateWorldPoint={handleMinimapNavigate}
            />
          ) : null}
        </div>
      )}

      {hasNodes ? (
        <NodeActionToolbar
          key={effectiveFocusId}
          focusId={effectiveFocusId}
          focusedNode={focusedNode}
          rootTitle={rootHome.title}
          siblingIndex={siblingIndex}
          siblingCount={siblingIds.length}
          theme={resolvedTheme}
          writeDisabled={writeDisabled}
          onOpenNode={handleOpenNode}
          onCreateChild={handleCreateChild}
          onRenameNode={handleRenameFocused}
          onUpdateMeta={handleUpdateFocusedMeta}
          onReorderNode={handleReorderFocused}
          onRequestMove={() => setMoveDialogOpen(true)}
          onRequestDelete={() => setDeleteDialogOpen(true)}
          onInteractiveOpenChange={setToolbarInteractiveOpen}
        />
      ) : null}

      {focusedNode ? (
        <>
          <MoveNodeDialog
            open={moveDialogOpen}
            tree={tree}
            nodeId={focusedNode.id}
            rootTitle={rootHome.title}
            disabled={writeDisabled}
            onOpenChange={setMoveDialogOpen}
            onConfirmMove={handleConfirmMove}
          />
          <DeleteNodeDialog
            open={deleteDialogOpen}
            tree={tree}
            nodeId={focusedNode.id}
            disabled={writeDisabled}
            onOpenChange={setDeleteDialogOpen}
            onConfirmDelete={handleConfirmDelete}
          />
        </>
      ) : null}
    </section>
  )
}
