import { LogicalField, LogicalTable, NormalizationIssue } from '../types'

const cloneField = (field: LogicalField, overrides?: Partial<LogicalField>): LogicalField => ({
  ...field,
  composite_children: [...field.composite_children],
  partial_dep_on: [...field.partial_dep_on],
  ...overrides
})

const normalizeOrder = (fields: LogicalField[]) =>
  fields.map((field, index) => ({
    ...field,
    order_index: index
  }))

const normalizePkFirst = (fields: LogicalField[]) =>
  normalizeOrder([
    ...fields.filter((field) => field.is_pk),
    ...fields.filter((field) => !field.is_pk)
  ])

const removeField = (table: LogicalTable, fieldId: string): LogicalTable => ({
  ...table,
  fields: normalizePkFirst(table.fields.filter((field) => field.id !== fieldId).map((field) => cloneField(field)))
})

const addTable = (tables: LogicalTable[], table: LogicalTable) => [...tables, table]

const getTableAndField = (tables: LogicalTable[], issue: NormalizationIssue) => {
  const table = tables.find((targetTable) => targetTable.id === issue.tableId)
  if (!table) return { table: null, field: null }
  const field = table.fields.find((targetField) => targetField.id === issue.fieldId)
  return { table, field: field ?? null }
}

export function analyze1NF(tables: LogicalTable[]): NormalizationIssue[] {
  const issues: NormalizationIssue[] = []

  for (const table of tables) {
    for (const field of table.fields) {
      if (field.is_multi_value) {
        issues.push({
          type: 'MULTI_VALUE',
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          description: `欄位 ${field.name} 是多重值欄位，違反 1NF 原子性。`,
          suggestion: `將 ${field.name} 拆到新表，並以原表主鍵建立關聯。`
        })
      }

      if (field.is_composite) {
        issues.push({
          type: 'COMPOSITE',
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          description: `欄位 ${field.name} 為複合屬性，違反 1NF 原子性。`,
          suggestion: `展開 ${field.name} 為單元欄位：${field.composite_children.join(', ') || '請先設定子欄位'}。`
        })
      }
    }
  }

  return issues
}

export function analyze2NF(tables: LogicalTable[]): NormalizationIssue[] {
  const issues: NormalizationIssue[] = []

  for (const table of tables) {
    const pkFields = table.fields.filter((field) => field.is_pk)
    if (pkFields.length < 2) continue

    const pkNames = new Set(pkFields.map((field) => field.name))

    for (const field of table.fields) {
      if (field.is_pk || field.partial_dep_on.length === 0) continue

      const deps = field.partial_dep_on.filter((dep) => pkNames.has(dep))
      if (deps.length === 0) continue
      if (deps.length >= pkFields.length) continue

      issues.push({
        type: 'PARTIAL_DEP',
        tableId: table.id,
        tableName: table.name,
        fieldId: field.id,
        fieldName: field.name,
        description: `欄位 ${field.name} 只依賴部分主鍵 [${deps.join(', ')}]，違反 2NF。`,
        suggestion: `將 ${field.name} 移至以 [${deps.join(', ')}] 為主鍵的新表。`,
        dependsOn: deps
      })
    }
  }

  return issues
}

export function analyze3NF(tables: LogicalTable[]): NormalizationIssue[] {
  const issues: NormalizationIssue[] = []

  for (const table of tables) {
    for (const field of table.fields) {
      if (!field.transitive_dep_via) continue

      issues.push({
        type: 'TRANSITIVE_DEP',
        tableId: table.id,
        tableName: table.name,
        fieldId: field.id,
        fieldName: field.name,
        description: `欄位 ${field.name} 透過 ${field.transitive_dep_via} 發生遞移相依，違反 3NF。`,
        suggestion: `將 ${field.name} 移至以 ${field.transitive_dep_via} 為主鍵的新表。`,
        via: field.transitive_dep_via
      })
    }
  }

  return issues
}

export function fix1NF_multiValue(tables: LogicalTable[], issue: NormalizationIssue): LogicalTable[] {
  const { table, field } = getTableAndField(tables, issue)
  if (!table || !field) return tables

  const sourceWithoutField = removeField(table, field.id)
  const sourcePkFields = table.fields.filter((targetField) => targetField.is_pk)

  const newTableId = crypto.randomUUID()
  const copiedPkFields = sourcePkFields.map((pkField, index) =>
    cloneField(pkField, {
      id: crypto.randomUUID(),
      table_id: newTableId,
      order_index: index,
      is_fk: true,
      fk_ref_table: table.name,
      fk_ref_field: pkField.name
    })
  )

  const movedField = cloneField(field, {
    id: crypto.randomUUID(),
    table_id: newTableId,
    order_index: copiedPkFields.length,
    is_multi_value: false
  })

  const splitTable: LogicalTable = {
    id: newTableId,
    diagram_id: table.diagram_id,
    name: `${table.name}_${field.name}`,
    x: table.x + 360,
    y: table.y + 20,
    fields: normalizePkFirst([...copiedPkFields, movedField])
  }

  return addTable(
    tables.map((targetTable) => (targetTable.id === table.id ? sourceWithoutField : targetTable)),
    splitTable
  )
}

export function fix1NF_composite(tables: LogicalTable[], issue: NormalizationIssue): LogicalTable[] {
  const { table, field } = getTableAndField(tables, issue)
  if (!table || !field) return tables

  const children = field.composite_children.length > 0 ? field.composite_children : [`${field.name}_part`]
  const baseFields = table.fields.filter((targetField) => targetField.id !== field.id).map((targetField) => cloneField(targetField))
  const childFields = children.map((childName) =>
    cloneField(field, {
      id: crypto.randomUUID(),
      table_id: table.id,
      name: childName,
      is_composite: false,
      is_multi_value: false,
      composite_children: [],
      partial_dep_on: [],
      transitive_dep_via: null,
      is_pk: false,
      is_fk: false
    })
  )

  return tables.map((targetTable) =>
    targetTable.id === table.id
      ? {
          ...targetTable,
          fields: normalizePkFirst([...baseFields, ...childFields])
        }
      : targetTable
  )
}

export function fix2NF_partialDep(tables: LogicalTable[], issue: NormalizationIssue): LogicalTable[] {
  const { table, field } = getTableAndField(tables, issue)
  if (!table || !field) return tables
  if (!issue.dependsOn || issue.dependsOn.length === 0) return tables

  const sourceWithoutField = removeField(table, field.id)
  const pkFields = table.fields.filter((pkField) => issue.dependsOn?.includes(pkField.name))

  const newTableId = crypto.randomUUID()
  const depKeyFields = pkFields.map((pkField, index) =>
    cloneField(pkField, {
      id: crypto.randomUUID(),
      table_id: newTableId,
      order_index: index,
      is_fk: false
    })
  )

  const movedField = cloneField(field, {
    id: crypto.randomUUID(),
    table_id: newTableId,
    order_index: depKeyFields.length,
    partial_dep_on: []
  })

  const newTable: LogicalTable = {
    id: newTableId,
    diagram_id: table.diagram_id,
    name: `${table.name}_${issue.dependsOn.join('_')}`,
    x: table.x + 360,
    y: table.y + 80,
    fields: normalizePkFirst([...depKeyFields, movedField])
  }

  return addTable(
    tables.map((targetTable) => (targetTable.id === table.id ? sourceWithoutField : targetTable)),
    newTable
  )
}

export function fix3NF_transitiveDep(tables: LogicalTable[], issue: NormalizationIssue): LogicalTable[] {
  const { table, field } = getTableAndField(tables, issue)
  if (!table || !field || !issue.via) return tables

  const viaField = table.fields.find((targetField) => targetField.name === issue.via)
  if (!viaField) return tables

  const sourceWithoutField = removeField(table, field.id)
  const newTableId = crypto.randomUUID()

  const newPk = cloneField(viaField, {
    id: crypto.randomUUID(),
    table_id: newTableId,
    is_pk: true,
    is_fk: false,
    order_index: 0
  })

  const movedField = cloneField(field, {
    id: crypto.randomUUID(),
    table_id: newTableId,
    transitive_dep_via: null,
    order_index: 1
  })

  const newTable: LogicalTable = {
    id: newTableId,
    diagram_id: table.diagram_id,
    name: `${table.name}_${issue.via}`,
    x: table.x + 360,
    y: table.y + 140,
    fields: normalizePkFirst([newPk, movedField])
  }

  return addTable(
    tables.map((targetTable) => (targetTable.id === table.id ? sourceWithoutField : targetTable)),
    newTable
  )
}
