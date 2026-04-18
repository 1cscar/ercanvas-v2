import { createDiagramContent, createDiagramName } from './diagramDefaults.js'
import { toDbDiagramType, toUiDiagramType } from './diagramTypes.js'

export function rowToDiagram(row) {
  const content = row.content || {}

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    type: toUiDiagramType(row.diagram_type, content),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    linkedErDiagramId: row.linked_er_diagram_id ?? content.linkedErDiagramId ?? null,
    linkedLmDiagramId: row.linked_lm_diagram_id ?? content.linkedLmDiagramId ?? null,
    content,
  }
}

export function createDiagramInsert(uid, type) {
  const content = createDiagramContent(type)

  return {
    owner_id: uid,
    diagram_type: toDbDiagramType(type),
    name: createDiagramName(type),
    content,
    linked_er_diagram_id: content.linkedErDiagramId ?? null,
    linked_lm_diagram_id: content.linkedLmDiagramId ?? null,
  }
}
