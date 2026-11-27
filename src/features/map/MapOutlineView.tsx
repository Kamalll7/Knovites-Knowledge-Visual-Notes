import { ChevronDown, ChevronRight, Home } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { NodeStatus } from '@/domain/schema'
import type { TreeState } from '@/domain/tree'
import { MAP_THEME_PALETTES, type MapThemeMode } from '@/features/map/map-colors'
import {
  buildInitialExpandedIds,
  collectAncestorIds,
  flattenOutlineRows,
  resolveOutlineKeyCommand,
} from '@/features/map/map-outline'
import { cn } from '@/ui/lib/utils'

const STATUS_LABELS: Readonly<Record<Exclude<NodeStatus, 'none'>, string>> = {
  learning: 'Learning',
  practiced: 'Practiced',
  mastered: 'Mastered',
}

export interface MapOutlineViewProps {
  readonly tree: TreeState
  readonly rootTitle: string
  readonly focusId: string
  readonly theme: MapThemeMode
  readonly onSelectNode: (nodeId: string) => void
  readonly onOpenNode: (nodeId: string) => void
}

/**
 * Accessible WAI-ARIA TreeView outline alternative to the visual map (`FR-MAP-14`).
 * Shares `focusId` with `MapBreadcrumb`, `NodeActionToolbar`, and CRUD dialogs.
 */
export function MapOutlineView({
  tree,
  rootTitle,
  focusId,
  theme,
  onSelectNode,
  onOpenNode,
}: MapOutlineViewProps) {
  const palette = MAP_THEME_PALETTES[theme]
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() =>
    buildInitialExpandedIds(tree, focusId),
  )
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const focusAncestors = useMemo(() => collectAncestorIds(tree, focusId), [tree, focusId])

  const effectiveExpandedIds = useMemo(() => {
    if (focusAncestors.length === 0) return expandedIds
    const next = new Set(expandedIds)
    for (const id of focusAncestors) next.add(id)
    return next
  }, [expandedIds, focusAncestors])

  const rows = useMemo(
    () => flattenOutlineRows(tree, rootTitle, effectiveExpandedIds),
    [tree, rootTitle, effectiveExpandedIds],
  )

  const totalNodes = Object.keys(tree.nodes).length
  const hasVisibleFocusedRow = rows.some((r) => r.id === focusId)

  const focusRowDom = useCallback((nodeId: string) => {
    itemRefs.current.get(nodeId)?.focus()
  }, [])

  const setBranchExpanded = useCallback(
    (nodeId: string, expand: boolean) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (expand) next.add(nodeId)
        else next.delete(nodeId)
        return next
      })
      if (!expand && focusAncestors.includes(nodeId)) {
        onSelectNode(nodeId)
        focusRowDom(nodeId)
      }
    },
    [focusAncestors, focusRowDom, onSelectNode],
  )

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, rowId: string) => {
      const cmd = resolveOutlineKeyCommand(event.key, rows, rowId)
      if (!cmd) return
      event.preventDefault()
      event.stopPropagation()
      if (cmd.type === 'focus') {
        onSelectNode(cmd.nodeId)
        focusRowDom(cmd.nodeId)
      } else if (cmd.type === 'expand') {
        setBranchExpanded(cmd.nodeId, true)
      } else if (cmd.type === 'collapse') {
        setBranchExpanded(cmd.nodeId, false)
      } else if (cmd.type === 'open') {
        onOpenNode(cmd.nodeId)
      }
    },
    [focusRowDom, onOpenNode, onSelectNode, rows, setBranchExpanded],
  )

  return (
    <div
      data-testid="map-outline-view"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 py-4"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-foreground">Outline</h1>
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {totalNodes} {totalNodes === 1 ? 'node' : 'nodes'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ↑↓ navigate · ←→ collapse/expand · Enter open
          </p>
        </div>

        <ul
          role="tree"
          aria-label="Knowledge tree outline"
          data-testid="map-outline-tree"
          className="space-y-0.5 pb-6"
        >
          {rows.map((row, index) => {
            const isSelected = row.id === focusId
            const isTabStop = isSelected || (!hasVisibleFocusedRow && index === 0)
            const statusColor = row.status !== 'none' ? palette.status[row.status] : null
            const statusLabel = row.status !== 'none' ? STATUS_LABELS[row.status] : null

            return (
              <li key={row.id} role="none">
                <div
                  ref={(el) => {
                    if (el) itemRefs.current.set(row.id, el)
                    else itemRefs.current.delete(row.id)
                  }}
                  role="treeitem"
                  aria-level={row.level}
                  aria-posinset={row.posInSet}
                  aria-setsize={row.setSize}
                  aria-selected={isSelected}
                  aria-expanded={row.hasChildren ? row.isExpanded : undefined}
                  tabIndex={isTabStop ? 0 : -1}
                  data-testid="outline-item"
                  data-node-id={row.id}
                  style={{ paddingLeft: `${(row.level - 1) * 20 + 8}px` }}
                  onClick={() => {
                    onSelectNode(row.id)
                    focusRowDom(row.id)
                  }}
                  onDoubleClick={() => onOpenNode(row.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, row.id)}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-2 rounded-md pr-3 text-sm transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    isSelected
                      ? 'bg-secondary font-medium text-foreground ring-1 ring-primary/40'
                      : 'text-foreground/90 hover:bg-muted/70',
                  )}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="outline-toggle"
                      aria-label={row.isExpanded ? `Collapse ${row.title}` : `Expand ${row.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setBranchExpanded(row.id, !row.isExpanded)
                      }}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
                    >
                      {row.isExpanded ? (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span className="inline-block size-5 shrink-0" aria-hidden="true" />
                  )}

                  {row.isRoot ? (
                    <Home className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : statusColor ? (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: statusColor }}
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      className="size-2 shrink-0 rounded-full border border-border"
                      aria-hidden="true"
                    />
                  )}

                  <span className="min-w-0 flex-1 truncate">{row.title}</span>

                  {row.descendantCount > 0 ? (
                    <span
                      className="shrink-0 font-mono text-[11px] text-muted-foreground"
                      aria-label={`${row.descendantCount} descendants`}
                    >
                      · {row.descendantCount}
                    </span>
                  ) : null}

                  {statusLabel ? (
                    <span className="hidden shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
                      {statusLabel}
                    </span>
                  ) : null}

                  {row.type ? (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {row.type}
                    </span>
                  ) : null}

                  {row.isLocked ? (
                    <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                      Read-only
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
