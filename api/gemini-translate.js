import { GEMINI_TRANSLATE_TIMEOUT_MS } from './config.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

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
請將提供的中文資料表名稱與欄位名稱轉換為專業的英文命名，並確保結果能直接用於 MySQL schema。

# Core Goal
命名必須同時滿足：精確、簡潔、可預測，且「簡單辨識優先」。

# Merged Rules
1. 表名：使用單數名詞，並全專案固定同一風格。
2. 表名風格：預設 snake_case（例如 racetrack）；若已明確指定或上下文明確要求，可全專案改用 PascalCase（例如 Racetrack）。禁止同一份結果混用兩種風格。
3. 欄位名：一律 snake_case，且優先短詞（例如 name, length, date, status）。
4. 主鍵：統一為 xxx_id（例如 track_id），不可只用 id。
5. 外鍵：必須與對應主鍵一致（例如 race.track_id -> racetrack.track_id）。
6. 同義詞一致：同一份輸入固定一種詞，不可混用（例如只用 length，不要同時出現 distance）。
7. 去冗餘：若欄位已在 driver 表中，優先用 name，而非 driver_name。
8. 布林值命名：狀態類用 is_，擁有類用 has_，能力/權限類用 can_。
9. 時間命名：建立時間 created_at、更新時間 updated_at、特定日期使用 [動作]_date（例如 hired_date）。
10. 避免保留字：若命中 MySQL 保留字（order, group, index, rank ...），改為安全名稱（例如 order_no、rank_value）。
11. 禁止拼音：不得使用中文拼音。

# Example
- snake_case 表名模式：racetrack.track_id / racetrack.name / racetrack.length
- PascalCase 表名模式：Racetrack.track_id / Racetrack.name / Racetrack.length

# Translation SOP
1. 先定每個表的核心單數名詞，再決定表名風格（預設 snake_case）。
2. 再定欄位短詞，維持 snake_case。
3. 強制檢查主鍵/外鍵是否對齊 xxx_id。
4. 強制檢查同義詞是否全程一致。
5. 最後檢查保留字與冗長直譯。

# Consistency Requirements
- 同一個中文詞在同一份輸入中，盡量翻成同一個英文詞（除非語意明確不同）。
- 僅輸出命名結果，不要輸出 SQL、不要輸出資料型別、不要解釋文字。

# Output Contract (API only)
你必須只輸出合法 JSON，嚴格符合以下結構：
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
  const timer = setTimeout(() => controller.abort(), GEMINI_TRANSLATE_TIMEOUT_MS)

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
