import { useEffect, useMemo, useState } from 'react'
import {
  analyze1NF,
  analyze2NF,
  analyze3NF,
  fix1NF_composite,
  fix1NF_multiValue,
  fix2NF_partialDep,
  fix3NF_transitiveDep
} from '../../lib/normalization'
import { LogicalTable, NormalizationIssue } from '../../types'

interface NormalizationWizardProps {
  open: boolean
  tables: LogicalTable[]
  onClose: () => void
  onConfirmApply: (tables: LogicalTable[]) => void
}

type WizardStep = 1 | 2 | 3 | 4

const issueKey = (issue: NormalizationIssue) => `${issue.type}:${issue.tableId}:${issue.fieldId}`

const markClassMap = {
  MULTI_VALUE: 'border-red-300 bg-red-50',
  COMPOSITE: 'border-red-300 bg-red-50',
  PARTIAL_DEP: 'border-orange-300 bg-orange-50',
  TRANSITIVE_DEP: 'border-yellow-300 bg-yellow-50'
} as const

function buildSummary(originalTables: LogicalTable[], nextTables: LogicalTable[]) {
  const originalByName = new Map(originalTables.map((table) => [table.name, table]))

  const createdTables = nextTables.filter((table) => !originalByName.has(table.name))
  const changes = nextTables
    .map((table) => {
      const before = originalByName.get(table.name)
      if (!before) return null

      const beforeNames = new Set(before.fields.map((field) => field.name))
      const afterNames = new Set(table.fields.map((field) => field.name))

      const added = [...afterNames].filter((name) => !beforeNames.has(name))
      const removed = [...beforeNames].filter((name) => !afterNames.has(name))

      if (added.length === 0 && removed.length === 0) return null
      return { tableName: table.name, added, removed }
    })
    .filter(Boolean)

  return { createdTables, changes: changes as { tableName: string; added: string[]; removed: string[] }[] }
}

export function NormalizationWizard({ open, tables, onClose, onConfirmApply }: NormalizationWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [workingTables, setWorkingTables] = useState<LogicalTable[]>(tables)
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setStep(1)
    setWorkingTables(tables)
    setIgnoredIssues(new Set())
  }, [open, tables])

  const issuesByStep = useMemo(() => {
    return {
      1: analyze1NF(workingTables),
      2: analyze2NF(workingTables),
      3: analyze3NF(workingTables)
    }
  }, [workingTables])

  const activeIssues = step === 4 ? [] : issuesByStep[step].filter((issue) => !ignoredIssues.has(issueKey(issue)))
  const allHandled = activeIssues.length === 0

  const applyFix = (issue: NormalizationIssue) => {
    if (issue.type === 'MULTI_VALUE') {
      setWorkingTables((prev) => fix1NF_multiValue(prev, issue))
      return
    }
    if (issue.type === 'COMPOSITE') {
      setWorkingTables((prev) => fix1NF_composite(prev, issue))
      return
    }
    if (issue.type === 'PARTIAL_DEP') {
      setWorkingTables((prev) => fix2NF_partialDep(prev, issue))
      return
    }
    if (issue.type === 'TRANSITIVE_DEP') {
      setWorkingTables((prev) => fix3NF_transitiveDep(prev, issue))
    }
  }

  const summary = useMemo(() => buildSummary(tables, workingTables), [tables, workingTables])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-lg font-semibold text-slate-800">正規化精靈（步驟 {step} / 4）</h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            關閉
          </button>
        </div>

        <div className="max-h-[65vh] space-y-3 overflow-auto p-5 text-sm">
          {step !== 4 ? (
            <>
              <p className="text-slate-600">
                {step === 1 && '1NF 分析：多重值/複合屬性違規'}
                {step === 2 && '2NF 分析：部份相依違規'}
                {step === 3 && '3NF 分析：遞移相依違規'}
              </p>

              {activeIssues.length === 0 ? (
                <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                  目前步驟沒有未處理問題，可前往下一步。
                </p>
              ) : (
                activeIssues.map((issue) => (
                  <div
                    key={issueKey(issue)}
                    className={`rounded border p-3 ${markClassMap[issue.type]}`}
                  >
                    <p className="font-medium text-slate-800">
                      {issue.tableName}.{issue.fieldName}（{issue.type}）
                    </p>
                    <p className="mt-1 text-slate-700">{issue.description}</p>
                    <p className="mt-1 text-slate-600">建議：{issue.suggestion}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-white"
                        onClick={() => applyFix(issue)}
                      >
                        套用修正
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-white"
                        onClick={() =>
                          setIgnoredIssues((prev) => {
                            const next = new Set(prev)
                            next.add(issueKey(issue))
                            return next
                          })
                        }
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-slate-800">變更摘要</h3>
              <div className="space-y-2">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-700">新增資料表</p>
                  {summary.createdTables.length === 0 ? (
                    <p className="text-slate-500">無</p>
                  ) : (
                    summary.createdTables.map((table) => <p key={table.id}>+ {table.name}</p>)
                  )}
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-700">欄位異動</p>
                  {summary.changes.length === 0 ? (
                    <p className="text-slate-500">無</p>
                  ) : (
                    summary.changes.map((item) => (
                      <div key={item.tableName} className="mb-2">
                        <p className="font-medium">{item.tableName}</p>
                        <p className="text-slate-600">新增：{item.added.join(', ') || '無'}</p>
                        <p className="text-slate-600">移除：{item.removed.join(', ') || '無'}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
              onClick={() => setStep((prev) => Math.max(1, prev - 1) as WizardStep)}
              disabled={step === 1}
            >
              上一步
            </button>
            {step < 4 && (
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
                onClick={() => setStep((prev) => (prev + 1) as WizardStep)}
                disabled={!allHandled}
              >
                下一步
              </button>
            )}
          </div>

          {step === 4 ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
                onClick={onClose}
              >
                ✗ 取消
              </button>
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1 text-sm text-white hover:bg-slate-700"
                onClick={() => onConfirmApply(workingTables)}
              >
                ✓ 建立正規化實體圖
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-500">修正或忽略全部問題後才可前進</span>
          )}
        </div>
      </div>
    </div>
  )
}
