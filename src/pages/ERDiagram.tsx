import { type ComponentType, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { ImageImportModal } from '../components/ImageImportModal'
import { ERObjectPanel } from '../components/panels/ERObjectPanel'
import AttributeNode from '../components/nodes/AttributeNode'
import DeletableEREdge from '../components/edges/DeletableEREdge'
import EntityNode from '../components/nodes/EntityNode'
import EREntityNode from '../components/nodes/EREntityNode'
import RelationshipNode from '../components/nodes/RelationshipNode'
import { ShareDiagramButton } from '../components/toolbars/ShareDiagramButton'
import { ERFloatingToolbar } from '../components/toolbars/ERFloatingToolbar'
import { ERTopToolbar } from '../components/toolbars/ERTopToolbar'
import { fitViewFlow, toZoomPercent, zoomInFlow, zoomOutFlow } from '../lib/canvasInteractions'
import { convertERtoLogical } from '../lib/erToLogical'
import { supabase } from '../lib/supabase'
import { ERVisionResult } from '../lib/VisionService'
import { buildERCanvasFromVision } from '../lib/visionImport'
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

type ERSnapshot = {
  nodes: ERFlowNode[]
  edges: Edge[]
}

const cloneERSnapshot = (snapshot: ERSnapshot): ERSnapshot => {
  if (typeof structuredClone === 'function') return structuredClone(snapshot)
  return JSON.parse(JSON.stringify(snapshot)) as ERSnapshot
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

function ERDiagramInner() {
  const { id: diagramId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = Boolean(shareToken) && sharePermission === 'viewer'
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<ERFlowNode, Edge> | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [imageImportOpen, setImageImportOpen] = useState(false)
  const [diagramName, setDiagramName] = useState('未命名 ER 圖')
  const [editingDiagramName, setEditingDiagramName] = useState(false)
  const [diagramNameDraft, setDiagramNameDraft] = useState('')
  const [isComposingTitle, setIsComposingTitle] = useState(false)
  const [autoSaveReady, setAutoSaveReady] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [historyState, setHistoryState] = useState<{ entries: ERSnapshot[]; index: number }>({
    entries: [],
    index: -1
  })
  const applyingHistoryRef = useRef(false)
  const titleRef = useRef<HTMLDivElement>(null)
  const erNodes = useDiagramStore((state) => state.erNodes)
  const erEdges = useDiagramStore((state) => state.erEdges)
  const pendingNodeType = useDiagramStore((state) => state.pendingNodeType)
  const saveStatus = useDiagramStore((state) => state.saveStatus)
  const staleDataWarning = useDiagramStore((state) => state.staleDataWarning)
  const setStaleDataWarning = useDiagramStore((state) => state.setStaleDataWarning)
  const setERNodes = useDiagramStore((state) => state.setERNodes)
  const setEREdges = useDiagramStore((state) => state.setEREdges)
  const addERNode = useDiagramStore((state) => state.addERNode)
  const updateERNodeData = useDiagramStore((state) => state.updateERNodeData)
  const setPendingNodeType = useDiagramStore((state) => state.setPendingNodeType)
  const loadER = useDiagramStore((state) => state.loadER)
  const saveER = useDiagramStore((state) => state.saveER)
  const setSaveStatus = useDiagramStore((state) => state.setSaveStatus)
  const setShareContext = useDiagramStore((state) => state.setShareContext)

  useEffect(() => {
    if (shareToken && (sharePermission === 'viewer' || sharePermission === 'editor')) {
      setShareContext(shareToken, sharePermission)
      return
    }
    setShareContext(null, null)
  }, [setShareContext, sharePermission, shareToken])

  useEffect(() => {
    setAutoSaveReady(false)
    setHistoryState({ entries: [], index: -1 })
    setERNodes([])
    setEREdges([])
    setPendingNodeType(null)
    setSaveStatus('idle')
    if (!diagramId) return
    void (async () => {
      let loaded = false
      try {
        await loadER(diagramId)
        loaded = true
      } catch (error) {
        console.error('[ERDiagram] load failed', error)
      } finally {
        setAutoSaveReady(loaded)
        if (!loaded) setSaveStatus('error')
      }
    })()
  }, [diagramId, loadER, setEREdges, setERNodes, setPendingNodeType, setSaveStatus])

  useEffect(() => {
    if (!autoSaveReady) return
    const currentSnapshot = cloneERSnapshot({ nodes: erNodes, edges: erEdges })

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
  }, [autoSaveReady, erEdges, erNodes])

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
        setPendingNodeType(null)
        setConnectingSourceId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPendingNodeType])

  const canUndo = historyState.index > 0
  const canRedo = historyState.index >= 0 && historyState.index < historyState.entries.length - 1

  const handleUndo = useCallback(() => {
    if (!canUndo) return
    const snapshot = historyState.entries[historyState.index - 1]
    if (!snapshot) return
    applyingHistoryRef.current = true
    setERNodes(cloneERSnapshot(snapshot).nodes)
    setEREdges(cloneERSnapshot(snapshot).edges)
    setHistoryState((previous) => ({ ...previous, index: Math.max(0, previous.index - 1) }))
  }, [canUndo, historyState.entries, historyState.index, setEREdges, setERNodes])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    const snapshot = historyState.entries[historyState.index + 1]
    if (!snapshot) return
    applyingHistoryRef.current = true
    setERNodes(cloneERSnapshot(snapshot).nodes)
    setEREdges(cloneERSnapshot(snapshot).edges)
    setHistoryState((previous) => ({ ...previous, index: Math.min(previous.entries.length - 1, previous.index + 1) }))
  }, [canRedo, historyState.entries, historyState.index, setEREdges, setERNodes])

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
    if (!flowInstance) return
    setZoomPercent(toZoomPercent(flowInstance))
  }, [flowInstance])

  const handleFitView = useCallback(() => {
    fitViewFlow(flowInstance)
  }, [flowInstance])

  const handleZoomIn = useCallback(() => {
    zoomInFlow(flowInstance)
  }, [flowInstance])

  const handleZoomOut = useCallback(() => {
    zoomOutFlow(flowInstance)
  }, [flowInstance])

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
          sourceHandle: 'source-center',
          target: node.id,
          targetHandle: 'target-center',
          type: 'erEdge'
        }
      ])
      setConnectingSourceId(null)
    },
    [connectingSourceId, erEdges, setEREdges]
  )

  const handleAutoSave = useCallback(() => {
    if (isReadOnly) return
    if (!autoSaveReady) return
    if (!diagramId) return
    void saveER(diagramId)
  }, [autoSaveReady, diagramId, isReadOnly, saveER])

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
          type: 'logical',
          content: {}
        })
        .select('*')
        .single()

      if (diagramCreateError || !logicalDiagram) throw diagramCreateError

      const tableRows = converted.tables.map((table) => ({
        id: table.id,
        diagram_id: logicalDiagram.id,
        name: table.name,
        name_en: table.name_en ?? null,
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

      const bootstrapTables = converted.tables.map((table) => ({
        ...table,
        diagram_id: logicalDiagram.id,
        fields: table.fields.map((field, index) => ({
          ...field,
          table_id: table.id,
          order_index: index
        }))
      }))
      const bootstrapEdges = converted.edges.map((edge) => ({
        ...edge,
        diagram_id: logicalDiagram.id
      }))

      navigate(`/diagram/logical/${logicalDiagram.id}`, {
        state: {
          bootstrap: {
            diagramId: logicalDiagram.id,
            tables: bootstrapTables,
            edges: bootstrapEdges
          }
        }
      })
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
    if (pendingNodeType === 'relationship') return ''
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
    if (type === 'entity') return '實體'
    if (type === 'attribute') return '屬性'
    if (type === 'relationship') return '關聯'
    return '實體關聯'
  }

  const addNearSelectedNode = (type: ERNodeType) => {
    if (!selectedNode) return
    const sourceWidth = selectedNode.width ?? selectedNode.measured?.width ?? 120
    const sourceHeight = selectedNode.height ?? selectedNode.measured?.height ?? 60
    const defaultNodeSize =
      type === 'relationship'
        ? { width: 100, height: 100 }
        : { width: 120, height: 60 }
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
        width: defaultNodeSize.width,
        height: defaultNodeSize.height
      }
    ])

    setEREdges([
      ...erEdges,
      {
        id: crypto.randomUUID(),
        source: selectedNode.id,
        sourceHandle: 'source-center',
        target: newId,
        targetHandle: 'target-center',
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

  const setSelectedFontSize = (fontSize: number) => {
    if (!selectedNode) return
    updateERNodeData(selectedNode.id, { fontSize })
  }

  const setSelectedLabel = (label: string) => {
    if (!selectedNode) return
    updateERNodeData(selectedNode.id, { label })
  }

  const toggleSelectedUnderline = () => {
    if (!selectedNode) return
    updateERNodeData(selectedNode.id, {
      fontUnderline: !selectedNode.data.fontUnderline
    })
  }

  const handleImportFromImage = useCallback(
    (result: ERVisionResult) => {
      if (isReadOnly) return
      const imported = buildERCanvasFromVision(result)
      if (imported.nodes.length === 0) {
        window.alert('未偵測到可匯入的 ER 結構，請換一張更清晰的圖片再試。')
        return
      }

      setERNodes(imported.nodes)
      setEREdges(imported.edges)
      setPendingNodeType(null)
      setConnectingSourceId(null)
    },
    [isReadOnly, setEREdges, setERNodes, setPendingNodeType]
  )

  return (
    <div className="glass-page flex h-screen w-full flex-col">
      <header className="glass-topbar flex h-[54px] items-center justify-between px-4">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="mr-3 rounded-md bg-[#2650ff] px-2.5 py-1 text-sm font-bold text-white hover:bg-blue-700">ERCanvas</button>
          <span className="mr-3 rounded bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">ER 圖</span>
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
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
          <button
            type="button"
            onClick={() => setImageImportOpen(true)}
            className="rounded-md border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700 disabled:opacity-60"
            disabled={isReadOnly}
          >
            圖片識別匯入
          </button>
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

      <ERTopToolbar
        selectedNode={selectedNode ?? null}
        disabled={isReadOnly}
        onSetLabel={setSelectedLabel}
        onSetFontSize={setSelectedFontSize}
        onToggleUnderline={toggleSelectedUnderline}
      />

      <div className="glass-subbar flex h-[46px] items-center px-3">
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
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleZoomOut}
            disabled={!flowInstance}
          >
            －
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleZoomIn}
            disabled={!flowInstance}
          >
            ＋
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={handleFitView}
            disabled={!flowInstance}
          >
            全覽
          </button>
          <span className="px-1 text-xs font-semibold text-slate-500">{zoomPercent}%</span>
        </div>
      </div>

      <div
        className={`glass-surface flex min-h-0 flex-1 ${pendingNodeType && !isReadOnly ? 'cursor-crosshair' : ''}`}
        onMouseMove={(event) => setMousePos({ x: event.clientX, y: event.clientY })}
      >
        {!isReadOnly && <ERObjectPanel pendingType={pendingNodeType} onSelectType={setPendingNodeType} />}

        <div className="relative flex-1">
          {staleDataWarning && (
            <div className="glass-card absolute left-1/2 top-2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-rose-800 shadow-sm">
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

          {connectingSourceId && (
            <div className="glass-badge pointer-events-none absolute left-3 top-3 z-20 rounded-md px-3 py-1 text-xs text-amber-700">
              連線模式：請點擊另一個節點完成連線（Esc 取消）
            </div>
          )}

          {pendingNodeType && !isReadOnly && (
            <div
              className="pointer-events-none fixed z-50"
              style={{ left: mousePos.x + 16, top: mousePos.y + 8 }}
            >
              <div
                className={`relative ${pendingNodeType === 'relationship' ? 'h-12 w-12' : 'h-12 w-16'} ${previewClass}`}
              >
                {pendingNodeType === 'relationship' && (
                  <svg className="h-full w-full" viewBox="0 0 100 100">
                    <polygon points="50,2 98,50 50,98 2,50" fill="white" stroke="black" strokeWidth="4" />
                  </svg>
                )}
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
            onMove={(_event, viewport) => setZoomPercent(Math.round(viewport.zoom * 100))}
            onInit={(instance) => setFlowInstance(instance)}
            onRetrySave={handleAutoSave}
            onAutoSave={isReadOnly || !autoSaveReady ? undefined : handleAutoSave}
            autoSaveDeps={[erNodes, erEdges]}
            autoSaveSessionKey={diagramId ?? null}
          />
        </div>
      </div>

      {imageImportOpen && !isReadOnly && (
        <ImageImportModal
          mode="er"
          onImport={handleImportFromImage}
          onClose={() => setImageImportOpen(false)}
        />
      )}
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
