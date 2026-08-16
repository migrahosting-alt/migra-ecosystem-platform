/**
 * MKES_STRESS — Haitian Creole speech/text stress set.
 *
 * Ten authored utterances, each probing a capability we know models fail at.
 * Recorded by Bonex; the WAV files arrive separately from the text.
 *
 * TWO RULES SHAPE THIS WHOLE FILE.
 *
 * 1. HELD-OUT FIRST. Each item probes a named capability, which is exactly what
 *    makes it valuable as a benchmark and dangerous as training data. Train on
 *    these and then score against them and the number means nothing. They are
 *    evaluation evidence; training material is built separately around the same
 *    linguistic categories. `datasetRole` and `trainingEligible` carry that in
 *    the schema rather than in a convention someone can forget.
 *
 * 2. NOTHING IS ASSERTED BEFORE IT EXISTS. A reference transcript is present
 *    only when its author supplied it; an audio artifact is present only when
 *    the WAV arrives. Duration, sample rate, speaker identity, acoustic
 *    properties, emotion, transcription confidence and ASR metrics are ABSENT
 *    fields until measured — never defaults, never estimates. A benchmark that
 *    invents its own reference is worse than no benchmark.
 */

export type AudioStatus = 'pending' | 'received' | 'validated' | 'rejected'

/**
 * Whether the authored text has actually reached the manifest.
 *
 * Separate from audio on purpose: text and recordings arrive independently, and
 * the pipeline must be honest about each. `awaiting-author` means exactly what
 * it says — the slot is prepared and empty, not filled with a guess.
 */
export type TranscriptStatus = 'awaiting-author' | 'authored' | 'released'

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

/** A named entity the recognizer must preserve, with its type. */
export interface NamedEntityTarget {
  surface: string
  type: 'PERSON' | 'PLACE' | 'ORG'
}

/** A quantity, date, time or amount that must survive recognition intact. */
export interface NumericTarget {
  surface: string
  kind: 'date' | 'time' | 'count' | 'currency'
  /** Normalised value, ONLY where the author stated it. Never inferred. */
  value?: string
}

/**
 * A rule the transcript must obey, and that a "helpful" pipeline would break.
 *
 * These exist because the usual defaults are wrong here: ASR and normalisers
 * translate code-switched words into the matrix language, and clean disfluency
 * out of self-corrections. Both destroy the exact signal being measured.
 */
export interface TranscriptRule {
  rule: string
  rationale: string
}

export interface ConsentScope {
  /** What the speaker agreed this recording may be used for. */
  permitted: string[]
  /**
   * Explicitly withheld uses.
   *
   * Voice cloning is listed separately and always: consent to contribute speech
   * to a dataset is NOT consent to synthesise that person's voice, and the two
   * must never be collapsed by inference.
   */
  withheld: string[]
}

export interface AudioArtifact {
  filename: string
  status: AudioStatus
  /**
   * Everything below is measured from the file, never predicted.
   * Absent while `status` is `pending`.
   */
  sha256?: string
  bytes?: number
  durationMs?: number
  sampleRateHz?: number
  channels?: number
  receivedAt?: string
}

export interface MkesStressItem {
  id: string
  suite: 'MKES_STRESS'
  version: string
  language: 'ht'
  /**
   * The utterance as authored. `null` until the author supplies it — see
   * `transcriptStatus`. Immutable once the version is released; any
   * orthographic normalisation is a derived representation under a new version,
   * never an overwrite of this field.
   */
  referenceTranscript: string | null
  transcriptStatus: TranscriptStatus
  audio: AudioArtifact
  purpose: string
  evaluationTags: EvaluationTag[]
  /** Languages deliberately mixed in. Empty means monolingual Haitian Creole. */
  codeSwitchLanguages: ('en' | 'fr')[]
  namedEntities: NamedEntityTarget[]
  numericTargets: NumericTarget[]
  transcriptRules: TranscriptRule[]
  provenance: {
    author: string
    authoredFor: string
    /** Attached when the WAV arrives; absent until then. */
    recordedAt?: string
    recordingDevice?: string
  }
  consentScope: ConsentScope
  /** Held-out benchmark, or material eligible to train on. */
  datasetRole: 'held-out-evaluation'
  trainingEligible: false
  notes?: string
}

export interface MkesStressManifest {
  suite: 'MKES_STRESS'
  version: string
  language: 'ht'
  createdAt: string
  datasetRole: 'held-out-evaluation'
  items: MkesStressItem[]
}
