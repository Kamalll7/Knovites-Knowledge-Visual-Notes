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

    // Verify `.nodrag` behaviorally: even when draggable=true and dragHandle=undefined, dragging on card padding (outside EditorContent onMouseDown) MUST NOT move the node
    await page.evaluate(() =>
      window.__S2_API__?.setNodeDragConfigForTest('box-edit', {
        draggable: true,
        dragHandle: undefined,
      }),
    )
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

    // Enter edit mode on box-edit, type extra text, then press Ctrl+Z
    await page.getByTestId('text-box-box-edit').dblclick()
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
      if (!state) return null
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
      if (!state) return null
      const first = window.__S2_API__!.validateWithDomainSchema(state.doc)
      if (first.status !== 'ok') return { firstStatus: first.status }
      const sanitizedDoc = (first.data.elements['e_00000001'] as { content: typeof state.doc })
        .content
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

  test('benchmark FPS pan-only, zoom-only, and culling toggle across 100 and 300 nodes', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.goto('/')

    const scenarios = [
      {
        key: 's100_pan_0editor_cullOn',
        count: 100 as const,
        activeEditor: false,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's100_pan_1editor_cullOn',
        count: 100 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's100_zoom_1editor_cullOn',
        count: 100 as const,
        activeEditor: true,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_pan_0editor_cullOn',
        count: 300 as const,
        activeEditor: false,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_pan_1editor_cullOn',
        count: 300 as const,
        activeEditor: true,
        mode: 'pan' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_zoom_0editor_cullOn',
        count: 300 as const,
        activeEditor: false,
        mode: 'zoom' as const,
        onlyRenderVisibleElements: true,
      },
      {
        key: 's300_zoom_1editor_cullOn',
        count: 300 as const,
        activeEditor: true,
        mode: 'zoom' as const,
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

    const results: Record<string, unknown> = {}
    for (const sc of scenarios) {
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
      if (!sc.onlyRenderVisibleElements || sc.mode === 'zoom-out-all') {
        expect(res!.renderedDomNodesMin).toBe(sc.count)
      }
      results[sc.key] = res
    }

    await page.screenshot({ path: path.join(OUT_DIR, 'stress-300-dark.png') })
    console.log('S2_FPS_BENCHMARKS=' + JSON.stringify(results))
  })
})
