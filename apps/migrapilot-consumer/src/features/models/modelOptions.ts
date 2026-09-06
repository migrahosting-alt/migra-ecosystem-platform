/**
 * The rows the model menu offers, as data.
 *
 * Split out from the component because the requirements here are decisions, not
 * markup: which families appear, which can be chosen, what each row says, and —
 * the one that caused the redesign — WHERE the governance reason is allowed to
 * be read. A rule that only exists inside JSX can only be checked by looking at
 * JSX, and the previous leak survived exactly that long.
 *
 * 🚨 THE RULE THIS ENCODES. An unavailable family stays listed and stays
 * unselectable, carrying its real reason. The reason belongs to the OPENED menu.
 * It must never be rendered on the chat page at rest, where four such sentences
 * stacked above the composer read as a system in trouble rather than as the
 * deliberate, governed state they describe.
 */

import { humanUnavailableReason, leaksInternalIdentifier } from './unavailableReason'
import type { MigraFamilyView } from './useModelFamilies'

/** What the closed control says when the server is left to route. */
export const AUTOMATIC_LABEL = 'Automatic'

export const AUTOMATIC_HINT = 'MigraPilot picks the right Migra model for each message.'

export interface ModelOption {
  /** undefined = Automatic: let the server route, which is the governed default. */
  id: string | undefined
  label: string
  /**
   * The single line under the name. For an available family this is its tagline;
   * for a blocked one the reason REPLACES it, because showing what a family is
   * for beside why it cannot be picked is how a dead control reads.
   */
  hint: string
  available: boolean
  recommended: boolean
  /** Rendered as a small status chip beside the name, inside the menu only. */
  status?: 'unavailable'
}

/**
 * A short, honest note for a family that cannot be chosen.
 *
 * Translated, never passed through: the resolver's reasons name the internal
 * governed capability, and rendering them verbatim put `chat.general` and three
 * more like it in front of users.
 *
 * The guard is the point of the second line. `humanUnavailableReason` translates
 * every shape it recognises, but a shape added later would otherwise reach the
 * screen with no test failing — so anything still carrying an identifier is
 * replaced here rather than rendered.
 */
export function unavailableNote(family: MigraFamilyView): string {
  const note = humanUnavailableReason(family)
  return leaksInternalIdentifier(note) ? `${family.displayName} isn’t available right now.` : note
}

/**
 * Build the menu rows.
 *
 * Automatic is always first: it is the default, and the only way back once a
 * family has been chosen. Families follow in catalog order — this layer does not
 * reorder them, because the catalog's order is the Brain's decision and a UI
 * that sorts by availability would quietly bury a family the owner put first.
 */
export function buildModelOptions(families: readonly MigraFamilyView[]): ModelOption[] {
  return [
    {
      id: undefined,
      label: AUTOMATIC_LABEL,
      hint: AUTOMATIC_HINT,
      available: true,
      recommended: false,
    },
    ...families.map((f): ModelOption => ({
      id: f.id,
      label: f.displayName,
      hint: f.available ? f.tagline : unavailableNote(f),
      available: f.available,
      recommended: f.recommended,
      ...(f.available ? {} : { status: 'unavailable' as const }),
    })),
  ]
}

/**
 * What the CLOSED control says.
 *
 * Only ever "Automatic" or the selected family's product name — never a model,
 * never an id, and never a status. The collapsed state is not where availability
 * is reported; that is the menu's job.
 */
export function collapsedLabel(
  families: readonly MigraFamilyView[],
  selected: string | undefined,
): string {
  const match = families.find((f) => f.id === selected)
  return match?.displayName ?? AUTOMATIC_LABEL
}

/**
 * May this id be selected?
 *
 * `undefined` (Automatic) always may. A family may only when it is available —
 * a stored choice can go stale between visits, and honouring it would silently
 * resurrect a selection the system can no longer serve.
 */
export function selectable(
  families: readonly MigraFamilyView[],
  id: string | undefined,
): boolean {
  if (id === undefined) return true
  return families.find((f) => f.id === id)?.available === true
}
