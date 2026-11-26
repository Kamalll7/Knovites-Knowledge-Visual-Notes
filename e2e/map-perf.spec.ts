import { expect, test, type Page } from '@playwright/test'

const VIEWPORT = { width: 1280, height: 800 }
const MAX_DOM_NODES = 300

async function waitForStableSvg(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
}

async function readDevMetrics(page: Page) {
  return page.evaluate(() => {
    const diag = document.querySelector<HTMLElement>('[data-testid="dev-map-diagnostics"]')!
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
    const domNodes = svg.querySelectorAll('[data-testid="map-node"]').length
    const domEdges = svg.querySelectorAll('[data-edge-id]').length
    const filterCount = svg.querySelectorAll('filter').length
    const rawHydrate = diag.dataset.hydrateMs ?? ''
    return {
      nodeCount: Number(diag.dataset.nodeCount ?? '0'),
      domNodes,
      domEdges,
      filterCount,
      layoutMs: Number(diag.dataset.layoutMs ?? '0'),
      hydrateMs: rawHydrate.length > 0 ? Number(rawHydrate) : null,
      fpsP50: Number(diag.dataset.fpsP50 ?? '0'),
      fpsP95: Number(diag.dataset.fpsP95 ?? '0'),
      fpsMin: Number(diag.dataset.fpsMin ?? '0'),
      frameMaxMs: Number(diag.dataset.frameMaxMs ?? '0'),
      fpsSamples: Number(diag.dataset.fpsSamples ?? '0'),
    }
  })
}

async function exerciseActiveInteraction(page: Page) {
  const svgBox = (await page.getByTestId('map-svg').boundingBox())!
  await page.getByTestId('map-zoom-in').click()
  await page.waitForTimeout(450)
  await page.mouse.move(svgBox.x + 120, svgBox.y + 120)
  await page.mouse.down()
  await page.mouse.move(svgBox.x + 260, svgBox.y + 200, { steps: 8 })
  await page.mouse.up()
  await page.getByTestId('map-zoom-out').click()
  await page.waitForTimeout(550)
  await waitForStableSvg(page)
}

async function measureFreshHydrate(page: Page, timeoutMs: number) {
  await page.getByTestId('dev-perf-reset').click()
  await expect(page.getByTestId('dev-map-diagnostics')).toHaveAttribute('data-hydrate-ms', '')
  await page.getByTestId('dev-bench-hydrate').click()
  await expect(page.getByTestId('dev-map-diagnostics')).not.toHaveAttribute('data-hydrate-ms', '', {
    timeout: timeoutMs,
  })
}

test.describe('Map real-browser IndexedDB hydrate & DOM performance guard [T3.8, FR-MAP-17]', () => {
  test('verifies <= 300 DOM nodes, real IndexedDB hydrate, and 0 console errors on unbalanced150, large2000, and wide60Children', async ({
    page,
  }) => {
    test.setTimeout(90_000)

    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.setViewportSize(VIEWPORT)

    // (a) unbalanced150 — real IndexedDB hydrate + active interaction
    await page.goto('/#/__dev/map?dataset=unbalanced150&interactive=1&mode=radial&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await waitForStableSvg(page)

    await measureFreshHydrate(page, 15_000)

    // Focus first branch child so more nodes are visible, then pan/zoom for active RAF samples
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await waitForStableSvg(page)
    await page.locator('[data-testid="map-node"][data-node-kind="node"]').first().click()
    await page.waitForTimeout(650)
    await exerciseActiveInteraction(page)
    await expect(page.getByTestId('dev-map-diagnostics')).not.toHaveAttribute(
      'data-fps-samples',
      '0',
    )

    const unbalanced150 = await readDevMetrics(page)
    expect(unbalanced150.nodeCount).toBeGreaterThan(0)
    expect(unbalanced150.nodeCount).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(unbalanced150.domNodes).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(unbalanced150.filterCount).toBe(0)
    expect(unbalanced150.hydrateMs).not.toBeNull()
    expect(unbalanced150.hydrateMs!).toBeGreaterThanOrEqual(0)
    expect(unbalanced150.layoutMs).toBeGreaterThanOrEqual(0)
    expect(unbalanced150.fpsSamples).toBeGreaterThan(0)

    // (b) large2000 — real IndexedDB hydrate (2,000 nodes, Prasyarat M6 #6) + deep focus + DOM <= 300
    await page.goto('/#/__dev/map?dataset=large2000&interactive=1&mode=radial&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await waitForStableSvg(page)

    await measureFreshHydrate(page, 30_000)
    const large2000Root = await readDevMetrics(page)
    expect(large2000Root.nodeCount).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(large2000Root.domNodes).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(large2000Root.filterCount).toBe(0)
    expect(large2000Root.hydrateMs).not.toBeNull()
    expect(large2000Root.hydrateMs!).toBeGreaterThanOrEqual(0)

    // Fit then click into a primary branch and a deeper child for multi-level visibility + active RAF samples
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await waitForStableSvg(page)
    await page.locator('[data-testid="map-node"][data-node-kind="node"]').first().click()
    await page.waitForTimeout(650)
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await waitForStableSvg(page)
    const deepCandidates = page.locator('[data-testid="map-node"][data-node-kind="node"]')
    const deepCount = await deepCandidates.count()
    if (deepCount > 1) {
      await deepCandidates.nth(deepCount - 1).click()
      await page.waitForTimeout(650)
    }
    await exerciseActiveInteraction(page)
    await expect(page.getByTestId('dev-map-diagnostics')).not.toHaveAttribute(
      'data-fps-samples',
      '0',
    )

    const large2000Deep = await readDevMetrics(page)
    expect(large2000Deep.nodeCount).toBeGreaterThan(0)
    expect(large2000Deep.nodeCount).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(large2000Deep.domNodes).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(large2000Deep.filterCount).toBe(0)
    expect(large2000Deep.layoutMs).toBeGreaterThanOrEqual(0)
    expect(large2000Deep.fpsSamples).toBeGreaterThan(0)

    // (c) wide60Children — before & after clicking '+N' overflow bubble
    await page.goto('/#/__dev/map?dataset=wide60Children&interactive=1&mode=radial&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await waitForStableSvg(page)

    await measureFreshHydrate(page, 15_000)

    // Focus the 60-child hub so 24 children + '+36' bubble appear
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await waitForStableSvg(page)
    await page.locator('[data-testid="map-node"][data-node-kind="node"]').first().click()
    await page.waitForTimeout(650)
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await waitForStableSvg(page)

    const wide60Before = await readDevMetrics(page)
    expect(wide60Before.nodeCount).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(wide60Before.domNodes).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(wide60Before.filterCount).toBe(0)
    expect(wide60Before.hydrateMs).not.toBeNull()

    const overflowBubble = page.locator('[data-testid="map-node"][data-node-kind="overflow"]')
    await expect(overflowBubble).toBeVisible()
    await overflowBubble.click()
    await page.waitForTimeout(650)
    await page.getByTestId('map-fit').click()
    await page.waitForTimeout(550)
    await exerciseActiveInteraction(page)

    const wide60After = await readDevMetrics(page)
    expect(wide60After.domNodes).toBeGreaterThan(wide60Before.domNodes)
    expect(wide60After.nodeCount).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(wide60After.domNodes).toBeLessThanOrEqual(MAX_DOM_NODES)
    expect(wide60After.filterCount).toBe(0)
    expect(wide60After.fpsSamples).toBeGreaterThan(0)

    const browserVersion = page.context().browser()?.version() ?? 'unknown'
    console.info(
      `[T3_8_BROWSER_PERF] ${JSON.stringify({
        browserVersion,
        unbalanced150,
        large2000Root,
        large2000Deep,
        wide60Before,
        wide60After,
      })}`,
    )

    expect(consoleErrors).toEqual([])
  })
})
