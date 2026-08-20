// Turning an observed failure into retrieval evidence.
//
// WHY THIS EXISTS
//
// Candidate ranking scores the USER'S WORDS against the repository. That works
// when the request names its subject and collapses when it does not: "the test
// suite is failing" contains no file, no symbol and no identifier, so nothing
// clears the relevance floor and planning refuses `no-candidates` — measured, in
// five seconds, against a repository whose failing test names the answer.
//
// A person does not solve that by guessing. They run the suite and read what
// broke. This module is the mechanical half of that: given the output of a
// verification that actually ran, it extracts the paths the failure names and the
// words worth searching for. It performs no I/O and makes no claims — it only
// says what the failure mentioned.

/** Stack frames: `at fn (/abs/path/file.js:12:3)` and bare `path/file.js:12`. */
const FRAME = /(?:\(|\s|^)((?:[A-Za-z]:)?[./\w-]*[\w-]+\.[cm]?[jt]sx?)(?::(\d+))?(?::\d+)?(?:\)|\s|$)/g;
/** Jest/vitest/mocha headline: `FAIL src/thing.test.ts`. */
const FAIL_FILE = /^\s*(?:✕|×|FAIL|not ok \d+ -)\s+(.+?)\s*$/gm;
/** node:test names the file in a TAP subtest header. */
const TAP_FILE = /^\s*#\s+Subtest:\s+(.+\.[cm]?[jt]sx?)\s*$/gm;

const NOISE = new Set([
  'node:internal', 'node_modules', 'internal', 'timers', 'task_queues', 'async_hooks',
]);

function plausible(candidate: string): boolean {
  if (!candidate || candidate.length > 200) return false;
  if (candidate.startsWith('node:')) return false;
  for (const bad of NOISE) if (candidate.includes(bad)) return false;
  return /\.[cm]?[jt]sx?$/.test(candidate);
}

/** Normalise to a workspace-relative path when the frame is absolute inside the root. */
function relativise(candidate: string, rootPath: string): string {
  const normalised = candidate.replace(/\\/g, '/');
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && normalised.startsWith(`${root}/`)) return normalised.slice(root.length + 1);
  return normalised.replace(/^\.\//, '');
}

export interface FailureEvidence {
  /** Paths the failure actually named, workspace-relative, most-mentioned first. */
  paths: string[];
  /** Free text worth ranking against the map: test names and assertion lines. */
  query: string;
}

/**
 * Read a verification's output as navigation evidence.
 *
 * Deliberately conservative: it reports what the output MENTIONS. Whether a
 * mentioned path exists, is contained, or is worth opening stays with the
 * planner, which owns the repository map and the containment rule.
 */
export function failureEvidence(output: string, rootPath = ''): FailureEvidence {
  const counts = new Map<string, number>();
  const add = (raw: string): void => {
    const candidate = relativise(raw.trim(), rootPath);
    if (!plausible(candidate)) return;
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  };

  for (const match of output.matchAll(FRAME)) add(match[1] ?? '');
  for (const match of output.matchAll(TAP_FILE)) add(match[1] ?? '');
  for (const match of output.matchAll(FAIL_FILE)) {
    const target = (match[1] ?? '').trim();
    if (plausible(relativise(target, rootPath))) add(target);
  }

  // The QUERY is the human-readable half: failing test names and assertion text.
  // "a gold member gets 10% off before tax" carries `gold`, `member`, `tax` —
  // exactly the words that rank the pricing module, and exactly what the issue
  // text lacked.
  const queryLines: string[] = [];
  let inErrorBlock = false;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (queryLines.length >= 40) break;

    // The BODY of the error block is the part that names things — the headline
    // `error: |-` on its own says nothing. Same shape as `observedFailure`, for
    // the same reason: an earlier version kept only headlines and threw away the
    // assertion diff, which is where the values and field names live.
    if (/^error:/.test(line)) { inErrorBlock = true; continue; }
    if (inErrorBlock) {
      if (line === '...' || /^(code|name|stack|operator):/.test(line)) { inErrorBlock = false; continue; }
      if (line) queryLines.push(line);
      continue;
    }

    const failing = /^not ok \d+ - (.+)$/.exec(line);
    if (failing) { queryLines.push(failing[1] ?? ''); continue; }
    const named = /^\s*(?:✕|×)\s+(.+)$/.exec(line);
    if (named) { queryLines.push(named[1] ?? ''); continue; }
    if (/^(AssertionError|Error|TypeError|ReferenceError)\b/.test(line) || line.includes('!==')) {
      queryLines.push(line);
    }
  }

  return {
    paths: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    query: queryLines.join('\n'),
  };
}
