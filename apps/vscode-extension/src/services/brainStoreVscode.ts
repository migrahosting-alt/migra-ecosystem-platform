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
  bootstrapBrainStoreAt,
  type BrainBootstrapCore,
  type StorageFs,
} from './brainPersistence.js';

export { connectionPersister } from './brainPersistence.js';

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

export type BrainBootstrap = BrainBootstrapCore;

/**
 * Resolves storage under globalStorageUri and delegates to the vscode-free core.
 *
 * Storage NEVER lives in a workspace or repository: an operation record is not project
 * content, it is operator evidence, and writing it into a checkout would both pollute
 * the tree and leak across clones.
 */
export async function bootstrapBrainStore(
  context: vscode.ExtensionContext,
  log: (message: string) => void,
): Promise<BrainBootstrap> {
  // 1 — resolve under globalStorageUri. Never the workspace.
  const storagePath = vscode.Uri.joinPath(context.globalStorageUri, 'brain-execution').fsPath;
  return bootstrapBrainStoreAt(storagePath, vscodeStorageFs(), log);
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
