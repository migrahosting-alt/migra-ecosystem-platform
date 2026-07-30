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
/**
 * Why a gate can be DORMANT.
 *
 * A dormant gate keeps its context name and path filter recorded — so the definition and the
 * collision fixes are not lost — but is never treated as applicable and never gates merge
 * eligibility. Dead checks must not become required checks: a required context that cannot pass,
 * or cannot even be emitted, makes every PR in its scope unmergeable.
 *
 * Restoring one is deliberate: delete its `dormant` entry, which means deleting the documented
 * re-entry criteria below. It cannot be silently switched back on.
 */
export const DORMANT_REASONS = {
  PALE_UNREACHABLE: {
    reason:
      "Software/Pale has zero tracked files in this repository — every Software/* directory is " +
      "an untracked nested git repo. No PR here can match Software/Pale/**, so these contexts " +
      "can never be emitted. The duplicate-name fixes are kept for the day Pale is tracked.",
    reentry: [
      "Software/Pale content is tracked by this repository (git ls-files Software/Pale is non-empty)",
      "the Pale workflows actually trigger on a pull_request to the integration branch",
      "a live scoped PR proves each context reports success",
    ],
  },
  PILOT_WEB_UNTRACKED: {
    reason:
      "apps/pilot-web is gitignored with only package.json and package-lock.json force-added — " +
      "no tracked source and no tracked tsconfig.json. A CI checkout therefore contains neither, " +
      "so pilot:ci's `tsc --noEmit` has no inputs, prints its option list and exits non-zero. " +
      "pilot-ci cannot pass in its current state, so it is not a valid repository quality gate. " +
      "The workflow is kept; only its merge eligibility is withdrawn.",
    reentry: [
      "apps/pilot-web source is tracked by this repository",
      "apps/pilot-web/tsconfig.json is tracked",
      "a clean-clone dependency install succeeds reproducibly from the committed lockfile",
      "typecheck and build succeed in that clean clone",
      "a live scoped PR proves the pilot-ci context reports success",
    ],
  },
};

export const GATES = [
  // No path filter — these run on every PR to the integration branch.
  { context: "guard-bootstrap", always: true },
  { context: "fresh-clone-proof", always: true },
  { context: "nginx-gate", always: true },
  { context: "Workspace Hygiene (Strict)", always: true },

  // Path-filtered and live. These were `validate` / `secret-scan` until the reconciliation with
  // `main`, whose universal-required-gates.yml emits those two names unconditionally. Protection
  // matches by context NAME, so the canonical platform jobs were renamed to keep both security
  // models without two check-runs sharing a name.
  {
    context: "canonical-platform-validate",
    paths: ["MigraTeck/**", ".github/workflows/migrateck-platform-ci.yml"],
  },
  {
    context: "canonical-platform-secret-scan",
    paths: ["MigraTeck/**", ".github/workflows/migrateck-platform-ci.yml"],
  },

  // Path-filtered but DORMANT — defined, never required. See DORMANT_REASONS.
  {
    context: "pale-validate",
    paths: ["Software/Pale/**"],
    dormant: DORMANT_REASONS.PALE_UNREACHABLE,
  },
  {
    context: "pale-backend-checks",
    paths: ["Software/Pale/backend/**", "Software/Pale/packages/**"],
    dormant: DORMANT_REASONS.PALE_UNREACHABLE,
  },
  {
    context: "pale-mobile-checks",
    paths: ["Software/Pale/mobile/**", "Software/Pale/packages/**"],
    dormant: DORMANT_REASONS.PALE_UNREACHABLE,
  },
  {
    context: "pilot-ci",
    paths: ["apps/pilot-web/**"],
    dormant: DORMANT_REASONS.PILOT_WEB_UNTRACKED,
  },
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
 *
 * `truncated` means the changed-file list could not be fully enumerated; every live path-filtered
 * gate is then treated as applicable, because under-expecting would let a real gate go unchecked.
 * Dormant gates are excluded unconditionally — truncation must not resurrect a gate that cannot
 * pass, or the fail-safe would itself become the thing that blocks every PR.
 */
export function computeApplicability(files, truncated = false) {
  const expected = [];
  const notApplicable = [];
  const dormant = [];
  for (const gate of GATES) {
    if (gate.dormant) {
      dormant.push({ context: gate.context, reason: gate.dormant.reason });
    } else if (gate.always || truncated || matchesAny(gate.paths, files)) {
      expected.push(gate.context);
    } else {
      notApplicable.push(gate.context);
    }
  }
  return { expected, notApplicable, dormant };
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
