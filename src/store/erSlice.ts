import type { StateCreator } from 'zustand'
import { getSupabaseClient } from '../lib/supabase'
import { fromLegacyERContent } from '../lib/legacyContentAdapter'
import { createId, deleteRowsByIdsInChunks } from './storeHelpers'
import { broadcastDiagramSave } from './broadcastChannel'
import type { DiagramStore, ERFlowNode, ERSlice } from './storeTypes'

const DEFAULT_NODE_SIZE = { width: 120, height: 60 }

const NODE_LABEL: Record<string, string> = {
  entity: 'Entity',
  attribute: 'Attribute',
  relationship: 'Relationship',
  er_entity: 'ER Entity'
}

export const createERSlice: StateCreator<DiagramStore, [], [], ERSlice> = (set, get) => ({
  erNodes: [],
  erEdges: [],
  currentERLoadController: null,

  setERNodes: (nodes) => set({ erNodes: nodes }),
  setEREdges: (edges) => set({ erEdges: edges }),

  addERNode: (type, position) => {
    set((state) => ({
      erNodes: [
        ...state.erNodes,
        {
          id: createId(),
          type,
          position,
          data: {
            label: NODE_LABEL[type] ?? type,
            isPrimaryKey: false,
            fontSize: 14,
            fontBold: false,
            fontUnderline: false
          },
          width: DEFAULT_NODE_SIZE.width,
          height: DEFAULT_NODE_SIZE.height
        }
      ]
    }))
  },

  updateERNodeData: (id, data) => {
    set((state) => ({
      erNodes: state.erNodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node
      )
    }))
  },

  loadER: async (diagramId) => {
    get().currentERLoadController?.abort()
    const controller = new AbortController()
    set({ currentERLoadController: controller, currentDiagramId: diagramId, staleDataWarning: false })
    const client = getSupabaseClient(get().shareToken)

    try {
      const [
        { data: nodeRows, error: nodesError },
        { data: edgeRows, error: edgesError },
        { data: diagramMeta, error: metaError }
      ] = await Promise.all([
        client.from('er_nodes').select('*').eq('diagram_id', diagramId).abortSignal(controller.signal),
        client.from('er_edges').select('*').eq('diagram_id', diagramId).abortSignal(controller.signal),
        client.from('diagrams').select('version, content').eq('id', diagramId).abortSignal(controller.signal).maybeSingle()
      ])

      if (controller.signal.aborted) return
      if (nodesError) throw nodesError
      if (edgesError) throw edgesError

      // Cache version for conflict detection on next save
      if (!metaError && diagramMeta != null) {
        set({ diagramVersion: diagramMeta.version ?? null })
      }

      const nodes: ERFlowNode[] = (nodeRows ?? []).map((row) => ({
        id: row.id,
        type: row.type,
        position: { x: row.x ?? 0, y: row.y ?? 0 },
        width: row.width ?? DEFAULT_NODE_SIZE.width,
        height: row.height ?? DEFAULT_NODE_SIZE.height,
        style: row.style ?? {},
        data: {
          label: row.label ?? '',
          isPrimaryKey: row.is_primary_key ?? false,
          fontSize: row.font_size ?? 14,
          fontBold: row.font_bold ?? false,
          fontUnderline: row.font_underline ?? false
        }
      }))

      const edges = (edgeRows ?? []).map((row) => ({
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        label: row.label ?? '',
        type: 'erEdge'
      }))

      if (nodes.length === 0 && edges.length === 0) {
        if (!metaError && diagramMeta?.content) {
          const legacy = fromLegacyERContent(diagramMeta.content)
          if (legacy) {
            set({ erNodes: legacy.nodes, erEdges: legacy.edges })
            // Auto-migrate: persist the converted nodes/edges to the new tables
            // so future loads skip the legacy path entirely.
            console.info('[Migration] 已自動升級舊版 ER content 格式，正在儲存至新格式…')
            void get().saveER(diagramId)
            return
          }
        }
      }

      set({ erNodes: nodes, erEdges: edges })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    }
  },

  saveER: async (diagramId) => {
    const { erNodes, erEdges, diagramVersion, shareToken } = get()
    const client = getSupabaseClient(shareToken)
    set({ saveStatus: 'saving' })

    try {
      // Version conflict check: read current DB version and compare to cached value
      if (diagramVersion !== null) {
        const { data: meta } = await client
          .from('diagrams')
          .select('version')
          .eq('id', diagramId)
          .maybeSingle()
        const dbVersion = meta?.version ?? null
        if (dbVersion !== null && dbVersion !== diagramVersion) {
          const overwrite = window.confirm(
            `此 ER 圖已被其他頁面或裝置修改（版本 ${diagramVersion} → ${dbVersion}）。\n` +
              '確定要覆寫嗎？（取消則放棄本次儲存）'
          )
          if (!overwrite) {
            set({ saveStatus: 'idle', staleDataWarning: true })
            return
          }
          // Accept remote version to avoid re-triggering the dialog next save
          set({ diagramVersion: dbVersion })
        }
      }

      const nodeRows = erNodes.map((node) => ({
        id: node.id,
        diagram_id: diagramId,
        type: node.type,
        label: node.data?.label ?? '',
        x: node.position.x,
        y: node.position.y,
        width: node.width ?? DEFAULT_NODE_SIZE.width,
        height: node.height ?? DEFAULT_NODE_SIZE.height,
        is_primary_key: node.data?.isPrimaryKey ?? false,
        font_size: node.data?.fontSize ?? 14,
        font_bold: node.data?.fontBold ?? false,
        font_underline: node.data?.fontUnderline ?? false,
        style: node.style ?? {}
      }))

      const edgeRows = erEdges.map((edge) => ({
        id: edge.id,
        diagram_id: diagramId,
        source_id: edge.source,
        target_id: edge.target,
        label: typeof edge.label === 'string' ? edge.label : ''
      }))

      if (nodeRows.length > 0) {
        const { error } = await client.from('er_nodes').upsert(nodeRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length > 0) {
        const { error } = await client.from('er_edges').upsert(edgeRows, { onConflict: 'id' })
        if (error) throw error
      }

      const [
        { data: existingEdgeRows, error: existingEdgesError },
        { data: existingNodeRows, error: existingNodesError }
      ] = await Promise.all([
        client.from('er_edges').select('id').eq('diagram_id', diagramId),
        client.from('er_nodes').select('id').eq('diagram_id', diagramId)
      ])
      if (existingEdgesError) throw existingEdgesError
      if (existingNodesError) throw existingNodesError

      const nextEdgeIds = new Set(edgeRows.map((edge) => edge.id))
      const nextNodeIds = new Set(nodeRows.map((node) => node.id))
      const staleEdgeIds = (existingEdgeRows ?? [])
        .map((row) => row.id as string)
        .filter((id) => !nextEdgeIds.has(id))
      const staleNodeIds = (existingNodeRows ?? [])
        .map((row) => row.id as string)
        .filter((id) => !nextNodeIds.has(id))

      await deleteRowsByIdsInChunks(client, 'er_edges', staleEdgeIds)
      await deleteRowsByIdsInChunks(client, 'er_nodes', staleNodeIds)

      // Refresh cached version after successful save (trigger incremented it)
      const { data: updatedMeta } = await client
        .from('diagrams')
        .select('version')
        .eq('id', diagramId)
        .maybeSingle()
      const newVersion = updatedMeta?.version ?? null
      set({ saveStatus: 'saved', diagramVersion: newVersion })

      // Notify other tabs that this diagram was saved
      broadcastDiagramSave(diagramId)
    } catch (error) {
      console.error('[saveER] failed', error)
      set({ saveStatus: 'error' })
      throw error
    }
  }
})
