/*
 * WHAT THE USER WANTS DONE — as a typed plan, not a phrase.
 *
 * A mockup was attached with "can you help me build this page". The vision model
 * read it correctly, and the product then answered with a description of the
 * screenshot plus generic web-development advice. The pieces all worked; the
 * ORCHESTRATION did not. A vision read is an intermediate child operation, and
 * it terminated the parent turn simply because it produced usable text.
 *
 * The fix is not better wording and not a list of magic phrases. Routing happens
 * from a typed plan: an intent, the capabilities that intent REQUIRES, and
 * whether a vision read may terminate the turn. Callers consume the plan, so
 * improving how the intent is recognised never changes how the turn is routed.
 *
 * THE MATCHER IS A HEURISTIC AND IS LABELLED AS ONE. Verb families rather than
 * whole phrases, because "build this page", "recreate this component",
 * "implement this", "code this up" and "make mine look like this" are variations
 * of ONE outcome. When a new phrasing is missed the fix is a better signal here,
 * never a new branch in a router.
 */

export type TurnIntent =
  /** "what is in this image" — the picture itself is the subject. */
  | 'describe'
  /** "analyse this UI" — structured reading, still an answer about the image. */
  | 'analyze'
  /** "what would you improve" — judgement about the design. */
  | 'critique'
  /** "build this page" — the outcome is working software. */
  | 'implement'
  /** "make my page look like this" — outcome is a change to code that EXISTS. */
  | 'modify_existing'
  /** Ordinary conversation. */
  | 'converse';

export interface CapabilityPlan {
  intent: TurnIntent;
  /** An attached image must be read before anything else can use it. */
  requiresVision: boolean;
  /** The turn cannot be satisfied without the engineering agent. */
  requiresEngineer: boolean;
  /** The turn cannot be satisfied without an editable project on disk. */
  requiresWorkspace: boolean;
  /**
   * May the vision read BE the answer?
   *
   * False for implementation intents. That single flag is what stops a design
   * description from being served as the completed work — the defect this file
   * exists to prevent.
   */
  visionIsTerminal: boolean;
  /** Why this plan was chosen, for provenance and for debugging a misroute. */
  reason: string;
}

/*
 * Outcome families. Each entry is a set of signals for ONE outcome, not a phrase
 * to match literally — that is the difference between a classifier and a lookup
 * table, and the reason a new phrasing should cost a signal rather than a branch.
 */
/*
 * "generate" is deliberately ABSENT.
 *
 * It is the ordinary verb for asking for a PICTURE — "generate an image of a
 * fox" — and including it classified image-generation turns as software builds,
 * which then hit the missing-workspace path instead of the image pipeline.
 * An ambiguous verb that spans two outcomes belongs in neither family.
 */
const IMPLEMENT_VERBS =
  /\b(build|implement|scaffold|recreate|rebuild|reproduce|clone|code (this|it|up)|write the code|turn (this|it) into (a|an) (page|site|app|component))\b/i;

/** Weaker verbs that only mean "build" when a buildable THING is named. */
const SOFT_BUILD_VERBS = /\b(create|make|develop)\b/i;
const BUILDABLE_THING = /\b(page|site|website|app|component|screen|ui|interface|form|dashboard|layout|landing)\b/i;
/** "make this" names no object — but an attached design IS the object. */
const REFERS_TO_ATTACHMENT = /\b(this|it|these)\b/i;
/** "make this shorter" is an edit of text, not a request to build software. */
const ADJUSTMENT = /\b(shorter|longer|bigger|smaller|better|darker|lighter|brighter|louder|simpler|clearer)\b/i;

const MODIFY_VERBS =
  /\b(match|update|change|modify|adapt|restyle|redesign|apply (this|it) to|make (my|mine|our|the existing)|look like (this|that))\b/i;

/** Names an existing thing of the user's — the mark of a modify, not a create. */
const EXISTING_TARGET =
  /\b(my|mine|our|existing|current|already have|this project|the app|the site|the page i)\b/i;

const DESCRIBE_VERBS = /\b(describe|what('| i)?s in|what is this|read|transcribe|tell me what|caption)\b/i;
const ANALYZE_VERBS = /\b(analy[sz]e|break ?down|explain the (design|layout|ui)|what components|structure of)\b/i;
const CRITIQUE_VERBS = /\b(improve|critique|feedback|better|what would you change|review the design|suggestions?)\b/i;

export interface PlanInput {
  text: string;
  hasImageAttachment: boolean;
  /** Whether the calling surface actually has an editable project. */
  workspaceAvailable?: boolean;
}

export function planTurn(input: PlanInput): CapabilityPlan {
  const text = (input.text ?? '').trim();
  const vision = Boolean(input.hasImageAttachment);

  // A soft verb needs a buildable noun: "make this page" is a build, "make it
  // shorter" is not, and "generate an image" is neither.
  const softBuild =
    SOFT_BUILD_VERBS.test(text) &&
    !ADJUSTMENT.test(text) &&
    // Either the thing is named, or a design is attached and "this" refers to it.
    (BUILDABLE_THING.test(text) || (vision && REFERS_TO_ATTACHMENT.test(text)));
  const implementish = IMPLEMENT_VERBS.test(text) || softBuild;
  const modifyish = MODIFY_VERBS.test(text) && EXISTING_TARGET.test(text);

  /*
   * Order matters, and implementation wins.
   *
   * "Build this page" also contains a picture, so a describe-first classifier
   * answers with a description and calls it done. When a request names an
   * OUTCOME, the presence of an image is a means, not the subject.
   */
  if (modifyish) {
    return {
      intent: 'modify_existing',
      requiresVision: vision,
      requiresEngineer: true,
      requiresWorkspace: true,
      visionIsTerminal: false,
      reason: 'names an existing project of the user’s and asks for it to change',
    };
  }
  if (implementish) {
    return {
      intent: 'implement',
      requiresVision: vision,
      requiresEngineer: true,
      // Software has to be built somewhere.
      requiresWorkspace: true,
      visionIsTerminal: false,
      reason: 'asks for something to be built, so the outcome is working software',
    };
  }
  if (vision && CRITIQUE_VERBS.test(text)) {
    return { intent: 'critique', requiresVision: true, requiresEngineer: false, requiresWorkspace: false, visionIsTerminal: true, reason: 'asks for judgement about the design' };
  }
  if (vision && ANALYZE_VERBS.test(text)) {
    return { intent: 'analyze', requiresVision: true, requiresEngineer: false, requiresWorkspace: false, visionIsTerminal: true, reason: 'asks for a structured reading of the image' };
  }
  if (vision && DESCRIBE_VERBS.test(text)) {
    return { intent: 'describe', requiresVision: true, requiresEngineer: false, requiresWorkspace: false, visionIsTerminal: true, reason: 'asks what the image contains' };
  }
  if (vision) {
    /*
     * An image with no clear verb. Describing is the safe default: it answers
     * something useful and, unlike building, it cannot be wrong about intent in
     * a way that wastes the user's project.
     */
    return { intent: 'describe', requiresVision: true, requiresEngineer: false, requiresWorkspace: false, visionIsTerminal: true, reason: 'an image with no explicit outcome verb' };
  }
  return { intent: 'converse', requiresVision: false, requiresEngineer: false, requiresWorkspace: false, visionIsTerminal: false, reason: 'ordinary conversation' };
}

/** What is missing before this plan can be satisfied here. Empty means nothing. */
export function unmetPrerequisites(plan: CapabilityPlan, ctx: { workspaceAvailable: boolean; engineerAvailable: boolean }): string[] {
  const missing: string[] = [];
  if (plan.requiresWorkspace && !ctx.workspaceAvailable) missing.push('an editable project to build in');
  if (plan.requiresEngineer && !ctx.engineerAvailable) missing.push('the engineering agent');
  return missing;
}
