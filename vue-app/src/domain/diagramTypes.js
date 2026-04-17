export function toDbDiagramType(type) {
  if (type === 'table' || type === 'pt') return 'physical'
  if (type === 'logical' || type === 'lm') return 'logical'
  if (type === 'physical' || type === 'pm') return 'physical'
  return 'er'
}

export function toUiDiagramType(type, content = {}) {
  const dbType = toDbDiagramType(type)
  if (dbType === 'physical' && content?.physicalStyle === 'table') return 'table'
  return dbType
}

export function isTableDiagram(type, content = {}) {
  return toUiDiagramType(type, content) === 'table'
}
