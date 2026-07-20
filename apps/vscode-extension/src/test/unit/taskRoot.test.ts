// MigraPilot must be able to build in ANY folder on the machine — an explicit
// path in the message, else the open workspace, else it ASKS for a folder. These
// cover the pure path extractor and the resolution order/fallbacks. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPathCandidates, resolveTaskRoot, type ResolveRootDeps } from '../../chat/taskRoot.js';

test('extractPathCandidates finds Windows, POSIX, UNC, home, and quoted paths', () => {
  assert.deepEqual(extractPathCandidates('build an app in C:\\Users\\me\\proj now'), ['C:\\Users\\me\\proj']);
  assert.deepEqual(extractPathCandidates('scaffold it under /home/me/apps/todo'), ['/home/me/apps/todo']);
  assert.ok(extractPathCandidates('put it in ~/projects/site').includes('~/projects/site'));
  assert.ok(extractPathCandidates('build in "P:\\AI Studio\\Petit-Frere-Trio"').includes('P:\\AI Studio\\Petit-Frere-Trio'));
  assert.ok(extractPathCandidates('use \\\\nas\\share\\media').some((c) => c.startsWith('\\\\nas')));
});

test('a bare slash-command or single segment is NOT treated as a path', () => {
  assert.deepEqual(extractPathCandidates('run /deep on this'), []);
  assert.deepEqual(extractPathCandidates('just build the app'), []);
  // trailing prose punctuation is trimmed off the path
  assert.ok(extractPathCandidates('build it in /home/me/app, please').includes('/home/me/app'));
});

function deps(over: Partial<ResolveRootDeps>): ResolveRootDeps {
  return {
    isDirectory: async () => false,
    pickFolder: async () => undefined,
    ...over,
  };
}

test('an explicit EXISTING path in the message wins over the open workspace', async () => {
  const r = await resolveTaskRoot('build a game in /home/me/game', deps({
    openWorkspace: '/open/ws',
    isDirectory: async (p) => p === '/home/me/game',
  }));
  assert.deepEqual(r, { root: '/home/me/game', source: 'explicit-path' });
});

test('no path + open workspace → uses the workspace (no picker)', async () => {
  let picked = false;
  const r = await resolveTaskRoot('build me a todo app', deps({
    openWorkspace: '/open/ws',
    pickFolder: async () => { picked = true; return '/x'; },
  }));
  assert.deepEqual(r, { root: '/open/ws', source: 'workspace' });
  assert.equal(picked, false, 'must not prompt when a workspace is open');
});

test('no path + no workspace → ASKS for a folder', async () => {
  const r = await resolveTaskRoot('build me a todo app', deps({
    openWorkspace: undefined,
    pickFolder: async () => '/picked/here',
  }));
  assert.deepEqual(r, { root: '/picked/here', source: 'picked' });
});

test('a NAMED-but-missing path asks (near it) rather than silently using the workspace', async () => {
  let nearArg: string | undefined;
  const r = await resolveTaskRoot('build in /does/not/exist', deps({
    openWorkspace: '/open/ws',
    isDirectory: async () => false,
    pickFolder: async (near) => { nearArg = near; return '/chosen'; },
  }));
  assert.deepEqual(r, { root: '/chosen', source: 'picked', missingNamed: '/does/not/exist' });
  assert.equal(nearArg, '/does/not/exist', 'picker opens near the named path');
});

test('cancelling the picker resolves to undefined (caller aborts the turn)', async () => {
  const r = await resolveTaskRoot('build me a todo app', deps({ openWorkspace: undefined, pickFolder: async () => undefined }));
  assert.equal(r, undefined);
});
