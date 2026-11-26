import { useEffect } from 'react'
import { VIRTUAL_ROOT_ID, type TreeState } from '@/domain/tree'
import type { MapEdgeOrientation } from '@/features/map/map-edge-path'

export type MapKeyboardCommand =
  | { readonly type: 'focus'; readonly nodeId: string }
  | { readonly type: 'open'; readonly nodeId: string }
  | { readonly type: 'none' }

/**
 * Returns true when keyboard focus is inside a text input, editable area, or modal dialog
 * so map navigation shortcuts never hijack user typing (`FR-MAP-07`).
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
    return true
  }
  return (
    target.closest(
      '[contenteditable="true"], [role="textbox"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  )
}

/**
 * Pure keyboard navigation reducer (`FR-MAP-07`):
 * - Radial: ArrowLeft/Right = prev/next sibling, ArrowDown = first child, ArrowUp = parent
 * - Horizontal: ArrowUp/Down = prev/next sibling, ArrowRight = first child, ArrowLeft = parent
 * - Enter = open focused node (or Home for `'__root__'`)
 * - Escape = move focus to parent (towards root `'__root__'`)
 */
export function resolveMapKeyboardCommand({
  key,
  tree,
  focusId,
  orientation,
  hasModKey = false,
}: {
  readonly key: string
  readonly tree: TreeState
  readonly focusId: string
  readonly orientation: MapEdgeOrientation
  readonly hasModKey?: boolean
}): MapKeyboardCommand {
  if (hasModKey) return { type: 'none' }

  const isRoot = focusId === VIRTUAL_ROOT_ID
  const currentNode = isRoot ? undefined : tree.nodes[focusId]
  const effectiveFocusId = isRoot || currentNode ? focusId : VIRTUAL_ROOT_ID

  if (key === 'Enter') {
    return { type: 'open', nodeId: effectiveFocusId }
  }

  const parentId =
    effectiveFocusId === VIRTUAL_ROOT_ID
      ? null
      : (tree.nodes[effectiveFocusId]?.parentId ?? VIRTUAL_ROOT_ID)

  if (key === 'Escape') {
    return parentId !== null ? { type: 'focus', nodeId: parentId } : { type: 'none' }
  }

  const childrenIds =
    effectiveFocusId === VIRTUAL_ROOT_ID
      ? tree.rootIds
      : (tree.nodes[effectiveFocusId]?.childrenIds ?? [])

  const siblingIds =
    effectiveFocusId === VIRTUAL_ROOT_ID
      ? []
      : tree.nodes[effectiveFocusId]?.parentId === null
        ? tree.rootIds
        : (tree.nodes[tree.nodes[effectiveFocusId]!.parentId!]?.childrenIds ?? [])

  const siblingIndex = siblingIds.indexOf(effectiveFocusId)

  const goParent = (): MapKeyboardCommand =>
    parentId !== null ? { type: 'focus', nodeId: parentId } : { type: 'none' }
  const goFirstChild = (): MapKeyboardCommand =>
    childrenIds.length > 0 ? { type: 'focus', nodeId: childrenIds[0]! } : { type: 'none' }
  const goPrevSibling = (): MapKeyboardCommand =>
    siblingIndex > 0 ? { type: 'focus', nodeId: siblingIds[siblingIndex - 1]! } : { type: 'none' }
  const goNextSibling = (): MapKeyboardCommand =>
    siblingIndex >= 0 && siblingIndex < siblingIds.length - 1
      ? { type: 'focus', nodeId: siblingIds[siblingIndex + 1]! }
      : { type: 'none' }

  if (orientation === 'horizontal') {
    if (key === 'ArrowLeft') return goParent()
    if (key === 'ArrowRight') return goFirstChild()
    if (key === 'ArrowUp') return goPrevSibling()
    if (key === 'ArrowDown') return goNextSibling()
    return { type: 'none' }
  }

  if (key === 'ArrowUp') return goParent()
  if (key === 'ArrowDown') return goFirstChild()
  if (key === 'ArrowLeft') return goPrevSibling()
  if (key === 'ArrowRight') return goNextSibling()
  return { type: 'none' }
}

export interface UseMapKeyboardOptions {
  readonly tree: TreeState
  readonly focusId: string
  readonly orientation: MapEdgeOrientation
  readonly disabled?: boolean
  readonly onFocusNode: (nodeId: string) => void
  readonly onOpenNode: (nodeId: string) => void
  readonly onKeyboardNavigate?: () => void
}

/**
 * Registers accessible map keyboard navigation shortcuts on `window` (`FR-MAP-07`),
 * skipping events inside inputs, textareas, contenteditables, buttons/links (for Enter), or dialogs.
 */
export function useMapKeyboard({
  tree,
  focusId,
  orientation,
  disabled = false,
  onFocusNode,
  onOpenNode,
  onKeyboardNavigate,
}: UseMapKeyboardOptions): void {
  useEffect(() => {
    if (disabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isTextInputTarget(event.target)) return

      // Let focused interactive controls (buttons/links) handle their own Enter activation naturally
      if (
        event.key === 'Enter' &&
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'BUTTON' || event.target.tagName === 'A')
      ) {
        return
      }

      const cmd = resolveMapKeyboardCommand({
        key: event.key,
        tree,
        focusId,
        orientation,
        hasModKey: event.ctrlKey || event.metaKey || event.altKey,
      })
      if (cmd.type === 'none') return

      event.preventDefault()
      if (cmd.type === 'focus') {
        onKeyboardNavigate?.()
        onFocusNode(cmd.nodeId)
      } else {
        onOpenNode(cmd.nodeId)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, focusId, onFocusNode, onKeyboardNavigate, onOpenNode, orientation, tree])
}
