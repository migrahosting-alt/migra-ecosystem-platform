// MigraPilot — action risk model + central approval classifier (Phase 9.6).
// EVERY agent tool call passes through classifyPilotAction() before execution:
//   safe_read         -> auto-run (no approval)
//   safe_write        -> human approval (bounded memory change)
//   requires_approval -> human approval (file writes / mutating ops)
//   blocked           -> refused, never executed, no approval offered
// This is the guardrail layer only — it adds NO operational/destructive tools.

import { TOOLS, repoCommandRisk } from "./tools";

export type PilotRiskLevel = "safe_read" | "safe_write" | "requires_approval" | "blocked";

export interface PilotActionDecision {
  action: string;
  risk: PilotRiskLevel;
  reason: string;
  requiresApproval: boolean;
  blocked: boolean;
  summary: string; // human-readable, secret-free
  expectedEffect: string;
}

// Forward-looking blocklist: destructive / secret / unsafe-prod patterns. No current tool matches —
// this ensures any FUTURE tool matching these is refused by default until explicitly reclassified.
const BLOCKED_RE = /(shell|\bexec\b|spawn|deploy|restart|reboot|\brm\b|rmrf|truncate|\bdrop\b|db\.(migrate|drop|truncate|write)|migrat|\binstall\b|secret|credential|password|token|exfil|\bprod\b)/i;

// Memory-changing tools => safe_write (still gated, but a clearly bounded memory-only change).
const MEMORY_WRITE = new Set(["memory.ingest", "memory.delete", "memory.reingest"]);

// Read-only image provider ops (also covered by risk:"read"; pinned explicitly per Phase 9.7).
const IMAGE_SAFE_READ = new Set(["image.health", "image.preview"]);

// Ops MUTATIONS are NOT enabled (Phase 10.4 is read-only). These are blocked, never approval-gated.
const OPS_BLOCKED = new Set(["ops.restart", "ops.deploy", "ops.suspend", "ops.resume", "ops.restore", "ops.dns.update", "ops.invoice.update", "ops.db.migrate", "ops.ssh", "ops.shell"]);

// Sandbox file writers => requires_approval.
const FILE_WRITE_RE = /^(scratch\.write|image\.(resize|convert|crop|annotate|generate))/;

const SECRET_KEY_RE = /secret|token|password|key|credential/i;

function summarize(name: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args ?? {})
    .filter(([k]) => !SECRET_KEY_RE.test(k)) // never echo secret-looking keys into the approval payload
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 48 ? s.slice(0, 48) + "…" : s}`;
    });
  return `${name}(${parts.join(", ")})`;
}

function effectFor(risk: PilotRiskLevel): string {
  switch (risk) {
    case "safe_read": return "Reads data only — no changes.";
    case "safe_write": return "Will add or remove records in MigraPilot memory.";
    case "requires_approval": return "Will create or modify a file in the sandbox.";
    case "blocked": return "Refused — this operation is not permitted in this phase.";
  }
}

export function classifyPilotAction(name: string, args: Record<string, unknown> = {}): PilotActionDecision {
  const summary = summarize(name, args);
  const mk = (risk: PilotRiskLevel, reason: string, effect?: string): PilotActionDecision => ({
    action: name,
    risk,
    reason,
    requiresApproval: risk === "safe_write" || risk === "requires_approval",
    blocked: risk === "blocked",
    summary,
    expectedEffect: effect ?? effectFor(risk),
  });

  if (OPS_BLOCKED.has(name)) return mk("blocked", "ops mutations are not enabled in this phase (read-only ops only)");
  if (BLOCKED_RE.test(name)) return mk("blocked", "matches a blocked pattern (shell/deploy/db/install/secret/destructive/prod)");

  const tool = TOOLS[name];
  if (!tool) return mk("blocked", "unknown tool — not in the allowlisted registry");

  // Coding hand (Phase 10.3): repo.command risk is per-command; code.apply edits a repo file.
  if (name === "repo.command") {
    const cmd = typeof args.command === "string" ? args.command : "";
    const r = repoCommandRisk(cmd);
    if (r === "blocked") return mk("blocked", "command is not in the repo allowlist");
    if (r === "read") return mk("safe_read", "allowlisted read-only repo command");
    return mk("requires_approval", "allowlisted build / typecheck command", "Will run a build/typecheck command in the repo (no commit).");
  }
  if (name === "code.apply") return mk("requires_approval", "applies a change to a repository file", "Will create or modify a repository file (no commit).");

  if (IMAGE_SAFE_READ.has(name)) return mk("safe_read", "read-only image provider operation");
  if (tool.risk === "read") return mk("safe_read", "read-only operation");
  if (MEMORY_WRITE.has(name)) return mk("safe_write", "changes MigraPilot memory");
  if (FILE_WRITE_RE.test(name)) return mk("requires_approval", "writes a file in the sandbox");
  return mk("requires_approval", `mutating operation (tool risk: ${tool.risk})`);
}
