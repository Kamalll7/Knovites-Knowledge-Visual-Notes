import { ArrowDown, ArrowUp, FolderInput, MoreHorizontal, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { TAG_REGEX, type NodeStatus, type NodeType } from '@/domain/schema'
import type { TreeNode } from '@/domain/tree'
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

export interface NodeMorePopoverProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly focusedNode: TreeNode
  readonly siblingIndex: number
  readonly siblingCount: number
  readonly theme: MapThemeMode
  readonly disabled: boolean
  readonly onUpdateMeta: (patch: {
    type?: NodeType
    status?: NodeStatus
    color?: string | null
    tags?: readonly string[]
  }) => Promise<{ ok: boolean; message?: string }>
  readonly onReorderNode: (direction: 'earlier' | 'later') => Promise<void>
  readonly onRequestMove: () => void
  readonly onRequestDelete: () => void
}

/**
 * Secondary node actions popover (`FR-MAP-10`, `FR-NODE-04..06`):
 * Type, Color (including Auto reset), Tags, Move earlier/later, Move to…, and Delete.
 */
export function NodeMorePopover({
  open,
  onOpenChange,
  focusedNode,
  siblingIndex,
  siblingCount,
  theme,
  disabled,
  onUpdateMeta,
  onReorderNode,
  onRequestMove,
  onRequestDelete,
}: NodeMorePopoverProps) {
  const [tagDraft, setTagDraft] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const palette = MAP_THEME_PALETTES[theme]

  const handleAddTag = async (event: FormEvent) => {
    event.preventDefault()
    const nextTag = tagDraft.trim()
    if (!TAG_REGEX.test(nextTag)) {
      setTagError('Tags use lowercase a-z, 0-9, _ or - (max 32).')
      return
    }
    if (focusedNode.meta.tags.includes(nextTag)) {
      setTagDraft('')
      setTagError(null)
      return
    }
    if (focusedNode.meta.tags.length >= 20) {
      setTagError('Maximum 20 tags per node.')
      return
    }
    const result = await onUpdateMeta({ tags: [...focusedNode.meta.tags, nextTag] })
    if (!result.ok) {
      setTagError(result.message ?? 'Invalid tag.')
      return
    }
    setTagDraft('')
    setTagError(null)
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    await onUpdateMeta({ tags: focusedNode.meta.tags.filter((t) => t !== tagToRemove) })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          data-testid="node-action-more"
          aria-label="More node actions"
          className="h-7 gap-1 px-2 text-xs"
        >
          <MoreHorizontal className="size-3.5" aria-hidden="true" />
          <span>More</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3 text-xs">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Type</p>
          <div className="grid grid-cols-2 gap-1">
            {PHASE1_NODE_TYPES.map((typeOption) => (
              <button
                key={typeOption}
                type="button"
                data-testid={`type-option-${typeOption}`}
                aria-pressed={focusedNode.meta.type === typeOption}
                onClick={() => void onUpdateMeta({ type: typeOption })}
                className={cn(
                  'rounded border px-2 py-1 text-left capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  focusedNode.meta.type === typeOption
                    ? 'border-primary/60 bg-primary/15 font-medium text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                {typeOption}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-medium text-muted-foreground">Color</p>
            <button
              type="button"
              data-testid="color-option-auto"
              aria-pressed={focusedNode.meta.color === null}
              onClick={() => void onUpdateMeta({ color: null })}
              className={cn(
                'rounded border px-1.5 py-0.5 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                focusedNode.meta.color === null
                  ? 'border-primary/60 bg-primary/15 font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Auto
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {palette.branches.map((hex, idx) => {
              const active = focusedNode.meta.color?.toLowerCase() === hex.toLowerCase()
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Color ${hex}`}
                  aria-pressed={active}
                  data-testid={`color-swatch-${idx}`}
                  onClick={() => void onUpdateMeta({ color: hex })}
                  className={cn(
                    'size-5 rounded-full border-2 transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: hex }}
                />
              )
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Tags</p>
          {focusedNode.meta.tags.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {focusedNode.meta.tags.map((tag) => (
                <span
                  key={tag}
                  data-testid={`tag-chip-${tag}`}
                  className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                >
                  <span>#{tag}</span>
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => void handleRemoveTag(tag)}
                    className="rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <form onSubmit={(e) => void handleAddTag(e)} className="flex items-center gap-1">
            <input
              type="text"
              aria-label="Add tag"
              data-testid="tag-add-input"
              maxLength={32}
              value={tagDraft}
              onChange={(e) => {
                setTagDraft(e.target.value)
                setTagError(null)
              }}
              placeholder="add-tag"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              data-testid="tag-add-submit"
              className="h-7 px-2 text-xs"
            >
              Add
            </Button>
          </form>
          {tagError ? (
            <p role="alert" className="mt-1 text-[11px] text-destructive">
              {tagError}
            </p>
          ) : null}
        </div>

        <div className="space-y-1 border-t border-border pt-2">
          <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={siblingIndex <= 0}
              data-testid="node-action-move-earlier"
              onClick={() => void onReorderNode('earlier')}
              className="h-7 gap-1 px-2 text-xs"
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
              <span>Move earlier</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={siblingIndex < 0 || siblingIndex >= siblingCount - 1}
              data-testid="node-action-move-later"
              onClick={() => void onReorderNode('later')}
              className="h-7 gap-1 px-2 text-xs"
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              <span>Move later</span>
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="node-action-move-to"
            onClick={() => {
              onOpenChange(false)
              onRequestMove()
            }}
            className="h-7 w-full justify-start gap-2 px-2 text-xs"
          >
            <FolderInput className="size-3.5" aria-hidden="true" />
            <span>Move to…</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="node-action-delete"
            onClick={() => {
              onOpenChange(false)
              onRequestDelete()
            }}
            className="h-7 w-full justify-start gap-2 px-2 text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Delete</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
