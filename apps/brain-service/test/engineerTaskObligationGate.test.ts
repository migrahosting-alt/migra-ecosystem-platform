// The controller refuses a final the evidence does not support.
//
// engineerTaskObligations.test.ts proves the ledger in isolation. This proves the
// LOOP honours it: that a model trying to finish early is sent back, that a model
// which never cooperates still terminates rather than hanging, and that whatever
// the prose says, the published answer carries the controller's own account of
// what was never verified.
//
// Every scripted model here is HOSTILE in the specific way the real one was: it
// tries to finish while requirements remain unevidenced. A cooperative script
// would prove nothing, which is precisely how the repository-identity defect
// survived a green suite.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runEngineerTask,
  type EngineerEvent,
  type EngineerToolInfo,
} from '../src/engine/engineer/engineerRuntime.js';

/** Unlike the hardening harness, these declare what they can PROVE. */
const TOOLS: EngineerToolInfo[] = [
  {
    id: 'file.read',
    description: 'read a file',
    readOnly: true,
    inputHint: '{}',
    evidenceSemantics: ['workspace.file_content'],
  },
  {
    id: 'workspace.list',
    description: 'list a directory',
    readOnly: true,
    inputHint: '{}',
    evidenceSemantics: ['workspace.directory_listing'],
  },
  {
    id: 'workspace.find',
    description: 'find paths by name',
    readOnly: true,
    inputHint: '{}',
    evidenceSemantics: ['workspace.path_discovery'],
  },
];

const TASK = [
  'Inspect this repository read-only.',
  'Read package.json, inspect the src tree, read the application entrypoint,',
  'inspect one API implementation, one server-side implementation, and one test implementation.',
].join('\n');

function harness(replies: string[]) {
  const calls: Array<{ tool: string; input: unknown }> = [];
  let i = 0;
  return {
    calls,
    deps: {
      complete: async () => replies[Math.min(i++, replies.length - 1)]!,
      executeTool: async (tool: string, input: unknown) => {
        calls.push({ tool, input });
        const path =
          input && typeof input === 'object'
            ? String((input as Record<string, unknown>).path ?? '')
            : '';
        if (tool === 'file.read') {
          return { path, content: `// contents of ${path}\nexport const x = 1;\n` };
        }
        if (tool === 'workspace.list') {
          return { dir: path, entries: [{ name: 'app' }, { name: 'server' }] };
        }
        return { matches: ['src/server/database.ts', 'tests/payments.test.ts'] };
      },
      tools: TOOLS,
      noProgressLimit: 8,
      maxReplans: 1,
    },
  };
}

const read = (path: string) =>
  JSON.stringify({ action: { tool: 'file.read', input: { path } } });
const list = (path: string) =>
  JSON.stringify({ action: { tool: 'workspace.list', input: { path } } });
const find = (query: string) =>
  JSON.stringify({ action: { tool: 'workspace.find', input: { query } } });
const final = (text: string) => JSON.stringify({ final: text });

async function drain(
  gen: AsyncGenerator<EngineerEvent>,
): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const finalText = (events: EngineerEvent[]): string => {
  const f = events.find((e) => e.type === 'final');
  return f && f.type === 'final' ? f.markdown : '';
};

// ── the model cooperates ─────────────────────────────────────────────────────

test('all six requirements evidenced: the final is allowed and carries no warning', async () => {
  const { deps } = harness([
    read('package.json'),
    list('src'),
    read('src/app/page.tsx'),
    read('src/app/api/orders/route.ts'),
    read('src/server/ledger.ts'),
    read('tests/payments.test.ts'),
    final('Inspected the manifest, the src tree, the entrypoint, an API route, the ledger and the payments test.'),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));
  const markdown = finalText(events);

  assert.ok(markdown.length > 0, 'a fully evidenced run must be able to finish');
  assert.doesNotMatch(
    markdown,
    /Not verified by this run/,
    'an honest complete answer must not be decorated with a warning it does not deserve',
  );
});

// ── the model tries to finish early ──────────────────────────────────────────

test('MODEL SKIPS REQUIRED TOOLS: the first final is refused and it is sent back', async () => {
  // The premature final is deliberately DETAILED and plausible. A terse one is
  // caught by the weak-final corrector, which would send the model back for an
  // unrelated reason and let this test pass while the obligation gate did nothing.
  // Confirmed by mutation: with the gate disabled and a terse final, this still
  // passed. Only a strong-but-unevidenced final isolates the gate.
  const { deps, calls } = harness([
    read('package.json'),
    final(
      'I inspected the manifest and reviewed the repository layout. The API implementation ' +
        'lives under src/app/api, the server logic in src/server/ledger.ts, and the payment ' +
        'tests in tests/payments.test.ts. The inspection is complete.',
    ),
    // After the refusal it complies:
    list('src'),
    read('src/app/page.tsx'),
    read('src/app/api/orders/route.ts'),
    read('src/server/ledger.ts'),
    read('tests/payments.test.ts'),
    final('Inspected the manifest, src tree, entrypoint, an API route, the ledger and the payments test.'),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));

  assert.ok(
    calls.some((c) => c.input && String((c.input as Record<string, unknown>).path) === 'src/server/ledger.ts'),
    'the refusal must actually drive the missing inspection',
  );
  assert.doesNotMatch(
    finalText(events),
    /Not verified by this run/,
    'once it complied, the answer is clean',
  );
});

test('PATH DISCOVERY IS NOT INSPECTION: finding the files does not discharge the requirement', async () => {
  // The real failure. It ran workspace.find, saw src/server/database.ts and
  // tests/payments.test.ts in the matches, and described them as inspected.
  const { deps } = harness([
    read('package.json'),
    list('src'),
    read('src/app/page.tsx'),
    read('src/app/api/orders/route.ts'),
    find('*.ts'),
    final('The inspection is complete. src/server/database.ts holds the server logic and tests/payments.test.ts covers payments.'),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));
  const markdown = finalText(events);

  assert.match(markdown, /Not verified by this run/);
  assert.match(markdown, /server-side implementation/);
  assert.match(markdown, /test implementation/);
  assert.match(
    markdown,
    /unverified, whatever wording was used/,
    'the controller must contradict the claim in the same message',
  );
});

// ── the model never cooperates ───────────────────────────────────────────────

test('AN UNCOOPERATIVE MODEL STILL TERMINATES, with the shortfall stated', async () => {
  // It must not hang. A requirement the run cannot discharge becomes UNPROVABLE
  // and the answer ships with the controller's ledger attached.
  const { deps } = harness([
    read('package.json'),
    list('src'),
    read('src/app/page.tsx'),
    ...Array(12).fill(final('Everything has been verified.')),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));
  const markdown = finalText(events);
  const errored = events.some((e) => e.type === 'error');

  assert.ok(markdown.length > 0 || errored, 'the run must reach a terminal state');
  if (markdown.length > 0) {
    assert.match(markdown, /Not verified by this run/);
    assert.match(markdown, /API implementation|server-side implementation|test implementation/);
  }
});

test('AN HONEST INCOMPLETE ANSWER IS ALLOWED, and still names what went unverified', async () => {
  const { deps } = harness([
    read('package.json'),
    list('src'),
    read('src/app/page.tsx'),
    ...Array(12).fill(
      final('I read the manifest, the src tree and the entrypoint. I could not locate an API, server or test implementation in this workspace.'),
    ),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));
  const markdown = finalText(events);

  if (markdown.length > 0) {
    assert.match(markdown, /could not locate/, 'the honest account survives');
    assert.match(markdown, /Not verified by this run/, 'and is still qualified by the ledger');
  }
});

// ── the contract must not attach itself to everything ────────────────────────

test('a task that states no requirements is completely unaffected', async () => {
  const { deps } = harness([final('The login form lives in src/app/login/page.tsx.')]);

  const events = await drain(
    runEngineerTask(deps, { rootPath: '/ws', task: 'where is the login form?' }),
  );

  assert.doesNotMatch(
    finalText(events),
    /Not verified by this run/,
    'an ordinary question must not inherit an audit contract',
  );
});

// ── deduplication must survive ───────────────────────────────────────────────

test('DEDUPLICATION SURVIVES: a repeated accepted read is reused, not re-executed', async () => {
  const { deps, calls } = harness([
    read('package.json'),
    read('package.json'),
    list('src'),
    read('src/app/page.tsx'),
    read('src/app/api/orders/route.ts'),
    read('src/server/ledger.ts'),
    read('tests/payments.test.ts'),
    final('Inspected the manifest, src tree, entrypoint, an API route, the ledger and the payments test.'),
  ]);

  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: TASK }));

  assert.equal(
    calls.filter((c) => String((c.input as Record<string, unknown>).path) === 'package.json').length,
    1,
    'the identical repeat must not execute again',
  );
  assert.ok(events.some((e) => e.type === 'note' && e.kind === 'duplicate'));
  assert.doesNotMatch(
    finalText(events),
    /Not verified by this run/,
    'reused evidence still counts as evidence',
  );
});
