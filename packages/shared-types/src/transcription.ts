/**
 * The shared speech-to-text capability boundary.
 *
 * WHY A SHARED CONTRACT, AND WHY THESE FIELDS. The Command Center owned a private ASR
 * implementation that returned `{ text }` and nothing else. That shape cannot express the
 * failure that matters: Whisper forced to a language it is not hearing does not produce
 * obvious errors, it produces CONFIDENT, FLUENT TEXT FROM ITS TRAINING DATA. Measured on
 * this stack — French speech "Bonjour, je voudrais un résumé du document." came back as
 * "I hope you enjoyed this video and like and subscribe to my channel."
 *
 * A fluent transcript is not proof the ASR heard the user. So the contract carries what a
 * caller needs to DOUBT a transcript: which language was detected, which was requested, how
 * confident the detection was, which model produced it, and explicit warnings. A surface
 * that cannot see those cannot refuse, and would submit words the user never spoke.
 */

/** Haitian Creole is a first-class target, not an afterthought. */
export const HAITIAN_CREOLE = 'ht'

export type TranscriptionStatus =
  /** Safe to use as the user's own words. */
  | 'ok'
  /** Plausible, but the user must confirm before it becomes their message. */
  | 'needs_confirmation'
  /** Nothing usable was heard. Never submit. */
  | 'unusable'
  /** The pipeline itself failed. */
  | 'failed'

export type TranscriptionWarningCode =
  /** An English-only model transcribed audio not known to be English — it CANNOT report
   *  anything else, so a fluent result here is unverified by construction. */
  | 'english_only_model'
  /** Detection probability below the accepted threshold. */
  | 'low_confidence'
  /** A language was imposed rather than detected. */
  | 'forced_language'
  /** Nothing was heard. */
  | 'empty_transcript'
  /** Repeated phrases — the signature of a model looping on training data. */
  | 'repetition_detected'

export interface TranscriptionWarning {
  code: TranscriptionWarningCode
  message: string
}

/**
 * Provenance is kept separate from content ON PURPOSE. A transcript is machine-derived text
 * about audio, never the audio itself, and a turn built from one must remain distinguishable
 * from something the user typed.
 */
export interface TranscriptionProvenance {
  kind: 'machine-transcribed'
  audioBytes: number
  audioMime: string
}

export interface TranscriptionResult {
  text: string
  /** What the model says it heard. `null` when the model cannot detect (English-only). */
  detectedLanguage: string | null
  /** What the USER asked for. `null` means auto-detect, which is the DEFAULT. */
  requestedLanguage: string | null
  /**
   * What the decoder was actually told to assume. `null` means it was free to detect.
   *
   * Kept separate from `requestedLanguage` because they diverge, and the divergence is
   * dangerous: a runtime pins "en" for an English-only model by itself. Collapsing the two
   * once already disabled the fabrication guard — French audio returned status "ok" with
   * fluent invented English. Requested is a CHOICE; forced is a MECHANISM; detected is an
   * OBSERVATION. Three different facts, three fields.
   */
  forcedLanguage: string | null
  /** Detection probability 0..1, or `null` when detection did not happen. */
  confidence: number | null
  model: string
  /** Wall-clock milliseconds spent transcribing. */
  durationMs: number
  status: TranscriptionStatus
  warnings: TranscriptionWarning[]
  provenance: TranscriptionProvenance
}

/** What a surface must consult before enabling a microphone. */
export interface TranscriptionCapability {
  state: 'ready' | 'unavailable'
  model: string | null
  /** False for any `.en` model: it cannot produce or detect another language. */
  multilingual: boolean
  supportedLanguages: string[]
  unavailableReason?: string
}

/** Default floor for accepting a detected language without confirmation. */
export const DEFAULT_MIN_CONFIDENCE = 0.6

/**
 * Detects a model looping on its own output.
 *
 * Grounded in observed behaviour, not theory: the English-only model given French returned
 * "I will never get you to be a You will never get me to be a You will never get me to be
 * a". Fluent, confident, and repeating — which is the tell.
 */
export function hasRepetition(text: string): boolean {
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean)
  if (words.length < 8) return false

  const repeats = (size: number, times: number): boolean => {
    if (words.length < size) return false
    const seen = new Map<string, number>()
    for (let i = 0; i + size <= words.length; i += 1) {
      const phrase = words.slice(i, i + size).join(' ')
      const count = (seen.get(phrase) ?? 0) + 1
      seen.set(phrase, count)
      if (count >= times) return true
    }
    return false
  }

  // TWO SIGNATURES, both taken from real failures rather than guessed.
  //
  // A long phrase repeated even ONCE is the giveaway: the observed output was "I will never
  // get you to be a You will never get me to be a You will never get me to be a" — an
  // eight-word span twice over. An earlier version required a 4-word phrase three times and
  // missed it, because the loop was longer and looser than that. People do not restate six
  // identical words inside one dictated sentence; a model stuck on its own output does.
  //
  // The short-phrase rule still catches tight loops ("no no no no ...").
  return repeats(6, 2) || repeats(4, 3)
}

export interface RawTranscription {
  text: string
  detectedLanguage: string | null
  requestedLanguage: string | null
  /** What the decoder was told. Defaults to the request, or to nothing. */
  forcedLanguage?: string | null
  confidence: number | null
  model: string
  /** True when the model can only ever produce English. */
  englishOnly: boolean
  durationMs: number
  provenance: TranscriptionProvenance
}

/**
 * Turn a raw worker result into a contract result, applying the rules ONCE so no surface
 * has to remember them.
 *
 * The central rule: a transcript is only `ok` when the pipeline could actually have heard
 * a wrong language and didn't. An English-only model given audio nobody asked to be treated
 * as English can never reach `ok`, however fluent the text — that is precisely the case
 * that produced a YouTube sign-off from a French sentence.
 */
export function assessTranscription(
  raw: RawTranscription,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): TranscriptionResult {
  const warnings: TranscriptionWarning[] = []
  const text = raw.text.trim()

  if (!text) {
    warnings.push({ code: 'empty_transcript', message: 'No speech was detected in the recording.' })
  }

  if (raw.englishOnly && raw.requestedLanguage !== 'en') {
    warnings.push({
      code: 'english_only_model',
      message:
        `${raw.model} can only produce English. If the speaker used another language this ` +
        `transcript is invented, not heard — confirm it before sending.`,
    })
  }

  if (raw.requestedLanguage && !raw.englishOnly) {
    warnings.push({
      code: 'forced_language',
      message: `Transcribed as "${raw.requestedLanguage}" because it was requested, not detected.`,
    })
  }

  if (!raw.englishOnly && !raw.requestedLanguage && raw.confidence !== null && raw.confidence < minConfidence) {
    warnings.push({
      code: 'low_confidence',
      message: `The language was detected with only ${Math.round(raw.confidence * 100)}% confidence.`,
    })
  }

  if (text && hasRepetition(text)) {
    warnings.push({
      code: 'repetition_detected',
      message: 'The transcript repeats itself, which usually means the model was not hearing speech.',
    })
  }

  const status: TranscriptionStatus = !text
    ? 'unusable'
    : warnings.length > 0
      ? 'needs_confirmation'
      : 'ok'

  return {
    text,
    detectedLanguage: raw.detectedLanguage,
    requestedLanguage: raw.requestedLanguage,
    // An English-only model is pinned to "en" whether or not anyone asked.
    forcedLanguage: raw.forcedLanguage ?? raw.requestedLanguage ?? (raw.englishOnly ? 'en' : null),
    confidence: raw.confidence,
    model: raw.model,
    durationMs: raw.durationMs,
    status,
    warnings,
    provenance: raw.provenance,
  }
}

/**
 * May this transcript become the user's message without them looking at it?
 *
 * Only a clean `ok`. Everything else is shown for confirmation, because the whole point of
 * the contract is that a confident sentence can still be fabricated.
 */
export function mayAutoSubmit(result: TranscriptionResult): boolean {
  return result.status === 'ok'
}

/** A surface may only enable a microphone when the shared capability says it is ready. */
export function micMayBeEnabled(capability: TranscriptionCapability): boolean {
  return capability.state === 'ready'
}

/** Creole needs a multilingual model; an English-only build cannot serve it at all. */
export function supportsHaitianCreole(capability: TranscriptionCapability): boolean {
  return capability.state === 'ready' && capability.multilingual &&
    capability.supportedLanguages.includes(HAITIAN_CREOLE)
}
