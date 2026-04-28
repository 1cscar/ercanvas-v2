import { useState } from 'react'
import { Node, NodeProps } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { EditableERLabel, ERNodeHandles, ERNodeResizer } from './ERNodeCommon'

type EREntityFlowNode = Node<ERNodeData>

export default function EntityNode({ id, data, selected }: NodeProps<EREntityFlowNode>) {
  const [editNonce, setEditNonce] = useState(0)

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-visible"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.84))',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: selected ? '2px solid #007AFF' : '1px solid rgba(255, 255, 255, 0.62)',
        borderRadius: '16px',
        boxShadow: selected
          ? '0 0 0 4px rgba(0,122,255,0.12), 0 18px 42px rgba(29,29,31,0.16), 0 3px 10px rgba(29,29,31,0.08)'
          : '0 14px 34px rgba(29,29,31,0.12), 0 4px 10px rgba(29,29,31,0.08), inset 0 1px 0 rgba(255,255,255,0.72)',
        color: '#1d1d1f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale'
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditNonce((value) => value + 1)
      }}
    >
      <ERNodeResizer selected={selected} />
      <ERNodeHandles />
      <EditableERLabel nodeId={id} data={data} editNonce={editNonce} />
    </div>
  )
}
