import { describe, it, expect, vi } from 'vitest'
import { calculateClosure, findCandidateKeys, getMinimalCover } from '../NormalizationEngine'
import type { FD } from '../normalizationTypes'

// ─── calculateClosure ────────────────────────────────────────────────────────

describe('calculateClosure', () => {
  it('returns the seed attributes when there are no FDs', () => {
    const result = calculateClosure(new Set(['A']), [])
    expect([...result].sort()).toEqual(['A'])
  })

  it('chases transitive dependencies', () => {
    // A → B, B → C  ⟹  {A}⁺ = {A, B, C}
    const fds: FD[] = [
      { lhs: ['A'], rhs: 'B' },
      { lhs: ['B'], rhs: 'C' }
    ]
    const result = calculateClosure(new Set(['A']), fds)
    expect([...result].sort()).toEqual(['A', 'B', 'C'])
  })

  it('handles composite LHS', () => {
    // {A,B} → C
    const fds: FD[] = [{ lhs: ['A', 'B'], rhs: 'C' }]
    expect(calculateClosure(new Set(['A', 'B']), fds).has('C')).toBe(true)
    expect(calculateClosure(new Set(['A']), fds).has('C')).toBe(false)
  })

  it('does not add attributes that are not determined', () => {
    const fds: FD[] = [{ lhs: ['A'], rhs: 'B' }]
    const result = calculateClosure(new Set(['A']), fds)
    expect(result.has('C')).toBe(false)
  })
})

// ─── findCandidateKeys — small schemas (exact search) ────────────────────────

describe('findCandidateKeys — exact search (small schema)', () => {
  it('returns empty array for empty attribute list', () => {
    expect(findCandidateKeys([], [])).toEqual([])
  })

  it('returns [A] when A alone determines everything', () => {
    // A → B, A → C
    const fds: FD[] = [
      { lhs: ['A'], rhs: 'B' },
      { lhs: ['A'], rhs: 'C' }
    ]
    const keys = findCandidateKeys(['A', 'B', 'C'], fds)
    expect(keys).toHaveLength(1)
    expect(keys[0].sort()).toEqual(['A'])
  })

  it('finds composite candidate key', () => {
    // {A,B} → C, no single attr determines all
    const fds: FD[] = [{ lhs: ['A', 'B'], rhs: 'C' }]
    const keys = findCandidateKeys(['A', 'B', 'C'], fds)
    expect(keys).toHaveLength(1)
    expect(keys[0].sort()).toEqual(['A', 'B'])
  })

  it('finds multiple candidate keys', () => {
    // AB → C, C → A  ⟹  two CKs: {A,B} and {B,C}
    // Verify: {A,B}⁺ = {A,B,C} ✓  |  {B,C}⁺ = {B,C,A} = universe ✓
    // {A} alone: closure = {A} ✗ (cannot derive B)
    // {B} alone: closure = {B} ✗
    const fds: FD[] = [
      { lhs: ['A', 'B'], rhs: 'C' },
      { lhs: ['C'], rhs: 'A' }
    ]
    const keys = findCandidateKeys(['A', 'B', 'C'], fds)
    const keyStrings = keys.map((k) => [...k].sort().join(','))
    expect(keyStrings).toContain('A,B')
    expect(keyStrings).toContain('B,C')
  })

  it('returns the whole attribute set when there are no FDs', () => {
    // No FDs → only superkey is all attributes together
    const keys = findCandidateKeys(['A', 'B', 'C'], [])
    expect(keys).toHaveLength(1)
    expect(keys[0].sort()).toEqual(['A', 'B', 'C'])
  })

  it('deduplicates input attributes before searching', () => {
    const fds: FD[] = [{ lhs: ['A'], rhs: 'B' }]
    const keys = findCandidateKeys(['A', 'A', 'B'], fds)
    expect(keys[0].sort()).toEqual(['A'])
  })
})

// ─── findCandidateKeys — greedy fallback ─────────────────────────────────────

describe('findCandidateKeys — greedy fallback (large schema)', () => {
  /**
   * Schema designed to force the greedy path:
   *
   *   Universe: K0..K7 (8 key attrs) + D0..D11 (12 derived attrs) = 20 total
   *   FDs:
   *     {K0,K1,...,K7} → Di  for each i ∈ 0..11  (8-attr composite key)
   *     Di → Ki              for each i ∈ 0..7   (so every Ki appears on some RHS)
   *
   * Because every Ki appears on the RHS of Di→Ki, required=[] and
   * optional = all 20 attrs.  The bounded search checks subsets up to size
   * LARGE_SCHEMA_MAX_EXTRA_ATTRS=6 (since universe.length=20 > SMALL_SCHEMA_ATTR_LIMIT=18)
   * but the true CK has size 8 — no smaller superkey exists.  After exhausting
   * all C(20,0..6) = 60,460 candidates (< 80,000 budget but loop finishes with
   * zero hits), the function falls through to the greedy path.
   */
  const KEY_ATTRS = Array.from({ length: 8 }, (_, i) => `K${i}`)
  const DERIVED_ATTRS = Array.from({ length: 12 }, (_, i) => `D${i}`)
  const ALL_ATTRS = [...KEY_ATTRS, ...DERIVED_ATTRS]

  const buildFDs = (): FD[] => {
    const fds: FD[] = []
    // {K0..K7} → each derived attr
    for (const d of DERIVED_ATTRS) {
      fds.push({ lhs: [...KEY_ATTRS], rhs: d })
    }
    // Di → Ki  (makes every Ki appear on some RHS → required=[])
    for (let i = 0; i < 8; i++) {
      fds.push({ lhs: [`D${i}`], rhs: `K${i}` })
    }
    return fds
  }

  it('produces a valid superkey via greedy when bounded search finds nothing', () => {
    const fds = buildFDs()
    const keys = findCandidateKeys(ALL_ATTRS, fds)
    expect(keys.length).toBeGreaterThan(0)

    // The returned key must actually be a superkey
    const key = keys[0]
    const closure = calculateClosure(new Set(key), fds)
    expect(ALL_ATTRS.every((a) => closure.has(a))).toBe(true)
  })

  it('emits a console.warn containing "greedy key" when the greedy path is taken', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      findCandidateKeys(ALL_ATTRS, buildFDs())
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('greedy key'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ─── getMinimalCover ──────────────────────────────────────────────────────────

describe('getMinimalCover', () => {
  it('returns empty array for empty input', () => {
    expect(getMinimalCover([])).toEqual([])
  })

  it('removes redundant FDs', () => {
    // A → B, A → B (duplicate)
    const fds: FD[] = [
      { lhs: ['A'], rhs: 'B' },
      { lhs: ['A'], rhs: 'B' }
    ]
    const cover = getMinimalCover(fds)
    expect(cover).toHaveLength(1)
  })

  it('removes transitive redundancy', () => {
    // A → B, B → C, A → C  ⟹  A → C is redundant
    const fds: FD[] = [
      { lhs: ['A'], rhs: 'B' },
      { lhs: ['B'], rhs: 'C' },
      { lhs: ['A'], rhs: 'C' }
    ]
    const cover = getMinimalCover(fds)
    const hasRedundant = cover.some(
      (fd) => fd.lhs.includes('A') && fd.rhs === 'C'
    )
    expect(hasRedundant).toBe(false)
  })

  it('removes redundant LHS attributes', () => {
    // {A,B} → C but A → C alone (B is redundant in LHS)
    const fds: FD[] = [
      { lhs: ['A', 'B'], rhs: 'C' },
      { lhs: ['A'], rhs: 'C' }
    ]
    const cover = getMinimalCover(fds)
    // No FD in cover should have both A and B as LHS for rhs C
    const hasCompositeLhs = cover.some(
      (fd) => fd.lhs.includes('A') && fd.lhs.includes('B') && fd.rhs === 'C'
    )
    expect(hasCompositeLhs).toBe(false)
  })
})
