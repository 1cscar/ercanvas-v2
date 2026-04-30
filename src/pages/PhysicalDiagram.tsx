import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const PHYSICAL_TABLE_MIN_WIDTH = 360
const PHYSICAL_TABLE_HEADER_HEIGHT = 56
const PHYSICAL_TABLE_FIELD_WIDTH = 196
const PHYSICAL_TABLE_BODY_HEIGHT = 116

const estimatePhysicalTableHeight = (_fieldCount: number) =>
  PHYSICAL_TABLE_HEADER_HEIGHT + PHYSICAL_TABLE_BODY_HEIGHT

const estimatePhysicalTableWidth = (fieldCount: number) =>
  Math.max(PHYSICAL_TABLE_MIN_WIDTH, Math.max(fieldCount, 1) * PHYSICAL_TABLE_FIELD_WIDTH)

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

function PhysicalDiagramInner() {
  const location = useLocation()
  const navigate = useNavigate()
  const { id: diagramId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const shareToken = searchParams.get('shareToken')
  const sharePermission = searchParams.get('permission')
  const isReadOnly = Boolean(shareToken) && sharePermission === 'viewer'
  const [connectingFieldId, setConnectingFieldId] = useState<string | null>(null)
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set())
  const [diagramName, setDiagramName] = useState('未命名實體圖')
  const [autoSaveReady, setAutoSaveReady] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [historyState, setHistoryState] = useState<{ entries: LogicalSnapshot[]; index: number }>({
    entries: [],
    index: -1
  })
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<PhysicalFlowNode, Edge> | null>(null)
  const applyingHistoryRef = useRef(false)

  const logicalTables = useDiagramStore((state) => state.logicalTables)
  const logicalEdges = useDiagramStore((state) => state.logicalEdges)
  const selectedFieldId = useDiagramStore((state) => state.selectedFieldId)
  const saveStatus = useDiagramStore((state) => state.saveStatus)

  const setLogicalTables = useDiagramStore((state) => state.setLogicalTables)
  const setLogicalEdges = useDiagramStore((state) => state.setLogicalEdges)
  const addLogicalField = useDiagramStore((state) => state.addLogicalField)
  const deleteLogicalField = useDiagramStore((state) => state.deleteLogicalField)
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
    setAutoSaveReady(false)
    setHistoryState({ entries: [], index: -1 })
    setLogicalTables([])
    setLogicalEdges([])
    setSelectedFieldId(null)
    setConnectingFieldId(null)
    setSelectedEdgeIds(new Set())
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
        console.error('[PhysicalDiagram] load failed', error)
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
    if (!flowInstance) return
    setZoomPercent(Math.round(flowInstance.getZoom() * 100))
  }, [flowInstance])

  const handleFitView = useCallback(() => {
    if (!flowInstance) return
    void flowInstance.fitView()
  }, [flowInstance])

  const handleZoomIn = useCallback(() => {
    if (!flowInstance) return
    void flowInstance.zoomIn({ duration: 160 })
  }, [flowInstance])

  const handleZoomOut = useCallback(() => {
    if (!flowInstance) return
    void flowInstance.zoomOut({ duration: 160 })
  }, [flowInstance])

  useEffect(() => {
    if (!diagramId) return
    void (async () => {
      const { data } = await supabase.from('diagrams').select('name').eq('id', diagramId).single()
      if (data?.name) setDiagramName(data.name)
    })()
  }, [diagramId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isReadOnly) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedEdgeIds.size === 0) return
      if (isTextEditingTarget(event.target)) return

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

  const nodes = useMemo<PhysicalFlowNode[]>(
    () =>
      logicalTables.map((table) => ({
        id: table.id,
        type: 'logicalTable',
        position: { x: table.x, y: table.y },
        width: estimatePhysicalTableWidth(table.fields.length),
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
          onMoveField: (tableId, fromIndex, toIndex) => moveLogicalField(tableId, fromIndex, toIndex),
          onAddFieldBelow: isReadOnly
            ? undefined
            : (tableId, index) => addLogicalField(tableId, index),
          onDeleteField: isReadOnly
            ? undefined
            : (tableId, fieldId) => deleteLogicalField(tableId, fieldId)
        }
      })),
    [
      connectingFieldId,
      diagramId,
      logicalEdges,
      logicalTables,
      moveLogicalField,
      addLogicalField,
      deleteLogicalField,
      selectedFieldId,
      setLogicalEdges,
      setLogicalTables,
      setSelectedFieldId,
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
    [setSelectedFieldId]
  )

  const edges = useMemo<Edge[]>(
    () => {
      const reconciledEdges = reconcileLogicalEdges(logicalTables, logicalEdges)
      return reconciledEdges.map((edge) => ({
        id: edge.id,
        source: edge.source_table_id,
        target: edge.target_table_id,
        type: 'logicalFieldEdge',
        selectable: true,
        selected: selectedEdgeIds.has(edge.id),
        zIndex: 1200,
        data: {
          sourceFieldId: edge.source_field_id,
          targetFieldId: edge.target_field_id,
          onSelectEdge: handleSelectEdge
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#111827' },
        style: { stroke: '#111827', strokeWidth: 2.4 }
      }))
    },
    [handleSelectEdge, logicalEdges, logicalTables, selectedEdgeIds]
  )

  useEffect(() => {
    if (logicalTables.length === 0 && logicalEdges.length === 0) return
    const reconciledEdges = reconcileLogicalEdges(logicalTables, logicalEdges)
    if (areLogicalEdgesEqual(logicalEdges, reconciledEdges)) return
    setLogicalEdges(reconciledEdges)
  }, [logicalEdges, logicalTables, setLogicalEdges])

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
      if (removedIds.size > 0) {
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
    <div className="glass-page flex h-screen w-full flex-col">
      <header className="glass-topbar flex h-[54px] items-center justify-between px-4">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="mr-3 rounded-md px-2.5 py-1 text-sm font-bold">ERCanvas</button>
          <span className="glass-badge mr-3 rounded px-2 py-1 text-xs font-semibold">實體圖</span>
          <h1 className="text-[28px] font-extrabold tracking-tight text-slate-900">{diagramName}</h1>
          {isReadOnly && (
            <span className="glass-badge ml-3 rounded px-2 py-1 text-xs font-semibold">唯讀分享</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {diagramId && !shareToken && <ShareDiagramButton diagramId={diagramId} />}
        </div>
      </header>

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

      <div className="glass-surface relative min-h-0 flex-1">
      <DiagramCanvas
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        saveStatus={saveStatus}
        className="field-edge-canvas"
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(event, edge) => {
          event.stopPropagation()
          handleSelectEdge(edge.id, event.shiftKey)
        }}
        onMove={(_event, viewport) => setZoomPercent(Math.round(viewport.zoom * 100))}
        onPaneClick={() => {
          setSelectedFieldId(null)
          setConnectingFieldId(null)
          setSelectedEdgeIds(new Set())
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
