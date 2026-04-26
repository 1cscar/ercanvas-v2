import type { LogicalTable } from '../types'
import type {
  FD,
  NormalizedRelation,
  NormalizedAction,
  SemanticInput,
  HiddenFD,
  NormalizationAnalysisInput
} from './normalizationTypes'

// ═══════════════════════════════════════════════════════════════════════════════
// Attribute Closure  X⁺
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Computes the attribute closure X⁺ under a set of FDs.
 * The closure is the set of all attributes functionally determined by X.
 *
 * Algorithm: Chase — iterate until no new attribute can be added.
 */
export function calculateClosure(attributes: ReadonlySet<string>, fds: FD[]): Set<string> {
  const closure = new Set(attributes)
  let changed = true

  while (changed) {
    changed = false
    for (const fd of fds) {
      if (!closure.has(fd.rhs) && fd.lhs.every((a) => closure.has(a))) {
        closure.add(fd.rhs)
        changed = true
      }
    }
  }

  return closure
}

// ═══════════════════════════════════════════════════════════════════════════════
// Candidate Key Discovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns all candidate keys of a relation (minimal superkeys).
 * Practical limit: attribute sets up to ~20 elements.
 */
export function findCandidateKeys(attributes: string[], fds: FD[]): string[][] {
  const universe = [...new Set(attributes)]
  if (universe.length === 0) return []

  const candidates: string[][] = []
  const rhsAttrs = new Set(fds.map((fd) => fd.rhs))
  const required = universe.filter((attr) => !rhsAttrs.has(attr))
  const optional = universe.filter((attr) => !required.includes(attr))

  const isSuperKey = (attrs: string[]) =>
    universe.every((a) => calculateClosure(new Set(attrs), fds).has(a))

  // Required attrs are always part of every key. If they already determine all attrs, done.
  if (required.length > 0 && isSuperKey(required)) {
    return [required]
  }

  // Exact subset search explodes combinatorially for large schemas.
  // Keep exact search for small schemas, and bounded search for larger ones.
  const SMALL_SCHEMA_ATTR_LIMIT = 18
  const LARGE_SCHEMA_MAX_EXTRA_ATTRS = 6
  const MAX_EVALUATED_KEY_CANDIDATES = 80_000

  const maxExtraAttrs =
    universe.length <= SMALL_SCHEMA_ATTR_LIMIT
      ? optional.length
      : Math.min(optional.length, LARGE_SCHEMA_MAX_EXTRA_ATTRS)

  let evaluated = 0
  for (let extraSize = 0; extraSize <= maxExtraAttrs; extraSize++) {
    const subsets = combinations(optional, extraSize)
    for (const subset of subsets) {
      evaluated += 1
      if (evaluated > MAX_EVALUATED_KEY_CANDIDATES) break

      const candidate = [...required, ...subset]
      // Must be a superkey and not contain any already-found candidate key
      if (isSuperKey(candidate) && !isSubsumedBy(candidate, candidates)) {
        candidates.push(candidate)
      }
    }

    // Once we've found candidates at size k, no candidate at size > k can be minimal
    if (candidates.length > 0) break
    if (evaluated > MAX_EVALUATED_KEY_CANDIDATES) break
  }

  if (candidates.length > 0) return candidates

  // Safe fallback: preserve progress without hanging/crashing the UI.
  const fallback = required.length > 0 ? required : [universe[0]]
  console.warn(
    '[NormalizationEngine] Candidate key search fell back to heuristic key due schema size/complexity.'
  )
  return [fallback]
}

/** True if some existing candidate is a subset of `attrs`. */
function isSubsumedBy(attrs: string[], candidates: string[][]): boolean {
  return candidates.some((ck) => ck.every((a) => attrs.includes(a)))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Minimal Cover  (Canonical Cover)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Computes the minimal cover Fc of a set of FDs.
 *
 * Three-step algorithm (Ullman / Ramakrishnan & Gehrke):
 *   Step 1 — RHS is already single-attribute by type; deduplicate.
 *   Step 2 — Remove redundant attributes from each LHS.
 *   Step 3 — Remove redundant FDs.
 */
export function getMinimalCover(fds: FD[]): FD[] {
  // Step 1: Normalise and deduplicate
  let work: FD[] = deduplicate(
    fds.map((fd) => ({ lhs: [...fd.lhs].sort(), rhs: fd.rhs }))
  )

  // Step 2: Remove redundant LHS attributes
  //   For each FD X → A and each attribute B in X:
  //   If A ∈ closure(X − {B}, current F), then B is redundant → replace X with X − {B}.
  for (let i = 0; i < work.length; i++) {
    if (work[i].lhs.length <= 1) continue

    let currentLhs = [...work[i].lhs]
    const rhs = work[i].rhs

    // Iterate in reverse so index manipulation is safe
    for (let j = currentLhs.length - 1; j >= 0; j--) {
      const reducedLhs = currentLhs.filter((_, k) => k !== j)

      // Build test set: this FD has the potentially-reduced LHS
      const testFDs = work.map((f, idx) =>
        idx === i ? ({ lhs: reducedLhs, rhs } as FD) : f
      )

      if (calculateClosure(new Set(reducedLhs), testFDs).has(rhs)) {
        currentLhs = reducedLhs
        work[i] = { lhs: currentLhs, rhs }
      }
    }
  }

  work = deduplicate(work)

  // Step 3: Remove redundant FDs
  //   FD X → A is redundant if A ∈ closure(X, F − {X → A}).
  const keep = new Array<boolean>(work.length).fill(true)

  for (let i = 0; i < work.length; i++) {
    const without = work.filter((_, j) => j !== i && keep[j])
    if (calculateClosure(new Set(work[i].lhs), without).has(work[i].rhs)) {
      keep[i] = false
    }
  }

  return work.filter((_, i) => keep[i])
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bernstein's 3NF Synthesis
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Synthesises a set of 3NF relations from a minimal cover.
 *
 * Algorithm (Bernstein 1976 / Ullman):
 *   1. Group FDs in Fc by LHS → one relation per group.
 *   2. If no resulting relation contains a candidate key of the original schema,
 *      add a relation whose schema is one candidate key.
 *   3. Remove redundant relations (attributes ⊆ another relation's attributes).
 *
 * Guarantees:
 *   - Dependency preservation (every FD in Fc is represented in some relation).
 *   - Lossless join (candidate-key relation ensures the universal relation is
 *     recoverable via natural join).
 */
export function synthesize3NF(
  /** All attributes of the original (universal) relation. */
  attributes: string[],
  minCover: FD[]
): NormalizedRelation[] {
  const uniqueAttributes = [...new Set(attributes)]
  if (minCover.length === 0) {
    // Degenerate case: no FDs → single relation with all attributes
    return [
      {
        name: 'Relation_1',
        attributes: [...uniqueAttributes],
        primaryKey: [...uniqueAttributes],
        fds: []
      }
    ]
  }

  // Step 1: Group by LHS (normalise key to sorted comma-separated string)
  const groups = new Map<string, { lhs: string[]; fds: FD[] }>()
  for (const fd of minCover) {
    const key = [...fd.lhs].sort().join(' ')
    if (!groups.has(key)) {
      groups.set(key, { lhs: [...fd.lhs], fds: [] })
    }
    groups.get(key)!.fds.push(fd)
  }

  const relations: NormalizedRelation[] = []
  let idx = 1

  for (const { lhs, fds: groupFDs } of groups.values()) {
    const rhsAttrs = groupFDs.map((fd) => fd.rhs)
    const relAttrs = [...new Set([...lhs, ...rhsAttrs])]

    relations.push({
      name: `Relation_${idx++}`,
      attributes: relAttrs,
      primaryKey: [...lhs],
      fds: groupFDs
    })
  }

  // Step 2: Ensure at least one relation contains a candidate key
  const candidateKeys = findCandidateKeys(uniqueAttributes, minCover)
  const hasCandidateKey = candidateKeys.some((ck) =>
    relations.some((rel) => ck.every((a) => rel.attributes.includes(a)))
  )

  if (!hasCandidateKey && candidateKeys.length > 0) {
    const ck = candidateKeys[0]
    relations.push({
      name: `Relation_${idx}`,
      attributes: [...ck],
      primaryKey: [...ck],
      fds: []
    })
  }

  // Step 3: Remove relations subsumed by a larger relation
  return removeRedundant(relations)
}

function removeRedundant(relations: NormalizedRelation[]): NormalizedRelation[] {
  return relations.filter(
    (rel, i) =>
      !relations.some(
        (other, j) =>
          i !== j &&
          other.attributes.length > rel.attributes.length &&
          rel.attributes.every((a) => other.attributes.includes(a))
      )
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FD Extraction from LogicalTable[]
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts the UI's `LogicalTable[]` representation into a flat set of
 * qualified attribute names and explicit FDs, ready for the math engine.
 *
 * Attribute names are qualified as "TableName.ColumnName" to avoid
 * cross-table ambiguity in multi-table normalization.
 */
export function extractFDsFromTables(tables: LogicalTable[]): {
  allAttrs: string[]
  fds: FD[]
} {
  const allAttrsSet = new Set<string>()
  const fds: FD[] = []

  for (const table of tables) {
    const pkNames = table.fields.filter((f) => f.is_pk).map((f) => f.name)
    const qualifiedPKs = pkNames.map((pk) => `${table.name}.${pk}`)

    for (const field of table.fields) {
      const qName = `${table.name}.${field.name}`
      allAttrsSet.add(qName)

      if (field.is_pk) continue

      if (field.partial_dep_on.length > 0) {
        // Partial dependency: field depends only on a subset of the PK
        fds.push({
          lhs: field.partial_dep_on.map((dep) => `${table.name}.${dep}`),
          rhs: qName
        })
      } else if (field.transitive_dep_via) {
        // Transitive dependency: PK → via → field
        fds.push({
          lhs: [`${table.name}.${field.transitive_dep_via}`],
          rhs: qName
        })
      } else if (qualifiedPKs.length > 0) {
        // Full functional dependency on the primary key
        fds.push({ lhs: qualifiedPKs, rhs: qName })
      }
    }
  }

  return { allAttrs: [...allAttrsSet], fds }
}

/**
 * Converts `LogicalTable[]` into the `SemanticInput` format expected by
 * `SemanticService.analyze()`.
 */
export function buildSemanticInput(tables: LogicalTable[]): SemanticInput {
  return {
    tables: tables.map((t) => ({
      tableName: t.name,
      columns: t.fields.map((f) => f.name),
      primaryKeys: t.fields.filter((f) => f.is_pk).map((f) => f.name)
    }))
  }
}

/**
 * Converts `LogicalTable[]` into a rich JSON payload for end-to-end
 * AI-led 1NF→3NF staged analysis.
 */
export function buildNormalizationAnalysisInput(tables: LogicalTable[]): NormalizationAnalysisInput {
  const seenConnection = new Set<string>()
  const userConnections: NonNullable<NormalizationAnalysisInput['userConnections']> = []

  for (const table of tables) {
    for (const field of table.fields) {
      if (!field.is_fk || !field.fk_ref_table || !field.fk_ref_field) continue
      const key = `${table.name}.${field.name}->${field.fk_ref_table}.${field.fk_ref_field}`
      if (seenConnection.has(key)) continue
      seenConnection.add(key)
      userConnections.push({
        fromTable: table.name,
        fromColumn: field.name,
        toTable: field.fk_ref_table,
        toColumn: field.fk_ref_field
      })
    }
  }

  return {
    tables: tables.map((table) => {
      const primaryKeys = table.fields.filter((field) => field.is_pk).map((field) => field.name)
      return {
        tableName: table.name,
        columns: table.fields.map((field) => ({
          name: field.name,
          type: field.data_type ?? null,
          isPrimaryKey: field.is_pk,
          notes:
            [
              field.is_not_null ? 'NOT NULL' : null,
              field.default_value ? `DEFAULT ${field.default_value}` : null
            ]
              .filter(Boolean)
              .join(', ') || null
        })),
        primaryKeys
      }
    }),
    userConnections
  }
}

/**
 * Lifts AI-detected `HiddenFD[]` into qualified `FD[]` compatible with the
 * math engine, scoping each attribute name to its source table.
 *
 * Because AI may return unqualified column names, this function resolves
 * them against the known schema using a name-lookup map.
 */
export function liftHiddenFDs(
  hiddenFDs: HiddenFD[],
  tables: LogicalTable[],
  minConfidence = 0.75
): FD[] {
  // Build a map: unqualified column name → qualified "Table.Column" (first match wins)
  const nameMap = new Map<string, string>()
  for (const table of tables) {
    for (const field of table.fields) {
      const key = field.name.toLowerCase()
      if (!nameMap.has(key)) {
        nameMap.set(key, `${table.name}.${field.name}`)
      }
    }
  }

  const resolve = (col: string): string | null => {
    // Already qualified
    if (col.includes('.')) return col
    return nameMap.get(col.toLowerCase()) ?? null
  }

  return hiddenFDs
    .filter((hfd) => hfd.confidence >= minConfidence)
    .flatMap((hfd) => {
      const resolvedLhs = hfd.lhs.map(resolve)
      const resolvedRhs = resolve(hfd.rhs)
      if (resolvedLhs.some((a) => a === null) || resolvedRhs === null) return []
      return [{ lhs: resolvedLhs as string[], rhs: resolvedRhs }]
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action List Generator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compares the original `LogicalTable[]` with the 3NF-synthesised relations
 * and emits an ordered list of canvas actions that transform one into the other.
 *
 * Action ordering:
 *   1. CREATE_TABLE  (new tables must exist before columns are moved into them)
 *   2. MOVE_COLUMN   (move columns that no longer belong in the original table)
 *   3. ADD_FOREIGN_KEY (wire up FK references between related tables)
 *   4. DELETE_TABLE  (original tables that were fully decomposed)
 */
export function generateActions(
  originalTables: LogicalTable[],
  normalizedRelations: NormalizedRelation[]
): NormalizedAction[] {
  const actions: NormalizedAction[] = []

  const originalNames = new Set(originalTables.map((t) => t.name))
  const normalizedNames = new Set(normalizedRelations.map((r) => r.name))

  // ── 1. CREATE new tables ──────────────────────────────────────────────────
  for (const rel of normalizedRelations) {
    if (!originalNames.has(rel.name)) {
      // Strip table-name qualifier from column names for the UI
      const cols = rel.attributes.map(unqualify)
      const pk = rel.primaryKey.map(unqualify)

      actions.push({ type: 'CREATE_TABLE', tableName: rel.name, columns: cols, primaryKey: pk })
    }
  }

  // Build a map: qualified attr → destination relation name
  const destination = new Map<string, string>()
  for (const rel of normalizedRelations) {
    for (const attr of rel.attributes) {
      destination.set(attr, rel.name)
    }
  }

  // ── 2. MOVE columns ───────────────────────────────────────────────────────
  for (const table of originalTables) {
    for (const field of table.fields) {
      const qName = `${table.name}.${field.name}`
      const dest = destination.get(qName)
      if (dest && dest !== table.name) {
        actions.push({
          type: 'MOVE_COLUMN',
          fromTable: table.name,
          toTable: dest,
          columnName: field.name
        })
      }
    }
  }

  // ── 3. ADD_FOREIGN_KEY ───────────────────────────────────────────────────
  // For each non-key attribute in a relation, check if it is a PK in another
  // relation (i.e., it's a foreign key reference).
  const pkIndex = new Map<string, string>() // unqualified col → relation name
  for (const rel of normalizedRelations) {
    for (const pkAttr of rel.primaryKey) {
      pkIndex.set(unqualify(pkAttr), rel.name)
    }
  }

  for (const rel of normalizedRelations) {
    for (const attr of rel.attributes) {
      const col = unqualify(attr)
      if (rel.primaryKey.map(unqualify).includes(col)) continue

      const refTable = pkIndex.get(col)
      if (refTable && refTable !== rel.name) {
        actions.push({
          type: 'ADD_FOREIGN_KEY',
          fromTable: rel.name,
          fromColumn: col,
          toTable: refTable,
          toColumn: col
        })
      }
    }
  }

  // ── 4. DELETE tables that were fully decomposed ──────────────────────────
  for (const table of originalTables) {
    if (!normalizedNames.has(table.name)) {
      actions.push({ type: 'DELETE_TABLE', tableName: table.name })
    }
  }

  return actions
}

// ═══════════════════════════════════════════════════════════════════════════════
// Relations → LogicalTable[]  (math output → UI model)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts 3NF-synthesised `NormalizedRelation[]` back into the `LogicalTable[]`
 * format used by the canvas, with FK references wired up automatically.
 *
 * @param relations   Output of `synthesize3NF` (after AI renaming).
 * @param diagramId   Current diagram ID to stamp onto every new table.
 * @param originalTables  Used to preserve x/y positions for tables that kept their name.
 */
export function relationsToLogicalTables(
  relations: NormalizedRelation[],
  diagramId: string,
  originalTables: LogicalTable[]
): LogicalTable[] {
  // Map: unqualified col name → relation name that owns it as PK
  const pkOwner = new Map<string, string>()
  for (const rel of relations) {
    for (const pk of rel.primaryKey) {
      pkOwner.set(unqualify(pk), rel.name)
    }
  }

  // Reuse positions for tables that kept their original name
  const originalPos = new Map(originalTables.map((t) => [t.name, { x: t.x, y: t.y }]))

  return relations.map((rel, idx) => {
    const pos = originalPos.get(rel.name) ?? {
      x: 80 + (idx % 3) * 380,
      y: 80 + Math.floor(idx / 3) * 280
    }

    const tableId = crypto.randomUUID()
    const pkCols = new Set(rel.primaryKey.map(unqualify))

    const fields: LogicalTable['fields'] = rel.attributes.map((attr, order) => {
      const colName = unqualify(attr)
      const isPK = pkCols.has(colName)

      // Non-PK column is a FK when it's the PK of another relation
      const refRelName = pkOwner.get(colName)
      const isFK = !isPK && refRelName !== undefined && refRelName !== rel.name

      return {
        id: crypto.randomUUID(),
        table_id: tableId,
        name: colName,
        order_index: order,
        is_pk: isPK,
        is_fk: isFK,
        is_multi_value: false,
        is_composite: false,
        composite_children: [],
        partial_dep_on: [],
        transitive_dep_via: null,
        fk_ref_table: isFK ? refRelName! : null,
        fk_ref_field: isFK ? colName : null,
        data_type: null,
        is_not_null: isPK,
        default_value: null
      }
    })

    // PKs first
    fields.sort((a, b) => (b.is_pk ? 1 : 0) - (a.is_pk ? 1 : 0))
    fields.forEach((f, i) => { f.order_index = i })

    return { id: tableId, diagram_id: diagramId, name: rel.name, x: pos.x, y: pos.y, fields }
  })
}

/**
 * Applies an AI-supplied rename map to a list of relations.
 * Relations without a mapping keep their original name.
 */
export function applyRenames(
  relations: NormalizedRelation[],
  renames: Map<string, string>
): NormalizedRelation[] {
  return relations.map((rel) => {
    const newName = renames.get(rel.name)
    if (!newName) return rel
    return { ...rel, name: newName }
  })
}

/** Strips the "TableName." prefix from a qualified attribute name. */
function unqualify(attr: string): string {
  const dot = attr.indexOf('.')
  return dot !== -1 ? attr.slice(dot + 1) : attr
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/** Returns all k-combinations of an array. */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  return [
    ...combinations(tail, k - 1).map((c) => [head, ...c]),
    ...combinations(tail, k)
  ]
}

/** Removes duplicate FDs (same sorted LHS and same RHS). */
function deduplicate(fds: FD[]): FD[] {
  const seen = new Set<string>()
  return fds.filter((fd) => {
    const key = `${[...fd.lhs].sort().join(' ')}→${fd.rhs}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
