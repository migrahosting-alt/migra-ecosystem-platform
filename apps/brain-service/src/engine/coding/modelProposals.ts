/**
 * MigraAI Engine — model proposal adapters.
 *
 * The model is now connected to an already-governed system. These adapters produce
 * UNTRUSTED proposals; `governedApply`, the approved scope, the ledger and the
 * reconciliation remain authoritative. A proposal that passes an adapter has not
 * been permitted to write — it has merely earned the right to be checked again.
 *
 * ── Why evidence IDs, not quoted failure lines ──────────────────────────────────
 *
 * The first design required a repair to reproduce observed failure lines verbatim.
 * That is brittle in exactly the wrong direction: a real model paraphrases,
 * normalises whitespace and drops TAP formatting, so correct repairs would be
 * refused and the obvious fix — fuzzy prose matching — would quietly weaken the
 * governance it exists to provide.
 *
 * So the SYSTEM names the evidence. Each failure block gets an immutable id, a
 * hash, and the identity of the command run that produced it. The model cites ids.
 * Its rationale may paraphrase freely; the AUTHORITY comes from the id, which it
 * cannot invent, cannot carry over from a previous attempt, and cannot alter
 * without breaking the hash.
 *
 * A model may still quote directly. If it does, the quotation is checked strictly —
 * a wrong quotation fails rather than being silently repaired.
 *
 * ── Why the rejection codes are not collapsed ───────────────────────────────────
 *
 * "Invalid response" tells an operator nothing and tells a future maintainer less.
 * A malformed schema, a stale citation and a scope expansion are three different
 * failures with three different remedies, and only one of them is the model's
 * fault in the same way. © MigraTeck LLC.
 */

import { createHash } from 'node:crypto';
import type { ChangesetRequest } from '@migrapilot/protocol';
import { isWorkspaceRelativeContained } from './editScope.js';
import { normalizePath, type EvidenceLedger } from '../grounding/evidenceLedger.js';
import type { ApprovedEditScope } from './editScope.js';
import type { DeclaredValidation, ValidationRecord } from './validationRun.js';

// ── Observed failure evidence ──────────────────────────────────────────────────

export interface ObservedFailureEvidence {
  evidenceId: string;
  /** Ties the block to ONE validation attempt of ONE run. */
  commandRunId: string;
  startLine: number;
  endLine: number;
  text: string;
  textHash: string;
}

export function hashEvidence(text: string): string {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Split a validation result into citable failure blocks.
 *
 * One block per failing assertion, headline plus its error body — the unit a
 * repair actually reasons about. Ids are positional within the attempt and scoped
 * by `commandRunId`, so `F-001` from attempt 2 is a different thing from `F-001`
 * of attempt 1 and cannot be substituted for it.
 */
export function extractFailureEvidence(record: ValidationRecord, commandRunId: string, maxBlocks = 20): ObservedFailureEvidence[] {
  if (record.passed) return [];
  const lines = `${record.stdout}\n${record.stderr}`.split(/\r?\n/);
  const blocks: ObservedFailureEvidence[] = [];
  let start = -1;
  const push = (from: number, to: number): void => {
    if (from < 0 || blocks.length >= maxBlocks) return;
    const text = lines.slice(from, to).join('\n').trimEnd();
    if (!text.trim()) return;
    blocks.push({
      evidenceId: `F-${String(blocks.length + 1).padStart(3, '0')}`,
      commandRunId,
      startLine: from + 1,
      endLine: to,
      text,
      textHash: hashEvidence(text),
    });
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*not ok /.test(lines[i]!)) {
      push(start, i);
      start = i;
    }
  }
  push(start, lines.length);
  return blocks;
}

/** Render evidence for a prompt, ids first so they are the obvious thing to cite. */
export function renderFailureEvidence(evidence: ObservedFailureEvidence[]): string {
  return evidence
    .map((e) => `FAILURE-EVIDENCE ${e.evidenceId}\n${e.text}`)
    .join('\n\n');
}

// ── Results ────────────────────────────────────────────────────────────────────

export type ProposalRejection =
  /** Output was not valid structured data of the required shape. */
  | 'malformed-output'
  /** The rationale is absent, empty, or asserts something the run cannot support. */
  | 'unsupported-rationale'
  /** A requested path has no retrieved evidence behind it. */
  | 'unsupported-path'
  /** A requested path is outside the approved scope. */
  | 'scope-expansion'
  /** No current failure evidence was cited at all. */
  | 'no-citation'
  /** A cited id does not exist in the current attempt's evidence. */
  | 'unobserved-citation'
  /** A cited id belongs to an earlier validation attempt. */
  | 'stale-citation'
  /** A cited id belongs to a different coding run. */
  | 'foreign-citation'
  /** A cited id exists but its content has changed. */
  | 'evidence-hash-mismatch'
  /** A direct quotation does not match the evidence it claims to quote. */
  | 'quotation-mismatch'
  /** Two operations target the same path with different content. */
  | 'conflicting-edits'
  /** The model tried to supply or replace the validation command. */
  | 'command-override'
  /** The proposal exceeds an operation or size ceiling. */
  | 'size-ceiling'
  /** The identical changeset already failed; repeating it cannot help. */
  | 'duplicate-repair'
  /** A strategy already shown not to land on disk, retried unchanged in substance. */
  | 'repeated-strategy'
  /** The edit introduces a package or framework the repository's evidence never shows. */
  | 'unsupported-dependency'
  /** The edit removes an exported symbol the file currently provides. */
  | 'api-shape-change'
  /** The model asserted the tests pass. Only a real exit code decides that. */
  | 'claims-passed'
  /** No attempts remain. */
  | 'ceiling-exhausted';

export interface AcceptedProposal {
  ok: true;
  rationale: string;
  changeset: ChangesetRequest;
  citedEvidenceIds: string[];
  /**
   * Things worth recording that are NOT grounds for refusal — currently a voluntary
   * quotation that did not match the block it named. Surfaced into the stage's
   * durable evidence so a paraphrasing model stays visible rather than silent.
   *
   * Never contains the quoted TEXT. A quotation that failed its check is exactly
   * the string that must not be repeated anywhere as though it came from evidence.
   */
  concerns?: string[];
  /**
   * Did every cited id verify — exists, current, this run's, hash intact?
   *
   * Reported separately from `quotationMatched` on purpose. The two answer
   * different questions, and collapsing them would let "the model quoted sloppily"
   * read as "the authority behind this repair is in doubt", or worse, the reverse.
   */
  evidenceIdVerified?: boolean;
  /** Absent when no quotation was offered; false when one did not match its block. */
  quotationMatched?: boolean;
}

export interface RejectedProposal {
  ok: false;
  kind: 'rejected';
  rejection: ProposalRejection;
  message: string;
  /** Whether this consumed one of the finite attempts. */
  consumedAttempt: boolean;
}

export interface TransportFailure {
  ok: false;
  kind: 'transport';
  message: string;
  retryable: true;
  consumedAttempt: boolean;
}

export type ModelProposalResult = AcceptedProposal | RejectedProposal | TransportFailure;

/** Ceilings a proposal must respect. */
export interface ProposalLimits {
  maxOps: number;
  maxBytesPerFile: number;
  maxAttempts: number;
}

export const DEFAULT_PROPOSAL_LIMITS: ProposalLimits = { maxOps: 8, maxBytesPerFile: 64 * 1024, maxAttempts: 3 };

const reject = (rejection: ProposalRejection, message: string, consumedAttempt = true): RejectedProposal => ({
  ok: false,
  kind: 'rejected',
  rejection,
  message,
  consumedAttempt,
});

// ── Structured-output parsing ──────────────────────────────────────────────────

export interface RawProposal {
  rationale?: unknown;
  edits?: unknown;
  observedFailureEvidenceIds?: unknown;
  /** Optional verbatim quotation. Checked strictly when present. */
  quotedEvidence?: unknown;
  /** Anything here is a command-override attempt. */
  validationCommand?: unknown;
  /** A model asserting success. Never authoritative. */
  testsPass?: unknown;
}

interface ParsedProposal {
  rationale: string;
  edits: Array<{ path: string; content: string }>;
  citedIds: string[];
  quoted: Array<{ evidenceId: string; text: string }>;
}

/**
 * The proposal shape, stated in the words `parseProposal` enforces.
 *
 * Same reasoning as the planner contract: the prompt carried the data but never
 * the shape, so a real model returned correct code under invented keys and was
 * refused. Stated here, next to the validator, so the two cannot drift.
 */
export const PROPOSAL_OUTPUT_CONTRACT = [
  'Reply with a single JSON object, and no other top-level keys:',
  '{',
  '  "rationale": "why this change is correct",',
  '  "edits": [{ "path": "<file>", "content": "<COMPLETE new file text>" }]',
  '}',
  'Rules:',
  '- "edits" must contain at least one entry.',
  '- Every "path" must be workspace-relative (no leading "/", no drive letter, no "..")',
  '  and must be one of the supplied approvedPaths. Any other path is refused.',
  '- "content" is the entire file after the change, never a diff or a fragment.',
  '- Do NOT rename or remove anything the file currently exports. Callers you were',
  '  not shown depend on those names; renaming one is an API change nobody asked for.',
  '- Do NOT import a package the supplied files do not already import.',
].join('\n');

/**
 * The repair shape. Adds the cited failure evidence, which is what gives a repair
 * its authority: the ids are checked against the run's real validation output.
 */
export const REPAIR_OUTPUT_CONTRACT = [
  'Reply with a single JSON object, and no other top-level keys:',
  '{',
  '  "rationale": "what the failure shows and why this fixes it",',
  '  "observedFailureEvidenceIds": ["F-1"],',
  '  "edits": [{ "path": "<file>", "content": "<COMPLETE new file text>" }],',
  '  "quotedEvidence": [{ "evidenceId": "F-1", "text": "<exact text from that block>" }]',
  '}',
  'Rules:',
  '- "edits" must contain at least one entry.',
  '- Every "path" must be workspace-relative and one of the supplied approvedPaths.',
  '- "content" is the entire file after the change, never a diff or a fragment.',
  '- "observedFailureEvidenceIds" must quote ids that appear in failureEvidence.',
  '  Cite only what the failure actually shows; invented ids are rejected.',
  // Stated because the parser accepts it and the repair adapter checks it. Omitting
  // it while the system prompt forbids "other top-level keys" left a validated field
  // the model was told not to send: the strict quotation check became unreachable,
  // and a model that sent one anyway was violating the shape instruction. Exactly
  // the contract/validator drift these constants exist to prevent.
  '- "quotedEvidence" is OPTIONAL. Omit it entirely unless you quote verbatim.',
  '  Each quotation is checked strictly against the block it names: text that does',
  '  not appear in that block rejects the whole proposal. Never paraphrase here.',
].join('\n');

export function parseProposal(raw: unknown): ParsedProposal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as RawProposal;
  if (typeof r.rationale !== 'string' || !r.rationale.trim()) return null;
  if (!Array.isArray(r.edits) || r.edits.length === 0) return null;

  const edits: Array<{ path: string; content: string }> = [];
  for (const entry of r.edits) {
    const e = entry as { path?: unknown; content?: unknown };
    if (typeof e.path !== 'string' || !e.path.trim()) return null;
    if (typeof e.content !== 'string') return null;
    // Refuse an absolute or escaping path rather than normalising it into a
    // plausible workspace-relative one. Rewriting would hide the attempt, and a
    // hidden attempt is worse than a rejected proposal.
    if (!isWorkspaceRelativeContained(e.path)) return null;
    edits.push({ path: normalizePath(e.path), content: e.content });
  }
  const citedIds: string[] = [];
  if (r.observedFailureEvidenceIds !== undefined) {
    if (!Array.isArray(r.observedFailureEvidenceIds)) return null;
    for (const id of r.observedFailureEvidenceIds) {
      if (typeof id !== 'string' || !id.trim()) return null;
      citedIds.push(id.trim());
    }
  }
  const quoted: Array<{ evidenceId: string; text: string }> = [];
  if (r.quotedEvidence !== undefined) {
    if (!Array.isArray(r.quotedEvidence)) return null;
    for (const q of r.quotedEvidence) {
      const e = q as { evidenceId?: unknown; text?: unknown };
      if (typeof e.evidenceId !== 'string' || typeof e.text !== 'string') return null;
      quoted.push({ evidenceId: e.evidenceId.trim(), text: e.text });
    }
  }
  return { rationale: r.rationale.trim(), edits, citedIds, quoted };
}

// ── Shared validation ──────────────────────────────────────────────────────────

function checkShape(
  parsed: ParsedProposal,
  raw: unknown,
  scope: ApprovedEditScope,
  ledger: EvidenceLedger,
  limits: ProposalLimits,
  /** Current contents of the approved files, when the caller has them. */
  current?: Map<string, string>,
  /** Bare modules this repository already uses, when the caller has enumerated them. */
  knownModules?: readonly string[],
): RejectedProposal | null {
  const r = raw as RawProposal;
  // A model may not choose its own check, nor declare its own success.
  if (r.validationCommand !== undefined) return reject('command-override', 'The proposal attempted to supply a validation command; commands come from the task contract.');
  if (r.testsPass === true) return reject('claims-passed', 'The proposal asserted the tests pass. Only a real exit code decides that.');

  if (parsed.edits.length > limits.maxOps) return reject('size-ceiling', `The proposal contains ${parsed.edits.length} operations; the limit is ${limits.maxOps}.`);
  for (const edit of parsed.edits) {
    if (Buffer.byteLength(edit.content, 'utf8') > limits.maxBytesPerFile) {
      return reject('size-ceiling', `${edit.path} exceeds the ${limits.maxBytesPerFile}-byte per-file ceiling.`);
    }
  }
  // Two operations on one path with different content is an ambiguous plan, and
  // resolving it by picking one would be inventing intent.
  const byPath = new Map<string, string>();
  for (const edit of parsed.edits) {
    const seen = byPath.get(edit.path);
    if (seen !== undefined && seen !== edit.content) return reject('conflicting-edits', `${edit.path} appears twice with different content.`);
    byPath.set(edit.path, edit.content);
  }
  const approved = new Set(scope.files.map((f) => f.path));
  for (const edit of parsed.edits) {
    if (!approved.has(edit.path)) return reject('scope-expansion', `${edit.path} is outside the approved scope; a proposal may not widen it.`);
    if (ledger.spansFor(edit.path).length === 0) return reject('unsupported-path', `${edit.path} has no retrieved evidence behind it.`);
  }

  /**
   * A file's exports are its contract with everything that imports it.
   *
   * Observed live: asked to exclude cancelled lines, the model rewrote
   * `computeOrderTotal(lines)` as `calculateOrderTotals(order)` — a rename nobody
   * asked for, invisible to the approved scope, and fatal to a caller the run never
   * retrieved. Removing an export is an API change, and an API change the issue did
   * not ask for is a guess.
   *
   * Checked in the direction that cannot reject correct work: only DISAPPEARANCE is
   * refused. Adding an export is how a legitimate change often starts, and requiring
   * new names to be grounded in retrieved evidence would reject the correct answer
   * whenever the required name lives somewhere the run never opened — which is the
   * normal case for a name that only the failing test knows.
   */
  if (current) {
    for (const edit of parsed.edits) {
      const before = current.get(edit.path);
      if (before === undefined) continue;
      const had = exportedSymbols(before);
      const now = new Set(exportedSymbols(edit.content));
      const dropped = had.filter((name) => !now.has(name));
      if (dropped.length) {
        return reject(
          'api-shape-change',
          `${edit.path} currently exports ${dropped.join(', ')}, and the proposal removes ${dropped.length > 1 ? 'them' : 'it'}. Renaming or dropping an exported symbol changes the contract every caller depends on, including callers this run never retrieved.`,
        );
      }
    }
  }

  // A proposal may not reach for a package the repository does not already use.
  // Shared by BOTH adapters from here, so the rule cannot drift between them.
  if (knownModules) {
    const known = new Set(knownModules);
    for (const edit of parsed.edits) {
      for (const mod of importedModules(edit.content)) {
        if (!known.has(mod)) {
          return reject(
            'unsupported-dependency',
            `The proposal imports "${mod}" in ${edit.path}, which this repository's evidence never shows it using. A proposal may not introduce a package or framework.`,
          );
        }
      }
    }
  }
  return null;
}

function toChangeset(rootPath: string, edits: Array<{ path: string; content: string }>): ChangesetRequest {
  const byPath = new Map(edits.map((e) => [e.path, e.content]));
  return { rootPath, ops: [...byPath].map(([path, content]) => ({ op: 'replace' as const, path, content })) };
}

// ── Initial changeset adapter ──────────────────────────────────────────────────

export interface InitialChangesetInput {
  issue: string;
  scope: ApprovedEditScope;
  /** Exact retrieved spans for the approved files. */
  evidence: Array<{ path: string; startLine: number; endLine: number; text: string }>;
  /** Current contents of the approved files, and nothing else. */
  currentFiles: Array<{ path: string; content: string }>;
  validationCommand: DeclaredValidation;
  /**
   * Bare modules this repository demonstrably already uses. Supplied by the driver
   * so this module performs no IO; when omitted the dependency check is skipped
   * rather than guessed at.
   */
  knownModules?: string[];
}

export type ProposalModel = (input: unknown) => Promise<unknown>;

export interface InitialChangesetAuthor {
  propose(input: InitialChangesetInput): Promise<ModelProposalResult>;
}

export function createInitialChangesetAuthor(deps: {
  model: ProposalModel;
  rootPath: string;
  ledger: EvidenceLedger;
  limits?: Partial<ProposalLimits>;
}): InitialChangesetAuthor {
  const limits = { ...DEFAULT_PROPOSAL_LIMITS, ...(deps.limits ?? {}) };
  return {
    async propose(input) {
      let raw: unknown;
      try {
        // The model sees the issue, the frozen scope, its evidence and the current
        // contents — never arbitrary repository access.
        raw = await deps.model({
          responseShape: PROPOSAL_OUTPUT_CONTRACT,
          issue: input.issue,
          approvedPaths: input.scope.files.map((f) => f.path),
          evidence: input.evidence,
          currentFiles: input.currentFiles,
          validationCommand: input.validationCommand.command.join(' '),
        });
      } catch (err) {
        return { ok: false, kind: 'transport', message: err instanceof Error ? err.message : String(err), retryable: true, consumedAttempt: false };
      }
      const parsed = parseProposal(raw);
      if (!parsed) return reject('malformed-output', 'The proposal did not match the required structured shape.');
      const shapeError = checkShape(
        parsed, raw, input.scope, deps.ledger, limits,
        new Map(input.currentFiles.map((f) => [normalizePath(f.path), f.content])),
        input.knownModules,
      );
      if (shapeError) return shapeError;
      return { ok: true, rationale: parsed.rationale, changeset: toChangeset(deps.rootPath, parsed.edits), citedEvidenceIds: [] };
    },
  };
}

// ── Repair adapter ─────────────────────────────────────────────────────────────

export interface RepairChangesetInput {
  scope: ApprovedEditScope;
  /** Paths currently differing from HEAD. */
  currentDiff: string[];
  latestValidation: ValidationRecord;
  /** Immutable, id-bearing blocks from THIS attempt. */
  evidence: ObservedFailureEvidence[];
  /** The attempt these blocks belong to. */
  commandRunId: string;
  /**
   * What earlier repair attempts tried and what became of them. Bounded and
   * summarised — never raw model output. Empty only on the first attempt.
   */
  previousAttempts: PreviousRepairAttempt[];
  /**
   * Bare module specifiers this repository demonstrably already uses — its declared
   * dependencies plus whatever the approved files import today.
   *
   * Supplied by the driver so this module performs no IO. When omitted the check is
   * skipped rather than guessed at: refusing every bare import on an empty set would
   * reject correct repairs in a repository nobody enumerated.
   */
  knownModules?: string[];
  remainingAttempts: number;
}

export interface RepairChangesetAuthor {
  propose(input: RepairChangesetInput): Promise<ModelProposalResult>;
}

/**
 * What a previous repair attempt tried, and what actually became of it.
 *
 * The driver used to pass `previousAttempts: []` unconditionally, so every repair
 * was authored as though it were the first. A real `qwen3-coder:30b` run spent its
 * whole budget that way: told only "the tests still fail", it escalated from a
 * field-name change to hallucinating an Express application into an ESM codebase
 * that never used Express. It was refused, correctly — but it was never given the
 * one fact that would have stopped it, namely that its own last attempt had
 * already been rejected and why.
 *
 * Deliberately a SUMMARY, not a transcript. Raw model responses are never carried
 * here: they are unbounded, they are the least trustworthy thing in the run, and
 * replaying them invites the model to continue its own worst reasoning.
 */
export interface PreviousRepairAttempt {
  attempt: number;
  citedEvidenceIds: string[];
  rationale: string;
  proposedPaths: string[];
  proposalDigest: string;
  outcome: 'proposal_rejected' | 'apply_refused' | 'apply_failed' | 'validation_failed' | 'rolled_back';
  outcomeReason: string;
  validationEvidenceIds?: string[];
}

/** Outcomes proving the strategy never reached a validated state on disk. */
const NON_LANDING_OUTCOMES: ReadonlySet<PreviousRepairAttempt['outcome']> = new Set([
  'proposal_rejected',
  'apply_refused',
  'apply_failed',
  'rolled_back',
]);

/** How much history the model may see. Bounded by COUNT and by SIZE. */
export const REPAIR_HISTORY_LIMITS = {
  maxAttempts: 4,
  maxRationaleChars: 400,
  maxTotalChars: 4000,
} as const;

/**
 * Bound a history entry's free text BEFORE it is stored.
 *
 * The 400-char cap above applies when the history is rendered into a prompt, which
 * left the durable payload itself unbounded: a verbose model rationale, or a long
 * refusal message, was persisted whole against a 256 KB domain-payload ceiling.
 * "Durable and bounded" has to be true at rest, not only on the way out.
 */
export function boundRepairAttempt(entry: PreviousRepairAttempt): PreviousRepairAttempt {
  const clip = (text: string): string =>
    text.length > REPAIR_HISTORY_LIMITS.maxRationaleChars
      ? `${text.slice(0, REPAIR_HISTORY_LIMITS.maxRationaleChars)}…`
      : text;
  return {
    ...entry,
    rationale: clip(entry.rationale),
    outcomeReason: clip(entry.outcomeReason),
    citedEvidenceIds: entry.citedEvidenceIds.slice(0, 16),
    proposedPaths: entry.proposedPaths.slice(0, 16),
    ...(entry.validationEvidenceIds ? { validationEvidenceIds: entry.validationEvidenceIds.slice(0, 16) } : {}),
  };
}

/**
 * Render the history as instruction, not narration.
 *
 * States what was tried, why it failed, what was cited, what was touched, and what
 * must not be repeated — then stops. The most RECENT attempts are kept when the
 * budget binds, because the strategy the model is most likely to repeat is the one
 * it just tried.
 */
export function renderRepairHistory(
  attempts: readonly PreviousRepairAttempt[],
  remainingAttempts: number,
): string {
  const rules = [
    'You MUST NOT:',
    '- resend any changeset above (an identical digest is rejected outright);',
    // Written FROM the enforced set, so the instruction cannot name fewer outcomes
    // than the check refuses. It previously listed two of the four, so a model could
    // spend an attempt on a strategy it was never told was forbidden.
    `- retry a strategy whose outcome was ${[...NON_LANDING_OUTCOMES].join(', ')} — it`,
    '  did not land, and repeating it cannot make it land;',
    '- introduce a framework, package or import that the supplied evidence does not',
    '  already show this repository using;',
    '- edit any path outside approvedPaths, or supply a validation command.',
    '',
    `Repair attempts remaining after this one: ${Math.max(0, remainingAttempts - 1)}.`,
    'If the evidence does not support a different, smaller change, say so in',
    '"rationale" and edit only what the evidence supports.',
  ].join('\n');

  if (!attempts.length) return `No previous repair attempt. This is the first.\n\n${rules}`;

  // NEWEST FIRST. The budget is spent from the top, so if it binds it drops the
  // oldest attempt — never the one the model is most likely to repeat. Rendering
  // oldest-first and truncating the tail did exactly the wrong thing: it cut the
  // most recent attempt AND the prohibitions below it.
  const kept = attempts.slice(-REPAIR_HISTORY_LIMITS.maxAttempts).reverse();
  const cap = (text: string): string =>
    text.length > REPAIR_HISTORY_LIMITS.maxRationaleChars
      ? `${text.slice(0, REPAIR_HISTORY_LIMITS.maxRationaleChars)}…`
      : text;

  const blocks: string[] = [];
  let used = 0;
  for (const a of kept) {
    const block = [
      `Attempt ${a.attempt} — OUTCOME: ${a.outcome}`,
      `  why it failed: ${cap(a.outcomeReason)}`,
      `  it claimed: ${cap(a.rationale)}`,
      `  it edited: ${a.proposedPaths.join(', ') || '(nothing)'}`,
      `  it cited: ${a.citedEvidenceIds.join(', ') || '(nothing)'}`,
      `  digest: ${a.proposalDigest}`,
      '',
    ].join('\n');
    if (used + block.length > REPAIR_HISTORY_LIMITS.maxTotalChars) {
      blocks.push('…(older attempts omitted)\n');
      break;
    }
    blocks.push(block);
    used += block.length;
  }
  // The rules are appended AFTER the budget is spent, so they can never be the
  // thing that gets cut. A history without its prohibitions is worse than none.
  return `${blocks.join('\n')}\n${rules}`;
}

/**
 * Names a file exports today.
 *
 * Deliberately syntactic and conservative: it reads declarations rather than
 * parsing, so it under-reports rather than inventing exports that are not there.
 * An under-report costs a missed check; an over-report would reject correct work.
 */
export function exportedSymbols(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]!);
  }
  for (const m of content.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.split(/\bas\b/)[part.includes(' as ') ? 1 : 0]?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return [...out];
}

/** Bare (non-relative) module specifiers a changeset introduces. */
export function importedModules(content: string): string[] {
  // Comments first. `\bfrom\s+["']x["']` matched any prose containing `from "x"`,
  // so a line like `// migrated from "express" to fetch` was read as a dependency
  // and refused the whole proposal. A false positive here rejects correct work.
  const code = content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const out = new Set<string>();
  const add = (spec: string | undefined): void => {
    if (!spec) return;
    // Relative, absolute and `node:` specifiers stay inside what the repository and
    // platform already provide; only a BARE specifier can drag in a dependency.
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return;
    out.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'));
  };

  // `import … from "x"` / `export … from "x"` — anchored to a statement start so the
  // `from` belongs to a module declaration rather than to a sentence.
  for (const m of code.matchAll(/(?:^|[;{}])\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm)) add(m[1]);
  // Bare side-effect import: `import "x"`.
  for (const m of code.matchAll(/(?:^|[;{}])\s*import\s*["']([^"']+)["']/gm)) add(m[1]);
  // `require("x")` and dynamic `import("x")`.
  for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  return [...out];
}

/** Stable identity of a changeset, for detecting a repeated failed repair. */
export function changesetFingerprint(changeset: ChangesetRequest): string {
  const body = [...changeset.ops]
    .map((o) => `${o.op}:${normalizePath(o.path)}:${hashEvidence('content' in o ? String(o.content ?? '') : '')}`)
    .sort()
    .join('|');
  return hashEvidence(body);
}

/** Words that carry no discriminating signal when relating evidence to a file. */
const RELATION_STOPWORDS = new Set(['test', 'tests', 'not', 'the', 'and', 'for', 'error', 'expected', 'actual', 'values', 'strictly', 'equal', 'deep', 'ok', 'src', 'js', 'ts']);

function relationTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9]{2,}/g)) {
    if (!RELATION_STOPWORDS.has(m[0])) out.add(m[0]);
  }
  return out;
}

/**
 * Does a cited block plausibly concern this file?
 *
 * Compares the block's vocabulary against BOTH the path and what the run retrieved
 * from that file. Calibrated against real TAP output, which names tests rather
 * than symbols: the block "the contract declares the excluded-count field" relates
 * to the contract file by its path, while "cancelled lines are excluded from the
 * total" relates to the service through the word `cancelled` in its own source.
 *
 * This is the one HEURISTIC in the chain, and it is deliberately lenient. The hard
 * guarantees — the id exists, is current, belongs to this run, and hashes true, and
 * the path is inside the approved scope — do not depend on it. Being strict here
 * would reject correct repairs without preventing any unauthorised write.
 */
export function materiallyRelates(block: ObservedFailureEvidence, path: string, ledger: EvidenceLedger): boolean {
  const blockTokens = relationTokens(block.text);
  const pathTokens = relationTokens(path.replace(/[/.]/g, ' '));
  for (const t of pathTokens) if (blockTokens.has(t)) return true;
  const source = ledger.spansFor(path).map((s) => s.text).join('\n');
  const sourceTokens = relationTokens(source);
  for (const t of blockTokens) if (sourceTokens.has(t)) return true;
  return false;
}

export function createRepairChangesetAuthor(deps: {
  model: ProposalModel;
  rootPath: string;
  runId: string;
  ledger: EvidenceLedger;
  limits?: Partial<ProposalLimits>;
}): RepairChangesetAuthor {
  const limits = { ...DEFAULT_PROPOSAL_LIMITS, ...(deps.limits ?? {}) };
  return {
    async propose(input) {
      if (input.remainingAttempts <= 0) return reject('ceiling-exhausted', 'No repair attempts remain.', false);

      let raw: unknown;
      try {
        raw = await deps.model({
          responseShape: REPAIR_OUTPUT_CONTRACT,
          approvedPaths: input.scope.files.map((f) => f.path),
          currentDiff: input.currentDiff,
          exitCode: input.latestValidation.exitCode,
          failureEvidence: renderFailureEvidence(input.evidence),
          repairHistory: renderRepairHistory(input.previousAttempts, input.remainingAttempts),
          remainingAttempts: input.remainingAttempts,
        });
      } catch (err) {
        return { ok: false, kind: 'transport', message: err instanceof Error ? err.message : String(err), retryable: true, consumedAttempt: false };
      }

      const parsed = parseProposal(raw);
      if (!parsed) return reject('malformed-output', 'The repair did not match the required structured shape.');
      const shapeError = checkShape(parsed, raw, input.scope, deps.ledger, limits, undefined, input.knownModules);
      if (shapeError) return shapeError;

      // ── Citation authority ──────────────────────────────────────────────────
      if (!parsed.citedIds.length) return reject('no-citation', 'A repair must cite at least one current failure-evidence id.');
      const byId = new Map(input.evidence.map((e) => [e.evidenceId, e]));
      for (const id of parsed.citedIds) {
        const block = byId.get(id);
        if (!block) {
          // Distinguish "never existed" from "belonged to an earlier attempt".
          const shapedLikeId = /^F-\d{3}$/.test(id);
          return shapedLikeId
            ? reject('stale-citation', `${id} is not part of the current validation attempt (${input.commandRunId}); evidence does not carry over.`)
            : reject('unobserved-citation', `${id} does not name any observed failure.`);
        }
        if (block.commandRunId !== input.commandRunId) {
          return reject('foreign-citation', `${id} belongs to ${block.commandRunId}, not to this run's current attempt.`);
        }
        if (block.textHash !== hashEvidence(block.text)) {
          return reject('evidence-hash-mismatch', `${id} no longer matches the output it was taken from.`);
        }
      }
      /**
       * A voluntary quotation is CHECKED, but it cannot veto a repair.
       *
       * It used to reject outright. That was safe only while no model ever sent one:
       * once `quotedEvidence` was named in the contract, `qwen3-coder:30b` supplied it
       * on every attempt and re-indented the TAP output it was quoting, so the strict
       * check failed 16 times across an 8-run benchmark and took completion from 3/8
       * to 0/8 — discarding repairs whose actual authority was fully verified.
       *
       * This module's own design note says why that is the wrong trade: requiring a
       * model to reproduce failure text verbatim "is brittle in exactly the wrong
       * direction", which is precisely why authority moved to evidence IDs. A
       * quotation grants no authority, so a bad one cannot be allowed to destroy a
       * proposal whose IDs are current, unaltered and this run's. Citing an
       * id that does not exist is still fatal — that is a citation, not a quotation.
       */
      const concerns: string[] = [];
      for (const q of parsed.quoted) {
        const block = byId.get(q.evidenceId);
        if (!block) return reject('unobserved-citation', `Quotation cites ${q.evidenceId}, which is not current evidence.`);
        if (!block.text.includes(q.text.trim())) {
          concerns.push(`the quotation attributed to ${q.evidenceId} does not appear in it verbatim`);
        }
      }

      // Every edited path needs at least one cited block that plausibly concerns it.
      const citedBlocks = parsed.citedIds.map((id) => byId.get(id)!);
      for (const edit of parsed.edits) {
        if (!citedBlocks.some((b) => materiallyRelates(b, edit.path, deps.ledger))) {
          return reject('unsupported-rationale', `No cited failure evidence relates to ${edit.path}.`);
        }
      }

      const changeset = toChangeset(deps.rootPath, parsed.edits);
      const fingerprint = changesetFingerprint(changeset);
      if (input.previousAttempts.some((a) => a.proposalDigest === fingerprint)) {
        return reject('duplicate-repair', 'This exact changeset has already been proposed and did not fix the failure.');
      }

      // A strategy that never reached disk cannot be made to work by resending it in
      // slightly different words. Keyed on WHAT it touches and WHAT it claims as
      // authority — not on byte equality, which the digest check above already owns.
      const pathKey = [...new Set(parsed.edits.map((e) => normalizePath(e.path)))].sort().join('|');
      const citeKey = [...new Set(parsed.citedIds)].sort().join('|');
      const repeated = input.previousAttempts.find(
        (a) =>
          NON_LANDING_OUTCOMES.has(a.outcome) &&
          [...new Set(a.proposedPaths.map(normalizePath))].sort().join('|') === pathKey &&
          [...new Set(a.citedEvidenceIds)].sort().join('|') === citeKey,
      );
      if (repeated) {
        return reject(
          'repeated-strategy',
          `Attempt ${repeated.attempt} already tried these files under the same evidence and ended as ${repeated.outcome} (${repeated.outcomeReason}). Repeating it cannot make it land.`,
        );
      }
      return {
        ok: true, rationale: parsed.rationale, changeset, citedEvidenceIds: parsed.citedIds,
        // Reaching here means every cited id passed existence, currency, ownership
        // and hash checks — those still reject outright, so `true` is a fact, not a
        // default. The quotation verdict is a separate, weaker statement.
        evidenceIdVerified: true,
        ...(parsed.quoted.length ? { quotationMatched: concerns.length === 0 } : {}),
        ...(concerns.length ? { concerns } : {}),
      };
    },
  };
}
