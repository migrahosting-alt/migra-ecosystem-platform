// MigraPilot — mock agent (Phase 1).
// Classifies intent, picks an agent profile, and produces a read-only plan.
// NO tools are executed and NO system state is changed. Real model gateway,
// tools, and approval gates arrive in later phases.

import type { AgentProfile, AgentProfileId } from "./types";

export const AGENT_PROFILES: Record<AgentProfileId, AgentProfile> = {
  operator: { id: "operator", name: "Operator Agent", purpose: "General command-center assistant", scope: "General" },
  coding: { id: "coding", name: "Coding Agent", purpose: "Reads repos, suggests patches, prepares PRs", scope: "Engineering" },
  deploy: { id: "deploy", name: "Deploy Agent", purpose: "Checks builds, deploy status, rollback plans", scope: "Execution" },
  billing: { id: "billing", name: "Billing Agent", purpose: "Invoices, subscriptions, payment issues", scope: "Billing" },
  hosting: { id: "hosting", name: "Hosting Agent", purpose: "Domains, DNS, hosting, email, SSL, VPS", scope: "Hosting" },
  security: { id: "security", name: "Security Agent", purpose: "Audits, policies, suspicious changes", scope: "Security" },
  support: { id: "support", name: "Support Agent", purpose: "Client tickets, email drafts, follow-ups", scope: "Support" },
  database: { id: "database", name: "Database Agent", purpose: "Migrations, backups, query diagnostics", scope: "Data" },
};

// Order matters: more specific / stronger-signal intents are matched first.
const CLASSIFY_RULES: [AgentProfileId, RegExp][] = [
  ["coding", /\b(code|coding|refactor|patch|pr|pull request|repo|function|class|bug|unit test|typescript|javascript|python)\b/],
  ["deploy", /\b(deploy|rollback|release|build|pipeline|ci\/?cd)\b/],
  ["database", /\b(database|migration|backup|sql|query|postgres|schema|index)\b/],
  ["billing", /\b(invoice|subscription|payment|stripe|billing|charge|refund|renewal)\b/],
  ["security", /\b(security|audit|policy|vulnerab|breach|suspicious|secret|exploit)\b/],
  ["hosting", /\b(dns|domain|ssl|certificate|hosting|vps|mailbox|nameserver|email)\b/],
  ["support", /\b(ticket|support|client|customer|reply|follow[- ]?up)\b/],
];

export function classifyAgent(message: string): AgentProfileId {
  const m = message.toLowerCase();
  for (const [agent, re] of CLASSIFY_RULES) {
    if (re.test(m)) return agent;
  }
  return "operator";
}

const AGENT_INSPECT_STEP: Partial<Record<AgentProfileId, string>> = {
  deploy: "Check branch, build status, and recent deploys",
  coding: "Search repository and read related files",
  billing: "Look up customer, invoices, and subscription state",
  hosting: "Check DNS, SSL, and hosting records",
  security: "Review recent changes and policy posture",
  support: "Pull related tickets and conversation history",
  database: "Inspect schema, migrations, and backup status",
};

export function buildPlan(agent: AgentProfileId, _message: string): string[] {
  const steps = [
    "Understand request and gather context",
    "Read relevant system state (read-only)",
    "Analyze findings",
    "Prepare a safe plan",
    "Summarize recommendation",
  ];
  const inspect = AGENT_INSPECT_STEP[agent];
  if (inspect) steps[1] = inspect;
  return steps;
}

export function buildSummary(agent: AgentProfile, message: string): string {
  return [
    `**${agent.name}** reviewed your request: "${message.trim()}".`,
    "",
    "This is a read-only planning response — no tools were executed and no system state was changed. Based on the request I would:",
    `1. Gather the relevant ${agent.scope.toLowerCase()} context.`,
    "2. Inspect current system state without making changes.",
    "3. Propose a safe, reviewable plan before any action.",
    "",
    "Approval gates, the model gateway, and real (read-only first) tools arrive in the next phases.",
  ].join("\n");
}

// Guardrails applied to every agent (the safety layer, baked into the system prompt).
const GUARDRAILS = [
  "You are MigraPilot, the AI assistant for the MigraTeck / MigraHosting engineering and operations team.",
  "",
  "Be genuinely helpful, clear, and natural — like a sharp, friendly senior colleague. Answer directly and completely, and explain your reasoning when it helps. Be concise for simple questions and thorough for complex ones; skip filler.",
  "Format with Markdown: short paragraphs, **bold** for emphasis, bullet or numbered lists, and fenced code blocks with a language tag for any code or commands. Match the user's language and tone.",
  "",
  "Tools & safety:",
  "- Use tools ONLY when the request needs repository data or a file action. For greetings, small talk, or general questions, just reply naturally — do NOT call any tool.",
  "- To do something, simply call the right tool. Do NOT narrate an approval step or ask the user to 'confirm or deny' in text — the system automatically holds any change for the user's approval. Never claim an action happened until a tool result confirms it.",
  "- Never reveal, guess, or invent secrets, API keys, passwords, tokens, or credentials.",
  "- If you don't know or lack real data, say so plainly instead of fabricating specifics (hostnames, amounts, IDs).",
].join("\n");

const AGENT_SYSTEM_PROMPTS: Record<AgentProfileId, string> = {
  operator: "Role: Operator Agent — the general command-center assistant. Help with any MigraTeck/MigraHosting operational question and route the user's intent.",
  coding: "Role: Coding Agent — you read repositories, propose patches, and prepare PRs. Give precise, idiomatic, minimal-diff code guidance.",
  deploy: "Role: Deploy Agent — you reason about builds, deploy status, and rollback plans. Always emphasise safe, staged rollout and verification.",
  billing: "Role: Billing Agent — invoices, subscriptions, Stripe, payments, renewals. Be precise about money and never guess amounts.",
  hosting: "Role: Hosting Agent — domains, DNS, SSL, hosting, email, VPS. Give concrete, correct infrastructure guidance.",
  security: "Role: Security Agent — audits, policy, suspicious changes. Be cautious, flag risks explicitly, and prefer least-privilege.",
  support: "Role: Support Agent — client tickets, email drafts, follow-ups. Be clear, empathetic, and customer-appropriate.",
  database: "Role: Database Agent — migrations, backups, query diagnostics. Prioritise data safety, reversibility, and read-only checks first.",
};

const TOOLS_NOTE = [
  "",
  "Tools (use only when needed): git.status, git.log, git.diff, repo.search, repo.read_file, repo.list_files, image.info, image.analyze, image.health, image.preview, memory.search, memory.preview, code.preview, ops.health, ops.check_url, ops.known_topology, ops.hazard_lookup, ops.verify.url, ops.verify.service, ops.verify.deploy, ops.verify.plan, ops.runbook.preview, ops.report.preview, ops.report.generate, ops.health_bundle.preview, ops.health_bundle.run, ops.noop.verify, ops.actions.list, ops.targets.list, ops.targets.check, ops.status_marker.list, ops.status_marker.verify, ops.status_marker.history, ops.webhook_sim.preview, ops.webhook_sim.verify (read-only) and scratch.write_file, image.resize, image.convert, image.crop, image.annotate, image.generate, memory.ingest, code.apply, repo.command, ops.restart.plan, ops.deploy.plan, ops.dns.plan, ops.billing.plan, ops.runbook.generate, ops.noop.execute, ops.status_marker.set, ops.status_marker.transition, ops.webhook_sim.send (these write/change something, run a command, generate a runbook, record a controlled no-op, set/transition an internal status marker, or send a dev webhook simulation and need approval).\n- ops.webhook_sim.send is a DEV SIMULATION: disabled by default, sends to allowlisted dev URLs only, externalMutation:false, simulated:true — it changes NO infrastructure. Real ops mutations stay blocked.\n- ops.status_marker.set records an INTERNAL ops status marker in the journal (mutated:true, externalMutation:false, mutationScope internal_journal_only) — it changes NO infrastructure. Real ops mutations stay blocked.\n- ops.noop.execute is a CONTROLLED NO-OP: it records a controlled execution to prove the approval rails and mutates NOTHING (no command/deploy/restart/API). Real ops mutations stay blocked.\n- Ops actions: ops.*.plan tools are DRY RUN / PLAN ONLY — they generate a grounded plan for operator review and execute NOTHING (no restart/deploy/DNS/billing). Real ops mutations (ops.restart, ops.deploy, ops.dns.update, ops.invoice.update, ops.ssh, etc.) are BLOCKED and must never be attempted.\n- Coding: to change a repo file, call code.preview FIRST (shows the diff, no write), then propose code.apply with the full new file 'content' (optional validate:'tsc'|'build'). repo.command runs ONLY allowlisted commands (git status/diff/rev-parse auto; tsc/build need approval). You cannot run arbitrary shell, deploy, install packages, restart services, or commit.",
  "- Use a read tool only when the user asks about the repo, git, code, an image's details, or to look at / describe / critique an image. Use a write/image tool only when the user explicitly asks to create, edit, or generate a file or image (image.generate makes a brand-new picture from a text prompt). To add files to memory, call memory.preview first, then propose memory.ingest for approval.",
  "- Do NOT call tools for greetings or chit-chat — just reply. After a tool returns, answer concisely. Never invent file paths.",
].join("\n");

export function buildSystemPrompt(agentId: AgentProfileId): string {
  return `${GUARDRAILS}\n\n${AGENT_SYSTEM_PROMPTS[agentId]}\n${TOOLS_NOTE}`;
}
