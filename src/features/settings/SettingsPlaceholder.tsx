import { Bell, GitBranch, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from '@/app/theme-context'
import { useToast } from '@/app/toast-context'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: typeof Moon
}> = [
  { value: 'dark', label: en.theme.dark, icon: Moon },
  { value: 'light', label: en.theme.light, icon: Sun },
  { value: 'system', label: en.theme.system, icon: Monitor },
]

export function SettingsPlaceholder() {
  const { theme, setTheme } = useTheme()
  const { notify } = useToast()

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {en.settings.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{en.settings.subtitle}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-medium text-foreground">{en.settings.appearanceTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{en.settings.appearanceDescription}</p>
        <div role="radiogroup" aria-label={en.theme.label} className="mt-4 flex flex-wrap gap-2">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon
            const selected = theme === option.value
            return (
              <Button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                variant={selected ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme(option.value)}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{option.label}</span>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-foreground">{en.settings.toastTestTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{en.settings.toastTestDescription}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              notify({
                title: en.settings.sampleToastTitle,
                description: en.settings.sampleToastBody,
                variant: 'success',
              })
            }
          >
            <Bell className="size-4" aria-hidden="true" />
            <span>{en.settings.triggerToastButton}</span>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <GitBranch className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-base font-medium text-foreground">{en.settings.connectionTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{en.settings.connectionBody}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
