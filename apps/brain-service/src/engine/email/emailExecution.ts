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
import {
  bridgeAttachment,
  type AttachmentPolicy,
  type BridgeRefusal,
  type CanonicalFileHandoff,
} from './attachmentBridge.js';
import type { EmailAttachmentEvidence } from './evidence.js';
import type {
  EmailAttachment, EmailFailure, EmailMessage, EmailProvider, EmailQuery, EmailThread,
} from './types.js';

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
 * Resolve a provider for the caller, or say why not.
 *
 * 🚨 EVERY OPERATION GOES THROUGH HERE, and every operation resolves FRESH.
 * Nothing is memoised between calls — not the connection, not the account, not
 * the provider. A read that reused a previously resolved provider would keep
 * working after the user disconnected, which is the one thing disconnecting is
 * for.
 */
async function resolveForCaller(
  ctx: ToolHandlerContext | undefined,
  what: string,
): Promise<{ ok: true; provider: EmailProvider } | { ok: false; failure: EmailFailure }> {
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
      failure: { kind: 'refused', reason: `Choose which connected email account to ${what}.` },
    };
  }
  return { ok: true, provider: resolved.provider };
}

/** Search the caller's mailbox. */
export async function executeEmailSearch(
  query: EmailQuery,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailExecutionResult> {
  const resolved = await resolveForCaller(ctx, 'search');
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  const outcome = await resolved.provider.search(query);
  return outcome.ok ? { ok: true, messages: outcome.value } : { ok: false, failure: outcome.failure };
}

export type EmailMessageResult =
  | { ok: true; message: EmailMessage }
  | { ok: false; failure: EmailFailure };

/**
 * Read one message.
 *
 * 🚨 The id comes from the CLIENT, and that is safe only because the provider
 * is the caller's own. A message id is meaningless across mailboxes: resolved
 * against someone else's connection it would be `not_found`, never a read of
 * their mail. The boundary is the connection, not the identifier.
 */
export async function executeEmailReadMessage(
  providerMessageId: string,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailMessageResult> {
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  const outcome = await resolved.provider.readMessage(providerMessageId);
  return outcome.ok ? { ok: true, message: outcome.value } : { ok: false, failure: outcome.failure };
}

export type EmailThreadResult =
  | { ok: true; thread: EmailThread }
  | { ok: false; failure: EmailFailure };

/** Read a whole thread, in order. */
export async function executeEmailReadThread(
  providerThreadId: string,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailThreadResult> {
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  const outcome = await resolved.provider.readThread(providerThreadId);
  return outcome.ok ? { ok: true, thread: outcome.value } : { ok: false, failure: outcome.failure };
}

export type EmailAttachmentListResult =
  | { ok: true; attachments: EmailAttachment[] }
  | { ok: false; failure: EmailFailure };

/** What a message carries, without fetching any of it. */
export async function executeEmailListAttachments(
  providerMessageId: string,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailAttachmentListResult> {
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  const outcome = await resolved.provider.listAttachments(providerMessageId);
  return outcome.ok ? { ok: true, attachments: outcome.value } : { ok: false, failure: outcome.failure };
}

export type EmailAttachmentFetchResult =
  | { ok: true; handoff: CanonicalFileHandoff }
  | { ok: false; failure: EmailFailure }
  /** The bytes arrived but the pipeline will not take them. A different fact. */
  | { ok: false; refusal: BridgeRefusal };

/**
 * Fetch one attachment and hand it to the canonical file pipeline.
 *
 * 🚨 THE ATTACHMENT INHERITS THE MESSAGE'S SCOPE, because it is fetched through
 * the same per-caller provider. There is no path here that takes bytes from
 * anywhere else: an attachment id alone cannot reach a mailbox, and a caller
 * with no connection gets no bytes rather than someone else's.
 *
 * 🚨 THE POLICY IS INJECTED. Allowed types and size limits belong to the file
 * pipeline; restating them here would create a second source of truth that
 * disagrees with the uploader the first time either changes.
 */
export async function executeEmailFetchAttachment(input: {
  evidence: EmailAttachmentEvidence;
  policy: AttachmentPolicy;
  ctx: ToolHandlerContext | undefined;
}): Promise<EmailAttachmentFetchResult> {
  const resolved = await resolveForCaller(input.ctx, 'read');
  if (!resolved.ok) return { ok: false, failure: resolved.failure };

  /*
   * Refused BEFORE the bytes are fetched when the provider already told us the
   * size. Downloading a 200MB file to then refuse it spends the user's time and
   * our memory to reach a conclusion we could have drawn from the listing.
   */
  const declared = input.evidence.sizeBytes;
  if (typeof declared === 'number' && declared > input.policy.maxBytes) {
    return {
      ok: false,
      refusal: { kind: 'too_large', limitBytes: input.policy.maxBytes, actualBytes: declared },
    };
  }

  const outcome = await resolved.provider.readAttachment(
    input.evidence.providerMessageId,
    input.evidence.providerAttachmentId,
  );
  if (!outcome.ok) return { ok: false, failure: outcome.failure };

  const bridged = bridgeDownloadedAttachment({
    evidence: input.evidence,
    downloaded: outcome.value,
    policy: input.policy,
  });

  return bridged.ok
    ? { ok: true, handoff: bridged.handoff }
    : { ok: false, refusal: bridged.refusal };
}

/**
 * Judge what actually arrived.
 *
 * 🚨 THE DOWNLOAD WINS OVER THE LISTING, and this is a separate exported
 * function so that can be tested at all: the Gmail adapter has no HTTP seam
 * yet, so nothing downstream of a successful provider read is otherwise
 * reachable from a test. Extracting it is the difference between a claim and
 * an assertion.
 *
 * Why it matters: a listing is metadata from the sender's side of the world. A
 * message can advertise `notes.txt` and deliver a name — or a size — that the
 * policy would have refused. Re-judging the bytes we hold means the limit is
 * applied to the file, not to a promise about it.
 */
export function bridgeDownloadedAttachment(input: {
  evidence: EmailAttachmentEvidence;
  downloaded: { filename: string; mimeType: string; bytes: Uint8Array };
  policy: AttachmentPolicy;
}) {
  return bridgeAttachment({
    evidence: {
      ...input.evidence,
      filename: input.downloaded.filename,
      mimeType: input.downloaded.mimeType,
    },
    bytes: input.downloaded.bytes,
    policy: input.policy,
  });
}
