import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeProps, NodeResizer, Position } from '@xyflow/react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { LogicalField, LogicalTable } from '../../types'

export interface LogicalTableNodeData {
  table: LogicalTable
  mode?: 'logical' | 'physical'
  selectedFieldId: string | null
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
  onUpdateTableName: (tableId: string, name: string) => void
  onMoveField: (tableId: string, fromIndex: number, toIndex: number) => void
}

const renderFlags = (field: LogicalField, mode: 'logical' | 'physical') => {
  const list: string[] = []
  if (field.is_pk) list.push('PK')
  if (field.is_fk) list.push('FK')
  if (field.is_multi_value) list.push('🔁')
  if (field.is_composite) list.push('📦')
  if (field.partial_dep_on.length > 0) list.push('↗')
  if (field.transitive_dep_via) list.push('↔')
  if (mode === 'physical') {
    if (field.data_type) list.push(field.data_type.toUpperCase())
    if (field.is_not_null) list.push('NOT NULL')
    if (field.default_value) list.push(`DEFAULT ${field.default_value}`)
  }
  return list
}

function FieldRow({
  index,
  tableId,
  field,
  selected,
  onSelectField,
  onUpdateFieldName,
  mode
}: {
  index: number
  tableId: string
  field: LogicalField
  selected: boolean
  onSelectField: (tableId: string, fieldId: string) => void
  onUpdateFieldName: (tableId: string, fieldId: string, name: string) => void
  mode: 'logical' | 'physical'
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
    if (editing) editableRef.current?.focus()
  }, [editing])

  const prefix = field.is_pk ? '🔑' : field.is_fk ? '📎' : ' '
  const flags = renderFlags(field, mode)

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
      className={`group relative flex items-center justify-between border-b border-slate-200 px-3 py-1 text-sm ${
        selected ? 'bg-blue-100' : 'bg-white hover:bg-slate-50'
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
        position={Position.Left}
        className="!h-2 !w-2 !border !border-slate-500 !bg-white"
      />
      <Handle
        type="source"
        id={`field-source-${field.id}`}
        position={Position.Right}
        className="!h-2 !w-2 !border !border-slate-500 !bg-white"
      />

      <div className="flex min-w-0 flex-1 items-center gap-1 pr-2">
        <button
          type="button"
          className="nodrag cursor-grab text-xs text-slate-400 hover:text-slate-700"
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          ⋮⋮
        </button>
        <span className="text-xs">{prefix}</span>
        {editing ? (
          <div
            ref={editableRef}
            className="nodrag flex-1 truncate outline-none"
            contentEditable
            suppressContentEditableWarning
            onBlur={commit}
            onInput={(event) => setDraft(event.currentTarget.textContent ?? '')}
            onKeyDown={onKeyDown}
          >
            {draft}
          </div>
        ) : (
          <span className="truncate">{field.name}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
        {flags.map((flag) => (
          <span key={`${field.id}-${flag}`} className="rounded bg-slate-100 px-1">
            {flag}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function LogicalTableNode({ data, selected }: NodeProps<LogicalTableNodeData>) {
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
    if (editingTitle) titleRef.current?.focus()
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
    <div className="relative min-w-[280px] rounded-md border border-slate-300 bg-white shadow-sm">
      <NodeResizer isVisible={Boolean(selected)} minWidth={220} minHeight={120} keepAspectRatio={false} />
      <div
        className="rounded-t-md bg-slate-800 px-3 py-2 text-center text-sm font-semibold text-white"
        onDoubleClick={() => setEditingTitle(true)}
      >
        {editingTitle ? (
          <div
            ref={titleRef}
            className="nodrag outline-none"
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
        <SortableContext items={sortedFields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
          <div className="rounded-b-md bg-white">
            {sortedFields.map((field, index) => (
              <FieldRow
                key={field.id}
                index={index}
                tableId={table.id}
                field={field}
                selected={data.selectedFieldId === field.id}
                onSelectField={data.onSelectField}
                onUpdateFieldName={data.onUpdateFieldName}
                mode={mode}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
