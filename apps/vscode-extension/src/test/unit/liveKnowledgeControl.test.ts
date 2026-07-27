import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  LIVE_MODE_OPTIONS,
  SOURCE_MODE_OPTIONS,
  groundingModeOf,
  liveKnowledgeBadge,
  liveModeConfirmation,
  liveModeOf,
  permitsLiveLookup,
} from '../../panel/shell/composerModel.js';
import { shellHtml } from '../../panel/shell/shellHtml.js';
import { shellScript } from '../../panel/shell/shellScript.js';

/**
 * Live knowledge is a SECOND, independent evidence dimension, and the control has to
 * behave like one.
 *
 * The repository selector governs which repository material may be used. This one
 * governs whether anything leaves the machine at all. Neither implies the other, so the
 * two must be separately settable, separately serialized and separately disclosed — and
 * a webview reload must never be able to turn egress on.
 *
 * The other half of the job is honesty about coverage: no general-web provider ships
 * yet, so `web` gets authoritative connectors and the frame says so. A control that
 * claimed broad web coverage while delivering seven first-party APIs would be a worse
 * lie than offering no web mode at all.
 */

/** Read extension SOURCE, so an assertion is about what ships rather than a mock. */
function source(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'src', rel), 'utf8');
}

// ── the control exposes exactly the enforced modes ───────────────────────────

test('the selector exposes the three protocol modes with the required labels', () => {
  assert.deepEqual(LIVE_MODE_OPTIONS.map((o) => o.value), ['off', 'official', 'web']);
  assert.deepEqual(LIVE_MODE_OPTIONS.map((o) => o.label), ['Live knowledge off', 'Official sources', 'Web research']);
});

test('the UI values match the protocol union exactly', () => {
  const protocolPath = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'protocol', 'src', 'liveKnowledge.ts');
  const protocol = readFileSync(protocolPath, 'utf8');
  const declared = /LIVE_KNOWLEDGE_MODES = \[([\s\S]*?)\] as const/.exec(protocol)?.[1] ?? '';
  const protocolValues = [...declared.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

  // A UI offering a mode the Brain does not enforce is a false governance guarantee,
  // and for network egress that failure is considerably worse than for retrieval.
  assert.deepEqual(LIVE_MODE_OPTIONS.map((o) => o.value), protocolValues);
});

test('an unrecognised mode fails CLOSED to off, never to a lookup', () => {
  // Deliberately unlike the repository parser, which defaults to `auto`. There the
  // default is the prior behaviour; here anything but `off` would grant egress to a
  // turn that never asked for it.
  for (const bad of ['OFFICIAL', 'web ', 'search', 'auto', 'approved', '', undefined, null, 0]) {
    assert.equal(liveModeOf(bad as string | undefined), 'off', `must not honour ${String(bad)}`);
  }
  assert.equal(permitsLiveLookup(undefined), false);
  assert.equal(permitsLiveLookup('official'), true);
  assert.equal(permitsLiveLookup('web'), true);
});

test('off is the only ungoverned state, and it is the default', () => {
  assert.deepEqual(LIVE_MODE_OPTIONS.filter((o) => o.governed).map((o) => o.value), ['official', 'web']);
  assert.equal(LIVE_MODE_OPTIONS[0]!.value, 'off', 'the first option is what an unset control shows');
  assert.match(source('panel/shell/shellProvider.ts'), /private liveMode = 'off'/, 'and the host default is off');
});

// ── serialization: backward compatible, exact, independent ───────────────────

test('off is omitted from the wire so existing payloads are unchanged', () => {
  const engine = source('chat/chatEngine.ts');
  assert.match(
    engine,
    /options\.liveMode && liveModeOf\(options\.liveMode\) !== 'off'\s*\?\s*\{ liveKnowledgeMode: liveModeOf\(options\.liveMode\) \}\s*:\s*\{\}/,
    'a new field on every request would be a silent behaviour change for older Brains',
  );
});

test('official and web serialize to exactly their protocol values', () => {
  // The selector stores the PROTOCOL value, so a label change cannot alter what the
  // Brain is asked to enforce.
  assert.equal(liveModeOf('official'), 'official');
  assert.equal(liveModeOf('web'), 'web');
  const wire = (mode: string | undefined) =>
    mode && liveModeOf(mode) !== 'off' ? { liveKnowledgeMode: liveModeOf(mode) } : {};
  assert.deepEqual(wire('official'), { liveKnowledgeMode: 'official' });
  assert.deepEqual(wire('web'), { liveKnowledgeMode: 'web' });
  assert.deepEqual(wire('off'), {});
  assert.deepEqual(wire(undefined), {});
});

test('the two controls are separate fields and never mutate one another', () => {
  const engine = source('chat/chatEngine.ts');
  // Two independent spreads, two independent request fields.
  assert.match(engine, /\{ groundingMode: groundingModeOf\(options\.sourceMode\) \}/);
  assert.match(engine, /\{ liveKnowledgeMode: liveModeOf\(options\.liveMode\) \}/);
  // Neither parser is ever fed the other's value.
  assert.ok(!/liveModeOf\(options\.sourceMode\)/.test(engine));
  assert.ok(!/groundingModeOf\(options\.liveMode\)/.test(engine));

  const provider = source('panel/shell/shellProvider.ts');
  // Separate sticky state, separate shellActions.
  assert.match(provider, /private sourceMode = 'auto'/);
  assert.match(provider, /private liveMode = 'off'/);
  assert.match(provider, /case 'liveMode:official':/);
  assert.match(provider, /case 'sourceMode:approved':/);
  // A liveMode action must not touch sourceMode, or vice versa.
  const liveCase = /case 'liveMode:off':[\s\S]*?return;\s*\}/.exec(provider)?.[0] ?? '';
  assert.ok(liveCase.length > 0, 'the liveMode handler exists');
  assert.ok(!/this\.sourceMode/.test(liveCase), 'the live handler must not write sourceMode');
  const sourceCase = /case 'sourceMode:approved':[\s\S]*?return;\s*\}/.exec(provider)?.[0] ?? '';
  assert.ok(!/this\.liveMode/.test(sourceCase), 'the source handler must not write liveMode');
});

test('all five required repository/live combinations are independently expressible', () => {
  const wire = (sourceMode: string, liveMode: string) => ({
    ...(groundingModeOf(sourceMode) !== 'auto' ? { groundingMode: groundingModeOf(sourceMode) } : {}),
    ...(liveModeOf(liveMode) !== 'off' ? { liveKnowledgeMode: liveModeOf(liveMode) } : {}),
  });

  assert.deepEqual(wire('approved', 'official'), { groundingMode: 'approved', liveKnowledgeMode: 'official' });
  assert.deepEqual(wire('workspace', 'official'), { groundingMode: 'workspace', liveKnowledgeMode: 'official' });
  assert.deepEqual(wire('none', 'official'), { groundingMode: 'none', liveKnowledgeMode: 'official' });
  assert.deepEqual(wire('approved', 'off'), { groundingMode: 'approved' });
  // Both dimensions closed: the payload carries the repository mode and nothing else.
  assert.deepEqual(wire('none', 'off'), { groundingMode: 'none' });
  // And the pair the two dimensions exist to make possible: no repository evidence at
  // all, yet authoritative external evidence permitted.
  assert.equal(SOURCE_MODE_OPTIONS.some((o) => o.value === 'none'), true);
  assert.equal(LIVE_MODE_OPTIONS.some((o) => o.value === 'official'), true);
});

// ── the composer sends it per turn, independently ────────────────────────────

test('the composer reads its own selector and sends it as its own field', () => {
  const composer = source('panel/shell/script/composer.ts');
  assert.match(composer, /liveMode: \(\$\('clive'\) \? \$\('clive'\)\.value : 'off'\)/);
  assert.match(composer, /sourceMode: \(\$\('csource'\) \? \$\('csource'\)\.value : 'auto'\)/);
  // Change wiring for each, so selecting one never restyles or resends the other.
  assert.match(composer, /action: 'liveMode:' \+ clive\.value/);
  assert.match(composer, /action: 'sourceMode:' \+ csource\.value/);
});

test('the selector is actually RENDERED, not merely defined', () => {
  // A selector defined in a model but never emitted into the HTML gets tree-shaken out
  // of the bundle, which is exactly how the evidence control shipped invisible once.
  const html = source('panel/shell/shellHtml.ts');
  assert.match(html, /<select id="clive"/);
  assert.match(html, /liveModeOptions\(\)/);
  assert.match(html, /LIVE_MODE_OPTIONS\.map/);
  assert.match(html, /<label class="sr-only" for="clive">Live knowledge<\/label>/, 'and it is labelled');
});

test('the recommended composer order places live knowledge after evidence', () => {
  const html = source('panel/shell/shellHtml.ts');
  const csource = html.indexOf('id="csource"');
  const clive = html.indexOf('id="clive"');
  const croute = html.indexOf('id="croute"');
  const csend = html.indexOf('id="csend"');
  assert.ok(csource > 0 && clive > 0 && croute > 0 && csend > 0);
  assert.ok(csource < clive, 'evidence precedes live knowledge');
  assert.ok(clive < croute, 'live knowledge precedes model routing');
  assert.ok(croute < csend, 'send is last');
});

// ── styling reflects state without decorating the safe default ───────────────

test('off is neutral, official is governance, web is a distinct research treatment', () => {
  const styles = source('panel/shell/shellStyles.ts');
  // Shared with the other selects, so it can never render as a native white control.
  assert.match(styles, /#croute, #csource, #clive \{/);
  assert.match(styles, /#clive\[data-mode="official"\] \{/);
  assert.match(styles, /#clive\[data-mode="web"\] \{/);
  // No rule for off: the safe default stays undecorated.
  assert.ok(!/#clive\[data-mode="off"\]/.test(styles));

  const web = /#clive\[data-mode="web"\] \{([\s\S]*?)\}/.exec(styles)?.[1] ?? '';
  const official = /#clive\[data-mode="official"\] \{([\s\S]*?)\}/.exec(styles)?.[1] ?? '';
  assert.match(web, /mp-warn/, 'web reads as unsettled while coverage is incomplete');
  assert.ok(!/mp-warn/.test(official), 'official reads as governed, not as a warning');
  assert.notEqual(web.trim(), official.trim(), 'the two states must be distinguishable');
});

test('the composer row wraps and the selects can shrink', () => {
  const styles = source('panel/shell/shellStyles.ts');
  assert.match(styles, /#ctools \{[^}]*flex-wrap: wrap/);
  // Three selects now share the row; without shrinkage the send button is pushed off
  // screen in a narrow side panel.
  const shared = /#croute, #csource, #clive \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? '';
  assert.match(shared, /min-width: 0/);
  assert.match(shared, /flex: 0 1 auto/);
});

// ── what actually ships ──────────────────────────────────────────────────────

test('the rendered webview document carries every label, value and marker', () => {
  // Rendered, not grepped from a source file: a selector defined in a model but never
  // emitted into the document gets tree-shaken out of the bundle, which is exactly how
  // the evidence control once shipped invisible.
  const document = shellHtml({
    nonce: 'test-nonce-abcdefgh',
    csp: "default-src 'none'; script-src 'nonce-test-nonce-abcdefgh'",
    logoUri: 'https://file%2B.vscode-resource/logo.svg',
    initialTab: 'chat',
    script: shellScript(),
    compact: false,
  });

  for (const option of LIVE_MODE_OPTIONS) {
    assert.ok(document.includes(`value="${option.value}"`), `${option.value} reaches the document`);
    assert.ok(document.includes(option.label), `"${option.label}" reaches the document`);
    assert.ok(document.includes(option.hint), `the ${option.value} tooltip reaches the document`);
  }
  assert.match(document, /<select id="clive"/);
  // The webview script must handle the control and the host message.
  const script = shellScript();
  assert.match(script, /'clive'/);
  assert.match(script, /liveMode:/);
  assert.match(script, /case 'liveMode'/);
  // And the composed script must still be valid JavaScript after the addition.
  assert.doesNotThrow(() => new Function(script), 'the exact packaged shell script must compile');
});

test('the built bundle carries the labels and mode values when one exists', () => {
  // Present after `npm run package`. Absent in a bare unit run, and the rendered-document
  // assertion above already covers that case — so this checks the artifact when there is
  // one rather than pretending a missing file is a pass.
  const bundle = join(__dirname, '..', '..', '..', 'dist', 'extension.js');
  if (!existsSync(bundle)) return;
  const built = readFileSync(bundle, 'utf8');

  for (const option of LIVE_MODE_OPTIONS) {
    assert.ok(built.includes(option.label), `"${option.label}" survives bundling`);
    // esbuild normalises string quotes to double, and the option markup is generated at
    // runtime — so the value is checked as a bundled literal in either quote style.
    assert.ok(
      built.includes(`"${option.value}"`) || built.includes(`'${option.value}'`),
      `${option.value} survives bundling`,
    );
    assert.ok(built.includes(`liveMode:${option.value}`), `the ${option.value} shellAction survives bundling`);
  }
  assert.ok(built.includes('clive'), 'the selector id survives bundling');
  assert.ok(built.includes('liveKnowledgeMode'), 'the wire field survives bundling');
  assert.ok(built.includes('General web provider'), 'the coverage disclosure survives bundling');
  assert.ok(built.includes('Authoritative sources only'), 'the honest web-mode label survives bundling');
});

// ── host-owned disclosure ────────────────────────────────────────────────────

test('the frame renders host-owned provenance with counts and citations', () => {
  const lines = liveKnowledgeBadge({
    headline: 'Live knowledge: Official sources',
    checkedAt: '2026-07-27T04:00:00.000Z',
    sourcesConsulted: 3,
    sourcesAccepted: 2,
    citations: [
      {
        sourceId: 'npm:typescript',
        title: 'npm: typescript 7.0.2',
        safeUrl: 'https://registry.npmjs.org/typescript/latest',
        domain: 'registry.npmjs.org',
        trustTier: 1,
        connectorId: 'npm-registry',
        retrievedAt: '2026-07-27T04:00:00.000Z',
        contentHash: 'abc123',
      },
    ],
    unavailable: [],
  });

  assert.equal(lines[0], 'Live knowledge: Official sources');
  assert.equal(lines[1], 'Checked: 2026-07-27T04:00:00.000Z');
  assert.equal(lines[2], 'Sources accepted: 2');
  assert.match(lines[3]!, /\[npm:typescript\]/);
  assert.match(lines[3]!, /registry\.npmjs\.org\/typescript\/latest/);
  assert.match(lines[3]!, /tier 1/);
});

test('web mode without a general provider says so explicitly', () => {
  const lines = liveKnowledgeBadge({
    headline: 'Live knowledge: Authoritative sources only (no general web provider configured)',
    checkedAt: '2026-07-27T04:00:00.000Z',
    sourcesConsulted: 1,
    sourcesAccepted: 1,
    citations: [],
    unavailable: [],
  });

  assert.match(lines.join('\n'), /Authoritative sources only/);
  assert.match(lines.join('\n'), /General web provider: Not configured/);
  // The frame must never present incomplete coverage as a completed web search.
  assert.ok(!lines.some((l) => /^Live knowledge: Web research$/.test(l)));
});

test('a genuine broad-web result is labelled Web research', () => {
  const lines = liveKnowledgeBadge({
    headline: 'Live knowledge: Web research',
    sourcesConsulted: 4,
    sourcesAccepted: 3,
    citations: [],
    unavailable: [],
  });
  assert.equal(lines[0], 'Live knowledge: Web research');
  assert.ok(!lines.some((l) => /General web provider: Not configured/.test(l)), 'no contradiction');
});

test('citations come only from the frame, so an invented source cannot render', () => {
  // A citation the model wrote into its prose has no entry here. The renderer only ever
  // sees the host frame, which is derived from documents that were actually fetched.
  const lines = liveKnowledgeBadge({
    headline: 'Live knowledge: Official sources',
    sourcesConsulted: 2,
    sourcesAccepted: 0,
    citations: [],
    unavailable: [],
  });
  assert.deepEqual(lines, ['Live knowledge: Official sources', 'Sources accepted: 0']);

  // A malformed citation (no url) is dropped rather than half-rendered.
  const partial = liveKnowledgeBadge({
    headline: 'Live knowledge: Official sources',
    sourcesAccepted: 1,
    citations: [{ sourceId: 'ghost:1', title: 'Invented' }],
  });
  assert.ok(!partial.some((l) => /Invented/.test(l)));
});

test('an unavailable connector is named for the operator', () => {
  const lines = liveKnowledgeBadge({
    headline: 'Live knowledge: Official sources',
    sourcesAccepted: 1,
    citations: [],
    unavailable: [{ connectorId: 'vendor-docs', reason: 'not-configured', detail: 'no domains allowlisted' }],
  });
  assert.match(lines.join('\n'), /unavailable: vendor-docs \(not-configured\) — no domains allowlisted/);
});

test('an absent frame renders nothing at all', () => {
  assert.deepEqual(liveKnowledgeBadge(undefined), []);
  assert.deepEqual(liveKnowledgeBadge({}), []);
});

test('the two frames are rendered separately, and provenance precedes the answer', () => {
  const turn = source('chat/engineerTurn.ts');
  assert.match(turn, /ev\.event === 'liveKnowledge'/);
  assert.match(turn, /ev\.event === 'grounding'/);
  // Separate handlers and separate helpers: collapsing them would make "no repository
  // evidence" and "no external evidence" indistinguishable.
  assert.match(turn, /liveKnowledgeBadge\(/);
  assert.match(turn, /sourceModeBadge\(/);

  // The Brain emits both frames before any answer text, including before a refusal.
  const routes = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'brain-service', 'src', 'engine', 'engineerRoutes.ts'),
    'utf8',
  );
  const liveFrame = routes.indexOf("send('liveKnowledge'");
  const refusal = routes.indexOf("send('refusal'");
  const loopStart = routes.indexOf('INSUFFICIENT_APPROVED_EVIDENCE');
  assert.ok(liveFrame > 0, 'the Brain emits the live frame');
  assert.ok(liveFrame < refusal, 'provenance precedes a refusal');
  assert.ok(liveFrame < loopStart, 'and precedes the loop');
});

test('the confirmation states what each mode enforces', () => {
  assert.match(liveModeConfirmation('off'), /No external lookup of any kind/i);
  assert.match(liveModeConfirmation('off'), /nothing leaves this machine/i);
  assert.match(liveModeConfirmation('official'), /authoritative first-party/i);
  assert.match(liveModeConfirmation('official'), /rather than widening/i);
  // The web confirmation must disclose the missing provider rather than overstating.
  assert.match(liveModeConfirmation('web'), /no general web provider is configured/i);
  assert.match(liveModeConfirmation(undefined), /off/i);
});

// ── audit stays metadata-only across the wire ────────────────────────────────

test('the extension never sends the live mode as prose or infers it from the prompt', () => {
  const engine = source('chat/chatEngine.ts');
  const composer = source('panel/shell/script/composer.ts');
  // The mode comes from a control. Nothing scans the message text for it.
  assert.ok(!/task\.(match|includes|test).*(official|web research)/i.test(engine));
  assert.ok(!/text\.(match|includes|indexOf).*(official|live knowledge)/i.test(composer));
  assert.match(engine, /never parsed from the prompt/i, 'and the contract says so');
});
