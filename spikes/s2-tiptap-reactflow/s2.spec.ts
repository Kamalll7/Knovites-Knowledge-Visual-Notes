import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const OUT_DIR = path.resolve(import.meta.dirname, 'out')

test.describe('Spike S2 — TipTap + React Flow isolation, parity, and FPS', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
  })

  test('1. mengetik teks termasuk spasi tidak memicu pan (Space) maupun tool shortcut H, T, I, ], [', async ({
    page,
  }) => {
    await page.goto('/')
    const box = page.getByTestId('text-box-box-edit')
    await box.dblclick()

    await expect(page.getByTestId('active-tiptap-editor')).toBeVisible()
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    const viewportBefore = await page.evaluate(() => window.__S2_API__?.getViewport())

    // Type spaces, tool letters H/T/I, and bracket z-order shortcuts ] / [
    await page.keyboard.type(' hello h t i H T I ] [', { delay: 10 })

    // Verify tool stayed 'select', zIndex stayed 3, viewport stayed identical, text was inserted
    expect(await page.evaluate(() => window.__S2_API__?.getTool())).toBe('select')
    const state = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit'))
    expect(state?.zIndex).toBe(3)
    expect(state?.isEditing).toBe(true)
    expect(await page.getByTestId('active-tiptap-editor').innerText()).toContain(
      'hello h t i H T I ] [',
    )

    // Hold Space + mouse drag inside editor must NOT pan viewport
    const editorBox = await page.getByTestId('active-tiptap-editor').boundingBox()
    expect(editorBox).not.toBeNull()
    await page.keyboard.down('Space')
    await page.mouse.move(editorBox!.x + 40, editorBox!.y + 15)
    await page.mouse.down()
    await page.mouse.move(editorBox!.x + 140, editorBox!.y + 45, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Space')

    const viewportAfter = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(viewportAfter).toEqual(viewportBefore)
  })

  test('2. Backspace dan Delete saat mengedit TIDAK menghapus elemen', async ({ page }) => {
    await page.goto('/')
    const initialCount = await page.evaluate(() => window.__S2_API__?.getAllNodeCount())
    await page.getByTestId('text-box-box-edit').dblclick()
    await expect(page.getByTestId('active-tiptap-editor')).toBeVisible()

    // Select a few characters and delete via Backspace and Delete
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Home')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Delete')

    expect(await page.evaluate(() => window.__S2_API__?.getAllNodeCount())).toBe(initialCount)
    await expect(page.getByTestId('text-box-box-edit')).toBeVisible()

    // Exit edit mode via Esc -> now Delete removes the selected element cleanly
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('active-tiptap-editor')).toHaveCount(0)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(0)

    // Focus flow wrapper so React Flow handles element Delete outside edit mode
    await page.getByTestId('text-box-box-edit').click()
    await page.keyboard.press('Delete')
    expect(await page.evaluate(() => window.__S2_API__?.getAllNodeCount())).toBe(initialCount! - 1)
  })

  test('3. memilih teks dengan drag mouse tidak memindahkan kotak', async ({ page }) => {
    await page.goto('/')
    const beforeState = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit'))
    expect(beforeState).not.toBeNull()

    await page.getByTestId('text-box-box-edit').dblclick()
    const editorEl = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorEl).toBeVisible()

    const box = await editorEl.boundingBox()
    expect(box).not.toBeNull()

    // Drag horizontally across the paragraph to select text
    await page.mouse.move(box!.x + 6, box!.y + 12)
    await page.mouse.down()
    await page.mouse.move(box!.x + 120, box!.y + 12, { steps: 8 })
    await page.mouse.up()

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selectedText.trim().length).toBeGreaterThan(2)

    const afterState = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit'))
    expect(afterState?.x).toBe(beforeState!.x)
    expect(afterState?.y).toBe(beforeState!.y)
  })

  test('4. scroll di dalam kotak tidak mengubah zoom atau pan kanvas', async ({ page }) => {
    await page.goto('/')
    const scrollCard = page.getByTestId('card-surface-box-scroll')
    await expect(scrollCard).toBeVisible()

    // Check overflow exists in box-scroll before and while editing
    await page.getByTestId('text-box-box-scroll').dblclick()
    await expect(page.getByTestId('active-tiptap-editor')).toBeVisible()

    const viewportBefore = await page.evaluate(() => window.__S2_API__?.getViewport())
    const scrollTopBefore = await scrollCard.evaluate((el) => el.scrollTop)

    const box = await scrollCard.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(80)

    const scrollTopAfter = await scrollCard.evaluate((el) => el.scrollTop)
    const viewportAfter = await page.evaluate(() => window.__S2_API__?.getViewport())

    expect(scrollTopAfter).toBeGreaterThan(scrollTopBefore)
    expect(viewportAfter).toEqual(viewportBefore)
  })

  test('5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorEl = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorEl).toBeVisible()
    await expect(editorEl).toBeFocused()

    // Select the first word "Alpha" via Shift+ArrowRight
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+ArrowRight')
    }

    const initialSelection = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(initialSelection).toBe('Alpha')

    // Click Bold on floating toolbar
    await page.getByTestId('toolbar-bold').click()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')
    await expect(editorEl.locator('strong')).toContainText('Alpha')

    // Click Color swatch Accent Blue
    await page.getByTestId('toolbar-color-accent-blue').click()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')

    // Open Font Size dropdown & choose 24px
    await page.getByTestId('toolbar-size-trigger').click()
    await page.getByTestId('toolbar-size-24px').click()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')

    // Open Font Family dropdown & choose JetBrains Mono
    await page.getByTestId('toolbar-font-trigger').click()
    await page.getByTestId('toolbar-font-jetbrains-mono').click()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')

    const doc = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit')?.doc)
    const firstText = doc?.content?.[0]?.content?.[0]
    expect(firstText?.text).toBe('Alpha')
    const markTypes = (firstText?.marks ?? []).map((m) => m.type)
    expect(markTypes).toContain('bold')
    expect(markTypes).toContain('textStyle')
    const styleMark = firstText?.marks?.find((m) => m.type === 'textStyle')
    expect(styleMark?.attrs?.['color']).toBe('#7c9cff')
    expect(styleMark?.attrs?.['fontSize']).toBe('24px')
    expect(styleMark?.attrs?.['fontFamily']).toContain('JetBrains Mono')
  })

  test('6. gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi', async ({
    page,
  }) => {
    await page.goto('/')
    const before = await page.evaluate(() => window.__S2_API__?.getNodeState('box-second'))
    expect(before).not.toBeNull()

    // Hover/select node to expose top-edge drag handle, then drag it
    const card = page.getByTestId('text-box-box-second')
    await card.hover()
    const handle = page.getByTestId('drag-handle-box-second')
    await expect(handle).toBeVisible()
    const hBox = await handle.boundingBox()
    expect(hBox).not.toBeNull()

    await page.mouse.move(hBox!.x + hBox!.width / 2, hBox!.y + hBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(hBox!.x + hBox!.width / 2 + 120, hBox!.y + hBox!.height / 2 + 70, {
      steps: 8,
    })
    await page.mouse.up()

    const afterDrag = await page.evaluate(() => window.__S2_API__?.getNodeState('box-second'))
    expect(afterDrag!.x).toBeGreaterThan(before!.x + 80)
    expect(afterDrag!.y).toBeGreaterThan(before!.y + 40)

    // Pan via Space + drag on empty canvas & zoom via Ctrl + wheel
    const vpBefore = await page.evaluate(() => window.__S2_API__?.getViewport())
    await page.keyboard.down('Space')
    await page.mouse.move(950, 500)
    await page.mouse.down()
    await page.mouse.move(800, 420, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Space')

    const vpAfterPan = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(vpAfterPan!.x).not.toBe(vpBefore!.x)
    expect(vpAfterPan!.y).not.toBe(vpBefore!.y)

    await page.keyboard.down('Control')
    await page.mouse.move(900, 450)
    await page.mouse.wheel(0, -180)
    await page.keyboard.up('Control')
    await page.waitForTimeout(80)

    const vpAfterZoom = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(vpAfterZoom!.zoom).toBeGreaterThan(vpAfterPan!.zoom)
  })

  test('7. Ctrl/Cmd+Z saat mengedit hanya membatalkan teks, bukan operasi kanvas', async ({
    page,
  }) => {
    await page.goto('/')
    // First record a canvas move on box-second
    await page.getByTestId('text-box-box-second').hover()
    const handleBox = await page.getByTestId('drag-handle-box-second').boundingBox()
    expect(handleBox).not.toBeNull()
    const beforePos = await page.evaluate(() => window.__S2_API__?.getNodeState('box-second'))

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2 + 100,
      handleBox!.y + handleBox!.height / 2,
      {
        steps: 6,
      },
    )
    await page.mouse.up()

    const movedPos = await page.evaluate(() => window.__S2_API__?.getNodeState('box-second'))
    expect(movedPos!.x).toBeGreaterThan(beforePos!.x + 60)
    expect(await page.evaluate(() => window.__S2_API__?.getCanvasUndoCount())).toBe(1)

    // Enter edit mode on box-edit, type extra token, then press Ctrl+Z
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorEl = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorEl).toBeFocused()
    await page.keyboard.type('EXTRA_WORD')
    await expect(page.getByTestId('active-tiptap-editor')).toContainText('EXTRA_WORD')

    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('active-tiptap-editor')).not.toContainText('EXTRA_WORD')

    // Canvas move on box-second must NOT have been undone
    const posDuringEditUndo = await page.evaluate(() =>
      window.__S2_API__?.getNodeState('box-second'),
    )
    expect(posDuringEditUndo!.x).toBe(movedPos!.x)
    expect(await page.evaluate(() => window.__S2_API__?.getCanvasUndoCount())).toBe(1)

    // Exit edit mode via Esc -> now Ctrl+Z undoes the canvas move!
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('active-tiptap-editor')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    const posAfterCanvasUndo = await page.evaluate(() =>
      window.__S2_API__?.getNodeState('box-second'),
    )
    expect(posAfterCanvasUndo!.x).toBe(beforePos!.x)
  })

  test('8. paste teks berformat dibersihkan sesuai whitelist', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorEl = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorEl).toBeVisible()

    // Select all and dispatch synthetic HTML paste event containing disallowed tags/attributes + valid ones
    await page.keyboard.press('Control+a')
    await editorEl.evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData(
        'text/html',
        '<script>window.__XSS=1;</script>' +
          '<img src="invalid" onerror="window.__XSS=2" />' +
          '<h5>HeadingFive</h5>' +
          '<p><a href="javascript:alert(1)">BadLink</a> and ' +
          '<a href="https://example.com/safe">SafeLink</a> ' +
          '<span style="position:fixed;color:rgb(255, 0, 0);font-size:24px" onclick="alert(1)"><strong>KeptBold</strong></span></p>',
      )
      dt.setData('text/plain', 'fallback plain')
      const evt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      })
      el.dispatchEvent(evt)
    })

    const xssFlag = await page.evaluate(() => (window as unknown as { __XSS?: unknown }).__XSS)
    expect(xssFlag).toBeUndefined()

    const doc = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit')?.doc)
    const serialized = JSON.stringify(doc)
    expect(serialized).not.toContain('javascript:')
    expect(serialized).not.toContain('onerror')
    expect(serialized).not.toContain('script')
    expect(serialized).toContain('BadLink')
    expect(serialized).toContain('https://example.com/safe')
    expect(serialized).toContain('#ff0000')
    expect(serialized).toContain('24px')
    expect(serialized).toContain('"type":"bold"')
    // Heading level 5 must be downgraded / excluded from heading level > 3
    expect(serialized).not.toContain('"level":5')
  })

  test('9. tampilan statis dan mode edit identik secara visual dan tangkap screenshot', async ({
    page,
  }) => {
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(10, 10)
    await page.waitForTimeout(80)

    const staticBodyShot = await page.getByTestId('richtext-body-box-rich').screenshot()
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-static-dark.png') })

    // Enter edit mode on box-rich (double-click), blur text caret briefly via transparent caret-color?
    // Keep live editor mounted (tipTapInstances === 1) and compare richtext-body pixels directly!
    await page.getByTestId('text-box-box-rich').dblclick()
    await expect(page.getByTestId('floating-toolbar')).toBeVisible()
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    // Move cursor to end / click toolbar neutral position? Compare actual rendered box directly:
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-edit-dark.png') })
    const editBodyShot = await page.getByTestId('richtext-body-box-rich').screenshot()

    // Compute exact pixel diff ratio between static body and live TipTap editor body
    const diff = await page.evaluate(
      async ({ aB64, bB64 }) => {
        const load = async (b64: string) => {
          const res = await fetch(`data:image/png;base64,${b64}`)
          return createImageBitmap(await res.blob())
        }
        const imgA = await load(aB64)
        const imgB = await load(bB64)
        const w = Math.max(imgA.width, imgB.width)
        const h = Math.max(imgA.height, imgB.height)
        const cA = new OffscreenCanvas(w, h)
        const cB = new OffscreenCanvas(w, h)
        const ctxA = cA.getContext('2d')!
        const ctxB = cB.getContext('2d')!
        ctxA.drawImage(imgA, 0, 0)
        ctxB.drawImage(imgB, 0, 0)
        const dA = ctxA.getImageData(0, 0, w, h).data
        const dB = ctxB.getImageData(0, 0, w, h).data
        let diffPixels = 0
        for (let i = 0; i < dA.length; i += 4) {
          if (
            Math.abs(dA[i]! - dB[i]!) > 8 ||
            Math.abs(dA[i + 1]! - dB[i + 1]!) > 8 ||
            Math.abs(dA[i + 2]! - dB[i + 2]!) > 8
          ) {
            diffPixels += 1
          }
        }
        const total = w * h
        return {
          widthA: imgA.width,
          heightA: imgA.height,
          widthB: imgB.width,
          heightB: imgB.height,
          diffPixels,
          diffPercent: Number(((diffPixels / total) * 100).toFixed(3)),
        }
      },
      {
        aB64: staticBodyShot.toString('base64'),
        bB64: editBodyShot.toString('base64'),
      },
    )

    console.log('S2_VISUAL_PARITY=' + JSON.stringify(diff))
    expect(diff.widthA).toBe(diff.widthB)
    expect(diff.heightA).toBe(diff.heightB)
    // Only the blinking 1px cursor / subpixel anti-aliasing may differ (< 1% pixels)
    expect(diff.diffPercent).toBeLessThan(1.0)

    // Also capture Light theme edit mode screenshot
    await page.getByTestId('theme-toggle').click()
    await expect
      .poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        ),
      )
      .toBe('#f6f8fc')
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-edit-light.png') })
  })

  test('benchmark FPS pan dan zoom dengan 100 dan 300 elemen statis + 1 editor aktif', async ({
    page,
  }) => {
    test.setTimeout(45_000)
    await page.goto('/')

    const bench100 = await page.evaluate(() => window.__S2_API__?.measurePanZoomFps(100))
    expect(bench100).toBeDefined()
    expect(bench100!.frameCount).toBeGreaterThan(5)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    const bench300 = await page.evaluate(() => window.__S2_API__?.measurePanZoomFps(300))
    expect(bench300).toBeDefined()
    expect(bench300!.frameCount).toBeGreaterThan(5)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    await page.screenshot({ path: path.join(OUT_DIR, 'stress-300-dark.png') })

    console.log(
      'S2_FPS_BENCHMARKS=' +
        JSON.stringify({
          nodes100: bench100,
          nodes300: bench300,
        }),
    )
  })
})
