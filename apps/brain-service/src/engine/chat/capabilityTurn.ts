/**
 * ONE TURN, FROM PROMPT TO VERIFIED EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS A MODULE AND NOT PART OF THE CHAT ROUTE
 *
 * `/api/ai/chat` is already a thousand lines carrying image generation,
 * streaming, escalation and memory. Teaching it Email semantics, attachment
 * semantics, provider ids and evidence-resolution rules would make the one
 * route that every turn passes through the place where every capability's
 * details accumulate.
 *
 * So the route supplies four things — an authenticated identity, the
 * conversation and turn, the prompt, and its streaming hooks — and learns
 * nothing else. Everything below is capability-generic: nothing here names a
 * capability, and a capability registered later flows through unchanged.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A PERSISTED REFERENCE IS A POINTER, NEVER A PERMISSION
 *
 * A stored evidence id says what the user was previously shown. It does NOT
 * say they may still see it. So resolving "that email" does not serve the
 * stored text back: it re-executes the read through the capability, under the
 * CURRENT identity, against CURRENT readiness.
 *
 * That difference is the whole reason a disconnect takes effect between turns.
 * The tempting optimisation — "we already have the body, skip the round trip" —
 * silently converts the pointer into a permission token, and the mailbox the
 * user revoked keeps answering.
 */

import { executeToolCore, type ToolExecDeps } from '../tools/toolExecutor.js';
import { principalScopeOf, type ExecutionIdentity } from '../identity/executionIdentity.js';
import { RETRIEVAL_VERBS, selectCapabilities, type CapabilityPlan, type SelectableCapability } from '../models/capabilitySelection.js';
import { TypedEvidenceLedger } from '../grounding/typedEvidenceLedger.js';
import { adapterFor, significantTerms, tokensOf, type EvidenceItem } from '../grounding/evidenceTypes.js';
import {
  evidenceFromAttachment, evidenceFromMessage, evidenceFromSearch, evidenceFromThread,
} from '../email/emailEvidenceProduction.js';
import { emailAttachmentOrigin, fileEvidenceFrom } from '../grounding/fileEvidenceProduction.js';
import { extractFileText } from '../files/fileText.js';
import {
  referenceFileType, referencePhrase, resolveReference,
  type ConversationEvidenceStore, type ReferenceFileType, type ResolvedReference,
} from './conversationEvidence.js';
import type { EmailAttachment, EmailMessage, EmailThread } from '../email/types.js';

export interface CapabilityTurnDeps {
  toolDeps: ToolExecDeps;
  /** From the registry. The turn does not know which capabilities exist. */
  capabilities: readonly SelectableCapability[];
  evidence: ConversationEvidenceStore;
}

export interface CapabilityTurnInput {
  prompt: string;
  /** 🚨 Server-derived. Null means unidentified, and nothing executes. */
  identity: ExecutionIdentity | null;
  conversationId: string;
  turnId: string;
  requestId: string;
}

export interface ExecutedCapability {
  capabilityId: string;
  op: string;
  ok: boolean;
  /** Present when the capability refused. Engine words, no provider vocabulary. */
  detail?: string;
}

/**
 * The prompt pointed backward and nothing could be pointed at.
 *
 * 🚨 THERE IS DELIBERATELY NO "not yours" REASON.
 *
 * A first draft distinguished "no antecedent" from "belongs to another
 * principal". It cannot, and it must not: the store scopes its reads, so this
 * layer never sees another principal's turns — and reporting the difference
 * would tell one user that another has evidence in a shared conversation.
 * Not knowing is the correct amount to know.
 */
export interface UnresolvedReference {
  /** The phrase that was read as pointing backward. */
  phrase: string;
}

export interface CapabilityTurnResult {
  plan: CapabilityPlan;
  /**
   * Whether the turn carried an authenticated principal.
   *
   * 🚨 STATED, NOT INFERRED. A caller has to tell an unidentified turn from an
   * identified one that found nothing, because the two get DIFFERENT answers:
   * an identified user whose mailbox is not connected should be told so, and an
   * unidentified request must not learn whether a mailbox exists at all.
   * Deriving it from an empty ledger or an empty scope would be reading an
   * implementation detail as an authorization fact.
   */
  identified: boolean;
  /** Evidence this turn retrieved. Empty when nothing was selected or executed. */
  ledger: TypedEvidenceLedger;
  /** What a backward reference resolved to, if the prompt carried one. */
  reference: ResolvedReference | null;
  /**
   * Set when the prompt POINTED BACKWARD and nothing could be pointed at.
   *
   * 🚨 A FAILED REFERENCE IS NOT A SEARCH REQUEST. "Summarize that email" with
   * no resolvable antecedent means the user believes we are already looking at
   * something. Falling through to a fresh mailbox search would answer a
   * question they did not ask, and — for another principal in a shared
   * conversation — would quietly turn "you cannot reuse that" into "so I
   * searched your mailbox instead".
   *
   * The caller asks what they meant. It does not go looking.
   */
  unresolvedReference: UnresolvedReference | null;
  /**
   * Set when a SINGULAR reference ("the spreadsheet") met more than one
   * candidate attachment.
   *
   * 🚨 THE TURN DOES NOT PICK. Choosing between `Q3-budget.xlsx` and
   * `Q3-budget-final.xlsx` from the wording of a prompt is the prose routing
   * this project deleted once already, and the cost of getting it wrong is an
   * answer that quotes the wrong document confidently. The candidates go back
   * to the caller so a person can say which one.
   */
  ambiguousAttachment: { candidates: string[] } | null;
  /**
   * The provider matched this message on something our evidence does not contain.
   *
   * ---------------------------------------------------------------------
   * 🚨 "GMAIL RETURNED THIS MESSAGE FOR THE QUERY" IS NOT "THE MESSAGE SAYS THIS"
   *
   * Found in owner acceptance. Asked to find the email containing a sentinel
   * string, Gmail returned exactly one message — because Gmail indexes
   * ATTACHMENT CONTENT. The sentinel was in a spreadsheet; it was in neither the
   * snippet, the subject, nor the full body. Every claim that the message
   * contained it was therefore unsupported, and the gate — correctly — removed
   * all of them. The user was told nothing was found, about a search that had
   * found exactly the right message.
   *
   * A provider's match is real information and it is NOT evidence of content.
   * So the turn goes and looks: it opens the attachments through the canonical
   * file pipeline and stops as soon as the term is actually in front of it.
   * Only then can an answer say where the term was found — and it says it about
   * a FILE it has read, not about a body it has not.
   */
  providerMatchBeyondEvidence: {
    /** The terms the provider matched on that our message evidence lacks. */
    terms: string[];
    /** Attachments actually fetched and extracted while looking for them. */
    inspected: string[];
    /** True once the terms were found in something this turn really read. */
    located: boolean;
  } | null;
  executed: ExecutedCapability[];
  /** Whether the caller should still plan repository evidence. */
  repoPlanning: boolean;
}

/** The scope every piece of this turn is bound to. */
const scopeOf = (identity: ExecutionIdentity) => ({
  principalId: identity.principalId,
  workspaceId: identity.workspaceId,
});

/**
 * Run the capability half of one turn.
 *
 * Returns evidence, never prose. Synthesis and verification stay with the
 * caller, because the model call and the streaming hooks live there — and
 * because an orchestrator that also wrote the answer would be two jobs.
 */
export async function runCapabilityTurn(
  input: CapabilityTurnInput,
  deps: CapabilityTurnDeps,
): Promise<CapabilityTurnResult> {
  /*
   * 🚨 UNIDENTIFIED TURNS STOP BEFORE READING ANYTHING.
   *
   * The conversation record is not consulted at all: without a principal there
   * is no scope to read it under, and "whose evidence would this be" has no
   * answer. The selector refuses to choose anything for the same reason, and
   * this returns an empty ledger rather than an absent one, so a caller cannot
   * mistake "nothing retrieved" for "nothing to retrieve".
   */
  if (!input.identity) {
    return {
      plan: selectCapabilities({
        prompt: input.prompt,
        capabilities: deps.capabilities,
        identified: false,
      }),
      identified: false,
      ledger: new TypedEvidenceLedger({ principalId: '', workspaceId: '' }),
      reference: null,
      unresolvedReference: null,
      ambiguousAttachment: null,
      providerMatchBeyondEvidence: null,
      executed: [],
      // An unidentified turn plans repository evidence like any other, because
      // nothing capability-shaped was, or could have been, chosen.
      repoPlanning: true,
    };
  }

  const scope = scopeOf(input.identity);
  const ledger = new TypedEvidenceLedger(scope);
  const executed: ExecutedCapability[] = [];

  /*
   * 🚨 SCOPED READ. The history is fetched for THIS principal; a conversation
   * id names a thread, it does not grant access to what someone else put in it.
   */
  const history = await deps.evidence.recent(input.conversationId, scope, 10);
  /*
   * 🚨 DOES THIS PROMPT NAME SOMETHING OF ITS OWN TO LOOK FOR?
   *
   * The union of every registered capability's vocabulary, because the question
   * is asked before one is chosen. It decides only one thing: whether a bare
   * "it" points backward. "Search my inbox for the test file and tell me who
   * sent it" names a subject, so the pronoun is about what this turn will find;
   * "summarize it" names nothing, so it is about what the last turn found.
   */
  const ownedNouns = deps.capabilities.flatMap((c) => c.nouns);
  const hasFreshSubject = subjectTermsOf(input.prompt, ownedNouns).length > 0;
  const reference = resolveReference({ prompt: input.prompt, history, scope, hasFreshSubject });

  /*
   * ---------------------------------------------------------------------
   * 🚨 WHAT THE PROMPT POINTS AT IS RESOLVED BEFORE CAPABILITIES ARE CHOSEN.
   *
   * Not a reordering of the locked pipeline — reference resolution is part of
   * UNDERSTANDING THE REQUEST, upstream of both capability selection and
   * evidence-source planning. It reads this conversation's own record and
   * nothing else; no capability runs, no mailbox is touched.
   *
   * It has to come first because a backward reference is a selection signal
   * the grammar cannot supply. "What revenue does the spreadsheet attached to
   * that email show?" is, grammatically, a question about a spreadsheet — and
   * the selector is right to say so. Only the conversation knows that the
   * spreadsheet in question is one we already found in a mailbox.
   */
  const plan = selectCapabilities({
    prompt: input.prompt,
    capabilities: deps.capabilities,
    identified: true,
    continuation: reference
      ? { capabilityId: reference.capabilityId, phrase: reference.phrase }
      : null,
  });

  /*
   * 🚨 POINTED BACKWARD, FOUND NOTHING — STOP.
   *
   * Distinguishing this from a fresh request is the whole point: "could not
   * reuse prior evidence" and "you asked me to search" are different answers,
   * and collapsing them lets a failed cross-scope resolution become an
   * implicit authorization to search a different mailbox.
   */
  const phrase = referencePhrase(input.prompt, { hasFreshSubject });
  if (phrase && !reference) {
    return {
      plan,
      identified: true,
      ledger,
      reference: null,
      unresolvedReference: { phrase },
      ambiguousAttachment: null,
      providerMatchBeyondEvidence: null,
      executed: [],
      repoPlanning: plan.repoPlanning,
    };
  }

  let ambiguousAttachment: { candidates: string[] } | null = null;
  let providerMatchBeyondEvidence: CapabilityTurnResult['providerMatchBeyondEvidence'] = null;
  /** Evidence id → the capability that produced it, for the turns that follow. */
  const producedBy: Record<string, string> = {};

  for (const selected of plan.selected) {
    // The full declaration, for the words this capability owns. The plan
    // carries only the one that decided it.
    const chosen = {
      ...selected,
      nouns: deps.capabilities.find((c) => c.id === selected.capabilityId)?.nouns ?? [],
    };
    /*
     * 🚨 RE-EXECUTED, NOT REPLAYED. When a reference resolved, the operation
     * still goes through the capability under the current identity — the
     * stored text is a pointer to what was seen, never evidence that it may
     * still be seen.
     */
    const run = async (request: Record<string, unknown>) => {
      const outcome = await executeToolCore(deps.toolDeps, {
        tool: chosen.capabilityId,
        input: request,
        requestId: input.requestId,
        principal: principalScopeOf(input.identity!),
      });
      const op = String(request.op ?? 'search');
      if (!outcome.ok) {
        executed.push({ capabilityId: chosen.capabilityId, op, ok: false, detail: outcome.error });
        return null;
      }
      executed.push({ capabilityId: chosen.capabilityId, op, ok: true });
      return (outcome.result ?? {}) as Record<string, unknown>;
    };

    const first = operationFor(input.prompt, reference, chosen.nouns);
    const result = await run(first);
    if (!result) continue;

    for (const item of await evidenceFrom(result, reference, scope, ledger)) {
      // A refusal here would mean production stamped a foreign scope, which is
      // a bug rather than a condition — the ledger is the second gate.
      ledger.add(item);
      producedBy[item.id] = chosen.capabilityId;
    }

    /*
     * ---------------------------------------------------------------------
     * 🚨 THE PROVIDER MATCHED SOMETHING WE CANNOT SEE — SO GO AND LOOK.
     *
     * A mail provider indexes attachment content. A search can therefore return
     * exactly the right message while the snippet, the subject and even the full
     * body contain nothing of what was asked for. Answering from that message is
     * then guaranteed to fail the gate, and the user is told nothing was found
     * about a search that found precisely what they wanted.
     *
     * The distinction is real and worth keeping sharp: "the provider returned
     * this message for the query" is a fact about the SEARCH, and "the message
     * says this" is a claim about CONTENT. This bridges them the only honest way
     * — by opening the attachments and reading them, so that whatever is said
     * afterwards is said about a document this turn actually has.
     *
     * 🚨 NARROW ON PURPOSE. One result only, and only when the terms are
     * genuinely absent from what was retrieved. A search whose terms are right
     * there in the body — the ordinary case — costs nothing extra. Fetching
     * stops the moment the terms are found, so the common shape is one extra
     * read, not a sweep of every attachment.
     */
    const searched = Array.isArray(result.messages) ? (result.messages as EmailMessage[]) : null;
    if (searched?.length === 1 && !reference) {
      const wanted = subjectTermsOf(input.prompt, chosen.nouns);
      const message = searched[0]!;
      if (wanted.length > 0 && !coveredBy(ledger.all(), wanted)) {
        const inspected: string[] = [];

        /*
         * 🚨 READ THE MESSAGE BEFORE CONCLUDING THE MESSAGE DOES NOT SAY IT.
         *
         * A search returns a SNIPPET. Absence from a snippet is not absence
         * from the message — most of a body is missing from its own preview —
         * so escalating straight to attachments would download files to look
         * for something that was in the body all along, and would do it on
         * ordinary searches, constantly.
         *
         * Reading the one result first turns "unknown" into "proven absent",
         * which is the only ground on which opening an attachment is justified.
         * It also just makes the answer better: the full body instead of a
         * hundred-character preview.
         */
        const read = await run({ op: 'readMessage', messageId: message.providerMessageId });
        if (read) {
          for (const item of await evidenceFrom(read, reference, scope, ledger)) {
            ledger.add(item);
            producedBy[item.id] = chosen.capabilityId;
          }
        }

        if (coveredBy(ledger.all(), wanted)) continue;

        const listing = await run({ op: 'listAttachments', messageId: message.providerMessageId });
        const attachments = listing ? attachmentsOf(listing) ?? [] : [];

        for (const attachment of attachments.slice(0, MAX_ATTACHMENTS_INSPECTED)) {
          const fetched = await run({
            op: 'fetchAttachment',
            messageId: message.providerMessageId,
            attachmentId: attachment.ref,
          });
          if (!fetched) continue;
          inspected.push(attachment.filename);
          for (const item of await evidenceFrom(fetched, reference, scope, ledger)) {
            ledger.add(item);
            producedBy[item.id] = chosen.capabilityId;
          }
          // Found it. Reading the rest would cost a round trip to prove nothing.
          if (coveredBy(ledger.all(), wanted)) break;
        }

        providerMatchBeyondEvidence = {
          terms: wanted,
          inspected,
          located: coveredBy(ledger.all(), wanted),
        };
      }
    }

    /*
     * ---------------------------------------------------------------------
     * 🚨 THE ATTACHMENT CONTINUATION
     *
     * "What does the spreadsheet attached to that email say?" resolves to the
     * MESSAGE, because that is the thing a previous turn actually retrieved. A
     * listing then tells us what it carries — and stopping there would answer
     * with a filename, which is not what was asked.
     *
     * So the listing continues into a fetch, and the fetch goes through the
     * SAME capability under the same identity. That matters more than it looks:
     * the ref this step names came from a listing done seconds ago through this
     * caller's own connection, and it is re-resolved against a fresh read of the
     * message. A disconnect landing between the two steps fails the second one
     * — which is the behaviour a persisted pointer is supposed to have, arriving
     * at the finest granularity the product has.
     *
     * Exactly ONE continuation. A loop here would be a planner, and a planner
     * that decides operations from prose is what this design refuses.
     */
    const listed = attachmentsOf(result);
    if (!listed || !reference) continue;
    if (listed.length === 0) continue;

    /*
     * 🚨 NARROWED BY THE FILE'S OWN DECLARED TYPE, never by the wording alone.
     * The user said "spreadsheet"; the provider said which of these IS one. If
     * that leaves exactly one, there is nothing to guess at. If it leaves none,
     * the whole list goes back — a type word that matches nothing is a reason
     * to ask, never a reason to open whatever else was there.
     */
    const wantedType = referenceFileType(input.prompt);
    const matching = wantedType ? listed.filter((a) => isType(a, wantedType)) : listed;
    const candidates = matching.length > 0 ? matching : listed;

    if (candidates.length > 1) {
      ambiguousAttachment = { candidates: candidates.map((a) => a.filename) };
      continue;
    }

    const only = candidates[0]!;
    const fetched = await run({
      op: 'fetchAttachment',
      messageId: reference.item.locator.providerMessageId,
      // 🚨 OUR ref, from the listing we just did. Never a provider token.
      attachmentId: only.ref,
    });
    if (!fetched) continue;

    for (const item of await evidenceFrom(fetched, reference, scope, ledger)) {
      ledger.add(item);
      producedBy[item.id] = chosen.capabilityId;
    }
  }

  /*
   * Persist what THIS turn retrieved, so the next turn can say "that email".
   * Ids and locators only — the ledger holds the text for this turn alone.
   */
  if (!ledger.isEmpty()) {
    await deps.evidence.append({
      conversationId: input.conversationId,
      turnId: input.turnId,
      scope,
      items: ledger.all(),
      producedBy,
    });
  }

  return {
    plan, identified: true, ledger, reference,
    unresolvedReference: null,
    ambiguousAttachment,
    providerMatchBeyondEvidence,
    executed,
    repoPlanning: plan.repoPlanning,
  };
}

/**
 * What to ask the capability for.
 *
 * A resolved reference names the message; without one the prompt is a fresh
 * search. Deliberately small — deciding operations from prose is the routing
 * problem this project already deleted once, and it does not come back here.
 */
function operationFor(
  prompt: string,
  reference: ResolvedReference | null,
  nouns: readonly string[],
): Record<string, unknown> {
  if (reference) {
    if (reference.kind === 'thread') {
      return { op: 'readThread', threadId: reference.item.locator.providerThreadId };
    }
    if (reference.kind === 'attachment') {
      /*
       * 🚨 A REF THE USER WAS ALREADY SHOWN GOES STRAIGHT TO THE BYTES.
       *
       * When the resolved evidence IS an attachment, a previous turn already
       * listed it and the ref is ours. Listing again would be a wasted read
       * whose only other effect is a second chance to pick the wrong one.
       *
       * Without a ref the reference points at the MESSAGE, and the listing is
       * how we find out what it carries.
       */
      const ref = reference.item.locator.attachmentRef;
      return ref
        ? { op: 'fetchAttachment', messageId: reference.item.locator.providerMessageId, attachmentId: ref }
        : { op: 'listAttachments', messageId: reference.item.locator.providerMessageId };
    }
    return { op: 'readMessage', messageId: reference.item.locator.providerMessageId };
  }
  return { op: 'search', keywords: searchTermsFor(prompt, nouns), limit: 20 };
}

/**
 * The most attachments worth opening to find a term the provider matched on.
 *
 * A bound rather than a preference: a message can carry a dozen files, and
 * "look everywhere" turns one question into a dozen downloads of the user's own
 * mail. Three is enough to cover the shapes that actually occur — a document
 * and its spreadsheet, a scan and its transcript — and the search result names
 * what was not opened when it is not.
 */
const MAX_ATTACHMENTS_INSPECTED = 3;

/**
 * Is every one of these terms in something this turn actually retrieved?
 *
 * 🚨 THE SAME TOKEN RULE THE VERIFIER USES, so this cannot decide a term is
 * present and then have the gate decide it is absent. Whole tokens, never
 * substrings.
 */
function coveredBy(items: readonly EvidenceItem[], wanted: readonly string[]): boolean {
  const haystack = new Set<string>();
  for (const item of items) {
    for (const token of tokensOf(adapterFor(item).haystack(item as never))) haystack.add(token);
  }
  return wanted.every((t) => haystack.has(t));
}

/**
 * Does this attachment match the kind of file the user named?
 *
 * 🚨 THE ATTACHMENT'S OWN PROPERTIES ANSWER, not the prompt. Both the declared
 * MIME type and the extension are consulted because senders get either one
 * wrong: a spreadsheet arrives as `application/vnd.ms-excel`, as the long
 * OpenXML type, and occasionally as `application/octet-stream` with an honest
 * `.xlsx` on the end.
 */
function isType(attachment: EmailAttachment, wanted: ReferenceFileType): boolean {
  const name = attachment.filename.toLowerCase();
  const mime = (attachment.mimeType ?? '').toLowerCase();
  if (wanted === 'spreadsheet') {
    return name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')
      || mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv');
  }
  if (wanted === 'pdf') return name.endsWith('.pdf') || mime.includes('pdf');
  return name.endsWith('.docx') || name.endsWith('.doc') || mime.includes('word');
}

/**
 * What to actually search for.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE WHOLE PROMPT IS NOT A QUERY, AND THIS WAS PROVEN LIVE
 *
 * The first version passed `prompt` straight through. Against the real mailbox:
 * `"test file"` returned the message, and "search my inbox for the message
 * about the test file" — the same request, phrased the way a person phrases
 * it — returned NOTHING. A mail provider ANDs the terms it is given, so every
 * word of the asking became a word the message had to contain.
 *
 * The failure is invisible from inside: the search succeeds, the count is zero,
 * and the honest answer "nothing was found" is indistinguishable from an empty
 * mailbox. No unit test catches it, because a fake provider matches whatever
 * the fake decides to match.
 *
 * 🚨 STILL NOT PROSE ROUTING. Nothing here decides an operation or infers
 * intent. Two categories of word are removed and the rest is passed through
 * untouched: the words that say the user is ASKING (the selector's own verb
 * list, so the two cannot drift), and the capability's OWN NOUNS — "inbox"
 * says where to look, never what to look for. If that leaves nothing, the
 * prompt goes through unchanged rather than being replaced by a guess.
 */
function searchTermsFor(prompt: string, nouns: readonly string[]): string {
  const terms = subjectTermsOf(prompt, nouns);
  return terms.length > 0 ? terms.join(' ') : prompt;
}

/**
 * What the prompt is ABOUT, once the asking is removed.
 *
 * 🚨 THE ARRAY, NOT A STRING, because two callers need different answers from
 * it and one of them needs to know when it is EMPTY. Deriving that from a
 * string — "did the query come back unchanged?" — is true only by coincidence:
 * the prompt "test file" filters down to exactly itself, and would then read as
 * a prompt with no subject at all.
 */
function subjectTermsOf(prompt: string, nouns: readonly string[]): string[] {
  const owned = new Set(nouns.map((n) => n.toLowerCase()));
  return significantTerms(prompt)
    .filter((t) => !RETRIEVAL_VERBS.has(t))
    .filter((t) => !ASKING.has(t))
    .filter((t) => !owned.has(t));
}

/**
 * Words that describe the ASKING, beyond the verbs that decide selection.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A SEPARATE LIST, DELIBERATELY, AND SMALLER THAN IT WANTS TO BE
 *
 * `RETRIEVAL_VERBS` answers "is this a request to go and look" — a selection
 * question, and widening it changes which prompts reach a capability at all.
 * This answers "is this word part of how the question was phrased", which is a
 * query question. One list for both would mean every word added here quietly
 * altered selection: "sent" belongs in a query filter and has no business
 * making "the sent items" look like a retrieval request.
 *
 * 🚨 IT IS A HEURISTIC AND THE FAILURE MODE IS KNOWN. A provider ANDs the terms
 * it is given, so one leftover word of phrasing costs every result — "who sent
 * it" put `sent` in the query and the message that matched everything else came
 * back as nothing. It stays small on purpose: a word wrongly dropped loses
 * precision, a word wrongly kept loses the answer, and neither is visible from
 * inside, because both look exactly like an empty mailbox.
 */
const ASKING: ReadonlySet<string> = new Set([
  'sent', 'send', 'sends', 'sender', 'received', 'receive', 'receives',
  'wrote', 'write', 'writes', 'said', 'say', 'says',
  'give', 'gives', 'need', 'want', 'know', 'please', 'help',
]);

/**
 * The attachments a listing reported, or null when this was not a listing.
 *
 * 🚨 `attachmentsKnown` IS THE GATE, NOT THE ARRAY. An empty array means two
 * opposite things depending on which operation produced it: a listing reads the
 * full MIME tree, so empty is a PROVEN absence, while a search result's empty
 * array means nothing was ever inspected. Continuing on the second would be a
 * fetch against a message we never opened.
 */
function attachmentsOf(result: Record<string, unknown>): EmailAttachment[] | null {
  if (result.attachmentsKnown !== true || !Array.isArray(result.attachments)) return null;
  return result.attachments as EmailAttachment[];
}

/** Convert whatever a capability returned into evidence. */
async function evidenceFrom(
  result: Record<string, unknown>,
  reference: ResolvedReference | null,
  scope: { principalId: string; workspaceId: string },
  ids: { nextId(kind: EvidenceItem['kind']): string },
): Promise<EvidenceItem[]> {
  if (Array.isArray(result.messages)) {
    return evidenceFromSearch(result.messages as EmailMessage[], scope, ids);
  }
  if (result.message) {
    return [evidenceFromMessage(result.message as EmailMessage, scope, ids)];
  }
  if (result.thread) {
    return evidenceFromThread(result.thread as EmailThread, scope, ids);
  }

  /*
   * A LISTING. What a message carries is a fact about the MESSAGE — a filename
   * is not contents — so these are email evidence, deliberately incomplete, and
   * they exist mainly so a later turn can say "the spreadsheet" and resolve it.
   */
  const listed = attachmentsOf(result);
  if (listed && reference) {
    return listed.map((attachment) => evidenceFromAttachment({
      providerMessageId: reference.item.locator.providerMessageId,
      providerThreadId: reference.item.locator.providerThreadId,
      attachmentRef: attachment.ref,
      filename: attachment.filename,
      subject: reference.item.subject,
      from: reference.item.from,
      sentAt: reference.item.sentAt,
    }, scope, ids));
  }

  /*
   * 🚨 A FETCHED FILE IS NO LONGER EMAIL EVIDENCE.
   *
   * The bytes went through the canonical file pipeline, and the same
   * spreadsheet uploaded from a desktop must be verified by the same rules. The
   * message survives as PROVENANCE, so a reader still gets "the spreadsheet
   * attached to Invoice 4471" — but the judging is done by the file adapter,
   * not by rules written for message bodies.
   */
  if (result.file) {
    return fileEvidenceFor(result.file as CanonicalHandoff, scope, ids);
  }
  return [];
}

/** The shape `migra.email { op: fetchAttachment }` hands back. */
interface CanonicalHandoff {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  provenance: { providerMessageId: string; providerThreadId: string; attachmentRef: string };
}

async function fileEvidenceFor(
  handoff: CanonicalHandoff,
  scope: { principalId: string; workspaceId: string },
  ids: { nextId(kind: EvidenceItem['kind']): string },
): Promise<EvidenceItem[]> {
  const extracted = await extractFileText({ filename: handoff.filename, bytes: handoff.bytes });
  /*
   * 🚨 NOTHING, RATHER THAN A FILENAME.
   *
   * An item whose text is the filename would let "the 2026 budget was attached"
   * ground itself in a document nobody opened. The caller already has the
   * failure in `executed` and can say why — "it looks like a scan" is an
   * answer; a groundless claim is not.
   */
  if (!extracted.ok) return [];

  return [fileEvidenceFrom({
    filename: handoff.filename,
    mimeType: handoff.mimeType,
    bytes: handoff.bytes,
    extraction: extracted.extraction,
    /*
     * 🚨 THE PROVIDER'S OWN ATTACHMENT ID IS NOT PASSED, and there is no
     * parameter for it. It is regenerated on every read, so a stored copy names
     * nothing an hour later.
     */
    origin: emailAttachmentOrigin({
      providerMessageId: handoff.provenance.providerMessageId,
      providerThreadId: handoff.provenance.providerThreadId,
      attachmentRef: handoff.provenance.attachmentRef,
    }),
  }, scope, ids)];
}
