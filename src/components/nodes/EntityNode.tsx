import { NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'
import { ERNodeToolbar } from '../toolbars/ERNodeToolbar'

export default function EntityNode({ id, data, selected }: NodeProps<ERNodeData>) {
  return (
    <div className="relative flex h-full w-full items-center justify-center border-2 border-black bg-white text-slate-900">
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <ERNodeToolbar nodeId={id} nodeType="entity" data={data} selected={selected} />
      <EditableERLabel nodeId={id} data={data} />
    </div>
  )
}
