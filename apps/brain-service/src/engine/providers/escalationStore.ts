// Intelligent Provider Router — Slice 3: escalation offer store.
//
// An escalation OFFER is minted when a local coding turn fails with a defined
// reason and escalation is eligible. It carries a SINGLE-USE token bound to a
// hash of the originating request, so approval can authorize exactly one cloud
// attempt for exactly that request. Nothing external happens until an offer is
// consumed. Offers expire; replay is refused.
//
// © MigraTeck LLC.

import { createHash, randomUUID } from 'node:crypto';
import type { EscalationReason, EscalationTarget } from './escalation.js';

export interface EscalationOffer {
  offerId: string;
  token: string;
  requestHash: string;
  reason: EscalationReason;
  target: EscalationTarget;
  estCostUsd: number;
  /** Consent binds this WORST-CASE cost ceiling — approval is refused if the
   * re-estimated cost exceeds it. */
  costCeilingUsd: number;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_OFFERS = 500;

/** Stable, non-reversible hash binding an offer to its request. */
export function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
}

export type ConsumeResult =
  | { ok: true; offer: EscalationOffer }
  | { ok: false; reason: 'UNKNOWN_OFFER' | 'TOKEN_MISMATCH' | 'REQUEST_MISMATCH' | 'EXPIRED' | 'ALREADY_USED' };

export class EscalationOfferStore {
  private readonly byId = new Map<string, EscalationOffer>();
  private readonly order: string[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  mint(input: { requestHash: string; reason: EscalationReason; target: EscalationTarget; estCostUsd: number; costCeilingUsd: number }): EscalationOffer {
    const at = this.now();
    const offer: EscalationOffer = {
      offerId: `esc_${this.mkId()}`,
      token: `escok_${this.mkId()}`,
      requestHash: input.requestHash,
      reason: input.reason,
      target: input.target,
      estCostUsd: input.estCostUsd,
      costCeilingUsd: input.costCeilingUsd,
      createdAt: at,
      expiresAt: at + this.ttlMs,
      used: false,
    };
    this.byId.set(offer.offerId, offer);
    this.order.push(offer.offerId);
    while (this.order.length > MAX_OFFERS) {
      const evicted = this.order.shift()!;
      this.byId.delete(evicted);
    }
    return offer;
  }

  /** Validate + single-use consume. Binds token AND request hash; refuses replay,
   * expiry, and mismatches. On success the offer is marked used atomically. */
  consume(offerId: string, token: string, requestHash: string): ConsumeResult {
    const offer = this.byId.get(offerId);
    if (!offer) return { ok: false, reason: 'UNKNOWN_OFFER' };
    if (offer.used) return { ok: false, reason: 'ALREADY_USED' };
    if (this.now() > offer.expiresAt) return { ok: false, reason: 'EXPIRED' };
    if (offer.token !== token) return { ok: false, reason: 'TOKEN_MISMATCH' };
    if (offer.requestHash !== requestHash) return { ok: false, reason: 'REQUEST_MISMATCH' };
    offer.used = true; // single-use
    return { ok: true, offer };
  }

  /** Safe metadata view (no token). */
  get(offerId: string): Omit<EscalationOffer, 'token'> | undefined {
    const o = this.byId.get(offerId);
    if (!o) return undefined;
    const { token: _t, ...safe } = o;
    return safe;
  }

  size(): number {
    return this.byId.size;
  }
}
