import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ENGINEER_CHECKPOINT_VERSION,
  decodeEngineerCheckpointPayloadV1,
} from '../src/engine/engineer/engineerCheckpointStore.js';

function validCheckpoint() {
  return {
    taskStateVersion: ENGINEER_CHECKPOINT_VERSION,
    correlationId: 'corr-1',
    rootPath: '/workspace',
    objective: 'Inspect repository',
    intent: 'INSPECT',
    plan: [{ text: 'Inspect files', done: false }],
    completionEvidence: {
      enabled: true,
      satisfied: [],
      evidence: [],
    },
    observations: [
      {
        tool: 'git.status',
        input: { rootPath: '/workspace' },
        result: { branch: 'main' },
      },
    ],
    workspaceSnapshot: {
      gitHead: 'abc123',
      gitBranch: 'main',
      dirtyFingerprint: 'fingerprint',
    },
    resumeEpoch: 0,
    status: 'RUNNING' as const,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:01:00.000Z',
  };
}

test('R2 checkpoint decoder accepts the exact V1 durable contract', () => {
  const decoded = decodeEngineerCheckpointPayloadV1(validCheckpoint());

  assert.equal(decoded.taskStateVersion, 1);
  assert.equal(decoded.correlationId, 'corr-1');
  assert.equal(decoded.status, 'RUNNING');
  assert.equal(decoded.resumeEpoch, 0);
});

test('R2 checkpoint decoder rejects an unknown checkpoint version', () => {
  const checkpoint = {
    ...validCheckpoint(),
    taskStateVersion: 2,
  };

  assert.throws(
    () => decodeEngineerCheckpointPayloadV1(checkpoint),
    /INVALID_ENGINEER_CHECKPOINT_PAYLOAD/,
  );
});

test('R2 checkpoint decoder rejects malformed semantic state', () => {
  const checkpoint = {
    ...validCheckpoint(),
    observations: [{ tool: '', input: {}, result: {} }],
  };

  assert.throws(
    () => decodeEngineerCheckpointPayloadV1(checkpoint),
    /INVALID_ENGINEER_CHECKPOINT_PAYLOAD/,
  );
});

test('R2 checkpoint decoder rejects impossible resume epochs', () => {
  const checkpoint = {
    ...validCheckpoint(),
    resumeEpoch: -1,
  };

  assert.throws(
    () => decodeEngineerCheckpointPayloadV1(checkpoint),
    /INVALID_ENGINEER_CHECKPOINT_PAYLOAD/,
  );
});

test('R2 checkpoint decoder rejects updatedAt before createdAt', () => {
  const checkpoint = {
    ...validCheckpoint(),
    updatedAt: '2026-09-16T23:59:59.000Z',
  };

  assert.throws(
    () => decodeEngineerCheckpointPayloadV1(checkpoint),
    /INVALID_ENGINEER_CHECKPOINT_PAYLOAD/,
  );
});

test('R2 checkpoint decoder rejects undeclared V1 fields', () => {
  const checkpoint = {
    ...validCheckpoint(),
    approvalToken: 'must-never-be-resumable',
  };

  assert.throws(
    () => decodeEngineerCheckpointPayloadV1(checkpoint),
    /INVALID_ENGINEER_CHECKPOINT_PAYLOAD/,
  );
});
