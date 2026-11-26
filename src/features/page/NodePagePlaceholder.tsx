import { ArrowLeft, FileText, Home, Link2, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { selectPageTarget } from '@/app/store'
import { useWorkspaceStore } from '@/app/workspace-context'
import { VIRTUAL_ROOT_ID, isVirtualRootId } from '@/domain/tree'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

export interface NodePagePlaceholderProps {
  readonly forcedNodeId?: string
}

export function NodePagePlaceholder({ forcedNodeId }: NodePagePlaceholderProps = {}) {
  const { nodeId: routeNodeId } = useParams<{ nodeId: string }>()
  const rawNodeId = forcedNodeId ?? routeNodeId ?? 'unknown'

  const tree = useWorkspaceStore((s) => s.tree)
  const rootHome = useWorkspaceStore((s) => s.rootHome)
  const target = selectPageTarget({ tree, rootHome }, rawNodeId)

  const isHome = isVirtualRootId(rawNodeId)
  const nodeRecord = !isHome ? tree.nodes[rawNodeId] : undefined

  const ancestors: Array<{ id: string; title: string }> = []
  if (nodeRecord) {
    let curr = nodeRecord.parentId !== null ? tree.nodes[nodeRecord.parentId] : undefined
    const seen = new Set<string>()
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id)
      ancestors.push({ id: curr.id, title: curr.meta.title })
      curr = curr.parentId !== null ? tree.nodes[curr.parentId] : undefined
    }
    ancestors.reverse()
  }

  const headingText =
    target?.kind === 'home'
      ? target.title
      : target?.kind === 'node'
        ? target.title
        : `${en.nodePage.titlePrefix}: ${rawNodeId}`

  const statusLabel =
    nodeRecord && nodeRecord.meta.status !== 'none'
      ? en.map.statuses[nodeRecord.meta.status]
      : isHome
        ? en.nodePage.homeBadge
        : !nodeRecord
          ? en.map.statuses.practiced
          : null

  return (
    <section
      data-testid="node-page"
      data-node-id={rawNodeId}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="space-y-1">
          <div
            data-testid="node-page-breadcrumb"
            className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          >
            {isHome ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <Home className="size-3.5" aria-hidden="true" />
                <span>{rootHome.title}</span>
              </span>
            ) : nodeRecord ? (
              <>
                <Link to={`/n/${VIRTUAL_ROOT_ID}`} className="hover:text-foreground">
                  {rootHome.title}
                </Link>
                {ancestors.map((anc) => (
                  <span key={anc.id} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true">/</span>
                    <Link to={`/n/${anc.id}`} className="hover:text-foreground">
                      {anc.title}
                    </Link>
                  </span>
                ))}
                <span aria-hidden="true">/</span>
                <span className="font-medium text-foreground">{nodeRecord.meta.title}</span>
              </>
            ) : (
              <>
                <span>{en.nav.breadcrumbRoot}</span>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-foreground">{rawNodeId}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{headingText}</h1>
            {nodeRecord ? (
              <span className="rounded-sm border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {nodeRecord.meta.type}
              </span>
            ) : null}
            {statusLabel ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--status-practiced-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-practiced)]">
                <Sparkles className="size-3" aria-hidden="true" />
                <span>{statusLabel}</span>
              </span>
            ) : null}
            {nodeRecord && nodeRecord.meta.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                {nodeRecord.meta.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {isHome ? en.nodePage.homeSubtitle : en.nodePage.subtitle}
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{en.nodePage.backToMap}</span>
          </Link>
        </Button>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/70 p-8 text-center">
          <FileText className="size-8 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-base font-medium text-foreground">
            {en.nodePage.canvasPlaceholderTitle}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {isHome
              ? rootHome.hasCanvas
                ? en.nodePage.homeCanvasReadyBody
                : en.nodePage.homeCanvasLazyBody
              : en.nodePage.canvasPlaceholderBody}
          </p>
        </div>

        <aside
          aria-label={en.nodePage.sidePanelTitle}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">{en.nodePage.sidePanelTitle}</h2>
          </div>
          <div className="mt-3 flex gap-1.5 text-xs">
            <span className="rounded-sm border border-border bg-secondary px-2 py-1 font-medium text-foreground">
              {en.nodePage.linksTab}
            </span>
            <span className="rounded-sm px-2 py-1 text-muted-foreground">
              {en.nodePage.childrenTab}
            </span>
            <span className="rounded-sm px-2 py-1 text-muted-foreground">
              {en.nodePage.infoTab}
            </span>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{en.nodePage.backlinksEmpty}</p>
        </aside>
      </div>
    </section>
  )
}
