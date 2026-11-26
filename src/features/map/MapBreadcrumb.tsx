import { ChevronRight, Home } from 'lucide-react'
import { VIRTUAL_ROOT_ID } from '@/domain/tree'
import type { BreadcrumbItem } from '@/features/map/map-breadcrumb'
import { cn } from '@/ui/lib/utils'

export interface MapBreadcrumbProps {
  readonly items: readonly BreadcrumbItem[]
  readonly onSelectNode: (nodeId: string) => void
}

/**
 * Clickable breadcrumb path (`Home > ... > Focused`) rendered in the top map bar outside `<svg>`
 * so it never overlaps map nodes (`FR-MAP-07`, `FR-MAP-11`).
 */
export function MapBreadcrumb({ items, onSelectNode }: MapBreadcrumbProps) {
  return (
    <nav
      aria-label="Map breadcrumb"
      data-testid="map-breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5"
    >
      <ol className="flex min-w-0 items-center gap-0.5">
        {items.map((item, idx) => {
          const isRoot = item.id === VIRTUAL_ROOT_ID
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-0.5">
              {idx > 0 ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                title={item.title}
                aria-current={item.isCurrent ? 'location' : undefined}
                data-testid="map-breadcrumb-item"
                data-node-id={item.id}
                onClick={() => onSelectNode(item.id)}
                className={cn(
                  'inline-flex max-w-[11rem] items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  item.isCurrent
                    ? 'bg-secondary font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                {isRoot ? <Home className="size-3 shrink-0" aria-hidden="true" /> : null}
                <span className="truncate">{item.title}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
