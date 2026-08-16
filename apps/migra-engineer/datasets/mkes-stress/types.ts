/**
 * MKES_STRESS — Haitian Creole speech stress set.
 *
 * Part of MKES, the Migra Kreyòl Evaluation Suite
 * (`/mnt/p/MigraAI-Engineer/evaluations/mkes/taxonomy.json`). This is the spoken
 * stress subset: authored utterances recorded under controlled conditions.
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────────
 *
 * A CASE is a linguistic unit: one authored utterance, one reference transcript.
 * A VARIANT is a recording of that same utterance under one acoustic condition.
 *
 *   MKES_STRESS_004  (Kreyòl + English code-switching)
 *     reference: <one authored transcript>
 *     variants:  clean  → MKES_STRESS_004_codeswitch_en.wav
 *                noise  → MKES_STRESS_004_codeswitch_en_noise.wav
 *
 * The transcript is NOT duplicated per variant. Same speaker, same words,
 * different microphone conditions — which is what makes this good ASR evidence:
 * hold the language constant and vary only the acoustics.
 *
 * But each recording is still reviewed INDEPENDENTLY. Two takes of the same
 * script are not the same performance; a speaker hesitates differently, drops a
 * word, or self-corrects on one take and not the other. Sharing the authored
 * reference does not mean assuming the delivery matched it.
 *
 * ── SOURCE EVIDENCE IS IMMUTABLE ─────────────────────────────────────────────
 *
 * The authoritative recordings live at
 *   /mnt/p/MigraAI-Engineer/training/datasets/kreyol-speech-source/raw
 *
 * They are never relocated, renamed, normalised, resampled or edited in place.
 * This catalogue REFERENCES them by measured filename, size, hash and format.
 * Any derived audio (denoised, resampled, segmented) belongs under a derived or
 * export path and never returns to `raw`.
 *
 * The Cubase `.cpr` files in that tree are session assets for re-editing a
 * recording. They are NOT a pipeline dependency: the dataset consumes stable
 * WAV artifacts plus hashes, so evaluation never requires opening a DAW.
 */

/** Acoustic condition of a recording, not a property of the language. */
export type AcousticCondition =
  | 'clean'
  /** Band-limited / phone-like capture. */
  | 'phone'
  /** Additive background noise. */
  | 'noise'
  /** Far-field / off-mic capture. */
  | 'distance'

export type AudioStatus = 'pending' | 'received' | 'validated' | 'rejected'

/** Whether the authored text has actually reached this catalogue. */
export type TranscriptStatus = 'awaiting-author' | 'authored' | 'released'

/** Whether a human has listened to this specific take. */
export type ReviewStatus = 'not-reviewed' | 'matches-reference' | 'deviates-from-reference'

export type EvaluationTag =
  | 'conversation'
  | 'named_entities'
  | 'geography'
  | 'numbers'
  | 'dates'
  | 'currency'
  | 'code_switch'
  | 'self_correction'
  | 'instruction_sequence'
  | 'prosody'
  | 'culture'
  | 'long_context_reasoning'
  | 'acoustic_robustness'

export interface NamedEntityTarget {
  surface: string
  type: 'PERSON' | 'PLACE' | 'ORG'
}

export interface NumericTarget {
  surface: string
  kind: 'date' | 'time' | 'count' | 'currency'
  /** Normalised value, ONLY where the author stated it. Never inferred. */
  value?: string
}

export interface TranscriptRule {
  rule: string
  rationale: string
}

export interface ConsentScope {
  permitted: string[]
  /**
   * Voice cloning is listed here always and explicitly: consent to contribute
   * speech to a dataset is NOT consent to synthesise that person's voice, and
   * the two must never be collapsed by inference.
   */
  withheld: string[]
}

/**
 * One recording. Every field below is MEASURED from the file on disk — never
 * estimated, never defaulted. A recording that has not arrived has no entry.
 */
export interface RecordingVariant {
  filename: string
  condition: AcousticCondition
  status: AudioStatus
  bytes?: number
  sha256?: string
  durationMs?: number
  sampleRateHz?: number
  channels?: number
  bitDepth?: number
  /**
   * Reviewed per take, not per case.
   *
   * `matches-reference` may only be set by a human who listened. A take that
   * deviates keeps the case's authored reference AND records what was actually
   * said, because the deviation is data, not an error to be tidied away.
   */
  review: ReviewStatus
  /** What the speaker actually said on THIS take, when it differs. */
  spokenDeviation?: string
}

/** A linguistic case: one authored utterance, recorded under one or more conditions. */
export interface MkesStressCase {
  id: string
  kind: 'speech'
  suite: 'MKES_STRESS'
  version: string
  language: 'ht'
  /**
   * The authored utterance, shared by every variant. `null` until its author
   * supplies it. Immutable once released; orthographic normalisation is a
   * derived representation under a new version, never an overwrite.
   */
  referenceTranscript: string | null
  transcriptStatus: TranscriptStatus
  purpose: string
  variants: RecordingVariant[]
  evaluationTags: EvaluationTag[]
  codeSwitchLanguages: ('en' | 'fr')[]
  namedEntities: NamedEntityTarget[]
  numericTargets: NumericTarget[]
  transcriptRules: TranscriptRule[]
  provenance: { author: string; authoredFor: string; sourceDirectory: string }
  consentScope: ConsentScope
  datasetRole: 'held-out-evaluation'
  trainingEligible: false
  notes?: string
}

/**
 * A negative acoustic control: room tone, no speech.
 *
 * Deliberately a DIFFERENT type from a speech case, because it has no authored
 * utterance and scoring it with WER would be meaningless. Its purpose is the
 * opposite: many ASR systems invent words from room noise, and a system that
 * transcribes silence into plausible Kreyòl is broken in a way no
 * speech-accuracy metric would reveal.
 *
 * `expectation.transcript` stays null until a human has listened and confirmed
 * the recording genuinely contains no speech. Asserting "empty" for a file
 * nobody has heard would be inventing the ground truth.
 */
export interface MkesAcousticControl {
  id: string
  kind: 'acoustic-control'
  suite: 'MKES_STRESS'
  version: string
  purpose: string
  variants: RecordingVariant[]
  expectation: {
    speechDetected: false
    /** Null until confirmed by listening. Expected to be the empty string. */
    transcript: string | null
    hallucinatedSpeech: 'none'
    confirmedByHuman: boolean
  }
  evaluationTags: EvaluationTag[]
  provenance: { author: string; authoredFor: string; sourceDirectory: string }
  consentScope: ConsentScope
  datasetRole: 'held-out-evaluation'
  trainingEligible: false
  notes?: string
}

export type MkesStressEntry = MkesStressCase | MkesAcousticControl

export interface MkesStressManifest {
  suite: 'MKES_STRESS'
  version: string
  language: 'ht'
  createdAt: string
  datasetRole: 'held-out-evaluation'
  /** Read-only source of every recording referenced below. */
  sourceDirectory: string
  entries: MkesStressEntry[]
}

export const isSpeechCase = (e: MkesStressEntry): e is MkesStressCase => e.kind === 'speech'
