/**
 * EXECUTING A MAIL CAPABILITY — against the caller's own mailbox.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT IS SHARED HERE, AND WHAT IS EMPHATICALLY NOT
 *
 * The binding below is module-level mutable state, which is the shape that
 * caused the readiness defect this codebase just fixed. The difference is what
 * it holds:
 *
 *   SHARED, and correctly so   the OAuth client, the sealing key, the store
 *                              handle, the clock. Deployment facts. One per
 *                              process because there IS one per process.
 *
 *   NEVER SHARED               the connection, the account, the tokens. Those
 *                              are resolved per call from the principal the
 *                              executor passed in, and nothing about them is
 *                              retained between calls.
 *
 * A binding that cached a resolved provider would recreate the bug exactly.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NO PRINCIPAL MEANS REFUSE, NOT "TRY ANYWAY"
 *
 * A mailbox read with no principal does not fail safe by accident. It either
 * finds nothing — which would render as "no messages", a claim about a mailbox
 * nobody opened — or it finds whichever connection the code happened to reach.
 * Both are worse than refusing.
 */

import type { ToolHandlerContext } from '../models/capabilityRegistry.js';

import type { MailConnectionStore } from './connectionStore.js';
import { mailProviderFor, type ProviderFactoryDeps } from './providerFactory.js';
import type { RefreshOutcome } from './tokenRefresh.js';
import type { SealKey } from './tokenSealing.js';
import type { EmailFailure, EmailMessage, EmailQuery } from './types.js';

export interface EmailExecutionBinding {
  connections: MailConnectionStore;
  key: SealKey;
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  now(): number;
}

let binding: EmailExecutionBinding | null = null;

/**
 * Install the deployment's mail deps. Called once at boot, and only when the
 * deployment actually has email configured.
 */
export function bindEmailExecution(next: EmailExecutionBinding | null): void {
  binding = next;
}

/** Test seam. Production installs a binding exactly once, at boot. */
export function __emailBindingForTest(): EmailExecutionBinding | null {
  return binding;
}

export type EmailExecutionResult =
  | { ok: true; messages: EmailMessage[] }
  | { ok: false; failure: EmailFailure };

const NOT_CONFIGURED: EmailFailure = { kind: 'not_configured', detail: 'Email is not set up yet.' };

/*
 * 🚨 The refusal for a missing principal is deliberately the same shape a user
 * would see for an unconfigured deployment, and deliberately NOT a crash. An
 * exception here would surface as a 500 on a chat turn; this surfaces as the
 * capability honestly reporting it cannot act.
 */
const NO_PRINCIPAL: EmailFailure = {
  kind: 'refused',
  reason: 'This request did not identify whose email to read.',
};

/**
 * Search the caller's mailbox.
 *
 * Every failure path returns before a provider exists or after the provider
 * itself answered — there is no state in which this holds a credential for
 * someone other than the caller.
 */
export async function executeEmailSearch(
  query: EmailQuery,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailExecutionResult> {
  if (!binding) return { ok: false, failure: NOT_CONFIGURED };

  const principal = ctx?.principal;
  if (!principal) return { ok: false, failure: NO_PRINCIPAL };

  const deps: ProviderFactoryDeps = {
    store: binding.connections,
    key: binding.key,
    exchangeRefresh: binding.refresh,
    now: binding.now,
    providerConfigured: true,
  };

  const resolved = await mailProviderFor({
    scope: { owner: principal.owner, workspace: principal.workspace },
    provider: 'gmail',
    deps,
    // Checked BEFORE a provider is built, so a caller cannot hold one it may
    // not use and discover that only at dispatch.
    needs: 'read',
  });

  if (!resolved.ok) {
    if ('failure' in resolved) return { ok: false, failure: resolved.failure };
    /*
     * Several mailboxes and none chosen. Reported as a refusal with the engine's
     * own words rather than silently picking one — reading the wrong inbox is
     * not a smaller mistake than reading none.
     */
    return {
      ok: false,
      failure: { kind: 'refused', reason: 'Choose which connected email account to search.' },
    };
  }

  const outcome = await resolved.provider.search(query);
  return outcome.ok ? { ok: true, messages: outcome.value } : { ok: false, failure: outcome.failure };
}
