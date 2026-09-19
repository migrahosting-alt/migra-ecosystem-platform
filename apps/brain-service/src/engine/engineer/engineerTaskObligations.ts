/**
 * Controller-owned obligations derived from what the TASK actually asked for.
 *
 * The repository-map contract in engineerRuntime.ts already refuses a final when
 * its nine fixed obligations are unmet — but only for tasks that arm it, and it
 * arms on a keyword heuristic (`requiresRepositoryMapEvidence`). A real owner
 * prompt asking for six specific inspections scored 3 against its threshold of 4,
 * so the contract recorded `enabled: false` and the run was free to answer
 * whatever it liked. It did:
 *
 *   - it claimed src/server/database.ts and src/server/ledger.ts as the
 *     server-side implementation, having never opened either
 *   - it claimed playwright.config.ts as the test implementation, likewise
 *   - it wrote "though not fully shown here" and still called the inspection
 *     complete
 *
 * All three are checkable against the run's own durable observations, and all
 * three are false. So the failure is not that the model lied; it is that nothing
 * independent of the model was counting.
 *
 * This module is that counter. Obligations are derived from the task text once,
 * up front, and then only OBSERVED TOOL RESULTS can move them. Model prose,
 * plan.update, and the model's own belief that it is finished have no effect on
 * an obligation's status — which is the whole point.
 *
 * Evidence TYPE is load-bearing, not decoration. `workspace.find` proves that a
 * path matching a pattern exists; it can never prove what a file contains, and
 * it can never prove an implementation is absent. A requirement to INSPECT an
 * API implementation is therefore satisfiable only by file content.
 */

import type { ToolEvidenceSemantic } from '../models/capabilityRegistry.js';

/** What a piece of evidence is capable of proving. */
export type ObligationEvidenceType =
  | 'file_content'
  | 'directory_listing'
  | 'path_discovery'
  | 'content_search'
  | 'repo_state';

/**
 * PENDING    nothing has satisfied it yet — a success final is refused
 * SATISFIED  observed evidence of an accepted type and shape
 * UNPROVABLE the workspace cannot supply it (e.g. no such directory exists).
 *            A final may explain the limitation but must not claim completion.
 * FAILED     evidence was sought and contradicted the requirement
 */
export type ObligationStatus =
  | 'PENDING'
  | 'SATISFIED'
  | 'UNPROVABLE'
  | 'FAILED';

export interface TaskObligation {
  readonly id: string;
  readonly kind: 'task';
  readonly description: string;
  readonly requiredEvidenceTypes: readonly ObligationEvidenceType[];
  status: ObligationStatus;
  acceptedEvidenceRefs: string[];
  failureReason?: string;
}

/** Map a tool's declared evidence semantics onto what it can prove here. */
export function evidenceTypeOf(
  semantics: readonly ToolEvidenceSemantic[] | undefined,
): ObligationEvidenceType | undefined {
  const set = new Set(semantics ?? []);
  if (set.has('workspace.file_content')) return 'file_content';
  if (set.has('workspace.directory_listing')) return 'directory_listing';
  if (set.has('workspace.content_search')) return 'content_search';
  if (set.has('workspace.path_discovery')) return 'path_discovery';
  if (set.has('vcs.state')) return 'repo_state';
  return undefined;
}

interface ObligationRule {
  readonly id: string;
  /** Recognised in the task text. */
  readonly trigger: RegExp;
  readonly description: string;
  readonly requiredEvidenceTypes: readonly ObligationEvidenceType[];
  /** Whether a given observed path can stand as evidence for this obligation. */
  accepts(path: string): boolean;
}

const norm = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();

const isTestPath = (path: string): boolean => {
  const p = norm(path);
  return (
    p === 'test' ||
    p === 'tests' ||
    p.startsWith('test/') ||
    p.startsWith('tests/') ||
    p.includes('/test/') ||
    p.includes('/tests/') ||
    p.includes('__tests__/') ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p)
  );
};

/**
 * Deliberately a declarative table rather than model instructions.
 *
 * Adding a requirement means adding a row whose satisfaction is mechanically
 * checkable. A rule that cannot be checked against an observation does not
 * belong here, because an obligation nothing can satisfy is just a stuck run.
 */
const RULES: readonly ObligationRule[] = [
  {
    id: 'task.manifest',
    trigger: /\bpackage\.json\b|\bmanifest\b/i,
    description: 'read the package manifest',
    requiredEvidenceTypes: ['file_content'],
    accepts: (path) => {
      const p = norm(path);
      return p === 'package.json' || p.endsWith('/package.json');
    },
  },
  {
    id: 'task.source_tree',
    trigger: /\bsrc tree\b|\bsource tree\b|\binspect the src\b|\bsrc directory\b/i,
    description: 'inspect the source tree',
    requiredEvidenceTypes: ['directory_listing'],
    accepts: (path) => {
      const p = norm(path);
      return p === 'src' || p.startsWith('src/') || p === '' || p === '.';
    },
  },
  {
    id: 'task.entrypoint',
    trigger: /\bentry ?point\b/i,
    description: 'read the application entrypoint',
    requiredEvidenceTypes: ['file_content'],
    accepts: (path) => {
      const p = norm(path);
      // Configuration is not an entrypoint, which is a mistake this run made.
      if (/(?:^|\/)[^/]*\.config\.[cm]?[jt]sx?$/.test(p)) return false;
      return /(?:^|\/)(?:app\/)?(?:page|layout|main|index|app|server)\.[cm]?[jt]sx?$/.test(p);
    },
  },
  {
    id: 'task.api_implementation',
    trigger: /\bapi implementation\b|\ban api\b|\bapi route\b|\bapi endpoint\b/i,
    description: 'read an API implementation file',
    requiredEvidenceTypes: ['file_content'],
    accepts: (path) => {
      const p = norm(path);
      return p.includes('/api/') || p.startsWith('api/') || p.includes('/routes/') || p.startsWith('routes/');
    },
  },
  {
    id: 'task.server_implementation',
    trigger: /\bserver[- ]side implementation\b|\bserver implementation\b|\bbackend implementation\b/i,
    description: 'read a server-side implementation file',
    requiredEvidenceTypes: ['file_content'],
    accepts: (path) => {
      const p = norm(path);
      return p.includes('/server/') || p.startsWith('server/') || p.includes('/backend/') || p.startsWith('backend/');
    },
  },
  {
    id: 'task.test_implementation',
    trigger: /\btest implementation\b|\btest file\b|\bone test\b|\btest implementations\b/i,
    description: 'read a test implementation file',
    requiredEvidenceTypes: ['file_content'],
    accepts: (path) => isTestPath(path),
  },
];

export interface TaskObligationState {
  readonly obligations: TaskObligation[];
  /**
   * Every evidence type this run actually produced.
   *
   * Tracked for ALL runs, including those that stated no obligations, because a
   * claim of absence can be made by any answer and must be checkable against what
   * the run really did.
   */
  readonly observedEvidenceTypes: Set<ObligationEvidenceType>;
}

/*
 * A claim that something does not EXIST in the repository.
 *
 * The run this guards against answered "I couldn't find any implementation
 * files…" after `workspace.list`, `git.overview`, one `file.read` and a
 * `workspace.find`. It never searched any file's contents, so it had no evidence
 * capable of supporting that sentence.
 *
 * The distinction that makes this safe is SEMANTIC absence versus FILE absence.
 * "There is no package-lock.json" is a claim about a named path, and a listing
 * genuinely settles it. "There are no payment handlers" is a claim about what the
 * code DOES, and only searching content can support it. So the object of the
 * sentence must be a capability — an implementation, a handler, logic, an
 * endpoint — never a filename.
 */
const ABSENCE_OBJECT =
  '(?:implementations?|handlers?|endpoints?|components?|services?|modules?|features?|functions?|logic|code)';

const SEMANTIC_ABSENCE_PATTERNS: readonly RegExp[] = [
  // "I couldn't find any implementation files", "was unable to locate any handler"
  new RegExp(
    String.raw`\b(?:could\s?n[o']?t|cannot|can['’]t|was unable to|were unable to|did\s?n[o']?t|unable to)\s+(?:find|locate|identify|discover)\b[^.\n]{0,40}?\b${ABSENCE_OBJECT}\b`,
    'i',
  ),
  // "I found no matching code", "there are no payment handlers", "I see no service"
  new RegExp(
    String.raw`\b(?:found|there\s+(?:is|are)|i\s+see|we\s+see)\s+no\b[^.\n]{0,40}?\b${ABSENCE_OBJECT}\b`,
    'i',
  ),
  // "No implementation exists", "no handlers were found", "no logic is present"
  new RegExp(
    String.raw`\bno\b[^.\n]{0,40}?\b${ABSENCE_OBJECT}\b[^.\n]{0,30}?\b(?:exists?|were found|was found|is present|are present|could be found)\b`,
    'i',
  ),
  // "Nothing in the source implements…", "nothing in the repository handles…"
  new RegExp(
    String.raw`\bnothing\b[^.\n]{0,40}?\b(?:implements?|handles?|defines?|provides?)\b`,
    'i',
  ),
  // "the repository does not implement…", "this project does not contain any handler"
  new RegExp(
    String.raw`\b(?:does\s?n[o']?t|do\s?n[o']?t)\s+(?:implement|contain|define|provide)\b[^.\n]{0,40}?\b${ABSENCE_OBJECT}\b`,
    'i',
  ),
];

/** Whether an answer asserts that a capability is absent from the repository. */
export function claimsSemanticAbsence(text: string): boolean {
  const body = String(text ?? '');
  return SEMANTIC_ABSENCE_PATTERNS.some((pattern) => pattern.test(body));
}

/**
 * A semantic-absence claim is supportable only by repository content search.
 *
 * `workspace.find` proves that no matching PATH was discovered, which is a
 * different statement and a much weaker one — a handler named nothing like the
 * thing it handles is invisible to it.
 */
export function absenceClaimUnsupported(
  state: TaskObligationState,
  finalText: string,
): boolean {
  if (!claimsSemanticAbsence(finalText)) return false;
  return !state.observedEvidenceTypes.has('content_search');
}

export const ABSENCE_OBLIGATION_DIRECTIVE = [
  'COMPLETION REFUSED BY THE CONTROLLER.',
  'This answer states that something does not exist in the repository, and no content search was run.',
  '',
  'workspace.find proves only that no matching PATH was discovered. It cannot show what',
  'the code does, so it can never establish that an implementation is absent.',
  '',
  'Run workspace.search across the relevant source area now, or drop the claim of absence',
  'and describe only what you actually observed.',
].join('\n');

/** Derive the obligations a task text explicitly asked for. */
export function deriveTaskObligations(
  taskText: string,
  specification = '',
): TaskObligationState {
  const text = `${taskText ?? ''}\n${specification ?? ''}`;

  const obligations = RULES.filter((rule) => rule.trigger.test(text)).map(
    (rule): TaskObligation => ({
      id: rule.id,
      kind: 'task',
      description: rule.description,
      requiredEvidenceTypes: rule.requiredEvidenceTypes,
      status: 'PENDING',
      acceptedEvidenceRefs: [],
    }),
  );

  return {
    obligations,
    observedEvidenceTypes: new Set<ObligationEvidenceType>(),
  };
}

function ruleFor(id: string): ObligationRule | undefined {
  return RULES.find((rule) => rule.id === id);
}

/**
 * Observe one SUCCESSFUL read-only tool result and advance any obligation it
 * genuinely satisfies. Returns how many moved to SATISFIED.
 *
 * Nothing here consults the model's intent. A `file.read` that returns an error,
 * or empty content, or content for a different path than was asked for, proves
 * nothing and is ignored — a successful dispatch is not a successful inspection.
 */
export function observeTaskObligations(
  state: TaskObligationState,
  toolId: string | undefined,
  semantics: readonly ToolEvidenceSemantic[] | undefined,
  toolInput: unknown,
  result: unknown,
): number {
  const evidenceType = evidenceTypeOf(semantics);
  if (!evidenceType) return 0;

  const record =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  if (record.ok === false || record.error) return 0;

  /*
   * Recorded BEFORE the obligation loop and regardless of whether this task
   * derived any obligations, because an absence claim can be made by any answer.
   * Gating this behind `obligations.length` would leave exactly the run that
   * provoked instance A — an open-ended inspection — with nothing to check.
   */
  state.observedEvidenceTypes.add(evidenceType);

  if (state.obligations.length === 0) return 0;

  const input =
    toolInput && typeof toolInput === 'object'
      ? (toolInput as Record<string, unknown>)
      : {};
  const requestedPath = typeof input.path === 'string' ? input.path : '';

  // File content must actually have arrived, and for the path that was asked for.
  if (evidenceType === 'file_content') {
    const content = typeof record.content === 'string' ? record.content : '';
    const returnedPath =
      typeof record.path === 'string' ? record.path : requestedPath;
    if (content.trim().length === 0) return 0;
    if (norm(returnedPath) !== norm(requestedPath)) return 0;
  }

  // A listing must have returned entries for the directory that was asked for.
  if (evidenceType === 'directory_listing') {
    if (!Array.isArray(record.entries)) return 0;
  }

  let advanced = 0;

  for (const obligation of state.obligations) {
    if (obligation.status === 'SATISFIED') continue;
    if (!obligation.requiredEvidenceTypes.includes(evidenceType)) continue;

    const rule = ruleFor(obligation.id);
    const candidate =
      evidenceType === 'directory_listing' && typeof record.dir === 'string'
        ? record.dir
        : requestedPath;

    if (!rule?.accepts(candidate)) continue;

    obligation.status = 'SATISFIED';
    obligation.acceptedEvidenceRefs.push(
      `${toolId ?? 'unknown'}(${norm(candidate) || '.'})`,
    );
    advanced += 1;
  }

  return advanced;
}

/** Obligations that still forbid a claim of completion. */
export function unresolvedTaskObligations(
  state: TaskObligationState,
): TaskObligation[] {
  return state.obligations.filter(
    (obligation) => obligation.status === 'PENDING' || obligation.status === 'FAILED',
  );
}

/**
 * The directive handed back to the model when a success final is refused.
 *
 * It names the obligation and the evidence TYPE that can discharge it, because
 * the run that provoked this module answered from filenames it had found but
 * never opened.
 */
export function renderTaskObligationDirective(
  unresolved: readonly TaskObligation[],
): string {
  return [
    'COMPLETION REFUSED BY THE CONTROLLER.',
    'This task has unsatisfied evidence obligations:',
    ...unresolved.map(
      (obligation) =>
        `  [ ] ${obligation.id} — ${obligation.description} ` +
        `(requires ${obligation.requiredEvidenceTypes.join(' or ')})`,
    ),
    '',
    'These are controller-owned. Prose, plan.update and naming a file cannot satisfy them.',
    'Finding a path is not reading it: workspace.find proves a path exists and nothing more.',
    'Read the actual file contents now, or state plainly that you could not and why.',
  ].join('\n');
}
