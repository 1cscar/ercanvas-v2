import { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy
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
  onAddFieldBelow?: (tableId: string, index: number) => void
  onDeleteField?: (tableId: string, fieldId: string) => void
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
  onSelectField,
  onUpdateFieldName,
  onAddFieldBelow,
  onDeleteField
}: {
  index: number
  tableId: string
  field: LogicalField
  selected: boolean
  mode: 'logical' | 'physical'
  isLast: boolean
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
  onAddFieldBelow?: (tableId: string, index: number) => void
  onDeleteField?: (tableId: string, fieldId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: field.id,
    data: { index }
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.name)
  const [isComposing, setIsComposing] = useState(false)
  const editableRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(field.name)
  }, [field.name])

  useEffect(() => {
    if (!editing || !editableRef.current) return
    editableRef.current.focus()
    editableRef.current.select()
  }, [editing])

  const commit = () => {
    setIsComposing(false)
    setEditing(false)
    onUpdateFieldName(tableId, field.id, draft.trim() || 'new_field')
  }

  const cancel = () => {
    setIsComposing(false)
    setEditing(false)
    setDraft(field.name)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <div
      ref={setNodeRef}
      data-logical-field-id={field.id}
      data-logical-table-id={tableId}
      className={`nodrag group relative flex min-h-[112px] min-w-[176px] max-w-[220px] flex-col items-stretch gap-2 px-3 py-2 text-[13px] font-semibold text-slate-900 ${
        selected ? 'bg-[#ecf2ff]' : 'bg-white'
      } ${
        isLast ? '' : 'border-r border-[#4d5562]'
      }`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      onClick={() => onSelectField(tableId, field.id)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditing(true)
      }}
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
        <input
          ref={editableRef}
          className="nodrag min-w-0 flex-1 bg-transparent text-left outline-none"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            setIsComposing(false)
            setDraft(event.currentTarget.value)
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          dir="ltr"
          style={{ unicodeBidi: 'plaintext' }}
        />
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

      <div className="nodrag mt-auto flex items-center justify-between gap-2">
        <button
          type="button"
          className="nodrag flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
          aria-label={`拖曳排序 ${field.name}`}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="nodrag h-7 w-7 rounded border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-100"
            aria-label={`編輯欄位 ${field.name}`}
            onClick={(event) => {
              event.stopPropagation()
              setEditing(true)
            }}
          >
            ✎
          </button>
          {onAddFieldBelow && (
            <button
              type="button"
              className="h-7 w-7 rounded border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-100"
              aria-label={`在 ${field.name} 右方新增列`}
              onClick={(event) => {
                event.stopPropagation()
                onAddFieldBelow(tableId, index)
              }}
            >
              ＋
            </button>
          )}
          {onDeleteField && (
            <button
              type="button"
              className="h-7 w-7 rounded border border-rose-200 text-rose-500 hover:border-rose-300 hover:bg-rose-50"
              aria-label={`刪除列 ${field.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onDeleteField(tableId, field.id)
              }}
            >
              －
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type LogicalTableFlowNode = Node<LogicalTableNodeData>
const MAX_RENDER_FIELDS_PER_TABLE = 120

function LogicalTableNodeInner({ id, data, selected }: NodeProps<LogicalTableFlowNode>) {
  const table = data.table
  const mode = data.mode ?? 'logical'
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const updateNodeInternals = useUpdateNodeInternals()

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(table.name)
  const [titleIsComposing, setTitleIsComposing] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleDraft(table.name)
  }, [table.name])

  useEffect(() => {
    if (!editingTitle || !titleRef.current) return
    titleRef.current.focus()
    titleRef.current.select()
  }, [editingTitle])

  const commitTitle = () => {
    setTitleIsComposing(false)
    setEditingTitle(false)
    data.onUpdateTableName(table.id, titleDraft.trim() || 'unnamed_table')
  }

  const cancelTitle = () => {
    setTitleIsComposing(false)
    setEditingTitle(false)
    setTitleDraft(table.name)
  }

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
    <div data-logical-node-id={id} className="relative min-w-[280px] w-full">
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
          strategy={horizontalListSortingStrategy}
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
                <input
                  ref={titleRef}
                  className="nodrag min-w-0 flex-1 rounded bg-white px-2 py-1 text-lg font-black tracking-tight text-slate-900 outline-none"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onCompositionStart={() => setTitleIsComposing(true)}
                  onCompositionEnd={(event) => {
                    setTitleIsComposing(false)
                    setTitleDraft(event.currentTarget.value)
                  }}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || titleIsComposing || event.keyCode === 229) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitTitle()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelTitle()
                    }
                  }}
                  dir="ltr"
                  style={{ unicodeBidi: 'plaintext' }}
                />
              ) : (
                <div className="min-w-0 flex-1 break-words text-lg font-black tracking-tight text-slate-900">
                  {table.name}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="nodrag rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    setEditingTitle(true)
                  }}
                >
                  編輯
                </button>
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

            <div className="flex overflow-x-auto">
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
                    onSelectField={data.onSelectField}
                    onUpdateFieldName={data.onUpdateFieldName}
                    onAddFieldBelow={data.onAddFieldBelow}
                    onDeleteField={data.onDeleteField}
                  />
                ))
              )}
              {hiddenFieldCount > 0 && (
                <div
                  className="flex min-h-[112px] min-w-[176px] items-center justify-center border-l border-[#4d5562] bg-slate-50 px-3 py-2 text-center text-[11px] font-semibold text-slate-500"
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

export default memo(LogicalTableNodeInner)
