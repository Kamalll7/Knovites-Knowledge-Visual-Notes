import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { Button } from '@/ui/components/button'

describe('App smoke test', () => {
  it('renders app heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Knovites' })).toBeInTheDocument()
  })

  it('renders shadcn Button component', () => {
    render(<Button>Action</Button>)
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })
})
