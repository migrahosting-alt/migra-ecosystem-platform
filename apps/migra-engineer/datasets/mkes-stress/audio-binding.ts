/**
 * Measured audio facts, kept separate from the authored manifest.
 *
 * The manifest records what a human WROTE. This records what a machine
 * MEASURED from a file that exists. Mixing the two is how a dataset ends up
 * with an authored-looking field nobody authored.
 *
 * Every value here is read from the WAV header — never estimated, never
 * defaulted. A recording that has not arrived simply has no entry.
 *
 * Source of truth for the files themselves:
 *   /mnt/p/MigraAI-Engineer/training/datasets/kreyol-speech-source/raw
 * (drvfs — read-only from here; never in-place edit that mount.)
 */

import type { AudioArtifact } from './types'

type Measured = Omit<AudioArtifact, 'filename' | 'status'>

/** Keyed by MKES id. Absent id = recording not yet received. */
export const MEASURED: Record<string, Measured> = {
  MKES_STRESS_001: { bytes: 6600932, durationMs: 22920, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:05:00Z' },
  MKES_STRESS_002: { bytes: 5137394, durationMs: 17838, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:17:00Z' },
  MKES_STRESS_003: { bytes: 4525100, durationMs: 15712, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:20:00Z' },
  MKES_STRESS_004: { bytes: 5779562, durationMs: 20068, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:23:00Z' },
  MKES_STRESS_005: { bytes: 4629638, durationMs: 16074, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:26:00Z' },
  MKES_STRESS_006: { bytes: 5504000, durationMs: 19111, sampleRateHz: 48000, channels: 2, receivedAt: '2026-08-16T08:33:00Z' },
}

/**
 * Bind measured facts onto an artifact.
 *
 * `received` means the bytes exist and parse as a WAV. It does NOT mean the
 * recording has been validated against consent/provenance, and it certainly
 * does not mean anyone has listened to it — those are later states.
 */
export function bindAudio(id: string, artifact: AudioArtifact): AudioArtifact {
  const measured = MEASURED[id]
  return measured ? { ...artifact, status: 'received', ...measured } : artifact
}
