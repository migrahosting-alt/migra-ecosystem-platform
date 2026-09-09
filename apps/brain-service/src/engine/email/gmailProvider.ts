/**
 * THE GMAIL ADAPTER — the only file that knows Gmail exists.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY. THE WRITE METHODS ARE DELIBERATELY STILL SHELLS.
 *
 * `search`, `readMessage`, `readThread`, `listAttachments` and `readAttachment`
 * talk to Gmail. `createDraft` and `send` do not, and refuse — the product does
 * not hold those scopes, and an adapter that could send while the consent above
 * it says it cannot is one wiring mistake from sending mail nobody approved.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A STATUS CODE IS NOT A FAILURE KIND
 *
 * Every mapping in `#failureFor` is a claim about a different thing — our
 * authorization, our permissions, their mailbox, or Google — and the layers
 * above act on which one it is. Collapsing them into "something went wrong"
 * tells a user to reconnect during a Google outage, which cannot work and
 * destroys a good stored grant on the way.
 *
 * The parsing was complete and tested against synthetic payloads before any of
 * this existed, because that is the part that is wrong in subtle ways.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NOTHING GMAIL-SHAPED LEAVES THIS FILE
 *
 * Its base64url bodies, its `payload.parts` tree, its label ids, its
 * `X-GM-THRID`, its error envelopes — all stop here. Above this, the system
 * knows `EmailProvider`, which is what lets a second provider arrive without
 * Chat learning anything.
 *
 * ---------------------------------------------------------------------------
 * NO PERSONAL MAILBOX DATA
 *
 * Every fixture used to test this is synthetic. A recorded payload from a real
 * inbox would put someone's correspondence in the repository permanently.
 */

import { createHash } from 'node:crypto';

import type {
  EmailAddress,
  EmailAttachment,
  EmailConnection,
  EmailDraft,
  EmailFailure,
  EmailMessage,
  EmailOutcome,
  EmailProvider,
  EmailQuery,
  EmailThread,
} from './types.js';

/** The Gmail message shape, as its API returns it. Not exported. */
interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailConfig {
  /** Present only when an account is linked. Absence is the unconfigured state. */
  accessToken?: string;
  accountAddress?: string;
  scopes?: { read: boolean; draft: boolean; send: boolean };
  /**
   * The transport. Injectable so every status mapping below is provable
   * without a mailbox — the alternative is discovering how we treat a 403
   * during an incident, against someone's real inbox.
   */
  fetch?: typeof globalThis.fetch;
  /** Per-request ceiling. A hung provider must become a timeout, not a hang. */
  timeoutMs?: number;
  /** Base URL. Overridable for tests only; production never sets it. */
  baseUrl?: string;
}

import { EMAIL_NOT_CONFIGURED, EMAIL_RECONNECT, EMAIL_UNAVAILABLE } from './emailReadiness.js';

/*
 * Re-used, not redeclared. These sentences also appear in the hub and on the
 * connection screen; a second copy here would drift, and the drift would show
 * up as a mailbox saying one thing and the row that opened it saying another.
 */
const NOT_CONFIGURED = EMAIL_NOT_CONFIGURED;
const RECONNECT = EMAIL_RECONNECT;
const UNAVAILABLE = EMAIL_UNAVAILABLE;
/** Distinct from an outage: Google is answering, and telling us to slow down. */
const BUSY = 'Email is busy right now. Try again in a moment.';
/** The transport's own response type, taken from fetch rather than the DOM lib. */
type FetchResponse = Awaited<ReturnType<typeof globalThis.fetch>>;

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * How many message fetches are in flight at once during a search.
 *
 * Gmail's list endpoint returns IDS ONLY, so a 20-result search is 1 + 20
 * requests. Unbounded parallelism earns a 429 and reports the mailbox as
 * unavailable when it is fine; serial fetching makes a search feel broken.
 */
const FETCH_CONCURRENCY = 5;

/** What Gmail puts in an error envelope. Read for ONE fact, never surfaced. */
interface GmailErrorEnvelope {
  error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> };
}

/** One header, case-insensitively. Gmail's casing is not guaranteed. */
function header(part: GmailPart | undefined, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return part?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value ?? undefined;
}

/**
 * `Name <a@b.com>, other@c.com` → addresses.
 *
 * Deliberately tolerant: a header we cannot fully parse should yield the
 * addresses we CAN read rather than nothing, because dropping a recipient
 * silently is worse than an imperfect display name.
 */
export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return [];
  const out: EmailAddress[] = [];
  /*
   * Split on commas that are outside BOTH quotes and angle brackets.
   *
   * A regex lookahead handled only the angle brackets and split `"Okafor,
   * James" <j@x>` inside the quoted display name — producing a recipient
   * called "James" and losing the real one. Address headers nest two kinds of
   * delimiter, so this walks them rather than pattern-matching around one.
   */
  const pieces: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === '<' && !inQuotes) inAngle = true;
    else if (char === '>' && !inQuotes) inAngle = false;
    if (char === ',' && !inQuotes && !inAngle) {
      pieces.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  pieces.push(current);

  for (const piece of pieces) {
    const text = piece.trim();
    if (!text) continue;
    const angled = text.match(/^(.*)<([^>]+)>$/);
    if (angled) {
      const name = angled[1]!.trim().replace(/^"|"$/g, '');
      out.push({ address: angled[2]!.trim().toLowerCase(), ...(name ? { name } : {}) });
    } else if (text.includes('@')) {
      out.push({ address: text.toLowerCase() });
    }
  }
  return out;
}

/** Gmail encodes bodies base64url. Undecodable content becomes ABSENT, not garbage. */
export function decodeBody(data: string | undefined): string | undefined {
  if (!data) return undefined;
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

/** Walk the MIME tree for the first part of a type. Gmail nests arbitrarily. */
function findPart(part: GmailPart | undefined, mimeType: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/** Every part that is an attachment: it has a filename and an attachment id. */
/**
 * A stable reference for one attachment within one message.
 *
 * 🚨 DERIVED FROM WHAT DOES NOT CHANGE. Gmail's own attachment id changes on
 * every read, so it is deliberately NOT an input here. Ordinal position,
 * filename, type and size are properties of an immutable message and are
 * identical on every read of it.
 *
 * Hashed rather than concatenated so the value is opaque, fixed-length and safe
 * to put in a URL or a log line — a raw `0|invoice.pdf|application/pdf|27194`
 * would leak a filename into places a filename should not go.
 */
function attachmentRef(ordinal: number, filename: string, mimeType: string, size: number | undefined): string {
  return createHash('sha256')
    .update(`${ordinal}\u0000${filename}\u0000${mimeType}\u0000${size ?? ''}`)
    .digest('hex')
    .slice(0, 24);
}

function collectAttachments(part: GmailPart | undefined, into: EmailAttachment[] = []): EmailAttachment[] {
  if (!part) return into;
  if (part.filename && part.body?.attachmentId) {
    const mimeType = part.mimeType ?? 'application/octet-stream';
    into.push({
      // The ordinal is `into.length` — the position in a deterministic walk.
      ref: attachmentRef(into.length, part.filename, mimeType, part.body.size),
      providerAttachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType,
      ...(part.body.size !== undefined ? { sizeBytes: part.body.size } : {}),
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, into);
  return into;
}

/**
 * Gmail message → Migra message.
 *
 * `bodyComplete` is TRUE only when a real text body was decoded. A `format=
 * metadata` response carries a snippet and no body, and labelling that complete
 * is precisely the failure the flag exists to prevent.
 */
export function toCanonicalMessage(
  raw: GmailMessage,
  retrievedAt: string,
  /**
   * 🚨 DID THIS READ ACTUALLY INSPECT THE MIME TREE?
   *
   * Attachment ids live in `payload.parts`, which a `format=metadata` response
   * does not carry. Defaulting this to true would let every search result claim
   * "no attachments" for messages that have them — which is exactly what this
   * product did until it was measured against a live mailbox.
   *
   * Defaults to FALSE, so a caller that forgets understates what it knows
   * rather than asserting something untrue.
   */
  attachmentsKnown = false,
): EmailMessage | null {
  if (!raw.id || !raw.threadId) return null;

  const textPart = findPart(raw.payload, 'text/plain');
  const htmlPart = findPart(raw.payload, 'text/html');
  const textBody = decodeBody(textPart?.body?.data);
  const htmlBody = decodeBody(htmlPart?.body?.data);

  const from = parseAddressList(header(raw.payload, 'From'))[0];
  /*
   * `internalDate` is epoch milliseconds and is what Gmail sorts by. The `Date`
   * header is sender-supplied and can be wrong or absent, so it is a fallback
   * rather than the source of truth.
   */
  const sentAt = raw.internalDate
    ? new Date(Number(raw.internalDate)).toISOString()
    : (() => {
        const parsed = Date.parse(header(raw.payload, 'Date') ?? '');
        return Number.isNaN(parsed) ? retrievedAt : new Date(parsed).toISOString();
      })();

  return {
    providerMessageId: raw.id,
    providerThreadId: raw.threadId,
    from: from ?? { address: '' },
    to: parseAddressList(header(raw.payload, 'To')),
    cc: parseAddressList(header(raw.payload, 'Cc')),
    subject: header(raw.payload, 'Subject') ?? '',
    sentAt,
    snippet: raw.snippet ?? '',
    ...(textBody ? { textBody } : {}),
    ...(htmlBody ? { htmlBody } : {}),
    bodyComplete: typeof textBody === 'string' && textBody.length > 0,
    attachmentsKnown,
    /*
     * Collected either way, because a partial tree may still carry parts — but
     * the LIST means nothing to a caller until the flag above says so.
     */
    attachments: collectAttachments(raw.payload),
    labels: raw.labelIds ?? [],
    unread: (raw.labelIds ?? []).includes('UNREAD'),
    retrievedAt,
  };
}

/** Migra query → Gmail's search syntax. Its grammar stops here. */
export function toGmailQuery(query: EmailQuery): string {
  const parts: string[] = [];
  if (query.from) parts.push(`from:${query.from}`);
  if (query.to) parts.push(`to:${query.to}`);
  if (query.subjectContains) parts.push(`subject:${query.subjectContains}`);
  if (query.unreadOnly) parts.push('is:unread');
  if (query.hasAttachment) parts.push('has:attachment');
  // Gmail's after/before take YYYY/MM/DD, not RFC-3339.
  if (query.after) parts.push(`after:${query.after.slice(0, 10).replace(/-/g, '/')}`);
  if (query.before) parts.push(`before:${query.before.slice(0, 10).replace(/-/g, '/')}`);
  if (query.keywords) parts.push(query.keywords);
  return parts.join(' ');
}

/**
 * The adapter. Unconfigured today, and honest about it.
 */
export class GmailProvider implements EmailProvider {
  readonly id = 'gmail';

  /*
   * 🚨 AN ES PRIVATE FIELD, NOT A TypeScript `private`.
   *
   * TypeScript's `private` is compile-time only: the field remains an
   * enumerable own property, so `JSON.stringify(provider)` — a logger, an
   * error report, a telemetry payload — serialises the access token in plain
   * text. A test caught exactly that.
   *
   * `#config` is genuinely private at runtime and is not serialised.
   */
  readonly #config: GmailConfig;
  readonly #now: () => number;

  constructor(config: GmailConfig = {}, now: () => number = () => Date.now()) {
    this.#config = config;
    this.#now = now;
  }

  /** Never the token itself, and never the whole config. */
  toJSON(): { id: string; configured: boolean } {
    return { id: this.id, configured: this.configured };
  }

  private get configured(): boolean {
    return typeof this.#config.accessToken === 'string' && this.#config.accessToken.length > 0;
  }

  private unconfigured<T>(): EmailOutcome<T> {
    return {
      ok: false,
      failure: { kind: 'not_configured', detail: NOT_CONFIGURED },
      provider: this.id,
      tookMs: 0,
    };
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  private ok<T>(value: T, startedAt: number): EmailOutcome<T> {
    return { ok: true, value, provider: this.id, tookMs: Math.max(0, this.#now() - startedAt) };
  }

  private fail<T>(failure: EmailFailure, startedAt: number): EmailOutcome<T> {
    return { ok: false, failure, provider: this.id, tookMs: Math.max(0, this.#now() - startedAt) };
  }

  /**
   * What an HTTP status actually MEANS for a mailbox.
   *
   * 🚨 Each branch is a different fact, and the layer above acts on which one.
   * `authorization_expired` sends the user to reconnect; `provider_unavailable`
   * tells them to wait. Getting these the wrong way round during a Google
   * incident means every user is told to re-grant access, which cannot work,
   * and each attempt overwrites a stored grant that was never broken.
   */
  #failureFor(status: number, envelope: GmailErrorEnvelope): EmailFailure {
    const reasons = new Set(
      (envelope.error?.errors ?? [])
        .map((entry) => entry.reason)
        .filter((reason): reason is string => typeof reason === 'string'),
    );

    /*
     * The bearer token was rejected. `resolveAuthorization` minted or refreshed
     * it immediately before this call, so this is the GRANT failing rather than
     * a stale copy of a token — which is exactly what reconnecting fixes.
     */
    if (status === 401) return { kind: 'authorization_expired', detail: RECONNECT };

    if (status === 403) {
      /*
       * 🚨 Gmail overloads 403 across two unrelated facts. Missing scope is
       * ours, and consent fixes it. A rate limit is Google asking us to wait,
       * and answering it with "reconnect your account" sends someone to grant
       * WIDER access to fix a problem that was never about permission.
       */
      if (reasons.has('insufficientPermissions') || reasons.has('accessNotConfigured')) {
        return { kind: 'insufficient_scope', needed: 'read' };
      }
      return { kind: 'provider_unavailable', detail: BUSY };
    }

    /*
     * Gone, or never ours. Both are "not_found": distinguishing them would
     * require telling a caller that a message they cannot read does exist.
     */
    if (status === 404) return { kind: 'not_found' };
    if (status === 429) return { kind: 'provider_unavailable', detail: BUSY };

    /*
     * Every unrecognised 4xx and every 5xx. Deliberately NOT expired: inferring
     * a revoked grant from an unfamiliar status is how a working connection
     * gets thrown away during an outage that had nothing to do with it.
     */
    return { kind: 'provider_unavailable', detail: UNAVAILABLE };
  }

  /**
   * One authorized GET, with a ceiling.
   *
   * The timeout is ours, not the transport's: without it a provider that
   * accepts the connection and never answers holds the request open until
   * something else gives up, and the user sees a hang rather than a fact.
   */
  async #call<T>(path: string): Promise<{ ok: true; value: T } | { ok: false; failure: EmailFailure }> {
    const transport = this.#config.fetch ?? globalThis.fetch;
    const base = this.#config.baseUrl ?? GMAIL_BASE;
    const timeoutMs = this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = this.#now();

    let response: FetchResponse;
    try {
      response = await transport(`${base}${path}`, {
        method: 'GET',
        headers: {
          // Read at the call from the private field; never held anywhere loggable.
          authorization: `Bearer ${this.#config.accessToken ?? ''}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch {
      // Our own ceiling, or the network refused. Different sentences, because
      // one of them is worth retrying immediately and the other is not.
      if (controller.signal.aborted) {
        return { ok: false, failure: { kind: 'provider_timeout', waitedMs: Math.max(0, this.#now() - startedAt) } };
      }
      return { ok: false, failure: { kind: 'provider_unavailable', detail: UNAVAILABLE } };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let envelope: GmailErrorEnvelope = {};
      // An error body is a courtesy, not a guarantee. Its absence must not turn
      // a mapped failure into a thrown one.
      try {
        envelope = (await response.json()) as GmailErrorEnvelope;
      } catch {
        envelope = {};
      }
      return { ok: false, failure: this.#failureFor(response.status, envelope) };
    }

    try {
      return { ok: true, value: (await response.json()) as T };
    } catch {
      // A 200 we cannot parse is not an empty mailbox. Reporting it as one
      // would be the single rule this whole subsystem exists to protect.
      return { ok: false, failure: { kind: 'provider_unavailable', detail: UNAVAILABLE } };
    }
  }

  /**
   * Fetch many messages with a bounded number in flight.
   *
   * 🚨 A message that 404s here is SKIPPED; anything else fails the whole
   * search. The two are different facts: a message deleted between the list and
   * the get genuinely is not in the mailbox any more, while dropping a message
   * we failed to READ would under-report someone's inbox with nothing saying so.
   */
  async #fetchMessages(
    ids: string[],
    format: 'full' | 'metadata',
  ): Promise<{ ok: true; value: EmailMessage[] } | { ok: false; failure: EmailFailure }> {
    const results = new Array<EmailMessage | null>(ids.length);
    let failure: EmailFailure | null = null;
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        if (index >= ids.length || failure) return;
        const outcome = await this.#getMessage(ids[index]!, format);
        if (outcome.ok) {
          results[index] = outcome.value;
        } else if (outcome.failure.kind === 'not_found') {
          results[index] = null;
        } else {
          failure ??= outcome.failure;
          return;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, () => worker()),
    );

    if (failure) return { ok: false, failure };
    // Order is Gmail's relevance order, preserved. The index slots keep it even
    // though the fetches completed out of order.
    return { ok: true, value: results.filter((message): message is EmailMessage => message !== null) };
  }

  async #getMessage(
    id: string,
    format: 'full' | 'metadata',
  ): Promise<{ ok: true; value: EmailMessage } | { ok: false; failure: EmailFailure }> {
    /*
     * `metadata` returns headers and a snippet and NO body, which is precisely
     * what a search result is. Asking for `full` here would make every search
     * claim complete bodies and silently defeat the partiality disclosure.
     */
    const query = format === 'metadata'
      ? '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc'
        + '&metadataHeaders=Subject&metadataHeaders=Date'
      : '?format=full';

    const raw = await this.#call<GmailMessage>(`/messages/${encodeURIComponent(id)}${query}`);
    if (!raw.ok) return raw;

    // `full` inspected the MIME tree; `metadata` did not. That is the whole
    // basis on which attachment presence may be claimed.
    const message = toCanonicalMessage(
      raw.value, new Date(this.#now()).toISOString(), format === 'full',
    );
    if (!message) {
      // A payload without an id or a thread id is not a message we can cite.
      return { ok: false, failure: { kind: 'provider_unavailable', detail: UNAVAILABLE } };
    }
    return { ok: true, value: message };
  }

  /* ---------------------------------------------------------------- *
   * Reading
   * ---------------------------------------------------------------- */

  async health(): Promise<EmailConnection> {
    const checkedAt = new Date(this.#now()).toISOString();
    if (!this.configured) {
      return {
        state: 'not_configured',
        scopes: { read: false, draft: false, send: false },
        reason: NOT_CONFIGURED,
        checkedAt,
      };
    }
    return {
      state: 'connected',
      ...(this.#config.accountAddress ? { account: this.#config.accountAddress } : {}),
      scopes: this.#config.scopes ?? { read: true, draft: false, send: false },
      checkedAt,
    };
  }

  /**
   * Search the mailbox.
   *
   * 🚨 EMPTY IS RETURNED AS EMPTY, never as a failure. `no_results` is a claim
   * about the user's mailbox and only the authority above may make it, from a
   * real answer — which is the difference between "nothing matched" and
   * "nobody looked".
   */
  async search(query: EmailQuery): Promise<EmailOutcome<EmailMessage[]>> {
    if (!this.configured) return this.unconfigured();
    const startedAt = this.#now();

    /*
     * A thread id is not expressible in Gmail's `q` grammar. Passing the rest
     * of the query and dropping it would quietly search the WHOLE mailbox and
     * present the result as that conversation.
     */
    if (query.threadId) {
      const thread = await this.readThread(query.threadId);
      if (!thread.ok) return this.fail(thread.failure, startedAt);
      return this.ok(thread.value.messages.slice(0, query.limit), startedAt);
    }

    const params = new URLSearchParams({ maxResults: String(query.limit) });
    const q = toGmailQuery(query);
    if (q) params.set('q', q);

    const listed = await this.#call<{ messages?: Array<{ id?: string }> }>(`/messages?${params.toString()}`);
    if (!listed.ok) return this.fail(listed.failure, startedAt);

    const ids = (listed.value.messages ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) return this.ok([], startedAt);

    const messages = await this.#fetchMessages(ids.slice(0, query.limit), 'metadata');
    return messages.ok ? this.ok(messages.value, startedAt) : this.fail(messages.failure, startedAt);
  }

  /** One message, complete. This is the call that earns `bodyComplete: true`. */
  async readMessage(providerMessageId: string): Promise<EmailOutcome<EmailMessage>> {
    if (!this.configured) return this.unconfigured();
    const startedAt = this.#now();
    const message = await this.#getMessage(providerMessageId, 'full');
    return message.ok ? this.ok(message.value, startedAt) : this.fail(message.failure, startedAt);
  }

  /**
   * A whole conversation, oldest first.
   *
   * Gmail returns a thread's messages already ordered, but the ordering is
   * re-derived from `internalDate` rather than trusted: everything downstream
   * reads "the last message" as the latest one, and a summary that answered
   * from the wrong end of a thread would read as confidently wrong.
   */
  async readThread(providerThreadId: string): Promise<EmailOutcome<EmailThread>> {
    if (!this.configured) return this.unconfigured();
    const startedAt = this.#now();

    const raw = await this.#call<{ id?: string; messages?: GmailMessage[] }>(
      `/threads/${encodeURIComponent(providerThreadId)}?format=full`,
    );
    if (!raw.ok) return this.fail(raw.failure, startedAt);

    const retrievedAt = new Date(this.#now()).toISOString();
    const messages = (raw.value.messages ?? [])
      // format=full above, so every message in a thread is authoritative.
      .map((message) => toCanonicalMessage(message, retrievedAt, true))
      .filter((message): message is EmailMessage => message !== null)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

    if (messages.length === 0) return this.fail({ kind: 'not_found' }, startedAt);

    return this.ok(
      {
        providerThreadId: raw.value.id ?? providerThreadId,
        // The thread's subject is the one it STARTED with; later replies carry
        // "Re:" prefixes that are not the conversation's name.
        subject: messages[0]!.subject,
        messages,
      },
      startedAt,
    );
  }

  /** What is attached, without fetching any of it. */
  async listAttachments(providerMessageId: string): Promise<EmailOutcome<EmailAttachment[]>> {
    if (!this.configured) return this.unconfigured();
    const startedAt = this.#now();
    /*
     * `full`, not `metadata`: attachment ids live in the MIME tree, and the
     * metadata projection does not carry it. A metadata read here would report
     * every message as having no attachments.
     */
    const message = await this.#getMessage(providerMessageId, 'full');
    return message.ok ? this.ok(message.value.attachments, startedAt) : this.fail(message.failure, startedAt);
  }

  /**
   * The bytes of one attachment.
   *
   * 🚨 The filename and MIME type come from the MESSAGE, not from the caller.
   * Gmail's attachment endpoint returns bytes and a size and nothing else, so a
   * caller-supplied name would let a prompt decide what a downloaded file
   * claims to be.
   */
  async readAttachment(
    providerMessageId: string,
    /** 🚨 OUR stable ref — see EmailAttachment.ref. Never a provider token. */
    attachmentRefValue: string,
  ): Promise<EmailOutcome<{ filename: string; mimeType: string; bytes: Uint8Array }>> {
    if (!this.configured) return this.unconfigured();
    const startedAt = this.#now();

    /*
     * 🚨 THE PROVIDER ID IS TAKEN FROM *THIS* READ, and used immediately.
     *
     * Gmail regenerates it per response, so an id captured by an earlier
     * listing is already dead. Matching on our own ref and then using the id
     * from the same payload is what makes list-then-fetch work at all.
     */
    const message = await this.#getMessage(providerMessageId, 'full');
    if (!message.ok) return this.fail(message.failure, startedAt);

    const attachment = message.value.attachments.find(
      (candidate) => candidate.ref === attachmentRefValue,
    );
    // Not on this message. Reported as not_found rather than fetched anyway:
    // an attachment id is only meaningful against the message that carries it.
    if (!attachment) return this.fail({ kind: 'not_found' }, startedAt);

    const raw = await this.#call<{ data?: string }>(
      `/messages/${encodeURIComponent(providerMessageId)}`
        + `/attachments/${encodeURIComponent(attachment.providerAttachmentId)}`,
    );
    if (!raw.ok) return this.fail(raw.failure, startedAt);
    if (typeof raw.value.data !== 'string') {
      return this.fail({ kind: 'provider_unavailable', detail: UNAVAILABLE }, startedAt);
    }

    return this.ok(
      {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        bytes: new Uint8Array(Buffer.from(raw.value.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      },
      startedAt,
    );
  }

  /* ---------------------------------------------------------------- *
   * 🚨 Writing — still shells, and that is the point
   * ---------------------------------------------------------------- */

  /*
   * The product holds `gmail.readonly` and nothing else. These stay unwritten
   * so that the adapter CANNOT mutate a mailbox even if a caller above it were
   * wired wrongly — the refusal is the absence of an implementation, not a flag
   * somebody can flip. Governance above them refuses first; this is the floor.
   */
  async createDraft(_draft: EmailDraft): Promise<EmailOutcome<{ providerDraftId: string }>> {
    return this.unconfigured();
  }
  async send(_draft: EmailDraft, _key: string): Promise<EmailOutcome<{ providerMessageId: string }>> {
    return this.unconfigured();
  }
}
