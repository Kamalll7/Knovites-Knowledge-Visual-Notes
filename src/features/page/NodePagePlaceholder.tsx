import { ArrowLeft, FileText, Link2, Sparkles } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

export function NodePagePlaceholder() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const displayId = nodeId ?? 'unknown'

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{en.nav.breadcrumbRoot}</span>
            <span aria-hidden="true">/</span>
            <span className="font-mono text-foreground">{displayId}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {en.nodePage.titlePrefix}: {displayId}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--status-practiced-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-practiced)]">
              <Sparkles className="size-3" aria-hidden="true" />
              <span>{en.map.statuses.practiced}</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{en.nodePage.subtitle}</p>
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
            {en.nodePage.canvasPlaceholderBody}
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
