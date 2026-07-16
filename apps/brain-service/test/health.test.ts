import assert from 'node:assert/strict';
import test from 'node:test';
import { readEnv } from '../src/config/env.js';
import { selectEffectiveProfile } from '../src/providers/selectProvider.js';

test('readEnv parses defaults correctly', () => {
  const env = readEnv({} as NodeJS.ProcessEnv);
  assert.equal(env.host, '127.0.0.1');
  assert.equal(env.port, 3988);
  assert.equal(env.mode, 'hybrid');
  assert.equal(env.enableTelemetry, true);
});

test('offline mode forces cloud profiles to local', () => {
  const env = readEnv({ MIGRAPILOT_MODE: 'offline' } as NodeJS.ProcessEnv);
  assert.equal(selectEffectiveProfile('cheap', env), 'local');
  assert.equal(selectEffectiveProfile('default', env), 'local');
});