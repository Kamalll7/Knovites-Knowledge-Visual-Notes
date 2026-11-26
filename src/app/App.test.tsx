import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { App } from '@/app/App'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { createDexieWorkspaceAdapter, createWorkspaceStore } from '@/app/store'
import { createKnovitesDatabase } from '@/storage'
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
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.classList.contains('light')).toBe(true)

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

  it('navigates between Map, Home ("__root__"), and real persisted Node pages via keyboard and breadcrumb without 404 [T3.7]', async () => {
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('app-home-root-route-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: () => '2026-11-26T10:00:00Z',
    })
    await store.getState().hydrate()

    render(<App workspaceStore={store} />)

    // Empty state -> create first node persisted to IndexedDB
    fireEvent.click(screen.getByTestId('create-first-node'))
    fireEvent.change(screen.getByTestId('create-first-node-input'), { target: { value: 'PWN' } })
    fireEvent.click(screen.getByTestId('create-first-node-submit'))

    await waitFor(() => {
      expect(screen.getAllByTestId('map-breadcrumb-item').map((b) => b.textContent)).toEqual([
        'Home',
        'PWN',
      ])
    })

    // Click Home breadcrumb -> Enter opens Home page (#/n/__root__) showing "Home"
    fireEvent.click(screen.getAllByTestId('map-breadcrumb-item')[0]!)
    await waitFor(() => {
      expect(screen.getAllByTestId('map-breadcrumb-item')).toHaveLength(1)
    })
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    })

    // Back to map -> ArrowDown to PWN -> Enter opens actual PWN node page
    fireEvent.click(screen.getByRole('link', { name: 'Back to map' }))
    await waitFor(() => {
      expect(screen.getByTestId('map-viewport')).toBeInTheDocument()
    })
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getAllByTestId('map-breadcrumb-item').map((b) => b.textContent)).toEqual([
        'Home',
        'PWN',
      ])
    })
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PWN' })).toBeInTheDocument()
    })

    store.getState().dispose()
    db.close()
  })

  it('deletes a node via Delete dialog and restores the subtree when clicking Undo toast [T3.7, FR-NODE-05]', async () => {
    const indexedDB = new IDBFactory()
    const db = createKnovitesDatabase('app-delete-undo-toast-test', { indexedDB, IDBKeyRange })
    const store = createWorkspaceStore({
      storage: createDexieWorkspaceAdapter(db),
      now: () => '2026-11-26T10:00:00Z',
    })
    await store.getState().hydrate()

    const pwn = await store.getState().createNode({ title: 'PWN', parentId: null })
    if (!pwn.ok) throw new Error(pwn.message)
    const stack = await store.getState().createNode({ title: 'Stack', parentId: pwn.nodeId })
    if (!stack.ok) throw new Error(stack.message)

    render(<App workspaceStore={store} />)

    // Focus PWN -> More -> Delete -> confirm
    fireEvent.keyDown(screen.getByTestId('map-viewport'), { key: 'ArrowDown' })
    await waitFor(() => {
      expect(screen.getByTestId('node-action-more')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('node-action-more'))
    fireEvent.click(screen.getByTestId('node-action-delete'))

    const dialog = await screen.findByTestId('delete-node-dialog')
    expect(dialog).toHaveTextContent(/1 descendant/i)
    fireEvent.click(screen.getByTestId('delete-node-confirm'))

    await waitFor(() => {
      expect(store.getState().tree.nodes[pwn.nodeId]).toBeUndefined()
    })

    // Click Undo button rendered in the 10s toast by AppShell -> restores PWN & Stack
    const undoBtn = await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(undoBtn)

    await waitFor(() => {
      expect(store.getState().tree.nodes[pwn.nodeId]?.meta.title).toBe('PWN')
      expect(store.getState().tree.nodes[stack.nodeId]?.meta.title).toBe('Stack')
    })

    store.getState().dispose()
    db.close()
  })
})
