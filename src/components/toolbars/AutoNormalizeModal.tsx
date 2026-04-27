import { useState } from 'react'
import { SemanticService, SemanticServiceError, SEMANTIC_MODEL } from '../../lib/SemanticService'
import {
  buildNormalizationAnalysisInput,
  generateActions,
  relationsToLogicalTables
} from '../../lib/NormalizationEngine'
import type {
  NormalizedAction,
  NormalizedRelation,
  StagedNormalizationAnalysis
} from '../../lib/normalizationTypes'
import type { LogicalTable } from '../../types'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; step: string }
  | { kind: 'preview'; result: PipelineResult }
  | { kind: 'error'; message: string; isConnection: boolean }

interface PipelineResult {
  stagedAnalysis: StagedNormalizationAnalysis | null
  relations: NormalizedRelation[]
  actions: NormalizedAction[]
  newTables: LogicalTable[]
}

const isOllamaTimeout = (err: unknown) =>
  err instanceof SemanticServiceError && /timed out/i.test(err.message)
const MAX_APPLY_TABLES = 120
const MAX_APPLY_FIELDS = 2400

function buildUniversalCoreRelations(): NormalizedRelation[] {
  return [
    {
      name: 'Parties',
      attributes: ['party_id', 'party_name', 'party_type', 'source_system', 'created_at', 'updated_at'],
      primaryKey: ['party_id'],
      fds: []
    },
    {
      name: 'Party_Roles',
      attributes: ['role_id', 'party_id', 'role_type', 'domain', 'valid_from', 'valid_to'],
      primaryKey: ['role_id'],
      fds: []
    },
    {
      name: 'Entity_Relationships',
      attributes: ['relationship_id', 'subject_id', 'object_id', 'rel_type', 'domain', 'valid_from', 'valid_to'],
      primaryKey: ['relationship_id'],
      fds: []
    },
    {
      name: 'Schema_Definitions',
      attributes: [
        'schema_id',
        'attribute_code',
        'attribute_name',
        'data_type',
        'domain',
        'unit',
        'description',
        'created_at'
      ],
      primaryKey: ['schema_id'],
      fds: []
    },
    {
      name: 'Universal_Events',
      attributes: ['event_id', 'event_type', 'event_time', 'domain', 'source_text', 'created_at'],
      primaryKey: ['event_id'],
      fds: []
    },
    {
      name: 'State_Observations',
      attributes: [
        'observation_id',
        'event_id',
        'party_id',
        'schema_id',
        'val_numeric',
        'val_text',
        'val_json',
        'observed_at',
        'created_at'
      ],
      primaryKey: ['observation_id'],
      fds: []
    }
  ]
}

function applyCoreForeignKeys(tables: LogicalTable[]): LogicalTable[] {
  const refs: Record<string, { table: string; field: string }> = {
    'Party_Roles.party_id': { table: 'Parties', field: 'party_id' },
    'Entity_Relationships.subject_id': { table: 'Parties', field: 'party_id' },
    'Entity_Relationships.object_id': { table: 'Parties', field: 'party_id' },
    'State_Observations.event_id': { table: 'Universal_Events', field: 'event_id' },
    'State_Observations.party_id': { table: 'Parties', field: 'party_id' },
    'State_Observations.schema_id': { table: 'Schema_Definitions', field: 'schema_id' }
  }

  return tables.map((table) => ({
    ...table,
    fields: table.fields.map((field) => {
      const key = `${table.name}.${field.name}`
      const ref = refs[key]
      if (!ref) return field
      return {
        ...field,
        is_fk: true,
        fk_ref_table: ref.table,
        fk_ref_field: ref.field
      }
    })
  }))
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(
  tables: LogicalTable[],
  diagramId: string,
  onStep: (step: string) => void
): Promise<PipelineResult> {
  const service = new SemanticService()

  // Phase 1: AI universal alignment analysis (6 core tables)
  onStep('AI 分析中：執行全領域六核心表對齊…')
  let stagedAnalysis: StagedNormalizationAnalysis | null = null
  try {
    stagedAnalysis = await service.analyzeNormalizationStages(buildNormalizationAnalysisInput(tables))
  } catch (err) {
    if (isOllamaTimeout(err)) {
      console.warn('[AutoNormalize] AI staged analysis timed out, continuing:', err)
    } else if (err instanceof SemanticServiceError && err.isConnectionError) {
      throw err
    } else {
      console.warn('[AutoNormalize] AI staged analysis failed, continuing:', err)
    }
  }

  // Phase 2: Build fixed universal schema
  onStep('建立固定六張核心表結構…')
  const relations = buildUniversalCoreRelations()

  // Phase 3: Generate actions & output tables
  onStep('產生轉換操作清單…')
  const actions = generateActions(tables, relations)
  const newTables = applyCoreForeignKeys(relationsToLogicalTables(relations, diagramId, tables))
  const totalFields = newTables.reduce((sum, table) => sum + table.fields.length, 0)
  if (newTables.length > MAX_APPLY_TABLES || totalFields > MAX_APPLY_FIELDS) {
    throw new Error(
      `正規化結果過大（${newTables.length} 張表 / ${totalFields} 欄位），已停止套用以避免頁面崩潰。請先拆小範圍再執行。`
    )
  }

  return { stagedAnalysis, relations, actions, newTables }
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

function StagedAnalysisSummary({ analysis }: { analysis: StagedNormalizationAnalysis | null }) {
  if (!analysis) {
    return (
      <Section title="AI 全域對齊分析">
        <p className="text-xs text-slate-500">未取得 AI 識別摘要。</p>
      </Section>
    )
  }

  const validationItems: Array<{
    label: string
    passed: boolean
    reason: string
  }> = [
    { label: '唯一性', passed: analysis.validations.uniqueness.passed, reason: analysis.validations.uniqueness.reason },
    { label: '不變性', passed: analysis.validations.invariance.passed, reason: analysis.validations.invariance.reason },
    { label: '完整性', passed: analysis.validations.completeness.passed, reason: analysis.validations.completeness.reason },
    { label: '時序性', passed: analysis.validations.temporality.passed, reason: analysis.validations.temporality.reason },
    {
      label: '關係正規化',
      passed: analysis.validations.relationNormalization.passed,
      reason: analysis.validations.relationNormalization.reason
    }
  ]

  return (
    <Section title="AI 全域對齊分析">
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2 text-slate-700">
          <p>主體：{analysis.identified.parties.length}</p>
          <p>角色：{analysis.identified.roles.length}</p>
          <p>關係：{analysis.identified.relationships.length}</p>
          <p>事件：{analysis.identified.events.length}</p>
          <p>屬性：{analysis.identified.attributes.length}</p>
        </div>

        {validationItems.map((item) => (
          <div key={item.label} className="flex items-start gap-2">
            <Badge label={item.label} color={item.passed ? 'emerald' : 'red'} />
            <span className="text-slate-700">{item.reason || (item.passed ? '通過' : '未通過')}</span>
          </div>
        ))}

        {analysis.suggestions.slice(0, 3).map((suggestion, i) => (
          <div key={`suggest-${i}`} className="flex items-start gap-2">
            <Badge label="建議" color="orange" />
            <span className="text-slate-700">{suggestion}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function RelationPreview({ relations }: { relations: NormalizedRelation[] }) {
  return (
    <Section title={`核心資料表（${relations.length} 張）`}>
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
        {actions.length === 0 && <p className="text-slate-500">目前結構已與核心六表一致。</p>}
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
            <h2 className="text-base font-semibold text-slate-800">全域對齊正規化 (AI + 核心六表)</h2>
            <p className="text-xs text-slate-500">{SEMANTIC_MODEL} 識別摘要 + 通用資料模型映射</p>
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
                <li className="list-decimal"><strong>AI 識別</strong>：解析主體、角色、關係、事件、屬性</li>
                <li className="list-decimal"><strong>通用映射</strong>：資料對齊到 Parties/Party_Roles/Entity_Relationships/Schema_Definitions/Universal_Events/State_Observations</li>
                <li className="list-decimal"><strong>Validation</strong>：唯一性、不變性、完整性、時序性、關係正規化</li>
                <li className="list-decimal"><strong>套用輸出</strong>：建立固定六張核心表，不產生領域專屬表</li>
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
                    <li className="list-decimal"><code>{`ollama pull ${SEMANTIC_MODEL}`}</code></li>
                    <li className="list-decimal">重新整理頁面後再試</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {phase.kind === 'preview' && (
            <div className="space-y-3">
              <StagedAnalysisSummary analysis={phase.result.stagedAnalysis} />
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
                建立正規化實體圖
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
