/**
 * The claim ledger.
 *
 * WHY HISTORY IS THE POINT. Over one long run, several confident conclusions
 * were later disproven by better sampling — a wardrobe "systematic failure" that
 * was two samples, a detector whose clean result meant nothing because it never
 * examined fixed-position elements, a measurement whose dramatic number was an
 * artefact of the metric's own edge case. In each case the correction only stuck
 * because someone remembered the original claim was wrong.
 *
 * A store that only holds current state forgets that. This one records every
 * transition, keeps withdrawn and superseded claims in place, and links a
 * replacement to what it replaced — so the system remembers not only what it
 * believes but what it stopped believing, and why.
 *
 * Deliberately in-memory and serialisable. Persistence is the caller's business;
 * hard-wiring a database here would make the primitive unusable in the places
 * that need it most, which are scripts and one-off probes.
 */

import type { ClaimStatus, Evidence } from './evidence.js';
import { transition, type PromotionOptions, type Refusal } from './transition.js';

export interface LedgerEntry {
  at: string;
  from: ClaimStatus;
  to: ClaimStatus;
  /** Present when the machine refused the move. */
  refusals?: Refusal[];
  /** The evidence as it stood at this moment. */
  evidence: Evidence;
  note?: string;
}

export interface Claim {
  id: string;
  status: ClaimStatus;
  evidence: Evidence;
  history: LedgerEntry[];
  /** Set when this claim replaced another. */
  supersedes?: string;
  /** Set when another claim replaced this one. */
  supersededBy?: string;
}

export class ClaimLedger {
  private readonly claims = new Map<string, Claim>();

  /** Open a claim. Always starts at INTENT — nothing is proven on arrival. */
  open(id: string, evidence: Evidence, note?: string): Claim {
    if (this.claims.has(id)) {
      throw new Error(`Claim ${id} already exists. Supersede it rather than overwriting.`);
    }
    const claim: Claim = {
      id,
      status: 'INTENT',
      evidence,
      history: [
        { at: new Date().toISOString(), from: 'INTENT', to: 'INTENT', evidence, ...(note ? { note } : {}) },
      ],
    };
    this.claims.set(id, claim);
    return claim;
  }

  get(id: string): Claim | undefined {
    return this.claims.get(id);
  }

  all(): Claim[] {
    return [...this.claims.values()];
  }

  /**
   * Attempt to move a claim.
   *
   * A REFUSAL IS RECORDED, NOT DISCARDED. Knowing that promotion was tried and
   * rejected — and on what grounds — is what stops the same unevidenced claim
   * being quietly re-attempted until it slips through.
   */
  advance(
    id: string,
    to: ClaimStatus,
    evidence: Evidence,
    options: PromotionOptions = {},
    note?: string,
  ): { ok: boolean; claim: Claim; refusals: Refusal[] } {
    const claim = this.mustGet(id);
    const result = transition(claim.status, to, evidence, options);

    const entry: LedgerEntry = {
      at: new Date().toISOString(),
      from: claim.status,
      to: result.ok ? to : 'REFUSED',
      evidence,
      ...(result.ok ? {} : { refusals: result.refusals }),
      ...(note ? { note } : {}),
    };
    claim.history.push(entry);
    claim.evidence = evidence;

    if (result.ok) {
      claim.status = to;
      return { ok: true, claim, refusals: [] };
    }

    /*
     * The claim does NOT become REFUSED just because one promotion failed —
     * that would erase a legitimately OBSERVED result the moment someone
     * over-reached. The attempt is in the history; the standing status holds.
     */
    return { ok: false, claim, refusals: result.refusals };
  }

  /**
   * Retract a claim that turned out to be wrong.
   *
   * The original evidence stays exactly where it is. The point of a withdrawal
   * is to record that something was believed and is no longer — deleting the
   * evidence would destroy the only proof the mistake happened.
   */
  withdraw(id: string, reason: string, supersededBy?: string): Claim {
    const claim = this.mustGet(id);
    claim.history.push({
      at: new Date().toISOString(),
      from: claim.status,
      to: 'WITHDRAWN',
      evidence: claim.evidence,
      note: reason,
    });
    claim.status = 'WITHDRAWN';
    if (supersededBy) claim.supersededBy = supersededBy;
    return claim;
  }

  /**
   * Replace one claim with a better-evidenced one about the same subject.
   *
   * Both survive, linked in both directions, so the older conclusion can still
   * be found by anyone who encounters it repeated elsewhere.
   */
  supersede(oldId: string, newId: string, evidence: Evidence, note?: string): Claim {
    const previous = this.mustGet(oldId);
    previous.history.push({
      at: new Date().toISOString(),
      from: previous.status,
      to: 'SUPERSEDED',
      evidence: previous.evidence,
      ...(note ? { note } : {}),
    });
    previous.status = 'SUPERSEDED';
    previous.supersededBy = newId;

    const replacement = this.open(newId, evidence, note);
    replacement.supersedes = oldId;
    return replacement;
  }

  /** Everything currently believed, for reporting. */
  proven(): Claim[] {
    return this.all().filter((c) => c.status === 'PROVEN_LIVE');
  }

  /** Everything that was believed and is not any more. */
  retracted(): Claim[] {
    return this.all().filter((c) => c.status === 'WITHDRAWN' || c.status === 'SUPERSEDED');
  }

  toJSON(): Claim[] {
    return this.all();
  }

  private mustGet(id: string): Claim {
    const claim = this.claims.get(id);
    if (!claim) throw new Error(`No such claim: ${id}`);
    return claim;
  }
}
