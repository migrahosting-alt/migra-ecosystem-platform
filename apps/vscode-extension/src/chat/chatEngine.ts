import * as vscode from 'vscode';
import type { ChatAttachment, FeatureName } from '@migrapilot/shared-types';
import { BackendRouter } from '../services/backendRouter.js';
import { BrainClient } from '../services/brainClient.js';
import { newRequestId } from '@migrapilot/pilot-client';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';
import { type AiChatRequest, MigraAiClient } from '../services/migraAiClient.js';
import { EngineDiagnostics } from '../services/engineDiagnostics.js';
import { parseAgentCommand, runAgentCommand } from './agentCommand.js';
import { parseDeepCommand, runDeepCommand } from './deepCommand.js';
import { classifyIntent, detectEcosystem, buildInspectionPlan } from './intentRouter.js';
import { resolveTaskRoot } from './taskRoot.js';
import { resolveChatScope } from './chatScope.js';
import { buildWorkReport } from './workReport.js';
import { runInspectionTurn, renderRoutingError } from './inspectionTurn.js';
import { runEngineerTurn } from './engineerTurn.js';
import { previewAndMaybeApplyChangeset, type ChangesetProposal, type ChangesetOp } from '../services/proposedChangeset.js';
import { getEscalationDispatch } from '../services/escalationConsent.js';
import { attributionView, type RoutingView } from '../panel/providerRouterViewModel.js';
import { buildAiRequest } from './intentMapping.js';

/** A backend-agnostic output surface for a chat turn. Both the native chat
 * participant (wrapping a vscode.ChatResponseStream) and the dedicated chat
 * webview (posting messages to a webview) implement this, so a single turn
 * pipeline drives both. `progress` renders a transient status line; `markdown`
 * appends rendered content. */
export interface ChatSink {
  progress(text: string): void;
  markdown(text: string): void;
}

export interface ChatEngineDeps {
  /** Legacy brain client — retained for the compatibility `/chat` path and other
   * brain calls (health/tools). The chat turn no longer routes through it. */
  brainClient: BrainClient;
  router: BackendRouter;
  /** MigraAI Engine client — the local chat path streams through `/api/ai/chat`. */
  migraAiClient: MigraAiClient;
  /** Sanitized routing diagnostics recorder (observability only). */
  engineDiagnostics?: EngineDiagnostics;
}


/** A model profile the user can explicitly request from the chat UI. `local` is
 * omitted — it is an internal offline-fallback profile, not a user choice. */
export type SelectableProfile = 'cheap' | 'default' | 'premium';

export interface ChatTurnOptions {
  /** Explicit model-profile override from the UI model picker. When set, it wins
   * over the router policy's auto-selected profile. Absent = "auto" (policy
   * decides). The brain still applies its own effective-profile fallback (e.g.
   * premium→default when no premium model is configured). */
  modelProfile?: SelectableProfile;
  /** Explicit model id pinned in the picker (power-user override of Auto/tier).
   * Local engine path only; the engine uses it verbatim when registered + qualified. */
  modelId?: string;
  /** Slice 5: the active execution-policy preference (server resolves + is
   * authoritative). */
  policy?: string;
  /** User-uploaded attachments (images for vision analysis, documents, …).
   * Images are forwarded to a vision model; text documents should already be
   * inlined into `prompt` by the chat surface. */
  attachments?: ChatAttachment[];
  /** Server-side conversation memory: when set, the engine owns history — the
   * client sends only this id and does NOT reconstruct history locally. */
  conversationId?: string;
  memoryPolicy?: { mode?: 'off' | 'session' | 'durable'; retrieve?: boolean; store?: boolean };
}

/** Run a single chat turn through the resolved backend and stream it to `sink`.
 *
 * This is the exact pipeline the `@migrapilot` participant used, lifted verbatim
 * so the webview reuses it byte-for-byte:
 *  - the backend is the one resolved at activation/repair (never re-resolved
 *    per turn — `auto` cannot silently switch mid-turn);
 *  - a remote-pilot failure surfaces a correlated message and is NEVER retried
 *    on the local stub.
 *
 * `conversationSummary` is supplied by the caller (built from whatever history
 * representation it holds) so the engine stays agnostic of the chat surface. */
export async function runChatTurn(
  deps: ChatEngineDeps,
  sink: ChatSink,
  prompt: string,
  conversationSummary: string,
  token: vscode.CancellationToken,
  options: ChatTurnOptions = {},
): Promise<void> {
  const { brainClient, router } = deps;
  const trimmed = prompt.trim();
  const activeEditor = vscode.window.activeTextEditor;
  const selectionText = activeEditor
    ? activeEditor.document.getText(activeEditor.selection).trim() || undefined
    : undefined;

  // ── explicit /agent command: the ONLY chat path to the agent runtime ────────
  // Dispatched straight to the engine's agent-runs contract; the conversational
  // model is never involved, and any failure renders as a machine-generated
  // execution error — never an LLM apology, never a silent fallback to chat.
  const agentCmd = parseAgentCommand(trimmed);
  if (agentCmd) {
    await runAgentCommand(deps.migraAiClient, agentCmd, sink, {
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      path: activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri) : undefined,
    });
    return;
  }

  // ── explicit /deep command: AGENT MODE (Copilot-style) ──────────────────────
  // Runs the engine's agentic answer loop — the model iteratively calls read-only
  // workspace tools to gather real evidence, then answers with citations. Live
  // tool steps render as progress. Read-only; never edits; never a silent fallback.
  const deepCmd = parseDeepCommand(trimmed);
  if (deepCmd) {
    await runDeepCommand(
      deps.migraAiClient,
      deepCmd,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      sink,
      tokenToSignal(token),
    );
    return;
  }

  const feature = inferFeature(trimmed);
  const requestId = newRequestId();

  // ── read-only workspace INSPECTION → LOCAL runner (model-free) ──────────────
  // A request to see the actual workspace/repo state (root, files, git status,
  // …) must run on the local runner's read-only tools and return real evidence —
  // it must NEVER be answered by the conversational model (which falsely claims
  // it "cannot access your local environment"). Independent of the chat backend:
  // inspection is always local + read-only. A missing workspace or an unreachable
  // runner returns a TRUTHFUL TYPED error, never a generic refusal.
  if (classifyIntent(trimmed) === 'inspection') {
    const inspectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!inspectRoot) {
      renderRoutingError(sink, 'workspace_not_open', { operation: 'workspace inspection', traceId: requestId });
      return;
    }
    await runInspectionTurn(deps.migraAiClient, inspectRoot, buildInspectionPlan(trimmed), sink, tokenToSignal(token));
    return;
  }

  // Route through the backend resolved at activation/repair — never re-resolve
  // per request (auto cannot silently switch mid-turn).
  const backend = router.current() ?? (await router.resolve());

  // ── workspace-task routing (Slice 2): ordinary engineering requests run the
  // LOCAL workspace engineer — inspect/edit-propose/build/test in the active
  // workspace. Local-only by construction (never the pilot runtime, so disabled
  // delegation cannot block it); conservative classifier keeps conversational
  // questions on the chat path. Only on the local engine backend — the remote
  // pilot chat surface keeps its existing behavior.
  if (backend.kind === 'local' && classifyIntent(trimmed) === 'workspace-task') {
    // Resolve WHICH folder to build in: an explicit path in the message, else the
    // open workspace, else ASK via a folder picker — so MigraPilot can work on any
    // folder on the machine, not only the one open in VS Code.
    const resolved = await resolveTaskRoot(trimmed, {
      openWorkspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      isDirectory: async (p) => {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
          return (stat.type & vscode.FileType.Directory) !== 0;
        } catch {
          return false;
        }
      },
      pickFolder: async (near) => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Build here',
          title: 'Choose a folder for MigraPilot to build in',
          ...(near ? { defaultUri: vscode.Uri.file(near) } : {}),
        });
        return picked?.[0]?.fsPath;
      },
    });
    if (!resolved) {
      sink.markdown('No folder selected. Open a folder, or include a path in your message (e.g. `build … in C:\\\\path\\\\to\\\\project`), and try again.');
      return;
    }
    const workspaceRootForTask = resolved.root;
    if (resolved.source !== 'workspace') {
      const why = resolved.missingNamed ? ` (\`${resolved.missingNamed}\` was not found)` : '';
      sink.markdown(`\n_Building in \`${workspaceRootForTask}\`${why}._\n`);
    }
    // Collect changeset proposals during the run so we can offer a user-confirmed
    // APPLY afterwards. The engineer loop is preview-only by owner policy — it
    // proposes, it never writes; applying is an explicit operator action here.
    const changesetProposals: ChangesetProposal[] = [];
    const taskSignal = tokenToSignal(token);
    await runEngineerTurn(
      deps.migraAiClient,
      {
        rootPath: workspaceRootForTask,
        task: trimmed,
        ecosystem: detectEcosystem({ rootPath: workspaceRootForTask, prompt: trimmed }),
        ...(options.policy ? { policy: options.policy } : {}),
      },
      {
        markdown: (t) => sink.markdown(t),
        progress: (t) => sink.progress?.(t),
        // Slice 5: cloud escalation needs explicit consent (a modal); the approved
        // cloud result is rendered back into the response.
        onEscalation: async (offer) => {
          const d = getEscalationDispatch();
          if (d) await d(offer, (md) => sink.markdown(md));
        },
        onAttribution: (routing) => {
          const a = attributionView((routing ?? {}) as RoutingView);
          sink.markdown(`\n\n— _${a.headline}_${a.lines.length ? '\n' + a.lines.map((l) => `_${l}_`).join('  ·  ') : ''}\n`);
        },
        onProposal: (p) => {
          const pv = (p as { preview?: { ops?: ChangesetOp[]; proposalHash?: string; fileCount?: number } }).preview;
          if (pv?.proposalHash && pv.ops?.length) {
            changesetProposals.push({ proposalHash: pv.proposalHash, ops: pv.ops, ...(pv.fileCount != null ? { fileCount: pv.fileCount } : {}) });
          }
        },
      },
      taskSignal,
    );
    // Offer to apply the final (most complete) proposed changeset — user-confirmed,
    // via the engine's approval boundary. Non-fatal: a decline/failure just leaves
    // the proposal unapplied. Passes the abort signal so the chat Stop button can
    // dismiss the apply prompt (a pending notification must not block the turn).
    const finalChangeset = changesetProposals.at(-1);
    const autoApply = vscode.workspace.getConfiguration('migrapilot').get<boolean>('autoApplyChangeset', false);
    let applied = false;
    if (finalChangeset && !token.isCancellationRequested) {
      // Opt-in auto-approve: when on, apply without the interactive prompt. Default
      // off keeps the owner's preview-only behavior (review + click Apply).
      try {
        applied = await previewAndMaybeApplyChangeset(deps.migraAiClient, workspaceRootForTask, finalChangeset, 'MigraPilot proposal', { autoApply, signal: taskSignal });
      } catch {
        /* apply UI failure never breaks the chat turn */
      }
    }
    // Consistent machine-authored work report after every build task — the user
    // always gets the same clear "what I did" summary, not the model's varying prose.
    sink.markdown(
      buildWorkReport({
        task: trimmed,
        root: workspaceRootForTask,
        proposedFiles: (finalChangeset?.ops ?? []).map((o) => ({ path: o.path ?? '', ...(o.kind ? { kind: o.kind } : {}) })),
        applied,
        cancelled: token.isCancellationRequested,
        autoApply,
      }),
    );
    return;
  }

  if (backend.kind === 'remote-unavailable') {
    // Surface the correlated error; do NOT fall back to the local stub.
    sink.markdown(`⚠️ ${toUserMessage(backend.error.code)}\n\n_Request ${requestId}._`);
    return;
  }

  if (backend.kind === 'remote') {
    await streamRemote(router, sink, token, trimmed, requestId, {
      activeFile: activeEditor?.document.uri.fsPath,
      selectionText,
      conversationSummary,
      modelProfile: options.modelProfile,
      attachments: options.attachments,
    });
    return;
  }

  // ── local MigraAI Engine path (POST /api/ai/chat) ─────────────────────────
  // The extension describes the turn's capability needs and streams the engine's
  // answer. The engine owns model selection + failover; the extension never names
  // a model and never falls back to the legacy `/chat` endpoint.
  sink.progress('MigraPilot is analyzing your request…');
  const openRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  // Folder-scoped grounding: if the question names a folder (an absolute path or
  // a distinctive directory like `migracms-enterprise`), scope retrieval to THAT
  // folder so a large monorepo doesn't ground the answer on an unrelated copy.
  let workspaceRoot = openRoot;
  if (openRoot) {
    const scope = await resolveChatScope(trimmed, {
      isDirectory: async (p) => {
        try {
          const s = await vscode.workspace.fs.stat(vscode.Uri.file(p));
          return (s.type & vscode.FileType.Directory) !== 0;
        } catch {
          return false;
        }
      },
      findDirs: async (name) => {
        try {
          const res = await deps.migraAiClient.inspect({ rootPath: openRoot, op: 'find', query: name, kind: 'dir', limit: 30 });
          if (!res.ok) return [];
          const matches = (res.data as { matches?: Array<{ path?: string }> }).matches ?? [];
          return matches
            .filter((m) => m.path && m.path.split('/').pop() === name)
            .map((m) => `${openRoot}/${m.path!}`);
        } catch {
          return [];
        }
      },
    });
    if (scope && scope.root !== openRoot) {
      workspaceRoot = scope.root;
      sink.markdown(`\n_Scoped to \`${scope.label}\` (\`${scope.root}\`)._\n`);
    }
  }
  const aiRequest = buildAiRequest(trimmed, {
    feature,
    modelProfile: options.modelProfile,
    modelId: options.modelId,
    attachments: options.attachments,
    selectionText,
    activeFile: activeEditor?.document.uri.fsPath,
    workspaceRoot,
    // With a server-side conversation the engine owns history — do NOT send a
    // locally-reconstructed summary.
    conversationSummary: options.conversationId ? undefined : conversationSummary,
    policy: options.policy,
  });
  if (options.conversationId) {
    aiRequest.conversationId = options.conversationId;
    aiRequest.memoryPolicy = options.memoryPolicy ?? { mode: 'session', retrieve: true, store: true };
  }
  await streamLocalEngine(deps, sink, token, requestId, aiRequest);
}

/** Stream a chat turn from the local MigraAI Engine. On failure, surface a
 * correlated PilotError message — NEVER fall back to legacy `/chat`. */
async function streamLocalEngine(
  deps: ChatEngineDeps,
  sink: ChatSink,
  token: vscode.CancellationToken,
  requestId: string,
  request: AiChatRequest,
): Promise<void> {
  const signal = tokenToSignal(token);
  const diag = deps.engineDiagnostics;
  let sawToken = false;
  try {
    for await (const event of deps.migraAiClient.chatStream(request, signal)) {
      if (event.type === 'route') {
        diag?.record(event.routing);
        sink.progress(
          event.routing.failedOver.length
            ? `Engine → ${event.routing.model} (failover)`
            : `Engine → ${event.routing.model}`,
        );
      } else if (event.type === 'token') {
        sawToken = true;
        sink.markdown(event.text);
      } else if (event.type === 'done') {
        diag?.finish('completed', event.usage);
      }
    }
    // Stream closed without a terminal `done` (rare) — still mark completed.
    if (sawToken) diag?.finish('completed');
  } catch (err) {
    const code = isPilotError(err) ? err.code : 'NETWORK';
    if (code === 'CANCELLED') {
      diag?.finish('cancelled');
      return;
    }
    diag?.finish('error');
    sink.markdown(`\n\n⚠️ ${toUserMessage(code)}\n\n_Request ${requestId}._`);
  }
}

/** Bridge a VS Code CancellationToken to an AbortSignal so cancellation
 * propagates through the router into fetch/SSE. */
function tokenToSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}

/** Stream a chat turn from the remote pilot-api backend. On failure, surface a
 * correlated message — never fall back to the local stub. */
async function streamRemote(
  router: BackendRouter,
  sink: ChatSink,
  token: vscode.CancellationToken,
  prompt: string,
  requestId: string,
  context: {
    activeFile?: string;
    selectionText?: string;
    conversationSummary: string;
    modelProfile?: SelectableProfile;
    attachments?: ChatAttachment[];
  },
): Promise<void> {
  const signal = tokenToSignal(token);
  const { modelProfile, ...remoteContext } = context;
  const turn = {
    requestId,
    local: null,
    remote: {
      message: prompt,
      context: remoteContext,
      // Forward the profile hint; pilot-api may honor or ignore it.
      ...(modelProfile ? { modelProfile } : {}),
    },
  };
  try {
    for await (const chunk of router.chat(turn, signal)) {
      if (chunk.type === 'token') {
        sink.markdown(chunk.text);
      } else if (chunk.type === 'plan') {
        sink.progress('Planning…');
      }
      // 'done'/'info' need no rendering here.
    }
  } catch (err) {
    const code = isPilotError(err) ? err.code : 'NETWORK';
    if (code !== 'CANCELLED') {
      sink.markdown(`\n\n⚠️ ${toUserMessage(code)}\n\n_Request ${requestId}._`);
    }
  }
}

export function inferFeature(prompt: string): FeatureName {
  const lower = prompt.toLowerCase();
  if (lower.includes('test')) return 'test';
  if (lower.includes('commit')) return 'commit';
  if (lower.includes('fix') || lower.includes('error') || lower.includes('bug')) return 'fix';
  if (lower.includes('explain') || lower.includes('what does this do')) return 'explain';
  if (lower.includes('review')) return 'review';
  if (lower.includes('search') || lower.includes('find')) return 'search';
  return 'chat';
}

// Conversation-summary construction lives in a vscode-free module so it is
// unit-testable under `node --test`. Re-exported here to keep the public API
// (`summarizeChatContext`, `summarizeTurns`) stable for existing importers.
export { summarizeChatContext, summarizeTurns } from './conversationSummary.js';

