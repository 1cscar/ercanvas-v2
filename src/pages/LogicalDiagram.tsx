import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  BackgroundVariant,
  Connection,
  Edge,
  EdgeChange,
  MarkerType,
  Node,
  NodeChange,
  Position,
  ReactFlowInstance,
  ReactFlowProvider
} from '@xyflow/react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import LogicalFieldEdge from '../components/edges/LogicalFieldEdge'
import { ImageImportModal } from '../components/ImageImportModal'
import LogicalTableNode, { LogicalTableNodeData } from '../components/nodes/LogicalTableNode'
import { FieldToolbar } from '../components/toolbars/FieldToolbar'
import { GeminiNormalizeModal } from '../components/toolbars/GeminiNormalizeModal'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import {
  buildBilingualNameMappingCsv,
  buildMySqlDDL,
  normalizeLogicalModelForMySQL,
  suggestEnglishIdentifier,
  translateLogicalNamesByGeminiForSql
} from '../lib/logicalSql'
import { supabase } from '../lib/supabase'
import { LogicalVisionResult } from '../lib/VisionService'
import { buildLogicalCanvasFromVision } from '../lib/visionImport'
import { SMALL_SCHEMA_ATTR_LIMIT } from '../config/limits'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge, LogicalField, LogicalTable } from '../types'

const parseFieldIdFromHandle = (handle?: string | null) => {
  if (!handle) return null
  const match = handle.match(/field-(?:source|target)-(.+)/)
  return match?.[1] ?? null
}

const LOGICAL_TABLE_MIN_WIDTH = 360
const LOGICAL_TABLE_HEADER_HEIGHT = 56
const LOGICAL_TABLE_FIELD_WIDTH = 196
const LOGICAL_TABLE_BODY_HEIGHT = 116

const estimateTableHeight = (_fieldCount: number) => LOGICAL_TABLE_HEADER_HEIGHT + LOGICAL_TABLE_BODY_HEIGHT

const estimateTableWidth = (fieldCount: number) =>
  Math.max(LOGICAL_TABLE_MIN_WIDTH, Math.max(fieldCount, 1) * LOGICAL_TABLE_FIELD_WIDTH)

const NORMALIZED_LAYOUT_START_X = 120
const NORMALIZED_LAYOUT_START_Y = 120
const NORMALIZED_LAYOUT_HORIZONTAL_GAP = 120
const FITVIEW_MIN_ZOOM = 0.05
const FITVIEW_MAX_ZOOM = 4
const FITVIEW_PADDING = 0.2
const EXPORT_FITVIEW_PADDING = 0.28
const FITVIEW_VIEWPORT_DELTA_THRESHOLD = 0.5

const sanitizeRequiredText = (value: unknown, fallback: string) => {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return text || fallback
}

const sanitizeNullableText = (value: unknown) => {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => sanitizeNullableText(item))
    .filter((item): item is string => item !== null)
}

const toBoolean = (value: unknown) => value === true

const sanitizeNormalizedField = (
  field: LogicalField,
  tableId: string,
  fallbackIndex: number
): LogicalField => ({
  id: field.id,
  table_id: tableId,
  name: sanitizeRequiredText(field.name, `欄位${fallbackIndex + 1}`),
  name_en: sanitizeNullableText(field.name_en),
  order_index: Number.isFinite(field.order_index) ? Math.max(0, Math.floor(field.order_index)) : fallbackIndex,
  is_pk: toBoolean(field.is_pk),
  is_fk: toBoolean(field.is_fk),
  is_multi_value: toBoolean(field.is_multi_value),
  is_composite: toBoolean(field.is_composite),
  composite_children: sanitizeStringArray(field.composite_children),
  partial_dep_on: sanitizeStringArray(field.partial_dep_on),
  transitive_dep_via: sanitizeNullableText(field.transitive_dep_via),
  fk_ref_table: sanitizeNullableText(field.fk_ref_table),
  fk_ref_field: sanitizeNullableText(field.fk_ref_field),
  fk_ref_table_en: sanitizeNullableText(field.fk_ref_table_en),
  fk_ref_field_en: sanitizeNullableText(field.fk_ref_field_en),
  data_type: sanitizeNullableText(field.data_type),
  is_not_null: toBoolean(field.is_not_null) || toBoolean(field.is_pk),
  default_value: sanitizeNullableText(field.default_value)
})

const sanitizeNormalizedTablesForInsert = (tables: LogicalTable[]): LogicalTable[] =>
  tables.map((table, tableIndex) => {
    const sanitizedFields = table.fields
      .map((field, fieldIndex) => sanitizeNormalizedField(field, table.id, fieldIndex))
      .sort((left, right) => left.order_index - right.order_index)
      .map((field, fieldIndex) => ({ ...field, order_index: fieldIndex }))

    return {
      ...table,
      name: sanitizeRequiredText(table.name, `正規化資料表${tableIndex + 1}`),
      name_en: sanitizeNullableText(table.name_en),
      fields: sanitizedFields
    }
  })

const buildLegacyLogicalTableRow = (table: LogicalTable, diagramId: string) => ({
  id: table.id,
  diagram_id: diagramId,
  name: sanitizeRequiredText(table.name, '資料表'),
  x: table.x,
  y: table.y
})

const buildLegacyLogicalFieldRow = (field: LogicalField, tableId: string, fallbackIndex: number) => ({
  id: field.id,
  table_id: tableId,
  name: sanitizeRequiredText(field.name, `欄位${fallbackIndex + 1}`),
  order_index: Number.isFinite(field.order_index) ? Math.max(0, Math.floor(field.order_index)) : fallbackIndex,
  is_pk: toBoolean(field.is_pk),
  is_fk: toBoolean(field.is_fk),
  is_multi_value: toBoolean(field.is_multi_value),
  is_composite: toBoolean(field.is_composite),
  composite_children: sanitizeStringArray(field.composite_children),
  partial_dep_on: sanitizeStringArray(field.partial_dep_on),
  transitive_dep_via: sanitizeNullableText(field.transitive_dep_via),
  fk_ref_table: sanitizeNullableText(field.fk_ref_table),
  fk_ref_field: sanitizeNullableText(field.fk_ref_field)
})

const formatDbError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return String(error)

  const payload = error as Record<string, unknown>
  const code = typeof payload.code === 'string' ? payload.code : null
  const message = typeof payload.message === 'string' ? payload.message : null
  const details = typeof payload.details === 'string' ? payload.details : null
  const hint = typeof payload.hint === 'string' ? payload.hint : null

  const parts = [code, message, details, hint].filter((value): value is string => Boolean(value))
  if (parts.length > 0) return parts.join(' | ')

  try {
    return JSON.stringify(payload)
  } catch {
    return String(error)
  }
}

const layoutNormalizedTablesHorizontal = (tables: LogicalTable[]) => {
  let x = NORMALIZED_LAYOUT_START_X

  return tables.map((table) => {
    const positioned: LogicalTable = { ...table, x, y: NORMALIZED_LAYOUT_START_Y }
    x += estimateTableWidth(table.fields.length) + NORMALIZED_LAYOUT_HORIZONTAL_GAP
    return positioned
  })
}

const remapTablesForDiagram = (tables: LogicalTable[], nextDiagramId: string): LogicalTable[] =>
  tables.map((table) => {
    const nextTableId = crypto.randomUUID()
    const nextFields = table.fields.map((field, index) => ({
      ...field,
      id: crypto.randomUUID(),
      table_id: nextTableId,
      order_index: index
    }))
    return {
      ...table,
      id: nextTableId,
      diagram_id: nextDiagramId,
      fields: nextFields
    }
  })

const normalizeKey = (value: string) => value.trim().toLowerCase()

const buildEdgesFromFKRefs = (tables: LogicalTable[], diagramId: string): LogicalEdge[] => {
  const tableByName = new Map<string, LogicalTable>()
  for (const table of tables) {
    const key = normalizeKey(table.name)
    if (!tableByName.has(key)) {
      tableByName.set(key, table)
    }
  }

  const dedupe = new Set<string>()
  const edges: LogicalEdge[] = []

  for (const sourceTable of tables) {
    for (const sourceField of sourceTable.fields) {
      if (!sourceField.is_fk) continue
      const refTableName = sourceField.fk_ref_table?.trim()
      if (!refTableName) continue

      const refKey = normalizeKey(refTableName)
      const targetTable =
        tableByName.get(refKey) ??
        tables.find((table) => normalizeKey(table.name).includes(refKey) || refKey.includes(normalizeKey(table.name)))
      if (!targetTable) continue

      const targetField =
        targetTable.fields.find((field) => normalizeKey(field.name) === normalizeKey(sourceField.fk_ref_field ?? '')) ??
        targetTable.fields.find((field) => field.is_pk) ??
        targetTable.fields[0]
      if (!targetField) continue

      const dedupeKey = `${sourceTable.id}:${sourceField.id}->${targetTable.id}:${targetField.id}`
      if (dedupe.has(dedupeKey)) continue
      dedupe.add(dedupeKey)

      edges.push({
        id: crypto.randomUUID(),
        diagram_id: diagramId,
        source_table_id: sourceTable.id,
        source_field_id: sourceField.id,
        target_table_id: targetTable.id,
        target_field_id: targetField.id,
        edge_type: 'fk'
      })
    }
  }

  return edges
}

const reconcileLogicalEdges = (tables: LogicalTable[], edges: LogicalEdge[]): LogicalEdge[] => {
  const sortedFieldsByTable = new Map(
    tables.map((table) => [
      table.id,
      [...table.fields].sort((a, b) => a.order_index - b.order_index)
    ])
  )

  return edges.flatMap((edge) => {
    const sourceFields = sortedFieldsByTable.get(edge.source_table_id) ?? []
    const targetFields = sortedFieldsByTable.get(edge.target_table_id) ?? []
    if (sourceFields.length === 0 || targetFields.length === 0) return []

    const sourceField =
      sourceFields.find((field) => field.id === edge.source_field_id) ??
      sourceFields.find((field) => field.is_fk) ??
      sourceFields[0]
    const targetField =
      targetFields.find((field) => field.id === edge.target_field_id) ??
      targetFields.find((field) => field.is_pk) ??
      targetFields[0]
    if (!sourceField || !targetField) return []

    return [
      {
        ...edge,
        source_field_id: sourceField.id,
        target_field_id: targetField.id
      }
    ]
  })
}

const areLogicalEdgesEqual = (left: LogicalEdge[], right: LogicalEdge[]) =>
  left.length === right.length &&
  left.every(
    (edge, index) =>
      edge.id === right[index]?.id &&
      edge.diagram_id === right[index]?.diagram_id &&
      edge.source_table_id === right[index]?.source_table_id &&
      edge.source_field_id === right[index]?.source_field_id &&
      edge.target_table_id === right[index]?.target_table_id &&
      edge.target_field_id === right[index]?.target_field_id &&
      edge.edge_type === right[index]?.edge_type
  )

type LogicalFlowNode = Node<LogicalTableNodeData>
type DiagramBootstrapState = {
  bootstrap?: {
    diagramId: string
    tables: LogicalTable[]
    edges: LogicalEdge[]
  }
}

const nodeTypes: Record<string, ComponentType<any>> = {
  logicalTable: LogicalTableNode
}

const edgeTypes = {
  logicalFieldEdge: LogicalFieldEdge
}

type LogicalSnapshot = {
  tables: LogicalTable[]
  edges: LogicalEdge[]
}

const cloneLogicalSnapshot = (snapshot: LogicalSnapshot): LogicalSnapshot => {
  if (typeof structuredClone === 'function') return structuredClone(snapshot)
  return JSON.parse(JSON.stringify(snapshot)) as LogicalSnapshot
}

const isTextEditingTarget = (target: EventTarget | null) => {
  if (!target) return false
  let element: HTMLElement | null = null
  if (target instanceof HTMLElement) {
    element = target
  } else if (typeof target === 'object' && target !== null && 'parentElement' in target) {
    const parent = (target as { parentElement: Element | null }).parentElement
    element = parent instanceof HTMLElement ? parent : null
  }
  if (!element) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
}

function LogicalDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = Boolean(shareToken) && sharePermission === 'viewer'
  const [converting, setConverting] = useState(false)
  const [geminiNormalizeOpen, setGeminiNormalizeOpen] = useState(false)
  const [imageImportOpen, setImageImportOpen] = useState(false)
  const [diagramName, setDiagramName] = useState('未命名邏輯模型')
  const [editingDiagramName, setEditingDiagramName] = useState(false)
  const [diagramNameDraft, setDiagramNameDraft] = useState('')
  const [isComposingTitle, setIsComposingTitle] = useState(false)
  const [placingTable, setPlacingTable] = useState(false)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set())
  const [autoSaveReady, setAutoSaveReady] = useState(false)
  const [exportingSql, setExportingSql] = useState(false)
  const [largeSchemaTipCollapsed, setLargeSchemaTipCollapsed] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [historyState, setHistoryState] = useState<{ entries: LogicalSnapshot[]; index: number }>({
    entries: [],
    index: -1
  })
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<LogicalFlowNode, Edge> | null>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<LogicalFlowNode, Edge> | null>(null)
  const logicalAutoSaveTimerRef = useRef<number | null>(null)
  const diagramExportRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const logicalAutoSaveStartedRef = useRef(false)
  const latestLogicalSaveRef = useRef<() => Promise<void> | void>(() => {})
  const applyingHistoryRef = useRef(false)

  const logicalTables = useDiagramStore((state) => state.logicalTables)
  const logicalEdges = useDiagramStore((state) => state.logicalEdges)
  const selectedFieldId = useDiagramStore((state) => state.selectedFieldId)
  const connectingFieldId = useDiagramStore((state) => state.connectingFieldId)
  const saveStatus = useDiagramStore((state) => state.saveStatus)
  const staleDataWarning = useDiagramStore((state) => state.staleDataWarning)
  const setStaleDataWarning = useDiagramStore((state) => state.setStaleDataWarning)

  const setLogicalTables = useDiagramStore((state) => state.setLogicalTables)
  const setLogicalEdges = useDiagramStore((state) => state.setLogicalEdges)
  const deleteLogicalTable = useDiagramStore((state) => state.deleteLogicalTable)
  const addLogicalField = useDiagramStore((state) => state.addLogicalField)
  const deleteLogicalField = useDiagramStore((state) => state.deleteLogicalField)
  const setSelectedFieldId = useDiagramStore((state) => state.setSelectedFieldId)
  const setConnectingFieldId = useDiagramStore((state) => state.setConnectingFieldId)
  const updateFieldName = useDiagramStore((state) => state.updateFieldName)
  const moveLogicalField = useDiagramStore((state) => state.moveLogicalField)
  const loadLogical = useDiagramStore((state) => state.loadLogical)
  const saveLogical = useDiagramStore((state) => state.saveLogical)
  const setSaveStatus = useDiagramStore((state) => state.setSaveStatus)
  const setShareContext = useDiagramStore((state) => state.setShareContext)
  const bootstrap = useMemo(() => {
    const state = location.state as DiagramBootstrapState | null
    if (!state?.bootstrap) return null
    if (!diagramId || state.bootstrap.diagramId !== diagramId) return null
    return state.bootstrap
  }, [diagramId, location.state])

  useEffect(() => {
    if (shareToken && (sharePermission === 'viewer' || sharePermission === 'editor')) {
      setShareContext(shareToken, sharePermission)
      return
    }
    setShareContext(null, null)
  }, [setShareContext, sharePermission, shareToken])

  const saveStatusText =
    saveStatus === 'saving'
      ? '儲存中…'
      : saveStatus === 'saved'
        ? '已儲存'
        : saveStatus === 'error'
          ? '儲存失敗'
          : '未儲存'

  const createEmptyTable = useCallback(
    (x: number, y: number): LogicalTable => ({
      id: crypto.randomUUID(),
      diagram_id: diagramId ?? '',
      name: '資料表',
      name_en: null,
      x,
      y,
      fields: [
        {
          id: crypto.randomUUID(),
          table_id: '',
          name: 'id',
          name_en: 'id',
          order_index: 0,
          is_pk: true,
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
          data_type: 'INT',
          is_not_null: false,
          default_value: null
        }
      ]
    }),
    [diagramId]
  )

  useEffect(() => {
    setAutoSaveReady(false)
    setHistoryState({ entries: [], index: -1 })
    setLogicalTables([])
    setLogicalEdges([])
    setSelectedFieldId(null)
    setConnectingFieldId(null)
    setLargeSchemaTipCollapsed(false)
    setSaveStatus('idle')
    if (!diagramId) return

    if (bootstrap) {
      setLogicalTables(bootstrap.tables)
      setLogicalEdges(bootstrap.edges)
      setAutoSaveReady(true)
      setSaveStatus('saved')
      window.setTimeout(() => {
        void saveLogical(diagramId)
      }, 0)
      return
    }

    void (async () => {
      let loaded = false
      try {
        await loadLogical(diagramId)
        loaded = true
      } catch (error) {
        console.error('[LogicalDiagram] load failed', error)
      } finally {
        setAutoSaveReady(loaded)
        if (loaded) setSaveStatus('saved')
        if (!loaded) setSaveStatus('error')
      }
    })()
  }, [
    bootstrap,
    diagramId,
    loadLogical,
    saveLogical,
    setConnectingFieldId,
    setLogicalEdges,
    setLogicalTables,
    setSaveStatus,
    setSelectedFieldId
  ])

  useEffect(() => {
    if (!diagramId) return
    void (async () => {
      const { data } = await supabase.from('diagrams').select('name').eq('id', diagramId).single()
      if (!data?.name) return
      setDiagramName(data.name)
      setDiagramNameDraft(data.name)
    })()
  }, [diagramId])

  useEffect(() => {
    if (!editingDiagramName || !titleRef.current) return
    titleRef.current.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(titleRef.current)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [editingDiagramName])

  const commitDiagramName = useCallback(async () => {
    const newName = diagramNameDraft.trim() || diagramName
    setEditingDiagramName(false)
    if (newName === diagramName || !diagramId) return
    setDiagramName(newName)
    setDiagramNameDraft(newName)
    await supabase.from('diagrams').update({ name: newName }).eq('id', diagramId)
  }, [diagramId, diagramName, diagramNameDraft])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacingTable(false)
        setConnectingFieldId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setConnectingFieldId])

  useEffect(() => {
    if (!autoSaveReady) return
    const currentSnapshot = cloneLogicalSnapshot({ tables: logicalTables, edges: logicalEdges })

    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false
      return
    }

    setHistoryState((previous) => {
      const current = previous.index >= 0 ? previous.entries[previous.index] : null
      if (current && JSON.stringify(current) === JSON.stringify(currentSnapshot)) return previous

      const truncated = previous.entries.slice(0, previous.index + 1)
      const next = [...truncated, currentSnapshot]
      const bounded = next.length > 80 ? next.slice(next.length - 80) : next
      return {
        entries: bounded,
        index: bounded.length - 1
      }
    })
  }, [autoSaveReady, logicalEdges, logicalTables])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isReadOnly) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedEdgeIds.size === 0) return

      const target = event.target as HTMLElement | null
      if (target) {
        const tagName = target.tagName
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) return
      }

      event.preventDefault()
      setLogicalEdges(logicalEdges.filter((edge) => !selectedEdgeIds.has(edge.id)))
      setSelectedEdgeIds(new Set())
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isReadOnly, logicalEdges, selectedEdgeIds, setLogicalEdges])

  const canUndo = historyState.index > 0
  const canRedo = historyState.index >= 0 && historyState.index < historyState.entries.length - 1

  const handleUndo = useCallback(() => {
    if (isReadOnly || !canUndo) return
    const snapshot = historyState.entries[historyState.index - 1]
    if (!snapshot) return

    applyingHistoryRef.current = true
    const next = cloneLogicalSnapshot(snapshot)
    setLogicalTables(next.tables)
    setLogicalEdges(next.edges)
    setSelectedFieldId(null)
    setConnectingFieldId(null)
    setSelectedEdgeIds(new Set())
    setHistoryState((previous) => ({ ...previous, index: Math.max(0, previous.index - 1) }))
  }, [
    canUndo,
    historyState.entries,
    historyState.index,
    isReadOnly,
    setConnectingFieldId,
    setLogicalEdges,
    setLogicalTables,
    setSelectedFieldId
  ])

  const handleRedo = useCallback(() => {
    if (isReadOnly || !canRedo) return
    const snapshot = historyState.entries[historyState.index + 1]
    if (!snapshot) return

    applyingHistoryRef.current = true
    const next = cloneLogicalSnapshot(snapshot)
    setLogicalTables(next.tables)
    setLogicalEdges(next.edges)
    setSelectedFieldId(null)
    setConnectingFieldId(null)
    setSelectedEdgeIds(new Set())
    setHistoryState((previous) => ({
      ...previous,
      index: Math.min(previous.entries.length - 1, previous.index + 1)
    }))
  }, [
    canRedo,
    historyState.entries,
    historyState.index,
    isReadOnly,
    setConnectingFieldId,
    setLogicalEdges,
    setLogicalTables,
    setSelectedFieldId
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return
      const withMeta = event.metaKey || event.ctrlKey
      if (!withMeta) return

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleRedo, handleUndo])

  useEffect(() => {
    const instance = flowInstanceRef.current ?? flowInstance
    if (!instance) return
    setZoomPercent(Math.round(instance.getZoom() * 100))
  }, [flowInstance])

  const handleFitView = useCallback(async (padding = FITVIEW_PADDING) => {
    const instance = flowInstanceRef.current ?? flowInstance
    if (!instance || !instance.viewportInitialized) return

    const visibleNodes = instance.getNodes().filter((node) => !node.hidden)
    if (visibleNodes.length === 0) return

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    const beforeViewport = instance.getViewport()
    try {
      await instance.fitBounds(instance.getNodesBounds(visibleNodes), {
        padding,
        duration: 240
      })
    } catch {
      // fallback below
    }

    const afterViewport = instance.getViewport()
    const viewportChanged =
      Math.abs(afterViewport.x - beforeViewport.x) > FITVIEW_VIEWPORT_DELTA_THRESHOLD ||
      Math.abs(afterViewport.y - beforeViewport.y) > FITVIEW_VIEWPORT_DELTA_THRESHOLD ||
      Math.abs(afterViewport.zoom - beforeViewport.zoom) > 0.001

    if (!viewportChanged) {
      // Nudge viewport once, then retry fitBounds to avoid edge cases where first call is ignored.
      await instance.setViewport(
        {
          x: beforeViewport.x,
          y: beforeViewport.y,
          zoom: Math.max(FITVIEW_MIN_ZOOM, Math.min(FITVIEW_MAX_ZOOM, beforeViewport.zoom * 0.9))
        },
        { duration: 0 }
      )
      await instance.fitBounds(instance.getNodesBounds(visibleNodes), {
        padding,
        duration: 240
      })
    }

    setZoomPercent(Math.round(instance.getZoom() * 100))
  }, [flowInstance])

  const handleZoomIn = useCallback(() => {
    const instance = flowInstanceRef.current ?? flowInstance
    if (!instance) return
    void instance.zoomIn({ duration: 160 })
  }, [flowInstance])

  const handleZoomOut = useCallback(() => {
    const instance = flowInstanceRef.current ?? flowInstance
    if (!instance) return
    void instance.zoomOut({ duration: 160 })
  }, [flowInstance])

  useEffect(() => {
    if (logicalTables.length === 0) return
    const timer = window.setTimeout(() => {
      void handleFitView()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [handleFitView, logicalTables.length])

  const normalizeModelBeforeExport = useCallback(
    (interactive: boolean) => {
      const normalized = normalizeLogicalModelForMySQL(logicalTables)
      const hasTableUpdates = JSON.stringify(normalized.tables) !== JSON.stringify(logicalTables)
      if (hasTableUpdates) {
        setLogicalTables(normalized.tables)
      }

      if (normalized.issues.length > 0) {
        if (interactive) {
          const preview = normalized.issues
            .slice(0, 8)
            .map((issue, index) => `${index + 1}. ${issue.message}`)
            .join('\n')
          const suffix = normalized.issues.length > 8 ? `\n...還有 ${normalized.issues.length - 8} 筆` : ''
          window.alert(`目前模型尚未符合 MySQL 匯出要求，請先修正：\n${preview}${suffix}`)
        }
        return { ok: false, tables: normalized.tables }
      }

      return { ok: true, tables: normalized.tables }
    },
    [logicalTables, setLogicalTables]
  )

  useEffect(() => {
    latestLogicalSaveRef.current = () => {
      if (isReadOnly) return
      if (!autoSaveReady) return
      if (!diagramId) return
      void saveLogical(diagramId)
    }
  }, [autoSaveReady, diagramId, isReadOnly, saveLogical])

  useEffect(() => {
    return () => {
      if (logicalAutoSaveTimerRef.current === null) return
      window.clearTimeout(logicalAutoSaveTimerRef.current)
      logicalAutoSaveTimerRef.current = null
      void latestLogicalSaveRef.current()
    }
  }, [])

  useEffect(() => {
    if (isReadOnly || !autoSaveReady || !diagramId) {
      logicalAutoSaveStartedRef.current = false
      if (logicalAutoSaveTimerRef.current !== null) {
        window.clearTimeout(logicalAutoSaveTimerRef.current)
        logicalAutoSaveTimerRef.current = null
      }
      return
    }

    if (!logicalAutoSaveStartedRef.current) {
      logicalAutoSaveStartedRef.current = true
      return
    }

    if (logicalAutoSaveTimerRef.current !== null) {
      window.clearTimeout(logicalAutoSaveTimerRef.current)
    }

    logicalAutoSaveTimerRef.current = window.setTimeout(() => {
      logicalAutoSaveTimerRef.current = null
      void saveLogical(diagramId)
    }, 700)

    return () => {
      if (logicalAutoSaveTimerRef.current === null) return
      window.clearTimeout(logicalAutoSaveTimerRef.current)
      logicalAutoSaveTimerRef.current = null
    }
  }, [autoSaveReady, diagramId, isReadOnly, logicalEdges, logicalTables, saveLogical])

  const handleDeleteTable = useCallback(
    (tableId: string) => {
      if (isReadOnly) return
      const table = logicalTables.find((targetTable) => targetTable.id === tableId)
      if (!table) return
      if (connectingFieldId && table.fields.some((field) => field.id === connectingFieldId)) {
        setConnectingFieldId(null)
      }
      deleteLogicalTable(tableId)
    },
    [connectingFieldId, deleteLogicalTable, isReadOnly, logicalTables, setConnectingFieldId]
  )

  const nodes = useMemo<LogicalFlowNode[]>(
    () =>
      logicalTables.map((table) => {
        const nodeWidth = estimateTableWidth(table.fields.length)
        const nodeHeight = estimateTableHeight(table.fields.length)
        return {
        id: table.id,
        type: 'logicalTable',
        position: { x: table.x, y: table.y },
        width: nodeWidth,
        height: nodeHeight,
        handles: [
          { id: 'node-target', type: 'target' as const, position: Position.Top, x: nodeWidth / 2 - 4, y: 0, width: 8, height: 8 },
          { id: 'node-source', type: 'source' as const, position: Position.Bottom, x: nodeWidth / 2 - 4, y: nodeHeight - 8, width: 8, height: 8 },
        ],
        data: {
          table,
          selectedFieldId,
          onSelectField: (tableId, fieldId) => {
            setSelectedFieldId(fieldId)
            if (isReadOnly) return
            if (!connectingFieldId || connectingFieldId === fieldId) return

            const sourceTable = logicalTables.find((targetTable) =>
              targetTable.fields.some((field) => field.id === connectingFieldId)
            )
            if (!sourceTable) return

            const newEdge: LogicalEdge = {
              id: crypto.randomUUID(),
              diagram_id: diagramId ?? '',
              source_table_id: sourceTable.id,
              source_field_id: connectingFieldId,
              target_table_id: tableId,
              target_field_id: fieldId,
              edge_type: 'fk'
            }
            const currentEdges = useDiagramStore.getState().logicalEdges
            const duplicate = currentEdges.some(
              (edge) =>
                edge.source_table_id === newEdge.source_table_id &&
                edge.source_field_id === newEdge.source_field_id &&
                edge.target_table_id === newEdge.target_table_id &&
                edge.target_field_id === newEdge.target_field_id
            )
            if (!duplicate) {
              setLogicalEdges([...currentEdges, newEdge])
            }
            setConnectingFieldId(null)
          },
          onUpdateFieldName: (tableId, fieldId, name) => updateFieldName(tableId, fieldId, name),
          onUpdateTableName: (tableId, name) =>
            setLogicalTables(
              logicalTables.map((table) => (table.id === tableId ? { ...table, name } : table))
            ),
          onMoveField: (tableId, fromIndex, toIndex) => moveLogicalField(tableId, fromIndex, toIndex),
          onAddFieldBelow: isReadOnly
            ? undefined
            : (tableId, index) => addLogicalField(tableId, index),
          onDeleteField: isReadOnly
            ? undefined
            : (tableId, fieldId) => deleteLogicalField(tableId, fieldId),
          onDeleteTable: isReadOnly ? undefined : handleDeleteTable
        }
      }}),
    [
      connectingFieldId,
      diagramId,
      logicalTables,
      moveLogicalField,
      addLogicalField,
      deleteLogicalField,
      selectedFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId,
      handleDeleteTable,
      updateFieldName,
      isReadOnly
    ]
  )

  const handleSelectEdge = useCallback(
    (edgeId: string, additive: boolean) => {
      setSelectedFieldId(null)
      setConnectingFieldId(null)
      setSelectedEdgeIds((previous) => {
        if (!additive) return new Set([edgeId])
        const next = new Set(previous)
        if (next.has(edgeId)) next.delete(edgeId)
        else next.add(edgeId)
        return next
      })
    },
    [setSelectedFieldId, setConnectingFieldId]
  )

  const edges = useMemo<Edge[]>(
    () =>
      reconcileLogicalEdges(logicalTables, logicalEdges).map((edge) => ({
        id: edge.id,
        source: edge.source_table_id,
        target: edge.target_table_id,
        type: 'logicalFieldEdge',
        selectable: true,
        selected: selectedEdgeIds.has(edge.id),
        data: {
          sourceFieldId: edge.source_field_id,
          targetFieldId: edge.target_field_id,
          onSelectEdge: handleSelectEdge
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#111827' }
      })),
    [handleSelectEdge, logicalEdges, logicalTables, selectedEdgeIds]
  )

  useEffect(() => {
    if (logicalTables.length === 0 && logicalEdges.length === 0) return
    const reconciledEdges = reconcileLogicalEdges(logicalTables, logicalEdges)
    if (areLogicalEdgesEqual(logicalEdges, reconciledEdges)) return
    setLogicalEdges(reconciledEdges)
  }, [logicalEdges, logicalTables, setLogicalEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange<LogicalFlowNode>[]) => {
      if (isReadOnly) return
      const changedNodes = applyNodeChanges(changes, nodes)
      const remainingIds = new Set(changedNodes.map((node) => node.id))
      const removedTables = logicalTables.filter((table) => !remainingIds.has(table.id))
      const removedFieldIds = new Set(
        removedTables.flatMap((table) => table.fields.map((field) => field.id))
      )

      setLogicalTables(
        logicalTables
          .filter((table) => remainingIds.has(table.id))
          .map((table) => {
            const changed = changedNodes.find((node) => node.id === table.id)
            if (!changed) return table
            return {
              ...table,
              x: changed.position.x,
              y: changed.position.y
            }
          })
      )

      if (removedTables.length > 0) {
        const removedTableIds = new Set(removedTables.map((table) => table.id))
        setLogicalEdges(
          logicalEdges.filter(
            (edge) =>
              !removedTableIds.has(edge.source_table_id) &&
              !removedTableIds.has(edge.target_table_id) &&
              !removedFieldIds.has(edge.source_field_id) &&
              !removedFieldIds.has(edge.target_field_id)
          )
        )
      }
      if (selectedFieldId && removedFieldIds.has(selectedFieldId)) {
        setSelectedFieldId(null)
      }
      if (connectingFieldId && removedFieldIds.has(connectingFieldId)) {
        setConnectingFieldId(null)
      }
    },
    [
      connectingFieldId,
      isReadOnly,
      logicalEdges,
      logicalTables,
      nodes,
      selectedFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId
    ]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (isReadOnly) return

      const selectionChanges = changes.filter(
        (change): change is EdgeChange<Edge> & { type: 'select'; selected: boolean } => change.type === 'select'
      )
      if (selectionChanges.length > 0) {
        setSelectedEdgeIds((previous) => {
          const next = new Set(previous)
          for (const change of selectionChanges) {
            if (change.selected) next.add(change.id)
            else next.delete(change.id)
          }
          return next
        })
      }

      const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
      const hasRemove = removedIds.size > 0

      if (hasRemove) {
        const updatedEdges = applyEdgeChanges(changes, edges)
        const mapped = updatedEdges
          .map((edge) => {
            const sourceFieldId =
              typeof edge.data === 'object' && edge.data && 'sourceFieldId' in edge.data
                ? String((edge.data as Record<string, unknown>).sourceFieldId ?? '')
                : ''
            const targetFieldId =
              typeof edge.data === 'object' && edge.data && 'targetFieldId' in edge.data
                ? String((edge.data as Record<string, unknown>).targetFieldId ?? '')
                : ''
            if (!edge.source || !edge.target || !sourceFieldId || !targetFieldId) return null
            return {
              id: edge.id,
              diagram_id: diagramId ?? '',
              source_table_id: edge.source,
              source_field_id: sourceFieldId,
              target_table_id: edge.target,
              target_field_id: targetFieldId,
              edge_type: 'fk'
            }
          })
          .filter((edge): edge is LogicalEdge => edge !== null)
        setLogicalEdges(mapped)
        setSelectedEdgeIds((previous) => {
          const next = new Set(previous)
          for (const removedId of removedIds) {
            next.delete(removedId)
          }
          return next
        })
      }
    },
    [diagramId, edges, isReadOnly, setLogicalEdges]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isReadOnly) return
      const sourceFieldId = parseFieldIdFromHandle(connection.sourceHandle)
      const targetFieldId = parseFieldIdFromHandle(connection.targetHandle)
      if (!connection.source || !connection.target || !sourceFieldId || !targetFieldId) return

      const rfEdge = addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          type: 'logicalFieldEdge',
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          zIndex: 1200,
          data: {
            sourceFieldId,
            targetFieldId
          },
          markerEnd: { type: MarkerType.ArrowClosed }
        },
        edges
      )

      const mapped = rfEdge
        .map((edge) => {
          const sourceField =
            typeof edge.data === 'object' && edge.data && 'sourceFieldId' in edge.data
              ? String((edge.data as Record<string, unknown>).sourceFieldId ?? '')
              : ''
          const targetField =
            typeof edge.data === 'object' && edge.data && 'targetFieldId' in edge.data
              ? String((edge.data as Record<string, unknown>).targetFieldId ?? '')
              : ''
          if (!edge.source || !edge.target || !sourceField || !targetField) return null

          return {
            id: edge.id,
            diagram_id: diagramId ?? '',
            source_table_id: edge.source,
            source_field_id: sourceField,
            target_table_id: edge.target,
            target_field_id: targetField,
            edge_type: 'fk'
          }
        })
        .filter((edge): edge is LogicalEdge => edge !== null)

      setLogicalEdges(mapped)
    },
    [diagramId, edges, isReadOnly, setLogicalEdges]
  )

  const selectedTable = useMemo(
    () => logicalTables.find((table) => table.fields.some((field) => field.id === selectedFieldId)) ?? null,
    [logicalTables, selectedFieldId]
  )
  const selectedField = useMemo(
    () => selectedTable?.fields.find((field) => field.id === selectedFieldId) ?? null,
    [selectedFieldId, selectedTable]
  )

  /** True when the schema is large enough that candidate key search uses the greedy fallback. */
  const isLargeSchema = useMemo(
    () => logicalTables.reduce((sum, t) => sum + t.fields.length, 0) > SMALL_SCHEMA_ATTR_LIMIT,
    [logicalTables]
  )

  const handleAutoSave = useCallback(() => {
    if (isReadOnly) return
    if (!autoSaveReady) return
    if (!diagramId) return
    void saveLogical(diagramId)
  }, [autoSaveReady, diagramId, isReadOnly, saveLogical])

  const handleExportMySql = useCallback(async () => {
    if (isReadOnly) return
    setExportingSql(true)

    try {
      const translatedTables = await translateLogicalNamesByGeminiForSql(logicalTables)
      const normalized = normalizeLogicalModelForMySQL(translatedTables)
      if (normalized.issues.length > 0) {
        const preview = normalized.issues
          .slice(0, 8)
          .map((issue, index) => `${index + 1}. ${issue.message}`)
          .join('\n')
        const suffix = normalized.issues.length > 8 ? `\n...還有 ${normalized.issues.length - 8} 筆` : ''
        window.alert(`目前模型尚未符合 MySQL 匯出要求，請先修正：\n${preview}${suffix}`)
        return
      }

      const fileBase = suggestEnglishIdentifier(diagramName || 'logical_model', 'table')
      const sql = buildMySqlDDL(normalized.tables, {
        databaseName: fileBase,
        includeDatabaseBootstrap: true,
        includeSeedData: true
      })
      const mappingCsv = buildBilingualNameMappingCsv(normalized.tables)

      const downloadFile = (content: string, type: string, filename: string) => {
        const blob = new Blob([content], { type })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }

      downloadFile(sql, 'application/sql;charset=utf-8', `${fileBase}.sql`)
      downloadFile(mappingCsv, 'text/csv;charset=utf-8', `${fileBase}_zh_en_mapping.csv`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '無法匯出 SQL，請檢查命名與欄位設定。'
      window.alert(message)
    } finally {
      setExportingSql(false)
    }
  }, [diagramName, isReadOnly, logicalTables])

  const createNormalizedLogicalDiagram = useCallback(
    async (normalizedTables: LogicalTable[]) => {
      if (!diagramId || converting) return
      if (isReadOnly) return
      if (normalizedTables.length === 0) {
        window.alert('正規化結果為空，未建立邏輯圖。請先確認邏輯圖中有可正規化欄位。')
        return
      }
      setConverting(true)

      try {
        let failedStep = 'auth.getUser'
        const { data: authData } = await supabase.auth.getUser()
        if (!authData.user) {
          window.alert('請先登入再執行正規化匯出。')
          return
        }

        const baseNormalizedDiagramName = `${diagramName}（正規化邏輯）`

        failedStep = 'diagrams.select_existing_normalized_names'
        const { data: existingNamedDiagrams, error: existingNamedError } = await supabase
          .from('diagrams')
          .select('name')
          .eq('user_id', authData.user.id)
          .eq('type', 'logical')
          .like('name', `${baseNormalizedDiagramName}%`)
        if (existingNamedError) {
          throw new Error(`[${failedStep}] ${formatDbError(existingNamedError)}`)
        }

        const escapedBaseName = baseNormalizedDiagramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const suffixPattern = new RegExp(`^${escapedBaseName}\\((\\d+)\\)$`)
        let baseNameExists = false
        let maxSuffix = 0

        for (const row of existingNamedDiagrams ?? []) {
          const currentName = typeof row?.name === 'string' ? row.name : ''
          if (currentName === baseNormalizedDiagramName) {
            baseNameExists = true
            continue
          }
          const match = currentName.match(suffixPattern)
          if (!match) continue
          const parsed = Number.parseInt(match[1], 10)
          if (!Number.isFinite(parsed) || parsed < 1) continue
          maxSuffix = Math.max(maxSuffix, parsed)
        }

        const normalizedDiagramName = baseNameExists
          ? `${baseNormalizedDiagramName}(${maxSuffix + 1})`
          : baseNormalizedDiagramName

        failedStep = 'diagrams.insert_normalized_logical'
        const { data: createdLogicalDiagram, error: createError } = await supabase
          .from('diagrams')
          .insert({
            user_id: authData.user.id,
            name: normalizedDiagramName,
            type: 'logical',
            content: {}
          })
          .select('id')
          .single()
        if (createError) {
          throw new Error(`[${failedStep}] ${formatDbError(createError)}`)
        }
        if (!createdLogicalDiagram?.id) {
          throw new Error('[diagrams.insert_normalized_logical] 未取得新建立的正規化邏輯圖資料')
        }
        const targetDiagramId = createdLogicalDiagram.id

        const remappedTables = remapTablesForDiagram(normalizedTables, targetDiagramId)
        const sanitizedTables = sanitizeNormalizedTablesForInsert(remappedTables)
        const laidOutTables = layoutNormalizedTablesHorizontal(sanitizedTables)
        if (laidOutTables.length === 0) {
          throw new Error('正規化結果沒有可建立的資料表。')
        }
        const normalizedEdges = buildEdgesFromFKRefs(laidOutTables, targetDiagramId)

        const tableRows = laidOutTables.map((table) => buildLegacyLogicalTableRow(table, targetDiagramId))
        if (tableRows.length > 0) {
          failedStep = 'logical_tables.insert'
          const { error } = await supabase.from('logical_tables').insert(tableRows)
          if (error) throw new Error(`[${failedStep}] ${formatDbError(error)}`)
        }

        const fieldRows = laidOutTables.flatMap((table) =>
          table.fields.map((field, fieldIndex) => buildLegacyLogicalFieldRow(field, table.id, fieldIndex))
        )
        if (fieldRows.length > 0) {
          failedStep = 'logical_fields.insert'
          const { error } = await supabase.from('logical_fields').insert(fieldRows)
          if (error) throw new Error(`[${failedStep}] ${formatDbError(error)}`)
        }

        if (normalizedEdges.length > 0) {
          failedStep = 'logical_edges.insert'
          const { error } = await supabase.from('logical_edges').insert(normalizedEdges)
          if (error) throw new Error(`[${failedStep}] ${formatDbError(error)}`)
        }

        navigate(`/diagram/logical/${targetDiagramId}`, {
          state: {
            bootstrap: {
              diagramId: targetDiagramId,
              tables: laidOutTables,
              edges: normalizedEdges
            }
          },
          replace: targetDiagramId === diagramId
        })
      } catch (error) {
        console.error('[createNormalizedLogicalDiagram] failed', error)
        const detail = formatDbError(error)
        window.alert(`建立正規化邏輯圖失敗。\n${detail}`)
      } finally {
        setConverting(false)
      }
    },
    [converting, diagramId, diagramName, isReadOnly, navigate]
  )

  const handleImportFromImage = useCallback(
    (result: LogicalVisionResult) => {
      if (isReadOnly) return
      const imported = buildLogicalCanvasFromVision(result, diagramId ?? '')
      if (imported.tables.length === 0) {
        window.alert('未偵測到可匯入的資料表，請換一張更清晰的圖片再試。')
        return false
      }

      setLogicalTables(imported.tables)
      setLogicalEdges(imported.edges)
      setSelectedFieldId(null)
      setConnectingFieldId(null)
      setPlacingTable(false)
      window.setTimeout(() => {
        flowInstance?.fitView({ padding: 0.2, duration: 320 })
      }, 80)
      return true
    },
    [
      diagramId,
      flowInstance,
      isReadOnly,
      setConnectingFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId
    ]
  )

  return (
    <div className="glass-page flex h-screen w-full flex-col">
      <header className="glass-topbar flex h-[54px] items-center justify-between px-4">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white hover:bg-blue-700">ERCanvas</button>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">邏輯模型</span>
          {editingDiagramName && !isReadOnly ? (
            <div
              ref={titleRef}
              className="nodrag rounded px-1 text-[28px] font-extrabold tracking-tight text-slate-900 outline-none ring-2 ring-blue-400"
              contentEditable
              suppressContentEditableWarning
              onInput={(event) => setDiagramNameDraft(event.currentTarget.textContent ?? '')}
              onCompositionStart={() => setIsComposingTitle(true)}
              onCompositionEnd={(event) => {
                setIsComposingTitle(false)
                setDiagramNameDraft(event.currentTarget.textContent ?? '')
              }}
              onBlur={() => void commitDiagramName()}
              onKeyDown={(event) => {
                if (isComposingTitle) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commitDiagramName()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditingDiagramName(false)
                  setDiagramNameDraft(diagramName)
                }
              }}
            >
              {diagramNameDraft}
            </div>
          ) : (
            <h1
              className={`text-[28px] font-extrabold tracking-tight text-slate-900 ${!isReadOnly ? 'cursor-text' : ''}`}
              onDoubleClick={() => {
                if (isReadOnly) return
                setDiagramNameDraft(diagramName)
                setEditingDiagramName(true)
              }}
            >
              {diagramName}
            </h1>
          )}
          {isReadOnly && (
            <span className="glass-badge ml-3 rounded px-2 py-1 text-xs font-semibold">唯讀分享</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">{saveStatusText}</span>
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
          <button
            type="button"
            className="rounded-md border border-emerald-400 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 disabled:opacity-60"
            onClick={() => void handleExportMySql()}
            disabled={isReadOnly || exportingSql}
          >
            {exportingSql ? 'Gemini 翻譯中…' : '匯出 .sql'}
          </button>
          <button
            type="button"
            className="rounded-md border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 disabled:opacity-60"
            onClick={() => setImageImportOpen(true)}
            disabled={isReadOnly}
          >
            圖片識別匯入
          </button>
        </div>
      </header>

      <div className="glass-subbar flex h-[46px] items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleUndo}
            disabled={!canUndo || isReadOnly}
          >
            ↶ 上一步
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleRedo}
            disabled={!canRedo || isReadOnly}
          >
            ↷ 下一步
          </button>
          <div className="h-5 w-px bg-slate-300" />
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700"
            onClick={() => void handleAutoSave()}
          >
            💾 存檔
          </button>
          <button
            type="button"
            className="rounded border border-emerald-400 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"
            onClick={() => void handleExportMySql()}
            disabled={isReadOnly || exportingSql}
          >
            {exportingSql ? 'Gemini 翻譯中…' : '匯出 MySQL SQL'}
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs font-bold disabled:opacity-60 ${
              placingTable ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
            onClick={() => setPlacingTable((prev) => !prev)}
            disabled={isReadOnly}
          >
            新增表
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleZoomOut}
          >
            －
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleZoomIn}
          >
            ＋
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={() => void handleFitView()}
            disabled={!flowInstance || logicalTables.length === 0}
          >
            全覽
          </button>
          <span className="px-1 text-xs font-semibold text-slate-500">{zoomPercent}%</span>
        </div>

        <div className="flex items-center gap-2">
          {connectingFieldId && (
            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
              連線模式：請點選目標欄位
            </span>
          )}
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={() => setGeminiNormalizeOpen(true)}
            disabled={isReadOnly}
          >
            Gemini 正規化分析
          </button>
        </div>
      </div>

      <main className="glass-surface flex min-h-0 flex-1">
        <aside className={`glass-sidebar flex w-[188px] shrink-0 flex-col ${isReadOnly ? 'opacity-70' : ''}`}>
          <div className="px-3 py-3 text-xs font-semibold text-slate-500">點擊後在畫布放置</div>
          <button
            type="button"
            className={`mx-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
              placingTable ? 'border-slate-900 bg-white text-slate-900' : 'border-slate-300 bg-white text-slate-700'
            }`}
            onClick={() => setPlacingTable((prev) => !prev)}
          >
            <span className="inline-block h-4 w-6 border-2 border-slate-500" />
            資料表
          </button>

          <div className="mt-auto border-t border-slate-200 p-3 text-[11px] text-slate-400">
            點選表格後可拖曳移動
            <br />
            點擊欄位可新增/刪除/連線
            <br />
            Esc 可取消放置
          </div>
        </aside>

          <section
            ref={(element) => {
              diagramExportRef.current = element
            }}
            className={`glass-surface relative min-w-0 flex-1 ${placingTable ? 'cursor-crosshair' : ''}`}
          >
            {staleDataWarning && (
            <div
              className="glass-card absolute left-1/2 top-2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-rose-800 shadow-sm"
              data-export-ignore="true"
            >
              ⚠️ 此圖表已被其他頁面修改，建議重新整理以取得最新版本。
              <button
                type="button"
                className="ml-1 rounded bg-rose-200 px-2 py-0.5 text-xs font-semibold hover:bg-rose-300"
                onClick={() => setStaleDataWarning(false)}
              >
                關閉
              </button>
            </div>
          )}

          {isLargeSchema && !largeSchemaTipCollapsed && (
            <div
              className="glass-card absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm"
              data-export-ignore="true"
            >
              <div className="flex items-center gap-2">
                <span>
                  ⚠️ 欄位數量較多（&gt;{SMALL_SCHEMA_ATTR_LIMIT}），AI 正規化候選鍵搜尋將使用貪婪演算法，結果可能為近似值。
                </span>
                <button
                  type="button"
                  className="rounded bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-300"
                  onClick={() => setLargeSchemaTipCollapsed(true)}
                >
                  收合
                </button>
              </div>
            </div>
          )}
          {isLargeSchema && largeSchemaTipCollapsed && (
            <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2" data-export-ignore="true">
              <button
                type="button"
                className="glass-card rounded-full px-3 py-1 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-50"
                onClick={() => setLargeSchemaTipCollapsed(false)}
              >
                ⚠️ 候選鍵提示（展開）
              </button>
            </div>
          )}

          <DiagramCanvas
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            saveStatus={saveStatus}
            showSaveStatus={false}
            showControls={false}
            showMiniMap={false}
            className="field-edge-canvas"
            backgroundVariant={BackgroundVariant.Lines}
            backgroundGap={22}
            backgroundSize={1}
            backgroundColor="#d5dbe3"
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(event, edge) => {
              event.stopPropagation()
              handleSelectEdge(edge.id, event.shiftKey || event.metaKey || event.ctrlKey)
            }}
            onMove={(_event, viewport) => setZoomPercent(Math.round(viewport.zoom * 100))}
            onInit={(instance) => {
              setFlowInstance(instance)
              flowInstanceRef.current = instance
              ;(window as Window & { __logicalFlow?: unknown }).__logicalFlow = instance
            }}
            onPaneClick={(event) => {
              const instance = flowInstanceRef.current ?? flowInstance
              if (placingTable && instance) {
                if (isReadOnly) return
                const pos = instance.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY
                })
                setLogicalTables([...logicalTables, createEmptyTable(pos.x, pos.y)])
                setPlacingTable(false)
                return
              }
              setSelectedFieldId(null)
              setConnectingFieldId(null)
              setSelectedEdgeIds(new Set())
            }}
            onRetrySave={handleAutoSave}
            autoSaveSessionKey={diagramId ?? null}
          />

          {!isReadOnly && selectedTable && selectedField && (
            <FieldToolbar
              table={selectedTable}
              field={selectedField}
              onStartConnect={(fieldId) => setConnectingFieldId(fieldId)}
              onDeleteTable={handleDeleteTable}
            />
          )}
        </section>
      </main>

      <GeminiNormalizeModal
        open={geminiNormalizeOpen}
        tables={logicalTables}
        diagramId={diagramId ?? ''}
        exportElement={diagramExportRef.current}
        onBeforeExport={() => handleFitView(EXPORT_FITVIEW_PADDING)}
        onClose={() => setGeminiNormalizeOpen(false)}
        onConfirmApply={(nextTables) => {
          if (isReadOnly) return
          setGeminiNormalizeOpen(false)
          void createNormalizedLogicalDiagram(nextTables)
        }}
      />

      {imageImportOpen && !isReadOnly && (
        <ImageImportModal
          mode="logical"
          onImport={handleImportFromImage}
          onClose={() => setImageImportOpen(false)}
        />
      )}
    </div>
  )
}

export default function LogicalDiagram() {
  return (
    <ReactFlowProvider>
      <LogicalDiagramInner />
    </ReactFlowProvider>
  )
}
