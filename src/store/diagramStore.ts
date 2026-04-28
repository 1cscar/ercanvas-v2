import { create } from 'zustand'
import { createUISlice } from './uiSlice'
import { createERSlice } from './erSlice'
import { createLogicalSlice } from './logicalSlice'
import { initDiagramBroadcast } from './broadcastChannel'
import type { DiagramStore } from './storeTypes'

export { type DiagramStore }

export const useDiagramStore = create<DiagramStore>((...args) => ({
  ...createUISlice(...args),
  ...createERSlice(...args),
  ...createLogicalSlice(...args)
}))

// Subscribe to save events from other tabs
initDiagramBroadcast(useDiagramStore)
