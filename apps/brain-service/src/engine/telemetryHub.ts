// Telemetry hub (Operational Readiness Slice 2). A single sink both stores feed:
//  - forwards each event as one structured line to the app log (writer set at
//    boot; no-op until then so module load never depends on the logger);
//  - aggregates eviction statistics by reason (ttl vs capacity);
//  - keeps a small bounded ring of recent events for the health view.
//
// The sink never throws into a caller (enforcement must not depend on telemetry).

import type { TelemetryEvent, TelemetrySink } from './storeTelemetry.js';

export interface EvictionStats {
  ttl_total: number;
  capacity_total: number;
  total: number;
  last_at: number | null;
}

const RECENT_CAP = 200;

export class TelemetryHub {
  private writer: (line: string) => void = () => {};
  private readonly recent: TelemetryEvent[] = [];
  private readonly evictions: EvictionStats = { ttl_total: 0, capacity_total: 0, total: 0, last_at: null };

  /** The sink both stores are constructed with. */
  readonly sink: TelemetrySink = (e) => {
    try {
      this.writer(JSON.stringify({ evt: 'store.telemetry', event: e.event, at: e.at, correlationId: e.correlationId, ...e.fields }));
    } catch {
      /* best-effort */
    }
    this.recent.push(e);
    if (this.recent.length > RECENT_CAP) this.recent.shift();
    this.aggregateEviction(e);
  };

  private aggregateEviction(e: TelemetryEvent): void {
    const reason = e.fields.reason;
    const removed = Number(e.fields.removed ?? 0);
    if (!removed) return;
    const isTtl = reason === 'ttl' || reason === 'sweep' || reason === 'capacity_dead';
    const isCapacity = reason === 'capacity' || reason === 'capacity_evicted';
    if (!isTtl && !isCapacity) return;
    if (isTtl) this.evictions.ttl_total += removed;
    if (isCapacity) this.evictions.capacity_total += removed;
    this.evictions.total += removed;
    this.evictions.last_at = e.at;
  }

  setWriter(writer: (line: string) => void): void {
    this.writer = writer;
  }

  evictionStats(): EvictionStats {
    return { ...this.evictions };
  }

  /** Recent events, redaction-safe by construction (fields are metadata only). */
  recentEvents(n = 50): TelemetryEvent[] {
    return this.recent.slice(-n);
  }
}

/** Process-wide hub — both stores and the boot wiring share this instance. */
export const telemetryHub = new TelemetryHub();
