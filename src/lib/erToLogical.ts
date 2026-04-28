import { Edge, Node } from '@xyflow/react'
import { ERNodeData, LogicalEdge, LogicalField, LogicalTable } from '../types'

type ErNode = Node<ERNodeData>

export interface ConvertedLogicalGraph {
  tables: LogicalTable[]
  edges: LogicalEdge[]
}

const getLabel = (node?: ErNode) => (node?.data?.label?.trim() ? node.data.label.trim() : 'Unnamed')

const toFieldName = (value: string) => value.trim().replace(/\s+/g, '_')

const createField = (tableId: string, name: string, orderIndex: number, options?: Partial<LogicalField>): LogicalField => ({
  id: crypto.randomUUID(),
  table_id: tableId,
  name,
  name_en: null,
  order_index: orderIndex,
  is_pk: false,
  is_fk: false,
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
  default_value: null,
  ...options
})

const normalizePkFirst = (fields: LogicalField[]) => {
  const sorted = [...fields].sort((a, b) => Number(b.is_pk) - Number(a.is_pk) || a.order_index - b.order_index)
  return sorted.map((field, index) => ({ ...field, order_index: index }))
}

export function convertERtoLogical(erNodes: ErNode[], erEdges: Edge[]): ConvertedLogicalGraph {
  const entities = erNodes.filter((node) => node.type === 'entity')
  const attributes = erNodes.filter((node) => node.type === 'attribute')
  const relationships = erNodes.filter((node) => node.type === 'relationship')
  const erEntities = erNodes.filter((node) => node.type === 'er_entity')
  const nodeById = new Map(erNodes.map((node) => [node.id, node]))

  const tables: LogicalTable[] = []
  const edges: LogicalEdge[] = []
  const entityToTable = new Map<string, LogicalTable>()

  for (const entity of entities) {
    const tableId = crypto.randomUUID()
    const table: LogicalTable = {
      id: tableId,
      diagram_id: '',
      name: getLabel(entity),
      name_en: null,
      x: entity.position.x,
      y: entity.position.y,
      fields: []
    }
    tables.push(table)
    entityToTable.set(entity.id, table)
  }

  const edgesByNode = new Map<string, Edge[]>()
  for (const edge of erEdges) {
    const sourceEdges = edgesByNode.get(edge.source) ?? []
    sourceEdges.push(edge)
    edgesByNode.set(edge.source, sourceEdges)

    const targetEdges = edgesByNode.get(edge.target) ?? []
    targetEdges.push(edge)
    edgesByNode.set(edge.target, targetEdges)
  }

  for (const attr of attributes) {
    const connected = edgesByNode.get(attr.id) ?? []
    const connectedEntity = connected
      .map((edge) => (edge.source === attr.id ? edge.target : edge.source))
      .map((nodeId) => nodeById.get(nodeId))
      .find((node) => node?.type === 'entity')

    if (!connectedEntity) continue
    const table = entityToTable.get(connectedEntity.id)
    if (!table) continue

    const nextField = createField(
      table.id,
      toFieldName(getLabel(attr)),
      table.fields.length,
      {
        is_pk: Boolean(attr.data?.isPrimaryKey),
        is_fk: false
      }
    )

    table.fields = normalizePkFirst([...table.fields, nextField])
  }

  for (const relationship of relationships) {
    const connectedEntities = (edgesByNode.get(relationship.id) ?? [])
      .map((edge) => (edge.source === relationship.id ? edge.target : edge.source))
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is ErNode => node?.type === 'entity')

    if (connectedEntities.length < 2) continue

    const [leftEntity, rightEntity] = connectedEntities
    const leftTable = entityToTable.get(leftEntity.id)
    const rightTable = entityToTable.get(rightEntity.id)
    if (!leftTable || !rightTable) continue

    const relationTableId = crypto.randomUUID()
    const relationTableName = `${leftTable.name}_${rightTable.name}`
    const leftPKs = leftTable.fields.filter((field) => field.is_pk)
    const rightPKs = rightTable.fields.filter((field) => field.is_pk)
    const fallbackLeftPk = leftPKs.length > 0 ? leftPKs : [createField(leftTable.id, `${leftTable.name}_id`, 0, { is_pk: true })]
    const fallbackRightPk =
      rightPKs.length > 0 ? rightPKs : [createField(rightTable.id, `${rightTable.name}_id`, 0, { is_pk: true })]

    const relationFields: LogicalField[] = [
      ...fallbackLeftPk.map((field, index) =>
        createField(relationTableId, field.name, index, {
          is_pk: true,
          is_fk: true,
          fk_ref_table: leftTable.name,
          fk_ref_field: field.name
        })
      ),
      ...fallbackRightPk.map((field, index) =>
        createField(relationTableId, field.name, fallbackLeftPk.length + index, {
          is_pk: true,
          is_fk: true,
          fk_ref_table: rightTable.name,
          fk_ref_field: field.name
        })
      )
    ]

    tables.push({
      id: relationTableId,
      diagram_id: '',
      name: relationTableName,
      name_en: null,
      x: relationship.position.x,
      y: relationship.position.y,
      fields: normalizePkFirst(relationFields)
    })
  }

  for (const erEntity of erEntities) {
    const connectedEntities = (edgesByNode.get(erEntity.id) ?? [])
      .map((edge) => (edge.source === erEntity.id ? edge.target : edge.source))
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is ErNode => node?.type === 'entity')

    if (connectedEntities.length < 2) continue
    const [strongEntity, weakEntity] = connectedEntities
    const strongTable = entityToTable.get(strongEntity.id)
    const weakTable = entityToTable.get(weakEntity.id)
    if (!strongTable || !weakTable) continue

    const strongPKs = strongTable.fields.filter((field) => field.is_pk)
    const fieldsToInject = (strongPKs.length > 0 ? strongPKs : [createField(strongTable.id, `${strongTable.name}_id`, 0, { is_pk: true })])
      .filter((field) => !weakTable.fields.some((targetField) => targetField.name === field.name))
      .map((field, index) =>
        createField(weakTable.id, field.name, weakTable.fields.length + index, {
          is_fk: true,
          fk_ref_table: strongTable.name,
          fk_ref_field: field.name
        })
      )

    weakTable.fields = normalizePkFirst([...weakTable.fields, ...fieldsToInject])
  }

  return { tables, edges }
}
