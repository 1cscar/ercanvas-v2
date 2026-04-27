const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 180_000
const MAX_SOURCE_TABLES = 8
const MAX_SOURCE_FIELDS_PER_TABLE = 10

const sanitizeText = (value, fallback = '') => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const extractJSON = (text) => {
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

const normalizeSourceTables = (input) => {
  if (!Array.isArray(input)) return []
  return input
    .map((table) => {
      if (!table || typeof table !== 'object') return null
      const name = sanitizeText(table.name)
      const fields = Array.isArray(table.fields)
        ? table.fields
            .map((field) => sanitizeText(field))
            .filter(Boolean)
        : []
      if (!name) return null
      return { name, fields }
    })
    .filter(Boolean)
}

const buildNormalizationPrompt = (sourceTables) => {
  const compactTables = sourceTables.slice(0, MAX_SOURCE_TABLES)
  const sourceSummary = compactTables
    .map((table) => {
      const columns = table.fields.slice(0, MAX_SOURCE_FIELDS_PER_TABLE).join('、')
      const more =
        table.fields.length > MAX_SOURCE_FIELDS_PER_TABLE
          ? `…(+${table.fields.length - MAX_SOURCE_FIELDS_PER_TABLE})`
          : ''
      return `- ${table.name}（${columns || '無'}${more}）`
    })
    .join('\n')

  return `你是資料庫正規化助手。請讀取附件 PDF（邏輯資料模型/ER 圖），輸出可落地的 3NF 中文表設計。

要求：
- 依 1NF→2NF→3NF 正規化
- 保留原始領域語意與中文命名
- 拆分重複欄位與多對多關係（關聯表）
- 每張表至少一個 PK，FK 要指出 refTable/refField
- 不要輸出通用抽象六表（Parties 等）

畫布摘要（僅輔助）：
${sourceSummary || '- 無'}

僅輸出 JSON：
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
}`
}

const createErrorResponse = (res, status, error) => {
  return res.status(status).json({ error })
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb'
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return createErrorResponse(res, 405, 'Method Not Allowed')
  }

  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite'

  if (!apiKey) {
    return createErrorResponse(res, 500, 'Server env `GEMINI_API_KEY` is missing.')
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return createErrorResponse(res, 400, 'Invalid JSON body.')
    }
  }
  const pdfBase64 = sanitizeText(body.pdfBase64)
  const sourceTables = normalizeSourceTables(body.sourceTables)

  if (!pdfBase64) {
    return createErrorResponse(res, 400, 'pdfBase64 is required.')
  }

  const prompt = buildNormalizationPrompt(sourceTables)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const callGemini = async (targetModel) => {
    const endpoint = `${API_BASE}/${targetModel}:generateContent?key=${apiKey}`
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
          maxOutputTokens: 3072,
          responseMimeType: 'application/json'
        }
      })
    })

    const rawBody = await response.text().catch(() => '')
    return { targetModel, status: response.status, ok: response.ok, rawBody }
  }

  const parseResult = (rawBody) => {
    let json = null
    try {
      json = JSON.parse(rawBody)
    } catch {
      json = null
    }

    const candidates = Array.isArray(json?.candidates) ? json.candidates : []
    const firstCandidate = candidates[0] || {}
    const parts = Array.isArray(firstCandidate?.content?.parts)
      ? firstCandidate.content.parts
      : []
    const rawText = parts
      .map((part) => sanitizeText(part?.text))
      .filter(Boolean)
      .join('\n')

    if (!rawText) {
      return { parsed: null, reason: 'Gemini returned empty response.' }
    }

    const parsed = extractJSON(rawText)
    if (!parsed || !Array.isArray(parsed.normalizedTables)) {
      return { parsed: null, reason: `Gemini JSON parse failed: ${rawText.slice(0, 300)}` }
    }

    return { parsed, reason: '' }
  }

  try {
    let attempt = await callGemini(model)
    let usedFallback = false

    if (!attempt.ok && attempt.status === 429 && fallbackModel && fallbackModel !== model) {
      usedFallback = true
      attempt = await callGemini(fallbackModel)
    }

    if (!attempt.ok) {
      const shortMsg =
        attempt.status === 429
          ? `Gemini 配額不足（429）。${usedFallback ? '已自動改用備援模型仍超限。' : ''}請稍後再試或升級配額。`
          : `Gemini API failed (${attempt.status}): ${attempt.rawBody.slice(0, 300)}`
      return createErrorResponse(res, attempt.status, shortMsg)
    }

    const parsedResult = parseResult(attempt.rawBody)
    if (!parsedResult.parsed) {
      return createErrorResponse(res, 502, parsedResult.reason)
    }

    return res.status(200).json({
      result: parsedResult.parsed,
      meta: {
        model: attempt.targetModel,
        fallbackUsed: usedFallback
      }
    })
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Gemini request timeout.'
        : error instanceof Error
          ? error.message
          : String(error)
    return createErrorResponse(res, 500, message)
  } finally {
    clearTimeout(timer)
  }
}
