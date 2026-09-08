/**
 * WHAT THE ACTION HUB MAY OFFER — decided from authorities, never from a list
 * of buttons someone typed.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PROBLEM THIS REPLACES
 *
 * The composer's rows were a hardcoded array, and each one decided its own
 * availability with its own probe. That shape has already produced two real
 * defects in this codebase: a row that was live for signed-out visitors while
 * everything behind it needed an account, and a paperclip that opened a picker
 * for a chat that could not receive a file. A button is a promise, and a
 * hardcoded button is a promise nobody checked.
 *
 * It also does not scale to where Chat is going. Web, Maps, Email, Drive and
 * GitHub must join by REGISTRATION, not by another hardcoded row and another
 * bespoke availability hook.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, STATED ONCE
 *
 * A row exists only if something real backs it:
 *
 *   local     a surface this app implements itself (photos, files, library).
 *             Its readiness comes from the same probe it always did — the
 *             difference is that the CATALOG declares the dependency instead
 *             of the component inlining it.
 *
 *   registry  a capability the ENGINE executes. It renders only when the id is
 *             actually present in the capability registry. Not registered
 *             means NOT SHOWN — not shown greyed out, not shown "coming soon".
 *             An unregistered capability is not a thing that exists yet, and
 *             offering it would be the button-pretending-to-be-a-capability
 *             problem in a new costume.
 *
 * Registered but unavailable is a DIFFERENT fact and does render, carrying the
 * engine's own reason — because the user has one, it simply cannot run right
 * now, and silence there would look like it was never built.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS PURE
 *
 * No fetch, no React, no DOM. The decision that governs what a user is offered
 * is a function of two inputs, so it can be tested exhaustively rather than
 * inferred from a rendered menu.
 */

/** A capability as the engine describes it. Exactly the registry's own shape. */
export interface RegistryCapability {
  id: string
  displayName: string
  description: string
  category: string
  readOnly: boolean
  approvalRequired: boolean
  /** The ENGINE's decision, never re-derived here. */
  available: boolean
  /** Present when the engine explains why it is not available. */
  unavailableReason?: string
}

/** Readiness of a surface this app implements itself. */
export interface LocalReadiness {
  ready: boolean
  /** The authority's own words. Required when not ready. */
  reason?: string
}

export type CapabilitySource =
  | { kind: 'local'; readiness: LocalReadiness | null }
  | { kind: 'registry'; capabilityId: string }

/** A row the catalog declares. Its EXISTENCE is still decided by its source. */
export interface CatalogEntry {
  id: string
  label: string
  hint: string
  icon: string
  source: CapabilitySource
}

export interface ResolvedCapability {
  id: string
  label: string
  hint: string
  icon: string
  /** Absent when the capability can run. Present, with the authority's own
   *  words, when it is real but cannot run right now. */
  unavailableReason?: string
}

/**
 * Resolve the catalog against the authorities.
 *
 * Order is preserved from the catalog, so the menu does not reshuffle itself as
 * probes settle — a control that moves while someone is reaching for it is its
 * own small betrayal.
 */
export function resolveCapabilities(input: {
  catalog: readonly CatalogEntry[]
  /** null while the registry has not answered yet — NOT the same as empty. */
  registry: readonly RegistryCapability[] | null
}): ResolvedCapability[] {
  const byId = new Map((input.registry ?? []).map((c) => [c.id, c]))
  const rows: ResolvedCapability[] = []

  for (const entry of input.catalog) {
    if (entry.source.kind === 'local') {
      const readiness = entry.source.readiness
      /*
       * A probe still in flight renders the row as not-yet-ready rather than
       * hiding it. Hiding would make the menu grow under the user's cursor;
       * claiming ready would offer a control that may fail on click.
       */
      if (!readiness) {
        rows.push({ ...strip(entry), unavailableReason: 'Checking…' })
        continue
      }
      rows.push(
        readiness.ready
          ? strip(entry)
          : {
              ...strip(entry),
              // The authority's words. This layer never writes its own excuse.
              unavailableReason: readiness.reason ?? 'This is not available right now.',
            },
      )
      continue
    }

    /*
     * REGISTRY-BACKED. Absence is the whole point: until the engine registers
     * the capability, there is nothing to offer and the row does not exist.
     *
     * `registry === null` means we have not asked yet, which is also not a
     * reason to invent a row — so the same omission applies.
     */
    const capability = byId.get(entry.source.capabilityId)
    if (!capability) continue

    rows.push(
      capability.available
        ? strip(entry)
        : {
            ...strip(entry),
            unavailableReason:
              capability.unavailableReason ?? `${capability.displayName} is not available right now.`,
          },
    )
  }

  return rows
}

const strip = (entry: CatalogEntry): ResolvedCapability => ({
  id: entry.id,
  label: entry.label,
  hint: entry.hint,
  icon: entry.icon,
})
