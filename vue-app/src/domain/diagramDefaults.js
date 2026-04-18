import { toDbDiagramType } from './diagramTypes.js'

export function createDiagramName(type) {
  switch (type) {
    case 'logical':
    case 'lm':
      return '未命名邏輯模型'
    case 'physical':
    case 'pm':
      return '未命名實體模型'
    case 'table':
    case 'pt':
      return '未命名資料表'
    default:
      return '未命名圖表'
  }
}

export function createDiagramContent(type) {
  const dbType = toDbDiagramType(type)

  if (type === 'table' || type === 'pt') {
    return { tables: [], nextId: 1, physicalStyle: 'table', linkedLmDiagramId: null }
  }

  if (dbType === 'logical') {
    return { tables: [], fkLinks: [], nextId: 1, linkedErDiagramId: null }
  }

  if (dbType === 'physical') {
    return { tables: [], fkLinks: [], nextId: 1, linkedLmDiagramId: null }
  }

  return { nodes: [], edges: [], nextId: 1 }
}
