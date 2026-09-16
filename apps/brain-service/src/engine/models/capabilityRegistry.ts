/**
 * MigraAI Engine — Capability Registry.
 *
 * The single, extensible catalog of everything the engine can execute on a
 * client's behalf. Today it holds TOOLS (file / git / workspace / diagnostics /
 * edit); the same registry is designed to later hold agents, deployment actions,
 * memory/embedding providers, and workflows — one registry instead of five.
 *
 * Clients never learn a capability's implementation: `list()`/`get()` expose only
 * sanitized METADATA (id, category, read-only/mutating, approval + dry-run flags,
 * schema versions, availability). The zod input schema and the handler stay in an
 * internal table reachable only through {@link runnable}.
 *
 * Availability is the ENGINE's decision: a capability is available only when every
 * one of its `requiredCapabilities` is in the granted set. A future
 * `terminal.exec` ships registered-but-unavailable until its grant is enabled.
 */

import { z } from 'zod';
import type { ZodType } from 'zod';

import { migraSearch } from '../search/migraSearch.js';
import type { EmailConnection } from '../email/types.js';
import { emailReadinessFor } from '../email/emailReadiness.js';
import {
  executeEmailReadMessage,
  executeEmailIngestAttachment,
  executeEmailListAttachments,
  executeEmailSummarize,
  executeEmailReadThread,
  executeEmailSearch,
} from '../email/emailExecution.js';
import { migraEmail } from '../email/migraEmail.js';
import {
  WorkspaceSearchRequestSchema,
  FileReadRangeRequestSchema,
  FileReadSymbolRequestSchema,
  GitStatusRequestSchema,
  GitDiffRequestSchema,
  EditPreviewRequestSchema,
  EditApplyRequestSchema,
  DiagnosticsGetRequestSchema,
  ChangesetRequestSchema,
  ApplyChangesetRequestSchema,
  GitOverviewRequestSchema,
  GitHistoryRequestSchema,
  GitBlameRequestSchema,
} from '@migrapilot/protocol';
import { proposeChangeset, applyChangeset, previewStoredChangeset, ChangesetProposalStore, ChangesetError } from '../../tools/changeset.js';
import { nodeChangesetFs } from '../../tools/changesetFs.js';
import { telemetryHub } from '../observability/telemetryHub.js';
import { auditStore, auditHash } from '../observability/auditLog.js';
import { incidentManager } from '../observability/incidents.js';
import { recoveryManager } from '../recovery/recovery.js';
import { workspaceSearch } from '../../tools/workspaceSearch.js';
import { gitOverview, gitHistory, gitBlame } from '../../tools/gitInsight.js';
import { workspaceList, WorkspaceListRequestSchema } from '../../tools/workspaceList.js';
import { fileRead, FileReadRequestSchema } from '../../tools/fileRead.js';
import { workspaceFind, WorkspaceFindRequestSchema } from '../../tools/workspaceFind.js';
import { fileReadRange } from '../../tools/fileReadRange.js';
import { fileReadSymbol } from '../../tools/fileReadSymbol.js';
import { gitStatus } from '../../tools/gitStatus.js';
import { gitDiff } from '../../tools/gitDiff.js';
import { editPreview } from '../../tools/editPreview.js';
import { editApply } from '../../tools/editApply.js';
import { diagnosticsGet } from '../../tools/diagnosticsGet.js';

export type CapabilityKind = 'tool' | 'agent' | 'model' | 'deployment' | 'workflow';
export type CapabilityCategory =
  | 'file'
  | 'git'
  | 'workspace'
  | 'diagnostics'
  | 'edit'
  | 'terminal'
  | 'deployment'
  | 'mcp'
  /** Capabilities the engine executes against the outside world. */
  | 'web'
  /** The user's own connected accounts — mail, and later calendar and files. */
  | 'account';

/** Client-facing capability metadata — safe to serialize; no implementation. */
/**
 * Facts a ROUTE resolved for THIS request, for readiness probes to consult.
 *
 * 🚨 EXISTS BECAUSE SOME CAPABILITIES ARE PER-PRINCIPAL AND THIS REGISTRY IS
 * NOT. A connected mailbox belongs to one user; the registry is a process-wide
 * singleton. Readiness computed from shared state answers "is email available?"
 * for whoever connected most recently and hands that answer to everyone else —
 * a display bug that sits one wiring mistake away from executing against
 * somebody else's inbox.
 *
 * The route knows who is asking, resolves the fact (which may need a database
 * read, and so cannot happen inside a synchronous probe), and passes it here.
 *
 * Absent means NOT RESOLVED, which is never treated as "fine": a probe that
 * needs a fact it was not given must report unavailable rather than assume.
 */
export interface ReadinessContext {
  /** This caller's mail connection. `null` = the deployment has no email. */
  mail?: EmailConnection | null;
}

export type ToolEvidenceSemantic =
  | 'workspace.directory_listing'
  | 'workspace.path_discovery'
  | 'workspace.content_search'
  | 'workspace.file_content'
  | 'workspace.diagnostics'
  | 'vcs.state'
  | 'vcs.diff';

export interface CapabilityDescriptor {
  kind: CapabilityKind;
  id: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;
  /** Grant tokens this capability needs; the engine decides if they're held. */
  requiredCapabilities: string[];
  /**
   * The nouns this capability OWNS, lower-case and singular where natural.
   *
   * ---------------------------------------------------------------------
   * 🚨 THE VOCABULARY BELONGS TO THE CAPABILITY, NOT TO THE SELECTOR
   *
   * Chat has to decide which capability a request is ABOUT. The tempting place
   * to put that knowledge is the selector — a list of mail words, a list of
   * calendar words — and it is the wrong place twice over: the selector stops
   * being generic, and adding a capability means editing a file that has
   * nothing to do with it.
   *
   * So each capability declares its own words here and the selector stays
   * structural. `thread` is the example that proves the point: "summarize the
   * thread" selected nothing until Email declared it, and the fix was Email's
   * to make.
   *
   * 🚨 OWNED, NOT MERELY ASSOCIATED. A word two capabilities would both claim
   * means the vocabulary is too broad — not that the selector needs a
   * tie-break. "file" belongs to no capability for exactly that reason.
   */
  nouns: readonly string[];
  readOnly: boolean;
  approvalRequired: boolean;
  supportsDryRun: boolean;
  supportsStreaming: boolean;
  inputSchemaVersion: number;
  outputSchemaVersion: number;
  /**
   * Structural evidence this capability can produce when successfully executed.
   * This alone never satisfies a task obligation; input/path/result still matter.
   */
  evidenceSemantics: readonly ToolEvidenceSemantic[];
  /** Engine's decision: is this capability executable right now? */
  available: boolean;
  /**
   * Why not, in words the ENGINE owns and a person could read.
   *
   * Present only when `available` is false. It exists because "not registered"
   * and "registered but cannot run" are different facts that a client must be
   * able to show differently — and because a client that wrote its own excuse
   * would be guessing at a state only the engine can see. It must never name a
   * backend, host or version: infrastructure describing itself to a user is a
   * defect this codebase has already shipped once.
   */
  unavailableReason?: string;
  /**
   * What the USER can do about it, as a machine-readable token.
   *
   * 🚨 EXISTS SO A CLIENT NEVER PARSES `unavailableReason` TO DECIDE WHETHER TO
   * OFFER A BUTTON. Reading prose to infer a state is a keyword proxy for a
   * semantic claim, and it breaks silently the first time the wording changes —
   * a "Connect" control that vanishes because someone improved a sentence.
   *
   * Absent means there is nothing the user can do here: the remedy is to wait,
   * or it belongs to an operator. That is a real and common case, and it must
   * stay distinguishable from an actionable one — offering a button for a
   * provider outage sends people to press something that cannot help.
   */
  remedy?: CapabilityRemedy;
}

/**
 * The remedies a client knows how to offer. A closed set on purpose: a client
 * can only render an action it has actually built.
 */
export type CapabilityRemedy =
  /** Link an external account. The client opens its own connect flow. */
  | 'connect-account'
  /** The link exists but the grant died; the same flow, different words. */
  | 'reconnect-account';

/** Per-call execution context threaded from the tool boundary (Slice 2): lets a
 * handler correlate its store telemetry to the originating execution. */
export interface ToolHandlerContext {
  correlationId?: string;
  signal?: AbortSignal;
  /**
   * WHOSE data this call acts on.
   *
   * 🚨 REQUIRED BY ANY CAPABILITY THAT TOUCHES PER-PRINCIPAL STATE, and
   * deliberately optional in the type so existing workspace capabilities — which
   * act on a checkout, not on a person — are unaffected.
   *
   * A capability that needs it MUST refuse when it is absent. Executing a
   * mailbox read with no principal does not fail safe by accident: it either
   * finds nothing, or finds whichever connection the code happened to reach.
   */
  principal?: { owner: string; workspace: string };
}
type Handler = (input: unknown, ctx?: ToolHandlerContext) => Promise<unknown>;

interface RunnableCapability {
  descriptor: Omit<CapabilityDescriptor, 'available' | 'unavailableReason'>;
  inputSchema: ZodType;
  handler: Handler;
  /** For mutating capabilities that support dry-run: how to produce a preview. */
  preview?: Handler;
  /**
   * Optional dynamic readiness, ON TOP OF the grant check.
   *
   * Grants are static: a capability either has its tokens or it does not. Some
   * capabilities also depend on something that changes — a provider that is
   * configured or not, reachable or not. Those cannot be answered by the grant
   * set, and answering them by attempting the operation would make rendering a
   * menu cost a real request.
   *
   * MUST be synchronous and cheap. `list()` is called to draw a UI; a probe
   * that reached the network here would put an outbound call on every render.
   * The provider layer keeps its own cached health and reports it from memory.
   */
  readiness?: (ctx?: ReadinessContext) => { ready: boolean; reason?: string; remedy?: CapabilityRemedy };
}

/** Grants held by the local engine deployment. The read/write/git grants make the
 * bounded workspace tools available; `terminal.exec` / `deployment.*` are intentionally
 * NOT granted, so those future capabilities register as unavailable. */
export const LOCAL_GRANTS: ReadonlySet<string> = new Set([
  'workspace.read',
  'workspace.write',
  'git.read',
  /*
   * Read-only web search is granted. Whether it can actually RUN is a separate
   * question answered by provider readiness — which is the distinction the
   * `readiness` probe exists for. Withholding the grant instead would make
   * "nobody has set up a backend" indistinguishable from "this deployment is
   * not allowed to search", and those call for different actions.
   */
  'web.search',
  /*
   * Read-only mail is granted. Whether it can RUN depends on whether this user
   * has connected an account — a per-user fact the grant set cannot express,
   * and the reason the readiness probe exists.
   */
  'email.read',
]);

/**
 * Input for `migra.email`.
 *
 * 🚨 ONE CAPABILITY, THREE OPERATIONS. Search, read-a-message and read-a-thread
 * are the same authority over the same mailbox with the same scope requirement,
 * so they are one registered capability with an `op` discriminator rather than
 * three rows in a hub that would each need connecting separately.
 *
 * `op` is optional and defaults to `search`, so a caller written before reads
 * existed keeps working.
 */
export const EmailSearchRequestSchema = z.object({
  op: z.enum(['search', 'readMessage', 'readThread', 'listAttachments', 'fetchAttachment', 'summarize']).optional(),
  /**
   * 🚨 An attachment is named by ID, never described.
   *
   * There is deliberately no filename, mimeType or size field: the evidence is
   * derived server-side from the message this caller's own connection returns,
   * so a prompt cannot decide what a downloaded file claims to be.
   */
  /**
   * 🚨 BOUNDED, BUT NOT BY A GUESS.
   *
   * A provider attachment id is an OPAQUE blob, not an identifier with a shape
   * we get to choose. Real Gmail ids measured against the live QA mailbox are
   * 404 characters; the original 200-character cap rejected every genuine
   * attachment before the provider was ever called, and the refusal read as
   * "invalid input" rather than "our limit is wrong".
   *
   * Still bounded — an unbounded string is an unbounded log line and an
   * unbounded URL — but bounded well clear of what the provider actually emits.
   */
  attachmentId: z.string().min(1).max(2048).optional(),
  /** Required by readMessage. Meaningless across mailboxes — see the executor. */
  messageId: z.string().min(1).max(200).optional(),
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
  subjectContains: z.string().max(300).optional(),
  keywords: z.string().max(500).optional(),
  after: z.string().max(40).optional(),
  before: z.string().max(40).optional(),
  unreadOnly: z.boolean().optional(),
  hasAttachment: z.boolean().optional(),
  threadId: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Input for `migra.search`. Deliberately small: a query and how fresh it must be. */
export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  freshness: z.enum(['any', 'recent', 'latest']).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});


const changesetFs = nodeChangesetFs();
// One proposal store shared by propose (writes) + apply (consumes by hash).
// Instrumented via the process-wide telemetry hub. Exported so the store-health
// endpoint can read its truthful health snapshot.
export const changesetProposals = new ChangesetProposalStore(undefined, telemetryHub.sink);

/** Apply a changeset with full application.* audit + INCONSISTENT_STATE incident
 * raising (Slice 3). application.started is CRITICAL — if it cannot be durably
 * recorded the apply fails closed BEFORE any mutation. */
async function applyChangesetAudited(input: unknown, correlationId?: string): Promise<unknown> {
  const cid = correlationId ?? 'none';
  const req = input as { rootPath?: string; proposalHash?: string };
  const workspace = req.rootPath ? auditHash(req.rootPath) : 'unknown';
  const proposal = req.proposalHash ? auditHash(req.proposalHash) : 'unknown';
  // Critical: this append throws AuditCriticalWriteError → fail closed pre-mutation.
  //
  // AWAITED, and that is the entire guarantee. Un-awaited, control fell straight
  // through to applyChangeset below: the mutation happened, and the failure of the
  // CRITICAL record surfaced later as an unhandled rejection. The comment above
  // described a fail-closed boundary the code did not have.
  await auditStore.append({ correlationId: cid, type: 'application.started', component: 'changeset', fields: { workspace, proposal } });
  const started = Date.now();
  try {
    const res = applyChangeset(input, changesetFs, changesetProposals, correlationId) as {
      created: string[];
      modified: string[];
      deleted: string[];
    };
    await auditStore.append({
      correlationId: cid,
      type: 'application.completed',
      component: 'changeset',
      outcome: 'ok',
      durationMs: Date.now() - started,
      fields: { workspace, proposal, created: res.created.length, modified: res.modified.length, deleted: res.deleted.length },
    });
    return res;
  } catch (err) {
    if (err instanceof ChangesetError && err.code === 'INCONSISTENT_STATE') {
      const d = err.details ?? { appliedFileCount: 0, affectedPathCount: 0, rollbackFailureCount: 1, failureStage: 'rollback' };
      await auditStore.append({
        correlationId: cid,
        type: 'application.rollback_failed',
        component: 'changeset',
        outcome: 'INCONSISTENT_STATE',
        durationMs: Date.now() - started,
        fields: { workspace, proposal, appliedFileCount: d.appliedFileCount, affectedPathCount: d.affectedPathCount, rollbackFailureCount: d.rollbackFailureCount, failureStage: d.failureStage },
      });
      const raised = incidentManager.raiseInconsistentState({
        correlationId: cid,
        workspaceIdentityHash: workspace,
        proposalHashPrefix: proposal,
        appliedFileCount: d.appliedFileCount,
        affectedPathCount: d.affectedPathCount,
        rollbackFailureCount: d.rollbackFailureCount,
        failureStage: d.failureStage,
      });
      // Stash server-side reverse material (content lives here only, never
      // audited) so an approval-gated recovery can restore the workspace.
      if (err.reverseMaterial && req.rootPath) {
        recoveryManager.stashReverseMaterial(cid, req.rootPath, err.reverseMaterial, raised.incident.incidentId);
      }
    } else if (err instanceof ChangesetError && err.code === 'PARTIAL_WRITE') {
      await auditStore.append({ correlationId: cid, type: 'application.rollback_completed', component: 'changeset', outcome: 'rolled_back', durationMs: Date.now() - started, fields: { workspace, proposal } });
    } else {
      await auditStore.append({ correlationId: cid, type: 'application.failed', component: 'changeset', outcome: err instanceof ChangesetError ? err.code : 'error', durationMs: Date.now() - started, fields: { workspace, proposal } });
    }
    throw err;
  }
}

const TOOLS: RunnableCapability[] = [
  {
    descriptor: meta('workspace.search', 'Workspace Search', 'Search workspace files for a query.', 'workspace', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.content_search'] }),
    inputSchema: WorkspaceSearchRequestSchema,
    handler: (i) => workspaceSearch(i as never),
  },
  {
    // Without this the agent has no instrument for "what files exist?" — it
    // searched content, read ranges and asked git, then GUESSED the listing.
    descriptor: meta('workspace.list', 'List Directory', 'List the files and directories that actually exist at a workspace path.', 'workspace', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.directory_listing'] }),
    inputSchema: WorkspaceListRequestSchema,
    handler: (i) => workspaceList(i as never),
  },
  {
    // Finding a file by NAME. Content search answers "where is tsconfig.json?"
    // badly: it matches everything that merely mentions the string.
    descriptor: meta('workspace.find', 'Find Files By Name', 'Find files or directories by name or glob.', 'workspace', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.path_discovery'] }),
    inputSchema: WorkspaceFindRequestSchema,
    handler: (i) => workspaceFind(i as never),
  },
  {
    // Reading a whole file. file.readRange REQUIRES line numbers, so reading
    // package.json meant GUESSING a range and reasoning about a truncated file.
    descriptor: meta('file.read', 'Read File', 'Read a whole workspace file (bounded; reports truncation).', 'file', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.file_content'] }),
    inputSchema: FileReadRequestSchema,
    handler: (i) => fileRead(i as never),
  },
  {
    descriptor: meta('file.readRange', 'Read File Range', 'Read a line range from a workspace file.', 'file', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.file_content'] }),
    inputSchema: FileReadRangeRequestSchema,
    handler: (i) => fileReadRange(i as never),
  },
  {
    descriptor: meta('file.readSymbol', 'Read Symbol', 'Read the source of a named symbol.', 'file', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.file_content'] }),
    inputSchema: FileReadSymbolRequestSchema,
    handler: (i) => fileReadSymbol(i as never),
  },
  {
    descriptor: meta('git.status', 'Git Status', 'Inspect the working tree status.', 'git', ['git.read'], { readOnly: true, evidenceSemantics: ['vcs.state'] }),
    inputSchema: GitStatusRequestSchema,
    handler: (i) => gitStatus(i as never),
  },
  {
    descriptor: meta('git.diff', 'Git Diff', 'Inspect staged/unstaged diffs.', 'git', ['git.read'], { readOnly: true, evidenceSemantics: ['vcs.diff'] }),
    inputSchema: GitDiffRequestSchema,
    handler: (i) => gitDiff(i as never),
  },
  // Read-only Git visibility. Each answers ONE question with a fixed argv built in
  // gitInsight.ts — no request field becomes a git subcommand or flag, so no input shape
  // can turn a read into a mutation. `git` is deliberately NOT on the command.run
  // allowlist and this does not change that: structured facts, never arbitrary execution.
  {
    descriptor: meta('git.overview', 'Git Overview', 'Branch, HEAD, ahead/behind, and staged/unstaged/untracked counts.', 'git', ['git.read'], { readOnly: true, evidenceSemantics: ['vcs.state'] }),
    inputSchema: GitOverviewRequestSchema,
    handler: (i) => gitOverview(i as never),
  },
  {
    descriptor: meta('git.history', 'Git History', 'Recent commits, bounded.', 'git', ['git.read'], { readOnly: true }),
    inputSchema: GitHistoryRequestSchema,
    handler: (i) => gitHistory(i as never),
  },
  {
    descriptor: meta('git.blame', 'Git Blame', 'Attribution for a file or line range.', 'git', ['git.read'], { readOnly: true }),
    inputSchema: GitBlameRequestSchema,
    handler: (i) => gitBlame(i as never),
  },
  {
    descriptor: meta('diagnostics.get', 'Get Diagnostics', 'Read synced editor diagnostics.', 'diagnostics', ['workspace.read'], { readOnly: true, evidenceSemantics: ['workspace.diagnostics'] }),
    inputSchema: DiagnosticsGetRequestSchema,
    handler: (i) => diagnosticsGet(i as never),
  },
  {
    descriptor: meta('edit.preview', 'Preview Edit', 'Compute a patch preview without writing.', 'edit', ['workspace.read'], { readOnly: true, supportsDryRun: true }),
    inputSchema: EditPreviewRequestSchema,
    handler: (i) => editPreview(i as never),
  },
  {
    // The one mutating capability: requires approval + supports dry-run (preview).
    descriptor: meta('edit.apply', 'Apply Edit', 'Apply a patch to workspace files.', 'edit', ['workspace.write'], {
      readOnly: false,
      approvalRequired: true,
      supportsDryRun: true,
    }),
    inputSchema: EditApplyRequestSchema,
    handler: (i) => editApply(i as never),
    // Dry-run / approval preview shares the edit.preview implementation (same input).
    preview: (i) => editPreview(i as never),
  },
  {
    // Slice 3B — propose a changeset (create/replace/patch/delete/mkdir). READ-
    // ONLY: computes previews + immutable proposal hash + pre-state, zero writes.
    descriptor: meta('fs.proposeChangeset', 'Propose Changeset', 'Preview file create/edit/delete as an approvable proposal (no writes).', 'edit', ['workspace.read'], {
      readOnly: true,
    }),
    inputSchema: ChangesetRequestSchema,
    handler: (i, ctx) => Promise.resolve(proposeChangeset(i, changesetFs, changesetProposals, ctx?.correlationId)),
  },
  {
    // Slice 3B — apply an approved changeset by its server-stored proposal hash
    // ({rootPath, proposalHash} only — the client never resubmits the body).
    // MUTATING + APPROVAL-REQUIRED; the approval preview renders the stored
    // proposal without consuming it.
    descriptor: meta('fs.applyChangeset', 'Apply Changeset', 'Apply an approved proposal (by hash) atomically with rollback.', 'edit', ['workspace.write'], {
      readOnly: false,
      approvalRequired: true,
      supportsDryRun: true,
    }),
    inputSchema: ApplyChangesetRequestSchema,
    handler: (i, ctx) => applyChangesetAudited(i, ctx?.correlationId),
    preview: (i, ctx) => Promise.resolve(previewStoredChangeset(i, changesetFs, changesetProposals, ctx?.correlationId)),
  },
  {
    // Future capability — registered but UNAVAILABLE (grant not held), so it
    // appears in a full catalog listing yet is denied at dispatch. Proves the
    // engine (not the client) owns availability.
    descriptor: {
      kind: 'tool',
      id: 'terminal.exec',
      displayName: 'Run Terminal Command',
      description: 'Execute a shell command (not yet enabled).',
      category: 'terminal',
      requiredCapabilities: ['terminal.exec'],
      // No declared vocabulary: a chat turn can never select this. Reaching it
      // takes an explicit tool call, which is the right bar for a shell.
      nouns: [],
      readOnly: false,
      approvalRequired: true,
      supportsDryRun: false,
      supportsStreaming: true,
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
      evidenceSemantics: [],
    },
    inputSchema: EditApplyRequestSchema, // placeholder; unavailable so never dispatched
    handler: async () => {
      throw new Error('terminal.exec is not enabled');
    },
  },
  {
    /*
     * MIGRA SEARCH — registered now, available only when a provider exists.
     *
     * 🚨 THIS IS THE STATE DISTINCTION THE REGISTRY WAS EXTENDED FOR.
     *
     * `terminal.exec` above is unavailable because a GRANT is withheld: a
     * static deployment fact. Search is different — the grant is held, and
     * whether it can run depends on something that changes underneath. That
     * cannot be answered from the grant set, and answering it by attempting a
     * search would make drawing a menu cost a real query.
     *
     * So availability comes from `migraSearch.readiness()`, which reads a
     * cached snapshot, and the REASON travels with it. Today there is no
     * provider, so this is registered, visible, and honestly unusable:
     *
     *   "Web search is not set up yet."
     *
     * The alternative — omitting the capability until a backend exists — would
     * teach people the product cannot search, which is a different and worse
     * untruth than saying it is not set up.
     *
     * The handler refuses rather than pretending. Dispatch is already gated on
     * availability, so this is defence in depth, not the primary check.
     */
    descriptor: meta(
      'migra.search',
      'Search the web',
      'Find current information on the web and read the sources.',
      'web',
      ['web.search'],
      { readOnly: true },
    ),
    inputSchema: WebSearchRequestSchema,
    readiness: () => migraSearch.readiness(),
    handler: async () => {
      throw new Error('migra.search has no provider configured');
    },
  },
  {
    /*
     * MIGRA EMAIL — reading. Sending is a SEPARATE capability, deliberately.
     *
     * 🚨 ONE CAPABILITY CANNOT REPRESENT BOTH. A connected account may hold
     * read scope and not send scope — common, and entirely reasonable. A
     * single entry would either hide working search or advertise a send that
     * is refused at dispatch, and the hub would have no way to show the truth.
     *
     * So read is registered here as read-only and non-approval-gated, and send
     * lives in its own registration governed by consent and durable
     * idempotency. Availability comes from the CALLER'S resolved connection —
     * per-operation for exactly this reason.
     *
     * Today no provider is configured, so this is registered, visible, and
     * honestly unusable: "Email is not set up yet."
     */
    descriptor: meta(
      'migra.email',
      'Email',
      'Search and read your connected email.',
      'account',
      ['email.read'],
      {
        readOnly: true,
        /*
         * 🚨 EMAIL'S OWN WORDS, DECLARED BY EMAIL.
         *
         * `thread` is here because "summarize the thread" selected nothing
         * without it — a real gap, and one whose fix belongs to this
         * registration rather than to the chat selector, which must stay
         * generic across capabilities that do not exist yet.
         *
         * `attachment` and `spreadsheet` are deliberately ABSENT. They are
         * things a message CARRIES, not things only a mailbox can be about: a
         * spreadsheet may equally arrive from Drive or an upload, and a
         * capability that claimed the word would win prompts that were never
         * about mail. A reference to one already reaches the mailbox the
         * correct way — by continuing from evidence this capability produced.
         */
        nouns: ['email', 'emails', 'mail', 'mailbox', 'inbox', 'message', 'messages', 'thread'],
      },
    ),
    inputSchema: EmailSearchRequestSchema,
    /*
     * 🚨 RESOLVED FROM THE CALLER'S OWN CONNECTION, never from shared state.
     *
     * A mailbox belongs to a principal and this registry is a singleton. Asking
     * a cached provider would report whoever connected most recently — to
     * everybody — and that answer is one wiring mistake away from executing
     * against their inbox.
     *
     * `ctx.mail === undefined` means the route did not resolve it. That is
     * treated as "no email here", NOT as available: a probe that needs a fact
     * it was not given must refuse rather than assume.
     */
    readiness: (ctx) => emailReadinessFor(ctx?.mail ?? null),
    /*
     * Executes against the CALLER'S mailbox, resolved from `ctx.principal`.
     * Refuses when no principal was supplied: a mailbox read with none does not
     * fail safe by accident — it either finds nothing, which renders as a claim
     * about a mailbox nobody opened, or it finds whichever connection the code
     * happened to reach.
     */
    handler: async (input, ctx) => {
      const request = input as {
        op?: 'search' | 'readMessage' | 'readThread' | 'listAttachments' | 'fetchAttachment' | 'summarize';
        messageId?: string;
        threadId?: string;
        attachmentId?: string;
        limit?: number;
      } & Record<string, unknown>;

      switch (request.op ?? 'search') {
        case 'readMessage': {
          if (!request.messageId) {
            return { ok: false, failure: { kind: 'refused', reason: 'No message was named to read.' } };
          }
          const result = await executeEmailReadMessage(request.messageId, ctx);
          return result.ok ? { ok: true, message: result.message } : { ok: false, failure: result.failure };
        }
        case 'readThread': {
          if (!request.threadId) {
            return { ok: false, failure: { kind: 'refused', reason: 'No conversation was named to read.' } };
          }
          const result = await executeEmailReadThread(request.threadId, ctx);
          return result.ok ? { ok: true, thread: result.thread } : { ok: false, failure: result.failure };
        }
        case 'summarize': {
          /*
           * 🚨 ONE IMPLEMENTATION, reached identically from the HTTP tools
           * route and from inside the autonomous loop — both arrive here.
           *
           * The scope is a thread, a message, or a query; the evidence is read
           * through the caller's own connection, and the disclosure for a
           * partial source set is attached by the executor rather than asked of
           * the model.
           */
          const result = await executeEmailSummarize({
            ...(request.threadId ? { threadId: request.threadId } : {}),
            ...(request.messageId ? { messageId: request.messageId } : {}),
            ...(typeof request.keywords === 'string' ? { keywords: request.keywords } : {}),
            ...(request.limit ? { limit: request.limit } : {}),
            ctx,
          });
          if (result.ok) {
            return {
              ok: true,
              summary: result.summary,
              complete: result.complete,
              // Provenance travels with the answer: a claim with no source here
              // has no basis, and a reader can open the message it came from.
              sources: result.sources,
            };
          }
          return 'refusal' in result
            ? { ok: false, refusal: result.refusal }
            : { ok: false, failure: result.failure };
        }
        case 'listAttachments': {
          if (!request.messageId) {
            return { ok: false, failure: { kind: 'refused', reason: 'No message was named to read.' } };
          }
          const result = await executeEmailListAttachments(request.messageId, ctx);
          return result.ok
            /*
             * 🚨 ALWAYS KNOWN. listAttachments reads the full MIME tree, so an
             * empty list here is a PROVEN absence — unlike a search result,
             * where the same empty array means nothing was ever inspected. The
             * flag is stated rather than implied so a caller never has to know
             * which op it came from to read the answer correctly.
             */
            ? { ok: true, attachmentsKnown: true, attachments: result.attachments }
            : { ok: false, failure: result.failure };
        }
        case 'fetchAttachment': {
          if (!request.messageId || !request.attachmentId) {
            return {
              ok: false,
              failure: { kind: 'refused', reason: 'No attachment was named to open.' },
            };
          }
          /*
           * 🚨 THE POLICY IS NOT AN INPUT AND NEVER REACHES THIS LAYER. It is
           * resolved inside the executor, per principal, by the canonical
           * shared implementation the consumer's upload path also calls.
           *
           * A refusal is reported as a REFUSAL, not a failure: "we will not
           * take this file" and "we could not reach your mail" call for
           * different words and different remedies.
           */
          const result = await executeEmailIngestAttachment({
            providerMessageId: request.messageId,
            // The caller names OUR ref from a listing, never a provider token.
            attachmentRef: request.attachmentId,
            ctx,
          });
          if (result.ok) return { ok: true, file: result.handoff };
          return 'refusal' in result
            ? { ok: false, refusal: result.refusal }
            : { ok: false, failure: result.failure };
        }
        default: {
          const result = await executeEmailSearch({ ...request, limit: request.limit ?? 20 } as never, ctx);
          return result.ok ? { ok: true, messages: result.messages } : { ok: false, failure: result.failure };
        }
      }
    },
  },
];

export function meta(
  id: string,
  displayName: string,
  description: string,
  category: CapabilityCategory,
  requiredCapabilities: string[],
  opts: {
    readOnly?: boolean; approvalRequired?: boolean; supportsDryRun?: boolean; supportsStreaming?: boolean;
    /** The words this capability owns. Empty means chat can never select it. */
    nouns?: readonly string[];
    evidenceSemantics?: readonly ToolEvidenceSemantic[];
  } = {},
): Omit<CapabilityDescriptor, 'available'> {
  return {
    kind: 'tool',
    id,
    displayName,
    description,
    category,
    requiredCapabilities,
    /*
     * 🚨 EMPTY BY DEFAULT, AND THAT IS THE SAFE DIRECTION. A capability with no
     * declared vocabulary is simply never selected by a chat turn — it stays
     * reachable through an explicit tool call and nothing else. The opposite
     * default would have every capability quietly compete for every prompt.
     */
    nouns: opts.nouns ?? [],
    readOnly: opts.readOnly ?? false,
    approvalRequired: opts.approvalRequired ?? false,
    supportsDryRun: opts.supportsDryRun ?? false,
    supportsStreaming: opts.supportsStreaming ?? false,
    inputSchemaVersion: 1,
    outputSchemaVersion: 1,
    evidenceSemantics: opts.evidenceSemantics ?? [],
  };
}

export interface CapabilityFilter {
  category?: string;
  readOnly?: boolean;
  kind?: CapabilityKind;
  /** Include capabilities the engine currently can't execute. Default false. */
  includeUnavailable?: boolean;
}

export class CapabilityRegistry {
  private readonly byId = new Map<string, RunnableCapability>();

  private readonly grants: Set<string>;
  constructor(grants: ReadonlySet<string> = LOCAL_GRANTS) {
    this.grants = new Set(grants);
    for (const cap of TOOLS) this.byId.set(cap.descriptor.id, cap);
  }

  /** Register a capability discovered at runtime (an MCP tool). Structural, so
   * the MCP layer need not import the registry's internals. A built-in id can
   * never be overwritten — the static catalog is authoritative. */
  register(cap: RunnableCapability): boolean {
    if (this.byId.has(cap.descriptor.id)) return false;
    this.byId.set(cap.descriptor.id, cap);
    return true;
  }

  /** Register a set of MCP tool capabilities (structural), filling the descriptor
   * fields the registry requires. Read-only tools run in-loop; mutating ones are
   * visible but approval-gated. Returns the count actually registered. */
  registerMcp(caps: ReadonlyArray<{
    descriptor: { id: string; displayName: string; description: string; readOnly: boolean; approvalRequired: boolean; requiredCapabilities: string[] };
    inputSchema: ZodType;
    handler: (input: unknown) => Promise<unknown>;
  }>): number {
    let n = 0;
    for (const c of caps) {
      const ok = this.register({
        descriptor: meta(c.descriptor.id, c.descriptor.displayName, c.descriptor.description, 'mcp', c.descriptor.requiredCapabilities, {
          readOnly: c.descriptor.readOnly,
          approvalRequired: c.descriptor.approvalRequired,
        }),
        inputSchema: c.inputSchema,
        handler: c.handler,
      });
      if (ok) n += 1;
    }
    return n;
  }

  /** Add a grant token at runtime (e.g. mcp.call once MCP servers connect). */
  grant(token: string): void {
    this.grants.add(token);
  }

  /** Drop every capability in a category (used to refresh MCP tools on reconnect). */
  clearCategory(category: CapabilityCategory): void {
    for (const [id, cap] of this.byId) {
      if (cap.descriptor.category === category) this.byId.delete(id);
    }
  }

  private available(cap: RunnableCapability, ctx?: ReadinessContext): boolean {
    if (!cap.descriptor.requiredCapabilities.every((c) => this.grants.has(c))) return false;
    // Grants first, then dynamic readiness. A capability whose grant is missing
    // is unavailable regardless of what a provider says, so the cheaper and
    // more fundamental check runs first.
    return cap.readiness ? cap.readiness(ctx).ready === true : true;
  }

  private describe(cap: RunnableCapability, ctx?: ReadinessContext): CapabilityDescriptor {
    const available = this.available(cap, ctx);
    if (available) return { ...cap.descriptor, available };
    /*
     * The reason comes from the readiness probe when it has one. A missing
     * GRANT gets no reason on purpose: grants are an internal deployment fact,
     * and "you lack workspace.write" is scaffolding, not something a person
     * can act on.
     */
    const probe = cap.readiness?.(ctx);
    return {
      ...cap.descriptor,
      available,
      ...(probe?.reason ? { unavailableReason: probe.reason } : {}),
      /*
       * The remedy travels only when the capability is genuinely unavailable
       * AND the probe named one. It is never synthesised here: this layer does
       * not know whether an account can be connected, and guessing would put a
       * button in front of a user for a state nobody checked.
       */
      ...(probe?.remedy ? { remedy: probe.remedy } : {}),
    };
  }

  list(filter: CapabilityFilter = {}, ctx?: ReadinessContext): CapabilityDescriptor[] {
    const out: CapabilityDescriptor[] = [];
    for (const cap of this.byId.values()) {
      const d = this.describe(cap, ctx);
      if (!filter.includeUnavailable && !d.available) continue;
      if (filter.category && d.category !== filter.category) continue;
      if (filter.kind && d.kind !== filter.kind) continue;
      if (filter.readOnly !== undefined && d.readOnly !== filter.readOnly) continue;
      out.push(d);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): CapabilityDescriptor | undefined {
    const cap = this.byId.get(id);
    return cap ? this.describe(cap) : undefined;
  }

  /** Internal: the runnable (schema + handler) for a capability, or undefined if
   * unknown. Availability is checked separately by the route. */
  runnable(id: string): { descriptor: CapabilityDescriptor; inputSchema: ZodType; handler: Handler; preview?: Handler } | undefined {
    const cap = this.byId.get(id);
    if (!cap) return undefined;
    return { descriptor: this.describe(cap), inputSchema: cap.inputSchema, handler: cap.handler, preview: cap.preview };
  }

  /**
   * 🚨 TAKES THE SAME PER-REQUEST CONTEXT THE LISTING DOES.
   *
   * Without it, a capability whose readiness depends on the caller is denied
   * for everyone — which is not a safe default, it is a capability that can
   * never run. Email was exactly that until a test executed it end to end and
   * found the gate refusing before the handler was ever reached.
   */
  isAvailable(id: string, ctx?: ReadinessContext): boolean {
    const cap = this.byId.get(id);
    return cap ? this.available(cap, ctx) : false;
  }
}
