import {
  assessTranscription,
  HAITIAN_CREOLE,
  type TranscriptionCapability,
  type TranscriptionProvenance,
  type TranscriptionResult,
} from '@migrapilot/shared-types/transcription';

/**
 * The Brain's speech capability, and the runtime port behind it.
 *
 * WHY A PORT AND NOT A DIRECT CALL. apps/pilot-web owns a working whisper pipeline, but the
 * consumer product must not reach into another application to use it — that couples the
 * product to the Command Center's implementation and rebuilds the island the shared Brain
 * exists to remove. So the Brain owns the CAPABILITY and delegates to whatever runtime is
 * configured. Either surface consumes the capability; neither imports the other.
 *
 * FAILS CLOSED. With no runtime configured the capability is `unavailable` with the reason
 * said plainly, never `ready` with an empty promise. A capability that is quietly absent is
 * indistinguishable from one that is broken — the same rule governed coding already follows.
 *
 * THE RUNTIME IS DUMB ON PURPOSE. It returns what it heard; it does not decide whether the
 * transcript is safe to use. `assessTranscription` runs HERE, once, so every surface reads
 * the same verdict instead of each re-deriving it and drifting.
 */

export interface SpeechRuntimeConfig {
  /** Base URL of a speech runtime speaking the contract below. Absent = not configured. */
  url?: string;
  timeoutMs: number;
  /**
   * Shared secret for the runtime, when it requires one.
   *
   * The GPU is on the workstation and this Brain is not, so the runtime has to listen where
   * the tailnet can reach it — and it refuses to do that unauthenticated. Absent here simply
   * means no header is sent, which is correct for a loopback runtime.
   */
  token?: string;
}

export function readSpeechRuntimeConfig(env: NodeJS.ProcessEnv = process.env): SpeechRuntimeConfig {
  const raw = env.MIGRAPILOT_SPEECH_RUNTIME_URL?.trim();
  const token = env.MIGRAPILOT_SPEECH_RUNTIME_TOKEN?.trim();
  return {
    ...(raw ? { url: raw.replace(/\/+$/, '') } : {}),
    ...(token ? { token } : {}),
    timeoutMs: Number(env.MIGRAPILOT_SPEECH_TIMEOUT_MS ?? 120_000),
  };
}

/** What a runtime reports about itself: `GET {url}/capability`. */
interface RuntimeCapability {
  /** A runtime that knows it is not serving says so; absent means "assume nothing". */
  ready?: boolean;
  unavailableReason?: string;
  model?: string;
  multilingual?: boolean;
  supportedLanguages?: string[];
  /** cuda | cpu. Reported so a slow deployment is visible rather than mysterious. */
  device?: string;
}

/** What a runtime returns from `POST {url}/transcribe`. Raw observation, no verdict. */
interface RuntimeTranscription {
  text?: string;
  language?: string | null;
  languageProbability?: number | null;
  model?: string;
  englishOnly?: boolean;
  /** Echoed back ONLY when the caller explicitly asked for a language. */
  requestedLanguage?: string | null;
  error?: string;
}

const unavailable = (reason: string): TranscriptionCapability => ({
  state: 'unavailable',
  model: null,
  multilingual: false,
  supportedLanguages: [],
  unavailableReason: reason,
});

type FetchLike = typeof fetch;

/** The secret is only ever a request header — never a query string, never logged. */
const authHeaders = (config: SpeechRuntimeConfig): Record<string, string> =>
  config.token ? { authorization: `Bearer ${config.token}` } : {};

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the configured runtime what it can do. Never guesses on its behalf. */
export async function probeSpeechCapability(
  config: SpeechRuntimeConfig,
  fetchImpl: FetchLike = fetch,
): Promise<TranscriptionCapability> {
  if (!config.url) {
    return unavailable(
      'No speech runtime is configured. Set MIGRAPILOT_SPEECH_RUNTIME_URL to a qualified transcription runtime.',
    );
  }

  let payload: RuntimeCapability;
  try {
    const response = await withTimeout(Math.min(config.timeoutMs, 10_000), (signal) =>
      fetchImpl(`${config.url}/capability`, { signal, headers: authHeaders(config) }),
    );
    if (response.status === 401) {
      // A misconfigured secret must not read as "speech is switched off" — that would send
      // someone looking for a feature flag instead of a credential.
      return unavailable('The speech runtime rejected this Brain\'s credentials.');
    }
    if (!response.ok) return unavailable(`The speech runtime answered HTTP ${response.status}.`);
    payload = (await response.json()) as RuntimeCapability;
  } catch (error) {
    // Unreachable is UNAVAILABLE, never ready-with-a-shrug. A surface must not open a
    // microphone against a runtime that did not answer.
    return unavailable(`The speech runtime could not be reached: ${(error as Error).message}`);
  }

  // A runtime that reports itself not ready is authoritative about that, and its own reason
  // is better than anything inferred out here. A model still loading is not a broken model.
  if (payload.ready === false) {
    return unavailable(payload.unavailableReason ?? 'The speech runtime reports it is not ready.');
  }

  const model = payload.model ?? null;
  const multilingual = payload.multilingual === true;
  // Trust the runtime's own list, but never invent one: an English-only runtime that claims
  // Creole would be exactly the fabrication this contract exists to prevent.
  const supportedLanguages = Array.isArray(payload.supportedLanguages)
    ? payload.supportedLanguages.filter((l) => typeof l === 'string')
    : multilingual
      ? []
      : ['en'];

  if (!model) return unavailable('The speech runtime did not report which model it runs.');

  return { state: 'ready', model, multilingual, supportedLanguages };
}

export interface TranscribeInput {
  audioBase64: string;
  audioMime: string;
  /** Present ONLY when the user explicitly chose a language. Never defaulted. */
  requestedLanguage?: string;
}

export class SpeechRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechRuntimeError';
  }
}

/**
 * Transcribe, then apply the shared safety rules.
 *
 * `requestedLanguage` is forwarded only when the caller supplied one. The runtime may pin a
 * language of its own for an English-only model — that pin must come back as `englishOnly`,
 * NOT as a requested language. Conflating the two once already disabled the fabrication
 * guard: French audio returned status "ok" with fluent invented English, ready to send as
 * the speaker's own words.
 */
export async function transcribeWithRuntime(
  config: SpeechRuntimeConfig,
  input: TranscribeInput,
  fetchImpl: FetchLike = fetch,
): Promise<TranscriptionResult> {
  if (!config.url) throw new SpeechRuntimeError('No speech runtime is configured.');

  const startedAt = Date.now();
  const audioBytes = Math.floor((input.audioBase64.length * 3) / 4);
  const provenance: TranscriptionProvenance = {
    kind: 'machine-transcribed',
    audioBytes,
    audioMime: input.audioMime,
  };

  let payload: RuntimeTranscription;
  try {
    const response = await withTimeout(config.timeoutMs, (signal) =>
      fetchImpl(`${config.url}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(config) },
        body: JSON.stringify({
          audio: input.audioBase64,
          mime: input.audioMime,
          ...(input.requestedLanguage ? { requestedLanguage: input.requestedLanguage } : {}),
        }),
        signal,
      }),
    );
    if (!response.ok) throw new SpeechRuntimeError(`The speech runtime answered HTTP ${response.status}.`);
    payload = (await response.json()) as RuntimeTranscription;
  } catch (error) {
    if (error instanceof SpeechRuntimeError) throw error;
    throw new SpeechRuntimeError(`The speech runtime could not be reached: ${(error as Error).message}`);
  }

  if (payload.error) throw new SpeechRuntimeError(payload.error);

  const model = payload.model ?? 'unknown';
  const englishOnly = payload.englishOnly === true || model.endsWith('.en');

  return assessTranscription({
    text: payload.text ?? '',
    // An English-only runtime reports a language because it was told to, not because it
    // heard it. Presenting that as a detection is the same lie in a different field.
    detectedLanguage: englishOnly ? null : (payload.language ?? null),
    requestedLanguage: input.requestedLanguage ?? null,
    confidence: englishOnly ? null : (payload.languageProbability ?? null),
    model,
    englishOnly,
    durationMs: Date.now() - startedAt,
    provenance,
  });
}

/** Exposed so callers can name the language without importing the package directly. */
export { HAITIAN_CREOLE };
