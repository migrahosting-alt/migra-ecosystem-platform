import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  probeSpeechCapability,
  probeSynthesisCapability,
  readSpeechRuntimeConfig,
  SpeechRuntimeError,
  synthesizeWithRuntime,
  transcribeWithRuntime,
  type SpeechRuntimeConfig,
} from './speechRuntime.js';

/** ~25 MB of audio once decoded. Bounded here as well as at the caller. */
const MAX_AUDIO_BASE64 = 34 * 1024 * 1024;
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,8})?$/;
/*
 * 🚨 A MEDIA TYPE MAY CARRY PARAMETERS, AND BROWSERS ALWAYS SEND THEM.
 *
 * This pattern had no room for `;codecs=opus`, so it rejected the exact string
 * every MediaRecorder produces — `audio/webm;codecs=opus` in Chrome,
 * `audio/mp4;codecs=opus` in Safari. Every real microphone recording was refused
 * at the boundary and surfaced to the user as "That recording could not be
 * transcribed", while the runtime behind it was healthy the whole time.
 *
 * Proven by sending IDENTICAL bytes twice: declared audio/mpeg it transcribed
 * perfectly, declared audio/webm;codecs=opus it failed. The audio was never the
 * problem.
 *
 * Only the ESSENCE is validated and passed on. ffmpeg sniffs the container
 * anyway, so the codec parameter tells the decoder nothing it does not already
 * know — and a parameter list is a poor thing to pattern-match on.
 */
const AUDIO_MIME = /^audio\/[A-Za-z0-9.+-]{1,64}$/;

/** `audio/webm;codecs=opus` -> `audio/webm`. Whitespace and case normalised. */
function mimeEssence(raw: string): string {
  return raw.split(';')[0]!.trim().toLowerCase();
}
/** Matches the runtime's own ceiling; bounded here too so a huge body never travels. */
const MAX_SPEAK_CHARS = 4000;
const VOICE_ID = /^[a-z][a-z0-9-]{0,31}$/;

interface TranscribeBody {
  audio?: unknown;
  mime?: unknown;
  requestedLanguage?: unknown;
}

/**
 * The speech capability.
 *
 * BOTH ROUTES ARE ALWAYS REGISTERED, even with no runtime configured — the same rule
 * governed coding follows. A client must be able to discover that speech is unavailable and
 * WHY, rather than inferring it from a 404 on a route that might simply have moved. That
 * distinction is what lets a surface tell "not built yet" apart from "switched off", and
 * keep a microphone honestly disabled with a reason instead of silently missing.
 */
export function registerSpeechRoutes(
  app: FastifyInstance,
  config: SpeechRuntimeConfig = readSpeechRuntimeConfig(),
): void {
  app.get('/api/ai/speech/capability', async () => probeSpeechCapability(config));

  /*
   * Registered unconditionally, like the routes above and for the same reason: a
   * surface must be able to learn that speaking is unavailable AND why, rather
   * than inferring it from a 404 that might just mean the route moved.
   */
  app.get('/api/ai/speech/synthesis/capability', async () => probeSynthesisCapability(config));

  app.post(
    '/api/ai/speech/synthesize',
    async (request: FastifyRequest<{ Body: { text?: unknown; voice?: unknown } }>, reply: FastifyReply) => {
      const body = request.body ?? {};
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        return reply.code(400).send({ error: 'text must be a non-empty string.' });
      }
      if (body.text.length > MAX_SPEAK_CHARS) {
        return reply.code(413).send({ error: 'That answer is too long to read aloud.' });
      }
      if (body.voice !== undefined && (typeof body.voice !== 'string' || !VOICE_ID.test(body.voice))) {
        return reply.code(400).send({ error: 'voice is not a valid voice id.' });
      }
      try {
        return await synthesizeWithRuntime(config, {
          text: body.text,
          ...(typeof body.voice === 'string' ? { voice: body.voice } : {}),
        });
      } catch (error) {
        if (error instanceof SpeechRuntimeError) {
          // 503, not 500: the answer is fine and the request was valid — the
          // voice service is what is unavailable, and that is worth saying
          // precisely so the caller can keep the text and explain the rest.
          return reply.code(503).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/ai/speech/transcribe',
    async (request: FastifyRequest<{ Body: TranscribeBody }>, reply: FastifyReply) => {
      const body = request.body ?? {};

      if (typeof body.audio !== 'string' || body.audio.length === 0) {
        return reply.code(400).send({ error: 'audio must be a non-empty base64 string.' });
      }
      if (body.audio.length > MAX_AUDIO_BASE64) {
        return reply.code(413).send({ error: 'audio is too large to transcribe.' });
      }
      const mimeEssenceValue = typeof body.mime === 'string' ? mimeEssence(body.mime) : '';
      if (!mimeEssenceValue || !AUDIO_MIME.test(mimeEssenceValue)) {
        return reply.code(400).send({ error: 'mime must be an audio/* media type.' });
      }
      // ONLY an explicit choice. Absent stays absent: a default here would be indistinguishable
      // from the user having asked for it, which is exactly how the fabrication guard was
      // switched off once already.
      if (body.requestedLanguage !== undefined) {
        if (typeof body.requestedLanguage !== 'string' || !LANGUAGE_CODE.test(body.requestedLanguage)) {
          return reply.code(400).send({ error: 'requestedLanguage is not a valid language code.' });
        }
      }

      try {
        const result = await transcribeWithRuntime(config, {
          audioBase64: body.audio,
          // The essence, not the raw header: the decoder sniffs the container,
          // and passing the parameter list on only spreads it further.
          audioMime: mimeEssenceValue,
          ...(typeof body.requestedLanguage === 'string' ? { requestedLanguage: body.requestedLanguage } : {}),
        });
        return result;
      } catch (error) {
        if (error instanceof SpeechRuntimeError) {
          // 503, not 500: the Brain is fine, the runtime behind it is not, and a caller
          // should treat that as temporary rather than as a broken contract.
          return reply.code(503).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
