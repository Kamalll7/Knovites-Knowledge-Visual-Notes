import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HORIZONTAL_LAYOUT_CONFIG,
  MAP_ROOT_ID,
  computeHorizontalGeometryDiagnostics,
  computeHorizontalLayout,
  computeVisible,
  type ComputeVisibleResult,
  type HorizontalLayoutResult,
  type HorizontalLayoutStats,
  type TextMeasurerFn,
  type VisibleMapNode,
} from '@/domain/layout'
import { buildTree, type TreeBuildEntry } from '@/domain/tree'

const MIN_REQUIRED_GAP_PX = 12
const MIN_REQUIRED_SCREEN_FONT_PX = 11

/**
 * GOLDEN HASH UPDATE PROCEDURE (T3.3a):
 * - NEVER modify `GOLDEN_HORIZONTAL_SHA256` or `GOLDEN_WORST300_HORIZONTAL_SHA256` silently.
 * - Updating golden hashes is ONLY permitted after an approved behavioral change:
 *   1. Run manually once: `UPDATE_GOLDEN=1 pnpm vitest run src/domain/layout/horizontal-layout.test.ts -t "golden"`
 *   2. Inspect the emitted JSON map and commit the approved hashes (CI never sets `UPDATE_GOLDEN`).
 */
const GOLDEN_WORST300_HORIZONTAL_SHA256 =
  'f6590367e03af4c77b9e5d8af03be8acb203c551ac1d880ca85d26ef3ac30a1c'

const GOLDEN_HORIZONTAL_SHA256: Readonly<Record<string, string>> = {
  'unbalanced150:root:t1:s1': 'c53e659f3419886e2c663890ca9e3163a81bbea39847ccf550e79dde85fc9e7b',
  'unbalanced150:root:t2:s1': '92f5c54f119a8461ede050fa86d42c7112f9e2003a28242c09798851f8d2490b',
  'unbalanced150:root:t0:s0.85': 'c766bbfe5d974127fad3a2e4dc6bff76e30dfaaa2552fd38b5681852588a6902',
  'unbalanced150:root:t0:s0.35': '17c3f6a0485a11e1e271bec050e0e5655c8f408f67cddf7347339f9c1b1ef0cb',
  'unbalanced150:middle:t1:s1': '0dfa8ad1106d7a9f07c4d88c1f04755211f19d1977e096df453fdef16f9124dd',
  'unbalanced150:middle:t2:s1': '3871ab3db11ffc134e6f24813529945243a4924976a31f869fd99bdf7c4732f4',
  'unbalanced150:middle:t0:s0.85':
    '69a662909595df64ced5ced9c154cc731ce2434b0e6853464d257bb8503ab7eb',
  'unbalanced150:middle:t0:s0.35':
    'be7a31482647b8759a10d18f31220c51352b8617b7ac682b6b58acb5886100dd',
  'unbalanced150:leaf:t1:s1': 'dbfb2437a1249924ad54db227053ee8ec35ae15b7be94d96b6d7c14987047b60',
  'unbalanced150:leaf:t2:s1': 'e9e02774fbf3bdb156ad1b92ab47558a421ce601c7286b4f7124ad0605c2f149',
  'unbalanced150:leaf:t0:s0.85': '2dca2ee46e154077b5847e9287059b8b6b32b2204d23ce25991eccd296cec8f8',
  'unbalanced150:leaf:t0:s0.35': '30a45e3c55f776d6d8a8f9e1076daeb64c63dd416742d630527f441e5c1fd52c',
  'unbalanced150:withChildren:t1:s1':
    'f863de81c23cec8b1e6feda0d162bfcf0d416cc1b4bf48d5e82ff5b492e4af90',
  'unbalanced150:withChildren:t2:s1':
    '2380fc039c712ec7ca3d7065445288f3c7491a00ed0995012a8ebcd08f604d0e',
  'unbalanced150:withChildren:t0:s0.85':
    '527e1347d0b411eb991853e6d8d232537c9bdaa352b502a26fd41decef242b6b',
  'unbalanced150:withChildren:t0:s0.35':
    'b4ddcec699ca3a5c1c6ef8a5ce58214538ec2fe1e827d1bd4ad7424d42dcdd09',
  'wide60Children:root:t1:s1': '24d006a1a8099384caf971046008cf78e23d034dffdcbb7f075367d000a841ea',
  'wide60Children:root:t2:s1': '9e743fe8b03fc730b534ad3438122d9ff149bb12d80b2a2a0f0b8e7f12aee7b2',
  'wide60Children:root:t0:s0.85':
    '2713ebc9c9493b22a6d015ca318edc563e0da35f44c8b7481180cb37adf98f74',
  'wide60Children:root:t0:s0.35':
    'a5d41565c2715ce458412359f082db3f84513d2d3224caf542cdfe70e2cef504',
  'wide60Children:middle:t1:s1': '2d57907dffcbf60792586054bef3b9e2d2f157cda5fa6717d7c7101a9313b254',
  'wide60Children:middle:t2:s1': 'ebdd91c473111c23f8dabdfcc1e54ef0e8f96f654732d6931eaaca98db9a6257',
  'wide60Children:middle:t0:s0.85':
    '86172dac453f6c587adc1e0c34dc8708361cd02cf4e49925343d24b1965502fe',
  'wide60Children:middle:t0:s0.35':
    'a59f89dcac86d132172f1a5fd75be6fffeeb8d9b78b2950b32091adfb26b66de',
  'wide60Children:leaf:t1:s1': '7d6ae32d9474ea04793465e65dd3f2bd12aa4b262e364682a0017c95237af109',
  'wide60Children:leaf:t2:s1': 'a53259fbe83889652310f67e317207e7cf18cb29b8c71b5262e14441649344fc',
  'wide60Children:leaf:t0:s0.85':
    '02966669ccb751ada0c4595f802beb4c35edf91075ea967fc4dd1be2416028ba',
  'wide60Children:leaf:t0:s0.35':
    '3db53e1cb1f0cf53800d96dc09af9a8539172b69cf5dbd8cb0ee0bc9c11336b8',
  'wide60Children:withChildren:t1:s1':
    '7d6ae32d9474ea04793465e65dd3f2bd12aa4b262e364682a0017c95237af109',
  'wide60Children:withChildren:t2:s1':
    'a53259fbe83889652310f67e317207e7cf18cb29b8c71b5262e14441649344fc',
  'wide60Children:withChildren:t0:s0.85':
    '02966669ccb751ada0c4595f802beb4c35edf91075ea967fc4dd1be2416028ba',
  'wide60Children:withChildren:t0:s0.35':
    '3db53e1cb1f0cf53800d96dc09af9a8539172b69cf5dbd8cb0ee0bc9c11336b8',
  'chainDepth12:root:t1:s1': '93a8ff43fbec5b31a05172215a10f0b19af74918a37697f4e334648694e8cb73',
  'chainDepth12:root:t2:s1': 'aab8825e7a34b993832517e9054f047b5b9241459d08de67f535b83a454f676c',
  'chainDepth12:root:t0:s0.85': 'f297216e7499d394b07a089c5ff9767ada34738177a0f037504ab5868e33caf2',
  'chainDepth12:root:t0:s0.35': 'dc332f26b5f069d355d5f22be8fac306b14ba505cffc88233cbcb4e1b6b1813d',
  'chainDepth12:middle:t1:s1': '772277a1193e56a1ee99648e834013b59420015b571ca91d6f5b50d82b7398e2',
  'chainDepth12:middle:t2:s1': '851e40ff7c08af0496be57d0d839d6fa20ef4aa729523a4b7f35db3839c35875',
  'chainDepth12:middle:t0:s0.85':
    '91a22b5ca7c39825f8fbc573e40bef70a3f66d83c6c3662f4425b7aeef62792c',
  'chainDepth12:middle:t0:s0.35':
    '0d326b1837bdcb2a98eab1fb0210ef6bc93f386e70e9aa974cad40ffd0b2348a',
  'chainDepth12:leaf:t1:s1': '5e814084ac2a9c86f7ba474d0828d5594902efb432537b465b795aca1b8abc65',
  'chainDepth12:leaf:t2:s1': '59cf3cb5ddc030a438122bf6b2f12f89f7abe80d00a84f60b12110e6e24add45',
  'chainDepth12:leaf:t0:s0.85': 'fd4c1783ec5a0e3ca33ebbf554277cc27264a939cb6bf08d30d588f8df31a789',
  'chainDepth12:leaf:t0:s0.35': '9ff942549d545204f1057c04051c7593e6da6f67646e184a76006d11549e03c2',
  'chainDepth12:withChildren:t1:s1':
    '2a4fbc69ae7e7dc1c9d9a474a05f39401c28e94150588ac445c95b9582668026',
  'chainDepth12:withChildren:t2:s1':
    '6b42bcae1f1615f2c07975076745bde9ea228eb453265c43722a17a8291c86ab',
  'chainDepth12:withChildren:t0:s0.85':
    '456ec5e6425c95c906987d1293f1f7b7b9303d4166e4dcb7668a4bbc67ffd5d5',
  'chainDepth12:withChildren:t0:s0.35':
    'f5cb84a204d15f541523377b4f9603c88ec89e82e799fafce4a36644b494f1b7',
  'root20Children:root:t1:s1': '83daba71820db7c8165bc8a15a0d2973f9616fb2c3fd352a7d7efe7082e50d25',
  'root20Children:root:t2:s1': '456fde39bebfefaf0cf53909496928643c3fc3480d91f7a5593a9b959af7a65b',
  'root20Children:root:t0:s0.85':
    '54f1d35177234821c3f48749f472afd2eff3ccf10c423100f8beda34271a4a11',
  'root20Children:root:t0:s0.35':
    '515283b8f1162db97942d3330c26fe5662e34db06a558209ac10dce1fd6cefab',
  'root20Children:middle:t1:s1': '83daba71820db7c8165bc8a15a0d2973f9616fb2c3fd352a7d7efe7082e50d25',
  'root20Children:middle:t2:s1': '456fde39bebfefaf0cf53909496928643c3fc3480d91f7a5593a9b959af7a65b',
  'root20Children:middle:t0:s0.85':
    '54f1d35177234821c3f48749f472afd2eff3ccf10c423100f8beda34271a4a11',
  'root20Children:middle:t0:s0.35':
    '515283b8f1162db97942d3330c26fe5662e34db06a558209ac10dce1fd6cefab',
  'root20Children:leaf:t1:s1': '83daba71820db7c8165bc8a15a0d2973f9616fb2c3fd352a7d7efe7082e50d25',
  'root20Children:leaf:t2:s1': '456fde39bebfefaf0cf53909496928643c3fc3480d91f7a5593a9b959af7a65b',
  'root20Children:leaf:t0:s0.85':
    '54f1d35177234821c3f48749f472afd2eff3ccf10c423100f8beda34271a4a11',
  'root20Children:leaf:t0:s0.35':
    '515283b8f1162db97942d3330c26fe5662e34db06a558209ac10dce1fd6cefab',
  'root20Children:withChildren:t1:s1':
    '83daba71820db7c8165bc8a15a0d2973f9616fb2c3fd352a7d7efe7082e50d25',
  'root20Children:withChildren:t2:s1':
    '456fde39bebfefaf0cf53909496928643c3fc3480d91f7a5593a9b959af7a65b',
  'root20Children:withChildren:t0:s0.85':
    '54f1d35177234821c3f48749f472afd2eff3ccf10c423100f8beda34271a4a11',
  'root20Children:withChildren:t0:s0.35':
    '515283b8f1162db97942d3330c26fe5662e34db06a558209ac10dce1fd6cefab',
  'large2000:root:t1:s1': 'c62f0bfb5e9c29c4777465c39a5cc065a95bb731977c7dc3126dbfb1e1a3a59e',
  'large2000:root:t2:s1': 'a38eb276a5366034f1f6779e9fa91e345a45f4b42a7339060463fcc2ded79533',
  'large2000:root:t0:s0.85': '16177e4364bf16f7d9f1f774a4e877360272d5c1808e143976ff6054b121fe15',
  'large2000:root:t0:s0.35': '1f5eaddc96b30416c5518fdab1c684cb2c89318b28c02ca28c65ad3d99942b0b',
  'large2000:middle:t1:s1': '507fff8bfdca71b2743eeb31f6b7c56309c49cc01f6ec5f53b432ce1587cf4f2',
  'large2000:middle:t2:s1': '4a6955ccd8847b2af2bfd90ec118bc2c0a3ebd4b729a5bfcee978acce6524388',
  'large2000:middle:t0:s0.85': 'd363a604445f6a091c0ebedd05967f4d010d19a99085a9e8cff729d4bd20f4f2',
  'large2000:middle:t0:s0.35': 'a467debbf9891acd3732119d60e47d2b7fda389b1879db23623380e4104384c7',
  'large2000:leaf:t1:s1': '74a46638838ebea15333ff8c2cf6496fc54319641d5f48ed9055b200f3380ae0',
  'large2000:leaf:t2:s1': '123c5eb9325e105358122e976f4af8448bc76d54f8ea8cbcb3326b05f7d3e810',
  'large2000:leaf:t0:s0.85': 'a7f54cb27df8ad211aa49435c2482814ac72288c7fe3f036e766fda9bed58b2d',
  'large2000:leaf:t0:s0.35': '4f1cfbd1a2f9d82d439365bfdccfb2840a9e29bd77880023859926a9653c114e',
  'large2000:withChildren:t1:s1':
    '632b71419cc509953ca5799387121612b967b14ecf96dc7fd9f91ce0a260fa2c',
  'large2000:withChildren:t2:s1':
    '5959642bb9d3d7c3ac99912eedc6914b46ddea73c3e7147ca8e7f39c5bc063a0',
  'large2000:withChildren:t0:s0.85':
    'a4bce69bd7488f45157d7a0bbdf76a2c1b74da408219d624d0dbd3a657bc6312',
  'large2000:withChildren:t0:s0.35':
    '0e892a8aac0e602acf484119b43d5da766a8ce47623f9ee124d1a6b98f2dd21f',
}

const fixedWidthMeasure = (pxPerChar: number): TextMeasurerFn => {
  return (text) => text.length * pxPerChar
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function makeVisibleNode(
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
    isCollapsedWithChildren: partial.isCollapsedWithChildren ?? (partial.hiddenCount ?? 0) > 0,
    totalDescendants: partial.totalDescendants ?? 0,
    visibleDescendants: partial.visibleDescendants ?? 0,
    hiddenCount: partial.hiddenCount ?? 0,
    visibleChildIds: partial.visibleChildIds ?? [],
    ...partial,
  }
}

function buildSyntheticVisible(
  nodesList: VisibleMapNode[],
  focusId = MAP_ROOT_ID,
): ComputeVisibleResult {
  const nodes: Record<string, VisibleMapNode> = {}
  const childMap = new Map<string, string[]>()
  for (const n of nodesList) {
    nodes[n.id] = n
    if (n.parentId) {
      const list = childMap.get(n.parentId) ?? []
      list.push(n.id)
      childMap.set(n.parentId, list)
    }
  }
  for (const [parentId, ids] of childMap.entries()) {
    const parent = nodes[parentId]
    if (parent && parent.visibleChildIds.length === 0) {
      nodes[parentId] = { ...parent, visibleChildIds: ids }
    }
  }
  const totalSubtreeCounts: Record<string, number> = {}
  for (const n of nodesList) {
    totalSubtreeCounts[n.id] = n.totalDescendants
  }
  return {
    rootId: MAP_ROOT_ID,
    focusId,
    nodes,
    orderedIds: nodesList.map((n) => n.id),
    focusPathIds: new Set(nodesList.filter((n) => n.isOnFocusPath).map((n) => n.id)),
    totalSubtreeCounts,
  }
}

function buildWorstCaseVisible(maxVisibleNodes = 300): ComputeVisibleResult {
  const worstEntries: TreeBuildEntry[] = []
  let seq = 0
  const addNode = (id: string, parentPath: string | null, title: string): string => {
    seq += 1
    const path = parentPath ? `${parentPath}/${id}` : id
    worstEntries.push({
      node: {
        schema: 1,
        id,
        title,
        type: 'concept',
        status: 'none',
        tags: [],
        order: `k${String(seq).padStart(5, '0')}`,
        color: null,
        links: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      path,
    })
    return path
  }
  let parentPath: string | null = null
  for (let d = 0; d < 6; d += 1) {
    const chainId = `chain_${d}`
    const nextChainPath = addNode(chainId, parentPath, `Hierarchy Backbone Concept ${d} Long`)
    for (let s = 0; s < 24; s += 1) {
      addNode(`sib_${d}_${s}`, parentPath, `Ancestor Sibling Branch ${d}-${s} Expanded`)
    }
    parentPath = nextChainPath
  }
  for (let c = 0; c < 24; c += 1) {
    const cid = `fc_${c}`
    const cPath = addNode(cid, parentPath, `Primary Focus Child ${c} Extended Label`)
    for (let g = 0; g < 6; g += 1) {
      addNode(`fg_${c}_${g}`, cPath, `Grandchild Detail Item ${c}-${g} Label`)
    }
  }
  const { state: worstTree } = buildTree(worstEntries)
  return computeVisible({
    tree: worstTree,
    rootTitle: 'Worst Case 300 Root',
    focusId: 'chain_5',
    zoomTier: 2,
    config: { maxVisibleNodes },
  })
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Set || obj instanceof Map) return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    deepFreeze((obj as Record<string, unknown>)[key])
  }
  return obj
}

function getLayoutExtent(layout: HorizontalLayoutResult): { bboxW: number; bboxH: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const id of layout.orderedIds) {
    const n = layout.nodes[id]!
    minX = Math.min(minX, n.x - n.width / 2, n.labelBox ? n.labelBox.x : Infinity)
    maxX = Math.max(
      maxX,
      n.x + n.width / 2,
      n.labelBox ? n.labelBox.x + n.labelBox.width : -Infinity,
    )
    minY = Math.min(minY, n.y - n.height / 2, n.labelBox ? n.labelBox.y : Infinity)
    maxY = Math.max(
      maxY,
      n.y + n.height / 2,
      n.labelBox ? n.labelBox.y + n.labelBox.height : -Infinity,
    )
  }
  return {
    bboxW: Math.round(maxX - minX),
    bboxH: Math.round(maxY - minY),
  }
}

function assertHorizontalInvariants(
  layout: HorizontalLayoutResult,
  visible: ComputeVisibleResult,
): void {
  const ids = layout.orderedIds
  expect(ids.length).toBe(Object.keys(layout.nodes).length)
  expect(layout.diagnostics.nodeCount).toBe(ids.length)
  expect(layout.diagnostics.edgeCount).toBe(layout.edges.length)

  if (ids.length === 0) return

  const root = layout.nodes[layout.rootId]
  expect(root).toBeDefined()
  expect(root!.x).toBe(0)
  expect(root!.y).toBe(0)

  for (const id of ids) {
    const n = layout.nodes[id]!
    expect(Number.isFinite(n.x)).toBe(true)
    expect(Number.isFinite(n.y)).toBe(true)
    expect(Number.isFinite(n.width)).toBe(true)
    expect(Number.isFinite(n.height)).toBe(true)
    if (n.labelVisible) {
      expect(n.effectiveFontPx).toBeGreaterThanOrEqual(MIN_REQUIRED_SCREEN_FONT_PX)
    } else {
      expect(n.labelBox).toBeNull()
    }
  }

  const columnX = new Map<number, number>()
  const childrenByParent = new Map<string, string[]>()
  for (const id of ids) {
    const n = layout.nodes[id]!
    const existingX = columnX.get(n.columnIndex)
    if (existingX === undefined) {
      columnX.set(n.columnIndex, n.x)
    } else {
      expect(n.x).toBeCloseTo(existingX, 6)
    }
    if (n.parentId !== null && layout.nodes[n.parentId]) {
      const list = childrenByParent.get(n.parentId) ?? []
      list.push(id)
      childrenByParent.set(n.parentId, list)
    }
  }

  for (let c = 1; c < layout.diagnostics.columnCount; c += 1) {
    expect(columnX.get(c)! - columnX.get(c - 1)!).toBeGreaterThanOrEqual(
      DEFAULT_HORIZONTAL_LAYOUT_CONFIG.columnGapPx,
    )
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = layout.nodes[parentId]!
    const firstChild = layout.nodes[children[0]!]!
    const lastChild = layout.nodes[children[children.length - 1]!]!
    expect(parent.y).toBeCloseTo((firstChild.y + lastChild.y) / 2, 6)
    expect(parent.y).toBeGreaterThanOrEqual(firstChild.y - 1e-6)
    expect(parent.y).toBeLessThanOrEqual(lastChild.y + 1e-6)
    for (let i = 1; i < children.length; i += 1) {
      const prev = layout.nodes[children[i - 1]!]!
      const curr = layout.nodes[children[i]!]!
      expect(curr.y).toBeGreaterThan(prev.y)
    }
  }

  for (const edge of layout.edges) {
    const src = layout.nodes[edge.sourceId]!
    const dst = layout.nodes[edge.targetId]!
    expect(edge.sourceX).toBeCloseTo(src.x + src.width / 2, 6)
    expect(edge.sourceY).toBeCloseTo(src.y, 6)
    expect(edge.targetX).toBeCloseTo(dst.x - dst.width / 2, 6)
    expect(edge.targetY).toBeCloseTo(dst.y, 6)
    expect(edge.targetX - edge.sourceX).toBeGreaterThanOrEqual(MIN_REQUIRED_GAP_PX - 1e-6)
    expect(edge.sourceFanCount).toBe(childrenByParent.get(edge.sourceId)!.length)
    expect(edge.fadeSourceBase).toBe(
      edge.sourceFanCount >= DEFAULT_HORIZONTAL_LAYOUT_CONFIG.wideFanFadeThreshold,
    )
  }

  expect(visible.nodes[layout.rootId]).toBeDefined()
  expect(
    computeHorizontalGeometryDiagnostics(layout, { minGapPx: MIN_REQUIRED_GAP_PX }).overlapCount,
  ).toBe(0)
}

describe('computeHorizontalLayout (FR-MAP-04)', () => {
  it('matches golden SHA-256 hashes across all 5 mandatory datasets, focuses, tiers, and scales', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasets = Object.values(createMandatoryDatasets())
    expect(datasets).toHaveLength(5)

    const captured: Record<string, string> = {}
    let checked = 0

    for (const ds of datasets) {
      const { state: tree } = buildTree(ds.entries)
      const middleId = ds.entries[Math.floor(ds.entries.length / 2)]?.node?.id ?? MAP_ROOT_ID
      let leafId = ds.entries[ds.entries.length - 1]?.node?.id ?? MAP_ROOT_ID
      for (const e of ds.entries) {
        const id = e.node?.id
        if (id && (tree.nodes[id]?.childrenIds.length ?? 0) === 0) {
          leafId = id
          break
        }
      }
      let withChildrenId = MAP_ROOT_ID
      let maxChildren = 0
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxChildren) {
          maxChildren = n.childrenIds.length
          withChildrenId = n.id
        }
      }

      const focuses = {
        root: MAP_ROOT_ID,
        middle: middleId,
        leaf: leafId,
        withChildren: withChildrenId,
      }
      for (const [focusKind, focusId] of Object.entries(focuses)) {
        for (const [scale, tier] of [
          [1, 1] as const,
          [1, 2] as const,
          [0.85, 0] as const,
          [0.35, 0] as const,
        ]) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId,
            zoomTier: tier,
          })
          const layout = computeHorizontalLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          const geom = computeHorizontalGeometryDiagnostics(layout)
          const key = `${ds.id}:${focusKind}:t${tier}:s${scale}`
          const hash = await sha256Hex(JSON.stringify({ layout, geom }))
          captured[key] = hash
          if (process.env.UPDATE_GOLDEN !== '1' || process.env.CI) {
            expect(hash, `golden hash mismatch for ${key}`).toBe(GOLDEN_HORIZONTAL_SHA256[key])
          }
          checked += 1
        }
      }
    }
    expect(checked).toBe(80)

    const worstVisible = buildWorstCaseVisible(300)
    const worstLayout = computeHorizontalLayout({
      visible: worstVisible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 2,
    })
    const worstHash = await sha256Hex(JSON.stringify(worstLayout))

    if (process.env.UPDATE_GOLDEN === '1' && !process.env.CI) {
      console.info(`[UPDATE_GOLDEN_HORIZONTAL] worst=${worstHash}`)
      console.info(`[UPDATE_GOLDEN_HORIZONTAL_MAP] ${JSON.stringify(captured)}`)
      return
    }
    expect(worstHash).toBe(GOLDEN_WORST300_HORIZONTAL_SHA256)
  })

  it('allocates proportional vertical band height by visible descendants and centers every parent on children (b, f)', () => {
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 'a', parentId: MAP_ROOT_ID, title: 'Leaf A', depth: 1, order: 'a1' }),
      makeVisibleNode({ id: 'b', parentId: MAP_ROOT_ID, title: 'Leaf B', depth: 1, order: 'a2' }),
      makeVisibleNode({ id: 'c', parentId: MAP_ROOT_ID, title: 'Branch C', depth: 1, order: 'a3' }),
      makeVisibleNode({ id: 'c1', parentId: 'c', title: 'Sub C1', depth: 2, order: 'b1' }),
      makeVisibleNode({ id: 'c2', parentId: 'c', title: 'Sub C2', depth: 2, order: 'b2' }),
      makeVisibleNode({ id: 'c3', parentId: 'c', title: 'Sub C3', depth: 2, order: 'b3' }),
      makeVisibleNode({ id: 'c4', parentId: 'c', title: 'Sub C4', depth: 2, order: 'b4' }),
    ])

    const layout = computeHorizontalLayout({
      visible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })

    const leafA = layout.nodes.a!
    const leafB = layout.nodes.b!
    const branchC = layout.nodes.c!
    const root = layout.nodes[MAP_ROOT_ID]!
    const c1 = layout.nodes.c1!
    const c4 = layout.nodes.c4!

    expect(leafA.bandHeightPx).toBe(40)
    expect(leafB.bandHeightPx).toBe(40)
    // Branch C has 4 leaves (40px each) + 3 * 12px gaps = 196px
    expect(branchC.bandHeightPx).toBe(196)
    expect(leafB.y - leafA.y).toBe(40 + MIN_REQUIRED_GAP_PX)
    expect(branchC.y - leafB.y).toBe(20 + MIN_REQUIRED_GAP_PX + 196 / 2)
    expect(branchC.y).toBeCloseTo((c1.y + c4.y) / 2, 6)
    expect(root.y).toBe(0)
    expect(root.y).toBeCloseTo((leafA.y + branchC.y) / 2, 6)
    // Notice (leafA.y + branchC.y) / 2 = 0 forces leafA.y = -branchC.y = -91, b.y = -39, c.y = +91
    expect(leafA.y).toBe(-91)
    expect(leafB.y).toBe(-39)
    expect(branchC.y).toBe(91)

    // Single-child deep chain also expands proportional to visibleDescendants (12px per visible descendant)
    const chainVisible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({
        id: 'd1',
        parentId: MAP_ROOT_ID,
        title: 'Leaf Sibling',
        depth: 1,
        order: 'a1',
      }),
      makeVisibleNode({
        id: 'd2',
        parentId: MAP_ROOT_ID,
        title: 'Deep Chain',
        depth: 1,
        order: 'a2',
      }),
      makeVisibleNode({ id: 'd2_1', parentId: 'd2', title: 'Step 1', depth: 2, order: 'b1' }),
      makeVisibleNode({ id: 'd2_2', parentId: 'd2_1', title: 'Step 2', depth: 3, order: 'c1' }),
      makeVisibleNode({ id: 'd2_3', parentId: 'd2_2', title: 'Step 3', depth: 4, order: 'd1' }),
    ])
    const chainLayout = computeHorizontalLayout({
      visible: chainVisible,
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })
    expect(chainLayout.nodes.d2!.visibleDescendants).toBe(3)
    expect(chainLayout.nodes.d2!.bandHeightPx).toBe(40 + 3 * 12)
    expect(chainLayout.nodes.d2!.bandHeightPx).toBeGreaterThan(chainLayout.nodes.d1!.bandHeightPx)
    assertHorizontalInvariants(layout, visible)
    assertHorizontalInvariants(chainLayout, chainVisible)
  })

  it('derives node width and column x positions from injected measureText without leading truncation (c)', () => {
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({
        id: 'wide',
        parentId: MAP_ROOT_ID,
        title: 'Moderate Column Title',
        depth: 1,
        order: 'a1',
      }),
      makeVisibleNode({
        id: 'overflow',
        parentId: 'wide',
        title: 'Extremely Long Node Title Beyond Maximum Capsule Limit',
        depth: 2,
        order: 'b1',
      }),
    ])

    const narrowMeasure = computeHorizontalLayout({
      visible,
      measureText: fixedWidthMeasure(5),
      scale: 1,
      tier: 1,
    })
    const wideMeasure = computeHorizontalLayout({
      visible,
      measureText: fixedWidthMeasure(10),
      scale: 1,
      tier: 1,
    })

    expect(wideMeasure.nodes.wide!.width).toBeGreaterThan(narrowMeasure.nodes.wide!.width)
    expect(wideMeasure.nodes.wide!.width).toBeGreaterThanOrEqual(
      DEFAULT_HORIZONTAL_LAYOUT_CONFIG.capsuleMinWidthPx,
    )
    expect(wideMeasure.nodes.wide!.width).toBeLessThanOrEqual(
      DEFAULT_HORIZONTAL_LAYOUT_CONFIG.capsuleMaxWidthPx,
    )
    expect(wideMeasure.nodes.overflow!.isTruncated).toBe(true)
    expect(wideMeasure.nodes.overflow!.displayTitle.startsWith('Extremely Long')).toBe(true)
    expect(wideMeasure.nodes.overflow!.displayTitle.endsWith('…')).toBe(true)

    // Exact column center equation from measureText widths + columnGapPx
    const expectedCol1X =
      narrowMeasure.nodes[MAP_ROOT_ID]!.width / 2 +
      DEFAULT_HORIZONTAL_LAYOUT_CONFIG.columnGapPx +
      narrowMeasure.nodes.wide!.width / 2
    expect(narrowMeasure.nodes.wide!.x).toBeCloseTo(expectedCol1X, 6)
    expect(wideMeasure.nodes.overflow!.x).toBeGreaterThan(narrowMeasure.nodes.overflow!.x)
  })

  it('sorts siblings strictly by compareSiblings order independent of input order (d)', () => {
    const baseNodes: VisibleMapNode[] = [
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 's3', parentId: MAP_ROOT_ID, title: 'Third', depth: 1, order: 'c' }),
      makeVisibleNode({ id: 's1', parentId: MAP_ROOT_ID, title: 'First', depth: 1, order: 'a' }),
      makeVisibleNode({ id: 's2', parentId: MAP_ROOT_ID, title: 'Second', depth: 1, order: 'b' }),
    ]
    const reversedNodes: VisibleMapNode[] = [
      baseNodes[0]!,
      baseNodes[1]!,
      baseNodes[3]!,
      baseNodes[2]!,
    ]

    const layoutA = computeHorizontalLayout({
      visible: buildSyntheticVisible(baseNodes),
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })
    const layoutB = computeHorizontalLayout({
      visible: {
        ...buildSyntheticVisible(reversedNodes),
        orderedIds: [MAP_ROOT_ID, 's3', 's2', 's1'],
      },
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })

    expect(layoutA.orderedIds).toEqual([MAP_ROOT_ID, 's1', 's2', 's3'])
    expect(layoutA.nodes.s1!.y).toBeLessThan(layoutA.nodes.s2!.y)
    expect(layoutA.nodes.s2!.y).toBeLessThan(layoutA.nodes.s3!.y)
    expect(layoutB).toEqual(layoutA)
  })

  it('enforces exact right/left edge anchors and minimum horizontal and vertical clearances (a, e, g)', () => {
    const visible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root Hub', depth: 0 }),
      makeVisibleNode({
        id: 'n1',
        parentId: MAP_ROOT_ID,
        title: 'Alpha Topic',
        depth: 1,
        order: 'a1',
      }),
      makeVisibleNode({
        id: 'n2',
        parentId: MAP_ROOT_ID,
        title: 'Beta Topic',
        depth: 1,
        order: 'a2',
      }),
      makeVisibleNode({
        id: 'n2b',
        parentId: MAP_ROOT_ID,
        title: 'Gamma Leaf',
        depth: 1,
        order: 'a3',
      }),
      makeVisibleNode({ id: 'n3', parentId: 'n1', title: 'Child Item', depth: 2, order: 'b1' }),
    ])

    for (const [scale, tier] of [[1, 1] as const, [1, 2] as const, [0.85, 0] as const]) {
      const layout = computeHorizontalLayout({
        visible,
        measureText: fixedWidthMeasure(7.5),
        scale,
        tier,
      })
      assertHorizontalInvariants(layout, visible)
      const n2 = layout.nodes.n2!
      const n2b = layout.nodes.n2b!
      const leafBoxGapY = n2b.y - n2b.height / 2 - (n2.y + n2.height / 2)
      expect(leafBoxGapY).toBeGreaterThanOrEqual(MIN_REQUIRED_GAP_PX)
      expect(
        computeHorizontalGeometryDiagnostics(layout, { minGapPx: MIN_REQUIRED_GAP_PX })
          .overlapCount,
      ).toBe(0)
    }
  })

  it('marks wide-fan edge base fading cleanly at >= 12 visible siblings for renderer support', () => {
    const makeFan = (count: number) =>
      buildSyntheticVisible([
        makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
        ...Array.from({ length: count }, (_, i) =>
          makeVisibleNode({
            id: `child_${i}`,
            parentId: MAP_ROOT_ID,
            title: `Child ${i}`,
            depth: 1,
            order: `k_${String(i).padStart(3, '0')}`,
          }),
        ),
      ])

    const elevenLayout = computeHorizontalLayout({
      visible: makeFan(11),
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })
    expect(elevenLayout.edges).toHaveLength(11)
    expect(elevenLayout.edges.every((e) => e.sourceFanCount === 11 && !e.fadeSourceBase)).toBe(true)

    const twelveLayout = computeHorizontalLayout({
      visible: makeFan(12),
      measureText: fixedWidthMeasure(7.5),
      scale: 1,
      tier: 1,
    })
    expect(twelveLayout.edges).toHaveLength(12)
    expect(twelveLayout.edges.every((e) => e.sourceFanCount === 12 && e.fadeSourceBase)).toBe(true)
  })

  it('handles empty visible maps, missing roots, invalid scales, and tiny sub-11px scales cleanly', () => {
    const emptyVisible: ComputeVisibleResult = {
      rootId: MAP_ROOT_ID,
      focusId: MAP_ROOT_ID,
      nodes: {},
      orderedIds: [],
      focusPathIds: new Set(),
      totalSubtreeCounts: {},
    }
    const emptyLayout = computeHorizontalLayout({
      visible: emptyVisible,
      measureText: fixedWidthMeasure(7.5),
      scale: Number.NaN,
    })
    expect(emptyLayout.orderedIds).toEqual([])
    expect(emptyLayout.scale).toBe(1)
    expect(emptyLayout.diagnostics.columnCount).toBe(0)

    const tinyVisible = buildSyntheticVisible([
      makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
      makeVisibleNode({ id: 'a', parentId: MAP_ROOT_ID, title: 'Hidden At Tiny Scale', depth: 1 }),
    ])
    const tinyLayout = computeHorizontalLayout({
      visible: tinyVisible,
      measureText: fixedWidthMeasure(7.5),
      scale: 0.35,
    })
    expect(tinyLayout.tier).toBe(0)
    expect(tinyLayout.diagnostics.hiddenLabelCount).toBe(2)
    expect(tinyLayout.diagnostics.minEffectiveFontPx).toBe(0)
    assertHorizontalInvariants(tinyLayout, tinyVisible)
  })

  it('validates all 5 mandatory datasets across focuses and tiers with 0 overlaps and logs extents', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const datasets = Object.values(createMandatoryDatasets())
    const extents: Array<Record<string, number | string>> = []

    for (const ds of datasets) {
      const { state: tree } = buildTree(ds.entries)
      let withChildrenId = MAP_ROOT_ID
      let maxChildren = 0
      for (const n of Object.values(tree.nodes)) {
        if (n.childrenIds.length > maxChildren) {
          maxChildren = n.childrenIds.length
          withChildrenId = n.id
        }
      }
      const focusTargets =
        ds.id === 'wide60Children' ? [MAP_ROOT_ID, withChildrenId] : [MAP_ROOT_ID]

      for (const focusId of focusTargets) {
        const tiers: Array<readonly [number, 0 | 1 | 2]> = [
          [1, 1],
          [1, 2],
          [0.85, 0],
          [0.35, 0],
        ]
        for (const [scale, tier] of tiers) {
          const visible = computeVisible({
            tree,
            rootTitle: ds.manifest.title,
            focusId,
            zoomTier: tier,
            config:
              ds.id === 'wide60Children' && focusId === withChildrenId
                ? { maxVisibleNodes: 100 }
                : undefined,
          })
          const layout = computeHorizontalLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          assertHorizontalInvariants(layout, visible)
          const ext = getLayoutExtent(layout)
          extents.push({
            dataset: ds.id,
            focus: focusId === MAP_ROOT_ID ? 'root' : 'withChildren',
            tier: layout.tier,
            scale: layout.scale,
            visibleNodes: layout.diagnostics.nodeCount,
            columns: layout.diagnostics.columnCount,
            bboxW: ext.bboxW,
            bboxH: ext.bboxH,
          })
        }
      }
    }

    console.info(`[T3_3A_EXTENT] ${JSON.stringify(extents)}`)
  })

  it('enforces O(n) operation-count bounds in CI and benchmarks large2000 & worstCase300 (< 30 ms)', async () => {
    const { createMandatoryDatasets } = await import('@/domain/datasets')
    const { large2000 } = createMandatoryDatasets()
    const { state: largeTree } = buildTree(large2000.entries)
    const largeDeepFocus = large2000.entries[large2000.entries.length - 1]?.node?.id ?? MAP_ROOT_ID

    const largeRootVisible = computeVisible({
      tree: largeTree,
      rootTitle: large2000.manifest.title,
      focusId: MAP_ROOT_ID,
      zoomTier: 1,
    })
    const largeDeepVisible = computeVisible({
      tree: largeTree,
      rootTitle: large2000.manifest.title,
      focusId: largeDeepFocus,
      zoomTier: 2,
    })
    const worstVisible = buildWorstCaseVisible(300)

    for (const [tier, visible] of [
      [1, largeRootVisible] as const,
      [2, largeDeepVisible] as const,
      [2, worstVisible] as const,
    ]) {
      const stats: HorizontalLayoutStats = { nodesVisited: 0, edgeAnchorsComputed: 0 }
      const layout = computeHorizontalLayout({
        visible,
        measureText: fixedWidthMeasure(7.5),
        scale: 1,
        tier,
        stats,
      })
      expect(stats.nodesVisited).toBeLessThanOrEqual(2 * layout.diagnostics.nodeCount)
      expect(stats.edgeAnchorsComputed).toBe(layout.diagnostics.edgeCount)
      expect(computeHorizontalGeometryDiagnostics(layout).overlapCount).toBe(0)
    }

    const measurePerf = (name: string, visible: ComputeVisibleResult, tier: 1 | 2) => {
      for (let i = 0; i < 5; i += 1) {
        computeHorizontalLayout({ visible, measureText: fixedWidthMeasure(7.5), scale: 1, tier })
      }
      const samples: number[] = []
      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now()
        computeHorizontalLayout({ visible, measureText: fixedWidthMeasure(7.5), scale: 1, tier })
        samples.push(performance.now() - t0)
      }
      samples.sort((a, b) => a - b)
      return {
        name,
        visibleCount: visible.orderedIds.length,
        medianMs: Number(samples[Math.floor(samples.length / 2)]!.toFixed(3)),
        p95Ms: Number(
          samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!.toFixed(3),
        ),
        maxMs: Number(samples[samples.length - 1]!.toFixed(3)),
      }
    }

    const pRoot = measurePerf('large2000_root', largeRootVisible, 1)
    const pDeep = measurePerf('large2000_deep', largeDeepVisible, 2)
    const pWorst = measurePerf('worstCase300', worstVisible, 2)
    console.info(`[T3_3A_PERF_PROFILE] ${JSON.stringify({ pRoot, pDeep, pWorst })}`)

    if (process.env.KNOVITES_PERF === '1' && !process.env.CI) {
      expect(pDeep.medianMs).toBeLessThan(30)
      expect(pWorst.medianMs).toBeLessThan(30)
    }
  })

  it('satisfies horizontal layout, permutation invariance, and immutability under fast-check trees', () => {
    const nodeGenArb = fc.record({
      parentIdx: fc.nat(),
      title: fc.string({ minLength: 1, maxLength: 32 }),
      order: fc.string({ minLength: 1, maxLength: 6 }),
      hiddenCount: fc.nat({ max: 25 }),
    })

    fc.assert(
      fc.property(
        fc.array(nodeGenArb, { minLength: 1, maxLength: 45 }),
        fc.constantFrom(0.35, 0.85, 1, 1.3),
        fc.constantFrom<0 | 1 | 2>(0, 1, 2),
        (specs, scale, tier) => {
          const nodes: VisibleMapNode[] = [
            makeVisibleNode({ id: MAP_ROOT_ID, parentId: null, title: 'Root', depth: 0 }),
          ]
          for (let i = 0; i < specs.length; i += 1) {
            const spec = specs[i]!
            const parent = nodes[spec.parentIdx % nodes.length]!
            nodes.push(
              makeVisibleNode({
                id: `n_${i}`,
                parentId: parent.id,
                title: spec.title,
                depth: parent.depth + 1,
                order: `${spec.order}_${i}`,
                hiddenCount: spec.hiddenCount,
                totalDescendants: spec.hiddenCount,
              }),
            )
          }

          const visible = deepFreeze(buildSyntheticVisible(nodes))
          const layout = computeHorizontalLayout({
            visible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          assertHorizontalInvariants(layout, visible)

          const shuffled = [...nodes].reverse()
          const shuffledVisible: ComputeVisibleResult = {
            ...buildSyntheticVisible(shuffled),
            orderedIds: [...visible.orderedIds].reverse(),
          }
          const permutedLayout = computeHorizontalLayout({
            visible: shuffledVisible,
            measureText: fixedWidthMeasure(7.5),
            scale,
            tier,
          })
          expect(permutedLayout).toEqual(layout)
        },
      ),
      { numRuns: 100 },
    )
  })
})
