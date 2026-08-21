import 'server-only'

import type { BrainResult } from './gateway'
import type { GovernedCodingCapability } from './contracts'

/**
 * ONE honest translation from a Brain result to something a screen may render.
 *
 * Every module needs to answer the same question — "may I show this, and if not,
 * what do I tell the user?" — and if each screen answers it privately they drift:
 * one renders a spinner forever, one shows an empty list that looks like "you have
 * nothing", one invents a believable placeholder. A shared mapper is what stops
 * modules becoming hard-coded islands.
 *
 * The states are deliberately distinguishable. "The Brain says this feature is off"
 * and "the Brain could not be reached" and "your session is gone" are three different
 * facts, and collapsing them into one grey box is how a product starts lying about
 * readiness. NOTHING here invents a fallback value: absence stays absence.
 */
export type BrainView<T> =
  /** The Brain answered and the value may be shown. */
  | { state: 'ready'; value: T }
  /** The Brain answered, and the answer is "not available" — with its reason. */
  | { state: 'unavailable'; reason: string }
  /** THE CONTRACT DOES NOT MATCH. This build asked for something the Brain does not
   *  accept, so the surface refuses rather than degrading silently. */
  | { state: 'incompatible'; reason: string }
  /** The Brain could not be reached at all. Not the same as "off". */
  | { state: 'unreachable'; reason: string }
  /** No live session. The screen must not render tenant data. */
  | { state: 'signed_out'; reason: string }

export function toBrainView<T>(result: BrainResult<T>): BrainView<T> {
  switch (result.kind) {
    case 'ok':
      return { state: 'ready', value: result.value }
    case 'unauthenticated':
      return { state: 'signed_out', reason: result.detail }
    case 'tenancy_unresolved':
      return { state: 'unavailable', reason: `Workspace could not be resolved: ${result.detail}` }
    case 'invalid_operation':
      // The published capability contract and this build disagree. Refusing is the
      // point: a surface that guesses past a contract mismatch is how a bad update
      // becomes silent breakage instead of a clean, visible rejection.
      return { state: 'incompatible', reason: result.detail }
    case 'not_found':
      return { state: 'unavailable', reason: 'The Brain has no record for this request.' }
    case 'conflict':
      return { state: 'unavailable', reason: `The Brain reported a conflict (HTTP ${result.status}).` }
    case 'brain_error':
      return { state: 'unavailable', reason: `The Brain returned an error (HTTP ${result.status}).` }
    case 'timeout':
      return { state: 'unreachable', reason: `The Brain did not respond in time: ${result.detail}` }
    case 'transport_failure':
      return { state: 'unreachable', reason: `The Brain could not be reached: ${result.detail}` }
  }
}

/** What a screen is allowed to say about governed coding. */
export type GovernedCodingView =
  | { state: 'ready'; approvalMode: 'scope'; progressMode: 'polling'; workspaceRootsConfigured: number }
  | { state: 'unavailable'; reason: string }
  | { state: 'incompatible'; reason: string }
  | { state: 'unreachable'; reason: string }
  | { state: 'signed_out'; reason: string }

/**
 * Applies the gate the seam documents: available AND workspaceRootsConfigured > 0.
 *
 * `available: true` with zero configured roots is NOT ready — it is a capability with
 * nowhere to act, and showing it as ready would promise the user something no run can
 * deliver. The gate lives here so no screen can forget half of it.
 */
export function governedCodingView(
  result: BrainResult<{ governedCoding: GovernedCodingCapability }>,
): GovernedCodingView {
  const view = toBrainView(result)
  if (view.state !== 'ready') return view
  const c = view.value.governedCoding
  if (!c.available) {
    return { state: 'unavailable', reason: c.unavailableReason ?? 'Governed coding is switched off for this workspace.' }
  }
  if (c.workspaceRootsConfigured <= 0) {
    return { state: 'unavailable', reason: 'No workspace root is configured, so no coding run can be started yet.' }
  }
  return {
    state: 'ready',
    approvalMode: c.approvalMode,
    progressMode: c.progressMode,
    workspaceRootsConfigured: c.workspaceRootsConfigured,
  }
}
