import { Home, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { VIRTUAL_ROOT_ID, type TreeState } from '@/domain/tree'
import {
  buildMoveTargetOptions,
  countDescendants,
  type MoveTargetBlockReason,
} from '@/features/map/move-target-picker'
import { Button } from '@/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/dialog'
import { cn } from '@/ui/lib/utils'

const BLOCK_REASON_LABELS: Readonly<Record<MoveTargetBlockReason, string>> = {
  self: 'Current node',
  descendant: 'Descendant',
  same_parent: 'Current parent',
  readonly_target: 'Read-only',
  virtual_root: 'Unavailable',
}

export interface MoveNodeDialogProps {
  readonly open: boolean
  readonly tree: TreeState
  readonly nodeId: string
  readonly rootTitle: string
  readonly disabled?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirmMove: (newParentId: string | null) => Promise<{ ok: boolean; message?: string }>
}

function MoveNodeDialogBody({
  tree,
  nodeId,
  rootTitle,
  disabled,
  onCancel,
  onConfirmMove,
}: Omit<MoveNodeDialogProps, 'open' | 'onOpenChange'> & { readonly onCancel: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const node = tree.nodes[nodeId]
  const nodeTitle = node?.meta.title || node?.slug || nodeId
  const descendantCount = useMemo(() => countDescendants(tree, nodeId), [tree, nodeId])
  const options = useMemo(
    () => buildMoveTargetOptions(tree, nodeId, query, rootTitle),
    [tree, nodeId, query, rootTitle],
  )

  const selectedOption = options.find((opt) => opt.id === selectedId && !opt.disabled) ?? null

  const handleConfirm = async () => {
    if (!selectedOption || disabled || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await onConfirmMove(selectedOption.parentId)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not move node.')
      return
    }
    onCancel()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move &ldquo;{nodeTitle}&rdquo;</DialogTitle>
        <DialogDescription>
          {descendantCount > 0
            ? `Choose a new parent folder. This will also move ${descendantCount} descendant ${descendantCount === 1 ? 'node' : 'nodes'}.`
            : 'Choose a new parent folder for this node.'}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-3 space-y-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Filter destination"
            data-testid="move-target-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter destination..."
            className="h-8 w-full rounded-md border border-input bg-background pr-2.5 pl-8 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div
          role="listbox"
          aria-label="Destination nodes"
          className="max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-border bg-background/60 p-1"
        >
          {options.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No matching destinations.
            </p>
          ) : (
            options.map((opt) => {
              const isSelected = selectedOption?.id === opt.id
              const isRoot = opt.id === VIRTUAL_ROOT_ID
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  data-testid="move-target-option"
                  data-target-id={opt.id}
                  onClick={() => {
                    setSelectedId(opt.id)
                    setError(null)
                  }}
                  style={{ paddingLeft: `${8 + Math.min(opt.depth, 6) * 14}px` }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    opt.disabled
                      ? 'cursor-not-allowed text-muted-foreground/55'
                      : isSelected
                        ? 'bg-primary/20 font-medium text-foreground ring-1 ring-primary/60'
                        : 'text-foreground hover:bg-muted/70',
                  )}
                >
                  <span
                    className="flex min-w-0 items-center gap-1.5 truncate"
                    title={opt.pathLabel}
                  >
                    {isRoot ? <Home className="size-3 shrink-0" aria-hidden="true" /> : null}
                    <span className="truncate">{opt.title}</span>
                  </span>
                  {opt.disabled && opt.disabledReason ? (
                    <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {BLOCK_REASON_LABELS[opt.disabledReason]}
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!selectedOption || disabled || submitting}
          data-testid="move-node-confirm"
          onClick={() => void handleConfirm()}
        >
          Move here
        </Button>
      </DialogFooter>
    </>
  )
}

export function MoveNodeDialog({ open, onOpenChange, nodeId, ...rest }: MoveNodeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="move-node-dialog">
        {open ? (
          <MoveNodeDialogBody
            key={nodeId}
            nodeId={nodeId}
            onCancel={() => onOpenChange(false)}
            {...rest}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export interface DeleteNodeDialogProps {
  readonly open: boolean
  readonly tree: TreeState
  readonly nodeId: string
  readonly disabled?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirmDelete: () => Promise<{ ok: boolean; message?: string }>
}

export function DeleteNodeDialog({
  open,
  tree,
  nodeId,
  disabled,
  onOpenChange,
  onConfirmDelete,
}: DeleteNodeDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const node = tree.nodes[nodeId]
  const nodeTitle = node?.meta.title || node?.slug || nodeId
  const descendantCount = useMemo(() => countDescendants(tree, nodeId), [tree, nodeId])

  const handleConfirm = async () => {
    if (disabled || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await onConfirmDelete()
    setSubmitting(false)
    if (!result.ok) {
      setError(result.message ?? 'Could not delete node.')
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null)
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent data-testid="delete-node-dialog">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{nodeTitle}&rdquo;?</DialogTitle>
          <DialogDescription>
            {descendantCount > 0
              ? `This will also delete ${descendantCount} descendant ${descendantCount === 1 ? 'node' : 'nodes'}. You can undo within 10 seconds.`
              : 'This node will be removed from the map. You can undo within 10 seconds.'}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="delete-node-cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={disabled || submitting}
            data-testid="delete-node-confirm"
            onClick={() => void handleConfirm()}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
