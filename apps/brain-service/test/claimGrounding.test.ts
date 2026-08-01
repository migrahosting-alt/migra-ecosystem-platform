// Claim-level grounding for repository answers.
//
// The primary regression uses the REAL `check-brain-transport.mjs` from the
// extension, not a fixture: the defect being closed was an answer about that exact
// file that named `package.json`, `brainTransport` and an HTTP-versus-WebSocket
// choice, none of which the run had retrieved. A fixture would have let the gate
// pass while the real file still produced the wrong answer.
//
// The adversarial cases below are the failure modes that a citation-shaped answer
// hides: a filename that lies, a comment that outlives its code, two files with
// almost the same name, a file that was opened but proves nothing, evidence too
// thin to answer from, and reasoning dressed as fact. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvidenceLedger, extractCitations, hashExcerpt, splitCodeAndComments } from '../src/engine/grounding/evidenceLedger.js';
import {
  verifyAnswer,
  extractRepoTerms,
  INFERENCE_LABEL,
  COMMENT_INFERENCE_LABEL,
  type RejectedClaim,
} from '../src/engine/grounding/claimVerifier.js';

/** Walk up from the compiled test to find a repo-relative file. */
function repoFile(rel: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, rel);
    if (fs.existsSync(candidate)) return candidate;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`could not locate ${rel} from ${path.dirname(fileURLToPath(import.meta.url))}`);
}

const GUARD_REL = 'apps/vscode-extension/scripts/check-brain-transport.mjs';
const GUARD_ABS = repoFile(GUARD_REL);
const GUARD_SOURCE = fs.readFileSync(GUARD_ABS, 'utf8');
const GUARD_LINES = GUARD_SOURCE.split('\n');

/** A ledger holding the given line range of the real guard script. */
function guardLedger(startLine = 1, endLine = GUARD_LINES.length): EvidenceLedger {
  const ledger = new EvidenceLedger();
  ledger.notePath(GUARD_REL);
  ledger.recordRead(GUARD_REL, startLine, endLine, GUARD_LINES.slice(startLine - 1, endLine).join('\n'));
  return ledger;
}

function reasons(rejected: RejectedClaim[]): string[] {
  return rejected.map((r) => r.reason);
}

// ── Primary regression: check-brain-transport.mjs ────────────────────────────────

test('regression: the true description of check-brain-transport.mjs survives as direct evidence', () => {
  const ledger = guardLedger();
  const answer = [
    `\`${GUARD_REL}:2-9\` documents it as a structural anti-bypass guard for the governed Brain transport.`,
    `\`${GUARD_REL}:39-66\` fails the check when a source file outside the approved adapter performs a direct Brain-targeting \`fetch()\`, printing the violations and exiting non-zero.`,
  ].join('\n');

  const v = verifyAnswer(answer, ledger, { question: 'what does check-brain-transport.mjs do?' });

  assert.equal(v.refused, false, 'a correct, cited description is not refused');
  assert.equal(v.rejected.length, 0, `nothing should be rejected, got ${JSON.stringify(v.rejected)}`);
  const direct = v.claims.filter((c) => c.kind === 'direct_evidence');
  assert.equal(direct.length, 2, 'both sentences are direct evidence');
  // The description identifies the file's actual job.
  assert.match(v.answer, /anti-bypass guard/);
  assert.match(v.answer, /Brain-targeting/);
  assert.match(v.answer, /approved adapter/);
  // Every direct claim carries an exact, hashed source span.
  for (const c of direct) {
    assert.ok(c.sources.length > 0, 'a direct claim has sources');
    for (const s of c.sources) {
      assert.equal(s.path, GUARD_REL);
      assert.equal(s.excerptHash.length, 16);
      assert.ok(s.startLine >= 1 && s.endLine >= s.startLine);
    }
  }
});

test('regression: HTTP-versus-WebSocket selection is removed — those terms are not in the file', () => {
  const ledger = guardLedger();
  const answer = `The script selects between HTTP and WebSocket transports for the Brain. (\`${GUARD_REL}:14\`)`;

  const v = verifyAnswer(answer, ledger, { question: 'how does it choose a transport?' });

  assert.equal(v.claims.filter((c) => c.kind === 'direct_evidence').length, 0);
  assert.deepEqual(reasons(v.rejected), ['term-absent-from-evidence']);
  // The gate may NAME an unsupported term when disclosing the removal — that is a
  // negation. What it must never do is leave the assertion standing.
  const body = v.answer.split('> ⚠️')[0]!;
  assert.ok(!/WebSocket/i.test(body), `WebSocket is not asserted in the body: ${body}`);
  assert.ok(!/selects between/i.test(body));
  const terms = v.rejected[0]!.terms.map((t) => t.toLowerCase());
  assert.ok(terms.includes('websocket'), `WebSocket flagged, got ${terms.join(',')}`);
  assert.ok(terms.includes('http'), `HTTP flagged, got ${terms.join(',')}`);
  assert.equal(v.refused, true, 'nothing survived as evidence, so the gate refuses');
});

test('regression: package.json is rejected even when a `list` proved the file exists', () => {
  // The hard version: the path IS real and the run DID see it. It is still not
  // evidence for what check-brain-transport.mjs does.
  const ledger = guardLedger();
  ledger.notePath('package.json');
  const answer = `The transport choice is configured in \`package.json\`. (\`${GUARD_REL}:14\`)`;

  const v = verifyAnswer(answer, ledger, {});

  assert.deepEqual(reasons(v.rejected), ['term-not-in-cited-source']);
  assert.deepEqual(v.rejected[0]!.terms, ['package.json']);
  assert.ok(!v.answer.includes('is configured in'), 'the claim is gone from the answer body');
});

test('regression: a brainTransport reference is rejected when the allowlist was never retrieved', () => {
  // Lines 1-14 stop short of the ALLOWLIST at line 17-19.
  const ledger = guardLedger(1, 14);
  assert.ok(!ledger.spans[0]!.text.includes('brainTransport'), 'fixture precondition: allowlist not retrieved');

  const answer = `Requests are delegated to \`services/brainTransport.ts\` at runtime. (\`${GUARD_REL}:12\`)`;
  const v = verifyAnswer(answer, ledger, {});

  assert.deepEqual(reasons(v.rejected), ['term-absent-from-evidence']);
  assert.deepEqual(v.rejected[0]!.terms, ['services/brainTransport.ts']);
});

test('regression: the same brainTransport reference is allowed once the allowlist IS retrieved', () => {
  const ledger = guardLedger();
  const answer = `The only file permitted to call fetch against the Brain is \`services/brainTransport.ts\`. (\`${GUARD_REL}:16-19\`)`;

  const v = verifyAnswer(answer, ledger, {});

  assert.equal(v.rejected.length, 0, `expected acceptance, got ${JSON.stringify(v.rejected)}`);
  assert.equal(v.claims[0]!.kind, 'direct_evidence');
  assert.match(v.answer, /services\/brainTransport\.ts/);
});

// ── Adversarial case 1: a filename that lies ────────────────────────────────────

test('adversarial: a misleading filename does not license the behaviour it advertises', () => {
  const ledger = new EvidenceLedger();
  ledger.recordRead(
    'src/authValidator.ts',
    1,
    3,
    ['export function toIsoDay(input: Date): string {', '  return input.toISOString().slice(0, 10);', '}'].join('\n'),
  );

  const v = verifyAnswer('`src/authValidator.ts:1-3` validates the submitted password against the session store.', ledger, {});
  assert.deepEqual(reasons(v.rejected), ['citation-does-not-support']);

  const truthful = verifyAnswer('`src/authValidator.ts:1-3` formats a date as an ISO day via `toIsoDay`.', ledger, {});
  assert.equal(truthful.rejected.length, 0, `truthful claim survives, got ${JSON.stringify(truthful.rejected)}`);
  assert.equal(truthful.claims[0]!.kind, 'direct_evidence');
});

// ── Adversarial case 2: a comment that outlives its code ────────────────────────

test('adversarial: a claim backed only by a stale comment is demoted to labelled inference', () => {
  const ledger = new EvidenceLedger();
  ledger.recordRead(
    'src/net.ts',
    1,
    5,
    [
      '// Retries the request three times with exponential backoff.',
      'export async function send(url: string): Promise<Response> {',
      '  return fetch(url);',
      '}',
    ].join('\n'),
  );

  const v = verifyAnswer('`src/net.ts:1-5` retries the request three times with exponential backoff.', ledger, {});

  assert.equal(v.rejected.length, 0);
  assert.equal(v.claims.length, 1);
  assert.equal(v.claims[0]!.kind, 'inference', 'a comment is not evidence of behaviour');
  assert.equal(v.claims[0]!.basis, 'comment');
  assert.ok(v.answer.includes(COMMENT_INFERENCE_LABEL), 'the demotion is visible in the answer');
  assert.equal(v.refused, true, 'no direct evidence survived, so the answer is a refusal');

  // The executable truth is still answerable as direct evidence.
  const code = verifyAnswer('`src/net.ts:3` calls `fetch` once and returns the response.', ledger, {});
  assert.equal(code.claims[0]!.kind, 'direct_evidence');
});

// ── Adversarial case 3: two similarly named files ───────────────────────────────

test('adversarial: behaviour from one file may not be attributed to its near-namesake', () => {
  const ledger = new EvidenceLedger();
  ledger.recordRead(
    'src/providerRouter.ts',
    1,
    3,
    ['export function chooseProvider(candidates: Provider[]): Provider {', '  return candidates[0]!;', '}'].join('\n'),
  );
  ledger.recordRead(
    'src/providerRouterClient.ts',
    1,
    3,
    ['export async function postRoute(body: unknown): Promise<Response> {', '  return fetch(HTTP_ENDPOINT, { method: "POST", body: JSON.stringify(body) });', '}'].join('\n'),
  );

  // The HTTP call lives in the CLIENT; attributing it to the router is a real
  // mistake that a whole-corpus check would wave through.
  const misattributed = verifyAnswer('`src/providerRouter.ts:1-3` issues the HTTP request to the route endpoint.', ledger, {});
  assert.deepEqual(reasons(misattributed.rejected), ['term-not-in-cited-source']);
  assert.deepEqual(misattributed.rejected[0]!.terms, ['HTTP']);

  // Citing the file that was never read at those lines resolves to nothing.
  const unread = new EvidenceLedger();
  unread.recordRead('src/providerRouter.ts', 1, 3, 'export function chooseProvider() { return null; }');
  unread.notePath('src/providerRouterClient.ts');
  const v = verifyAnswer('`src/providerRouterClient.ts:2` posts the route request.', unread, {});
  assert.deepEqual(reasons(v.rejected), ['citation-not-retrieved']);
});

// ── Adversarial case 4: an opened file that proves nothing ──────────────────────

test('adversarial: opening a file does not make it evidence for an unrelated claim', () => {
  const ledger = new EvidenceLedger();
  ledger.recordRead('src/config.ts', 1, 2, ['export const PORT = 3988;', 'export const HOST = "127.0.0.1";'].join('\n'));

  const v = verifyAnswer('`src/config.ts:1-2` throttles inbound requests to twenty per minute.', ledger, {});
  assert.deepEqual(reasons(v.rejected), ['citation-does-not-support']);
  assert.equal(v.claims.length, 0);
  assert.equal(v.refused, true);
  assert.match(v.answer, /src\/config\.ts/, 'the refusal still says what WAS retrieved');
});

// ── Adversarial case 5: evidence too thin to answer from ────────────────────────

test('adversarial: filenames alone force a refusal that states the gap', () => {
  const ledger = new EvidenceLedger();
  ledger.notePath('src/engine/agenticAnswer.ts');
  ledger.notePath('src/engine/answerRoutes.ts');

  const v = verifyAnswer(
    'The agentic loop caps itself at eight tool steps and then synthesises. (`src/engine/agenticAnswer.ts:48`)',
    ledger,
    { question: 'how many tool steps does the loop allow?' },
  );

  assert.equal(v.refused, true);
  assert.deepEqual(reasons(v.rejected), ['citation-not-retrieved']);
  assert.match(v.answer, /could not support an answer/i);
  assert.match(v.answer, /read none of them/i, 'the gap says paths were located but not read');
  assert.match(v.answer, /src\/engine\/agenticAnswer\.ts/);
});

test('adversarial: an empty model answer refuses and lists the content actually retrieved', () => {
  const ledger = guardLedger(1, 20);
  const v = verifyAnswer('', ledger, { question: 'what does the guard do?' });
  assert.equal(v.refused, true);
  assert.match(v.answer, /Content I did retrieve/);
  assert.match(v.answer, new RegExp(GUARD_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(v.answer, /lines 1-20/);
});

// ── Adversarial case 6: reasoning dressed as fact ───────────────────────────────

test('adversarial: hedged reasoning survives but is visibly labelled as inference', () => {
  const ledger = guardLedger();
  const answer = `The allowlist is likely kept minimal so that widening it appears in review. (\`${GUARD_REL}:16-19\`)`;

  const v = verifyAnswer(answer, ledger, {});

  assert.equal(v.rejected.length, 0);
  assert.equal(v.claims.length, 1);
  assert.equal(v.claims[0]!.kind, 'inference');
  assert.equal(v.claims[0]!.basis, 'hedged');
  // Inference alone is not an answer: the gate still refuses, and the reasoning is
  // carried through under a label rather than deleted or promoted to fact.
  assert.equal(v.refused, true);
  assert.ok(v.answer.includes(INFERENCE_LABEL), `inference is labelled: ${v.answer}`);
  assert.match(v.answer, /Unverified inference \(reasoning, not evidence\)/);
});

test('an inference sentence beside an evidenced one is labelled individually', () => {
  const ledger = guardLedger();
  const answer =
    `The scanner walks the src tree and collects \`.ts\` files. It probably skips \`test\` directories to avoid noise. (\`${GUARD_REL}:24-35\`)`;

  const v = verifyAnswer(answer, ledger, {});
  const kinds = v.claims.map((c) => c.kind);
  assert.ok(kinds.includes('direct_evidence'), `expected a direct claim, got ${JSON.stringify(v.claims)}`);
  assert.ok(kinds.includes('inference'), 'the hedged sentence is inference');
  assert.equal((v.answer.match(/inference — not directly evidenced/g) ?? []).length, 1, 'only the hedged sentence is labelled');
});

// ── Structural rules ────────────────────────────────────────────────────────────

// ── Anchoring: the span may come from the ledger, never the model's imagination ──

test('a correct description that names the file it read is anchored by the gate, not deleted', () => {
  // A model that describes a file accurately but writes no `path:line` has produced
  // a grounded answer with bad formatting. The gate resolves the span itself; the
  // line numbers on the claim are the ledger's.
  const ledger = guardLedger();
  const answer = `The \`${GUARD_REL}\` script collects violations and exits non-zero when a direct Brain fetch is found outside the approved transport adapter.`;

  const v = verifyAnswer(answer, ledger, {});

  assert.equal(v.rejected.length, 0, JSON.stringify(v.rejected));
  assert.equal(v.claims[0]!.kind, 'direct_evidence');
  assert.equal(v.claims[0]!.anchor, 'derived');
  assert.deepEqual(v.claims[0]!.sources, [{ path: GUARD_REL, startLine: 1, endLine: GUARD_LINES.length, excerptHash: v.claims[0]!.sources[0]!.excerptHash }]);
  assert.equal(v.refused, false);
});

test('an explicit citation is marked as cited and outranks the derived anchor', () => {
  const ledger = guardLedger();
  const v = verifyAnswer(`\`${GUARD_REL}:39-66\` collects the violations and exits non-zero.`, ledger, {});
  assert.equal(v.claims[0]!.anchor, 'cited');
});

test('a WRONG explicit citation is never rescued by a derived anchor', () => {
  // The file is right there in the ledger, and the sentence names it. If a bad
  // citation could silently fall back, the gate would be correcting the model's
  // references instead of checking them.
  const ledger = guardLedger(1, 20);
  const v = verifyAnswer(`\`${GUARD_REL}:900-940\` collects the violations and exits non-zero.`, ledger, {});
  assert.deepEqual(reasons(v.rejected), ['citation-not-retrieved']);
});

test('the anchor carries across paragraphs, but a claim that drifts off-subject still fails', () => {
  const ledger = guardLedger();
  ledger.recordRead('src/config.ts', 1, 2, ['export const PORT = 3988;', 'export const HOST = "127.0.0.1";'].join('\n'));

  const answer = [
    `The \`${GUARD_REL}\` script is the anti-bypass guard.`,
    '',
    'It walks the source tree and skips the test directory.',
    '',
    'It throttles inbound requests to twenty per minute.',
  ].join('\n');

  const v = verifyAnswer(answer, ledger, {});
  // Sentence 2 inherits the guard as its subject and is supported by its code.
  assert.ok(v.claims.some((c) => /walks the source tree/.test(c.text) && c.kind === 'direct_evidence'), JSON.stringify(v.claims));
  // Sentence 3 inherits the same subject and is rejected — inheritance supplies an
  // anchor, never support.
  assert.ok(v.rejected.some((r) => /throttles/.test(r.text) && r.reason === 'citation-does-not-support'), JSON.stringify(v.rejected));
});

test('a file that was only listed can never become the anchor', () => {
  const ledger = new EvidenceLedger();
  ledger.notePath('src/rateLimiter.ts');
  const v = verifyAnswer('The `src/rateLimiter.ts` module throttles inbound requests.', ledger, {});
  assert.deepEqual(reasons(v.rejected), ['no-source-span']);
});

test('a language name is supported by the extensions the code actually matches on', () => {
  const ledger = guardLedger();
  const v = verifyAnswer(`The \`${GUARD_REL}\` script walks the source tree collecting TypeScript files.`, ledger, {});
  assert.equal(v.rejected.length, 0, `\`.ts\` in the code supports "TypeScript": ${JSON.stringify(v.rejected)}`);
});

test('the removal note explains each reason correctly instead of blaming absence for everything', () => {
  const ledger = guardLedger();
  const answer = [
    'The script publishes metrics to Prometheus.',
    '',
    `The \`${GUARD_REL}\` script collects violations and exits non-zero.`,
  ].join('\n');

  const v = verifyAnswer(answer, ledger, {});
  assert.equal(v.rejected.length, 1);
  assert.equal(v.rejected[0]!.reason, 'term-absent-from-evidence');
  assert.match(v.answer, /`Prometheus` — never appeared in anything this run retrieved/);

  // A claim dropped for a DIFFERENT reason must not be described as absent: its
  // terms were in the evidence, they just did not anchor.
  const noSpan = verifyAnswer('The `ALLOWLIST` permits `services/brainTransport.ts`.', ledger, {});
  assert.equal(noSpan.rejected[0]!.reason, 'no-source-span');
  assert.match(noSpan.answer, /named no file this run had read/);
  assert.ok(!/never appeared/.test(noSpan.answer), 'the gate does not misreport why it dropped a claim');
});

test('a factual repository claim with no source span anywhere in its block is removed', () => {
  const ledger = guardLedger();
  const v = verifyAnswer('The `ALLOWLIST` contains `services/brainTransport.ts`.', ledger, {});
  assert.deepEqual(reasons(v.rejected), ['no-source-span']);
});

test('narrative that names nothing in the repository is left alone', () => {
  const ledger = guardLedger();
  const answer = `Here is what I found, in short. The scanner collects violations and exits non-zero. (\`${GUARD_REL}:39-66\`)`;
  const v = verifyAnswer(answer, ledger, {});
  assert.equal(v.rejected.length, 0);
  assert.equal(v.claims.length, 1, 'only the factual sentence is a claim');
  assert.match(v.answer, /Here is what I found/, 'the connective prose survives beside it');
});

test('an answer that is ONLY narrative still refuses — it answered nothing', () => {
  const ledger = guardLedger();
  const v = verifyAnswer('Here is what I found, in short.', ledger, { question: 'what does the guard do?' });
  assert.equal(v.claims.length, 0);
  assert.equal(v.refused, true);
  assert.match(v.answer, /could not support an answer/i);
});

test('a fenced code block must be code the run literally retrieved', () => {
  const ledger = guardLedger();
  const invented = ['```js', 'const transport = new WebSocketTransport(brainUrl);', 'await transport.connect();', '```'].join('\n');
  const v = verifyAnswer(invented, ledger, {});
  assert.deepEqual(reasons(v.rejected), ['code-not-in-evidence']);
  assert.ok(!v.answer.includes('WebSocketTransport'));

  const real = ['```js', "const ALLOWLIST = new Set([", "  'services/brainTransport.ts', // the transport primitive itself", '```'].join('\n');
  const kept = verifyAnswer(real, ledger, {});
  assert.equal(kept.rejected.length, 0, `verbatim code survives, got ${JSON.stringify(kept.rejected)}`);
});

test('the removal note names the unsupported terms so the gate is auditable', () => {
  const ledger = guardLedger();
  const answer = [
    `\`${GUARD_REL}:39-66\` collects violations and exits non-zero when a direct Brain fetch is found outside the approved adapter.`,
    '',
    `It also publishes metrics to Prometheus. (\`${GUARD_REL}:60\`)`,
  ].join('\n');

  const v = verifyAnswer(answer, ledger, {});
  assert.equal(v.refused, false, 'one good claim survives');
  assert.equal(v.rejected.length, 1);
  assert.match(v.answer, /Grounding gate: 1 statement\(s\) were removed/);
  assert.match(v.answer, /`Prometheus`/);
  assert.ok(!v.answer.split('⚠️')[0]!.includes('publishes metrics'), 'the claim itself is gone from the body');
});

// ── Ledger primitives ───────────────────────────────────────────────────────────

test('a citation resolves only to lines the run actually retrieved', () => {
  const ledger = guardLedger(1, 20);
  assert.equal(ledger.resolve({ path: GUARD_REL, startLine: 5, endLine: 9 }).length, 1);
  assert.equal(ledger.resolve({ path: GUARD_REL, startLine: 400, endLine: 420 }).length, 0, 'a line past what we read does not resolve');
  assert.equal(ledger.resolve({ path: 'src/nowhere.ts', startLine: 1, endLine: 2 }).length, 0);
});

test('extractCitations parses path:line and path:start-end, and ignores prose', () => {
  assert.deepEqual(extractCitations('see `src/a.ts:12` and src/b.ts:3-9'), [
    { path: 'src/a.ts', startLine: 12, endLine: 12 },
    { path: 'src/b.ts', startLine: 3, endLine: 9 },
  ]);
  assert.deepEqual(extractCitations('there are 12 files, roughly 3-9 of them relevant'), []);
});

test('excerptHash is stable across trailing-whitespace round trips but not content edits', () => {
  assert.equal(hashExcerpt('const a = 1;\nconst b = 2;'), hashExcerpt('const a = 1;   \nconst b = 2;\t'));
  assert.notEqual(hashExcerpt('const a = 1;'), hashExcerpt('const a = 2;'));
});

test('splitCodeAndComments keeps a URL intact and pulls JSDoc continuations out of code', () => {
  const { code, comments } = splitCodeAndComments('src/x.ts', ['/**', ' * Sends to the Brain.', ' */', 'const url = "https://brain.example/health"; // trailing note'].join('\n'));
  assert.match(comments, /Sends to the Brain/);
  assert.match(comments, /trailing note/);
  assert.match(code, /https:\/\/brain\.example\/health/, 'the // of a URL is not a comment');
  assert.ok(!code.includes('Sends to the Brain'));
});

test('extractRepoTerms picks names the repository chose, not ordinary English', () => {
  const terms = extractRepoTerms('The `brainTransport` adapter reads `services/foo.ts` and never opens a WebSocket.');
  const values = terms.map((t) => t.value);
  assert.ok(values.includes('brainTransport'));
  assert.ok(values.includes('services/foo.ts'));
  assert.ok(values.includes('WebSocket'));
  assert.ok(!values.includes('adapter'), 'a plain English word is not a repository term');
  assert.ok(!values.includes('never'));
});
