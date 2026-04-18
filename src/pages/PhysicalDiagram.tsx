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
  ReactFlowProvider
} from '@xyflow/react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import LogicalTableNode, { LogicalTableNodeData } from '../components/nodes/LogicalTableNode'
import { FieldToolbar } from '../components/toolbars/FieldToolbar'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge } from '../types'

const parseFieldIdFromHandle = (handle?: string | null) => {
  if (!handle) return null
  const match = handle.match(/field-(?:source|target)-(.+)/)
  return match?.[1] ?? null
}

type PhysicalFlowNode = Node<LogicalTableNodeData>

const nodeTypes: Record<string, ComponentType<any>> = {
  logicalTable: LogicalTableNode
}

function PhysicalDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const isReadOnly = searchParams.get('permission') === 'viewer'
  const [connectingFieldId, setConnectingFieldId] = useState<string | null>(null)
  const [diagramName, setDiagramName] = useState('未命名實體圖')

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

  useEffect(() => {
    if (!diagramId) return
    void loadLogical(diagramId)
  }, [diagramId, loadLogical])

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
    () =>
      logicalEdges.map((edge) => ({
        id: edge.id,
        source: edge.source_table_id,
        sourceHandle: `field-source-${edge.source_field_id}`,
        target: edge.target_table_id,
        targetHandle: `field-target-${edge.target_field_id}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style:
          edge.edge_type === 'fk'
            ? { stroke: '#2563eb', strokeWidth: 1.6, strokeDasharray: '5,5' }
            : { stroke: '#64748b', strokeWidth: 1.5 }
      })),
    [logicalEdges]
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
            const sourceFieldId = parseFieldIdFromHandle(edge.sourceHandle)
            const targetFieldId = parseFieldIdFromHandle(edge.targetHandle)
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
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed }
        },
        edges
      )

      setLogicalEdges(
        rfEdge
          .map((edge) => {
            const sourceField = parseFieldIdFromHandle(edge.sourceHandle)
            const targetField = parseFieldIdFromHandle(edge.targetHandle)
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
    if (!diagramId) return
    void saveLogical(diagramId)
  }, [diagramId, isReadOnly, saveLogical])

  return (
    <div className="flex h-screen w-full flex-col bg-[#f2f4f7]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center">
          <div className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white">ERCanvas</div>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">實體圖</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
          {isReadOnly && (
            <span className="ml-3 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">唯讀分享</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {diagramId && <ShareDiagramButton diagramId={diagramId} />}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-slate-100">
      <DiagramCanvas
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        saveStatus={saveStatus}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => {
          setSelectedFieldId(null)
          setConnectingFieldId(null)
        }}
        onRetrySave={handleAutoSave}
        onAutoSave={isReadOnly ? undefined : handleAutoSave}
        autoSaveDeps={[logicalTables, logicalEdges]}
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
