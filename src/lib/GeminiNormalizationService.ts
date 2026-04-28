import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { LogicalTable } from '../types'
import { GeminiNormalizationResultSchema } from './geminiSchemas'
import { GEMINI_TIMEOUT_MS } from '../config/limits'

const API_ENDPOINT = '/api/gemini-normalize'

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
    scale: 1,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight
  })

  const imageData = canvas.toDataURL('image/jpeg', 0.72)
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

  pdf.addImage(imageData, 'JPEG', x, y, renderWidth, renderHeight, undefined, 'FAST')

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

interface ProxyPayload {
  result?: unknown
  error?: string
}

function normalizeResponse(result: unknown): GeminiNormalizationResult {
  const parseResult = GeminiNormalizationResultSchema.safeParse(result)
  if (!parseResult.success) {
    throw new Error(
      `Gemini 回傳格式驗證失敗：${parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    )
  }

  const parsed = parseResult.data

  const normalizedTables = parsed.normalizedTables
    .map((table, tableIndex): GeminiNormalizedTable | null => {
      const name = sanitizeText(table.name, `正規化資料表${tableIndex + 1}`)

      const fields = table.fields
        .map((field, fieldIndex): GeminiNormalizedField | null => {
          const fieldName = sanitizeText(field.name, `欄位${fieldIndex + 1}`)
          if (!fieldName) return null
          return {
            name: fieldName,
            isPK: Boolean(field.isPK ?? field.isPrimaryKey),
            isFK: Boolean(field.isFK ?? field.isForeignKey),
            refTable: field.refTable == null ? null : sanitizeText(field.refTable),
            refField: field.refField == null ? null : sanitizeText(field.refField),
            dataType: field.dataType == null ? null : sanitizeText(field.dataType),
            nullable: typeof field.nullable === 'boolean' ? field.nullable : null
          }
        })
        .filter((field): field is GeminiNormalizedField => field !== null)

      if (fields.length === 0) return null

      if (!fields.some((field) => field.isPK)) {
        throw new Error(
          `Gemini 回傳的資料表 ${name} 沒有標記主鍵，請重試`
        )
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
    notes: parsed.notes.map((note) => sanitizeText(note)).filter(Boolean)
  }
}

export async function normalizeLogicalDiagramByGeminiPDF(
  pdfBase64: string,
  sourceTables: LogicalTable[]
): Promise<GeminiNormalizationResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        pdfBase64,
        sourceTables: sourceTables.map((table) => ({
          name: table.name,
          fields: table.fields.map((field) => field.name)
        }))
      })
    })

    const payload = (await response.json().catch(() => ({}))) as ProxyPayload
    if (!response.ok) {
      throw new Error(payload.error || `後端代理呼叫失敗 (${response.status})`)
    }

    return normalizeResponse(payload.result)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('後端代理逾時，請稍後再試。')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
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
      if (field.isFK && field.refTable && !hasRefTable) {
        console.warn(
          `[geminiTablesToLogicalTables] ${table.name}.${field.name}: isFK=true 但 refTable "${field.refTable}" 不在資料表集合中，FK 參照將被清除`
        )
      }
      return {
        id: crypto.randomUUID(),
        table_id: tableId,
        name: field.name,
        name_en: null,
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
        fk_ref_table_en: null,
        fk_ref_field_en: null,
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
      name_en: null,
      x: 120 + tableIndex * 420,
      y: 120,
      fields: sortedFields
    }
  })
}
