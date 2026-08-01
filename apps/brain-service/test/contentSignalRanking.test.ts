// Deterministic content-signal ranking.
//
// The measured defect these tests encode: asked "What does the guard allow?", the
// planner ranked 26 candidates, opened seven, and returned a fully grounded answer
// about an ops allowlist, some auth guards and a mail-guardrails deploy script.
// Every citation was real. The answer was useless, because the file that actually
// answers the question scored ZERO — it exports nothing and its filename contains
// neither word, while `guard` sits in a comment and `allow` inside `ALLOWLIST`.
//
// That is a SUBJECT-SELECTION failure, not a grounding failure. So these tests are
// about which files get opened, and — just as importantly — that nothing the
// ranker knows can ever become evidence. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { verifyAnswer } from '../src/engine/grounding/claimVerifier.js';
import { AnswerTimeline } from '../src/engine/answerTimings.js';
import { buildRepoMap, clearRepoMapCache } from '../src/engine/planning/repoMap.js';
import { rankCandidates, aboveRelevanceFloor, isCompoundOf } from '../src/engine/planning/candidateRanking.js';
import { decompose, extractSignals, splitToken, GENERIC_TOKENS } from '../src/engine/planning/contentSignals.js';
import { resolveBudget, DEFAULT_EVIDENCE_BUDGET } from '../src/engine/planning/evidenceBudget.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import { runEvidencePlan, renderEvidence } from '../src/engine/planning/evidencePlan.js';

/** The real fixture, reduced to the properties that made it invisible. */
const GUARD = [
  '#!/usr/bin/env node',
  '// Structural anti-bypass guard for the governed Brain transport.',
  '//',
  '// Fails if any production source file other than the approved adapter performs a',
  '// direct Brain-targeting `fetch()`. The allowlist is deliberately exact and minimal.',
  '',
  "import { readFileSync } from 'node:fs';",
  '',
  "const ALLOWLIST = new Set(['services/brainTransport.ts']);",
  'const BRAIN_MARKERS = [/brainUrl/i, /3988/];',
  'const violations = [];',
  'if (violations.length > 0) process.exit(1);',
  '',
].join('\n');

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo-pkg' }, null, 2),
  // The subject: no exports, filename says neither "guard" nor "allow".
  'apps/ext/scripts/check-brain-transport.mjs': GUARD,
  // Matches only "guard".
  'src/security/mutation-guard.ts': 'export function requireGuard(x: number): boolean {\n  return x > 0;\n}\n',
  // Matches only "allow".
  'src/ops/target-allowlist.ts': 'export const TARGETS = new Set(["a"]);\nexport function isTargetAllowed(t: string): boolean {\n  return TARGETS.has(t);\n}\n',
  // Contains the LETTERS of guard but is not a guard.
  'migrations/deploy-guardian-migration.sh': '#!/bin/sh\n# guardian migration runner\necho migrate\n',
  'infra/deploy-mail-guardrails.sh': '#!/bin/sh\n# guardrails for mail\necho deploy\n',
  // A misleading comment over contradictory code.
  'src/net/plainFetch.ts': '// This module is the security guard that blocks every request.\nexport function sendAnything(url: string): Promise<Response> {\n  return fetch(url);\n}\n',
  // Must never be ranked.
  'dist/ext/scripts/check-brain-transport.js': GUARD,
  'backups/check-brain-transport.mjs': GUARD,
  'node_modules/pkg/guard.js': 'module.exports = { guard: true, allow: true };\n',
};

function tmpRepo(files: Record<string, string> = FILES): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-signals-')));
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
  // node_modules is normally ignored; track it so the ROLE filter is what excludes it.
  fs.writeFileSync(path.join(dir, '.gitignore'), '');
  g(['add', '-A', '-f']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

const SUBJECT = 'apps/ext/scripts/check-brain-transport.mjs';
const QUERY = 'What does the guard allow?';

async function ranked(root: string, query = QUERY): Promise<ReturnType<typeof rankCandidates>> {
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  return rankCandidates(map, query, { limit: 50 });
}

function positionOf(list: ReturnType<typeof rankCandidates>, p: string): number {
  return list.findIndex((c) => c.entry.path === p) + 1;
}
function scoreOf(list: ReturnType<typeof rankCandidates>, p: string): number {
  return list.find((c) => c.entry.path === p)?.score ?? 0;
}

// ── 1-4. The subject is found, and beats single-concept matches ────────────────

test('1 — the plain-English query ranks the file whose name says nothing', async () => {
  const list = await ranked(tmpRepo());
  assert.ok(positionOf(list, SUBJECT) > 0, `subject must be ranked, got ${JSON.stringify(list.map((c) => c.entry.path))}`);
  assert.ok(scoreOf(list, SUBJECT) > 0);
});

test('2 — it enters the bounded candidate set that actually gets opened', async () => {
  const list = aboveRelevanceFloor(await ranked(tmpRepo()));
  assert.ok(list.findIndex((c) => c.entry.path === SUBJECT) >= 0, 'above the relevance floor');
  assert.ok(list.findIndex((c) => c.entry.path === SUBJECT) < DEFAULT_EVIDENCE_BUDGET.maxFilesOpened, 'within the open budget');
});

test('3 — it outranks a file matching only `guard`', async () => {
  const list = await ranked(tmpRepo());
  assert.ok(scoreOf(list, SUBJECT) > scoreOf(list, 'src/security/mutation-guard.ts'), 'two concepts beat one');
});

test('4 — it outranks a file matching only `allow`', async () => {
  const list = await ranked(tmpRepo());
  assert.ok(scoreOf(list, SUBJECT) > scoreOf(list, 'src/ops/target-allowlist.ts'));
});

// ── 5-8. Signal classes carry their designed weight ────────────────────────────

test('5 — ALLOWLIST contributes as executable selection metadata, via decomposition', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const entry = map.byPath.get(SUBJECT)!;
  assert.ok(entry.signals.identifiers.includes('ALLOWLIST'), 'the identifier is captured verbatim');
  assert.ok(entry.signals.tokens.code.includes('allowlist'));
  assert.ok(isCompoundOf('allowlist', 'allow', map.vocabulary), '`allow` is recoverable from ALLOWLIST');

  const reasons = rankCandidates(map, QUERY, { limit: 50 }).find((c) => c.entry.path === SUBJECT)!.reasons;
  assert.ok(reasons.some((r) => /identifier component allow/.test(r)), `executable credit: ${reasons.join('; ')}`);
});

test('6 — the `guard` comment contributes weakly but materially', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const entry = map.byPath.get(SUBJECT)!;
  assert.ok(entry.signals.tokens.comment.includes('guard'), 'guard is a comment term, not an identifier');
  assert.ok(!entry.signals.tokens.code.includes('guard'), 'and it is NOT executable text');

  const reasons = rankCandidates(map, QUERY, { limit: 50 }).find((c) => c.entry.path === SUBJECT)!.reasons;
  assert.ok(reasons.some((r) => /comment term guard/.test(r)), `discoverable via comment: ${reasons.join('; ')}`);
});

test('7 — `guardian` and `guardrails` do not receive exact-guard weight', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  // `ian` is not a word this repository uses, so `guardian` never decomposes.
  assert.equal(isCompoundOf('guardian', 'guard', map.vocabulary), false);
  assert.equal(decompose('guardian', map.vocabulary).length, 0);

  const list = rankCandidates(map, QUERY, { limit: 50 });
  const guardian = scoreOf(list, 'migrations/deploy-guardian-migration.sh');
  const guardrails = scoreOf(list, 'infra/deploy-mail-guardrails.sh');
  assert.equal(guardian, 0, 'guardian is not guard');
  assert.ok(guardrails < scoreOf(list, 'src/security/mutation-guard.ts'), 'guardrails ranks below a real guard');
  assert.ok(scoreOf(list, SUBJECT) > guardrails);
});

test('8 — the multi-concept bonus is bounded', async () => {
  const list = await ranked(tmpRepo());
  const subject = list.find((c) => c.entry.path === SUBJECT)!;
  assert.ok(subject.reasons.some((r) => /2 concepts matched/.test(r)));
  // Bounded: even both concepts across both classes cannot multiply beyond 2.5x,
  // so combination can never dwarf an exact-path match.
  const single = scoreOf(list, 'src/security/mutation-guard.ts') || 1;
  assert.ok(subject.score / single < 25, 'the bonus is a multiplier, not a licence');
});

// ── 9-10. The exact-path contract is untouched ─────────────────────────────────

test('9 — an exact-path query still contributes the full 100 and ranks first', async () => {
  const list = await ranked(tmpRepo(), `What does ${SUBJECT} allow?`);
  assert.equal(list[0]!.entry.path, SUBJECT);
  assert.ok(list[0]!.reasons.some((r) => r.startsWith('exact path match')));
  assert.ok(list[0]!.score >= 100, `exact-path tier intact, got ${list[0]!.score}`);
  assert.equal(list[0]!.exactNamed, true);
});

test('10 — a named file short-circuits the field, so only it is opened', async () => {
  // The regression this prevents: content signals lifted seven unrelated files
  // above the proportional floor, turning a 1-file/19.9s exact-path query into an
  // 8-file/62s one. Better recall arriving where recall was not the problem.
  const kept = aboveRelevanceFloor(await ranked(tmpRepo(), `What does ${SUBJECT} allow?`));
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.entry.path, SUBJECT);
});

// ── 11-12. The evidence boundary ───────────────────────────────────────────────

test('11 — ranking metadata never enters the evidence ledger', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const ledger = new EvidenceLedger();
  const gen = runEvidencePlan({
    question: QUERY,
    map,
    ledger,
    timeline: new AnswerTimeline(),
    budget: resolveBudget({}),
    openSpan: (rel, s, e) => makeSpanSource(root, rel, s, e),
    callModel: async () => 'no answer',
  });
  let step = await gen.next();
  while (!step.done) step = await gen.next();

  // Every span is verbatim file content. Categories, scores and reasons are not.
  for (const span of ledger.spans) {
    const onDisk = fs.readFileSync(path.join(root, span.path), 'utf8');
    assert.ok(onDisk.includes(span.text), `${span.path} span is verbatim source`);
  }
  const corpus = ledger.spans.map((s) => s.text).join('\n');
  for (const artefact of ['structuralCategories', 'exactNamed', 'identifier component', 'category component', '2 concepts matched']) {
    assert.ok(!corpus.includes(artefact), `ranking artefact "${artefact}" is absent from the ledger`);
  }
});

test('12 — ranking metadata never appears in citations, and cannot support a claim', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const entry = map.byPath.get(SUBJECT)!;
  assert.ok(entry.signals.structuralCategories.includes('guard'), 'the category exists as metadata');

  // The word only exists as a CATEGORY and a comment. A behavioural claim resting
  // on it must not be citable as evidence.
  const ledger = new EvidenceLedger();
  ledger.recordRead(SUBJECT, 9, 9, "const ALLOWLIST = new Set(['services/brainTransport.ts']);");
  const v = verifyAnswer(`\`${SUBJECT}:9\` is categorised as a guard and an allowlist.`, ledger, {});
  for (const claim of v.claims) {
    for (const source of claim.sources) {
      assert.ok(ledger.spans.some((s) => s.excerptHash === source.excerptHash), 'every citation resolves to a real span');
    }
  }
  assert.ok(!JSON.stringify(v).includes('structuralCategories'));
});

// ── 13-15. Precision guards ────────────────────────────────────────────────────

test('13 — a misleading comment cannot outrank contradictory executable structure', async () => {
  const list = await ranked(tmpRepo(), 'which module is the security guard that blocks requests?');
  const liar = scoreOf(list, 'src/net/plainFetch.ts');
  const real = scoreOf(list, 'src/security/mutation-guard.ts');
  assert.ok(liar > 0, 'the comment still makes it discoverable');
  assert.ok(real > liar, `code outranks prose: real=${real} liar=${liar}`);
});

test('14 — generic directory words contribute nothing', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  for (const generic of ['apps', 'src', 'services', 'test', 'extension']) {
    assert.ok(GENERIC_TOKENS.has(generic), `${generic} is classified generic`);
  }
  // A query made only of scaffolding words selects nothing.
  assert.equal(rankCandidates(map, 'the src apps services extension', { limit: 50 }).length, 0);
});

test('15 — generated, archived and dependency paths stay excluded', async () => {
  const list = await ranked(tmpRepo());
  const paths = list.map((c) => c.entry.path);
  for (const excluded of ['dist/ext/scripts/check-brain-transport.js', 'backups/check-brain-transport.mjs', 'node_modules/pkg/guard.js']) {
    assert.ok(!paths.includes(excluded), `${excluded} must never be a candidate`);
  }
  // Even though a build copy has identical content to the subject.
  assert.ok(paths.includes(SUBJECT));
});

// ── 16-17. Ceilings and fallback are untouched ─────────────────────────────────

test('16 — candidate and evidence ceilings are unchanged', () => {
  const b = resolveBudget({});
  assert.equal(b.maxEvidenceUnits, 6_000);
  assert.equal(b.maxModelCalls, 2);
  assert.equal(b.maxFilesOpened, 8);
  assert.equal(b.maxExpansionRounds, 1);
  assert.equal(b.maxCandidates, 40);
});

test('17 — zero viable candidates still invokes the explicit fallback', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const map = await buildRepoMap(root);
  const gen = runEvidencePlan({
    question: 'zzqqxx nothing in this repository matches',
    map,
    ledger: new EvidenceLedger(),
    timeline: new AnswerTimeline(),
    budget: resolveBudget({}),
    openSpan: (rel, s, e) => makeSpanSource(root, rel, s, e),
    callModel: async () => 'unused',
  });
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  assert.equal(step.value.stopReason, 'no-candidates');
  assert.equal(step.value.needsExploration, true, 'exploration is entered explicitly, never silently');
});

// ── 18-20. Cache correctness ───────────────────────────────────────────────────

test('18 — a dirty working-tree change invalidates the signal entry without a commit', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const before = await buildRepoMap(root);
  assert.equal(before.byPath.get('src/security/mutation-guard.ts')!.signals.identifiers.includes('requireGuard'), true);

  fs.writeFileSync(path.join(root, 'src/security/mutation-guard.ts'), 'export function permitEverything(): boolean {\n  return true;\n}\n');
  const after = await buildRepoMap(root); // no commit
  assert.equal(after.fromCache, false, 'a dirty tree is never served from cache');
  assert.notEqual(after.dirtyFingerprint, before.dirtyFingerprint);
  assert.ok(after.byPath.get('src/security/mutation-guard.ts')!.signals.identifiers.includes('permitEverything'));
});

test('19 — cached map reuse preserves identical ranking', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const first = await buildRepoMap(root);
  const second = await buildRepoMap(root);
  assert.equal(second.fromCache, true);
  const a = rankCandidates(first, QUERY, { limit: 50 }).map((c) => `${c.entry.path}:${c.score.toFixed(4)}`);
  const b = rankCandidates(second, QUERY, { limit: 50 }).map((c) => `${c.entry.path}:${c.score.toFixed(4)}`);
  assert.deepEqual(b, a, 'a cached map ranks byte-identically');
});

test('20 — a changed executable identifier changes ranking after invalidation', async () => {
  const root = tmpRepo();
  clearRepoMapCache();
  const before = rankCandidates(await buildRepoMap(root), QUERY, { limit: 50 });
  const scoreBefore = scoreOf(before, SUBJECT);

  // Remove the executable `ALLOWLIST`; only the comment now mentions the concepts.
  fs.writeFileSync(
    path.join(root, SUBJECT),
    GUARD.replace("const ALLOWLIST = new Set(['services/brainTransport.ts']);", 'const PERMITTED = new Set([]);'),
  );
  const after = rankCandidates(await buildRepoMap(root), QUERY, { limit: 50 });
  assert.notEqual(scoreOf(after, SUBJECT), scoreBefore, 'ranking follows the code, not a stale index');
  assert.ok(scoreOf(after, SUBJECT) < scoreBefore, 'losing the executable signal costs more than losing prose would');
});

// ── Supporting units ───────────────────────────────────────────────────────────

test('splitToken normalises case, separators and paths', () => {
  assert.deepEqual(splitToken('checkBrainTransport'), ['check', 'brain', 'transport']);
  assert.deepEqual(splitToken('mutation-guard.ts'), ['mutation', 'guard']);
  assert.deepEqual(splitToken('BRAIN_MARKERS'), ['brain', 'markers']);
  assert.deepEqual(splitToken('ALLOWLIST'), ['allowlist'], 'a run-together compound survives whole here');
});

test('extractSignals separates executable text from commentary', () => {
  const s = extractSignals({ path: 'a.mjs', text: GUARD, role: 'source' });
  assert.ok(s.identifiers.includes('ALLOWLIST'));
  assert.ok(s.tokens.comment.includes('guard'));
  assert.ok(!s.tokens.code.includes('guard'), 'a comment word is never executable text');
  assert.ok(s.imports.includes('node:fs'));
  assert.ok(!JSON.stringify(s).includes('process.exit(1)'), 'signals carry no source bodies');
});

test('renderEvidence carries source spans only — never signals', async () => {
  const root = tmpRepo();
  const ledger = new EvidenceLedger();
  await ledger.request(SUBJECT, 1, 20, makeSpanSource(root, SUBJECT, 1, 20));
  const rendered = renderEvidence(ledger);
  assert.match(rendered.text, /ALLOWLIST/);
  assert.ok(!rendered.text.includes('structuralCategor'));
  assert.ok(!rendered.text.includes('concepts matched'));
});
