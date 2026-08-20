// Is the repair loop actually getting anywhere?
//
// The loop was already bounded and already ended honestly — a run whose tests
// still failed reported FAILED, never success. What it could not do was notice
// that it was going BACKWARDS. Measured: one run changed +70/-41 across three
// files and finished having broken three tests that passed at baseline, leaving
// the workspace worse than it found it. Every attempt was "valid"; none was an
// improvement.
//
// Two questions, asked from the validation output alone:
//   - is this worse than where we started?
//   - is this the same failure we just tried to fix?
//
// Both are mechanical, and neither asks the model to grade itself.

import type { ValidationRecord } from './validationRun.js';

export interface FailureSignature {
  /** Failing test names, sorted and deduplicated. */
  names: string[];
  /** `# fail N` when the runner reports it, else the number of names seen. */
  count: number;
  /** True when the command could not even run — never comparable as progress. */
  unusable: boolean;
}

const NOT_OK = /^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/;
const JEST_FAIL = /^\s*(?:✕|×)\s+(.+?)\s*$/;

/** What is failing, as a comparable fingerprint. Reads output; claims nothing. */
export function failureSignature(record: ValidationRecord | undefined): FailureSignature {
  if (!record || !record.admitted || record.timedOut) return { names: [], count: 0, unusable: true };
  if (record.passed) return { names: [], count: 0, unusable: false };

  const text = `${record.stdout}\n${record.stderr}`;
  const names = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const tap = NOT_OK.exec(line);
    if (tap?.[1]) { names.add(tap[1]); continue; }
    const jest = JEST_FAIL.exec(line);
    if (jest?.[1]) names.add(jest[1]);
  }
  const reported = /^#\s*fail\s+(\d+)\s*$/m.exec(record.stdout)?.[1];
  return {
    names: [...names].sort(),
    count: reported !== undefined ? Number.parseInt(reported, 10) : names.size,
    unusable: false,
  };
}

export type ProgressVerdict =
  /** Worth another attempt. */
  | { kind: 'continue' }
  /** Strictly worse than where the run started — stop and stop touching things. */
  | { kind: 'regressed'; detail: string }
  /** The same failure as last time: another attempt is a guess, not a repair. */
  | { kind: 'no-progress'; detail: string };

/**
 * Decide whether another repair attempt is justified.
 *
 * `baseline` is the state BEFORE the run touched anything, so "worse than
 * baseline" means the run has done net harm — a stronger and more useful signal
 * than "still failing". A test that failed at baseline and still fails is not a
 * regression; a test that passed at baseline and now fails is.
 *
 * An unusable record (refused, timed out) is never treated as progress OR as a
 * regression: nothing was measured, so nothing can be concluded.
 */
export function assessProgress(input: {
  baseline: ValidationRecord | undefined;
  previous: ValidationRecord | undefined;
  current: ValidationRecord | undefined;
}): ProgressVerdict {
  const current = failureSignature(input.current);
  if (current.unusable) return { kind: 'continue' };

  const baseline = failureSignature(input.baseline);
  if (!baseline.unusable) {
    // Names that pass at baseline and fail now. This is the harm test.
    const broken = current.names.filter((name) => !baseline.names.includes(name));
    if (broken.length > 0) {
      return {
        kind: 'regressed',
        detail: `${broken.length} test(s) that passed before this run now fail: ${broken.slice(0, 5).join('; ')}`,
      };
    }
    if (current.count > baseline.count) {
      return {
        kind: 'regressed',
        detail: `failures rose from ${baseline.count} at baseline to ${current.count}`,
      };
    }
  }

  const previous = failureSignature(input.previous);
  if (!previous.unusable && previous.names.length > 0) {
    const identical =
      previous.count === current.count &&
      previous.names.length === current.names.length &&
      previous.names.every((name, i) => name === current.names[i]);
    if (identical) {
      return {
        kind: 'no-progress',
        detail: `the same ${current.count} failure(s) as the previous attempt: ${current.names.slice(0, 3).join('; ')}`,
      };
    }
  }

  return { kind: 'continue' };
}
