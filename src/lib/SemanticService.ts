import type {
  SemanticAnalysisResult,
  SemanticInput,
  HiddenFD,
  Disambiguation,
  AtomicViolation,
  NormalizedRelation,
  NormalizationAnalysisInput,
  StagedNormalizationAnalysis,
  ValidationCheck,
  PartiesRow,
  PartyRolesRow,
  EntityRelationshipsRow,
  SchemaDefinitionsRow,
  UniversalEventsRow,
  StateObservationsRow
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
  return `# 角色
你是「文字轉資料庫結構」的通用對齊引擎。

# 任務
請將輸入模型統一映射到固定六張核心表，禁止產生任何領域專屬物理表。
核心表固定為：
- Parties
- Party_Roles
- Entity_Relationships
- Schema_Definitions
- Universal_Events
- State_Observations

# 輸入資料（JSON）
${JSON.stringify(input, null, 2)}

# 強制規則
1. 所有可獨立識別主體都放到 Parties。
2. 角色只能放到 Party_Roles，不可建立 Patients/Doctors/Customers 等表。
3. 屬性概念（blood_pressure, balance, ranking...）只能放到 Schema_Definitions。
4. 有時間或狀態變化的行為都放到 Universal_Events。
5. 數值/文字/剩餘資料只能放到 State_Observations 的 val_numeric/val_text/val_json。
6. 跨主體關係只能放到 Entity_Relationships(subject_id, object_id, rel_type)。
7. 物理結構不可隨領域變動，只能新增資料列。
8. 每筆 observation 應盡量掛到 event_id（可回溯）。

# 輸出要求
- 僅輸出 JSON，禁止 Markdown、禁止額外說明。
- 欄位名請嚴格符合下列 schema。
- 若未知值請給 null 或空字串，不可省略必要欄位。

{
  "identified": {
    "parties": ["string"],
    "roles": ["string"],
    "relationships": ["string"],
    "events": ["string"],
    "attributes": ["string"]
  },
  "mappings": {
    "parties": [
      {
        "party_id": "string",
        "party_name": "string",
        "party_type": "person|organization|asset|account|system|string",
        "source_system": "string"
      }
    ],
    "partyRoles": [
      {
        "role_id": "string",
        "party_id": "string",
        "role_type": "string",
        "domain": "string",
        "valid_from": "ISO-8601 string or null",
        "valid_to": "ISO-8601 string or null"
      }
    ],
    "entityRelationships": [
      {
        "relationship_id": "string",
        "subject_id": "string",
        "object_id": "string",
        "rel_type": "string",
        "domain": "string",
        "valid_from": "ISO-8601 string or null",
        "valid_to": "ISO-8601 string or null"
      }
    ],
    "schemaDefinitions": [
      {
        "schema_id": "string",
        "attribute_code": "string",
        "attribute_name": "string",
        "data_type": "numeric|text|json|date|boolean|string",
        "domain": "string",
        "unit": "string or null",
        "description": "string"
      }
    ],
    "universalEvents": [
      {
        "event_id": "string",
        "event_type": "string",
        "event_time": "ISO-8601 string or null",
        "domain": "string",
        "source_text": "string"
      }
    ],
    "stateObservations": [
      {
        "observation_id": "string",
        "event_id": "string",
        "party_id": "string",
        "schema_id": "string",
        "val_numeric": "number or null",
        "val_text": "string or null",
        "val_json": "object or null",
        "observed_at": "ISO-8601 string or null"
      }
    ]
  },
  "validations": {
    "uniqueness": { "passed": true, "reason": "string" },
    "invariance": { "passed": true, "reason": "string" },
    "completeness": { "passed": true, "reason": "string" },
    "temporality": { "passed": true, "reason": "string" },
    "relationNormalization": { "passed": true, "reason": "string" }
  },
  "suggestions": ["string"]
}`
}

// ─── Response Parser ────────────────────────────────────────────────────────────

function createEmptyStagedAnalysis(): StagedNormalizationAnalysis {
  return {
    identified: {
      parties: [],
      roles: [],
      relationships: [],
      events: [],
      attributes: []
    },
    mappings: {
      parties: [],
      partyRoles: [],
      entityRelationships: [],
      schemaDefinitions: [],
      universalEvents: [],
      stateObservations: []
    },
    validations: {
      uniqueness: { passed: true, reason: '' },
      invariance: { passed: true, reason: '' },
      completeness: { passed: true, reason: '' },
      temporality: { passed: true, reason: '' },
      relationNormalization: { passed: true, reason: '' }
    },
    suggestions: []
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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || typeof value === 'number'

const isJsonObjectOrNull = (value: unknown): value is Record<string, unknown> | null =>
  value === null || (typeof value === 'object' && value !== null && !Array.isArray(value))

function isValidationCheck(x: unknown): x is ValidationCheck {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.passed === 'boolean' && typeof o.reason === 'string'
}

function isPartiesRow(x: unknown): x is PartiesRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.party_id === 'string' &&
    typeof o.party_name === 'string' &&
    typeof o.party_type === 'string' &&
    typeof o.source_system === 'string'
  )
}

function isPartyRolesRow(x: unknown): x is PartyRolesRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.role_id === 'string' &&
    typeof o.party_id === 'string' &&
    typeof o.role_type === 'string' &&
    typeof o.domain === 'string' &&
    isNullableString(o.valid_from) &&
    isNullableString(o.valid_to)
  )
}

function isEntityRelationshipsRow(x: unknown): x is EntityRelationshipsRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.relationship_id === 'string' &&
    typeof o.subject_id === 'string' &&
    typeof o.object_id === 'string' &&
    typeof o.rel_type === 'string' &&
    typeof o.domain === 'string' &&
    isNullableString(o.valid_from) &&
    isNullableString(o.valid_to)
  )
}

function isSchemaDefinitionsRow(x: unknown): x is SchemaDefinitionsRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.schema_id === 'string' &&
    typeof o.attribute_code === 'string' &&
    typeof o.attribute_name === 'string' &&
    typeof o.data_type === 'string' &&
    typeof o.domain === 'string' &&
    isNullableString(o.unit) &&
    typeof o.description === 'string'
  )
}

function isUniversalEventsRow(x: unknown): x is UniversalEventsRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.event_id === 'string' &&
    typeof o.event_type === 'string' &&
    isNullableString(o.event_time) &&
    typeof o.domain === 'string' &&
    typeof o.source_text === 'string'
  )
}

function isStateObservationsRow(x: unknown): x is StateObservationsRow {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return (
    typeof o.observation_id === 'string' &&
    typeof o.event_id === 'string' &&
    typeof o.party_id === 'string' &&
    typeof o.schema_id === 'string' &&
    isNullableNumber(o.val_numeric) &&
    isNullableString(o.val_text) &&
    isJsonObjectOrNull(o.val_json) &&
    isNullableString(o.observed_at)
  )
}

function parseStagedResponse(content: string): StagedNormalizationAnalysis {
  const obj = parseJsonObject(content)
  if (!obj) return createEmptyStagedAnalysis()

  const identifiedObj = asRecord(obj.identified)
  const mappingsObj = asRecord(obj.mappings)
  const validationsObj = asRecord(obj.validations)
  const fallback = createEmptyStagedAnalysis()

  return {
    identified: {
      parties: isStringArray(identifiedObj.parties) ? identifiedObj.parties : [],
      roles: isStringArray(identifiedObj.roles) ? identifiedObj.roles : [],
      relationships: isStringArray(identifiedObj.relationships) ? identifiedObj.relationships : [],
      events: isStringArray(identifiedObj.events) ? identifiedObj.events : [],
      attributes: isStringArray(identifiedObj.attributes) ? identifiedObj.attributes : []
    },
    mappings: {
      parties: Array.isArray(mappingsObj.parties) ? mappingsObj.parties.filter(isPartiesRow) : [],
      partyRoles: Array.isArray(mappingsObj.partyRoles) ? mappingsObj.partyRoles.filter(isPartyRolesRow) : [],
      entityRelationships: Array.isArray(mappingsObj.entityRelationships)
        ? mappingsObj.entityRelationships.filter(isEntityRelationshipsRow)
        : [],
      schemaDefinitions: Array.isArray(mappingsObj.schemaDefinitions)
        ? mappingsObj.schemaDefinitions.filter(isSchemaDefinitionsRow)
        : [],
      universalEvents: Array.isArray(mappingsObj.universalEvents)
        ? mappingsObj.universalEvents.filter(isUniversalEventsRow)
        : [],
      stateObservations: Array.isArray(mappingsObj.stateObservations)
        ? mappingsObj.stateObservations.filter(isStateObservationsRow)
        : []
    },
    validations: {
      uniqueness: isValidationCheck(validationsObj.uniqueness)
        ? validationsObj.uniqueness
        : fallback.validations.uniqueness,
      invariance: isValidationCheck(validationsObj.invariance)
        ? validationsObj.invariance
        : fallback.validations.invariance,
      completeness: isValidationCheck(validationsObj.completeness)
        ? validationsObj.completeness
        : fallback.validations.completeness,
      temporality: isValidationCheck(validationsObj.temporality)
        ? validationsObj.temporality
        : fallback.validations.temporality,
      relationNormalization: isValidationCheck(validationsObj.relationNormalization)
        ? validationsObj.relationNormalization
        : fallback.validations.relationNormalization
    },
    suggestions: Array.isArray(obj.suggestions)
      ? obj.suggestions.filter((item): item is string => typeof item === 'string')
      : []
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
目標：保留原始模型的中文領域語意與分類，不要抽象化。

關係如下：
${relLines}

請為每個關係提供「中文資料表名稱」（繁體中文），根據主鍵與欄位語意命名。

規則：
- 只輸出繁體中文表名，不要英文、不要拼音
- 表名簡潔（2~8字）
- 表名需能反映原始業務語意，例如：顧客、訂單、產品、銷售明細、庫存
- 不可重複名稱
- 不要加上「表」或「資料表」等贅詞，除非語意必要
- 優先延用原始 LDM 的中文主題與分類
- 禁止使用通用抽象英文表名：Parties、Party_Roles、Entity_Relationships、Schema_Definitions、Universal_Events、State_Observations

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
