/**
 * Turn a governance reason into something a person should read.
 *
 * The resolver's reasons are written for operators and name the internal
 * governed capability: "no approved model for chat.general". Rendering that in
 * the product put `chat.general`, `reasoning.deep`, `chat.fast` and
 * `chat.long_context` under the model picker — four lines of engineering
 * vocabulary telling a user nothing they can act on, and reading like a
 * malfunction rather than a deliberate state. It is the same leak as the mic
 * tooltip that once showed an internal operation name.
 *
 * The families stay visible and disabled, which is the selector's documented
 * intent: hiding one would look like the capability never existed. Only the
 * words change.
 *
 * TRANSLATE, DON'T PASS THROUGH. An unrecognised reason falls back to a generic
 * line rather than being rendered verbatim, because the failure mode being fixed
 * is precisely an internal string reaching the screen — and a reason shape added
 * later would otherwise leak the same way with no test failing.
 */

/** The identifier shape this must never render: `chat.general`, `vision.general`. */
const CAPABILITY_ID = /\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/

const NO_APPROVED_MODEL = /^no approved model for\s+\S+$/i
const APPROVED_NOT_INSTALLED = /^the approved model for\s+\S+\s+is not installed$/i
const NO_MODEL_MEETS = /^no installed model meets\s+(.+?)'s requirements$/i

export interface UnavailableFamily {
  displayName: string
  unavailableReason?: string
}

/**
 * A short, honest sentence naming the family and why it cannot be chosen.
 *
 * Each branch says something a reader can act on — wait for an approval, or
 * install something — without naming the capability, the model, or the store
 * the decision lives in.
 */
export function humanUnavailableReason(family: UnavailableFamily): string {
  const raw = (family.unavailableReason ?? '').trim()
  const name = family.displayName

  if (NO_APPROVED_MODEL.test(raw)) {
    // Nothing is wrong; nothing has been approved yet. Say that plainly rather
    // than implying a fault the user could do something about.
    return `${name} isn’t available yet — no model has been approved for it.`
  }
  if (APPROVED_NOT_INSTALLED.test(raw)) {
    // This one IS a fault, and a different one: approved, but missing.
    return `${name} is temporarily unavailable — its approved model isn’t installed.`
  }
  const meets = NO_MODEL_MEETS.exec(raw)
  if (meets) {
    return `${name} isn’t available — no installed model meets its requirements.`
  }
  return `${name} isn’t available right now.`
}

/**
 * Belt and braces for the property that actually matters.
 *
 * Exported so the component and the tests assert the same thing: whatever we
 * render, it contains no internal identifier. A future reason shape that slips
 * past the branches above still cannot leak one.
 */
export function leaksInternalIdentifier(text: string): boolean {
  return CAPABILITY_ID.test(text)
}
