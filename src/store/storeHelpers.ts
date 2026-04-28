import type { LogicalField, LogicalTable } from '../types'
import { getSupabaseClient } from '../lib/supabase'

export const createId = () => crypto.randomUUID()

export const chunkArray = <T>(list: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

type SupabaseClient = ReturnType<typeof getSupabaseClient>

export const deleteRowsByIdsInChunks = async (
  client: SupabaseClient,
  table: 'er_nodes' | 'er_edges' | 'logical_tables' | 'logical_fields' | 'logical_edges',
  ids: string[],
  chunkSize = 100
) => {
  if (ids.length === 0) return
  for (const chunk of chunkArray(ids, chunkSize)) {
    const { error } = await client.from(table).delete().in('id', chunk)
    if (error) throw error
  }
}

export const fetchLogicalFieldsByTableIds = async (
  client: SupabaseClient,
  tableIds: string[]
) => {
  const result: Array<{ id: string; table_id: string }> = []
  if (tableIds.length === 0) return result
  for (const chunk of chunkArray(tableIds, 100)) {
    const { data, error } = await client
      .from('logical_fields')
      .select('id, table_id')
      .in('table_id', chunk)
    if (error) throw error
    result.push(...((data ?? []) as Array<{ id: string; table_id: string }>))
  }
  return result
}

export const normalizeFieldOrder = (fields: LogicalField[]): LogicalField[] =>
  fields.map((field, index) => ({ ...field, order_index: index }))

export const reorderPkFirst = (fields: LogicalField[]): LogicalField[] =>
  normalizeFieldOrder([
    ...fields.filter((field) => field.is_pk),
    ...fields.filter((field) => !field.is_pk)
  ])

export const castStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const POS_LIMIT = 50000

export const toFiniteNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(-POS_LIMIT, Math.min(POS_LIMIT, parsed))
}

export const replaceTableFields = (
  tables: LogicalTable[],
  tableId: string,
  updater: (fields: LogicalField[]) => LogicalField[]
): LogicalTable[] | null => {
  const idx = tables.findIndex((t) => t.id === tableId)
  if (idx === -1) return null
  const table = tables[idx]
  const next = [...tables]
  next[idx] = { ...table, fields: updater(table.fields) }
  return next
}
