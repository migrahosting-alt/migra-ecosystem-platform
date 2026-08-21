// Step 6B — what a turn may do next, and on whose authority.
//
// THE DEFECT THIS REPLACES. `DEFERRED_TO_USER` is a regex over the model's prose. On
// Record #1 it fired on a correct answer — "I don't have enough information about your
// specific requirements for the website… Please provide more details" — the controller
// discarded that answer, and pushed a directive that told the model to call
// fs.proposeChangeset instead of asking which defaults to use. Three unwanted file
// creations followed and the user's question was never answered.
//
// A FIRST ATTEMPT AT THE FIX WAS ALSO WRONG, and its failure is why this design exists.
// It asked "does a concrete workspace referent exist?" and granted continuation only
// then. That broke two legitimate turns: "report what is in this repo" and "where is the
// engineer loop?" name no path at all, yet the workspace can plainly answer both. The
// tests caught it.
//
// ⭐ REFERENT-PRESENCE WAS THE WRONG VARIABLE. The right one is WHO CAN SUPPLY THE
// MISSING INFORMATION:
//
//     "where is the engineer loop?"     -> a WORKSPACE FACT. Go and look.
//     "what kind of website do you want?" -> a USER PREFERENCE. No amount of looking
//                                            produces it. Ask, and let the answer stand.
//
// Both name nothing. They differ in the KIND of thing that is missing, which is a
// semantic question — so the model is allowed to answer it, and the controller is not
// allowed to believe it on its own say-so.
//
// 🚨 THE MODEL MAY DECLARE. THE CONTROLLER DECIDES. A declaration is evidence, never
// authorization. It is verified against observable state, and an absent, malformed or
// unverifiable declaration fails CLOSED.
//
// 🚨 AND AUTHORITY IS A LADDER, NOT A SWITCH. `WORKSPACE_FACT` buys READ-ONLY discovery
// and nothing more. Mutation is a separate decision requiring actionable build intent,
// no outstanding user-supplied gap, and governance consumed by the loop. So even a
// misclassification of "what kind of website?" as a workspace fact costs at worst a
// bounded search — it can no longer reach fs.proposeChangeset. That containment is the
// point: the old design let a prose detector end in a directive that said, in effect,
// stop asking and build something.
//
// © MigraTeck LLC.

/** What the turn is trying to do. Separate from what it is missing. */
export type TurnIntent =
  | 'DISCUSS'
  | 'INSPECT'
  | 'BUILD'
  | 'MODIFY'
  | 'UNKNOWN';

/** Who can supply the information the model says it lacks. */
export type MissingInformationKind =
  /** Discoverable from repository state. */
  | 'WORKSPACE_FACT'
  /** Only the user knows it — a choice, a requirement, a preference. */
  | 'USER_PREFERENCE'
  /** Outside the repository and outside the user: docs, the network, the world. */
  | 'EXTERNAL_FACT'
  /** Nothing is missing. */
  | 'NONE'
  /** Not declared, malformed, or unverifiable. */
  | 'UNKNOWN';

/** What the controller will permit next. A ladder: each rung is strictly more. */
export type ToolAuthority = 'NONE' | 'READ_ONLY' | 'MUTATION';

export type TurnDisposition =
  | 'CONTINUE_TO_INSPECT'
  | 'CONTINUE_TO_ACT'
  | 'TERMINATE'
  | 'NEEDS_USER_INPUT';

/** The model's structured claim about what it lacks. EVIDENCE, not authorization. */
export interface MissingInformationDeclaration {
  kind?: string;
  /** Normalized description of the thing needed. */
  subject?: string;
  /** Why it is needed. Recorded for the audit trail. */
  evidence?: string;
}

export interface TurnDecision {
  intent: TurnIntent;
  /** The kind the CONTROLLER accepted — not necessarily the kind declared. */
  missingInformationKind: MissingInformationKind;
  disposition: TurnDisposition;
  toolAuthority: ToolAuthority;
  reason: string;
  /** Each independent check the controller ran, and its result. */
  verification: Array<{ check: string; passed: boolean }>;
  /** True when the controller did not accept the model's declared kind. */
  declarationOverridden: boolean;
}

export interface TurnDecisionInput {
  intent: TurnIntent;
  /** What the model declared. Absent ⇒ UNKNOWN ⇒ fails closed. */
  declaration?: MissingInformationDeclaration | undefined;
  /** Did the lexical detector observe a deferral? OBSERVATION ONLY. */
  deferredObserved: boolean;
  /** Observable state the controller checks the declaration against. */
  workspaceExists: boolean;
  readCapabilityGranted: boolean;
  /** 6C. Mutation is never reachable while this is false. */
  governanceConsumed: boolean;
  mutationCapabilityGranted: boolean;
}

const KINDS: readonly MissingInformationKind[] = [
  'WORKSPACE_FACT',
  'USER_PREFERENCE',
  'EXTERNAL_FACT',
  'NONE',
  'UNKNOWN',
];

/** Strict: an unrecognised or absent kind is UNKNOWN, never a guess at the nearest. */
export function parseDeclaredKind(
  value: unknown,
): MissingInformationKind {
  const text = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z_]/g, '');
  return (KINDS as readonly string[]).includes(text)
    ? (text as MissingInformationKind)
    : 'UNKNOWN';
}

/**
 * Decide the turn.
 *
 * Reads top to bottom: nothing missing, then the gaps only the user can close, then the
 * gaps the workspace can close, then — separately — whether mutation is permitted.
 */
export function decideTurn(input: TurnDecisionInput): TurnDecision {
  const declared = parseDeclaredKind(input.declaration?.kind);
  const verification: Array<{ check: string; passed: boolean }> = [];

  // No deferral and nothing declared: the answer stands. The commonest turn.
  if (!input.deferredObserved && declared === 'UNKNOWN') {
    return {
      intent: input.intent,
      missingInformationKind: 'NONE',
      disposition: mutationDisposition(input) ?? 'TERMINATE',
      toolAuthority: mutationDisposition(input) ? 'MUTATION' : 'NONE',
      reason:
        mutationDisposition(input)
          ? 'nothing outstanding and build intent is authorized; the turn may act'
          : 'the model did not defer and declared nothing missing; its answer stands',
      verification,
      declarationOverridden: false,
    };
  }

  if (declared === 'NONE') {
    const act = mutationDisposition(input);
    return {
      intent: input.intent,
      missingInformationKind: 'NONE',
      disposition: act ?? 'TERMINATE',
      toolAuthority: act ? 'MUTATION' : 'NONE',
      reason: act
        ? 'nothing is missing and build intent is authorized'
        : 'nothing is missing; the answer stands',
      verification,
      declarationOverridden: false,
    };
  }

  // Only the user can close these. No amount of inspection substitutes, and BUILD intent
  // does not override it: "build me a website" plus "what kind?" is an incomplete
  // requirement, not a failure to act.
  if (declared === 'USER_PREFERENCE' || declared === 'EXTERNAL_FACT') {
    return {
      intent: input.intent,
      missingInformationKind: declared,
      disposition: 'NEEDS_USER_INPUT',
      toolAuthority: 'NONE',
      reason:
        declared === 'USER_PREFERENCE'
          ? 'the missing information is a user choice; repository state cannot supply it'
          : 'the missing information is outside the repository and outside the user',
      verification,
      declarationOverridden: false,
    };
  }

  if (declared === 'WORKSPACE_FACT') {
    // The declaration is a claim. These are the controller's own checks.
    verification.push(
      { check: 'workspace exists', passed: input.workspaceExists },
      { check: 'read capability granted', passed: input.readCapabilityGranted },
    );
    const verified = verification.every((v) => v.passed);

    if (verified) {
      return {
        intent: input.intent,
        missingInformationKind: 'WORKSPACE_FACT',
        disposition: 'CONTINUE_TO_INSPECT',
        // READ-ONLY, deliberately. A workspace gap buys discovery, never mutation.
        toolAuthority: 'READ_ONLY',
        reason: 'declared a workspace fact and the controller verified the workspace and read capability',
        verification,
        declarationOverridden: false,
      };
    }

    return {
      intent: input.intent,
      missingInformationKind: 'UNKNOWN',
      disposition: 'NEEDS_USER_INPUT',
      toolAuthority: 'NONE',
      reason: 'declared a workspace fact, but the controller could not verify it; failing closed',
      verification,
      declarationOverridden: true,
    };
  }

  // Deferred with no usable declaration. Fail closed to the user — never to execution.
  return {
    intent: input.intent,
    missingInformationKind: 'UNKNOWN',
    disposition: 'NEEDS_USER_INPUT',
    toolAuthority: 'NONE',
    reason: input.deferredObserved
      ? 'the model deferred without declaring what kind of information it needs; failing closed to the user'
      : 'no usable declaration; failing closed to the user',
    verification,
    declarationOverridden: input.declaration !== undefined,
  };
}

/**
 * May this turn mutate?
 *
 * Every condition is required, and none of them is the model's opinion. Returns the
 * disposition when permitted, or null — the caller must not infer permission from
 * anything else.
 */
function mutationDisposition(
  input: TurnDecisionInput,
): TurnDisposition | null {
  const wantsToBuild =
    input.intent === 'BUILD' || input.intent === 'MODIFY';
  if (!wantsToBuild) return null;
  // 6C, checked here as well as at dispatch. Defence in depth: a controller bug must
  // not be able to manufacture authority, and a governance bug must not be reachable
  // through the controller.
  if (!input.governanceConsumed) return null;
  if (!input.mutationCapabilityGranted) return null;
  return 'CONTINUE_TO_ACT';
}
