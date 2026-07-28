/**
 * MigraPilot Interaction Verification — environment baseline and effect classification.
 *
 * "Unchanged" is a typed, multi-dimensional claim here, not `git status`. A control can
 * write a setting, leave a document dirty or park a dialog without touching a tracked file,
 * and a baseline watching only git would call that clean.
 *
 * Two dimensions genuinely cannot be captured through the VS Code API and are recorded as
 * gaps rather than quietly dropped:
 *
 *   host.pendingNotifications / host.pendingDialogs
 *     There is no API to enumerate open notifications or modal dialogs. This is the exact
 *     dimension that would have named the `Diagnose Failure` toast hang directly instead of
 *     leaving it as a 60-second timeout, so its absence is worth stating loudly.
 *
 *   workspace.workspaceStateDigest
 *     An extension's `Memento` is private to that extension. Reachable only if the
 *     extension chooses to expose it, which it does not today.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { EffectKind, InteractionBaseline, ObservedEffect } from './types.js';

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
}

/**
 * Capture the environment.
 *
 * `trackedContentDigest` hashes the porcelain status rather than every tracked file: the
 * cheap signal catches the mutations this slice forbids, and hashing a monorepo on every
 * interaction would make verification too slow to run often — which is its own failure.
 */
export function captureBaseline(root: string): InteractionBaseline {
  const unverifiable: Record<string, string> = {};

  const headSha = git(root, ['rev-parse', 'HEAD']);
  const statusRaw = git(root, ['status', '--porcelain']);
  if (headSha === null || statusRaw === null) {
    unverifiable['repository'] = 'git is unavailable or the workspace is not a repository';
  }
  const statusPorcelain = (statusRaw ?? '').split('\n').map((l) => l.trim()).filter(Boolean).sort();

  let configurationDigest: string | null = null;
  try {
    // Only MigraPilot's own section: hashing every setting would report unrelated editor
    // churn as a mutation and make the check useless within a day.
    configurationDigest = digest(JSON.parse(JSON.stringify(vscode.workspace.getConfiguration('migrapilot'))));
  } catch {
    unverifiable['workspace.configurationDigest'] = 'configuration could not be serialized';
  }

  // Not obtainable: an extension Memento is private to its own extension host instance.
  unverifiable['workspace.workspaceStateDigest'] = 'extension workspace state is private to the owning extension';

  // Not obtainable: VS Code exposes no API to enumerate open notifications or dialogs.
  unverifiable['host.pendingNotifications'] = 'VS Code exposes no API to enumerate open notifications';
  unverifiable['host.pendingDialogs'] = 'VS Code exposes no API to enumerate open modal dialogs';

  return {
    repository: {
      headSha,
      statusPorcelain,
      ...(statusRaw !== null ? { trackedContentDigest: digest(statusPorcelain) } : {}),
    },
    workspace: { configurationDigest, workspaceStateDigest: null },
    editors: {
      openDocumentUris: vscode.workspace.textDocuments.map((d) => d.uri.toString()).sort(),
      dirtyDocumentUris: vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => d.uri.toString()).sort(),
      activeDocumentUri: vscode.window.activeTextEditor?.document.uri.toString() ?? null,
    },
    host: { pendingNotifications: null, pendingDialogs: null },
    unverifiable,
  };
}

/**
 * Classify what changed between two baselines.
 *
 * Returns NAMED effects from a closed set. An effect a trace cannot name is one it cannot
 * declare expected or forbidden, and silently-unclassified change is how a verification
 * system starts lying about what it checked.
 */
export function classifyEffects(before: InteractionBaseline, after: InteractionBaseline): ObservedEffect[] {
  const effects: ObservedEffect[] = [];
  const add = (kind: EffectKind, detail: string) => effects.push({ kind, detail });

  if (before.repository.headSha !== after.repository.headSha) {
    add('repository.headChanged', `${before.repository.headSha ?? 'none'} → ${after.repository.headSha ?? 'none'}`);
  }

  const beforeStatus = new Set(before.repository.statusPorcelain);
  const afterStatus = new Set(after.repository.statusPorcelain);
  const appeared = [...afterStatus].filter((l) => !beforeStatus.has(l));
  const vanished = [...beforeStatus].filter((l) => !afterStatus.has(l));
  if (appeared.length || vanished.length) {
    add('repository.filesChanged', [...appeared.map((l) => `+${l}`), ...vanished.map((l) => `-${l}`)].join(' | '));
  }

  if (before.workspace.configurationDigest !== after.workspace.configurationDigest) {
    add('workspace.configurationChanged', 'the migrapilot configuration section changed');
  }
  if (
    before.workspace.workspaceStateDigest !== null &&
    before.workspace.workspaceStateDigest !== after.workspace.workspaceStateDigest
  ) {
    add('workspace.stateChanged', 'extension workspace state changed');
  }

  const beforeOpen = new Set(before.editors.openDocumentUris);
  const afterOpen = new Set(after.editors.openDocumentUris);
  const opened = [...afterOpen].filter((u) => !beforeOpen.has(u));
  const closed = [...beforeOpen].filter((u) => !afterOpen.has(u));
  if (opened.length) add('editors.documentOpened', opened.join(' | '));
  if (closed.length) add('editors.documentClosed', closed.join(' | '));
  if (before.editors.activeDocumentUri !== after.editors.activeDocumentUri) {
    add('editors.activeChanged', `${before.editors.activeDocumentUri ?? 'none'} → ${after.editors.activeDocumentUri ?? 'none'}`);
  }

  // A document that was ALREADY dirty and is still dirty is not a finding — the operator
  // left it that way. A document dirty only afterwards, that existed before, is.
  const newlyDirty = after.editors.dirtyDocumentUris.filter(
    (u) => !before.editors.dirtyDocumentUris.includes(u) && beforeOpen.has(u),
  );
  if (newlyDirty.length) add('editors.preexistingDirtyModified', newlyDirty.join(' | '));

  if (typeof after.host.pendingNotifications === 'number' && after.host.pendingNotifications > 0) {
    add('host.pendingNotificationsRemain', `${after.host.pendingNotifications} notification(s) still open`);
  }

  return effects;
}

/** Union of both baselines' gaps, phrased for the report. */
export function evidenceGaps(before: InteractionBaseline, after: InteractionBaseline): string[] {
  const merged = { ...before.unverifiable, ...after.unverifiable };
  return Object.entries(merged)
    .map(([dimension, reason]) => `${dimension}: ${reason}`)
    .sort();
}
