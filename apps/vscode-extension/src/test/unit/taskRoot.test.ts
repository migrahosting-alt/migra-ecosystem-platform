// MigraPilot must be able to build in ANY folder on the machine — an explicit
// path in the message, else the open workspace, else it ASKS for a folder. These
// cover the pure path extractor and the resolution order/fallbacks. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPathCandidates, resolveTaskRoot, type ResolveRootDeps, pathAlternatives } from '../../chat/taskRoot.js';

test('extractPathCandidates finds Windows, POSIX, UNC, home, and quoted paths', () => {
  // Windows paths may contain spaces, so the greedy match can swallow trailing
  // prose ("… proj now"). That is deliberate: the longest form is offered first
  // and shorter prefixes after it, and the caller's existence check decides.
  const win = extractPathCandidates('build an app in C:\\Users\\me\\proj now');
  assert.ok(win.includes('C:\\Users\\me\\proj'), `real path missing: ${JSON.stringify(win)}`);
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
    isDirectory: async (p) => p === '/picked/here', // a picked folder must be real
    pickFolder: async () => '/picked/here',
  }));
  assert.deepEqual(r, { root: '/picked/here', source: 'picked' });
});

test('a NAMED-but-missing path asks (near it) rather than silently using the workspace', async () => {
  let nearArg: string | undefined;
  const r = await resolveTaskRoot('build in /does/not/exist', deps({
    openWorkspace: '/open/ws',
    isDirectory: async (p) => p === '/chosen', // the named path is missing; the pick is real
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
    isDirectory: async (p) => p === '/mnt/t/Existing',
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

test('a Windows path containing spaces is not truncated at the first space', () => {
  // Reported: `T:\MigraAccess Command` is a real folder, but the run said
  // "`T:\MigraAccess` was not found" — the extractor stopped at the space.
  const c = extractPathCandidates('build it in T:\\MigraAccess Command please');
  assert.ok(c.includes('T:\\MigraAccess Command'), `full path missing: ${JSON.stringify(c)}`);
  assert.ok(c.indexOf('T:\\MigraAccess Command') < c.indexOf('T:\\MigraAccess'), 'longest form is tried first');
  assert.ok(c.includes('T:\\MigraAccess'), 'shorter prefixes remain as fallbacks');
});

test('a picked folder that does not exist on this host is rejected, not built in', async () => {
  // The owner ended up "Working in `t:\`" — a Windows drive root, which does not
  // exist from the WSL host, so every tool call in that run was doomed and it
  // looked as though the agent had no build tools at all.
  const r = await resolveTaskRoot('build the app', {
    isDirectory: async () => false,
    pickFolder: async () => 't:\\',
  });
  assert.equal(r, undefined, 'a non-existent picked root must not start a run');
});

test('a picked Windows folder is accepted via its WSL mount', async () => {
  const r = await resolveTaskRoot('build the app', {
    isDirectory: async (p) => p === '/mnt/t/MigraAccess Command',
    pickFolder: async () => 'T:\\MigraAccess Command',
  });
  assert.equal(r?.root, '/mnt/t/MigraAccess Command');
  assert.equal(r?.source, 'picked');
});
