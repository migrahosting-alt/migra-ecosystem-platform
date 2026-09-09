/**
 * MIGRA EMAIL — the authority. Chat above it, a provider below it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS LAYER OWNS
 *
 * Deciding what is TRUE about a mailbox request, in states a person can act on:
 * whether an account is connected, whether the grant still works, whether the
 * provider answered, and whether it found anything. Those are four different
 * facts and the whole file is shaped to keep them apart.
 *
 * ---------------------------------------------------------------------------
 * 🚨 ONLY A REAL ANSWER MAY BECOME "NOTHING FOUND"
 *
 * `no_results` is a claim about the user's mailbox. Every other failure is a
 * claim about US — our configuration, our authorization, our reachability —
 * and reporting one as the other tells someone their inbox is empty when
 * nobody looked. That is the single rule this module exists to enforce, and
 * every early return below is a case where it would otherwise be violated.
 *
 * ---------------------------------------------------------------------------
 * BODY COMPLETENESS TRAVELS
 *
 * A search returns SNIPPETS. `bodyComplete: false` is carried on every message
 * so a summary downstream can say it is working from previews. Losing the flag
 * makes the honest disclosure impossible to write, which is why nothing here
 * ever sets it to true on the caller's behalf.
 */

import type { CapabilityRemedy } from '../models/capabilityRegistry.js';
import type {
  EmailConnection,
  EmailFailure,
  EmailMessage,
  EmailOutcome,
  EmailProvider,
  EmailQuery,
  EmailThread,
} from './types.js';

/** User-facing reasons. Engine-owned, free of provider vocabulary. */
/*
 * Re-exported, not redeclared. These sentences are also the ones the capability
 * hub shows, and two copies would drift — the drift appearing as a hub row
 * disagreeing with the screen it opens.
 */
export {
  EMAIL_NOT_CONFIGURED,
  EMAIL_NOT_CONNECTED,
  EMAIL_RECONNECT,
  EMAIL_UNAVAILABLE,
} from './emailReadiness.js';
import { emailReadinessFor } from './emailReadiness.js';
import {
  EMAIL_NOT_CONFIGURED,
  EMAIL_NOT_CONNECTED,
  EMAIL_RECONNECT,
  EMAIL_UNAVAILABLE,
} from './emailReadiness.js';

export interface EmailAuthorityDeps {
  /** Absent until a provider exists. Absence is a state, not a failure. */
  provider?: EmailProvider | null;
  now?: () => number;
}

/** What the capability registry needs, per operation class. */
export interface EmailReadiness {
  registered: true;
  providerConfigured: boolean;
  accountConnected: boolean;
  readAvailable: boolean;
  sendAvailable: boolean;
  /** Engine's words when something is unavailable. */
  reason?: string;
  /**
   * What the USER can do, as a token rather than prose.
   *
   * 🚨 Present ONLY when the user is the one who can fix it. An unconfigured
   * deployment and an unreachable provider both have reasons and NEITHER has a
   * remedy here — the first belongs to an operator and the second to time.
   * Offering "Connect" for those sends someone to press a control that cannot
   * help, and then to press it again.
   */
  remedy?: CapabilityRemedy;
}

/**
 * A provider exists but its health has not been read yet.
 *
 * Deliberately NOT `not_configured`: the deployment is configured, we simply
 * have not asked. Reporting it as unconfigured would tell an operator to go
 * and set up something that is already set up.
 */
const NOT_YET_CHECKED: EmailConnection = Object.freeze({
  state: 'not_connected',
  scopes: { read: false, draft: false, send: false },
  checkedAt: '',
});

export class MigraEmail {
  private readonly provider: EmailProvider | null;
  private readonly now: () => number;
  private snapshot: { connection: EmailConnection; at: number } | null = null;

  constructor(deps: EmailAuthorityDeps = {}) {
    this.provider = deps.provider ?? null;
    this.now = deps.now ?? (() => Date.now());
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  /**
   * Readiness for the registry — per operation, never one boolean.
   *
   * A single flag would either hide working search when send scope is absent,
   * or promise a send that fails at dispatch. Both are common states for a real
   * Google account, so both must be representable.
   */
  readiness(): EmailReadiness {
    /*
     * 🚨 THE REASON AND THE REMEDY COME FROM ONE MAPPING, shared with the
     * capability hub. Two copies drifted apart the moment they existed, and the
     * drift would show as a hub row disagreeing with the screen it opens.
     *
     * What stays here is only what this object knows and the mapping does not:
     * the per-operation booleans, because read and send are separate
     * capabilities and one flag would either hide working search or promise a
     * send that fails at dispatch.
     */
    const connection = this.provider ? (this.snapshot?.connection ?? NOT_YET_CHECKED) : null;
    const shared = emailReadinessFor(connection);

    const connected =
      connection !== null
      && connection.state !== 'not_connected'
      && connection.state !== 'not_configured';

    return {
      registered: true,
      providerConfigured: this.provider !== null,
      accountConnected: connected,
      readAvailable: shared.ready,
      // Send is reported independently, and is NEVER implied by read.
      sendAvailable: shared.ready && (connection?.scopes.send ?? false),
      ...(shared.reason ? { reason: shared.reason } : {}),
      ...(shared.remedy ? { remedy: shared.remedy } : {}),
    };
  }

  /** Refresh the cached connection. Called on a schedule, never from a render. */
  async refreshConnection(): Promise<EmailConnection> {
    const checkedAt = new Date(this.now()).toISOString();
    if (!this.provider) {
      const connection: EmailConnection = {
        state: 'not_configured',
        scopes: { read: false, draft: false, send: false },
        reason: EMAIL_NOT_CONFIGURED,
        checkedAt,
      };
      this.snapshot = { connection, at: this.now() };
      return connection;
    }
    try {
      const connection = await this.provider.health();
      this.snapshot = { connection, at: this.now() };
      return connection;
    } catch {
      /*
       * A health probe that THREW is a provider not answering. Reported with
       * the engine's words — never the exception's, which would carry a host
       * or an OAuth code into a UI.
       */
      const connection: EmailConnection = {
        state: 'provider_unavailable',
        scopes: { read: false, draft: false, send: false },
        reason: EMAIL_UNAVAILABLE,
        checkedAt,
      };
      this.snapshot = { connection, at: this.now() };
      return connection;
    }
  }

  /**
   * The gate every read operation passes through.
   *
   * Returns a FAILURE when the request must not proceed, so each caller below
   * is a single early return rather than four repeated checks that could drift
   * apart.
   */
  private async gate(need: 'read' | 'send'): Promise<EmailFailure | null> {
    if (!this.provider) return { kind: 'not_configured', detail: EMAIL_NOT_CONFIGURED };
    const connection = await this.refreshConnection();

    if (connection.state === 'not_configured') return { kind: 'not_configured', detail: EMAIL_NOT_CONFIGURED };
    if (connection.state === 'not_connected') return { kind: 'not_connected', detail: EMAIL_NOT_CONNECTED };
    if (connection.state === 'authorization_expired') {
      return { kind: 'authorization_expired', detail: EMAIL_RECONNECT };
    }
    if (connection.state === 'provider_unavailable') {
      return { kind: 'provider_unavailable', detail: EMAIL_UNAVAILABLE };
    }
    if (!connection.scopes[need]) return { kind: 'insufficient_scope', needed: need };
    return null;
  }

  /**
   * Search the mailbox.
   *
   * 🚨 The ONLY path to `no_results` is a provider that answered with an empty
   * list. Every other outcome is a different fact with a different remedy.
   */
  async search(query: EmailQuery): Promise<EmailOutcome<EmailMessage[]>> {
    const started = this.now();
    const tookMs = () => this.now() - started;
    const blocked = await this.gate('read');
    if (blocked) return { ok: false, failure: blocked, provider: this.provider?.id ?? 'none', tookMs: tookMs() };

    try {
      const outcome = await this.provider!.search(query);
      if (!outcome.ok) return outcome;
      /*
       * An empty list from a successful call IS "nothing found" — and it stays
       * an `ok` outcome carrying an empty array rather than becoming a failure,
       * because the caller must be able to say "I looked and there was
       * nothing" distinctly from "I could not look".
       */
      return outcome;
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'provider_unavailable',
          detail: error instanceof Error ? error.message : 'provider threw',
        },
        provider: this.provider!.id,
        tookMs: tookMs(),
      };
    }
  }

  async readMessage(providerMessageId: string): Promise<EmailOutcome<EmailMessage>> {
    const started = this.now();
    const blocked = await this.gate('read');
    if (blocked) {
      return { ok: false, failure: blocked, provider: this.provider?.id ?? 'none', tookMs: this.now() - started };
    }
    try {
      return await this.provider!.readMessage(providerMessageId);
    } catch (error) {
      return {
        ok: false,
        failure: { kind: 'provider_unavailable', detail: error instanceof Error ? error.message : 'provider threw' },
        provider: this.provider!.id,
        tookMs: this.now() - started,
      };
    }
  }

  /**
   * Read a thread, in the order the provider gives, then by time.
   *
   * 🚨 THREAD MEMBERSHIP IS NEVER INFERRED FROM SUBJECT. "Re: invoice" appears
   * on unrelated conversations, and grouping by it would show a user messages
   * from a thread they were not reading — and, worse, could let a reply be
   * addressed to that thread's participants.
   */
  async readThread(providerThreadId: string): Promise<EmailOutcome<EmailThread>> {
    const started = this.now();
    const blocked = await this.gate('read');
    if (blocked) {
      return { ok: false, failure: blocked, provider: this.provider?.id ?? 'none', tookMs: this.now() - started };
    }
    try {
      const outcome = await this.provider!.readThread(providerThreadId);
      if (!outcome.ok) return outcome;
      return {
        ...outcome,
        value: {
          ...outcome.value,
          // Chronological. A provider that returns newest-first would otherwise
          // make a summary describe a conversation backwards.
          messages: [...outcome.value.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
        },
      };
    } catch (error) {
      return {
        ok: false,
        failure: { kind: 'provider_unavailable', detail: error instanceof Error ? error.message : 'provider threw' },
        provider: this.provider!.id,
        tookMs: this.now() - started,
      };
    }
  }
}

/**
 * The process-wide authority, constructed with no provider.
 *
 * That is the accurate state: no Gmail credentials exist, so email is
 * registered and honestly unusable. When a provider is configured, nothing
 * above this line changes.
 */
export const migraEmail = new MigraEmail();
