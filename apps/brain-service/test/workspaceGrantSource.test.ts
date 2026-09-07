/**
 * THE FIRST REAL GRANT SOURCE, against the real Workspace Manager.
 *
 * Not a fixture standing in for a registry — the actual manager, backed by the
 * actual durable store, so what this proves is what the product does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scope } from '../src/engine/memory/conversationStore.js';
import { WorkspaceManager, type WorkspaceView } from '../src/engine/workspace/workspaceManager.js';
import { IndexService } from '../src/engine/rag/indexService.js';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { AgentRegistry } from '../src/engine/agents/agentRegistry.js';
import { engineVersion } from '../src/engine/platform/version.js';
import { grantFor, WorkspaceProjectGrantSource } from '../src/engine/projects/workspaceGrantSource.js';
import type { WorkspaceRecord } from '../src/engine/workspace/workspaceManager.js';
import { authorityFromGrant, resolveBoundProject } from '../src/engine/projects/projectGrants.js';

const MINE: Scope = { owner: 'owner_a', workspace: 'ws_a' };
const THEIRS: Scope = { owner: 'owner_b', workspace: 'ws_b' };

function projectDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), `# ${name}\n`);
  return root;
}

/**
 * The REAL manager, memory-backed. Its dependencies are the production ones —
 * a grant source tested against a stand-in for the registry would prove only
 * that it agrees with the stand-in.
 */
const APPROVED = async (): Promise<WorkspaceView['models']> => ({
  coding: [], reasoning: [], general: [], vision: [], embedding: [],
});

const manager = () =>
  new WorkspaceManager({
    indexService: new IndexService(
      { async embed() { return [[0]]; }, id: 'fake', dimensions: 1 } as never,
      () => ({ async *files() {} }) as never,
    ),
    conversations: new ConversationStore(),
    agents: new AgentRegistry(),
    approvedModelsByTier: APPROVED,
    version: engineVersion,
    schemaVersion: () => 0,
    gitInfo: async () => ({ repo: undefined, branch: undefined }),
  });

test('a user sees the projects the registry already knows they have', async () => {
  const workspaces = manager();
  const root = projectDir('alpha');
  await workspaces.openWorkspace(MINE, { name: 'Alpha service', root });

  const source = new WorkspaceProjectGrantSource(workspaces);
  const grants = await source.listGrants(MINE);

  assert.equal(grants.length, 1);
  assert.equal(grants[0]!.label, 'Alpha service', 'the NAME the user gave it');
  assert.equal(grants[0]!.rootPath, root, 'the root comes from the registry row');
  assert.equal(grants[0]!.canRead, true);
});

test('🚨 another owner’s project is not listed and cannot be resolved', async () => {
  const workspaces = manager();
  await workspaces.openWorkspace(THEIRS, { name: 'Someone else', root: projectDir('beta') });

  const source = new WorkspaceProjectGrantSource(workspaces);
  assert.deepEqual(await source.listGrants(MINE), [], 'no cross-scope listing');

  const theirs = (await source.listGrants(THEIRS))[0]!;
  assert.equal(
    await source.resolveGrant(theirs.projectId, MINE),
    null,
    'resolving another owner’s project by id must fail',
  );
});

test('an unresolvable project reads as UNAVAILABLE, never as a refusal that confirms it exists', async () => {
  const workspaces = manager();
  await workspaces.openWorkspace(THEIRS, { name: 'Someone else', root: projectDir('gamma') });
  const source = new WorkspaceProjectGrantSource(workspaces);
  const theirs = (await source.listGrants(THEIRS))[0]!;

  const resolution = await resolveBoundProject(theirs.projectId, MINE, source);
  assert.equal(resolution.state, 'unavailable');
});

/*
 * The permission mapping is tested against RECORDS rather than through the
 * manager, because `patch` does not accept permissions and no route writes the
 * column — so a workspace cannot be put into these states through the public
 * API today. Testing the mapping directly is the honest way to prove it is
 * ready for the day the registry records them.
 */
const record = (permissions?: string[]): WorkspaceRecord => ({
  id: 'ws_1', ownerScope: 'owner_a', workspaceScope: 'ws_a', name: 'A project',
  root: '/srv/projects/a', memoryMode: 'session', createdAt: 1, updatedAt: 1,
  ...(permissions ? { permissions } : {}),
});

test('🚨 apply is FALSE even when the registry grants more', () => {
  const grant = grantFor(record(['read', 'propose', 'apply']));
  const authority = authorityFromGrant(grant);
  assert.equal(authority.canRead, true);
  assert.equal(authority.canPropose, true, 'proposing follows the grant');
  assert.equal(
    authority.canApply,
    false,
    '…and applying still does not. Read-only until the write path is integrated.',
  );
});

test('an explicit permission list is honoured exactly', () => {
  const grant = grantFor(record(['read']));
  assert.equal(grant.canRead, true);
  assert.equal(grant.canPropose, false, 'propose is not implied by read');
});

test('an unrecognised permission grants NOTHING', () => {
  const grant = grantFor(record(['raed']));
  assert.equal(grant.canRead, false, 'defaulting an unknown permission to allowed is how a typo becomes access');
});

test('no permission list means read — what the product already does with these', () => {
  const grant = grantFor(record());
  assert.equal(grant.canRead, true);
  assert.equal(grant.canPropose, false);
});

test('🚨 no root path reaches the label a user reads', async () => {
  const workspaces = manager();
  const root = projectDir('eta');
  const record = await workspaces.openWorkspace(MINE, { name: 'Eta service', root });
  const source = new WorkspaceProjectGrantSource(workspaces);
  const grant = await source.resolveGrant(record.id, MINE);

  assert.doesNotMatch(grant!.label, /\//, 'a path is infrastructure detail, and on a server it is worse');
  assert.notEqual(grant!.label, grant!.projectId, 'the label is not the id either');
});

test('the source has nowhere to accept a caller-supplied root, permission or kind', () => {
  /*
   * A STRUCTURAL assertion rather than a behavioural one, because the
   * protection IS structural: `ProjectGrantSource` takes a scope and a project
   * id, so there is no argument a caller could smuggle a root path through.
   * If that ever changes, this fails.
   */
  const source = new WorkspaceProjectGrantSource(manager());
  assert.equal(source.listGrants.length, 1, 'listGrants(scope) — one argument');
  assert.equal(source.resolveGrant.length, 2, 'resolveGrant(projectId, scope) — no root, no permissions');
});
