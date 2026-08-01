// MigraPilot — the classification of every dispatch inside a chat turn.
//
// A chat turn owns child operations. Deciding WHICH calls are children cannot be done
// by guessing from a client class name: `deps.migraAiClient` appears at sites that
// stream a model completion, at sites that run a read-only workspace tool, and at sites
// that write files. Those are three different governance answers.
//
// So each call site is classified explicitly here, and a guard asserts the source
// contains no dispatch-shaped call that is missing from this table. Adding a new
// provider or tool call therefore forces a decision rather than allowing a silent
// omission — the same reason the Brain-fetch guard exists.

/** What kind of thing the call actually is. */
export type DispatchClass =
  /** A governed Brain request through brainClient/runBrainOperation. */
  | 'brain_operation'
  /** A request to the MigraAI Engine (streamed completion or agent loop). */
  | 'migraai_provider'
  /** A request to an external model/provider, e.g. pilot-api streaming. */
  | 'external_provider'
  /** Read-only workspace tooling executed through the engine. */
  | 'local_tool'
  /** Something that mutates the repository or working tree. */
  | 'repository_command'
  /** Local computation or a cached lookup; no remote work, nothing to outlive a crash. */
  | 'passive_local';

export interface DispatchSite {
  /** Identifier used in the child record's `requestedAction`. */
  readonly id: string;
  /** The callee as it appears in source — what the guard matches on. */
  readonly callee: string;
  readonly classification: DispatchClass;
  /**
   * Whether this dispatch must be registered as a child before it runs.
   *
   * True for anything that can outlive the turn's own loop: if the extension dies
   * mid-flight, a record must already exist saying work was sent. False only where
   * nothing was sent, or where the work is already governed by its own record.
   */
  readonly requiresChild: boolean;
  /** Why. Stated so the decision is reviewable rather than merely asserted. */
  readonly rationale: string;
}

export const CHAT_DISPATCH_SITES: readonly DispatchSite[] = [
  {
    id: 'agent_command',
    callee: 'runAgentCommand',
    classification: 'migraai_provider',
    requiresChild: true,
    rationale: 'Dispatches the engine agent runtime; the run continues server-side if we die.',
  },
  {
    id: 'deep_command',
    callee: 'runDeepCommand',
    classification: 'migraai_provider',
    requiresChild: true,
    rationale: 'Agentic answer loop with tool calls — long-running and remote.',
  },
  {
    id: 'backend_resolve',
    callee: 'router.resolve',
    classification: 'passive_local',
    requiresChild: false,
    rationale:
      'Resolves which backend to use and probes readiness. Already covered by the connection ' +
      'record, and it performs no work on the user’s behalf that could be left half-done.',
  },
  {
    id: 'inspection_turn',
    callee: 'runInspectionTurn',
    classification: 'local_tool',
    requiresChild: true,
    rationale:
      'Read-only, but executed remotely and asynchronously — an interrupted inspection must ' +
      'be reported as interrupted rather than silently absent.',
  },
  {
    id: 'engineer_turn',
    callee: 'runEngineerTurn',
    classification: 'migraai_provider',
    requiresChild: true,
    rationale: 'The main build loop. The most consequential dispatch in the turn.',
  },
  {
    id: 'apply_changeset',
    callee: 'previewAndMaybeApplyChangeset',
    classification: 'repository_command',
    requiresChild: true,
    rationale:
      'Writes to the working tree. A partially applied changeset is precisely the outcome that ' +
      'must never be inferred — it has to be recorded.',
  },
  {
    id: 'remote_stream',
    callee: 'streamRemote',
    classification: 'external_provider',
    requiresChild: true,
    rationale: 'Streams from pilot-api; the remote run outlives our loop.',
  },
  {
    id: 'workspace_find',
    callee: 'migraAiClient.inspect',
    classification: 'local_tool',
    requiresChild: true,
    rationale: 'Remote read-only tool call — same interruption argument as the inspection turn.',
  },
  {
    id: 'local_chat_stream',
    callee: 'migraAiClient.chatStream',
    classification: 'migraai_provider',
    requiresChild: true,
    rationale: 'The ordinary streamed completion. Generation continues server-side after an abort.',
  },
  {
    id: 'remote_router_stream',
    callee: 'router.chat',
    classification: 'external_provider',
    requiresChild: true,
    rationale: 'The actual remote stream inside streamRemote; the run continues after we abort.',
  },
  {
    id: 'cloud_escalation',
    callee: 'escalationDispatch',
    classification: 'external_provider',
    requiresChild: true,
    rationale:
      'Sends the turn to a CLOUD provider after the consent modal. Consequential, remote, and ' +
      'previously invisible — it was bound to a variable named `d` until this guard found it.',
  },
  {
    id: 'local_stream_wrapper',
    callee: 'streamLocalEngine',
    classification: 'passive_local',
    requiresChild: false,
    rationale:
      'A local wrapper in this same file; the remote call it makes (migraAiClient.chatStream) is ' +
      'registered separately and is scanned by the same guard.',
  },
  {
    id: 'task_root',
    callee: 'resolveTaskRoot',
    classification: 'passive_local',
    requiresChild: false,
    rationale: 'Resolves and optionally creates a local folder. No work is sent anywhere.',
  },
  {
    id: 'chat_scope',
    callee: 'resolveChatScope',
    classification: 'passive_local',
    requiresChild: false,
    rationale: 'Local scope computation over already-known state.',
  },
  {
    id: 'folder_picker',
    callee: 'vscode.window.showOpenDialog',
    classification: 'passive_local',
    requiresChild: false,
    rationale: 'An editor prompt. Nothing is dispatched; the user either chooses or does not.',
  },
  {
    id: 'mkdir',
    callee: 'vscode.workspace.fs.createDirectory',
    classification: 'passive_local',
    requiresChild: false,
    rationale:
      'A local mkdir for a folder the user just confirmed. It cannot be left half-done in a way ' +
      'that outlives the turn, which is the test this class applies.',
  },
  {
    id: 'path_stat',
    callee: 'vscode.workspace.fs.stat',
    classification: 'passive_local',
    requiresChild: false,
    rationale: 'A local existence check.',
  },
];

export const REQUIRED_CHILD_SITES: readonly DispatchSite[] = CHAT_DISPATCH_SITES.filter(
  (s) => s.requiresChild,
);

export function siteById(id: string): DispatchSite | undefined {
  return CHAT_DISPATCH_SITES.find((s) => s.id === id);
}
