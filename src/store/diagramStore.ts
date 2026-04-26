import { create } from 'zustand'
import { Edge, Node, XYPosition } from '@xyflow/react'
import { getSupabaseClient } from '../lib/supabase'
import { fromLegacyERContent } from '../lib/legacyContentAdapter'
import { SaveStatus } from './saveStatus'
import { ERNodeData, ERNodeType, LogicalEdge, LogicalField, LogicalTable } from '../types'

type FieldMark = 'multi_value' | 'composite' | 'partial_dep' | 'transitive_dep'
type ERFlowNode = Node<ERNodeData>

interface DiagramStore {
  erNodes: ERFlowNode[]
  erEdges: Edge[]
  setERNodes: (nodes: ERFlowNode[]) => void
  setEREdges: (edges: Edge[]) => void
  addERNode: (type: ERNodeType, position: XYPosition) => void
  updateERNodeData: (id: string, data: Partial<ERNodeData>) => void

  logicalTables: LogicalTable[]
  logicalEdges: LogicalEdge[]
  setLogicalTables: (tables: LogicalTable[]) => void
  setLogicalEdges: (edges: LogicalEdge[]) => void
  addLogicalField: (tableId: string, afterIndex: number) => void
  deleteLogicalField: (tableId: string, fieldId: string) => void
  deleteLogicalTable: (tableId: string) => void
  moveLogicalField: (tableId: string, fromIndex: number, toIndex: number) => void
  updateFieldName: (tableId: string, fieldId: string, name: string) => void
  updateFieldMeta: (
    tableId: string,
    fieldId: string,
    meta: Partial<Pick<LogicalField, 'data_type' | 'is_not_null' | 'default_value'>>
  ) => void
  setFieldFKRef: (tableId: string, fieldId: string, refTable: string, refField: string) => void
  toggleFieldPK: (tableId: string, fieldId: string) => void
  toggleFieldFK: (tableId: string, fieldId: string, refTable?: string, refField?: string) => void
  setFieldMark: (
    tableId: string,
    fieldId: string,
    mark: FieldMark,
    value: boolean,
    extra?: Record<string, unknown>
  ) => void

  pendingNodeType: ERNodeType | null
  setPendingNodeType: (type: ERNodeType | null) => void
  selectedFieldId: string | null
  setSelectedFieldId: (id: string | null) => void
  connectingFieldId: string | null
  setConnectingFieldId: (id: string | null) => void

  saveStatus: SaveStatus
  setSaveStatus: (status: SaveStatus) => void
  shareToken: string | null
  sharePermission: 'viewer' | 'editor' | null
  setShareContext: (token: string | null, permission: 'viewer' | 'editor' | null) => void

  loadER: (diagramId: string) => Promise<void>
  saveER: (diagramId: string) => Promise<void>
  loadLogical: (diagramId: string) => Promise<void>
  saveLogical: (diagramId: string) => Promise<void>
}

const DEFAULT_NODE_SIZE = { width: 120, height: 60 }
const NODE_LABEL: Record<ERNodeType, string> = {
  entity: 'Entity',
  attribute: 'Attribute',
  relationship: 'Relationship',
  er_entity: 'ER Entity'
}

const createId = () => crypto.randomUUID()

const toInFilter = (ids: string[]) => `(${ids.map((id) => `'${id}'`).join(',')})`

const chunkArray = <T>(list: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

const deleteRowsByIdsInChunks = async (
  client: ReturnType<typeof getScopedClient>,
  table: 'er_nodes' | 'er_edges' | 'logical_tables' | 'logical_fields' | 'logical_edges',
  ids: string[],
  chunkSize = 100
) => {
  if (ids.length === 0) return

  for (const chunk of chunkArray(ids, chunkSize)) {
    const { error } = await client.from(table).delete().in('id', chunk)
    if (error) throw error
  }
}

const fetchLogicalFieldsByTableIds = async (
  client: ReturnType<typeof getScopedClient>,
  tableIds: string[]
) => {
  const result: Array<{ id: string; table_id: string }> = []
  if (tableIds.length === 0) return result

  for (const tableIdChunk of chunkArray(tableIds, 100)) {
    const { data, error } = await client
      .from('logical_fields')
      .select('id, table_id')
      .in('table_id', tableIdChunk)
    if (error) throw error
    result.push(...((data ?? []) as Array<{ id: string; table_id: string }>))
  }

  return result
}

const normalizeFieldOrder = (fields: LogicalField[]) =>
  fields.map((field, index) => ({
    ...field,
    order_index: index
  }))

const reorderPkFirst = (fields: LogicalField[]) =>
  normalizeFieldOrder([
    ...fields.filter((field) => field.is_pk),
    ...fields.filter((field) => !field.is_pk)
  ])

const castStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const POS_LIMIT = 50000

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(-POS_LIMIT, Math.min(POS_LIMIT, parsed))
}

const getScopedClient = () => {
  const { shareToken } = useDiagramStore.getState()
  return getSupabaseClient(shareToken)
}

let erMutationVersion = 0
let logicalMutationVersion = 0

const touchLogicalMutation = () => {
  logicalMutationVersion += 1
}

export const useDiagramStore = create<DiagramStore>((set, get) => ({
  erNodes: [],
  erEdges: [],
  logicalTables: [],
  logicalEdges: [],

  pendingNodeType: null,
  selectedFieldId: null,
  connectingFieldId: null,

  saveStatus: 'idle',
  shareToken: null,
  sharePermission: null,

  setERNodes: (nodes) => {
    erMutationVersion += 1
    set({ erNodes: nodes })
  },
  setEREdges: (edges) => {
    erMutationVersion += 1
    set({ erEdges: edges })
  },
  setLogicalTables: (tables) => {
    touchLogicalMutation()
    set({ logicalTables: tables, saveStatus: 'idle' })
  },
  setLogicalEdges: (edges) => {
    touchLogicalMutation()
    set({ logicalEdges: edges, saveStatus: 'idle' })
  },
  setPendingNodeType: (type) => set({ pendingNodeType: type }),
  setSelectedFieldId: (id) => set({ selectedFieldId: id }),
  setConnectingFieldId: (id) => set({ connectingFieldId: id }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setShareContext: (token, permission) => set({ shareToken: token, sharePermission: permission }),

  addERNode: (type, position) =>
    {
      erMutationVersion += 1
      set((state) => ({
        erNodes: [
          ...state.erNodes,
          {
            id: createId(),
            type,
            position,
            data: {
              label: NODE_LABEL[type],
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

  updateERNodeData: (id, data) =>
    {
      erMutationVersion += 1
      set((state) => ({
        erNodes: state.erNodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...data
                }
              }
            : node
        )
      }))
    },

  addLogicalField: (tableId, afterIndex) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table

          const insertionIndex = Math.max(0, Math.min(afterIndex + 1, table.fields.length))
          const nextFields = [...table.fields]
          nextFields.splice(insertionIndex, 0, {
            id: createId(),
            table_id: tableId,
            name: 'new_field',
            order_index: insertionIndex,
            is_pk: false,
            is_fk: false,
            is_multi_value: false,
            is_composite: false,
            composite_children: [],
            partial_dep_on: [],
            transitive_dep_via: null,
            fk_ref_table: null,
            fk_ref_field: null,
            data_type: null,
            is_not_null: false,
            default_value: null
          })

          return {
            ...table,
            fields: normalizeFieldOrder(nextFields)
          }
        })
      }))
    },

  deleteLogicalField: (tableId, fieldId) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          const nextFields = table.fields.filter((field) => field.id !== fieldId)
          return {
            ...table,
            fields: normalizeFieldOrder(nextFields)
          }
        }),
        logicalEdges: state.logicalEdges.filter(
          (edge) => edge.source_field_id !== fieldId && edge.target_field_id !== fieldId
        ),
        selectedFieldId: state.selectedFieldId === fieldId ? null : state.selectedFieldId,
        connectingFieldId: state.connectingFieldId === fieldId ? null : state.connectingFieldId
      }))
    },

  deleteLogicalTable: (tableId) =>
    {
      touchLogicalMutation()
      set((state) => {
        const targetTable = state.logicalTables.find((table) => table.id === tableId)
        const removedFieldIds = new Set(targetTable?.fields.map((field) => field.id) ?? [])
        return {
          logicalTables: state.logicalTables.filter((table) => table.id !== tableId),
          logicalEdges: state.logicalEdges.filter(
            (edge) =>
              edge.source_table_id !== tableId &&
              edge.target_table_id !== tableId &&
              !removedFieldIds.has(edge.source_field_id) &&
              !removedFieldIds.has(edge.target_field_id)
          ),
          selectedFieldId:
            state.selectedFieldId && removedFieldIds.has(state.selectedFieldId)
              ? null
              : state.selectedFieldId,
          connectingFieldId:
            state.connectingFieldId && removedFieldIds.has(state.connectingFieldId)
              ? null
              : state.connectingFieldId
        }
      })
    },

  moveLogicalField: (tableId, fromIndex, toIndex) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          if (fromIndex < 0 || fromIndex >= table.fields.length) return table
          if (toIndex < 0 || toIndex >= table.fields.length) return table
          if (fromIndex === toIndex) return table

          const nextFields = [...table.fields]
          const [moved] = nextFields.splice(fromIndex, 1)
          nextFields.splice(toIndex, 0, moved)

          return {
            ...table,
            fields: normalizeFieldOrder(nextFields)
          }
        })
      }))
    },

  updateFieldName: (tableId, fieldId, name) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          return {
            ...table,
            fields: table.fields.map((field) =>
              field.id === fieldId
                ? {
                    ...field,
                    name
                  }
                : field
            )
          }
        })
      }))
    },

  updateFieldMeta: (tableId, fieldId, meta) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          return {
            ...table,
            fields: table.fields.map((field) =>
              field.id === fieldId
                ? {
                    ...field,
                    ...meta
                  }
                : field
            )
          }
        })
      }))
    },

  setFieldFKRef: (tableId, fieldId, refTable, refField) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          return {
            ...table,
            fields: table.fields.map((field) =>
              field.id === fieldId
                ? {
                    ...field,
                    is_fk: true,
                    fk_ref_table: refTable || null,
                    fk_ref_field: refField || null
                  }
                : field
            )
          }
        })
      }))
    },

  toggleFieldPK: (tableId, fieldId) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table

          const toggled = table.fields.map((field) =>
            field.id === fieldId
              ? {
                  ...field,
                  is_pk: !field.is_pk
                }
              : field
          )

          return {
            ...table,
            fields: reorderPkFirst(toggled)
          }
        })
      }))
    },

  toggleFieldFK: (tableId, fieldId, refTable, refField) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          return {
            ...table,
            fields: table.fields.map((field) => {
              if (field.id !== fieldId) return field
              const nextIsFK = !field.is_fk
              return {
                ...field,
                is_fk: nextIsFK,
                fk_ref_table: nextIsFK ? refTable ?? field.fk_ref_table : null,
                fk_ref_field: nextIsFK ? refField ?? field.fk_ref_field : null
              }
            })
          }
        })
      }))
    },

  setFieldMark: (tableId, fieldId, mark, value, extra) =>
    {
      touchLogicalMutation()
      set((state) => ({
        logicalTables: state.logicalTables.map((table) => {
          if (table.id !== tableId) return table
          return {
            ...table,
            fields: table.fields.map((field) => {
              if (field.id !== fieldId) return field

              if (mark === 'multi_value') {
                return { ...field, is_multi_value: value }
              }

              if (mark === 'composite') {
                const children = castStringArray(extra?.composite_children ?? extra?.children)
                return {
                  ...field,
                  is_composite: value,
                  composite_children: value ? children : []
                }
              }

              if (mark === 'partial_dep') {
                const dependsOn = castStringArray(extra?.partial_dep_on ?? extra?.dependsOn)
                return {
                  ...field,
                  partial_dep_on: value ? dependsOn : []
                }
              }

              if (mark === 'transitive_dep') {
                return {
                  ...field,
                  transitive_dep_via:
                    value && typeof extra?.transitive_dep_via === 'string'
                      ? extra.transitive_dep_via
                      : value && typeof extra?.via === 'string'
                        ? extra.via
                        : null
                }
              }

              return field
            })
          }
        })
      }))
    },

  loadER: async (diagramId) => {
    const client = getScopedClient()
    const startVersion = erMutationVersion
    const [{ data: nodeRows, error: nodesError }, { data: edgeRows, error: edgesError }] =
      await Promise.all([
        client.from('er_nodes').select('*').eq('diagram_id', diagramId),
        client.from('er_edges').select('*').eq('diagram_id', diagramId)
      ])

    if (nodesError) throw nodesError
    if (edgesError) throw edgesError

    const nodes: ERFlowNode[] = (nodeRows ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      position: {
        x: row.x ?? 0,
        y: row.y ?? 0
      },
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

    const edges: Edge[] = (edgeRows ?? []).map((row) => ({
      id: row.id,
      source: row.source_id,
      target: row.target_id,
      label: row.label ?? '',
      type: 'erEdge'
    }))

    if (nodes.length === 0 && edges.length === 0) {
      const { data: diagramRow, error: diagramError } = await client
        .from('diagrams')
        .select('content')
        .eq('id', diagramId)
        .maybeSingle()

      if (!diagramError && diagramRow?.content) {
        const legacy = fromLegacyERContent(diagramRow.content)
        if (legacy) {
          set({ erNodes: legacy.nodes, erEdges: legacy.edges })
          return
        }
      }
    }

    if (erMutationVersion !== startVersion) return
    set({ erNodes: nodes, erEdges: edges })
  },

  saveER: async (diagramId) => {
    const { erNodes, erEdges } = get()
    const client = getScopedClient()
    set({ saveStatus: 'saving' })

    try {
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

      const [{ data: existingEdgeRows, error: existingEdgesError }, { data: existingNodeRows, error: existingNodesError }] =
        await Promise.all([
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

      set({ saveStatus: 'saved' })
    } catch (error) {
      console.error('[saveER] failed', error)
      set({ saveStatus: 'error' })
      throw error
    }
  },

  loadLogical: async (diagramId) => {
    const client = getScopedClient()
    const startVersion = logicalMutationVersion
    const { data: tableRows, error: tablesError } = await client
      .from('logical_tables')
      .select('*')
      .eq('diagram_id', diagramId)

    if (tablesError) throw tablesError

    const tableIds = (tableRows ?? []).map((table) => table.id)
    const [fieldsResult, edgesResult] = await Promise.all([
      tableIds.length > 0
        ? client.from('logical_fields').select('*').in('table_id', tableIds).order('order_index')
        : Promise.resolve({ data: [], error: null }),
      client.from('logical_edges').select('*').eq('diagram_id', diagramId)
    ])

    if (fieldsResult.error) throw fieldsResult.error
    if (edgesResult.error) throw edgesResult.error

    const fieldsByTable = new Map<string, LogicalField[]>()
    ;(fieldsResult.data ?? []).forEach((field) => {
      const list = fieldsByTable.get(field.table_id) ?? []
      list.push({
        ...(field as LogicalField),
        data_type: field.data_type ?? null,
        is_not_null: field.is_not_null ?? false,
        default_value: field.default_value ?? null
      })
      fieldsByTable.set(field.table_id, list)
    })

    const logicalTables: LogicalTable[] = (tableRows ?? []).map((table) => ({
      id: table.id,
      diagram_id: table.diagram_id,
      name: table.name,
      x: toFiniteNumber(table.x, 100),
      y: toFiniteNumber(table.y, 100),
      fields: reorderPkFirst(fieldsByTable.get(table.id) ?? [])
    }))

    if (logicalMutationVersion !== startVersion) return
    set({
      logicalTables,
      logicalEdges: (edgesResult.data ?? []) as LogicalEdge[]
    })
  },

  saveLogical: async (diagramId) => {
    const { logicalTables, logicalEdges } = get()
    const client = getScopedClient()
    set({ saveStatus: 'saving' })

    try {
      const tableRows = logicalTables.map((table) => ({
        id: table.id,
        diagram_id: diagramId,
        name: table.name,
        x: table.x,
        y: table.y
      }))

      const fieldRows = logicalTables.flatMap((table) =>
        normalizeFieldOrder(table.fields).map((field) => ({
          ...field,
          table_id: table.id
        }))
      )

      const edgeRows = logicalEdges.map((edge) => ({
        ...edge,
        diagram_id: diagramId
      }))

      if (tableRows.length > 0) {
        const { error } = await client
          .from('logical_tables')
          .upsert(tableRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (fieldRows.length > 0) {
        const { error } = await client
          .from('logical_fields')
          .upsert(fieldRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length > 0) {
        const { error } = await client
          .from('logical_edges')
          .upsert(edgeRows, { onConflict: 'id' })
        if (error) throw error
      }

      const [{ data: existingEdges, error: existingEdgesError }, { data: existingTables, error: existingTablesError }] =
        await Promise.all([
          client.from('logical_edges').select('id').eq('diagram_id', diagramId),
          client.from('logical_tables').select('id').eq('diagram_id', diagramId)
        ])
      if (existingEdgesError) throw existingEdgesError
      if (existingTablesError) throw existingTablesError

      const existingTableIds = (existingTables ?? []).map((row) => row.id as string)
      const existingFields = await fetchLogicalFieldsByTableIds(client, existingTableIds)

      const nextEdgeIds = new Set(edgeRows.map((edge) => edge.id))
      const nextTableIds = new Set(tableRows.map((table) => table.id))
      const nextFieldIds = new Set(fieldRows.map((field) => field.id))

      const staleEdgeIds = (existingEdges ?? [])
        .map((row) => row.id as string)
        .filter((id) => !nextEdgeIds.has(id))
      const staleTableIds = existingTableIds.filter((id) => !nextTableIds.has(id))
      const staleFieldIds = existingFields
        .map((field) => field.id)
        .filter((id) => !nextFieldIds.has(id))

      await deleteRowsByIdsInChunks(client, 'logical_edges', staleEdgeIds)
      await deleteRowsByIdsInChunks(client, 'logical_fields', staleFieldIds)
      await deleteRowsByIdsInChunks(client, 'logical_tables', staleTableIds)

      set({ saveStatus: 'saved' })
    } catch (error) {
      console.error('[saveLogical] failed', error)
      set({ saveStatus: 'error' })
      throw error
    }
  }
}))
