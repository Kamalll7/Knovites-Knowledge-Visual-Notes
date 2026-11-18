import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TAG_REGEX,
  ULID_REGEX,
  parseCanvasJson,
  parseKnovitesJson,
  parseNodeJson,
} from '@/domain/schema'
import { serializeCanvasJson, serializeKnovitesJson, serializeNodeJson } from '@/domain/serialize'
import {
  buildTree,
  compareSiblings,
  isValidFractionalKey,
  type TreeBuildEntry,
  type TreeState,
} from '@/domain/tree'
import {
  DEMO_DATASET,
  MANDATORY_MAP_DATASETS,
  createDemoDataset,
  generateTree,
} from '@/testing/datasets'

interface TreeShapeMetrics {
  state: TreeState
  totalNodes: number
  rootCount: number
  maxChildren: number
  maxDepth: number
  rootSubtreeSizes: number[]
}

function measureAndValidateTree(entries: readonly TreeBuildEntry[]): TreeShapeMetrics {
  const seenIds = new Set<string>()
  for (const entry of entries) {
    expect(entry.node).toBeDefined()
    const node = entry.node!
    expect(ULID_REGEX.test(node.id)).toBe(true)
    expect(seenIds.has(node.id)).toBe(false)
    seenIds.add(node.id)

    expect(isValidFractionalKey(node.order)).toBe(true)
    expect(node.title).not.toMatch(/^node-\d+$/i)
    const leafSlug = entry.path.split('/').pop()!
    expect(leafSlug).not.toMatch(/^node-\d+$/i)

    for (const tag of node.tags) {
      expect(TAG_REGEX.test(tag)).toBe(true)
    }

    const serialized = serializeNodeJson(node)
    const parsed = parseNodeJson(serialized)
    expect(parsed.status).toBe('ok')
    if (parsed.status === 'ok') {
      expect(parsed.issues).toEqual([])
    }
  }

  const built = buildTree(entries)
  expect(built.issues).toEqual([])
  expect(built.changeset.upserts).toEqual([])
  expect(built.changeset.moves).toEqual([])
  expect(built.changeset.deletes).toEqual([])

  const { state } = built
  const totalNodes = Object.keys(state.nodes).length
  expect(totalNodes).toBe(entries.length)

  // Verify unique sibling slugs and strict sibling ordering at root and every parent
  let maxChildren = 0
  const checkSiblings = (ids: readonly string[]) => {
    const slugs = new Set<string>()
    for (let i = 0; i < ids.length; i += 1) {
      const node = state.nodes[ids[i]!]!
      expect(slugs.has(node.slug)).toBe(false)
      slugs.add(node.slug)
      if (i > 0) {
        const prev = state.nodes[ids[i - 1]!]!
        expect(
          compareSiblings(
            { order: prev.meta.order, id: prev.id },
            { order: node.meta.order, id: node.id },
          ),
        ).toBeLessThan(0)
      }
    }
  }

  checkSiblings(state.rootIds)

  let maxDepth = 0
  const measureSubtree = (nodeId: string, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth)
    const node = state.nodes[nodeId]!
    maxChildren = Math.max(maxChildren, node.childrenIds.length)
    checkSiblings(node.childrenIds)
    let size = 1
    for (const childId of node.childrenIds) {
      size += measureSubtree(childId, depth + 1)
    }
    return size
  }

  const rootSubtreeSizes = state.rootIds.map((id) => measureSubtree(id, 1))

  return {
    state,
    totalNodes,
    rootCount: state.rootIds.length,
    maxChildren,
    maxDepth,
    rootSubtreeSizes,
  }
}

describe('testing/datasets [T1.4]', () => {
  it('never uses Math.random or Date.now in generator sources', () => {
    const dir = path.resolve(import.meta.dirname)
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThanOrEqual(4)
    for (const file of files) {
      const source = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(source).not.toMatch(/\bMath\.random\b/)
      expect(source).not.toMatch(/\bDate\.now\b/)
    }
  })

  it('generateTree is deterministic for identical seeds and varies across different seeds', () => {
    const runA = generateTree({ seed: 1337, nodes: 80, imbalance: 0.65 })
    const runB = generateTree({ seed: 1337, nodes: 80, imbalance: 0.65 })
    const runDifferentSeed = generateTree({ seed: 7331, nodes: 80, imbalance: 0.65 })

    expect(runA).toEqual(runB)
    expect(runA).toHaveLength(80)
    expect(runA[0]!.node!.id).not.toBe(runDifferentSeed[0]!.node!.id)
    expect(runA[0]!.path).not.toBe(runDifferentSeed[0]!.path)

    expect(generateTree({ seed: 1, nodes: 0 })).toEqual([])
    const single = generateTree({ seed: 1, nodes: 1 })
    expect(measureAndValidateTree(single).totalNodes).toBe(1)
  })

  describe('mandatory map datasets (docs/spec-map.md)', () => {
    it('unbalanced150: 150 nodes with skewed branch sizes and realistic titles', () => {
      const dataset = MANDATORY_MAP_DATASETS.unbalanced150
      expect(parseKnovitesJson(serializeKnovitesJson(dataset.manifest)).status).toBe('ok')
      const metrics = measureAndValidateTree(dataset.entries)

      expect(metrics.totalNodes).toBe(150)
      expect(metrics.maxDepth).toBeGreaterThanOrEqual(4)
      const heaviest = Math.max(...metrics.rootSubtreeSizes)
      const lightest = Math.min(...metrics.rootSubtreeSizes)
      expect(heaviest).toBeGreaterThanOrEqual(lightest * 3)
    })

    it('wide60Children: single parent node with exactly 60 direct children', () => {
      const dataset = MANDATORY_MAP_DATASETS.wide60Children
      expect(parseKnovitesJson(serializeKnovitesJson(dataset.manifest)).status).toBe('ok')
      const metrics = measureAndValidateTree(dataset.entries)

      expect(metrics.totalNodes).toBe(61)
      expect(metrics.rootCount).toBe(1)
      expect(metrics.maxChildren).toBe(60)
      expect(metrics.maxDepth).toBe(2)
    })

    it('chainDepth12: single linear chain of depth 12', () => {
      const dataset = MANDATORY_MAP_DATASETS.chainDepth12
      expect(parseKnovitesJson(serializeKnovitesJson(dataset.manifest)).status).toBe('ok')
      const metrics = measureAndValidateTree(dataset.entries)

      expect(metrics.totalNodes).toBe(12)
      expect(metrics.rootCount).toBe(1)
      expect(metrics.maxChildren).toBe(1)
      expect(metrics.maxDepth).toBe(12)
    })

    it('root20Children: virtual root with 20 top-level children', () => {
      const dataset = MANDATORY_MAP_DATASETS.root20Children
      expect(parseKnovitesJson(serializeKnovitesJson(dataset.manifest)).status).toBe('ok')
      const metrics = measureAndValidateTree(dataset.entries)

      expect(metrics.totalNodes).toBe(20)
      expect(metrics.rootCount).toBe(20)
      expect(metrics.maxChildren).toBe(0)
      expect(metrics.maxDepth).toBe(1)
    })

    it('large2000: valid 2,000-node tree with unique IDs, slugs, and zero issues', () => {
      const dataset = MANDATORY_MAP_DATASETS.large2000
      expect(parseKnovitesJson(serializeKnovitesJson(dataset.manifest)).status).toBe('ok')
      const metrics = measureAndValidateTree(dataset.entries)

      expect(metrics.totalNodes).toBe(2000)
      expect(metrics.maxDepth).toBeGreaterThanOrEqual(4)
    })
  })

  describe('demo dataset (~40 nodes, PWN/RE/CRYPTO, canvases)', () => {
    it('satisfies structure, variety, cross-links, canvases, and canonical round-trip serialization', () => {
      expect(createDemoDataset()).toEqual(DEMO_DATASET)

      const metrics = measureAndValidateTree(DEMO_DATASET.entries)
      expect(metrics.totalNodes).toBe(40)
      expect(metrics.rootCount).toBe(3)
      expect(metrics.maxDepth).toBe(3)

      const rootTitles = metrics.state.rootIds.map((id) => metrics.state.nodes[id]!.meta.title)
      expect(rootTitles).toEqual(['PWN', 'RE', 'CRYPTO'])

      // Verify all three top-level branches reach depth 3
      for (const rootId of metrics.state.rootIds) {
        const root = metrics.state.nodes[rootId]!
        expect(root.childrenIds.length).toBeGreaterThanOrEqual(3)
        const hasGrandchild = root.childrenIds.some(
          (cid) => metrics.state.nodes[cid]!.childrenIds.length >= 1,
        )
        expect(hasGrandchild).toBe(true)
      }

      // Verify type, status, tags, and cross-link diversity
      const allNodes = Object.values(metrics.state.nodes)
      const types = new Set(allNodes.map((n) => n.meta.type))
      const statuses = new Set(allNodes.map((n) => n.meta.status))
      const allLinks = allNodes.flatMap((n) => n.meta.links)

      expect(types).toEqual(new Set(['category', 'concept', 'technique', 'challenge', 'lab']))
      expect(statuses).toEqual(new Set(['none', 'learning', 'practiced', 'mastered']))
      expect(allNodes.every((n) => n.meta.tags.length >= 1)).toBe(true)
      expect(allLinks.length).toBeGreaterThanOrEqual(6)
      for (const link of allLinks) {
        expect(metrics.state.nodes[link.to]).toBeDefined()
      }

      // Verify 3-5 rich canvases with 2-3 valid text elements and zero images
      const canvasEntries = Object.entries(DEMO_DATASET.canvases)
      expect(canvasEntries.length).toBeGreaterThanOrEqual(3)
      expect(canvasEntries.length).toBeLessThanOrEqual(5)

      for (const [nodePath, canvas] of canvasEntries) {
        const treeNode = allNodes.find((n) => n.path === nodePath)
        expect(treeNode).toBeDefined()
        expect(treeNode!.hasCanvas).toBe(true)

        const elements = Object.values(canvas.elements)
        expect(elements.length).toBeGreaterThanOrEqual(2)
        expect(elements.length).toBeLessThanOrEqual(3)
        expect(elements.every((el) => el.type === 'text')).toBe(true)

        const rawCanvas = serializeCanvasJson(canvas)
        const parsedCanvas = parseCanvasJson(rawCanvas)
        expect(parsedCanvas.status).toBe('ok')
        if (parsedCanvas.status === 'ok') {
          expect(parsedCanvas.issues).toEqual([])
          expect(serializeCanvasJson(parsedCanvas.data)).toBe(rawCanvas)
        }
      }

      // Verify manifest and every node.json pass exact canonical round-trip serialization
      const rawManifest = serializeKnovitesJson(DEMO_DATASET.manifest)
      const parsedManifest = parseKnovitesJson(rawManifest)
      expect(parsedManifest.status).toBe('ok')
      if (parsedManifest.status === 'ok') {
        expect(parsedManifest.issues).toEqual([])
        expect(serializeKnovitesJson(parsedManifest.data)).toBe(rawManifest)
      }

      for (const entry of DEMO_DATASET.entries) {
        const rawNode = serializeNodeJson(entry.node!)
        const parsedNode = parseNodeJson(rawNode)
        expect(parsedNode.status).toBe('ok')
        if (parsedNode.status === 'ok') {
          expect(parsedNode.issues).toEqual([])
          expect(serializeNodeJson(parsedNode.data)).toBe(rawNode)
        }
      }
    })
  })
})
