import { useCallback, useEffect, useMemo, useState } from 'react'
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
  ReactFlowInstance,
  ReactFlowProvider
} from '@xyflow/react'
import { useNavigate, useParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import LogicalTableNode, { LogicalTableNodeData } from '../components/nodes/LogicalTableNode'
import { FieldToolbar } from '../components/toolbars/FieldToolbar'
import { NormalizationWizard } from '../components/toolbars/NormalizationWizard'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'
import { LogicalEdge, LogicalTable } from '../types'

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
  const [diagramName, setDiagramName] = useState('未命名邏輯模型')
  const [placingTable, setPlacingTable] = useState(false)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null)

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacingTable(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
    <div className="flex h-screen w-full flex-col bg-[#f2f4f7]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center">
          <div className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white">ERCanvas</div>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">邏輯模型</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">{saveStatusText}</span>
          <button
            type="button"
            className="rounded-md border border-violet-300 bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700 disabled:opacity-60"
            disabled={converting}
            onClick={() => void handleConvertToPhysical()}
          >
            {converting ? '轉換中…' : '從 ER 轉換'}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
            onClick={() => setWizardOpen(true)}
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
            className={`rounded border px-2 py-1 text-xs font-bold ${
              placingTable ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
            onClick={() => setPlacingTable((prev) => !prev)}
          >
            ＋
          </button>
          <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600">全覽</button>
          <span className="px-1 text-xs font-semibold text-slate-500">100%</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            onClick={() => setWizardOpen(true)}
          >
            🔧 正規化
          </button>
        </div>
      </div>

      <main className="flex min-h-0 flex-1">
        <aside className="flex w-[188px] shrink-0 flex-col border-r border-slate-200 bg-[#eef0f3]">
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
            點擊欄位可編輯名稱
            <br />
            拖曳欄位可排序
            <br />
            Esc 可取消放置
          </div>
        </aside>

        <section className={`relative min-w-0 flex-1 bg-[#e9edf2] ${placingTable ? 'cursor-crosshair' : ''}`}>
          <DiagramCanvas
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            saveStatus={saveStatus}
            showSaveStatus={false}
            showControls={false}
            showMiniMap={false}
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
        </section>
      </main>

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
