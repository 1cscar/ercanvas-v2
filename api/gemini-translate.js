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
命名必須同時滿足：精確、簡潔、可預測。

# Constraints & Rules
1. 命名格式：統一使用小寫蛇形命名法（lower_case_with_underscores）。
2. 單數準則：資料表名稱必須使用單數名詞（例如 user 而非 users）。
3. 主鍵與外鍵：
   - 主鍵名稱必須是「名詞 + _id」格式（例如 race_id、driver_id），不可只用 id。
   - 主鍵必須以 _id 結尾，且只能有一組 _id（禁止 race_id_id 這種重複後綴）。
   - 外鍵統一命名為 [關聯表英文名]_id。
   - 同一關聯中主鍵名稱必須一致，不可混用 identifier / uuid / key。
4. 布林值命名：
   - 狀態類使用 is_ 前綴。
   - 擁有類使用 has_ 前綴。
   - 權限/能力類使用 can_ 前綴。
5. 時間命名：
   - 建立時間 created_at
   - 更新時間 updated_at
   - 特定日期 [動作]_date（例如 hired_date）
6. 精簡原則：
   - 移除冗餘前綴：若欄位已在 driver 表中，用 name 而非 driver_name。
   - 避免 MySQL 保留字（如 order, group, index, rank）；必要時加修飾詞（如 order_no、rank_value）。
7. 專業術語優先：
   - 編號 id / no / sn
   - 狀態 status / state
   - 類型 type
   - 數量 qty / amount / count
   - 描述 desc / note / remark
8. 命名結構順序：
   - 優先採用 [主體][屬性][限定詞]，避免中文直譯語序。
   - 例如「年度總銷售」更偏向 sales_total_yearly，而不是 current_year_total_sales_amount。
9. 關聯表命名：
   - 多對多中介表優先使用 a_b（snake_case），若有成熟術語可用術語（如 enrollment）。
10. 長度控制：
   - 避免過長名稱；可使用常見縮寫且保持專案一致，例如 addr / config / msg / img / stats / src。

# Translation SOP
請在心中依下列步驟完成翻譯後再輸出 JSON：
1. 先定實體名：先決定每個表的核心名詞（Noun）。
2. 再定屬性：欄位名稱反映該實體的屬性/動作/狀態。
3. 檢查冗餘與長度：移除與表名重複前綴，必要時改用業界縮寫。
4. 檢查關鍵字：若命中 MySQL 保留字（如 order/group/index/rank），改為安全名稱（例如 order_no、rank_value）。
5. 檢查一致性：同一中文術語在同一份輸入中盡量維持同一英文術語。
6. 編號類欄位檢查：若中文名稱含「編號 / 序號」，英文不得只用 id，必須有名詞主體（例如 race_id、team_id）。

# Consistency Requirements
- 同一個中文詞在同一份輸入中，盡量翻成同一個英文詞（除非語意明確不同）。
- 不得使用中文拼音（例如 bisai、cheshou）。
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
