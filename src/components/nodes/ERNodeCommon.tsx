import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { useDiagramStore } from '../../store/diagramStore'

interface EditableLabelProps {
  nodeId: string
  data: ERNodeData
  forceUnderline?: boolean
  editNonce?: number
}

export function ERNodeResizer({ selected }: { selected?: boolean }) {
  return (
    <NodeResizer
      isVisible={Boolean(selected)}
      minWidth={80}
      minHeight={44}
      lineClassName="border-blue-400"
      handleClassName="h-2.5 w-2.5 rounded-sm border border-blue-600 bg-white"
      keepAspectRatio={false}
    />
  )
}

export function ERNodeHandles() {
  return (
    <>
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="target-top" type="target" position={Position.Top} />

      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="target-right" type="target" position={Position.Right} />

      <Handle id="source-bottom" type="source" position={Position.Bottom} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} />

      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="target-left" type="target" position={Position.Left} />
    </>
  )
}

export function EditableERLabel({ nodeId, data, forceUnderline = false, editNonce = 0 }: EditableLabelProps) {
  const updateERNodeData = useDiagramStore((state) => state.updateERNodeData)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label ?? '')
  const [isComposing, setIsComposing] = useState(false)
  const editableRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(data.label ?? '')
  }, [data.label])

  useEffect(() => {
    if (!editing || !editableRef.current) return
    editableRef.current.focus()
    editableRef.current.select()
  }, [editing])

  useEffect(() => {
    if (editNonce <= 0) return
    setEditing(true)
  }, [editNonce])

  const labelStyle = useMemo(
    () => ({
      fontSize: `${data.fontSize ?? 14}px`,
      fontWeight: data.fontBold ? 700 : 400,
      textDecoration: forceUnderline || data.fontUnderline ? 'underline' : 'none'
    }),
    [data.fontBold, data.fontSize, data.fontUnderline, forceUnderline]
  )

  const handleCommit = () => {
    setIsComposing(false)
    setEditing(false)
    updateERNodeData(nodeId, { label: draft.trim() || '未命名' })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      handleCommit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsComposing(false)
      setEditing(false)
      setDraft(data.label ?? '')
    }
  }

  return editing ? (
    <input
      ref={editableRef}
      className="nodrag max-w-full bg-transparent px-2 text-center outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={(event) => {
        setIsComposing(false)
        setDraft(event.currentTarget.value)
      }}
      onBlur={handleCommit}
      onKeyDown={handleKeyDown}
      style={{ ...labelStyle, unicodeBidi: 'plaintext' }}
      dir="ltr"
    />
  ) : (
    <div className="nodrag cursor-text px-2 text-center" style={labelStyle} onDoubleClick={() => setEditing(true)}>
      {data.label || '雙擊編輯'}
    </div>
  )
}
