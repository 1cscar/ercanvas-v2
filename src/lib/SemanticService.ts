import type {
  SemanticAnalysisResult,
  SemanticInput,
  HiddenFD,
  Disambiguation,
  AtomicViolation,
  NormalizedRelation,
  NormalizationAnalysisInput,
  StagedNormalizationAnalysis,
  NF1AtomicityIssue,
  NF1KeyAudit,
  NF2PartialDependency,
  NF3TransitiveDependency,
  NormalizedSchemaTable,
  NormalizedSchemaForeignKey
} from './normalizationTypes'

const OLLAMA_URL = 'http://localhost:11434/api/chat'
// Run `ollama list` to confirm your exact model tag (e.g. gemma4, gemma4:27b)
const MODEL = 'gemma2:2b'
export const SEMANTIC_MODEL = MODEL
const TIMEOUT_MS = 180_000

// ─── Prompt Builder ─────────────────────────────────────────────────────────────

function buildPrompt(input: SemanticInput): string {
  const schemaLines = input.tables
    .map(
      (t) =>
        `  Table "${t.tableName}": PK=[${t.primaryKeys.join(', ') || 'none'}], Columns=[${t.columns.join(', ')}]`
    )
    .join('\n')

  return `You are a senior database normalization expert with deep cross-domain knowledge (medical, financial, e-commerce, manufacturing, logistics, sports, HR, education, etc.).

Analyze this database schema:

${schemaLines}

Your job is to find three categories of issues. Be domain-agnostic — rely on naming patterns and universal domain knowledge.

═══ TASK 1: Hidden Functional Dependencies (hiddenFDs) ═══
Find functional dependencies between non-primary-key columns that a domain expert would recognize.
Classic patterns by domain:
  - Geography:    ZipCode → City, ZipCode → State, CountryCode → CountryName
  - Medical:      DiagnosisCode → DiagnosisName, DrugCode → DrugName, DoctorID → Specialty
  - E-commerce:   ProductID → Brand, ProductID → Manufacturer, CategoryID → CategoryName
  - Logistics:    TrackingNumber → Carrier, RouteID → Origin, RouteID → Destination
  - Sports:       TeamID → TeamCity, TeamID → Coach, VenueID → Capacity
  - HR:           DepartmentID → Manager, JobGradeID → SalaryRange
  - Finance:      ISIN → InstrumentName, CurrencyCode → CurrencyName
Only include FDs you are highly confident about (confidence ≥ 0.7).

═══ TASK 2: Semantic Disambiguation (disambiguations) ═══
Look for same-named columns in different tables that likely have different meanings.
Example: "StartTime" in a "Flights" table vs "StartTime" in a "Meetings" table → suggest "Flight_StartTime" and "Meeting_StartTime".
Only flag pairs where the semantic difference is clear.

═══ TASK 3: Atomicity Violations (atomicViolations) ═══
Flag columns that likely store composite or multi-valued data, violating 1NF.
Common patterns: "Address", "FullName", "ContactList", "Tags", "PhoneNumbers", "Coordinates", "DateRange", "NameAndAge".

Return ONLY the following JSON — no markdown, no explanation, no extra text:
{
  "hiddenFDs": [
    { "lhs": ["col1"], "rhs": "col2", "confidence": 0.85, "reason": "one short English sentence" }
  ],
  "disambiguations": [
    { "tableName": "TableName", "columnName": "ColName", "suggestedName": "TableName_ColName", "reason": "one short English sentence" }
  ],
  "atomicViolations": [
    { "tableName": "TableName", "columnName": "ColName", "reason": "one short English sentence", "suggestion": "split into: field1, field2" }
  ]
}`
}

function buildStagedNormalizationPrompt(input: NormalizationAnalysisInput): string {
  return `# Role: 全領域資料庫架構大師 (Expert Database Architect)

# Task: 執行 100% AI 驅動的資料庫正規化分析 (1NF -> 3NF)

## 輸入模型
以下是邏輯圖 JSON（包含表名、欄位、主鍵、使用者連線、備註）：
${JSON.stringify(input, null, 2)}

## 介入分析指令
第一階段：1NF 原子性與主鍵校閱
- 檢查欄位是否隱藏複合資料或多值資料。
- 標記必須炸開欄位或獨立成表的項目。
- 針對每個實體給出 candidate keys 與 chosen primary key。

第二階段：2NF 消除部分相依
- 對複合主鍵檢查 partial functional dependency。
- 僅保留「確定成立」的部分相依。
- 為每項部分相依提出 decomposition table 與 key。

第三階段：3NF 消除遞移相依
- 尋找 non-key 欄位間的 A -> B -> C 決定關係。
- 僅保留「確定成立」的遞移相依。
- 為每項遞移相依提出 decomposition table 與 key。

## Constraints
- Domain agnostic：僅依語義與常識推導。
- 最終結構必須可無損連接 (Lossless Join)。
- 僅輸出 JSON，不要任何解釋性文字、Markdown、前後綴。

只回傳以下 JSON 結構：
{
  "phase1": {
    "atomicityIssues": [
      {
        "tableName": "string",
        "columnName": "string",
        "issue": "string",
        "splitInto": ["string"]
      }
    ],
    "keyAudit": [
      {
        "tableName": "string",
        "candidateKeys": [["string"]],
        "chosenPrimaryKey": ["string"]
      }
    ]
  },
  "phase2": {
    "partialDependencies": [
      {
        "tableName": "string",
        "determinant": ["string"],
        "dependent": "string",
        "decompositionTable": "string",
        "decompositionKey": ["string"]
      }
    ]
  },
  "phase3": {
    "transitiveDependencies": [
      {
        "tableName": "string",
        "chain": ["string", "string", "string"],
        "decompositionTable": "string",
        "decompositionKey": ["string"]
      }
    ]
  },
  "normalizedSchema": {
    "tables": [
      {
        "tableName": "string",
        "columns": ["string"],
        "primaryKey": ["string"],
        "foreignKeys": [
          {
            "column": "string",
            "referencesTable": "string",
            "referencesColumn": "string"
          }
        ]
      }
    ],
    "losslessJoin": true
  }
}`
}

// ─── Response Parser ────────────────────────────────────────────────────────────

function createEmptyStagedAnalysis(): StagedNormalizationAnalysis {
  return {
    phase1: {
      atomicityIssues: [],
      keyAudit: []
    },
    phase2: {
      partialDependencies: []
    },
    phase3: {
      transitiveDependencies: []
    },
    normalizedSchema: {
      tables: [],
      losslessJoin: true
    }
  }
}

function stripCodeFence(text: string): string {
  const fenceMatch = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenceMatch ? fenceMatch[1].trim() : text.trim()
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripCodeFence(content))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseResponse(content: string): SemanticAnalysisResult {
  const obj = parseJsonObject(content)
  if (!obj) {
    console.warn('[SemanticService] Could not parse JSON response:', content.slice(0, 200))
    return { hiddenFDs: [], disambiguations: [], atomicViolations: [] }
  }

  return {
    hiddenFDs: Array.isArray(obj.hiddenFDs) ? obj.hiddenFDs.filter(isHiddenFD) : [],
    disambiguations: Array.isArray(obj.disambiguations)
      ? obj.disambiguations.filter(isDisambiguation)
      : [],
    atomicViolations: Array.isArray(obj.atomicViolations)
      ? obj.atomicViolations.filter(isAtomicViolation)
      : []
  }
}

function isHiddenFD(x: unknown): x is HiddenFD {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    Array.isArray(o.lhs) &&
    o.lhs.every((a) => typeof a === 'string') &&
    typeof o.rhs === 'string' &&
    typeof o.confidence === 'number' &&
    typeof o.reason === 'string'
  )
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isStringMatrix = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.every((item) => isStringArray(item))

function isNF1AtomicityIssue(x: unknown): x is NF1AtomicityIssue {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    typeof o.columnName === 'string' &&
    typeof o.issue === 'string' &&
    isStringArray(o.splitInto)
  )
}

function isNF1KeyAudit(x: unknown): x is NF1KeyAudit {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    isStringMatrix(o.candidateKeys) &&
    isStringArray(o.chosenPrimaryKey)
  )
}

function isNF2PartialDependency(x: unknown): x is NF2PartialDependency {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    isStringArray(o.determinant) &&
    typeof o.dependent === 'string' &&
    typeof o.decompositionTable === 'string' &&
    isStringArray(o.decompositionKey)
  )
}

function isNF3TransitiveDependency(x: unknown): x is NF3TransitiveDependency {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    isStringArray(o.chain) &&
    typeof o.decompositionTable === 'string' &&
    isStringArray(o.decompositionKey)
  )
}

function isNormalizedSchemaForeignKey(x: unknown): x is NormalizedSchemaForeignKey {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.column === 'string' &&
    typeof o.referencesTable === 'string' &&
    typeof o.referencesColumn === 'string'
  )
}

function isNormalizedSchemaTable(x: unknown): x is NormalizedSchemaTable {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    isStringArray(o.columns) &&
    isStringArray(o.primaryKey) &&
    Array.isArray(o.foreignKeys) &&
    o.foreignKeys.every(isNormalizedSchemaForeignKey)
  )
}

function parseStagedResponse(content: string): StagedNormalizationAnalysis {
  const obj = parseJsonObject(content)
  if (!obj) return createEmptyStagedAnalysis()

  const phase1Obj = typeof obj.phase1 === 'object' && obj.phase1 !== null ? (obj.phase1 as Record<string, unknown>) : {}
  const phase2Obj = typeof obj.phase2 === 'object' && obj.phase2 !== null ? (obj.phase2 as Record<string, unknown>) : {}
  const phase3Obj = typeof obj.phase3 === 'object' && obj.phase3 !== null ? (obj.phase3 as Record<string, unknown>) : {}
  const schemaObj =
    typeof obj.normalizedSchema === 'object' && obj.normalizedSchema !== null
      ? (obj.normalizedSchema as Record<string, unknown>)
      : {}

  const losslessJoin = typeof schemaObj.losslessJoin === 'boolean' ? schemaObj.losslessJoin : true

  return {
    phase1: {
      atomicityIssues: Array.isArray(phase1Obj.atomicityIssues)
        ? phase1Obj.atomicityIssues.filter(isNF1AtomicityIssue)
        : [],
      keyAudit: Array.isArray(phase1Obj.keyAudit) ? phase1Obj.keyAudit.filter(isNF1KeyAudit) : []
    },
    phase2: {
      partialDependencies: Array.isArray(phase2Obj.partialDependencies)
        ? phase2Obj.partialDependencies.filter(isNF2PartialDependency)
        : []
    },
    phase3: {
      transitiveDependencies: Array.isArray(phase3Obj.transitiveDependencies)
        ? phase3Obj.transitiveDependencies.filter(isNF3TransitiveDependency)
        : []
    },
    normalizedSchema: {
      tables: Array.isArray(schemaObj.tables) ? schemaObj.tables.filter(isNormalizedSchemaTable) : [],
      losslessJoin
    }
  }
}

function isDisambiguation(x: unknown): x is Disambiguation {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    typeof o.columnName === 'string' &&
    typeof o.suggestedName === 'string' &&
    typeof o.reason === 'string'
  )
}

function isAtomicViolation(x: unknown): x is AtomicViolation {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tableName === 'string' &&
    typeof o.columnName === 'string' &&
    typeof o.reason === 'string' &&
    typeof o.suggestion === 'string'
  )
}

// ─── Naming Prompt ─────────────────────────────────────────────────────────────

function buildNamingPrompt(relations: NormalizedRelation[]): string {
  const relLines = relations
    .map((r) => `  "${r.name}": PK=[${r.primaryKey.join(', ')}], columns=[${r.attributes.join(', ')}]`)
    .join('\n')

  return `你是資深資料庫架構師。以下關係由 3NF 合成演算法產生，目前是暫時名稱。

關係如下：
${relLines}

請為每個關係提供「中文資料表名稱」（繁體中文），根據主鍵與欄位語意命名。

規則：
- 只輸出繁體中文表名，不要英文、不要拼音
- 表名簡潔（2~8字）
- 表名需能反映業務語意，例如：顧客、訂單、產品、銷售明細、庫存
- 不可重複名稱
- 不要加上「表」或「資料表」等贅詞，除非語意必要

只回傳以下 JSON，不要額外文字：
{
  "renames": [
    { "original": "Relation_1", "suggested": "中文表名" }
  ]
}`
}

function parseNamingResponse(content: string, relations: NormalizedRelation[]): Map<string, string> {
  const result = new Map<string, string>()
  let text = content.trim()

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) text = fenceMatch[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return result
  }

  const renames = (parsed as Record<string, unknown>)?.renames
  if (!Array.isArray(renames)) return result

  const usedNames = new Set<string>()
  for (const item of renames) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).original === 'string' &&
      typeof (item as Record<string, unknown>).suggested === 'string'
    ) {
      const original = (item as Record<string, string>).original
      let suggested = (item as Record<string, string>).suggested.trim()

      // Deduplicate: append index if name already used
      if (usedNames.has(suggested)) {
        suggested = `${suggested}_${[...usedNames].filter((n) => n.startsWith(suggested)).length + 1}`
      }

      if (relations.some((r) => r.name === original)) {
        result.set(original, suggested)
        usedNames.add(suggested)
      }
    }
  }

  return result
}

// ─── SemanticService ───────────────────────────────────────────────────────────

export class SemanticServiceError extends Error {
  constructor(
    message: string,
    /** Whether the user should check Ollama setup. */
    public readonly isConnectionError = false
  ) {
    super(message)
    this.name = 'SemanticServiceError'
  }
}

/**
 * Calls the local Ollama model to perform semantic pre-processing
 * before the mathematical normalization engine runs.
 *
 * Setup requirements:
 *   1. `ollama serve` must be running (with OLLAMA_ORIGINS=* for browser CORS).
 *   2. `ollama pull gemma4` must have been executed.
 */
export class SemanticService {
  private async callOllama(prompt: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          stream: false,
          format: 'json',
          messages: [{ role: 'user', content: prompt }]
        })
      })

      if (!response.ok) {
        throw new SemanticServiceError(
          `Ollama returned HTTP ${response.status}. ` +
            `Ensure Ollama is running and the model "${MODEL}" is pulled (ollama pull ${MODEL}).`,
          true
        )
      }

      const raw = await response.json()
      return raw?.message?.content ?? raw?.response ?? JSON.stringify(raw)
    } catch (err) {
      if (err instanceof SemanticServiceError) throw err

      if ((err as Error).name === 'AbortError') {
        throw new SemanticServiceError(
          `Ollama request timed out after ${TIMEOUT_MS / 1000}s. ` +
            'Is the model fully loaded? Try running a prompt in the terminal first.',
          true
        )
      }

      const msg = (err as Error).message ?? ''
      if (
        msg.includes('fetch') ||
        msg.includes('CORS') ||
        msg.includes('network') ||
        msg.includes('Failed to fetch')
      ) {
        throw new SemanticServiceError(
          'Cannot reach Ollama at localhost:11434.\n' +
            '  1. Run: OLLAMA_ORIGINS=* ollama serve\n' +
            `  2. Run: ollama pull ${MODEL}\n` +
            '  3. Reload this page.',
          true
        )
      }

      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async analyze(input: SemanticInput): Promise<SemanticAnalysisResult> {
    const content = await this.callOllama(buildPrompt(input))
    return parseResponse(content)
  }

  async analyzeNormalizationStages(
    input: NormalizationAnalysisInput
  ): Promise<StagedNormalizationAnalysis> {
    const content = await this.callOllama(buildStagedNormalizationPrompt(input))
    return parseStagedResponse(content)
  }

  /**
   * Phase 3: Given 3NF-synthesised relations (with placeholder names like "Relation_1"),
   * ask the AI to suggest meaningful business-domain table names.
   *
   * Returns a Map of { placeholderName → suggestedName }.
   * Falls back to the original placeholder names on any error.
   */
  async suggestTableNames(relations: NormalizedRelation[]): Promise<Map<string, string>> {
    if (relations.length === 0) return new Map()
    try {
      const content = await this.callOllama(buildNamingPrompt(relations))
      return parseNamingResponse(content, relations)
    } catch {
      // Naming is best-effort; don't block the pipeline on AI failure
      return new Map()
    }
  }
}
