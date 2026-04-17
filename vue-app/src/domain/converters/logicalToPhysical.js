export function convertLogicalToPhysical({ name = '未命名邏輯模型', tables = [], nextId = 1, linkedLmDiagramId = null } = {}) {
  return {
    name: `${name} — 關聯表`,
    diagramType: 'physical',
    physicalStyle: 'table',
    tables: structuredClone(tables),
    nextId,
    linkedLmDiagramId,
  }
}
