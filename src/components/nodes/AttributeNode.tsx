import { NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'
import { ERNodeToolbar } from '../toolbars/ERNodeToolbar'

export default function AttributeNode({ id, data, selected }: NodeProps<ERNodeData>) {
  return (
    <div className="relative flex h-full w-full items-center justify-center rounded-[999px] border-2 border-black bg-white text-slate-900">
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <ERNodeToolbar nodeId={id} nodeType="attribute" data={data} selected={selected} />
      <EditableERLabel nodeId={id} data={data} forceUnderline={data.isPrimaryKey} />
    </div>
  )
}
