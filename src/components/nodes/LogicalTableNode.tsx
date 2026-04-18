import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position } from '@xyflow/react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { LogicalField, LogicalTable } from '../../types'

export interface LogicalTableNodeData extends Record<string, unknown> {
  table: LogicalTable
  mode?: 'logical' | 'physical'
  selectedFieldId: string | null
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
  onUpdateTableName: (tableId: string, name: string) => void
  onMoveField: (tableId: string, fromIndex: number, toIndex: number) => void
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
  onUpdateFieldName
}: {
  index: number
  tableId: string
  field: LogicalField
  selected: boolean
  mode: 'logical' | 'physical'
  isLast: boolean
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
      className={`nodrag group relative flex min-w-[92px] items-center justify-center px-4 text-[13px] font-semibold text-slate-900 ${
        mode === 'physical' ? 'h-11' : 'h-9'
      } ${selected ? 'bg-[#ecf2ff]' : 'bg-white'} ${isLast ? '' : 'border-r border-[#4d5562]'}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      onClick={() => onSelectField(tableId, field.id)}
      onDoubleClick={() => setEditing(true)}
      {...attributes}
      {...listeners}
    >
      <Handle
        type="target"
        id={`field-target-${field.id}`}
        position={Position.Left}
        className="!h-2 !w-2 !border !border-slate-600 !bg-white opacity-0 transition-opacity group-hover:opacity-100"
      />
      <Handle
        type="source"
        id={`field-source-${field.id}`}
        position={Position.Right}
        className="!h-2 !w-2 !border !border-slate-600 !bg-white opacity-0 transition-opacity group-hover:opacity-100"
      />

      {editing ? (
        <div
          ref={editableRef}
          className="nodrag min-w-0 whitespace-nowrap outline-none"
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => setDraft(event.currentTarget.textContent ?? '')}
          onBlur={commit}
          onKeyDown={onKeyDown}
        >
          {draft}
        </div>
      ) : (
        <div className="min-w-0 whitespace-nowrap text-center">
          <span>{field.name}</span>
          {mode === 'physical' && (
            <div className="mt-0.5 text-[10px] font-normal text-slate-500">{renderPhysicalMeta(field)}</div>
          )}
        </div>
      )}
    </div>
  )
}

type LogicalTableFlowNode = Node<LogicalTableNodeData>

export default function LogicalTableNode({ data, selected }: NodeProps<LogicalTableFlowNode>) {
  const table = data.table
  const mode = data.mode ?? 'logical'
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(table.name)
  const titleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitleDraft(table.name)
  }, [table.name])

  useEffect(() => {
    if (!editingTitle || !titleRef.current) return
    titleRef.current.focus()
  }, [editingTitle])

  const sortedFields = useMemo(
    () => [...table.fields].sort((a, b) => Number(b.is_pk) - Number(a.is_pk) || a.order_index - b.order_index),
    [table.fields]
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = sortedFields.findIndex((field) => field.id === active.id)
    const toIndex = sortedFields.findIndex((field) => field.id === over.id)
    if (fromIndex < 0 || toIndex < 0) return
    data.onMoveField(table.id, fromIndex, toIndex)
  }

  return (
    <div className="relative inline-block">
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={240}
        minHeight={52}
        lineClassName="border-blue-400"
        handleClassName="h-2.5 w-2.5 rounded-sm border border-blue-600 bg-white"
      />

      <div
        className="mb-1 pl-1 text-[34px] font-black leading-none tracking-tight text-slate-900"
        onDoubleClick={() => setEditingTitle(true)}
      >
        {editingTitle ? (
          <div
            ref={titleRef}
            className="nodrag rounded bg-white/80 px-1 outline-none"
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
            }}
          >
            {titleDraft}
          </div>
        ) : (
          table.name
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={sortedFields.map((field) => field.id)} strategy={horizontalListSortingStrategy}>
          <div className="inline-flex flex-nowrap items-stretch overflow-visible border-2 border-[#4d5562] bg-white">
            {sortedFields.map((field, index) => (
              <FieldCell
                key={field.id}
                index={index}
                tableId={table.id}
                field={field}
                selected={data.selectedFieldId === field.id}
                mode={mode}
                isLast={index === sortedFields.length - 1}
                onSelectField={data.onSelectField}
                onUpdateFieldName={data.onUpdateFieldName}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
