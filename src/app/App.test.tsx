import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { MemoryRouter } from 'react-router'
import { Button } from '@/ui/components/button'

describe('App shell, routing, theme, toast, and error boundary', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.location.hash = '#/'
    document.documentElement.classList.remove('dark', 'light')
  })

  it('defaults to dark theme and renders Map route', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Knowledge Map' })).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('navigates across Map, Node, and Settings routes and toggles theme', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: 'Open sample node' }))
    expect(screen.getByRole('heading', { name: 'Node: demo-ret2win' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(window.localStorage.getItem('knovites.theme')).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Show sample toast' }))
    expect(screen.getByText('Workspace ready')).toBeInTheDocument()
  })

  it('catches route errors in ErrorBoundary and supports retry', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true

    function Boom() {
      if (shouldThrow) {
        throw new Error('Simulated route failure')
      }
      return <p>Recovered view</p>
    }

    render(
      <MemoryRouter>
        <ErrorBoundary resetKey="test">
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Simulated route failure')).toBeInTheDocument()

    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Recovered view')).toBeInTheDocument()

    errorSpy.mockRestore()
  })

  it('renders shadcn Button component', () => {
    render(<Button>Action</Button>)
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })
})
