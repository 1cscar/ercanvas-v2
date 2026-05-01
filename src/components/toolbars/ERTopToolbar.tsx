import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Node } from '@xyflow/react'
import { ERNodeData, ERNodeType } from '../../types'

interface ERTopToolbarProps {
  selectedNode: Node<ERNodeData> | null
  disabled?: boolean
  onSetLabel: (label: string) => void
  onSetFontSize: (fontSize: number) => void
  onToggleUnderline: () => void
}

const NODE_TYPE_LABEL: Record<ERNodeType, string> = {
  entity: '實體',
  attribute: '屬性',
  relationship: '關聯',
  er_entity: '實體關聯'
}

const clampFontSize = (value: number) => Math.max(10, Math.min(72, value))

export function ERTopToolbar({
  selectedNode,
  disabled = false,
  onSetLabel,
  onSetFontSize,
  onToggleUnderline
}: ERTopToolbarProps) {
  const [fontInput, setFontInput] = useState('14')
  const [labelInput, setLabelInput] = useState('')

  const fontSize = selectedNode?.data.fontSize ?? 14
  const isUnderlineActive = Boolean(selectedNode?.data.fontUnderline)
  const selectedLabel = selectedNode?.data.label?.trim() || '未命名'

  useEffect(() => {
    setFontInput(String(fontSize))
  }, [fontSize, selectedNode?.id])

  useEffect(() => {
    setLabelInput(selectedNode?.data.label ?? '')
  }, [selectedNode?.data.label, selectedNode?.id])

  const selectionLabel = useMemo(() => {
    if (!selectedNode) return '未選取元素'
    return `${NODE_TYPE_LABEL[selectedNode.type as ERNodeType] ?? '元素'}：${selectedLabel}`
  }, [selectedLabel, selectedNode])

  const commitFontSize = (rawValue: string) => {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
      setFontInput(String(fontSize))
      return
    }
    const next = clampFontSize(parsed)
    setFontInput(String(next))
    onSetFontSize(next)
  }

  const handleFontInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFontInput(event.target.value)
  }

  const commitLabel = (rawValue: string) => {
    if (!selectedNode || disabled) return
    const normalized = rawValue.trim().length === 0 ? '未命名' : rawValue
    setLabelInput(normalized)
    onSetLabel(normalized)
  }

  return (
    <div className="flex min-h-[48px] flex-col gap-2 border-b border-slate-200 bg-[#f6f7f9] px-3 py-2 lg:h-[48px] lg:flex-row lg:items-center lg:justify-between lg:px-4 lg:py-0">
      <div className="min-w-0 text-sm font-semibold text-slate-700">
        <span className="mr-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Text</span>
        <span className="truncate">{selectionLabel}</span>
      </div>

      <div className="w-full overflow-x-auto lg:w-auto">
        <div className="flex w-max items-center gap-2 pb-1 lg:pb-0">
          <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
            文字
            <input
              type="text"
              className="w-40 border-none bg-transparent text-sm outline-none disabled:cursor-not-allowed sm:w-56"
              value={labelInput}
              onChange={(event) => setLabelInput(event.target.value)}
              onBlur={() => commitLabel(labelInput)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitLabel(labelInput)
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setLabelInput(selectedNode?.data.label ?? '')
                }
              }}
              disabled={!selectedNode || disabled}
            />
          </label>

          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => commitFontSize(String(fontSize - 2))}
            disabled={!selectedNode || disabled}
          >
            A-
          </button>

          <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
            字級
            <input
              type="number"
              min={10}
              max={72}
              step={1}
              className="w-14 border-none bg-transparent text-right outline-none disabled:cursor-not-allowed"
              value={fontInput}
              onChange={handleFontInputChange}
              onBlur={() => commitFontSize(fontInput)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitFontSize(fontInput)
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFontInput(String(fontSize))
                }
              }}
              disabled={!selectedNode || disabled}
            />
          </label>

          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => commitFontSize(String(fontSize + 2))}
            disabled={!selectedNode || disabled}
          >
            A+
          </button>

          <button
            type="button"
            className={`rounded border px-3 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
              isUnderlineActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
            }`}
            onClick={onToggleUnderline}
            disabled={!selectedNode || disabled}
          >
            底線
          </button>
        </div>
      </div>
    </div>
  )
}
