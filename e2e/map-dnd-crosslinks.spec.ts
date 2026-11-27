import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/t39b-screens'
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
  return { x: Number(match[1]), y: Number(match[2]), k: Number(match[3]) }
}

async function getNodeCenter(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  const shape = page
    .locator(`[data-testid="map-node"][data-node-id="${nodeId}"] [data-testid="map-node-shape"]`)
    .first()
  const box = await shape.boundingBox()
  if (!box) throw new Error(`Missing boundingBox for node ${nodeId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function findNodeIdByTitle(page: Page, title: string): Promise<string> {
  const node = page.locator('[data-testid="map-node"]', { hasText: title }).first()
  await expect(node).toBeVisible()
  const id = await node.getAttribute('data-node-id')
  if (!id) throw new Error(`Missing data-node-id for title ${title}`)
  return id
}

async function readIdbNodeParentId(
  page: Page,
  targetNodeId: string,
): Promise<string | null | undefined> {
  return page.evaluate(async (nodeId) => {
    return new Promise<string | null | undefined>((resolve, reject) => {
      const req = indexedDB.open('knovites-local')
      req.onerror = () => reject(req.error ?? new Error('Failed to open knovites-local IDB'))
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['nodes'], 'readonly')
        const getReq = tx.objectStore('nodes').get(nodeId)
        getReq.onsuccess = () => {
          const rec = getReq.result as { parentId?: string | null } | undefined
          db.close()
          resolve(rec ? (rec.parentId ?? null) : undefined)
        }
        getReq.onerror = () => {
          db.close()
          reject(getReq.error ?? new Error('Failed reading node from IDB'))
        }
      }
    })
  }, targetNodeId)
}

async function seedCanvasCrossLinksInIdb(
  page: Page,
  sourceNodeId: string,
  sourcePath: string,
  hrefs: readonly string[],
) {
  await page.evaluate(
    async ({ nodeId, path, linkHrefs }) => {
      const doc = {
        schema: 1,
        elements: {
          e_aa11bb22: {
            type: 'text',
            x: 40,
            y: 40,
            w: 280,
            z: 'a0',
            style: { bg: null, border: null },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: linkHrefs.map((href, idx) => ({
                    type: 'text',
                    text: `Ref ${idx + 1}`,
                    marks: [{ type: 'link', attrs: { href } }],
                  })),
                },
              ],
            },
            updatedAt: '2026-11-27T12:00:00Z',
          },
        },
      }
      const rawJson = JSON.stringify(doc)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('knovites-local')
        req.onerror = () => reject(req.error ?? new Error('Failed to open knovites-local IDB'))
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['canvases'], 'readwrite')
          const store = tx.objectStore('canvases')
          store.put({
            nodeId,
            path,
            basePath: null,
            doc,
            rawJson,
            baseBlobSha: null,
            dirty: 1,
            loaded: true,
            corrupt: false,
            deletedAt: 0,
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error ?? new Error('Failed writing canvas record'))
          }
        }
      })
    },
    { nodeId: sourceNodeId, path: sourcePath, linkHrefs: hrefs },
  )
}

test.describe('Drag-and-drop reparent (FR-MAP-15) & Cross-link arcs (FR-MAP-16) [T3.9b]', () => {
  test('verifies DnD reparent, cycle/root guards, persistence, focus/hover cross-link arcs, and captures 4 theme screenshots', async ({
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

    // 1. Seed 3-level hierarchy: PWN -> Stack -> ret2win, plus siblings RE and Crypto
    await expect(page.getByTestId('map-empty-state')).toBeVisible()
    await page.getByTestId('create-first-node').click()
    await page.getByTestId('create-first-node-input').fill('PWN')
    await page.getByTestId('create-first-node-type').selectOption('category')
    await page.getByTestId('create-first-node-submit').click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('Stack')
    await page.getByTestId('add-child-type-select').selectOption('concept')
    await page.getByTestId('add-child-submit').click()

    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('ret2win')
    await page.getByTestId('add-child-type-select').selectOption('challenge')
    await page.getByTestId('add-child-submit').click()

    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('RE')
    await page.getByTestId('add-child-type-select').selectOption('category')
    await page.getByTestId('add-child-submit').click()

    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.getByTestId('node-action-add-child').click()
    await page.getByTestId('add-child-title-input').fill('Crypto')
    await page.getByTestId('add-child-type-select').selectOption('category')
    await page.getByTestId('add-child-submit').click()

    // Focus PWN so Home, PWN, Stack, RE, Crypto are all clearly visible and fit to viewport
    const pwnId = await findNodeIdByTitle(page, 'PWN')
    const reId = await findNodeIdByTitle(page, 'RE')
    const cryptoId = await findNodeIdByTitle(page, 'Crypto')

    await page.locator(`[data-testid="map-node"][data-node-id="${pwnId}"]`).click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])
    const stackId = await findNodeIdByTitle(page, 'Stack')
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)

    // 2. Verify background drag still pans d3-zoom cleanly and normal click still changes focus
    const camBeforePan = await readCameraTransform(page)
    await page.mouse.move(100, 180)
    await page.mouse.down()
    await page.mouse.move(190, 230, { steps: 6 })
    await page.mouse.up()
    await waitForStableUi(page)
    const camAfterPan = await readCameraTransform(page)
    expect(
      Math.hypot(camAfterPan.x - camBeforePan.x, camAfterPan.y - camBeforePan.y),
    ).toBeGreaterThan(30)
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)

    // 3. Verify __root__ cannot be dragged
    const rootNode = page.locator('[data-testid="map-node"][data-node-id="__root__"]')
    await expect(rootNode).toHaveAttribute('data-draggable', 'false')
    const rootCenter = await getNodeCenter(page, '__root__')
    await page.mouse.move(rootCenter.x, rootCenter.y)
    await page.mouse.down()
    await page.mouse.move(rootCenter.x + 80, rootCenter.y + 60, { steps: 6 })
    await expect(page.getByTestId('map-drag-ghost')).toHaveCount(0)
    await page.mouse.up()
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)

    // 4. Drag PWN over its own child Stack -> invalid highlight, capture screenshot, drop -> no mutation
    const pwnCenter = await getNodeCenter(page, pwnId)
    const stackCenter = await getNodeCenter(page, stackId)
    await page.mouse.move(pwnCenter.x, pwnCenter.y)
    await page.mouse.down()
    await page.mouse.move(stackCenter.x, stackCenter.y, { steps: 10 })

    await expect(page.getByTestId('map-drag-ghost')).toBeVisible()
    await expect(page.getByTestId('map-drag-ghost')).toHaveAttribute('data-drop-status', 'invalid')
    await expect(
      page.locator(`[data-testid="map-node"][data-node-id="${stackId}"]`),
    ).toHaveAttribute('data-drop-state', 'invalid')
    await captureScreen(page, 't3.9b-dnd-invalid-dark.png')

    await page.mouse.up()
    await expect(page.getByTestId('map-drag-ghost')).toHaveCount(0)
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])

    // 5. Drag PWN over valid target RE -> valid highlight, capture screenshot, drop -> reparented!
    const pwnCenter2 = await getNodeCenter(page, pwnId)
    const reCenter = await getNodeCenter(page, reId)
    await page.mouse.move(pwnCenter2.x, pwnCenter2.y)
    await page.mouse.down()
    await page.mouse.move(reCenter.x, reCenter.y, { steps: 10 })

    await expect(page.getByTestId('map-drag-ghost')).toBeVisible()
    await expect(page.getByTestId('map-drag-ghost')).toHaveAttribute('data-drop-status', 'valid')
    await expect(page.locator(`[data-testid="map-node"][data-node-id="${reId}"]`)).toHaveAttribute(
      'data-drop-state',
      'valid',
    )
    await captureScreen(page, 't3.9b-dnd-valid-dark.png')

    await page.mouse.up()
    await expect(page.getByTestId('map-drag-ghost')).toHaveCount(0)
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE', 'PWN'])

    // Wait for Dexie applyChangeset transaction to commit before reloading
    await expect.poll(() => readIdbNodeParentId(page, pwnId)).toBe(reId)

    // Verify IndexedDB reload persistence of reparented subtree
    await page.reload()
    await expect(page.getByTestId('map-viewport')).toBeVisible()
    await expect(page.locator(`[data-testid="map-node"][data-node-id="${reId}"]`)).toBeVisible()
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)
    await page.locator(`[data-testid="map-node"][data-node-id="${reId}"]`).click()
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)
    await expect(page.locator(`[data-testid="map-node"][data-node-id="${pwnId}"]`)).toBeVisible()
    await page.locator(`[data-testid="map-node"][data-node-id="${pwnId}"]`).click()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'RE', 'PWN'])

    // Also verify drag-and-drop works in Horizontal orientation: promote PWN back onto Home (__root__)
    await page.getByTestId('map-orientation-horizontal').click()
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)
    const pwnHoriz = await getNodeCenter(page, pwnId)
    const rootHoriz = await getNodeCenter(page, '__root__')
    await page.mouse.move(pwnHoriz.x, pwnHoriz.y)
    await page.mouse.down()
    await page.mouse.move(rootHoriz.x, rootHoriz.y, { steps: 10 })
    await expect(page.getByTestId('map-drag-ghost')).toHaveAttribute('data-drop-status', 'valid')
    await page.mouse.up()
    await expect(page.getByTestId('map-breadcrumb-item')).toHaveText(['Home', 'PWN'])
    await expect.poll(() => readIdbNodeParentId(page, pwnId)).toBeNull()

    // Return to Radial orientation for cross-link visual checks
    await page.getByTestId('map-orientation-radial').click()
    await waitForStableUi(page)

    // 6. Cross-link arcs (FR-MAP-16): persist canvas with knovites:<reId> & knovites:<cryptoId>
    // (+ self-link & broken link which must be ignored) into IndexedDB and reload!
    await seedCanvasCrossLinksInIdb(page, pwnId, 'pwn', [
      `knovites:${reId}`,
      `knovites:${cryptoId}`,
      `knovites:${pwnId}`,
      'knovites:01JC8ZQ4M7X2K9T50000000099',
    ])
    await page.reload()
    await expect(page.getByTestId('map-viewport')).toBeVisible()
    await expect(page.locator(`[data-testid="map-node"][data-node-id="${pwnId}"]`)).toBeVisible()
    await page.getByTestId('map-fit').click()
    await waitForStableUi(page)

    // Initially focused on Home (__root__) -> 0 cross-link arcs visible
    await expect(page.getByTestId('map-cross-link')).toHaveCount(0)

    // Hover PWN -> 2 outgoing dashed arcs appear (PWN -> RE and PWN -> Crypto)
    const pwnHoverPt = await getNodeCenter(page, pwnId)
    await page.mouse.move(pwnHoverPt.x, pwnHoverPt.y)
    await expect(page.getByTestId('map-cross-link')).toHaveCount(2)
    const dashArray = await page
      .getByTestId('map-cross-link-path')
      .first()
      .getAttribute('stroke-dasharray')
    expect(dashArray).toBeTruthy()

    // Move mouse to empty corner -> hover ends -> 0 arcs
    await page.mouse.move(40, 140)
    await expect(page.getByTestId('map-cross-link')).toHaveCount(0)

    // Focus PWN -> 2 dashed arcs stay visible; fit & zoom out slightly so Crypto clears minimap, then capture Dark and Light screenshots
    await page.locator(`[data-testid="map-node"][data-node-id="${pwnId}"]`).click()
    await expect(page.getByTestId('map-cross-link')).toHaveCount(2)
    await page.getByTestId('map-fit').click()
    await page.getByTestId('map-zoom-out').click()
    await page.mouse.move(40, 140)
    await waitForStableUi(page)

    const filterCount = await page.evaluate(() => document.querySelectorAll('svg filter').length)
    expect(filterCount).toBe(0)

    await captureScreen(page, 't3.9b-crosslinks-dark.png')

    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await captureScreen(page, 't3.9b-crosslinks-light.png')

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // Focus incoming endpoint RE -> 1 incoming arc (PWN -> RE) visible
    await page.locator(`[data-testid="map-node"][data-node-id="${reId}"]`).click()
    await page.mouse.move(40, 140)
    await expect(page.getByTestId('map-cross-link')).toHaveCount(1)

    // Focus unrelated Home (__root__) -> 0 arcs visible
    await page.getByTestId('map-breadcrumb-item').first().click()
    await page.mouse.move(40, 140)
    await expect(page.getByTestId('map-cross-link')).toHaveCount(0)

    expect(errors).toEqual([])
  })
})
