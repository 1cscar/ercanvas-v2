import { useState } from 'react'
import { Node, NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'

type ERRelationshipFlowNode = Node<ERNodeData>

export default function RelationshipNode({ id, data, selected }: NodeProps<ERRelationshipFlowNode>) {
  const [editNonce, setEditNonce] = useState(0)

  return (
    <div
      className="relative h-full w-full bg-transparent text-slate-900"
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditNonce((value) => value + 1)
      }}
    >
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <div className="absolute left-1/2 top-1/2 h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-black bg-white" />
      <div className="absolute inset-0 flex items-center justify-center">
        <EditableERLabel nodeId={id} data={data} editNonce={editNonce} />
      </div>
    </div>
  )
}
