import { useState } from 'react'
import { SemanticService, SemanticServiceError, SEMANTIC_MODEL } from '../../lib/SemanticService'
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
import {
  analyze1NF,
  analyze2NF,
  analyze3NF,
  fix1NF_composite,
  fix1NF_multiValue,
  fix2NF_partialDep,
  fix3NF_transitiveDep
} from '../../lib/normalization'
import type {
  NormalizedAction,
  NormalizedRelation,
  SemanticAnalysisResult
} from '../../lib/normalizationTypes'
import type { LogicalTable, NormalizationIssue } from '../../types'

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
  strategy: 'racing_gemini' | 'generic_3nf'
  phaseStats: {
    nf1Fixed: number
    nf2Fixed: number
    nf3Fixed: number
  }
}

const isOllamaTimeout = (err: unknown) =>
  err instanceof SemanticServiceError && /timed out/i.test(err.message)
const MAX_APPLY_TABLES = 120
const MAX_APPLY_FIELDS = 2400
const MAX_AUTO_FIX_ITERATIONS = 200
const cjkRegex = /[\u3400-\u9fff]/
const bannedAbstractNames = new Set([
  'Parties',
  'Party_Roles',
  'Entity_Relationships',
  'Schema_Definitions',
  'Universal_Events',
  'State_Observations'
])

const localizeRelationNames = (relations: NormalizedRelation[]) => {
  const used = new Set<string>()
  let fallbackIndex = 1

  return relations.map((relation) => {
    let name = relation.name.trim()
    if (!cjkRegex.test(name) || bannedAbstractNames.has(name)) {
      name = `資料${fallbackIndex}`
      fallbackIndex += 1
    }
    while (used.has(name)) {
      name = `${name}${fallbackIndex}`
      fallbackIndex += 1
    }
    used.add(name)
    return { ...relation, name }
  })
}

const applyIssueFix = (tables: LogicalTable[], issue: NormalizationIssue): LogicalTable[] => {
  switch (issue.type) {
    case 'MULTI_VALUE':
      return fix1NF_multiValue(tables, issue)
    case 'COMPOSITE':
      return fix1NF_composite(tables, issue)
    case 'PARTIAL_DEP':
      return fix2NF_partialDep(tables, issue)
    case 'TRANSITIVE_DEP':
      return fix3NF_transitiveDep(tables, issue)
    default:
      return tables
  }
}

function runAutoPhase(
  phaseName: '1NF' | '2NF' | '3NF',
  tables: LogicalTable[],
  analyze: (tables: LogicalTable[]) => NormalizationIssue[],
  onStep: (step: string) => void
): { nextTables: LogicalTable[]; fixedCount: number } {
  let nextTables = tables
  let fixedCount = 0

  for (let i = 0; i < MAX_AUTO_FIX_ITERATIONS; i += 1) {
    const issues = analyze(nextTables)
    if (issues.length === 0) break

    const candidate = applyIssueFix(nextTables, issues[0])
    if (candidate === nextTables) break
    nextTables = candidate
    fixedCount += 1

    if (fixedCount % 10 === 0) {
      onStep(`${phaseName} 自動修正中…（已修正 ${fixedCount} 項）`)
    }
  }

  return { nextTables, fixedCount }
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function detectRacingDomain(tables: LogicalTable[]): boolean {
  const corpus = tables
    .flatMap((table) => [table.name, ...table.fields.map((field) => field.name)])
    .join(' ')
    .toLowerCase()

  const keywordGroups = [
    ['比賽', '賽事', '大獎賽', '賽季'],
    ['車手', '車隊', '賽道'],
    ['正賽', '排位', '練習', '衝刺', '圈速', '名次']
  ]

  const matchedGroups = keywordGroups.filter((group) => includesAny(corpus, group)).length
  return matchedGroups >= 2
}

function findQualifiedAttr(
  tables: LogicalTable[],
  fieldNames: string[],
  tableHints: string[] = []
): string {
  const hintMatchedTable = tables.find((table) =>
    tableHints.length > 0 && tableHints.some((hint) => table.name.includes(hint))
      ? tableHints.some((hint) => table.name.includes(hint))
      : false
  )

  if (hintMatchedTable) {
    for (const fieldName of fieldNames) {
      const found = hintMatchedTable.fields.find((field) => field.name === fieldName)
      if (found) return `${hintMatchedTable.name}.${found.name}`
    }
  }

  for (const table of tables) {
    for (const fieldName of fieldNames) {
      const found = table.fields.find((field) => field.name === fieldName)
      if (found) return `${table.name}.${found.name}`
    }
  }

  return fieldNames[0]
}

function buildRelation(
  name: string,
  primaryKey: string[],
  attributes: string[]
): NormalizedRelation {
  const uniqueAttrs = [...new Set(attributes)]
  const uniquePk = [...new Set(primaryKey)]
  return {
    name,
    attributes: uniqueAttrs,
    primaryKey: uniquePk,
    fds: uniqueAttrs
      .filter((attr) => !uniquePk.includes(attr))
      .map((attr) => ({ lhs: uniquePk, rhs: attr }))
  }
}

function buildGeminiRacingRelations(tables: LogicalTable[]): NormalizedRelation[] {
  const driverId = findQualifiedAttr(tables, ['車手編號'], ['車手'])
  const teamId = findQualifiedAttr(tables, ['車隊編號'], ['車隊'])
  const trackId = findQualifiedAttr(tables, ['賽道編號'], ['賽道'])
  const eventId = findQualifiedAttr(tables, ['賽事編號'], ['賽事'])

  const sessionTypeId = '場次類型編號'
  const sessionId = '場次編號'
  const resultId = '成績編號'

  const relations: NormalizedRelation[] = [
    buildRelation('車手', [driverId], [
      driverId,
      findQualifiedAttr(tables, ['車手姓名', '姓名'], ['車手']),
      findQualifiedAttr(tables, ['起步位階', '起步位置'], ['車手'])
    ]),
    buildRelation('車隊', [teamId], [
      teamId,
      findQualifiedAttr(tables, ['車隊名稱', '名稱'], ['車隊'])
    ]),
    buildRelation('賽道', [trackId], [
      trackId,
      findQualifiedAttr(tables, ['賽道名稱', '名稱'], ['賽道']),
      findQualifiedAttr(tables, ['長度'], ['賽道'])
    ]),
    buildRelation('賽事', [eventId], [eventId, trackId, '賽季年度', '賽事日期']),
    buildRelation('場次類型', [sessionTypeId], [sessionTypeId, '類型名稱']),
    buildRelation('場次', [sessionId], [sessionId, eventId, sessionTypeId]),
    buildRelation('場次成績', [resultId], [
      resultId,
      sessionId,
      driverId,
      teamId,
      findQualifiedAttr(tables, ['排名', '名次']),
      findQualifiedAttr(tables, ['最快圈', '最快圈速']),
      findQualifiedAttr(tables, ['車手獲得積分', '獲得積分', '積分']),
      findQualifiedAttr(tables, ['車隊獲得積分', '車隊積分']),
      findQualifiedAttr(tables, ['完賽狀態', '狀態'])
    ])
  ]

  return relations
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(
  tables: LogicalTable[],
  diagramId: string,
  onStep: (step: string) => void
): Promise<PipelineResult> {
  const service = new SemanticService()
  let workingTables = tables

  // Phase 1: AI semantic analysis (hidden FD / atomic hints)
  onStep('AI 分析中：偵測隱藏相依性與原子性違規…')
  let aiResult: SemanticAnalysisResult = { hiddenFDs: [], disambiguations: [], atomicViolations: [] }
  try {
    aiResult = await service.analyze(buildSemanticInput(workingTables))
  } catch (err) {
    if (isOllamaTimeout(err)) {
      console.warn('[AutoNormalize] AI analysis timed out, fallback to math-only pipeline:', err)
    } else if (err instanceof SemanticServiceError && err.isConnectionError) {
      throw err
    } else {
      console.warn('[AutoNormalize] AI analysis failed, continuing without it:', err)
    }
  }

  // Phase 2: True order auto-fix (1NF -> 2NF -> 3NF)
  onStep('1NF 自動修正中…')
  const nf1 = runAutoPhase('1NF', workingTables, analyze1NF, onStep)
  workingTables = nf1.nextTables

  onStep('2NF 自動修正中…')
  const nf2 = runAutoPhase('2NF', workingTables, analyze2NF, onStep)
  workingTables = nf2.nextTables

  onStep('3NF 自動修正中…')
  const nf3 = runAutoPhase('3NF', workingTables, analyze3NF, onStep)
  workingTables = nf3.nextTables

  if (detectRacingDomain(workingTables)) {
    onStep('套用 Gemini 賽事正規化邏輯（賽事/場次/成績）…')
    const relations = buildGeminiRacingRelations(workingTables)

    onStep('產生操作清單…')
    const actions = generateActions(tables, relations)
    const newTables = relationsToLogicalTables(relations, diagramId, workingTables)
    const totalFields = newTables.reduce((sum, table) => sum + table.fields.length, 0)
    if (newTables.length > MAX_APPLY_TABLES || totalFields > MAX_APPLY_FIELDS) {
      throw new Error(
        `正規化結果過大（${newTables.length} 張表 / ${totalFields} 欄位），已停止套用以避免頁面崩潰。請先拆小範圍再執行。`
      )
    }

    return {
      aiResult,
      relations,
      actions,
      newTables,
      strategy: 'racing_gemini',
      phaseStats: {
        nf1Fixed: nf1.fixedCount,
        nf2Fixed: nf2.fixedCount,
        nf3Fixed: nf3.fixedCount
      }
    }
  }

  // Phase 3: Math engine (validation + synthesis)
  onStep('計算最小涵蓋 (Minimal Cover)…')
  const { allAttrs, fds } = extractFDsFromTables(workingTables)
  const hiddenFDs = liftHiddenFDs(aiResult.hiddenFDs, workingTables)
  const minCover = getMinimalCover([...fds, ...hiddenFDs])

  onStep('合成 3NF 結構 (Bernstein Synthesis)…')
  const rawRelations = synthesize3NF(allAttrs, minCover)

  // Phase 4: AI naming
  onStep('AI 命名：保留原始中文領域分類…')
  let relations = rawRelations
  try {
    const renames = await service.suggestTableNames(rawRelations)
    relations = applyRenames(rawRelations, renames)
  } catch (err) {
    console.warn('[AutoNormalize] AI naming failed, using placeholder names:', err)
  }
  relations = localizeRelationNames(relations)

  // Phase 5: Generate actions & new tables
  onStep('產生操作清單…')
  const actions = generateActions(tables, relations)
  const newTables = relationsToLogicalTables(relations, diagramId, workingTables)
  const totalFields = newTables.reduce((sum, table) => sum + table.fields.length, 0)
  if (newTables.length > MAX_APPLY_TABLES || totalFields > MAX_APPLY_FIELDS) {
    throw new Error(
      `正規化結果過大（${newTables.length} 張表 / ${totalFields} 欄位），已停止套用以避免頁面崩潰。請先拆小範圍再執行。`
    )
  }

  return {
    aiResult,
    relations,
    actions,
    newTables,
    strategy: 'generic_3nf',
    phaseStats: {
      nf1Fixed: nf1.fixedCount,
      nf2Fixed: nf2.fixedCount,
      nf3Fixed: nf3.fixedCount
    }
  }
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

function PhaseSummary({
  phaseStats
}: {
  phaseStats: PipelineResult['phaseStats']
}) {
  return (
    <Section title="真正順序版自動修正摘要">
      <div className="space-y-1 text-xs text-slate-700">
        <p>1NF 自動修正：{phaseStats.nf1Fixed} 項</p>
        <p>2NF 自動修正：{phaseStats.nf2Fixed} 項</p>
        <p>3NF 自動修正：{phaseStats.nf3Fixed} 項</p>
      </div>
    </Section>
  )
}

function RelationPreview({ relations }: { relations: NormalizedRelation[] }) {
  return (
    <Section title={`正規化後結構（${relations.length} 張表）`}>
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
        {actions.length === 0 && <p className="text-slate-500">目前已接近 3NF，無需大幅變更。</p>}
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
            <h2 className="text-base font-semibold text-slate-800">自動正規化（保留原始領域中文分類）</h2>
            <p className="text-xs text-slate-500">{SEMANTIC_MODEL} 真正順序版：1NF → 2NF → 3NF + 中文命名</p>
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
                <li className="list-decimal"><strong>AI 語義分析</strong>：偵測隱藏 FD、消歧、原子性問題</li>
                <li className="list-decimal"><strong>1NF 自動修正</strong>：先處理多值與複合欄位</li>
                <li className="list-decimal"><strong>2NF 自動修正</strong>：再處理部分相依</li>
                <li className="list-decimal"><strong>3NF 自動修正</strong>：最後處理傳遞相依</li>
                <li className="list-decimal"><strong>最小涵蓋與 3NF 合成</strong>：做結構驗算與補強</li>
                <li className="list-decimal"><strong>中文命名</strong>：避免抽象英文通用表，優先保留原始中文分類</li>
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
              <Section title="正規化策略">
                <p className="text-xs text-slate-700">
                  {phase.result.strategy === 'racing_gemini'
                    ? '已套用 Gemini 賽事邏輯：核心實體 + 場次結構 + 場次成績。'
                    : '已套用通用真正順序版：1NF → 2NF → 3NF + 最小涵蓋合成。'}
                </p>
              </Section>
              <PhaseSummary phaseStats={phase.result.phaseStats} />
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
                建立正規化實體圖
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
