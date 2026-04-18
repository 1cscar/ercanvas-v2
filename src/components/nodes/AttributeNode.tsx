import { Node, NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'

type ERAttributeFlowNode = Node<ERNodeData>

export default function AttributeNode({ id, data, selected }: NodeProps<ERAttributeFlowNode>) {
  return (
    <div className="relative flex h-full w-full items-center justify-center rounded-[999px] border-2 border-black bg-white text-slate-900">
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <EditableERLabel nodeId={id} data={data} forceUnderline={data.isPrimaryKey} />
    </div>
  )
}
