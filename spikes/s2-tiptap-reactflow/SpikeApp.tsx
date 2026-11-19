import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import { Hand, Image as ImageIcon, MousePointer, RotateCcw, Sun, Moon, Type } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseCanvasJson, type CanvasJson, type ParseResult, type TipTapDoc } from '@/domain/schema'
import { Button } from '@/ui/components/button'
import { createPlainParagraphDoc } from './rich-text-config'
import { TextCanvasNode, type TextBoxNode } from './TextCanvasNode'

type CanvasTool = 'select' | 'hand' | 'text' | 'image'

interface CanvasSnapshot {
  nodes: Array<{
    id: string
    x: number
    y: number
    zIndex: number
    doc: TipTapDoc
    width: number
    maxHeight?: number
  }>
}

type FpsMotionMode = 'pan' | 'zoom' | 'zoom-out-all'

interface FpsBenchmarkOptions {
  count: 100 | 300
  activeEditor: boolean
  mode: FpsMotionMode
  onlyRenderVisibleElements?: boolean
}

interface FpsBenchmarkResult {
  staticNodes: number
  activeEditor: boolean
  mode: FpsMotionMode
  onlyRenderVisibleElements: boolean
  durationMs: number
  frameCount: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  meanFps: number
  p50Fps: number
  p95Fps: number
  renderedDomNodesMin: number
  renderedDomNodesMax: number
}

declare global {
  interface Window {
    __S2_API__?: {
      setTheme: (theme: 'dark' | 'light') => void
      setStaticNodeCount: (count: 4 | 100 | 300) => void
      getViewport: () => Viewport
      getNodeState: (id: string) => {
        x: number
        y: number
        zIndex: number
        doc: TipTapDoc
        isEditing: boolean
        selected: boolean
      } | null
      getAllNodeCount: () => number
      getActiveEditorCount: () => number
      getTool: () => CanvasTool
      getCanvasUndoCount: () => number
      getLeakedCanvasKeydowns: () => number
      resetLeakedCanvasKeydowns: () => void
      setNodeDragConfigForTest: (
        id: string,
        cfg: { draggable?: boolean; dragHandle?: string | undefined },
      ) => void
      enterEdit: (id: string) => void
      exitEdit: () => void
      validateWithDomainSchema: (doc: TipTapDoc) => ParseResult<CanvasJson>
      measurePanZoomFps: (opts: FpsBenchmarkOptions) => Promise<FpsBenchmarkResult>
    }
  }
}

const NODE_TYPES: NodeTypes = {
  textBox: TextCanvasNode as NodeTypes[string],
}

const SAMPLE_RICH_DOC: TipTapDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2, textAlign: 'left' },
      content: [{ type: 'text', text: 'Heap Exploitation Notes' }],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'Inspect ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'tcache' },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'entries' },
        { type: 'text', text: ' & ' },
        {
          type: 'text',
          marks: [{ type: 'textStyle', attrs: { color: '#7c9cff', fontSize: '18px' } }],
          text: 'pointer mangling',
        },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'code' }], text: 'SAFE_LINK' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Check 16-byte alignment before allocation' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com/heap' } }],
                  text: 'Reference walkthrough',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verify bin count' }] }],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'c' },
      content: [{ type: 'text', text: 'void* p = malloc(0x20);' }],
    },
  ],
}

const LONG_SCROLLABLE_DOC: TipTapDoc = {
  type: 'doc',
  content: Array.from({ length: 14 }, (_, idx) => ({
    type: 'paragraph' as const,
    content: [
      {
        type: 'text' as const,
        text: `Line ${idx + 1}: Overflow scroll verification item with details for inner wheel handling.`,
      },
    ],
  })),
}

function buildInitialNodeSpecs(staticCount: 4 | 100 | 300): Array<{
  id: string
  x: number
  y: number
  width: number
  maxHeight?: number
  zIndex: number
  doc: TipTapDoc
}> {
  const base: Array<{
    id: string
    x: number
    y: number
    width: number
    maxHeight?: number
    zIndex: number
    doc: TipTapDoc
  }> = [
    {
      id: 'box-rich',
      x: 80,
      y: 90,
      width: 340,
      zIndex: 1,
      doc: SAMPLE_RICH_DOC,
    },
    {
      id: 'box-scroll',
      x: 470,
      y: 90,
      width: 320,
      maxHeight: 140,
      zIndex: 2,
      doc: LONG_SCROLLABLE_DOC,
    },
    {
      id: 'box-edit',
      x: 80,
      y: 480,
      width: 340,
      zIndex: 3,
      doc: createPlainParagraphDoc('Alpha Bravo Charlie Delta'),
    },
    {
      id: 'box-second',
      x: 470,
      y: 480,
      width: 320,
      zIndex: 4,
      doc: createPlainParagraphDoc('Second box (only 1 TipTap instance mounts at a time)'),
    },
  ]

  if (staticCount <= 4) return base

  const extraTotal = staticCount - base.length
  const cols = 15
  for (let i = 0; i < extraTotal; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    base.push({
      id: `box-stress-${i + 1}`,
      x: 860 + col * 260,
      y: 80 + row * 120,
      width: 230,
      zIndex: 10 + i,
      doc: createPlainParagraphDoc(`Static node #${i + 1}: pure React render`),
    })
  }
  return base
}

function isEditableDomTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[contenteditable="true"]')) return true
  if (target.closest('[data-editor-toolbar="true"]')) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))
  return sorted[idx]!
}

function SpikeCanvasInner() {
  const reactFlow = useReactFlow<TextBoxNode>()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [tool, setTool] = useState<CanvasTool>('select')
  const [staticCountMode, setStaticCountMode] = useState<4 | 100 | 300>(4)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [activeEditorCount, setActiveEditorCount] = useState(0)
  const [onlyRenderVisible, setOnlyRenderVisible] = useState(true)
  const [lastFpsBench, setLastFpsBench] = useState<FpsBenchmarkResult | null>(null)

  const leakedCanvasKeydownsRef = useRef(0)
  const undoStackRef = useRef<CanvasSnapshot[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const editSessionStartRef = useRef<CanvasSnapshot | null>(null)
  const editSessionHasNetChangeRef = useRef(false)
  const dragStartSnapshotRef = useRef<CanvasSnapshot | null>(null)

  const editingNodeIdRef = useRef(editingNodeId)
  useEffect(() => {
    editingNodeIdRef.current = editingNodeId
  }, [editingNodeId])

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.classList.remove('dark', 'light')
    root.classList.add(theme)
    const raf = requestAnimationFrame(() => root.classList.remove('theme-switching'))
    return () => cancelAnimationFrame(raf)
  }, [theme])

  const makeSnapshot = useCallback((list: readonly TextBoxNode[]): CanvasSnapshot => {
    return {
      nodes: list.map((n) => ({
        id: n.id,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        zIndex: n.zIndex ?? 1,
        doc: structuredClone(n.data.doc),
        width: n.data.width,
        maxHeight: n.data.maxHeight,
      })),
    }
  }, [])

  const pushUndoSnapshot = useCallback((snap: CanvasSnapshot) => {
    undoStackRef.current.push(snap)
    if (undoStackRef.current.length > 100) undoStackRef.current.shift()
    setUndoCount(undoStackRef.current.length)
  }, [])

  const mountedEditorIdsRef = useRef<Set<string>>(new Set())

  const handlersRef = useRef<{
    onEnterEdit: (id: string) => void
    onExitEdit: () => void
    onDocChange: (id: string, doc: TipTapDoc, hasNetChange: boolean) => void
    onEditorMountChange: (instanceId: string, mounted: boolean) => void
  }>({
    onEnterEdit: () => {},
    onExitEdit: () => {},
    onDocChange: () => {},
    onEditorMountChange: () => {},
  })

  const buildFlowNodes = useCallback(
    (specs: ReturnType<typeof buildInitialNodeSpecs>): TextBoxNode[] =>
      specs.map((s) => ({
        id: s.id,
        type: 'textBox',
        position: { x: s.x, y: s.y },
        zIndex: s.zIndex,
        dragHandle: '.knovites-drag-handle',
        draggable: true,
        selectable: true,
        deletable: true,
        data: {
          doc: s.doc,
          width: s.width,
          maxHeight: s.maxHeight,
          isEditing: false,
          onEnterEdit: (nodeId) => handlersRef.current.onEnterEdit(nodeId),
          onExitEdit: () => handlersRef.current.onExitEdit(),
          onDocChange: (nodeId, doc, hasNetChange) =>
            handlersRef.current.onDocChange(nodeId, doc, hasNetChange),
          onEditorMountChange: (instanceId, mounted) =>
            handlersRef.current.onEditorMountChange(instanceId, mounted),
        },
      })),
    [],
  )

  const initialNodes = useMemo(() => buildFlowNodes(buildInitialNodeSpecs(4)), [buildFlowNodes])
  const [nodes, setNodes, onNodesChange] = useNodesState<TextBoxNode>(initialNodes)
  const nodesRef = useRef<TextBoxNode[]>(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const handleEditorMountChange = useCallback((instanceId: string, mounted: boolean) => {
    const set = mountedEditorIdsRef.current
    if (mounted) {
      set.add(instanceId)
    } else {
      set.delete(instanceId)
    }
    setActiveEditorCount(set.size)
  }, [])

  const handleDocChange = useCallback(
    (id: string, doc: TipTapDoc, hasNetChange: boolean) => {
      editSessionHasNetChangeRef.current = hasNetChange
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, doc } } : n)))
    },
    [setNodes],
  )

  const exitEditMode = useCallback(() => {
    const currentEditing = editingNodeIdRef.current
    if (!currentEditing) return
    const before = editSessionStartRef.current
    const hasNetChange = editSessionHasNetChangeRef.current
    editSessionStartRef.current = null
    editSessionHasNetChangeRef.current = false
    if (before && hasNetChange) {
      pushUndoSnapshot(before)
    }
    setEditingNodeId(null)
    setNodes((prev) =>
      prev.map((n) =>
        n.id === currentEditing
          ? { ...n, draggable: true, data: { ...n.data, isEditing: false } }
          : n,
      ),
    )
  }, [pushUndoSnapshot, setNodes])

  const enterEditMode = useCallback(
    (id: string) => {
      if (editingNodeIdRef.current && editingNodeIdRef.current !== id) {
        exitEditMode()
      }
      editSessionStartRef.current = makeSnapshot(nodesRef.current)
      editSessionHasNetChangeRef.current = false
      setEditingNodeId(id)
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          selected: n.id === id,
          draggable: n.id !== id,
          data: {
            ...n.data,
            isEditing: n.id === id,
          },
        })),
      )
    },
    [exitEditMode, makeSnapshot, setNodes],
  )

  useEffect(() => {
    handlersRef.current = {
      onEnterEdit: enterEditMode,
      onExitEdit: exitEditMode,
      onDocChange: handleDocChange,
      onEditorMountChange: handleEditorMountChange,
    }
  }, [enterEditMode, exitEditMode, handleDocChange, handleEditorMountChange])

  const applyNodeDataset = useCallback(
    (count: 4 | 100 | 300) => {
      setEditingNodeId(null)
      undoStackRef.current = []
      setUndoCount(0)
      setStaticCountMode(count)
      setNodes(buildFlowNodes(buildInitialNodeSpecs(count)))
      void reactFlow.setViewport({ x: 0, y: 0, zoom: 1 })
    },
    [buildFlowNodes, reactFlow, setNodes],
  )

  const restoreCanvasUndo = useCallback(() => {
    const snap = undoStackRef.current.pop()
    if (!snap) return
    setUndoCount(undoStackRef.current.length)
    setNodes(buildFlowNodes(snap.nodes))
  }, [buildFlowNodes, setNodes])

  // Global canvas keyboard shortcuts (strictly disabled while editing text or focused in editable input)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingNodeIdRef.current !== null || isEditableDomTarget(event.target)) {
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        restoreCanvasUndo()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return

      const k = event.key.toLowerCase()
      if (k === 'h') {
        setTool('hand')
      } else if (k === 't') {
        setTool('text')
      } else if (k === 'i') {
        setTool('image')
      } else if (event.key === ']') {
        const selectedIds = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
        if (selectedIds.size > 0) {
          pushUndoSnapshot(makeSnapshot(nodesRef.current))
          setNodes((prev) =>
            prev.map((n) => (selectedIds.has(n.id) ? { ...n, zIndex: (n.zIndex ?? 1) + 1 } : n)),
          )
        }
      } else if (event.key === '[') {
        const selectedIds = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id))
        if (selectedIds.size > 0) {
          pushUndoSnapshot(makeSnapshot(nodesRef.current))
          setNodes((prev) =>
            prev.map((n) =>
              selectedIds.has(n.id) ? { ...n, zIndex: Math.max(0, (n.zIndex ?? 1) - 1) } : n,
            ),
          )
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [makeSnapshot, pushUndoSnapshot, restoreCanvasUndo, setNodes])

  const measurePanZoomFps = useCallback(
    async ({
      count,
      activeEditor,
      mode,
      onlyRenderVisibleElements = true,
    }: FpsBenchmarkOptions): Promise<FpsBenchmarkResult> => {
      setOnlyRenderVisible(onlyRenderVisibleElements)
      applyNodeDataset(count)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      if (activeEditor) {
        enterEditMode('box-edit')
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
      }

      if (mode === 'zoom-out-all') {
        void reactFlow.setViewport({ x: 60, y: 40, zoom: 0.21 })
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
      } else if (mode === 'zoom') {
        void reactFlow.setViewport({ x: -180, y: -60, zoom: 0.72 })
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
      }

      const deltas: number[] = []
      let renderedDomNodesMin = Infinity
      let renderedDomNodesMax = 0
      const minDurationMs = 3200
      const minFrames = 150
      const maxDurationMs = 12000
      const start = performance.now()
      let prev = start

      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const dt = now - prev
          if (deltas.length > 0 || dt > 0.1) {
            deltas.push(dt)
          }
          prev = now

          const domNodes = document.querySelectorAll('.react-flow__node').length
          renderedDomNodesMin = Math.min(renderedDomNodesMin, domNodes)
          renderedDomNodesMax = Math.max(renderedDomNodesMax, domNodes)

          const elapsed = now - start
          const progress = Math.min(1, elapsed / minDurationMs)
          const angle = (elapsed / minDurationMs) * Math.PI * 4

          if (mode === 'zoom-out-all') {
            const zoom = 0.2 + 0.015 * Math.sin(angle)
            const x = 60 + 25 * Math.cos(angle)
            const y = 35 + 15 * Math.sin(angle)
            void reactFlow.setViewport({ x, y, zoom })
          } else if (mode === 'zoom') {
            // Pure zoom with constant pan translation
            const zoom = 0.72 + 0.36 * Math.sin(angle)
            void reactFlow.setViewport({ x: -180, y: -60, zoom })
          } else {
            // Pure pan with constant 1.0 zoom across populated stress grid
            const x = -1200 * Math.sin(progress * Math.PI) + 120 * Math.cos(angle)
            const y = -480 * Math.sin(progress * Math.PI) + 80 * Math.sin(angle)
            void reactFlow.setViewport({ x, y, zoom: 1 })
          }

          if ((elapsed < minDurationMs || deltas.length < minFrames) && elapsed < maxDurationMs) {
            requestAnimationFrame(step)
          } else {
            resolve()
          }
        }
        requestAnimationFrame(step)
      })

      const sorted = [...deltas].sort((a, b) => a - b)
      const sumMs = sorted.reduce((acc, v) => acc + v, 0)
      const meanMs = sorted.length > 0 ? sumMs / sorted.length : 0
      const p50Ms = percentile(sorted, 0.5)
      const p95Ms = percentile(sorted, 0.95)
      const maxMs = sorted.length > 0 ? sorted[sorted.length - 1]! : 0
      const res: FpsBenchmarkResult = {
        staticNodes: count,
        activeEditor,
        mode,
        onlyRenderVisibleElements,
        durationMs: Number((prev - start).toFixed(1)),
        frameCount: sorted.length,
        meanMs: Number(meanMs.toFixed(2)),
        p50Ms: Number(p50Ms.toFixed(2)),
        p95Ms: Number(p95Ms.toFixed(2)),
        maxMs: Number(maxMs.toFixed(2)),
        meanFps: meanMs > 0 ? Number((1000 / meanMs).toFixed(1)) : 0,
        p50Fps: p50Ms > 0 ? Number((1000 / p50Ms).toFixed(1)) : 0,
        p95Fps: p95Ms > 0 ? Number((1000 / p95Ms).toFixed(1)) : 0,
        renderedDomNodesMin: Number.isFinite(renderedDomNodesMin) ? renderedDomNodesMin : 0,
        renderedDomNodesMax,
      }
      setLastFpsBench(res)
      return res
    },
    [applyNodeDataset, enterEditMode, reactFlow],
  )

  useEffect(() => {
    window.__S2_API__ = {
      setTheme,
      setStaticNodeCount: applyNodeDataset,
      getViewport: () => reactFlow.getViewport(),
      getNodeState: (id: string) => {
        const node = nodesRef.current.find((n) => n.id === id)
        if (!node) return null
        return {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          zIndex: node.zIndex ?? 1,
          doc: node.data.doc,
          isEditing: node.data.isEditing,
          selected: Boolean(node.selected),
        }
      },
      getAllNodeCount: () => nodesRef.current.length,
      getActiveEditorCount: () => activeEditorCount,
      getTool: () => tool,
      getCanvasUndoCount: () => undoStackRef.current.length,
      getLeakedCanvasKeydowns: () => leakedCanvasKeydownsRef.current,
      resetLeakedCanvasKeydowns: () => {
        leakedCanvasKeydownsRef.current = 0
      },
      setNodeDragConfigForTest: (
        id: string,
        cfg: { draggable?: boolean; dragHandle?: string | undefined },
      ) => {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === id
              ? {
                  ...n,
                  ...(cfg.draggable !== undefined ? { draggable: cfg.draggable } : {}),
                  ...('dragHandle' in cfg ? { dragHandle: cfg.dragHandle } : {}),
                }
              : n,
          ),
        )
      },
      enterEdit: enterEditMode,
      exitEdit: exitEditMode,
      validateWithDomainSchema: (doc: TipTapDoc) =>
        parseCanvasJson({
          schema: 1,
          elements: {
            e_00000001: {
              type: 'text',
              x: 0,
              y: 0,
              w: 320,
              z: 'a0',
              style: { bg: null, border: null },
              content: doc,
              updatedAt: '2026-11-19T12:00:00Z',
            },
          },
        }),
      measurePanZoomFps,
    }
    return () => {
      delete window.__S2_API__
    }
  }, [
    activeEditorCount,
    applyNodeDataset,
    enterEditMode,
    exitEditMode,
    measurePanZoomFps,
    reactFlow,
    setNodes,
    tool,
  ])

  const handleNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const posChanges = changes.getByType('position')
      if (posChanges.some((c) => c.dragging === true) && !dragStartSnapshotRef.current) {
        dragStartSnapshotRef.current = makeSnapshot(nodesRef.current)
      }
      if (posChanges.some((c) => c.dragging === false) && dragStartSnapshotRef.current) {
        pushUndoSnapshot(dragStartSnapshotRef.current)
        dragStartSnapshotRef.current = null
      }
      onNodesChange(changes)
    },
    [makeSnapshot, onNodesChange, pushUndoSnapshot],
  )

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Compact Top Spike Header */}
      <header className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-wider uppercase text-primary">
            Spike S2 · TipTap + React Flow
          </span>

          <div
            data-testid="tool-bar"
            className="flex items-center rounded-md border border-border bg-secondary p-0.5 text-xs"
          >
            {(
              [
                { id: 'select', label: 'Select', icon: MousePointer },
                { id: 'hand', label: 'Hand (H)', icon: Hand },
                { id: 'text', label: 'Text (T)', icon: Type },
                { id: 'image', label: 'Image (I)', icon: ImageIcon },
              ] as const
            ).map((t) => {
              const Icon = t.icon
              const active = tool === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`tool-${t.id}`}
                  aria-pressed={active}
                  onClick={() => setTool(t.id)}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="size-3" />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center rounded-md border border-border bg-secondary p-0.5">
            {([4, 100, 300] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                data-testid={`count-${cnt}`}
                onClick={() => applyNodeDataset(cnt)}
                className={`rounded px-2 py-0.5 font-mono ${
                  staticCountMode === cnt
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {cnt} nodes
              </button>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="canvas-undo-btn"
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
            disabled={undoCount === 0}
            onClick={restoreCanvasUndo}
          >
            <RotateCcw className="size-3.5" />
            Undo ({undoCount})
          </Button>

          <span
            data-testid="editor-instance-badge"
            className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[11px] whitespace-nowrap"
          >
            TipTap instances: {activeEditorCount}
          </span>

          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </div>
      </header>

      {/* Main React Flow Canvas */}
      <main
        data-testid="canvas-stage"
        onKeyDown={() => {
          if (editingNodeIdRef.current !== null) {
            leakedCanvasKeydownsRef.current += 1
          }
        }}
        className="relative flex-1 overflow-hidden"
      >
        <ReactFlow<TextBoxNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChangeWrapped}
          onNodesDelete={() => {
            pushUndoSnapshot(makeSnapshot(nodesRef.current))
          }}
          onPaneClick={() => {
            if (editingNodeIdRef.current) {
              exitEditMode()
            }
          }}
          onNodeClick={(_event, clicked) => {
            if (editingNodeIdRef.current && editingNodeIdRef.current !== clicked.id) {
              exitEditMode()
            }
          }}
          onlyRenderVisibleElements={onlyRenderVisible}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          selectionOnDrag={tool === 'select'}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode="Control"
          zoomOnDoubleClick={false}
          panActivationKeyCode={editingNodeId ? null : 'Space'}
          deleteKeyCode={editingNodeId ? null : ['Backspace', 'Delete']}
          minZoom={0.1}
          maxZoom={4}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>

        {lastFpsBench ? (
          <aside
            data-testid="s2-fps-hud"
            className="pointer-events-none absolute right-3 bottom-8 z-20 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md"
          >
            <div className="font-semibold">
              Pan/Zoom Benchmark ({lastFpsBench.staticNodes} nodes)
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              p50: {lastFpsBench.p50Ms}ms ({lastFpsBench.p50Fps} fps) · p95: {lastFpsBench.p95Ms}ms
              ({lastFpsBench.p95Fps} fps)
            </div>
          </aside>
        ) : null}
      </main>
    </div>
  )
}

export function SpikeApp() {
  return (
    <ReactFlowProvider>
      <SpikeCanvasInner />
    </ReactFlowProvider>
  )
}
