import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/app/ThemeProvider'
import { createEmptyCanvas, type CanvasJson } from '@/domain/schema'
import { CanvasWorkspace } from '@/features/canvas/CanvasWorkspace'

const capturedFlowProps: Array<Record<string, unknown>> = []

vi.mock('@xyflow/react', () => {
  return {
    ReactFlowProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="rf-provider">{children}</div>
    ),
    ReactFlow: (props: Record<string, unknown>) => {
      capturedFlowProps.push(props)
      const nodes = (props['nodes'] as Array<Record<string, unknown>>) ?? []
      const nodeTypes = (props['nodeTypes'] as Record<string, React.ComponentType<unknown>>) ?? {}
      return (
        <div
          data-testid="mock-react-flow"
          data-only-render-visible={String(Boolean(props['onlyRenderVisibleElements']))}
        >
          {nodes.map((node) => {
            const NodeComp = nodeTypes[String(node['type'])]
            return <div key={String(node['id'])}>{NodeComp ? <NodeComp {...node} /> : null}</div>
          })}
          {props['children'] as ReactNode}
        </div>
      )
    },
    Background: () => <div data-testid="rf-background" />,
    BackgroundVariant: { Dots: 'dots', Lines: 'lines', Cross: 'cross' },
    Controls: () => <div data-testid="rf-controls" />,
  }
})

describe('CanvasWorkspace React Flow culling & autosave integration [T4.2, FR-CVS-01, FR-CVS-07]', () => {
  beforeEach(() => {
    capturedFlowProps.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enables onlyRenderVisibleElements on ReactFlow and saves new text boxes via 400 ms debounce', async () => {
    const onSaveDoc = vi.fn<(doc: CanvasJson) => Promise<boolean>>().mockResolvedValue(true)

    render(
      <ThemeProvider defaultTheme="dark">
        <CanvasWorkspace
          nodeId="01JC8ZQ4M7X2K9T5VB3N6D8RHW"
          initialDoc={createEmptyCanvas()}
          isHome={false}
          readOnly={false}
          onSaveDoc={onSaveDoc}
        />
      </ThemeProvider>,
    )

    expect(capturedFlowProps.length).toBeGreaterThan(0)
    expect(capturedFlowProps.at(-1)?.['onlyRenderVisibleElements']).toBe(true)
    expect(screen.getByTestId('canvas-empty-overlay')).toBeInTheDocument()
    expect(onSaveDoc).not.toHaveBeenCalled()

    // Click "+ Text" -> adds a new text box immutably and schedules 400 ms autosave
    fireEvent.click(screen.getByTestId('canvas-add-text'))
    expect(screen.queryByTestId('canvas-empty-overlay')).not.toBeInTheDocument()
    expect(onSaveDoc).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(onSaveDoc).toHaveBeenCalledTimes(1)
    expect(Object.keys(onSaveDoc.mock.calls[0]![0].elements)).toHaveLength(1)
  })

  it('does not write root Home canvas on read-only open/unmount without edits', () => {
    const onSaveDoc = vi.fn<(doc: CanvasJson) => Promise<boolean>>().mockResolvedValue(true)

    const { unmount } = render(
      <ThemeProvider defaultTheme="dark">
        <CanvasWorkspace
          nodeId="__root__"
          initialDoc={createEmptyCanvas()}
          isHome={true}
          readOnly={false}
          onSaveDoc={onSaveDoc}
        />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('canvas-empty-overlay')).toBeInTheDocument()
    unmount()
    expect(onSaveDoc).not.toHaveBeenCalled()
  })
})
