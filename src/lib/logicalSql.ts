import { LogicalField, LogicalTable } from '../types'
import { GeminiTranslateResponseSchema } from './geminiSchemas'

const CJK_PATTERN = /[\u3400-\u9fff]/u
const NON_IDENTIFIER_PATTERN = /[^a-z0-9_]+/g

const WORD_TRANSLATIONS: Array<[string, string]> = [
  ['建立時間', 'created_at'],
  ['更新時間', 'updated_at'],
  ['刪除時間', 'deleted_at'],
  ['主鍵', 'id'],
  ['外鍵', 'fk'],
  ['編號', 'id'],
  ['流水號', 'serial_no'],
  ['姓名', 'name'],
  ['名稱', 'name'],
  ['電話', 'phone'],
  ['手機', 'mobile'],
  ['電子郵件', 'email'],
  ['地址', 'address'],
  ['郵遞區號', 'zip_code'],
  ['國家', 'country'],
  ['城市', 'city'],
  ['縣市', 'city'],
  ['日期', 'date'],
  ['時間', 'time'],
  ['建立', 'created'],
  ['更新', 'updated'],
  ['刪除', 'deleted'],
  ['啟用', 'enabled'],
  ['狀態', 'status'],
  ['類型', 'type'],
  ['分類', 'category'],
  ['備註', 'note'],
  ['描述', 'description'],
  ['內容', 'content'],
  ['標題', 'title'],
  ['數量', 'quantity'],
  ['金額', 'amount'],
  ['單價', 'unit_price'],
  ['折扣', 'discount'],
  ['總計', 'total'],
  ['價格', 'price'],
  ['使用者', 'user'],
  ['會員', 'member'],
  ['客戶', 'customer'],
  ['供應商', 'supplier'],
  ['員工', 'employee'],
  ['部門', 'department'],
  ['角色', 'role'],
  ['權限', 'permission'],
  ['產品', 'product'],
  ['商品', 'product'],
  ['品項', 'item'],
  ['訂單', 'order'],
  ['發票', 'invoice'],
  ['付款', 'payment'],
  ['庫存', 'inventory'],
  ['專案', 'project'],
  ['任務', 'task'],
  ['訊息', 'message'],
  ['密碼', 'password'],
  ['帳號', 'account'],
  ['代碼', 'code']
]

const MYSQL_DATA_TYPE_OPTIONS = [
  'INT',
  'BIGINT',
  'VARCHAR(255)',
  'TEXT',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'DECIMAL(10,2)',
  'BOOLEAN'
] as const

const MYSQL_RESERVED_WORDS = new Set([
  'order',
  'group',
  'index',
  'key',
  'table',
  'select',
  'from',
  'where',
  'by',
  'rank',
  'desc',
  'asc',
  'primary',
  'foreign',
  'constraint'
])

type MutableLogicalTable = Omit<LogicalTable, 'fields'> & { fields: LogicalField[] }

export type LogicalValidationIssueCode =
  | 'INVALID_DATA_TYPE'
  | 'FK_REF_TABLE_REQUIRED'
  | 'FK_REF_TABLE_NOT_FOUND'
  | 'FK_REF_FIELD_REQUIRED'
  | 'FK_REF_FIELD_NOT_FOUND'
  | 'DEFAULT_VALUE_CONTAINS_CHINESE'

export interface LogicalValidationIssue {
  code: LogicalValidationIssueCode
  tableId: string
  tableName: string
  fieldId: string
  fieldName: string
  message: string
}

export interface LogicalModelNormalizationResult {
  tables: LogicalTable[]
  issues: LogicalValidationIssue[]
}

type GeminiTranslatedField = { name?: string; nameEn?: string }
type GeminiTranslatedTable = { name?: string; nameEn?: string; fields?: GeminiTranslatedField[] }

const normalizeLookupKey = (value: string | null | undefined) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')

const hasChinese = (value: string | null | undefined) => CJK_PATTERN.test(value ?? '')

const appendUniqueName = (base: string, used: Set<string>) => {
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    candidate = `${base}_${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

const hashLabel = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

const applyReservedWordFallback = (value: string, fallbackPrefix: string) => {
  if (!MYSQL_RESERVED_WORDS.has(value)) return value
  if (fallbackPrefix === 'table') return `${value}_item`
  return `${value}_value`
}

const sanitizeIdentifier = (value: string, fallbackPrefix: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .replace(NON_IDENTIFIER_PATTERN, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  const safe = normalized || `${fallbackPrefix}_${hashLabel(value || fallbackPrefix)}`
  const prefixed = /^[0-9]/.test(safe) ? `${fallbackPrefix}_${safe}` : safe
  return applyReservedWordFallback(prefixed, fallbackPrefix)
}

const suggestFromChinese = (value: string, fallbackPrefix: string) => {
  let remaining = value.trim()
  const tokens: string[] = []

  for (const [zh, en] of WORD_TRANSLATIONS) {
    if (!remaining.includes(zh)) continue
    tokens.push(en)
    remaining = remaining.split(zh).join(' ')
  }

  if (tokens.length === 0 && !/[a-zA-Z]/.test(value)) {
    return `${fallbackPrefix}_${hashLabel(value || fallbackPrefix)}`
  }

  const asciiRemainder = remaining
    .replace(/[\u3400-\u9fff]/gu, ' ')
    .replace(/\s+/g, '_')
    .replace(NON_IDENTIFIER_PATTERN, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (asciiRemainder) tokens.push(asciiRemainder)
  return tokens.join('_') || `${fallbackPrefix}_${hashLabel(value || fallbackPrefix)}`
}

export const suggestEnglishIdentifier = (value: string, fallbackPrefix: 'table' | 'field') => {
  const trimmed = value.trim()
  if (!trimmed) return `${fallbackPrefix}_${hashLabel(fallbackPrefix)}`

  const suggested = hasChinese(trimmed)
    ? suggestFromChinese(trimmed, fallbackPrefix)
    : sanitizeIdentifier(trimmed, fallbackPrefix)

  return sanitizeIdentifier(suggested, fallbackPrefix)
}

const sanitizeDataType = (dataType: string | null | undefined) => {
  const raw = (dataType ?? '').trim()
  const value = raw.toUpperCase()
  if (!value) return null
  if (hasChinese(value)) return null
  return value
}

const normalizeDefaultValue = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

const shouldTreatDefaultAsRaw = (value: string) =>
  /^(NULL|CURRENT_TIMESTAMP(?:\(\))?|TRUE|FALSE|-?\d+(?:\.\d+)?)$/i.test(value)

const quoteDefaultLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`

export const getMySqlDataTypeOptions = () => [...MYSQL_DATA_TYPE_OPTIONS]

const cloneTables = (tables: LogicalTable[]): LogicalTable[] =>
  tables.map((table) => ({
    ...table,
    fields: table.fields.map((field) => ({ ...field }))
  }))

const ensureSingleIdSuffix = (value: string, fallbackNoun: string) => {
  const normalized = sanitizeIdentifier(value, 'field')
  const stem = normalized.replace(/(?:_id)+$/g, '')
  const finalStem = stem && stem !== 'id' ? stem : sanitizeIdentifier(fallbackNoun, 'field')
  return sanitizeIdentifier(`${finalStem}_id`, 'field')
}

const buildPrimaryKeyFieldName = (tableName: string) => {
  const tableBase = sanitizeIdentifier(tableName, 'table')
  return ensureSingleIdSuffix(tableBase, 'entity')
}

const buildForeignKeyFieldName = (targetTableName: string) => {
  const tableBase = sanitizeIdentifier(targetTableName, 'table')
  return ensureSingleIdSuffix(tableBase, 'ref')
}

const applyFieldNamingConventions = (table: { name: string; name_en?: string | null; fields: LogicalField[] }) => {
  const usedFieldNames = new Set<string>()
  const prioritizedFields = [...table.fields].sort((a, b) => Number(b.is_pk) - Number(a.is_pk))
  const tableNameForPk = table.name_en?.trim() || suggestEnglishIdentifier(table.name, 'table')
  const defaultPkName = buildPrimaryKeyFieldName(tableNameForPk)

  for (const field of prioritizedFields) {
    const baseFieldName = sanitizeIdentifier(
      field.name_en?.trim() || suggestEnglishIdentifier(field.name, 'field'),
      'field'
    )

    let finalBase = baseFieldName
    if (field.is_pk) {
      finalBase = ensureSingleIdSuffix(baseFieldName, defaultPkName.replace(/_id$/g, ''))
    } else if (field.is_fk) {
      const targetTableName = field.fk_ref_table_en?.trim() || field.fk_ref_table?.trim() || ''
      if (targetTableName) {
        finalBase = buildForeignKeyFieldName(targetTableName)
      }
    }

    field.name_en = appendUniqueName(finalBase, usedFieldNames)
  }
}

export async function translateLogicalNamesByGeminiForSql(tables: LogicalTable[]): Promise<LogicalTable[]> {
  const source = cloneTables(tables)
  const response = await fetch('/api/gemini-translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tables: source.map((table) => ({
        name: table.name,
        fields: table.fields.map((field) => ({
          name: field.name,
          isPK: field.is_pk,
          isFK: field.is_fk,
          fkRefTable: field.fk_ref_table,
          fkRefField: field.fk_ref_field
        }))
      }))
    })
  })

  const rawPayload = (await response.json().catch(() => ({}))) as {
    error?: string
    result?: unknown
  }

  if (!response.ok) {
    throw new Error(rawPayload.error || `Gemini translation failed (${response.status})`)
  }

  const parseResult = GeminiTranslateResponseSchema.safeParse(rawPayload.result)
  if (!parseResult.success) {
    throw new Error(
      `Gemini translate 回傳格式驗證失敗：${parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    )
  }

  const translatedTables = parseResult.data.tables ?? []
  if (translatedTables.length === 0) {
    throw new Error('Gemini 沒有回傳可用的英文命名結果。')
  }

  const translatedByTableName = new Map<string, GeminiTranslatedTable>()
  for (const table of translatedTables) {
    const key = normalizeLookupKey(table.name)
    if (key && !translatedByTableName.has(key)) translatedByTableName.set(key, table)
  }

  const usedTableNames = new Set<string>()

  for (let tableIndex = 0; tableIndex < source.length; tableIndex += 1) {
    const table = source[tableIndex]
    const translatedTable =
      translatedByTableName.get(normalizeLookupKey(table.name)) ?? translatedTables[tableIndex] ?? null

    const tableNameRaw =
      (translatedTable?.nameEn && sanitizeIdentifier(translatedTable.nameEn, 'table')) ||
      suggestEnglishIdentifier(table.name, 'table')
    table.name_en = appendUniqueName(tableNameRaw, usedTableNames)

    const translatedFieldByName = new Map<string, GeminiTranslatedField>()
    for (const translatedField of translatedTable?.fields ?? []) {
      const key = normalizeLookupKey(translatedField.name)
      if (key && !translatedFieldByName.has(key)) translatedFieldByName.set(key, translatedField)
    }

    for (let fieldIndex = 0; fieldIndex < table.fields.length; fieldIndex += 1) {
      const field = table.fields[fieldIndex]
      const translatedField =
        translatedFieldByName.get(normalizeLookupKey(field.name)) ??
        translatedTable?.fields?.[fieldIndex] ??
        null
      const rawFieldName =
        (translatedField?.nameEn && sanitizeIdentifier(translatedField.nameEn, 'field')) ||
        suggestEnglishIdentifier(field.name, 'field')
      field.name_en = sanitizeIdentifier(rawFieldName, 'field')
    }
  }

  const tableByRawName = new Map<string, LogicalTable>()
  const tableByEnglishName = new Map<string, LogicalTable>()
  for (const table of source) {
    tableByRawName.set(normalizeLookupKey(table.name), table)
    if (table.name_en) tableByEnglishName.set(normalizeLookupKey(table.name_en), table)
  }

  for (const table of source) {
    for (const field of table.fields) {
      if (!field.is_fk) continue

      const targetTable =
        tableByRawName.get(normalizeLookupKey(field.fk_ref_table)) ??
        tableByEnglishName.get(normalizeLookupKey(field.fk_ref_table_en)) ??
        null
      if (!targetTable) continue

      const targetField =
        targetTable.fields.find(
          (candidate) =>
            normalizeLookupKey(candidate.name) === normalizeLookupKey(field.fk_ref_field) ||
            normalizeLookupKey(candidate.name_en) === normalizeLookupKey(field.fk_ref_field_en)
        ) ??
        targetTable.fields.find((candidate) => candidate.is_pk) ??
        null

      field.fk_ref_table_en = targetTable.name_en
      field.fk_ref_field_en = targetField?.name_en ?? null
    }

    applyFieldNamingConventions(table)
  }

  return source
}

export function normalizeLogicalModelForMySQL(tables: LogicalTable[]): LogicalModelNormalizationResult {
  const nextTables: MutableLogicalTable[] = tables.map((table) => ({
    ...table,
    fields: table.fields.map((field) => ({ ...field }))
  }))

  const issues: LogicalValidationIssue[] = []
  const tableNameUsed = new Set<string>()
  const tableLookup = new Map<string, MutableLogicalTable>()

  for (const table of nextTables) {
    const tableEnBase = sanitizeIdentifier(
      table.name_en?.trim() || suggestEnglishIdentifier(table.name, 'table'),
      'table'
    )
    const tableEn = appendUniqueName(tableEnBase, tableNameUsed)
    table.name_en = tableEn

    tableLookup.set(normalizeLookupKey(table.name), table)
    tableLookup.set(normalizeLookupKey(table.name_en), table)
  }

  for (const table of nextTables) {
    for (const field of table.fields) {
      const rawFieldEn = sanitizeIdentifier(
        field.name_en?.trim() || suggestEnglishIdentifier(field.name, 'field'),
        'field'
      )
      field.name_en = rawFieldEn

      const normalizedType = sanitizeDataType(field.data_type)
      const rawType = field.data_type?.trim() ?? ''
      field.data_type = normalizedType ?? 'VARCHAR(255)'

      if (rawType && !normalizedType) {
        issues.push({
          code: 'INVALID_DATA_TYPE',
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          message: `${table.name}.${field.name} 的資料型別格式無效，請改為 MySQL 型別（例如 INT / VARCHAR(255)）。`
        })
      }

      const normalizedDefault = normalizeDefaultValue(field.default_value)
      field.default_value = normalizedDefault
      if (normalizedDefault && hasChinese(normalizedDefault)) {
        issues.push({
          code: 'DEFAULT_VALUE_CONTAINS_CHINESE',
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          message: `${table.name}.${field.name} 的 DEFAULT 值含有中文，SQL 匯出不可包含中文。`
        })
      }
    }
  }

  const findFieldByRef = (table: MutableLogicalTable, ref: string | null, refEn: string | null) => {
    const refKey = normalizeLookupKey(ref)
    const refEnKey = normalizeLookupKey(refEn)
    return (
      table.fields.find((field) => normalizeLookupKey(field.name) === refKey) ??
      table.fields.find((field) => normalizeLookupKey(field.name_en) === refEnKey) ??
      null
    )
  }

  for (const sourceTable of nextTables) {
    for (const sourceField of sourceTable.fields) {
      if (!sourceField.is_fk) continue

      const rawRefTable = sourceField.fk_ref_table?.trim() || null
      const rawRefTableEn = sourceField.fk_ref_table_en?.trim() || null
      if (!rawRefTable && !rawRefTableEn) {
        issues.push({
          code: 'FK_REF_TABLE_REQUIRED',
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          fieldId: sourceField.id,
          fieldName: sourceField.name,
          message: `${sourceTable.name}.${sourceField.name} 是 FK，但尚未指定參照資料表。`
        })
        continue
      }

      const targetTable =
        tableLookup.get(normalizeLookupKey(rawRefTable)) ??
        tableLookup.get(normalizeLookupKey(rawRefTableEn)) ??
        null

      if (!targetTable) {
        issues.push({
          code: 'FK_REF_TABLE_NOT_FOUND',
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          fieldId: sourceField.id,
          fieldName: sourceField.name,
          message: `${sourceTable.name}.${sourceField.name} 的 FK 參照表不存在：${rawRefTable ?? rawRefTableEn}`
        })
        continue
      }

      const rawRefField = sourceField.fk_ref_field?.trim() || null
      const rawRefFieldEn = sourceField.fk_ref_field_en?.trim() || null
      if (!rawRefField && !rawRefFieldEn) {
        issues.push({
          code: 'FK_REF_FIELD_REQUIRED',
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          fieldId: sourceField.id,
          fieldName: sourceField.name,
          message: `${sourceTable.name}.${sourceField.name} 是 FK，但尚未指定參照欄位。`
        })
        continue
      }

      const targetField = findFieldByRef(targetTable, rawRefField, rawRefFieldEn)
      if (!targetField) {
        issues.push({
          code: 'FK_REF_FIELD_NOT_FOUND',
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          fieldId: sourceField.id,
          fieldName: sourceField.name,
          message: `${sourceTable.name}.${sourceField.name} 的 FK 參照欄位不存在：${rawRefField ?? rawRefFieldEn}`
        })
        continue
      }

      sourceField.fk_ref_table = targetTable.name
      sourceField.fk_ref_table_en = targetTable.name_en
      sourceField.fk_ref_field = targetField.name
      sourceField.fk_ref_field_en = targetField.name_en
    }
  }

  for (const table of nextTables) {
    applyFieldNamingConventions(table)
  }

  for (const sourceTable of nextTables) {
    for (const sourceField of sourceTable.fields) {
      if (!sourceField.is_fk) continue
      const targetTable =
        tableLookup.get(normalizeLookupKey(sourceField.fk_ref_table)) ??
        tableLookup.get(normalizeLookupKey(sourceField.fk_ref_table_en)) ??
        null
      if (!targetTable) continue
      const targetField = findFieldByRef(targetTable, sourceField.fk_ref_field, sourceField.fk_ref_field_en)
      sourceField.fk_ref_table_en = targetTable.name_en
      sourceField.fk_ref_field_en = targetField?.name_en ?? null
    }
  }

  return {
    tables: nextTables,
    issues
  }
}

interface BuildMySqlDDLOptions {
  databaseName?: string | null
  includeDatabaseBootstrap?: boolean
  includeSeedData?: boolean
}

const escapeCsvCell = (value: string | null | undefined) => {
  const text = String(value ?? '')
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function buildBilingualNameMappingCsv(tables: LogicalTable[]): string {
  const header = ['term_type', 'zh_term', 'en_term', 'usage_count', 'example_contexts']
  const lines: string[] = [header.join(',')]
  const mapping = new Map<
    string,
    {
      zh: string
      usage: number
      contexts: Set<string>
      termTypes: Set<'table' | 'field'>
      enUsage: Map<string, number>
    }
  >()

  const addTerm = (
    termType: 'table' | 'field',
    zh: string,
    en: string,
    context: string
  ) => {
    const zhTerm = String(zh ?? '').trim()
    const enTerm = String(en ?? '').trim()
    if (!zhTerm || !enTerm) return
    const key = zhTerm
    const current = mapping.get(key)
    if (current) {
      current.usage += 1
      current.contexts.add(context)
      current.termTypes.add(termType)
      current.enUsage.set(enTerm, (current.enUsage.get(enTerm) ?? 0) + 1)
      return
    }
    mapping.set(key, {
      zh: zhTerm,
      usage: 1,
      contexts: new Set([context]),
      termTypes: new Set([termType]),
      enUsage: new Map([[enTerm, 1]])
    })
  }

  for (const table of tables) {
    const tableEn = sanitizeIdentifier(table.name_en || suggestEnglishIdentifier(table.name, 'table'), 'table')
    addTerm('table', table.name, tableEn, table.name)

    const sortedFields = [...table.fields].sort((a, b) => a.order_index - b.order_index)
    for (const field of sortedFields) {
      const fieldEn = sanitizeIdentifier(field.name_en || suggestEnglishIdentifier(field.name, 'field'), 'field')
      addTerm('field', field.name, fieldEn, `${table.name}.${field.name}`)
    }
  }

  const rows = [...mapping.values()].sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant'))

  for (const row of rows) {
    const preferredEn = [...row.enUsage.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1]
      if (a[0].length !== b[0].length) return a[0].length - b[0].length
      return a[0].localeCompare(b[0])
    })[0]?.[0] ?? ''
    const termType =
      row.termTypes.size === 1 ? ([...row.termTypes][0] as 'table' | 'field') : 'mixed'
    const contexts = [...row.contexts].slice(0, 6).join(' | ')
    lines.push(
      [termType, row.zh, preferredEn, String(row.usage), contexts]
        .map(escapeCsvCell)
        .join(',')
    )
  }

  return `${lines.join('\n')}\n`
}

const getTypeFamily = (dataType: string | null | undefined) => {
  const normalized = sanitizeDataType(dataType) ?? 'VARCHAR(255)'
  return normalized.replace(/\(.*/, '')
}

const escapeSqlString = (value: string) => value.replace(/'/g, "''")

const buildSeedLiteralByType = (typeFamily: string, token: string, numericSeed: number) => {
  switch (typeFamily) {
    case 'INT':
    case 'BIGINT':
    case 'SMALLINT':
    case 'TINYINT':
    case 'MEDIUMINT':
    case 'DECIMAL':
    case 'NUMERIC':
    case 'FLOAT':
    case 'DOUBLE':
      return String(numericSeed)
    case 'BOOLEAN':
    case 'BOOL':
    case 'BIT':
      return '0'
    case 'DATE':
      return "'2026-01-01'"
    case 'DATETIME':
    case 'TIMESTAMP':
      return "'2026-01-01 00:00:00'"
    case 'TIME':
      return "'00:00:00'"
    default:
      return `'${escapeSqlString(token)}'`
  }
}

const buildSeedInserts = (tables: LogicalTable[]) => {
  const normalizedTables = tables.map((table) => ({
    tableName: sanitizeIdentifier(table.name_en || suggestEnglishIdentifier(table.name, 'table'), 'table'),
    fields: [...table.fields]
      .sort((a, b) => a.order_index - b.order_index)
      .map((field) => ({
        ...field,
        fieldName: sanitizeIdentifier(field.name_en || suggestEnglishIdentifier(field.name, 'field'), 'field'),
        typeFamily: getTypeFamily(field.data_type),
        refTable: field.fk_ref_table_en ? sanitizeIdentifier(field.fk_ref_table_en, 'table') : null,
        refField: field.fk_ref_field_en ? sanitizeIdentifier(field.fk_ref_field_en, 'field') : null
      }))
  }))

  const pkSeedMap = new Map<string, string>()
  normalizedTables.forEach((table, tableIndex) => {
    table.fields
      .filter((field) => field.is_pk)
      .forEach((field, pkIndex) => {
        const key = `${table.tableName}.${field.fieldName}`
        const token = `${table.tableName}_${field.fieldName}_${pkIndex + 1}`
        pkSeedMap.set(key, buildSeedLiteralByType(field.typeFamily, token, tableIndex + 1))
      })
  })

  const insertStatements: string[] = []

  for (const table of normalizedTables) {
    if (table.fields.length === 0) continue

    const columns = table.fields.map((field) => `\`${field.fieldName}\``)
    const values = table.fields.map((field, fieldIndex) => {
      if (field.is_fk && field.refTable && field.refField) {
        const referenced = pkSeedMap.get(`${field.refTable}.${field.refField}`)
        if (referenced) return referenced
      }

      if (field.is_pk) {
        const seed = pkSeedMap.get(`${table.tableName}.${field.fieldName}`)
        if (seed) return seed
      }

      const token = `${table.tableName}_${field.fieldName}_${fieldIndex + 1}`
      return buildSeedLiteralByType(field.typeFamily, token, fieldIndex + 1)
    })

    insertStatements.push(
      `INSERT INTO \`${table.tableName}\` (${columns.join(', ')}) VALUES (${values.join(', ')});`
    )
  }

  return insertStatements
}

export function buildMySqlDDL(tables: LogicalTable[], options: BuildMySqlDDLOptions = {}): string {
  const statements: string[] = []
  const includeDatabaseBootstrap = options.includeDatabaseBootstrap !== false
  const includeSeedData = options.includeSeedData === true
  const databaseName = sanitizeIdentifier(options.databaseName || 'logical_model', 'db')

  if (includeDatabaseBootstrap) {
    statements.push(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
    statements.push(`USE \`${databaseName}\`;`)
  }

  for (const table of tables) {
    const tableEn = sanitizeIdentifier(table.name_en || suggestEnglishIdentifier(table.name, 'table'), 'table')
    const sortedFields = [...table.fields].sort((a, b) => a.order_index - b.order_index)

    const columnLines = sortedFields.map((field) => {
      const fieldEn = sanitizeIdentifier(field.name_en || suggestEnglishIdentifier(field.name, 'field'), 'field')
      const type = sanitizeDataType(field.data_type) ?? 'VARCHAR(255)'
      const parts = [`\`${fieldEn}\``, type]
      parts.push(field.is_not_null || field.is_pk ? 'NOT NULL' : 'NULL')

      if (field.default_value) {
        const raw = field.default_value.trim()
        parts.push(`DEFAULT ${shouldTreatDefaultAsRaw(raw) ? raw : quoteDefaultLiteral(raw)}`)
      }

      return `  ${parts.join(' ')}`
    })

    const pkFields = sortedFields
      .filter((field) => field.is_pk)
      .map((field) => `\`${sanitizeIdentifier(field.name_en || suggestEnglishIdentifier(field.name, 'field'), 'field')}\``)

    if (pkFields.length > 0) {
      columnLines.push(`  PRIMARY KEY (${pkFields.join(', ')})`)
    }

    const fkLines = sortedFields
      .filter((field) => field.is_fk && field.fk_ref_table_en && field.fk_ref_field_en)
      .map((field) => {
        const sourceField = sanitizeIdentifier(field.name_en || suggestEnglishIdentifier(field.name, 'field'), 'field')
        const targetTable = sanitizeIdentifier(field.fk_ref_table_en!, 'table')
        const targetField = sanitizeIdentifier(field.fk_ref_field_en!, 'field')
        const constraintName = sanitizeIdentifier(`fk_${tableEn}_${sourceField}`, 'fk')
        return `  CONSTRAINT \`${constraintName}\` FOREIGN KEY (\`${sourceField}\`) REFERENCES \`${targetTable}\` (\`${targetField}\`)`
      })

    const allLines = [...columnLines, ...fkLines]
    const createStatement = `CREATE TABLE \`${tableEn}\` (\n${allLines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    statements.push(createStatement)
  }

  if (includeSeedData) {
    const seedStatements = buildSeedInserts(tables)
    if (seedStatements.length > 0) {
      statements.push('SET FOREIGN_KEY_CHECKS = 0;')
      statements.push(...seedStatements)
      statements.push('SET FOREIGN_KEY_CHECKS = 1;')
    }
  }

  const sql = `${statements.join('\n\n')}\n`
  if (hasChinese(sql)) {
    throw new Error('SQL 內容仍含有中文，請先修正英文命名與預設值。')
  }

  return sql
}
