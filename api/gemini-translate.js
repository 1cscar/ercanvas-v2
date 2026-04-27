const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 60_000

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
      // ignore
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0])
    } catch {
      // ignore
    }
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const normalizeTables = (input) => {
  if (!Array.isArray(input)) return []
  return input
    .map((table) => {
      if (!table || typeof table !== 'object') return null
      const name = sanitizeText(table.name)
      const fields = Array.isArray(table.fields)
        ? table.fields
            .map((field) => {
              if (!field || typeof field !== 'object') return null
              const fieldName = sanitizeText(field.name)
              if (!fieldName) return null
              return {
                name: fieldName,
                isPK: Boolean(field.isPK),
                isFK: Boolean(field.isFK),
                fkRefTable: sanitizeText(field.fkRefTable) || null,
                fkRefField: sanitizeText(field.fkRefField) || null
              }
            })
            .filter(Boolean)
        : []
      if (!name) return null
      return { name, fields }
    })
    .filter(Boolean)
}

const buildPrompt = (tables) => `# Role
你是一位資深的資料庫架構師，擅長根據業務邏輯設計符合 MySQL 業界標準的 Database Schema。

# Task
請將我提供的中文資料表名稱與欄位名稱轉換為專業的英文命名。

# Constraints & Rules
1. 命名格式：統一使用小寫蛇形命名法（lower_case_with_underscores）。
2. 單數準則：資料表名稱必須使用單數名詞（例如 user 而非 users）。
3. 主鍵與外鍵：
   - 每張表的主鍵統一叫 id。
   - 外鍵統一叫 [關聯表名]_id。
   - 同一組關聯中，外鍵對應到的主鍵名稱翻譯必須完全一致（例如都用 id，不可混用 identifier / uuid / key）。
4. 布林值命名：涉及「是否」、「開關」狀態時，使用 is_ / has_ / can_ 作為前綴。
5. 時間命名：
   - 建立時間用 created_at
   - 更新時間用 updated_at
   - 特定日期用 [動作]_date（例如 hired_date）
6. 精簡原則：
   - 移除冗餘前綴。若欄位在 driver 表中，使用 name 而非 driver_name。
   - 避免 MySQL 保留字（例如 order, group, rank）。若必要請加修飾詞。
7. 專業術語：優先使用產業慣用術語（例如 quantity 用 qty 或 amount，狀態用 status）。

補充要求：
- 盡量避免台式英文直譯，優先自然、可維護、可預測命名。
- 僅輸出英文 snake_case 結果，不要輸出中文拼音。
- 不要輸出 SQL、不要輸出資料型別、不要解釋。

輸出限制（API 專用）：
- 雖然人類閱讀可用 Markdown 表格，但你現在必須只輸出 JSON，且格式嚴格如下。

輸出格式：
{
  "tables": [
    {
      "name": "原始中文表名",
      "nameEn": "english_table_name",
      "fields": [
        {
          "name": "原始中文欄位名",
          "nameEn": "english_field_name"
        }
      ]
    }
  ]
}

來源資料：
${JSON.stringify({ tables }, null, 2)}`

const createErrorResponse = (res, status, error) => res.status(status).json({ error })

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

  const tables = normalizeTables(body.tables)
  if (tables.length === 0) {
    return createErrorResponse(res, 400, '`tables` is required.')
  }

  const prompt = buildPrompt(tables)
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
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0,
          topP: 0.8,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      })
    })
    const rawBody = await response.text().catch(() => '')
    return { targetModel, status: response.status, ok: response.ok, rawBody }
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
          ? `Gemini 配額不足（429）。${usedFallback ? '已嘗試備援模型仍超限。' : ''}`
          : `Gemini API failed (${attempt.status}): ${attempt.rawBody.slice(0, 300)}`
      return createErrorResponse(res, attempt.status, shortMsg)
    }

    let json = null
    try {
      json = JSON.parse(attempt.rawBody)
    } catch {
      json = null
    }

    const candidates = Array.isArray(json?.candidates) ? json.candidates : []
    const firstCandidate = candidates[0] || {}
    const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : []
    const rawText = parts
      .map((part) => sanitizeText(part?.text))
      .filter(Boolean)
      .join('\n')

    if (!rawText) {
      return createErrorResponse(res, 502, 'Gemini returned empty response.')
    }

    const parsed = extractJSON(rawText)
    if (!parsed || !Array.isArray(parsed.tables)) {
      return createErrorResponse(res, 502, `Gemini JSON parse failed: ${rawText.slice(0, 300)}`)
    }

    return res.status(200).json({
      result: parsed,
      meta: { model: attempt.targetModel, fallbackUsed: usedFallback }
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
