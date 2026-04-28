import { Edge, Node } from '@xyflow/react'
import { ERNodeData, LogicalEdge, LogicalField, LogicalTable } from '../types'

type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject =>
  typeof value === 'object' && value !== null ? (value as JsonObject) : {}

const asString = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

const asNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asBoolean = (value: unknown, fallback = false) =>
  typeof value === 'boolean' ? value : fallback

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const mapLegacyErType = (type: string) => {
  if (type === 'weak-entity') return 'er_entity'
  if (type === 'relationship') return 'relationship'
  if (type === 'attribute') return 'attribute'
  return 'entity'
}

const createField = (
  tableId: string,
  name: string,
  orderIndex: number,
  isPk: boolean,
  isFk: boolean,
  dataType: string | null,
  isNotNull: boolean
): LogicalField => ({
  id: crypto.randomUUID(),
  table_id: tableId,
  name,
  name_en: null,
  order_index: orderIndex,
  is_pk: isPk,
  is_fk: isFk,
  is_multi_value: false,
  is_composite: false,
  composite_children: [],
  partial_dep_on: [],
  transitive_dep_via: null,
  fk_ref_table: null,
  fk_ref_field: null,
  fk_ref_table_en: null,
  fk_ref_field_en: null,
  data_type: dataType,
  is_not_null: isNotNull,
  default_value: null
})

/**
 * Converts a legacy JSON `{nodes, edges}` ER diagram content blob to React Flow nodes/edges.
 *
 * @deprecated Use the normalised `er_nodes` / `er_edges` Supabase tables instead.
 * This function is only retained to migrate old diagrams that still store content in
 * the `diagrams.content` JSON column. After `loadER` successfully reads and re-saves
 * via the new tables the legacy content is no longer needed.
 */
export function fromLegacyERContent(content: unknown): {
  nodes: Array<Node<ERNodeData>>
  edges: Edge[]
} | null {
  const root = asObject(content)
  const rawNodes = asArray(root.nodes)
  const rawEdges = asArray(root.edges)

  if (rawNodes.length === 0) return null

  const idMap = new Map<string, string>()
  const nodes: Array<Node<ERNodeData>> = []

  rawNodes.forEach((item, index) => {
    const node = asObject(item)
    const legacyId = asString(node.id, `legacy_node_${index + 1}`)
    const nodeId = crypto.randomUUID()
    idMap.set(legacyId, nodeId)

    const type = mapLegacyErType(asString(node.type, 'entity'))
    const label = asString(node.label, type === 'attribute' ? `屬性${index + 1}` : `元素${index + 1}`)
    const fontUnderline = asBoolean(node.fontUnderline, false)

    nodes.push({
      id: nodeId,
      type,
      position: {
        x: asNumber(node.x, 120),
        y: asNumber(node.y, 120)
      },
      width: asNumber(node.w, 120),
      height: asNumber(node.h, 60),
      data: {
        label,
        isPrimaryKey: type === 'attribute' ? fontUnderline : false,
        fontSize: asNumber(node.fontSize, 14),
        fontBold: asString(node.fontWeight) === '700',
        fontUnderline
      }
    })
  })

  const edges: Edge[] = rawEdges.flatMap((item, index) => {
    const edge = asObject(item)
    const source = idMap.get(asString(edge.from))
    const target = idMap.get(asString(edge.to))
    if (!source || !target || source === target) return []

    return [
      {
        id: crypto.randomUUID(),
        source,
        target,
        label: asString(edge.label),
        type: 'erEdge'
      } satisfies Edge
    ]
  })

  return { nodes, edges }
}

/**
 * Converts a legacy JSON logical diagram content blob to `LogicalTable[]` / `LogicalEdge[]`.
 *
 * @deprecated This function is **not used** anywhere in the application and exists only
 * as a historical reference. If a logical migration path is ever needed, revisit this
 * function with proper validation before re-enabling it.
 */
export function fromLegacyLogicalContent(
  content: unknown,
  diagramId: string
): {
  logicalTables: LogicalTable[]
  logicalEdges: LogicalEdge[]
} | null {
  const root = asObject(content)
  const rawTables = asArray(root.tables)
  const rawLinks = asArray(root.fkLinks)
  if (rawTables.length === 0) return null

  const tableIdMap = new Map<string, string>()
  const columnIdMap = new Map<string, string>()

  const logicalTables: LogicalTable[] = rawTables.map((item, tableIndex) => {
    const table = asObject(item)
    const legacyTableId = asString(table.id, `legacy_table_${tableIndex + 1}`)
    const newTableId = crypto.randomUUID()
    tableIdMap.set(legacyTableId, newTableId)

    const rawColumns = asArray(table.columns)
    const fields: LogicalField[] = rawColumns.map((colItem, colIndex) => {
      const column = asObject(colItem)
      const legacyColumnId = asString(column.id, `legacy_col_${tableIndex + 1}_${colIndex + 1}`)
      const newFieldId = crypto.randomUUID()
      columnIdMap.set(`${legacyTableId}::${legacyColumnId}`, newFieldId)

      return {
        ...createField(
          newTableId,
          asString(column.name, `column_${colIndex + 1}`),
          colIndex,
          asBoolean(column.pk, false),
          asBoolean(column.fk, false),
          asString(column.dataType || column.type) || null,
          !asBoolean(column.nullable, true)
        ),
        id: newFieldId
      }
    })

    if (fields.length === 0) {
      fields.push(createField(newTableId, 'id', 0, true, false, 'uuid', true))
    } else if (!fields.some((field) => field.is_pk)) {
      fields[0] = { ...fields[0], is_pk: true }
    }

    return {
      id: newTableId,
      diagram_id: diagramId,
      name: asString(table.name, `table_${tableIndex + 1}`),
      name_en: null,
      x: asNumber(table.x, 100),
      y: asNumber(table.y, 100),
      fields
    }
  })

  const tableById = new Map(logicalTables.map((table) => [table.id, table]))
  const fieldById = new Map<string, LogicalField>()
  logicalTables.forEach((table) => {
    table.fields.forEach((field) => fieldById.set(field.id, field))
  })

  const logicalEdges: LogicalEdge[] = rawLinks.flatMap((item) => {
    const link = asObject(item)
    const fromLegacyTableId = asString(link.fromTableId)
    const toLegacyTableId = asString(link.toTableId)
    const fromLegacyColumnId = asString(link.fromColumnId)
    const toLegacyColumnId = asString(link.toColumnId)

    const sourceTableId = tableIdMap.get(fromLegacyTableId)
    const targetTableId = tableIdMap.get(toLegacyTableId)
    const sourceFieldId = columnIdMap.get(`${fromLegacyTableId}::${fromLegacyColumnId}`)
    const targetFieldId = columnIdMap.get(`${toLegacyTableId}::${toLegacyColumnId}`)

    if (!sourceTableId || !targetTableId || !sourceFieldId || !targetFieldId) return []
    if (sourceTableId === targetTableId && sourceFieldId === targetFieldId) return []

    const sourceField = fieldById.get(sourceFieldId)
    const targetField = fieldById.get(targetFieldId)
    const targetTable = tableById.get(targetTableId)
    if (sourceField) {
      sourceField.is_fk = true
      sourceField.fk_ref_table = targetTable?.name ?? null
      sourceField.fk_ref_field = targetField?.name ?? null
    }

    return [
      {
        id: crypto.randomUUID(),
        diagram_id: diagramId,
        source_table_id: sourceTableId,
        source_field_id: sourceFieldId,
        target_table_id: targetTableId,
        target_field_id: targetFieldId,
        edge_type: 'fk'
      } satisfies LogicalEdge
    ]
  })

  return { logicalTables, logicalEdges }
}
