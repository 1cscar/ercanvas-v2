/**
 * Timeout for Gemini API calls from the backend proxy (ms).
 * 180s matches the frontend AbortController timeout so both sides fail together.
 */
export const GEMINI_API_TIMEOUT_MS = 180_000

/**
 * Timeout for the translate endpoint (ms).
 * 60s is sufficient for text-only requests with no PDF upload.
 */
export const GEMINI_TRANSLATE_TIMEOUT_MS = 60_000

/**
 * Max source tables forwarded to the normalization prompt.
 * 8 tables keeps the prompt token count below ~1k while covering most mid-size schemas.
 */
export const MAX_SOURCE_TABLES = 8

/**
 * Max fields per source table included in the normalization prompt.
 * 10 fields is enough for context without inflating the prompt excessively.
 */
export const MAX_SOURCE_FIELDS_PER_TABLE = 10

/**
 * Default max output tokens for normalization.
 * 3072 covers most mid-size schemas; higher values incur cost and latency.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 3072

/**
 * Retry max output tokens when the first attempt was truncated (MAX_TOKENS / RECITATION finish reason).
 * 8192 gives extra room for large schemas without exceeding Gemini Flash limits.
 */
export const RETRY_MAX_OUTPUT_TOKENS = 8192
