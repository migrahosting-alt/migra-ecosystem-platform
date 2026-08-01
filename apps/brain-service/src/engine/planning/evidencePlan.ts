/**
 * MigraAI Engine — bounded repository evidence planning.
 *
 * The loop this replaces worked, and was ruinous: a correct small-scope answer took
 * 305s over 8 model calls, 99% of it inference, because every call carried the
 * whole accumulating transcript plus every file body seen so far — 1,906 units
 * growing to 8,704 — and the model spent most of those calls rediscovering by
 * search what a map could have told it in 76ms. `brainTransport.ts` was read four
 * times.
 *
 * The plan here is deliberately short and deterministic:
 *
 *   question → rank the map → open a small candidate set → answer from the ledger
 *            → verify → expand ONCE, and only for a gap the verifier actually named
 *
 * Two properties matter more than the speed:
 *
 *  - Context is REBUILT, never appended. Each call gets the question, a routing
 *    digest, the deduplicated evidence, and the named gaps. There is no transcript,
 *    so there is nothing to grow.
 *  - Compaction never summarises source. Evidence is carried as exact spans with
 *    their real line ranges and hashes, because the grounding gate downstream
 *    checks claims against those spans — a paraphrase would quietly turn verified
 *    evidence into an unverifiable assertion.
 *
 * The model gets NO exploration tools on this path. Its one lever is to name a gap;
 * resolving it is the planner's job, and it is bounded. © MigraTeck LLC.
 */

import { verifyAnswer, type VerifiedAnswer } from '../grounding/claimVerifier.js';
import { EvidenceLedger, normalizePath, type EvidenceSource } from '../grounding/evidenceLedger.js';
import type { AnswerTimeline, CallPhase, RunPhase } from '../answerTimings.js';
import { BudgetLedger, type EvidenceBudget, type BudgetSpend, type StopReason } from './evidenceBudget.js';
import { aboveRelevanceFloor, importNeighbours, rankCandidates, type RankedCandidate } from './candidateRanking.js';
import { describeCandidates, type RepoMap, type RepoMapEntry } from './repoMap.js';

/** Lines opened from a candidate on the first pass. */
const INITIAL_SPAN_LINES = 400;
/** Lines opened when a gap sends us back to a file we already hold. */
const EXPANSION_SPAN_LINES = 900;

export interface PlanMessage {
  role: 'system' | 'user';
  content: string;
}

/** Calls the model. Injected so the whole plan is testable without one. */
export type PlanModelCaller = (messages: PlanMessage[], phase: CallPhase) => Promise<string>;

/** Opens a workspace file range. Injected so the plan stays free of fs and policy. */
export type SpanOpener = (relPath: string, startLine: number, endLine: number) => EvidenceSource;

/**
 * Progress the plan emits while it runs.
 *
 * Structurally a subset of the agentic event union, so the caller can `yield*` the
 * plan straight into its own stream: opening eight files takes ~10ms, but the model
 * calls between them take tens of seconds, and a plan that reported nothing until
 * it finished would read as a hang.
 */
export type PlanEvent =
  | { type: 'phase'; phase: RunPhase }
  | { type: 'step'; step: { tool: string; args: Record<string, unknown>; ok: boolean; summary: string } };

export interface EvidencePlanOptions {
  question: string;
  map: RepoMap;
  ledger: EvidenceLedger;
  timeline: AnswerTimeline;
  budget: EvidenceBudget;
  callModel: PlanModelCaller;
  openSpan: SpanOpener;
}

export interface EvidencePlanResult {
  rawAnswer: string;
  verified: VerifiedAnswer;
  stopReason: StopReason;
  spend: BudgetSpend;
  /** Ranked candidates considered, for the run report. */
  candidates: Array<{ path: string; score: number; reasons: string[] }>;
  /** Files whose content was opened, in order. */
  opened: string[];
  /** Gaps the verifier or the model named, and whether they were resolved. */
  gaps: Array<{ token: string; resolvedTo?: string; source: 'model' | 'verifier' }>;
  /** True when the map could not route this question and exploration is needed. */
  needsExploration: boolean;
}

const PLAN_SYSTEM_PROMPT =
  'You are MigraPilot answering a question about the user\'s repository. You have NO tools. ' +
  'Everything you are allowed to use is below: a routing map (file names only — NOT evidence) and EVIDENCE, which is exact source text retrieved for you with real line numbers.\n\n' +
  'RULES:\n' +
  '1. State repository behaviour ONLY from the EVIDENCE section. The routing map tells you a file exists; it never tells you what the file does.\n' +
  '2. Cite every factual sentence as `path:line` or `path:start-end`, using the line numbers shown in the EVIDENCE headers.\n' +
  '3. Never write hypothetical, illustrative or placeholder code. Only quote code present in the EVIDENCE.\n' +
  '4. Never describe a generic architecture. If the evidence does not show it, do not say it.\n' +
  '5. If you are reasoning rather than reporting, hedge explicitly ("likely", "appears to") so it is recorded as inference instead of being removed.\n' +
  '6. If the evidence is insufficient, say so and emit one line per missing thing:\n' +
  '   EVIDENCE-GAP: <exact file path or exported identifier you need>\n' +
  '   Do not guess around a gap — naming it is how you get it.\n\n' +
  'Every sentence you write is checked against the EVIDENCE text. Unsupported sentences are deleted from your answer.';

// The whole LINE is consumed, newline included: a lazy `(.+?)` followed by an
// optional newline matches a single character and leaves the rest of the token in
// the answer, which is how a gap marker turned into visible garbage.
const GAP_RE = /^[ \t]*EVIDENCE-GAP:[ \t]*(.*?)[ \t]*(?:\r?\n|$)/gim;

/** Strip the machine-readable gap lines before the answer is verified or shown. */
export function stripGapMarkers(text: string): { answer: string; gaps: string[] } {
  const gaps: string[] = [];
  for (const m of text.matchAll(GAP_RE)) {
    const token = m[1]!.trim().replace(/^[`'"]|[`'"]$/g, '');
    if (token) gaps.push(token);
  }
  return { answer: text.replace(GAP_RE, '').replace(/\n{3,}/g, '\n\n').trim(), gaps: [...new Set(gaps)] };
}

/**
 * Gaps the VERIFIER found, as opposed to gaps the model admitted.
 *
 * A rejected claim already names exactly what it wanted and could not have: a path
 * it never opened, or a term it could not anchor. That is a far better expansion
 * signal than asking the model to search again, because it comes from a check that
 * ran over real evidence rather than from another guess.
 */
export function gapsFromVerifier(verified: VerifiedAnswer): string[] {
  const out: string[] = [];
  for (const r of verified.rejected) {
    if (r.reason === 'code-not-in-evidence') continue;
    for (const term of r.terms) out.push(term.replace(/:\d+(?:-\d+)?$/, ''));
  }
  return [...new Set(out)];
}

/** Resolve a gap token to a map entry: exact path, suffix, export, then ranking. */
export function resolveGap(map: RepoMap, token: string): RepoMapEntry | undefined {
  const t = normalizePath(token);
  const direct = map.byPath.get(t);
  if (direct) return direct;
  const lower = t.toLowerCase();
  const suffix = map.entries.find((e) => e.path.toLowerCase().endsWith('/' + lower));
  if (suffix) return suffix;
  const exported = map.entries.find((e) => e.role !== 'generated' && e.role !== 'archive' && e.exports.includes(token));
  if (exported) return exported;
  const ranked = rankCandidates(map, token, { limit: 1 });
  return ranked[0]?.entry;
}

/** Render the evidence the model may use — exact spans, deduplicated by hash. */
export function renderEvidence(ledger: EvidenceLedger, maxUnits: number): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  let units = 0;
  for (const span of ledger.spans) {
    if (seen.has(span.excerptHash)) continue; // the same excerpt is one piece of evidence
    seen.add(span.excerptHash);
    const header = `--- ${span.path}:${span.startLine}-${span.endLine} ---`;
    const cost = Math.ceil((header.length + span.text.length) / 4);
    if (units + cost > maxUnits) break;
    units += cost;
    blocks.push(`${header}\n${span.text}`);
  }
  return blocks.join('\n\n');
}

function buildMessages(opts: EvidencePlanOptions, candidates: RankedCandidate[], gaps: string[]): PlanMessage[] {
  const digest = describeCandidates(candidates.map((c) => c.entry), 12);
  const evidence = renderEvidence(opts.ledger, opts.budget.maxEvidenceUnits);
  const gapNote = gaps.length
    ? `\n\nYou previously could not support these. The evidence above now includes what could be found for them; anything still missing is genuinely unavailable:\n${gaps.map((g) => `- ${g}`).join('\n')}`
    : '';
  return [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `Question: ${opts.question}\n\n` +
        `ROUTING MAP (file names only — NOT evidence):\n${digest || '(no candidates)'}\n\n` +
        `EVIDENCE (exact source text retrieved for you):\n${evidence || '(nothing was retrieved)'}` +
        gapNote,
    },
  ];
}

/** Open one candidate's span into the ledger, respecting the budget. */
async function* openCandidate(
  opts: EvidencePlanOptions,
  ledger: EvidenceLedger,
  budget: BudgetLedger,
  entry: RepoMapEntry,
  lines: number,
): AsyncGenerator<PlanEvent, 'opened' | 'cached' | 'skipped'> {
  const alreadyHeld = ledger.hasContentFor(entry.path);
  // Cost is estimated from the map BEFORE reading, so a file that would blow the
  // evidence ceiling is never read at all rather than read and then discarded.
  const estimatedUnits = Math.ceil(Math.min(entry.sizeBytes, lines * 80) / 4);
  if (!alreadyHeld && !budget.canOpenFile(estimatedUnits)) return 'skipped';
  if (alreadyHeld && ledger.expansionsFor(entry.path) >= opts.budget.maxExpansionsPerPath) {
    budget.noteBinding('maxExpansionsPerPath');
    return 'skipped';
  }
  const end = Math.min(lines, entry.lineCount || lines);
  const result = await ledger.request(entry.path, 1, end, opts.openSpan(entry.path, 1, end));
  const units = Math.ceil(result.span.text.length / 4);
  const range = `${result.span.startLine}-${result.span.endLine}`;
  // A cache hit is reported as a STEP too. Silently skipping it would hide the very
  // thing this slice is measured on: how often the run asked for what it already had.
  yield {
    type: 'step',
    step: {
      tool: result.outcome === 'cache-hit' ? 'evidence(cached)' : 'read',
      args: { path: entry.path },
      ok: true,
      summary: `${result.outcome} ${entry.path}:${range}`,
    },
  };
  if (result.outcome === 'cache-hit') return 'cached';
  if (!alreadyHeld) budget.noteFileOpened(units);
  else if (budget.canAddSpan(units)) budget.noteSpanAdded(units);
  return 'opened';
}

/**
 * Run the bounded plan.
 *
 * Returns `needsExploration` rather than throwing when the map cannot route the
 * question, so the caller can fall back to the tool loop instead of the planner
 * inventing a subject it has no basis for.
 */
export async function* runEvidencePlan(opts: EvidencePlanOptions): AsyncGenerator<PlanEvent, EvidencePlanResult> {
  const { ledger, timeline, map } = opts;
  const budget = new BudgetLedger(opts.budget);
  const opened: string[] = [];
  const gapLog: EvidencePlanResult['gaps'] = [];

  const empty = (stopReason: StopReason, needsExploration: boolean): EvidencePlanResult => ({
    rawAnswer: '',
    verified: verifyAnswer('', ledger, { question: opts.question }),
    stopReason,
    spend: budget.spend(),
    candidates: [],
    opened,
    gaps: gapLog,
    needsExploration,
  });

  if (map.unavailable) return empty('map-unavailable', true);

  const endSelection = timeline.beginPhase('evidence_selection');
  const ranked = rankCandidates(map, opts.question, { limit: opts.budget.maxCandidates });
  // Considered vs opened are different numbers, and the gap is the point: the
  // ranking looks at everything, the plan opens only what is close to the best
  // match. Both are reported.
  const candidates = aboveRelevanceFloor(ranked);
  budget.noteCandidates(ranked.length);
  endSelection();
  if (candidates.length === 0) return empty('no-candidates', true);

  // ── Open the initial evidence set ────────────────────────────────────────────
  const endOpen = timeline.beginPhase('tool_execution');
  yield { type: 'phase', phase: 'tool_execution' };
  for (const candidate of candidates) {
    if (!budget.canOpenFile()) break;
    const outcome = yield* openCandidate(opts, ledger, budget, candidate.entry, INITIAL_SPAN_LINES);
    if (outcome === 'opened') opened.push(candidate.entry.path);
  }
  endOpen();

  // ── Answer, verify, and expand at most once for a NAMED gap ──────────────────
  let rawAnswer = '';
  let verified = verifyAnswer('', ledger, { question: opts.question });
  let stopReason: StopReason = 'claims-supported';
  let carriedGaps: string[] = [];

  for (let round = 0; ; round += 1) {
    if (!budget.canCallModel()) {
      stopReason = 'model-call-budget-exhausted';
      break;
    }
    const phase: CallPhase = round === 0 ? 'tool_loop' : 'final_synthesis_retry';
    const messages = buildMessages(opts, candidates, carriedGaps);
    budget.noteModelCall();
    yield { type: 'phase', phase: 'model_inference' };
    const text = await opts.callModel(messages, phase);

    const { answer, gaps: declared } = stripGapMarkers(text);
    rawAnswer = answer;
    yield { type: 'phase', phase: 'answer_verification' };
    const endVerify = timeline.beginPhase('answer_verification');
    verified = verifyAnswer(answer, ledger, { question: opts.question });
    endVerify();

    const wanted = [
      ...declared.map((token) => ({ token, source: 'model' as const })),
      ...gapsFromVerifier(verified).map((token) => ({ token, source: 'verifier' as const })),
    ];
    if (wanted.length === 0) {
      stopReason = verified.claims.some((c) => c.kind === 'direct_evidence') ? 'claims-supported' : 'inference-only';
      break;
    }
    if (!budget.canExpand()) {
      stopReason = 'evidence-budget-exhausted';
      for (const w of wanted) gapLog.push(w);
      break;
    }

    // Resolve the named gaps into files, plus one hop along the import edges of
    // what we already opened — the adapter a scanner allowlists is exactly one
    // edge away, and following it beats another round of model guessing.
    budget.noteExpansionRound();
    yield { type: 'phase', phase: 'tool_execution' };
    const endExpand = timeline.beginPhase('tool_execution');
    let addedAny = false;

    // Resolve first, then open UNOPENED files before widening ones already held.
    // Measured: a repository-scale run spent its whole remaining evidence budget
    // re-opening `src/extension.ts` at a wider range, so the two files the verifier
    // had explicitly asked for never opened at all and their claims were dropped.
    // A file not yet seen is worth more than more of a file already seen.
    const resolved = wanted.map((w) => ({ ...w, entry: resolveGap(map, w.token) }));
    const ordered = [
      ...resolved.filter((r) => r.entry && !ledger.hasContentFor(r.entry.path)),
      ...resolved.filter((r) => r.entry && ledger.hasContentFor(r.entry.path)),
      ...resolved.filter((r) => !r.entry),
    ];
    for (const w of ordered) {
      const entry = w.entry;
      gapLog.push({ token: w.token, source: w.source, ...(entry ? { resolvedTo: entry.path } : {}) });
      if (!entry) continue;
      // Nothing more to fetch from a file we already hold in full.
      if (ledger.spansFor(entry.path).some((s) => s.reachesEof)) continue;
      const outcome = yield* openCandidate(opts, ledger, budget, entry, EXPANSION_SPAN_LINES);
      if (outcome === 'opened') {
        opened.push(entry.path);
        addedAny = true;
      }
    }
    if (!addedAny) {
      for (const neighbour of importNeighbours(map, opened, 3)) {
        if (!budget.canOpenFile()) break;
        const outcome = yield* openCandidate(opts, ledger, budget, neighbour, INITIAL_SPAN_LINES);
        if (outcome === 'opened') {
          opened.push(neighbour.path);
          addedAny = true;
        }
      }
    }
    endExpand();

    if (!addedAny) {
      // Nothing new could be found for the gap. Asking the model again with the
      // identical evidence would cost a full call to produce the same answer.
      stopReason = 'evidence-budget-exhausted';
      break;
    }
    carriedGaps = wanted.map((w) => w.token);
  }

  timeline.noteRepeatedReads(ledger.repeatedReads());
  return {
    rawAnswer,
    verified,
    stopReason,
    spend: budget.spend(),
    candidates: candidates.map((c) => ({ path: c.entry.path, score: Math.round(c.score * 10) / 10, reasons: c.reasons })),
    opened,
    gaps: gapLog,
    needsExploration: false,
  };
}
