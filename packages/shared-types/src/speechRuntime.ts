/**
 * The Speech Runtime boundary — one governed interface, whatever is behind it.
 *
 * 🚨 CHAT MUST NOT KNOW WHAT THE BACKEND IS. Not Whisper, not faster-whisper,
 * not whatever replaces them. The moment a Chat code path branches on a model
 * name, swapping the model becomes a Chat change, and the attachment pipeline
 * has to be re-proven for a decision that was never about attachments. Audio
 * goes in; a transcript with its provenance comes out.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `transcription.ts`. That file already owns
 * the transcript PAYLOAD — status, warnings, confidence, Kreyòl normalisation —
 * and is actively developed by the Engineer lane. This module owns the BOUNDARY:
 * what is asked of a runtime, what identity it must return, and how it fails.
 * It imports the payload rather than restating it, because two definitions of a
 * transcript is how the two lanes would drift apart.
 *
 * ── THE TWO WORKFLOWS ARE RELATED AND NOT THE SAME FEATURE ──
 *
 * MICROPHONE: speech becomes the USER'S OWN TURN. It is ephemeral, latency
 * matters, and the output is text the person is about to send as themselves.
 * Nothing is stored as a document. Getting it wrong wastes a moment.
 *
 * ATTACHMENT: an uploaded file is a PERSISTENT ARTIFACT. It is transcribed once,
 * kept, and answered from later with provenance, exactly like a PDF — "summarise
 * this recording", "what did the second speaker say". Latency barely matters and
 * durability does. Getting it wrong puts a wrong transcript in someone's library
 * and cites it for months.
 *
 * Collapsing them would force one set of trade-offs onto both. They share this
 * interface and a payload type; they do not share a workflow.
 *
 * NOT MODEL QUALIFICATION. Which ASR model is good enough — for Haitian Creole
 * above all — is Engineer's question, once a runtime exists to qualify. This
 * file only makes the answer replaceable.
 */

import type { TranscriptionResult } from './transcription.js'

/**
 * Which runtime and which model produced a transcript.
 *
 * 🚨 BOTH, NOT JUST THE MODEL. `TranscriptionResult.model` already names the
 * model, and a model name alone cannot distinguish two deployments of the same
 * weights with different versions, decoding settings or hardware. When a
 * transcript is later found to be wrong, the question is "what produced this",
 * and a runtime that cannot answer it makes every past transcript unauditable.
 */
export interface SpeechRuntimeIdentity {
  /** The runtime service, e.g. its deployment name. Never a Chat-side constant. */
  runtime: string
  /** Version of that runtime, so a redeploy is distinguishable. */
  runtimeVersion: string
  /** The model it served this request with. */
  model: string
}

/**
 * A timed span of transcript, when the runtime can produce one.
 *
 * OPTIONAL BY DESIGN. Some runtimes return word or segment timings and some do
 * not, and a contract that demanded them would exclude a perfectly good runtime
 * — or invite one to invent them. Absent means "not offered", never "the audio
 * had no speech there".
 */
export interface TranscriptionSegment {
  startMs: number
  endMs: number
  text: string
  /** Present only when the runtime reports per-segment confidence. */
  confidence?: number
}

/** Where a transcription attempt stopped. Named so an operator can act. */
export type SpeechRuntimeFailureStage =
  /** No runtime is configured at all — the state Chat is in today. */
  | 'not_configured'
  /** Configured, but nothing answered. */
  | 'unreachable'
  /** The runtime answered that it will not take this input. */
  | 'rejected_input'
  /** The audio could not be decoded. */
  | 'undecodable_audio'
  /** It ran and gave up — timeout, resource exhaustion, model error. */
  | 'transcription_failed'

/**
 * A failure a caller can act on, and a user can be told about truthfully.
 *
 * 🚨 A STAGE, NOT A MESSAGE. "Transcription failed" cannot distinguish "we never
 * set this up" from "your file is corrupt", and those need opposite words to the
 * user and opposite actions from an operator. The product's own refusal copy is
 * chosen from `stage`, never from `detail`, which is for logs.
 */
export interface SpeechRuntimeFailure {
  stage: SpeechRuntimeFailureStage
  /** Operator-facing detail. Never rendered to a user, never carries credentials. */
  detail: string
  /** Whether trying the same input again could plausibly succeed. */
  retryable: boolean
}

/** What Chat asks a runtime for. The two workflows are named, not inferred. */
export interface SpeechRuntimeRequest {
  /**
   * WHICH WORKFLOW. Declared by the caller rather than guessed from the audio,
   * because the same recording can legitimately arrive either way and the
   * durability, provenance and latency expectations differ completely.
   */
  workflow: 'microphone' | 'attachment'
  audioMime: string
  audioBytes: number
  /**
   * A language to transcribe as, when the user has chosen one.
   *
   * Absent means DETECT, not "assume English". A forced language is recorded in
   * the result as forced — see `TranscriptionResult.forcedLanguage` — because a
   * language that was imposed is not evidence of what was spoken.
   */
  requestedLanguage?: string
}

/**
 * What a runtime returns. Success carries provenance; failure carries a stage.
 *
 * A discriminated union rather than a nullable transcript, so a caller cannot
 * read `text` off a failed attempt and render an empty string as a transcript.
 */
export type SpeechRuntimeOutcome =
  | {
      ok: true
      result: TranscriptionResult
      identity: SpeechRuntimeIdentity
      /** Present only when the runtime produced timings. */
      segments?: TranscriptionSegment[]
    }
  | { ok: false; failure: SpeechRuntimeFailure }

/**
 * What Chat may say about audio right now.
 *
 * 🚨 THE HONEST DEFAULT IS `not_configured`, and today that is the real state.
 * This exists so the product describes the gap from one place — the policy
 * refusal, the composer's disabled controls and any future capability answer all
 * reading the same fact instead of three hand-written sentences drifting apart.
 */
export interface SpeechRuntimeCapability {
  state: 'ready' | 'not_configured'
  identity?: SpeechRuntimeIdentity
  /** Which workflows the runtime will serve. A runtime may offer one and not the other. */
  workflows: ReadonlyArray<'microphone' | 'attachment'>
  /** Why it is unavailable, chosen from a stage rather than free text. */
  unavailable?: SpeechRuntimeFailureStage
}

/** The state of the world today: nothing configured, nothing claimed. */
export const NO_SPEECH_RUNTIME: SpeechRuntimeCapability = {
  state: 'not_configured',
  workflows: [],
  unavailable: 'not_configured',
}

/**
 * May Chat offer audio for this workflow?
 *
 * Asked per workflow, because a runtime that transcribes uploaded files is not
 * automatically one that should serve a live microphone, and claiming both from
 * one flag is how a product promises what it cannot do.
 */
export function speechWorkflowAvailable(
  capability: SpeechRuntimeCapability,
  workflow: 'microphone' | 'attachment',
): boolean {
  return capability.state === 'ready' && capability.workflows.includes(workflow)
}
