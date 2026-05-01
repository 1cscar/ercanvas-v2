import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { Node } from '@xyflow/react'
import { ERNodeData, ERNodeType } from '../../types'

interface ERFloatingToolbarProps {
  node: Node<ERNodeData>
  anchor: { x: number; y: number }
  onAddNode: (type: ERNodeType) => void
  onStartConnect: () => void
  onDuplicate: () => void
  onDelete: () => void
  onChangeType: (type: ERNodeType) => void
}

const NODE_TYPES: { value: ERNodeType; label: string }[] = [
  { value: 'entity', label: '實體' },
  { value: 'attribute', label: '屬性' },
  { value: 'relationship', label: '關聯' },
  { value: 'er_entity', label: '實體關聯' }
]

export function ERFloatingToolbar({
  node,
  anchor,
  onAddNode,
  onStartConnect,
  onDuplicate,
  onDelete,
  onChangeType
}: ERFloatingToolbarProps) {
  const [offset, setOffset] = useState({ x: 22, y: 0 })
  const dragStateRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  useEffect(() => {
    setOffset({ x: 22, y: 0 })
  }, [node.id])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y
    }

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const state = dragStateRef.current
      if (!state) return
      setOffset({
        x: state.baseX + (moveEvent.clientX - state.startX),
        y: state.baseY + (moveEvent.clientY - state.startY)
      })
    }

    const onUp = () => {
      dragStateRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      className="fixed z-[90] w-[164px] rounded-md border border-slate-300 bg-white shadow-xl"
      style={{
        left: anchor.x + offset.x,
        top: anchor.y + offset.y
      }}
    >
      <div
        className="cursor-move rounded-t-md border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500"
        onPointerDown={startDrag}
      >
        工具列（可拖動）
      </div>

      <div className="flex flex-col gap-1 p-2 text-xs">
        <select
          className="rounded border border-slate-300 px-2 py-1"
          defaultValue=""
          onChange={(event) => {
            if (!event.target.value) return
            onAddNode(event.target.value as ERNodeType)
            event.target.value = ''
          }}
        >
          <option value="">＋ 新增元素</option>
          {NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-left hover:bg-slate-50"
          onClick={onStartConnect}
        >
          → 連線
        </button>

        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-left hover:bg-slate-50"
          onClick={onDuplicate}
        >
          ⎘ 複製
        </button>

        <button
          type="button"
          className="rounded border border-rose-300 px-2 py-1 text-left text-rose-700 hover:bg-rose-50"
          onClick={onDelete}
        >
          🗑 刪除
        </button>

        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={node.type as ERNodeType}
          onChange={(event) => onChangeType(event.target.value as ERNodeType)}
        >
          {NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              更改：{item.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
