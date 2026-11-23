import { describe, expect, it } from 'vitest'

import { createDemoDataset } from '@/domain/datasets'
import {
  DEFAULT_RADIAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeRadialLayout,
  computeVisible,
  resolveScreenZoomTier,
} from '@/domain/layout'
import { buildTree } from '@/domain/tree'
import { computeMapBoundingBox } from '@/features/map/map-bounds'
import {
  MAP_FOCUS_NON_ROOT_MIN_K,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  buildTransitionStartPositions,
  clampCameraTransform,
  computeCameraForFocus,
  interpolateCamera,
  interpolateNodePositions,
  resolveViewportZoomTier,
  stepZoomCamera,
} from '@/features/map/map-camera'
import { MAP_CAPSULE_BOX_CONFIG, createCanvasTextMeasurer } from '@/features/map/map-measure'

describe('map-camera [T3.5, FR-MAP-05, FR-MAP-06, FR-MAP-08]', () => {
  const demo = createDemoDataset()
  const { state: demoTree } = buildTree([...demo.entries])
  const measurer = createCanvasTextMeasurer({ context: null })

  it('reuses resolveScreenZoomTier directly and enforces >= 11px on-screen font', () => {
    for (const scale of [0.2, 0.4, 0.5, 0.78, 0.85, 1.0, 1.5, 3.0]) {
      const expected = resolveScreenZoomTier(scale, undefined, DEFAULT_RADIAL_LAYOUT_CONFIG)
      const actual = resolveViewportZoomTier(scale)
      expect(actual).toEqual(expected)
      if (actual.labelVisible) {
        expect(actual.effectiveFontPx).toBeGreaterThanOrEqual(
          DEFAULT_RADIAL_LAYOUT_CONFIG.minScreenFontPx,
        )
      }
    }
  })

  it('frames leaf focus with parent + siblings and branch focus with focus + children inside HUD-safe bounds', () => {
    const firstBranchId = demoTree.rootIds[0]!
    const leafId = demoTree.nodes[firstBranchId]!.childrenIds[0]!
    const deepLeafId = demoTree.nodes[leafId]!.childrenIds[0] ?? leafId

    // Branch focus (has children)
    const branchVis = computeVisible({
      tree: demoTree,
      rootTitle: demo.manifest.title,
      focusId: firstBranchId,
      zoomTier: 1,
    })
    const branchLay = computeRadialLayout({
      visible: branchVis,
      measureText: measurer.measure,
      scale: 1,
      tier: 1,
      config: MAP_CAPSULE_BOX_CONFIG,
    })
    const hudInsets = { top: 64, right: 0, bottom: 0, left: 0 }
    const branchCam = computeCameraForFocus(
      branchLay,
      branchVis,
      firstBranchId,
      1280,
      720,
      'focus',
      hudInsets,
    )
    expect(branchCam.k).toBeGreaterThanOrEqual(MAP_FOCUS_NON_ROOT_MIN_K)
    expect(branchCam.k).toBeLessThanOrEqual(MAP_ZOOM_MAX)
    const focusNode = branchLay.nodes[firstBranchId]!
    const focusScreenY = focusNode.y * branchCam.k + branchCam.y
    expect(focusScreenY).toBeGreaterThan(hudInsets.top)
    expect(focusScreenY).toBeLessThan(720)

    // Leaf focus (must frame parent + siblings)
    const leafVis = computeVisible({
      tree: demoTree,
      rootTitle: demo.manifest.title,
      focusId: deepLeafId,
      zoomTier: 1,
    })
    const leafLay = computeRadialLayout({
      visible: leafVis,
      measureText: measurer.measure,
      scale: 1,
      tier: 1,
      config: MAP_CAPSULE_BOX_CONFIG,
    })
    const leafCam = computeCameraForFocus(
      leafLay,
      leafVis,
      deepLeafId,
      1280,
      720,
      'focus',
      hudInsets,
    )
    expect(leafCam.k).toBeGreaterThanOrEqual(MAP_FOCUS_NON_ROOT_MIN_K)
    const parentId = leafVis.nodes[deepLeafId]!.parentId!
    const parentNode = leafLay.nodes[parentId]!
    const parentScreenX = parentNode.x * leafCam.k + leafCam.x
    const parentScreenY = parentNode.y * leafCam.k + leafCam.y
    expect(parentScreenX).toBeGreaterThan(0)
    expect(parentScreenX).toBeLessThan(1280)
    expect(parentScreenY).toBeGreaterThan(hudInsets.top)
    expect(parentScreenY).toBeLessThan(720)

    // Fit-all frames entire map bounding box inside safe viewport
    const fitCam = computeCameraForFocus(
      branchLay,
      branchVis,
      firstBranchId,
      1280,
      720,
      'fit-all',
      hudInsets,
    )
    const bbox = computeMapBoundingBox(branchLay)
    expect(bbox.minX * fitCam.k + fitCam.x).toBeGreaterThanOrEqual(0)
    expect(bbox.maxX * fitCam.k + fitCam.x).toBeLessThanOrEqual(1280)
    expect(bbox.minY * fitCam.k + fitCam.y).toBeGreaterThanOrEqual(hudInsets.top)
    expect(bbox.maxY * fitCam.k + fitCam.y).toBeLessThanOrEqual(720)

    // Tiny viewport exercises the non-root readable minK = 0.54 floor (S3 / FR-MAP-05)
    expect(MAP_FOCUS_NON_ROOT_MIN_K).toBe(0.54)
    const tightCam = computeCameraForFocus(branchLay, branchVis, firstBranchId, 260, 200, 'focus')
    expect(tightCam.k).toBeCloseTo(0.54, 4)
  })

  it('clamps pan and zoom strictly within [0.2, 3] and keeps map reachable', () => {
    const bbox = { minX: -400, minY: -300, maxX: 400, maxY: 300, width: 800, height: 600 }
    const tooSmall = clampCameraTransform({ x: 0, y: 0, k: 0.01 }, bbox, 1280, 720)
    expect(tooSmall.k).toBe(0.2)
    expect(tooSmall.k).toBe(MAP_ZOOM_MIN)

    const tooLarge = clampCameraTransform({ x: 0, y: 0, k: 12 }, bbox, 1280, 720)
    expect(tooLarge.k).toBe(3)
    expect(tooLarge.k).toBe(MAP_ZOOM_MAX)

    const pannedWayOff = clampCameraTransform({ x: 99_999, y: -99_999, k: 1 }, bbox, 1280, 720)
    expect(bbox.minX * pannedWayOff.k + pannedWayOff.x).toBeLessThan(1280)
    expect(bbox.maxY * pannedWayOff.k + pannedWayOff.y).toBeGreaterThan(0)

    const zoomedIn = stepZoomCamera({ x: 640, y: 360, k: 1 }, 'in', 1280, 720, bbox)
    expect(zoomedIn.k).toBeGreaterThan(1)
    const zoomedOut = stepZoomCamera({ x: 640, y: 360, k: 1 }, 'out', 1280, 720, bbox)
    expect(zoomedOut.k).toBeLessThan(1)
  })

  it('interpolates focus transitions from live positions (interruptible), emerges new nodes from parent, and snaps on reduced motion', () => {
    const visA = computeVisible({
      tree: demoTree,
      rootTitle: demo.manifest.title,
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    const layA = computeRadialLayout({
      visible: visA,
      measureText: measurer.measure,
      scale: 1,
      tier: 1,
      config: MAP_CAPSULE_BOX_CONFIG,
    })
    const firstBranchId = demoTree.rootIds[0]!
    const visB = computeVisible({
      tree: demoTree,
      rootTitle: demo.manifest.title,
      focusId: firstBranchId,
      zoomTier: 1,
    })
    const layB = computeRadialLayout({
      visible: visB,
      measureText: measurer.measure,
      scale: 1,
      tier: 1,
      config: MAP_CAPSULE_BOX_CONFIG,
    })

    const livePositions = new Map(
      layA.orderedIds.map((id) => [
        id,
        { x: layA.nodes[id]!.x, y: layA.nodes[id]!.y, scale: 1, opacity: 1 },
      ]),
    )
    const starts = buildTransitionStartPositions(livePositions, layB, visB)

    // Newly revealed child of firstBranchId starts at firstBranchId's previous position
    const newChildId = visB.nodes[firstBranchId]!.visibleChildIds[0]!
    expect(livePositions.has(newChildId)).toBe(false)
    expect(starts.get(newChildId)!.x).toBeCloseTo(layA.nodes[firstBranchId]!.x, 5)
    expect(starts.get(newChildId)!.y).toBeCloseTo(layA.nodes[firstBranchId]!.y, 5)
    expect(starts.get(newChildId)!.opacity).toBe(0)

    // Mid-flight interpolation (t = 0.5) moves smoothly and allows re-targeting from live mid position
    const mid = interpolateNodePositions(starts, layB, 0.5, false)
    const midChild = mid.get(newChildId)!
    expect(midChild.opacity).toBeGreaterThan(0.5)
    expect(midChild.opacity).toBeLessThan(1)

    // Reduced motion snaps immediately at t = 0.1
    const snapped = interpolateNodePositions(starts, layB, 0.1, true)
    expect(snapped.get(newChildId)!.x).toBeCloseTo(layB.nodes[newChildId]!.x, 5)
    expect(snapped.get(newChildId)!.opacity).toBe(1)

    const camSnap = interpolateCamera({ x: 0, y: 0, k: 1 }, { x: 200, y: -100, k: 1.5 }, 0.2, true)
    expect(camSnap).toEqual({ x: 200, y: -100, k: 1.5 })
    const camMid = interpolateCamera({ x: 0, y: 0, k: 1 }, { x: 200, y: -100, k: 1.5 }, 0.5, false)
    expect(camMid.x).toBeGreaterThan(100)
    expect(camMid.x).toBeLessThan(200)
  })
})
