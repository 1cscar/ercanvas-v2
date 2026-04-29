import type { StateCreator } from 'zustand'
import { getSupabaseClient } from '../lib/supabase'
import { detectFKCycle, getOrphanFKFields } from '../lib/logicalValidation'
import {
  createId,
  castStringArray,
  normalizeFieldOrder,
  reorderPkFirst,
  replaceTableFields,
  toFiniteNumber,
  deleteRowsByIdsInChunks,
  fetchLogicalFieldsByTableIds
} from './storeHelpers'
import { broadcastDiagramSave } from './broadcastChannel'
import type { DiagramStore, LogicalSlice } from './storeTypes'
import type { LogicalField } from '../types'

const LEGACY_LOGICAL_TABLE_COLUMNS = ['id', 'diagram_id', 'name', 'x', 'y'] as const
const LEGACY_LOGICAL_FIELD_COLUMNS = [
  'id',
  'table_id',
  'name',
  'order_index',
  'is_pk',
  'is_fk',
  'is_multi_value',
  'is_composite',
  'composite_children',
  'partial_dep_on',
  'transitive_dep_via',
  'fk_ref_table',
  'fk_ref_field'
] as const

const NEW_LOGICAL_TABLE_COLUMNS = ['name_en'] as const
const NEW_LOGICAL_FIELD_COLUMNS = [
  'name_en',
  'fk_ref_table_en',
  'fk_ref_field_en',
  'data_type',
  'is_not_null',
  'default_value'
] as const

type DbErrorLike = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

const includesColumnHint = (error: DbErrorLike | null | undefined, columns: readonly string[]) => {
  if (!error) return false
  const haystack = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return columns.some((column) => haystack.includes(column.toLowerCase()))
}

const shouldFallbackToLegacyColumns = (error: DbErrorLike | null | undefined, columns: readonly string[]) => {
  if (!error) return false
  if (error.code === 'PGRST204' || error.code === '42703') return true
  return includesColumnHint(error, columns)
}

const pickColumns = <T extends Record<string, unknown>>(row: T, columns: readonly string[]) => {
  const next: Record<string, unknown> = {}
  for (const column of columns) {
    next[column] = row[column]
  }
  return next
}

export const createLogicalSlice: StateCreator<DiagramStore, [], [], LogicalSlice> = (set, get) => ({
  logicalTables: [],
  logicalEdges: [],
  currentLogicalLoadController: null,

  setLogicalTables: (tables) => set({ logicalTables: tables, saveStatus: 'idle' }),
  setLogicalEdges: (edges) => set({ logicalEdges: edges, saveStatus: 'idle' }),

  updateTableMeta: (tableId, meta) => {
    set((state) => ({
      logicalTables: state.logicalTables.map((table) =>
        table.id === tableId ? { ...table, ...meta } : table
      )
    }))
  },

  addLogicalField: (tableId, afterIndex) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const insertionIndex = Math.max(0, Math.min(afterIndex + 1, fields.length))
        const next = [...fields]
        next.splice(insertionIndex, 0, {
          id: createId(),
          table_id: tableId,
          name: 'new_field',
          name_en: null,
          order_index: insertionIndex,
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
          data_type: 'VARCHAR(255)',
          is_not_null: false,
          default_value: null
        })
        return normalizeFieldOrder(next)
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  deleteLogicalField: (tableId, fieldId) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) =>
        normalizeFieldOrder(fields.filter((f) => f.id !== fieldId))
      )
      if (!newTables) return state
      return {
        logicalTables: newTables,
        logicalEdges: state.logicalEdges.filter(
          (edge) => edge.source_field_id !== fieldId && edge.target_field_id !== fieldId
        ),
        selectedFieldId: state.selectedFieldId === fieldId ? null : state.selectedFieldId,
        connectingFieldId: state.connectingFieldId === fieldId ? null : state.connectingFieldId
      }
    })
  },

  deleteLogicalTable: (tableId) => {
    set((state) => {
      const targetTable = state.logicalTables.find((t) => t.id === tableId)
      const removedFieldIds = new Set(targetTable?.fields.map((f) => f.id) ?? [])

      const tablesAfterDelete = state.logicalTables.filter((t) => t.id !== tableId)

      const orphans = getOrphanFKFields(tablesAfterDelete)
      const orphanFieldIds = new Set(orphans.map((o) => o.fieldId))
      const cleanedTables =
        orphans.length > 0
          ? tablesAfterDelete.map((table) => ({
              ...table,
              fields: table.fields.map((field) =>
                orphanFieldIds.has(field.id)
                  ? {
                      ...field,
                      is_fk: false,
                      fk_ref_table: null,
                      fk_ref_field: null,
                      fk_ref_table_en: null,
                      fk_ref_field_en: null
                    }
                  : field
              )
            }))
          : tablesAfterDelete

      return {
        logicalTables: cleanedTables,
        logicalEdges: state.logicalEdges.filter(
          (edge) =>
            edge.source_table_id !== tableId &&
            edge.target_table_id !== tableId &&
            !removedFieldIds.has(edge.source_field_id) &&
            !removedFieldIds.has(edge.target_field_id)
        ),
        selectedFieldId:
          state.selectedFieldId && removedFieldIds.has(state.selectedFieldId)
            ? null
            : state.selectedFieldId,
        connectingFieldId:
          state.connectingFieldId && removedFieldIds.has(state.connectingFieldId)
            ? null
            : state.connectingFieldId
      }
    })
  },

  moveLogicalField: (tableId, fromIndex, toIndex) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        if (
          fromIndex < 0 ||
          fromIndex >= fields.length ||
          toIndex < 0 ||
          toIndex >= fields.length ||
          fromIndex === toIndex
        )
          return fields
        const next = [...fields]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return normalizeFieldOrder(next)
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  updateFieldName: (tableId, fieldId, name) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const idx = fields.findIndex((f) => f.id === fieldId)
        if (idx === -1) return fields
        const next = [...fields]
        next[idx] = { ...next[idx], name }
        return next
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  updateFieldMeta: (tableId, fieldId, meta) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const idx = fields.findIndex((f) => f.id === fieldId)
        if (idx === -1) return fields
        const next = [...fields]
        next[idx] = { ...next[idx], ...meta }
        return next
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  setFieldFKRef: (tableId, fieldId, refTable, refField, refTableEn, refFieldEn) => {
    const newTables = replaceTableFields(get().logicalTables, tableId, (fields) => {
      const idx = fields.findIndex((f) => f.id === fieldId)
      if (idx === -1) return fields
      const next = [...fields]
      next[idx] = {
        ...next[idx],
        is_fk: true,
        fk_ref_table: refTable || null,
        fk_ref_field: refField || null,
        fk_ref_table_en: refTableEn || null,
        fk_ref_field_en: refFieldEn || null
      }
      return next
    })
    if (!newTables) return

    const { hasCycle, path } = detectFKCycle(newTables)
    if (hasCycle) {
      throw new Error(`FK 循環引用：${path.join(' → ')}`)
    }

    set({ logicalTables: newTables })
  },

  toggleFieldPK: (tableId, fieldId) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const idx = fields.findIndex((f) => f.id === fieldId)
        if (idx === -1) return fields
        const next = [...fields]
        next[idx] = { ...next[idx], is_pk: !next[idx].is_pk }
        return reorderPkFirst(next)
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  toggleFieldFK: (tableId, fieldId, refTable, refField) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const idx = fields.findIndex((f) => f.id === fieldId)
        if (idx === -1) return fields
        const field = fields[idx]
        const nextIsFK = !field.is_fk
        const next = [...fields]
        next[idx] = {
          ...field,
          is_fk: nextIsFK,
          fk_ref_table: nextIsFK ? refTable ?? field.fk_ref_table : null,
          fk_ref_field: nextIsFK ? refField ?? field.fk_ref_field : null,
          fk_ref_table_en: nextIsFK ? field.fk_ref_table_en : null,
          fk_ref_field_en: nextIsFK ? field.fk_ref_field_en : null
        }
        return next
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  setFieldMark: (tableId, fieldId, mark, value, extra) => {
    set((state) => {
      const newTables = replaceTableFields(state.logicalTables, tableId, (fields) => {
        const idx = fields.findIndex((f) => f.id === fieldId)
        if (idx === -1) return fields
        const field = fields[idx]
        let updated: LogicalField = field

        if (mark === 'multi_value') {
          updated = { ...field, is_multi_value: value }
        } else if (mark === 'composite') {
          const children = castStringArray(extra?.composite_children ?? extra?.children)
          updated = { ...field, is_composite: value, composite_children: value ? children : [] }
        } else if (mark === 'partial_dep') {
          const dependsOn = castStringArray(extra?.partial_dep_on ?? extra?.dependsOn)
          updated = { ...field, partial_dep_on: value ? dependsOn : [] }
        } else if (mark === 'transitive_dep') {
          updated = {
            ...field,
            transitive_dep_via:
              value && typeof extra?.transitive_dep_via === 'string'
                ? extra.transitive_dep_via
                : value && typeof extra?.via === 'string'
                  ? extra.via
                  : null
          }
        }

        const next = [...fields]
        next[idx] = updated
        return next
      })
      return newTables ? { logicalTables: newTables } : state
    })
  },

  loadLogical: async (diagramId) => {
    get().currentLogicalLoadController?.abort()
    const controller = new AbortController()
    set({ currentLogicalLoadController: controller, currentDiagramId: diagramId, staleDataWarning: false })
    const client = getSupabaseClient(get().shareToken)

    try {
      // Fetch diagram version alongside tables so we can detect conflicts later
      const [{ data: tableRows, error: tablesError }, { data: diagramMeta }] = await Promise.all([
        client
          .from('logical_tables')
          .select('*')
          .eq('diagram_id', diagramId)
          .abortSignal(controller.signal),
        client
          .from('diagrams')
          .select('version')
          .eq('id', diagramId)
          .abortSignal(controller.signal)
          .maybeSingle()
      ])

      if (controller.signal.aborted) return
      if (tablesError) throw tablesError

      if (diagramMeta != null) {
        set({ diagramVersion: diagramMeta.version ?? null })
      }

      if (controller.signal.aborted) return
      if (tablesError) throw tablesError

      const tableIds = (tableRows ?? []).map((table) => table.id)
      const [fieldsResult, edgesResult] = await Promise.all([
        tableIds.length > 0
          ? client
              .from('logical_fields')
              .select('*')
              .in('table_id', tableIds)
              .order('order_index')
              .abortSignal(controller.signal)
          : Promise.resolve({ data: [], error: null }),
        client
          .from('logical_edges')
          .select('*')
          .eq('diagram_id', diagramId)
          .abortSignal(controller.signal)
      ])

      if (controller.signal.aborted) return
      if (fieldsResult.error) throw fieldsResult.error
      if (edgesResult.error) throw edgesResult.error

      const fieldsByTable = new Map<string, LogicalField[]>()
      ;(fieldsResult.data ?? []).forEach((field) => {
        const list = fieldsByTable.get(field.table_id) ?? []
        list.push({
          ...(field as LogicalField),
          name_en: field.name_en ?? null,
          data_type: field.data_type ?? null,
          is_not_null: field.is_not_null ?? false,
          default_value: field.default_value ?? null,
          fk_ref_table_en: field.fk_ref_table_en ?? null,
          fk_ref_field_en: field.fk_ref_field_en ?? null
        })
        fieldsByTable.set(field.table_id, list)
      })

      const logicalTables = (tableRows ?? []).map((table) => ({
        id: table.id,
        diagram_id: table.diagram_id,
        name: table.name,
        name_en: table.name_en ?? null,
        x: toFiniteNumber(table.x, 100),
        y: toFiniteNumber(table.y, 100),
        fields: reorderPkFirst(fieldsByTable.get(table.id) ?? [])
      }))

      set({
        logicalTables,
        logicalEdges: (edgesResult.data ?? []) as import('../types').LogicalEdge[]
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    }
  },

  saveLogical: async (diagramId) => {
    const { logicalTables, logicalEdges, diagramVersion, shareToken } = get()
    const client = getSupabaseClient(shareToken)
    set({ saveStatus: 'saving' })

    try {
      // Version conflict check
      if (diagramVersion !== null) {
        const { data: meta } = await client
          .from('diagrams')
          .select('version')
          .eq('id', diagramId)
          .maybeSingle()
        const dbVersion = meta?.version ?? null
        if (dbVersion !== null && dbVersion !== diagramVersion) {
          const overwrite = window.confirm(
            `此邏輯圖已被其他頁面或裝置修改（版本 ${diagramVersion} → ${dbVersion}）。\n` +
              '確定要覆寫嗎？（取消則放棄本次儲存）'
          )
          if (!overwrite) {
            set({ saveStatus: 'idle', staleDataWarning: true })
            return
          }
          set({ diagramVersion: dbVersion })
        }
      }
    } catch {
      // Version check failure is non-fatal; proceed with save
    }

    try {
      const tableRows = logicalTables.map((table) => ({
        id: table.id,
        diagram_id: diagramId,
        name: table.name,
        name_en: table.name_en ?? null,
        x: table.x,
        y: table.y
      }))

      const fieldRows = logicalTables.flatMap((table) =>
        normalizeFieldOrder(table.fields).map((field) => ({
          ...field,
          table_id: table.id
        }))
      )

      const edgeRows = logicalEdges.map((edge) => ({
        ...edge,
        diagram_id: diagramId
      }))

      if (tableRows.length > 0) {
        const { error } = await client
          .from('logical_tables')
          .upsert(tableRows, { onConflict: 'id' })
        if (error) {
          if (!shouldFallbackToLegacyColumns(error as DbErrorLike, NEW_LOGICAL_TABLE_COLUMNS)) {
            console.error('[saveLogical] logical_tables upsert 失敗，請確認已執行最新 migration', error)
            throw new Error('儲存失敗：資料庫結構不完整，請聯絡管理員執行資料庫更新。')
          }
          console.warn('[saveLogical] logical_tables 新欄位不存在，改用舊版欄位儲存', error)
          const legacyTableRows = tableRows.map((row) => pickColumns(row, LEGACY_LOGICAL_TABLE_COLUMNS))
          const { error: legacyError } = await client
            .from('logical_tables')
            .upsert(legacyTableRows, { onConflict: 'id' })
          if (legacyError) throw legacyError
        }
      }

      if (fieldRows.length > 0) {
        const { error } = await client
          .from('logical_fields')
          .upsert(fieldRows, { onConflict: 'id' })
        if (error) {
          if (!shouldFallbackToLegacyColumns(error as DbErrorLike, NEW_LOGICAL_FIELD_COLUMNS)) {
            console.error('[saveLogical] logical_fields upsert 失敗，請確認已執行最新 migration', error)
            throw new Error('儲存失敗：資料庫結構不完整，請聯絡管理員執行資料庫更新。')
          }
          console.warn('[saveLogical] logical_fields 新欄位不存在，改用舊版欄位儲存', error)
          const legacyFieldRows = fieldRows.map((row) => pickColumns(row, LEGACY_LOGICAL_FIELD_COLUMNS))
          const { error: legacyError } = await client
            .from('logical_fields')
            .upsert(legacyFieldRows, { onConflict: 'id' })
          if (legacyError) throw legacyError
        }
      }

      if (edgeRows.length > 0) {
        const { error } = await client
          .from('logical_edges')
          .upsert(edgeRows, { onConflict: 'id' })
        if (error) throw error
      }

      const [
        { data: existingEdges, error: existingEdgesError },
        { data: existingTables, error: existingTablesError }
      ] = await Promise.all([
        client.from('logical_edges').select('id').eq('diagram_id', diagramId),
        client.from('logical_tables').select('id').eq('diagram_id', diagramId)
      ])
      if (existingEdgesError) throw existingEdgesError
      if (existingTablesError) throw existingTablesError

      const existingTableIds = (existingTables ?? []).map((row) => row.id as string)
      const existingFields = await fetchLogicalFieldsByTableIds(client, existingTableIds)

      const nextEdgeIds = new Set(edgeRows.map((edge) => edge.id))
      const nextTableIds = new Set(tableRows.map((table) => table.id))
      const nextFieldIds = new Set(fieldRows.map((field) => field.id))

      const staleEdgeIds = (existingEdges ?? [])
        .map((row) => row.id as string)
        .filter((id) => !nextEdgeIds.has(id))
      const staleTableIds = existingTableIds.filter((id) => !nextTableIds.has(id))
      const staleFieldIds = existingFields
        .map((field) => field.id)
        .filter((id) => !nextFieldIds.has(id))

      await deleteRowsByIdsInChunks(client, 'logical_edges', staleEdgeIds)
      await deleteRowsByIdsInChunks(client, 'logical_fields', staleFieldIds)
      await deleteRowsByIdsInChunks(client, 'logical_tables', staleTableIds)

      // Refresh cached version after successful save (trigger incremented it)
      const { data: updatedMeta } = await client
        .from('diagrams')
        .select('version')
        .eq('id', diagramId)
        .maybeSingle()
      const newVersion = updatedMeta?.version ?? null
      set({ saveStatus: 'saved', diagramVersion: newVersion })

      // Notify other tabs that this diagram was saved
      broadcastDiagramSave(diagramId)
    } catch (error) {
      console.error('[saveLogical] failed', error)
      set({ saveStatus: 'error' })
      throw error
    }
  }
})
