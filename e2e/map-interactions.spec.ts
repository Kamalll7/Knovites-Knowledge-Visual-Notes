import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/map-screens'
const VIEWPORT = { width: 1280, height: 800 }
const MIN_SCREEN_FONT_PX = 11

async function waitForStableSvg(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
}

async function auditInteractiveMap(page: Page) {
  return page.evaluate((minFontPx: number) => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
    const camGroup = document.querySelector<SVGGElement>('[data-testid="map-camera-group"]')!
    const devHud = document.querySelector<HTMLElement>('[data-testid="dev-map-hud"]')
    const mapHud = document.querySelector<HTMLElement>('[data-testid="map-hud-controls"]')
    const hudRects = [devHud, mapHud]
      .filter((el): el is HTMLElement => el !== null)
      .map((el) => el.getBoundingClientRect())

    const tfStr = camGroup.getAttribute('transform') ?? ''
    const scaleMatch = /scale\(([^)]+)\)/.exec(tfStr)
    const scale = scaleMatch ? Number.parseFloat(scaleMatch[1]!) : 1

    const filterCount = svg.querySelectorAll('filter').length
    const svgRect = svg.getBoundingClientRect()
    const nodeEls = Array.from(svg.querySelectorAll<SVGGElement>('[data-testid="map-node"]'))

    let hudOverlaps = 0
    let labelOverflows = 0
    let minScreenFontPx = Infinity
    let visibleLabelCount = 0

    const nodeBoxesWorld: Array<{
      id: string
      minX: number
      minY: number
      maxX: number
      maxY: number
    }> = []

    for (const g of nodeEls) {
      const id = g.dataset.nodeId ?? ''
      const shape = g.querySelector<SVGGraphicsElement>('[data-testid="map-node-shape"]')
      if (!shape) continue
      const sRect = shape.getBoundingClientRect()
      const visLeft = Math.max(sRect.left, svgRect.left)
      const visRight = Math.min(sRect.right, svgRect.right)
      const visTop = Math.max(sRect.top, svgRect.top)
      const visBottom = Math.min(sRect.bottom, svgRect.bottom)
      const isVisibleInSvg = visRight > visLeft && visBottom > visTop
      if (isVisibleInSvg) {
        for (const hr of hudRects) {
          if (
            visRight > hr.left &&
            visLeft < hr.right &&
            visBottom > hr.top &&
            visTop < hr.bottom
          ) {
            hudOverlaps += 1
            break
          }
        }
      }

      const tf = g.getAttribute('transform') ?? ''
      const m = /translate\(([^,]+),\s*([^)]+)\)/.exec(tf)
      const nx = m ? Number.parseFloat(m[1]!) : 0
      const ny = m ? Number.parseFloat(m[2]!) : 0
      const sb = shape.getBBox()
      nodeBoxesWorld.push({
        id,
        minX: nx + sb.x,
        minY: ny + sb.y,
        maxX: nx + sb.x + sb.width,
        maxY: ny + sb.y + sb.height,
      })

      const label = g.querySelector<SVGTextElement>('[data-testid="map-node-label"]')
      if (label) {
        visibleLabelCount += 1
        const fontSize = Number.parseFloat(label.getAttribute('font-size') ?? '0')
        minScreenFontPx = Math.min(minScreenFontPx, fontSize * scale)
        if (g.dataset.nodeShape === 'capsule') {
          const lb = label.getBBox()
          if (lb.x < sb.x + 1 || lb.x + lb.width > sb.x + sb.width - 1) {
            labelOverflows += 1
          }
        }
      }
    }

    let sampledEdgeNodeCrossings = 0
    const edgeGroups = Array.from(svg.querySelectorAll<SVGGElement>('[data-edge-id]'))
    for (const eg of edgeGroups) {
      const edgeId = eg.dataset.edgeId ?? ''
      const [srcId, dstId] = edgeId.split('->')
      const path = eg.querySelector<SVGPathElement>('[data-testid="map-edge-path"]')
      if (!path) continue
      const totalLen = path.getTotalLength()
      if (totalLen <= 0) continue
      const samples = 10
      for (let s = 1; s < samples; s += 1) {
        const pt = path.getPointAtLength((totalLen * s) / samples)
        for (const box of nodeBoxesWorld) {
          if (box.id === srcId || box.id === dstId) continue
          if (pt.x >= box.minX && pt.x <= box.maxX && pt.y >= box.minY && pt.y <= box.maxY) {
            sampledEdgeNodeCrossings += 1
            break
          }
        }
      }
    }

    return {
      filterCount,
      hudOverlaps,
      labelOverflows,
      sampledEdgeNodeCrossings,
      nodeCount: nodeEls.length,
      scale: Number(scale.toFixed(3)),
      visibleLabelCount,
      minScreenFontPx: Number.isFinite(minScreenFontPx) ? Number(minScreenFontPx.toFixed(2)) : 0,
      passesMinFont: visibleLabelCount === 0 || minScreenFontPx >= minFontPx - 0.15,
    }
  }, MIN_SCREEN_FONT_PX)
}

test.describe('Map interactions, semantic zoom, persistence, and dev perf HUD [T3.5, T3.3b]', () => {
  test('supports zoom/pan/fit/recenter, focus transition + interruption, +N overflow, hover tooltip, orientation reload persistence, and dev HUD', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    mkdirSync(SCREENS_DIR, { recursive: true })

    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.setViewportSize(VIEWPORT)
    await page.goto('/#/__dev/map?dataset=demo&interactive=1&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await waitForStableSvg(page)

    // 1. Zoom in, zoom out, drag pan, fit, recenter
    const initialAudit = await auditInteractiveMap(page)
    expect(initialAudit.filterCount).toBe(0)
    expect(initialAudit.hudOverlaps).toBe(0)
    expect(initialAudit.sampledEdgeNodeCrossings).toBe(0)
    expect(initialAudit.labelOverflows).toBe(0)
    expect(initialAudit.passesMinFont).toBe(true)

    await page.getByTestId('map-zoom-in').click()
    await page.waitForTimeout(550)
    const afterZoomIn = await auditInteractiveMap(page)
    expect(afterZoomIn.scale).toBeGreaterThan(initialAudit.scale)
    expect(afterZoomIn.scale).toBeLessThanOrEqual(3)

    // Drag pan on SVG background
    const svgBox = (await page.getByTestId('map-svg').boundingBox())!
    const beforePanTf = await page.getByTestId('map-camera-group').getAttribute('transform')
    await page.mouse.move(svgBox.x + 80, svgBox.y + 80)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 180, svgBox.y + 140, { steps: 6 })
    await page.mouse.up()
    await waitForStableSvg(page)
    const afterPanTf = await page.getByTestId('map-camera-group').getAttribute('transform')
    expect(afterPanTf).not.toBe(beforePanTf)

    // Focus transition + mid-flight interruption on branch nodes
    const branchNodes = page.locator('[data-testid="map-node"][data-node-kind="node"]')
    const firstBranchId = await branchNodes.nth(0).getAttribute('data-node-id')
    const secondBranchId = await branchNodes.nth(1).getAttribute('data-node-id')
    expect(firstBranchId).toBeTruthy()
    expect(secondBranchId).toBeTruthy()

    await page.locator(`[data-node-id="${firstBranchId}"]`).click()
    await page.waitForTimeout(120)
    // Interrupt mid-flight by clicking second branch
    await page.locator(`[data-node-id="${secondBranchId}"]`).click()
    await page.waitForTimeout(600)
    await waitForStableSvg(page)

    const afterFocusAudit = await auditInteractiveMap(page)
    expect(afterFocusAudit.filterCount).toBe(0)
    expect(afterFocusAudit.hudOverlaps).toBe(0)
    expect(afterFocusAudit.sampledEdgeNodeCrossings).toBe(0)
    expect(afterFocusAudit.labelOverflows).toBe(0)
    expect(afterFocusAudit.passesMinFont).toBe(true)

    await page.screenshot({
      path: `${SCREENS_DIR}/t3.5-demo-interactive-dark.png`,
      animations: 'disabled',
    })

    // 2. Orientation toggle (Radial -> Horizontal) persists across reload [T3.3b]
    await page.getByTestId('map-orientation-horizontal').click()
    await page.waitForTimeout(550)
    await expect(page.getByTestId('map-viewport')).toHaveAttribute('data-orientation', 'horizontal')

    await page.reload()
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await expect(page.getByTestId('map-viewport')).toHaveAttribute('data-orientation', 'horizontal')
    await expect(page.getByTestId('map-orientation-horizontal')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const afterReloadAudit = await auditInteractiveMap(page)
    expect(afterReloadAudit.hudOverlaps).toBe(0)
    expect(afterReloadAudit.sampledEdgeNodeCrossings).toBe(0)
    expect(afterReloadAudit.labelOverflows).toBe(0)

    await page.screenshot({
      path: `${SCREENS_DIR}/t3.5-demo-horizontal-reload-dark.png`,
      animations: 'disabled',
    })

    // Reset orientation back to radial and verify reduced-motion + +N overflow + hover + dev perf HUD
    await page.getByTestId('map-orientation-radial').click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#/__dev/map?dataset=wide60Children&interactive=1&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await waitForStableSvg(page)

    // Click first child hub to reveal its 24 children + +36 overflow bubble
    const hubNode = page.locator('[data-testid="map-node"][data-node-kind="node"]').first()
    await hubNode.click()
    await waitForStableSvg(page)

    // Hover a truncated node (if present) and verify tooltip shows full title without <filter>
    const truncatedNode = page.locator('[data-testid="map-node"][data-truncated="true"]').first()
    if ((await truncatedNode.count()) > 0) {
      await truncatedNode.hover()
      await expect(page.getByTestId('map-hover-tooltip')).toBeVisible()
      await page.mouse.move(10, 10)
    }

    // Click +N overflow bubble and confirm node count expands
    const overflowBubble = page.locator('[data-testid="map-node"][data-node-kind="overflow"]')
    await expect(overflowBubble).toBeVisible()
    const beforeOverflowCount = await page.locator('[data-testid="map-node"]').count()
    await overflowBubble.click()
    await waitForStableSvg(page)
    const afterOverflowCount = await page.locator('[data-testid="map-node"]').count()
    expect(afterOverflowCount).toBeGreaterThan(beforeOverflowCount)

    await page.screenshot({
      path: `${SCREENS_DIR}/t3.5-wide60-expanded-dark.png`,
      animations: 'disabled',
    })

    // 3. Dev measurement HUD: real IndexedDB hydrate benchmark + FPS log (printed only, not gated) + Reset pengukuran
    await page.goto('/#/__dev/map?dataset=unbalanced150&interactive=1&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.getByTestId('dev-bench-hydrate').click()
    await expect(page.getByTestId('dev-map-diagnostics')).not.toHaveAttribute('data-hydrate-ms', '')
    await page.waitForTimeout(400)

    const diag = page.getByTestId('dev-map-diagnostics')
    const hudSnapshot = {
      nodeCount: Number(await diag.getAttribute('data-node-count')),
      layoutMs: Number(await diag.getAttribute('data-layout-ms')),
      hydrateMs: Number(await diag.getAttribute('data-hydrate-ms')),
      fpsP50: Number(await diag.getAttribute('data-fps-p50')),
      fpsP95: Number(await diag.getAttribute('data-fps-p95')),
      fpsMax: Number(await diag.getAttribute('data-fps-max')),
      fpsSamples: Number(await diag.getAttribute('data-fps-samples')),
    }
    // Headless FPS is printed for visibility only (owner measures real GPU FPS in Chrome)
    console.info(`[T3_5_DEV_HUD] ${JSON.stringify(hudSnapshot)}`)
    expect(hudSnapshot.hydrateMs).toBeGreaterThanOrEqual(0)
    expect(hudSnapshot.layoutMs).toBeGreaterThanOrEqual(0)
    expect(hudSnapshot.nodeCount).toBeGreaterThan(0)

    // Verify Reset pengukuran button clears hydrateMs
    await page.getByTestId('dev-perf-reset').click()
    await expect(diag).toHaveAttribute('data-hydrate-ms', '')

    expect(consoleErrors).toEqual([])
  })
})
