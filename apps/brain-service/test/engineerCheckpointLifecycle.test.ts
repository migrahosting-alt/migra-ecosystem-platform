import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { registerEngineerRoutes } from '../src/engine/engineer/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/tools/toolRoutes.js';
import {
  ModelRegistry,
  type ModelDescriptor,
} from '../src/engine/models/modelRegistry.js';
import type { ProviderAdapter } from '../src/providers/providerRegistry.js';
import type {
  EngineerCheckpointPayloadV1,
  EngineerCheckpointScope,
  EngineerCheckpointStatus,
  EngineerCheckpointStore,
} from '../src/engine/engineer/engineerCheckpointStore.js';
import {
  engineerWorkspaceSnapshotFromGit,
} from '../src/engine/engineer/engineerWorkspaceSnapshot.js';

const STUB_ENV = {
  localProvider: 'stub',
  providerBaseUrl: '',
  openAiApiKey: undefined,
} as never;

function model(id = 'local-coder'): ModelDescriptor {
  return {
    id,
    provider: 'local',
    capabilities: {
      chat: true,
      vision: false,
      tools: true,
      embedding: false,
      reasoning: true,
      coding: true,
      insert: false,
    },
    tier: 'balanced',
  };
}

interface SaveRecord {
  scope: EngineerCheckpointScope;
  checkpoint: EngineerCheckpointPayloadV1;
}

class RecordingCheckpointStore implements EngineerCheckpointStore {
  readonly saves: SaveRecord[] = [];
  readonly statuses: Array<{
    scope: EngineerCheckpointScope;
    correlationId: string;
    status: EngineerCheckpointStatus;
    updatedAt: string;
  }> = [];

  failSaveNumber: number | undefined;
  checkpointToLoad: EngineerCheckpointPayloadV1 | null = null;
  readonly loads: Array<{
    scope: EngineerCheckpointScope;
    correlationId: string;
  }> = [];

  private saveCount = 0;

  async save(
    scope: EngineerCheckpointScope,
    checkpoint: EngineerCheckpointPayloadV1,
  ): Promise<void> {
    this.saveCount += 1;

    if (this.failSaveNumber === this.saveCount) {
      throw new Error(`checkpoint save ${this.saveCount} failed`);
    }

    this.saves.push({
      scope: { ...scope },
      checkpoint: structuredClone(checkpoint),
    });
  }

  async load(
    scope: EngineerCheckpointScope,
    correlationId: string,
  ): Promise<EngineerCheckpointPayloadV1 | null> {
    this.loads.push({
      scope: { ...scope },
      correlationId,
    });

    if (
      !this.checkpointToLoad ||
      this.checkpointToLoad.correlationId !== correlationId
    ) {
      return null;
    }

    return structuredClone(this.checkpointToLoad);
  }

  async markStatus(
    scope: EngineerCheckpointScope,
    correlationId: string,
    status: EngineerCheckpointStatus,
    updatedAt: string,
  ): Promise<boolean> {
    this.statuses.push({
      scope: { ...scope },
      correlationId,
      status,
      updatedAt,
    });
    return true;
  }
}

function frames(
  body: string,
): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];

  for (const block of body.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(block);
    const data = /^data: (.+)$/m.exec(block);

    if (!event || !data) continue;

    try {
      out.push({
        event: event[1]!,
        data: JSON.parse(data[1]!) as Record<string, unknown>,
      });
    } catch {
      // Ignore malformed/non-JSON frames; the production protocol is JSON.
    }
  }

  return out;
}

function sequencedAdapter(
  outputs: string[],
  calls: string[],
): ProviderAdapter {
  let index = 0;

  return {
    name: 'stub',

    async complete() {
      calls.push(`complete:${index + 1}`);

      const content =
        outputs[Math.min(index, outputs.length - 1)] ??
        '{"final":"done"}';

      index += 1;

      return {
        content,
        model: 'stub',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
        },
      } as never;
    },

    async isAvailable() {
      return true;
    },
  } as never;
}

function throwingAdapter(calls: string[]): ProviderAdapter {
  return {
    name: 'stub',

    async complete() {
      calls.push('complete');
      throw new Error('synthetic provider failure');
    },

    async isAvailable() {
      return true;
    },
  } as never;
}

function buildApp(
  adapter: ProviderAdapter,
  checkpointStore: EngineerCheckpointStore,
) {
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);

  registerEngineerRoutes(
    app,
    STUB_ENV,
    new ModelRegistry({
      sources: [],
      staticModels: [model()],
    }),
    toolDeps,
    () => adapter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    checkpointStore,
  );

  return app;
}

test(
  'R2 route: successful run persists RUNNING semantic progress then COMPLETED in trusted scope',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    const app = buildApp(
      sequencedAdapter(
        [
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                steps: ['inspect the request'],
              },
            },
          }),
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                complete: [1],
              },
            },
          }),
          JSON.stringify({
            final: 'done',
          }),
        ],
        calls,
      ),
      store,
    );

    const rootPath = mkdtempSync(tmpdir() + '/eng-checkpoint-ok-');
    const correlationId = 'r2-route-success';

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': correlationId,
        'x-owner-scope': 'owner-A',
        'x-workspace-scope': 'workspace-A',
      },
      payload: {
        rootPath,
        task: 'Inspect this request and report when complete.',
      },
    });

    await app.close();

    assert.equal(response.statusCode, 200);
    assert.ok(calls.length >= 3, 'the controller must actually run');

    assert.ok(
      store.saves.length >= 4,
      `expected initial + semantic + terminal saves, got ${store.saves.length}`,
    );

    assert.equal(store.saves[0]!.checkpoint.status, 'RUNNING');
    assert.equal(
      store.saves.at(-1)!.checkpoint.status,
      'COMPLETED',
    );

    const semanticRunning = store.saves
      .slice(1, -1)
      .filter((record) => record.checkpoint.status === 'RUNNING');

    assert.ok(
      semanticRunning.length >= 1,
      'controller semantic progress must be durably saved while RUNNING',
    );

    for (const record of store.saves) {
      assert.deepEqual(record.scope, {
        owner: 'owner-A',
        workspace: 'workspace-A',
      });

      assert.equal(record.checkpoint.correlationId, correlationId);
      assert.equal(record.checkpoint.rootPath, rootPath);
      assert.equal(
        record.checkpoint.objective,
        'Inspect this request and report when complete.',
      );
      assert.equal(record.checkpoint.resumeEpoch, 0);
      assert.equal(
        record.checkpoint.createdAt,
        store.saves[0]!.checkpoint.createdAt,
        'createdAt must remain stable for one execution',
      );

      assert.ok(
        record.checkpoint.updatedAt >= record.checkpoint.createdAt,
        'updatedAt cannot precede createdAt',
      );
    }

    const terminal = store.saves.at(-1)!.checkpoint;
    assert.equal(terminal.plan.length, 1);
    assert.equal(
      (terminal.plan[0] as { done?: boolean }).done,
      true,
      'terminal checkpoint must contain the last controller plan state',
    );

    const fs = frames(response.body);
    const done = fs.find((frame) => frame.event === 'done');

    assert.ok(done, 'successful route must publish a done frame');
  },
);

test(
  'R2 route: real git.status + git.overview persist canonical repository identity',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    const rootPath = mkdtempSync(tmpdir() + '/eng-checkpoint-git-');

    execFileSync('git', ['init', '-b', 'main'], {
      cwd: rootPath,
      stdio: 'ignore',
    });

    writeFileSync(
      `${rootPath}/README.md`,
      '# Restart-safe checkpoint fixture\n',
    );

    execFileSync('git', ['add', 'README.md'], {
      cwd: rootPath,
      stdio: 'ignore',
    });

    execFileSync(
      'git',
      [
        '-c',
        'user.name=MigraPilot Test',
        '-c',
        'user.email=migrapilot-test@example.invalid',
        'commit',
        '-m',
        'fixture',
      ],
      {
        cwd: rootPath,
        stdio: 'ignore',
      },
    );

    const expectedHead = execFileSync(
      'git',
      ['rev-parse', 'HEAD'],
      {
        cwd: rootPath,
        encoding: 'utf8',
      },
    ).trim();

    const app = buildApp(
      sequencedAdapter(
        [
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                steps: ['inspect repository identity'],
              },
            },
          }),
          JSON.stringify({
            action: {
              tool: 'git.status',
              input: {},
            },
          }),
          JSON.stringify({
            action: {
              tool: 'git.overview',
              input: {},
            },
          }),
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                complete: [1],
              },
            },
          }),
          JSON.stringify({
            final: 'done',
          }),
        ],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-route-git-snapshot',
        'x-owner-scope': 'owner-git',
        'x-workspace-scope': 'workspace-git',
      },
      payload: {
        rootPath,
        task: 'Inspect this repository identity and report when complete.',
      },
    });

    await app.close();

    assert.equal(response.statusCode, 200);
    assert.ok(calls.length >= 5, 'controller must execute the Git inspection sequence');

    const terminal = store.saves.at(-1)!.checkpoint;

    assert.equal(terminal.status, 'COMPLETED');

    assert.equal(
      terminal.workspaceSnapshot.gitHead,
      expectedHead,
      'checkpoint HEAD must come from the real repository',
    );

    assert.equal(
      terminal.workspaceSnapshot.gitBranch,
      'main',
      'checkpoint branch must come from git.overview',
    );

    assert.ok(
      terminal.workspaceSnapshot.dirtyFingerprint !== null,
      'checkpoint must persist a canonical dirty-state fingerprint',
    );

    assert.ok(
      terminal.workspaceSnapshot.dirtyFingerprint.length > 0,
      'canonical dirty-state fingerprint must not be empty',
    );

    assert.ok(
      terminal.observations.some(
        (observation) => observation.tool === 'git.status',
      ),
      'terminal checkpoint must retain successful git.status evidence',
    );

    assert.ok(
      terminal.observations.some(
        (observation) => observation.tool === 'git.overview',
      ),
      'terminal checkpoint must retain successful git.overview evidence',
    );
  },
);

test(
  'R2 route: provider/controller failure persists FAILED',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();
    const app = buildApp(throwingAdapter(calls), store);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-route-failed',
        'x-owner-scope': 'owner-failure',
        'x-workspace-scope': 'workspace-failure',
      },
      payload: {
        rootPath: mkdtempSync(tmpdir() + '/eng-checkpoint-fail-'),
        task: 'Inspect this request.',
      },
    });

    await app.close();

    assert.equal(response.statusCode, 200);
    assert.ok(calls.length > 0, 'provider must have been invoked');

    assert.ok(store.saves.length >= 2);
    assert.equal(store.saves[0]!.checkpoint.status, 'RUNNING');
    assert.equal(store.saves.at(-1)!.checkpoint.status, 'FAILED');

    for (const record of store.saves) {
      assert.deepEqual(record.scope, {
        owner: 'owner-failure',
        workspace: 'workspace-failure',
      });
    }

    const fs = frames(response.body);
    assert.ok(
      fs.some((frame) => frame.event === 'error'),
      'failure must remain visible to the client',
    );
  },
);

test(
  'R2 route: initial checkpoint failure refuses before any model execution',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();
    store.failSaveNumber = 1;

    const app = buildApp(
      sequencedAdapter(
        [JSON.stringify({ final: 'must never run' })],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-route-store-unavailable',
        'x-owner-scope': 'owner-store',
        'x-workspace-scope': 'workspace-store',
      },
      payload: {
        rootPath: mkdtempSync(tmpdir() + '/eng-checkpoint-store-'),
        task: 'Inspect this request.',
      },
    });

    await app.close();

    assert.deepEqual(
      calls,
      [],
      'model/controller work must not begin when durable initialization fails',
    );

    assert.equal(
      store.saves.length,
      0,
      'failed initial write must not appear as a successful durable save',
    );

    const fs = frames(response.body);

    const error = fs.find(
      (frame) =>
        frame.event === 'error' &&
        frame.data.code === 'ENGINEER_CHECKPOINT_UNAVAILABLE',
    );

    assert.ok(
      error,
      `expected ENGINEER_CHECKPOINT_UNAVAILABLE, got ${fs
        .map((frame) => `${frame.event}:${String(frame.data.code ?? '')}`)
        .join(', ')}`,
    );

    const done = fs.find((frame) => frame.event === 'done');
    assert.equal(done?.data.code, 'ENGINEER_CHECKPOINT_UNAVAILABLE');
  },
);

test(
  'R2 route: request body cannot override checkpoint owner/workspace scope',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    const app = buildApp(
      sequencedAdapter(
        [JSON.stringify({ final: 'done' })],
        calls,
      ),
      store,
    );

    await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-route-scope',
        'x-owner-scope': 'trusted-owner',
        'x-workspace-scope': 'trusted-workspace',
      },
      payload: {
        rootPath: mkdtempSync(tmpdir() + '/eng-checkpoint-scope-'),
        task: 'Answer this request.',
        owner: 'body-owner-must-not-win',
        workspace: 'body-workspace-must-not-win',
      },
    });

    await app.close();

    assert.ok(calls.length > 0);
    assert.ok(store.saves.length >= 2);

    for (const record of store.saves) {
      assert.deepEqual(record.scope, {
        owner: 'trusted-owner',
        workspace: 'trusted-workspace',
      });
    }
  },
);

test(
  'R2 route: terminal checkpoint write failure is observable and does not fabricate durable completion',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    /*
     * Save sequence for this simple run:
     *   1 initial RUNNING
     *   2 terminal COMPLETED
     *
     * Fail the terminal durability write only.
     */
    store.failSaveNumber = 2;

    const app = buildApp(
      sequencedAdapter(
        [JSON.stringify({ final: 'done' })],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-terminal-save-failure',
        'x-owner-scope': 'owner-terminal',
        'x-workspace-scope': 'workspace-terminal',
      },
      payload: {
        rootPath: mkdtempSync(tmpdir() + '/eng-terminal-save-'),
        task: 'Answer this request.',
      },
    });

    await app.close();

    assert.ok(calls.length > 0, 'the controller must have run');

    assert.equal(
      store.saves.length,
      1,
      'only the initial RUNNING checkpoint should have persisted',
    );

    assert.equal(
      store.saves[0]!.checkpoint.status,
      'RUNNING',
      'durable state must not falsely claim COMPLETED',
    );

    const fs = frames(response.body);

    const finalFrame = fs.find((frame) => frame.event === 'final');
    assert.equal(
      finalFrame,
      undefined,
      'an accepted final must remain private until COMPLETED is durable',
    );

    const durabilityError = fs.find(
      (frame) =>
        frame.event === 'error' &&
        frame.data.code === 'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED',
    );

    assert.ok(
      durabilityError,
      'terminal durability failure must be explicit to the client',
    );

    const done = fs.find((frame) => frame.event === 'done');
    assert.equal(done?.data.outcome, 'failed');
    assert.equal(
      done?.data.code,
      'ENGINEER_CHECKPOINT_TERMINAL_WRITE_FAILED',
    );
  },
);

test(
  'R2 route: a provider interruption never persists COMPLETED',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    const adapter: ProviderAdapter = {
      name: 'stub',

      async complete() {
        calls.push('complete');
        throw Object.assign(
          new Error('synthetic interrupted stream'),
          { name: 'AbortError' },
        );
      },

      async isAvailable() {
        return true;
      },
    } as never;

    const app = buildApp(adapter, store);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'r2-interrupted-run',
        'x-owner-scope': 'owner-interrupt',
        'x-workspace-scope': 'workspace-interrupt',
      },
      payload: {
        rootPath: mkdtempSync(tmpdir() + '/eng-interrupt-'),
        task: 'Inspect this request.',
      },
    });

    await app.close();

    assert.ok(calls.length > 0);

    assert.ok(
      store.saves.length >= 2,
      'initial and terminal durability records are required',
    );

    const terminalStatus = store.saves.at(-1)!.checkpoint.status;

    assert.notEqual(
      terminalStatus,
      'COMPLETED',
      'an interrupted run must never become durable COMPLETED',
    );

    assert.ok(
      terminalStatus === 'FAILED' || terminalStatus === 'INTERRUPTED',
      `unexpected terminal checkpoint status: ${terminalStatus}`,
    );

    const fs = frames(response.body);

    assert.ok(
      fs.some((frame) => frame.event === 'error'),
      'interruption must remain visible to the client',
    );
  },
);

function gitFixtureCheckpoint(
  rootPath: string,
  correlationId: string,
  status: EngineerCheckpointPayloadV1['status'] = 'INTERRUPTED',
): EngineerCheckpointPayloadV1 {
  const head = execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    {
      cwd: rootPath,
      encoding: 'utf8',
    },
  ).trim();

  return {
    taskStateVersion: 1,
    correlationId,
    rootPath,
    objective: 'Inspect this repository and continue.',
    intent: 'DISCUSS',
    plan: [
      {
        text: 'inspect repository identity',
        done: false,
      },
    ],
    completionEvidence: {
      enabled: false,
      satisfied: [],
      evidence: [],
    },
    observations: [
      {
        tool: 'git.status',
        input: { rootPath },
        result: {
          tool: 'git.status',
          branch: 'main',
          files: [],
        },
      },
      {
        tool: 'git.overview',
        input: { rootPath },
        result: {
          tool: 'git.overview',
          branch: 'main',
          head,
          headShort: head.slice(0, 7),
          detached: false,
          ahead: null,
          behind: null,
          counts: {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
          },
          diffSummary: {
            stagedFiles: 0,
            stagedInsertions: 0,
            stagedDeletions: 0,
            unstagedFiles: 0,
            unstagedInsertions: 0,
            unstagedDeletions: 0,
          },
        },
      },
    ],
    workspaceSnapshot: engineerWorkspaceSnapshotFromGit(
      {
        tool: 'git.status',
        branch: 'main',
        files: [],
      },
      {
        tool: 'git.overview',
        branch: 'main',
        head,
        headShort: head.slice(0, 7),
        detached: false,
        ahead: null,
        behind: null,
        counts: {
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
        },
        diffSummary: {
          stagedFiles: 0,
          stagedInsertions: 0,
          stagedDeletions: 0,
          unstagedFiles: 0,
          unstagedInsertions: 0,
          unstagedDeletions: 0,
        },
      },
    ),
    resumeEpoch: 2,
    status,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:01:00.000Z',
  };
}

function createCommittedGitFixture(): string {
  const rootPath = mkdtempSync(tmpdir() + '/eng-resume-git-');

  execFileSync('git', ['init', '-b', 'main'], {
    cwd: rootPath,
    stdio: 'ignore',
  });

  writeFileSync(
    `${rootPath}/README.md`,
    '# Resume fixture\n',
  );

  execFileSync('git', ['add', 'README.md'], {
    cwd: rootPath,
    stdio: 'ignore',
  });

  execFileSync(
    'git',
    [
      '-c',
      'user.name=MigraPilot Test',
      '-c',
      'user.email=migrapilot-test@example.invalid',
      'commit',
      '-m',
      'fixture',
    ],
    {
      cwd: rootPath,
      stdio: 'ignore',
    },
  );

  return rootPath;
}

test(
  'R2 resume: missing scoped checkpoint refuses before model work',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();

    const app = buildApp(
      sequencedAdapter(
        [JSON.stringify({ final: 'must never run' })],
        calls,
      ),
      store,
    );

    const rootPath = createCommittedGitFixture();

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-owner-scope': 'resume-owner',
        'x-workspace-scope': 'resume-workspace',
      },
      payload: {
        rootPath,
        task: 'Inspect this repository and continue.',
        resumeCorrelationId: 'missing-resume',
      },
    });

    await app.close();

    assert.equal(response.statusCode, 404);
    assert.deepEqual(calls, []);
    assert.equal(store.loads.length, 1);
    assert.deepEqual(store.loads[0]!.scope, {
      owner: 'resume-owner',
      workspace: 'resume-workspace',
    });
  },
);

test(
  'R2 resume: correlation header cannot disagree with resume identity',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();
    const app = buildApp(
      sequencedAdapter(
        [JSON.stringify({ final: 'must never run' })],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': 'different-trace',
        'x-owner-scope': 'owner',
        'x-workspace-scope': 'workspace',
      },
      payload: {
        rootPath: '/workspace',
        task: 'Inspect this repository and continue.',
        resumeCorrelationId: 'original-run',
      },
    });

    await app.close();

    assert.equal(response.statusCode, 409);
    assert.deepEqual(calls, []);
    assert.equal(store.loads.length, 0);
  },
);

for (const terminalStatus of ['COMPLETED', 'FAILED'] as const) {
  test(
    `R2 resume: ${terminalStatus} checkpoint is not re-entered`,
    async () => {
      const calls: string[] = [];
      const store = new RecordingCheckpointStore();
      const rootPath = createCommittedGitFixture();

      store.checkpointToLoad =
        gitFixtureCheckpoint(
          rootPath,
          `terminal-${terminalStatus}`,
          terminalStatus,
        );

      const app = buildApp(
        sequencedAdapter(
          [JSON.stringify({ final: 'must never run' })],
          calls,
        ),
        store,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/ai/engineer',
        headers: {
          'x-owner-scope': 'owner-terminal-resume',
          'x-workspace-scope': 'workspace-terminal-resume',
        },
        payload: {
          rootPath,
          task: 'Inspect this repository and continue.',
          resumeCorrelationId: `terminal-${terminalStatus}`,
        },
      });

      await app.close();

      assert.equal(response.statusCode, 409);
      assert.deepEqual(calls, []);
    },
  );
}

test(
  'R2 resume: unchanged repository restores semantic state and increments epoch',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();
    const rootPath = createCommittedGitFixture();
    const correlationId = 'resume-unchanged';

    store.checkpointToLoad =
      gitFixtureCheckpoint(
        rootPath,
        correlationId,
        'INTERRUPTED',
      );

    const app = buildApp(
      sequencedAdapter(
        [
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                complete: [1],
              },
            },
          }),
          JSON.stringify({
            final: 'done',
          }),
        ],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': correlationId,
        'x-owner-scope': 'resume-owner',
        'x-workspace-scope': 'resume-workspace',
      },
      payload: {
        rootPath,
        task: 'Inspect this repository and continue.',
        resumeCorrelationId: correlationId,
      },
    });

    await app.close();

    assert.equal(response.statusCode, 200);
    assert.ok(calls.length >= 2);

    const terminal = store.saves.at(-1)!.checkpoint;

    assert.equal(terminal.correlationId, correlationId);
    assert.equal(terminal.resumeEpoch, 3);
    assert.equal(
      terminal.createdAt,
      '2026-09-17T00:00:00.000Z',
    );

    assert.equal(terminal.plan.length, 1);
    assert.equal(terminal.plan[0]!.done, true);

    assert.ok(
      terminal.observations.some(
        (observation) => observation.tool === 'git.status',
      ),
    );

    assert.ok(
      terminal.observations.some(
        (observation) => observation.tool === 'git.overview',
      ),
    );

    const fs = frames(response.body);
    const resume = fs.find(
      (frame) => frame.event === 'resume',
    );

    assert.equal(resume?.data.workspaceState, 'unchanged');
    assert.equal(resume?.data.restoredSemanticState, true);
  },
);

test(
  'R2 resume: changed repository preserves task identity but invalidates stale semantic state',
  async () => {
    const calls: string[] = [];
    const store = new RecordingCheckpointStore();
    const rootPath = createCommittedGitFixture();
    const correlationId = 'resume-changed';

    store.checkpointToLoad =
      gitFixtureCheckpoint(
        rootPath,
        correlationId,
        'RUNNING',
      );

    // Change the workspace after the checkpoint.
    writeFileSync(
      `${rootPath}/README.md`,
      '# Resume fixture changed after checkpoint\n',
    );

    const app = buildApp(
      sequencedAdapter(
        [
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                steps: ['reinspect changed repository'],
              },
            },
          }),
          JSON.stringify({
            action: {
              tool: 'plan.update',
              input: {
                complete: [1],
              },
            },
          }),
          JSON.stringify({
            final: 'done',
          }),
        ],
        calls,
      ),
      store,
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/engineer',
      headers: {
        'x-correlation-id': correlationId,
        'x-owner-scope': 'changed-owner',
        'x-workspace-scope': 'changed-workspace',
      },
      payload: {
        rootPath,
        task: 'Inspect this repository and continue.',
        resumeCorrelationId: correlationId,
      },
    });

    await app.close();

    assert.equal(response.statusCode, 200);

    const terminal = store.saves.at(-1)!.checkpoint;

    assert.equal(terminal.correlationId, correlationId);
    assert.equal(terminal.resumeEpoch, 3);
    assert.equal(
      terminal.createdAt,
      '2026-09-17T00:00:00.000Z',
    );

    // Old accepted plan/evidence were not trusted.
    assert.equal(terminal.plan.length, 1);
    assert.equal(
      terminal.plan[0]!.text,
      'reinspect changed repository',
    );

    assert.equal(
      terminal.observations.length,
      0,
      'stale pre-restart observations must not be restored',
    );

    const fs = frames(response.body);
    const resume = fs.find(
      (frame) => frame.event === 'resume',
    );

    assert.equal(resume?.data.workspaceState, 'changed');
    assert.equal(resume?.data.restoredSemanticState, false);
  },
);
