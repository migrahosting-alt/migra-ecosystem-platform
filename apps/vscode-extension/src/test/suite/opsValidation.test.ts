import { execFileSync } from 'node:child_process';
import { type Server, createServer } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MigraPilotApi } from '../../extension.js';
import {
  type EvidenceRecord,
  deriveRecoveryPath,
  deriveUserFacingStatus,
  noSilentFallback,
} from '../support/opsEvidence.js';
import { type MockModelProvider, startMockModelProvider } from '../support/mockModelProvider.js';
import { type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';

// P6 operational-validation matrix. Drives each real-world scenario through the
// Extension Host, captures the sanitized diagnostic snapshot + the per-run
// fields, asserts the "no silent fallback" invariant, and retains the evidence.
// Run via `npm run test:ops` (dedicated runner). Does NOT change any default or
// flip P6 — it only collects repeatable evidence.

const EXTENSION_ID = 'migrateck.migrapilot-extension';
const extensionRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(extensionRoot, '../..');
const brainServer = path.join(repoRoot, 'apps/brain-service/dist/src/server.js');
const FREE_PORT_NO_BRAIN = 3994;

let extApi: MigraPilotApi;
const records: EvidenceRecord[] = [];

function cfgUpdate(key: string, value: unknown): Thenable<void> {
  return vscode.workspace.getConfiguration('migrapilot').update(key, value, vscode.ConfigurationTarget.Global);
}

async function portState(brainPort: number): Promise<EvidenceRecord['portState']> {
  let occupied = false;
  try {
    const r = await fetch(`http://127.0.0.1:${brainPort}/health`, { signal: AbortSignal.timeout(800) });
    occupied = r.status >= 0;
  } catch {
    occupied = false;
  }
  return { brainPort, occupied, ownedByExtension: extApi.lifecycle.ownedPid() !== undefined };
}

async function capture(scenario: string, brainPort = 3988): Promise<EvidenceRecord> {
  const cur = extApi.backendDiagnostics().current!;
  const rec: EvidenceRecord = {
    scenario,
    configuredMode: cur.mode,
    selectedBackend: cur.backend,
    decisionReason: cur.reason,
    localProbe: cur.localProbe,
    remoteProbe: cur.remoteProbe,
    changed: cur.changed,
    userFacingStatus: deriveUserFacingStatus(cur),
    recoveryPath: deriveRecoveryPath(cur),
    noSilentFallback: noSilentFallback(cur),
    portState: await portState(brainPort),
    at: cur.at,
  };
  records.push(rec);
  return rec;
}

suite('P6 operational validation matrix', function () {
  this.timeout(60_000);

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    extApi = (await ext!.activate()) as MigraPilotApi;
  });

  suiteTeardown(async () => {
    // reset to shipping defaults
    await cfgUpdate('mode', 'local-brain');
    await cfgUpdate('provider', 'stub');
    await cfgUpdate('pilotApiUrl', undefined);
    await cfgUpdate('brainUrl', 'http://127.0.0.1:3988');
    await cfgUpdate('brainAutoStartCommand', undefined);
    await extApi.clearToken();
    await extApi.clearProviderKey();
    await extApi.lifecycle.shutdown();

    const dir = process.env.MIGRAPILOT_EVIDENCE_DIR ?? os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `ops-evidence-${records[0]?.at ?? 'run'}.json`);
    fs.writeFileSync(file, JSON.stringify(records, null, 2));
    // Summary table to the run log (captured as evidence).
    // eslint-disable-next-line no-console
    console.log('\n=== P6 OPS EVIDENCE ===');
    for (const r of records) {
      // eslint-disable-next-line no-console
      console.log(
        `[OPS] ${r.scenario} | mode=${r.configuredMode} backend=${r.selectedBackend} reason=${r.decisionReason} local=${r.localProbe} remote=${r.remoteProbe} changed=${r.changed} noFallback=${r.noSilentFallback} status="${r.userFacingStatus}" port3988=${r.portState.occupied ? 'occupied' : 'free'} owned=${r.portState.ownedByExtension}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[OPS] evidence written: ${file}`);
  });

  test('clean-activation', async () => {
    await cfgUpdate('mode', 'local-brain');
    await extApi.resolveBackend(true);
    const r = await capture('clean-activation');
    assert(r.selectedBackend === 'local' && r.noSilentFallback);
  });

  test('local-brain-unavailable', async () => {
    await cfgUpdate('mode', 'local-brain');
    await cfgUpdate('brainUrl', `http://127.0.0.1:${FREE_PORT_NO_BRAIN}`);
    await cfgUpdate('brainAutoStartCommand', []); // cannot start
    await extApi.resolveBackend(true);
    await extApi.lifecycle.ensureRunning(); // annotate local probe (down)
    const r = await capture('local-brain-unavailable', FREE_PORT_NO_BRAIN);
    assert(r.selectedBackend === 'local' && r.localProbe === 'down');
    await cfgUpdate('brainUrl', 'http://127.0.0.1:3988');
  });

  test('foreign-process-on-brain-port', async () => {
    const foreign: Server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'pilot-api' })); // NOT a migrapilot-brain
    });
    await new Promise<void>((r) => foreign.listen(3988, '127.0.0.1', r));
    try {
      await cfgUpdate('mode', 'local-brain');
      await cfgUpdate('brainAutoStartCommand', ['node', brainServer]);
      await extApi.resolveBackend(true);
      const ensure = await extApi.lifecycle.ensureRunning();
      const r = await capture('foreign-process-on-brain-port');
      assert(ensure === 'conflict', `expected conflict, got ${ensure}`);
      assert(r.localProbe === 'conflict');
      assert(extApi.lifecycle.ownedPid() === undefined, 'must not adopt/kill the foreign process');
    } finally {
      await new Promise<void>((r) => foreign.close(() => r()));
      await cfgUpdate('brainAutoStartCommand', undefined);
    }
  });

  test('invalid-or-missing-remote-token', async () => {
    const mock = await startMockPilotApi({ capabilities: 'unauthorized' });
    try {
      await cfgUpdate('pilotApiUrl', mock.url);
      await cfgUpdate('mode', 'remote-pilot');
      await extApi.clearToken();
      await extApi.resolveBackend(true);
      const r = await capture('invalid-or-missing-remote-token');
      assert(r.selectedBackend === 'remote-unavailable' && r.remoteProbe === 'unauthorized');
      assert(r.noSilentFallback, 'explicit remote failure must not fall back to local');
    } finally {
      await mock.close();
    }
  });

  test('pilot-api-outage', async () => {
    const mock = await startMockPilotApi({});
    const deadUrl = mock.url;
    await mock.close(); // now unreachable
    await cfgUpdate('pilotApiUrl', deadUrl);
    await cfgUpdate('mode', 'remote-pilot');
    await extApi.setToken('test-jwt');
    await extApi.resolveBackend(true);
    const r = await capture('pilot-api-outage');
    assert(r.selectedBackend === 'remote-unavailable' && r.remoteProbe === 'unavailable');
    assert(r.noSilentFallback);
    await extApi.clearToken();
  });

  test('provider-failure', async () => {
    const provider: MockModelProvider = await startMockModelProvider({ status: 500 });
    const folder = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
    fs.writeFileSync(path.join(folder, 'opsprov.ts'), 'export const p = 1;\n');
    execFileSync('git', ['add', 'opsprov.ts'], { cwd: folder });
    try {
      await cfgUpdate('mode', 'local-brain');
      await cfgUpdate('provider', 'openai-compat');
      await cfgUpdate('providerUrl', provider.url);
      await extApi.setProviderKey('sk-ops');
      await extApi.resolveBackend(true);
      const result = await extApi.generateCommitMessage();
      const rec = await capture('provider-failure');
      rec.recoveryPath = 'Retry, or switch provider/mode';
      assert(result.status === 'error', 'provider failure surfaces error, no fabricated message');
    } finally {
      await cfgUpdate('provider', 'stub');
      await cfgUpdate('providerUrl', undefined);
      await extApi.clearProviderKey();
      try {
        execFileSync('git', ['reset', '--', 'opsprov.ts'], { cwd: folder });
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(path.join(folder, 'opsprov.ts'));
      } catch {
        /* ignore */
      }
      await provider.close();
    }
  });

  test('explicit-repair-recovery', async () => {
    // Start unavailable, then "repair" against a working pilot-api → recovers.
    const bad = await startMockPilotApi({ capabilities: 'unauthorized' });
    await cfgUpdate('pilotApiUrl', bad.url);
    await cfgUpdate('mode', 'remote-pilot');
    await extApi.clearToken();
    await extApi.resolveBackend(true); // remote-unavailable
    await bad.close();

    const good = await startMockPilotApi({ capabilities: 'ok' });
    try {
      await cfgUpdate('pilotApiUrl', good.url);
      await extApi.setToken('test-jwt');
      await extApi.resolveBackend(true); // explicit re-resolution
      const r = await capture('explicit-repair-recovery');
      assert(r.selectedBackend === 'remote' && r.changed, 'repair recovered to remote and recorded the change');
    } finally {
      await good.close();
      await extApi.clearToken();
    }
  });

  test('session-stability-no-change-without-repair', async () => {
    const good = await startMockPilotApi({ capabilities: 'ok' });
    try {
      await cfgUpdate('pilotApiUrl', good.url);
      await cfgUpdate('mode', 'remote-pilot');
      await extApi.setToken('test-jwt');
      await extApi.resolveBackend(true); // resolves remote, records event
      const before = extApi.backendDiagnostics();
      // A non-forced resolve returns the cached selection and records NOTHING.
      await extApi.resolveBackend(false);
      await extApi.resolveBackend(false);
      const after = extApi.backendDiagnostics();
      assert(
        after.history.length === before.history.length,
        'no re-resolution event without an explicit repair',
      );
      const r = await capture('session-stability-no-change-without-repair');
      assert(r.selectedBackend === 'remote');
    } finally {
      await good.close();
      await extApi.clearToken();
    }
  });

  test('auto-remote-ready', async () => {
    const good = await startMockPilotApi({ capabilities: 'ok' });
    try {
      await cfgUpdate('pilotApiUrl', good.url);
      await cfgUpdate('mode', 'auto');
      await extApi.setToken('test-jwt');
      await extApi.resolveBackend(true);
      const r = await capture('auto-remote-ready');
      assert(r.selectedBackend === 'remote' && r.decisionReason === 'auto-remote-ready');
    } finally {
      await good.close();
      await extApi.clearToken();
    }
  });

  test('auto-remote-degraded-selects-local', async () => {
    const bad = await startMockPilotApi({ capabilities: 'unauthorized' });
    try {
      await cfgUpdate('pilotApiUrl', bad.url);
      await cfgUpdate('mode', 'auto');
      await extApi.clearToken();
      await extApi.resolveBackend(true);
      const r = await capture('auto-remote-degraded-selects-local');
      assert(r.selectedBackend === 'local' && r.decisionReason === 'auto-remote-not-ready-local-selected');
      assert(r.remoteProbe === 'unauthorized', 'remote probe outcome recorded even when auto selects local');
    } finally {
      await bad.close();
    }
  });

  test('auto-start-then-shutdown-port-state', async () => {
    await cfgUpdate('mode', 'local-brain');
    await cfgUpdate('brainUrl', 'http://127.0.0.1:3988');
    await cfgUpdate('brainAutoStartCommand', ['node', brainServer]);
    await extApi.resolveBackend(true);
    const started = await extApi.lifecycle.ensureRunning();
    assert(started === 'started' || started === 'already-brain');
    await extApi.lifecycle.shutdown();
    // Give the OS a moment to release the socket.
    for (let i = 0; i < 20; i++) {
      const s = await portState(3988);
      if (!s.occupied && !s.ownedByExtension) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = await capture('auto-start-then-shutdown-port-state');
    assert(r.portState.occupied === false && r.portState.ownedByExtension === false, 'port free + not owned after shutdown');
    await cfgUpdate('brainAutoStartCommand', undefined);
  });
});

function assert(cond: boolean, msg = 'assertion failed'): void {
  if (!cond) {
    throw new Error(msg);
  }
}
