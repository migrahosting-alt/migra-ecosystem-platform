// Installed-path acceptance for the execution store.
//
// Everything below runs inside a real VS Code host, launched from the packaged VSIX,
// against the real filesystem through `vscode.workspace.fs`.
//
// That is the point. `vscodeStorageFs()` had never actually executed — every unit test
// substitutes an in-memory StorageFs. Real fs differs in ways that matter here: rename
// over an existing file, directory creation semantics, and whether a write that the
// in-memory harness treats as infallible can fail. A store proven only against a Map is
// not a store proven.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { BrainStore } from '../../services/brainPersistence.js';
import { vscodeStorageFs } from '../../services/brainStoreVscode.js';
import { ChatTurnExecution, reconcile } from '../../services/chatTurnExecution.js';
import { governedChild, ChildDispatchRefused } from '../../services/chatChildDispatch.js';

const EXTENSION_ID = 'migrateck.migrapilot-extension';

suite('Execution governance (installed path, real filesystem)', () => {
  let root: string;
  let store: BrainStore;

  suiteSetup(async function () {
    this.timeout(60_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} is not installed`);
    await ext.activate();
    // A dedicated subtree so acceptance never disturbs the extension's own records.
    root = vscode.Uri.joinPath(ext.extensionUri, '.acceptance-execution').fsPath;
    store = new BrainStore(root, vscodeStorageFs());
    await store.init();
  });

  test('the real storage backend round-trips a turn through vscode.workspace.fs', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-roundtrip');
    const onDisk = await store.readTurn('accept-roundtrip');
    assert.ok(onDisk, 'the parent record must exist on the real filesystem');
    assert.equal(onDisk.currentState, 'running');
    assert.equal(onDisk.revision, 1);
    assert.equal(turn.state, 'running');
  });

  test('success: a governed child completes and the parent completes from its record', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-success');
    const value = await governedChild(turn, 'engineer_turn', async () => 'produced');
    assert.equal(value, 'produced');

    const outcome = await turn.finish();
    assert.equal(outcome.state, 'completed');
    assert.equal(outcome.durable, true, 'the terminal revision reached real disk');

    const persisted = await store.readTurn('accept-success');
    assert.equal(persisted?.currentState, 'completed');
    assert.equal(persisted?.terminalEvidence?.outcome, 'success');
    assert.equal(persisted?.childOperationIds.length, 1);

    const child = await store.readOperation(persisted!.childOperationIds[0]!);
    assert.equal(child?.currentState, 'completed', 'the child is terminal on disk, not merely believed');
    assert.match(child!.requestedAction, /migraai_provider:engineer_turn/);
  });

  test('failure: a child that throws blocks parent success on disk', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-failure');
    await assert.rejects(() =>
      governedChild(turn, 'engineer_turn', async () => {
        throw new Error('provider refused');
      }),
    );
    const outcome = await turn.finish();
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.failure, 'child_failed');

    const persisted = await store.readTurn('accept-failure');
    assert.equal(persisted?.currentState, 'failed');
    assert.notEqual(persisted?.terminalEvidence?.outcome, 'success');
  });

  test('cancellation: requested but unacknowledged is never reported as cancelled', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-cancel-unconfirmed');
    await turn.requestCancellation();
    const outcome = await turn.finish();
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.failure, 'cancellation_unconfirmed');

    const persisted = await store.readTurn('accept-cancel-unconfirmed');
    assert.equal(persisted?.currentState, 'failed');
    assert.equal(persisted?.cancellation?.confirmed, false);
  });

  test('cancellation: an acknowledged stop with a cancelled child is reported as cancelled', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-cancel-confirmed');
    await assert.rejects(() =>
      governedChild(turn, 'local_chat_stream', async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }),
    );
    await turn.requestCancellation();
    turn.acknowledgeCancellation();
    const outcome = await turn.finish();
    assert.equal(outcome.state, 'cancelled');

    const persisted = await store.readTurn('accept-cancel-confirmed');
    assert.equal(persisted?.currentState, 'cancelled');
    assert.equal(persisted?.cancellation?.confirmed, true);
    const child = await store.readOperation(persisted!.childOperationIds[0]!);
    assert.equal(child?.currentState, 'cancelled', 'the child confirmed its own termination');
  });

  test('a VS Code CancellationToken only triggers — it never decides the outcome', async () => {
    const cts = new vscode.CancellationTokenSource();
    const turn = await ChatTurnExecution.begin(store, 'accept-token-trigger');
    cts.token.onCancellationRequested(() => {
      void turn.requestCancellation();
    });
    cts.cancel();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(cts.token.isCancellationRequested, true, 'the token says stop was pressed');
    const outcome = await turn.finish();
    assert.notEqual(outcome.state, 'cancelled', 'but the token alone never produces a cancelled outcome');
    assert.equal(outcome.failure, 'cancellation_unconfirmed');
    cts.dispose();
  });

  test('restart: reconciliation reads real records written by a previous session', async () => {
    // Written and left interrupted, exactly as a crash would leave it.
    const turn = await ChatTurnExecution.begin(store, 'accept-restart');
    await turn.registerChild('accept-restart-child', 'migraai_provider:engineer_turn');
    await turn.startChild('accept-restart-child');

    // A fresh store instance — nothing carried in memory, same as a new host.
    const reopened = new BrainStore(root, vscodeStorageFs());
    const turns = await reopened.loadTurns();
    const { operations } = await reopened.loadOperations();

    const record = turns.find((t) => t.turnId === 'accept-restart');
    assert.ok(record, 'the interrupted turn survived on disk');
    assert.equal(record.currentState, 'running', 'still running — never silently completed');

    const findings = reconcile([record], operations);
    const active = findings.filter((f) => f.childId === 'accept-restart-child');
    assert.ok(active.length === 0 || active.every((f) => f.kind !== 'parent_references_missing_child'),
      'the child exists, so no referential-integrity violation is reported');

    // And the parent still refuses to complete with an unresolved child.
    const outcome = await turn.finish();
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.failure, 'child_unresolved');
  });

  test('restart: a parent referencing a deleted child is reported, never completed', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-missing-child');
    await governedChild(turn, 'workspace_find', async () => 'ok');
    const persisted = await store.readTurn('accept-missing-child');
    const childId = persisted!.childOperationIds[0]!;

    // Remove the child through the real filesystem.
    await vscode.workspace.fs.delete(vscode.Uri.file(`${root}/operations/${childId}.json`));

    const outcome = await turn.finish();
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.failure, 'referential_integrity_violated');

    const reopened = new BrainStore(root, vscodeStorageFs());
    const findings = reconcile(await reopened.loadTurns(), (await reopened.loadOperations()).operations);
    assert.ok(
      findings.some((f) => f.kind === 'parent_references_missing_child' && f.childId === childId),
      'restart reconciliation reports the dangling reference',
    );
  });

  test('no token-shaped content reaches the real filesystem', async () => {
    const turn = await ChatTurnExecution.begin(store, 'accept-scrub');
    await governedChild(turn, 'cloud_escalation', async () => 'ok');
    await turn.finish();

    const dir = await vscode.workspace.fs.readDirectory(vscode.Uri.file(`${root}/turns`));
    let all = '';
    for (const [name] of dir) {
      all += new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.file(`${root}/turns/${name}`)),
      );
    }
    assert.equal(/Bearer\s+\S+/.test(all), false);
    assert.equal(/sk_live_|ghp_[A-Za-z0-9]{20}/.test(all), false);
  });

  suiteTeardown(async () => {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(root), { recursive: true, useTrash: false });
    } catch {
      /* acceptance artifacts only; leaving them behind never fails the run */
    }
  });
});
