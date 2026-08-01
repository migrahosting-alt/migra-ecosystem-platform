// MigraPilot — notification surface for governed Brain outcomes.
//
// Every toast about an operation goes through here so severity, wording and the
// revision stamp are decided once. A command that writes its own success string is
// how "reported done, wasn't" gets reintroduced.
//
// This file holds ONLY the vscode call; the severity decision lives in the
// vscode-free presenter so it can be tested without the editor host.

import * as vscode from 'vscode';

import {
  notificationApiFor,
  presentOutcome,
  type OutcomePresentation,
} from './brainOutcomePresentation.js';
import { unwrap } from './brainClient.js';
import type { BrainOperationOutcome } from './brainTransport.js';

export { notificationApiFor };

/**
 * Show the outcome. Never awaited: a notification promise resolves when the toast is
 * DISMISSED, so awaiting one would block the caller until the user clicks it.
 *
 * The three calls are written out literally rather than dispatched through
 * `vscode.window[api]`. Dynamic dispatch is shorter, but the notification-awaits guard
 * only recognises literal `vscode.window.showXMessage` call sites — a computed one is
 * invisible to it, so a later change from `void` to `await` here would slip through
 * unflagged. Being enforceable is worth three lines.
 */
export function notifyOutcome(p: OutcomePresentation): void {
  const message = `MigraPilot: ${p.text}`;
  switch (notificationApiFor(p)) {
    case 'showInformationMessage':
      void vscode.window.showInformationMessage(message);
      return;
    case 'showErrorMessage':
      void vscode.window.showErrorMessage(message);
      return;
    default:
      void vscode.window.showWarningMessage(message);
  }
}

/**
 * Unwrap a governed outcome, warning the user if it was anything short of a durable
 * success.
 *
 * Preparatory operations (`route`, `retrieve`) are not themselves rendered, so it is
 * tempting to drop their records. That is wrong for a narrower reason than a false
 * success claim: an operation ran, a record was meant to be written, and if the write
 * failed nothing in the UI would ever say so. Each governed operation answers for
 * itself.
 */
export function governedValue<T>(outcome: BrainOperationOutcome<T>): T {
  const value = unwrap(outcome);
  const presented = presentOutcome(outcome);
  if (presented.severity !== 'success') notifyOutcome(presented);
  return value;
}
