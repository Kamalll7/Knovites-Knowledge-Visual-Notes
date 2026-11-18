import { ArrowRight, BookOpen, CheckCircle2, Compass, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

const BRANCH_VARS = [
  '--branch-1',
  '--branch-2',
  '--branch-3',
  '--branch-4',
  '--branch-5',
  '--branch-6',
  '--branch-7',
  '--branch-8',
] as const

export function MapPlaceholder() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-sm bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Compass className="size-3.5 text-primary" aria-hidden="true" />
              <span>{en.nav.breadcrumbRoot}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {en.map.title}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">{en.map.subtitle}</p>
          </div>
          <Button asChild>
            <Link to="/n/demo-ret2win">
              <span>{en.map.openSampleNode}</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-secondary/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{en.map.previewNodeTitle}</span>
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--status-practiced-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-practiced)]">
                <Sparkles className="size-3" aria-hidden="true" />
                <span>{en.map.statuses.practiced}</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{en.map.previewNodeMeta}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--status-learning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-learning)]">
                <BookOpen className="size-3" aria-hidden="true" />
                <span>{en.map.statuses.learning}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--status-practiced-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-practiced)]">
                <Sparkles className="size-3" aria-hidden="true" />
                <span>{en.map.statuses.practiced}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--status-mastered-bg)] px-2 py-0.5 text-xs font-medium text-[var(--status-mastered)]">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                <span>{en.map.statuses.mastered}</span>
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-secondary/60 p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {en.map.branchPaletteTitle}
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {BRANCH_VARS.map((cssVar, idx) => (
                <div
                  key={cssVar}
                  className="flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5"
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(${cssVar})` }}
                    aria-hidden="true"
                  />
                  <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
