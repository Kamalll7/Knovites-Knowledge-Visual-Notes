import type { Editor } from '@tiptap/react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useViewport,
  ViewportPortal,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import { Hand, Image as ImageIcon, MousePointer, RotateCcw, Sun, Moon, Type } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { parseCanvasJson, type CanvasJson, type ParseResult, type TipTapDoc } from '@/domain/schema'
import { Button } from '@/ui/components/button'
import { ImageCanvasNode, type ImageBoxNode } from './ImageCanvasNode'
import {
  computeLodZoomState,
  createPlainParagraphDoc,
  INITIAL_LOD_ZOOM_STATE,
  LodZoomContext,
  type LodZoomState,
} from './rich-text-config'
import { TextBoxSurface, TextCanvasNode, type TextBoxNode } from './TextCanvasNode'

type CanvasNode = TextBoxNode | ImageBoxNode
type CanvasTool = 'select' | 'hand' | 'text' | 'image'

interface CanvasSnapshot {
  nodes: Array<{
    id: string
    x: number
    y: number
    zIndex: number
    width: number
    nodeKind: 'textBox' | 'imageBox'
    doc?: TipTapDoc
    maxHeight?: number
    frameNone?: boolean
    src?: string
    thumbSrc?: string
    alt?: string
    height?: number
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
  activeEditorMinDuringRun: number
}

import { FloatingToolbar } from './FloatingToolbar'

declare global {
  interface Window {
    __S2_API__?: {
      setTheme: (theme: 'dark' | 'light') => void
      setStaticNodeCount: (count: 4 | 100 | 300) => void
      setViewport: (vp: Viewport) => void
      getViewport: () => Viewport
      getNodeState: (id: string) => {
        x: number
        y: number
        width: number
        zIndex: number
        doc: TipTapDoc | null
        isEditing: boolean
        selected: boolean
      } | null
      deleteNode: (id: string) => void
      selectNodes: (ids: string[]) => void
      getLodState: () => LodZoomState
      getLodSwitchCount: () => number
      getAllNodeCount: () => number
      getImageNodeCount: () => number
      getActiveEditorCount: () => number
      getTool: () => CanvasTool
      getCanvasUndoCount: () => number
      getLeakedCanvasKeydowns: () => number
      resetLeakedCanvasKeydowns: () => void
      setNodeDragConfigForTest: (
        id: string,
        cfg: { draggable?: boolean; dragHandle?: string | undefined },
      ) => void
      setNodeDocForTest: (id: string, doc: TipTapDoc) => void
      setNodeFrameModeForTest: (id: string, frameNone: boolean) => void
      setMitigateActiveEditorUnmount: (enabled: boolean) => void
      enterEdit: (id: string) => void
      exitEdit: () => void
      validateWithDomainSchema: (doc: TipTapDoc) => ParseResult<CanvasJson>
      measurePanZoomFps: (opts: FpsBenchmarkOptions) => Promise<FpsBenchmarkResult>
    }
  }
}

const NODE_TYPES: NodeTypes = {
  textBox: TextCanvasNode as NodeTypes[string],
  imageBox: ImageCanvasNode as NodeTypes[string],
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

type NodeSpec =
  | {
      kind: 'textBox'
      id: string
      x: number
      y: number
      width: number
      maxHeight?: number
      frameNone?: boolean
      zIndex: number
      doc: TipTapDoc
    }
  | {
      kind: 'imageBox'
      id: string
      x: number
      y: number
      width: number
      height: number
      zIndex: number
      src: string
      thumbSrc: string
      alt: string
    }

let cachedImageUrls: string[] | null = null
let cachedThumbUrls: string[] | null = null

function generateLocalSampleBitmaps(): { full: string[]; thumb: string[] } {
  if (cachedImageUrls && cachedThumbUrls) {
    return { full: cachedImageUrls, thumb: cachedThumbUrls }
  }
  const palettes = [
    ['#1d4ed8', '#7c9cff', 'Heap Layout'],
    ['#047857', '#34d399', 'Stack Frame'],
    ['#b45309', '#fbbf24', 'ELF Segments'],
    ['#be123c', '#f87171', 'ROP Gadget Map'],
    ['#6d28d9', '#a78bfa', 'Format String'],
    ['#0369a1', '#38bdf8', 'Syscall Table'],
  ] as const

  const renderSample = (w: number, h: number, includeText: boolean) =>
    palettes.map(([c1, c2, label], idx) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, c1)
        grad.addColorStop(1, '#11151d')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
        const scaleX = w / 480
        const scaleY = h / 300
        if (includeText) {
          ctx.strokeStyle = 'rgba(255,255,255,0.16)'
          ctx.lineWidth = 1
          for (let gx = 40; gx < 480; gx += 40) {
            ctx.beginPath()
            ctx.moveTo(gx, 0)
            ctx.lineTo(gx, 300)
            ctx.stroke()
          }
        }
        ctx.fillStyle = c2
        ctx.fillRect(
          28 * scaleX,
          (36 + (idx % 3) * 20) * scaleY,
          140 * scaleX,
          Math.max(4, 26 * scaleY),
        )
        ctx.fillRect(28 * scaleX, 120 * scaleY, 220 * scaleX, Math.max(3, 18 * scaleY))
        if (includeText) {
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 22px system-ui, sans-serif'
          ctx.fillText(`Figure ${idx + 1}: ${label}`, 28, 250)
        }
      }
      return canvas.toDataURL('image/png')
    })

  cachedImageUrls = renderSample(480, 300, true)
  cachedThumbUrls = renderSample(64, 40, false)
  return { full: cachedImageUrls, thumb: cachedThumbUrls }
}

function makeRichBenchmarkDoc(variant: number, index: number): TipTapDoc {
  if (variant === 0) {
    return SAMPLE_RICH_DOC
  }
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: `Node #${index} · Binary Analysis` }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Check ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'GOT' },
          { type: 'text', text: ' & ' },
          {
            type: 'text',
            marks: [{ type: 'textStyle', attrs: { color: '#7c9cff', fontSize: '14px' } }],
            text: 'PLT',
          },
          { type: 'text', text: ' via ' },
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: `https://example.com/node/${index}` } }],
            text: 'reference',
          },
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
                content: [{ type: 'text', marks: [{ type: 'code' }], text: 'checksec --file=bin' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'Verify PIE + NX' }],
              },
            ],
          },
        ],
      },
    ],
  }
}

function buildInitialNodeSpecs(staticCount: 4 | 100 | 300): NodeSpec[] {
  const base: NodeSpec[] = [
    {
      kind: 'textBox',
      id: 'box-rich',
      x: 80,
      y: 90,
      width: 340,
      zIndex: 1,
      doc: SAMPLE_RICH_DOC,
    },
    {
      kind: 'textBox',
      id: 'box-scroll',
      x: 470,
      y: 90,
      width: 320,
      maxHeight: 140,
      zIndex: 2,
      doc: LONG_SCROLLABLE_DOC,
    },
    {
      kind: 'textBox',
      id: 'box-edit',
      x: 80,
      y: 480,
      width: 340,
      zIndex: 3,
      doc: createPlainParagraphDoc('Alpha Bravo Charlie Delta'),
    },
    {
      kind: 'textBox',
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
  const targetImages = staticCount === 300 ? 50 : 17
  const cols = 15
  const { full: sampleUrls, thumb: sampleThumbUrls } = generateLocalSampleBitmaps()
  let imageCount = 0

  for (let i = 0; i < extraTotal; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = 860 + col * 280
    const y = 80 + row * 260
    const shouldBeImage =
      imageCount < targetImages && (i % 5 === 4 || extraTotal - i <= targetImages - imageCount)

    if (shouldBeImage) {
      const src = sampleUrls[imageCount % sampleUrls.length]!
      const thumbSrc = sampleThumbUrls[imageCount % sampleThumbUrls.length]!
      imageCount += 1
      base.push({
        kind: 'imageBox',
        id: `box-img-${imageCount}`,
        x,
        y,
        width: 240,
        height: 150,
        zIndex: 10 + i,
        src,
        thumbSrc,
        alt: `Benchmark figure #${imageCount}`,
      })
    } else if (i % 2 === 0) {
      base.push({
        kind: 'textBox',
        id: `box-stress-${i + 1}`,
        x,
        y,
        width: 250,
        zIndex: 10 + i,
        doc: makeRichBenchmarkDoc(i % 3 === 0 ? 0 : 1, i + 1),
      })
    } else {
      base.push({
        kind: 'textBox',
        id: `box-stress-${i + 1}`,
        x,
        y,
        width: 240,
        zIndex: 10 + i,
        doc: createPlainParagraphDoc(`Static node #${i + 1}: pure React render`),
      })
    }
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

function LodViewportObserver({ onZoom }: { onZoom: (zoom: number) => void }) {
  useOnViewportChange({
    onChange: (vp) => {
      onZoom(vp.zoom)
    },
  })
  return null
}

function LodZoomProvider({
  onLodStateChange,
  onLodSwitch,
  lodState,
  children,
}: {
  onLodStateChange?: (next: LodZoomState) => void
  onLodSwitch?: () => void
  lodState: LodZoomState
  children: ReactNode
}) {
  const prevIsLodRef = useRef(lodState.isLod)
  useEffect(() => {
    onLodStateChange?.(lodState)
    if (lodState.isLod !== prevIsLodRef.current) {
      prevIsLodRef.current = lodState.isLod
      onLodSwitch?.()
    }
  }, [lodState, onLodStateChange, onLodSwitch])

  return <LodZoomContext.Provider value={lodState}>{children}</LodZoomContext.Provider>
}

const FooterZoomLabel = memo(function FooterZoomLabel({ nodeCount }: { nodeCount: number }) {
  const viewport = useViewport()
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      Zoom: {Math.round(viewport.zoom * 100)}% · Nodes: {nodeCount}
    </span>
  )
})

function FloatingToolbarOverlay({
  editor,
  editingNode,
  stageRef,
}: {
  editor: Editor
  editingNode: TextBoxNode
  stageRef: RefObject<HTMLElement | null>
}) {
  const viewport = useViewport()
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({
    w: editingNode.data.width,
    h: 120,
  })
  const [tbSize, setTbSize] = useState<{ w: number; h: number }>({ w: 374, h: 38 })
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 })

  // Measure node, toolbar & stage dimensions only when node identity/content changes — never force reflow during pan/zoom
  useLayoutEffect(() => {
    const stageEl = stageRef.current
    if (!stageEl) return
    setStageSize({ w: stageEl.clientWidth, h: stageEl.clientHeight })
    const cardEl = stageEl.querySelector<HTMLElement>(
      `[data-testid="card-surface-${editingNode.id}"]`,
    )
    if (cardEl) {
      setBoxSize({ w: cardEl.offsetWidth, h: cardEl.offsetHeight })
    }
    if (toolbarRef.current) {
      setTbSize({ w: toolbarRef.current.offsetWidth, h: toolbarRef.current.offsetHeight })
    }
  }, [editingNode.id, editingNode.data.doc, editingNode.data.width, stageRef])

  const { w: stageW, h: stageH } = stageSize
  const gap = 10
  const pad = 8
  const cardLeft = viewport.x + editingNode.position.x * viewport.zoom
  const cardTop = viewport.y + editingNode.position.y * viewport.zoom
  const cardBottom = cardTop + boxSize.h * viewport.zoom

  const aboveTop = cardTop - Math.round(20 * viewport.zoom) - tbSize.h - gap
  const belowTop = cardBottom + gap
  let top: number
  if (aboveTop >= pad) {
    top = aboveTop
  } else if (belowTop + tbSize.h <= stageH - pad) {
    top = belowTop
  } else {
    top = pad
  }
  const left = Math.max(pad, Math.min(cardLeft, Math.max(pad, stageW - tbSize.w - pad)))

  return (
    <FloatingToolbar
      editor={editor}
      position={{ left: Math.round(left), top: Math.round(top) }}
      toolbarRef={toolbarRef}
    />
  )
}

function SpikeCanvasInner() {
  const reactFlow = useReactFlow<CanvasNode>()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [tool, setTool] = useState<CanvasTool>('select')
  const [staticCountMode, setStaticCountMode] = useState<4 | 100 | 300>(4)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [activeEditorCount, setActiveEditorCount] = useState(0)
  const [onlyRenderVisible, setOnlyRenderVisible] = useState(true)
  const [mitigateActiveEditorUnmount, setMitigateActiveEditorUnmount] = useState(true)
  const mitigateRef = useRef(mitigateActiveEditorUnmount)
  useEffect(() => {
    mitigateRef.current = mitigateActiveEditorUnmount
  }, [mitigateActiveEditorUnmount])
  const [lastFpsBench, setLastFpsBench] = useState<FpsBenchmarkResult | null>(null)
  const [lodState, setLodState] = useState<LodZoomState>(INITIAL_LOD_ZOOM_STATE)
  const lodStateRef = useRef<LodZoomState>(INITIAL_LOD_ZOOM_STATE)
  const lodSwitchCountRef = useRef(0)

  const handleViewportZoom = useCallback((zoom: number) => {
    setLodState((prev) => computeLodZoomState(zoom, prev))
  }, [])
  const handleLodStateChange = useCallback((next: LodZoomState) => {
    lodStateRef.current = next
  }, [])
  const handleLodSwitch = useCallback(() => {
    lodSwitchCountRef.current += 1
  }, [])

  const canvasStageRef = useRef<HTMLElement | null>(null)
  const leakedCanvasKeydownsRef = useRef(0)
  const undoStackRef = useRef<CanvasSnapshot[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const editSessionStartRef = useRef<CanvasSnapshot | null>(null)
  const editSessionHasNetChangeRef = useRef(false)
  const dragStartSnapshotRef = useRef<CanvasSnapshot | null>(null)
  const resizeStartSnapshotRef = useRef<CanvasSnapshot | null>(null)

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

  const makeSnapshot = useCallback((list: readonly CanvasNode[]): CanvasSnapshot => {
    return {
      nodes: list.map((n) =>
        n.type === 'imageBox'
          ? {
              id: n.id,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
              zIndex: n.zIndex ?? 1,
              width: n.data.width,
              height: n.data.height,
              src: n.data.src,
              thumbSrc: n.data.thumbSrc,
              alt: n.data.alt,
              nodeKind: 'imageBox',
            }
          : {
              id: n.id,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
              zIndex: n.zIndex ?? 1,
              width: n.data.width,
              nodeKind: 'textBox',
              doc: structuredClone(n.data.doc),
              maxHeight: n.data.maxHeight,
              frameNone: n.data.frameNone,
            },
      ),
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
    onResizeStart: (id: string) => void
    onResizeWidth: (id: string, width: number) => void
    onResizeEnd: (id: string) => void
    onEditorReady: (id: string, editor: Editor | null) => void
    onEditorMountChange: (instanceId: string, mounted: boolean) => void
  }>({
    onEnterEdit: () => {},
    onExitEdit: () => {},
    onDocChange: () => {},
    onResizeStart: () => {},
    onResizeWidth: () => {},
    onResizeEnd: () => {},
    onEditorReady: () => {},
    onEditorMountChange: () => {},
  })

  const buildFlowNodes = useCallback((specs: readonly NodeSpec[]): CanvasNode[] => {
    return specs.map((s) =>
      s.kind === 'imageBox'
        ? {
            id: s.id,
            type: 'imageBox',
            position: { x: s.x, y: s.y },
            zIndex: s.zIndex,
            dragHandle: '.knovites-drag-handle',
            draggable: true,
            selectable: true,
            deletable: true,
            data: {
              src: s.src,
              thumbSrc: s.thumbSrc,
              alt: s.alt,
              width: s.width,
              height: s.height,
            },
          }
        : {
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
              frameNone: s.frameNone,
              isEditing: false,
              onEnterEdit: (nodeId) => handlersRef.current.onEnterEdit(nodeId),
              onExitEdit: () => handlersRef.current.onExitEdit(),
              onDocChange: (nodeId, doc, hasNetChange) =>
                handlersRef.current.onDocChange(nodeId, doc, hasNetChange),
              onResizeStart: (nodeId) => handlersRef.current.onResizeStart(nodeId),
              onResizeWidth: (nodeId, width) => handlersRef.current.onResizeWidth(nodeId, width),
              onResizeEnd: (nodeId) => handlersRef.current.onResizeEnd(nodeId),
              onEditorReady: (nodeId, editor) => handlersRef.current.onEditorReady(nodeId, editor),
              onEditorMountChange: (instanceId, mounted) =>
                handlersRef.current.onEditorMountChange(instanceId, mounted),
            },
          },
    )
  }, [])

  const initialNodes = useMemo(() => buildFlowNodes(buildInitialNodeSpecs(4)), [buildFlowNodes])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes)
  const nodesRef = useRef<CanvasNode[]>(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const handleEditorReady = useCallback((id: string, editor: Editor | null) => {
    if (editor === null) {
      setActiveEditor(null)
    } else if (editingNodeIdRef.current === id) {
      setActiveEditor(editor)
    }
  }, [])

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
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id && n.type === 'textBox' ? { ...n, data: { ...n.data, doc } } : n,
        ),
      )
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
    setActiveEditor(null)
    setNodes((prev) =>
      prev.map((n) =>
        n.id === currentEditing && n.type === 'textBox'
          ? {
              ...n,
              draggable: true,
              data: { ...n.data, isEditing: false, renderInViewportPortal: false },
            }
          : n,
      ),
    )
  }, [pushUndoSnapshot, setNodes])

  const handleResizeStart = useCallback(() => {
    resizeStartSnapshotRef.current = makeSnapshot(nodesRef.current)
  }, [makeSnapshot])

  const handleResizeWidth = useCallback(
    (id: string, width: number) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id && n.type === 'textBox' ? { ...n, data: { ...n.data, width } } : n,
        ),
      )
    },
    [setNodes],
  )

  const handleResizeEnd = useCallback(() => {
    if (resizeStartSnapshotRef.current) {
      pushUndoSnapshot(resizeStartSnapshotRef.current)
      resizeStartSnapshotRef.current = null
    }
  }, [pushUndoSnapshot])

  const enterEditMode = useCallback(
    (id: string) => {
      if (editingNodeIdRef.current && editingNodeIdRef.current !== id) {
        exitEditMode()
      }
      editSessionStartRef.current = makeSnapshot(nodesRef.current)
      editSessionHasNetChangeRef.current = false
      setEditingNodeId(id)
      const usePortal = mitigateRef.current
      setNodes((prev) =>
        prev.map((n) =>
          n.type === 'textBox'
            ? {
                ...n,
                selected: n.id === id,
                draggable: true,
                data: {
                  ...n.data,
                  isEditing: n.id === id,
                  renderInViewportPortal: n.id === id && usePortal,
                },
              }
            : {
                ...n,
                selected: false,
              },
        ),
      )
    },
    [exitEditMode, makeSnapshot, setNodes],
  )

  useEffect(() => {
    handlersRef.current = {
      onEnterEdit: enterEditMode,
      onExitEdit: exitEditMode,
      onDocChange: handleDocChange,
      onResizeStart: handleResizeStart,
      onResizeWidth: handleResizeWidth,
      onResizeEnd: handleResizeEnd,
      onEditorReady: handleEditorReady,
      onEditorMountChange: handleEditorMountChange,
    }
  }, [
    enterEditMode,
    exitEditMode,
    handleDocChange,
    handleEditorMountChange,
    handleEditorReady,
    handleResizeEnd,
    handleResizeStart,
    handleResizeWidth,
  ])

  const handleNodesDelete = useCallback(() => {
    pushUndoSnapshot(makeSnapshot(nodesRef.current))
  }, [makeSnapshot, pushUndoSnapshot])

  const handlePaneClick = useCallback(() => {
    if (editingNodeIdRef.current) {
      exitEditMode()
    }
  }, [exitEditMode])

  const handleNodeClick = useCallback(
    (_event: unknown, clicked: CanvasNode) => {
      if (editingNodeIdRef.current && editingNodeIdRef.current !== clicked.id) {
        exitEditMode()
      }
    },
    [exitEditMode],
  )

  const applyNodeDataset = useCallback(
    (count: 4 | 100 | 300) => {
      setEditingNodeId(null)
      setActiveEditor(null)
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
    setNodes(
      buildFlowNodes(
        snap.nodes.map((s) =>
          s.nodeKind === 'imageBox'
            ? {
                kind: 'imageBox',
                id: s.id,
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height ?? 150,
                zIndex: s.zIndex,
                src: s.src ?? '',
                thumbSrc: s.thumbSrc ?? s.src ?? '',
                alt: s.alt ?? '',
              }
            : {
                kind: 'textBox',
                id: s.id,
                x: s.x,
                y: s.y,
                width: s.width,
                maxHeight: s.maxHeight,
                frameNone: s.frameNone,
                zIndex: s.zIndex,
                doc: s.doc ?? createPlainParagraphDoc(''),
              },
        ),
      ),
    )
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
        void reactFlow.setViewport({ x: 100, y: 35, zoom: 0.105 })
        for (let attempt = 0; attempt < 25; attempt += 1) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
          if (document.querySelectorAll('.react-flow__node').length >= count) {
            break
          }
        }
      } else if (mode === 'zoom') {
        void reactFlow.setViewport({ x: 20, y: -40, zoom: 0.72 })
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
      }

      const deltas: number[] = []
      let renderedDomNodesMin = Infinity
      let renderedDomNodesMax = 0
      let activeEditorMinDuringRun = Infinity
      const minDurationMs = 3200
      const minFrames = 150
      const maxDurationMs = 25000
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
          activeEditorMinDuringRun = Math.min(
            activeEditorMinDuringRun,
            mountedEditorIdsRef.current.size,
          )

          const elapsed = now - start
          const progress = Math.min(1, elapsed / minDurationMs)
          const angle = (elapsed / minDurationMs) * Math.PI * 4

          if (mode === 'zoom-out-all') {
            const zoom = 0.105 + 0.004 * Math.sin(angle)
            const x = 100 + 12 * Math.cos(angle)
            const y = 35 + 6 * Math.sin(angle)
            void reactFlow.setViewport({ x, y, zoom })
          } else if (mode === 'zoom') {
            // Pure zoom anchored so box-edit remains inside viewport across all zoom levels
            const zoom = 0.72 + 0.36 * Math.sin(angle)
            void reactFlow.setViewport({ x: 20, y: -40, zoom })
          } else {
            // Pure pan with constant 1.0 zoom across populated rich+image stress grid
            const x = -1500 * Math.sin(progress * Math.PI) + 120 * Math.cos(angle)
            const y = -900 * Math.sin(progress * Math.PI) + 80 * Math.sin(angle)
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
        activeEditorMinDuringRun: Number.isFinite(activeEditorMinDuringRun)
          ? activeEditorMinDuringRun
          : 0,
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
      setViewport: (vp: Viewport) => {
        void reactFlow.setViewport(vp)
      },
      getViewport: () => reactFlow.getViewport(),
      getNodeState: (id: string) => {
        const node = nodesRef.current.find((n) => n.id === id)
        if (!node) return null
        return {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          width: node.data.width,
          zIndex: node.zIndex ?? 1,
          doc: node.type === 'textBox' ? node.data.doc : null,
          isEditing: node.type === 'textBox' ? node.data.isEditing : false,
          selected: Boolean(node.selected),
        }
      },
      deleteNode: (id: string) => {
        pushUndoSnapshot(makeSnapshot(nodesRef.current))
        if (editingNodeIdRef.current === id) {
          editSessionStartRef.current = null
          editSessionHasNetChangeRef.current = false
          setEditingNodeId(null)
          setActiveEditor(null)
        }
        setNodes((prev) => prev.filter((n) => n.id !== id))
      },
      selectNodes: (ids: string[]) => {
        const idSet = new Set(ids)
        if (editingNodeIdRef.current && !idSet.has(editingNodeIdRef.current)) {
          exitEditMode()
        }
        setNodes((prev) => prev.map((n) => ({ ...n, selected: idSet.has(n.id) })))
      },
      getLodState: () => lodStateRef.current,
      getLodSwitchCount: () => lodSwitchCountRef.current,
      getAllNodeCount: () => nodesRef.current.length,
      getImageNodeCount: () => nodesRef.current.filter((n) => n.type === 'imageBox').length,
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
      setNodeDocForTest: (id: string, doc: TipTapDoc) => {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === id && n.type === 'textBox' ? { ...n, data: { ...n.data, doc } } : n,
          ),
        )
      },
      setNodeFrameModeForTest: (id: string, frameNone: boolean) => {
        setNodes((prev) =>
          prev.map((n) =>
            n.id === id && n.type === 'textBox' ? { ...n, data: { ...n.data, frameNone } } : n,
          ),
        )
      },
      setMitigateActiveEditorUnmount: (enabled: boolean) => {
        mitigateRef.current = enabled
        setMitigateActiveEditorUnmount(enabled)
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
    makeSnapshot,
    measurePanZoomFps,
    pushUndoSnapshot,
    reactFlow,
    setNodes,
    tool,
  ])

  const handleNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const editingId = editingNodeIdRef.current
      if (editingId) {
        const removes = changes.getByType('remove')
        if (removes.some((c) => c.id === editingId)) {
          pushUndoSnapshot(makeSnapshot(nodesRef.current))
          editSessionStartRef.current = null
          editSessionHasNetChangeRef.current = false
          setEditingNodeId(null)
          setActiveEditor(null)
        } else {
          const selects = changes.getByType('select')
          if (selects.some((c) => c.id === editingId && c.selected === false)) {
            exitEditMode()
          }
        }
      }
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
    [exitEditMode, makeSnapshot, onNodesChange, pushUndoSnapshot],
  )

  const editingTextNode = useMemo(() => {
    if (!editingNodeId) return null
    const found = nodes.find((n) => n.id === editingNodeId && n.type === 'textBox')
    return found?.type === 'textBox' ? found : null
  }, [editingNodeId, nodes])

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
        ref={canvasStageRef}
        data-testid="canvas-stage"
        onKeyDown={() => {
          if (editingNodeIdRef.current !== null) {
            leakedCanvasKeydownsRef.current += 1
          }
        }}
        className="relative flex-1 overflow-hidden"
      >
        <LodZoomProvider
          lodState={lodState}
          onLodStateChange={handleLodStateChange}
          onLodSwitch={handleLodSwitch}
        >
          <ReactFlow<CanvasNode>
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChangeWrapped}
            onNodesDelete={handleNodesDelete}
            onPaneClick={handlePaneClick}
            onNodeClick={handleNodeClick}
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
            minZoom={0.05}
            maxZoom={4}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          >
            <LodViewportObserver onZoom={handleViewportZoom} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            {mitigateActiveEditorUnmount && editingTextNode ? (
              <ViewportPortal>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transform: `translate(${editingTextNode.position.x}px, ${editingTextNode.position.y}px)`,
                    zIndex: Math.max(1000, editingTextNode.zIndex ?? 1),
                    pointerEvents: 'auto',
                  }}
                >
                  <TextBoxSurface
                    id={editingTextNode.id}
                    data={editingTextNode.data}
                    selected={true}
                    inPortal={true}
                  />
                </div>
              </ViewportPortal>
            ) : null}
          </ReactFlow>
        </LodZoomProvider>

        {/* Screen-space floating toolbar rendered OUTSIDE React Flow viewport transform */}
        {editingTextNode && activeEditor ? (
          <FloatingToolbarOverlay
            editor={activeEditor}
            editingNode={editingTextNode}
            stageRef={canvasStageRef}
          />
        ) : null}
      </main>

      {/* Dedicated status footer outside React Flow so HUD never overlaps nodes or attribution */}
      <footer
        data-testid="s2-status-footer"
        className="z-20 flex h-8 shrink-0 items-center justify-between border-t border-border bg-card/95 px-4 text-xs"
      >
        <FooterZoomLabel nodeCount={nodes.length} />

        {lastFpsBench ? (
          <div data-testid="s2-fps-hud" className="flex items-center gap-2 font-mono text-[11px]">
            <span className="font-semibold text-foreground">
              Bench ({lastFpsBench.staticNodes} nodes · {lastFpsBench.mode} ·{' '}
              {lastFpsBench.onlyRenderVisibleElements ? 'cull:ON' : 'cull:OFF'}):
            </span>
            <span className="text-muted-foreground">
              mean {lastFpsBench.meanFps} fps · p50 {lastFpsBench.p50Ms}ms ({lastFpsBench.p50Fps}{' '}
              fps) · p95 {lastFpsBench.p95Ms}ms ({lastFpsBench.p95Fps} fps) · max{' '}
              {lastFpsBench.maxMs}ms · DOM {lastFpsBench.renderedDomNodesMin}–
              {lastFpsBench.renderedDomNodesMax}
            </span>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            Double-click box to edit · Esc/outside click to exit
          </span>
        )}
      </footer>
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
