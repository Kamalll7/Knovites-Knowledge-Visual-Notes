import {
  clipEdgeEndpointsInto,
  segmentIntersectsBox,
  segmentIntersectsRawBounds,
  type MutablePoint,
} from './edges'
import { updateCartesian } from './rings'
import {
  mergeRadialConfig,
  type BoxBounds,
  type CollisionStats,
  type PlacedMutableNode,
  type RadialGeometryDiagnostics,
  type RadialLayoutConfig,
  type RadialLayoutNode,
  type RadialLayoutResult,
} from './types'

const MAX_DIRTY_RECTS = 128
const GRID_MARGIN_CELLS = 14
const NEIGHBOR_DX = [-1, 0, 1, -1, 0, 1, -1, 0, 1]
const NEIGHBOR_DY = [-1, -1, -1, 0, 0, 0, 1, 1, 1]

/** Returns outer axis-aligned bounding box including any visible external tier-0 label. */
export function occupiedBounds(n: PlacedMutableNode): BoxBounds {
  const minX = n.x - n.spec.width / 2
  const maxX = n.x + n.spec.width / 2
  const minY = n.y - n.spec.height / 2
  const maxY = n.y + n.spec.height / 2
  const lb = n.spec.localLabelBox
  if (!lb) return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  const uMinX = Math.min(minX, n.x + lb.x)
  const uMaxX = Math.max(maxX, n.x + lb.x + lb.width)
  const uMinY = Math.min(minY, n.y + lb.y)
  const uMaxY = Math.max(maxY, n.y + lb.y + lb.height)
  return { x: uMinX, y: uMinY, width: uMaxX - uMinX, height: uMaxY - uMinY }
}

/** Outer AABB for an output `RadialLayoutNode`, including visible external tier-0 label. */
export function occupiedLayoutNodeBounds(n: RadialLayoutNode): BoxBounds {
  const minX = n.x - n.width / 2
  const maxX = n.x + n.width / 2
  const minY = n.y - n.height / 2
  const maxY = n.y + n.height / 2
  const lb = n.labelBox
  if (!lb) return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  const uMinX = Math.min(minX, lb.x)
  const uMaxX = Math.max(maxX, lb.x + lb.width)
  const uMinY = Math.min(minY, lb.y)
  const uMaxY = Math.max(maxY, lb.y + lb.height)
  return { x: uMinX, y: uMinY, width: uMaxX - uMinX, height: uMaxY - uMinY }
}

/** Computes O(n^2) node overlap and edge-crossing counts for tests and geometry audits. */
export function computeRadialGeometryDiagnostics(
  layout: RadialLayoutResult,
  configOverride?: Partial<RadialLayoutConfig>,
): RadialGeometryDiagnostics {
  const config = mergeRadialConfig(configOverride)
  const orderedNodes = layout.orderedIds
    .map((id) => layout.nodes[id])
    .filter((n): n is RadialLayoutNode => n !== undefined)
  const boxes = orderedNodes.map((n) => occupiedLayoutNodeBounds(n))
  let overlapCount = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlapWithGap(boxes[i]!, boxes[j]!, config.minGapPx)) overlapCount += 1
    }
  }
  let edgeCrossingsCount = 0
  for (const edge of layout.edges) {
    for (let i = 0; i < orderedNodes.length; i += 1) {
      const node = orderedNodes[i]!
      if (node.id === edge.sourceId || node.id === edge.targetId) continue
      if (segmentIntersectsBox(edge.sourceX, edge.sourceY, edge.targetX, edge.targetY, boxes[i]!)) {
        edgeCrossingsCount += 1
      }
    }
  }
  return { overlapCount, edgeCrossingsCount }
}

/** Checks whether two bounding boxes violate minimum gap clearance `minGapPx`. */
export function boxesOverlapWithGap(a: BoxBounds, b: BoxBounds, minGapPx: number): boolean {
  const halfGap = minGapPx / 2
  return !(
    a.x + a.width + halfGap <= b.x - halfGap ||
    b.x + b.width + halfGap <= a.x - halfGap ||
    a.y + a.height + halfGap <= b.y - halfGap ||
    b.y + b.height + halfGap <= a.y - halfGap
  )
}

function createGrid(n: number) {
  return {
    invCell: 1,
    baseCx: 0,
    baseCy: 0,
    w: 1,
    h: 1,
    cells: [] as (number[] | undefined)[],
    cellStampArr: new Uint32Array(1),
    cellStamp: 0,
    nodeSlot: new Int32Array(n),
    seenStamp: new Uint32Array(n),
    stamp: 0,
    candidates: [] as number[],
    x0: new Float64Array(n),
    y0: new Float64Array(n),
    x1: new Float64Array(n),
    y1: new Float64Array(n),
  }
}
type GridState = ReturnType<typeof createGrid>

function writeBox(g: GridState, n: PlacedMutableNode, i: number): void {
  const hw = n.spec.width / 2,
    hh = n.spec.height / 2,
    lb = n.spec.localLabelBox
  g.x0[i] = lb ? Math.min(n.x - hw, n.x + lb.x) : n.x - hw
  g.x1[i] = lb ? Math.max(n.x + hw, n.x + lb.x + lb.width) : n.x + hw
  g.y0[i] = lb ? Math.min(n.y - hh, n.y + lb.y) : n.y - hh
  g.y1[i] = lb ? Math.max(n.y + hh, n.y + lb.y + lb.height) : n.y + hh
}

function rebuildGrid(g: GridState, n: number): void {
  let minCx = Infinity,
    maxCx = -Infinity,
    minCy = Infinity,
    maxCy = -Infinity
  for (let i = 0; i < n; i += 1) {
    const cx = Math.floor((g.x0[i]! + g.x1[i]!) * 0.5 * g.invCell),
      cy = Math.floor((g.y0[i]! + g.y1[i]!) * 0.5 * g.invCell)
    minCx = Math.min(minCx, cx)
    maxCx = Math.max(maxCx, cx)
    minCy = Math.min(minCy, cy)
    maxCy = Math.max(maxCy, cy)
  }
  g.baseCx = minCx - GRID_MARGIN_CELLS
  g.baseCy = minCy - GRID_MARGIN_CELLS
  g.w = maxCx + GRID_MARGIN_CELLS - g.baseCx + 1
  g.h = maxCy + GRID_MARGIN_CELLS - g.baseCy + 1
  g.cells = new Array(g.w * g.h)
  g.cellStampArr = new Uint32Array(g.w * g.h)
  g.cellStamp = 0
  for (let i = 0; i < n; i += 1) {
    const slot =
      (Math.floor((g.y0[i]! + g.y1[i]!) * 0.5 * g.invCell) - g.baseCy) * g.w +
      (Math.floor((g.x0[i]! + g.x1[i]!) * 0.5 * g.invCell) - g.baseCx)
    g.nodeSlot[i] = slot
    ;(g.cells[slot] ?? (g.cells[slot] = [])).push(i)
  }
}

function collectCell(g: GridState, gx: number, gy: number, minIdx: number): void {
  for (let o = 0; o < 9; o += 1) {
    const nx = gx + NEIGHBOR_DX[o]!,
      ny = gy + NEIGHBOR_DY[o]!
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue
    const slot = ny * g.w + nx
    if (g.cellStampArr[slot] === g.cellStamp) continue
    g.cellStampArr[slot] = g.cellStamp
    const bucket = g.cells[slot]
    if (!bucket) continue
    for (let k = 0; k < bucket.length; k += 1) {
      const c = bucket[k]!
      if (c > minIdx && g.seenStamp[c] !== g.stamp) {
        g.seenStamp[c] = g.stamp
        g.candidates.push(c)
      }
    }
  }
}

function sortAsc(c: number[]): void {
  for (let i = 1; i < c.length; i += 1) {
    const v = c[i]!
    let j = i - 1
    while (j >= 0 && c[j]! > v) {
      c[j + 1] = c[j]!
      j -= 1
    }
    c[j + 1] = v
  }
}

function rectsHit(
  r: Float64Array,
  count: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  for (let i = 0; i < count * 4; i += 4)
    if (minX <= r[i + 2]! && maxX >= r[i]! && minY <= r[i + 3]! && maxY >= r[i + 1]!) return true
  return false
}

/** Direct 2D spatial-grid + cached-AABB + dirty-rect collision resolver preserving reference output. */
export function resolveCollisionsAndCrossings(
  rootId: string,
  placedPreOrder: readonly string[],
  childrenMap: Map<string, string[]>,
  placed: Map<string, PlacedMutableNode>,
  config: RadialLayoutConfig,
  stats?: CollisionStats,
): number {
  const n = placedPreOrder.length
  if (n === 0) {
    if (stats) stats.passesUsed = 0
    return 0
  }

  const nodes: PlacedMutableNode[] = new Array(n),
    idToIdx = new Map<string, number>(),
    g = createGrid(n)
  const { x0, y0, x1, y1 } = g
  let maxBox = 0,
    wX0 = Infinity,
    wX1 = -Infinity,
    wY0 = Infinity,
    wY1 = -Infinity
  for (let i = 0; i < n; i += 1) {
    const id = placedPreOrder[i]!,
      node = placed.get(id)!
    nodes[i] = node
    idToIdx.set(id, i)
    writeBox(g, node, i)
    maxBox = Math.max(maxBox, x1[i]! - x0[i]!, y1[i]! - y0[i]!)
    wX0 = Math.min(wX0, x0[i]!)
    wX1 = Math.max(wX1, x1[i]!)
    wY0 = Math.min(wY0, y0[i]!)
    wY1 = Math.max(wY1, y1[i]!)
  }

  const childrenIndices: number[][] = new Array(n),
    parentIndex = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i += 1) {
    const cIdx: number[] = []
    for (const cid of childrenMap.get(nodes[i]!.id) ?? []) {
      const idx = idToIdx.get(cid)
      if (idx !== undefined) {
        cIdx.push(idx)
        parentIndex[idx] = i
      }
    }
    childrenIndices[i] = cIdx
  }

  const cellSize = Math.max(
    Math.max(config.capsuleMaxWidthPx, Math.ceil(maxBox)) + config.minGapPx,
    Math.ceil(Math.max(wX1 - wX0, wY1 - wY0) / 22),
  )
  g.invCell = 1 / cellSize
  rebuildGrid(g, n)

  const prevRects = new Float64Array(MAX_DIRTY_RECTS * 4),
    currRects = new Float64Array(MAX_DIRTY_RECTS * 4)
  let prevCount = 0,
    currCount = 0,
    prevOverflow = false,
    currOverflow = false
  const nodeLastMoved = new Int32Array(n).fill(-2),
    edgeCleanPass = new Int32Array(n).fill(-2),
    overlapCleanPass = new Int32Array(n).fill(-2)
  const pushQueue: number[] = [],
    pA: MutablePoint = { x: 0, y: 0 },
    cA: MutablePoint = { x: 0, y: 0 }
  const rootIdx = idToIdx.get(rootId) ?? -1,
    minGap = config.minGapPx,
    stepR = config.staggerRadialStepPx

  const isDirty = (minX: number, minY: number, maxX: number, maxY: number): boolean =>
    prevOverflow ||
    currOverflow ||
    rectsHit(prevRects, prevCount, minX, minY, maxX, maxY) ||
    rectsHit(currRects, currCount, minX, minY, maxX, maxY)

  const pushSubtree = (rootSubIdx: number, deltaR: number, passNum: number): void => {
    let minSX = Infinity,
      minSY = Infinity,
      maxSX = -Infinity,
      maxSY = -Infinity,
      needsRebuild = false
    pushQueue.length = 0
    pushQueue.push(rootSubIdx)
    while (pushQueue.length > 0) {
      const idx = pushQueue.pop()!,
        node = nodes[idx]!
      nodeLastMoved[idx] = passNum
      minSX = Math.min(minSX, x0[idx]!)
      minSY = Math.min(minSY, y0[idx]!)
      maxSX = Math.max(maxSX, x1[idx]!)
      maxSY = Math.max(maxSY, y1[idx]!)
      node.r += deltaR
      updateCartesian(node)
      writeBox(g, node, idx)
      minSX = Math.min(minSX, x0[idx]!)
      minSY = Math.min(minSY, y0[idx]!)
      maxSX = Math.max(maxSX, x1[idx]!)
      maxSY = Math.max(maxSY, y1[idx]!)
      const gx = Math.floor((x0[idx]! + x1[idx]!) * 0.5 * g.invCell) - g.baseCx,
        gy = Math.floor((y0[idx]! + y1[idx]!) * 0.5 * g.invCell) - g.baseCy
      if (gx < 0 || gx >= g.w || gy < 0 || gy >= g.h) needsRebuild = true
      else if (!needsRebuild) {
        const newSlot = gy * g.w + gx,
          oldSlot = g.nodeSlot[idx]!
        if (newSlot !== oldSlot) {
          const oldB = g.cells[oldSlot],
            pos = oldB ? oldB.indexOf(idx) : -1
          if (oldB && pos >= 0) {
            const last = oldB.pop()!
            if (pos < oldB.length) oldB[pos] = last
          }
          ;(g.cells[newSlot] ?? (g.cells[newSlot] = [])).push(idx)
          g.nodeSlot[idx] = newSlot
        }
      }
      for (const childIdx of childrenIndices[idx]!) pushQueue.push(childIdx)
    }
    if (needsRebuild) rebuildGrid(g, n)
    if (currCount < MAX_DIRTY_RECTS) {
      const off = currCount * 4
      currRects[off] = minSX
      currRects[off + 1] = minSY
      currRects[off + 2] = maxSX
      currRects[off + 3] = maxSY
      currCount += 1
    } else currOverflow = true
  }

  let passesUsed = 0
  for (let pass = 0; pass < config.maxCollisionPasses; pass += 1) {
    let adjusted = false
    for (let i = 0; i < n; i += 1) {
      const ax0 = x0[i]!,
        ay0 = y0[i]!,
        ax1 = x1[i]!,
        ay1 = y1[i]!
      if (
        overlapCleanPass[i] === pass - 1 &&
        nodeLastMoved[i]! < pass - 1 &&
        !isDirty(ax0 - minGap, ay0 - minGap, ax1 + minGap, ay1 + minGap)
      ) {
        overlapCleanPass[i] = pass
        continue
      }
      const a = nodes[i]!
      g.stamp += 1
      g.cellStamp += 1
      g.candidates.length = 0
      collectCell(
        g,
        Math.floor((ax0 + ax1) * 0.5 * g.invCell) - g.baseCx,
        Math.floor((ay0 + ay1) * 0.5 * g.invCell) - g.baseCy,
        i,
      )
      sortAsc(g.candidates)
      for (let c = 0; c < g.candidates.length; c += 1) {
        const j = g.candidates[c]!
        if (j === rootIdx) continue
        if (stats) stats.overlapChecks += 1
        if (
          ax1 + minGap <= x0[j]! ||
          x1[j]! + minGap <= ax0 ||
          ay1 + minGap <= y0[j]! ||
          y1[j]! + minGap <= ay0
        )
          continue
        const b = nodes[j]!
        if (a.parentId !== null && a.parentId === b.parentId) {
          const pIdx = parentIndex[i]!
          if (pIdx >= 0)
            for (const sibIdx of childrenIndices[pIdx]!) pushSubtree(sibIdx, stepR, pass)
          adjusted = true
          break
        }
        const pushIsB = b.r >= a.r,
          pt = pushIsB ? b : a,
          st = pushIsB ? a : b
        const rx = Math.max(0, (ax1 - ax0 + x1[j]! - x0[j]!) / 2 + minGap - Math.abs(st.x - pt.x))
        const ry = Math.max(0, (ay1 - ay0 + y1[j]! - y0[j]!) / 2 + minGap - Math.abs(st.y - pt.y))
        pushSubtree(pushIsB ? j : i, Math.max(minGap, Math.ceil(Math.min(rx, ry)) + minGap), pass)
        adjusted = true
      }
      if (adjusted) break
      overlapCleanPass[i] = pass
    }

    for (let cIdx = 0; cIdx < n; cIdx += 1) {
      const pIdx = parentIndex[cIdx]!
      if (pIdx < 0) continue
      const child = nodes[cIdx]!,
        parent = nodes[pIdx]!
      clipEdgeEndpointsInto(parent, child, pA, cA)
      const sMinX = Math.min(pA.x, cA.x),
        sMaxX = Math.max(pA.x, cA.x),
        sMinY = Math.min(pA.y, cA.y),
        sMaxY = Math.max(pA.y, cA.y)
      if (
        edgeCleanPass[cIdx] === pass - 1 &&
        nodeLastMoved[cIdx]! < pass - 1 &&
        nodeLastMoved[pIdx]! < pass - 1 &&
        !isDirty(sMinX, sMinY, sMaxX, sMaxY)
      ) {
        edgeCleanPass[cIdx] = pass
        continue
      }
      g.stamp += 1
      g.cellStamp += 1
      g.candidates.length = 0
      let gx = Math.floor(pA.x * g.invCell) - g.baseCx,
        gy = Math.floor(pA.y * g.invCell) - g.baseCy
      const endGx = Math.floor(cA.x * g.invCell) - g.baseCx,
        endGy = Math.floor(cA.y * g.invCell) - g.baseCy
      const dx = cA.x - pA.x,
        dy = cA.y - pA.y,
        stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0,
        stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
      const tDeltaX = stepX !== 0 ? Math.abs(cellSize / dx) : Infinity,
        tDeltaY = stepY !== 0 ? Math.abs(cellSize / dy) : Infinity
      let tMaxX =
        stepX !== 0 ? ((gx + g.baseCx + (stepX > 0 ? 1 : 0)) * cellSize - pA.x) / dx : Infinity
      let tMaxY =
        stepY !== 0 ? ((gy + g.baseCy + (stepY > 0 ? 1 : 0)) * cellSize - pA.y) / dy : Infinity
      const maxSteps = Math.abs(endGx - gx) + Math.abs(endGy - gy) + 2
      for (let step = 0; step < maxSteps; step += 1) {
        collectCell(g, gx, gy, -1)
        if (gx === endGx && gy === endGy) break
        if (tMaxX <= tMaxY) {
          tMaxX += tDeltaX
          gx += stepX
        } else {
          tMaxY += tDeltaY
          gy += stepY
        }
      }
      sortAsc(g.candidates)
      let hitCrossing = false
      for (let k = 0; k < g.candidates.length; k += 1) {
        const otherIdx = g.candidates[k]!
        if (otherIdx === cIdx || otherIdx === pIdx) continue
        if (
          x0[otherIdx]! > sMaxX ||
          x1[otherIdx]! < sMinX ||
          y0[otherIdx]! > sMaxY ||
          y1[otherIdx]! < sMinY
        )
          continue
        if (stats) stats.edgeCrossChecks += 1
        if (
          !segmentIntersectsRawBounds(
            pA.x,
            pA.y,
            cA.x,
            cA.y,
            x0[otherIdx]!,
            y0[otherIdx]!,
            x1[otherIdx]!,
            y1[otherIdx]!,
          )
        )
          continue
        const other = nodes[otherIdx]!
        if (other.depth < parent.depth && pIdx !== rootIdx) pushSubtree(pIdx, stepR, pass)
        else if (other.parentId === child.parentId)
          for (const sibIdx of childrenIndices[pIdx]!) pushSubtree(sibIdx, stepR, pass)
        else if (otherIdx !== rootIdx && other.depth >= child.depth)
          pushSubtree(otherIdx, Math.max(stepR, Math.ceil(child.r - other.r) + stepR), pass)
        else pushSubtree(cIdx, stepR, pass)
        adjusted = true
        hitCrossing = true
        break
      }
      if (!hitCrossing) edgeCleanPass[cIdx] = pass
    }

    prevCount = currCount
    prevOverflow = currOverflow
    if (!currOverflow) prevRects.set(currRects.subarray(0, currCount * 4))
    currCount = 0
    currOverflow = false
    passesUsed = pass + 1
    if (!adjusted) break
  }
  if (stats) stats.passesUsed = passesUsed
  return passesUsed
}
