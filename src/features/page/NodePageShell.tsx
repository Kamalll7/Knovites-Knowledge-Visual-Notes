import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileWarning,
  Home,
  Loader2,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { VIRTUAL_ROOT_ID } from '@/domain/tree'
import {
  type NodePageSaveStatus,
  type ResolvedNodePageView,
  type RightPanelTab,
} from '@/features/page/page-helpers'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'
import { cn } from '@/ui/lib/utils'

export interface NodePageShellProps {
  readonly view: ResolvedNodePageView
  readonly homeTitle: string
  readonly saveStatus: NodePageSaveStatus
  readonly corrupt: boolean
  readonly newerSchemaVersion?: number
  readonly defaultPanelOpen?: boolean
  readonly canvasSlot: ReactNode
}

const STATUS_BADGE_CLASSES = {
  learning: 'bg-[var(--status-learning-bg)] text-[var(--status-learning)]',
  practiced: 'bg-[var(--status-practiced-bg)] text-[var(--status-practiced)]',
  mastered: 'bg-[var(--status-mastered-bg)] text-[var(--status-mastered)]',
} as const

const PANEL_TABS: ReadonlyArray<{ readonly id: RightPanelTab; readonly label: string }> = [
  { id: 'links', label: en.nodePage.linksTab },
  { id: 'children', label: en.nodePage.childrenTab },
  { id: 'info', label: en.nodePage.infoTab },
]

function SaveStatusPill({ status }: { readonly status: NodePageSaveStatus }) {
  const label =
    status === 'lazy-empty'
      ? en.nodePage.saveStatus.lazyEmpty
      : status === 'saving'
        ? en.nodePage.saveStatus.saving
        : status === 'saved'
          ? en.nodePage.saveStatus.saved
          : status === 'error'
            ? en.nodePage.saveStatus.error
            : status === 'readonly'
              ? en.nodePage.saveStatus.readonly
              : en.nodePage.saveStatus.idle

  return (
    <span
      data-testid="node-page-save-status"
      data-status={status}
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-medium',
        status === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : status === 'saving'
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border bg-secondary text-muted-foreground',
      )}
    >
      {status === 'saving' ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : status === 'saved' ? (
        <Check className="size-3 text-[var(--success)]" aria-hidden="true" />
      ) : status === 'readonly' ? (
        <Lock className="size-3" aria-hidden="true" />
      ) : null}
      <span>{label}</span>
    </span>
  )
}

export function NodePageCanvasSkeleton() {
  return (
    <div
      data-testid="node-page-canvas-skeleton"
      aria-busy="true"
      aria-label={en.nodePage.loadingCanvas}
      className="flex h-full min-h-[420px] flex-1 flex-col items-center justify-center gap-4 bg-background/60 p-8"
    >
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <div className="h-36 animate-pulse rounded-xl border border-border bg-card/80 p-4">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="mt-3 h-3 w-full rounded bg-muted/70" />
          <div className="mt-2 h-3 w-5/6 rounded bg-muted/70" />
        </div>
        <div className="h-36 animate-pulse rounded-xl border border-border bg-card/80 p-4">
          <div className="h-4 w-1/2 rounded bg-muted" />
          <div className="mt-3 h-3 w-4/5 rounded bg-muted/70" />
          <div className="mt-2 h-3 w-3/5 rounded bg-muted/70" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{en.nodePage.loadingCanvas}</p>
    </div>
  )
}

export function NodePageShell({
  view,
  homeTitle,
  saveStatus,
  corrupt,
  newerSchemaVersion,
  defaultPanelOpen,
  canvasSlot,
}: NodePageShellProps) {
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    if (defaultPanelOpen !== undefined) return defaultPanelOpen
    return typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
  })
  const [activeTab, setActiveTab] = useState<RightPanelTab>('links')

  if (view.kind === 'loading') {
    return (
      <section data-testid="node-page-loading" className="flex flex-1 flex-col">
        <NodePageCanvasSkeleton />
      </section>
    )
  }

  if (view.kind === 'not-found') {
    return (
      <section
        data-testid="node-page-not-found"
        className="mx-auto my-12 max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm"
      >
        <FileWarning className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">{en.nodePage.notFoundTitle}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{en.nodePage.notFoundDescription}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{view.nodeId}</p>
        <Button asChild size="sm" className="mt-5">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{en.nodePage.backToMap}</span>
          </Link>
        </Button>
      </section>
    )
  }

  const isHome = view.kind === 'home'
  const nodeRecord = view.kind === 'node' ? view.node : undefined
  const nodeStatus = nodeRecord?.meta.status
  const statusBadgeClass =
    nodeStatus && nodeStatus !== 'none'
      ? STATUS_BADGE_CLASSES[nodeStatus]
      : STATUS_BADGE_CLASSES.practiced
  const statusLabel =
    nodeStatus && nodeStatus !== 'none'
      ? en.map.statuses[nodeStatus]
      : isHome
        ? en.nodePage.homeBadge
        : null

  return (
    <section
      data-testid="node-page"
      data-node-id={view.nodeId}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="border-b border-border bg-card/95 px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <Button asChild variant="outline" size="sm" className="h-8 px-2.5">
              <Link to="/">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                <span>{en.nodePage.backToMap}</span>
              </Link>
            </Button>

            <div className="min-w-0 space-y-0.5">
              <nav
                aria-label="Node breadcrumb"
                data-testid="node-page-breadcrumb"
                className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
              >
                {isHome ? (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Home className="size-3" aria-hidden="true" />
                    <span>{homeTitle}</span>
                  </span>
                ) : view.kind === 'node' ? (
                  <>
                    <Link
                      to={`/n/${VIRTUAL_ROOT_ID}`}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Home className="size-3" aria-hidden="true" />
                      <span>{homeTitle}</span>
                    </Link>
                    {view.ancestors.map((anc) => (
                      <span key={anc.id} className="inline-flex items-center gap-1">
                        <span aria-hidden="true">/</span>
                        <Link to={anc.route} className="hover:text-foreground">
                          {anc.title}
                        </Link>
                      </span>
                    ))}
                    <span aria-hidden="true">/</span>
                    <span className="font-medium text-foreground">{view.title}</span>
                  </>
                ) : (
                  <>
                    <span>{en.nav.breadcrumbRoot}</span>
                    <span aria-hidden="true">/</span>
                    <span className="font-mono text-foreground">{view.nodeId}</span>
                  </>
                )}
              </nav>

              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  {view.title}
                </h1>
                {nodeRecord ? (
                  <span className="rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                    {nodeRecord.meta.type}
                  </span>
                ) : null}
                {statusLabel ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium',
                      statusBadgeClass,
                    )}
                  >
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
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SaveStatusPill status={saveStatus} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="node-page-panel-toggle"
              aria-expanded={panelOpen}
              aria-controls="node-page-side-panel"
              aria-label={panelOpen ? en.nodePage.hidePanel : en.nodePage.showPanel}
              onClick={() => setPanelOpen((prev) => !prev)}
              className="h-8 px-2.5"
            >
              {panelOpen ? (
                <PanelRightClose className="size-4" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {panelOpen ? en.nodePage.hidePanel : en.nodePage.showPanel}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {corrupt || newerSchemaVersion !== undefined ? (
        <div
          role="status"
          data-testid="node-page-readonly-banner"
          className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-foreground sm:px-6"
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            {newerSchemaVersion !== undefined
              ? `${en.nodePage.readonlyNewerSchemaPrefix} v${newerSchemaVersion}.`
              : en.nodePage.readonlyCorrupt}
          </span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-[460px] min-w-0 flex-1 flex-col">{canvasSlot}</div>

        {panelOpen ? (
          <aside
            id="node-page-side-panel"
            data-testid="node-page-side-panel"
            aria-label={en.nodePage.sidePanelTitle}
            className="flex w-72 shrink-0 flex-col border-l border-border bg-card p-3.5"
          >
            <div
              role="tablist"
              aria-label={en.nodePage.sidePanelTitle}
              className="flex items-center gap-1 border-b border-border pb-2.5"
            >
              {PANEL_TABS.map((tab) => {
                const selected = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`node-page-tab-${tab.id}`}
                    aria-selected={selected}
                    aria-controls={`node-page-tabpanel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border border-border bg-secondary text-foreground'
                        : 'border border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div
              role="tabpanel"
              id={`node-page-tabpanel-${activeTab}`}
              aria-labelledby={`node-page-tab-${activeTab}`}
              data-testid={`node-page-tab-panel-${activeTab}`}
              className="mt-3 flex-1 text-xs text-muted-foreground"
            >
              {activeTab === 'links' ? (
                <p>{en.nodePage.linksEmpty}</p>
              ) : activeTab === 'children' ? (
                <p>{en.nodePage.childrenEmpty}</p>
              ) : (
                <div className="space-y-2">
                  <p>{en.nodePage.infoEmpty}</p>
                  <dl className="space-y-1.5 rounded-md border border-border bg-background/60 p-2.5 text-[11px]">
                    <div>
                      <dt className="font-medium text-foreground">ID</dt>
                      <dd className="break-all font-mono text-muted-foreground">{view.nodeId}</dd>
                    </div>
                    {view.kind === 'node' ? (
                      <div>
                        <dt className="font-medium text-foreground">Path</dt>
                        <dd className="break-all font-mono text-muted-foreground">
                          {view.target.path}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
