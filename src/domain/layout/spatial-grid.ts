import type { PlacedMutableNode } from './types'

export const MAX_DIRTY_RECTS = 128
const GRID_MARGIN_CELLS = 14
const NEIGHBOR_DX = [-1, 0, 1, -1, 0, 1, -1, 0, 1]
const NEIGHBOR_DY = [-1, -1, -1, 0, 0, 0, 1, 1, 1]

export function createGrid(n: number) {
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
export type GridState = ReturnType<typeof createGrid>

export function writeBox(g: GridState, n: PlacedMutableNode, i: number): void {
  const hw = n.spec.width / 2,
    hh = n.spec.height / 2,
    lb = n.spec.localLabelBox
  g.x0[i] = lb ? Math.min(n.x - hw, n.x + lb.x) : n.x - hw
  g.x1[i] = lb ? Math.max(n.x + hw, n.x + lb.x + lb.width) : n.x + hw
  g.y0[i] = lb ? Math.min(n.y - hh, n.y + lb.y) : n.y - hh
  g.y1[i] = lb ? Math.max(n.y + hh, n.y + lb.y + lb.height) : n.y + hh
}

export function rebuildGrid(g: GridState, n: number): void {
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

export function collectCell(g: GridState, gx: number, gy: number, minIdx: number): void {
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

export function sortAsc(c: number[]): void {
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

export function rectsHit(
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

