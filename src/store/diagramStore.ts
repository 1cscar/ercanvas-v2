import { create } from 'zustand'
import { Edge, Node, XYPosition } from '@xyflow/react'
import { supabase } from '../lib/supabase'
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

export const useDiagramStore = create<DiagramStore>((set, get) => ({
  erNodes: [],
  erEdges: [],
  logicalTables: [],
  logicalEdges: [],

  pendingNodeType: null,
  selectedFieldId: null,
  connectingFieldId: null,

  saveStatus: 'idle',

  setERNodes: (nodes) => set({ erNodes: nodes }),
  setEREdges: (edges) => set({ erEdges: edges }),
  setLogicalTables: (tables) => set({ logicalTables: tables }),
  setLogicalEdges: (edges) => set({ logicalEdges: edges }),
  setPendingNodeType: (type) => set({ pendingNodeType: type }),
  setSelectedFieldId: (id) => set({ selectedFieldId: id }),
  setConnectingFieldId: (id) => set({ connectingFieldId: id }),
  setSaveStatus: (status) => set({ saveStatus: status }),

  addERNode: (type, position) =>
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
    })),

  updateERNodeData: (id, data) =>
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
    })),

  addLogicalField: (tableId, afterIndex) =>
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
    })),

  moveLogicalField: (tableId, fromIndex, toIndex) =>
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
    })),

  updateFieldName: (tableId, fieldId, name) =>
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
    })),

  updateFieldMeta: (tableId, fieldId, meta) =>
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
    })),

  setFieldFKRef: (tableId, fieldId, refTable, refField) =>
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
    })),

  toggleFieldPK: (tableId, fieldId) =>
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
    })),

  toggleFieldFK: (tableId, fieldId, refTable, refField) =>
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
    })),

  setFieldMark: (tableId, fieldId, mark, value, extra) =>
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
    })),

  loadER: async (diagramId) => {
    const [{ data: nodeRows, error: nodesError }, { data: edgeRows, error: edgesError }] =
      await Promise.all([
        supabase.from('er_nodes').select('*').eq('diagram_id', diagramId),
        supabase.from('er_edges').select('*').eq('diagram_id', diagramId)
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

    set({ erNodes: nodes, erEdges: edges })
  },

  saveER: async (diagramId) => {
    const { erNodes, erEdges } = get()
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
        const { error } = await supabase.from('er_nodes').upsert(nodeRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length > 0) {
        const { error } = await supabase.from('er_edges').upsert(edgeRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length === 0) {
        const { error } = await supabase.from('er_edges').delete().eq('diagram_id', diagramId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('er_edges')
          .delete()
          .eq('diagram_id', diagramId)
          .not('id', 'in', toInFilter(edgeRows.map((edge) => edge.id)))
        if (error) throw error
      }

      if (nodeRows.length === 0) {
        const { error } = await supabase.from('er_nodes').delete().eq('diagram_id', diagramId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('er_nodes')
          .delete()
          .eq('diagram_id', diagramId)
          .not('id', 'in', toInFilter(nodeRows.map((node) => node.id)))
        if (error) throw error
      }

      set({ saveStatus: 'saved' })
    } catch (error) {
      set({ saveStatus: 'error' })
      throw error
    }
  },

  loadLogical: async (diagramId) => {
    const { data: tableRows, error: tablesError } = await supabase
      .from('logical_tables')
      .select('*')
      .eq('diagram_id', diagramId)

    if (tablesError) throw tablesError

    const tableIds = (tableRows ?? []).map((table) => table.id)
    const [fieldsResult, edgesResult] = await Promise.all([
      tableIds.length > 0
        ? supabase.from('logical_fields').select('*').in('table_id', tableIds).order('order_index')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('logical_edges').select('*').eq('diagram_id', diagramId)
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
      x: table.x ?? 100,
      y: table.y ?? 100,
      fields: reorderPkFirst(fieldsByTable.get(table.id) ?? [])
    }))

    set({
      logicalTables,
      logicalEdges: (edgesResult.data ?? []) as LogicalEdge[]
    })
  },

  saveLogical: async (diagramId) => {
    const { logicalTables, logicalEdges } = get()
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
        const { error } = await supabase
          .from('logical_tables')
          .upsert(tableRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (fieldRows.length > 0) {
        const { error } = await supabase
          .from('logical_fields')
          .upsert(fieldRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length > 0) {
        const { error } = await supabase
          .from('logical_edges')
          .upsert(edgeRows, { onConflict: 'id' })
        if (error) throw error
      }

      if (edgeRows.length === 0) {
        const { error } = await supabase.from('logical_edges').delete().eq('diagram_id', diagramId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('logical_edges')
          .delete()
          .eq('diagram_id', diagramId)
          .not('id', 'in', toInFilter(edgeRows.map((edge) => edge.id)))
        if (error) throw error
      }

      if (tableRows.length === 0) {
        const { error } = await supabase.from('logical_tables').delete().eq('diagram_id', diagramId)
        if (error) throw error
      } else {
        const tableIds = tableRows.map((table) => table.id)
        const fieldIds = fieldRows.map((field) => field.id)

        if (fieldIds.length === 0) {
          const { error } = await supabase.from('logical_fields').delete().in('table_id', tableIds)
          if (error) throw error
        } else {
          const { error } = await supabase
            .from('logical_fields')
            .delete()
            .in('table_id', tableIds)
            .not('id', 'in', toInFilter(fieldIds))
          if (error) throw error
        }

        const { error } = await supabase
          .from('logical_tables')
          .delete()
          .eq('diagram_id', diagramId)
          .not('id', 'in', toInFilter(tableIds))
        if (error) throw error
      }

      set({ saveStatus: 'saved' })
    } catch (error) {
      set({ saveStatus: 'error' })
      throw error
    }
  }
}))
