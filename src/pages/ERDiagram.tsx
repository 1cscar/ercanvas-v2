import { type ComponentType, MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DiagramCanvas } from '../components/DiagramCanvas'
import { ERObjectPanel } from '../components/panels/ERObjectPanel'
import AttributeNode from '../components/nodes/AttributeNode'
import DeletableEREdge from '../components/edges/DeletableEREdge'
import EntityNode from '../components/nodes/EntityNode'
import EREntityNode from '../components/nodes/EREntityNode'
import RelationshipNode from '../components/nodes/RelationshipNode'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import { ERFloatingToolbar } from '../components/toolbars/ERFloatingToolbar'
import { convertERtoLogical } from '../lib/erToLogical'
import { supabase } from '../lib/supabase'
import { useDiagramStore } from '../store/diagramStore'
import { ERNodeData, ERNodeType } from '../types'

type ERFlowNode = Node<ERNodeData>

const nodeTypes: Record<string, ComponentType<any>> = {
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
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = searchParams.get('permission') === 'viewer'
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<ERFlowNode, Edge> | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [diagramName, setDiagramName] = useState('未命名 ER 圖')
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
  const setShareContext = useDiagramStore((state) => state.setShareContext)

  useEffect(() => {
    if (shareToken && (sharePermission === 'viewer' || sharePermission === 'editor')) {
      setShareContext(shareToken, sharePermission)
      return
    }
    setShareContext(null, null)
  }, [setShareContext, sharePermission, shareToken])

  useEffect(() => {
    if (!diagramId) return
    void loadER(diagramId)
  }, [diagramId, loadER])

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
        setPendingNodeType(null)
        setConnectingSourceId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPendingNodeType])

  const onNodesChange = useCallback(
    (changes: NodeChange<ERFlowNode>[]) => {
      if (isReadOnly) return
      setERNodes(applyNodeChanges(changes, erNodes))
    },
    [erNodes, isReadOnly, setERNodes]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (isReadOnly) return
      setEREdges(applyEdgeChanges(changes, erEdges))
    },
    [erEdges, isReadOnly, setEREdges]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isReadOnly) return
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
    [erEdges, isReadOnly, setEREdges]
  )

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      if (isReadOnly) return
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
    [addERNode, connectingSourceId, flowInstance, isReadOnly, pendingNodeType, setPendingNodeType]
  )

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: ERFlowNode) => {
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
    if (isReadOnly) return
    if (!diagramId) return
    void saveER(diagramId)
  }, [diagramId, isReadOnly, saveER])

  const handleConvertToLogical = useCallback(async () => {
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
  }, [converting, diagramId, erEdges, erNodes, isReadOnly, navigate])

  const previewClass = useMemo(() => {
    if (!pendingNodeType) return ''
    if (pendingNodeType === 'attribute') return 'rounded-full border-2 border-black bg-white'
    if (pendingNodeType === 'relationship') return 'rotate-45 border-2 border-black bg-white'
    if (pendingNodeType === 'er_entity') return 'border-2 border-black bg-white'
    return 'border-2 border-black bg-white'
  }, [pendingNodeType])

  const selectedNode = useMemo(() => erNodes.find((node) => node.selected), [erNodes])

  const toolbarAnchor = useMemo(() => {
    if (!selectedNode || !flowInstance) return null
    const width = selectedNode.width ?? selectedNode.measured?.width ?? 120
    return flowInstance.flowToScreenPosition({
      x: selectedNode.position.x + width,
      y: selectedNode.position.y
    })
  }, [flowInstance, selectedNode])

  const createNodeLabel = (type: ERNodeType) => {
    if (type === 'entity') return 'Entity'
    if (type === 'attribute') return 'Attribute'
    if (type === 'relationship') return 'Relationship'
    return 'ER Entity'
  }

  const addNearSelectedNode = (type: ERNodeType) => {
    if (!selectedNode) return
    const sourceWidth = selectedNode.width ?? selectedNode.measured?.width ?? 120
    const sourceHeight = selectedNode.height ?? selectedNode.measured?.height ?? 60
    const newId = crypto.randomUUID()

    setERNodes([
      ...erNodes,
      {
        id: newId,
        type,
        position: {
          x: selectedNode.position.x + sourceWidth + 80,
          y: selectedNode.position.y + sourceHeight / 2
        },
        data: {
          label: createNodeLabel(type),
          isPrimaryKey: false,
          fontSize: 14,
          fontBold: false,
          fontUnderline: false
        },
        width: 120,
        height: 60
      }
    ])

    setEREdges([
      ...erEdges,
      {
        id: crypto.randomUUID(),
        source: selectedNode.id,
        sourceHandle: 'source-right',
        target: newId,
        targetHandle: 'target-left',
        type: 'erEdge'
      }
    ])
  }

  const duplicateSelectedNode = () => {
    if (!selectedNode) return
    setERNodes([
      ...erNodes,
      {
        ...selectedNode,
        id: crypto.randomUUID(),
        selected: false,
        position: {
          x: selectedNode.position.x + 24,
          y: selectedNode.position.y + 24
        }
      }
    ])
  }

  const deleteSelectedNode = () => {
    if (!selectedNode) return
    setERNodes(erNodes.filter((node) => node.id !== selectedNode.id))
    setEREdges(erEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id))
  }

  const changeSelectedType = (type: ERNodeType) => {
    if (!selectedNode) return
    setERNodes(
      erNodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              type
            }
          : node
      )
    )
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[#f2f4f7]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center">
          <div className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white">ERCanvas</div>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">ER 圖</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
          {isReadOnly && (
            <span className="ml-3 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">唯讀分享</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
          <button
            type="button"
            onClick={() => void handleConvertToLogical()}
            className="rounded-md border border-violet-300 bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700 disabled:opacity-60"
            disabled={converting || isReadOnly}
          >
            {converting ? '轉換中…' : '轉換為邏輯圖'}
          </button>
        </div>
      </header>

      <div
        className={`flex min-h-0 flex-1 bg-slate-100 ${pendingNodeType && !isReadOnly ? 'cursor-crosshair' : ''}`}
        onMouseMove={(event) => setMousePos({ x: event.clientX, y: event.clientY })}
      >
        {!isReadOnly && <ERObjectPanel pendingType={pendingNodeType} onSelectType={setPendingNodeType} />}

        <div className="relative flex-1">
          {connectingSourceId && (
            <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md bg-amber-100 px-3 py-1 text-xs text-amber-700">
              連線模式：請點擊另一個節點完成連線（Esc 取消）
            </div>
          )}

          {pendingNodeType && !isReadOnly && (
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

          {!isReadOnly && selectedNode && toolbarAnchor && (
            <ERFloatingToolbar
              node={selectedNode}
              anchor={toolbarAnchor}
              onAddNode={addNearSelectedNode}
              onStartConnect={() => setConnectingSourceId(selectedNode.id)}
              onDuplicate={duplicateSelectedNode}
              onDelete={deleteSelectedNode}
              onChangeType={changeSelectedType}
            />
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
            onAutoSave={isReadOnly ? undefined : handleAutoSave}
            autoSaveDeps={[erNodes, erEdges]}
          />
        </div>
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
