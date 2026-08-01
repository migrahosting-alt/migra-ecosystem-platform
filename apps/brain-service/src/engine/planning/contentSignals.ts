/**
 * MigraAI Engine — deterministic content signals for candidate RANKING.
 *
 * The measured defect: asked "What does the guard allow?", the planner ranked 26
 * candidates, opened seven, and returned a fully grounded answer about an ops
 * allowlist, some auth guards and a mail-guardrails deploy script. Every citation
 * was real. The answer was still useless, because the file that actually answers
 * the question — `check-brain-transport.mjs` — scored ZERO and was never ranked at
 * all. It exports nothing, and its filename contains neither word.
 *
 * That is a subject-selection failure, not a grounding failure, and it is not
 * fixable by looking harder at filenames. The words are in the file:
 *
 *     line  2  // Structural anti-bypass guard …      ← comment
 *     line 17  const ALLOWLIST = new Set([            ← executable
 *
 * So the map carries what the source deterministically says about itself:
 * identifiers, imports, string literals, comment terms and structural categories.
 *
 * ┌─ THE BOUNDARY ────────────────────────────────────────────────────────────┐
 * │ These signals may decide WHICH FILES TO OPEN. They may never become        │
 * │ evidence. No signal, category, token or score explanation is written to    │
 * │ the ledger, rendered into the EVIDENCE block, or citable in an answer. A   │
 * │ ranking match justifies a read; only an opened span justifies a claim.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Everything here is derived from the source text by fixed rules — no model, no
 * summary, no paraphrase. © MigraTeck LLC.
 */

import { splitCodeAndComments } from '../grounding/evidenceLedger.js';

/** Compact, per-file signals. Never source bodies. */
export interface ContentSignals {
  /** Top-level declared names, verbatim (`ALLOWLIST`, `runBrainOperation`). */
  identifiers: string[];
  /** Module specifiers this file imports. */
  imports: string[];
  /** Selected string literals — bounded in count and length. */
  stringLiterals: string[];
  /** Tokens drawn from comments and headings. Discovery hints, never behaviour. */
  commentTerms: string[];
  /** Deterministic categories, from several signal sources rather than filenames. */
  structuralCategories: string[];
  /** Normalised token sets used for scoring, deduplicated. */
  tokens: {
    /** From executable text: identifiers and string literals. */
    code: string[];
    /** From comments and headings only. */
    comment: string[];
    /** From the path and filename. */
    name: string[];
  };
  /**
   * Parts recovered from run-together compounds (`allowlist` → `allow`, `list`).
   *
   * Kept SEPARATE from exact tokens so a file that merely contains `allow` inside
   * a longer word scores below one that says `allow` outright — and so
   * `guardrails` stays distinguishable from an exact `guard`.
   */
  componentTokens: string[];
}

export const EMPTY_SIGNALS: ContentSignals = {
  identifiers: [],
  imports: [],
  stringLiterals: [],
  commentTerms: [],
  structuralCategories: [],
  tokens: { code: [], comment: [], name: [] },
  componentTokens: [],
};

/** Caps so a map entry stays small regardless of file size. */
const MAX_IDENTIFIERS = 80;
const MAX_LITERALS = 40;
const MAX_COMMENT_TERMS = 60;
const MAX_TOKENS = 120;
const MIN_TOKEN_LENGTH = 3;
const MAX_LITERAL_LENGTH = 60;

/**
 * Directory and scaffolding words that describe where a file lives, not what it
 * does. They match thousands of files and therefore separate nothing.
 */
export const GENERIC_TOKENS = new Set([
  'apps', 'app', 'src', 'lib', 'libs', 'packages', 'package', 'services', 'service',
  'test', 'tests', 'spec', 'extension', 'extensions', 'scripts', 'script', 'infra',
  'dist', 'build', 'out', 'index', 'main', 'common', 'utils', 'util', 'core',
  'shared', 'types', 'type', 'node', 'modules', 'module', 'code', 'file', 'files',
  'data', 'temp', 'tmp', 'new', 'old', 'copy', 'default', 'base', 'helper', 'helpers',
]);

/** Top-level declarations. Deliberately shallow: names, not bodies. */
const DECLARATION_RE =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?(?:abstract[ \t]+)?(?:const|let|var|function|class|interface|type|enum)[ \t]+([A-Za-z_$][\w$]*)/g;
const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)[^'"\n]*from[ \t]*['"]([^'"\n]+)['"]|require\([ \t]*['"]([^'"\n]+)['"][ \t]*\)/g;
const LITERAL_RE = /'([^'\n\\]{3,60})'|"([^"\n\\]{3,60})"/g;

/**
 * Split an identifier or filename into its normalised parts.
 *
 * Case and separator boundaries only — `checkBrainTransport` → check, brain,
 * transport; `mutation-guard` → mutation, guard. Compound words with no boundary
 * (`ALLOWLIST`) survive whole here and are decomposed later, against a vocabulary
 * the repository itself supplies.
 */
export function splitToken(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+|\s+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= MIN_TOKEN_LENGTH && !/^\d+$/.test(p));
}

/**
 * Decompose a run-together lowercase word into vocabulary parts.
 *
 * The vocabulary is built FROM THE REPOSITORY, not curated: any part that appears
 * on its own somewhere in the tree can be a component elsewhere. That is what lets
 * `allowlist` decompose into `allow` + `list` while `guardian` does not decompose
 * at all — because `ian` is not a word this repository uses.
 *
 * Parts must be at least 4 characters, so a query for "guard" can never be
 * satisfied by slicing an unrelated word into fragments.
 */
export function decompose(word: string, vocabulary: ReadonlySet<string>): string[] {
  const w = word.toLowerCase();
  if (w.length < 8) return [];
  const MIN_PART = 4;
  // Shortest segmentation wins: fewer, longer parts are the likelier reading.
  const best: Array<string[] | null> = new Array(w.length + 1).fill(null);
  best[0] = [];
  for (let end = MIN_PART; end <= w.length; end += 1) {
    for (let start = 0; start + MIN_PART <= end; start += 1) {
      const prefix = best[start];
      if (!prefix) continue;
      const part = w.slice(start, end);
      if (!vocabulary.has(part)) continue;
      const candidate = [...prefix, part];
      const current = best[end];
      if (!current || candidate.length < current.length) best[end] = candidate;
    }
  }
  const whole = best[w.length];
  return whole && whole.length >= 2 ? whole : [];
}

/**
 * Categories a file plausibly belongs to.
 *
 * Assigned from EXACT tokens across several signal sources, never from a filename
 * substring. That distinction is the whole point: `deploy-guardian-migration.sh`
 * ranked joint-third for "guard" purely because its name contains those letters.
 * `guardian` is not `guard`, and this table will not pretend otherwise.
 */
const CATEGORY_RULES: Array<{ category: string; tokens: string[] }> = [
  { category: 'guard', tokens: ['guard', 'guards', 'bypass', 'enforce', 'forbid', 'disallow'] },
  { category: 'allowlist', tokens: ['allowlist', 'allowlists', 'denylist', 'blocklist', 'permitted', 'whitelist'] },
  { category: 'validator', tokens: ['validate', 'validator', 'validation', 'schema', 'assert'] },
  { category: 'router', tokens: ['router', 'route', 'routes', 'routing', 'dispatch'] },
  { category: 'transport', tokens: ['transport', 'fetch', 'request', 'http', 'socket'] },
  { category: 'persistence', tokens: ['store', 'repository', 'persist', 'database', 'ledger'] },
  { category: 'policy', tokens: ['policy', 'policies', 'rule', 'rules', 'governance'] },
  { category: 'security', tokens: ['security', 'secret', 'credential', 'auth', 'token', 'redact'] },
  { category: 'migration', tokens: ['migration', 'migrate', 'migrations'] },
];

function addTokens(into: Set<string>, raw: string): void {
  for (const part of splitToken(raw)) into.add(part);
}

/** First pass: the vocabulary a repository uses, for later decomposition. */
export function buildVocabulary(sources: Iterable<string>): Set<string> {
  const vocab = new Set<string>();
  for (const raw of sources) {
    for (const part of splitToken(raw)) if (part.length >= 4) vocab.add(part);
  }
  return vocab;
}

export interface ExtractInput {
  path: string;
  text: string;
  role: string;
}

/** Extract raw signals from one file. Vocabulary-independent; see {@link finalizeSignals}. */
export function extractSignals(input: ExtractInput): ContentSignals {
  const { code, comments } = splitCodeAndComments(input.path, input.text);

  const identifiers: string[] = [];
  for (const m of code.matchAll(DECLARATION_RE)) {
    if (identifiers.length >= MAX_IDENTIFIERS) break;
    identifiers.push(m[1]!);
  }
  const imports: string[] = [];
  for (const m of input.text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    if (spec && imports.length < MAX_IDENTIFIERS) imports.push(spec);
  }
  const stringLiterals: string[] = [];
  for (const m of code.matchAll(LITERAL_RE)) {
    const lit = (m[1] ?? m[2] ?? '').trim();
    if (!lit || lit.length > MAX_LITERAL_LENGTH) continue;
    if (!/[A-Za-z]{3}/.test(lit)) continue; // punctuation/format strings carry no signal
    if (stringLiterals.length < MAX_LITERALS) stringLiterals.push(lit);
  }

  const commentTermSet = new Set<string>();
  for (const word of comments.split(/[^A-Za-z0-9_$-]+/)) {
    if (commentTermSet.size >= MAX_COMMENT_TERMS) break;
    for (const part of splitToken(word)) commentTermSet.add(part);
  }

  const codeTokens = new Set<string>();
  for (const id of identifiers) addTokens(codeTokens, id);
  for (const lit of stringLiterals) addTokens(codeTokens, lit);
  const nameTokens = new Set<string>();
  addTokens(nameTokens, input.path);

  return {
    identifiers,
    imports,
    stringLiterals,
    commentTerms: [...commentTermSet],
    structuralCategories: [],
    componentTokens: [],
    tokens: {
      code: [...codeTokens].slice(0, MAX_TOKENS),
      comment: [...commentTermSet].slice(0, MAX_TOKENS),
      name: [...nameTokens].slice(0, MAX_TOKENS),
    },
  };
}

/**
 * Second pass: decompose compounds against the repository vocabulary and assign
 * categories. Components are kept SEPARATE from exact tokens so scoring can weigh
 * `ALLOWLIST`-contains-`allow` below a file that says `allow` outright.
 */
export function finalizeSignals(signals: ContentSignals, role: string, vocabulary: ReadonlySet<string>): ContentSignals {
  const components = new Set<string>();
  for (const token of [...signals.tokens.code, ...signals.tokens.name, ...signals.tokens.comment]) {
    for (const part of decompose(token, vocabulary)) components.add(part);
  }

  // Categories are decided on EXACT tokens plus decomposed components, never on a
  // filename substring.
  const exact = new Set([...signals.tokens.code, ...signals.tokens.name, ...signals.tokens.comment]);
  const categories = new Set<string>();
  for (const rule of CATEGORY_RULES) {
    if (rule.tokens.some((t) => exact.has(t))) categories.add(rule.category);
  }
  if (role === 'test') categories.add('test');

  return { ...signals, structuralCategories: [...categories], componentTokens: [...components].slice(0, MAX_TOKENS) };
}
