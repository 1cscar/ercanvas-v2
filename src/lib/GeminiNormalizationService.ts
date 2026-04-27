import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { LogicalTable } from '../types'

const API_ENDPOINT = '/api/gemini-normalize'
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
  const parsed =
    typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : null
  if (!parsed || !Array.isArray(parsed.normalizedTables)) {
    throw new Error('後端代理回傳格式無法解析。')
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
            nullable: typeof fieldSource.nullable === 'boolean' ? fieldSource.nullable : null
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

export async function normalizeLogicalDiagramByGeminiPDF(
  pdfBase64: string,
  sourceTables: LogicalTable[]
): Promise<GeminiNormalizationResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

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
