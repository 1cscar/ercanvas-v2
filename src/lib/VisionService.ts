const VISION_MODEL = 'gemma4'
const OLLAMA_BASES = ['http://127.0.0.1:11434', 'http://localhost:11434'] as const
const TIMEOUT_MS = 180000

export interface ERVisionResult {
  entities: Array<{ id: string; name: string }>
  attributes: Array<{ id: string; name: string; entityId: string; isPrimaryKey: boolean }>
  relationships: Array<{ id: string; name: string; connectedEntityIds: string[] }>
}

export interface LogicalVisionResult {
  tables: Array<{
    name: string
    fields: Array<{ name: string; isPK: boolean; isFK: boolean }>
  }>
  relationships: Array<{ fromTable: string; toTable: string }>
}

const sanitizeText = (value: unknown, fallback = '') => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const splitFieldCandidates = (raw: string) =>
  raw
    .split(/[、,，;；|／/\\\n\r\t]+/)
    .map((item) => item.trim())
    .filter(Boolean)

async function callOllamaVision(prompt: string, imageBase64: string): Promise<string> {
  const base64Data = imageBase64.replace(/^data:image\/[a-z+]+;base64,/, '')
  const errors: string[] = []

  for (const baseUrl of OLLAMA_BASES) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: VISION_MODEL,
          stream: false,
          messages: [{ role: 'user', content: prompt, images: [base64Data] }]
        })
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        errors.push(`${baseUrl} -> HTTP ${response.status} ${text.slice(0, 120)}`)
        continue
      }

      const data = await response.json()
      return (data.message?.content ?? '') as string
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${baseUrl} -> ${message}`)
    } finally {
      window.clearTimeout(timer)
    }
  }

  throw new Error(
    '無法連線到本機 Ollama（圖片識別）。\n' +
      '1. 先確認終端機正在執行：OLLAMA_ORIGINS=* ollama serve\n' +
      `2. 確認模型存在：ollama pull ${VISION_MODEL}\n` +
      '3. 重新整理頁面後再試（Safari 請用 Cmd+Shift+R）\n\n' +
      `偵錯資訊：\n${errors.join('\n')}`
  )
}

function extractJSON(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]) } catch { /* fall through */ }
  }
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) {
    try { return JSON.parse(obj[0]) } catch { /* fall through */ }
  }
  try { return JSON.parse(text) } catch { return null }
}

export async function parseERDiagramImage(imageBase64: string): Promise<ERVisionResult> {
  const prompt = `你會看到一張 ER 圖（實體-關係圖）圖片，可能是中文標示。

請擷取：
1. entities：矩形/方框（實體）
2. attributes：橢圓（屬性），要判斷屬於哪個實體；若有底線或主鍵語意，isPrimaryKey=true
3. relationships：菱形（關係），列出連到哪些實體

文字請盡量保留原圖內容，不要翻譯。
只輸出合法 JSON，不要任何額外說明：
{
  "entities": [{"id":"e1","name":"EntityName"}],
  "attributes": [{"id":"a1","name":"AttrName","entityId":"e1","isPrimaryKey":false}],
  "relationships": [{"id":"r1","name":"RelName","connectedEntityIds":["e1","e2"]}]
}`

  const raw = await callOllamaVision(prompt, imageBase64)
  const parsed = extractJSON(raw) as Record<string, unknown> | null

  if (!parsed || !Array.isArray(parsed['entities'])) {
    throw new Error(`AI 無法解析 ER 圖結構。\n回應：${raw.slice(0, 300)}`)
  }

  const entities = ((parsed['entities'] ?? []) as unknown[]).map((item: unknown, index: number) => {
    const entity = item as Record<string, unknown>
    return {
      id: sanitizeText(entity['id'], `e${index + 1}`),
      name: sanitizeText(entity['name'], `實體${index + 1}`)
    }
  })

  const entityIdSet = new Set(entities.map((entity) => entity.id))

  const attributes = ((parsed['attributes'] ?? []) as unknown[]).map((item: unknown, index: number) => {
    const attribute = item as Record<string, unknown>
    const attributeEntityId = sanitizeText(attribute['entityId'])
    return {
      id: sanitizeText(attribute['id'], `a${index + 1}`),
      name: sanitizeText(attribute['name'], `屬性${index + 1}`),
      entityId: entityIdSet.has(attributeEntityId) ? attributeEntityId : entities[0]?.id ?? '',
      isPrimaryKey: Boolean(attribute['isPrimaryKey'] ?? attribute['isPK'])
    }
  })

  const relationships = ((parsed['relationships'] ?? []) as unknown[]).map((item: unknown, index: number) => {
    const relationship = item as Record<string, unknown>
    return {
      id: sanitizeText(relationship['id'], `r${index + 1}`),
      name: sanitizeText(relationship['name'], `關係${index + 1}`),
      connectedEntityIds: Array.isArray(relationship['connectedEntityIds'])
        ? (relationship['connectedEntityIds'] as unknown[])
            .map((entityId) => sanitizeText(entityId))
            .filter((entityId) => entityIdSet.has(entityId))
        : []
    }
  })

  return { entities, attributes, relationships }
}

export async function parseLogicalDiagramImage(imageBase64: string): Promise<LogicalVisionResult> {
  const prompt = `你會看到一張資料庫邏輯圖（邏輯模型 / relational schema）圖片，可能是中文表名與欄位名。

任務：
1. 擷取所有資料表（tables）
2. 每張表列出欄位（fields），保留原文字
3. 盡量判斷 PK/FK（第一欄通常是 PK）
4. 根據箭頭或連線找出資料表關聯（relationships）

只輸出合法 JSON，不要多餘文字：
{
  "tables": [
    {
      "name": "TableName",
      "fields": [
        {"name": "columnName","isPK":true,"isFK":false}
      ]
    }
  ],
  "relationships": [
    {"fromTable":"Table1","toTable":"Table2"}
  ]
}`

  const raw = await callOllamaVision(prompt, imageBase64)
  const parsed = extractJSON(raw) as Record<string, unknown> | null

  if (!parsed || !Array.isArray(parsed['tables'])) {
    throw new Error(`AI 無法解析邏輯圖結構。\n回應：${raw.slice(0, 300)}`)
  }

  const tables = ((parsed['tables'] ?? []) as unknown[]).map((item: unknown, tableIndex: number) => {
    const table = item as Record<string, unknown>
    const rawFields = Array.isArray(table['fields']) ? (table['fields'] as unknown[]) : []
    const parsedFields = rawFields.flatMap((field, fieldIndex) => {
      if (typeof field === 'string') {
        const parts = splitFieldCandidates(field)
        if (parts.length === 0) return []
        return parts.map((part, partIndex) => ({
          name: sanitizeText(part, `field${fieldIndex + 1}_${partIndex + 1}`),
          isPK: fieldIndex === 0 && partIndex === 0,
          isFK: false
        }))
      }

      const fieldObj = field as Record<string, unknown>
      const rawName = sanitizeText(fieldObj['name'])
      const fallback = `field${fieldIndex + 1}`
      const parts = rawName ? splitFieldCandidates(rawName) : [fallback]
      if (parts.length === 0) parts.push(fallback)

      return parts.map((part, partIndex) => ({
        name: sanitizeText(part, `${fallback}_${partIndex + 1}`),
        isPK: Boolean(
          fieldObj['isPK'] ??
            fieldObj['isPrimaryKey'] ??
            fieldObj['pk'] ??
            (fieldIndex === 0 && partIndex === 0)
        ),
        isFK: Boolean(fieldObj['isFK'] ?? fieldObj['isForeignKey'] ?? fieldObj['fk'])
      }))
    })

    if (parsedFields.length > 0 && !parsedFields.some((field) => field.isPK)) {
      parsedFields[0] = { ...parsedFields[0], isPK: true }
    }

    return {
      name: sanitizeText(table['name'], `資料表${tableIndex + 1}`),
      fields: parsedFields
    }
  })

  const relationships = ((parsed['relationships'] ?? []) as unknown[])
    .map((item: unknown) => {
      if (typeof item === 'string') {
        const parts = item.split(/->|→|=>|=/).map((part) => part.trim())
        if (parts.length >= 2) {
          return {
            fromTable: sanitizeText(parts[0]),
            toTable: sanitizeText(parts[1])
          }
        }
        return null
      }

      const relationship = item as Record<string, unknown>
      return {
        fromTable: sanitizeText(relationship['fromTable']),
        toTable: sanitizeText(relationship['toTable'])
      }
    })
    .filter(
      (
        relationship
      ): relationship is {
        fromTable: string
        toTable: string
      } => relationship !== null && Boolean(relationship.fromTable) && Boolean(relationship.toTable)
    )

  return { tables, relationships }
}
