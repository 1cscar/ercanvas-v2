import { Edge, Node } from '@xyflow/react'
import { ERNodeData, LogicalEdge, LogicalField, LogicalTable } from '../types'
import { ERVisionResult, LogicalVisionResult } from './VisionService'

const DEFAULT_FONT_SIZE = 14

const sanitizeText = (value: unknown, fallback: string) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const normalizeNameKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

const getUniqueName = (name: string, counts: Map<string, number>) => {
  const count = counts.get(name) ?? 0
  counts.set(name, count + 1)
  if (count === 0) return name
  return `${name}_${count + 1}`
}

const createLogicalField = (
  tableId: string,
  name: string,
  orderIndex: number,
  isPK: boolean,
  isFK: boolean
): LogicalField => ({
  id: crypto.randomUUID(),
  table_id: tableId,
  name,
  name_en: null,
  order_index: orderIndex,
  is_pk: isPK,
  is_fk: isFK,
  is_multi_value: false,
  is_composite: false,
  composite_children: [],
  partial_dep_on: [],
  transitive_dep_via: null,
  fk_ref_table: null,
  fk_ref_field: null,
  fk_ref_table_en: null,
  fk_ref_field_en: null,
  data_type: null,
  is_not_null: false,
  default_value: null
})

export function buildERCanvasFromVision(result: ERVisionResult): {
  nodes: Array<Node<ERNodeData>>
  edges: Edge[]
} {
  if (result.entities.length === 0) {
    return { nodes: [], edges: [] }
  }

  const nodes: Array<Node<ERNodeData>> = []
  const edges: Edge[] = []
  const entityNodeIdByVisionId = new Map<string, string>()
  const entityPositionByNodeId = new Map<string, { x: number; y: number }>()
  const entityColumns = Math.max(1, Math.ceil(Math.sqrt(result.entities.length)))

  result.entities.forEach((entity, index) => {
    const nodeId = crypto.randomUUID()
    const x = 180 + (index % entityColumns) * 420
    const y = 140 + Math.floor(index / entityColumns) * 320
    const entityName = sanitizeText(entity.name, `實體${index + 1}`)

    entityNodeIdByVisionId.set(entity.id, nodeId)
    entityPositionByNodeId.set(nodeId, { x, y })

    nodes.push({
      id: nodeId,
      type: 'entity',
      position: { x, y },
      width: 140,
      height: 60,
      data: {
        label: entityName,
        isPrimaryKey: false,
        fontSize: DEFAULT_FONT_SIZE,
        fontBold: false,
        fontUnderline: false
      }
    })
  })

  const fallbackEntityId = result.entities[0]?.id ?? ''
  const attributesByEntityId = new Map<string, ERVisionResult['attributes']>()

  result.attributes.forEach((attribute) => {
    const mappedEntityId = entityNodeIdByVisionId.has(attribute.entityId) ? attribute.entityId : fallbackEntityId
    if (!mappedEntityId) return
    const current = attributesByEntityId.get(mappedEntityId) ?? []
    current.push(attribute)
    attributesByEntityId.set(mappedEntityId, current)
  })

  attributesByEntityId.forEach((attributes, entityVisionId) => {
    const entityNodeId = entityNodeIdByVisionId.get(entityVisionId)
    if (!entityNodeId) return
    const anchor = entityPositionByNodeId.get(entityNodeId)
    if (!anchor) return

    attributes.forEach((attribute, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, attributes.length)
      const radiusX = 230
      const radiusY = 150
      const attrNodeId = crypto.randomUUID()
      const x = anchor.x + Math.cos(angle) * radiusX
      const y = anchor.y + Math.sin(angle) * radiusY
      const attributeName = sanitizeText(attribute.name, `屬性${index + 1}`)

      nodes.push({
        id: attrNodeId,
        type: 'attribute',
        position: { x, y },
        width: 140,
        height: 60,
        data: {
          label: attributeName,
          isPrimaryKey: attribute.isPrimaryKey,
          fontSize: DEFAULT_FONT_SIZE,
          fontBold: false,
          fontUnderline: attribute.isPrimaryKey
        }
      })

      edges.push({
        id: crypto.randomUUID(),
        source: attrNodeId,
        target: entityNodeId,
        type: 'erEdge'
      })
    })
  })

  const relationshipRowY =
    240 + Math.ceil(result.entities.length / entityColumns) * 330

  result.relationships.forEach((relationship, index) => {
    const connectedEntityNodeIds = relationship.connectedEntityIds
      .map((entityVisionId) => entityNodeIdByVisionId.get(entityVisionId))
      .filter((nodeId): nodeId is string => Boolean(nodeId))

    if (connectedEntityNodeIds.length === 0) return

    const relationshipNodeId = crypto.randomUUID()
    const relationshipName = sanitizeText(relationship.name, `關係${index + 1}`)
    const connectedPositions = connectedEntityNodeIds
      .map((nodeId) => entityPositionByNodeId.get(nodeId))
      .filter((position): position is { x: number; y: number } => Boolean(position))

    const averageX =
      connectedPositions.reduce((sum, position) => sum + position.x, 0) /
      Math.max(1, connectedPositions.length)
    const averageY =
      connectedPositions.reduce((sum, position) => sum + position.y, 0) /
      Math.max(1, connectedPositions.length)

    const x =
      connectedPositions.length > 0
        ? averageX + ((index % 2 === 0 ? -1 : 1) * 28)
        : 200 + (index % entityColumns) * 360
    const y =
      connectedPositions.length > 0
        ? averageY + 110 + Math.floor(index / 2) * 18
        : relationshipRowY + Math.floor(index / entityColumns) * 200

    nodes.push({
      id: relationshipNodeId,
      type: 'relationship',
      position: { x, y },
      width: 120,
      height: 60,
      data: {
        label: relationshipName,
        isPrimaryKey: false,
        fontSize: DEFAULT_FONT_SIZE,
        fontBold: false,
        fontUnderline: false
      }
    })

    connectedEntityNodeIds.forEach((entityNodeId) => {
      edges.push({
        id: crypto.randomUUID(),
        source: relationshipNodeId,
        target: entityNodeId,
        type: 'erEdge'
      })
    })
  })

  return { nodes, edges }
}

export function buildLogicalCanvasFromVision(
  result: LogicalVisionResult,
  diagramId: string
): {
  tables: LogicalTable[]
  edges: LogicalEdge[]
} {
  if (result.tables.length === 0) return { tables: [], edges: [] }

  const tableNameCounts = new Map<string, number>()
  const tables: LogicalTable[] = result.tables.map((table, tableIndex) => {
    const baseTableName = sanitizeText(table.name, `資料表${tableIndex + 1}`)
    const tableName = getUniqueName(baseTableName, tableNameCounts)
    const tableId = crypto.randomUUID()
    const fieldNameCounts = new Map<string, number>()

    const normalizedFields = (table.fields.length > 0
      ? table.fields
      : [{ name: 'id', isPK: true, isFK: false }]
    ).map((field, fieldIndex) => {
      const fieldName = getUniqueName(
        sanitizeText(field.name, `欄位${fieldIndex + 1}`),
        fieldNameCounts
      )
      return createLogicalField(
        tableId,
        fieldName,
        fieldIndex,
        Boolean(field.isPK),
        Boolean(field.isFK)
      )
    })

    if (!normalizedFields.some((field) => field.is_pk) && normalizedFields[0]) {
      normalizedFields[0] = { ...normalizedFields[0], is_pk: true }
    }

    return {
      id: tableId,
      diagram_id: diagramId,
      name: tableName,
      name_en: null,
      x: 150 + (tableIndex % 3) * 410,
      y: 130 + Math.floor(tableIndex / 3) * 300,
      fields: normalizedFields
    }
  })

  const tableByNormalizedName = new Map<string, LogicalTable>()
  tables.forEach((table) => {
    const key = normalizeNameKey(table.name)
    if (key && !tableByNormalizedName.has(key)) {
      tableByNormalizedName.set(key, table)
    }
  })

  const resolveTable = (name: string): LogicalTable | null => {
    const key = normalizeNameKey(name)
    if (!key) return null

    const exact = tableByNormalizedName.get(key)
    if (exact) return exact

    const partial = tables.find((table) => {
      const tableKey = normalizeNameKey(table.name)
      return tableKey.includes(key) || key.includes(tableKey)
    })
    return partial ?? null
  }

  const edges: LogicalEdge[] = []
  const edgeKeys = new Set<string>()

  result.relationships.forEach((relationship) => {
    const sourceTable = resolveTable(relationship.fromTable)
    const targetTable = resolveTable(relationship.toTable)
    if (!sourceTable || !targetTable || sourceTable.id === targetTable.id) return

    const targetPKField = targetTable.fields.find((field) => field.is_pk) ?? targetTable.fields[0]
    if (!targetPKField) return

    const targetNameKey = normalizeNameKey(targetTable.name)
    const targetPKKey = normalizeNameKey(targetPKField.name)

    const sourceFKField =
      sourceTable.fields.find((field) => {
        const fieldKey = normalizeNameKey(field.name)
        return field.is_fk || fieldKey.includes(targetNameKey) || fieldKey.includes(targetPKKey)
      }) ??
      sourceTable.fields.find((field) => !field.is_pk) ??
      sourceTable.fields[0]

    if (!sourceFKField) return

    sourceFKField.is_fk = true
    sourceFKField.fk_ref_table = targetTable.name
    sourceFKField.fk_ref_field = targetPKField.name

    const edgeKey = `${sourceTable.id}:${sourceFKField.id}->${targetTable.id}:${targetPKField.id}`
    if (edgeKeys.has(edgeKey)) return
    edgeKeys.add(edgeKey)

    edges.push({
      id: crypto.randomUUID(),
      diagram_id: diagramId,
      source_table_id: sourceTable.id,
      source_field_id: sourceFKField.id,
      target_table_id: targetTable.id,
      target_field_id: targetPKField.id,
      edge_type: 'fk'
    })
  })

  return { tables, edges }
}
