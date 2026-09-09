/**
 * THE MIXED-EVIDENCE LEDGER — what a run actually retrieved, whatever it was.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT IT ADDS OVER A LIST
 *
 * Two things a plain array cannot enforce:
 *
 *   · ONE SCOPE PER RUN. A repository span belongs to a workspace; a message
 *     belongs to a person. Mixing them in one ledger makes "whose evidence is
 *     this" a question worth asking, and the answer must be the same for every
 *     item or an answer could be grounded in someone else's mail.
 *
 *   · COMPLETENESS THAT SURVIVES. One preview among complete sources makes the
 *     whole answer partial. A reader cannot tell which sentence came from which
 *     source, so "mostly complete" is not a claim that can be made honestly.
 *
 * ---------------------------------------------------------------------------
 * NOT A REPLACEMENT FOR THE REPO LEDGER — YET
 *
 * `EvidenceLedger` still owns repository retrieval: caching, expansion budgets,
 * repeated-read detection. This holds the VERIFIABLE surface that grounding
 * needs, across kinds. Repo items are added alongside, so the existing span
 * logic is untouched and its qualified behaviour is not re-derived.
 */

import {
  adapterFor, sameScope,
  type EmailEvidence, type EvidenceItem, type EvidenceScope, type RepoEvidence,
} from './evidenceTypes.js';

export type LedgerRefusal =
  /** The item belongs to a different principal or workspace than this run. */
  | { kind: 'scope_mismatch'; detail: string };

export class TypedEvidenceLedger {
  private readonly items: EvidenceItem[] = [];
  private seq = 0;

  /**
   * @param scope Whose run this is. Fixed at construction — a ledger that could
   *   change principal mid-run is the same defect as a run that could.
   */
  constructor(readonly scope: EvidenceScope) {}

  /**
   * Add one item.
   *
   * 🚨 REFUSES A FOREIGN SCOPE rather than filtering it out later. Dropping it
   * quietly would leave an answer citing fewer sources than it was built from,
   * with nothing saying so; accepting it would let one principal's mailbox
   * ground another's answer.
   */
  add(item: EvidenceItem): { ok: true } | { ok: false; refusal: LedgerRefusal } {
    if (!sameScope(item.scope, this.scope)) {
      return {
        ok: false,
        refusal: {
          kind: 'scope_mismatch',
          detail: 'evidence from another principal or workspace cannot ground this answer',
        },
      };
    }
    this.items.push(item);
    return { ok: true };
  }

  /** Mint an id that is stable within this run. */
  nextId(kind: EvidenceItem['kind']): string {
    this.seq += 1;
    return `${kind}_${this.seq}`;
  }

  all(): readonly EvidenceItem[] {
    return this.items;
  }

  ofKind<K extends EvidenceItem['kind']>(kind: K): Array<Extract<EvidenceItem, { kind: K }>> {
    return this.items.filter((i): i is Extract<EvidenceItem, { kind: K }> => i.kind === kind);
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Which kinds actually contributed. What a mixed answer reports. */
  kinds(): EvidenceItem['kind'][] {
    return [...new Set(this.items.map((i) => i.kind))];
  }

  /**
   * 🚨 ONE PREVIEW MAKES THE WHOLE THING PARTIAL.
   *
   * Derived from the items every time rather than tracked as a flag, because a
   * flag and its sources can disagree and only the sources are the truth.
   */
  complete(): boolean {
    return this.items.every((i) => i.complete);
  }

  /**
   * The caveats an answer built on this ledger must carry.
   *
   * De-duplicated: two partial messages produce one sentence, not two. The same
   * caveat twice reads as a fault in the product.
   */
  limitations(): string[] {
    const out: string[] = [];
    for (const item of this.items) {
      const limitation = adapterFor(item).limitation(item as never);
      if (limitation && !out.includes(limitation)) out.push(limitation);
    }
    return out;
  }

  /**
   * Which items could be the source of this claim, and how to cite each.
   *
   * 🚨 CANDIDATES, NOT A VERDICT. Whether the claim actually stands is the
   * verifier's decision and stays shared across kinds — an adapter that ruled
   * on it would give every new capability its own grounding standard, which is
   * the two-standards problem arriving by another road.
   *
   * The verifier asks THIS rather than reaching into the items, so a new
   * evidence kind becomes an adapter and not an edit to the gate.
   */
  candidatesFor(claim: string): Array<{ item: EvidenceItem; cite: string }> {
    return this.items
      .filter((item) => adapterFor(item).couldSource(claim, item as never))
      .map((item) => ({ item, cite: adapterFor(item).describe(item as never) }));
  }

  /** Whether ANY retrieved source mentions a term. */
  mentions(term: string): boolean {
    const needle = term.toLowerCase();
    return this.items.some((i) => i.text.toLowerCase().includes(needle));
  }
}

/* ------------------------------------------------------------------ *
 * Builders — the only sanctioned way to shape an item
 * ------------------------------------------------------------------ */

export function repoEvidence(input: {
  id: string;
  scope: EvidenceScope;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  code?: string;
  /** False when only part of the file was read. */
  complete?: boolean;
}): RepoEvidence {
  return {
    kind: 'repo',
    id: input.id,
    scope: input.scope,
    text: input.text,
    ...(input.code !== undefined ? { code: input.code } : {}),
    // A line range is a PART of a file unless someone says otherwise.
    complete: input.complete ?? false,
    locator: { path: input.path, startLine: input.startLine, endLine: input.endLine },
  };
}

export function emailEvidence(input: {
  id: string;
  scope: EvidenceScope;
  providerMessageId: string;
  providerThreadId: string;
  attachmentRef?: string;
  subject: string;
  from: string;
  sentAt: string;
  text: string;
  /** True only when a FULL body was read — a search snippet is not one. */
  complete: boolean;
  preGrounded?: boolean;
}): EmailEvidence {
  return {
    kind: 'email',
    id: input.id,
    scope: input.scope,
    text: input.text,
    complete: input.complete,
    subject: input.subject,
    from: input.from,
    sentAt: input.sentAt,
    ...(input.preGrounded ? { preGrounded: true } : {}),
    locator: {
      providerMessageId: input.providerMessageId,
      providerThreadId: input.providerThreadId,
      ...(input.attachmentRef ? { attachmentRef: input.attachmentRef } : {}),
    },
  };
}
