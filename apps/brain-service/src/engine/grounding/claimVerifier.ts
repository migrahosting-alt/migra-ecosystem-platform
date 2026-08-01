/**
 * MigraAI Engine — claim-level grounding for repository answers.
 *
 * The agentic answer path asked the model, in prose, not to fabricate. That is an
 * instruction, not an enforcement: the same run that read one file could still emit
 * a confident paragraph about a second file it never opened, and nothing downstream
 * could tell the two apart. The failure is not that the model lies often — it is
 * that a grounded sentence and an invented one were the SAME KIND OF OBJECT.
 *
 * This module makes them different objects. Every repository-behaviour claim in an
 * answer is classified against {@link EvidenceLedger} — the record of what the run
 * actually retrieved — as exactly one of:
 *
 *   `direct_evidence`  cites a span we really retrieved, and every term it names
 *                      appears in the text of the cited source.
 *   `inference`        hedged reasoning over retrieved evidence. Kept, but never
 *                      allowed to read as fact: rendering labels it.
 *   `unsupported`      names something absent from the evidence, or asserts without
 *                      a source span. REMOVED from the answer.
 *
 * Four rules follow directly, and each is a test in `claimGrounding.test.ts`:
 *   - a filename alone is not evidence (a citation must resolve to a retrieved SPAN,
 *     not merely to a path a `find` happened to list);
 *   - an inspected file does not automatically support a claim (the claim's own
 *     vocabulary must appear in what was retrieved FROM THE CITED FILE);
 *   - inference must be labelled;
 *   - when nothing survives as direct evidence, the answer refuses and states the
 *     gap instead of narrating around it.
 *
 * PURE: no fs, no fetch, no model. © MigraTeck LLC.
 */

import {
  EvidenceLedger,
  extractCitations,
  normalizePath,
  termAppearsIn,
  type CitationRef,
  type EvidenceSpan,
} from './evidenceLedger.js';

export type ClaimKind = 'direct_evidence' | 'inference' | 'unsupported';

/** Why a claim is inference rather than evidence. */
export type InferenceBasis =
  /** The author hedged ("likely", "appears to"). */
  | 'hedged'
  /** Only a COMMENT in the cited file supports it — the code does not show it. */
  | 'comment';

export interface ClaimSource {
  path: string;
  startLine: number;
  endLine: number;
  excerptHash: string;
}

/** A claim that survived verification. Mirrors the branch's grounding contract. */
/**
 * How the claim's source span was located.
 *
 * `cited` — the answer wrote `path:line` and it resolved.
 * `derived` — the answer named a file the run had really read, and the gate
 *   resolved the span itself.
 *
 * Both are VERIFIED identically: the claim's vocabulary must be present in the
 * retrieved code of that file. The distinction exists because a model that
 * describes a file correctly but writes no line numbers has produced a grounded
 * answer with bad formatting, and deleting it would be the gate enforcing markdown
 * rather than truth. The line numbers on the claim are the ledger's, not the
 * model's, either way.
 */
export type SourceAnchor = 'cited' | 'derived';

export interface GroundedClaim {
  text: string;
  kind: 'direct_evidence' | 'inference';
  sources: ClaimSource[];
  confidence: 'high' | 'medium' | 'low';
  anchor: SourceAnchor;
  /** Set only on `inference`. */
  basis?: InferenceBasis;
}

export type RejectionReason =
  /** Named a term that appears nowhere in anything the run retrieved. */
  | 'term-absent-from-evidence'
  /** Asserted repository behaviour with no `path:line` span anywhere in its block. */
  | 'no-source-span'
  /** Cited a file/line the run never actually retrieved. */
  | 'citation-not-retrieved'
  /** The cited source is real, but does not contain the terms the claim names. */
  | 'term-not-in-cited-source'
  /** The cited source is real, but shares no vocabulary with the claim. */
  | 'citation-does-not-support'
  /** Showed code that is not literally present in any retrieved excerpt. */
  | 'code-not-in-evidence';

export interface RejectedClaim {
  text: string;
  reason: RejectionReason;
  /** The specific terms that could not be supported, when that was the reason. */
  terms: string[];
}

export interface VerifiedAnswer {
  /** The answer to emit — unsupported claims removed, inference labelled. */
  answer: string;
  claims: GroundedClaim[];
  rejected: RejectedClaim[];
  /** True when no claim survived as direct evidence. */
  refused: boolean;
  evidence: {
    readPaths: string[];
    spanCount: number;
    knownPathCount: number;
  };
}

/**
 * Technology nouns a language model reaches for when it describes a "typical"
 * architecture instead of the one in front of it.
 *
 * This is not a general vocabulary — it is the concrete failure mode already named
 * in the agentic system prompt ("might use Winston/Sentry/Kubernetes", "could be
 * Express"), promoted from an instruction the model may ignore into a check it
 * cannot. Membership only means the term must APPEAR in retrieved evidence; a
 * repository that genuinely uses Fastify cites Fastify and passes.
 */
const TECH_TERMS = new Set([
  'websocket', 'websockets', 'http', 'https', 'grpc', 'graphql', 'rest', 'sse', 'tcp', 'udp', 'mqtt', 'amqp', 'soap', 'rpc',
  'redis', 'postgres', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'sqlite', 'kafka', 'rabbitmq', 'elasticsearch',
  'docker', 'kubernetes', 'k8s', 'nginx', 'apache', 'traefik', 'terraform', 'ansible', 'helm',
  'express', 'fastify', 'koa', 'hapi', 'nestjs', 'django', 'flask', 'rails', 'spring',
  'winston', 'pino', 'bunyan', 'sentry', 'datadog', 'prometheus', 'grafana', 'opentelemetry', 'splunk',
  'webpack', 'vite', 'rollup', 'esbuild', 'babel', 'parcel', 'turbopack',
  'jest', 'mocha', 'vitest', 'jasmine', 'cypress', 'playwright', 'eslint', 'prettier',
  'oauth', 'oauth2', 'jwt', 'saml', 'ldap', 'openid',
  'lambda', 's3', 'dynamodb', 'cloudflare', 'vercel', 'netlify',
  'websocketserver', 'eventsource', 'graphene',
]);

/** Hedges that turn an assertion into reasoning ABOUT evidence. */
const HEDGES = [
  'likely', 'probably', 'presumably', 'apparently', 'seemingly', 'arguably',
  'appears to', 'appear to', 'seems to', 'seem to', 'suggests', 'suggesting', 'implies', 'implying',
  'i infer', 'we infer', 'inferred', 'inference', 'my reading', 'reading of',
  'may ', 'might ', 'could ', 'would ', 'presumed', 'assume', 'assuming',
  'typically', 'generally', 'usually', 'in principle', 'in effect', 'effectively',
];

/** Phrases that already announce a refusal — never overwritten by the gate. */
const REFUSAL_MARKERS = [
  'could not find', 'couldn’t find', "couldn't find", 'not find the',
  'insufficient', 'no evidence', 'not enough evidence', 'unable to answer',
  'cannot answer', 'did not find', 'no repository evidence',
];

const STOPWORDS = new Set([
  'that', 'this', 'these', 'those', 'with', 'from', 'into', 'onto', 'over', 'under', 'when', 'then', 'than',
  'they', 'them', 'their', 'there', 'here', 'have', 'has', 'had', 'been', 'being', 'does', 'done', 'will',
  'shall', 'must', 'also', 'only', 'just', 'each', 'every', 'both', 'some', 'any', 'all', 'not', 'never',
  'always', 'which', 'what', 'where', 'while', 'because', 'about', 'above', 'below', 'after', 'before',
  'file', 'files', 'code', 'line', 'lines', 'used', 'uses', 'using', 'make', 'makes', 'made', 'like',
  'such', 'more', 'most', 'other', 'same', 'very', 'thus', 'therefore', 'however', 'answer', 'question',
]);

/**
 * Content words above which a sentence naming no identifier is still a CLAIM.
 *
 * Calibrated on the boundary that matters: connectives an answer needs ("Here is
 * what I found, in short." → 2) sit below it, assertions about behaviour ("It
 * throttles inbound requests to twenty per minute." → 5) sit above. A heuristic,
 * and stated as one — but erring toward checking is the correct direction for a
 * gate whose whole purpose is to stop confident prose from passing unexamined.
 */
const SUBSTANTIVE_WORD_COUNT = 4;

export interface RepoTerm {
  value: string;
  kind: 'path' | 'identifier' | 'tech' | 'code';
}

/** Paths with a code/config extension, e.g. `services/brainTransport.ts`. */
const PATH_TERM_RE =
  /(?<![\w/])((?:[\w.@-]+\/)*[\w.@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|ya?ml|toml|ini|sh|bash|zsh|py|rb|go|rs|java|kt|cs|php|sql|css|scss|html|env|lock|txt|xml|proto|prisma))(?![\w])/g;

/**
 * Identifiers with a case or underscore transition.
 *
 * The transition is the whole point: it is what separates a name the repository
 * chose (`brainTransport`, `runBrainOperation`, `tool_calls`, `BRAIN_MARKERS`) from
 * an ordinary English word, so the check can be strict without shredding prose.
 */
const IDENT_TERM_RE =
  /(?<![\w$.])(?:[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![\w$])/g;

/** Non-global twin of {@link PATH_TERM_RE} — `.test()` on a /g regex is stateful. */
const PATH_TERM_TEST = new RegExp(PATH_TERM_RE.source);

/** Strip a trailing `:12` / `:12-40` so a cited path is checked as a path. */
function stripCitationSuffix(s: string): string {
  return s.replace(/\s*:\s*\d{1,6}(?:\s*[-–—]\s*\d{1,6})?\s*$/, '');
}

/** Strip decoration a model adds around a code term: `fetch()`, `#hash`, quotes. */
function cleanCodeTerm(s: string): string {
  return s.trim().replace(/\(\s*\)$/, '').replace(/[.,;:]+$/, '').replace(/^['"`]|['"`]$/g, '');
}

/**
 * Every term in a fragment that names something in the repository.
 *
 * Only these are fact-checked. A sentence naming nothing ("Here is what it does:")
 * cannot fabricate a repository fact and is passed through as narrative.
 */
export function extractRepoTerms(text: string): RepoTerm[] {
  const out: RepoTerm[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind: RepoTerm['kind']): void => {
    const value = cleanCodeTerm(raw);
    if (!value || value.length < 3) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value, kind });
  };

  // 1. Backticked spans — the model's own marker for "this is code, not prose".
  for (const m of text.matchAll(/`([^`\n]{1,200})`/g)) {
    const inner = stripCitationSuffix(m[1]!).trim();
    if (!inner) continue;
    if (PATH_TERM_TEST.test(inner)) {
      for (const p of inner.matchAll(PATH_TERM_RE)) push(p[1]!, 'path');
      continue;
    }
    push(inner, 'code');
  }

  // 2. Paths, then identifiers in what is LEFT once paths are masked out. Without
  //    the mask, `src/authValidator.ts` also yields a bare `authValidator`
  //    identifier, which no file contains — the path check would then reject every
  //    correctly-cited claim for naming its own citation.
  const masked = text.replace(PATH_TERM_RE, (m) => {
    push(m, 'path');
    return ' '.repeat(m.length);
  });
  for (const m of masked.matchAll(IDENT_TERM_RE)) push(m[0]!, 'identifier');

  // 3. Technology nouns from the fabrication-prone lexicon.
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]{2,}/g)) {
    const w = m[0]!.toLowerCase();
    if (TECH_TERMS.has(w)) push(m[0]!, 'tech');
  }
  return out;
}

/** Reduce a word to a crude stem so `walks`/`walk` and `collects`/`collect` match. */
function stem(word: string): string {
  const w = word.toLowerCase();
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ies', 'ers', 'er', 'es', 'ed', 's']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) return w.slice(0, w.length - suffix.length);
  }
  return w;
}

/** Content words that carry the meaning of a claim (for overlap with a source). */
function contentWords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]{3,}/g)) {
    const w = m[0]!.toLowerCase();
    if (!STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

function isHedged(text: string): boolean {
  const lower = ' ' + text.toLowerCase() + ' ';
  return HEDGES.some((h) => lower.includes(h.startsWith(' ') ? h : ' ' + h));
}

function looksLikeRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSAL_MARKERS.some((m) => lower.includes(m));
}

// ── Segmentation ────────────────────────────────────────────────────────────────

type SegmentKind = 'prose' | 'code' | 'blank';

interface Block {
  kind: SegmentKind;
  /** Original lines, verbatim, so rendering preserves markdown structure. */
  lines: string[];
  /** Every `path:line` reference anywhere in the block. */
  citations: CitationRef[];
  /** Files named anywhere in the block, whether or not they were retrieved. */
  namedPaths: string[];
}

/** What a sentence may anchor to: explicit citations, else named-file fallbacks. */
interface Anchors {
  citations: CitationRef[];
  derivedPaths: string[];
}

/** Split an answer into blocks: fenced code, blank runs, and paragraphs. */
function toBlocks(answer: string): Block[] {
  const lines = answer.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      const buf = [line];
      i += 1;
      while (i < lines.length) {
        buf.push(lines[i]!);
        const closed = /^\s*```/.test(lines[i]!);
        i += 1;
        if (closed) break;
      }
      blocks.push({ kind: 'code', lines: buf, citations: [], namedPaths: [] });
      continue;
    }
    if (!line.trim()) {
      const buf: string[] = [];
      while (i < lines.length && !lines[i]!.trim()) {
        buf.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'blank', lines: buf, citations: [], namedPaths: [] });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*```/.test(lines[i]!)) {
      buf.push(lines[i]!);
      i += 1;
    }
    const text = buf.join('\n');
    blocks.push({
      kind: 'prose',
      lines: buf,
      citations: extractCitations(text),
      namedPaths: extractRepoTerms(text).filter((t) => t.kind === 'path').map((t) => t.value),
    });
  }
  return blocks;
}

/** Leading markdown furniture on a line: indent, bullet, number, quote, heading. */
const LINE_PREFIX_RE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+|#{1,6}\s+)?)([\s\S]*)$/;

/**
 * Split a line's body into sentences without cutting inside `path.ext:12`.
 *
 * `(` is deliberately NOT a sentence opener: a trailing `(\`src/a.ts:12\`)` is the
 * citation FOR the sentence before it, and splitting it off turned every citation
 * into a standalone claim whose only content was the path it named.
 */
function toSentences(body: string): string[] {
  const parts = body.split(/(?<=[.!?;:])\s+(?=[A-Z`*_\-•])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Text with citations, paths and backticked spans removed — the prose that is left. */
function bareProse(text: string): string {
  return text
    .replace(/`[^`\n]*`/g, ' ')
    .replace(PATH_TERM_RE, ' ')
    .replace(/[(){}[\]]/g, ' ');
}

// ── Verification ────────────────────────────────────────────────────────────────

interface SentenceVerdict {
  /** `narrative` names nothing in the repository, so there is nothing to check. */
  kind: ClaimKind | 'narrative';
  reason?: RejectionReason;
  /** Why this is inference: the author hedged, or only a comment supports it. */
  basis?: InferenceBasis;
  anchor?: SourceAnchor;
  terms: string[];
  sources: ClaimSource[];
  confidence: 'high' | 'medium' | 'low';
}

function toSource(span: EvidenceSpan): ClaimSource {
  return { path: span.path, startLine: span.startLine, endLine: span.endLine, excerptHash: span.excerptHash };
}

/** Classify one sentence against the ledger, given what its block may anchor to. */
function verifySentence(sentence: string, ledger: EvidenceLedger, anchors: Anchors): SentenceVerdict {
  const citations = anchors.citations;
  const terms = extractRepoTerms(sentence);
  const hedged = isHedged(sentence);

  // What counts as narrative rather than a claim.
  //
  // A bare citation or a lone code span asserts nothing. Neither does a short
  // connective ("Here is what I found, in short."). But a sentence like "It
  // throttles inbound requests to twenty per minute" names no identifier at all and
  // is still a hard factual claim about the file under discussion — treating it as
  // narrative because it happens to be written in plain English would let the
  // easiest kind of fabrication straight through.
  const prose = contentWords(bareProse(sentence));
  const substantive = terms.length > 0 || prose.length >= SUBSTANTIVE_WORD_COUNT;
  if (!substantive || prose.length === 0) {
    return { kind: 'narrative', terms: [], sources: [], confidence: 'low' };
  }

  // Rule 1 — a term the run never retrieved, anywhere, is fabrication.
  const absent = terms.filter((t) => !ledger.mentions(t.value));
  if (absent.length > 0) {
    return { kind: 'unsupported', reason: 'term-absent-from-evidence', terms: absent.map((t) => t.value), sources: [], confidence: 'low' };
  }

  const explicit = citations.flatMap((c) => ledger.resolve(c));

  // An explicit citation that points at something the run never retrieved is a hard
  // failure — a derived fallback must never rescue a claim whose own citation is
  // wrong, or the gate would be quietly correcting the model's references.
  if (citations.length > 0 && explicit.length === 0) {
    return {
      kind: 'unsupported',
      reason: 'citation-not-retrieved',
      terms: citations.map((c) => `${c.path}:${c.startLine}`),
      sources: [],
      confidence: 'low',
    };
  }

  const usingCitation = explicit.length > 0;
  const anchorPaths = usingCitation ? citations.map((c) => c.path) : anchors.derivedPaths;
  const anchorSpans = usingCitation ? explicit : anchorPaths.flatMap((p) => ledger.spansFor(p));
  const anchor: SourceAnchor = usingCitation ? 'cited' : 'derived';

  // Inference is reasoning OVER evidence: it needs its vocabulary to exist, and it
  // needs a label, but it does not need to point at a line. Labelling happens in
  // rendering; classification happens here.
  if (hedged) {
    return {
      kind: 'inference',
      basis: 'hedged',
      anchor,
      terms: terms.map((t) => t.value),
      sources: anchorSpans.map(toSource),
      confidence: anchorSpans.length ? 'medium' : 'low',
    };
  }

  // Rule 2 — an unhedged repository claim must resolve to a real retrieved span,
  // either from its own citation or from a file it names that the run actually read.
  if (anchorSpans.length === 0) {
    return { kind: 'unsupported', reason: 'no-source-span', terms: terms.map((t) => t.value), sources: [], confidence: 'low' };
  }

  // Rule 3 — the anchored source must actually contain what the claim names.
  // Opening a file does not license every sentence that follows it.
  const citedPaths = new Set(anchorPaths.map((p) => normalizePath(p).toLowerCase()));
  const citedText = anchorSpans.map((s) => s.text).join('\n').toLowerCase();
  const isCitedPath = (t: RepoTerm): boolean => {
    if (t.kind !== 'path') return false;
    const v = normalizePath(t.value).toLowerCase();
    for (const p of citedPaths) if (p === v || p.endsWith('/' + v) || v.endsWith('/' + p)) return true;
    return false;
  };
  const foreign = terms.filter((t) => !isCitedPath(t) && !termAppearsIn(citedText, t.value));
  if (foreign.length > 0) {
    return { kind: 'unsupported', reason: 'term-not-in-cited-source', terms: foreign.map((t) => t.value), sources: [], confidence: 'low' };
  }

  // Rule 4 — the claim must share vocabulary with the source it points at, and
  // with the EXECUTABLE part of it. A comment is a claim about the code, so a
  // sentence that only echoes a comment is evidence about the documentation, not
  // about the behaviour, and it is demoted to labelled inference rather than
  // presented as fact. This is what a stale header comment costs.
  const codeText = anchorSpans.map((s) => s.codeText).join('\n').toLowerCase();
  const commentText = anchorSpans.map((s) => s.commentText).join('\n').toLowerCase();
  const stems = contentWords(sentence).map(stem).filter((s) => s.length >= 3);
  const codeOverlap = new Set(stems.filter((s) => codeText.includes(s)));
  if (codeOverlap.size === 0) {
    const commentOverlap = stems.filter((s) => commentText.includes(s));
    if (commentOverlap.length > 0) {
      return {
        kind: 'inference',
        basis: 'comment',
        anchor,
        terms: terms.map((t) => t.value),
        sources: anchorSpans.map(toSource),
        confidence: 'low',
      };
    }
    return { kind: 'unsupported', reason: 'citation-does-not-support', terms: terms.map((t) => t.value), sources: [], confidence: 'low' };
  }

  return {
    kind: 'direct_evidence',
    anchor,
    terms: terms.map((t) => t.value),
    sources: anchorSpans.map(toSource),
    confidence: codeOverlap.size >= 3 ? 'high' : 'medium',
  };
}

/** A fenced block is only allowed to show code the run literally retrieved. */
function verifyCodeBlock(block: Block, ledger: EvidenceLedger): { ok: boolean; missing: string[] } {
  const body = block.lines.slice(1, Math.max(1, block.lines.length - 1));
  const corpus = ledger.spans.map((s) => s.text).join('\n').toLowerCase();
  const missing: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line.length < 4) continue; // `}`/`{`/`);` carry no claim
    if (!corpus.includes(line.toLowerCase())) missing.push(line.slice(0, 80));
  }
  return { ok: missing.length === 0, missing };
}

export interface VerifyOptions {
  /** The question, used only to phrase the gap statement. */
  question?: string;
}

/**
 * Verify an answer against the evidence the run actually gathered.
 *
 * Returns the answer to emit — not the answer the model wrote. Unsupported claims
 * are removed rather than annotated, because an annotated fabrication is still on
 * screen, and a reader who skims sees the claim and not the warning.
 */
export function verifyAnswer(raw: string, ledger: EvidenceLedger, opts: VerifyOptions = {}): VerifiedAnswer {
  const blocks = toBlocks(raw ?? '');
  const claims: GroundedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const rendered: string[] = [];
  let sawRefusal = false;
  /**
   * The file currently under discussion, carried forward across blocks.
   *
   * Prose refers back: "It scans every `.ts` file" belongs to whatever was last
   * named, and requiring each sentence to re-name its subject would reject ordinary
   * writing. Inheritance only supplies the ANCHOR — the claim's vocabulary still has
   * to be in that file's retrieved code, so a sentence that has drifted onto a
   * different subject fails rule 3 or 4 rather than borrowing the wrong evidence.
   */
  let carriedPaths: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'blank') {
      rendered.push(block.lines.join('\n'));
      continue;
    }
    if (block.kind === 'code') {
      const { ok, missing } = verifyCodeBlock(block, ledger);
      if (ok) rendered.push(block.lines.join('\n'));
      else rejected.push({ text: missing.join(' / ').slice(0, 200), reason: 'code-not-in-evidence', terms: missing });
      continue;
    }

    // Only files the run really READ can anchor anything; a name we merely saw in a
    // `find` listing is not evidence, so it never becomes the subject.
    const retrievedHere = [...new Set([...block.namedPaths, ...block.citations.map((c) => c.path)])].filter((p) => ledger.spansFor(p).length > 0);
    if (retrievedHere.length) carriedPaths = retrievedHere;
    const anchors: Anchors = { citations: block.citations, derivedPaths: carriedPaths };

    const keptLines: string[] = [];
    for (const line of block.lines) {
      const m = LINE_PREFIX_RE.exec(line)!;
      const prefix = m[1]!;
      const body = m[2]!;
      if (looksLikeRefusal(body)) sawRefusal = true;
      const kept: string[] = [];
      for (const sentence of toSentences(body)) {
        const verdict = verifySentence(sentence, ledger, anchors);
        if (verdict.kind === 'narrative') {
          kept.push(sentence);
          continue;
        }
        if (verdict.kind === 'unsupported') {
          rejected.push({ text: sentence, reason: verdict.reason!, terms: verdict.terms });
          continue;
        }
        claims.push({
          text: sentence,
          kind: verdict.kind,
          sources: verdict.sources,
          confidence: verdict.confidence,
          anchor: verdict.anchor ?? 'derived',
          ...(verdict.basis ? { basis: verdict.basis } : {}),
        });
        // Rule — inference must be VISIBLE, per sentence. Labelling the block would
        // leave a hedged sentence sitting unmarked among evidenced ones.
        kept.push(verdict.kind === 'inference' ? labelInference(sentence, verdict.basis ?? 'hedged') : sentence);
      }
      if (kept.length) keptLines.push(prefix + kept.join(' '));
    }
    if (keptLines.length) rendered.push(keptLines.join('\n'));
  }

  const directClaims = claims.filter((c) => c.kind === 'direct_evidence');
  const body = rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const refused = directClaims.length === 0 && !sawRefusal;

  const evidence = {
    readPaths: ledger.readPaths,
    spanCount: ledger.spans.length,
    knownPathCount: ledger.knownPaths.length,
  };

  if (refused) {
    return { answer: gapStatement(ledger, rejected, claims, opts.question), claims, rejected, refused, evidence };
  }
  const disclosure = rejected.length ? '\n\n' + removalNote(rejected) : '';
  return { answer: (body || gapStatement(ledger, rejected, claims, opts.question)) + disclosure, claims, rejected, refused, evidence };
}

/** Visible marks for reasoning. Distinct texts: the two failure modes differ. */
export const INFERENCE_LABEL = '_(inference — not directly evidenced)_';
export const COMMENT_INFERENCE_LABEL = '_(inference — states what a comment says; the retrieved code does not show it)_';

function labelInference(sentence: string, basis: InferenceBasis): string {
  const label = basis === 'comment' ? COMMENT_INFERENCE_LABEL : INFERENCE_LABEL;
  // A comment-only claim is always labelled: the sentence hedging its own wording
  // says nothing about whether the CODE backs it.
  if (basis === 'hedged' && /\binfer(?:ence|red|s|ring)?\b/i.test(sentence)) return sentence;
  return `${label} ${sentence}`;
}

/**
 * Disclose what was removed, without re-publishing it.
 *
 * Naming an unsupported TERM is a negation ("`Prometheus` never appeared"), which
 * is safe to show. Reprinting a rejected code block is not: the fabricated snippet
 * would be back on screen, in a monospace font, immediately under the answer.
 */
/** What each rejection reason actually means, in the disclosure's own words. */
const REASON_WORDING: Record<RejectionReason, string> = {
  'term-absent-from-evidence': 'never appeared in anything this run retrieved',
  'no-source-span': 'named no file this run had read',
  'citation-not-retrieved': 'cited a file or line range this run never retrieved',
  'term-not-in-cited-source': 'appeared elsewhere, but not in the source the claim pointed at',
  'citation-does-not-support': 'pointed at a real source that says nothing about the claim',
  'code-not-in-evidence': '',
};

function removalNote(rejected: RejectedClaim[]): string {
  const codeBlocks = rejected.filter((r) => r.reason === 'code-not-in-evidence').length;
  const parts = [`> ⚠️ Grounding gate: ${rejected.length} statement(s) were removed because the evidence gathered in this run does not support them.`];
  // Grouped BY REASON. A single "never appeared" line covering every rejection was
  // itself an unsupported claim: a sentence dropped for missing a source span names
  // terms that were, in fact, right there in the evidence.
  const byReason = new Map<RejectionReason, Set<string>>();
  for (const r of rejected) {
    if (r.reason === 'code-not-in-evidence') continue;
    const set = byReason.get(r.reason) ?? new Set<string>();
    for (const t of r.terms) set.add(t);
    byReason.set(r.reason, set);
  }
  for (const [reason, terms] of byReason) {
    const listed = [...terms].slice(0, 6);
    if (!listed.length) continue;
    parts.push(`${listed.map((t) => `\`${t}\``).join(', ')} — ${REASON_WORDING[reason]}.`);
  }
  if (codeBlocks) parts.push(`${codeBlocks} code block(s) were removed as not present verbatim in any retrieved excerpt.`);
  return parts.join(' ');
}

/** Say what was retrieved and what is missing — never narrate around the gap. */
function gapStatement(
  ledger: EvidenceLedger,
  rejected: RejectedClaim[],
  claims: GroundedClaim[],
  question?: string,
): string {
  const lines: string[] = [];
  lines.push(
    question
      ? `I could not support an answer to **${question.trim().slice(0, 200)}** with evidence I actually retrieved in this run.`
      : 'I could not support an answer with evidence I actually retrieved in this run.',
  );
  lines.push('');
  if (ledger.readPaths.length) {
    lines.push('Content I did retrieve:');
    for (const p of ledger.readPaths.slice(0, 12)) {
      const spans = ledger.spansFor(p);
      const ranges = spans.slice(0, 4).map((s) => `${s.startLine}-${s.endLine}`).join(', ');
      lines.push(`- \`${p}\` (lines ${ranges})`);
    }
  } else if (ledger.knownPaths.length) {
    lines.push('I located these paths but read none of them, so I have no content to answer from:');
    for (const p of ledger.knownPaths.slice(0, 12)) lines.push(`- \`${p}\``);
  } else {
    lines.push('No workspace content was retrieved in this run.');
  }
  if (rejected.length) {
    lines.push('');
    lines.push(removalNote(rejected));
  }
  const inferences = claims.filter((c) => c.kind === 'inference');
  if (inferences.length) {
    lines.push('');
    lines.push('Unverified inference (reasoning, not evidence):');
    for (const c of inferences.slice(0, 5)) lines.push(`- ${labelInference(c.text, c.basis ?? 'hedged')}`);
  }
  return lines.join('\n');
}
