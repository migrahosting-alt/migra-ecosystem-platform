/**
 * Measured facts about the raw recordings.
 *
 * Read from the files themselves — size, SHA-256, duration, format. Nothing
 * here is authored, estimated or defaulted. This module is the catalogue of
 * source evidence; the manifest is the catalogue of intent. Keeping them apart
 * is what stops a dataset acquiring an authored-looking field nobody authored.
 *
 * SOURCE (read-only, never modified in place):
 *   /mnt/p/MigraAI-Engineer/training/datasets/kreyol-speech-source/raw
 *
 * Measured 2026-08-16. Re-measure and update if a take is re-recorded — a
 * changed hash against an unchanged filename is exactly the drift this catalogue
 * exists to make visible.
 */

import type { AcousticCondition, RecordingVariant } from './types'

export const SOURCE_DIRECTORY = '/mnt/p/MigraAI-Engineer/training/datasets/kreyol-speech-source/raw'

type Measured = {
  filename: string
  condition: AcousticCondition
  bytes: number
  sha256: string
  durationMs: number
}

/** Every take is 48 kHz / 24-bit / stereo, as recorded. */
const FORMAT = { sampleRateHz: 48000, channels: 2, bitDepth: 24 } as const

const MEASURED: Record<string, Measured[]> = {
  MKES_STRESS_001: [
    { filename: 'MKES_STRESS_001_conversation.wav', condition: 'clean', bytes: 6600932, sha256: 'f7442035680da2ed', durationMs: 22920 },
    { filename: 'MKES_STRESS_001_conversation_phone.wav', condition: 'phone', bytes: 5301674, sha256: '64eb50b30f9126c4', durationMs: 18409 },
  ],
  MKES_STRESS_002: [
    { filename: 'MKES_STRESS_002_places_names.wav', condition: 'clean', bytes: 5137394, sha256: '3c72f7f482e2ee70', durationMs: 17838 },
  ],
  MKES_STRESS_003: [
    { filename: 'MKES_STRESS_003_numbers_money.wav', condition: 'clean', bytes: 4525100, sha256: '50e617c398176e8b', durationMs: 15712 },
  ],
  MKES_STRESS_004: [
    { filename: 'MKES_STRESS_004_codeswitch_en.wav', condition: 'clean', bytes: 5779562, sha256: '29973bbe3518402f', durationMs: 20068 },
    { filename: 'MKES_STRESS_004_codeswitch_en_noise.wav', condition: 'noise', bytes: 6974288, sha256: '237a5d31e534cc0e', durationMs: 24216 },
  ],
  MKES_STRESS_005: [
    { filename: 'MKES_STRESS_005_codeswitch_fr.wav', condition: 'clean', bytes: 4629638, sha256: 'f778a6a437346758', durationMs: 16074 },
    { filename: 'MKES_STRESS_005_codeswitch_fr_phone.wav', condition: 'phone', bytes: 4853648, sha256: '79de33e470d9d4b9', durationMs: 16853 },
  ],
  MKES_STRESS_006: [
    { filename: 'MKES_STRESS_006_self_correction.wav', condition: 'clean', bytes: 5495816, sha256: 'b4979e191319392e', durationMs: 19082 },
  ],
  MKES_STRESS_007: [
    { filename: 'MKES_STRESS_007_instructions.wav', condition: 'clean', bytes: 4778978, sha256: 'c44e4e033dc177b9', durationMs: 16594 },
  ],
  MKES_STRESS_008: [
    { filename: 'MKES_STRESS_008_prosody.wav', condition: 'clean', bytes: 4704308, sha256: 'a5a7bde7e31a93af', durationMs: 16334 },
  ],
  MKES_STRESS_009: [
    { filename: 'MKES_STRESS_009_culture.wav', condition: 'clean', bytes: 6391856, sha256: 'a5c4b888d68d14c3', durationMs: 22193 },
  ],
  MKES_STRESS_010: [
    { filename: 'MKES_STRESS_010_context_reasoning.wav', condition: 'clean', bytes: 7123628, sha256: 'ee008dd44056c27a', durationMs: 24735 },
    { filename: 'MKES_STRESS_010_context_reasoning_distance.wav', condition: 'distance', bytes: 8019668, sha256: '88ea4b4c21b97a7d', durationMs: 27846 },
  ],
  MKES_STRESS_011: [
    { filename: 'MKES_STRESS_011_room_silence.wav', condition: 'clean', bytes: 5301674, sha256: 'dd33a41b43dbfbb1', durationMs: 18409 },
  ],
}

/**
 * Recordings for a case, as `RecordingVariant`s.
 *
 * `status: 'received'` means the bytes exist and parse as RIFF/WAVE. It does
 * NOT mean consent and provenance have been validated, and it does not mean
 * anyone has listened — hence `review: 'not-reviewed'` on every take until a
 * human says otherwise.
 */
export const recordingsFor = (id: string): RecordingVariant[] =>
  (MEASURED[id] ?? []).map((m) => ({
    filename: m.filename,
    condition: m.condition,
    status: 'received' as const,
    bytes: m.bytes,
    sha256: m.sha256,
    durationMs: m.durationMs,
    ...FORMAT,
    review: 'not-reviewed' as const,
  }))

/**
 * Takes sharing a byte length AND duration with another take.
 *
 * Not an error — two exports of the same length legitimately match — but an
 * identical size across different content is worth a human glance before the
 * set is frozen, in case a take was exported from the wrong region.
 */
export function suspiciousDuplicates(): string[][] {
  const bySize = new Map<string, string[]>()
  for (const takes of Object.values(MEASURED)) {
    for (const t of takes) {
      const key = `${t.bytes}:${t.durationMs}`
      bySize.set(key, [...(bySize.get(key) ?? []), t.filename])
    }
  }
  return [...bySize.values()].filter((group) => group.length > 1)
}
