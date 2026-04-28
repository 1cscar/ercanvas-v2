import type { LogicalTable } from '../types'

export interface FKCycleResult {
  hasCycle: boolean
  /** Ordered table names forming the cycle, e.g. ['A', 'B', 'A'] */
  path: string[]
}

export interface OrphanFKField {
  tableId: string
  fieldId: string
  refTable: string
}

/**
 * Detects FK reference cycles using DFS on the directed graph
 * table A → table B when any field in A has fk_ref_table = B.name.
 */
export function detectFKCycle(tables: LogicalTable[]): FKCycleResult {
  const tableNames = new Set(tables.map((t) => t.name))

  // Build adjacency list: tableName → unique referenced table names
  const adj = new Map<string, string[]>()
  for (const table of tables) {
    const refs: string[] = []
    for (const field of table.fields) {
      if (
        field.is_fk &&
        field.fk_ref_table &&
        tableNames.has(field.fk_ref_table) &&
        field.fk_ref_table !== table.name &&
        !refs.includes(field.fk_ref_table)
      ) {
        refs.push(field.fk_ref_table)
      }
    }
    adj.set(table.name, refs)
  }

  const visited = new Set<string>()
  const onStack = new Set<string>()
  let cyclePath: string[] = []

  const dfs = (node: string, path: string[]): boolean => {
    if (onStack.has(node)) {
      const start = path.indexOf(node)
      cyclePath = [...path.slice(start), node]
      return true
    }
    if (visited.has(node)) return false

    visited.add(node)
    onStack.add(node)
    for (const neighbor of adj.get(node) ?? []) {
      if (dfs(neighbor, [...path, node])) return true
    }
    onStack.delete(node)
    return false
  }

  for (const name of tableNames) {
    if (!visited.has(name) && dfs(name, [])) {
      return { hasCycle: true, path: cyclePath }
    }
  }

  return { hasCycle: false, path: [] }
}

/**
 * Returns FK fields whose fk_ref_table does not exist in the current table set.
 */
export function getOrphanFKFields(tables: LogicalTable[]): OrphanFKField[] {
  const tableNames = new Set(tables.map((t) => t.name))
  const result: OrphanFKField[] = []

  for (const table of tables) {
    for (const field of table.fields) {
      if (field.is_fk && field.fk_ref_table && !tableNames.has(field.fk_ref_table)) {
        result.push({ tableId: table.id, fieldId: field.id, refTable: field.fk_ref_table })
      }
    }
  }

  return result
}
