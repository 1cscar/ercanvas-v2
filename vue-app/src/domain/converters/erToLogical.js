function neighborSet(nodeId, edges) {
  return new Set(
    edges
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => (edge.from === nodeId ? edge.to : edge.from)),
  )
}

function sortPkFirst(columns) {
  return [...columns].sort((a, b) => Number(Boolean(b.pk)) - Number(Boolean(a.pk)))
}

export function convertErToLogical({ nodes = [], edges = [], nextId = 1, existingTables = [] } = {}) {
  let localNextId = nextId
  const attrTypes = new Set(['attribute', 'multi-value', 'derived'])
  const tables = []

  const mkCol = (attribute, fk = false) => ({
    id: `lc${localNextId++}`,
    name: attribute.label || '欄位',
    pk: attribute.style?.underline === true,
    fk,
  })

  nodes
    .filter((node) => node.type === 'entity' || node.type === 'weak-entity')
    .forEach((entity) => {
      if (existingTables.some((table) => table.name === entity.label)) return

      const neighbors = neighborSet(entity.id, edges)
      const columns = sortPkFirst(
        nodes
          .filter((node) => neighbors.has(node.id) && attrTypes.has(node.type))
          .map((attribute) => mkCol(attribute)),
      )

      if (!columns.length) columns.push({ id: `lc${localNextId++}`, name: 'id', pk: true, fk: false })

      tables.push({
        id: `lt${localNextId++}`,
        name: entity.label || '表格',
        x: 0,
        y: 0,
        columns,
      })
    })

  return { tables, nextId: localNextId }
}
