// A claim of absence needs evidence capable of establishing absence.
//
// The run this exists for answered "I couldn't find any implementation files…"
// after workspace.list, git.overview, one file.read and a workspace.find. It
// never searched any file's contents, so it had nothing that could support the
// sentence — finding no matching FILENAME does not show the behaviour is missing.
//
// The discrimination that keeps this safe is semantic absence versus file
// absence. "There is no package-lock.json" is about a named path and a listing
// settles it. "There are no payment handlers" is about what the code does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimsSemanticAbsence,
  absenceClaimUnsupported,
  deriveTaskObligations,
  observeTaskObligations,
} from '../src/engine/engineer/engineerTaskObligations.js';
import {
  runEngineerTask,
  type EngineerEvent,
  type EngineerToolInfo,
} from '../src/engine/engineer/engineerRuntime.js';

// ── the detector ─────────────────────────────────────────────────────────────

test('every absence form from the live regression set is recognised', () => {
  for (const claim of [
    "I couldn't find any implementation files in this repository.",
    'No implementation exists for the payment flow.',
    'There are no payment handlers anywhere in the project.',
    'I found no matching code for that behaviour.',
    'Nothing in the source implements the refund path.',
    // Variants the narrow original matcher also missed.
    'I was unable to locate any handler for this event.',
    'The repository does not contain any service for notifications.',
    'No endpoints were found for the admin area.',
    "I can't find any logic that performs the conversion.",
  ]) {
    assert.equal(claimsSemanticAbsence(claim), true, `missed: ${claim}`);
  }
});

test('NEGATIVE CONTROL: ordinary sentences using "find" do not trigger the gate', () => {
  // If these matched, every helpful answer would be forced to run a search.
  for (const benign of [
    'You can find the login form in src/app/login/page.tsx.',
    'I found the implementation in src/server/ledger.ts.',
    'The search found three matching components.',
    'Run npm test to find failing cases.',
    'I could not find a package-lock.json at the repository root.',
    'There is no package.json in the tests directory.',
    'This implementation handles both cash-in and cash-out.',
    'I did not modify any files.',
  ]) {
    assert.equal(claimsSemanticAbsence(benign), false, `false positive: ${benign}`);
  }
});

// ── the evidence rule ────────────────────────────────────────────────────────

const observe = (
  state: ReturnType<typeof deriveTaskObligations>,
  toolId: string,
  semantics: readonly string[],
  input: unknown,
  result: unknown,
) => observeTaskObligations(state, toolId, semantics as never, input, result);

test('PATH DISCOVERY CANNOT SUPPORT ABSENCE — the live failure, in one assertion', () => {
  const state = deriveTaskObligations('inspect this repository');

  observe(state, 'workspace.list', ['workspace.directory_listing'], { path: 'src' }, { dir: 'src', entries: [] });
  observe(state, 'workspace.find', ['workspace.path_discovery'], { query: '*.ts' }, { matches: [] });
  observe(state, 'file.read', ['workspace.file_content'], { path: 'package.json' }, { path: 'package.json', content: '{}' });

  assert.equal(
    absenceClaimUnsupported(state, "I couldn't find any implementation files."),
    true,
    'find + list + read still cannot establish that a capability is absent',
  );
});

test('CONTENT SEARCH SUPPORTS IT — the positive control', () => {
  const state = deriveTaskObligations('inspect this repository');

  observe(state, 'workspace.search', ['workspace.content_search'], { query: 'handler' }, { matches: [] });

  assert.equal(
    absenceClaimUnsupported(state, "I couldn't find any implementation files."),
    false,
    'a run that actually searched content may report what it did not find',
  );
});

test('an answer that claims nothing about absence is never gated', () => {
  const state = deriveTaskObligations('inspect this repository');
  assert.equal(
    absenceClaimUnsupported(state, 'The ledger is implemented in src/server/ledger.ts.'),
    false,
  );
});

test('a FAILED search does not count as having searched', () => {
  const state = deriveTaskObligations('inspect this repository');
  observe(state, 'workspace.search', ['workspace.content_search'], { query: 'x' }, { ok: false, error: 'EACCES' });

  assert.equal(
    absenceClaimUnsupported(state, 'There are no payment handlers.'),
    true,
    'a dispatch that failed proves nothing',
  );
});

// ── the loop honours it ──────────────────────────────────────────────────────

const TOOLS: EngineerToolInfo[] = [
  { id: 'file.read', description: 'read', readOnly: true, inputHint: '{}', evidenceSemantics: ['workspace.file_content'] },
  { id: 'workspace.list', description: 'list', readOnly: true, inputHint: '{}', evidenceSemantics: ['workspace.directory_listing'] },
  { id: 'workspace.find', description: 'find', readOnly: true, inputHint: '{}', evidenceSemantics: ['workspace.path_discovery'] },
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}', evidenceSemantics: ['workspace.content_search'] },
];

function harness(replies: string[]) {
  const calls: Array<{ tool: string; input: unknown }> = [];
  let i = 0;
  return {
    calls,
    deps: {
      complete: async () => replies[Math.min(i++, replies.length - 1)]!,
      executeTool: async (tool: string, input: unknown) => {
        calls.push({ tool, input });
        const path = input && typeof input === 'object' ? String((input as Record<string, unknown>).path ?? '') : '';
        if (tool === 'file.read') return { path, content: `// ${path}\n` };
        if (tool === 'workspace.list') return { dir: path, entries: [{ name: 'app' }] };
        if (tool === 'workspace.search') return { matches: [] };
        return { matches: [] };
      },
      tools: TOOLS,
      noProgressLimit: 8,
      maxReplans: 1,
    },
  };
}

async function drain(gen: AsyncGenerator<EngineerEvent>): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const finalText = (events: EngineerEvent[]): string => {
  const f = events.find((e) => e.type === 'final');
  return f && f.type === 'final' ? f.markdown : '';
};

const ABSENCE_FINAL =
  'I reviewed the repository layout and the manifest carefully. ' +
  "I couldn't find any implementation files for the payment flow in this project.";

test('THE LOOP REFUSES an unsupported absence claim and drives a content search', async () => {
  const { deps, calls } = harness([
    JSON.stringify({ action: { tool: 'workspace.find', input: { query: '*.ts' } } }),
    JSON.stringify({ final: ABSENCE_FINAL }),
    // After the refusal it does the thing that could actually support the claim:
    JSON.stringify({ action: { tool: 'workspace.search', input: { query: 'payment' } } }),
    JSON.stringify({ final: ABSENCE_FINAL }),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 'inspect this repository' }));

  assert.ok(
    calls.some((c) => c.tool === 'workspace.search'),
    'the refusal must drive a content search',
  );
  assert.doesNotMatch(
    finalText(events),
    /Repository-wide implementation absence was not established/,
    'once searched, the claim stands unqualified',
  );
});

test('AN UNSUPPORTED CLAIM THAT SURVIVES THE BUDGET IS PUBLISHED QUALIFIED, never bare', async () => {
  const { deps } = harness([
    JSON.stringify({ action: { tool: 'workspace.find', input: { query: '*.ts' } } }),
    ...Array(10).fill(JSON.stringify({ final: ABSENCE_FINAL })),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 'inspect this repository' }));
  const markdown = finalText(events);

  if (markdown.length > 0) {
    assert.match(markdown, /Repository-wide implementation absence was not established/);
    assert.match(markdown, /does not show that the behaviour is missing/);
  }
});

test('a run that searched content is NOT qualified', async () => {
  const { deps } = harness([
    JSON.stringify({ action: { tool: 'workspace.search', input: { query: 'payment' } } }),
    JSON.stringify({ final: ABSENCE_FINAL }),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 'inspect this repository' }));

  assert.doesNotMatch(
    finalText(events),
    /Repository-wide implementation absence was not established/,
  );
});
