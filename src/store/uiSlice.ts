import type { StateCreator } from 'zustand'
import type { DiagramStore, UISlice } from './storeTypes'

export const createUISlice: StateCreator<DiagramStore, [], [], UISlice> = (set) => ({
  pendingNodeType: null,
  selectedFieldId: null,
  connectingFieldId: null,
  saveStatus: 'idle',
  shareToken: null,
  sharePermission: null,
  diagramVersion: null,
  currentDiagramId: null,
  staleDataWarning: false,

  setPendingNodeType: (type) => set({ pendingNodeType: type }),
  setSelectedFieldId: (id) => set({ selectedFieldId: id }),
  setConnectingFieldId: (id) => set({ connectingFieldId: id }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setShareContext: (token, permission) => set({ shareToken: token, sharePermission: permission }),
  setDiagramVersion: (version) => set({ diagramVersion: version }),
  setCurrentDiagramId: (id) => set({ currentDiagramId: id }),
  setStaleDataWarning: (value) => set({ staleDataWarning: value }),
})
