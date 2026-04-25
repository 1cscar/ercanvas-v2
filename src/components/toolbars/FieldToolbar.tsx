import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useDiagramStore } from '../../store/diagramStore'
import { LogicalField, LogicalTable } from '../../types'

interface FieldToolbarProps {
  table: LogicalTable
  field: LogicalField
  mode?: 'logical' | 'physical'
  onStartConnect?: (fieldId: string) => void
  onDeleteTable?: (tableId: string) => void
}

const splitCommaValues = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

export function FieldToolbar({
  table,
  field,
  mode = 'logical',
  onStartConnect,
  onDeleteTable
}: FieldToolbarProps) {
  const addLogicalField = useDiagramStore((state) => state.addLogicalField)
  const deleteLogicalField = useDiagramStore((state) => state.deleteLogicalField)
  const updateFieldName = useDiagramStore((state) => state.updateFieldName)
  const updateFieldMeta = useDiagramStore((state) => state.updateFieldMeta)
  const setFieldFKRef = useDiagramStore((state) => state.setFieldFKRef)
  const toggleFieldPK = useDiagramStore((state) => state.toggleFieldPK)
  const toggleFieldFK = useDiagramStore((state) => state.toggleFieldFK)
  const setFieldMark = useDiagramStore((state) => state.setFieldMark)
  const setConnectingFieldId = useDiagramStore((state) => state.setConnectingFieldId)

  const [editValue, setEditValue] = useState(field.name)
  const [fkRefTable, setFkRefTable] = useState(field.fk_ref_table ?? '')
  const [fkRefField, setFkRefField] = useState(field.fk_ref_field ?? '')
  const [compositeChildren, setCompositeChildren] = useState(field.composite_children.join(', '))
  const [partialDeps, setPartialDeps] = useState(field.partial_dep_on.join(', '))
  const [transitiveVia, setTransitiveVia] = useState(field.transitive_dep_via ?? '')

  useEffect(() => {
    setEditValue(field.name)
    setFkRefTable(field.fk_ref_table ?? '')
    setFkRefField(field.fk_ref_field ?? '')
    setCompositeChildren(field.composite_children.join(', '))
    setPartialDeps(field.partial_dep_on.join(', '))
    setTransitiveVia(field.transitive_dep_via ?? '')
  }, [field])

  const fieldIndex = useMemo(
    () => table.fields.findIndex((targetField) => targetField.id === field.id),
    [field.id, table.fields]
  )

  const applyRename = (event: FormEvent) => {
    event.preventDefault()
    updateFieldName(table.id, field.id, editValue.trim() || 'new_field')
  }

  return (
    <div className="absolute right-3 top-12 z-30 w-64 space-y-2 rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl">
      <h3 className="text-sm font-semibold text-slate-800">Field Toolbar</h3>
      <p className="truncate text-slate-500">
        {table.name}.{field.name}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => addLogicalField(table.id, fieldIndex - 1)}
        >
          ← 左側新增
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => addLogicalField(table.id, fieldIndex)}
        >
          → 右側新增
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded border border-rose-300 px-2 py-1 text-rose-600 hover:bg-rose-50"
          onClick={() => deleteLogicalField(table.id, field.id)}
        >
          刪除欄位
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
          onClick={() => {
            setConnectingFieldId(field.id)
            onStartConnect?.(field.id)
          }}
        >
          開始連線
        </button>
      </div>

      <form className="space-y-1" onSubmit={applyRename}>
        <label className="block text-slate-600">✏ 編輯文字</label>
        <div className="flex gap-1">
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
          />
          <button type="submit" className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
            套用
          </button>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={`rounded border px-2 py-1 ${field.is_pk ? 'border-amber-500 bg-amber-100' : 'border-slate-300'}`}
          onClick={() => toggleFieldPK(table.id, field.id)}
        >
          🔑 PK
        </button>
        <button
          type="button"
          className={`rounded border px-2 py-1 ${field.is_fk ? 'border-blue-500 bg-blue-100' : 'border-slate-300'}`}
          onClick={() => toggleFieldFK(table.id, field.id)}
        >
          📎 FK
        </button>
      </div>

      {field.is_fk && (
        <div className="space-y-1 rounded border border-slate-200 p-2">
          <p className="font-medium text-slate-700">FK 參照</p>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="參照表名"
            value={fkRefTable}
            onChange={(event) => setFkRefTable(event.target.value)}
          />
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="參照欄位名"
            value={fkRefField}
            onChange={(event) => setFkRefField(event.target.value)}
          />
          <button
            type="button"
            className="w-full rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            onClick={() => setFieldFKRef(table.id, field.id, fkRefTable, fkRefField)}
          >
            更新 FK 參照
          </button>
        </div>
      )}

      <div className="space-y-2 rounded border border-slate-200 p-2">
        <p className="font-medium text-slate-700">⚠ 標記設定</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={field.is_multi_value}
            onChange={(event) =>
              setFieldMark(table.id, field.id, 'multi_value', event.target.checked)
            }
          />
          🔁 多重值
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={field.is_composite}
            onChange={(event) =>
              setFieldMark(table.id, field.id, 'composite', event.target.checked, {
                composite_children: splitCommaValues(compositeChildren)
              })
            }
          />
          📦 複合屬性
        </label>
        {field.is_composite && (
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="子欄位，以逗號分隔"
            value={compositeChildren}
            onChange={(event) => setCompositeChildren(event.target.value)}
            onBlur={() =>
              setFieldMark(table.id, field.id, 'composite', true, {
                composite_children: splitCommaValues(compositeChildren)
              })
            }
          />
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={field.partial_dep_on.length > 0}
            onChange={(event) =>
              setFieldMark(table.id, field.id, 'partial_dep', event.target.checked, {
                partial_dep_on: splitCommaValues(partialDeps)
              })
            }
          />
          ↗ 部份相依
        </label>
        {field.partial_dep_on.length > 0 && (
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="依賴主鍵欄位，以逗號分隔"
            value={partialDeps}
            onChange={(event) => setPartialDeps(event.target.value)}
            onBlur={() =>
              setFieldMark(table.id, field.id, 'partial_dep', true, {
                partial_dep_on: splitCommaValues(partialDeps)
              })
            }
          />
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(field.transitive_dep_via)}
            onChange={(event) =>
              setFieldMark(table.id, field.id, 'transitive_dep', event.target.checked, {
                transitive_dep_via: transitiveVia
              })
            }
          />
          ↔ 遞移相依
        </label>
        {field.transitive_dep_via && (
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="中間欄位"
            value={transitiveVia}
            onChange={(event) => setTransitiveVia(event.target.value)}
            onBlur={() =>
              setFieldMark(table.id, field.id, 'transitive_dep', true, {
                transitive_dep_via: transitiveVia
              })
            }
          />
        )}
      </div>

      {mode === 'physical' && (
        <div className="space-y-1 rounded border border-slate-200 p-2">
          <p className="font-medium text-slate-700">實體欄位設定</p>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="資料型別（例如 VARCHAR(255)）"
            value={field.data_type ?? ''}
            onChange={(event) =>
              updateFieldMeta(table.id, field.id, { data_type: event.target.value || null })
            }
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={field.is_not_null}
              onChange={(event) =>
                updateFieldMeta(table.id, field.id, { is_not_null: event.target.checked })
              }
            />
            NOT NULL
          </label>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1"
            placeholder="DEFAULT 值"
            value={field.default_value ?? ''}
            onChange={(event) =>
              updateFieldMeta(table.id, field.id, { default_value: event.target.value || null })
            }
          />
        </div>
      )}

      {onDeleteTable && mode === 'logical' && (
        <button
          type="button"
          className="w-full rounded border border-rose-300 px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50"
          onClick={() => onDeleteTable(table.id)}
        >
          刪除整張表
        </button>
      )}
    </div>
  )
}
