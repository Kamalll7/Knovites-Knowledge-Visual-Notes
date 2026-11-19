import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { WorkspaceStoreApi, WorkspaceStoreState } from '@/app/store'

export const WorkspaceStoreContext = createContext<WorkspaceStoreApi | null>(null)

export function useWorkspaceStore<U>(selector: (state: WorkspaceStoreState) => U): U {
  const store = useContext(WorkspaceStoreContext)
  if (!store) {
    throw new Error('useWorkspaceStore must be used inside WorkspaceStoreContext')
  }
  return useStore(store, selector)
}
