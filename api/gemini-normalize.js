const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 180_000

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
  const sourceSummary = sourceTables
    .map((table) => {
      const columns = table.fields.join('、')
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
  const endpoint = `${API_BASE}/${model}:generateContent?key=${apiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

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
      const errorText = await response.text().catch(() => '')
      return createErrorResponse(
        res,
        response.status,
        `Gemini API failed: ${errorText.slice(0, 400)}`
      )
    }

    const data = await response.json()
    const candidates = Array.isArray(data?.candidates) ? data.candidates : []
    const firstCandidate = candidates[0] || {}
    const parts = Array.isArray(firstCandidate?.content?.parts)
      ? firstCandidate.content.parts
      : []
    const rawText = parts
      .map((part) => sanitizeText(part?.text))
      .filter(Boolean)
      .join('\n')

    if (!rawText) {
      return createErrorResponse(res, 502, 'Gemini returned empty response.')
    }

    const parsed = extractJSON(rawText)
    if (!parsed || !Array.isArray(parsed.normalizedTables)) {
      return createErrorResponse(res, 502, `Gemini JSON parse failed: ${rawText.slice(0, 400)}`)
    }

    return res.status(200).json({ result: parsed })
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
