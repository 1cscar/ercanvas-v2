import { MouseEvent, ReactNode, useEffect, useRef } from 'react'
import {
  Background,
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

interface DiagramCanvasProps {
  nodes: Node[]
  edges: Edge[]
  nodeTypes?: NodeTypes
  edgeTypes?: EdgeTypes
  saveStatus: SaveStatus
  className?: string
  children?: ReactNode
  onNodesChange?: OnNodesChange<Node>
  onEdgesChange?: OnEdgesChange<Edge>
  onConnect?: OnConnect
  onPaneClick?: (event: MouseEvent) => void
  onNodeClick?: (event: MouseEvent, node: Node) => void
  onEdgeClick?: (event: MouseEvent, edge: Edge) => void
  onNodeDoubleClick?: (event: MouseEvent, node: Node) => void
  onInit?: (instance: ReactFlowInstance<Node, Edge>) => void
  onRetrySave?: () => void
  onAutoSave?: () => void
  autoSaveDeps?: unknown[]
}

export function DiagramCanvas({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  saveStatus,
  className,
  children,
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
  autoSaveDeps = []
}: DiagramCanvasProps) {
  const hasMountedRef = useRef(false)

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
      <SaveStatusIndicator status={saveStatus} onRetry={onRetrySave} />
      <ReactFlow
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
        <Background variant="dots" gap={20} size={1} />
        <Controls />
        <MiniMap zoomable pannable />
        {children}
      </ReactFlow>
    </div>
  )
}
