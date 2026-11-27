import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CanvasImageElement, CanvasTextElement, TipTapDoc } from '@/domain/schema'
import { createPlainTextDoc } from '@/features/canvas/canvas-model'
import { CanvasImageSurface, CanvasTextSurface } from '@/features/canvas/CanvasNodes'
import { hasCachedTipTapDoc, renderCachedTipTapDoc } from '@/features/canvas/static-text-cache'
import { StaticTextContent } from '@/features/canvas/StaticTextContent'

const VALID_ULID = '01JC8ZQ4M7X2K9T5VB3N6D8RHW'

describe('StaticTextContent (WeakMap cache & security) & CanvasNodes [T4.2, FR-TXT-06, FR-TXT-08]', () => {
  it('caches rendered React element tree per immutable doc reference in WeakMap and refreshes on new doc reference', () => {
    const docA: TipTapDoc = createPlainTextDoc('Initial static text')
    expect(hasCachedTipTapDoc(docA)).toBe(false)

    const tree1 = renderCachedTipTapDoc(docA)
    expect(hasCachedTipTapDoc(docA)).toBe(true)
    const tree2 = renderCachedTipTapDoc(docA)
    expect(tree2).toBe(tree1)

    const { rerender } = render(<StaticTextContent doc={docA} />)
    expect(screen.getByText('Initial static text')).toBeInTheDocument()

    // New immutable doc reference MUST bypass old WeakMap entry and render updated text immediately
    const docB: TipTapDoc = createPlainTextDoc('Updated static text')
    expect(docB).not.toBe(docA)
    const treeB = renderCachedTipTapDoc(docB)
    expect(treeB).not.toBe(tree1)

    rerender(<StaticTextContent doc={docB} />)
    expect(screen.getByText('Updated static text')).toBeInTheDocument()
    expect(screen.queryByText('Initial static text')).not.toBeInTheDocument()
  })

  it('enforces rel="noopener noreferrer" on all static links, maps knovites:<ulid>, and drops unsafe hrefs', () => {
    const doc: TipTapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'External Doc',
              marks: [
                { type: 'link', attrs: { href: 'https://example.com/pwn' } },
                { type: 'textStyle', attrs: { color: 'accent' } },
              ],
            },
            { type: 'text', text: ' · ' },
            {
              type: 'text',
              text: 'Internal Ref',
              marks: [
                { type: 'link', attrs: { href: `knovites:${VALID_ULID}` } },
                { type: 'highlight', attrs: { color: 'warning' } },
              ],
            },
            { type: 'text', text: ' · ' },
            {
              type: 'text',
              text: 'Blocked XSS',
              marks: [{ type: 'link', attrs: { href: 'JaVaScRiPt:alert(1)' } }],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [{ type: 'text', text: 'payload = b"A" * 120' }],
        },
      ],
    }

    const { container } = render(<StaticTextContent doc={doc} />)

    const externalLink = screen.getByRole('link', { name: 'External Doc' })
    expect(externalLink).toHaveAttribute('href', 'https://example.com/pwn')
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(externalLink).toHaveAttribute('target', '_blank')

    const internalLink = screen.getByRole('link', { name: 'Internal Ref' })
    expect(internalLink).toHaveAttribute('href', `#/n/${VALID_ULID}`)
    expect(internalLink).toHaveAttribute('rel', 'noopener noreferrer')

    // Disallowed javascript: link must NOT render an anchor, while keeping safe text
    expect(screen.getByText(/Blocked XSS/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Blocked XSS/ })).not.toBeInTheDocument()

    // Semantic color token, highlight token, textAlign, and codeBlock rendered cleanly
    expect(container.querySelector('[data-color-token="accent"]')).toBeInTheDocument()
    expect(container.querySelector('mark[data-highlight-token="warning"]')).toBeInTheDocument()
    expect(container.querySelector('p')?.style.textAlign).toBe('center')
    expect(container.querySelector('pre code')?.textContent).toContain('payload = b"A" * 120')
  })

  it('renders frame "none", semantic card style, non-destructive textScale, and safe image placeholders', () => {
    const textEl: CanvasTextElement = {
      type: 'text',
      x: 40,
      y: 40,
      w: 300,
      z: 'a0',
      textScale: 1.5,
      style: { bg: 'none', border: 'none' },
      content: createPlainTextDoc('Scaled frameless note'),
      updatedAt: '2026-11-27T11:00:00Z',
    }

    render(<CanvasTextSurface elementId="e_scaled01" element={textEl} />)
    const box = screen.getByTestId('canvas-text-node-e_scaled01')
    expect(box).toHaveAttribute('data-text-scale', '1.5')
    const surface = screen.getByTestId('canvas-card-surface-e_scaled01')
    expect(surface).toHaveAttribute('data-frame-mode', 'none')
    expect(surface.style.backgroundColor).toBe('transparent')
    expect(surface.style.borderColor).toBe('transparent')
    expect(screen.getByText('Scaled frameless note')).toBeInTheDocument()

    const imgEl: CanvasImageElement = {
      type: 'image',
      x: 400,
      y: 40,
      w: 320,
      h: 200,
      z: 'a1',
      asset: 'assets/3fa9c1d2e4b5a671.webp',
      nw: 1600,
      nh: 1000,
      alt: 'Heap chunk layout',
      updatedAt: '2026-11-27T11:00:00Z',
    }

    render(<CanvasImageSurface elementId="e_img00001" element={imgEl} />)
    const imgCard = screen.getByTestId('canvas-image-node-e_img00001')
    expect(imgCard).toHaveTextContent('Heap chunk layout')
    expect(imgCard).toHaveTextContent('1600 × 1000')
  })
})
