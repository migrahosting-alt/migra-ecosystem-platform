import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

/**
 * Behavioural regression tests for the awaited-notification hang.
 *
 * The static checker (`scripts/check-notification-awaits.mjs`) proves no `await` on a
 * discarded message result SURVIVES in the tree. It cannot prove the commands still behave
 * correctly, which is what these tests are for.
 *
 * The reproduction condition is the whole point: every message API here returns a promise
 * that NEVER SETTLES — a toast the operator never clicks away. That is not a pathological
 * case, it is the ordinary one. Notifications auto-hide visually but their promise stays
 * pending until dismissed, so a command that awaits a result it ignores never returns. On the
 * real `Diagnose Failure` this surfaced only as a 60-second timeout in a packaged VSIX, which
 * is a long way from the actual cause.
 *
 * Under these stubs the OLD code hangs and the NEW code completes. `harness detects the
 * defect` below pins that down, so a future change that makes the stub resolve early would
 * turn these tests vacuous loudly instead of silently.
 */

const requireCjs = createRequire(__filename);

interface ShownMessage {
  api: string;
  message: string;
}

const shown: ShownMessage[] = [];

/** Mutable host state. One stub instance is shared, because the modules under test capture
 *  `vscode` at import time and re-requiring would not rebind it. */
const state: {
  activeTextEditor: unknown;
  workspaceFolders: unknown;
  diagnostics: unknown[];
} = { activeTextEditor: undefined, workspaceFolders: undefined, diagnostics: [] };

/** The defect condition: records the call, then never settles. */
function never(api: string): (message: string, ...rest: unknown[]) => Promise<never> {
  return (message: string) => {
    shown.push({ api, message });
    return new Promise<never>(() => {});
  };
}

class StubDisposable {
  dispose(): void {}
}
class StubEventEmitter {
  event = (): StubDisposable => new StubDisposable();
  fire(): void {}
  dispose(): void {}
}

const vscodeStub: Record<string, unknown> = {
  window: {
    get activeTextEditor(): unknown {
      return state.activeTextEditor;
    },
    showInformationMessage: never('showInformationMessage'),
    showWarningMessage: never('showWarningMessage'),
    showErrorMessage: never('showErrorMessage'),
    showQuickPick: () => new Promise(() => {}),
    showInputBox: () => new Promise(() => {}),
    showTextDocument: async () => ({}),
    createOutputChannel: () => ({
      appendLine(): void {},
      append(): void {},
      show(): void {},
      clear(): void {},
      dispose(): void {},
    }),
    createStatusBarItem: () => ({ show(): void {}, hide(): void {}, dispose(): void {}, text: '' }),
    createWebviewPanel: () => ({ webview: { html: '', onDidReceiveMessage: () => new StubDisposable() }, dispose(): void {} }),
    registerWebviewViewProvider: () => new StubDisposable(),
    withProgress: (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
      task({ report(): void {} }, { isCancellationRequested: false, onCancellationRequested: () => new StubDisposable() }),
    onDidChangeActiveTextEditor: () => new StubDisposable(),
    tabGroups: { all: [], close: async () => true, onDidChangeTabs: () => new StubDisposable() },
    activeTerminal: undefined,
    terminals: [],
    createTerminal: () => ({ sendText(): void {}, show(): void {}, dispose(): void {} }),
  },
  workspace: {
    get workspaceFolders(): unknown {
      return state.workspaceFolders;
    },
    textDocuments: [],
    getConfiguration: () => ({
      get: (): undefined => undefined,
      update: async (): Promise<void> => {},
      has: (): boolean => false,
      inspect: (): undefined => undefined,
    }),
    asRelativePath: (target: { fsPath?: string }) => String(target?.fsPath ?? target),
    openTextDocument: async () => ({ uri: { toString: () => 'untitled:stub' }, getText: () => '' }),
    applyEdit: async () => true,
    onDidChangeConfiguration: () => new StubDisposable(),
    onDidSaveTextDocument: () => new StubDisposable(),
    createFileSystemWatcher: () => ({ onDidChange: () => new StubDisposable(), dispose(): void {} }),
    fs: { readFile: async () => new Uint8Array(), writeFile: async (): Promise<void> => {} },
  },
  languages: {
    getDiagnostics: () => state.diagnostics,
    registerCodeActionsProvider: () => new StubDisposable(),
    createDiagnosticCollection: () => ({ set(): void {}, clear(): void {}, dispose(): void {} }),
  },
  commands: {
    registerCommand: () => new StubDisposable(),
    executeCommand: async (): Promise<undefined> => undefined,
    getCommands: async (): Promise<string[]> => [],
  },
  env: {
    clipboard: { writeText: async (): Promise<void> => {}, readText: async (): Promise<string> => '' },
    openExternal: async (): Promise<boolean> => true,
    machineId: 'stub',
  },
  extensions: { getExtension: (): undefined => undefined, all: [] },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
    parse: (s: string) => ({ fsPath: s, path: s, scheme: 'stub', toString: () => s }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
      toString: () => [base.fsPath, ...parts].join('/'),
    }),
  },
  Disposable: StubDisposable,
  EventEmitter: StubEventEmitter,
  Position: class {
    constructor(
      public line: number,
      public character: number,
    ) {}
  },
  Range: class {
    constructor(
      public start: unknown,
      public end: unknown,
      public c?: unknown,
      public d?: unknown,
    ) {}
  },
  Selection: class {},
  Location: class {},
  WorkspaceEdit: class {
    replace(): void {}
    insert(): void {}
  },
  MarkdownString: class {
    constructor(public value: string = '') {}
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false, onCancellationRequested: () => new StubDisposable() };
    cancel(): void {}
    dispose(): void {}
  },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  TextEditorRevealType: { Default: 0, InCenter: 1 },
  CodeActionKind: { QuickFix: { value: 'quickfix' } },
  UIKind: { Desktop: 1, Web: 2 },
};

// Intercept `require('vscode')` before the modules under test are loaded. The extension host
// injects this module at runtime; outside it, nothing provides it.
const ModuleCtor = requireCjs('node:module') as {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = ModuleCtor._load.bind(ModuleCtor);
ModuleCtor._load = (request: string, parent: unknown, isMain: boolean): unknown =>
  request === 'vscode' ? vscodeStub : originalLoad(request, parent, isMain);

const fixDiagnostics = requireCjs('../../commands/fixDiagnostics.js') as {
  runFixDiagnostics(deps: unknown): Promise<void>;
};
const generateTests = requireCjs('../../commands/generateTests.js') as {
  runGenerateTestsCommand(deps: unknown): Promise<void>;
};
const reviewApprovals = requireCjs('../../commands/reviewApprovals.js') as {
  runReviewApprovals(deps: unknown): Promise<void>;
};
const commitMessage = requireCjs('../../commands/generateCommitMessage.js') as {
  runGenerateCommitMessageCommand(deps: unknown): Promise<void>;
};

/** Generous relative to a guard clause, tiny relative to a human dismissing a toast. */
const DEADLINE_MS = 250;

async function settlesWithin(work: () => Promise<unknown>): Promise<boolean> {
  let settled = false;
  const run = work().then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([run, new Promise((resolve) => setTimeout(resolve, DEADLINE_MS))]);
  return settled;
}

function reset(): void {
  shown.length = 0;
  state.activeTextEditor = undefined;
  state.workspaceFolders = undefined;
  state.diagnostics = [];
}

const editorStub = { document: { uri: { toString: () => 'file:///w/a.ts', fsPath: '/w/a.ts' }, getText: () => '' } };
const folderStub = [{ uri: { fsPath: '/w', toString: () => 'file:///w' }, name: 'w', index: 0 }];

test('harness detects the defect — awaiting a discarded notification does NOT settle', async () => {
  // Non-vacuity guard. If the stub ever starts resolving, every test below would pass
  // regardless of the production code, and this one fails first to say so.
  reset();
  const settled = await settlesWithin(async () => {
    await (vscodeStub.window as { showWarningMessage(m: string): Promise<unknown> }).showWarningMessage('x');
  });
  assert.equal(settled, false, 'the stub must model an undismissed toast, or these tests prove nothing');
});

test('fixDiagnostics: no active editor returns without waiting on the toast', async () => {
  reset();
  const settled = await settlesWithin(() => fixDiagnostics.runFixDiagnostics({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['No active file to diagnose.']);
});

test('fixDiagnostics: no diagnostics returns without waiting on the toast', async () => {
  reset();
  state.activeTextEditor = editorStub;
  state.workspaceFolders = folderStub;
  state.diagnostics = [];
  const settled = await settlesWithin(() => fixDiagnostics.runFixDiagnostics({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['No diagnostics found in the active file.']);
});

test('fixDiagnostics: no workspace folder returns without waiting on the toast', async () => {
  reset();
  state.activeTextEditor = editorStub;
  state.diagnostics = [{ message: 'boom' }];
  state.workspaceFolders = undefined;
  const settled = await settlesWithin(() => fixDiagnostics.runFixDiagnostics({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['Open a workspace folder to fix diagnostics with repo context.']);
});

test('generateTests: no active editor returns without waiting on the toast', async () => {
  reset();
  const settled = await settlesWithin(() => generateTests.runGenerateTestsCommand({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['Open a file to generate tests for.']);
});

test('generateTests: no workspace folder returns without waiting on the toast', async () => {
  reset();
  state.activeTextEditor = editorStub;
  state.workspaceFolders = undefined;
  const settled = await settlesWithin(() => generateTests.runGenerateTestsCommand({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['Open a workspace folder to generate tests.']);
});

test('reviewApprovals: local backend returns without waiting on the toast', async () => {
  reset();
  const deps = { router: { current: () => ({ kind: 'local' }) } };
  const settled = await settlesWithin(() => reviewApprovals.runReviewApprovals(deps));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['Approvals require pilot-api (remote) mode.']);
});

test('generateCommitMessage: no workspace folder returns without waiting on the toast', async () => {
  reset();
  state.workspaceFolders = undefined;
  const settled = await settlesWithin(() => commitMessage.runGenerateCommitMessageCommand({}));
  assert.equal(settled, true, 'command hung on an ignored notification result');
  assert.deepEqual(shown.map((s) => s.message), ['Open a workspace folder to generate a commit message.']);
});

test('the operator is still told — silencing the toast is not the fix', async () => {
  // The failure mode this must not become: making commands return promptly by removing the
  // notification. Every guard above asserts its exact message, and this pins the count.
  reset();
  await settlesWithin(() => fixDiagnostics.runFixDiagnostics({}));
  assert.equal(shown.length, 1, 'the guard must still notify exactly once');
  assert.equal(shown[0]?.api, 'showWarningMessage');
});
