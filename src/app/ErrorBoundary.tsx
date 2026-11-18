import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Link } from 'react-router'
import { en } from '@/i18n/en'
import { Button } from '@/ui/components/button'

interface ErrorBoundaryProps {
  children: ReactNode
  resetKey?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || en.errors.unknownError,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log only non-sensitive error metadata (never tokens or note contents)
    console.error('[ErrorBoundary]', error.name, error.message, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' })
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <section
        role="alert"
        className="mx-auto my-12 max-w-lg rounded-lg border border-destructive/40 bg-card p-6 text-card-foreground shadow-sm"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{en.errors.routeTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{en.errors.routeDescription}</p>
            <p className="mt-2 rounded-sm bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
              {this.state.message}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={this.handleReset}>
                {en.errors.retry}
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/">{en.errors.backToMap}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    )
  }
}
