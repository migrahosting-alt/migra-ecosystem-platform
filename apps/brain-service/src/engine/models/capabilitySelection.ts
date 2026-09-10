/**
 * WHICH CAPABILITY, AND WHY — before any evidence is planned.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY SELECTION COMES FIRST
 *
 * The repository planner used to run before anything else. Asked to find an
 * email, it scored `telemetry.ts` at 506 on "identifier email", pre-loaded four
 * source files, and the mailbox was never opened. The model then had repository
 * evidence in front of it and answered from that.
 *
 * The failure was ORDERING, not scoring. So the question "what is this request
 * about" is answered before any source is planned, and repository planning runs
 * only when the plan actually calls for repository evidence.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A REASONED PLAN, NOT A WINNING SCORE
 *
 * Teaching the repo planner about email would have made it a second capability
 * router. Scoring capabilities against keywords here would repeat that mistake
 * one layer up: whichever list of words was longest would win, and "email
 * marketing strategy" would open a mailbox.
 *
 * So selection asks a structural question instead. A capability owns nouns. It
 * is selected when one of its nouns is the OBJECT of the request — the thing
 * being acted on — and not when the same word merely modifies a different noun.
 *
 *   "find the email containing X"      email is the object      → mailbox
 *   "summarize that email"             email is the object      → mailbox
 *   "email marketing strategy"         email modifies strategy  → no mailbox
 *   "where is the email validator"     email modifies validator → no mailbox
 *   "rename the email field"           email modifies field     → no mailbox
 *
 * That distinction is a property of the sentence, not of a word list, which is
 * why it does not collapse the moment somebody adds a synonym.
 *
 * ---------------------------------------------------------------------------
 * CAPABILITY-GENERIC BY CONSTRUCTION
 *
 * Nothing here names a capability. The nouns come from the registry, so a
 * capability that arrives later is selectable without chat learning anything —
 * and chat cannot develop opinions about one capability that it lacks about the
 * others.
 */

/** What a capability tells the selector about itself. */
export interface SelectableCapability {
  id: string;
  /**
   * The nouns this capability OWNS, lower-case and singular where natural.
   *
   * Owned rather than merely associated: "message" belongs to a mailbox
   * capability, "commit" to a repository one. A word that several capabilities
   * would claim is a sign the vocabulary is too broad, not that the selector
   * needs a tie-break.
   */
  nouns: readonly string[];
  /** False when the engine says it cannot run right now. */
  available: boolean;
}

export type SelectionReason =
  | 'object-of-request'
  | 'explicit-reference'
  | 'noun-is-modifier'
  | 'no-owned-noun'
  | 'capability-unavailable';

export interface SelectedCapability {
  capabilityId: string;
  reason: Extract<SelectionReason, 'object-of-request' | 'explicit-reference'>;
  /** The word that carried the decision. Kept so a plan can be explained. */
  evidence: string;
}

export interface RejectedCapability {
  capabilityId: string;
  reason: Exclude<SelectionReason, 'object-of-request' | 'explicit-reference'>;
  /** The word that was present but did not select it, when there was one. */
  evidence?: string;
}

export interface CapabilityPlan {
  selected: SelectedCapability[];
  /**
   * Why each candidate was NOT chosen.
   *
   * Kept rather than discarded: "the mailbox was not opened" and "the mailbox
   * could not be opened" are different facts, and a plan that recorded only its
   * winners could not tell them apart when someone asks why.
   */
  rejected: RejectedCapability[];
  /**
   * Whether to plan repository evidence at all.
   *
   * 🚨 FALSE FOR AN EXPLICIT CAPABILITY REQUEST. This is the ordering fix: a
   * request about a mailbox does not pre-load source files, so the model never
   * has repository evidence in front of it to answer from instead.
   */
  repoPlanning: boolean;
}

/*
 * Words that mean "the thing after me is what I am about", so the noun before
 * them is not the object. Deliberately small: this is grammar, not a topic list.
 */
const DEMONSTRATIVES = new Set(['that', 'this', 'the', 'my', 'those', 'these', 'our']);

/**
 * Verbs that act on a retrieved object. A noun with no action is a topic.
 *
 * 🚨 EXPORTED BECAUSE A SEARCH NEEDS THE SAME LIST, INVERTED. These words say
 * that the user is ASKING; they are never what they are asking ABOUT. Keeping a
 * second copy beside the query builder would let the two drift, and the
 * symptom would be a search that quietly includes "summarize" as a term.
 */
export const RETRIEVAL_VERBS: ReadonlySet<string> = new Set([
  'find', 'search', 'read', 'show', 'open', 'check', 'look', 'get', 'fetch',
  'list', 'summarize', 'summarise', 'summary', 'tell', 'what', 'which', 'who',
  'when', 'compare', 'from', 'about', 'in', 'containing', 'contains',
]);

function words(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[a-z0-9_.@$-]+/g) ?? [])
    .map((w) => w.replace(/^[.\-]+/, '').replace(/[.\-]+$/, ''))
    .filter(Boolean);
}

/**
 * Is this occurrence of `noun` the OBJECT of the request, or a modifier?
 *
 * 🚨 THE WHOLE DISCRIMINATOR. English puts a modifier immediately before the
 * noun it modifies: "email validator" is a validator, "email marketing" is
 * marketing, "email field" is a field. None of them is a mailbox. The same word
 * as the head of the phrase — "the email", "that email", "emails from X" — is
 * the thing itself.
 *
 * A following word that is plainly not a noun (a preposition, a verb, the end
 * of the sentence) leaves the noun as the head.
 */
const NOT_A_HEAD_FOLLOWER = new Set([
  'from', 'to', 'about', 'with', 'containing', 'contains', 'that', 'which',
  'and', 'or', 'in', 'on', 'at', 'for', 'by', 'is', 'was', 'has', 'have',
  'says', 'said', 'and.', 'attached', 'sent', 'received',
]);

function occursAsObject(tokens: string[], noun: string): { object: boolean; modifier: boolean } {
  let object = false;
  let modifier = false;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== noun && tokens[i] !== `${noun}s`) continue;

    const next = tokens[i + 1];
    const prev = tokens[i - 1];

    /*
     * A noun immediately followed by another word that could be a noun is
     * modifying it. Followed by nothing, by a preposition, or by a clause
     * marker, it is the head — and therefore the object.
     */
    const followedByNoun = next !== undefined && !NOT_A_HEAD_FOLLOWER.has(next);
    if (followedByNoun) {
      modifier = true;
      continue;
    }

    /*
     * A determiner in front is strong evidence of the head: "the email", "that
     * email", "my email". Without one it can still be the object ("find emails
     * from X"), so this raises confidence rather than gating.
     */
    void (prev !== undefined && DEMONSTRATIVES.has(prev));
    object = true;
  }

  return { object, modifier };
}

/** Does the request ask for something to be DONE with the object? */
function hasRetrievalAction(tokens: string[]): boolean {
  return tokens.some((t) => RETRIEVAL_VERBS.has(t));
}

/**
 * Choose the capabilities this request is actually about.
 *
 * 🚨 UNAVAILABLE CAPABILITIES ARE REJECTED, NOT IGNORED. "Not asked for" and
 * "asked for but not connected" are different answers to the user, and a plan
 * that dropped the second silently would produce a reply about a mailbox that
 * never mentions it is disconnected.
 */
export function selectCapabilities(input: {
  prompt: string;
  capabilities: readonly SelectableCapability[];
  /** False when the request carries no authenticated identity. */
  identified: boolean;
  /**
   * What the prompt points BACKWARD at, and which capability retrieved it.
   *
   * ---------------------------------------------------------------------
   * 🚨 A REFERENCE IS A SELECTION SIGNAL IN ITS OWN RIGHT
   *
   * "What revenue does the spreadsheet attached to that email show?" is not a
   * request about a mailbox — grammatically it is a request about a
   * spreadsheet, and the analysis below is right to call `email` a modifier
   * here. Left at that, the turn selects nothing and the user is told the
   * assistant cannot help with the thing it showed them a moment ago.
   *
   * The resolution is not to weaken the grammar. It is that CONTINUING with
   * something already retrieved is a different reason to select a capability
   * than being asked to go and look — which is why `explicit-reference` exists
   * beside `object-of-request` rather than replacing it. The two answer
   * different questions, and a plan that recorded only "selected" could not say
   * which one happened.
   *
   * 🚨 AND IT IS NOT AN AUTHORIZATION. The capability still runs under the
   * current identity against current readiness; a reference decides WHAT to
   * continue, never whether the caller may.
   */
  continuation?: { capabilityId: string; phrase: string } | null;
}): CapabilityPlan {
  const selected: SelectedCapability[] = [];
  const rejected: RejectedCapability[] = [];

  const tokens = words(input.prompt);
  const action = hasRetrievalAction(tokens);

  for (const capability of input.capabilities) {
    if (input.continuation?.capabilityId === capability.id) {
      /*
       * Identity and availability, exactly as below — a reference exempts a
       * capability from neither.
       *
       * 🚨 DEFENCE IN DEPTH, NOT THE MECHANISM. Dispatch refuses an
       * unavailable capability on its own, per principal, at execution time;
       * that is what actually makes a disconnect take effect between turns, and
       * removing these four lines does not let a revoked mailbox answer. They
       * are here so the PLAN tells the truth about what was chosen and why —
       * worth stating, because a guard mistaken for the mechanism is the kind
       * of thing that gets deleted as redundant, and a guard mistaken for
       * redundant is the kind of thing that gets deleted as defence.
       */
      if (!input.identified || !capability.available) {
        rejected.push({
          capabilityId: capability.id,
          reason: 'capability-unavailable',
          evidence: input.continuation.phrase,
        });
        continue;
      }
      selected.push({
        capabilityId: capability.id,
        reason: 'explicit-reference',
        evidence: input.continuation.phrase,
      });
      continue;
    }

    let sawNoun: string | undefined;
    let asObject: string | undefined;
    let asModifierOnly: string | undefined;

    for (const noun of capability.nouns) {
      const { object, modifier } = occursAsObject(tokens, noun);
      if (object || modifier) sawNoun = noun;
      if (object) { asObject = noun; break; }
      if (modifier) asModifierOnly = noun;
    }

    if (!sawNoun) {
      rejected.push({ capabilityId: capability.id, reason: 'no-owned-noun' });
      continue;
    }
    if (!asObject) {
      // The word is present but it is describing something else.
      rejected.push({ capabilityId: capability.id, reason: 'noun-is-modifier', evidence: asModifierOnly! });
      continue;
    }
    if (!action) {
      // A bare mention is a topic, not a request to go and look.
      rejected.push({ capabilityId: capability.id, reason: 'noun-is-modifier', evidence: asObject });
      continue;
    }

    /*
     * 🚨 IDENTITY IS CHECKED BEFORE AVAILABILITY, and both before selection.
     * An unidentified request must not learn whether a mailbox exists.
     */
    if (!input.identified || !capability.available) {
      rejected.push({ capabilityId: capability.id, reason: 'capability-unavailable', evidence: asObject });
      continue;
    }

    selected.push({ capabilityId: capability.id, reason: 'object-of-request', evidence: asObject });
  }

  /*
   * 🚨 REPOSITORY PLANNING RUNS ONLY WHEN NOTHING ELSE WAS CHOSEN, or when the
   * request also names repository material. This is the ordering fix: an
   * explicit mailbox request must not pre-load source files, because the model
   * would then have repository evidence in front of it to answer from instead.
   */
  const mentionsRepoMaterial = tokens.some((t) => /\.[a-z]{1,4}$/.test(t) || t.includes('/'));
  return {
    selected,
    rejected,
    repoPlanning: selected.length === 0 || mentionsRepoMaterial,
  };
}
