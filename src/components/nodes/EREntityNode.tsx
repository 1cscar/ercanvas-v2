import { Node, NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'

type EREntityRelationFlowNode = Node<ERNodeData>

export default function EREntityNode({ id, data, selected }: NodeProps<EREntityRelationFlowNode>) {
  return (
    <div className="relative h-full w-full border-2 border-black bg-white text-slate-900">
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <svg
        className="pointer-events-none absolute left-1/2 top-1/2 h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 100 100"
      >
        <polygon points="50,2 98,50 50,98 2,50" fill="none" stroke="black" strokeWidth="4" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <EditableERLabel nodeId={id} data={data} />
      </div>
    </div>
  )
}
