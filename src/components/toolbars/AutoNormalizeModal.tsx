import { useState } from 'react'
import { SemanticService, SemanticServiceError } from '../../lib/SemanticService'
import {
  applyRenames,
  buildSemanticInput,
  extractFDsFromTables,
  generateActions,
  getMinimalCover,
  liftHiddenFDs,
  relationsToLogicalTables,
  synthesize3NF
} from '../../lib/NormalizationEngine'
import type { NormalizedAction, NormalizedRelation, SemanticAnalysisResult } from '../../lib/normalizationTypes'
import type { LogicalTable } from '../../types'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; step: string }
  | { kind: 'preview'; result: PipelineResult }
  | { kind: 'error'; message: string; isConnection: boolean }

interface PipelineResult {
  aiResult: SemanticAnalysisResult
  relations: NormalizedRelation[]
  actions: NormalizedAction[]
  newTables: LogicalTable[]
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(
  tables: LogicalTable[],
  diagramId: string,
  onStep: (step: string) => void
): Promise<PipelineResult> {
  const service = new SemanticService()

  // Phase 1: AI semantic analysis
  onStep('AI 分析中：偵測隱藏相依性與原子性違規…')
  let aiResult: SemanticAnalysisResult = { hiddenFDs: [], disambiguations: [], atomicViolations: [] }
  try {
    aiResult = await service.analyze(buildSemanticInput(tables))
  } catch (err) {
    if (err instanceof SemanticServiceError && err.isConnectionError) throw err
    // Non-connection AI errors are soft-ignored; math engine runs without AI input
    console.warn('[AutoNormalize] AI analysis failed, continuing without it:', err)
  }

  // Phase 2: Math engine
  onStep('計算最小涵蓋 (Minimal Cover)…')
  const { allAttrs, fds } = extractFDsFromTables(tables)
  const hiddenFDs = liftHiddenFDs(aiResult.hiddenFDs, tables)
  const minCover = getMinimalCover([...fds, ...hiddenFDs])

  onStep('合成 3NF 結構 (Bernstein Synthesis)…')
  const rawRelations = synthesize3NF(allAttrs, minCover)

  // Phase 3: AI naming
  onStep('AI 命名：為新資料表產生業務名稱…')
  let relations = rawRelations
  try {
    const renames = await service.suggestTableNames(rawRelations)
    relations = applyRenames(rawRelations, renames)
  } catch (err) {
    console.warn('[AutoNormalize] AI naming failed, using placeholder names:', err)
  }

  // Phase 4: Generate actions & new tables
  onStep('產生操作清單…')
  const actions = generateActions(tables, relations)
  const newTables = relationsToLogicalTables(relations, diagramId, tables)

  return { aiResult, relations, actions, newTables }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: 'violet' | 'orange' | 'red' | 'emerald' | 'slate' }) {
  const cls = {
    violet: 'bg-violet-100 text-violet-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-100 text-slate-600'
  }[color]
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">{title}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function AIFindings({ aiResult }: { aiResult: SemanticAnalysisResult }) {
  const total =
    aiResult.hiddenFDs.length + aiResult.disambiguations.length + aiResult.atomicViolations.length
  if (total === 0) {
    return (
      <Section title="AI 語義分析">
        <p className="text-xs text-slate-500">未偵測到額外問題。</p>
      </Section>
    )
  }

  return (
    <Section title={`AI 語義分析（發現 ${total} 項）`}>
      <div className="space-y-2 text-xs">
        {aiResult.hiddenFDs.map((fd, i) => (
          <div key={i} className="flex items-start gap-2">
            <Badge label="Hidden FD" color="violet" />
            <span className="text-slate-700">
              {fd.lhs.join(', ')} → {fd.rhs}
              <span className="ml-1 text-slate-400">({Math.round(fd.confidence * 100)}% · {fd.reason})</span>
            </span>
          </div>
        ))}
        {aiResult.disambiguations.map((d, i) => (
          <div key={i} className="flex items-start gap-2">
            <Badge label="消歧" color="orange" />
            <span className="text-slate-700">
              {d.tableName}.{d.columnName} → <strong>{d.suggestedName}</strong>
              <span className="ml-1 text-slate-400">({d.reason})</span>
            </span>
          </div>
        ))}
        {aiResult.atomicViolations.map((v, i) => (
          <div key={i} className="flex items-start gap-2">
            <Badge label="1NF 違規" color="red" />
            <span className="text-slate-700">
              {v.tableName}.{v.columnName} — {v.suggestion}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function RelationPreview({ relations }: { relations: NormalizedRelation[] }) {
  return (
    <Section title={`3NF 結構（${relations.length} 張表）`}>
      <div className="space-y-2">
        {relations.map((rel) => (
          <div key={rel.name} className="rounded border border-slate-200 bg-white px-3 py-2 text-xs">
            <p className="font-semibold text-slate-800">{rel.name}</p>
            <p className="mt-0.5 text-slate-500">
              PK: <span className="text-slate-700">{rel.primaryKey.map(unqualify).join(', ')}</span>
              {' · '}
              欄位: {rel.attributes.map(unqualify).join(', ')}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}

function ActionList({ actions }: { actions: NormalizedAction[] }) {
  const colorMap: Record<NormalizedAction['type'], string> = {
    CREATE_TABLE: 'emerald',
    DELETE_TABLE: 'red',
    MOVE_COLUMN: 'violet',
    RENAME_COLUMN: 'orange',
    ADD_FOREIGN_KEY: 'slate'
  }

  return (
    <Section title={`操作清單（${actions.length} 步）`}>
      <div className="space-y-1 text-xs">
        {actions.map((action, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-slate-400">{i + 1}.</span>
            <Badge label={action.type} color={colorMap[action.type] as any} />
            <span className="text-slate-700">{describeAction(action)}</span>
          </div>
        ))}
        {actions.length === 0 && <p className="text-slate-500">已是 3NF，無需變更。</p>}
      </div>
    </Section>
  )
}

function describeAction(action: NormalizedAction): string {
  switch (action.type) {
    case 'CREATE_TABLE':
      return `建立 ${action.tableName}（${action.columns.join(', ')}）`
    case 'DELETE_TABLE':
      return `刪除 ${action.tableName}`
    case 'MOVE_COLUMN':
      return `移動 ${action.columnName}：${action.fromTable} → ${action.toTable}`
    case 'RENAME_COLUMN':
      return `重命名 ${action.tableName}.${action.oldName} → ${action.newName}`
    case 'ADD_FOREIGN_KEY':
      return `FK：${action.fromTable}.${action.fromColumn} → ${action.toTable}.${action.toColumn}`
  }
}

function unqualify(attr: string): string {
  const dot = attr.indexOf('.')
  return dot !== -1 ? attr.slice(dot + 1) : attr
}

// ─── Main Modal ────────────────────────────────────────────────────────────────

interface AutoNormalizeModalProps {
  open: boolean
  tables: LogicalTable[]
  diagramId: string
  onClose: () => void
  onConfirmApply: (tables: LogicalTable[]) => void
}

export function AutoNormalizeModal({
  open,
  tables,
  diagramId,
  onClose,
  onConfirmApply
}: AutoNormalizeModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const handleStart = async () => {
    setPhase({ kind: 'running', step: '準備中…' })
    try {
      const result = await runPipeline(tables, diagramId, (step) =>
        setPhase({ kind: 'running', step })
      )
      setPhase({ kind: 'preview', result })
    } catch (err) {
      const isConn = err instanceof SemanticServiceError && err.isConnectionError
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        isConnection: isConn
      })
    }
  }

  const handleClose = () => {
    setPhase({ kind: 'idle' })
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">自動正規化 (AI + 3NF)</h2>
            <p className="text-xs text-slate-500">Gemma 4 語義分析 + Bernstein Synthesis</p>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5 text-sm">
          {phase.kind === 'idle' && (
            <div className="space-y-3">
              <p className="text-slate-700">
                將對目前 <strong>{tables.length}</strong> 張資料表執行以下流程：
              </p>
              <ol className="space-y-1.5 pl-4 text-xs text-slate-600">
                <li className="list-decimal"><strong>AI 語義分析</strong>：Gemma 4 偵測隱藏 FD、消歧、1NF 違規</li>
                <li className="list-decimal"><strong>最小涵蓋</strong>：移除冗餘 FD（右側單項化 → 左側精簡 → FD 消除）</li>
                <li className="list-decimal"><strong>3NF 合成</strong>：Bernstein Synthesis，保證無損連接 + 相依保持</li>
                <li className="list-decimal"><strong>AI 命名</strong>：為新表產生有業務意義的名稱</li>
              </ol>
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                確保 Ollama 已啟動：<code>OLLAMA_ORIGINS=* ollama serve</code>
              </p>
            </div>
          )}

          {phase.kind === 'running' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-violet-600" />
              <p className="text-sm text-slate-600">{phase.step}</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="space-y-3">
              <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p className="font-semibold">發生錯誤</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans">{phase.message}</pre>
              </div>
              {phase.isConnection && (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <p className="font-semibold">Ollama 設置步驟：</p>
                  <ol className="mt-1 space-y-1 pl-4">
                    <li className="list-decimal"><code>OLLAMA_ORIGINS=* ollama serve</code></li>
                    <li className="list-decimal"><code>ollama pull gemma4</code></li>
                    <li className="list-decimal">重新整理頁面後再試</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {phase.kind === 'preview' && (
            <div className="space-y-3">
              <AIFindings aiResult={phase.result.aiResult} />
              <RelationPreview relations={phase.result.relations} />
              <ActionList actions={phase.result.actions} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-5 py-3">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={handleClose}
          >
            取消
          </button>

          <div className="flex gap-2">
            {phase.kind === 'error' && (
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                onClick={() => void handleStart()}
              >
                重試
              </button>
            )}

            {phase.kind === 'idle' && (
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                onClick={() => void handleStart()}
              >
                開始分析
              </button>
            )}

            {phase.kind === 'preview' && (
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                onClick={() => onConfirmApply(phase.result.newTables)}
              >
                確認套用
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
