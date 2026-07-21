// MigraPilot must be able to build in ANY folder on the machine — an explicit
// path in the message, else the open workspace, else it ASKS for a folder. These
// cover the pure path extractor and the resolution order/fallbacks. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPathCandidates, resolveTaskRoot, type ResolveRootDeps, pathAlternatives } from '../../chat/taskRoot.js';

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

// ── cross-host paths and brand-new project folders ───────────────────────────
// Reported from real use: the owner typed `t:/MigraWatch/migrawatch` into the
// folder picker and got "Please enter a path that exists" — the dialog was
// browsing the WSL tree (/bin, /boot, /dev), where that Windows path is
// meaningless. And the folder did not exist yet, because the whole point was to
// START a new project there.

test('a Windows path resolves to its WSL mount', async () => {
  const seen: string[] = [];
  const r = await resolveTaskRoot('build a watcher app in T:\\MigraWatch\\migrawatch', {
    isDirectory: async (p) => {
      seen.push(p);
      return p === '/mnt/t/MigraWatch/migrawatch';
    },
    pickFolder: async () => undefined,
  });
  assert.equal(r?.root, '/mnt/t/MigraWatch/migrawatch');
  assert.equal(r?.source, 'explicit-path');
  assert.ok(seen.includes('T:\\MigraWatch\\migrawatch'), 'the literal spelling is tried first');
});

test('a WSL mount path resolves to its Windows spelling', () => {
  assert.deepEqual(pathAlternatives('/mnt/t/MigraWatch/app'), ['/mnt/t/MigraWatch/app', 'T:\\MigraWatch\\app']);
  assert.deepEqual(pathAlternatives('t:/MigraWatch/app'), ['t:/MigraWatch/app', '/mnt/t/MigraWatch/app']);
  assert.deepEqual(pathAlternatives('/home/me/app'), ['/home/me/app'], 'a plain POSIX path gains nothing');
});

test('a named folder that does not exist yet is CREATED on confirmation', async () => {
  const created: string[] = [];
  const r = await resolveTaskRoot('build a countdown app in /mnt/t/MigraWatch/migrawatch', {
    isDirectory: async () => false,
    confirmCreate: async () => true,
    createDirectory: async (p) => {
      created.push(p);
    },
    pickFolder: async () => {
      throw new Error('must not fall back to a picker after the user agreed to create');
    },
  });
  assert.equal(r?.root, '/mnt/t/MigraWatch/migrawatch');
  assert.equal(r?.source, 'created');
  assert.equal(r?.created, true);
  assert.deepEqual(created, ['/mnt/t/MigraWatch/migrawatch']);
});

test('declining the creation still offers the picker, and creates nothing', async () => {
  const created: string[] = [];
  const r = await resolveTaskRoot('build it in /mnt/t/Nope/here', {
    isDirectory: async () => false,
    confirmCreate: async () => false,
    createDirectory: async (p) => {
      created.push(p);
    },
    pickFolder: async () => '/mnt/t/Existing',
  });
  assert.equal(r?.root, '/mnt/t/Existing');
  assert.equal(r?.source, 'picked');
  assert.deepEqual(created, [], 'nothing is created without consent');
});
