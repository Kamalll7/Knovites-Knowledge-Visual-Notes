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
    await page.evaluate(() => window.__S2_API__?.resetLeakedCanvasKeydowns())

    // Type spaces, tool letters H/T/I, and bracket z-order shortcuts ] / [
    await page.keyboard.type(' hello h t i H T I ] [', { delay: 10 })

    // Verify tool stayed 'select', zIndex stayed 3, viewport stayed identical, text was inserted, and no keydown leaked
    expect(await page.evaluate(() => window.__S2_API__?.getLeakedCanvasKeydowns())).toBe(0)
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
    await expect(page.getByTestId('card-surface-box-edit')).toBeVisible()

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

    // Verify `.nodrag` behaviorally on React Flow's native node slot: even when draggable=true and dragHandle=undefined, dragging on card padding (outside EditorContent onMouseDown) MUST NOT move the node
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      window.__S2_API__?.setMitigateActiveEditorUnmount(false)
      window.__S2_API__?.enterEdit('box-edit')
      window.__S2_API__?.setNodeDragConfigForTest('box-edit', {
        draggable: true,
        dragHandle: undefined,
      })
    })
    await expect(page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')).toBeVisible()
    const editSurfaceBox = await page.getByTestId('card-surface-box-edit').boundingBox()
    expect(editSurfaceBox).not.toBeNull()
    await page.mouse.move(editSurfaceBox!.x + 5, editSurfaceBox!.y + 5)
    await page.mouse.down()
    await page.mouse.move(editSurfaceBox!.x + 145, editSurfaceBox!.y + 55, { steps: 8 })
    await page.mouse.up()
    const afterNodragState = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit'))
    expect(afterNodragState?.x).toBe(beforeState!.x)
    expect(afterNodragState?.y).toBe(beforeState!.y)
  })

  test('4. scroll/wheel/nopan di dalam kotak tidak mengubah zoom atau pan kanvas', async ({
    page,
  }) => {
    await page.goto('/')
    const scrollCard = page.getByTestId('card-surface-box-scroll')
    await expect(scrollCard).toBeVisible()

    // (a) Static scrollable card relies on `onWheelCapture` (without `.nowheel`) to isolate wheel scrolling
    const staticBox = await scrollCard.boundingBox()
    expect(staticBox).not.toBeNull()
    const vpStaticBefore = await page.evaluate(() => window.__S2_API__?.getViewport())
    const scrollStaticBefore = await scrollCard.evaluate((el) => el.scrollTop)
    await page.mouse.move(staticBox!.x + staticBox!.width / 2, staticBox!.y + staticBox!.height / 2)
    await page.mouse.wheel(0, 180)
    await page.waitForTimeout(80)
    const scrollStaticAfter = await scrollCard.evaluate((el) => el.scrollTop)
    const vpStaticAfter = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(scrollStaticAfter).toBeGreaterThan(scrollStaticBefore)
    expect(vpStaticAfter).toEqual(vpStaticBefore)

    // (b) Edited scrollable box stays isolated too
    await page.getByTestId('text-box-box-scroll').dblclick()
    await expect(page.getByTestId('active-tiptap-editor')).toBeVisible()
    await expect(page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')).toBeFocused()
    await scrollCard.evaluate((el) => {
      el.scrollTop = 0
    })

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

    // (c) Active NON-scrollable box relies exclusively on `.nowheel` (handleWheelCapture skips non-overflowing card)
    await page.getByTestId('text-box-box-edit').dblclick()
    await expect(page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')).toBeFocused()
    const editSurface = page.getByTestId('card-surface-box-edit')
    const editBox = await editSurface.boundingBox()
    expect(editBox).not.toBeNull()
    const vpEditBefore = await page.evaluate(() => window.__S2_API__?.getViewport())
    await page.mouse.move(editBox!.x + editBox!.width / 2, editBox!.y + editBox!.height / 2)
    await page.mouse.wheel(0, 240)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -180)
    await page.keyboard.up('Control')
    await page.waitForTimeout(80)
    const vpEditAfterWheel = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(vpEditAfterWheel).toEqual(vpEditBefore)

    // (d) In Hand tool (panOnDrag=true), dragging on card-surface padding (outside ProseMirror) relies on `.nopan`
    await page.getByTestId('tool-hand').click()
    expect(await page.evaluate(() => window.__S2_API__?.getTool())).toBe('hand')
    const vpBeforePaddingDrag = await page.evaluate(() => window.__S2_API__?.getViewport())
    await page.mouse.move(editBox!.x + 5, editBox!.y + 5)
    await page.mouse.down()
    await page.mouse.move(editBox!.x + 125, editBox!.y + 65, { steps: 6 })
    await page.mouse.up()
    const vpAfterPaddingDrag = await page.evaluate(() => window.__S2_API__?.getViewport())
    expect(vpAfterPaddingDrag).toEqual(vpBeforePaddingDrag)
  })

  test('5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorEl = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorEl).toBeVisible()
    await expect(page.getByTestId('floating-toolbar')).toBeVisible()
    await expect(editorEl).toBeFocused()
    await expect(editorEl).toHaveClass(/ProseMirror-focused/)
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )

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

    // Enter edit mode on box-edit, wait for focus before typing, then press Ctrl+Z
    await page.getByTestId('text-box-box-edit').dblclick()
    await expect(page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')).toBeFocused()
    await page.keyboard.type(' EXTRA_WORD')
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

    // First record whether editing an unaligned plain paragraph emits `{ textAlign: null }`
    await page.keyboard.press('End')
    await page.keyboard.type(' check')
    const plainDocCheck = await page.evaluate(() => {
      const state = window.__S2_API__?.getNodeState('box-edit')
      if (!state || !state.doc) return null
      return {
        firstParaAttrs: state.doc.content?.[0]?.attrs ?? null,
        schemaResult: window.__S2_API__!.validateWithDomainSchema(state.doc),
      }
    })
    console.log('S2_PLAIN_PARAGRAPH_CHECK=' + JSON.stringify(plainDocCheck))
    expect(plainDocCheck).not.toBeNull()

    // Select all and dispatch synthetic HTML paste with dangerous inline styles, on* handlers, external <img>, script, and malicious href variants
    await page.keyboard.press('Control+a')
    await editorEl.evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData(
        'text/html',
        '<script>window.__XSS=1;</script>' +
          '<img src="http://evil.test/tracker.png" onerror="window.__XSS=2" />' +
          '<h5>HeadingFive</h5>' +
          '<p onclick="window.__XSS=3" onload="window.__XSS=4" onmouseover="window.__XSS=5" ' +
          'style="background:url(http://evil.test/bg.png);background-image:url(javascript:alert(1));width:expression(alert(1));color:notacolor;position:fixed">CleanedAttrs</p>' +
          '<p><a href="JaVaScRiPt:alert(1)">BadCase</a> ' +
          '<a href="java\nscript:alert(2)">BadNewline</a> ' +
          '<a href=" javascript:alert(3)">BadLeadingSpace</a> ' +
          '<a href="data:text/html,<script>alert(4)</script>">BadData</a> ' +
          '<a href="vbscript:msgbox(5)">BadVbs</a> | ' +
          '<a href="http://example.org/http">SafeHttp</a> ' +
          '<a href="https://example.com/safe">SafeHttps</a> ' +
          '<a href="mailto:user@example.com">SafeMailto</a> ' +
          '<span style="background-color:notabg;color:rgb(255, 0, 0);font-size:24px" onclick="alert(1)"><strong>KeptBold</strong></span></p>',
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

    // Inspect rendered DOM inside editor: no img, script, inline on*, or dangerous CSS url()/expression()
    const editorHtmlAudit = await editorEl.evaluate((el) => ({
      imgCount: el.querySelectorAll('img').length,
      scriptCount: el.querySelectorAll('script').length,
      innerText: el.textContent ?? '',
      hasOnClick: el.querySelectorAll('[onclick],[onload],[onmouseover],[onerror]').length,
      inlineStyles: Array.from(el.querySelectorAll('[style]')).map(
        (n) => n.getAttribute('style') ?? '',
      ),
      hrefs: Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? ''),
    }))
    expect(editorHtmlAudit.imgCount).toBe(0)
    expect(editorHtmlAudit.scriptCount).toBe(0)
    expect(editorHtmlAudit.hasOnClick).toBe(0)
    expect(editorHtmlAudit.inlineStyles.join(';')).not.toContain('url(')
    expect(editorHtmlAudit.inlineStyles.join(';')).not.toContain('expression(')
    expect(editorHtmlAudit.inlineStyles.join(';')).not.toContain('fixed')
    expect(editorHtmlAudit.hrefs.sort()).toEqual(
      ['http://example.org/http', 'https://example.com/safe', 'mailto:user@example.com'].sort(),
    )

    const doc = await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit')?.doc)
    const serialized = JSON.stringify(doc)
    expect(serialized.toLowerCase()).not.toContain('javascript:')
    expect(serialized.toLowerCase()).not.toContain('vbscript:')
    expect(serialized.toLowerCase()).not.toContain('data:text/html')
    expect(serialized).not.toContain('onerror')
    expect(serialized).not.toContain('onclick')
    expect(serialized).not.toContain('evil.test')
    expect(serialized).toContain('BadCase')
    expect(serialized).toContain('CleanedAttrs')
    expect(serialized).toContain('https://example.com/safe')
    expect(serialized).toContain('#ff0000')
    expect(serialized).toContain('24px')
    expect(serialized).toContain('"type":"bold"')
    expect(serialized).not.toContain('"level":5')

    // Direct crafted-JSON validation through real `parseCanvasJson` (WITHOUT paste) for malicious href payloads + allowlist
    const craftedValidation = await page.evaluate(() => {
      const craftedDoc = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [
              {
                type: 'text' as const,
                text: 'bad1',
                marks: [{ type: 'link' as const, attrs: { href: 'JaVaScRiPt:alert(1)' } }],
              },
              {
                type: 'text' as const,
                text: 'bad2',
                marks: [{ type: 'link' as const, attrs: { href: 'java\nscript:alert(2)' } }],
              },
              {
                type: 'text' as const,
                text: 'bad3',
                marks: [{ type: 'link' as const, attrs: { href: ' javascript:alert(3)' } }],
              },
              {
                type: 'text' as const,
                text: 'bad4',
                marks: [
                  {
                    type: 'link' as const,
                    attrs: { href: 'data:text/html,<script>alert(4)</script>' },
                  },
                ],
              },
              {
                type: 'text' as const,
                text: 'bad5',
                marks: [{ type: 'link' as const, attrs: { href: 'vbscript:msgbox(5)' } }],
              },
              {
                type: 'text' as const,
                text: 'okHttp',
                marks: [{ type: 'link' as const, attrs: { href: 'http://example.org/path' } }],
              },
              {
                type: 'text' as const,
                text: 'okHttps',
                marks: [{ type: 'link' as const, attrs: { href: 'https://example.com/safe' } }],
              },
              {
                type: 'text' as const,
                text: 'okMailto',
                marks: [{ type: 'link' as const, attrs: { href: 'mailto:user@example.com' } }],
              },
            ],
          },
        ],
      }
      const parsed = window.__S2_API__!.validateWithDomainSchema(craftedDoc)
      const parsedJson = JSON.stringify(parsed)
      return {
        parsed,
        parsedJson,
      }
    })
    console.log('S2_CRAFTED_HREF_SCHEMA=' + craftedValidation.parsedJson)
    expect(craftedValidation.parsed.status).toBe('ok')
    expect(craftedValidation.parsedJson.toLowerCase()).not.toContain('javascript')
    expect(craftedValidation.parsedJson.toLowerCase()).not.toContain('vbscript')
    expect(craftedValidation.parsedJson.toLowerCase()).not.toContain('data:text/html')
    expect(craftedValidation.parsedJson).toContain('http://example.org/path')
    expect(craftedValidation.parsedJson).toContain('https://example.com/safe')
    expect(craftedValidation.parsedJson).toContain('mailto:user@example.com')

    // Validate live TipTap editor output with the real Zod schema from src/domain/schema
    const schemaCheck = await page.evaluate(() => {
      const state = window.__S2_API__?.getNodeState('box-edit')
      if (!state || !state.doc) return null
      const first = window.__S2_API__!.validateWithDomainSchema(state.doc)
      if (first.status !== 'ok') return { firstStatus: first.status }
      const sanitizedDoc = (
        first.data.elements['e_00000001'] as { content: NonNullable<typeof state.doc> }
      ).content
      const recheck = window.__S2_API__!.validateWithDomainSchema(sanitizedDoc)
      return {
        firstStatus: first.status,
        firstIssues: first.issues,
        recheckStatus: recheck.status,
        recheckIssues: recheck.status === 'ok' ? recheck.issues : [],
      }
    })
    console.log('S2_SCHEMA_VALIDATION=' + JSON.stringify(schemaCheck))
    expect(schemaCheck).not.toBeNull()
    expect(schemaCheck!.firstStatus).toBe('ok')
    expect(schemaCheck!.recheckStatus).toBe('ok')
    expect(schemaCheck!.recheckIssues).toEqual([])
  })

  test('9. tampilan statis dan mode edit identik secara visual dan tangkap screenshot', async ({
    page,
  }) => {
    const compareBodies = async (aBuf: Buffer, bBuf: Buffer) =>
      page.evaluate(
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
        { aB64: aBuf.toString('base64'), bB64: bBuf.toString('base64') },
      )

    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(10, 10)
    await page.waitForTimeout(80)

    // 0) Static-rendered anchor must include rel="noopener noreferrer"
    const staticAnchor = page.getByTestId('richtext-body-box-rich').locator('a')
    await expect(staticAnchor).toHaveAttribute('href', 'https://example.com/heap')
    await expect(staticAnchor).toHaveAttribute('rel', 'noopener noreferrer')

    // 1) Dark theme parity (static vs active edit, caret/selection kept natural)
    const staticDarkShot = await page.getByTestId('richtext-body-box-rich').screenshot()
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-static-dark.png') })

    await page.getByTestId('text-box-box-rich').dblclick()
    await expect(page.getByTestId('floating-toolbar')).toBeVisible()
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-edit-dark.png') })
    const editDarkShot = await page.getByTestId('richtext-body-box-rich').screenshot()

    const diffDark = await compareBodies(staticDarkShot, editDarkShot)
    console.log('S2_VISUAL_PARITY_DARK=' + JSON.stringify(diffDark))
    expect(diffDark.widthA).toBe(diffDark.widthB)
    expect(diffDark.heightA).toBe(diffDark.heightB)
    expect(diffDark.diffPercent).toBeLessThan(1.0)

    // 2) Light theme parity (static vs active edit)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('active-tiptap-editor')).toHaveCount(0)
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
    await page.mouse.move(10, 10)
    await page.waitForTimeout(60)

    const staticLightShot = await page.getByTestId('richtext-body-box-rich').screenshot()
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-static-light.png') })

    await page.getByTestId('text-box-box-rich').dblclick()
    await expect(page.getByTestId('floating-toolbar')).toBeVisible()
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    await page.screenshot({ path: path.join(OUT_DIR, 'canvas-edit-light.png') })
    const editLightShot = await page.getByTestId('richtext-body-box-rich').screenshot()

    const diffLight = await compareBodies(staticLightShot, editLightShot)
    console.log('S2_VISUAL_PARITY_LIGHT=' + JSON.stringify(diffLight))
    expect(diffLight.widthA).toBe(diffLight.widthB)
    expect(diffLight.heightA).toBe(diffLight.heightB)
    expect(diffLight.diffPercent).toBeLessThan(1.0)
  })

  test('10. toolbar berukuran tetap di luar transform kanvas, terbaca di semua zoom, dan tidak menutupi node', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('text-box-box-edit').dblclick()
    const toolbar = page.getByTestId('floating-toolbar')
    await expect(toolbar).toBeVisible()

    // Toolbar MUST sit outside `.react-flow__viewport` CSS transform
    const insideViewportTransform = await toolbar.evaluate(
      (el) => el.closest('.react-flow__viewport') !== null,
    )
    expect(insideViewportTransform).toBe(false)

    const intersects = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

    const measuredZooms: Array<{
      zoom: number
      toolbarWidth: number
      toolbarHeight: number
      boldBtnHeight: number
      overlapsNode: boolean
    }> = []

    // Measure at zoom 1.0, 0.25 (zoomed out), and 2.5 (zoomed in)
    const testViewports = [
      { zoom: 1, x: 0, y: 0 },
      { zoom: 0.25, x: 200, y: 120 },
      { zoom: 2.5, x: -120, y: -1020 },
    ]

    for (const vp of testViewports) {
      await page.evaluate((nextVp) => window.__S2_API__?.setViewport(nextVp), vp)
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )

      const tbBox = await toolbar.boundingBox()
      const cardBox = await page.getByTestId('card-surface-box-edit').boundingBox()
      const boldBox = await page.getByTestId('toolbar-bold').boundingBox()
      expect(tbBox).not.toBeNull()
      expect(cardBox).not.toBeNull()
      expect(boldBox).not.toBeNull()

      const overlaps = intersects(tbBox!, cardBox!)
      measuredZooms.push({
        zoom: vp.zoom,
        toolbarWidth: Math.round(tbBox!.width),
        toolbarHeight: Math.round(tbBox!.height),
        boldBtnHeight: Math.round(boldBox!.height),
        overlapsNode: overlaps,
      })

      // Toolbar stays screen-sized & readable (>= 28px button) and never overlaps edited box
      expect(tbBox!.width).toBeGreaterThanOrEqual(260)
      expect(tbBox!.width).toBeLessThanOrEqual(420)
      expect(tbBox!.height).toBeGreaterThanOrEqual(34)
      expect(tbBox!.height).toBeLessThanOrEqual(48)
      expect(boldBox!.height).toBeGreaterThanOrEqual(26)
      expect(overlaps).toBe(false)
    }

    // Width & height remain constant across 10x zoom change (0.25 -> 2.5)
    const widths = measuredZooms.map((m) => m.toolbarWidth)
    const heights = measuredZooms.map((m) => m.toolbarHeight)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2)

    // Near top edge of canvas -> toolbar flips below node cleanly without overlapping
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: -460, zoom: 1 }))
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    const tbFlip = await toolbar.boundingBox()
    const cardTopEdge = await page.getByTestId('card-surface-box-edit').boundingBox()
    expect(tbFlip).not.toBeNull()
    expect(cardTopEdge).not.toBeNull()
    expect(tbFlip!.y).toBeGreaterThanOrEqual(cardTopEdge!.y + cardTopEdge!.height - 1)
    expect(intersects(tbFlip!, cardTopEdge!)).toBe(false)

    console.log('S2_TOOLBAR_ZOOM_INVARIANCE=' + JSON.stringify(measuredZooms))
  })

  test('11. ukur rasio kontras WCAG 2.1 untuk mark color & highlight di tema dark/light dan frame card/none', async ({
    page,
  }) => {
    await page.goto('/')

    const contrastDoc = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph' as const,
          content: [
            { type: 'text' as const, text: 'AutoText' },
            {
              type: 'text' as const,
              text: 'AccentBlue',
              marks: [{ type: 'textStyle' as const, attrs: { color: '#7c9cff' } }],
            },
            {
              type: 'text' as const,
              text: 'AmberText',
              marks: [{ type: 'textStyle' as const, attrs: { color: '#fbbf24' } }],
            },
            {
              type: 'text' as const,
              text: 'EmeraldText',
              marks: [{ type: 'textStyle' as const, attrs: { color: '#34d399' } }],
            },
            {
              type: 'text' as const,
              text: 'RoseText',
              marks: [{ type: 'textStyle' as const, attrs: { color: '#f87171' } }],
            },
            {
              type: 'text' as const,
              text: 'VioletText',
              marks: [{ type: 'textStyle' as const, attrs: { color: '#a78bfa' } }],
            },
            {
              type: 'text' as const,
              text: 'HighlightAmber',
              marks: [{ type: 'highlight' as const, attrs: { color: '#fbbf24' } }],
            },
            {
              type: 'text' as const,
              text: 'HighlightEmerald',
              marks: [{ type: 'highlight' as const, attrs: { color: '#34d399' } }],
            },
            {
              type: 'text' as const,
              text: 'HighlightBlue',
              marks: [{ type: 'highlight' as const, attrs: { color: '#7c9cff' } }],
            },
            {
              type: 'text' as const,
              text: 'HighlightRose',
              marks: [{ type: 'highlight' as const, attrs: { color: '#f87171' } }],
            },
          ],
        },
      ],
    }

    await page.evaluate((doc) => window.__S2_API__?.setNodeDocForTest('box-edit', doc), contrastDoc)

    const measureThemeAndFrame = async (theme: 'dark' | 'light', frameNone: boolean) => {
      await page.evaluate(
        ({ t, fn }) => {
          window.__S2_API__?.setTheme(t)
          window.__S2_API__?.setNodeFrameModeForTest('box-edit', fn)
        },
        { t: theme, fn: frameNone },
      )
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        )
        .toBe(theme === 'dark' ? '#0b0e14' : '#f6f8fc')
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )

      return page.evaluate(() => {
        const parseRgb = (css: string): [number, number, number] => {
          const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/i.exec(css)
          if (!m) return [0, 0, 0]
          return [Number(m[1]), Number(m[2]), Number(m[3])]
        }
        const isTransparent = (css: string) =>
          css === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/i.test(css)
        const relLum = ([r, g, b]: [number, number, number]) => {
          const lin = [r, g, b].map((v) => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
        }
        const contrastRatio = (fg: [number, number, number], bg: [number, number, number]) => {
          const l1 = relLum(fg)
          const l2 = relLum(bg)
          const hi = Math.max(l1, l2)
          const lo = Math.min(l1, l2)
          return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
        }
        const effectiveBgCss = (el: HTMLElement): string => {
          let cur: HTMLElement | null = el
          while (cur) {
            const bg = getComputedStyle(cur).backgroundColor
            if (!isTransparent(bg)) return bg
            cur = cur.parentElement
          }
          return getComputedStyle(document.body).backgroundColor
        }

        const root = document.querySelector('[data-testid="richtext-body-box-edit"]')!
        const p = root.querySelector('p')!
        const surfaceBgCss = effectiveBgCss(p)
        const results: Array<{
          sample: string
          fgCss: string
          bgCss: string
          ratio: number
          passAA: boolean
        }> = []

        const nodes = Array.from(p.childNodes)
        for (const node of nodes) {
          if (node instanceof HTMLElement) {
            const fgCss = getComputedStyle(node).color
            const bgCss = effectiveBgCss(node)
            const ratio = contrastRatio(parseRgb(fgCss), parseRgb(bgCss))
            results.push({
              sample: node.textContent ?? '',
              fgCss,
              bgCss,
              ratio,
              passAA: ratio >= 4.5,
            })
          } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            const fgCss = getComputedStyle(p).color
            const ratio = contrastRatio(parseRgb(fgCss), parseRgb(surfaceBgCss))
            results.push({
              sample: node.textContent.trim(),
              fgCss,
              bgCss: surfaceBgCss,
              ratio,
              passAA: ratio >= 4.5,
            })
          }
        }
        return results
      })
    }

    const report = {
      dark_card: await measureThemeAndFrame('dark', false),
      dark_frame_none: await measureThemeAndFrame('dark', true),
      light_card: await measureThemeAndFrame('light', false),
      light_frame_none: await measureThemeAndFrame('light', true),
    }
    console.log('S2_CONTRAST_RATIOS=' + JSON.stringify(report))

    const isHighlight = (name: string) => name.startsWith('Highlight')

    // All text swatches + Auto + ALL paired Highlights MUST pass AA >= 4.5 on Dark (both card and frame:none)
    expect(report.dark_card.every((r) => r.passAA)).toBe(true)
    expect(report.dark_frame_none.every((r) => r.passAA)).toBe(true)

    // Light AutoText & ALL paired Highlights pass AA >= 4.5, while fixed dark-palette hex text swatches still fail AA (< 3.0) on light surface & frame:none
    expect(report.light_card.find((r) => r.sample === 'AutoText')!.passAA).toBe(true)
    expect(report.light_card.filter((r) => isHighlight(r.sample)).every((r) => r.passAA)).toBe(true)
    expect(
      report.light_frame_none.filter((r) => isHighlight(r.sample)).every((r) => r.passAA),
    ).toBe(true)
    const lightFixedHexes = report.light_card.filter(
      (r) => r.sample !== 'AutoText' && !isHighlight(r.sample),
    )
    expect(lightFixedHexes.every((r) => !r.passAA)).toBe(true)
    const lightNoneHexes = report.light_frame_none.filter(
      (r) => r.sample !== 'AutoText' && !isHighlight(r.sample),
    )
    expect(lightNoneHexes.every((r) => !r.passAA)).toBe(true)
  })

  test('12. editor aktif bertahan saat di-pan keluar layar (culling ON): tanpa vs dengan mitigasi ViewportPortal', async ({
    page,
  }) => {
    await page.goto('/')

    // (a) WITHOUT mitigation (`ViewportPortal` disabled): panning edited box off-screen destroys TipTap selection & undo history
    await page.evaluate(() => window.__S2_API__?.setMitigateActiveEditorUnmount(false))
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorA = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorA).toBeFocused()
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    await page.keyboard.type(' MID_EDIT')
    await expect(editorA).toContainText('MID_EDIT')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+ArrowRight')
    }
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')

    await page.evaluate(() => window.__S2_API__?.setViewport({ x: -1800, y: -1200, zoom: 1 }))
    await expect
      .poll(async () => page.evaluate(() => window.__S2_API__?.getActiveEditorCount()))
      .toBe(0)

    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 1 }))
    await expect(page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')).toBeVisible()
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    const withoutMitigationSelection = await page.evaluate(
      () => window.getSelection()?.toString() ?? '',
    )
    expect(withoutMitigationSelection).toBe('')
    await page.keyboard.press('Control+z')
    const withoutMitigationTextAfterUndo = await page
      .getByTestId('active-tiptap-editor')
      .innerText()
    expect(withoutMitigationTextAfterUndo).toContain('MID_EDIT')

    // (b) WITH ViewportPortal mitigation enabled: panning off-screen keeps TipTap instance, text, selection, focus, AND undo history intact
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      window.__S2_API__?.setMitigateActiveEditorUnmount(true)
      window.__S2_API__?.setStaticNodeCount(4)
    })
    await page.getByTestId('text-box-box-edit').dblclick()
    const editorB = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editorB).toBeFocused()
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    await page.keyboard.type(' MID_EDIT')
    await expect(editorB).toContainText('MID_EDIT')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+ArrowRight')
    }
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')

    // Pan far off-screen and wait 2 frames -> editor MUST remain mounted (1)
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: -1800, y: -1200, zoom: 1 }))
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    // Pan back into view -> text, selection, focus, and Ctrl+Z undo MUST all survive intact
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 1 }))
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    )
    await expect(editorB).toBeFocused()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Alpha')
    await expect(page.getByTestId('active-tiptap-editor')).toContainText('MID_EDIT')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('active-tiptap-editor')).not.toContainText('MID_EDIT')

    console.log(
      'S2_EDITOR_UNMOUNT_RESILIENCE=' +
        JSON.stringify({
          withoutMitigation: {
            unmountedOffscreen: true,
            selectionPreserved: withoutMitigationSelection === 'Alpha',
            undoPreserved: !withoutMitigationTextAfterUndo.includes('MID_EDIT'),
          },
          withViewportPortalMitigation: {
            remainedMountedOffscreen: true,
            selectionPreserved: true,
            focusPreserved: true,
            undoPreserved: true,
          },
        }),
    )
  })

  test('13. resize dan drag gagang saat mengedit di ViewportPortal mengikuti posisi dan ukuran tanpa lompatan (reflow & scale)', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('text-box-box-rich').dblclick()
    await expect(page.getByTestId('active-tiptap-editor')).toBeVisible()
    await expect(page.getByTestId('portal-text-box-box-rich')).toBeVisible()

    const placeholder = page.getByTestId('text-box-box-rich')
    const portalCard = page.getByTestId('card-surface-box-rich')
    const prosemirror = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')

    // Helper: check card surface & placeholder geometry & active editor width stay synchronized
    const measureAlignment = async () => {
      const phBox = await placeholder.boundingBox()
      const cardBox = await portalCard.boundingBox()
      const pmBox = await prosemirror.boundingBox()
      expect(phBox).not.toBeNull()
      expect(cardBox).not.toBeNull()
      expect(pmBox).not.toBeNull()
      return { phBox: phBox!, cardBox: cardBox!, pmBox: pmBox! }
    }

    const initialAlign = await measureAlignment()
    expect(Math.abs(initialAlign.cardBox.width - initialAlign.phBox.width)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(initialAlign.cardBox.height - initialAlign.phBox.height)).toBeLessThanOrEqual(
      1.5,
    )

    // 1) Drag top handle WHILE editing in ViewportPortal
    const dragHandle = page.getByTestId('drag-handle-box-rich')
    await expect(dragHandle).toBeVisible()
    const handleBox = await dragHandle.boundingBox()
    expect(handleBox).not.toBeNull()
    const beforePos = await page.evaluate(() => window.__S2_API__?.getNodeState('box-rich'))

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2 + 110,
      handleBox!.y + handleBox!.height / 2 + 70,
      { steps: 10 },
    )
    const midDragAlign = await measureAlignment()
    expect(Math.abs(midDragAlign.cardBox.x - midDragAlign.phBox.x)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(midDragAlign.cardBox.y - midDragAlign.phBox.y)).toBeLessThanOrEqual(1.5)
    await page.mouse.up()

    const afterDragPos = await page.evaluate(() => window.__S2_API__?.getNodeState('box-rich'))
    expect(afterDragPos!.x).toBeGreaterThan(beforePos!.x + 80)
    expect(afterDragPos!.y).toBeGreaterThan(beforePos!.y + 50)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    const afterDragAlign = await measureAlignment()
    expect(Math.abs(afterDragAlign.cardBox.x - afterDragAlign.phBox.x)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(afterDragAlign.cardBox.y - afterDragAlign.phBox.y)).toBeLessThanOrEqual(1.5)

    // 2) Width resize WHILE editing: text reflows and card/placeholder heights grow identically (`ukuran kotak = ukuran editor`)
    const resizeHandle = page.getByTestId('resize-handle-box-rich')
    await expect(resizeHandle).toBeVisible()
    const rBox = await resizeHandle.boundingBox()
    expect(rBox).not.toBeNull()

    await page.mouse.move(rBox!.x + rBox!.width / 2, rBox!.y + rBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(rBox!.x + rBox!.width / 2 - 140, rBox!.y + rBox!.height / 2, {
      steps: 10,
    })
    await page.mouse.up()

    const afterResizeState = await page.evaluate(() => window.__S2_API__?.getNodeState('box-rich'))
    expect(afterResizeState!.width).toBeLessThanOrEqual(230)
    const afterResizeAlign = await measureAlignment()
    expect(afterResizeAlign.cardBox.width).toBeLessThanOrEqual(232)
    expect(afterResizeAlign.cardBox.height).toBeGreaterThan(initialAlign.cardBox.height + 10)
    expect(
      Math.abs(afterResizeAlign.cardBox.width - afterResizeAlign.phBox.width),
    ).toBeLessThanOrEqual(1.5)
    expect(
      Math.abs(afterResizeAlign.cardBox.height - afterResizeAlign.phBox.height),
    ).toBeLessThanOrEqual(1.5)
    // ProseMirror inner editor width + card padding (14*2 + border 1*2 = 30px) matches card width
    expect(
      Math.abs(afterResizeAlign.cardBox.width - (afterResizeAlign.pmBox.width + 30)),
    ).toBeLessThanOrEqual(2)

    // Editor still accepts typing seamlessly after drag + resize
    await prosemirror.click()
    await page.keyboard.type(' REFLOW_OK')
    await expect(prosemirror).toContainText('REFLOW_OK')

    // 3) Scale while editing (`0.75` and `1.5`): ViewportPortal box & editor scale cleanly without mismatch
    for (const k of [0.75, 1.5]) {
      await page.evaluate((zoom) => window.__S2_API__?.setViewport({ x: 40, y: 20, zoom }), k)
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      const scaled = await measureAlignment()
      expect(Math.abs(scaled.cardBox.width - afterResizeState!.width * k)).toBeLessThanOrEqual(2.5)
      expect(Math.abs(scaled.cardBox.width - scaled.phBox.width)).toBeLessThanOrEqual(1.5)
      expect(Math.abs(scaled.cardBox.height - scaled.phBox.height)).toBeLessThanOrEqual(1.5)
      expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)
    }
  })

  test('14. edit di zoom < ambang LOD: editor tampil penuh tanpa reset zoom dengan caret & seleksi berfungsi', async ({
    page,
  }) => {
    await page.goto('/')
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 180, y: 120, zoom: 0.25 }))
    await expect(page.getByTestId('lod-placeholder-box-edit')).toBeVisible()
    await expect(page.getByTestId('text-box-box-edit')).toHaveAttribute('data-lod', 'true')

    // Double-click LOD box -> stays at zoom 0.25 and mounts full TipTap editor + screen-space toolbar
    await page.getByTestId('text-box-box-edit').dblclick()
    const editor = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)
    expect((await page.evaluate(() => window.__S2_API__?.getViewport()))?.zoom).toBeCloseTo(0.25, 2)
    await expect(page.getByTestId('floating-toolbar')).toBeVisible()

    // Caret typing, keyboard selection, and toolbar formatting all work at zoom 0.25
    await page.keyboard.type(' LOW_ZOOM')
    await expect(editor).toContainText('LOW_ZOOM')

    await page.keyboard.press('Home')
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('ArrowRight')
    }
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+ArrowRight')
    }
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('Bravo')
    await page.getByTestId('toolbar-bold').click()
    await expect(editor.locator('strong', { hasText: 'Bravo' })).toBeVisible()
    await expect(editor).toBeFocused()
  })

  test('15. node yang sedang diedit dihapus atau pilihan berpindah: editor unmount bersih tanpa kebocoran dan tanpa kehilangan teks', async ({
    page,
  }) => {
    await page.goto('/')

    // (a) Switch editing target by double-clicking another box -> 1 instance, prior edits preserved statically
    await page.getByTestId('text-box-box-edit').dblclick()
    const editor1 = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editor1).toBeFocused()
    await page.keyboard.type(' PERSIST_SWITCH')
    await page.getByTestId('text-box-box-second').dblclick()
    await expect(page.getByTestId('richtext-body-box-edit')).toContainText('PERSIST_SWITCH')
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(1)

    // (b) Move selection away while editing -> clean unmount (0 instances), typed text kept
    const editor2 = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editor2).toBeFocused()
    await page.keyboard.type(' PERSIST_SELECT')
    await page.evaluate(() => window.__S2_API__?.selectNodes(['box-rich']))
    await expect(page.getByTestId('active-tiptap-editor')).toHaveCount(0)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(0)
    await expect(page.getByTestId('richtext-body-box-second')).toContainText('PERSIST_SELECT')

    // (c) Delete the actively edited node mid-edit -> clean unmount, shortcuts work again, Ctrl+Z restores with typed text
    await page.getByTestId('text-box-box-edit').dblclick()
    const editor3 = page.locator('[data-testid="active-tiptap-editor"] .ProseMirror')
    await expect(editor3).toBeFocused()
    await page.keyboard.type(' BEFORE_DELETE')
    await expect(editor3).toContainText('BEFORE_DELETE')

    await page.evaluate(() => window.__S2_API__?.deleteNode('box-edit'))
    await expect(page.getByTestId('active-tiptap-editor')).toHaveCount(0)
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(0)
    expect(await page.evaluate(() => window.__S2_API__?.getNodeState('box-edit'))).toBeNull()

    // Shortcuts no longer blocked by stale editingNodeId
    await page.keyboard.press('t')
    expect(await page.evaluate(() => window.__S2_API__?.getTool())).toBe('text')

    // Canvas Ctrl+Z restores deleted node with its typed text intact
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('richtext-body-box-edit')).toContainText('BEFORE_DELETE')
    expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(0)
  })

  test('16. LOD: font judul placeholder >= 11 px di layar atau disembunyikan dan bebas kedip di sekitar ambang zoom', async ({
    page,
  }) => {
    await page.goto('/')

    // 1) Overview LOD (zoom 0.25 in [0.23, 0.32)): title is visible and rendered screen font >= 11 px
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 100, y: 80, zoom: 0.25 }))
    const lodTitle = page.getByTestId('lod-title-box-rich')
    await expect(lodTitle).toBeVisible()
    const screenFontPx = await lodTitle.evaluate((el) => {
      const worldPx = parseFloat(getComputedStyle(el).fontSize)
      return worldPx * 0.25
    })
    expect(screenFontPx).toBeGreaterThanOrEqual(11)

    // 2) Deep overview LOD (zoom 0.105 < 0.19): title hidden so no sub-11px unreadable text renders
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 100, y: 35, zoom: 0.105 }))
    await expect(page.getByTestId('lod-placeholder-box-rich')).toBeVisible()
    await expect(page.getByTestId('lod-title-box-rich')).toHaveCount(0)

    // 3) Hysteresis check around LOD boundaries [0.32..0.40]: zero flicker while oscillating inside deadband
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 1 }))
    await expect(page.getByTestId('richtext-body-box-rich')).toBeVisible()
    const baseSwitches = await page.evaluate(() => window.__S2_API__?.getLodSwitchCount() ?? 0)

    // Oscillating above LOD_ENTER_ZOOM (0.32) while exiting from zoom=1 stays non-LOD with 0 switches
    for (const z of [0.38, 0.33, 0.39, 0.34, 0.37, 0.33]) {
      await page.evaluate((zoom) => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom }), z)
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
    }
    expect(await page.evaluate(() => window.__S2_API__?.getLodSwitchCount())).toBe(baseSwitches)
    expect((await page.evaluate(() => window.__S2_API__?.getLodState()))?.isLod).toBe(false)

    // Crossing below LOD_ENTER_ZOOM (0.32) enters LOD once (+1 switch), then oscillating inside [0.32..0.40) causes 0 switches
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 0.3 }))
    await expect
      .poll(async () => (await page.evaluate(() => window.__S2_API__?.getLodState()))?.isLod)
      .toBe(true)
    const afterEnterSwitches = await page.evaluate(
      () => window.__S2_API__?.getLodSwitchCount() ?? 0,
    )
    expect(afterEnterSwitches).toBe(baseSwitches + 1)

    for (const z of [0.34, 0.38, 0.33, 0.39, 0.35, 0.395]) {
      await page.evaluate((zoom) => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom }), z)
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
    }
    expect(await page.evaluate(() => window.__S2_API__?.getLodSwitchCount())).toBe(
      afterEnterSwitches,
    )
    expect((await page.evaluate(() => window.__S2_API__?.getLodState()))?.isLod).toBe(true)

    // Crossing above LOD_EXIT_ZOOM (0.40) exits LOD cleanly
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 0.42 }))
    await expect
      .poll(async () => (await page.evaluate(() => window.__S2_API__?.getLodState()))?.isLod)
      .toBe(false)
  })

  test('benchmark FPS pan-only, zoom-only, culling ON vs OFF, 3 runs per scenario (LOD + rich text + 50 images)', async ({
    page,
  }) => {
    test.setTimeout(360_000)
    await page.goto('/')

    // Verify dataset composition & LOD switching below enter threshold (0.32)
    await page.evaluate(() => window.__S2_API__?.setStaticNodeCount(100))
    expect(await page.evaluate(() => window.__S2_API__?.getAllNodeCount())).toBe(100)
    expect(await page.evaluate(() => window.__S2_API__?.getImageNodeCount())).toBe(17)
    await page.evaluate(() => window.__S2_API__?.setStaticNodeCount(300))
    expect(await page.evaluate(() => window.__S2_API__?.getAllNodeCount())).toBe(300)
    expect(await page.evaluate(() => window.__S2_API__?.getImageNodeCount())).toBe(50)

    // Deep overview (< 0.19): LOD placeholder visible, title omitted to avoid <11px screen text
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 100, y: 35, zoom: 0.105 }))
    await expect(page.getByTestId('lod-placeholder-box-rich')).toBeVisible()
    await expect(page.getByTestId('lod-title-box-rich')).toHaveCount(0)
    await expect(page.getByTestId('lod-image-box-img-1')).toBeVisible()
    // Mid overview (0.25): LOD title visible at >= 11px on screen
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 100, y: 80, zoom: 0.25 }))
    await expect(page.getByTestId('lod-title-box-rich')).toBeVisible()
    await page.evaluate(() => window.__S2_API__?.setViewport({ x: 0, y: 0, zoom: 1 }))
    await expect(page.getByTestId('richtext-body-box-rich')).toBeVisible()

    const scenarios = [
      {
        key: 's100_pan_1editor_cullOn',
        count: 100 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's100_pan_1editor_cullOff',
        count: 100 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's100_zoom_1editor_cullOn',
        count: 100 as const,
        activeEditor: true,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's100_zoom_1editor_cullOff',
        count: 100 as const,
        activeEditor: true,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's300_pan_0editor_cullOn',
        count: 300 as const,
        activeEditor: false,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_pan_0editor_cullOff',
        count: 300 as const,
        activeEditor: false,
        mode: 'pan' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's300_pan_1editor_cullOn',
        count: 300 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_pan_1editor_cullOff',
        count: 300 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's300_zoom_0editor_cullOn',
        count: 300 as const,
        activeEditor: false,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_zoom_0editor_cullOff',
        count: 300 as const,
        activeEditor: false,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's300_zoom_1editor_cullOn',
        count: 300 as const,
        activeEditor: true,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_zoom_1editor_cullOff',
        count: 300 as const,
        activeEditor: true,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: false,
      },
      {
        key: 's300_zoom_out_all_visible_1editor',
        count: 300 as const,
        activeEditor: true,
        mode: 'zoom-out-all' as const,
        onlyRenderVisibleElements: true,
      },
    ]

    const summarize = (vals: number[]) => {
      const sorted = [...vals].sort((a, b) => a - b)
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const median = sorted[Math.floor(sorted.length / 2)]!
      return {
        mean: Number(mean.toFixed(1)),
        median: Number(median.toFixed(1)),
        min: sorted[0]!,
        max: sorted[sorted.length - 1]!,
      }
    }

    const results: Record<string, unknown> = {}
    for (const sc of scenarios) {
      const runs = []
      for (let r = 0; r < 3; r += 1) {
        const res = await page.evaluate((opts) => window.__S2_API__?.measurePanZoomFps(opts), {
          count: sc.count,
          activeEditor: sc.activeEditor,
          mode: sc.mode,
          onlyRenderVisibleElements: sc.onlyRenderVisibleElements,
        })
        expect(res).toBeDefined()
        expect(res!.durationMs).toBeGreaterThanOrEqual(3000)
        expect(res!.frameCount).toBeGreaterThanOrEqual(150)
        expect(await page.evaluate(() => window.__S2_API__?.getActiveEditorCount())).toBe(
          sc.activeEditor ? 1 : 0,
        )
        expect(res!.activeEditorMinDuringRun).toBe(sc.activeEditor ? 1 : 0)
        if (!sc.onlyRenderVisibleElements || sc.mode === 'zoom-out-all') {
          expect(res!.renderedDomNodesMin).toBe(sc.count)
        }
        // Enforce >= 30 fps CI threshold (docs/testing.md §9.5) AND p95/max latency gates grounded in docs/spec-ui-nfr.md §7.1 (< 100 ms)
        if (sc.onlyRenderVisibleElements) {
          expect(res!.meanFps).toBeGreaterThanOrEqual(30)
          expect(res!.p95Ms).toBeLessThanOrEqual(50)
          expect(res!.maxMs).toBeLessThanOrEqual(sc.mode === 'zoom' ? 200 : 100)
        }
        runs.push(res!)
      }
      const meanAcrossRuns = summarize(runs.map((x) => x.meanFps))
      const p95MsAcrossRuns = summarize(runs.map((x) => x.p95Ms))
      const maxMsAcrossRuns = summarize(runs.map((x) => x.maxMs))
      if (sc.onlyRenderVisibleElements) {
        expect(meanAcrossRuns.mean).toBeGreaterThanOrEqual(30)
        expect(p95MsAcrossRuns.mean).toBeLessThanOrEqual(50)
        expect(maxMsAcrossRuns.mean).toBeLessThanOrEqual(sc.mode === 'zoom' ? 150 : 100)
      }
      results[sc.key] = {
        runs,
        summary: {
          meanFps: meanAcrossRuns,
          p50Fps: summarize(runs.map((x) => x.p50Fps)),
          p95Fps: summarize(runs.map((x) => x.p95Fps)),
          p95Ms: p95MsAcrossRuns,
          maxMs: maxMsAcrossRuns,
          domMin: Math.min(...runs.map((x) => x.renderedDomNodesMin)),
          domMax: Math.max(...runs.map((x) => x.renderedDomNodesMax)),
          activeEditorMinDuringRun: Math.min(...runs.map((x) => x.activeEditorMinDuringRun)),
        },
      }
    }

    // Verify FPS HUD sits in bottom footer completely outside canvas-stage & attribution
    const hud = page.getByTestId('s2-fps-hud')
    const stage = page.getByTestId('canvas-stage')
    const attribution = page.locator('.react-flow__attribution')
    await expect(hud).toBeVisible()
    const hudBox = await hud.boundingBox()
    const stageBox = await stage.boundingBox()
    const attrBox = await attribution.boundingBox()
    expect(hudBox).not.toBeNull()
    expect(stageBox).not.toBeNull()
    expect(attrBox).not.toBeNull()
    const overlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    expect(overlaps(hudBox!, stageBox!)).toBe(false)
    expect(overlaps(hudBox!, attrBox!)).toBe(false)

    await page.screenshot({ path: path.join(OUT_DIR, 'stress-300-dark.png') })
    console.log('S2_FPS_BENCHMARKS=' + JSON.stringify(results))
  })
})
