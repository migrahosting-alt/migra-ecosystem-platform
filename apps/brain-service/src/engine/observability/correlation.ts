// Execution correlation (Operational Readiness Slice 1).
//
// A single correlation id flows through the whole coding-agent execution:
//   request → route → loop-step → tool → proposal → approval → apply → validation
// Each stage emits ONE structured line so an operator can reconstruct exactly
// what happened for a given request across the router, loop, tools, and the
// approval/apply boundary.
//
// REDACTION CONTRACT: stage fields carry METADATA ONLY — tool ids, stage names,
// counts, status codes, model ids, durations. Callers must never place raw
// command output, file content, diffs, secrets, or user prompts in `fields`.

export type Stage =
  | 'request'
  | 'route'
  | 'loop-step'
  | 'tool'
  | 'proposal'
  | 'approval'
  | 'apply'
  | 'validation'
  | 'final'
  | 'error';

export interface StageEvent {
  correlationId: string;
  stage: Stage;
  at: number;
  /** Metadata only (see redaction contract). */
  fields: Record<string, unknown>;
}

export type StageSink = (e: StageEvent) => void;

/** Generate a correlation id. Time + randomness are injectable for tests. */
export function newCorrelationId(now: () => number = () => Date.now(), rand: () => number = Math.random): string {
  return `corr_${now().toString(36)}${Math.floor(rand() * 1e9).toString(36)}`;
}

export interface StageLogger {
  readonly correlationId: string;
  log(stage: Stage, fields?: Record<string, unknown>): void;
  /** Time a scoped operation and emit the stage with a `durationMs` field. */
  timed<T>(stage: Stage, fields: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
}

export function makeStageLogger(
  correlationId: string,
  sink: StageSink,
  now: () => number = () => Date.now(),
): StageLogger {
  return {
    correlationId,
    log(stage, fields = {}) {
      sink({ correlationId, stage, at: now(), fields });
    },
    async timed(stage, fields, fn) {
      const started = now();
      try {
        const out = await fn();
        sink({ correlationId, stage, at: now(), fields: { ...fields, durationMs: now() - started, outcome: 'ok' } });
        return out;
      } catch (err) {
        sink({ correlationId, stage, at: now(), fields: { ...fields, durationMs: now() - started, outcome: 'error', error: err instanceof Error ? err.name : 'error' } });
        throw err;
      }
    },
  };
}

/** A no-op logger for call sites that have no correlation context. */
export const NOOP_STAGE_LOGGER: StageLogger = {
  correlationId: 'none',
  log() {},
  async timed(_stage, _fields, fn) {
    return fn();
  },
};

/** Structured single-line JSON sink. `write` typically wraps the app logger. */
export function jsonLineSink(write: (line: string) => void): StageSink {
  return (e) => write(JSON.stringify({ evt: 'exec.stage', correlationId: e.correlationId, stage: e.stage, at: e.at, ...e.fields }));
}

/** Compose sinks (e.g. app-log + an in-memory collector for tests/telemetry). */
export function multiSink(...sinks: StageSink[]): StageSink {
  return (e) => {
    for (const s of sinks) s(e);
  };
}
