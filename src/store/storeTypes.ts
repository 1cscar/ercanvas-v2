import type { Edge, Node, XYPosition } from '@xyflow/react'
import type { ERNodeData, ERNodeType, LogicalEdge, LogicalField, LogicalTable } from '../types'
import type { SaveStatus } from './saveStatus'

export type FieldMark = 'multi_value' | 'composite' | 'partial_dep' | 'transitive_dep'
export type ERFlowNode = Node<ERNodeData>

export interface UISlice {
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
  diagramVersion: number | null
  currentDiagramId: string | null
  staleDataWarning: boolean
  setDiagramVersion: (version: number | null) => void
  setCurrentDiagramId: (id: string | null) => void
  setStaleDataWarning: (value: boolean) => void
}

export interface ERSlice {
  erNodes: ERFlowNode[]
  erEdges: Edge[]
  setERNodes: (nodes: ERFlowNode[]) => void
  setEREdges: (edges: Edge[]) => void
  addERNode: (type: ERNodeType, position: XYPosition) => void
  updateERNodeData: (id: string, data: Partial<ERNodeData>) => void
  currentERLoadController: AbortController | null
  loadER: (diagramId: string) => Promise<void>
  saveER: (diagramId: string) => Promise<void>
}

export interface LogicalSlice {
  logicalTables: LogicalTable[]
  logicalEdges: LogicalEdge[]
  setLogicalTables: (tables: LogicalTable[]) => void
  setLogicalEdges: (edges: LogicalEdge[]) => void
  updateTableMeta: (tableId: string, meta: Partial<Pick<LogicalTable, 'name' | 'name_en'>>) => void
  addLogicalField: (tableId: string, afterIndex: number) => void
  deleteLogicalField: (tableId: string, fieldId: string) => void
  deleteLogicalTable: (tableId: string) => void
  moveLogicalField: (tableId: string, fromIndex: number, toIndex: number) => void
  updateFieldName: (tableId: string, fieldId: string, name: string) => void
  updateFieldMeta: (
    tableId: string,
    fieldId: string,
    meta: Partial<
      Pick<
        LogicalField,
        | 'name_en'
        | 'fk_ref_table'
        | 'fk_ref_field'
        | 'fk_ref_table_en'
        | 'fk_ref_field_en'
        | 'data_type'
        | 'is_not_null'
        | 'default_value'
      >
    >
  ) => void
  setFieldFKRef: (
    tableId: string,
    fieldId: string,
    refTable: string,
    refField: string,
    refTableEn?: string,
    refFieldEn?: string
  ) => void
  toggleFieldPK: (tableId: string, fieldId: string) => void
  toggleFieldFK: (tableId: string, fieldId: string, refTable?: string, refField?: string) => void
  setFieldMark: (
    tableId: string,
    fieldId: string,
    mark: FieldMark,
    value: boolean,
    extra?: Record<string, unknown>
  ) => void
  currentLogicalLoadController: AbortController | null
  loadLogical: (diagramId: string) => Promise<void>
  saveLogical: (diagramId: string) => Promise<void>
}

export type DiagramStore = UISlice & ERSlice & LogicalSlice
