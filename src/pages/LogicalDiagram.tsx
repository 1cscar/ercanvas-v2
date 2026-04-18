import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useNavigate, useParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import LogicalTableNode, { LogicalTableNodeData } from '../components/nodes/LogicalTableNode'
import { FieldToolbar } from '../components/toolbars/FieldToolbar'
import { NormalizationWizard } from '../components/toolbars/NormalizationWizard'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge } from '../types'

const parseFieldIdFromHandle = (handle?: string | null) => {
  if (!handle) return null
  const match = handle.match(/field-(?:source|target)-(.+)/)
  return match?.[1] ?? null
}

const nodeTypes = {
  logicalTable: LogicalTableNode
}

function LogicalDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [connectingFieldId, setConnectingFieldId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)

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

  const nodes = useMemo<Node<LogicalTableNodeData>[]>(
    () =>
      logicalTables.map((table) => ({
        id: table.id,
        type: 'logicalTable',
        position: { x: table.x, y: table.y },
        data: {
          table,
          selectedFieldId,
          onSelectField: (tableId, fieldId) => {
            setSelectedFieldId(fieldId)
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
      updateFieldName
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
    (changes: NodeChange<Node>[]) => {
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
    [logicalTables, nodes, setLogicalTables]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const updatedEdges = applyEdgeChanges(changes, edges)
      const mapped = updatedEdges
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
      setLogicalEdges(mapped)
    },
    [diagramId, edges, setLogicalEdges]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
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

      const mapped = rfEdge
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

      setLogicalEdges(mapped)
    },
    [diagramId, edges, setLogicalEdges]
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
    if (!diagramId) return
    void saveLogical(diagramId)
  }, [diagramId, saveLogical])

  const handleConvertToPhysical = useCallback(async () => {
    if (!diagramId || converting) return
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
          type: 'physical'
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

      const tableRows = logicalTables.map((table) => ({
        id: tableIdMap.get(table.id)!,
        diagram_id: physicalDiagram.id,
        name: table.name,
        x: table.x,
        y: table.y
      }))
      if (tableRows.length > 0) {
        const { error } = await supabase.from('logical_tables').insert(tableRows)
        if (error) throw error
      }

      const fieldRows = logicalTables.flatMap((table) =>
        table.fields.map((field) => ({
          ...field,
          id: fieldIdMap.get(field.id)!,
          table_id: tableIdMap.get(table.id)!
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
            id: crypto.randomUUID(),
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

      navigate(`/diagram/physical/${physicalDiagram.id}`)
    } catch (error) {
      console.error(error)
      window.alert('轉換為實體圖失敗。')
    } finally {
      setConverting(false)
    }
  }, [converting, diagramId, logicalEdges, logicalTables, navigate])

  return (
    <div className="relative h-screen w-full bg-slate-100">
      <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          onClick={() => setWizardOpen(true)}
        >
          🔧 正規化
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={converting}
          onClick={() => void handleConvertToPhysical()}
        >
          {converting ? '轉換中…' : '轉換為實體圖'}
        </button>
      </div>

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
        onAutoSave={handleAutoSave}
        autoSaveDeps={[logicalTables, logicalEdges]}
      />

      {selectedTable && selectedField && (
        <FieldToolbar
          table={selectedTable}
          field={selectedField}
          onStartConnect={(fieldId) => setConnectingFieldId(fieldId)}
        />
      )}

      <NormalizationWizard
        open={wizardOpen}
        tables={logicalTables}
        onClose={() => setWizardOpen(false)}
        onConfirmApply={(nextTables) => {
          setLogicalTables(nextTables)
          setWizardOpen(false)
          if (diagramId) {
            void saveLogical(diagramId)
          }
        }}
      />
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
