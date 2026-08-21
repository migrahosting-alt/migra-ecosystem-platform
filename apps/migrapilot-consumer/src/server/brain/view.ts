import 'server-only'

import type { BrainResult } from './gateway'
import type { GovernedCodingCapability } from './contracts'
import type { TranscriptionCapability } from '@migrapilot/shared-types/transcription'

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

/**
 * Whether a microphone may be offered, and if not, exactly why.
 *
 * Deliberately reduced to ONE thing the UI keys on. Each Brain state maps to a distinct,
 * user-meaningful cause so the composer never has to interpret a capability itself:
 *
 *   unavailable  the speech backend is off or not configured
 *   incompatible this build and the Brain disagree on the contract
 *   unreachable  temporary — the Brain could not be reached
 *   signed_out   no session
 *
 * Creole is reported separately from readiness on purpose. A ready English-only runtime is
 * still ready for English, and telling a Creole speaker the mic is "unavailable" would be
 * both wrong and unhelpful — they need to be told Creole specifically is not served yet.
 */
export type MicAvailability =
  | {
      state: 'ready'
      model: string | null
      multilingual: boolean
      supportedLanguages: string[]
      /** False when the active model cannot serve Haitian Creole. */
      creoleReady: boolean
      /** Present when ready for some languages but NOT Creole. */
      creoleReason?: string
    }
  | { state: 'disabled'; cause: 'unavailable' | 'incompatible' | 'unreachable' | 'signed_out'; reason: string }

export function micAvailability(result: BrainResult<TranscriptionCapability>): MicAvailability {
  /*
   * A 404 on a CAPABILITY probe is a contract mismatch, not a missing record.
   *
   * `not_found` normally means "no such conversation/run", which is genuinely `unavailable`.
   * But a capability endpoint either exists in the Brain or it does not, and a Brain that
   * does not serve this operation is a Brain older than this build. Reporting that as "the
   * Brain has no record for this request" sends someone looking for a setting; reporting it
   * as incompatible sends them to look at what is deployed — which is the actual answer.
   * Measured on production the day this was written: brain-service release persona-v4 has no
   * speech routes at all and answers 404.
   */
  if (result.kind === 'not_found') {
    return {
      state: 'disabled',
      cause: 'incompatible',
      reason:
        'This app expects a speech capability the connected Brain does not provide. The ' +
        'Brain is likely older than this build.',
    }
  }

  const view = toBrainView(result)
  if (view.state !== 'ready') {
    return { state: 'disabled', cause: view.state, reason: view.reason }
  }

  const capability = view.value
  if (capability.state !== 'ready') {
    return {
      state: 'disabled',
      cause: 'unavailable',
      reason: capability.unavailableReason ?? 'Speech input is not available on this workspace.',
    }
  }

  const creoleReady = capability.multilingual && capability.supportedLanguages.includes('ht')
  return {
    state: 'ready',
    model: capability.model,
    multilingual: capability.multilingual,
    supportedLanguages: capability.supportedLanguages,
    creoleReady,
    ...(creoleReady
      ? {}
      : {
          creoleReason:
            `Haitian Creole is not available on ${capability.model ?? 'the active model'}. ` +
            `Speaking Creole would be transcribed as invented English rather than refused, ` +
            `so it is not offered yet.`,
        }),
  }
}
