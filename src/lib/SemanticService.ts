import type {
  SemanticAnalysisResult,
  SemanticInput,
  HiddenFD,
  Disambiguation,
  AtomicViolation,
  NormalizedRelation
} from './normalizationTypes'

const OLLAMA_URL = 'http://localhost:11434/api/chat'
// Run `ollama list` to confirm your exact model tag (e.g. gemma4, gemma4:27b)
const MODEL = 'gemma4'
const TIMEOUT_MS = 90_000

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

// ─── Response Parser ────────────────────────────────────────────────────────────

function parseResponse(content: string): SemanticAnalysisResult {
  let text = content.trim()

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) text = fenceMatch[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    console.warn('[SemanticService] Could not parse JSON response:', text.slice(0, 200))
    return { hiddenFDs: [], disambiguations: [], atomicViolations: [] }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { hiddenFDs: [], disambiguations: [], atomicViolations: [] }
  }

  const obj = parsed as Record<string, unknown>

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

  return `You are a senior database architect. The following relations were produced by a 3NF synthesis algorithm and currently have placeholder names.

Relations:
${relLines}

For each relation, suggest a short, meaningful English table name (PascalCase, singular noun) that reflects its business domain based on the column names and primary key.

Rules:
- Use domain knowledge: e.g. columns [OrderID, CustomerID, OrderDate] → "Order"; [ZipCode, City, State] → "ZipLocation"
- Keep names concise (1-3 words max, no underscores)
- If the relation clearly maps to an existing concept, use that name
- Do NOT reuse the same name twice

Return ONLY this JSON, no other text:
{
  "renames": [
    { "original": "Relation_1", "suggested": "TableName" }
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
 * Calls the local Ollama/Gemma 4 model to perform semantic pre-processing
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
