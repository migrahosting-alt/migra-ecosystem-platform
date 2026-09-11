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

import {
  resolveFilePolicy,
  type FilePipelineConfig,
} from '@migrapilot/shared-types/file-policy';

import type { ToolHandlerContext } from '../models/capabilityRegistry.js';

import type { MailConnectionStore } from './connectionStore.js';
import { mailProviderFor, type ProviderFactoryDeps } from './providerFactory.js';
import type { RefreshOutcome } from './tokenRefresh.js';
import type { SealKey } from './tokenSealing.js';
import type { EmailEventOutcome, EmailStage, EmailTelemetrySink } from './telemetry.js';
import {
  bridgeAttachment,
  type AttachmentPolicy,
  type BridgeRefusal,
  type CanonicalFileHandoff,
} from './attachmentBridge.js';
import {
  attachmentEvidence, messageEvidence, summariseFrom, threadEvidence,
  type EmailAttachmentEvidence, type EmailMessageEvidence,
} from './evidence.js';
import {
  renderSummary, summaryContextFrom, summaryInstructions, summaryMaterial,
} from './emailSummary.js';
import type {
  EmailAttachment, EmailFailure, EmailMessage, EmailProvider, EmailQuery, EmailThread,
} from './types.js';

export interface EmailExecutionBinding {
  connections: MailConnectionStore;
  key: SealKey;
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  now(): number;
  /**
   * Where measurements go. Optional, and dropped when absent.
   *
   * 🚨 Wrapped in `guarded` by the installer, so an unsafe event never reaches
   * a sink and a broken metrics backend never breaks a mailbox read. Telemetry
   * that can fail an operation is worse than no telemetry.
   */
  telemetry?: EmailTelemetrySink;
  /**
   * The file pipeline's deployment configuration — NOT a policy.
   *
   * 🚨 THE POLICY IS DERIVED, PER CALLER, BY THE CANONICAL RESOLVER. Holding a
   * resolved policy here would freeze it at boot and put a second copy of the
   * answer in this process; accepting one from a caller would let a prompt
   * choose its own limits. Configuration is the only thing a deployment owns.
   */
  filePipeline: FilePipelineConfig;
  /**
   * Turn grounded material into prose.
   *
   * 🚨 IT RECEIVES TEXT, AND ONLY TEXT. No provider, no connection, no
   * credential, no principal — the summariser cannot reach a mailbox even by
   * accident, because it is handed the finished material and nothing to fetch
   * with. Everything it may state has already been resolved, scoped and
   * completeness-checked by the caller below.
   *
   * Absent means the deployment cannot summarise, and `op: summarize` refuses
   * saying so. A summary invented without a generator would be the confident
   * fabrication this whole layer exists to prevent.
   */
  generateSummary?(input: { instructions: string; material: string }): Promise<string>;
  /** Provider transport. Production leaves it unset; tests decide the answers. */
  transport?: typeof globalThis.fetch;
  providerBaseUrl?: string;
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
): Promise<
  | { ok: true; provider: EmailProvider; principal: { owner: string; workspace: string } }
  | { ok: false; failure: EmailFailure }
> {
  if (!binding) return { ok: false, failure: NOT_CONFIGURED };

  const principal = ctx?.principal;
  if (!principal) return { ok: false, failure: NO_PRINCIPAL };

  const deps: ProviderFactoryDeps = {
    store: binding.connections,
    key: binding.key,
    exchangeRefresh: binding.refresh,
    now: binding.now,
    providerConfigured: true,
    ...(binding.transport ? { transport: binding.transport } : {}),
    ...(binding.providerBaseUrl ? { providerBaseUrl: binding.providerBaseUrl } : {}),
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
  return {
    ok: true,
    provider: resolved.provider,
    // Carried out so the file policy can be resolved for THIS caller rather
    // than from ambient state — the identity is already proven here.
    principal: { owner: principal.owner, workspace: principal.workspace },
  };
}

/**
 * Record one operation.
 *
 * 🚨 SHAPES, NOT CONTENT. The event carries a stage, an outcome, a duration and
 * a count — never a subject, an address, a query or a message id. Metrics are
 * retained longer and read more widely than the mailbox itself, so a label
 * carrying content turns monitoring into a partial mirror of someone's mail.
 *
 * The COUNT is deliberately included: "search returned 0" and "search failed"
 * are different operational facts, and without the count they look identical
 * on a dashboard.
 */
function record(stage: EmailStage, startedAt: number, outcome: EmailEventOutcome, count?: number): void {
  const sink = binding?.telemetry;
  if (!sink) return;
  sink({
    stage,
    outcome,
    provider: 'gmail',
    durationMs: Math.max(0, (binding?.now() ?? startedAt) - startedAt),
    ...(count !== undefined ? { count } : {}),
  });
}

/** A failure's kind IS its outcome. One vocabulary, so the dashboard and the
 *  product cannot disagree about what happened. */
const outcomeOf = (failure: EmailFailure): EmailEventOutcome => failure.kind as EmailEventOutcome;

/** Search the caller's mailbox. */
export async function executeEmailSearch(
  query: EmailQuery,
  ctx: ToolHandlerContext | undefined,
): Promise<EmailExecutionResult> {
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(ctx, 'search');
  if (!resolved.ok) {
    record('search', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  const outcome = await resolved.provider.search(query);
  if (!outcome.ok) {
    record('search', startedAt, outcomeOf(outcome.failure));
    return { ok: false, failure: outcome.failure };
  }
  record('search', startedAt, 'ok', outcome.value.length);
  return { ok: true, messages: outcome.value };
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
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) {
    record('read_message', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  const outcome = await resolved.provider.readMessage(providerMessageId);
  record('read_message', startedAt, outcome.ok ? 'ok' : outcomeOf(outcome.failure), outcome.ok ? 1 : undefined);
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
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) {
    record('read_thread', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  const outcome = await resolved.provider.readThread(providerThreadId);
  record(
    'read_thread', startedAt,
    outcome.ok ? 'ok' : outcomeOf(outcome.failure),
    outcome.ok ? outcome.value.messages.length : undefined,
  );
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
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(ctx, 'read');
  if (!resolved.ok) {
    record('attachment_list', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  const outcome = await resolved.provider.listAttachments(providerMessageId);
  record(
    'attachment_list', startedAt,
    outcome.ok ? 'ok' : outcomeOf(outcome.failure),
    outcome.ok ? outcome.value.length : undefined,
  );
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
  ctx: ToolHandlerContext | undefined;
}): Promise<EmailAttachmentFetchResult> {
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(input.ctx, 'read');
  if (!resolved.ok) {
    record('attachment_read', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  /*
   * 🚨 THE POLICY IS RESOLVED HERE, FROM THE CANONICAL AUTHORITY, FOR THIS
   * PRINCIPAL — it is not a parameter, and there is no seam to substitute one.
   *
   * It used to be an input, which meant whoever called this chose the limits.
   * The rules now live in one implementation that the consumer's upload path
   * calls too, so an attachment accepted by email is accepted by upload and
   * refused the same way, by construction rather than by two teams agreeing.
   */
  const policy = resolveFilePolicy({
    config: binding!.filePipeline,
    principal: {
      principalId: resolved.principal.owner,
      workspaceId: resolved.principal.workspace,
    },
  });

  /*
   * Refused BEFORE the bytes are fetched when the provider already told us the
   * size. Downloading a 200MB file to then refuse it spends the user's time and
   * our memory to reach a conclusion we could have drawn from the listing.
   */
  const declared = input.evidence.sizeBytes;
  if (typeof declared === 'number' && declared > policy.maxBytes) {
    record('attachment_read', startedAt, 'refused');
    return {
      ok: false,
      refusal: { kind: 'too_large', limitBytes: policy.maxBytes, actualBytes: declared },
    };
  }

  const outcome = await resolved.provider.readAttachment(
    input.evidence.providerMessageId,
    // Our ref, not the provider's ephemeral id.
    input.evidence.ref,
  );
  if (!outcome.ok) {
    record('attachment_read', startedAt, outcomeOf(outcome.failure));
    return { ok: false, failure: outcome.failure };
  }

  const bridged = bridgeDownloadedAttachment({
    evidence: input.evidence,
    downloaded: outcome.value,
    policy,
  });

  record('attachment_read', startedAt, bridged.ok ? 'ok' : 'refused', bridged.ok ? 1 : undefined);
  return bridged.ok
    ? { ok: true, handoff: bridged.handoff }
    : { ok: false, refusal: bridged.refusal };
}

/**
 * Judge what actually arrived.
 *
 * 🚨 THE DOWNLOAD WINS OVER THE LISTING. Exported separately so the rule can
 * be asserted directly on bytes, without standing up a provider to reach it.
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

/* ------------------------------------------------------------------ *
 * 🚨 Ingestion — the caller names ids, and nothing else
 * ------------------------------------------------------------------ */

/**
 * Fetch one attachment by id and hand it to the canonical file pipeline.
 *
 * 🚨 THE CALLER SUPPLIES TWO IDS. NOT a filename, not a MIME type, not a size,
 * and not a policy.
 *
 * `executeEmailFetchAttachment` takes an evidence object, which is right for a
 * server that already read the message — and catastrophic as a capability
 * input, because a prompt could then describe an attachment rather than name
 * one. Provenance would record whatever it claimed, and a downstream citation
 * would repeat it.
 *
 * So the evidence is DERIVED here, from a message this caller's own connection
 * just returned. The two ids are the only thing that crosses the boundary, and
 * an id that is not on that message is a refusal rather than a fetch.
 */
export async function executeEmailIngestAttachment(input: {
  providerMessageId: string;
  /** 🚨 OUR stable ref, from a listing. A provider token would already be dead. */
  attachmentRef: string;
  ctx: ToolHandlerContext | undefined;
}): Promise<EmailAttachmentFetchResult> {
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(input.ctx, 'read');
  if (!resolved.ok) {
    record('attachment_read', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  /*
   * Read through the SAME per-caller provider the bytes will come from. Taking
   * the message from anywhere else would let the attachment inherit a scope the
   * message never had.
   */
  const message = await resolved.provider.readMessage(input.providerMessageId);
  if (!message.ok) {
    record('attachment_read', startedAt, outcomeOf(message.failure));
    return { ok: false, failure: message.failure };
  }

  const attachment = message.value.attachments.find(
    (candidate) => candidate.ref === input.attachmentRef,
  );
  if (!attachment) {
    // Named something this message does not carry. Reported as not_found rather
    // than fetched anyway: an attachment id means nothing apart from its message.
    record('attachment_read', startedAt, 'not_found');
    return { ok: false, failure: { kind: 'not_found' } };
  }

  return executeEmailFetchAttachment({
    evidence: attachmentEvidence(attachment, messageEvidence(message.value, 'gmail')),
    ctx: input.ctx,
  });
}

/* ------------------------------------------------------------------ *
 * 🚨 Summarisation — orchestration over canonical evidence
 * ------------------------------------------------------------------ */

/** What a summary hands back. Provenance is part of the answer, not a footnote. */
export type EmailSummarizeResult =
  | {
      ok: true;
      summary: string;
      /** False when any source was a preview; the disclosure is already in `summary`. */
      complete: boolean;
      /** 🚨 Every message the summary was built from. A claim with no source here has no basis. */
      sources: Array<{
        evidenceId: string;
        providerMessageId: string;
        providerThreadId: string;
        from: string;
        subject: string;
        sentAt: string;
        completeness: 'complete' | 'snippet';
        /**
         * 🚨 WHAT WAS ACTUALLY READ — a preview or the whole body.
         *
         * Dropped from this result until now, which quietly made the grounded
         * summariser useless. A summary may support only what its sources
         * support; with the sources reduced to headers, it could support
         * nothing about a body, so every content summary was struck out. The
         * rule was right and the sources were impoverished.
         */
        text: string;
      }>;
    }
  | { ok: false; failure: EmailFailure }
  | { ok: false; refusal: { kind: string; detail: string } };

/**
 * Summarise the caller's own mail.
 *
 * ---------------------------------------------------------------------------
 * 🚨 ORCHESTRATION, NOT A PROVIDER FEATURE
 *
 * principal → connection → read through the canonical provider → evidence →
 * completeness → prose → provenance. The provider is never told a summary is
 * happening, and the summariser is never given anything it could fetch with.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A FAILURE TO READ CANNOT BECOME A CONFIDENT SUMMARY
 *
 * Every read failure returns before any material exists, and an empty result
 * returns `no_results` rather than a summary of nothing. "Nobody looked" and
 * "there was nothing to say" are different facts, and prose erases the
 * difference — a summariser handed zero messages writes a fluent paragraph
 * about an empty inbox that nobody actually opened.
 */
export async function executeEmailSummarize(input: {
  threadId?: string;
  messageId?: string;
  keywords?: string;
  limit?: number;
  ctx: ToolHandlerContext | undefined;
}): Promise<EmailSummarizeResult> {
  const startedAt = binding?.now() ?? 0;
  const resolved = await resolveForCaller(input.ctx, 'summarise');
  if (!resolved.ok) {
    record('summarize', startedAt, outcomeOf(resolved.failure));
    return { ok: false, failure: resolved.failure };
  }

  /*
   * Scope is resolved to MESSAGES first, through the same per-caller provider
   * every other read uses. There is no summarise-only path to a mailbox.
   */
  let messages: EmailMessage[];
  let thread: EmailThread | null = null;

  if (input.threadId) {
    const outcome = await resolved.provider.readThread(input.threadId);
    if (!outcome.ok) {
      record('summarize', startedAt, outcomeOf(outcome.failure));
      return { ok: false, failure: outcome.failure };
    }
    thread = outcome.value;
    messages = outcome.value.messages;
  } else if (input.messageId) {
    const outcome = await resolved.provider.readMessage(input.messageId);
    if (!outcome.ok) {
      record('summarize', startedAt, outcomeOf(outcome.failure));
      return { ok: false, failure: outcome.failure };
    }
    messages = [outcome.value];
  } else {
    const outcome = await resolved.provider.search({
      ...(input.keywords ? { keywords: input.keywords } : {}),
      limit: input.limit ?? 20,
    });
    if (!outcome.ok) {
      record('summarize', startedAt, outcomeOf(outcome.failure));
      return { ok: false, failure: outcome.failure };
    }
    messages = outcome.value;
  }

  if (messages.length === 0) {
    // A real answer, and it was empty. Reported as such rather than summarised.
    record('summarize', startedAt, 'no_results');
    return { ok: false, failure: { kind: 'no_results' } };
  }

  const evidence: EmailMessageEvidence[] = messages.map((m) => messageEvidence(m, 'gmail'));

  /*
   * 🚨 THE SOURCE SET IS BUILT FROM WHAT WAS RETRIEVED, and a thread summary is
   * bounded to that thread's own messages — the realistic violation being a
   * real message from elsewhere presented as part of the conversation.
   */
  const built = summariseFrom({
    sourceIds: evidence.map((e) => e.id),
    available: evidence,
    ...(thread ? { thread: threadEvidence(thread, evidence) } : {}),
  });
  if (!built.ok) {
    record('summarize', startedAt, 'refused');
    return { ok: false, refusal: built.refusal };
  }

  const context = summaryContextFrom({ evidence: built.evidence, available: evidence });
  if (!context.ok) {
    record('summarize', startedAt, 'refused');
    return { ok: false, refusal: context.refusal };
  }

  const generate = binding?.generateSummary;
  if (!generate) {
    record('summarize', startedAt, 'not_configured');
    return {
      ok: false,
      refusal: { kind: 'no_summariser', detail: 'MigraPilot cannot write summaries on this deployment yet.' },
    };
  }

  let prose: string;
  try {
    prose = await generate({
      instructions: summaryInstructions(context.context),
      material: summaryMaterial(context.context),
    });
  } catch {
    // A generator that failed is unavailability, NOT an empty summary.
    record('summarize', startedAt, 'provider_unavailable');
    return {
      ok: false,
      failure: { kind: 'provider_unavailable', detail: 'Email is unavailable right now.' },
    };
  }

  record('summarize', startedAt, 'ok', evidence.length);
  return {
    ok: true,
    // 🚨 The disclosure is ATTACHED here, whatever the model wrote.
    summary: renderSummary(prose, context.context),
    complete: context.context.complete,
    sources: evidence.map((e) => ({
      evidenceId: e.id,
      providerMessageId: e.providerMessageId,
      providerThreadId: e.providerThreadId,
      from: e.from,
      subject: e.subject,
      sentAt: e.sentAt,
      completeness: e.completeness,
      text: e.text,
    })),
  };
}
