// Intelligent Provider Router — Slice 5: cloud escalation consent flow.
//
// The ONLY way the extension approves a cloud attempt. It shows the server-issued
// offer verbatim and submits ONLY the offer reference. Nothing is approved
// silently: only an explicit "Approve once" triggers a cloud call. Decline / Stay
// local / a malformed or expired offer perform ZERO cloud calls. The UI is
// injected so this is unit-testable without `vscode`.
//
// © MigraTeck LLC.

import type { EscalationApproveResult } from './providerRouterClient.js';
import { escalationCardContent, offerIsApprovable, failureView, OFFER_EXPIRED_MESSAGE, type EscalationCard, type EscalationOfferView } from '../panel/providerRouterViewModel.js';

export interface ConsentUi {
  /** Present the consent card; resolve with the chosen action or undefined (dismissed). */
  pickAction(card: EscalationCard): Promise<'Approve once' | 'Decline' | 'Stay local' | undefined>;
  info(message: string): void;
  error(message: string): void;
}

export interface ConsentClient {
  approveEscalation(offerId: string, token: string, request: unknown): Promise<EscalationApproveResult>;
}

export type ConsentOutcome =
  | { kind: 'invalid' }
  | { kind: 'declined' }
  | { kind: 'approved'; result: EscalationApproveResult };

/** A registered dispatcher lets deep stream consumers (engineer/chat) trigger the
 * consent modal, which lives where `vscode` + the client are available. `render`
 * lets the handler append the approved cloud result into the response. */
export type EscalationDispatch = (offer: unknown, render: (markdown: string) => void) => Promise<void>;
let dispatch: EscalationDispatch | undefined;
export function setEscalationDispatch(d: EscalationDispatch | undefined): void {
  dispatch = d;
}
export function getEscalationDispatch(): EscalationDispatch | undefined {
  return dispatch;
}

export async function runEscalationConsent(offer: EscalationOfferView | undefined, client: ConsentClient, ui: ConsentUi): Promise<ConsentOutcome> {
  // A malformed / partial / expired offer must never be actionable.
  if (!offerIsApprovable(offer)) {
    ui.error(OFFER_EXPIRED_MESSAGE);
    return { kind: 'invalid' };
  }
  const o = offer!;
  const action = await ui.pickAction(escalationCardContent(o));
  if (action !== 'Approve once') {
    // Decline / Stay local / dismissed → ZERO cloud calls.
    return { kind: 'declined' };
  }
  const result = await client.approveEscalation(o.offerId, o.token, o.request);
  if (!result.ok) {
    const f = failureView(result.code);
    ui.error(`${f.message} (${f.code})`);
    return { kind: 'approved', result };
  }
  ui.info(`Cloud fallback used: ${result.escalation?.provider ?? '?'} · ${result.escalation?.model ?? '?'}`);
  return { kind: 'approved', result };
}
