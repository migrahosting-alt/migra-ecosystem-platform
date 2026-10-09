import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { ApplyChangesetResponseSchema, ProposeChangesetResponseSchema } from '@migrapilot/protocol';
import { registerToolExecutionRoutes } from '../src/engine/tools/toolRoutes.js';
import { buildWebsiteCandidate, createWebsiteRepo, websiteChangeset, WEBSITE_REQUIRED_FILES } from './fixtures/websiteCodingFixture.js';
import { TRAP_FILE, runFixtureTests } from './fixtures/multifileCodingFixture.js';
import { candidateGit } from './support/detachedCandidate.js';

test('website candidate fails, repairs, validates before original writes, then applies through a single-use approval', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const trap = readFileSync(join(root, TRAP_FILE), 'utf8');
  const candidate = await buildWebsiteCandidate(root);
  const { report } = candidate.value;
  assert.equal(report.complete, true, report.unresolvedRisks.join('; '));
  assert.match(report.baseline.stdout, /# tests 8\b/);
  assert.match(report.baseline.stdout, /# fail 7\b/);
  assert.equal(report.repairs.length, 1);
  assert.match(report.repairs[0]!.failureSummary, /6 failing test/);
  assert.ok(report.repairs[0]!.failureLines.some((line) => line.includes('excludedLineCount')));
  assert.match(report.finalValidation!.stdout, /# pass 8\b/);
  assert.match(report.finalValidation!.stdout, /# fail 0\b/);
  assert.deepEqual(candidate.value.diffPaths.sort(), [...WEBSITE_REQUIRED_FILES].sort());
  assert.equal(candidateGit(root, ['status', '--porcelain']), '', 'no candidate operation may change the original');

  const app = Fastify({ logger: false });
  registerToolExecutionRoutes(app);
  t.after(() => app.close());
  const proposed = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.proposeChangeset', input: candidate.value.changeset } });
  assert.equal(proposed.statusCode, 200);
  const preview = ProposeChangesetResponseSchema.parse(proposed.json<{ result: unknown }>().result);
  assert.equal(preview.fileCount, 4);
  for (const op of preview.ops) {
    assert.equal(op.before, readFileSync(join(root, op.path), 'utf8'));
    const candidateOp = candidate.value.changeset.ops.find((change) => change.path === op.path);
    assert.ok(candidateOp && candidateOp.op === 'replace');
    assert.equal(op.after, candidateOp.content);
  }
  const input = { rootPath: root, proposalHash: preview.proposalHash };
  const approval = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.applyChangeset', input } });
  assert.equal(approval.statusCode, 200);
  const approved = approval.json<{ status: string; approvalId: string }>();
  assert.equal(approved.status, 'approval_required');
  assert.equal(typeof approved.approvalId, 'string');
  assert.equal(candidateGit(root, ['status', '--porcelain']), '', 'minting approval must not apply');
  const applied = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.applyChangeset', input, approvalId: approved.approvalId } });
  assert.equal(applied.statusCode, 200);
  const result = ApplyChangesetResponseSchema.parse(applied.json<{ result: unknown }>().result);
  assert.equal(result.rolledBack, false);
  assert.deepEqual(result.modified.sort(), [...WEBSITE_REQUIRED_FILES].sort());
  for (const op of preview.ops) assert.equal(readFileSync(join(root, op.path), 'utf8'), op.after);
  const replay = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.applyChangeset', input, approvalId: approved.approvalId } });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json<{ code: string }>().code, 'INVALID_STATE');
  assert.equal(readFileSync(join(root, TRAP_FILE), 'utf8'), trap);
  const actual = runFixtureTests(root);
  assert.equal(actual.exitCode, 0, actual.output);
  assert.equal(actual.passed, 8);
  assert.equal(actual.failed, 0);
});

test('fixing only the API cannot qualify the website candidate or touch the original', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = await buildWebsiteCandidate(root, false);
  assert.equal(candidate.value.report.complete, false);
  assert.equal(candidate.value.report.finalValidation!.passed, false);
  assert.match(candidate.value.report.finalValidation!.stdout, /# pass 7\b/);
  assert.match(candidate.value.report.finalValidation!.stdout, /# fail 1\b/);
  assert.equal(candidateGit(root, ['status', '--porcelain']), '');
});

test('source drift after approval refuses the original apply without overwriting the changed file', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = Fastify({ logger: false });
  registerToolExecutionRoutes(app);
  t.after(() => app.close());
  const proposed = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.proposeChangeset', input: websiteChangeset(root, 'excludedLineCount') } });
  assert.equal(proposed.statusCode, 200);
  const preview = ProposeChangesetResponseSchema.parse(proposed.json<{ result: unknown }>().result);
  const input = { rootPath: root, proposalHash: preview.proposalHash };
  const approval = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.applyChangeset', input } });
  assert.equal(approval.statusCode, 200);
  const { approvalId } = approval.json<{ approvalId: string }>();
  const changedPath = WEBSITE_REQUIRED_FILES[0];
  writeFileSync(join(root, changedPath), 'controlled external change\n');
  const result = await app.inject({ method: 'POST', url: '/api/ai/tools', payload: { tool: 'fs.applyChangeset', input, approvalId } });
  assert.equal(result.statusCode, 502);
  assert.equal(result.json<{ code: string }>().code, 'TOOL_FAILED');
  assert.equal(readFileSync(join(root, changedPath), 'utf8'), 'controlled external change\n');
  for (const op of preview.ops.filter((op) => op.path !== changedPath)) {
    assert.equal(readFileSync(join(root, op.path), 'utf8'), op.before);
  }
});
