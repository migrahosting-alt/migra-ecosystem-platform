// Intent routing for ordinary chat text (Slice 2 — workspace-agent capability
// routing). Runs AFTER the explicit /agent interception, BEFORE model routing:
//
//   /agent …            → delegated runtime (explicit-only; unchanged)
//   workspace intent    → local workspace engineer (may attach ecosystem context)
//   everything else     → lightweight conversational chat
//
// The classifier is DETERMINISTIC (keyword heuristics, unit-tested) and
// CONSERVATIVE: it routes to the engineer only on a strong engineering signal,
// so conversational questions stay on the chat path. It never influences the
// delegated runtime — NL inference remains banned there.

export type ChatRoute = 'workspace-task' | 'conversation';

const TASK_VERBS =
  /^(build|create|implement|add|fix|refactor|write|generate|scaffold|make|set\s*up|run|install|debug|investigate|diagnose|instrument|update|rename|convert|migrate|optimize|remove|delete)\b/i;

const CODE_OBJECTS =
  /\b(app|application|file|files|function|class|component|module|test|tests|bug|error|errors|script|page|endpoint|route|api|package|dependency|dependencies|project|folder|repo|json|config|build|lint|type ?error|latency|stage|pipeline)\b/i;

/** A file-ish token: something/with/slashes or name.ext */
const FILEISH = /(\.[a-z]{1,5}\b|\/[\w.-]+)/i;

const QUESTION_LEAD = /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|explain|describe|tell me|compare)\b/i;

export function classifyIntent(prompt: string): ChatRoute {
  const p = prompt.trim();
  if (!p) return 'conversation';
  // Questions stay conversational — advice is the chat path's job.
  if (QUESTION_LEAD.test(p)) return 'conversation';
  if (TASK_VERBS.test(p) && (CODE_OBJECTS.test(p) || FILEISH.test(p))) return 'workspace-task';
  return 'conversation';
}

/** Ecosystem brand markers — deliberately NOT a bare /migra/i (would match
 * "migrate"). Matches when the task or the workspace names an ecosystem brand. */
const ECOSYSTEM_MARKERS =
  /\b(migrateck|migrahosting|migrapilot|migrapanel|migracredit|migramail|migrastock|migrashield|migrapay|migraai|migradrive|migravoice|migracms|annoupale)\b/i;

export interface EcosystemSignals {
  rootPath?: string;
  packageName?: string;
  gitRemoteUrl?: string;
  prompt?: string;
}

/** Attach MigraTeck ecosystem context only when the task or workspace is
 * ecosystem-related (owner: context layer, never a cage). */
export function detectEcosystem(signals: EcosystemSignals): boolean {
  return [signals.rootPath, signals.packageName, signals.gitRemoteUrl, signals.prompt]
    .filter((s): s is string => Boolean(s))
    .some((s) => ECOSYSTEM_MARKERS.test(s));
}
