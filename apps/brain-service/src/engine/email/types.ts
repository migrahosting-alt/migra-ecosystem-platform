/**
 * MIGRA EMAIL — the contract. Not Gmail's contract. Ours.
 *
 * ---------------------------------------------------------------------------
 * THE GOVERNING RULE, SAME AS SEARCH
 *
 * Gmail is the first provider, not the product. Its message ids, its label
 * vocabulary, its query syntax, its OAuth scopes and its error shapes all stop
 * inside an adapter. Above that, the system knows only `EmailProvider` — which
 * is what lets a second provider arrive later without Chat learning anything
 * new.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE STATE THAT MATTERS MOST HERE: "NOT CONNECTED"
 *
 * Email has a failure mode search does not. A user who has never linked an
 * account is not experiencing an outage, and is not being told the truth by
 * "no messages found" — that sentence asserts something about their mailbox
 * that nobody looked at. It is also not "unavailable", which sends them to
 * wait for a service that is working fine.
 *
 * So connection, authorization and provider health are three separate axes,
 * and each has its own remedy. Collapsing them is the defect this file is
 * shaped to prevent.
 *
 * ---------------------------------------------------------------------------
 * READ AND SEND ARE DIFFERENT CAPABILITIES
 *
 * An account can be connected with read scope and no send scope — a common and
 * entirely reasonable state. A single `available` boolean would either hide
 * working search or promise a send that will be refused at dispatch. So
 * capability is reported per operation class.
 */

/** An address, and the display name when the provider supplied one. */
export interface EmailAddress {
  address: string;
  /** Absent when unknown. Never derived from the local part of the address. */
  name?: string;
}

/** Attachment METADATA. Bytes are fetched separately and only when authorized. */
export interface EmailAttachment {
  /** Provider-scoped identity. Internal — never rendered as user-facing text. */
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  /** Bytes as the provider reports them. Absent when it does not say. */
  sizeBytes?: number;
}

/**
 * One message, canonicalised.
 *
 * `snippet` and `textBody` are deliberately separate. A provider list call
 * returns a snippet — a truncated preview — and summarising that as though it
 * were the message is how a confident summary gets written over three lines of
 * a long thread. `bodyComplete` records which one we actually have.
 */
export interface EmailMessage {
  providerMessageId: string;
  providerThreadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** Only when the caller is authorized to see it; absent otherwise. */
  bcc?: EmailAddress[];
  subject: string;
  /** RFC-3339. From the provider's own header, never the retrieval time. */
  sentAt: string;
  /** A preview, when that is all a list call returned. */
  snippet: string;
  /** The full plain-text body. Absent when only a snippet was fetched. */
  textBody?: string;
  htmlBody?: string;
  /**
   * 🚨 Whether `textBody` is the WHOLE message.
   *
   * False means a summary must say it is working from a preview. Without this
   * flag the two are indistinguishable downstream, and the honest disclosure
   * becomes impossible to make.
   */
  bodyComplete: boolean;
  /**
   * 🚨 Whether ATTACHMENT PRESENCE WAS ACTUALLY DETERMINED.
   *
   * Attachment ids live in the provider's MIME tree, and a metadata read does
   * not carry one — so a search result's `attachments` array is empty whether
   * the message has none or has five. An empty array is a CLAIM, and that claim
   * was false on every search this product has ever run.
   *
   * Three states, deliberately, because two cannot express the difference:
   *
   *   attachmentsKnown: false                  presence is UNKNOWN — say nothing
   *   attachmentsKnown: true,  attachments: [] inspection PROVED none
   *   attachmentsKnown: true,  attachments: [] inspection PROVED these
   *
   * Absence of the flag was rejected as the design: a missing field also means
   * "old client", "serialisation bug" or "not requested", and the caller is
   * left inferring semantics from field presence. `bodyComplete` already
   * settled this argument for bodies — unknown must be EXPLICIT.
   *
   * 🚨 NOBODY MAY PROMOTE UNKNOWN TO EMPTY. Reading `attachments.length === 0`
   * without checking this flag is the defect, not a shortcut around it.
   */
  attachmentsKnown: boolean;
  /**
   * What was found. Meaningless — NOT "none" — while `attachmentsKnown` is
   * false; it is empty there only because there is nothing to report yet.
   */
  attachments: EmailAttachment[];
  /** Provider labels/folders, passed through. Meaning varies by provider. */
  labels: string[];
  unread: boolean;
  retrievedAt: string;
}

/** A thread, in provider order — never re-sorted by subject or guessed time. */
export interface EmailThread {
  providerThreadId: string;
  subject: string;
  messages: EmailMessage[];
}

/**
 * Deterministic search criteria.
 *
 * A structured object rather than a query string, so the planner's intent is
 * inspectable and the adapter's translation is testable. A string would make
 * every provider's syntax leak upward the moment one of them differed.
 */
export interface EmailQuery {
  from?: string;
  to?: string;
  subjectContains?: string;
  /** Free text across subject and body, as the provider supports it. */
  keywords?: string;
  /** Inclusive RFC-3339 date bounds. */
  after?: string;
  before?: string;
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  /** Narrow to one thread. */
  threadId?: string;
  limit: number;
}

/* ------------------------------------------------------------------ *
 * Connection, authorization, health — three axes, never one boolean
 * ------------------------------------------------------------------ */

export type EmailConnectionState =
  /** No provider is configured for this deployment at all. */
  | 'not_configured'
  /** A provider exists; this user has not linked an account. */
  | 'not_connected'
  /** Linked, and the stored authorization still works. */
  | 'connected'
  /**
   * Linked, but the grant no longer works — expired, or revoked by the user in
   * their Google account. DIFFERENT from `not_connected`: they did connect, and
   * the remedy is to reconnect rather than to start from nothing.
   */
  | 'authorization_expired'
  /** Connected and authorized; the provider itself is not answering. */
  | 'provider_unavailable';

/** What a connected account may actually do. Per operation class, not global. */
export interface EmailScopes {
  read: boolean;
  /** Provider-side draft creation. May be absent while read works. */
  draft: boolean;
  send: boolean;
}

export interface EmailConnection {
  state: EmailConnectionState;
  /**
   * The connected address, for display. Present only when connected — showing
   * a stale address after revocation would imply access we no longer have.
   */
  account?: string;
  scopes: EmailScopes;
  /**
   * The engine's own words when something is wrong. Never a provider error
   * string, never an OAuth code: those describe the machinery to someone who
   * asked about their mail.
   */
  reason?: string;
  checkedAt: string;
}

/* ------------------------------------------------------------------ *
 * Failure — enumerated, because these are different facts
 * ------------------------------------------------------------------ */

export type EmailFailure =
  | { kind: 'not_configured'; detail: string }
  | { kind: 'not_connected'; detail: string }
  | { kind: 'authorization_expired'; detail: string }
  /** The grant is valid but lacks the scope this operation needs. */
  | { kind: 'insufficient_scope'; needed: keyof EmailScopes }
  | { kind: 'provider_unavailable'; detail: string }
  | { kind: 'provider_timeout'; waitedMs: number }
  /** The provider answered and there was genuinely nothing. */
  | { kind: 'no_results' }
  /** A message or thread that does not exist, or is not ours to read. */
  | { kind: 'not_found' }
  /** The engine declined before dispatching. */
  | { kind: 'refused'; reason: string };

export type EmailOutcome<T> =
  | { ok: true; value: T; provider: string; tookMs: number }
  | { ok: false; failure: EmailFailure; provider: string; tookMs: number };

/* ------------------------------------------------------------------ *
 * Drafting and sending
 * ------------------------------------------------------------------ */

/**
 * A composed message, before anything has happened to it.
 *
 * 🚨 A DRAFT IS NOT A SEND, AND LOCAL COMPOSITION IS NOT A PROVIDER DRAFT.
 *
 * Three distinct things get called "draft" and only the first has no side
 * effect:
 *
 *   composed   held by us, nothing has left the process
 *   stored     written into the user's Drafts folder — a MUTATION of their
 *              mailbox, visible on their phone, and governed accordingly
 *   sent       irreversible
 *
 * Blurring the first two means a user who asked to "draft a reply" finds
 * something in their Drafts they did not put there.
 */
export interface EmailDraft {
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  body: string;
  /**
   * Provider ids for correct threading. Set when replying or forwarding.
   *
   * 🚨 Threading is NEVER inferred from subject text. "Re: invoice" appears on
   * unrelated conversations, and guessing would attach a reply to a stranger's
   * thread.
   */
  inReplyToMessageId?: string;
  threadId?: string;
}

/** The interface every provider implements. Gmail is one of them. */
export interface EmailProvider {
  readonly id: string;
  health(): Promise<EmailConnection>;
  search(query: EmailQuery): Promise<EmailOutcome<EmailMessage[]>>;
  readMessage(providerMessageId: string): Promise<EmailOutcome<EmailMessage>>;
  readThread(providerThreadId: string): Promise<EmailOutcome<EmailThread>>;
  listAttachments(providerMessageId: string): Promise<EmailOutcome<EmailAttachment[]>>;
  /** Bytes, for the canonical document pipeline. Authorized per call. */
  readAttachment(
    providerMessageId: string,
    providerAttachmentId: string,
  ): Promise<EmailOutcome<{ filename: string; mimeType: string; bytes: Uint8Array }>>;
  /** Writes into the user's Drafts. A MUTATION — see `EmailDraft`. */
  createDraft(draft: EmailDraft): Promise<EmailOutcome<{ providerDraftId: string }>>;
  /** Irreversible. Governed by consent + durable idempotency above this layer. */
  send(draft: EmailDraft, idempotencyKey: string): Promise<EmailOutcome<{ providerMessageId: string }>>;
}
