// MigraPilot — production wiring for the durable execution store.
//
// Storage lives under the extension's globalStorageUri and NEVER in a workspace or
// repository: an operation record is not project content, it is operator evidence, and
// writing it into a checkout would both pollute the tree and leak across clones.
//
// The activation sequence below is ordered for one reason: a health probe that starts
// before recovery finishes would overwrite the recovered state the user is shown, so a
// run that was interrupted would silently look fine.

import * as vscode from 'vscode';

import {
  BrainStore,
  SCHEMA_VERSION,
  type PersistedBrainOperation,
  type StorageFs,
} from './brainPersistence.js';
import type { ConnectionPersister } from './brainConnection.js';

/** StorageFs over vscode.workspace.fs, so the same code path works remotely. */
export function vscodeStorageFs(): StorageFs {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const uri = (p: string) => vscode.Uri.file(p);
  return {
    mkdir: async (p) => {
      await vscode.workspace.fs.createDirectory(uri(p));
    },
    readFile: async (p) => dec.decode(await vscode.workspace.fs.readFile(uri(p))),
    writeFile: async (p, d) => {
      await vscode.workspace.fs.writeFile(uri(p), enc.encode(d));
    },
    rename: async (from, to) => {
      await vscode.workspace.fs.rename(uri(from), uri(to), { overwrite: true });
    },
    readdir: async (p) => {
      try {
        return (await vscode.workspace.fs.readDirectory(uri(p))).map(([name]) => name);
      } catch {
        return [];
      }
    },
    exists: async (p) => {
      try {
        await vscode.workspace.fs.stat(uri(p));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface BrainBootstrap {
  store: BrainStore;
  /** Resolved location, for sanitized diagnostics only. */
  storagePath: string;
  /** Recovered operations, already rewritten at a new revision on disk. */
  recovered: Array<{ operationId: string; state: string; evidence?: string }>;
  quarantined: Array<{ sourceFile: string; failure: string }>;
}

/**
 * Steps 1–5 of the activation contract, in order and without gaps.
 *
 * Returns only after recovery has been PERSISTED, so the caller may safely start
 * health polling and accept operations once this resolves — and not before.
 */
export async function bootstrapBrainStore(
  context: vscode.ExtensionContext,
  log: (message: string) => void,
): Promise<BrainBootstrap> {
  // 1 — resolve under globalStorageUri. Never the workspace.
  const storagePath = vscode.Uri.joinPath(context.globalStorageUri, 'brain-execution').fsPath;

  // 2/3 — construct one shared store and create its directories before any read.
  const store = new BrainStore(storagePath, vscodeStorageFs());
  await store.init();

  // 4/5 — load, recover, and REWRITE incomplete records so the recovery decision is
  // itself durable. A record recovered only in memory would be re-recovered — or worse,
  // re-interpreted — on the next restart.
  const { operations, quarantined } = await store.loadOperations();
  const recovered: BrainBootstrap['recovered'] = [];

  for (const op of operations) {
    if (op.recovery) {
      try {
        await store.saveOperation(op);
      } catch (err) {
        // Persisting the recovery failed. Report it; never downgrade to "fine".
        log(`brain-store: could not persist recovery for ${op.operationId}: ${String(err)}`);
      }
      recovered.push({
        operationId: op.operationId,
        state: op.currentState,
        ...(op.recovery.evidence ? { evidence: op.recovery.evidence } : {}),
      });
    }
  }

  log(
    `brain-store: ready (${operations.length} record(s), ${recovered.length} recovered, ` +
      `${quarantined.length} quarantined)`,
  );
  for (const q of quarantined) {
    log(`brain-store: quarantined ${q.sourceFile} — ${q.failure}`);
  }

  return {
    store,
    storagePath,
    recovered,
    quarantined: quarantined.map((q) => ({ sourceFile: q.sourceFile, failure: q.failure })),
  };
}

/**
 * The user-visible line for a recovered run. Never reassuring: an interrupted operation
 * is reported as interrupted, and an unconfirmed cancellation says exactly that.
 */
export function recoveredStatusLine(recovered: BrainBootstrap['recovered']): string | undefined {
  if (recovered.length === 0) return undefined;
  const unconfirmed = recovered.filter((r) => r.evidence === 'cancellation_acknowledgment_missing');
  const interrupted = recovered.length - unconfirmed.length;
  const parts: string[] = [];
  if (interrupted > 0) {
    parts.push(`${interrupted} operation(s) interrupted by a restart — outcome never observed`);
  }
  if (unconfirmed.length > 0) {
    parts.push(`${unconfirmed.length} cancellation(s) requested but not confirmed`);
  }
  return `MigraPilot: ${parts.join('; ')}. Re-run if still required.`;
}


/**
 * Adapts the narrow ConnectionPersister onto the store, owning the monotonic revision
 * for `connection.json` alone.
 *
 * Writes are fire-and-forget by design: a health poll must never block the UI on disk
 * IO, and a failed connection write is a diagnostic, not a reason to misreport
 * readiness. Failures are logged — never swallowed, never escalated into a false state.
 */
export function connectionPersister(
  store: BrainStore,
  log: (message: string) => void,
): ConnectionPersister {
  let revision = 0;
  let inFlight: Promise<unknown> = Promise.resolve();
  return {
    persist(record) {
      revision += 1;
      const rev = revision;
      // Serialised through one chain so rapid transitions stay monotonic on disk
      // rather than racing each other into out-of-order revisions.
      inFlight = inFlight
        .then(() =>
          store.saveConnection({
            schemaVersion: SCHEMA_VERSION,
            revision: rev,
            updatedAt: new Date().toISOString(),
            ...record,
          }),
        )
        .catch((err: unknown) => {
          log(`brain-store: connection revision ${rev} not persisted — ${String(err)}`);
        });
    },
  };
}
