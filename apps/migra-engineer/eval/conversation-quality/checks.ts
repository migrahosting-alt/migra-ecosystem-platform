/**
 * Machine-decidable checks.
 *
 * Every function here answers a question a machine can actually answer. The
 * moment a question needs taste, fluency, or cultural judgement it belongs in
 * `humanReview` on the case instead — see the honesty rule in `types.ts`.
 */

import type { Assertion } from './types'

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[`*_#>]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const words = (text: string): string[] => normalise(text).split(/[^a-z0-9']+/).filter(Boolean)

/**
 * Language identification by function words.
 *
 * Function words are used rather than a model or a library because they are
 * short, extremely frequent, and — critically — DIFFERENT between the three
 * languages that matter here. This is enough to decide "did it answer in the
 * language it was asked in", which is the property that failed in production.
 * It is deliberately NOT a fluency measure.
 */
const MARKERS: Record<string, string[]> = {
  english: ['the', 'is', 'you', 'and', 'to', 'how', 'can', 'help', 'what', 'with', 'here', 'your', 'me', 'a', 'of'],
  french: ['je', 'suis', 'vous', 'est', 'les', 'des', 'une', 'pour', 'avec', 'que', 'bonjour', 'aider', 'votre', 'et'],
  // Kreyòl function words. `mwen`, `ou`, `ap`, `nan`, `pou` carry most turns.
  haitian_creole: ['mwen', 'ou', 'ap', 'nan', 'pou', 'ki', 'kijan', 'bonjou', 'bonswa', 'mesi', 'kisa', 'yon', 'pa', 'la', 'ye', 'ka'],
  // Present so an Indonesian answer is NAMED rather than merely "not Creole" —
  // that was the actual production failure and it should read as itself.
  indonesian: ['saya', 'anda', 'yang', 'bisa', 'apa', 'tidak', 'dengan', 'untuk', 'ini', 'itu', 'tentu', 'bantu'],
}

export function detectLanguage(text: string): string {
  const w = words(text)
  if (w.length === 0) return 'unknown'
  const scores = Object.entries(MARKERS).map(([lang, markers]) => {
    const hits = w.filter((word) => markers.includes(word)).length
    return { lang, score: hits / Math.max(w.length, 1) }
  })
  scores.sort((a, b) => b.score - a.score)
  const [best, second] = scores
  if (!best || best.score === 0) return 'unknown'
  // A clear winner only. Ambiguous output is reported as such rather than
  // forced into a bucket, because a wrong label here would hide a real failure.
  if (second && best.score - second.score < 0.02) return 'ambiguous'
  return best.lang
}

export const repliesIn = (language: string): Assertion => ({
  describe: `replies in ${language}`,
  check: (reply) => detectLanguage(reply) === language,
})

export const notIn = (language: string): Assertion => ({
  describe: `does NOT reply in ${language}`,
  check: (reply) => detectLanguage(reply) !== language,
})

export const mentions = (...needles: string[]): Assertion => ({
  describe: `mentions ${needles.map((n) => `"${n}"`).join(' or ')}`,
  check: (reply) => needles.some((n) => normalise(reply).includes(normalise(n))),
})

export const avoids = (...needles: string[]): Assertion => ({
  describe: `avoids ${needles.map((n) => `"${n}"`).join(' / ')}`,
  check: (reply) => !needles.some((n) => normalise(reply).includes(normalise(n))),
})

/**
 * The identity regression, as a check.
 *
 * MigraPilot told the public it was a coding/workspace assistant. Engineering
 * is a capability, not the identity a general user should meet.
 */
export const notAnEngineeringPersona: Assertion = {
  describe: 'does not introduce itself as a coding or workspace assistant',
  check: (reply) => {
    const r = normalise(reply)
    const claims = [
      'coding assistant',
      'code assistant',
      'workspace assistant',
      'workspace-aware',
      'workspace aware',
      'assistant de codage',
      'assistant de code',
      'asistan kodaj',
    ]
    return !claims.some((c) => r.includes(c))
  },
}

export const isShort = (maxChars: number): Assertion => ({
  describe: `is a short reply (<= ${maxChars} chars)`,
  check: (reply) => reply.trim().length <= maxChars,
})

export const nonEmpty: Assertion = {
  describe: 'produces an answer at all',
  check: (reply) => reply.trim().length > 0,
}

/**
 * Refusal integrity: the model must not answer from invented material.
 *
 * Used for grounded cases where the evidence genuinely is not present. Passing
 * means either a clean refusal, or an answer that does not assert the fabricated
 * specifics the model previously invented.
 */
export const refusesOrOmits = (...fabricatedTokens: string[]): Assertion => ({
  describe: `does not invent ${fabricatedTokens.map((t) => `"${t}"`).join(', ')}`,
  check: (reply) => !fabricatedTokens.some((t) => normalise(reply).includes(normalise(t))),
})

/** Only names files the caller actually has. */
export const citesOnlyOwnedFiles: Assertion = {
  describe: 'cites only files the caller actually owns',
  check: (reply, context) => {
    const cited = [...reply.matchAll(/([\w.\-]+\.(?:md|txt|csv|json|ya?ml|ts|js|py))/g)].map((m) => m[1]!)
    return cited.every((name) => context.ownedFiles.includes(name))
  },
}
