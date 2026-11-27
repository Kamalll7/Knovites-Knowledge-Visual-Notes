import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import type { LoadedPageCanvas } from '@/app/store'
import { useWorkspaceStore } from '@/app/workspace-context'
import { createEmptyCanvas, type CanvasJson } from '@/domain/schema'
import { NodePageCanvasSkeleton, NodePageShell } from '@/features/page/NodePageShell'
import { resolveNodePageView, type NodePageSaveStatus } from '@/features/page/page-helpers'

const LazyCanvasWorkspace = lazy(() => import('@/features/canvas/CanvasWorkspace'))

export interface NodePageRouteProps {
  readonly forcedNodeId?: string
}

/**
 * App-layer route composer (`FR-PAGE`) bridging `useWorkspaceStore`, `features/page/NodePageShell`,
 * and lazy-loaded `features/canvas/CanvasWorkspace` without cross-feature imports.
 */
export function NodePageRoute({ forcedNodeId }: NodePageRouteProps = {}) {
  const { nodeId: routeNodeId } = useParams<{ nodeId: string }>()
  const rawNodeId = forcedNodeId ?? routeNodeId ?? ''

  const hydrated = useWorkspaceStore((s) => s.hydrated)
  const tree = useWorkspaceStore((s) => s.tree)
  const rootHome = useWorkspaceStore((s) => s.rootHome)
  const isReadOnlyTab = useWorkspaceStore((s) => s.isReadOnlyTab)
  const storageError = useWorkspaceStore((s) => s.storageError)
  const loadPageCanvas = useWorkspaceStore((s) => s.loadPageCanvas)
  const savePageCanvas = useWorkspaceStore((s) => s.savePageCanvas)

  const view = useMemo(
    () => resolveNodePageView({ tree, rootHome, hydrated, rawNodeId }),
    [tree, rootHome, hydrated, rawNodeId],
  )

  const [loadedState, setLoadedState] = useState<{
    readonly nodeId: string
    readonly result: LoadedPageCanvas
  } | null>(null)
  const [canvasSaveStatus, setCanvasSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  )

  const shouldLoadFromStorage = view.kind === 'home' || view.kind === 'node'
  const activeNodeId = shouldLoadFromStorage ? view.nodeId : null

  useEffect(() => {
    if (activeNodeId === null) return
    let cancelled = false

    void loadPageCanvas(activeNodeId)
      .then((result) => {
        if (cancelled) return
        setLoadedState({ nodeId: activeNodeId, result })
        setCanvasSaveStatus('idle')
      })
      .catch(() => {
        if (cancelled) return
        setLoadedState({
          nodeId: activeNodeId,
          result: {
            nodeId: activeNodeId,
            exists: false,
            doc: createEmptyCanvas(),
            corrupt: false,
          },
        })
        setCanvasSaveStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [activeNodeId, loadPageCanvas])

  const loadedCanvas =
    activeNodeId !== null && loadedState?.nodeId === activeNodeId ? loadedState.result : null

  const targetCorrupt =
    (view.kind === 'home' || view.kind === 'node') &&
    (view.target.corrupt || Boolean(loadedCanvas?.corrupt))
  const targetNewerSchema =
    view.kind === 'home' || view.kind === 'node'
      ? (view.target.newerSchemaVersion ?? loadedCanvas?.newerSchemaVersion)
      : undefined

  const isReadOnly =
    view.kind === 'sample' ||
    isReadOnlyTab ||
    storageError !== null ||
    targetCorrupt ||
    targetNewerSchema !== undefined

  const handleSaveDoc = useCallback(
    async (nextDoc: CanvasJson): Promise<boolean> => {
      if (activeNodeId === null || isReadOnly) return false
      const result = await savePageCanvas(activeNodeId, nextDoc)
      return result.ok
    },
    [activeNodeId, isReadOnly, savePageCanvas],
  )

  const saveStatus: NodePageSaveStatus = isReadOnly
    ? 'readonly'
    : canvasSaveStatus !== 'idle'
      ? canvasSaveStatus
      : view.kind === 'home' && loadedCanvas !== null && !loadedCanvas.exists
        ? 'lazy-empty'
        : 'idle'

  const sampleDoc = useMemo(() => createEmptyCanvas(), [])

  const canvasSlot =
    view.kind === 'sample' ? (
      <Suspense fallback={<NodePageCanvasSkeleton />}>
        <LazyCanvasWorkspace
          key={view.nodeId}
          nodeId={view.nodeId}
          initialDoc={sampleDoc}
          isHome={false}
          readOnly={true}
        />
      </Suspense>
    ) : activeNodeId !== null && loadedCanvas !== null ? (
      <Suspense fallback={<NodePageCanvasSkeleton />}>
        <LazyCanvasWorkspace
          key={activeNodeId}
          nodeId={activeNodeId}
          initialDoc={loadedCanvas.doc}
          isHome={view.kind === 'home'}
          readOnly={isReadOnly}
          onSaveDoc={handleSaveDoc}
          onSaveStatusChange={setCanvasSaveStatus}
        />
      </Suspense>
    ) : (
      <NodePageCanvasSkeleton />
    )

  return (
    <NodePageShell
      view={view}
      homeTitle={rootHome.title}
      saveStatus={saveStatus}
      corrupt={targetCorrupt}
      newerSchemaVersion={targetNewerSchema}
      canvasSlot={canvasSlot}
    />
  )
}
