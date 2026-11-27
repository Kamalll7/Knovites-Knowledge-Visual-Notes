import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/t41-t42-screens'
const VIEWPORT = { width: 1280, height: 800 }

async function waitForStableCanvas(page: Page) {
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
  await waitForStableCanvas(page)
  await page.screenshot({
    path: `${SCREENS_DIR}/${filename}`,
    fullPage: false,
    animations: 'disabled',
  })
}

async function readCanvasRecordFromIdb(page: Page, nodeId: string): Promise<unknown> {
  return page.evaluate(async (targetId) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('knovites-local')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('canvases', 'readonly')
        const getReq = tx.objectStore('canvases').get(targetId)
        getReq.onerror = () => {
          db.close()
          reject(getReq.error)
        }
        getReq.onsuccess = () => {
          const val = getReq.result ?? null
          db.close()
          resolve(val)
        }
      }
    })
  }, nodeId)
}

async function seedRichCanvasV2InIdb(
  page: Page,
  nodeId: string,
  nodePath: string,
  internalTargetId: string,
) {
  await page.evaluate(
    async ({ targetNodeId, targetPath, linkTargetId }) => {
      const doc = {
        schema: 2,
        elements: {
          e_rich0001: {
            type: 'text',
            x: 40,
            y: 40,
            w: 410,
            z: 'a0',
            style: { bg: 'auto', border: 'auto' },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 1 },
                  content: [{ type: 'text', text: 'Ret2Win Stack Overflow' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            { type: 'text', text: 'Offset ' },
                            {
                              type: 'text',
                              text: '72 bytes',
                              marks: [{ type: 'textStyle', attrs: { color: 'warning' } }],
                            },
                            { type: 'text', text: ' + ' },
                            {
                              type: 'text',
                              text: 'win() address',
                              marks: [{ type: 'highlight', attrs: { color: 'success' } }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [
                            {
                              type: 'text',
                              text: 'External Writeup',
                              marks: [
                                {
                                  type: 'link',
                                  attrs: { href: 'https://example.com/ret2win-writeup' },
                                },
                                { type: 'textStyle', attrs: { color: 'accent' } },
                              ],
                            },
                            { type: 'text', text: ' · ' },
                            {
                              type: 'text',
                              text: 'Stack Concept',
                              marks: [
                                { type: 'link', attrs: { href: `knovites:${linkTargetId}` } },
                                { type: 'highlight', attrs: { color: 'accent' } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'codeBlock',
                  attrs: { language: 'python' },
                  content: [
                    {
                      type: 'text',
                      text: 'payload = b"A" * 72 + p64(0x000000000040101a) + p64(0x0000000000401196)  # align rsp 16B before win()',
                    },
                  ],
                },
              ],
            },
            updatedAt: '2026-11-27T11:00:00Z',
          },
          e_none0001: {
            type: 'text',
            x: 490,
            y: 40,
            w: 340,
            z: 'a1',
            textScale: 1.35,
            style: { bg: 'none', border: 'none' },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [
                    {
                      type: 'text',
                      text: 'Frameless Callout',
                      marks: [{ type: 'textStyle', attrs: { color: 'violet' } }],
                    },
                  ],
                },
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Verify ' },
                    {
                      type: 'text',
                      text: 'danger check',
                      marks: [{ type: 'highlight', attrs: { color: 'danger' } }],
                    },
                    { type: 'text', text: ' and ' },
                    {
                      type: 'text',
                      text: 'stack alignment',
                      marks: [{ type: 'highlight', attrs: { color: 'warning' } }],
                    },
                    { type: 'text', text: '.' },
                  ],
                },
              ],
            },
            updatedAt: '2026-11-27T11:00:00Z',
          },
          e_tinted01: {
            type: 'text',
            x: 490,
            y: 235,
            w: 340,
            z: 'a2',
            style: { bg: 'accent', border: 'accent' },
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  attrs: { textAlign: 'right' },
                  content: [
                    {
                      type: 'text',
                      text: 'Mitigations: NX enabled, PIE disabled',
                      marks: [{ type: 'textStyle', attrs: { color: 'success' } }],
                    },
                  ],
                },
              ],
            },
            updatedAt: '2026-11-27T11:00:00Z',
          },
          e_img00001: {
            type: 'image',
            x: 40,
            y: 380,
            w: 410,
            h: 150,
            z: 'a3',
            asset: 'assets/3fa9c1d2e4b5a671.webp',
            nw: 1600,
            nh: 900,
            alt: 'Stack frame layout diagram',
            updatedAt: '2026-11-27T11:00:00Z',
          },
        },
      }

      const rawJson = `${JSON.stringify(doc, null, 2)}\n`

      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('knovites-local')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('canvases', 'readwrite')
          tx.objectStore('canvases').put({
            nodeId: targetNodeId,
            path: targetPath,
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
            reject(tx.error)
          }
        }
      })
    },
    { targetNodeId: nodeId, targetPath: nodePath, linkTargetId: internalTargetId },
  )
}

async function listNodesFromIdb(
  page: Page,
): Promise<Array<{ id: string; title: string; path: string }>> {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('knovites-local')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('nodes', 'readonly')
        const getAllReq = tx.objectStore('nodes').getAll()
        getAllReq.onerror = () => {
          db.close()
          reject(getAllReq.error)
        }
        getAllReq.onsuccess = () => {
          const rows = (
            getAllReq.result as Array<{ id: string; path: string; meta: { title: string } }>
          ).map((row) => ({
            id: row.id,
            title: row.meta.title,
            path: row.path,
          }))
          db.close()
          resolve(rows)
        }
      }
    })
  })
}

test.describe('NodePageShell & static React Flow canvas E2E [T4.1, T4.2, FR-PAGE, FR-CVS-01, FR-CVS-07, FR-TXT-08]', () => {
  test('renders rich static canvas, code scroll, frameless card, 400ms autosave reload persistence, and lazy Home root', async ({
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

    // 1. Create a real 3-level hierarchy: PWN -> Stack -> ret2win
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

    // Read real ULIDs from IndexedDB and seed a rich v2 canvas.json on ret2win
    const nodes = await listNodesFromIdb(page)
    const stackNode = nodes.find((n) => n.title === 'Stack')
    const ret2winNode = nodes.find((n) => n.title === 'ret2win')
    expect(stackNode).toBeDefined()
    expect(ret2winNode).toBeDefined()

    await seedRichCanvasV2InIdb(page, ret2winNode!.id, ret2winNode!.path, stackNode!.id)

    // 2. Navigate to ret2win node page from Map
    await page.getByTestId('node-action-open').click()
    await expect(page).toHaveURL(new RegExp(`#/n/${ret2winNode!.id}$`))
    await expect(page.getByRole('heading', { name: 'ret2win', exact: true })).toBeVisible()
    await expect(page.getByTestId('node-page-breadcrumb')).toContainText('Home')
    await expect(page.getByTestId('node-page-breadcrumb')).toContainText('PWN')
    await expect(page.getByTestId('node-page-breadcrumb')).toContainText('Stack')
    await expect(page.getByTestId('canvas-workspace')).toBeVisible()

    // Right panel open on desktop (1280px) with all 3 placeholder tabs working
    await expect(page.getByTestId('node-page-side-panel')).toBeVisible()
    await expect(page.getByTestId('node-page-tab-panel-links')).toBeVisible()
    await page.getByRole('tab', { name: 'Children' }).click()
    await expect(page.getByTestId('node-page-tab-panel-children')).toBeVisible()
    await page.getByRole('tab', { name: 'Info' }).click()
    await expect(page.getByTestId('node-page-tab-panel-info')).toContainText(ret2winNode!.id)
    await page.getByRole('tab', { name: 'Links' }).click()

    // 3. Verify rich static canvas elements rendered inside React Flow
    await expect(page.getByTestId('canvas-text-node-e_rich0001')).toBeVisible()
    await expect(page.getByTestId('canvas-text-node-e_none0001')).toBeVisible()
    await expect(page.getByTestId('canvas-text-node-e_tinted01')).toBeVisible()
    await expect(page.getByTestId('canvas-image-node-e_img00001')).toBeVisible()

    // Verify all static links carry rel="noopener noreferrer" + expected hrefs
    const linkChecks = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('.knovites-canvas-richtext a'),
      )
      return anchors.map((a) => ({
        text: a.textContent,
        href: a.getAttribute('href'),
        rel: a.getAttribute('rel'),
      }))
    })
    expect(linkChecks).toHaveLength(2)
    for (const link of linkChecks) {
      expect(link.rel).toBe('noopener noreferrer')
    }
    expect(linkChecks.some((l) => l.href === 'https://example.com/ret2win-writeup')).toBe(true)
    expect(linkChecks.some((l) => l.href === `#/n/${stackNode!.id}`)).toBe(true)

    // Verify code block uses white-space: pre + overflow-x: auto and genuinely overflows horizontally
    const codeMetrics = await page.evaluate(() => {
      const pre = document.querySelector<HTMLPreElement>('.knovites-canvas-richtext pre')
      if (!pre) return null
      const style = window.getComputedStyle(pre)
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        scrollWidth: pre.scrollWidth,
        clientWidth: pre.clientWidth,
      }
    })
    expect(codeMetrics).not.toBeNull()
    expect(codeMetrics!.whiteSpace).toBe('pre')
    expect(codeMetrics!.overflowX).toBe('auto')
    expect(codeMetrics!.scrollWidth).toBeGreaterThan(codeMetrics!.clientWidth)

    // Verify frameless "none" card + textScale: 1.35 + semantic highlight & color tokens
    await expect(page.getByTestId('canvas-card-surface-e_none0001')).toHaveAttribute(
      'data-frame-mode',
      'none',
    )
    await expect(page.getByTestId('canvas-text-node-e_none0001')).toHaveAttribute(
      'data-text-scale',
      '1.35',
    )
    await expect(
      page.locator('.knovites-canvas-richtext [data-color-token="warning"]'),
    ).toHaveCount(1)
    await expect(
      page.locator('.knovites-canvas-richtext mark[data-highlight-token="success"]'),
    ).toHaveCount(1)
    await expect(
      page.locator('.knovites-canvas-richtext mark[data-highlight-token="danger"]'),
    ).toHaveCount(1)

    // Screenshot 1: rich node page, header, open right panel, dark theme
    await captureScreen(page, 't4.2-page-canvas-dark.png')

    // Screenshot 2: same rich node page, light theme
    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await captureScreen(page, 't4.2-page-canvas-light.png')

    // Switch back to dark theme & collapse side panel for clear code-scroll + frameless close-up
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByTestId('node-page-panel-toggle').click()
    await expect(page.getByTestId('node-page-side-panel')).toHaveCount(0)

    // Scroll the code block horizontally and verify scrollLeft advances cleanly
    const scrolledLeft = await page.evaluate(() => {
      const pre = document.querySelector<HTMLPreElement>('.knovites-canvas-richtext pre')
      if (!pre) return 0
      pre.scrollLeft = 96
      return pre.scrollLeft
    })
    expect(scrolledLeft).toBeGreaterThan(0)

    // Hover the frameless "none" card so its subtle dashed hover cue is also visible
    await page.getByTestId('canvas-card-surface-e_none0001').hover()

    // Screenshot 4: code block horizontal scroll + "none" frame + semantic colors/highlights (dark)
    await captureScreen(page, 't4.2-code-and-none-frame-dark.png')

    // 4. Test 400 ms debounced autosave + reload persistence
    await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-element-count', '4')
    await page.getByTestId('canvas-add-text').click()
    await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-element-count', '5')
    await expect(page.getByTestId('node-page-save-status')).toHaveAttribute(
      'data-status',
      'saved',
      {
        timeout: 3000,
      },
    )

    await page.reload()
    await expect(page.getByRole('heading', { name: 'ret2win', exact: true })).toBeVisible()
    await expect(page.getByTestId('canvas-workspace')).toHaveAttribute('data-element-count', '5')
    await expect(page.getByText('New note 5')).toBeVisible()

    // 5. Navigate to Home (#/n/__root__) via breadcrumb WITHOUT editing -> verify lazy root contract
    await page.getByTestId('node-page-breadcrumb').getByRole('link', { name: 'Home' }).click()
    await expect(page).toHaveURL(/#\/n\/__root__$/)
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByTestId('canvas-empty-overlay')).toBeVisible()

    // Collapse side panel if open (reloaded page re-opens panel on 1280px desktop)
    const panelVisible = await page.getByTestId('node-page-side-panel').isVisible()
    if (panelVisible) {
      await page.getByTestId('node-page-panel-toggle').click()
      await expect(page.getByTestId('node-page-side-panel')).toHaveCount(0)
    }

    // Screenshot 3: Home (#/n/__root__) empty state + collapsed right panel (dark)
    await captureScreen(page, 't4.2-home-empty-dark.png')

    // Confirm IndexedDB `canvases` does NOT contain '__root__'
    const rootCanvasRecord = await readCanvasRecordFromIdb(page, '__root__')
    expect(rootCanvasRecord).toBeNull()

    // 6. Verify missing node ID shows clean Not-Found state and returns to Map
    await page.goto('/#/n/01ZZZZZZZZZZZZZZZZZZZZZZZZ')
    await expect(page.getByTestId('node-page-not-found')).toBeVisible()
    await page.getByRole('link', { name: 'Back to map' }).click()
    await expect(page.getByTestId('map-viewport')).toBeVisible()

    expect(errors).toEqual([])
  })
})
