import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import { ERNodeData } from '../../types'
import { useDiagramStore } from '../../store/diagramStore'

interface EditableLabelProps {
  nodeId: string
  data: ERNodeData
  forceUnderline?: boolean
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

export function EditableERLabel({ nodeId, data, forceUnderline = false }: EditableLabelProps) {
  const updateERNodeData = useDiagramStore((state) => state.updateERNodeData)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label ?? '')
  const editableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(data.label ?? '')
  }, [data.label])

  useEffect(() => {
    if (!editing || !editableRef.current) return
    editableRef.current.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(editableRef.current)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [editing])

  const labelStyle = useMemo(
    () => ({
      fontSize: `${data.fontSize ?? 14}px`,
      fontWeight: data.fontBold ? 700 : 400,
      textDecoration: forceUnderline || data.fontUnderline ? 'underline' : 'none'
    }),
    [data.fontBold, data.fontSize, data.fontUnderline, forceUnderline]
  )

  const handleCommit = () => {
    setEditing(false)
    updateERNodeData(nodeId, { label: draft.trim() || '未命名' })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleCommit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(false)
      setDraft(data.label ?? '')
    }
  }

  return editing ? (
    <div
      ref={editableRef}
      className="nodrag max-w-full break-words px-2 text-center outline-none"
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => setDraft(event.currentTarget.textContent ?? '')}
      onBlur={handleCommit}
      onKeyDown={handleKeyDown}
      style={labelStyle}
    >
      {draft}
    </div>
  ) : (
    <div className="nodrag cursor-text px-2 text-center" style={labelStyle} onDoubleClick={() => setEditing(true)}>
      {data.label || '雙擊編輯'}
    </div>
  )
}
