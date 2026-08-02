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
  /** The model asserted the tests pass. Only a real exit code decides that. */
  | 'claims-passed'
  /** No attempts remain. */
  | 'ceiling-exhausted';

export interface AcceptedProposal {
  ok: true;
  rationale: string;
  changeset: ChangesetRequest;
  citedEvidenceIds: string[];
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
      const shapeError = checkShape(parsed, raw, input.scope, deps.ledger, limits);
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
  previousAttempts: Array<{ rationale: string; changesetFingerprint: string }>;
  remainingAttempts: number;
}

export interface RepairChangesetAuthor {
  propose(input: RepairChangesetInput): Promise<ModelProposalResult>;
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
          previousAttempts: input.previousAttempts.map((a) => a.rationale),
          remainingAttempts: input.remainingAttempts,
        });
      } catch (err) {
        return { ok: false, kind: 'transport', message: err instanceof Error ? err.message : String(err), retryable: true, consumedAttempt: false };
      }

      const parsed = parseProposal(raw);
      if (!parsed) return reject('malformed-output', 'The repair did not match the required structured shape.');
      const shapeError = checkShape(parsed, raw, input.scope, deps.ledger, limits);
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
      // A voluntary quotation is checked strictly — wrong quotations fail rather
      // than being repaired.
      for (const q of parsed.quoted) {
        const block = byId.get(q.evidenceId);
        if (!block) return reject('unobserved-citation', `Quotation cites ${q.evidenceId}, which is not current evidence.`);
        if (!block.text.includes(q.text.trim())) {
          return reject('quotation-mismatch', `The quotation attributed to ${q.evidenceId} does not appear in it.`);
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
      if (input.previousAttempts.some((a) => a.changesetFingerprint === fingerprint)) {
        return reject('duplicate-repair', 'This exact changeset has already been applied and did not fix the failure.');
      }
      return { ok: true, rationale: parsed.rationale, changeset, citedEvidenceIds: parsed.citedIds };
    },
  };
}
