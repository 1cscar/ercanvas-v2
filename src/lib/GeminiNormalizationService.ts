import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { LogicalTable } from '../types'

const DEFAULT_MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || 'gemini-2.5-flash'
const API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim()
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 180_000

export interface GeminiNormalizedField {
  name: string
  isPK: boolean
  isFK: boolean
  refTable: string | null
  refField: string | null
  dataType: string | null
  nullable: boolean | null
}

export interface GeminiNormalizedTable {
  name: string
  fields: GeminiNormalizedField[]
}

export interface GeminiNormalizationResult {
  domain: string
  normalizedTables: GeminiNormalizedTable[]
  notes: string[]
}

const sanitizeText = (value: unknown, fallback = '') => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const extractJSON = (text: string): unknown => {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1])
    } catch {
      // fall through
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0])
    } catch {
      // fall through
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const blobToBase64 = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('PDF 轉 Base64 失敗。'))
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : ''
      const base64 = raw.split(',')[1] ?? ''
      if (!base64) {
        reject(new Error('PDF Base64 內容為空。'))
        return
      }
      resolve(base64)
    }
    reader.readAsDataURL(blob)
  })

export async function exportElementToPdf(element: HTMLElement): Promise<{ blob: Blob; base64: string }> {
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight
  })

  const imageData = canvas.toDataURL('image/png', 1)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  const margin = 20
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const availableWidth = pageWidth - margin * 2
  const availableHeight = pageHeight - margin * 2

  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height)
  const renderWidth = canvas.width * scale
  const renderHeight = canvas.height * scale
  const x = (pageWidth - renderWidth) / 2
  const y = (pageHeight - renderHeight) / 2

  pdf.addImage(imageData, 'PNG', x, y, renderWidth, renderHeight, undefined, 'FAST')

  const blob = pdf.output('blob') as Blob
  const base64 = await blobToBase64(blob)
  return { blob, base64 }
}

export function downloadPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function buildNormalizationPrompt(sourceTables: LogicalTable[]): string {
  const sourceSummary = sourceTables
    .map((table) => {
      const columns = table.fields.map((field) => field.name).join('、')
      return `- ${table.name}（欄位：${columns || '無'}）`
    })
    .join('\n')

  return `你是資深資料庫正規化顧問。你會收到一份邏輯資料模型 PDF 圖。

請完成：
1. 判斷領域與業務語意
2. 依照真正順序做 1NF → 2NF → 3NF
3. 保留中文命名與原始領域語意
4. 拆出主資料、交易/場次、明細或關聯表
5. 指出必要 FK

目前畫布上的原始表摘要（供比對，不可忽略 PDF）：
${sourceSummary || '- 無'}

只輸出 JSON，禁止 Markdown、禁止多餘文字：
{
  "domain": "string",
  "normalizedTables": [
    {
      "name": "string",
      "fields": [
        {
          "name": "string",
          "isPK": true,
          "isFK": false,
          "refTable": null,
          "refField": null,
          "dataType": "string|null",
          "nullable": false
        }
      ]
    }
  ],
  "notes": ["string"]
}

約束：
- 表名與欄位名使用繁體中文
- 不要輸出通用抽象六表（Parties, Party_Roles...）
- 不要把不同場次拆成多張結構重複的表，應用類型表 + 事實表
- 每張表至少一個主鍵欄位`
}

async function callGemini(prompt: string, pdfBase64: string): Promise<string> {
  if (!API_KEY) {
    throw new Error('缺少 Gemini API Key，請設定 `VITE_GEMINI_API_KEY`。')
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  const endpoint = `${API_BASE}/${DEFAULT_MODEL}:generateContent?key=${API_KEY}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: pdfBase64
                }
              },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          responseMimeType: 'application/json'
        }
      })
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Gemini API 回應失敗 (${response.status})：${body.slice(0, 320)}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const candidates = Array.isArray(data.candidates) ? (data.candidates as Record<string, unknown>[]) : []
    const firstCandidate = candidates[0] ?? {}
    const content = (firstCandidate.content ?? {}) as Record<string, unknown>
    const parts = Array.isArray(content.parts) ? (content.parts as Record<string, unknown>[]) : []
    const text = parts
      .map((part) => sanitizeText(part.text))
      .filter(Boolean)
      .join('\n')

    if (!text) {
      throw new Error('Gemini 未回傳可解析文字。')
    }

    return text
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Gemini 分析逾時，請稍後再試。')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

export async function normalizeLogicalDiagramByGeminiPDF(
  pdfBase64: string,
  sourceTables: LogicalTable[]
): Promise<GeminiNormalizationResult> {
  const prompt = buildNormalizationPrompt(sourceTables)
  const raw = await callGemini(prompt, pdfBase64)
  const parsed = extractJSON(raw) as Record<string, unknown> | null

  if (!parsed || !Array.isArray(parsed.normalizedTables)) {
    throw new Error(`Gemini 回傳格式無法解析。\n回應片段：${raw.slice(0, 320)}`)
  }

  const normalizedTables = (parsed.normalizedTables as unknown[])
    .map((table, tableIndex): GeminiNormalizedTable | null => {
      if (typeof table !== 'object' || table === null) return null
      const source = table as Record<string, unknown>
      const name = sanitizeText(source.name, `正規化資料表${tableIndex + 1}`)
      const sourceFields = Array.isArray(source.fields) ? source.fields : []
      const fields = sourceFields
        .map((field, fieldIndex): GeminiNormalizedField | null => {
          if (typeof field !== 'object' || field === null) return null
          const fieldSource = field as Record<string, unknown>
          const fieldName = sanitizeText(fieldSource.name, `欄位${fieldIndex + 1}`)
          return {
            name: fieldName,
            isPK: Boolean(fieldSource.isPK ?? fieldSource.isPrimaryKey),
            isFK: Boolean(fieldSource.isFK ?? fieldSource.isForeignKey),
            refTable:
              fieldSource.refTable === null || fieldSource.refTable === undefined
                ? null
                : sanitizeText(fieldSource.refTable),
            refField:
              fieldSource.refField === null || fieldSource.refField === undefined
                ? null
                : sanitizeText(fieldSource.refField),
            dataType:
              fieldSource.dataType === null || fieldSource.dataType === undefined
                ? null
                : sanitizeText(fieldSource.dataType),
            nullable:
              typeof fieldSource.nullable === 'boolean' ? fieldSource.nullable : null
          }
        })
        .filter((field): field is GeminiNormalizedField => field !== null)

      if (fields.length === 0) return null
      if (!fields.some((field) => field.isPK)) {
        fields[0] = { ...fields[0], isPK: true }
      }

      return { name, fields }
    })
    .filter((table): table is GeminiNormalizedTable => table !== null)

  if (normalizedTables.length === 0) {
    throw new Error('Gemini 沒有回傳任何可用的正規化資料表。')
  }

  return {
    domain: sanitizeText(parsed.domain, '未提供'),
    normalizedTables,
    notes: Array.isArray(parsed.notes)
      ? parsed.notes
          .map((note) => sanitizeText(note))
          .filter(Boolean)
      : []
  }
}

export function geminiTablesToLogicalTables(
  normalizedTables: GeminiNormalizedTable[],
  diagramId: string
): LogicalTable[] {
  const tableNameSet = new Set(normalizedTables.map((table) => table.name))

  return normalizedTables.map((table, tableIndex) => {
    const tableId = crypto.randomUUID()
    const fields = table.fields.map((field, fieldIndex) => {
      const hasRefTable = field.refTable ? tableNameSet.has(field.refTable) : false
      return {
        id: crypto.randomUUID(),
        table_id: tableId,
        name: field.name,
        order_index: fieldIndex,
        is_pk: field.isPK,
        is_fk: field.isFK || hasRefTable,
        is_multi_value: false,
        is_composite: false,
        composite_children: [],
        partial_dep_on: [],
        transitive_dep_via: null,
        fk_ref_table: hasRefTable ? field.refTable : null,
        fk_ref_field: hasRefTable ? field.refField || null : null,
        data_type: field.dataType,
        is_not_null: field.isPK || field.nullable === false,
        default_value: null
      }
    })

    const sortedFields = [
      ...fields.filter((field) => field.is_pk),
      ...fields.filter((field) => !field.is_pk)
    ].map((field, index) => ({ ...field, order_index: index }))

    return {
      id: tableId,
      diagram_id: diagramId,
      name: table.name,
      x: 120 + (tableIndex % 3) * 420,
      y: 120 + Math.floor(tableIndex / 3) * 260,
      fields: sortedFields
    }
  })
}
