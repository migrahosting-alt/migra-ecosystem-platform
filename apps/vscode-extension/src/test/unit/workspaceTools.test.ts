// The client half of the governed workspace tool surface.
//
// Two properties matter most here and are asserted directly:
//   1. ABSENCE IS AN ERROR, never an empty success. A missing root that lists as
//      empty is what told the agent a project had no files and invited it to
//      invent some.
//   2. A PLANNER DOES NOT GET TO WRITE. The mutating tools go through a human,
//      and a decline is reported as a result the agent can reason about.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWorkspaceToolExecutor,
  WorkspaceToolError,
  CLIENT_CONTRACT_VERSION,
  type WorkspaceToolHost,
} from '../../services/workspaceTools.js';
import { WORKSPACE_TOOL_IDS, workspaceToolMeta } from '@migrapilot/workspace-tools';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  writeFileSync(join(root, 'index.html'), '<h1>MigraPilot</h1>\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n');
  return root;
}

/** A host that records what it was asked, so authority can be asserted. */
function host(overrides: Partial<WorkspaceToolHost> = {}) {
  const calls: string[] = [];
  const applied: unknown[] = [];
  const impl: WorkspaceToolHost = {
    async diagnostics(rootPath, filePath) {
      calls.push(`diagnostics:${filePath ?? '*'}`);
      return { tool: 'diagnostics.get', items: [], count: 0 };
    },
    async documentSymbols(rootPath, filePath) {
      calls.push(`symbols:${filePath}`);
      return {
        tool: 'file.readSymbol',
        path: filePath,
        symbols: [{ name: 'app', kind: 'Function', startLine: 1, endLine: 1 }],
        count: 1,
      };
    },
    async requestApproval() {
      calls.push('approval');
      return true;
    },
    async applyChangeset(input) {
      applied.push(input);
      return { ok: true };
    },
    ...overrides,
  };
  return { impl, calls, applied, exec: createWorkspaceToolExecutor(impl) };
}

test('every declared tool is routed — no tool is silently missing an adapter', async () => {
  const root = fixture();
  const h = host();
  const unroutable: string[] = [];
  for (const id of WORKSPACE_TOOL_IDS) {
    try {
      await h.exec(id, { rootPath: root, path: 'index.html', ops: [{ op: 'create', path: 'n.txt', content: 'x' }] });
    } catch (err) {
      // A genuine input/runtime error is fine here; "no adapter" is not.
      if (/has no adapter for it yet/.test((err as Error).message)) unroutable.push(id);
    }
  }
  assert.deepEqual(unroutable, [], 'these declared tools have no client adapter');
});

test('a missing root is an ERROR for every tool, never an empty result', async () => {
  const h = host();
  for (const id of WORKSPACE_TOOL_IDS) {
    await assert.rejects(
      () => h.exec(id, { rootPath: '/no/such/root/anywhere', path: 'a.ts', ops: [{ op: 'create', path: 'a', content: '' }] }),
      /does not exist on this machine/,
      id,
    );
  }
});

test('an undeclared tool is refused BY NAME', async () => {
  const h = host();
  await assert.rejects(
    () => h.exec('command.run', { rootPath: fixture() }),
    /command\.run is not a declared workspace tool/,
  );
});

test('reads answer from the real disk', async () => {
  const root = fixture();
  const h = host();
  const list = (await h.exec('workspace.list', { rootPath: root })) as { entries: Array<{ path: string }> };
  assert.deepEqual(list.entries.map((e) => e.path).sort(), ['index.html', 'src']);
  const read = (await h.exec('file.read', { rootPath: root, path: 'index.html' })) as { text?: string; content?: string };
  assert.match(String(read.text ?? read.content ?? ''), /MigraPilot/);
});

test('editor capabilities are delegated to the host, not guessed locally', async () => {
  const root = fixture();
  const h = host();
  await h.exec('diagnostics.get', { rootPath: root });
  const sym = (await h.exec('file.readSymbol', { rootPath: root, path: 'src/app.ts' })) as {
    symbolName: string;
    kind: string;
    range: { startLine: number; endLine: number };
    content: string;
  };
  assert.deepEqual(h.calls, ['diagnostics:*', 'symbols:src/app.ts']);
  // The contract is ONE enclosing symbol with its source, not a raw listing.
  assert.equal(sym.symbolName, 'app');
  assert.equal(sym.kind, 'function');
  assert.equal(sym.range.startLine, 1);
  assert.equal(typeof sym.content, 'string');
});

test('a proposal classifies create vs overwrite and writes NOTHING', async () => {
  const root = fixture();
  const h = host();
  const res = (await h.exec('fs.proposeChangeset', {
    rootPath: root,
    ops: [
      { op: 'create', path: 'src/new.ts', content: 'export const y = 2;' },
      { op: 'create', path: 'index.html', content: 'replaced' },
    ],
  })) as { ops: Array<{ path: string; effect: string }>; applied: boolean };
  const byPath = Object.fromEntries(res.ops.map((o) => [o.path, o.effect]));
  assert.equal(byPath['src/new.ts'], 'create');
  assert.equal(byPath['index.html'], 'overwrite');
  assert.equal(res.applied, false);
  assert.equal(existsSync(join(root, 'src', 'new.ts')), false, 'proposing must not write');
  assert.deepEqual(h.applied, [], 'proposing must not reach the apply path');
});

test('a mutating tool ASKS the operator before it writes', async () => {
  const root = fixture();
  const h = host();
  const res = (await h.exec('fs.applyChangeset', {
    rootPath: root,
    ops: [{ op: 'create', path: 'written.txt', content: 'x' }],
  })) as { applied: boolean; approved: boolean };
  assert.equal(h.calls.includes('approval'), true, 'the human must be asked');
  assert.equal(res.applied, true);
  assert.equal(h.applied.length, 1);
});

test('a declined change is a RESULT, not an exception — the agent must reason about it', async () => {
  const root = fixture();
  const h = host({ async requestApproval() { return false; } });
  const res = (await h.exec('edit.apply', {
    rootPath: root,
    ops: [{ op: 'create', path: 'nope.txt', content: 'x' }],
  })) as { applied: boolean; approved: boolean; reason: string };
  assert.equal(res.applied, false);
  assert.equal(res.approved, false);
  assert.match(res.reason, /did not approve/);
  assert.deepEqual(h.applied, [], 'a decline must never reach the working tree');
});

test('both mutating tools are gated; read-only tools are not', async () => {
  const root = fixture();
  for (const id of WORKSPACE_TOOL_IDS) {
    const meta = workspaceToolMeta(id)!;
    if (!meta.mutating) continue;
    const h = host({ async requestApproval() { return false; } });
    const res = (await h.exec(id, { rootPath: root, ops: [{ op: 'create', path: 'x.txt', content: 'x' }] })) as {
      applied: boolean;
    };
    assert.equal(res.applied, false, `${id} wrote without approval`);
  }
});

test('path traversal is refused inside a changeset', async () => {
  const root = fixture();
  const h = host();
  await assert.rejects(
    () => h.exec('fs.proposeChangeset', { rootPath: root, ops: [{ op: 'create', path: '../escape.txt', content: 'x' }] }),
    /escapes the workspace root/,
  );
});

test('an empty ops list is refused rather than proposing nothing', async () => {
  const h = host();
  await assert.rejects(() => h.exec('fs.proposeChangeset', { rootPath: fixture(), ops: [] }), /at least one operation/);
});

test('the client declares a contract version', () => {
  assert.match(CLIENT_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
});

test('WorkspaceToolError is what callers can catch', async () => {
  const h = host();
  await assert.rejects(() => h.exec('file.read', { rootPath: '/nope/nope' }), WorkspaceToolError);
});
