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
  /^(build|create|implement|add|fix|refactor|write|generate|scaffold|make|set\s*up|run|install|debug|investigate|diagnose|instrument|update|rename|convert|migrate|optimize|remove|delete|building|creating|implementing|adding|fixing|refactoring|writing|generating|scaffolding|making|setting\s*up|running|installing|debugging|updating|renaming|converting|migrating|optimizing|removing|deleting)\b/i;

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

/** Build/design/proposal framing — these are REQUESTS TO THE MODEL ("wire it
 * up", "design a system", "propose"), never a read-only inspection of the
 * current workspace, even if they mention files or use a verb like "show". */
const BUILD_DESIGN_SIGNAL =
  /\b(propos\w+|design|architect\w*|build|implement|create|scaffold|wire\s*(it|this|them)?\s*up|set\s*up|generate|write|refactor|add\s+a|should\s+(be|have|use|support)|would\s+(be|need)|plan\s+(a|for|out)|spec(ification)?|requirements?|dashboard|feature|integrat\w+|deploy\w*|roadmap|mvp)\b/i;

export function isInspectionIntent(p: string): boolean {
  // Inspection is for SHORT, explicit "what's my workspace state" queries. A long
  // message or one with build/design framing is a real request for the model —
  // route it to chat (which is grounded) so it is answered, never dead-ended in a
  // read-only inspection that can't help. Claude/Copilot never gate this away.
  const words = p.split(/\s+/).filter(Boolean).length;
  if (words > 40 || p.length > 320) return false;
  if (BUILD_DESIGN_SIGNAL.test(p)) return false;
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

/** Common domain TLDs — a bare token ending in one of these (e.g.
 * `compassionfuneralchapel.com`) is a DOMAIN NAME, not a file to read. */
const DOMAIN_TLD =
  /\.(com|org|net|io|co|dev|app|ai|gov|edu|info|biz|me|us|uk|ca|xyz|online|site|store|tech|cloud|email|link|live|news|shop|blog|page|host)$/i;

/** A token is a file reference if it is a path (has a slash) or has a real file
 * extension — but NOT a bare domain name. Prevents planning a read of a domain. */
function looksLikeFile(token: string): boolean {
  if (token.includes('/')) return true; // a workspace-relative path
  return !DOMAIN_TLD.test(token); // bare `foo.com` is a domain, not a file
}

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

  // read a specific file (but not a bare domain name that merely looks file-ish)
  if (/\b(read|open|show|cat|display|print)\b/i.test(p)) {
    const f = FILENAME.exec(p);
    if (f?.[1] && looksLikeFile(f[1])) add('read', { path: f[1] });
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
  /\b(app|apps|application|applications|file|files|function|functions|class|classes|component|components|module|modules|test|tests|bug|error|errors|script|scripts|page|pages|endpoint|endpoints|route|routes|api|apis|package|dependency|dependencies|project|folder|repo|json|config|build|lint|type ?error|latency|stage|pipeline|pipelines|utility|tool|tools|cli|database|schema|service|services|library|libraries|server|servers|system|systems|feature|features|functionality|prototype|mvp|boilerplate|scaffold|skeleton|structure|integration|dashboard|monitor|monitoring|poller|worker|handler|middleware|hook|hooks|store|model|models|controller|controllers|view|views|widget|screen|screens|form|forms|pwa|ui|frontend|backend|thing|things|it|this|that|them|everything)\b/i;

/** A file-ish token: something/with/slashes or name.ext */
const FILEISH = /(\.[a-z]{1,5}\b|\/[\w.-]+)/i;

const QUESTION_LEAD = /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|explain|describe|tell me|compare)\b/i;

/** Imperative lead-ins that precede an action directive without changing it into a
 * question: "you can now build …", "go ahead and create …", "please implement …",
 * "let's scaffold …", "now build it". Stripped before the task-verb test so a build
 * DIRECTIVE that is not sentence-initial still routes to the engineer — the way
 * Copilot/Claude act on "you can now build the system". A polite "can you build …"
 * / "could you create …" is a directive too (not a real question), so those leads
 * are absorbed here as well. */
const ACTION_LEAD =
  /^(?:(?:you\s+can\s+(?:now\s+)?|go\s+ahead(?:\s+and)?\s+|please\s+|now\s+|ok(?:ay)?[,!.\s]+|alright[,!.\s]+|sure[,!.\s]+|yes[,!.\s]+|let'?s\s+|lets\s+|i\s+(?:want|need)\s+(?:you\s+to\s+)?|i'?d\s+like\s+(?:you\s+to\s+)?|time\s+to\s+|proceed\s+(?:to|and|with)\s+|start\s+|begin\s+|can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?)\s*)+/i;

export function classifyIntent(prompt: string): ChatRoute {
  const p = prompt.trim();
  if (!p) return 'conversation';
  // Read-only workspace inspection runs on the LOCAL runner — checked BEFORE the
  // question heuristic so "what is the git status?" inspects rather than being
  // answered (and refused) by the tool-less conversational model.
  if (isInspectionIntent(p)) return 'inspection';
  // Strip leading noise (surrounding quote/backtick, bullet or numbered-list
  // marker, stray punctuation) THEN an imperative lead-in, so a quoted or
  // bulleted build directive ('"build the system"', '- build the app',
  // '1. create the files') routes like a bare one instead of the leading quote
  // defeating the anchored verb match.
  const deNoised = p.replace(/^(?:["'`*_>()\[\].:;,\s–—•·-]|\d+[.)])+/, '').trim() || p;
  const core = deNoised.replace(ACTION_LEAD, '').trim() || deNoised;
  const isTask = TASK_VERBS.test(core) && (CODE_OBJECTS.test(core) || FILEISH.test(core));
  // Questions stay conversational — but a polite "can you build X" whose core is a
  // real task ("build X") is a directive, not a question, so it is NOT diverted.
  if (QUESTION_LEAD.test(deNoised) && !isTask) return 'conversation';
  if (isTask) return 'workspace-task';
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
