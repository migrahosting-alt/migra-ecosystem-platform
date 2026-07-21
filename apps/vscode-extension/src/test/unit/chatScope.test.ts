// Folder-scoped chat: a question that names a folder scopes grounding to it, so
// a large monorepo doesn't answer from an unrelated copy. Covers candidate
// extraction and resolution (canonical preferred over a copy). © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractScopeCandidates, resolveChatScope, pickBestDir, isCopyPath, type ScopeDeps } from '../../chat/chatScope.js';

test('extracts a hyphenated project name and a "in X folder" name', () => {
  const c = extractScopeCandidates('in migracms-enterprise, what are the routes and Prisma models?');
  assert.ok(c.names.includes('migracms-enterprise'));
  const c2 = extractScopeCandidates('what does the auth package under the brain-service module do?');
  assert.ok(c2.names.includes('brain-service'));
  assert.ok(c2.names.includes('auth'));
});

test('does not treat English idioms or bare questions as folder names', () => {
  const c = extractScopeCandidates('what is a monad in general?');
  assert.ok(!c.names.includes('general'));
  assert.deepEqual(extractScopeCandidates('how does the router work?').names, []);
});

test('pickBestDir prefers the canonical path over a copy/starter', () => {
  assert.equal(isCopyPath('/ws/Clients/migracms-enterprise-starter'), true);
  assert.equal(isCopyPath('/ws/migracms-enterprise'), false);
  assert.equal(
    pickBestDir(['/ws/Clients/migracms-enterprise-starter', '/ws/migracms-enterprise']),
    '/ws/migracms-enterprise',
  );
});

function deps(over: Partial<ScopeDeps>): ScopeDeps {
  return { isDirectory: async () => false, findDirs: async () => [], ...over };
}

test('an absolute path in the question wins if it exists', async () => {
  const r = await resolveChatScope('routes in /ws/pkg/api ?', deps({ isDirectory: async (p) => p === '/ws/pkg/api' }));
  assert.deepEqual(r, { root: '/ws/pkg/api', label: '/ws/pkg/api' });
});

test('a named folder resolves to the canonical dir (not the starter copy)', async () => {
  const r = await resolveChatScope('what are migracms-enterprise routes?', deps({
    findDirs: async (name) => (name === 'migracms-enterprise'
      ? ['/ws/Clients/migracms-enterprise-starter', '/ws/migracms-enterprise'] : []),
  }));
  assert.deepEqual(r, { root: '/ws/migracms-enterprise', label: 'migracms-enterprise' });
});

test('no folder named / found → undefined (use the default workspace)', async () => {
  assert.equal(await resolveChatScope('what does the add function do?', deps({})), undefined);
});
