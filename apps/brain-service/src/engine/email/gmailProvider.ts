/**
 * THE GMAIL ADAPTER — the only file that knows Gmail exists.
 *
 * ---------------------------------------------------------------------------
 * SHELL, NOT INTEGRATION
 *
 * No credentials exist yet, and none are embedded here. With configuration
 * absent this reports `not_configured` truthfully and refuses every operation,
 * which is exactly what the capability's readiness needs in order to say
 * "Email is not set up yet."
 *
 * What IS complete and tested is the PARSING — Gmail's message shape into the
 * Migra contract — because that is the part that will be wrong in subtle ways,
 * and it can be got right against recorded payloads without a mailbox.
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

import type {
  EmailAddress,
  EmailAttachment,
  EmailConnection,
  EmailDraft,
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
}

const NOT_CONFIGURED = 'Email is not set up yet.';

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
function collectAttachments(part: GmailPart | undefined, into: EmailAttachment[] = []): EmailAttachment[] {
  if (!part) return into;
  if (part.filename && part.body?.attachmentId) {
    into.push({
      providerAttachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
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
export function toCanonicalMessage(raw: GmailMessage, retrievedAt: string): EmailMessage | null {
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

  /*
   * Every operation refuses while unconfigured. They are separate methods
   * rather than one guard so that adding a real implementation later is a
   * change to ONE method, and the others keep refusing until they are written.
   */
  async search(_query: EmailQuery): Promise<EmailOutcome<EmailMessage[]>> {
    return this.unconfigured();
  }
  async readMessage(_id: string): Promise<EmailOutcome<EmailMessage>> {
    return this.unconfigured();
  }
  async readThread(_id: string): Promise<EmailOutcome<EmailThread>> {
    return this.unconfigured();
  }
  async listAttachments(_id: string): Promise<EmailOutcome<EmailAttachment[]>> {
    return this.unconfigured();
  }
  async readAttachment(
    _messageId: string,
    _attachmentId: string,
  ): Promise<EmailOutcome<{ filename: string; mimeType: string; bytes: Uint8Array }>> {
    return this.unconfigured();
  }
  async createDraft(_draft: EmailDraft): Promise<EmailOutcome<{ providerDraftId: string }>> {
    return this.unconfigured();
  }
  async send(_draft: EmailDraft, _key: string): Promise<EmailOutcome<{ providerMessageId: string }>> {
    return this.unconfigured();
  }
}
