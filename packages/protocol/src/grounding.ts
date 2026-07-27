/**
 * MigraPilot protocol — evidence-source grounding modes.
 *
 * Defined ONCE, here, because the extension and the Brain must agree on the exact
 * literal set. Two independent unions that happen to match today drift silently:
 * the extension would send a value the Brain's schema rejects, or — worse — the
 * Brain would accept a mode the UI never enforces, which is precisely the class of
 * false governance guarantee this contract exists to prevent.
 *
 * Each mode is ENFORCED by the Brain, not merely labelled by the UI:
 *
 *  auto       prefer approved evidence; fall back to the working tree, disclosed
 *  approved   approved semantic index only; refuse rather than read the checkout
 *  workspace  FORCE the working tree; the approved index is never queried
 *  none       no repository evidence at all; no retrieval of either kind
 *
 * `approved` and `none` additionally cause repo-reading tools to be withheld, so an
 * agent cannot re-acquire by hand what the mode forbids.
 */

/** The wire values. Order is the UI's presentation order. */
export const GROUNDING_MODES = ['auto', 'approved', 'workspace', 'none'] as const;

export type GroundingMode = (typeof GROUNDING_MODES)[number];

/** True for a value that is a valid mode on the wire. */
export function isGroundingMode(value: unknown): value is GroundingMode {
  return typeof value === 'string' && (GROUNDING_MODES as readonly string[]).includes(value);
}

/**
 * Coerce an untrusted value to a mode, defaulting to `auto`.
 *
 * FAIL SAFE, not fail closed: an unrecognised value must not silently become a
 * restrictive mode (which would break a turn) nor a permissive one it did not ask
 * for. `auto` is today's behaviour and always discloses its source, so an
 * unparseable request degrades to the documented default rather than to a
 * governance claim nobody made.
 */
export function parseGroundingMode(value: unknown): GroundingMode {
  return isGroundingMode(value) ? value : 'auto';
}

/**
 * The legacy `requireApproved` boolean, which predates this contract.
 *
 * Kept so older callers keep working. An explicit `groundingMode` always wins —
 * a caller that sends both is stating the mode deliberately.
 */
export function groundingModeFrom(mode: unknown, legacyRequireApproved?: boolean): GroundingMode {
  if (isGroundingMode(mode)) return mode;
  return legacyRequireApproved ? 'approved' : 'auto';
}

/** Modes in which every repo-reading tool must be withheld from the agent. */
export function groundingWithholdsTools(mode: GroundingMode): boolean {
  return mode === 'approved' || mode === 'none';
}

/** Modes permitted to consult the approved semantic index at all. */
export function groundingMayUseApprovedIndex(mode: GroundingMode): boolean {
  return mode === 'auto' || mode === 'approved';
}
