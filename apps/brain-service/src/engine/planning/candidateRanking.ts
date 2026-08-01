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
import { GENERIC_TOKENS, splitToken } from './contentSignals.js';
import type { FileRole, RepoMap, RepoMapEntry } from './repoMap.js';

/**
 * Score contributed by a match, by the SIGNAL CLASS it came from.
 *
 * The precedence is the design: executable text outranks structure, structure
 * outranks prose, and a directory word is worth nothing. A comment must be able to
 * make a file DISCOVERABLE — that is how `check-brain-transport.mjs`, whose only
 * "guard" is in a header comment, becomes findable at all — without letting a
 * stale or aspirational comment outrank code that says otherwise.
 */
const SIGNAL_WEIGHT = {
  exactPath: 100,
  exactFilename: 60,
  codeIdentifier: 40,
  structuralCategory: 22,
  importOrLiteral: 8,
  filenameToken: 8,
  commentTerm: 4,
  genericPathToken: 0,
} as const;

/**
 * A component recovered from a compound counts, but at well under half an exact
 * match — so `guardrails` never reads as `guard`, and `ALLOWLIST` containing
 * `allow` ranks below a file that says `allow` outright.
 */
const COMPONENT_FACTOR = 0.45;

/** Cap on the multi-concept bonus, so combination can never dwarf evidence class. */
const MAX_CONCEPT_BONUS = 2.5;

/** A compound part must be a whole word's worth of characters, not a fragment. */
const MIN_COMPOUND_REMAINDER = 4;

/**
 * Does `token` contain `concept` as a real compound part?
 *
 * `allowlist` contains `allow`, because the remainder `list` is four characters —
 * a word, not a fragment. `guardian` does NOT contain `guard`, because `ian` is
 * three. That single threshold is what separates the file we want from the
 * `deploy-guardian-*` files that outranked it.
 *
 * An earlier version also required the remainder to appear in the repository's own
 * vocabulary. That was more precise and too fragile: a small workspace has no file
 * declaring a standalone `list`, so `allowlist` stopped decomposing and the whole
 * mechanism silently switched off exactly where the repository was smallest. The
 * vocabulary is still used for build-time decomposition, where a miss costs
 * nothing; matching a live query cannot depend on it.
 */
export function isCompoundOf(token: string, concept: string, vocabulary?: ReadonlySet<string>): boolean {
  if (token === concept || token.length <= concept.length) return false;
  const accepts = (remainder: string): boolean =>
    remainder.length >= MIN_COMPOUND_REMAINDER || (vocabulary?.has(remainder) ?? false);
  if (token.startsWith(concept) && accepts(token.slice(concept.length))) return true;
  if (token.endsWith(concept) && accepts(token.slice(0, token.length - concept.length))) return true;
  return false;
}

/**
 * Specificity prior.
 *
 * A 69-line script whose whole purpose is a guard with an allowlist is a better
 * answer than a 400-line route that happens to import a guard helper. Standard
 * length normalisation, applied gently and only to concept scoring.
 */
function focusFactor(lineCount: number): number {
  if (lineCount === 0) return 1;
  if (lineCount <= 120) return 1.35;
  if (lineCount <= 400) return 1.1;
  if (lineCount <= 1200) return 1;
  return 0.75;
}

export interface RankedCandidate {
  entry: RepoMapEntry;
  score: number;
  /** Why it ranked — surfaced in the run report so a bad plan is diagnosable. */
  reasons: string[];
  /** The question named this file by path or filename. */
  exactNamed: boolean;
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

/**
 * Drop candidates far below the best one; always keep at least the top match.
 *
 * When the question NAMES a file, that file is the subject and the semantic
 * candidates are noise. Measured: adding content signals lifted enough unrelated
 * files above the proportional floor that the exact-path query went from opening
 * ONE file in 19.9s to opening EIGHT in 62s — a regression caused entirely by
 * better recall arriving where recall was not the problem. A named file
 * short-circuits the field; the gap-expansion round still fetches genuinely
 * related files when the verifier asks for them.
 */
export function aboveRelevanceFloor(ranked: RankedCandidate[]): RankedCandidate[] {
  if (ranked.length === 0) return ranked;
  const named = ranked.filter((c) => c.exactNamed);
  if (named.length) return named;
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

  // The question's CONCEPTS: salient words that are not directory scaffolding.
  // "What does the guard allow?" carries two — `guard` and `allow` — and a file
  // satisfying both is a far better candidate than one satisfying either alone.
  const concepts = [...new Set([...words, ...identifiers.flatMap((i) => splitToken(i))])].filter(
    (w) => !GENERIC_TOKENS.has(w),
  );
  const vocabulary = map.vocabulary ?? new Set<string>();
  const ranked: RankedCandidate[] = [];

  for (const entry of map.entries) {
    const roleWeight = ROLE_WEIGHT[entry.role];
    if (roleWeight === 0) continue; // generated + archive are never evidence
    if (entry.role === 'test' && !wantsTests) continue;

    const relLower = entry.path.toLowerCase();
    const base = path.posix.basename(entry.path).toLowerCase();
    let score = 0;
    const reasons: string[] = [];

    // ── 1-2. Exact path / filename. Unchanged: a named file is never outranked. ──
    let exactNamed = false;
    for (const p of paths) {
      const pl = p.toLowerCase();
      if (relLower === pl) {
        score += SIGNAL_WEIGHT.exactPath;
        reasons.push(`exact path match ${p}`);
        exactNamed = true;
      } else if (relLower.endsWith('/' + pl) || base === path.posix.basename(pl)) {
        score += SIGNAL_WEIGHT.exactFilename;
        reasons.push(`filename match ${p}`);
        exactNamed = true;
      }
    }

    // ── 3-8. Deterministic content signals, by class. ──
    const sig = entry.signals;
    const codeSet = new Set(sig.tokens.code);
    const nameSet = new Set(sig.tokens.name);
    const commentSet = new Set(sig.tokens.comment);
    const componentSet = new Set(sig.componentTokens);
    const categorySet = new Set(sig.structuralCategories);
    const importSet = new Set(sig.imports.flatMap((i) => splitToken(i)));
    const exportSet = new Set(entry.exports.flatMap((e) => splitToken(e)));

    /** Concepts matched, and whether any came from executable vs structural text. */
    const matched = new Set<string>();
    let sawExecutable = false;
    let sawStructural = false;
    const credit = (concept: string, weight: number, kind: 'exact' | 'component', why: string): void => {
      if (weight === 0) return;
      score += weight * (kind === 'exact' ? 1 : COMPONENT_FACTOR);
      matched.add(concept);
      reasons.push(why);
    };

    for (const concept of concepts) {
      const singular = concept.endsWith('s') && concept.length > 4 ? concept.slice(0, -1) : concept;
      const plural = `${concept}s`;
      const hits = (set: ReadonlySet<string>): boolean => set.has(concept) || set.has(singular) || set.has(plural);
      /**
       * Compound match within ONE signal class.
       *
       * It previously also consulted the shared component set regardless of which
       * class was being checked, so a component recovered from an identifier
       * satisfied the filename and category checks too — inflating the score and
       * emitting reasons that named a source which had contributed nothing.
       * Iterates the set directly; the old `[...set]` spread allocated an array on
       * every concept x class check.
       */
      const compoundIn = (set: ReadonlySet<string>): boolean => {
        for (const token of set) if (isCompoundOf(token, concept, vocabulary)) return true;
        return false;
      };

      if (hits(codeSet) || hits(exportSet)) {
        credit(concept, SIGNAL_WEIGHT.codeIdentifier, 'exact', `identifier ${concept}`);
        sawExecutable = true;
        // `componentSet` is derived from CODE tokens, so it belongs to this class alone.
      } else if (componentSet.has(concept) || compoundIn(codeSet) || compoundIn(exportSet)) {
        // `ALLOWLIST` yields `allow`: real executable signal, deliberately discounted.
        credit(concept, SIGNAL_WEIGHT.codeIdentifier, 'component', `identifier component ${concept}`);
        sawExecutable = true;
      }
      if (hits(categorySet)) {
        credit(concept, SIGNAL_WEIGHT.structuralCategory, 'exact', `category ${concept}`);
        sawStructural = true;
      } else if (compoundIn(categorySet)) {
        credit(concept, SIGNAL_WEIGHT.structuralCategory, 'component', `category component ${concept}`);
        sawStructural = true;
      }
      // An import is evidence about a DEPENDENCY, not about this file's purpose, so
      // it scores but never counts as executable purpose for the bonus.
      if (hits(importSet)) credit(concept, SIGNAL_WEIGHT.importOrLiteral, 'exact', `import ${concept}`);
      if (!GENERIC_TOKENS.has(concept)) {
        if (hits(nameSet)) credit(concept, SIGNAL_WEIGHT.filenameToken, 'exact', `filename token ${concept}`);
        else if (compoundIn(nameSet)) credit(concept, SIGNAL_WEIGHT.filenameToken, 'component', `filename component ${concept}`);
      }
      // Comments are a DISCOVERY hint only — enough to surface a file, never
      // enough to outrank what the code actually says.
      if (hits(commentSet)) {
        credit(concept, SIGNAL_WEIGHT.commentTerm, 'exact', `comment term ${concept}`);
        sawStructural = true;
      }
    }

    if (structural && entry.entryPoint) {
      score += SIGNAL_WEIGHT.structuralCategory;
      reasons.push(entry.entryPoint);
    }
    if (score === 0) continue;

    // ── Multi-concept bonus, bounded. ──
    // Satisfying two distinct concepts is qualitatively different from matching one
    // word twice: it is what separates the real guard-with-an-allowlist from the
    // dozen files that merely contain "guard" or merely contain "allow".
    if (matched.size >= 2) {
      let bonus = 1 + 0.5 * (matched.size - 1);
      if (sawExecutable && sawStructural) bonus += 0.25;
      score *= Math.min(bonus, MAX_CONCEPT_BONUS);
      reasons.push(`${matched.size} concepts matched${sawExecutable && sawStructural ? ' (code + structure)' : ''}`);
    }

    // Prefer the file that DEFINES a thing over a large file that merely mentions
    // it: a 4,000-line barrel matching one word is rarely the answer.
    ranked.push({ entry, exactNamed, score: score * roleWeight * focusFactor(entry.lineCount), reasons: [...new Set(reasons)].slice(0, 6) });
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
