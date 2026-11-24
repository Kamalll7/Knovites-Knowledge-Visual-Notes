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

async function auditDomEdgeNodeConnectivity(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
    const viewport = document.querySelector<HTMLElement>('[data-testid="map-viewport"]')
    const orientation = viewport?.dataset.orientation ?? 'radial'
    const camGroup = document.querySelector<SVGGElement>('[data-testid="map-camera-group"]')!
    const tfStr = camGroup.getAttribute('transform') ?? ''
    const scaleMatch = /scale\(([^)]+)\)/.exec(tfStr)
    const scale = scaleMatch ? Number.parseFloat(scaleMatch[1]!) : 1

    const nodeElById = new Map<string, SVGGElement>()
    for (const g of svg.querySelectorAll<SVGGElement>('[data-testid="map-node"]')) {
      const id = g.dataset.nodeId
      if (id) nodeElById.set(id, g)
    }

    const distToRectBoundary = (px: number, py: number, r: DOMRect): number => {
      const dxOut = Math.max(r.left - px, 0, px - r.right)
      const dyOut = Math.max(r.top - py, 0, py - r.bottom)
      if (dxOut > 0 || dyOut > 0) return Math.hypot(dxOut, dyOut)
      return Math.min(px - r.left, r.right - px, py - r.top, r.bottom - py)
    }

    const distToNodeEndpoint = (
      px: number,
      py: number,
      nodeG: SVGGElement,
      allowRootLabelClip: boolean,
    ): number => {
      const shape = nodeG.querySelector<SVGGraphicsElement>('[data-testid="map-node-shape"]')!
      const sRect = shape.getBoundingClientRect()
      const shapeKind = nodeG.dataset.nodeShape
      let bestDist: number
      if (shapeKind === 'circle') {
        const cx = (sRect.left + sRect.right) / 2
        const cy = (sRect.top + sRect.bottom) / 2
        const radius = (sRect.width + sRect.height) / 4
        bestDist = Math.abs(Math.hypot(px - cx, py - cy) - radius)
      } else {
        bestDist = distToRectBoundary(px, py, sRect)
      }

      if (allowRootLabelClip && orientation === 'radial' && nodeG.dataset.nodeKind === 'root') {
        const labelBg =
          nodeG.querySelector<SVGGraphicsElement>('[data-testid="map-node-label-bg"]') ??
          nodeG.querySelector<SVGGraphicsElement>('[data-testid="map-node-label"]')
        if (labelBg) {
          const lbRect = labelBg.getBoundingClientRect()
          // map-edge-path clips radial root edges with ROOT_LABEL_CLEARANCE_PX (4 world px) outside labelBox
          // while label-bg expands labelBox by 4px horizontally and 1px vertically -> offset <= 3 * scale px.
          const padY = 3 * scale
          const expanded = new DOMRect(
            lbRect.left,
            lbRect.top - padY,
            lbRect.width,
            lbRect.height + padY * 2,
          )
          bestDist = Math.min(bestDist, distToRectBoundary(px, py, expanded))
        }
      }
      return bestDist
    }

    const edgeGroups = Array.from(svg.querySelectorAll<SVGGElement>('[data-edge-id]'))
    const tolPx = Math.max(5, 4 * scale + 2.5)
    const disconnected: Array<{
      edgeId: string
      end: 'source' | 'target' | 'missing-node' | 'halo'
      distPx: number
      tolPx: number
    }> = []

    for (const eg of edgeGroups) {
      const edgeId = eg.dataset.edgeId ?? ''
      const [srcId, dstId] = edgeId.split('->')
      const srcG = srcId ? nodeElById.get(srcId) : undefined
      const dstG = dstId ? nodeElById.get(dstId) : undefined
      if (!srcG || !dstG) {
        disconnected.push({ edgeId, end: 'missing-node', distPx: Infinity, tolPx })
        continue
      }
      const path = eg.querySelector<SVGPathElement>('[data-testid="map-edge-path"]')
      if (!path) continue
      const totalLen = path.getTotalLength()
      const ctm = path.getScreenCTM()
      if (!ctm || totalLen <= 0) continue

      const p0 = path.getPointAtLength(0).matrixTransform(ctm)
      const p1 = path.getPointAtLength(totalLen).matrixTransform(ctm)

      const srcDist = distToNodeEndpoint(p0.x, p0.y, srcG, true)
      if (srcDist > tolPx) {
        disconnected.push({
          edgeId,
          end: 'source',
          distPx: Number(srcDist.toFixed(2)),
          tolPx: Number(tolPx.toFixed(2)),
        })
      }

      const dstDist = distToNodeEndpoint(p1.x, p1.y, dstG, false)
      if (dstDist > tolPx) {
        disconnected.push({
          edgeId,
          end: 'target',
          distPx: Number(dstDist.toFixed(2)),
          tolPx: Number(tolPx.toFixed(2)),
        })
      }

      const halo = eg.querySelector<SVGPathElement>('[data-testid="map-edge-focus-halo"]')
      if (halo) {
        const hLen = halo.getTotalLength()
        const hCtm = halo.getScreenCTM()
        if (hCtm && hLen > 0) {
          const hp0 = halo.getPointAtLength(0).matrixTransform(hCtm)
          const hp1 = halo.getPointAtLength(hLen).matrixTransform(hCtm)
          const hGap = Math.max(
            Math.hypot(hp0.x - p0.x, hp0.y - p0.y),
            Math.hypot(hp1.x - p1.x, hp1.y - p1.y),
          )
          if (hGap > 2) {
            disconnected.push({ edgeId, end: 'halo', distPx: Number(hGap.toFixed(2)), tolPx: 2 })
          }
        }
      }
    }

    return {
      edgeCount: edgeGroups.length,
      scale: Number(scale.toFixed(3)),
      tier: viewport?.dataset.tier ?? '',
      orientation,
      disconnected,
    }
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
    let statusDotPaddingViolations = 0
    let rootLabelEdgeCrossings = 0
    let minScreenFontPx = Infinity
    let visibleLabelCount = 0
    let rootLabelBoxWorld: { minX: number; minY: number; maxX: number; maxY: number } | null = null

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
        } else if (g.dataset.nodeKind === 'root') {
          const lb = label.getBBox()
          rootLabelBoxWorld = {
            minX: nx + lb.x,
            minY: ny + lb.y,
            maxX: nx + lb.x + lb.width,
            maxY: ny + lb.y + lb.height,
          }
        }
      }

      if (g.dataset.nodeShape === 'capsule') {
        const dot = g.querySelector<SVGCircleElement>('[data-testid="status-dot"]')
        const badgeGroup = dot?.parentElement
        if (dot && badgeGroup) {
          const btf = badgeGroup.getAttribute('transform') ?? ''
          const bm = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(btf)
          const gx = bm ? Number.parseFloat(bm[1]!) : 0
          const dotCx = Number.parseFloat(dot.getAttribute('cx') ?? '0')
          const dotR = Number.parseFloat(dot.getAttribute('r') ?? '0')
          const dotMinX = gx + dotCx - dotR
          const dotMaxX = gx + dotCx + dotR
          if (dotMinX < sb.x + 4 || dotMaxX > sb.x + sb.width - 4) {
            statusDotPaddingViolations += 1
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
      const samples = 20
      for (let s = 0; s <= samples; s += 1) {
        const pt = path.getPointAtLength((totalLen * s) / samples)
        if (
          rootLabelBoxWorld &&
          pt.x >= rootLabelBoxWorld.minX &&
          pt.x <= rootLabelBoxWorld.maxX &&
          pt.y >= rootLabelBoxWorld.minY &&
          pt.y <= rootLabelBoxWorld.maxY
        ) {
          rootLabelEdgeCrossings += 1
        }
        if (s === 0 || s === samples) continue
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
      statusDotPaddingViolations,
      rootLabelEdgeCrossings,
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
    expect(initialAudit.statusDotPaddingViolations).toBe(0)
    expect(initialAudit.rootLabelEdgeCrossings).toBe(0)
    expect(initialAudit.passesMinFont).toBe(true)
    const initialConn = await auditDomEdgeNodeConnectivity(page)
    expect(initialConn.edgeCount).toBeGreaterThan(0)
    expect(initialConn.disconnected, 'initial load edge-node connectivity').toEqual([])

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
    expect(afterFocusAudit.statusDotPaddingViolations).toBe(0)
    expect(afterFocusAudit.rootLabelEdgeCrossings).toBe(0)
    expect(afterFocusAudit.passesMinFont).toBe(true)
    const afterFocusConn = await auditDomEdgeNodeConnectivity(page)
    expect(afterFocusConn.edgeCount).toBeGreaterThan(0)
    expect(afterFocusConn.disconnected, 'after focus settled edge-node connectivity').toEqual([])

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
    await waitForStableSvg(page)

    const afterReloadAudit = await auditInteractiveMap(page)
    expect(afterReloadAudit.hudOverlaps).toBe(0)
    expect(afterReloadAudit.sampledEdgeNodeCrossings).toBe(0)
    expect(afterReloadAudit.labelOverflows).toBe(0)
    expect(afterReloadAudit.statusDotPaddingViolations).toBe(0)
    const afterReloadConn = await auditDomEdgeNodeConnectivity(page)
    expect(afterReloadConn.edgeCount).toBeGreaterThan(0)
    expect(afterReloadConn.disconnected, 'horizontal reload edge-node connectivity').toEqual([])

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

    // Click Fit so the wide 24-child fan + overflow bubble (+36) sit inside viewport, then click +N
    await page.getByTestId('map-fit').click()
    await waitForStableSvg(page)
    const overflowBubble = page.locator('[data-testid="map-node"][data-node-kind="overflow"]')
    await expect(overflowBubble).toBeVisible()
    const beforeOverflowCount = await page.locator('[data-testid="map-node"]').count()
    await overflowBubble.click()
    await waitForStableSvg(page)
    const afterOverflowCount = await page.locator('[data-testid="map-node"]').count()
    expect(afterOverflowCount).toBeGreaterThan(beforeOverflowCount)
    const afterExpandConn = await auditDomEdgeNodeConnectivity(page)
    expect(afterExpandConn.edgeCount).toBeGreaterThan(24)
    expect(afterExpandConn.disconnected, 'after +N expand edge-node connectivity').toEqual([])

    await page.screenshot({
      path: `${SCREENS_DIR}/t3.5-wide60-expanded-dark.png`,
      animations: 'disabled',
    })

    // Measure wide60Children 62-node viewport bounds before vs after Fit to confirm fit-all padding math
    const measureNodesVsSvg = () =>
      page.evaluate(() => {
        const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
        const camGroup = document.querySelector<SVGGElement>('[data-testid="map-camera-group"]')!
        const m = /scale\(([^)]+)\)/.exec(camGroup.getAttribute('transform') ?? '')
        const scale = m ? Number.parseFloat(m[1]!) : 1
        const sr = svg.getBoundingClientRect()
        let minTop = Infinity
        let maxBottom = -Infinity
        let minLeft = Infinity
        let maxRight = -Infinity
        for (const s of svg.querySelectorAll<SVGGraphicsElement>(
          '[data-testid="map-node-shape"]',
        )) {
          const r = s.getBoundingClientRect()
          minTop = Math.min(minTop, r.top - sr.top)
          maxBottom = Math.max(maxBottom, r.bottom - sr.top)
          minLeft = Math.min(minLeft, r.left - sr.left)
          maxRight = Math.max(maxRight, r.right - sr.left)
        }
        return {
          scale: Number(scale.toFixed(4)),
          svgW: Math.round(sr.width),
          svgH: Math.round(sr.height),
          padTop: Math.round(minTop),
          padBottom: Math.round(sr.height - maxBottom),
          padLeft: Math.round(minLeft),
          padRight: Math.round(sr.width - maxRight),
        }
      })
    const wide60BeforePostExpandFit = await measureNodesVsSvg()
    await page.getByTestId('map-fit').click()
    await waitForStableSvg(page)
    const wide60AfterPostExpandFit = await measureNodesVsSvg()
    console.info(
      `[T3_5_WIDE60_FIT_DIAG] ${JSON.stringify({ beforeFit: wide60BeforePostExpandFit, afterFit: wide60AfterPostExpandFit })}`,
    )

    // 3. Dev measurement HUD: real IndexedDB hydrate benchmark + active-interaction RAF FPS log + Reset pengukuran
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/#/__dev/map?dataset=unbalanced150&interactive=1&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.getByTestId('dev-bench-hydrate').click()
    await expect(page.getByTestId('dev-map-diagnostics')).not.toHaveAttribute('data-hydrate-ms', '')
    // Trigger an active zoom transition so the active-interaction RAF sampler records real frames
    await page.getByTestId('map-zoom-in').click()
    await page.waitForTimeout(700)

    const diag = page.getByTestId('dev-map-diagnostics')
    await expect(diag).not.toHaveAttribute('data-fps-samples', '0')
    const hudSnapshot = {
      nodeCount: Number(await diag.getAttribute('data-node-count')),
      layoutMs: Number(await diag.getAttribute('data-layout-ms')),
      hydrateMs: Number(await diag.getAttribute('data-hydrate-ms')),
      fpsP50: Number(await diag.getAttribute('data-fps-p50')),
      fpsP95: Number(await diag.getAttribute('data-fps-p95')),
      fpsMin: Number(await diag.getAttribute('data-fps-min')),
      frameMaxMs: Number(await diag.getAttribute('data-frame-max-ms')),
      fpsSamples: Number(await diag.getAttribute('data-fps-samples')),
    }
    // Headless FPS is printed for visibility only (owner measures real GPU FPS in Chrome)
    console.info(`[T3_5_DEV_HUD] ${JSON.stringify(hudSnapshot)}`)
    expect(hudSnapshot.hydrateMs).toBeGreaterThanOrEqual(0)
    expect(hudSnapshot.layoutMs).toBeGreaterThanOrEqual(0)
    expect(hudSnapshot.nodeCount).toBeGreaterThan(0)
    expect(hudSnapshot.fpsSamples).toBeGreaterThan(0)
    expect(hudSnapshot.frameMaxMs).toBeGreaterThan(0)
    expect(hudSnapshot.fpsMin).toBeLessThanOrEqual(hudSnapshot.fpsP95)
    expect(hudSnapshot.fpsP95).toBeLessThanOrEqual(hudSnapshot.fpsP50)
    await expect(diag).toContainText(
      `fps(5s):${hudSnapshot.fpsP50}/${hudSnapshot.fpsP95}/${hudSnapshot.fpsMin}`,
    )
    await expect(diag).toContainText(`max:${hudSnapshot.frameMaxMs}ms`)

    // Verify Reset pengukuran button clears hydrateMs & perf samples
    await page.getByTestId('dev-perf-reset').click()
    await expect(diag).toHaveAttribute('data-hydrate-ms', '')
    await expect(diag).toHaveAttribute('data-fps-samples', '0')

    expect(consoleErrors).toEqual([])
  })

  test('pure-center focus preserves zoom k, animates camera+nodes+edges mid-flight, and eliminates pan-clamp dead-zone [T3.5-fix, T3.6]', async ({
    page,
  }) => {
    test.setTimeout(60_000)

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

    const parseCamera = () =>
      page.evaluate(() => {
        const g = document.querySelector<SVGGElement>('[data-testid="map-camera-group"]')!
        const tf = g.getAttribute('transform') ?? ''
        const m = /translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(tf)
        return {
          x: m ? Number.parseFloat(m[1]!) : 0,
          y: m ? Number.parseFloat(m[2]!) : 0,
          k: m ? Number.parseFloat(m[3]!) : 1,
        }
      })

    // Zoom in once so we test focus at a non-default scale k
    await page.getByTestId('map-zoom-in').click()
    await page.waitForTimeout(650)
    await waitForStableSvg(page)
    const camBeforeFocus = await parseCamera()

    const branchNodes = page.locator('[data-testid="map-node"][data-node-kind="node"]')
    const targetBranchId = (await branchNodes.nth(1).getAttribute('data-node-id'))!
    expect(targetBranchId).toBeTruthy()

    // Start in-page RAF frame recorder BEFORE clicking so we capture true mid-flight DOM state without IPC lag
    await page.evaluate(() => {
      interface FrameRec {
        ts: number
        cam: { x: number; y: number; k: number }
        nodes: Record<string, { x: number; y: number }>
        edges: Record<string, { sx: number; sy: number; tx: number; ty: number }>
      }
      const w = window as unknown as { __t35Frames: FrameRec[]; __t35Stop?: boolean }
      w.__t35Frames = []
      w.__t35Stop = false
      const parseEndPt = (d: string) => {
        const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
        if (nums.length < 4) return null
        return {
          sx: nums[0]!,
          sy: nums[1]!,
          tx: nums[nums.length - 2]!,
          ty: nums[nums.length - 1]!,
        }
      }
      const snap = () => {
        const g = document.querySelector<SVGGElement>('[data-testid="map-camera-group"]')
        const tf = g?.getAttribute('transform') ?? ''
        const cm = /translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(tf)
        const cam = {
          x: cm ? Number.parseFloat(cm[1]!) : 0,
          y: cm ? Number.parseFloat(cm[2]!) : 0,
          k: cm ? Number.parseFloat(cm[3]!) : 1,
        }
        const nodes: Record<string, { x: number; y: number }> = {}
        for (const el of document.querySelectorAll<SVGGElement>('[data-testid="map-node"]')) {
          const id = el.dataset.nodeId
          if (!id) continue
          const nt = el.getAttribute('transform') ?? ''
          const nm = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(nt)
          if (nm) nodes[id] = { x: Number.parseFloat(nm[1]!), y: Number.parseFloat(nm[2]!) }
        }
        const edges: Record<string, { sx: number; sy: number; tx: number; ty: number }> = {}
        for (const eg of document.querySelectorAll<SVGGElement>('[data-edge-id]')) {
          const eid = eg.dataset.edgeId
          const path = eg.querySelector<SVGPathElement>('[data-testid="map-edge-path"]')
          if (!eid || !path) continue
          const pt = parseEndPt(path.getAttribute('d') ?? '')
          if (pt) edges[eid] = pt
        }
        w.__t35Frames.push({ ts: performance.now(), cam, nodes, edges })
        if (!w.__t35Stop) requestAnimationFrame(snap)
      }
      requestAnimationFrame(snap)
    })

    await page.locator(`[data-node-id="${targetBranchId}"]`).click()
    await page.waitForTimeout(750)
    await waitForStableSvg(page)

    const animAudit = await page.evaluate((focusId: string) => {
      interface FrameRec {
        ts: number
        cam: { x: number; y: number; k: number }
        nodes: Record<string, { x: number; y: number }>
        edges: Record<string, { sx: number; sy: number; tx: number; ty: number }>
      }
      const w = window as unknown as { __t35Frames: FrameRec[]; __t35Stop?: boolean }
      w.__t35Stop = true
      const frames = w.__t35Frames
      const start = frames[0]!
      const end = frames[frames.length - 1]!

      // Find first frame where animation started (camera or node diverged from start)
      const firstMoveIdx = frames.findIndex(
        (f) => Math.hypot(f.cam.x - start.cam.x, f.cam.y - start.cam.y) > 0.5,
      )
      const t0 = firstMoveIdx >= 0 ? frames[firstMoveIdx]!.ts : start.ts

      // Find a persistent node whose position moved significantly (>= 15px)
      let movingNodeId: string | null = null
      let movingNodeDist = 0
      for (const [id, endPos] of Object.entries(end.nodes)) {
        const sPos = start.nodes[id]
        if (!sPos) continue
        const dist = Math.hypot(endPos.x - sPos.x, endPos.y - sPos.y)
        if (dist > movingNodeDist) {
          movingNodeDist = dist
          movingNodeId = id
        }
      }

      // Find an edge attached to a moving/emerging node whose endpoint moved (>= 15px)
      let movingEdgeId: string | null = null
      let movingEdgeDist = 0
      for (const [eid, endEdge] of Object.entries(end.edges)) {
        const sEdge = start.edges[eid]
        if (sEdge) {
          const dist = Math.hypot(endEdge.tx - sEdge.tx, endEdge.ty - sEdge.ty)
          if (dist > movingEdgeDist) {
            movingEdgeDist = dist
            movingEdgeId = eid
          }
        }
      }

      const camTotal = Math.hypot(end.cam.x - start.cam.x, end.cam.y - start.cam.y)

      // Inspect frames in ~100..350ms window (specifically targeting ~150-250ms mid-flight)
      const midCandidates = frames.filter((f) => f.ts - t0 >= 100 && f.ts - t0 <= 350)
      const midFrame =
        midCandidates.find((f) => f.ts - t0 >= 150 && f.ts - t0 <= 260) ??
        midCandidates[Math.floor(midCandidates.length / 2)] ??
        null

      let camProgress = -1
      let nodeProgress = -1
      let edgeProgress = -1
      let midElapsedMs = -1
      if (midFrame) {
        midElapsedMs = Number((midFrame.ts - t0).toFixed(1))
        if (camTotal > 1) {
          camProgress =
            Math.hypot(midFrame.cam.x - start.cam.x, midFrame.cam.y - start.cam.y) / camTotal
        }
        if (movingNodeId && movingNodeDist > 1) {
          const sPos = start.nodes[movingNodeId]!
          const mPos = midFrame.nodes[movingNodeId]
          if (mPos) {
            nodeProgress = Math.hypot(mPos.x - sPos.x, mPos.y - sPos.y) / movingNodeDist
          }
        }
        if (movingEdgeId && movingEdgeDist > 1) {
          const sEdge = start.edges[movingEdgeId]!
          const mEdge = midFrame.edges[movingEdgeId]
          if (mEdge) {
            edgeProgress = Math.hypot(mEdge.tx - sEdge.tx, mEdge.ty - sEdge.ty) / movingEdgeDist
          }
        }
      }

      // Check settled screen center of focus node vs safe viewport center
      const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
      const svgRect = svg.getBoundingClientRect()
      const focusShape = document.querySelector<SVGGraphicsElement>(
        `[data-node-id="${focusId}"] [data-testid="map-node-shape"]`,
      )!
      const shapeRect = focusShape.getBoundingClientRect()
      const focusCenterScreenX = shapeRect.left + shapeRect.width / 2
      const focusCenterScreenY = shapeRect.top + shapeRect.height / 2
      const viewportCenterX = svgRect.left + svgRect.width / 2
      const viewportCenterY = svgRect.top + svgRect.height / 2

      return {
        frameCount: frames.length,
        midElapsedMs,
        camTotal: Number(camTotal.toFixed(1)),
        movingNodeId,
        movingNodeDist: Number(movingNodeDist.toFixed(1)),
        movingEdgeId,
        movingEdgeDist: Number(movingEdgeDist.toFixed(1)),
        camProgress: Number(camProgress.toFixed(3)),
        nodeProgress: Number(nodeProgress.toFixed(3)),
        edgeProgress: Number(edgeProgress.toFixed(3)),
        endCam: end.cam,
        centerDeltaX: Number(Math.abs(focusCenterScreenX - viewportCenterX).toFixed(2)),
        centerDeltaY: Number(Math.abs(focusCenterScreenY - viewportCenterY).toFixed(2)),
      }
    }, targetBranchId)

    // (a) Zoom k preserved identically (tol 1e-4) and focus node centered strictly (tol <= 2px)
    expect(Math.abs(animAudit.endCam.k - camBeforeFocus.k)).toBeLessThanOrEqual(1e-4)
    expect(animAudit.centerDeltaX).toBeLessThanOrEqual(2)
    expect(animAudit.centerDeltaY).toBeLessThanOrEqual(2)

    // (b) Mid-flight (~150-250ms), camera, moving node, and edge endpoints are strictly between start & end
    expect(animAudit.camTotal).toBeGreaterThan(20)
    expect(animAudit.movingNodeDist).toBeGreaterThan(10)
    expect(animAudit.movingEdgeDist).toBeGreaterThan(10)
    expect(animAudit.camProgress).toBeGreaterThan(0.05)
    expect(animAudit.camProgress).toBeLessThan(0.98)
    expect(animAudit.nodeProgress).toBeGreaterThan(0.05)
    expect(animAudit.nodeProgress).toBeLessThan(0.98)
    expect(animAudit.edgeProgress).toBeGreaterThan(0.05)
    expect(animAudit.edgeProgress).toBeLessThan(0.98)

    // Verify Focus button also preserves k and re-centers after panning away
    const svgBox = (await page.getByTestId('map-svg').boundingBox())!
    await page.mouse.move(svgBox.x + 120, svgBox.y + 120)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 300, svgBox.y + 240, { steps: 6 })
    await page.mouse.up()
    await waitForStableSvg(page)

    const camBeforeRecenter = await parseCamera()
    await page.getByTestId('map-recenter').click()
    await page.waitForTimeout(650)
    await waitForStableSvg(page)
    const camAfterRecenter = await parseCamera()
    expect(Math.abs(camAfterRecenter.k - camBeforeRecenter.k)).toBeLessThanOrEqual(1e-4)
    const recenterDelta = await page.evaluate((focusId: string) => {
      const svgRect = document
        .querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
        .getBoundingClientRect()
      const shapeRect = document
        .querySelector<SVGGraphicsElement>(
          `[data-node-id="${focusId}"] [data-testid="map-node-shape"]`,
        )!
        .getBoundingClientRect()
      return {
        dx: Math.abs(shapeRect.left + shapeRect.width / 2 - (svgRect.left + svgRect.width / 2)),
        dy: Math.abs(shapeRect.top + shapeRect.height / 2 - (svgRect.top + svgRect.height / 2)),
      }
    }, targetBranchId)
    expect(recenterDelta.dx).toBeLessThanOrEqual(2)
    expect(recenterDelta.dy).toBeLessThanOrEqual(2)

    // (c) Pan-clamp zero dead-zone: drag far past clamp boundary, release, then drag back slightly
    await page.mouse.move(svgBox.x + 60, svgBox.y + 200)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 1200, svgBox.y + 200, { steps: 10 })
    await page.mouse.up()
    await page.mouse.move(svgBox.x + 60, svgBox.y + 200)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 1200, svgBox.y + 200, { steps: 10 })
    await page.mouse.up()
    await waitForStableSvg(page)
    const camAtClamp = await parseCamera()

    // One more huge push past clamp should remain pinned at the clamp wall
    await page.mouse.move(svgBox.x + 60, svgBox.y + 200)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 1000, svgBox.y + 200, { steps: 8 })
    await page.mouse.up()
    await waitForStableSvg(page)
    const camStillClamped = await parseCamera()
    expect(Math.abs(camStillClamped.x - camAtClamp.x)).toBeLessThanOrEqual(2)

    // Small pull back (-140px) MUST immediately move the camera (zero dead-zone!)
    await page.mouse.move(svgBox.x + 600, svgBox.y + 200)
    await page.mouse.down()
    await page.mouse.move(svgBox.x + 460, svgBox.y + 200, { steps: 6 })
    await page.mouse.up()
    await waitForStableSvg(page)
    const camAfterPullBack = await parseCamera()
    expect(camAtClamp.x - camAfterPullBack.x).toBeGreaterThan(80)

    expect(consoleErrors).toEqual([])
  })

  test('keeps every DOM edge endpoint attached to its source/target node across semantic zoom tier changes (T1 -> T2 -> T0 -> T2) [T3.5-fix2]', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.setViewportSize(VIEWPORT)

    // Test horizontal mode with normal motion enabled (catches T1 -> T2 initial tier upgrade + animated T2 -> T0 -> T2)
    await page.goto('/#/__dev/map?dataset=demo&interactive=1&mode=horizontal&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await page.waitForSelector('[data-testid="map-viewport"]')
    await waitForStableSvg(page)

    const viewport = page.getByTestId('map-viewport')
    const zoomOutBtn = page.getByTestId('map-zoom-out')
    const zoomInBtn = page.getByTestId('map-zoom-in')

    // Start at T2 (upgraded from initial T1 by fit-all -> 120% T2), verify connectivity
    await expect(viewport).toHaveAttribute('data-tier', '2')
    const initConn = await auditDomEdgeNodeConnectivity(page)
    expect(initConn.edgeCount).toBe(14)
    expect(initConn.disconnected, 'horizontal initial T1 -> T2 connectivity').toEqual([])

    // Zoom out repeatedly until Tier 0
    for (let i = 0; i < 6; i += 1) {
      const curTier = await viewport.getAttribute('data-tier')
      if (curTier === '0') break
      await zoomOutBtn.click()
      await page.waitForTimeout(620)
      await waitForStableSvg(page)
      const stepConn = await auditDomEdgeNodeConnectivity(page)
      expect(stepConn.disconnected, `zoom-out step ${i} (tier=${stepConn.tier})`).toEqual([])
    }
    await expect(viewport).toHaveAttribute('data-tier', '0')
    const t0Conn = await auditDomEdgeNodeConnectivity(page)
    expect(t0Conn.edgeCount).toBe(3)
    expect(t0Conn.disconnected, 'horizontal T0 connectivity').toEqual([])

    // Zoom back in rapidly (overlapping animations while tier flips T0 -> T2!)
    await zoomInBtn.click()
    await page.waitForTimeout(150)
    await zoomInBtn.click()
    await page.waitForTimeout(150)
    await zoomInBtn.click()
    await page.waitForTimeout(700)
    await waitForStableSvg(page)

    // Ensure we reach T2
    for (let i = 0; i < 4; i += 1) {
      const curTier = await viewport.getAttribute('data-tier')
      if (curTier === '2') break
      await zoomInBtn.click()
      await page.waitForTimeout(620)
      await waitForStableSvg(page)
    }
    await expect(viewport).toHaveAttribute('data-tier', '2')
    const backT2Conn = await auditDomEdgeNodeConnectivity(page)
    expect(backT2Conn.edgeCount).toBe(14)
    expect(backT2Conn.disconnected, 'horizontal T0 -> T2 connectivity').toEqual([])

    // Also test explicit T1 -> T2 -> T0 -> T2 via wheel zoom on radial mode
    await page.goto('/#/__dev/map?dataset=demo&interactive=1&mode=radial&theme=dark')
    await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
    await waitForStableSvg(page)

    const svgBox = (await page.getByTestId('map-svg').boundingBox())!
    await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2)

    // Wheel zoom out to T0
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, 220)
      await waitForStableSvg(page)
    }
    await expect(viewport).toHaveAttribute('data-tier', '0')
    const radT0 = await auditDomEdgeNodeConnectivity(page)
    expect(radT0.disconnected, 'radial wheel T0 connectivity').toEqual([])

    // Wheel zoom back in to T2
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, -220)
      await waitForStableSvg(page)
    }
    await expect(viewport).toHaveAttribute('data-tier', '2')
    const radT2 = await auditDomEdgeNodeConnectivity(page)
    expect(radT2.edgeCount).toBe(14)
    expect(radT2.disconnected, 'radial wheel T0 -> T2 connectivity').toEqual([])

    expect(consoleErrors).toEqual([])
  })
})
