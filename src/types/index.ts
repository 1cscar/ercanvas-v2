export type DiagramType = 'er' | 'logical' | 'physical'

export interface Diagram {
  id: string
  user_id: string
  name: string
  type: DiagramType
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type ERNodeType = 'entity' | 'attribute' | 'relationship' | 'er_entity'

export interface ERNodeData {
  label: string
  isPrimaryKey: boolean
  fontSize: number
  fontBold: boolean
  fontUnderline: boolean
}

export interface LogicalField {
  id: string
  table_id: string
  name: string
  order_index: number
  is_pk: boolean
  is_fk: boolean
  is_multi_value: boolean
  is_composite: boolean
  composite_children: string[]
  partial_dep_on: string[]
  transitive_dep_via: string | null
  fk_ref_table: string | null
  fk_ref_field: string | null
  data_type: string | null
  is_not_null: boolean
  default_value: string | null
}

export interface LogicalTable {
  id: string
  diagram_id: string
  name: string
  x: number
  y: number
  fields: LogicalField[]
}

export interface LogicalEdge {
  id: string
  diagram_id: string
  source_table_id: string
  source_field_id: string
  target_table_id: string
  target_field_id: string
  edge_type: string
}

export type NormalizationIssueType =
  | 'MULTI_VALUE'
  | 'COMPOSITE'
  | 'PARTIAL_DEP'
  | 'TRANSITIVE_DEP'

export interface NormalizationIssue {
  type: NormalizationIssueType
  tableId: string
  tableName: string
  fieldId: string
  fieldName: string
  description: string
  suggestion: string
  dependsOn?: string[]
  via?: string
}
