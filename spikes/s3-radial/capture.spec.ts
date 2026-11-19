import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const OUT_DIR = path.resolve(import.meta.dirname, 'out')

const DATASETS = [
  'unbalanced150',
  'wide60Children',
  'chainDepth12',
  'root20Children',
  'large2000',
] as const

test.describe('Spike S3 Radial Map verification, screenshots, video, and benchmarks', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
  })

  test('captures dark/light screenshots for all 5 datasets in root and deep-focus states with 0 overlaps', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Use reducedMotion during deterministic screenshot capture so transition settles instantaneously
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    const summary: Array<{
      dataset: string
      state: string
      visibleCount: number
      totalNodes: number
      overlapCount: number
      layoutMs: number
    }> = []

    for (const datasetId of DATASETS) {
      await page.evaluate((id) => {
        window.__S3_API__?.setTheme('dark')
        window.__S3_API__?.setDataset(id)
        window.__S3_API__?.setFocusRoot()
      }, datasetId)

      await expect
        .poll(async () => {
          const m = await page.evaluate(() => window.__S3_API__?.getMetrics() ?? null)
          return m?.focusId === '__virtual_root__' ? m : null
        })
        .not.toBeNull()
      // Ensure expected dataset count settled before reading metrics
      const expectedTotal =
        datasetId === 'unbalanced150'
          ? 150
          : datasetId === 'wide60Children'
            ? 61
            : datasetId === 'chainDepth12'
              ? 12
              : datasetId === 'root20Children'
                ? 20
                : 2000
      await expect
        .poll(
          async () => (await page.evaluate(() => window.__S3_API__?.getMetrics()?.totalNodes)) ?? 0,
        )
        .toBe(expectedTotal)
      await page.waitForTimeout(50)

      const rootMetrics = await page.evaluate(() => window.__S3_API__?.getMetrics() ?? null)
      expect(rootMetrics).not.toBeNull()
      expect(rootMetrics!.overlapCount).toBe(0)
      summary.push({
        dataset: datasetId,
        state: 'root',
        visibleCount: rootMetrics!.visibleCount,
        totalNodes: rootMetrics!.totalNodes,
        overlapCount: rootMetrics!.overlapCount,
        layoutMs: Number(rootMetrics!.layoutMs.toFixed(2)),
      })

      await page.evaluate(() => window.__S3_API__?.setTheme('dark'))
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        )
        .toBe('#0b0e14')
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      await page.screenshot({ path: path.join(OUT_DIR, `${datasetId}-root-dark.png`) })

      await page.evaluate(() => window.__S3_API__?.setTheme('light'))
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        )
        .toBe('#f6f8fc')
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      await page.waitForTimeout(80)
      await page.screenshot({ path: path.join(OUT_DIR, `${datasetId}-root-light.png`) })

      // Deep focus state
      const deepId = await page.evaluate(() => {
        window.__S3_API__?.setTheme('dark')
        return window.__S3_API__?.setFocusDeep() ?? ''
      })
      expect(deepId).not.toBe('')
      await expect
        .poll(
          async () => (await page.evaluate(() => window.__S3_API__?.getMetrics()?.focusId)) ?? '',
        )
        .toBe(deepId)
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        )
        .toBe('#0b0e14')
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      await page.waitForTimeout(60)

      const focusMetrics = await page.evaluate(() => window.__S3_API__?.getMetrics() ?? null)
      expect(focusMetrics).not.toBeNull()
      expect(focusMetrics!.overlapCount).toBe(0)
      summary.push({
        dataset: datasetId,
        state: 'focus',
        visibleCount: focusMetrics!.visibleCount,
        totalNodes: focusMetrics!.totalNodes,
        overlapCount: focusMetrics!.overlapCount,
        layoutMs: Number(focusMetrics!.layoutMs.toFixed(2)),
      })

      await page.screenshot({ path: path.join(OUT_DIR, `${datasetId}-focus-dark.png`) })

      await page.evaluate(() => window.__S3_API__?.setTheme('light'))
      await expect
        .poll(async () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          ),
        )
        .toBe('#f6f8fc')
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      )
      await page.waitForTimeout(80)
      await page.screenshot({ path: path.join(OUT_DIR, `${datasetId}-focus-light.png`) })

      if (datasetId === 'wide60Children') {
        await page.evaluate(() => {
          window.__S3_API__?.setTheme('dark')
        })
        await page.locator('[data-testid^="overflow-bubble-"]').first().click()
        await expect(page.getByTestId('spike-telemetry')).toContainText('62 / 61')
        const expandedMetrics = await page.evaluate(() => window.__S3_API__?.getMetrics() ?? null)
        expect(expandedMetrics).not.toBeNull()
        expect(expandedMetrics!.overlapCount).toBe(0)
        expect(expandedMetrics!.visibleCount).toBe(62)
        summary.push({
          dataset: datasetId,
          state: 'expanded-60',
          visibleCount: expandedMetrics!.visibleCount,
          totalNodes: expandedMetrics!.totalNodes,
          overlapCount: expandedMetrics!.overlapCount,
          layoutMs: Number(expandedMetrics!.layoutMs.toFixed(2)),
        })
        await page.screenshot({ path: path.join(OUT_DIR, `wide60Children-expanded-dark.png`) })
      }
    }

    // Verify semantic zoom tier buttons & click focus transition work cleanly
    await page.evaluate(() => {
      window.__S3_API__?.setTheme('dark')
      window.__S3_API__?.setDataset('unbalanced150')
      window.__S3_API__?.setFocusRoot()
    })
    await page.getByRole('button', { name: 'T2' }).click()
    await page.waitForTimeout(80)
    await page.screenshot({ path: path.join(OUT_DIR, 'unbalanced150-tier2-dark.png') })

    await page.getByRole('button', { name: 'T0' }).click()
    await page.waitForTimeout(80)
    await page.screenshot({ path: path.join(OUT_DIR, 'unbalanced150-tier0-dark.png') })

    console.log('S3_OVERLAP_SUMMARY=' + JSON.stringify(summary))
    expect(errors).toEqual([])
  })

  test('measures focus transition frame time p50/p95 on 150 and 2,000 nodes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    // Warm up and measure 150-node unbalanced focus transition (without video screencast overhead)
    await page.evaluate(() => {
      window.__S3_API__?.setTheme('dark')
      window.__S3_API__?.setDataset('unbalanced150')
      window.__S3_API__?.setFocusRoot()
    })
    await page.waitForTimeout(200)

    const bench150 = await page.evaluate(async () => window.__S3_API__?.measureTransitionToDeep())
    expect(bench150).not.toBeNull()
    expect(bench150!.frameCount).toBeGreaterThanOrEqual(5)

    // Test interruptible mid-transition click (click Root mid-animation, verify settles cleanly at Root)
    await page.evaluate(() => window.__S3_API__?.setFocusDeep())
    await page.waitForTimeout(160)
    await page.getByRole('button', { name: 'Root' }).click()
    await page.waitForTimeout(600)
    const afterInterrupt = await page.evaluate(() => window.__S3_API__?.getMetrics())
    expect(afterInterrupt?.focusId).toBe('__virtual_root__')

    // Measure 2,000-node scale transition
    await page.evaluate(() => {
      window.__S3_API__?.setDataset('large2000')
      window.__S3_API__?.setFocusRoot()
    })
    await expect
      .poll(
        async () => (await page.evaluate(() => window.__S3_API__?.getMetrics()?.totalNodes)) ?? 0,
      )
      .toBe(2000)
    await page.waitForTimeout(200)
    const bench2000 = await page.evaluate(async () => window.__S3_API__?.measureTransitionToDeep())
    expect(bench2000).not.toBeNull()
    expect(bench2000!.frameCount).toBeGreaterThanOrEqual(5)

    console.log(
      'S3_TRANSITION_BENCHMARKS=' +
        JSON.stringify({
          unbalanced150: bench150,
          large2000: bench2000,
        }),
    )
  })

  test('records smooth focus transition video to out/focus-transition.webm', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: {
        dir: OUT_DIR,
        size: { width: 1280, height: 800 },
      },
    })
    const page = await context.newPage()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    await page.evaluate(() => {
      window.__S3_API__?.setTheme('dark')
      window.__S3_API__?.setDataset('unbalanced150')
      window.__S3_API__?.setFocusRoot()
    })
    await page.waitForTimeout(350)
    await page.getByRole('button', { name: 'Deep Focus' }).click()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Root' }).click()
    await page.waitForTimeout(700)

    const video = page.video()
    await context.close()

    if (video) {
      const targetVideoPath = path.join(OUT_DIR, 'focus-transition.webm')
      await video.saveAs(targetVideoPath)
      const recordedTemp = await video.path()
      if (recordedTemp !== targetVideoPath && fs.existsSync(recordedTemp)) {
        fs.rmSync(recordedTemp, { force: true })
      }
      expect(fs.existsSync(targetVideoPath)).toBe(true)
    }
  })
})
