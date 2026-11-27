import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/t39a-screens'
const VIEWPORT = { width: 1280, height: 800 }

async function waitForStableUi(page: Page) {
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
  await waitForStableUi(page)
  await page.screenshot({
    path: `${SCREENS_DIR}/${filename}`,
    fullPage: false,
    animations: 'disabled',
  })
}

async function readCameraTransform(page: Page): Promise<{ x: number; y: number; k: number }> {
  const raw = await page.getByTestId('map-camera-group').getAttribute('transform')
  const match = raw?.match(/translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/)
  if (!match) {
    throw new Error(`Unexpected camera transform attribute: ${String(raw)}`)
  }
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    k: Number(match[3]),
  }
}

async function measureOverlapArea(page: Page, selA: string, selB: string): Promise<number> {
  return page.evaluate(
    ([a, b]) => {
      const elA = document.querySelector<HTMLElement>(a)
      const elB = document.querySelector<HTMLElement>(b)
      if (!elA || !elB) return -1
      const ra = elA.getBoundingClientRect()
      const rb = elB.getBoundingClientRect()
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left))
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top))
      return Number((ix * iy).toFixed(2))
    },
    [selA, selB],
  )
}

test.describe('Map Minimap (FR-MAP-13) & Accessible Outline View (FR-MAP-14) [T3.9a]', () => {
  test('verifies minimap non-overlap, click jump preserving zoom, outline keyboard CRUD sync, reload persistence, and captures 4 theme screenshots', async ({
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

    // 1. Seed 3-level hierarchy: PWN -> Stack -> ret2win, plus RE -> ELF and Crypto
    await expect(page.getByTestId('map-empty-state')).toBeVisible()
    await page.getByTestId('create-first-node').click()
    await page.getByTestId('create-first-node-input').fill('PWN')
    await page.getByTestId('create-first-node-type').selectOption('category')
    await page.getByTestId('create-first-node-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    await page.getByTestId('node-action-status').click()
    await page.getByTestId('status-option-practiced').click()

    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('Stack')
    await page.getByTestId('add-child-type-select').selectOption('concept')
    await page.getByTestId('add-child-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN', 'Stack'])

    await page.getByTestId('node-action-status').click()
    await page.getByTestId('status-option-learning').click()

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

    await page.getByTestId('node-action-status').click()
    await page.getByTestId('status-option-mastered').click()

    // Return to Home and add siblings RE -> ELF and Crypto
    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('RE')
    await page.getByTestId('add-child-type-select').selectOption('category')
    await page.getByTestId('add-child-submit').click()

    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('ELF')
    await page.getByTestId('add-child-type-select').selectOption('concept')
    await page.getByTestId('add-child-submit').click()

    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('Crypto')
    await page.getByTestId('add-child-type-select').selectOption('category')
    await page.getByTestId('add-child-submit').click()

    // 2. Minimap checks: zero <filter>, bottom-right placement, 0 overlap vs toolbar, HUD, and live Undo toast
    await expect(page.getByTestId('map-minimap')).toBeVisible()
    await expect(page.getByTestId('map-minimap-svg')).toBeVisible()
    const filterCount = await page.evaluate(
      () =>
        document.querySelectorAll(
          '[data-testid="map-minimap-svg"] filter, [data-testid="map-svg"] filter',
        ).length,
    )
    expect(filterCount).toBe(0)

    expect(
      await measureOverlapArea(
        page,
        '[data-testid="map-minimap"]',
        '[data-testid="node-action-toolbar"]',
      ),
    ).toBe(0)
    expect(
      await measureOverlapArea(
        page,
        '[data-testid="map-minimap"]',
        '[data-testid="map-hud-controls"]',
      ),
    ).toBe(0)

    // Verify bottom-right quadrant placement
    const minimapPosition = await page.evaluate(() => {
      const m = document
        .querySelector<HTMLElement>('[data-testid="map-minimap"]')!
        .getBoundingClientRect()
      const vp = document
        .querySelector<HTMLElement>('[data-testid="map-viewport"]')!
        .getBoundingClientRect()
      return {
        rightGap: vp.right - m.right,
        bottomGap: vp.bottom - m.bottom,
        inRightHalf: m.left > vp.left + vp.width / 2,
        inBottomHalf: m.top > vp.top + vp.height / 2,
      }
    })
    expect(minimapPosition.inRightHalf).toBe(true)
    expect(minimapPosition.inBottomHalf).toBe(true)
    expect(minimapPosition.rightGap).toBeGreaterThanOrEqual(0)
    expect(minimapPosition.bottomGap).toBeGreaterThanOrEqual(0)

    // Trigger Delete on Crypto -> assert live Undo toast has 0 px overlap vs BOTH minimap and toolbar -> Undo
    await page.getByTestId('node-action-more').click()
    await page.getByTestId('node-action-delete').click()
    await page.getByTestId('delete-node-confirm').click()

    const undoButton = page.getByRole('button', { name: 'Undo' })
    await expect(undoButton).toBeVisible()
    expect(await measureOverlapArea(page, '[role="status"]', '[data-testid="map-minimap"]')).toBe(0)
    expect(
      await measureOverlapArea(page, '[role="status"]', '[data-testid="node-action-toolbar"]'),
    ).toBe(0)

    await undoButton.click()
    await expect(undoButton).toBeHidden()
    await expect(page.locator('[data-testid="map-node"]', { hasText: 'Crypto' })).toBeVisible()

    // 3. Zoom in twice so viewport rect is noticeably smaller than full map, then click minimap to jump camera
    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('map-fit').click()
    await page.getByTestId('map-zoom-in').click()
    await page.getByTestId('map-zoom-in').click()
    await waitForStableUi(page)

    const beforeCam = await readCameraTransform(page)
    expect(beforeCam.k).toBeGreaterThan(1)

    const minimapBox = await page.getByTestId('map-minimap-svg').boundingBox()
    expect(minimapBox).not.toBeNull()
    await page.mouse.click(
      minimapBox!.x + minimapBox!.width * 0.2,
      minimapBox!.y + minimapBox!.height * 0.25,
    )
    await waitForStableUi(page)

    const afterCam = await readCameraTransform(page)
    const panDistance = Math.hypot(afterCam.x - beforeCam.x, afterCam.y - beforeCam.y)
    expect(panDistance).toBeGreaterThan(20)
    expect(Math.abs(afterCam.k - beforeCam.k)).toBeLessThan(0.001)

    // Toggle minimap hide & show cleanly
    await page.getByTestId('map-minimap-toggle').click()
    await expect(page.getByTestId('map-minimap-svg')).toHaveCount(0)
    await page.getByTestId('map-minimap-toggle').click()
    await expect(page.getByTestId('map-minimap-svg')).toBeVisible()

    // Capture Minimap Dark & Light screenshots (with clearly visible zoomed viewport rect)
    await captureScreen(page, 't3.9a-minimap-dark.png')

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await captureScreen(page, 't3.9a-minimap-light.png')

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 4. Toggle to Accessible Outline View (FR-MAP-14)
    await page.getByTestId('map-view-mode-outline').click()
    const outlineTree = page.getByRole('tree', { name: /outline/i })
    await expect(outlineTree).toBeVisible()
    await expect(page.getByTestId('map-minimap')).toHaveCount(0)
    await expect(page.getByTestId('map-orientation-radial')).toHaveCount(0)

    // Keyboard navigate in Outline: Home -> PWN -> Stack -> expand Stack (ArrowRight) -> ret2win
    const homeTreeItem = outlineTree.locator('[data-node-id="__root__"]')
    await homeTreeItem.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN', 'Stack'])

    // Expand Stack via ArrowRight, verify ret2win appears, collapse via ArrowLeft, then re-expand
    await page.keyboard.press('ArrowRight')
    await expect(outlineTree.getByRole('treeitem', { name: /ret2win/ })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(outlineTree.getByRole('treeitem', { name: /ret2win/ })).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await expect(outlineTree.getByRole('treeitem', { name: /ret2win/ })).toBeVisible()

    // Capture Outline Dark & Light screenshots
    await captureScreen(page, 't3.9a-outline-dark.png')

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await captureScreen(page, 't3.9a-outline-light.png')

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 5. Perform Add child & Rename directly from Outline via shared NodeActionToolbar
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('ROP')
    await page.getByTestId('add-child-type-select').selectOption('technique')
    await page.getByTestId('add-child-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'PWN',
      'Stack',
      'ROP',
    ])

    await page.getByTestId('node-action-rename').click()
    await page.getByTestId('rename-node-input').fill('ROP Gadgets')
    await page.getByTestId('rename-node-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'PWN',
      'Stack',
      'ROP Gadgets',
    ])
    await expect(outlineTree.getByRole('treeitem', { name: /ROP Gadgets/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Switch back to Map -> focus & breadcrumb stay synced on ROP Gadgets and minimap is visible
    await page.getByTestId('map-view-mode-map').click()
    await expect(page.getByTestId('map-minimap')).toBeVisible()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText([
      'Home',
      'PWN',
      'Stack',
      'ROP Gadgets',
    ])

    // Switch to Outline, press Enter on ROP Gadgets -> opens page route (#/n/<id>), return to Map
    await page.getByTestId('map-view-mode-outline').click()
    const ropItem = page.getByRole('tree').getByRole('treeitem', { name: /ROP Gadgets/ })
    await ropItem.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/n\/[0-9A-Z]{26}$/)
    await expect(page.getByRole('heading', { name: 'ROP Gadgets', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back to map' }).click()
    await expect(page.getByTestId('map-viewport')).toBeVisible()

    // 6. Reload persistence check (IndexedDB)
    await page.reload()
    await expect(page.getByTestId('map-viewport')).toBeVisible()
    await expect(page.locator('[data-testid="map-node"]', { hasText: 'PWN' })).toBeVisible()
    await page.getByTestId('map-view-mode-outline').click()
    const reloadedTree = page.getByRole('tree', { name: /outline/i })
    await reloadedTree.getByRole('treeitem', { name: /Stack/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(reloadedTree.getByRole('treeitem', { name: /ROP Gadgets/ })).toBeVisible()

    expect(errors).toEqual([])
  })
})
