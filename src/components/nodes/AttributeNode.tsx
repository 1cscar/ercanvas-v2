import { useState } from 'react'
import { Node, NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'

type ERAttributeFlowNode = Node<ERNodeData>

export default function AttributeNode({ id, data, selected }: NodeProps<ERAttributeFlowNode>) {
  const [editNonce, setEditNonce] = useState(0)

  return (
    <div
      className="relative flex h-full w-full items-center justify-center rounded-[999px] border-2 border-black bg-white text-slate-900"
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditNonce((value) => value + 1)
      }}
    >
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <EditableERLabel nodeId={id} data={data} forceUnderline={data.isPrimaryKey} editNonce={editNonce} />
    </div>
  )
}
