import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertCandidateBase, candidateGit, containedPath, nodeChangesetFs,
  observedFailure, previewCommandRun, redactCommandOutput, runValidation, withDetachedCandidate,
  type ValidationRecord,
} from '@migrapilot/workspace-tools';
import { ChangesetRequestSchema, ProposeChangesetResponseSchema, type ChangeOp } from '@migrapilot/protocol';
import { applyApprovedChangeset } from './changesetApply.js';
import type { ChangesetProposal } from './proposedChangeset.js';
import type { MigraAiClient } from './migraAiClient.js';
import { candidateDependencyPlan, type CandidateDependencyPlan } from './candidateDependencies.js';

export interface CandidateConsent {
  command: string[];
  script: string;
  paths: string[];
  maxRepairs: number;
  timeoutMs: number;
  preparation?: CandidateDependencyPlan;
}
export interface CandidateWorkflowOptions {
  rootPath: string;
  proposal: ChangesetProposal;
  script: string;
  goal: string;
  prepareDependencies?: boolean;
  signal?: AbortSignal;
  requestConsent(plan: CandidateConsent): Promise<boolean>;
  onProgress?(message: string): void;
  onRecord?(record: ValidationRecord): void;
}
export interface ValidatedCandidate {
  proposal: ChangesetProposal;
  baseCommit: string;
  script: string;
  records: ValidationRecord[];
  repairAttempts: number;
}
export interface WorkspaceVerification {
  status: 'passed' | 'failed' | 'declined' | 'cancelled' | 'unavailable';
  records: ValidationRecord[];
  message: string;
}
export interface WorkspaceVerificationOptions {
  rootPath: string;
  proposal: ChangesetProposal;
  script: string;
  signal?: AbortSignal;
  requestConsent(plan: Omit<CandidateConsent, 'maxRepairs'>): Promise<boolean>;
  onRecord?(record: ValidationRecord): void;
}
export const CANDIDATE_SCRIPTS = ['test', 'test:unit', 'typecheck', 'check', 'lint', 'build'] as const;
const MAX_REPAIRS = 2;
const TIMEOUT_MS = 120_000;
const fs = nodeChangesetFs();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('Candidate validation cancelled. No original workspace changes were applied.');
};

export function candidateOperations(proposal: ChangesetProposal): ChangeOp[] {
  if (!proposal.proposalHash || !proposal.ops.length) throw new Error('A stored full-diff proposal is required.');
  return proposal.ops.map(op => {
    if (!op.path) throw new Error('Candidate proposal omitted a path.');
    if (op.kind === 'mkdir') return { op: 'mkdir', path: op.path };
    if (op.before === null && typeof op.after === 'string') return { op: 'create', path: op.path, content: op.after };
    if (typeof op.before === 'string' && op.after === null) return { op: 'delete', path: op.path };
    if (typeof op.before === 'string' && typeof op.after === 'string') return { op: 'replace', path: op.path, content: op.after };
    throw new Error(`Candidate requires exact before/after content for ${op.path}.`);
  });
}

function packageScripts(root: string): Record<string, string> {
  const value: unknown = JSON.parse(readFileSync(containedPath(root, 'package.json', fs), 'utf8'));
  if (!value || typeof value !== 'object' || !('scripts' in value) || !value.scripts || typeof value.scripts !== 'object') {
    throw new Error('Candidate validation requires declared package.json scripts.');
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.scripts)) if (typeof entry === 'string') result[key] = entry;
  return result;
}
export function candidateScriptChoices(root: string): string[] {
  const scripts = packageScripts(root);
  return CANDIDATE_SCRIPTS.filter(script => Boolean(scripts[script]));
}

function validationAssets(root: string): string {
  const files = [...new Set([...candidateGit(root, ['ls-files', '-z']).split('\0'),
    ...candidateGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')])].filter(Boolean)
    .filter(path => /(^|\/)(package\.json|[^/]*lock[^/]*|tests?\/|__tests__\/)|\.(test|spec)\.[^/]+$/.test(path));
  return digest(files.sort().map(path => {
    const absolute = containedPath(root, path, fs);
    return `${path}\0${existsSync(absolute) ? readFileSync(absolute, 'utf8') : '(deleted)'}`;
  }).join('\0'));
}

function currentSource(root: string, paths: string[]): string {
  return digest(paths.map(path => {
    const absolute = containedPath(root, path, fs);
    if (!existsSync(absolute)) return `${path}\0(deleted)`;
    if (lstatSync(absolute).isDirectory()) return `${path}\0(directory)`;
    return `${path}\0${readFileSync(absolute, 'utf8')}`;
  }).join('\0'));
}
function assertScope(root: string, paths: ReadonlySet<string>): void {
  const changed = [...candidateGit(root, ['diff', '--name-only', 'HEAD', '-z']).split('\0'),
    ...candidateGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean);
  for (const path of changed) if (!paths.has(path)) throw new Error(`Candidate changed an unapproved path: ${path}`);
}
function testCount(output: string): number | undefined {
  const tap = /^# tests (\d+)$/m.exec(output);
  const other = /(?:Tests:|Tests)\s+(?:.*?\s)?(\d+)\s+(?:total|passed)/.exec(output);
  return tap ? Number(tap[1]) : other ? Number(other[1]) : undefined;
}

function validationEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, LANG: 'C.UTF-8', CI: '1',
    MIGRAPILOT_COMMAND_RUN: process.env.MIGRAPILOT_COMMAND_RUN,
    MIGRAPILOT_COMMAND_ALLOWLIST: process.env.MIGRAPILOT_COMMAND_ALLOWLIST,
  };
}

function assertApplied(root: string, proposal: ChangesetProposal): string[] {
  candidateOperations(proposal);
  const paths: string[] = [];
  for (const op of proposal.ops) {
    const path = op.path!;
    const absolute = containedPath(root, path, fs);
    const present = existsSync(absolute);
    if (op.kind === 'mkdir' ? !present || !lstatSync(absolute).isDirectory()
      : op.after === null ? present
      : !present || !lstatSync(absolute).isFile() || readFileSync(absolute, 'utf8') !== op.after) {
      throw new Error(`Applied source changed at ${path}. Request a fresh proposal; these bytes are not the reviewed changes.`);
    }
    paths.push(path);
  }
  return paths;
}

/** Check applied bytes without reapplying or granting model command authority. */
export async function verifyAppliedChangeset(options: WorkspaceVerificationOptions): Promise<WorkspaceVerification> {
  const records: ValidationRecord[] = [];
  let privateHome: string | undefined;
  try {
    if (options.signal?.aborted) return { status: 'cancelled', records, message: 'Original-workspace verification cancelled. Applied edits remain.' };
    if (realpathSync(candidateGit(options.rootPath, ['rev-parse', '--show-toplevel'])) !== realpathSync(options.rootPath)) {
      throw new Error('Original-workspace verification requires the exact repository root.');
    }
    const head = candidateGit(options.rootPath, ['rev-parse', 'HEAD']);
    const paths = assertApplied(options.rootPath, options.proposal);
    const scripts = packageScripts(options.rootPath);
    if (!CANDIDATE_SCRIPTS.some(script => script === options.script) || !scripts[options.script]) {
      throw new Error('Select an existing declared validation script; arbitrary commands are not admitted.');
    }
    const scriptIdentity = digest(JSON.stringify(scripts));
    const assets = validationAssets(options.rootPath);
    const environment = validationEnvironment();
    const command = ['npm', 'run', options.script];
    await previewCommandRun({ rootPath: options.rootPath, command, timeoutMs: TIMEOUT_MS }, environment);
    const approved = await options.requestConsent({
      command, script: redactCommandOutput(scripts[options.script]!).value, paths, timeoutMs: TIMEOUT_MS,
    });
    if (options.signal?.aborted) return { status: 'cancelled', records, message: 'Original-workspace verification cancelled. Applied edits remain.' };
    if (!approved) return { status: 'declined', records, message: 'Original-workspace verification was not approved. Applied edits remain unverified.' };
    const assertUnchanged = () => {
      assertApplied(options.rootPath, options.proposal);
      if (candidateGit(options.rootPath, ['rev-parse', 'HEAD']) !== head
        || digest(JSON.stringify(packageScripts(options.rootPath))) !== scriptIdentity
        || validationAssets(options.rootPath) !== assets) {
        throw new Error('Original repository HEAD, approved scripts or validation assets changed. Verification cannot qualify these results.');
      }
    };
    assertUnchanged();
    privateHome = mkdtempSync(join(tmpdir(), 'migrapilot-validation-home-'));
    environment.HOME = privateHome;
    environment.npm_config_cache = join(privateHome, 'cache');
    const record = await runValidation({ id: `workspace.${options.script}`, command, timeoutMs: TIMEOUT_MS }, 'final', {
      rootPath: options.rootPath, env: environment, inheritEnvironment: false, captureOutputTail: true, signal: options.signal,
    });
    records.push(record);
    options.onRecord?.(record);
    assertUnchanged();
    if (options.signal?.aborted) return { status: 'cancelled', records, message: 'Original-workspace verification cancelled. Applied edits remain.' };
    if (!record.admitted || record.timedOut) throw new Error(`Original-workspace check unavailable: ${record.refusedReason ?? observedFailure(record).summary}`);
    if (record.passed && options.script.startsWith('test') && !testCount(record.stdout)) {
      throw new Error('Test script reported exit zero without observable executed-test evidence.');
    }
    return {
      status: record.passed ? 'passed' : 'failed', records,
      message: record.passed
        ? 'Original-workspace check passed on the applied bytes. Product/owner acceptance is still required.'
        : `Original-workspace check failed: ${observedFailure(record).summary}. Applied edits remain; review the output before repair or retry.`,
    };
  } catch (error) {
    return {
      status: options.signal?.aborted ? 'cancelled' : 'unavailable', records,
      message: `${error instanceof Error ? error.message : String(error)} Applied edits were not rolled back or reapplied.`,
    };
  } finally {
    if (privateHome) rmSync(privateHome, { recursive: true, force: true });
  }
}

export async function validateCandidate(
  client: Pick<MigraAiClient, 'executeOperatorTool' | 'runReadOnlyTool' | 'engineerStream'>,
  options: CandidateWorkflowOptions,
): Promise<ValidatedCandidate> {
  checkAbort(options.signal);
  assertCandidateBase(options.rootPath);
  const stored = await client.executeOperatorTool({
    tool: 'fs.applyChangeset', input: { rootPath: options.rootPath, proposalHash: options.proposal.proposalHash }, dryRun: true,
  }, options.signal);
  if (stored.status !== 'dry_run') throw new Error('Candidate requires a no-write stored proposal preview.');
  const initial = ProposeChangesetResponseSchema.parse(stored.preview);
  if (initial.proposalHash !== options.proposal.proposalHash
    || initial.changeset.rootPath !== options.rootPath
    || JSON.stringify(initial.ops.map(op => ({ path: op.path, kind: op.kind, before: op.before, after: op.after })))
      !== JSON.stringify(options.proposal.ops.map(op => ({ path: op.path, kind: op.kind, before: op.before, after: op.after })))) {
    throw new Error('Candidate input differs from the actual stored proposal.');
  }
  const operations = candidateOperations(initial);
  const paths = operations.map(op => op.path);
  const scope = new Set(paths);
  const scripts = packageScripts(options.rootPath);
  if (!CANDIDATE_SCRIPTS.some(script => script === options.script) || !scripts[options.script]) {
    throw new Error('Select an existing declared validation script; arbitrary commands are not admitted.');
  }
  const command = ['npm', 'run', options.script];
  const scriptIdentity = digest(JSON.stringify(scripts));
  const environment = validationEnvironment();
  const preparation = options.prepareDependencies ? candidateDependencyPlan(options.rootPath) : undefined;
  await previewCommandRun({ rootPath: options.rootPath, command, timeoutMs: TIMEOUT_MS }, environment);
  if (preparation) await previewCommandRun({ rootPath: options.rootPath, command: preparation.command, timeoutMs: preparation.timeoutMs }, environment);
  const approved = await options.requestConsent({
    command: [...command], script: redactCommandOutput(scripts[options.script]!).value,
    paths: [...paths], maxRepairs: MAX_REPAIRS, timeoutMs: TIMEOUT_MS,
    preparation: preparation ? { ...preparation, command: [...preparation.command] } : undefined,
  });
  checkAbort(options.signal);
  if (!approved) throw new Error('Candidate execution was not approved. No original workspace changes were applied.');

  const privateHome = mkdtempSync(join(tmpdir(), 'migrapilot-validation-home-'));
  const execute = async (root: string) => {
    const records: ValidationRecord[] = [];
    environment.HOME = privateHome;
    environment.npm_config_cache = join(privateHome, 'cache');
    const assertDependencyIdentity = () => {
      if (preparation && candidateDependencyPlan(root).fingerprint !== preparation.fingerprint) {
        throw new Error('Approved dependency manifest, lock or local archive changed. Locked preparation cannot qualify this candidate.');
      }
    };
    if (preparation) {
      assertDependencyIdentity();
      const before = currentSource(root, paths);
      const assets = validationAssets(root);
      options.onProgress?.('Preparing locked candidate dependencies with install scripts disabled');
      const record = await runValidation({
        id: 'candidate.dependencies', command: preparation.command, timeoutMs: preparation.timeoutMs,
      }, 'baseline', {
        rootPath: root, env: {
          ...environment, npm_config_userconfig: join(privateHome, 'user.npmrc'),
          npm_config_globalconfig: join(privateHome, 'global.npmrc'),
        }, inheritEnvironment: false, captureOutputTail: true, signal: options.signal,
      });
      records.push(record); options.onRecord?.(record);
      checkAbort(options.signal);
      assertDependencyIdentity();
      if (currentSource(root, paths) !== before || validationAssets(root) !== assets) throw new Error('Dependency preparation modified pinned source or validation assets.');
      assertScope(root, scope);
      if (!record.passed) throw new Error(`Locked dependency preparation failed: ${record.refusedReason ?? observedFailure(record).summary}. No repairs or original changes were attempted; install scripts stay disabled.`);
    }
    const run = async (stage: 'baseline' | 'repair' | 'final') => {
      checkAbort(options.signal);
      assertDependencyIdentity();
      if (digest(JSON.stringify(packageScripts(root))) !== scriptIdentity) throw new Error('Candidate changed the approved validation scripts.');
      const before = currentSource(root, paths);
      const record = await runValidation({ id: `candidate.${options.script}`, command, timeoutMs: TIMEOUT_MS }, stage, {
        rootPath: root, env: environment, inheritEnvironment: false, captureOutputTail: true, signal: options.signal,
      });
      checkAbort(options.signal);
      records.push(record);
      options.onRecord?.(record);
      assertDependencyIdentity();
      if (currentSource(root, paths) !== before) throw new Error('Validation modified proposed source after it was checked.');
      if (!record.admitted || record.timedOut) throw new Error(`Candidate validation unavailable: ${record.refusedReason ?? observedFailure(record).summary}`);
      if (record.passed && options.script.startsWith('test') && !testCount(record.stdout)) {
        throw new Error('Test script reported exit zero without observable executed-test evidence.');
      }
      options.onProgress?.(`Candidate ${stage}: ${observedFailure(record).summary}`);
      return record;
    };
    await run('baseline');
    const apply = async (proposal: ChangesetProposal) => {
      for (const op of proposal.ops) if (!op.path || !scope.has(op.path)) throw new Error(`Repair exceeded approved scope: ${op.path ?? '(missing)'}`);
      const input = ChangesetRequestSchema.parse({ rootPath: root, ops: candidateOperations(proposal), allowDelete: true });
      const preview = ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', input, options.signal));
      for (const [index, op] of proposal.ops.entries()) {
        if (op.before !== preview.ops[index]?.before || op.after !== preview.ops[index]?.after) throw new Error('Candidate proposal source drifted.');
      }
      if (await applyApprovedChangeset(request => client.executeOperatorTool(request, options.signal), root, preview.proposalHash, preview.ops) !== 'applied') {
        throw new Error('Candidate changeset was refused.');
      }
    };
    await apply(initial);
    const assets = validationAssets(root);
    let record = await run('final');
    let repairs = 0;
    const tried = new Set<string>([currentSource(root, paths)]);
    while (!record.passed && repairs < MAX_REPAIRS) {
      if (validationAssets(root) !== assets) throw new Error('Validation assets changed during checks.');
      const failure = observedFailure(record);
      if (!failure.lines.length) throw new Error(`Validation failed without repairable test evidence: ${failure.summary}. Check candidate dependencies or tooling.`);
      options.onProgress?.(`Candidate repair ${repairs + 1}/${MAX_REPAIRS}`);
      let repair: ChangesetProposal | undefined;
      let failed = false;
      for await (const event of client.engineerStream({
        rootPath: root,
        task: `Repair the candidate for this task: ${options.goal}\nRead relevant files first. Propose only changes inside: ${paths.join(', ')}. Do not change tests, validation assets or package scripts. Do not apply or claim validation ran.\nObserved ${failure.summary}:\n${failure.lines.join('\n')}`,
      }, options.signal)) {
        if (event.event === 'error') failed = true;
        if (event.event === 'proposal') {
          const parsed = ProposeChangesetResponseSchema.safeParse(
            event.data && typeof event.data === 'object' && 'preview' in event.data ? event.data.preview : undefined,
          );
          if (parsed.success) repair = parsed.data;
        }
      }
      checkAbort(options.signal);
      if (failed || !repair) throw new Error('Engineer did not produce an accepted evidence-driven repair proposal.');
      await apply(repair);
      repairs++;
      if (validationAssets(root) !== assets) throw new Error('Repair changed pinned validation assets.');
      const next = currentSource(root, paths);
      if (tried.has(next)) throw new Error('Repair repeated a previously tested candidate without progress.');
      tried.add(next);
      record = await run('repair');
    }
    if (!record.passed) throw new Error(`Candidate failed after ${repairs} repair attempts. Original workspace unchanged.`);
    assertScope(root, scope);
    if (validationAssets(root) !== assets) throw new Error('Candidate changed pinned validation assets.');
    const finalOps: ChangeOp[] = [];
    for (const op of initial.ops) {
      const absolute = containedPath(root, op.path!, fs);
      const after = existsSync(absolute) && !lstatSync(absolute).isDirectory() ? readFileSync(absolute, 'utf8') : null;
      if (op.kind === 'mkdir') {
        if (existsSync(absolute)) finalOps.push({ op: 'mkdir', path: op.path! });
      } else if (after !== op.before) {
        if (after === null) finalOps.push({ op: 'delete', path: op.path! });
        else finalOps.push({ op: op.before === null ? 'create' : 'replace', path: op.path!, content: after });
      }
    }
    const proposal = ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', {
      rootPath: options.rootPath, ops: finalOps, allowDelete: true,
    }, options.signal));
    return { proposal, records, repairAttempts: repairs };
  };
  try {
    const detached = await withDetachedCandidate(options.rootPath, execute);
    return { ...detached.value, baseCommit: detached.baseCommit, script: options.script };
  } finally {
    rmSync(privateHome, { recursive: true, force: true });
  }
}
