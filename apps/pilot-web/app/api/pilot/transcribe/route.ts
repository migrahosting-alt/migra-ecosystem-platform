// POST /api/pilot/transcribe — local, private speech-to-text for voice input.
// Accepts an audio blob (webm/opus/ogg/wav) as multipart form-data ("audio")
// or JSON { audio: <base64>, mime }. Decodes to 16kHz mono WAV via ffmpeg and
// runs faster-whisper on-device (scripts/transcribe.py). No cloud, no per-use cost.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const execFileP = promisify(execFile);
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — plenty for a dictation turn
const SCRIPT = path.join(process.cwd(), "scripts", "transcribe.py");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function readAudio(req: Request): Promise<{ bytes: Buffer; ext: string } | null> {
  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) return null;
    const buf = Buffer.from(await file.arrayBuffer());
    const name = (file as File).name || "";
    const ext = path.extname(name).replace(/^\./, "") || mimeToExt(file.type);
    return { bytes: buf, ext };
  }
  const body = (await req.json().catch(() => ({}))) as { audio?: string; mime?: string };
  if (typeof body.audio !== "string" || !body.audio) return null;
  const b64 = body.audio.includes(",") ? body.audio.slice(body.audio.indexOf(",") + 1) : body.audio;
  return { bytes: Buffer.from(b64, "base64"), ext: mimeToExt(body.mime || "") };
}

function mimeToExt(mime: string): string {
  if (/webm/i.test(mime)) return "webm";
  if (/ogg/i.test(mime)) return "ogg";
  if (/wav/i.test(mime)) return "wav";
  if (/mp4|m4a|aac/i.test(mime)) return "m4a";
  if (/mpeg|mp3/i.test(mime)) return "mp3";
  return "webm";
}

export async function POST(req: Request) {
  let audio: { bytes: Buffer; ext: string } | null;
  try {
    audio = await readAudio(req);
  } catch {
    return json({ error: "could not read audio payload" }, 400);
  }
  if (!audio || audio.bytes.length === 0) return json({ error: "no audio provided" }, 400);
  if (audio.bytes.length > MAX_BYTES) return json({ error: "audio too large" }, 413);

  const stamp = randomBytes(8).toString("hex");
  const inPath = path.join(tmpdir(), `pilot-voice-${stamp}.${audio.ext}`);
  // MUST NOT COLLIDE WITH inPath. When the upload is already .wav — which any wav
  // recorder or file upload produces — both names resolved to the SAME path, and ffmpeg
  // refuses to write its own input: "Output file is the same as the input". Voice input
  // was therefore broken for every wav upload, and the route reported it as a raw ffmpeg
  // command failure rather than anything a caller could act on.
  const wavPath = path.join(tmpdir(), `pilot-voice-${stamp}-16k.wav`);
  const cleanup = async () => {
    await Promise.allSettled([unlink(inPath), unlink(wavPath)]);
  };

  try {
    await writeFile(inPath, audio.bytes);
    // Normalize to what whisper wants: 16kHz mono PCM WAV.
    await execFileP("ffmpeg", ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", wavPath], {
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const python = process.env.PILOT_PYTHON || "python3";
    const { stdout } = await execFileP(python, [SCRIPT, wavPath], {
      timeout: 90000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}") as {
      text?: string;
      error?: string;
      language?: string;
      language_probability?: number;
      model?: string;
      english_only?: boolean;
      forced_language?: string | null;
      low_confidence?: boolean;
    };
    if (parsed.error) return json({ error: parsed.error }, 500);
    // PASS THE LANGUAGE SIGNALS THROUGH. This used to return the bare text, which meant a
    // caller had no way to tell a real transcript from a confident hallucination: Whisper
    // forced to the wrong language emits fluent training-data text, not obvious garbage.
    // Measured before the fix — French in, "I hope you enjoyed this video and like and
    // subscribe to my channel." out. A caller that cannot see `english_only` or
    // `low_confidence` cannot refuse or confirm, so it would send words never spoken.
    return json({
      text: (parsed.text || "").trim(),
      language: parsed.language ?? null,
      languageProbability: parsed.language_probability ?? null,
      model: parsed.model ?? null,
      englishOnly: parsed.english_only === true,
      forcedLanguage: parsed.forced_language ?? null,
      lowConfidence: parsed.low_confidence === true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "transcription failed";
    return json({ error: /ENOENT/.test(msg) ? "transcription tools not installed (ffmpeg / python)" : msg }, 500);
  } finally {
    await cleanup();
  }
}
