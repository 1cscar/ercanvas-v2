import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  MarkerType,
  Node,
  NodeChange,
  ReactFlowInstance,
  ReactFlowProvider
} from '@xyflow/react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import LogicalFieldEdge from '../components/edges/LogicalFieldEdge'
import LogicalTableNode, { LogicalTableNodeData } from '../components/nodes/LogicalTableNode'
import { FieldToolbar } from '../components/toolbars/FieldToolbar'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge, LogicalTable } from '../types'

const parseFieldIdFromHandle = (handle?: string | null) => {
  if (!handle) return null
  const match = handle.match(/field-(?:source|target)-(.+)/)
  return match?.[1] ?? null
}

const FIELD_WIDTH = 220
const HEADER_HEIGHT = 46
const FIELD_HEIGHT = 56
const EDGE_COORD_LIMIT = 50000
const PHYSICAL_TABLE_WIDTH = 360
const PHYSICAL_TABLE_HEADER_HEIGHT = 56
const PHYSICAL_TABLE_FIELD_HEIGHT = 52

const clampCoord = (value: number) =>
  Math.max(-EDGE_COORD_LIMIT, Math.min(EDGE_COORD_LIMIT, value))

const estimatePhysicalTableHeight = (fieldCount: number) =>
  PHYSICAL_TABLE_HEADER_HEIGHT + Math.max(fieldCount, 1) * PHYSICAL_TABLE_FIELD_HEIGHT

const getFieldAnchor = (
  tableX: number,
  tableY: number,
  fieldCount: number,
  fieldIndex: number,
  asSource: boolean
) => {
  const safeCount = Math.max(fieldCount, 1)
  const safeIndex = Math.max(0, Math.min(fieldIndex, safeCount - 1))
  return {
    x: clampCoord(tableX + safeIndex * FIELD_WIDTH + FIELD_WIDTH / 2),
    y: clampCoord(tableY + HEADER_HEIGHT + (asSource ? FIELD_HEIGHT : 0))
  }
}

type PhysicalFlowNode = Node<LogicalTableNodeData>
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

function PhysicalDiagramInner() {
  const location = useLocation()
  const navigate = useNavigate()
  const { id: diagramId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = searchParams.get('permission') === 'viewer'
  const [connectingFieldId, setConnectingFieldId] = useState<string | null>(null)
  const [diagramName, setDiagramName] = useState('未命名實體圖')
  const [autoSaveReady, setAutoSaveReady] = useState(false)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<PhysicalFlowNode, Edge> | null>(null)

  const logicalTables = useDiagramStore((state) => state.logicalTables)
  const logicalEdges = useDiagramStore((state) => state.logicalEdges)
  const selectedFieldId = useDiagramStore((state) => state.selectedFieldId)
  const saveStatus = useDiagramStore((state) => state.saveStatus)

  const setLogicalTables = useDiagramStore((state) => state.setLogicalTables)
  const setLogicalEdges = useDiagramStore((state) => state.setLogicalEdges)
  const setSelectedFieldId = useDiagramStore((state) => state.setSelectedFieldId)
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
      return
    }

    void (async () => {
      let loaded = false
      try {
        await loadLogical(diagramId)
        loaded = true
      } catch (error) {
        console.error('[PhysicalDiagram] load failed', error)
      } finally {
        setAutoSaveReady(loaded)
        if (!loaded) setSaveStatus('error')
      }
    })()
  }, [
    bootstrap,
    diagramId,
    loadLogical,
    setLogicalEdges,
    setLogicalTables,
    setSaveStatus,
    setSelectedFieldId
  ])

  useEffect(() => {
    if (!flowInstance) return
    if (logicalTables.length === 0) return
    const timer = window.setTimeout(() => {
      flowInstance.fitView({ padding: 0.2, duration: 260 })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [flowInstance, logicalTables.length])

  useEffect(() => {
    if (!diagramId) return
    void (async () => {
      const { data } = await supabase.from('diagrams').select('name').eq('id', diagramId).single()
      if (data?.name) setDiagramName(data.name)
    })()
  }, [diagramId])

  const nodes = useMemo<PhysicalFlowNode[]>(
    () =>
      logicalTables.map((table) => ({
        id: table.id,
        type: 'logicalTable',
        position: { x: table.x, y: table.y },
        width: PHYSICAL_TABLE_WIDTH,
        height: estimatePhysicalTableHeight(table.fields.length),
        data: {
          table,
          mode: 'physical',
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
            setLogicalEdges([...logicalEdges, newEdge])
            setConnectingFieldId(null)
          },
          onUpdateFieldName: (tableId, fieldId, name) => updateFieldName(tableId, fieldId, name),
          onUpdateTableName: (tableId, name) =>
            setLogicalTables(
              logicalTables.map((table) => (table.id === tableId ? { ...table, name } : table))
            ),
          onMoveField: (tableId, fromIndex, toIndex) => moveLogicalField(tableId, fromIndex, toIndex)
        }
      })),
    [
      connectingFieldId,
      diagramId,
      logicalEdges,
      logicalTables,
      moveLogicalField,
      selectedFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId,
      updateFieldName,
      isReadOnly
    ]
  )

  const edges = useMemo<Edge[]>(
    () => {
      const tableById = new Map(logicalTables.map((table) => [table.id, table]))
      const sortedFieldsByTable = new Map(
        logicalTables.map((table) => [
          table.id,
          [...table.fields].sort((a, b) => a.order_index - b.order_index)
        ])
      )
      return logicalEdges.map((edge) => {
        const sourceTable = tableById.get(edge.source_table_id)
        const targetTable = tableById.get(edge.target_table_id)
        const sourceFields = sortedFieldsByTable.get(edge.source_table_id) ?? []
        const targetFields = sortedFieldsByTable.get(edge.target_table_id) ?? []
        const sourceIndex = sourceFields.findIndex((field) => field.id === edge.source_field_id)
        const targetIndex = targetFields.findIndex((field) => field.id === edge.target_field_id)
        const sourceAnchor =
          sourceTable && Number.isFinite(Number(sourceTable.x)) && Number.isFinite(Number(sourceTable.y))
            ? getFieldAnchor(
                Number(sourceTable.x),
                Number(sourceTable.y),
                sourceFields.length,
                sourceIndex >= 0 ? sourceIndex : 0,
                true
              )
            : { x: 0, y: 0 }
        const targetAnchor =
          targetTable && Number.isFinite(Number(targetTable.x)) && Number.isFinite(Number(targetTable.y))
            ? getFieldAnchor(
                Number(targetTable.x),
                Number(targetTable.y),
                targetFields.length,
                targetIndex >= 0 ? targetIndex : 0,
                false
              )
            : { x: 0, y: 0 }

        return {
        id: edge.id,
        source: edge.source_table_id,
        target: edge.target_table_id,
        type: 'logicalFieldEdge',
        zIndex: 1200,
        data: {
          sourceX: sourceAnchor.x,
          sourceY: sourceAnchor.y,
          targetX: targetAnchor.x,
          targetY: targetAnchor.y,
          sourceFieldId: edge.source_field_id,
          targetFieldId: edge.target_field_id
        },
        markerEnd: { type: MarkerType.ArrowClosed },
        style:
          edge.edge_type === 'fk'
            ? { stroke: '#1d4ed8', strokeWidth: 2.2, strokeDasharray: '6,4' }
            : { stroke: '#64748b', strokeWidth: 1.8 }
        }
      })
    },
    [logicalEdges, logicalTables]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<PhysicalFlowNode>[]) => {
      if (isReadOnly) return
      const changedNodes = applyNodeChanges(changes, nodes)
      setLogicalTables(
        logicalTables.map((table) => {
          const changed = changedNodes.find((node) => node.id === table.id)
          if (!changed) return table
          return {
            ...table,
            x: changed.position.x,
            y: changed.position.y
          }
        })
      )
    },
    [isReadOnly, logicalTables, nodes, setLogicalTables]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (isReadOnly) return
      const updatedEdges = applyEdgeChanges(changes, edges)
      setLogicalEdges(
        updatedEdges
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
      )
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
          zIndex: 1200,
          data: {
            sourceFieldId,
            targetFieldId
          },
          markerEnd: { type: MarkerType.ArrowClosed }
        },
        edges
      )

      setLogicalEdges(
        rfEdge
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
      )
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

  return (
    <div className="flex h-screen w-full flex-col bg-[#f2f4f7]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white hover:bg-blue-700">ERCanvas</button>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">實體圖</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
          {isReadOnly && (
            <span className="ml-3 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">唯讀分享</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-slate-100">
      <DiagramCanvas
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        saveStatus={saveStatus}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => {
          setSelectedFieldId(null)
          setConnectingFieldId(null)
        }}
        onInit={setFlowInstance}
        onRetrySave={handleAutoSave}
        onAutoSave={isReadOnly || !autoSaveReady ? undefined : handleAutoSave}
        autoSaveDeps={[logicalTables, logicalEdges]}
        autoSaveSessionKey={diagramId ?? null}
      />

      {!isReadOnly && selectedTable && selectedField && (
        <FieldToolbar
          table={selectedTable}
          field={selectedField}
          mode="physical"
          onStartConnect={(fieldId) => setConnectingFieldId(fieldId)}
        />
      )}
      </div>
    </div>
  )
}

export default function PhysicalDiagram() {
  return (
    <ReactFlowProvider>
      <PhysicalDiagramInner />
    </ReactFlowProvider>
  )
}
