import { MouseEvent, ReactNode, useEffect, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  EdgeTypes,
  MiniMap,
  Node,
  NodeTypes,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
  ReactFlow,
  ReactFlowInstance
} from '@xyflow/react'
import { SaveStatus } from '../store/saveStatus'
import { SaveStatusIndicator } from './SaveStatusIndicator'

interface DiagramCanvasProps<TNode extends Node = Node, TEdge extends Edge = Edge> {
  nodes: TNode[]
  edges: TEdge[]
  nodeTypes?: NodeTypes
  edgeTypes?: EdgeTypes
  saveStatus: SaveStatus
  className?: string
  children?: ReactNode
  showSaveStatus?: boolean
  showControls?: boolean
  showMiniMap?: boolean
  backgroundVariant?: BackgroundVariant
  backgroundGap?: number
  backgroundSize?: number
  backgroundColor?: string
  onNodesChange?: OnNodesChange<TNode>
  onEdgesChange?: OnEdgesChange<TEdge>
  onConnect?: OnConnect
  onPaneClick?: (event: MouseEvent) => void
  onNodeClick?: (event: MouseEvent, node: TNode) => void
  onEdgeClick?: (event: MouseEvent, edge: TEdge) => void
  onNodeDoubleClick?: (event: MouseEvent, node: TNode) => void
  onInit?: (instance: ReactFlowInstance<TNode, TEdge>) => void
  onRetrySave?: () => void
  onAutoSave?: () => void
  autoSaveDeps?: unknown[]
  autoSaveSessionKey?: string | null
}

export function DiagramCanvas<TNode extends Node = Node, TEdge extends Edge = Edge>({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  saveStatus,
  className,
  children,
  showSaveStatus = true,
  showControls = true,
  showMiniMap = true,
  backgroundVariant = BackgroundVariant.Dots,
  backgroundGap = 20,
  backgroundSize = 1,
  backgroundColor,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onPaneClick,
  onNodeClick,
  onEdgeClick,
  onNodeDoubleClick,
  onInit,
  onRetrySave,
  onAutoSave,
  autoSaveDeps = [],
  autoSaveSessionKey = null
}: DiagramCanvasProps<TNode, TEdge>) {
  const hasMountedRef = useRef(false)

  useEffect(() => {
    hasMountedRef.current = false
  }, [autoSaveSessionKey])

  useEffect(() => {
    if (!onAutoSave) return
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }

    const timer = window.setTimeout(() => {
      onAutoSave()
    }, 1000)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, autoSaveDeps)

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      {showSaveStatus && <SaveStatusIndicator status={saveStatus} onRetry={onRetrySave} />}
      <ReactFlow<TNode, TEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect as ((connection: Connection) => void) | undefined}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onInit={onInit}
        minZoom={0.005}
        maxZoom={4}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        translateExtent={[
          [-5000, -5000],
          [55000, 35000]
        ]}
        fitView
      >
        <Background
          variant={backgroundVariant}
          gap={backgroundGap}
          size={backgroundSize}
          color={backgroundColor}
        />
        {showControls && <Controls />}
        {showMiniMap && <MiniMap zoomable pannable />}
        {children}
      </ReactFlow>
    </div>
  )
}
