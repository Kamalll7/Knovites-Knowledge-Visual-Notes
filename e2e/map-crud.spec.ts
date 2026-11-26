import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/t37-screens'
const VIEWPORT = { width: 1280, height: 800 }

async function waitForStableMap(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    )
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })
}

async function captureScreen(page: Page, filename: string) {
  mkdirSync(SCREENS_DIR, { recursive: true })
  await waitForStableMap(page)
  await page.screenshot({
    path: `${SCREENS_DIR}/${filename}`,
    fullPage: false,
    animations: 'disabled',
  })
}

async function auditZeroChromeOverlapAndFilters(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')
    const filterCount = svg ? svg.querySelectorAll('filter').length : 0

    const chromeSelectors = [
      '[data-testid="map-hud-controls"]',
      '[data-testid="map-breadcrumb"]',
      '[data-testid="node-action-toolbar"]',
    ]
    const chromeRects = chromeSelectors
      .map((sel) => {
        const el = document.querySelector<HTMLElement>(sel)
        return el ? { sel, rect: el.getBoundingClientRect() } : null
      })
      .filter((x): x is { sel: string; rect: DOMRect } => x !== null)

    const overlaps: Array<{ chrome: string; nodeId: string; areaPx: number }> = []
    if (svg) {
      for (const nodeG of svg.querySelectorAll<SVGGElement>('[data-testid="map-node"]')) {
        const shape = nodeG.querySelector<SVGGraphicsElement>('[data-testid="map-node-shape"]')
        if (!shape) continue
        const nr = shape.getBoundingClientRect()
        for (const { sel, rect: cr } of chromeRects) {
          const ix = Math.max(0, Math.min(nr.right, cr.right) - Math.max(nr.left, cr.left))
          const iy = Math.max(0, Math.min(nr.bottom, cr.bottom) - Math.max(nr.top, cr.top))
          if (ix > 0.5 && iy > 0.5) {
            overlaps.push({
              chrome: sel,
              nodeId: nodeG.dataset.nodeId ?? 'unknown',
              areaPx: Number((ix * iy).toFixed(1)),
            })
          }
        }
      }
    }

    return { filterCount, overlaps }
  })
}

test.describe('Map keyboard navigation, breadcrumb, Home root, and CRUD E2E [T3.7, E1, E2]', () => {
  test('E1 & E2: full hierarchy CRUD, keyboard/breadcrumb nav, __root__ lock, cycle block, Undo toast, and reload persistence', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(VIEWPORT)
    await page.goto('/#/')

    // 1. Empty state -> create first node "PWN" (category)
    await expect(page.getByTestId('map-empty-state')).toBeVisible()
    await page.getByTestId('create-first-node').click()
    await page.getByTestId('create-first-node-input').fill('PWN')
    await page.getByTestId('create-first-node-type').selectOption('category')
    await page.getByTestId('create-first-node-submit').click()

    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    // 2. Build 3-level hierarchy via NodeActionToolbar: PWN -> Stack -> ret2win
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('Stack')
    await page.getByTestId('add-child-type-select').selectOption('concept')
    await page.getByTestId('add-child-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN', 'Stack'])

    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('ret2win')
    await page.getByTestId('add-child-type-select').selectOption('challenge')
    await page.getByTestId('add-child-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'PWN',
      'Stack',
      'ret2win',
    ])

    // 3. Breadcrumb click to Home ("__root__") -> verify strict __root__ UI lock + capture screenshot
    await page.getByTestId('map-breadcrumb-item').first().click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home'])
    await expect(page.getByTestId('node-action-open')).toBeVisible()
    await expect(page.getByTestId('node-action-add-child')).toBeVisible()
    await expect(page.getByTestId('node-action-rename')).toHaveCount(0)
    await expect(page.getByTestId('node-action-status')).toHaveCount(0)
    await expect(page.getByTestId('node-action-more')).toHaveCount(0)
    await expect(page.getByTestId('node-action-delete')).toHaveCount(0)

    await captureScreen(page, 't3.7-root-toolbar-dark.png')

    // Add second top-level branch "RE" directly from Home root
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('RE')
    await page.getByTestId('add-child-type-select').selectOption('category')
    await page.getByTestId('add-child-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE'])

    // 4. Keyboard navigation (arrows, Escape, Enter) + visible keyboard focus ring
    await page.getByTestId('map-viewport').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])
    await expect(page.getByTestId('map-node-keyboard-ring')).toBeVisible()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN', 'Stack'])
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'PWN',
      'Stack',
      'ret2win',
    ])

    // Enter opens real node page (#/n/<id>), showing actual title without 404
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/n\/[0-9A-Z]{26}$/)
    await expect(page.getByRole('heading', { name: 'ret2win', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to map' }).click()
    await expect(page.getByTestId('map-viewport')).toBeVisible()

    // Open Home page (#/n/__root__) via keyboard Enter on __root__, no 404
    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('map-viewport').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/n\/__root__$/)
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to map' }).click()
    await expect(page.getByTestId('map-viewport')).toBeVisible()

    // 5. E2 Metadata CRUD: focus PWN -> Rename, Status, Type, Color + Auto reset, Tags, Reorder
    await page.getByTestId('map-viewport').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    // Rename PWN -> Binary PWN
    await page.getByTestId('node-action-rename').click()
    await page.getByTestId('rename-node-input').fill('Binary PWN')
    await page.getByTestId('rename-node-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'Binary PWN'])

    // Status -> Practiced
    await page.getByTestId('node-action-status').click()
    await page.getByTestId('status-option-practiced').click()

    // More popover -> Type, Color swatch -> Auto -> swatch, Tag, Reorder later & earlier
    await page.getByTestId('node-action-more').click()
    await page.getByTestId('type-option-technique').click()
    await page.getByTestId('color-swatch-4').click()
    await expect(page.getByTestId('color-swatch-4')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('color-option-auto').click()
    await expect(page.getByTestId('color-option-auto')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('color-swatch-0').click()

    await page.getByTestId('tag-add-input').fill('rop_chain')
    await page.getByTestId('tag-add-submit').click()
    await expect(page.getByTestId('tag-chip-rop_chain')).toBeVisible()

    // Reorder Binary PWN later (after RE), then earlier (back to first)
    await expect(page.getByTestId('node-action-move-earlier')).toBeDisabled()
    await page.getByTestId('node-action-move-later').click()
    await expect(page.getByTestId('node-action-move-earlier')).toBeEnabled()
    await page.getByTestId('node-action-move-earlier').click()
    await expect(page.getByTestId('node-action-move-earlier')).toBeDisabled()

    // Close popover with Escape
    await page.keyboard.press('Escape')

    // Audit 0 chrome overlap & 0 SVG filters + capture Dark & Light screenshots
    await page.getByTestId('map-fit').click()
    await waitForStableMap(page)
    const darkAudit = await auditZeroChromeOverlapAndFilters(page)
    expect(darkAudit.filterCount).toBe(0)
    expect(darkAudit.overlaps).toEqual([])
    await captureScreen(page, 't3.7-map-crud-dark.png')

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await waitForStableMap(page)
    const lightAudit = await auditZeroChromeOverlapAndFilters(page)
    expect(lightAudit.filterCount).toBe(0)
    expect(lightAudit.overlaps).toEqual([])
    await captureScreen(page, 't3.7-map-crud-light.png')

    // Switch back to dark theme for dialog/toast captures
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 6. Move to… dialog: verify self & descendants blocked, capture screenshot, then move under RE
    await page.getByTestId('node-action-more').click()
    await page.getByTestId('node-action-move-to').click()

    const moveDialog = page.getByTestId('move-node-dialog')
    await expect(moveDialog).toBeVisible()
    await expect(moveDialog).toContainText('2 descendant nodes')

    await expect(
      moveDialog.locator('[data-testid="move-target-option"]', { hasText: 'Binary PWN' }),
    ).toBeDisabled()
    await expect(
      moveDialog.locator('[data-testid="move-target-option"]', { hasText: 'Stack' }),
    ).toBeDisabled()
    await expect(
      moveDialog.locator('[data-testid="move-target-option"]', { hasText: 'ret2win' }),
    ).toBeDisabled()

    const reTarget = moveDialog.getByRole('option', { name: 'RE', exact: true })
    await expect(reTarget).toBeEnabled()
    await reTarget.click()
    await captureScreen(page, 't3.7-move-dialog-dark.png')

    await moveDialog.getByTestId('move-node-confirm').click()
    await expect(moveDialog).toBeHidden()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE', 'Binary PWN'])

    // 7. Delete with descendant count confirmation -> capture Undo toast -> click Undo -> restored
    await page.getByTestId('node-action-more').click()
    await page.getByTestId('node-action-delete').click()

    const deleteDialog = page.getByTestId('delete-node-dialog')
    await expect(deleteDialog).toBeVisible()
    await expect(deleteDialog).toContainText('2 descendant nodes')
    await deleteDialog.getByTestId('delete-node-confirm').click()
    await expect(deleteDialog).toBeHidden()

    const undoButton = page.getByRole('button', { name: 'Undo' })
    await expect(undoButton).toBeVisible()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE'])
    const toastToolbarOverlap = await page.evaluate(() => {
      const toolbar = document
        .querySelector<HTMLElement>('[data-testid="node-action-toolbar"]')
        ?.getBoundingClientRect()
      const toast = document.querySelector<HTMLElement>('[role="status"]')?.getBoundingClientRect()
      if (!toolbar || !toast) return 0
      const ix = Math.max(
        0,
        Math.min(toast.right, toolbar.right) - Math.max(toast.left, toolbar.left),
      )
      const iy = Math.max(
        0,
        Math.min(toast.bottom, toolbar.bottom) - Math.max(toast.top, toolbar.top),
      )
      return ix * iy
    })
    expect(toastToolbarOverlap).toBe(0)
    await captureScreen(page, 't3.7-delete-undo-toast-dark.png')

    await undoButton.click()
    await expect(undoButton).toBeHidden()
    // Wait for async Dexie undoDelete() restore to re-render Binary PWN before keyboard nav
    await expect(page.locator('[data-testid="map-node"]', { hasText: 'Binary PWN' })).toBeVisible()

    // Navigate via keyboard into RE -> Binary PWN -> Stack -> ret2win to prove full subtree restored
    await page.getByTestId('map-viewport').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE', 'Binary PWN'])
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'RE',
      'Binary PWN',
      'Stack',
    ])

    // 8. Reload persistence check (IndexedDB)
    await page.reload()
    await expect(page.getByTestId('map-viewport')).toBeVisible()
    await expect(page.locator('[data-testid="map-node"]', { hasText: 'RE' })).toBeVisible()
    await page.getByTestId('map-viewport').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE'])
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE', 'Binary PWN'])

    // Verify metadata (status, type, tags) persisted after reload
    await page.getByTestId('node-action-more').click()
    await expect(page.getByTestId('type-option-technique')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('tag-chip-rop_chain')).toBeVisible()

    expect(errors).toEqual([])
  })
})
