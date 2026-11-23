import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const DATASETS = [
  'demo',
  'unbalanced150',
  'wide60Children',
  'chainDepth12',
  'root20Children',
  'large2000',
] as const

const THEMES = ['dark', 'light'] as const
const TIER_SPECS = [
  { tier: 0, scale: 0.85 },
  { tier: 1, scale: 1 },
  { tier: 2, scale: 1 },
] as const

const VIEWPORT = { width: 1280, height: 800 }
const SVG_FIXED_W = 1280
const SVG_FIXED_H = 700
const MIN_SCREEN_FONT_PX = 11
const SCREENS_DIR = process.env.KNOVITES_SCREENS_DIR || 'test-results/map-screens'

test.describe('Map static SVG visual baseline [T3.4b, FR-MAP-09]', () => {
  test('renders demo + 5 mandatory datasets across dark/light and tiers 0/1/2 cleanly', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    mkdirSync(SCREENS_DIR, { recursive: true })

    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(VIEWPORT)

    const metricsLog: Array<Record<string, number | string>> = []

    for (const theme of THEMES) {
      for (const dataset of DATASETS) {
        for (const { tier, scale } of TIER_SPECS) {
          const url = `/#/__dev/map?dataset=${dataset}&theme=${theme}&tier=${tier}&scale=${scale}&mode=radial&vw=${SVG_FIXED_W}&vh=${SVG_FIXED_H}`
          await page.goto(url)
          await page.waitForSelector('[data-testid="dev-map-route"][data-ready="true"]')
          await page.waitForSelector('[data-testid="map-svg"]')
          await expect(page.locator('html')).toHaveClass(new RegExp(theme))

          await page.evaluate(async () => {
            await document.fonts.ready
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            )
          })

          const audit = await page.evaluate((minFontPx: number) => {
            const svg = document.querySelector<SVGSVGElement>('[data-testid="map-svg"]')!
            const diag = document.querySelector<HTMLElement>('[data-testid="dev-map-diagnostics"]')!
            const hud = document.querySelector<HTMLElement>('[data-testid="dev-map-hud"]')!
            const filterCount = svg.querySelectorAll('filter').length

            // Check HUD vs rendered node bounding rects (screen space)
            const hudRect = hud.getBoundingClientRect()
            const nodeEls = Array.from(
              svg.querySelectorAll<SVGGElement>('[data-testid="map-node"]'),
            )
            let hudOverlaps = 0
            let labelOverflows = 0
            let minScreenFontPx = Infinity
            let checkedLabels = 0

            const vb = svg.viewBox.baseVal
            const svgRect = svg.getBoundingClientRect()
            const pxPerWorld = Math.min(svgRect.width / vb.width, svgRect.height / vb.height)

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
              // Intersect node rect with the clipped SVG viewport before testing HUD overlap
              const visLeft = Math.max(sRect.left, svgRect.left)
              const visRight = Math.min(sRect.right, svgRect.right)
              const visTop = Math.max(sRect.top, svgRect.top)
              const visBottom = Math.min(sRect.bottom, svgRect.bottom)
              const isVisibleInSvg = visRight > visLeft && visBottom > visTop
              const overlapsHud =
                isVisibleInSvg &&
                visRight > hudRect.left &&
                visLeft < hudRect.right &&
                visBottom > hudRect.top &&
                visTop < hudRect.bottom
              if (overlapsHud) hudOverlaps += 1

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
                checkedLabels += 1
                const fontSize = Number.parseFloat(label.getAttribute('font-size') ?? '0')
                const screenFont = fontSize * pxPerWorld
                minScreenFontPx = Math.min(minScreenFontPx, screenFont)
                if (g.dataset.nodeShape === 'capsule') {
                  const lb = label.getBBox()
                  if (lb.x < sb.x + 1 || lb.x + lb.width > sb.x + sb.width - 1) {
                    labelOverflows += 1
                  }
                }
              }
            }

            // Sample points along rendered SVG edge paths and verify 0 crossings through unrelated nodes
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
                  if (
                    pt.x >= box.minX &&
                    pt.x <= box.maxX &&
                    pt.y >= box.minY &&
                    pt.y <= box.maxY
                  ) {
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
              checkedLabels,
              minScreenFontPx: Number.isFinite(minScreenFontPx)
                ? Number(minScreenFontPx.toFixed(2))
                : 0,
              passesMinFont: checkedLabels === 0 || minScreenFontPx >= minFontPx - 0.1,
              sampledEdgeNodeCrossings,
              passesUsed: Number(diag.dataset.passesUsed ?? '0'),
              overlapCount: Number(diag.dataset.overlapCount ?? '0'),
              edgeCrossings: Number(diag.dataset.edgeCrossings ?? '0'),
              maxRadiusPx: Number(diag.dataset.maxRadiusPx ?? '0'),
              bboxW: Number(diag.dataset.bboxW ?? '0'),
              bboxH: Number(diag.dataset.bboxH ?? '0'),
              nodeCount: Number(diag.dataset.nodeCount ?? '0'),
            }
          }, MIN_SCREEN_FONT_PX)

          expect(audit.filterCount, `${dataset}/${theme}/t${tier} filters`).toBe(0)
          expect(audit.hudOverlaps, `${dataset}/${theme}/t${tier} HUD overlaps`).toBe(0)
          expect(audit.labelOverflows, `${dataset}/${theme}/t${tier} label overflows`).toBe(0)
          expect(audit.passesMinFont, `${dataset}/${theme}/t${tier} screen font >= 11px`).toBe(true)
          expect(audit.overlapCount, `${dataset}/${theme}/t${tier} layout overlaps`).toBe(0)
          expect(audit.edgeCrossings, `${dataset}/${theme}/t${tier} layout edge crossings`).toBe(0)
          expect(
            audit.sampledEdgeNodeCrossings,
            `${dataset}/${theme}/t${tier} sampled SVG curve crossings`,
          ).toBe(0)

          if (theme === 'dark') {
            metricsLog.push({
              dataset,
              tier,
              scale,
              nodeCount: audit.nodeCount,
              passesUsed: audit.passesUsed,
              maxRadiusPx: audit.maxRadiusPx,
              bboxW: audit.bboxW,
              bboxH: audit.bboxH,
              minScreenFontPx: audit.minScreenFontPx,
            })
          }

          await page.screenshot({
            path: `${SCREENS_DIR}/${dataset}-${theme}-t${tier}.png`,
            animations: 'disabled',
          })
        }
      }
    }

    console.info(`[T3_4B_BASELINE] ${JSON.stringify(metricsLog)}`)
    expect(consoleErrors).toEqual([])
  })
})
