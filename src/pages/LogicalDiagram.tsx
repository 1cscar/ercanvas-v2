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
import { NormalizationWizard } from '../components/toolbars/NormalizationWizard'
import { AutoNormalizeModal } from '../components/toolbars/AutoNormalizeModal'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import { supabase } from '../lib/supabase'
import { LogicalVisionResult } from '../lib/VisionService'
import { buildLogicalCanvasFromVision } from '../lib/visionImport'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge, LogicalTable } from '../types'

const parseFieldIdFromHandle = (handle?: string | null) => {
  if (!handle) return null
  const match = handle.match(/field-(?:source|target)-(.+)/)
  return match?.[1] ?? null
}

const FIELD_WIDTH = 220
const MAX_TABLE_WIDTH = 1980

const estimateTableHeight = (fieldCount: number) => {
  const titleHeight = 46
  const bodyHeight = fieldCount > 0 ? 62 : 42
  return titleHeight + bodyHeight
}

const estimateTableWidth = (fieldCount: number) =>
  Math.min(MAX_TABLE_WIDTH, Math.max(280, Math.max(fieldCount, 1) * FIELD_WIDTH))

const NORMALIZED_TABLE_HEADER_HEIGHT = 56
const NORMALIZED_TABLE_FIELD_HEIGHT = 52
const NORMALIZED_LAYOUT_START_X = 120
const NORMALIZED_LAYOUT_START_Y = 90
const NORMALIZED_LAYOUT_COLUMN_GAP = 460
const NORMALIZED_LAYOUT_ROW_GAP = 56
const NORMALIZED_LAYOUT_MAX_COLUMN_HEIGHT = 1600

const estimateNormalizedTableHeight = (fieldCount: number) =>
  NORMALIZED_TABLE_HEADER_HEIGHT + Math.max(fieldCount, 1) * NORMALIZED_TABLE_FIELD_HEIGHT

const layoutNormalizedTablesVertical = (tables: LogicalTable[]) => {
  let x = NORMALIZED_LAYOUT_START_X
  let y = NORMALIZED_LAYOUT_START_Y

  return tables.map((table) => {
    const height = estimateNormalizedTableHeight(table.fields.length)
    if (y > NORMALIZED_LAYOUT_START_Y && y + height > NORMALIZED_LAYOUT_MAX_COLUMN_HEIGHT) {
      x += NORMALIZED_LAYOUT_COLUMN_GAP
      y = NORMALIZED_LAYOUT_START_Y
    }

    const positioned: LogicalTable = { ...table, x, y }
    y += height + NORMALIZED_LAYOUT_ROW_GAP
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

function LogicalDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = searchParams.get('permission') === 'viewer'
  const [converting, setConverting] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [autoNormalizeOpen, setAutoNormalizeOpen] = useState(false)
  const [imageImportOpen, setImageImportOpen] = useState(false)
  const [diagramName, setDiagramName] = useState('未命名邏輯模型')
  const [placingTable, setPlacingTable] = useState(false)
  const [autoSaveReady, setAutoSaveReady] = useState(false)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<LogicalFlowNode, Edge> | null>(null)
  const logicalAutoSaveTimerRef = useRef<number | null>(null)
  const logicalAutoSaveStartedRef = useRef(false)
  const latestLogicalSaveRef = useRef<() => void>(() => {})

  const logicalTables = useDiagramStore((state) => state.logicalTables)
  const logicalEdges = useDiagramStore((state) => state.logicalEdges)
  const selectedFieldId = useDiagramStore((state) => state.selectedFieldId)
  const connectingFieldId = useDiagramStore((state) => state.connectingFieldId)
  const saveStatus = useDiagramStore((state) => state.saveStatus)

  const setLogicalTables = useDiagramStore((state) => state.setLogicalTables)
  const setLogicalEdges = useDiagramStore((state) => state.setLogicalEdges)
  const deleteLogicalTable = useDiagramStore((state) => state.deleteLogicalTable)
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
      x,
      y,
      fields: [
        {
          id: crypto.randomUUID(),
          table_id: '',
          name: 'id',
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
          data_type: null,
          is_not_null: false,
          default_value: null
        }
      ]
    }),
    [diagramId]
  )

  useEffect(() => {
    setAutoSaveReady(false)
    setLogicalTables([])
    setLogicalEdges([])
    setSelectedFieldId(null)
    setConnectingFieldId(null)
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
      if (data?.name) setDiagramName(data.name)
    })()
  }, [diagramId])

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
    if (!flowInstance) return
    if (logicalTables.length === 0) return
    const timer = window.setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 260 })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [flowInstance, logicalTables.length])

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
      latestLogicalSaveRef.current()
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
          onDeleteTable: isReadOnly ? undefined : handleDeleteTable
        }
      }}),
    [
      connectingFieldId,
      diagramId,
      logicalTables,
      moveLogicalField,
      selectedFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId,
      handleDeleteTable,
      updateFieldName,
      isReadOnly
    ]
  )

  const edges = useMemo<Edge[]>(
    () =>
      reconcileLogicalEdges(logicalTables, logicalEdges).map((edge) => ({
        id: edge.id,
        source: edge.source_table_id,
        target: edge.target_table_id,
        type: 'logicalFieldEdge',
        zIndex: 1200,
        data: {
          sourceFieldId: edge.source_field_id,
          targetFieldId: edge.target_field_id
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#111827' }
      })),
    [logicalEdges, logicalTables]
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

  const handleAutoSave = useCallback(() => {
    if (isReadOnly) return
    if (!autoSaveReady) return
    if (!diagramId) return
    void saveLogical(diagramId)
  }, [autoSaveReady, diagramId, isReadOnly, saveLogical])

  const handleConvertToPhysical = useCallback(async () => {
    if (!diagramId || converting) return
    if (isReadOnly) return
    setConverting(true)

    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData.user) {
        window.alert('請先登入再轉換。')
        return
      }

      const { data: sourceDiagram, error: sourceError } = await supabase
        .from('diagrams')
        .select('name')
        .eq('id', diagramId)
        .single()
      if (sourceError) throw sourceError

      const { data: physicalDiagram, error: createError } = await supabase
        .from('diagrams')
        .insert({
          user_id: authData.user.id,
          name: `${sourceDiagram?.name ?? '邏輯圖'}（實體）`,
          type: 'physical',
          content: {}
        })
        .select('*')
        .single()
      if (createError || !physicalDiagram) throw createError

      const tableIdMap = new Map<string, string>()
      for (const table of logicalTables) {
        tableIdMap.set(table.id, crypto.randomUUID())
      }

      const fieldIdMap = new Map<string, string>()
      for (const table of logicalTables) {
        for (const field of table.fields) {
          fieldIdMap.set(field.id, crypto.randomUUID())
        }
      }

      const remappedTables = logicalTables.map((table) => {
        const nextTableId = tableIdMap.get(table.id)!
        return {
          ...table,
          id: nextTableId,
          diagram_id: physicalDiagram.id,
          fields: table.fields.map((field, index) => ({
            ...field,
            id: fieldIdMap.get(field.id)!,
            table_id: nextTableId,
            order_index: index
          }))
        }
      })

      const tableRows = remappedTables.map((table) => ({
        id: table.id,
        diagram_id: physicalDiagram.id,
        name: table.name,
        x: table.x,
        y: table.y
      }))
      if (tableRows.length > 0) {
        const { error } = await supabase.from('logical_tables').insert(tableRows)
        if (error) throw error
      }

      const fieldRows = remappedTables.flatMap((table) =>
        table.fields.map((field) => ({
          ...field,
          table_id: table.id
        }))
      )
      if (fieldRows.length > 0) {
        const { error } = await supabase.from('logical_fields').insert(fieldRows)
        if (error) throw error
      }

      const edgeRows = logicalEdges
        .map((edge) => {
          const sourceTableId = tableIdMap.get(edge.source_table_id)
          const sourceFieldId = fieldIdMap.get(edge.source_field_id)
          const targetTableId = tableIdMap.get(edge.target_table_id)
          const targetFieldId = fieldIdMap.get(edge.target_field_id)
          if (!sourceTableId || !sourceFieldId || !targetTableId || !targetFieldId) return null

          return {
          ...edge,
          id: String(crypto.randomUUID()),
            diagram_id: physicalDiagram.id,
            source_table_id: sourceTableId,
            source_field_id: sourceFieldId,
            target_table_id: targetTableId,
            target_field_id: targetFieldId
          }
        })
        .filter((row): row is LogicalEdge => row !== null)
      if (edgeRows.length > 0) {
        const { error } = await supabase.from('logical_edges').insert(edgeRows)
        if (error) throw error
      }

      navigate(`/diagram/physical/${physicalDiagram.id}`, {
        state: {
          bootstrap: {
            diagramId: physicalDiagram.id,
            tables: remappedTables,
            edges: edgeRows
          }
        }
      })
    } catch (error) {
      console.error(error)
      window.alert('轉換為實體圖失敗。')
    } finally {
      setConverting(false)
    }
  }, [converting, diagramId, isReadOnly, logicalEdges, logicalTables, navigate])

  const createNormalizedPhysicalDiagram = useCallback(
    async (normalizedTables: LogicalTable[]) => {
      if (!diagramId || converting) return
      if (isReadOnly) return
      if (normalizedTables.length === 0) {
        window.alert('正規化結果為空，未建立實體圖。請先確認邏輯圖中有可正規化欄位。')
        return
      }
      setConverting(true)

      try {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData.user) {
          window.alert('請先登入再執行正規化匯出。')
          return
        }

        const { data: physicalDiagram, error: createError } = await supabase
          .from('diagrams')
          .insert({
            user_id: authData.user.id,
            name: `${diagramName}（正規化）`,
            type: 'physical',
            content: {}
          })
          .select('*')
          .single()
        if (createError || !physicalDiagram) throw createError

        const remappedTables = remapTablesForDiagram(normalizedTables, physicalDiagram.id)
        const laidOutTables = layoutNormalizedTablesVertical(remappedTables)
        if (laidOutTables.length === 0) {
          throw new Error('正規化結果沒有可建立的資料表。')
        }
        const normalizedEdges = buildEdgesFromFKRefs(laidOutTables, physicalDiagram.id)

        const tableRows = laidOutTables.map((table) => ({
          id: table.id,
          diagram_id: physicalDiagram.id,
          name: table.name,
          x: table.x,
          y: table.y
        }))
        if (tableRows.length > 0) {
          const { error } = await supabase.from('logical_tables').insert(tableRows)
          if (error) throw error
        }

        const fieldRows = laidOutTables.flatMap((table) =>
          table.fields.map((field) => ({
            ...field,
            table_id: table.id
          }))
        )
        if (fieldRows.length > 0) {
          const { error } = await supabase.from('logical_fields').insert(fieldRows)
          if (error) throw error
        }

        if (normalizedEdges.length > 0) {
          const { error } = await supabase.from('logical_edges').insert(normalizedEdges)
          if (error) throw error
        }

        navigate(`/diagram/physical/${physicalDiagram.id}`, {
          state: {
            bootstrap: {
              diagramId: physicalDiagram.id,
              tables: laidOutTables,
              edges: normalizedEdges
            }
          }
        })
      } catch (error) {
        console.error(error)
        window.alert('建立正規化實體圖失敗。')
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
    <div className="flex h-screen w-full flex-col bg-[#f2f4f7]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white hover:bg-blue-700">ERCanvas</button>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">邏輯模型</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
          {isReadOnly && (
            <span className="ml-3 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">唯讀分享</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">{saveStatusText}</span>
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
          <button
            type="button"
            className="rounded-md border border-violet-300 bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700 disabled:opacity-60"
            disabled={converting || isReadOnly}
            onClick={() => void handleConvertToPhysical()}
          >
            {converting ? '轉換中…' : '從 ER 轉換'}
          </button>
          <button
            type="button"
            className="rounded-md border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 disabled:opacity-60"
            onClick={() => setImageImportOpen(true)}
            disabled={isReadOnly}
          >
            圖片識別匯入
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={() => setWizardOpen(true)}
            disabled={isReadOnly}
          >
            連結 ER 圖
          </button>
        </div>
      </header>

      <div className="flex h-[46px] items-center justify-between border-b border-slate-200 bg-[#f5f6f8] px-3">
        <div className="flex items-center gap-2">
          <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-500">↶ 上一步</button>
          <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-500">↷ 下一步</button>
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
            className={`rounded border px-2 py-1 text-xs font-bold disabled:opacity-60 ${
              placingTable ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
            onClick={() => setPlacingTable((prev) => !prev)}
            disabled={isReadOnly}
          >
            ＋
          </button>
          <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600">全覽</button>
          <span className="px-1 text-xs font-semibold text-slate-500">100%</span>
        </div>

        <div className="flex items-center gap-2">
          {connectingFieldId && (
            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
              連線模式：請點選目標欄位
            </span>
          )}
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            onClick={() => setWizardOpen(true)}
            disabled={isReadOnly}
          >
            🔧 正規化
          </button>
          <button
            type="button"
            className="rounded border border-violet-400 bg-violet-600 px-2 py-1 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
            onClick={() => setAutoNormalizeOpen(true)}
            disabled={isReadOnly}
          >
            AI 自動正規化
          </button>
        </div>
      </div>

      <main className="flex min-h-0 flex-1">
        <aside className={`flex w-[188px] shrink-0 flex-col border-r border-slate-200 bg-[#eef0f3] ${isReadOnly ? 'opacity-70' : ''}`}>
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

        <section className={`relative min-w-0 flex-1 bg-[#e9edf2] ${placingTable ? 'cursor-crosshair' : ''}`}>
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
            onInit={(instance) => setFlowInstance(instance)}
            onPaneClick={(event) => {
              if (placingTable && flowInstance) {
                if (isReadOnly) return
                const pos = flowInstance.screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY
                })
                setLogicalTables([...logicalTables, createEmptyTable(pos.x, pos.y)])
                setPlacingTable(false)
                return
              }
              setSelectedFieldId(null)
              setConnectingFieldId(null)
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

      <NormalizationWizard
        open={wizardOpen}
        tables={logicalTables}
        onClose={() => setWizardOpen(false)}
        onConfirmApply={(nextTables) => {
          if (isReadOnly) return
          setWizardOpen(false)
          void createNormalizedPhysicalDiagram(nextTables)
        }}
      />

      <AutoNormalizeModal
        open={autoNormalizeOpen}
        tables={logicalTables}
        diagramId={diagramId ?? ''}
        onClose={() => setAutoNormalizeOpen(false)}
        onConfirmApply={(nextTables) => {
          if (isReadOnly) return
          setAutoNormalizeOpen(false)
          void createNormalizedPhysicalDiagram(nextTables)
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
