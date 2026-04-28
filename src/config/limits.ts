/**
 * Below this attribute count, NormalizationEngine uses exact subset enumeration for candidate keys.
 * At 18 attrs the search space is manageable (~2^18 = 262k subsets worst-case, pruned early).
 */
export const SMALL_SCHEMA_ATTR_LIMIT = 18

/**
 * When the schema exceeds SMALL_SCHEMA_ATTR_LIMIT, cap extra attributes added to required set.
 * 6 extra attrs keeps the search O(C(n,6)) ≈ millions max, avoiding UI hangs on adversarial schemas.
 */
export const LARGE_SCHEMA_MAX_EXTRA_ATTRS = 6

/**
 * Absolute cap on evaluated key candidates to prevent hang on pathological schemas.
 * 80k covers practical schema sizes without exceeding ~50ms on modern hardware.
 */
export const MAX_EVALUATED_KEY_CANDIDATES = 80_000

/**
 * Timeout for Gemini API calls originating from the frontend (ms).
 * 180s matches the backend proxy timeout so both sides fail at the same time.
 */
export const GEMINI_TIMEOUT_MS = 180_000
