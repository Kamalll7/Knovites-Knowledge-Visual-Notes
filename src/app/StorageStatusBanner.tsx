import { AlertTriangle, Lock } from 'lucide-react'
import { useWorkspaceStore } from '@/app/workspace-context'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

export function StorageStatusBanner() {
  const storageError = useWorkspaceStore((state) => state.storageError)
  const hasUnsavedChanges = useWorkspaceStore((state) => state.hasUnsavedChanges)
  const isReadOnlyTab = useWorkspaceStore((state) => state.isReadOnlyTab)
  const takeOverWriterLock = useWorkspaceStore((state) => state.takeOverWriterLock)

  if (!storageError && !isReadOnlyTab) {
    return null
  }

  return (
    <div className="border-b border-border bg-card">
      {storageError ? (
        <div
          role="alert"
          data-testid="storage-error-banner"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 bg-destructive/15 px-4 py-2.5 text-sm text-foreground sm:px-6"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">{en.storageBanner.errorTitle}</p>
              <p className="text-xs text-muted-foreground">
                {en.storageBanner.errorDescription} ({storageError.message})
              </p>
            </div>
          </div>
          {hasUnsavedChanges ? (
            <span className="rounded-sm border border-destructive/40 bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              {en.storageBanner.unsavedBadge}
            </span>
          ) : null}
        </div>
      ) : null}

      {isReadOnlyTab ? (
        <div
          role="status"
          data-testid="readonly-tab-banner"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 bg-primary/10 px-4 py-2.5 text-sm text-foreground sm:px-6"
        >
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">{en.storageBanner.readonlyTitle}</p>
              <p className="text-xs text-muted-foreground">
                {en.storageBanner.readonlyDescription}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="take-over-button"
            onClick={() => {
              void takeOverWriterLock()
            }}
          >
            {en.storageBanner.takeOverButton}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
