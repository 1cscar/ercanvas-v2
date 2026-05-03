import {
  GEMINI_API_TIMEOUT_MS,
  MAX_SOURCE_TABLES,
  MAX_SOURCE_FIELDS_PER_TABLE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  RETRY_MAX_OUTPUT_TOKENS
} from './config.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const sanitizeText = (value, fallback = '') => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const tryParseJSON = (text) => {
  try {
    return { parsed: JSON.parse(text), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { parsed: null, error: message }
  }
}

const extractFirstBalancedJSONObject = (text) => {
  const start = text.indexOf('{')
  if (start < 0) return { jsonText: null, truncated: false }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return {
          jsonText: text.slice(start, i + 1),
          truncated: false
        }
      }
    }
  }

  return { jsonText: null, truncated: depth > 0 }
}

const extractJSON = (text) => {
  const candidates = []
  const seen = new Set()

  const pushCandidate = (candidate) => {
    const normalized = sanitizeText(candidate)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlock?.[1]) pushCandidate(codeBlock[1])

  const balanced = extractFirstBalancedJSONObject(text)
  if (balanced.jsonText) pushCandidate(balanced.jsonText)

  pushCandidate(text)

  let lastError = null
  for (const candidate of candidates) {
    const { parsed, error } = tryParseJSON(candidate)
    if (parsed) {
      return { parsed, error: null, truncated: false }
    }
    lastError = error
  }

  return { parsed: null, error: lastError, truncated: balanced.truncated }
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

const buildNormalizationPrompt = (sourceTables, compactMode = false) => {
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

  const compactRule = compactMode
    ? `\n額外限制（避免回覆過長截斷）：
- normalizedTables 最多 10 張
- 每張表最多 10 個欄位
- normalizationDiagnosis 最多 6 條
- integrityNotes 最多 4 條
- notes 最多 4 條
- 不要輸出 inputAnalysis、functionalDependencies、normalizationSteps、sqlSchema、relationshipDiagram 或任何冗長說明`
    : ''

  return `【角色設定】
你是一位資深的資料庫架構師與資料建模專家，精通關係型資料庫理論（Relational Database Theory），擅長將邏輯資料模型正規化並落地成可實作的 SQL Schema 與關聯圖描述。

【任務目標】
請根據我提供的資料模型圖（PDF）與畫布摘要，將以下邏輯資料模型進行完整正規化，直到符合 3NF，必要時可延伸檢查 BCNF，但主輸出仍以可落地的 3NF 結構為準。

請依據以下資訊分析並正規化：
1. 原始表結構：［填入你的表名與欄位］
2. 欄位含義：［簡述幾個比較模糊的欄位在做什麼］
3. 資料相依性（Functional Dependencies）：
   - ［欄位A］決定了［欄位B、欄位C...］
   - ［欄位D］決定了［欄位E］
4. 特殊規則：［例如：一個員工是否能屬於多個部門？一個產品是否有複合主鍵？］

【正規化執行指令（必須嚴格遵守）】
1. 依 1NF、2NF、3NF 的順序進行拆分，必要時再檢查 BCNF。
2. 拆出多對多關聯表，移除明顯冗餘欄位。
3. 每張表至少要有一個 PK，FK 必須指出 refTable/refField。
4. 保留原始領域語意與中文命名。
5. 若圖片資訊不完整，請基於畫布摘要做最小必要假設。

【回覆要求】
- 只輸出 JSON，不要 Markdown，不要 code fence，不要多餘說明
- 只輸出前端會用到的最小必要內容，避免冗長欄位把 JSON 撐爆
- 不要輸出通用抽象六表（Parties、Party_Roles、Entity_Relationships、Schema_Definitions、Universal_Events、State_Observations）
- 不要輸出 inputAnalysis、functionalDependencies、normalizationSteps、sqlSchema 或 relationshipDiagram
- normalizationDiagnosis、integrityNotes、notes 盡量精簡
${compactRule}

畫布摘要（僅輔助）：
${sourceSummary || '- 無'}

僅輸出 JSON：
{
  "domain": "string",
  "inputAnalysis": {
    "businessAssumptions": ["string"]
  },
  "normalizationDiagnosis": [
    {
      "normalForm": "1NF|2NF|3NF|BCNF",
      "table": "string",
      "issue": "string",
      "reason": "string",
      "functionalDependency": "string|null"
    }
  ],
  "normalizedTables": [
    {
      "name": "string",
      "description": "string",
      "fields": [
        {
          "name": "string",
          "isPK": true,
          "isFK": false,
          "refTable": null,
          "refField": null,
          "dataType": null,
          "nullable": null
        }
      ]
    }
  ],
  "integrityNotes": ["string"],
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

  const prompt = buildNormalizationPrompt(sourceTables, false)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_API_TIMEOUT_MS)

  const callGemini = async (targetModel, options = {}) => {
    const maxOutputTokens = Number(options.maxOutputTokens) || DEFAULT_MAX_OUTPUT_TOKENS
    const compactMode = Boolean(options.compactMode)
    const effectivePrompt = compactMode ? buildNormalizationPrompt(sourceTables, true) : prompt
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
              { text: effectivePrompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens,
          responseMimeType: 'application/json'
        }
      })
    })

    const rawBody = await response.text().catch(() => '')
    return { targetModel, status: response.status, ok: response.ok, rawBody, maxOutputTokens, compactMode }
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
    const finishReason = sanitizeText(firstCandidate?.finishReason)
    const parts = Array.isArray(firstCandidate?.content?.parts)
      ? firstCandidate.content.parts
      : []
    const rawText = parts
      .map((part) => sanitizeText(part?.text))
      .filter(Boolean)
      .join('\n')

    if (!rawText) {
      return { parsed: null, reason: 'Gemini returned empty response.', finishReason }
    }

    const { parsed, error: parseError, truncated } = extractJSON(rawText)
    if (!parsed || !Array.isArray(parsed.normalizedTables)) {
      return {
        parsed: null,
        reason: `Gemini JSON parse failed${finishReason ? ` (${finishReason})` : ''}${
          parseError ? `: ${parseError}` : ''
        }.`,
        finishReason,
        rawText,
        truncated
      }
    }

    return { parsed, reason: '', finishReason, rawText, truncated: false }
  }

  try {
    let attempt = await callGemini(model, { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, compactMode: false })
    let usedFallback = false

    if (!attempt.ok && attempt.status === 429 && fallbackModel && fallbackModel !== model) {
      usedFallback = true
      attempt = await callGemini(fallbackModel, {
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        compactMode: false
      })
    }

    if (!attempt.ok) {
      const shortMsg =
        attempt.status === 429
          ? `Gemini 配額不足（429）。${usedFallback ? '已自動改用備援模型仍超限。' : ''}請稍後再試或升級配額。`
          : `Gemini API failed (${attempt.status}): ${attempt.rawBody.slice(0, 300)}`
      return createErrorResponse(res, attempt.status, shortMsg)
    }

    let parsedResult = parseResult(attempt.rawBody)
    const shouldRetryWithCompact =
      !parsedResult.parsed &&
      (parsedResult.finishReason.toUpperCase() === 'MAX_TOKENS' ||
        parsedResult.finishReason.toUpperCase() === 'RECITATION' ||
        parsedResult.truncated === true)

    if (shouldRetryWithCompact) {
      let retryAttempt = await callGemini(model, {
        maxOutputTokens: RETRY_MAX_OUTPUT_TOKENS,
        compactMode: true
      })
      if (!retryAttempt.ok && retryAttempt.status === 429 && fallbackModel && fallbackModel !== model) {
        usedFallback = true
        retryAttempt = await callGemini(fallbackModel, {
          maxOutputTokens: RETRY_MAX_OUTPUT_TOKENS,
          compactMode: true
        })
      }
      if (retryAttempt.ok) {
        attempt = retryAttempt
        parsedResult = parseResult(retryAttempt.rawBody)
      }
    }

    if (!parsedResult.parsed) {
      const shortPreview = sanitizeText(parsedResult.rawText).slice(0, 220)
      const detail = shortPreview ? ` Raw: ${shortPreview}` : ''
      return createErrorResponse(res, 502, `${parsedResult.reason}${detail}`)
    }

    return res.status(200).json({
      result: parsedResult.parsed,
      meta: {
        model: attempt.targetModel,
        fallbackUsed: usedFallback,
        finishReason: parsedResult.finishReason || null
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
