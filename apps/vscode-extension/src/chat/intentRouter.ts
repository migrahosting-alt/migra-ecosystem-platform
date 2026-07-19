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

export type ChatRoute = 'workspace-task' | 'inspection' | 'conversation';

const TASK_VERBS =
  /^(build|create|implement|add|fix|refactor|write|generate|scaffold|make|set\s*up|run|install|debug|investigate|diagnose|instrument|update|rename|convert|migrate|optimize|remove|delete)\b/i;

// ── Read-only INSPECTION intent ────────────────────────────────────────────────
// A request to SEE something about the ACTUAL workspace/repo (root, files, git
// state) must run on the LOCAL runner's read-only tools — never be answered by the
// tool-less conversational model (which falsely claims "I can't access your local
// environment"). Read-only execution is safe, so this classifier is deliberately
// liberal: a false positive just returns real, harmless workspace evidence.

/** Explicit read-only git inspection, e.g. `git status --short`, `git branch
 * --show-current`, `git rev-parse HEAD`, `git remote -v`, `git log`, `git diff`. */
const GIT_INSPECT = /\bgit\b[\s\S]*\b(status|branch|log|remote|diff|rev-parse|head|show|ls-files|blame|describe)\b/i;

/** A strong "don't change anything" signal — the user is explicitly asking for a
 * read-only operation. */
const READONLY_SIGNAL = /\b(read[-\s]?only|without (?:modifying|changing|editing|writing)|don'?t (?:modify|change|edit|write)|no (?:changes|edits|modifications))\b/i;

/** Inspection verbs (SEE/RETRIEVE), distinct from the engineering TASK verbs. */
const INSPECT_VERBS =
  /\b(report|show|list|display|print|find|search|locate|read|cat|open|get|check|inspect|look\s*up|tell\s*me|what'?s)\b/i;

/** Objects that reference the real workspace/repo/git state. */
const INSPECT_OBJECTS =
  /\b(workspace|repo|repository|working\s*director(?:y|ies)|current\s*director(?:y|ies)|cwd|root|folder|folders|director(?:y|ies)|file|files|branch|branches|commit|commits|remote|remotes|status|diff|head|package\.json|dependenc(?:y|ies)|tree|path|paths|untracked|staged|package\s*manager)\b/i;

/** Detect a read-only workspace-inspection request. Ordered BEFORE the question
 * and task heuristics so "what is the git status?" inspects rather than chats. */
/** Objects that reference a concrete LOCAL fact strongly enough to imply
 * inspection on their own (even phrased as a question). */
const STRONG_INSPECT_OBJECTS =
  /\b(package\s*manager|package-?manager|workspace\s*root|current\s*(?:working\s*)?director(?:y|ies)|working\s*director(?:y|ies)|cwd)\b/i;

export function isInspectionIntent(p: string): boolean {
  if (GIT_INSPECT.test(p)) return true;
  if (STRONG_INSPECT_OBJECTS.test(p)) return true;
  if (READONLY_SIGNAL.test(p) && (INSPECT_OBJECTS.test(p) || /\bgit\b|\bcommand/i.test(p))) return true;
  if (INSPECT_VERBS.test(p) && INSPECT_OBJECTS.test(p)) return true;
  return false;
}

/** The read-only inspection operations the local runner exposes (mirror of the
 * brain's `POST /api/ai/inspect` op set). */
export type InspectOp =
  | 'workspace_root' | 'list' | 'find' | 'search' | 'read'
  | 'git_status' | 'git_branch' | 'git_head' | 'git_remotes' | 'pkg_manager';

export interface InspectionStep {
  op: InspectOp;
  query?: string;
  path?: string;
  /** `find` filter: only files, only directories, or any (default). */
  kind?: 'file' | 'dir' | 'any';
}

const FILENAME = /([\w./-]+\.[a-z0-9]{1,6})\b/i;

/** Words that commonly follow "in" as an English idiom, NOT a directory name
 * ("in accordance with", "in order to", "in general", …). A bare token matching
 * this is never treated as a `list` sub-path. */
const NON_DIRECTORY_WORD =
  /^(accordance|order|general|particular|addition|fact|terms|place|case|contrast|line|response|sync|progress|question|common|mind|part|parts|detail|details|favor|charge|short|front|return|effect|practice|practices|principle|principles|theory|reality|summary|total|full|use|other|which|this|that|these|those|all|any|some|each|both|the|a|an|it|them|here|there)$/i;

/** Deterministically translate an inspection prompt into concrete read-only ops.
 * A request that mentions several facets (e.g. "git state") expands to a small
 * bundle. Never returns an empty plan for an inspection intent — a generic
 * request falls back to a safe overview (root + git status). */
export function buildInspectionPlan(prompt: string): InspectionStep[] {
  const p = prompt.trim();
  const steps: InspectionStep[] = [];
  const add = (op: InspectOp, extra: Partial<InspectionStep> = {}): void => {
    if (!steps.some((s) => s.op === op && s.path === extra.path && s.query === extra.query)) steps.push({ op, ...extra });
  };

  if (/\b(workspace|current|working)\s*(root|director|folder)|\bcwd\b|\bwhere\s+(am\s+i|is\s+(the|my))\b|\broot\s+(director|folder|path)\b/i.test(p)) add('workspace_root');

  // git facets
  const gitAll = /\bgit\b.*\bcommands?\b|\bgit\s+state\b|\bread[-\s]?only\s+git\b/i.test(p);
  if (gitAll || /\bgit\s+status\b|\bstatus\b|\buntracked\b|\bstaged\b|\bdirty\b|\bchanges?\b/i.test(p)) add('git_status');
  if (gitAll || /\bbranch\b/i.test(p)) add('git_branch');
  if (gitAll || /\b(head|commit|sha|rev[-\s]?parse)\b/i.test(p)) add('git_head');
  if (gitAll || /\bremotes?\b/i.test(p)) add('git_remotes');

  // package manager
  if (/\bpackage\s*manager\b|\bpackage-?manager\b|\bwhich\s+(pm|package)\b|\bdependenc/i.test(p)) add('pkg_manager');

  // read a specific file
  if (/\b(read|open|show|cat|display|print)\b/i.test(p)) {
    const f = FILENAME.exec(p);
    if (f) add('read', { path: f[1] });
  }

  // search — extract the target token: prefer "named/called X", then "for … X",
  // then a quoted literal. (A bare "for a directory" with no target adds nothing.)
  if (/\b(search|find|locate|grep)\b/i.test(p)) {
    const q =
      /\b(?:named|called|matching)\s+["'`]?([\w.\-/*]{2,})["'`]?/i.exec(p)?.[1] ??
      /\bfor\s+(?:an?\s+|the\s+)?(?:director(?:y|ies)|folder|files?|file)?\s*["'`]?([\w.\-/*]{2,})["'`]?/i.exec(p)?.[1] ??
      /\b(?:find|locate|grep)\s+(?:for\s+)?["'`]?([\w.\-/*]{2,})["'`]?/i.exec(p)?.[1] ??
      /["'`]([^"'`]{2,})["'`]/.exec(p)?.[1];
    if (q && q.length >= 2) {
      // CONTENT search only when the user explicitly asks for text/contents;
      // otherwise a "search/find" is a filesystem NAME/PATH search (`find`).
      const wantsContent = /\b(content|contents|text|string|occurrence|inside|grep|containing)\b/i.test(p);
      if (wantsContent) {
        add('search', { query: q });
      } else {
        const kind: 'file' | 'dir' | 'any' = /\b(director(?:y|ies)|folder)\b/i.test(p) ? 'dir' : /\bfiles?\b/i.test(p) ? 'file' : 'any';
        add('find', { query: q, kind });
      }
    }
  }

  // directory listing — extract a sub-path CONSERVATIVELY so an English idiom
  // ("in accordance/order/general…") is never mistaken for a directory. Accept a
  // path-like token (contains a slash) anywhere; accept a bare name only when it
  // sits at a clause boundary AND is not a common non-directory word after "in".
  if (/\b(list|ls|directory\s+listing|what\s+files|which\s+files|files\s+(in|under|are))\b/i.test(p)) {
    const slashDir = /\b(?:in|under|inside)\s+(?:the\s+)?["'`]?(\.?\/?[\w.\-]+(?:\/[\w.\-]+)+\/?|\.\/[\w.\-/]+)["'`]?/i.exec(p)?.[1];
    let listDir = slashDir;
    if (!listDir) {
      const bare = /\b(?:under|inside|in)\s+(?:the\s+)?(?:director(?:y|ies)\s+|folder\s+(?:named\s+|called\s+)?)?["'`]?([\w\-][\w.\-]*[\w\-]|[\w\-]{2})["'`]?\s*(?:$|[.,;:!?]|\s+(?:folder|director))/i.exec(p)?.[1];
      if (bare && !NON_DIRECTORY_WORD.test(bare)) listDir = bare;
    }
    add('list', listDir && listDir !== 'the' ? { path: listDir } : {});
  }

  // Generic inspection with no specific facet → safe overview.
  if (steps.length === 0) { add('workspace_root'); add('git_status'); }
  return steps;
}

const CODE_OBJECTS =
  /\b(app|application|file|files|function|class|component|module|test|tests|bug|error|errors|script|page|endpoint|route|api|package|dependency|dependencies|project|folder|repo|json|config|build|lint|type ?error|latency|stage|pipeline|utility|tool|cli|database|schema|service|library|server)\b/i;

/** A file-ish token: something/with/slashes or name.ext */
const FILEISH = /(\.[a-z]{1,5}\b|\/[\w.-]+)/i;

const QUESTION_LEAD = /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|explain|describe|tell me|compare)\b/i;

export function classifyIntent(prompt: string): ChatRoute {
  const p = prompt.trim();
  if (!p) return 'conversation';
  // Read-only workspace inspection runs on the LOCAL runner — checked BEFORE the
  // question heuristic so "what is the git status?" inspects rather than being
  // answered (and refused) by the tool-less conversational model.
  if (isInspectionIntent(p)) return 'inspection';
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
