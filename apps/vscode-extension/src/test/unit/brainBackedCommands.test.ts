import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ChatTurnRequest, ChatTurnResponse, RouteRequest, RouteResponse } from '@migrapilot/shared-types';

/*
 * Generate Commit Message and Generate Tests used to compose their own system
 * prompt and call an OpenAI-compatible endpoint straight from the extension.
 * These tests pin the replacement: both reach the Brain, with the canonical
 * feature, carrying the context the Brain needs — and when the Brain cannot
 * answer they fail, rather than quietly answering some other way.
 *
 * The command modules import `vscode` at load time, so the host module is
 * stubbed before they are required (same approach as
 * nonBlockingNotifications.test.ts). Neither function under test touches a
 * vscode API — only the interactive `…Command` wrappers do — so the stub is
 * deliberately minimal.
 */

const requireCjs = createRequire(__filename);

class StubDisposable {
  dispose(): void {}
}

const vscodeStub: Record<string, unknown> = {
  window: {
    activeTextEditor: undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showTextDocument: async () => ({}),
    withProgress: (_o: unknown, task: (p: unknown, t: unknown) => unknown) =>
      task({ report(): void {} }, { isCancellationRequested: false, onCancellationRequested: () => new StubDisposable() }),
  },
  workspace: {
    workspaceFolders: undefined,
    textDocuments: [],
    getConfiguration: () => ({ get: (): undefined => undefined }),
    asRelativePath: (t: { fsPath?: string }) => String(t?.fsPath ?? t),
    openTextDocument: async () => ({}),
  },
  commands: { registerCommand: () => new StubDisposable() },
  env: { clipboard: { writeText: async (): Promise<void> => {} } },
  Disposable: StubDisposable,
};

const ModuleCtor = requireCjs('node:module') as {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = ModuleCtor._load.bind(ModuleCtor);
ModuleCtor._load = (request: string, parent: unknown, isMain: boolean): unknown =>
  request === 'vscode' ? vscodeStub : originalLoad(request, parent, isMain);

const commitMod = requireCjs('../../commands/generateCommitMessage.js') as {
  runGenerateCommitMessage(deps: unknown, root: string, opts: unknown, signal?: AbortSignal): Promise<
    { status: string; subject?: string; modelProfile?: string; reason?: string }
  >;
};
const testsMod = requireCjs('../../commands/generateTests.js') as {
  runGenerateTests(
    deps: unknown,
    targetRelPath: string,
    root: string,
    confirm: (ctx: unknown) => Promise<boolean>,
    opts?: unknown,
  ): Promise<{ status: string; reason?: string }>;
};

interface Recorded {
  routes: RouteRequest[];
  chats: ChatTurnRequest[];
}

function fakeBrain(rec: Recorded, reply: string | Error): unknown {
  return {
    route: async (payload: RouteRequest): Promise<RouteResponse> => {
      rec.routes.push(payload);
      return {
        taskType: 'cheap_llm',
        modelProfile: 'cheap',
        retrievalMode: 'light',
        toolPlan: [],
        maxInputTokens: 1200,
        maxOutputTokens: 200,
        allowEscalation: false,
        reason: 'test',
      };
    },
    chat: async (payload: ChatTurnRequest): Promise<ChatTurnResponse> => {
      rec.chats.push(payload);
      if (reply instanceof Error) throw reply;
      return {
        modelProfile: 'cheap',
        content: reply,
        telemetry: { inputTokens: 1, outputTokens: 1, latencyMs: 1, cacheHit: false },
      };
    },
  };
}

/** Deps shaped like CommandDeps; only brainClient and router are exercised. */
function deps(brain: unknown): unknown {
  return {
    brainClient: brain,
    router: { current: () => ({ kind: 'local' }), resolve: async () => ({ kind: 'local' }) },
    pilot: undefined,
    migraAi: undefined,
  };
}

/** A real workspace on disk — runGenerateTests reads the target file for itself. */
function tempWorkspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'mp-brain-cmd-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { vitest: '1.0.0' } }));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ── Generate Commit Message ──────────────────────────────────────────────────

test('commit message: no staged changes → no Brain request at all', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const ws = tempWorkspace(); // not a git repo → nothing staged
  try {
    const res = await commitMod.runGenerateCommitMessage(deps(fakeBrain(rec, 'unused')), ws.root, {});
    assert.equal(res.status, 'no-staged-changes');
    assert.equal(rec.chats.length, 0, 'nothing sent when there is nothing to describe');
  } finally {
    ws.cleanup();
  }
});

test('commit message: reaches the Brain with feature "commit" and the diff as context', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const ws = tempWorkspace();
  const git = (...args: string[]): void => {
    const r = requireCjs('node:child_process').spawnSync('git', args, { cwd: ws.root, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('add', 'src/a.ts'); // a real staged change for the command to describe

    const res = await commitMod.runGenerateCommitMessage(
      deps(fakeBrain(rec, 'Add module a\n\nIntroduce the a constant.')),
      ws.root,
      {},
    );

    assert.equal(rec.routes.length, 1, 'routed through the Brain');
    assert.equal(rec.routes[0]?.feature, 'commit');
    assert.equal(rec.chats.length, 1, 'exactly one Brain chat turn');

    const turn = rec.chats[0]!;
    assert.equal(turn.feature, 'commit', 'canonical Brain feature');
    assert.equal(turn.systemPromptId, 'commit-message-v1', 'persona is named, not composed here');
    assert.ok(turn.context.gitDiff, 'the diff travels as Brain context');
    assert.match(String(turn.context.gitDiff), /a\.ts/, 'the staged file is in the diff');
    assert.ok(!/You write a git commit message/i.test(turn.userPrompt), 'no extension-owned persona');

    assert.equal(res.status, 'generated');
    assert.equal(res.subject, 'Add module a', 'the Brain result is what is used');
    assert.equal(res.modelProfile, 'cheap', 'reports the profile the Brain chose');
  } finally {
    ws.cleanup();
  }
});

test('commit message: a Brain failure is reported, never answered another way', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const ws = tempWorkspace();
  const git = (...args: string[]): void => {
    requireCjs('node:child_process').spawnSync('git', args, { cwd: ws.root, encoding: 'utf8' });
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('add', 'src/a.ts');

    const res = await commitMod.runGenerateCommitMessage(
      deps(fakeBrain(rec, new Error('brain unreachable'))),
      ws.root,
      {},
    );
    assert.equal(res.status, 'error', 'fails closed');
    assert.match(String(res.reason), /brain unreachable/i);
  } finally {
    ws.cleanup();
  }
});

// ── Generate Tests ───────────────────────────────────────────────────────────

test('generate tests: reaches the Brain with feature "test" and the source as context', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const proposal = JSON.stringify({
    files: [{ path: 'src/a.test.ts', contents: 'test("a", () => {});', mode: 'create' }],
  });
  const ws = tempWorkspace();
  try {
    // confirm=false → stops before any write; the Brain exchange still happened.
    const res = await testsMod.runGenerateTests(
      deps(fakeBrain(rec, proposal)),
      'src/a.ts',
      ws.root,
      async () => false,
    );

    assert.equal(rec.routes.length, 1, 'routed through the Brain');
    assert.equal(rec.routes[0]?.feature, 'test');
    assert.equal(rec.chats.length, 1, 'exactly one Brain chat turn');

    const turn = rec.chats[0]!;
    assert.equal(turn.feature, 'test', 'canonical Brain feature');
    assert.equal(turn.systemPromptId, 'generate-tests-v1', 'persona is named, not composed here');
    assert.equal(turn.context.activeFile, 'src/a.ts', 'target file identified to the Brain');
    assert.match(String(turn.context.selectionText), /export const a = 1;/, 'source travels as context');
    assert.ok(!/Respond ONLY with a JSON object/i.test(turn.userPrompt), 'no extension-owned persona');

    assert.equal(res.status, 'no-write', 'stopped at confirm, as asked');
  } finally {
    ws.cleanup();
  }
});

test('generate tests: a Brain failure is reported, never answered another way', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const ws = tempWorkspace();
  try {
    const res = await testsMod.runGenerateTests(
      deps(fakeBrain(rec, new Error('brain unreachable'))),
      'src/a.ts',
      ws.root,
      async () => true,
    );
    assert.equal(res.status, 'error', 'fails closed');
    assert.match(String(res.reason), /brain unreachable/i);
  } finally {
    ws.cleanup();
  }
});

test('generate tests: malformed Brain output is refused, not regenerated locally', async () => {
  const rec: Recorded = { routes: [], chats: [] };
  const ws = tempWorkspace();
  try {
    const res = await testsMod.runGenerateTests(
      deps(fakeBrain(rec, 'sorry, I cannot do that')),
      'src/a.ts',
      ws.root,
      async () => true,
    );
    assert.equal(res.status, 'error');
    assert.match(String(res.reason), /malformed test proposal/i);
  } finally {
    ws.cleanup();
  }
});
