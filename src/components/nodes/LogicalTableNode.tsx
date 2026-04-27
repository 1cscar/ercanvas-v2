import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { LogicalField, LogicalTable } from '../../types'

export interface LogicalTableNodeData extends Record<string, unknown> {
  table: LogicalTable
  mode?: 'logical' | 'physical'
  selectedFieldId: string | null
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
  onUpdateTableName: (tableId: string, name: string) => void
  onMoveField: (tableId: string, fromIndex: number, toIndex: number) => void
  onDeleteTable?: (tableId: string) => void
}

const renderPhysicalMeta = (field: LogicalField) => {
  const tokens: string[] = []
  if (field.data_type) tokens.push(field.data_type.toUpperCase())
  if (field.is_pk) tokens.push('PK')
  if (field.is_fk) tokens.push('FK')
  if (field.is_not_null) tokens.push('NOT NULL')
  if (field.default_value) tokens.push(`DEFAULT ${field.default_value}`)
  return tokens.join(' ')
}

function FieldCell({
  index,
  tableId,
  field,
  selected,
  mode,
  isLast,
  layout,
  onSelectField,
  onUpdateFieldName
}: {
  index: number
  tableId: string
  field: LogicalField
  selected: boolean
  mode: 'logical' | 'physical'
  isLast: boolean
  layout: 'horizontal' | 'vertical'
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: field.id,
    data: { index }
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.name)
  const editableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(field.name)
  }, [field.name])

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

  const commit = () => {
    setEditing(false)
    onUpdateFieldName(tableId, field.id, draft.trim() || 'new_field')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(false)
      setDraft(field.name)
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`nodrag group relative flex items-start gap-2 px-3 py-2 text-[13px] font-semibold text-slate-900 ${
        layout === 'horizontal' ? 'h-[56px] w-[220px] shrink-0' : 'min-h-[52px] w-full'
      } ${
        selected ? 'bg-[#ecf2ff]' : 'bg-white'
      } ${
        layout === 'horizontal'
          ? isLast
            ? ''
            : 'border-r border-[#4d5562]'
          : isLast
            ? ''
            : 'border-b border-[#4d5562]'
      }`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      onClick={() => onSelectField(tableId, field.id)}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle
        type="target"
        id={`field-target-${field.id}`}
        position={Position.Top}
        className="!h-2 !w-2 !border !border-slate-600 !bg-white opacity-0 transition-opacity group-hover:opacity-100"
      />
      <Handle
        type="source"
        id={`field-source-${field.id}`}
        position={Position.Bottom}
        className="!h-2 !w-2 !border !border-slate-600 !bg-white opacity-0 transition-opacity group-hover:opacity-100"
      />

      {editing ? (
        <div
          ref={editableRef}
          className="nodrag min-w-0 flex-1 break-words outline-none"
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => setDraft(event.currentTarget.textContent ?? '')}
          onBlur={commit}
          onKeyDown={onKeyDown}
        >
          {draft}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="break-words text-left leading-5">{field.name}</div>
          {mode === 'physical' && (
            <div className="mt-0.5 break-words text-[10px] font-normal leading-4 text-slate-500">
              {renderPhysicalMeta(field)}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="nodrag flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
        aria-label={`拖曳排序 ${field.name}`}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
    </div>
  )
}

type LogicalTableFlowNode = Node<LogicalTableNodeData>
const MAX_RENDER_FIELDS_PER_TABLE = 120

export default function LogicalTableNode({ id, data, selected }: NodeProps<LogicalTableFlowNode>) {
  const table = data.table
  const mode = data.mode ?? 'logical'
  const isHorizontal = mode === 'logical'
  const layout = isHorizontal ? 'horizontal' : 'vertical'
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const updateNodeInternals = useUpdateNodeInternals()

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(table.name)
  const titleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitleDraft(table.name)
  }, [table.name])

  useEffect(() => {
    if (!editingTitle || !titleRef.current) return
    titleRef.current.focus()
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(titleRef.current)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [editingTitle])

  const sortedFields = useMemo(
    () => [...table.fields].sort((a, b) => a.order_index - b.order_index),
    [table.fields]
  )
  const visibleFields = useMemo(
    () => sortedFields.slice(0, MAX_RENDER_FIELDS_PER_TABLE),
    [sortedFields]
  )
  const hiddenFieldCount = Math.max(0, sortedFields.length - visibleFields.length)

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, visibleFields, updateNodeInternals])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = sortedFields.findIndex((field) => field.id === active.id)
    const toIndex = sortedFields.findIndex((field) => field.id === over.id)
    if (fromIndex < 0 || toIndex < 0) return
    data.onMoveField(table.id, fromIndex, toIndex)
  }

  return (
    <div className="relative min-w-[280px] w-full">
      {/* Node-level handles outside DnD context so React Flow can reliably measure positions */}
      <Handle type="target" id="node-target" position={Position.Top} className="!opacity-0 !pointer-events-none" isConnectable={false} />
      <Handle type="source" id="node-source" position={Position.Bottom} className="!opacity-0 !pointer-events-none" isConnectable={false} />

      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={280}
        minHeight={120}
        lineClassName="border-blue-400"
        handleClassName="h-2.5 w-2.5 rounded-sm border border-blue-600 bg-white"
      />

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={visibleFields.map((field) => field.id)}
          strategy={isHorizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}
        >
          <div
            className={`overflow-visible rounded-sm border-2 bg-white shadow-sm ${
              selected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-[#4d5562]'
            }`}
          >
            <div
              className="flex cursor-grab items-center justify-between gap-3 border-b-2 border-[#4d5562] bg-[#f4f6f8] px-3 py-2"
              onDoubleClick={() => setEditingTitle(true)}
            >
              {editingTitle ? (
                <div
                  ref={titleRef}
                  className="nodrag min-w-0 flex-1 rounded bg-white px-2 py-1 text-lg font-black tracking-tight text-slate-900 outline-none"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => setTitleDraft(event.currentTarget.textContent ?? '')}
                  onBlur={() => {
                    setEditingTitle(false)
                    data.onUpdateTableName(table.id, titleDraft.trim() || 'unnamed_table')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      setEditingTitle(false)
                      data.onUpdateTableName(table.id, titleDraft.trim() || 'unnamed_table')
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditingTitle(false)
                      setTitleDraft(table.name)
                    }
                  }}
                >
                  {titleDraft}
                </div>
              ) : (
                <div className="min-w-0 flex-1 break-words text-lg font-black tracking-tight text-slate-900">
                  {table.name}
                </div>
              )}

              <div className="flex items-center gap-2">
                {data.onDeleteTable && (
                  <button
                    type="button"
                    className="nodrag rounded border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onDeleteTable?.(table.id)
                    }}
                  >
                    刪除表
                  </button>
                )}
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Drag</div>
              </div>
            </div>

            <div className={isHorizontal ? 'flex flex-row overflow-x-auto' : 'flex flex-col'}>
              {visibleFields.length === 0 ? (
                <div className="px-3 py-3 text-xs font-semibold text-slate-500">尚無欄位</div>
              ) : (
                visibleFields.map((field, index) => (
                  <FieldCell
                    key={field.id}
                    index={index}
                    tableId={table.id}
                    field={field}
                    selected={data.selectedFieldId === field.id}
                    mode={mode}
                    isLast={index === visibleFields.length - 1}
                    layout={layout}
                    onSelectField={data.onSelectField}
                    onUpdateFieldName={data.onUpdateFieldName}
                  />
                ))
              )}
              {hiddenFieldCount > 0 && (
                <div
                  className={`flex items-center justify-center bg-slate-50 px-3 text-center text-[11px] font-semibold text-slate-500 ${
                    isHorizontal
                      ? 'h-[56px] min-w-[220px] shrink-0 border-l border-[#4d5562]'
                      : 'min-h-[52px] w-full border-t border-[#4d5562] py-2'
                  }`}
                >
                  +{hiddenFieldCount} 欄位（為避免頁面崩潰暫不渲染）
                </div>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
