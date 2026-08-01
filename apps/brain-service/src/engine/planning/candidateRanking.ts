/**
 * MigraAI Engine — ranking repository-map entries against a question.
 *
 * This replaces the part of the old loop that was most expensive and least
 * reliable: the model guessing search terms, running a grep, reading the wrong
 * file, and trying again — eight times, at 30–90s per attempt. Ranking a
 * precomputed map is deterministic, costs microseconds, and is testable without a
 * model.
 *
 * It is a ROUTING decision, not an evidence decision. A high rank only means "open
 * this next"; nothing downstream may cite a ranking. © MigraTeck LLC.
 */

import * as path from 'node:path';
import type { FileRole, RepoMap, RepoMapEntry } from './repoMap.js';

export interface RankedCandidate {
  entry: RepoMapEntry;
  score: number;
  /** Why it ranked — surfaced in the run report so a bad plan is diagnosable. */
  reasons: string[];
}

/**
 * Question words that carry no routing signal.
 *
 * Same principle as the lexical retriever's stoplist: searching "explain", "file"
 * or "does" pulls in everything and ranks noise to the top.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'what', 'whats', 'why', 'how',
  'does', 'did', 'are', 'was', 'were', 'has', 'have', 'had', 'can', 'could', 'should', 'would',
  'repo', 'repository', 'code', 'codebase', 'file', 'files', 'function', 'functions', 'class',
  'method', 'methods', 'explain', 'tell', 'show', 'about', 'inside', 'used', 'use', 'uses',
  'using', 'work', 'works', 'working', 'handle', 'handled', 'handles', 'implement', 'implemented',
  'implementation', 'where', 'when', 'which', 'here', 'there', 'get', 'set', 'from', 'into',
  'your', 'our', 'its', 'doing', 'done', 'within', 'read', 'look', 'find', 'give', 'want', 'need',
  'please', 'exactly', 'actually', 'specific', 'purpose', 'name', 'named', 'thing', 'things',
]);

/** Role weights. Archives and build output are excluded outright, not down-ranked. */
const ROLE_WEIGHT: Record<FileRole, number> = {
  source: 1,
  config: 0.7,
  test: 0.55,
  doc: 0.4,
  asset: 0.1,
  generated: 0,
  archive: 0,
};

/** Questions about shape rather than a named thing — entry points matter more. */
const STRUCTURAL = /\b(architect\w*|structure|overview|entry\s?points?|how .* organi[sz]ed|what .* does .* do|layout|topology)\b/i;

/** Split a question into routing terms: identifiers, paths and salient words. */
export function questionTerms(question: string): { words: string[]; paths: string[]; identifiers: string[] } {
  const paths: string[] = [];
  for (const m of question.matchAll(/(?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][\w]{0,7}/g)) paths.push(m[0]);

  // A named path is ONE signal, not a bag of them. Measured: asking about
  // `apps/vscode-extension/scripts/check-brain-transport.mjs` let "apps",
  // "vscode", "extension" and "scripts" each score every sibling file, so seven
  // unrelated modules ranked high enough to open and the single call carried
  // 14,622 evidence units. The path match already says which file is meant.
  const fromPaths = new Set<string>();
  for (const p of paths) {
    for (const m of p.matchAll(/[A-Za-z][A-Za-z0-9]{2,}/g)) fromPaths.add(m[0].toLowerCase());
  }

  const identifiers: string[] = [];
  for (const m of question.matchAll(/[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z]+(?:_[a-z0-9]+)+/g)) {
    identifiers.push(m[0]);
  }
  const words: string[] = [];
  for (const m of question.matchAll(/[A-Za-z][A-Za-z0-9]{2,}/g)) {
    const w = m[0].toLowerCase();
    if (!STOPWORDS.has(w) && !fromPaths.has(w)) words.push(w);
  }
  return { words: [...new Set(words)], paths: [...new Set(paths)], identifiers: [...new Set(identifiers)] };
}

export interface RankOptions {
  /** How many ranked candidates to return. */
  limit: number;
  /** Include tests in the candidate set (off unless the question is about tests). */
  includeTests?: boolean;
}

/**
 * Score floor, as a fraction of the best candidate.
 *
 * Measured: for a question naming one exact file, the top score was 148 and the
 * runners-up 39, 36, 36, 32, 31 — a cliff, not a gradient. Opening down to 31
 * because the budget allowed eight files is how a well-routed question still
 * arrived at the model as 14,622 units of mostly-irrelevant source.
 */
export const RELEVANCE_FLOOR_RATIO = 0.25;

/** Drop candidates far below the best one; always keep at least the top match. */
export function aboveRelevanceFloor(ranked: RankedCandidate[]): RankedCandidate[] {
  if (ranked.length === 0) return ranked;
  const floor = ranked[0]!.score * RELEVANCE_FLOOR_RATIO;
  const kept = ranked.filter((c) => c.score >= floor);
  return kept.length ? kept : ranked.slice(0, 1);
}

/**
 * Rank the map against a question.
 *
 * The scoring is intentionally boring and explainable — an exact path match beats a
 * basename match beats an exported-identifier match beats a word appearing in the
 * path. Anything clever here would be a second, unverifiable retrieval model.
 */
export function rankCandidates(map: RepoMap, question: string, opts: RankOptions): RankedCandidate[] {
  const { words, paths, identifiers } = questionTerms(question);
  const structural = STRUCTURAL.test(question);
  const wantsTests = opts.includeTests || /\btests?\b|\bspec\b|\bregression\b/i.test(question);
  const identifiersLower = identifiers.map((i) => i.toLowerCase());
  const ranked: RankedCandidate[] = [];

  for (const entry of map.entries) {
    const roleWeight = ROLE_WEIGHT[entry.role];
    if (roleWeight === 0) continue; // generated + archive are never evidence
    if (entry.role === 'test' && !wantsTests) continue;

    const relLower = entry.path.toLowerCase();
    const base = path.posix.basename(entry.path).toLowerCase();
    let score = 0;
    const reasons: string[] = [];

    for (const p of paths) {
      const pl = p.toLowerCase();
      if (relLower === pl) {
        score += 100;
        reasons.push(`exact path match ${p}`);
      } else if (relLower.endsWith('/' + pl) || base === path.posix.basename(pl)) {
        score += 60;
        reasons.push(`filename match ${p}`);
      }
    }

    for (const id of identifiers) {
      if (entry.exports.includes(id)) {
        score += 40;
        reasons.push(`exports ${id}`);
      } else if (base.includes(id.toLowerCase())) {
        score += 20;
        reasons.push(`name contains ${id}`);
      }
    }
    for (const id of identifiersLower) {
      if (entry.exports.some((e) => e.toLowerCase() === id)) {
        score += 12;
        reasons.push(`exports ~${id}`);
      }
    }

    for (const w of words) {
      if (base.includes(w)) {
        score += 8;
        reasons.push(`filename word ${w}`);
      } else if (relLower.includes(w)) {
        score += 3;
        reasons.push(`path word ${w}`);
      }
      if (entry.exports.some((e) => e.toLowerCase().includes(w))) {
        score += 5;
        reasons.push(`export word ${w}`);
      }
      if (entry.packageName && entry.packageName.toLowerCase().includes(w)) {
        score += 4;
        reasons.push(`package ${entry.packageName}`);
      }
    }

    if (structural && entry.entryPoint) {
      score += 15;
      reasons.push(entry.entryPoint);
    }
    if (score === 0) continue;

    // Prefer the file that DEFINES a thing over a large file that merely mentions
    // it: a 4,000-line barrel matching one word is rarely the answer.
    const sizePenalty = entry.lineCount > 1200 ? 0.75 : 1;
    ranked.push({ entry, score: score * roleWeight * sizePenalty, reasons: [...new Set(reasons)].slice(0, 5) });
  }

  ranked.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
  return ranked.slice(0, opts.limit);
}

/**
 * Files a candidate directly imports, for one bounded neighbourhood expansion.
 *
 * Used only when the verifier reports a gap: an answer that needed the adapter a
 * scanner allowlists is one import edge away, and following that edge is cheaper
 * and more reliable than another round of model-driven guessing.
 */
export function importNeighbours(map: RepoMap, seed: string[], limit: number): RepoMapEntry[] {
  const seen = new Set(seed);
  const out: RepoMapEntry[] = [];
  for (const p of seed) {
    const entry = map.byPath.get(p);
    if (!entry) continue;
    for (const imp of entry.imports) {
      if (seen.has(imp)) continue;
      const target = map.byPath.get(imp);
      if (!target || target.role === 'generated' || target.role === 'archive') continue;
      seen.add(imp);
      out.push(target);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
