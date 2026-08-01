// Bounded repository evidence planning.
//
// Every test here is a measurement the 305s run failed. That run spent 99% of its
// wall clock on 8 model calls whose context grew 1,906 → 8,704 units, read
// `brainTransport.ts` four times, and rediscovered by search what a 76ms map
// already knew. So the assertions are about COUNTS — model calls, filesystem
// reads, files opened, duplicate spans, context growth — not about latency, which
// is the symptom.
//
// The plan is driven by a scripted model, so nothing here waits on inference.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { AnswerTimeline } from '../src/engine/answerTimings.js';
import { buildRepoMap, clearRepoMapCache, classifyRole, describeCandidates } from '../src/engine/planning/repoMap.js';
import { rankCandidates, importNeighbours, aboveRelevanceFloor, questionTerms } from '../src/engine/planning/candidateRanking.js';
import { resolveBudget, DEFAULT_EVIDENCE_BUDGET } from '../src/engine/planning/evidenceBudget.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import {
  runEvidencePlan,
  renderEvidence,
  stripGapMarkers,
  gapsFromVerifier,
  resolveGap,
  type EvidencePlanResult,
  type PlanMessage,
} from '../src/engine/planning/evidencePlan.js';

/** A small real git repository: the map is built from `git ls-files`, not a walk. */
function tmpRepo(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-plan-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const g = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.co']);
  g(['config', 'user.name', 'T']);
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

const GUARD = [
  '#!/usr/bin/env node',
  '// Structural anti-bypass guard for the governed Brain transport.',
  "import { readFileSync } from 'node:fs';",
  "const ALLOWLIST = new Set(['services/brainTransport.ts']);",
  'const BRAIN_MARKERS = [/brainUrl/i, /3988/];',
  'const violations = [];',
  'if (violations.length > 0) process.exit(1);',
  '',
].join('\n');

const TRANSPORT = [
  '// The governed Brain transport adapter.',
  'export async function runBrainOperation(op) {',
  '  return fetch(brainUrl, { method: "POST", body: JSON.stringify(op) });',
  '}',
  '',
].join('\n');

const STANDARD_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo-pkg', scripts: { 'test:unit': 'node --test' } }, null, 2),
  'scripts/check-brain-transport.mjs': GUARD,
  'src/services/brainTransport.ts': TRANSPORT,
  'src/services/unrelated.ts': 'export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n',
  'dist/services/brainTransport.js': 'GENERATED COPY — must never be evidence\n',
  'backups/check-brain-transport.mjs': 'ARCHIVED COPY — must never be evidence\n',
  'src/services/__tests__/brainTransport.test.ts': 'test("transport", () => {});\n',
};

interface PlanRun {
  result: EvidencePlanResult;
  ledger: EvidenceLedger;
  prompts: PlanMessage[][];
  events: Array<{ type: string; summary?: string }>;
  reads: string[];
}

/** Drive the plan with a scripted model, counting every real filesystem read. */
async function runPlan(
  root: string,
  question: string,
  replies: string[],
  budgetOverrides: Parameters<typeof resolveBudget>[0] = {},
): Promise<PlanRun> {
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const ledger = new EvidenceLedger();
  const timeline = new AnswerTimeline();
  const prompts: PlanMessage[][] = [];
  const events: Array<{ type: string; summary?: string }> = [];
  const reads: string[] = [];
  let next = 0;

  const gen = runEvidencePlan({
    question,
    map,
    ledger,
    timeline,
    budget: resolveBudget(budgetOverrides),
    openSpan: (rel, start, end) => {
      const inner = makeSpanSource(root, rel, start, end);
      return {
        fingerprint: () => inner.fingerprint(),
        read: async () => {
          reads.push(`${rel}:${start}-${end}`); // ONE entry per real filesystem read
          return inner.read();
        },
      };
    },
    callModel: async (messages) => {
      prompts.push(messages);
      const reply = replies[next] ?? '';
      next += 1;
      return reply;
    },
  });

  let step = await gen.next();
  while (!step.done) {
    const ev = step.value;
    events.push(ev.type === 'step' ? { type: 'step', summary: ev.step.summary } : { type: ev.type });
    step = await gen.next();
  }
  return { result: step.value, ledger, prompts, events, reads };
}

const CITED_ANSWER =
  '`scripts/check-brain-transport.mjs:1-8` is a structural anti-bypass guard; the `ALLOWLIST` permits only `services/brainTransport.ts`.';

// ── 1. Repeated file request uses the evidence cache ────────────────────────────

test('1 — a repeated request for the same range is served from cache, with no second read', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const ledger = new EvidenceLedger();
  const reads: string[] = [];
  const source = (): ReturnType<typeof makeSpanSource> => {
    const inner = makeSpanSource(root, 'src/services/brainTransport.ts', 1, 200);
    return {
      fingerprint: () => inner.fingerprint(),
      read: async () => {
        reads.push('read');
        return inner.read();
      },
    };
  };

  const first = await ledger.request('src/services/brainTransport.ts', 1, 200, source());
  const second = await ledger.request('src/services/brainTransport.ts', 1, 200, source());
  const third = await ledger.request('src/services/brainTransport.ts', 1, 100, source());
  const fourth = await ledger.request('src/services/brainTransport.ts', 1, 200, source());

  assert.equal(first.outcome, 'fresh');
  assert.equal(second.outcome, 'cache-hit');
  assert.equal(third.outcome, 'cache-hit', 'a narrower range is already covered');
  assert.equal(fourth.outcome, 'cache-hit');
  // The measured defect, inverted: four requests, one filesystem read.
  assert.equal(reads.length, 1, `four requests must cost one read, got ${reads.length}`);

  const stats = ledger.cacheStats();
  assert.deepEqual(
    { requests: stats.requests, freshReads: stats.freshReads, cacheHits: stats.cacheHits, repeated: stats.repeatedRequests, unique: stats.uniqueFiles },
    { requests: 4, freshReads: 1, cacheHits: 3, repeated: 3, unique: 1 },
  );
  assert.equal(second.alreadyInContext, true, 'a hit must not be re-inserted into the prompt');
});

// ── 2. Identical spans are inserted once ────────────────────────────────────────

test('2 — the same excerpt recorded twice is one span, and renders once', async () => {
  const ledger = new EvidenceLedger();
  const text = 'export const A = 1;\nexport const B = 2;';
  ledger.recordRead('src/a.ts', 1, 2, text);
  ledger.recordRead('src/a.ts', 1, 2, text); // same range, same content
  ledger.recordSeed('src/a.ts', 1, 2, text); // the seeder found the same lines
  ledger.recordRead('src/a.ts', 1, 1, 'export const A = 1;'); // contained in the above

  assert.equal(ledger.spans.length, 1, `duplicates collapse, got ${JSON.stringify(ledger.spans.map((s) => [s.startLine, s.endLine]))}`);
  const rendered = renderEvidence(ledger, 10_000);
  assert.equal((rendered.match(/export const A = 1;/g) ?? []).length, 1);
});

// ── 3. Context does not grow by duplicate evidence ──────────────────────────────

test('3 — a second round does not resend the transcript or duplicate evidence', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(
    root,
    'what does scripts/check-brain-transport.mjs do?',
    // Round 1 names a gap; round 2 answers. Both prompts are built from scratch.
    // The gap names a file the ranking did NOT surface, so the expansion is real
    // rather than a re-request of evidence already held.
    ['I need more.\nEVIDENCE-GAP: src/services/unrelated.ts', CITED_ANSWER],
  );

  assert.equal(run.prompts.length, 2, 'exactly two model calls');
  const [first, second] = run.prompts as [PlanMessage[], PlanMessage[]];
  assert.equal(first.length, 2, 'system + user, never a transcript');
  assert.equal(second.length, 2, 'the second call is also system + user');

  const secondUser = second[1]!.content;
  // The model's own round-1 text is NOT in the round-2 prompt: there is no
  // accumulating conversation for context to grow along.
  assert.ok(!secondUser.includes('I need more'), 'the previous reply is not resent');
  // Each evidence excerpt appears exactly once, however many times it was requested.
  const guardHeaders = secondUser.match(/--- scripts\/check-brain-transport\.mjs:/g) ?? [];
  assert.equal(guardHeaders.length, 1, `evidence appears once, got ${guardHeaders.length}`);
  assert.equal((secondUser.match(/Structural anti-bypass guard/g) ?? []).length, 1);
});

// ── 4. The map excludes generated and archived paths ────────────────────────────

test('4 — generated, archived and dependency paths are classified out of the map', async () => {
  const root = tmpRepo(STANDARD_FILES);
  clearRepoMapCache();
  const map = await buildRepoMap(root);

  assert.equal(map.byPath.get('dist/services/brainTransport.js')?.role, 'generated');
  assert.equal(map.byPath.get('backups/check-brain-transport.mjs')?.role, 'archive');
  assert.equal(map.byPath.get('src/services/__tests__/brainTransport.test.ts')?.role, 'test');
  assert.equal(map.byPath.get('src/services/brainTransport.ts')?.role, 'source');
  assert.equal(map.byPath.get('package.json')?.role, 'config');

  // Classification is what keeps them out of ranking, so assert the consequence.
  const ranked = rankCandidates(map, 'brainTransport', { limit: 20 }).map((c) => c.entry.path);
  assert.ok(ranked.includes('src/services/brainTransport.ts'));
  assert.ok(!ranked.some((p) => p.startsWith('dist/')), `no build output: ${ranked.join(', ')}`);
  assert.ok(!ranked.some((p) => p.startsWith('backups/')), `no archives: ${ranked.join(', ')}`);
  assert.ok(!ranked.some((p) => p.includes('__tests__')), 'tests are excluded unless asked for');

  assert.equal(classifyRole('node_modules/x/index.js', 'js'), 'generated');
  assert.equal(classifyRole('apps/web-old/src/a.ts', 'ts'), 'source', 'only the BASENAME marks an archive');
  assert.equal(classifyRole('src/a-old.ts', 'ts'), 'archive');
});

// ── 5. Initial retrieval respects the file budget ───────────────────────────────

test('5 — the initial candidate set never exceeds maxFilesOpened', async () => {
  const many: Record<string, string> = { ...STANDARD_FILES };
  for (let i = 0; i < 20; i += 1) many[`src/services/brainThing${i}.ts`] = `export function brainThing${i}() { return ${i}; }\n`;
  const root = tmpRepo(many);

  const run = await runPlan(root, 'explain the brain services', [CITED_ANSWER], { maxFilesOpened: 3 });
  assert.equal(run.result.spend.filesOpened, 3);
  assert.ok(run.result.spend.candidatesConsidered > 3, 'many were considered, few were opened');
  assert.equal(run.reads.length, 3, 'one filesystem read per opened file');
  assert.ok(run.result.spend.binding.includes('maxFilesOpened'), 'the binding ceiling is reported');
});

// ── 6. Expansion happens only for a named gap ───────────────────────────────────

test('6 — with no gap there is no expansion and no second call', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(root, 'what does scripts/check-brain-transport.mjs do?', [CITED_ANSWER]);
  assert.equal(run.result.spend.modelCalls, 1, 'a supported answer costs one call');
  assert.equal(run.result.spend.expansionRounds, 0);
  assert.equal(run.result.stopReason, 'claims-supported');
  assert.equal(run.result.gaps.length, 0);
});

test('6b — a named gap is resolved to a real file and opened once', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(root, 'what does scripts/check-brain-transport.mjs allow?', [
    'EVIDENCE-GAP: src/services/unrelated.ts',
    CITED_ANSWER,
  ]);
  assert.equal(run.result.spend.expansionRounds, 1);
  const resolved = run.result.gaps.find((g) => g.token === 'src/services/unrelated.ts');
  assert.equal(resolved?.resolvedTo, 'src/services/unrelated.ts');
  assert.equal(resolved?.source, 'model');
});

// ── 7. The model-call ceiling holds ─────────────────────────────────────────────

test('7 — a model that keeps naming gaps still costs no more than maxModelCalls', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const nagging = Array.from({ length: 6 }, (_, i) => `EVIDENCE-GAP: src/services/unrelated.ts\nround ${i}`);
  const run = await runPlan(root, 'explain the brain transport guard', nagging);

  assert.equal(run.result.spend.modelCalls, DEFAULT_EVIDENCE_BUDGET.maxModelCalls);
  assert.equal(run.prompts.length, 2, 'the scripted model was called exactly twice');
  assert.ok(
    ['evidence-budget-exhausted', 'model-call-budget-exhausted'].includes(run.result.stopReason),
    `stop reason names the ceiling, got ${run.result.stopReason}`,
  );
});

// ── 8. Exhausted budget produces a truthful partial, not fabrication ────────────

test('8 — an exhausted budget returns a refusal that states the gap', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(root, 'how does the billing reconciler work?', [
    'The billing reconciler posts invoices to Stripe every hour.',
    'The billing reconciler posts invoices to Stripe every hour.',
  ]);

  assert.equal(run.result.verified.refused, true, 'nothing was supported, so nothing is asserted');
  assert.ok(!run.result.verified.answer.includes('posts invoices to Stripe'), 'the fabrication is gone');
  assert.match(run.result.verified.answer, /could not support an answer/i);
  assert.ok(run.result.spend.modelCalls <= DEFAULT_EVIDENCE_BUDGET.maxModelCalls);
  assert.ok(run.result.stopReason !== 'claims-supported', `stop reason is honest, got ${run.result.stopReason}`);
});

// ── 9. Grounding stays mandatory after compaction ───────────────────────────────

test('9 — compaction preserves exact spans, so the gate still verifies claims', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(root, 'what does scripts/check-brain-transport.mjs do?', [
    `${CITED_ANSWER}\nIt also ships metrics to Prometheus.`,
  ]);

  const kinds = run.result.verified.claims.map((c) => c.kind);
  assert.ok(kinds.includes('direct_evidence'), `the cited claim survives: ${JSON.stringify(run.result.verified.claims)}`);
  assert.ok(run.result.verified.rejected.some((r) => r.terms.includes('Prometheus')), 'the fabricated one does not');

  // The prompt carried real line numbers, not a paraphrase, which is what makes
  // the citation checkable at all.
  const evidence = run.prompts[0]![1]!.content;
  assert.match(evidence, /--- scripts\/check-brain-transport\.mjs:1-\d+ ---/);
  assert.match(evidence, /Structural anti-bypass guard/, 'exact source text, not a summary');
});

// ── 10. A cached span keeps its original range and hash ─────────────────────────

test('10 — a cache hit returns the original span identity, not a fresh one', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const ledger = new EvidenceLedger();
  const first = await ledger.request('scripts/check-brain-transport.mjs', 1, 8, makeSpanSource(root, 'scripts/check-brain-transport.mjs', 1, 8));
  const hit = await ledger.request('scripts/check-brain-transport.mjs', 2, 5, makeSpanSource(root, 'scripts/check-brain-transport.mjs', 2, 5));

  assert.equal(hit.outcome, 'cache-hit');
  assert.equal(hit.span.startLine, first.span.startLine);
  assert.equal(hit.span.endLine, first.span.endLine);
  assert.equal(hit.span.excerptHash, first.span.excerptHash);
  assert.equal(hit.span.text, first.span.text);
});

// ── 11. A changed file invalidates the cached evidence ──────────────────────────

test('11 — editing the file on disk invalidates the cached span', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const rel = 'src/services/unrelated.ts';
  const ledger = new EvidenceLedger();
  const before = await ledger.request(rel, 1, 50, makeSpanSource(root, rel, 1, 50));
  assert.equal(before.outcome, 'fresh');

  // A real edit, with a distinct mtime so the stat fingerprint genuinely moves.
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, 'export function formatDate(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n');
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(abs, future, future);

  const after = await ledger.request(rel, 1, 50, makeSpanSource(root, rel, 1, 50));
  assert.equal(after.outcome, 'stale', 'a changed file is re-read, never served from cache');
  assert.notEqual(after.span.excerptHash, before.span.excerptHash);
  assert.match(after.span.text, /slice\(0, 10\)/);
  assert.equal(ledger.cacheStats().staleRereads, 1);
  // The superseded excerpt is gone: an answer must never cite text the file no
  // longer contains.
  assert.equal(ledger.spansFor(rel).length, 1);
});

test('11b — the repository map is rebuilt when HEAD or the working tree moves', async () => {
  const root = tmpRepo(STANDARD_FILES);
  clearRepoMapCache();
  const first = await buildRepoMap(root);
  assert.equal(first.fromCache, false);
  assert.equal((await buildRepoMap(root)).fromCache, true, 'an unchanged tree reuses the map');

  fs.writeFileSync(path.join(root, 'src/services/added.ts'), 'export const added = 1;\n');
  const dirty = await buildRepoMap(root);
  assert.equal(dirty.fromCache, false, 'a dirty working tree invalidates the cache');
  assert.notEqual(dirty.dirtyFingerprint, first.dirtyFingerprint);
});

// ── 12. check-brain-transport.mjs, answered without repeated reads ──────────────

test('12 — the guard question is answered in one call, one read per file', async () => {
  const root = tmpRepo(STANDARD_FILES);
  const run = await runPlan(root, 'What does scripts/check-brain-transport.mjs do?', [CITED_ANSWER]);

  assert.equal(run.result.stopReason, 'claims-supported');
  assert.equal(run.result.spend.modelCalls, 1, 'small scope costs ONE model call');
  assert.ok(run.result.spend.filesOpened <= DEFAULT_EVIDENCE_BUDGET.maxFilesOpened);

  // One filesystem read per unique file — the four-reads defect, asserted away.
  const unique = new Set(run.reads.map((r) => r.split(':')[0]));
  assert.equal(run.reads.length, unique.size, `no file is read twice: ${run.reads.join(', ')}`);
  assert.equal(run.ledger.cacheStats().uniqueFiles, run.ledger.readPaths.length);
  assert.deepEqual(run.result.spend.binding, [], 'no ceiling bound this run');

  // The guard was ranked first from its filename, with no model-driven search.
  assert.equal(run.result.candidates[0]!.path, 'scripts/check-brain-transport.mjs');
  assert.ok(run.result.opened.includes('scripts/check-brain-transport.mjs'));
  assert.equal(run.result.verified.refused, false);
});

// ── Supporting units ───────────────────────────────────────────────────────────

test('the map records exports, imports and package ownership', async () => {
  const root = tmpRepo(STANDARD_FILES);
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const transport = map.byPath.get('src/services/brainTransport.ts')!;
  assert.deepEqual(transport.exports, ['runBrainOperation']);
  assert.equal(transport.packageName, 'demo-pkg');
  assert.equal(map.byPath.get('package.json')?.entryPoint, 'package manifest');
  assert.ok(map.head.length > 0);
});

test('import edges give a bounded neighbourhood for expansion', () => {
  const map = {
    entries: [],
    byPath: new Map([
      ['src/a.ts', { path: 'src/a.ts', ext: 'ts', role: 'source' as const, sizeBytes: 1, lineCount: 1, exports: [], imports: ['src/b.ts', 'node:fs'] }],
      ['src/b.ts', { path: 'src/b.ts', ext: 'ts', role: 'source' as const, sizeBytes: 1, lineCount: 1, exports: [], imports: [] }],
    ]),
  } as never as Parameters<typeof importNeighbours>[0];
  assert.deepEqual(importNeighbours(map, ['src/a.ts'], 5).map((e) => e.path), ['src/b.ts']);
});

test('gap markers are stripped from the answer and never shown to the user', () => {
  const { answer, gaps } = stripGapMarkers('Partial answer.\nEVIDENCE-GAP: `src/x.ts`\nEVIDENCE-GAP: runBrainOperation\nMore text.');
  assert.equal(answer, 'Partial answer.\nMore text.');
  assert.deepEqual(gaps, ['src/x.ts', 'runBrainOperation']);
});

test('the verifier itself names the gaps, so expansion follows a check not a guess', () => {
  const verified = {
    rejected: [
      { text: 'x', reason: 'no-source-span' as const, terms: ['src/services/brainTransport.ts'] },
      { text: 'y', reason: 'citation-not-retrieved' as const, terms: ['src/other.ts:40'] },
      { text: 'z', reason: 'code-not-in-evidence' as const, terms: ['const invented = 1;'] },
    ],
  } as never as Parameters<typeof gapsFromVerifier>[0];
  assert.deepEqual(gapsFromVerifier(verified), ['src/services/brainTransport.ts', 'src/other.ts']);
});

test('a gap token resolves by path, by suffix, then by exported identifier', async () => {
  const root = tmpRepo(STANDARD_FILES);
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  assert.equal(resolveGap(map, 'src/services/brainTransport.ts')?.path, 'src/services/brainTransport.ts');
  assert.equal(resolveGap(map, 'brainTransport.ts')?.path, 'src/services/brainTransport.ts');
  assert.equal(resolveGap(map, 'runBrainOperation')?.path, 'src/services/brainTransport.ts');
});

test('budget overrides are merged over the measured defaults, and nonsense is refused', () => {
  assert.equal(resolveBudget({ maxFilesOpened: 3 }).maxFilesOpened, 3);
  assert.equal(resolveBudget({ maxFilesOpened: 3 }).maxModelCalls, DEFAULT_EVIDENCE_BUDGET.maxModelCalls);
  assert.equal(resolveBudget({ maxModelCalls: 0 }).maxModelCalls, DEFAULT_EVIDENCE_BUDGET.maxModelCalls, 'zero would answer nothing');
  assert.equal(resolveBudget({ maxSpans: -4 }).maxSpans, DEFAULT_EVIDENCE_BUDGET.maxSpans);
});

test('a workspace that is not a git repository asks for exploration instead of inventing a map', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-nogit-')));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  clearRepoMapCache();
  const map = await buildRepoMap(dir);
  assert.ok(map.unavailable, 'no git, no map');
  assert.equal(map.entries.length, 0);
});

test('the routing digest carries names and exports but never file content', async () => {
  const root = tmpRepo(STANDARD_FILES);
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const digest = describeCandidates(rankCandidates(map, 'brainTransport', { limit: 5 }).map((c) => c.entry));
  assert.match(digest, /src\/services\/brainTransport\.ts/);
  assert.match(digest, /runBrainOperation/);
  assert.ok(!digest.includes('return fetch('), 'the map is routing, never evidence');
});

// ── Scope: the ceilings must actually bind, and routing must not spray ──────────

test('a named path does not turn its own directory words into routing signal', () => {
  // Measured defect: asking about `apps/vscode-extension/scripts/check-...mjs`
  // let "apps", "vscode", "extension" and "scripts" each score every sibling, so
  // seven unrelated modules opened and the call carried 14,622 evidence units.
  const terms = questionTerms('What does apps/vscode-extension/scripts/check-brain-transport.mjs do?');
  assert.deepEqual(terms.paths, ['apps/vscode-extension/scripts/check-brain-transport.mjs']);
  for (const noise of ['apps', 'vscode', 'extension', 'scripts', 'check', 'brain', 'transport']) {
    assert.ok(!terms.words.includes(noise), `"${noise}" comes from the path, not from the question`);
  }
  // A word genuinely outside the path is still routing signal.
  assert.ok(questionTerms('does src/a.ts throttle requests?').words.includes('throttle'));
});

test('candidates far below the best match are not opened', () => {
  const ranked = [
    { entry: { path: 'a.ts' }, score: 148, reasons: [] },
    { entry: { path: 'b.ts' }, score: 39, reasons: [] },
    { entry: { path: 'c.ts' }, score: 31, reasons: [] },
  ] as never as Parameters<typeof aboveRelevanceFloor>[0];
  assert.deepEqual(aboveRelevanceFloor(ranked).map((c) => c.entry.path), ['a.ts', 'b.ts']);

  // A flat field keeps everything; an empty field stays empty; a lone match survives.
  const flat = [
    { entry: { path: 'a.ts' }, score: 10, reasons: [] },
    { entry: { path: 'b.ts' }, score: 9, reasons: [] },
  ] as never as Parameters<typeof aboveRelevanceFloor>[0];
  assert.equal(aboveRelevanceFloor(flat).length, 2);
  assert.equal(aboveRelevanceFloor([]).length, 0);
});

test('the evidence-unit ceiling binds the INITIAL open, not just later spans', async () => {
  const big: Record<string, string> = { ...STANDARD_FILES };
  // Four sizeable, similarly-named files so ranking keeps them all above the floor.
  for (let i = 0; i < 4; i += 1) {
    big[`src/services/brainBulk${i}.ts`] = `// bulk ${i}\n` + 'export const filler = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";\n'.repeat(120);
  }
  const root = tmpRepo(big);

  const run = await runPlan(root, 'explain the brain bulk services', [CITED_ANSWER], { maxEvidenceUnits: 2_000, maxFilesOpened: 8 });
  assert.ok(run.result.spend.evidenceUnits <= 2_000, `the ceiling holds, got ${run.result.spend.evidenceUnits}`);
  assert.ok(run.result.spend.binding.includes('maxEvidenceUnits'), 'and it is reported as binding');
  assert.ok(run.result.spend.filesOpened < 8, 'so fewer files opened than the count ceiling allowed');
  // A file refused on cost is never read at all.
  assert.equal(run.reads.length, run.result.spend.filesOpened);
});

test('one enormous file is still opened — a cost ceiling must not answer nothing', async () => {
  const huge: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'huge-pkg' }),
    'src/onlyFile.ts': 'export function onlyFile() {\n' + '  // padding\n'.repeat(400) + '}\n',
  };
  const root = tmpRepo(huge);
  const run = await runPlan(root, 'what does src/onlyFile.ts do?', ['`src/onlyFile.ts:1-2` defines onlyFile.'], { maxEvidenceUnits: 10 });
  assert.equal(run.result.spend.filesOpened, 1, 'the first file is always allowed');
  assert.ok(run.result.opened.includes('src/onlyFile.ts'));
});
