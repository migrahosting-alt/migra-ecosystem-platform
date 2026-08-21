// Adapter: the local whisper worker -> the SHARED transcription contract.
//
// The contract is imported, never re-declared. A second copy of these rules in this app is
// how the Command Center and the consumer would drift into disagreeing about whether a
// transcript is safe to send — which is the island problem this boundary exists to stop.

import {
  assessTranscription,
  HAITIAN_CREOLE,
  type TranscriptionCapability,
  type TranscriptionProvenance,
  type TranscriptionResult,
} from "../../../../packages/shared-types/src/transcription";

/** Raw JSON printed by scripts/transcribe.py. */
export interface WorkerOutput {
  text?: string;
  language?: string;
  language_probability?: number;
  model?: string;
  english_only?: boolean;
  forced_language?: string | null;
  /** ONLY set when the caller explicitly chose a language. */
  requested_language?: string | null;
  low_confidence?: boolean;
  error?: string;
}

/**
 * Languages a multilingual whisper build can transcribe. Only the ones this product
 * actually cares about are listed — claiming all 99 would invite a surface to offer a
 * language nobody has ever qualified.
 */
const QUALIFIED_LANGUAGES = ["en", "fr", "es", HAITIAN_CREOLE];

export function configuredModel(): string {
  return process.env.PILOT_WHISPER_MODEL || "base.en";
}

/** An `.en` build cannot produce OR detect another language. */
export function isEnglishOnly(model: string): boolean {
  return model.endsWith(".en");
}

/**
 * What a surface may believe about speech input before enabling a microphone.
 *
 * `ready` here means the pipeline is configured, NOT that it can serve every language:
 * `multilingual` is the field that decides whether Creole is reachable at all.
 */
export function transcriptionCapability(): TranscriptionCapability {
  const model = configuredModel();
  const englishOnly = isEnglishOnly(model);
  return {
    state: "ready",
    model,
    multilingual: !englishOnly,
    supportedLanguages: englishOnly ? ["en"] : QUALIFIED_LANGUAGES,
    ...(englishOnly
      ? {
          unavailableReason:
            `${model} is an English-only build, so any other language would be transcribed ` +
            `as invented English. Set PILOT_WHISPER_MODEL to a multilingual model (e.g. ` +
            `large-v3) to support Haitian Creole.`,
        }
      : {}),
  };
}

/** Convert one worker result into the shared contract, applying the shared rules. */
export function toTranscriptionResult(
  output: WorkerOutput,
  provenance: TranscriptionProvenance,
  durationMs: number,
): TranscriptionResult {
  const model = output.model ?? configuredModel();
  const englishOnly = output.english_only === true || isEnglishOnly(model);
  return assessTranscription({
    text: output.text ?? "",
    // An English-only model reports "en" because it was told to, not because it heard it.
    // Presenting that as a detection would be the same lie in a different field.
    detectedLanguage: englishOnly ? null : (output.language ?? null),
    // NOT forced_language: the worker pins "en" for an .en model by itself, and reading
    // that as a user request made an English-only transcript of French speech look like a
    // deliberate choice — status "ok", no warnings, straight into the user's message.
    requestedLanguage: output.requested_language ?? null,
    confidence: englishOnly ? null : (output.language_probability ?? null),
    model,
    englishOnly,
    durationMs,
    provenance,
  });
}
