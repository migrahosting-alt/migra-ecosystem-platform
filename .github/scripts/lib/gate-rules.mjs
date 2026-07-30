/**
 * Pure decision logic for the canonical integration gate.
 *
 * Kept free of network and environment access so it can be tested directly — the gate's
 * correctness is entirely in these rules, and a gate that cannot be tested is a gate nobody
 * should trust to guard a branch.
 */

export const GATE_CONTEXT = "canonical-integration-gate";

/**
 * Declared applicability, mirroring each workflow's `on.pull_request.paths` EXACTLY.
 * If a workflow's filter changes, change it here too. Drift fails closed: the gate waits for a
 * check that cannot arrive and then fails, rather than passing something unverified.
 */
export const GATES = [
  // No path filter — these run on every PR to the integration branch.
  { context: "guard-bootstrap", always: true },
  { context: "fresh-clone-proof", always: true },
  { context: "nginx-gate", always: true },
  { context: "Workspace Hygiene (Strict)", always: true },

  // Path-filtered.
  { context: "validate", paths: ["MigraTeck/**", ".github/workflows/migrateck-platform-ci.yml"] },
  { context: "secret-scan", paths: ["MigraTeck/**", ".github/workflows/migrateck-platform-ci.yml"] },
  { context: "pale-validate", paths: ["Software/Pale/**"] },
  {
    context: "pale-backend-checks",
    paths: ["Software/Pale/backend/**", "Software/Pale/packages/**"],
  },
  { context: "pale-mobile-checks", paths: ["Software/Pale/mobile/**", "Software/Pale/packages/**"] },
  { context: "pilot-ci", paths: ["apps/pilot-web/**"] },
];

/**
 * A `skipped` gate is one the platform decided did not apply — requirement: treat as
 * not-applicable, never as a failure. Everything unrecognised is treated as a failure so a new
 * GitHub conclusion value cannot silently become a pass.
 */
const PASSING = new Set(["success", "skipped", "neutral"]);

/** GitHub path-filter semantics: `**` crosses `/`, `*` does not. */
export function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`${out}$`);
}

export function matchesAny(paths, files) {
  return paths.some((p) => {
    const re = globToRegExp(p);
    return files.some((f) => re.test(f));
  });
}

/**
 * Split the gate table into what this PR must wait for and what it must not.
 * `truncated` means the changed-file list could not be fully enumerated; every path-filtered gate
 * is then treated as applicable, because under-expecting would let a real gate go unchecked.
 */
export function computeApplicability(files, truncated = false) {
  const expected = [];
  const notApplicable = [];
  for (const gate of GATES) {
    if (gate.always) {
      expected.push(gate.context);
    } else if (truncated || matchesAny(gate.paths, files)) {
      expected.push(gate.context);
    } else {
      notApplicable.push(gate.context);
    }
  }
  return { expected, notApplicable };
}

/** Contexts that are applicable but have not reached `completed` yet. */
export function pendingContexts(expected, runs) {
  return expected.filter((c) => {
    const run = runs.get(c);
    return !run || run.status !== "completed";
  });
}

/**
 * Evaluate completed runs. A missing run is a failure, not a pass — a workflow that never started
 * must never read as success.
 */
export function evaluate(expected, runs) {
  const results = expected.map((context) => {
    const run = runs.get(context);
    const conclusion = run?.conclusion ?? "MISSING";
    return { context, conclusion, ok: PASSING.has(conclusion) };
  });
  return { results, failures: results.filter((r) => !r.ok) };
}
