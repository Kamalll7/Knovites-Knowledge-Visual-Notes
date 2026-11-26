import { describe, expect, it } from 'vitest'
import { VIRTUAL_ROOT_ID, buildTree } from '@/domain/tree'
import type { NodeJson } from '@/domain/schema'
import {
  buildMoveTargetOptions,
  canMoveNodeToTarget,
  collectSubtreeIdSet,
  countDescendants,
} from '@/features/map/move-target-picker'

function makeMeta(id: string, title: string, order: string): NodeJson {
  return {
    schema: 1,
    id,
    title,
    type: 'concept',
    status: 'none',
    tags: [],
    order,
    color: null,
    links: [],
    createdAt: '2026-11-26T10:00:00Z',
    updatedAt: '2026-11-26T10:00:00Z',
  }
}

describe('move-target-picker [T3.7, FR-NODE-04, FR-NODE-05]', () => {
  const idPwn = '01JC8ZQ4M7X2K9T50000000001'
  const idStack = '01JC8ZQ4M7X2K9T50000000002'
  const idRet2win = '01JC8ZQ4M7X2K9T50000000003'
  const idRe = '01JC8ZQ4M7X2K9T50000000004'

  const built = buildTree([
    { path: 'pwn', node: makeMeta(idPwn, 'PWN', 'a0'), hasCanvas: true },
    { path: 'pwn/stack', node: makeMeta(idStack, 'Stack', 'a0'), hasCanvas: true },
    { path: 'pwn/stack/ret2win', node: makeMeta(idRet2win, 'ret2win', 'a0'), hasCanvas: true },
    { path: 're', node: makeMeta(idRe, 'RE', 'a1'), hasCanvas: true },
    {
      path: 'broken',
      corrupt: true,
      corruptErrors: [{ path: 'schema', code: 'invalid_schema', message: 'bad' }],
    },
  ])
  const tree = built.state

  it('collects subtree IDs and counts descendants excluding self', () => {
    expect([...collectSubtreeIdSet(tree, idPwn)]).toEqual([idPwn, idStack, idRet2win])
    expect(countDescendants(tree, idPwn)).toBe(2)
    expect(countDescendants(tree, idStack)).toBe(1)
    expect(countDescendants(tree, idRet2win)).toBe(0)
    expect(countDescendants(tree, VIRTUAL_ROOT_ID)).toBe(0)
  })

  it('blocks moving a node into itself, its descendants, its current parent, or corrupt targets', () => {
    expect(canMoveNodeToTarget(tree, idPwn, idPwn)).toEqual({ allowed: false, reason: 'self' })
    expect(canMoveNodeToTarget(tree, idPwn, idStack)).toEqual({
      allowed: false,
      reason: 'descendant',
    })
    expect(canMoveNodeToTarget(tree, idPwn, idRet2win)).toEqual({
      allowed: false,
      reason: 'descendant',
    })
    expect(canMoveNodeToTarget(tree, idPwn, null)).toEqual({
      allowed: false,
      reason: 'same_parent',
    })
    expect(canMoveNodeToTarget(tree, idPwn, VIRTUAL_ROOT_ID)).toEqual({
      allowed: false,
      reason: 'same_parent',
    })
    expect(canMoveNodeToTarget(tree, idPwn, idRe)).toEqual({ allowed: true })

    // Child can move to Home root or another branch
    expect(canMoveNodeToTarget(tree, idStack, VIRTUAL_ROOT_ID)).toEqual({ allowed: true })
    expect(canMoveNodeToTarget(tree, idStack, idRe)).toEqual({ allowed: true })
    expect(canMoveNodeToTarget(tree, idStack, idPwn)).toEqual({
      allowed: false,
      reason: 'same_parent',
    })

    // Corrupt target is blocked
    const corruptId = Object.keys(tree.nodes).find((k) => k.includes('broken'))!
    expect(canMoveNodeToTarget(tree, idStack, corruptId)).toEqual({
      allowed: false,
      reason: 'readonly_target',
    })

    // Virtual root itself cannot be moved
    expect(canMoveNodeToTarget(tree, VIRTUAL_ROOT_ID, idRe)).toEqual({
      allowed: false,
      reason: 'virtual_root',
    })
  })

  it('builds hierarchical move target options and filters by query', () => {
    const allOptions = buildMoveTargetOptions(tree, idPwn)
    const byId = new Map(allOptions.map((o) => [o.id, o]))

    expect(byId.get(VIRTUAL_ROOT_ID)?.disabled).toBe(true)
    expect(byId.get(VIRTUAL_ROOT_ID)?.disabledReason).toBe('same_parent')
    expect(byId.get(idPwn)?.disabled).toBe(true)
    expect(byId.get(idPwn)?.disabledReason).toBe('self')
    expect(byId.get(idStack)?.disabled).toBe(true)
    expect(byId.get(idStack)?.disabledReason).toBe('descendant')
    expect(byId.get(idRet2win)?.disabled).toBe(true)
    expect(byId.get(idRet2win)?.disabledReason).toBe('descendant')
    expect(byId.get(idRe)?.disabled).toBe(false)

    const filtered = buildMoveTargetOptions(tree, idPwn, 're')
    expect(filtered.map((o) => o.id)).toEqual([idRet2win, idRe])
  })
})
