// ─── Core FD Types ─────────────────────────────────────────────────────────────

/** A single functional dependency with a single-attribute RHS (canonical form). */
export interface FD {
  /** Determinant (left-hand side). May be composite. */
  lhs: string[]
  /** Dependent attribute (right-hand side), always a single attribute. */
  rhs: string
}

/**
 * Input table schema for the normalization engine.
 * Decoupled from the UI LogicalTable type so the engine stays framework-agnostic.
 */
export interface RawTable {
  id: string
  name: string
  /** All column names in declaration order. */
  columns: string[]
  /** Column names that form the primary key (may be composite). */
  primaryKeys: string[]
  /** Explicitly known FDs (from UI metadata + AI augmentation). */
  fds: FD[]
}

/** A 3NF relation produced by Bernstein's synthesis. */
export interface NormalizedRelation {
  /** Auto-generated name before AI renaming (e.g. "Relation_1"). */
  name: string
  /** All attribute names in this relation (may use qualified "Table.Col" form). */
  attributes: string[]
  /** The minimal key for this relation (subset of attributes). */
  primaryKey: string[]
  /** The FDs that motivated this relation's creation. */
  fds: FD[]
}

// ─── Action List Types ──────────────────────────────────────────────────────────

export interface CreateTableAction {
  type: 'CREATE_TABLE'
  tableName: string
  columns: string[]
  primaryKey: string[]
}

export interface DeleteTableAction {
  type: 'DELETE_TABLE'
  tableName: string
}

export interface MoveColumnAction {
  type: 'MOVE_COLUMN'
  fromTable: string
  toTable: string
  columnName: string
}

export interface RenameColumnAction {
  type: 'RENAME_COLUMN'
  tableName: string
  oldName: string
  newName: string
}

export interface AddForeignKeyAction {
  type: 'ADD_FOREIGN_KEY'
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export type NormalizedAction =
  | CreateTableAction
  | DeleteTableAction
  | MoveColumnAction
  | RenameColumnAction
  | AddForeignKeyAction

// ─── Semantic Analysis Types ───────────────────────────────────────────────────

/** A hidden FD discovered by AI (not specified by user). */
export interface HiddenFD {
  lhs: string[]
  rhs: string
  /** 0–1, how confident the AI is. */
  confidence: number
  /** Human-readable explanation (e.g. "ZipCode determines City in most address standards"). */
  reason: string
}

/** A column that may need to be renamed to avoid semantic ambiguity. */
export interface Disambiguation {
  tableName: string
  columnName: string
  /** Suggested qualified name, e.g. "Race_FastestLap". */
  suggestedName: string
  reason: string
}

/** A column that may violate 1NF atomicity. */
export interface AtomicViolation {
  tableName: string
  columnName: string
  reason: string
  /** What the column should be split into. */
  suggestion: string
}

/** Full output from the semantic analysis pass. */
export interface SemanticAnalysisResult {
  hiddenFDs: HiddenFD[]
  disambiguations: Disambiguation[]
  atomicViolations: AtomicViolation[]
}

/** Input schema sent to the AI for analysis. */
export interface SemanticInput {
  tables: Array<{
    tableName: string
    columns: string[]
    primaryKeys: string[]
  }>
}
