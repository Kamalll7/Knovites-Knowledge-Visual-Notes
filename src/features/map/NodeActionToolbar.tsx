import { Check, ExternalLink, Home, Pencil, Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { canMutateTreeNode } from '@/app/store'
import type { NodeStatus, NodeType } from '@/domain/schema'
import type { TreeNode } from '@/domain/tree'
import { NodeMorePopover } from '@/features/map/NodeMorePopover'
import { MAP_THEME_PALETTES, type MapThemeMode } from '@/features/map/map-colors'
import { Button } from '@/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/popover'
import { cn } from '@/ui/lib/utils'

const PHASE1_NODE_TYPES: readonly Exclude<NodeType, 'lab'>[] = [
  'category',
  'concept',
  'technique',
  'challenge',
]

const STATUS_ITEMS: readonly { readonly value: NodeStatus; readonly label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'learning', label: 'Learning' },
  { value: 'practiced', label: 'Practiced' },
  { value: 'mastered', label: 'Mastered' },
]

export interface NodeActionToolbarProps {
  readonly focusId: string
  readonly focusedNode: TreeNode | null
  readonly rootTitle: string
  readonly siblingIndex: number
  readonly siblingCount: number
  readonly theme: MapThemeMode
  readonly writeDisabled: boolean
  readonly onOpenNode: (nodeId: string) => void
  readonly onCreateChild: (
    title: string,
    type: Exclude<NodeType, 'lab'>,
  ) => Promise<{ ok: boolean; message?: string }>
  readonly onRenameNode: (title: string) => Promise<{ ok: boolean; message?: string }>
  readonly onUpdateMeta: (patch: {
    type?: NodeType
    status?: NodeStatus
    color?: string | null
    tags?: readonly string[]
  }) => Promise<{ ok: boolean; message?: string }>
  readonly onReorderNode: (direction: 'earlier' | 'later') => Promise<void>
  readonly onRequestMove: () => void
  readonly onRequestDelete: () => void
  readonly onInteractiveOpenChange?: (open: boolean) => void
}

/**
 * Focused-node action bar rendered outside `<MapViewport>` (0 px SVG overlap, `FR-MAP-10`).
 * Enforces strict `'__root__'` UI lock: virtual root exposes ONLY Open and Add child.
 */
export function NodeActionToolbar({
  focusId,
  focusedNode,
  rootTitle,
  siblingIndex,
  siblingCount,
  theme,
  writeDisabled,
  onOpenNode,
  onCreateChild,
  onRenameNode,
  onUpdateMeta,
  onReorderNode,
  onRequestMove,
  onRequestDelete,
  onInteractiveOpenChange,
}: NodeActionToolbarProps) {
  const canMutateFocus = canMutateTreeNode(focusId)
  const isMutableNode = canMutateFocus && focusedNode !== null
  const isNodeLocked =
    focusedNode !== null && (focusedNode.corrupt || focusedNode.newerSchemaVersion !== undefined)
  const mutateDisabled = writeDisabled || isNodeLocked

  const [mode, setMode] = useState<'idle' | 'add-child' | 'rename'>('idle')
  const [childTitle, setChildTitle] = useState('')
  const [childType, setChildType] = useState<Exclude<NodeType, 'lab'>>('concept')
  const [renameTitle, setRenameTitle] = useState(focusedNode?.meta.title ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const palette = MAP_THEME_PALETTES[theme]

  useEffect(() => {
    onInteractiveOpenChange?.(mode !== 'idle' || statusOpen || moreOpen)
  }, [mode, statusOpen, moreOpen, onInteractiveOpenChange])

  const handleSubmitChild = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = childTitle.trim()
    if (trimmed.length === 0) {
      setFormError('Title is required.')
      return
    }
    const result = await onCreateChild(trimmed, childType)
    if (!result.ok) {
      setFormError(result.message ?? 'Could not create node.')
      return
    }
    setChildTitle('')
    setFormError(null)
    setMode('idle')
  }

  const handleSubmitRename = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = renameTitle.trim()
    if (trimmed.length === 0) {
      setFormError('Title is required.')
      return
    }
    const result = await onRenameNode(trimmed)
    if (!result.ok) {
      setFormError(result.message ?? 'Could not rename node.')
      return
    }
    setFormError(null)
    setMode('idle')
  }

  const statusColor = (status: NodeStatus): string | null =>
    status === 'none' ? null : palette.status[status]

  const currentStatus = focusedNode?.meta.status ?? 'none'
  const currentTitle = isMutableNode ? focusedNode.meta.title || focusedNode.slug : rootTitle

  return (
    <div
      role="toolbar"
      aria-label="Node actions"
      data-testid="node-action-toolbar"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/95 px-3 py-1.5 text-xs"
    >
      <div className="flex min-w-0 items-center gap-2">
        {!isMutableNode ? (
          <Home className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        ) : statusColor(currentStatus) ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor(currentStatus)! }}
            aria-hidden="true"
          />
        ) : null}
        <span className="max-w-[14rem] truncate font-medium text-foreground" title={currentTitle}>
          {currentTitle}
        </span>
        {isMutableNode ? (
          <span className="hidden rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
            {focusedNode.meta.type}
          </span>
        ) : null}
        {isNodeLocked ? (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
            Read-only
          </span>
        ) : null}
      </div>

      {mode === 'add-child' ? (
        <form
          onSubmit={(e) => void handleSubmitChild(e)}
          className="flex flex-wrap items-center gap-1.5"
        >
          <input
            type="text"
            autoFocus
            aria-label="Child node title"
            data-testid="add-child-title-input"
            maxLength={200}
            value={childTitle}
            onChange={(e) => {
              setChildTitle(e.target.value)
              setFormError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setMode('idle')
                setFormError(null)
              }
            }}
            placeholder="New child title..."
            className="h-7 w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <select
            aria-label="Child node type"
            data-testid="add-child-type-select"
            value={childType}
            onChange={(e) => setChildType(e.target.value as Exclude<NodeType, 'lab'>)}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
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
            disabled={mutateDisabled}
            data-testid="add-child-submit"
            className="h-7 px-2.5 text-xs"
          >
            Create
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setMode('idle')
              setFormError(null)
            }}
            className="h-7 px-2 text-xs"
          >
            Cancel
          </Button>
          {formError ? (
            <span role="alert" className="text-xs text-destructive">
              {formError}
            </span>
          ) : null}
        </form>
      ) : mode === 'rename' && isMutableNode ? (
        <form
          onSubmit={(e) => void handleSubmitRename(e)}
          className="flex flex-wrap items-center gap-1.5"
        >
          <input
            type="text"
            autoFocus
            aria-label="Rename node"
            data-testid="rename-node-input"
            maxLength={200}
            value={renameTitle}
            onChange={(e) => {
              setRenameTitle(e.target.value)
              setFormError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setMode('idle')
                setFormError(null)
              }
            }}
            className="h-7 w-48 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button
            type="submit"
            size="sm"
            disabled={mutateDisabled}
            data-testid="rename-node-submit"
            className="h-7 px-2.5 text-xs"
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setMode('idle')
              setFormError(null)
            }}
            className="h-7 px-2 text-xs"
          >
            Cancel
          </Button>
          {formError ? (
            <span role="alert" className="text-xs text-destructive">
              {formError}
            </span>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="node-action-open"
            onClick={() => onOpenNode(focusId)}
            className="h-7 gap-1 px-2.5 text-xs"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span>Open</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mutateDisabled}
            data-testid="node-action-add-child"
            onClick={() => {
              setChildTitle('')
              setFormError(null)
              setMode('add-child')
            }}
            className="h-7 gap-1 px-2.5 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Add child</span>
          </Button>

          {canMutateFocus ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={mutateDisabled}
                data-testid="node-action-rename"
                onClick={() => {
                  setRenameTitle(focusedNode?.meta.title ?? rootTitle)
                  setFormError(null)
                  setMode('rename')
                }}
                className="h-7 gap-1 px-2 text-xs"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                <span>Rename</span>
              </Button>

              {focusedNode ? (
                <>
                  <Popover open={statusOpen} onOpenChange={setStatusOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={mutateDisabled}
                        data-testid="node-action-status"
                        className="h-7 gap-1.5 px-2 text-xs"
                      >
                        {statusColor(currentStatus) ? (
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: statusColor(currentStatus)! }}
                            aria-hidden="true"
                          />
                        ) : null}
                        <span>Status</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-40 p-1.5">
                      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                        Status
                      </p>
                      <div className="space-y-0.5">
                        {STATUS_ITEMS.map((item) => {
                          const active = currentStatus === item.value
                          const dot = statusColor(item.value)
                          return (
                            <button
                              key={item.value}
                              type="button"
                              data-testid={`status-option-${item.value}`}
                              onClick={() => {
                                void onUpdateMeta({ status: item.value })
                                setStatusOpen(false)
                              }}
                              className={cn(
                                'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                                active && 'bg-secondary font-medium text-foreground',
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className="size-2 rounded-full border border-border"
                                  style={
                                    dot ? { backgroundColor: dot, borderColor: dot } : undefined
                                  }
                                  aria-hidden="true"
                                />
                                <span>{item.label}</span>
                              </span>
                              {active ? (
                                <Check className="size-3.5 text-primary" aria-hidden="true" />
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <NodeMorePopover
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    focusedNode={focusedNode}
                    siblingIndex={siblingIndex}
                    siblingCount={siblingCount}
                    theme={theme}
                    disabled={mutateDisabled}
                    onUpdateMeta={onUpdateMeta}
                    onReorderNode={onReorderNode}
                    onRequestMove={onRequestMove}
                    onRequestDelete={onRequestDelete}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
