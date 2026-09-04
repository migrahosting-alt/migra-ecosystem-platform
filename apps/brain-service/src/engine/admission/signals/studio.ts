/**
 * What the image/video stack is doing with the card.
 *
 * WHAT EACH SIGNAL IS WORTH (measured 2026-08-27, not assumed):
 *
 *  - `/queue` — AUTHORITATIVE for "a render is holding the card". This is the exact
 *    workload that starved chat.
 *  - `/system_stats` `vram_free` — DIRECTIONAL ONLY, and measurably optimistic. It
 *    moves with real allocation (24.4 GB -> 13.9 GB when a 13.5 GB model loaded) but
 *    it is not `total - used`. Under a genuinely pinned card — 23.5 of 24.0 GiB
 *    allocated, ~1 GB actually free — it still reported **14.2 GB free**. Trusting
 *    it alone would have called that card ready.
 *
 * 🚨 AND SILENCE IS NOT IDLENESS. `/queue` stopped answering during a real render
 * BECAUSE a long node execution was blocking ComfyUI's event loop. The authoritative
 * signal disappears at exactly the moment it matters, so `reachable: false` is
 * reported as its own fact rather than folded into "no render".
 *
 * © MigraTeck LLC.
 */

import { getJson } from './http.js';

export interface StudioReading {
  /** False when /queue did not answer. NOT the same as an idle queue. */
  reachable: boolean;
  running?: number;
  pending?: number;
  vramFreeBytes?: number;
  vramTotalBytes?: number;
}

export async function readStudio(
  base: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<StudioReading> {
  const [queue, stats] = await Promise.all([
    getJson(`${base}/queue`, timeoutMs, fetchImpl),
    getJson(`${base}/system_stats`, timeoutMs, fetchImpl),
  ]);
  if (!queue) return { reachable: false };
  const devices = Array.isArray(stats?.devices) ? (stats!.devices as Array<Record<string, unknown>>) : [];
  const device = devices[0];
  return {
    reachable: true,
    running: Array.isArray(queue.queue_running) ? queue.queue_running.length : 0,
    pending: Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0,
    ...(typeof device?.vram_free === 'number' ? { vramFreeBytes: device.vram_free } : {}),
    ...(typeof device?.vram_total === 'number' ? { vramTotalBytes: device.vram_total } : {}),
  };
}
