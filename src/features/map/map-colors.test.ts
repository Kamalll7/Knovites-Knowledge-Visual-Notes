import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { MAP_ROOT_ID, type ComputeVisibleResult, type VisibleMapNode } from '@/domain/layout'
import {
  CAPSULE_TINT_ALPHA,
  MAP_THEME_PALETTES,
  MIN_ADJACENT_BRANCH_HUE_DEG,
  MIN_ALL_PAIRS_BRANCH_HUE_DEG,
  WCAG_AA_TEXT_CONTRAST,
  accentForDepth,
  assignMapNodeColors,
  contrastRatio,
  hueDistanceDeg,
  mixHex,
  type MapThemeMode,
} from '@/features/map/map-colors'
import { EDGE_OPACITY } from '@/features/map/map-edge-path'

function makeNode(
  partial: Partial<VisibleMapNode> & Pick<VisibleMapNode, 'id' | 'parentId' | 'title' | 'depth'>,
): VisibleMapNode {
  return {
    kind: partial.kind ?? (partial.id === MAP_ROOT_ID ? 'root' : 'node'),
    type: partial.type ?? (partial.id === MAP_ROOT_ID ? 'root' : 'concept'),
    status: partial.status ?? 'none',
    tags: partial.tags ?? [],
    order: partial.order ?? `a_${partial.id}`,
    color: partial.color ?? null,
    branchRootId: partial.branchRootId ?? (partial.depth === 1 ? partial.id : null),
    isOnFocusPath: partial.isOnFocusPath ?? partial.id === MAP_ROOT_ID,
    isFocus: partial.isFocus ?? partial.id === MAP_ROOT_ID,
    isGrandchildPreview: partial.isGrandchildPreview ?? false,
    isCollapsedWithChildren: partial.isCollapsedWithChildren ?? false,
    totalDescendants: partial.totalDescendants ?? 0,
    visibleDescendants: partial.visibleDescendants ?? 0,
    hiddenCount: partial.hiddenCount ?? 0,
    visibleChildIds: partial.visibleChildIds ?? [],
    ...partial,
  }
}

describe('map-colors [T3.4a, FR-MAP-09]', () => {
  it('calibrates WCAG 2.1 contrast ratio accurately and guarantees >= 4.5:1 across all branches x themes x tints x depths', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST)

    const themes: readonly MapThemeMode[] = ['light', 'dark']
    const tints = Object.values(CAPSULE_TINT_ALPHA)

    for (const theme of themes) {
      const palette = MAP_THEME_PALETTES[theme]
      expect(palette.branches).toHaveLength(8)

      for (const baseBranch of palette.branches) {
        for (let depth = 1; depth <= 6; depth += 1) {
          const accent = accentForDepth(baseBranch, depth, theme)
          for (const alpha of tints) {
            const fill = mixHex(accent, palette.surface, alpha)
            const ratio = contrastRatio(palette.fg, fill)
            expect(
              ratio,
              `theme=${theme} branch=${baseBranch} depth=${depth} alpha=${alpha} fill=${fill}`,
            ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST)
          }
        }
      }
    }
  })

  it('satisfies hue separation thresholds for adjacent and all branch pairs in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const branches = MAP_THEME_PALETTES[theme].branches
      for (let i = 0; i < branches.length; i += 1) {
        const next = (i + 1) % branches.length
        expect(
          hueDistanceDeg(branches[i]!, branches[next]!),
          `${theme} adjacent b${i + 1}/b${next + 1}`,
        ).toBeGreaterThanOrEqual(MIN_ADJACENT_BRANCH_HUE_DEG)
        for (let j = i + 1; j < branches.length; j += 1) {
          expect(
            hueDistanceDeg(branches[i]!, branches[j]!),
            `${theme} pair b${i + 1}/b${j + 1}`,
          ).toBeGreaterThanOrEqual(MIN_ALL_PAIRS_BRANCH_HUE_DEG)
        }
      }
    }
  })

  it('avoids adjacent sibling branch color collisions, lightens descendants, and honors node.color overrides', () => {
    const probeVisible = (id: string): ComputeVisibleResult => ({
      rootId: MAP_ROOT_ID,
      focusId: MAP_ROOT_ID,
      nodes: {
        [MAP_ROOT_ID]: makeNode({
          id: MAP_ROOT_ID,
          parentId: null,
          title: 'Root',
          depth: 0,
          visibleChildIds: [id],
        }),
        [id]: makeNode({ id, parentId: MAP_ROOT_ID, title: id, depth: 1 }),
      },
      orderedIds: [MAP_ROOT_ID, id],
      focusPathIds: new Set([MAP_ROOT_ID]),
      totalSubtreeCounts: { [MAP_ROOT_ID]: 1, [id]: 0 },
    })

    const bucket = new Map<number, string>()
    let idA = ''
    let idB = ''
    for (let i = 0; i < 100; i += 1) {
      const candidate = `branch_${i}`
      const idx = assignMapNodeColors(probeVisible(candidate), 'dark').get(candidate)!.branchIndex!
      const prev = bucket.get(idx)
      if (prev) {
        idA = prev
        idB = candidate
        break
      }
      bucket.set(idx, candidate)
    }
    expect(idA).not.toBe('')
    expect(idB).not.toBe('')

    const visible: ComputeVisibleResult = {
      rootId: MAP_ROOT_ID,
      focusId: 'child_a',
      nodes: {
        [MAP_ROOT_ID]: makeNode({
          id: MAP_ROOT_ID,
          parentId: null,
          title: 'Root',
          depth: 0,
          visibleChildIds: [idA, idB],
        }),
        [idA]: makeNode({
          id: idA,
          parentId: MAP_ROOT_ID,
          title: 'A',
          depth: 1,
          isOnFocusPath: true,
          visibleChildIds: ['child_a', 'custom_c'],
        }),
        [idB]: makeNode({ id: idB, parentId: MAP_ROOT_ID, title: 'B', depth: 1 }),
        child_a: makeNode({
          id: 'child_a',
          parentId: idA,
          title: 'Child A',
          depth: 2,
          branchRootId: idA,
          isOnFocusPath: true,
          isFocus: true,
        }),
        custom_c: makeNode({
          id: 'custom_c',
          parentId: idA,
          title: 'Custom',
          depth: 2,
          branchRootId: idA,
          color: '#e11d48',
        }),
      },
      orderedIds: [MAP_ROOT_ID, idA, idB, 'child_a', 'custom_c'],
      focusPathIds: new Set([MAP_ROOT_ID, idA, 'child_a']),
      totalSubtreeCounts: { [MAP_ROOT_ID]: 4, [idA]: 2, [idB]: 0, child_a: 0, custom_c: 0 },
    }

    const darkColors = assignMapNodeColors(visible, 'dark')
    expect(darkColors.get(idA)!.branchIndex).not.toBe(darkColors.get(idB)!.branchIndex)
    expect(darkColors.get('child_a')!.accentHex).not.toBe(darkColors.get(idA)!.accentHex)
    expect(darkColors.get('custom_c')!.accentHex).toBe('#e11d48')
    expect(darkColors.get('custom_c')!.branchIndex).toBeNull()

    // Descendant inherits branch-root custom node.color (lightened by depth) when its own color is null
    const coloredBranchVisible: ComputeVisibleResult = {
      ...visible,
      nodes: {
        ...visible.nodes,
        [idA]: { ...visible.nodes[idA]!, color: '#047857' },
      },
    }
    const inheritedColors = assignMapNodeColors(coloredBranchVisible, 'light')
    expect(inheritedColors.get(idA)!.accentHex).toBe('#047857')
    expect(inheritedColors.get('child_a')!.accentHex).toBe(accentForDepth('#047857', 2, 'light'))

    const hexByte = fc.integer({ min: 0, max: 255 }).map((v) => v.toString(16).padStart(2, '0'))
    const hexArb = fc.tuple(hexByte, hexByte, hexByte).map(([r, g, b]) => `#${r}${g}${b}`)
    fc.assert(
      fc.property(hexArb, fc.constantFrom<MapThemeMode>('light', 'dark'), (customHex, theme) => {
        const pal = MAP_THEME_PALETTES[theme]
        for (const alpha of Object.values(CAPSULE_TINT_ALPHA)) {
          expect(
            contrastRatio(pal.fg, mixHex(customHex, pal.surface, alpha)),
          ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('enforces >= 3.0:1 solid and focus (0.96) edge contrast across all 8 branches x d=1..4 in both themes and logs normal ratios [T3.5-fix]', () => {
    const summary: Record<
      MapThemeMode,
      {
        minSolid: number
        minFocus: number
        minNormal: number
        branches: Array<{
          index: number
          baseHex: string
          solidD1: number
          solidD4: number
          focusD1: number
          focusD4: number
          normalD1: number
          normalD4: number
        }>
      }
    > = {
      dark: { minSolid: Infinity, minFocus: Infinity, minNormal: Infinity, branches: [] },
      light: { minSolid: Infinity, minFocus: Infinity, minNormal: Infinity, branches: [] },
    }

    for (const theme of ['dark', 'light'] as const) {
      const pal = MAP_THEME_PALETTES[theme]
      for (let i = 0; i < pal.branches.length; i += 1) {
        const baseHex = pal.branches[i]!
        const row = {
          index: i,
          baseHex,
          solidD1: 0,
          solidD4: 0,
          focusD1: 0,
          focusD4: 0,
          normalD1: 0,
          normalD4: 0,
        }
        for (const depth of [1, 2, 3, 4]) {
          const hex = accentForDepth(baseHex, depth, theme)
          const solid = Number(contrastRatio(hex, pal.bg).toFixed(2))
          const focus = Number(
            contrastRatio(mixHex(hex, pal.bg, EDGE_OPACITY.focus), pal.bg).toFixed(2),
          )
          const normal = Number(
            contrastRatio(mixHex(hex, pal.bg, EDGE_OPACITY.normal), pal.bg).toFixed(2),
          )
          expect(
            solid,
            `${theme} branch=${i} (${baseHex}) d=${depth} solid contrast >= 3.0:1`,
          ).toBeGreaterThanOrEqual(3.0)
          expect(
            focus,
            `${theme} branch=${i} (${baseHex}) d=${depth} focus(0.96) contrast >= 3.0:1`,
          ).toBeGreaterThanOrEqual(3.0)
          expect(normal).toBeGreaterThan(1)
          summary[theme].minSolid = Math.min(summary[theme].minSolid, solid)
          summary[theme].minFocus = Math.min(summary[theme].minFocus, focus)
          summary[theme].minNormal = Math.min(summary[theme].minNormal, normal)
          if (depth === 1) {
            row.solidD1 = solid
            row.focusD1 = focus
            row.normalD1 = normal
          }
          if (depth === 4) {
            row.solidD4 = solid
            row.focusD4 = focus
            row.normalD4 = normal
          }
        }
        summary[theme].branches.push(row)
      }
    }

    expect(summary.dark.minSolid).toBeGreaterThanOrEqual(3.0)
    expect(summary.dark.minFocus).toBeGreaterThanOrEqual(3.0)
    expect(summary.light.minSolid).toBeGreaterThanOrEqual(3.0)
    expect(summary.light.minFocus).toBeGreaterThanOrEqual(3.0)
    console.info(`[T3_4C_EDGE_CONTRAST] ${JSON.stringify(summary)}`)
  })
})
