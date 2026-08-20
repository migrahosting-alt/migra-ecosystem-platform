// Proofs for consuming Brain-published qualified intelligence.
//
// The interesting failures are not parser bugs: they are (a) a caller naming a model,
// (b) a quiet fallback when nothing is qualified, (c) a validated-candidate satisfying a
// request that demanded production, and (d) the extension reaching Engineer at runtime.
// Each is asserted here through the production module.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CapabilityContractUnavailableError,
  loadCapabilityContract,
  requireCapability,
  resolveCapability,
  type CapabilityContractReader,
} from '../../services/capabilityResolver.js';

/** The Brain-published contract shape, inline so the test is hermetic. NON-PRODUCTION fixture. */
const FIXTURE_CONTRACT = JSON.stringify({
  schemaVersion: '1.0.0',
  publishedAtIso: '2026-08-20T00:00:00Z',
  consumableStages: ['validated-candidate', 'staging', 'production'],
  capabilities: [
    {
      capabilityId: 'language.integration-fixture.echo',
      domain: 'language',
      requestKeys: ['language.echo.fixture'],
      stage: 'validated-candidate',
      artifact: {
        modelId: 'echo-fixture',
        version: '1.0.0',
        artifactIdentityHash: 'b'.repeat(64),
        adapterIds: [],
      },
      constraints: {
        languages: ['en', 'ht'],
        intendedUses: ['contract-verification'],
        prohibitedUses: ['production-inference', 'user-facing-output'],
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      qualifiedAt: '2026-08-20T00:00:00.000Z',
      publicationHash: 'c'.repeat(64),
    },
  ],
});

const reader = (body?: string): CapabilityContractReader => ({
  read: () => body,
  describe: () => '<test contract>',
});

test('a caller resolves by requirements and never names a model', () => {
  const contract = loadCapabilityContract(reader(FIXTURE_CONTRACT));
  const resolution = resolveCapability(contract, {
    requestKeys: ['language.echo.fixture'],
    languages: ['ht'],
  });
  assert.equal(resolution.resolved, true);
  assert.equal(resolution.handle?.capabilityId, 'language.integration-fixture.echo');
  // identity crosses the boundary; location never does
  assert.equal(resolution.handle?.artifactIdentityHash.length, 64);
});

test('STAGE ENFORCEMENT: a validated-candidate does not satisfy a production requirement', () => {
  const contract = loadCapabilityContract(reader(FIXTURE_CONTRACT));
  const production = resolveCapability(contract, {
    requestKeys: ['language.echo.fixture'],
    minimumStage: 'production',
  });
  assert.equal(production.resolved, false);
  assert.equal(production.handle, undefined);
  assert.match(production.reason, /minimum stage production/);

  const staging = resolveCapability(contract, {
    requestKeys: ['language.echo.fixture'],
    minimumStage: 'staging',
  });
  assert.equal(staging.resolved, false, 'staging must also be unsatisfied by a validated-candidate');
});

test('NO SUBSTITUTION: an unsatisfied requirement yields no handle at all', () => {
  const contract = loadCapabilityContract(reader(FIXTURE_CONTRACT));
  for (const requirements of [
    { requestKeys: ['coding.completion.repository'] },
    { requestKeys: ['language.echo.fixture'], languages: ['ja'] },
    { requestKeys: [] },
  ]) {
    const resolution = resolveCapability(contract, requirements);
    assert.equal(resolution.resolved, false);
    assert.equal(resolution.handle, undefined, 'a near miss must never be substituted');
  }
});

test('FAILS CLOSED when Brain has published nothing', () => {
  assert.throws(() => loadCapabilityContract(reader(undefined)), CapabilityContractUnavailableError);
});

test('FAILS CLOSED on a malformed or unsupported contract', () => {
  assert.throws(() => loadCapabilityContract(reader('{ not json')), CapabilityContractUnavailableError);
  assert.throws(
    () => loadCapabilityContract(reader(JSON.stringify({ schemaVersion: '9.0.0', capabilities: [] }))),
    CapabilityContractUnavailableError,
  );
  assert.throws(
    () => loadCapabilityContract(reader(JSON.stringify({ schemaVersion: '1.0.0' }))),
    CapabilityContractUnavailableError,
  );
});

test('an empty qualified set is NOT an error, and still yields no model', () => {
  const contract = loadCapabilityContract(
    reader(JSON.stringify({ schemaVersion: '1.0.0', capabilities: [] })),
  );
  const resolution = resolveCapability(contract, { requestKeys: ['language.echo.fixture'] });
  assert.equal(resolution.resolved, false);
  assert.equal(resolution.handle, undefined);
});

test('requireCapability throws rather than falling back to a default model', () => {
  assert.throws(
    () => requireCapability(reader(FIXTURE_CONTRACT), { requestKeys: ['coding.completion.repository'] }),
    CapabilityContractUnavailableError,
  );
  assert.throws(
    () => requireCapability(reader(undefined), { requestKeys: ['language.echo.fixture'] }),
    CapabilityContractUnavailableError,
  );
});

test('NO DIRECT MODEL OR PROVIDER FALLBACK exists in the resolver source', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/services/capabilityResolver.ts'), 'utf8');
  const code = source.slice(source.lastIndexOf(' */') + 3);
  for (const forbidden of ['ollama', 'openai', 'anthropic', 'qwen', 'llama', 'gpt-', 'defaultModel', 'fallbackModel']) {
    assert.ok(!code.toLowerCase().includes(forbidden), `resolver must not know about "${forbidden}"`);
  }
});

test('ENGINEER IS ABSENT AT RUNTIME: no LOCATION crosses, and the resolver cannot reach it', () => {
  // Naming Engineer as PROVENANCE (source.component) is legitimate and matches the existing
  // runtime-policy.json / voice-capabilities.json convention — it says who produced the
  // contract. What must never cross is a LOCATION: a path, a registry file, an artifact
  // filename. Asserting the bare string "MigraAI-Engineer" would forbid honest provenance
  // while still permitting a leaked path, which is the wrong invariant.
  const blob = JSON.stringify(JSON.parse(FIXTURE_CONTRACT) as Record<string, unknown>);
  for (const forbidden of ['training/', 'datasets/', 'checkpoints/', 'reports/', '.safetensors', '.jsonl', 'capability-registry']) {
    assert.ok(!blob.includes(forbidden), `contract must not carry the location "${forbidden}"`);
  }
  for (const pattern of [/[A-Za-z]:[\\/]/, /\b(?:file|https?|s3|gs|minio):\/\//i]) {
    assert.ok(!pattern.test(blob), `contract must not carry a path or storage URI (${pattern})`);
  }
  const source = readFileSync(path.resolve(__dirname, '../../../src/services/capabilityResolver.ts'), 'utf8');
  const code = source.slice(source.lastIndexOf(' */') + 3);
  assert.ok(!code.includes('MigraAI-Engineer'), 'resolver code must not reference Engineer');
  assert.ok(!code.includes('capability-registry'), 'resolver code must not reference Engineer artifacts');
});

test('the most promoted capability wins when several satisfy a request', () => {
  const twoStages = JSON.parse(FIXTURE_CONTRACT) as { capabilities: unknown[] };
  const promoted = JSON.parse(JSON.stringify(twoStages.capabilities[0])) as Record<string, unknown>;
  promoted['stage'] = 'production';
  promoted['capabilityId'] = 'language.echo.promoted';
  promoted['publicationHash'] = 'd'.repeat(64);
  twoStages.capabilities.push(promoted);
  const contract = loadCapabilityContract(reader(JSON.stringify(twoStages)));
  const resolution = resolveCapability(contract, { requestKeys: ['language.echo.fixture'] });
  assert.equal(resolution.handle?.stage, 'production');
  assert.equal(resolution.handle?.capabilityId, 'language.echo.promoted');
});

// --- component naming: "Brain" is two different components -------------------------
//
// MigraAI Brain (ecosystem capability layer, publishes the contract) and MigraPilot Brain
// Service (apps/brain-service, local inference on :3988) fail in OPPOSITE ways and look
// identical to a user. Reporting one as the other sends an operator to the wrong component.
// Asserted structurally because the invariant is a property of the user-facing strings.

const readSource = (relative: string): string =>
  readFileSync(path.resolve(__dirname, '../../../src', relative), 'utf8');

test('capability messages name MigraAI Brain, never the Brain Service', () => {
  const source = readSource('services/capabilityContractVscode.ts');
  const messages = [...source.matchAll(/return\s+[`'"]([^`'"]*(?:Brain|capability)[^`'"]*)[`'"]/g)]
    .map((m) => m[1])
    .filter((m): m is string => typeof m === 'string');
  assert.ok(messages.length >= 3, 'expected the three availability states to be reported');
  for (const message of messages) {
    assert.ok(
      message.includes('MigraAI Brain'),
      `capability message must name MigraAI Brain explicitly: ${message}`,
    );
    assert.ok(
      !/Brain Service/.test(message),
      `capability message must NOT claim the Brain Service: ${message}`,
    );
  }
});

test('health message names the MigraPilot Brain Service, not a bare "brain"', () => {
  const source = readSource('extension.ts');
  assert.ok(
    source.includes('MigraPilot Brain Service is ${health.status}'),
    'health must name the Brain Service explicitly',
  );
  assert.ok(
    !source.includes('MigraPilot brain is ${health.status}'),
    'ambiguous bare "brain" must not return to the health surface',
  );
});

test('the resolver never confuses the capability layer with the inference runtime', () => {
  const source = readSource('services/capabilityResolver.ts');
  const code = source.slice(source.lastIndexOf(' */') + 3);
  assert.ok(!code.includes('brain-service'), 'resolver must not reference the inference runtime');
  assert.ok(!code.includes('3988'), 'resolver must not know the Brain Service port');
});
