import { MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance,
  ReactFlowProvider
} from '@xyflow/react'
import { useNavigate, useParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import { ERObjectPanel } from '../components/panels/ERObjectPanel'
import AttributeNode from '../components/nodes/AttributeNode'
import DeletableEREdge from '../components/edges/DeletableEREdge'
import EntityNode from '../components/nodes/EntityNode'
import EREntityNode from '../components/nodes/EREntityNode'
import RelationshipNode from '../components/nodes/RelationshipNode'
import { convertERtoLogical } from '../lib/erToLogical'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'

const nodeTypes = {
  entity: EntityNode,
  attribute: AttributeNode,
  relationship: RelationshipNode,
  er_entity: EREntityNode
}

const edgeTypes = {
  erEdge: DeletableEREdge
}

function ERDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const erNodes = useDiagramStore((state) => state.erNodes)
  const erEdges = useDiagramStore((state) => state.erEdges)
  const pendingNodeType = useDiagramStore((state) => state.pendingNodeType)
  const saveStatus = useDiagramStore((state) => state.saveStatus)
  const setERNodes = useDiagramStore((state) => state.setERNodes)
  const setEREdges = useDiagramStore((state) => state.setEREdges)
  const addERNode = useDiagramStore((state) => state.addERNode)
  const setPendingNodeType = useDiagramStore((state) => state.setPendingNodeType)
  const loadER = useDiagramStore((state) => state.loadER)
  const saveER = useDiagramStore((state) => state.saveER)

  useEffect(() => {
    if (!diagramId) return
    void loadER(diagramId)
  }, [diagramId, loadER])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingNodeType(null)
        setConnectingSourceId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPendingNodeType])

  useEffect(() => {
    const onStartConnect = (event: Event) => {
      const customEvent = event as CustomEvent<{ sourceId: string }>
      setConnectingSourceId(customEvent.detail?.sourceId ?? null)
    }
    window.addEventListener('er-start-connect', onStartConnect)
    return () => window.removeEventListener('er-start-connect', onStartConnect)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      setERNodes(applyNodeChanges(changes, erNodes))
    },
    [erNodes, setERNodes]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      setEREdges(applyEdgeChanges(changes, erEdges))
    },
    [erEdges, setEREdges]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      setEREdges(
        addEdge(
          {
            ...connection,
            type: 'erEdge'
          },
          erEdges
        )
      )
    },
    [erEdges, setEREdges]
  )

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      if (connectingSourceId) {
        setConnectingSourceId(null)
        return
      }
      if (!pendingNodeType || !flowInstance) return
      const position = flowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      addERNode(pendingNodeType, position)
      setPendingNodeType(null)
    },
    [addERNode, connectingSourceId, flowInstance, pendingNodeType, setPendingNodeType]
  )

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      if (!connectingSourceId) return
      if (node.id === connectingSourceId) return

      setEREdges([
        ...erEdges,
        {
          id: crypto.randomUUID(),
          source: connectingSourceId,
          sourceHandle: 'source-right',
          target: node.id,
          targetHandle: 'target-left',
          type: 'erEdge'
        }
      ])
      setConnectingSourceId(null)
    },
    [connectingSourceId, erEdges, setEREdges]
  )

  const handleAutoSave = useCallback(() => {
    if (!diagramId) return
    void saveER(diagramId)
  }, [diagramId, saveER])

  const handleConvertToLogical = useCallback(async () => {
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

      const converted = convertERtoLogical(erNodes, erEdges)

      const { data: logicalDiagram, error: diagramCreateError } = await supabase
        .from('diagrams')
        .insert({
          user_id: authData.user.id,
          name: `${sourceDiagram?.name ?? 'ER圖'}（邏輯）`,
          type: 'logical'
        })
        .select('*')
        .single()

      if (diagramCreateError || !logicalDiagram) throw diagramCreateError

      const tableRows = converted.tables.map((table) => ({
        id: table.id,
        diagram_id: logicalDiagram.id,
        name: table.name,
        x: table.x,
        y: table.y
      }))

      if (tableRows.length > 0) {
        const { error: tableError } = await supabase.from('logical_tables').insert(tableRows)
        if (tableError) throw tableError
      }

      const fieldRows = converted.tables.flatMap((table) =>
        table.fields.map((field) => ({
          ...field,
          table_id: table.id
        }))
      )

      if (fieldRows.length > 0) {
        const { error: fieldError } = await supabase.from('logical_fields').insert(fieldRows)
        if (fieldError) throw fieldError
      }

      const edgeRows = converted.edges.map((edge) => ({
        ...edge,
        diagram_id: logicalDiagram.id
      }))

      if (edgeRows.length > 0) {
        const { error: edgeError } = await supabase.from('logical_edges').insert(edgeRows)
        if (edgeError) throw edgeError
      }

      navigate(`/diagram/logical/${logicalDiagram.id}`)
    } catch (error) {
      console.error(error)
      window.alert('轉換為邏輯圖失敗，請稍後再試。')
    } finally {
      setConverting(false)
    }
  }, [converting, diagramId, erEdges, erNodes, navigate])

  const previewClass = useMemo(() => {
    if (!pendingNodeType) return ''
    if (pendingNodeType === 'attribute') return 'rounded-full border-2 border-black bg-white'
    if (pendingNodeType === 'relationship') return 'rotate-45 border-2 border-black bg-white'
    if (pendingNodeType === 'er_entity') return 'border-2 border-black bg-white'
    return 'border-2 border-black bg-white'
  }, [pendingNodeType])

  return (
    <div
      className={`flex h-screen w-full bg-slate-100 ${pendingNodeType ? 'cursor-crosshair' : ''}`}
      onMouseMove={(event) => setMousePos({ x: event.clientX, y: event.clientY })}
    >
      <ERObjectPanel pendingType={pendingNodeType} onSelectType={setPendingNodeType} />

      <div className="relative flex-1">
        <div className="absolute right-3 top-3 z-20">
          <button
            type="button"
            onClick={() => void handleConvertToLogical()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={converting}
          >
            {converting ? '轉換中…' : '轉換為邏輯圖'}
          </button>
        </div>

        {connectingSourceId && (
          <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-amber-100 px-3 py-1 text-xs text-amber-700">
            連線模式：請點擊另一個節點完成連線（Esc 取消）
          </div>
        )}

        {pendingNodeType && (
          <div
            className="pointer-events-none fixed z-50"
            style={{ left: mousePos.x + 16, top: mousePos.y + 8 }}
          >
            <div className={`relative h-12 w-16 ${previewClass}`}>
              {pendingNodeType === 'er_entity' && (
                <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-black" />
              )}
            </div>
          </div>
        )}

        <DiagramCanvas
          nodes={erNodes}
          edges={erEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          saveStatus={saveStatus}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onInit={(instance) => setFlowInstance(instance)}
          onRetrySave={handleAutoSave}
          onAutoSave={handleAutoSave}
          autoSaveDeps={[erNodes, erEdges]}
        />
      </div>
    </div>
  )
}

export default function ERDiagram() {
  return (
    <ReactFlowProvider>
      <ERDiagramInner />
    </ReactFlowProvider>
  )
}
