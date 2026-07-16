import * as vscode from 'vscode';
import { BackendRouter } from '../services/backendRouter.js';
import {
  type CapabilityDecision,
  type CommandCapabilityRequirement,
  evaluateCapability,
} from '../services/commandCapabilities.js';
import { newRequestId } from '@migrapilot/pilot-client';
import { BrainClient } from '../services/brainClient.js';
import { PilotApiClient } from '@migrapilot/pilot-client';
import { MigraAiClient } from '../services/migraAiClient.js';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';

// Shared per-command routing for P3. A command resolves the (already-selected)
// backend, evaluates its declared capability requirement, and dispatches to the
// local or remote implementation. Denials/failures surface a correlated,
// structured message — never the raw backend error body, secret, or capability
// payload, and never a silent local fallback after a remote path begins.

export interface CommandDeps {
  brainClient: BrainClient;
  router: BackendRouter;
  pilot: PilotApiClient;
  /** MigraAI Engine client — all tool execution flows through this, never
   * through direct brain `/tools/*` calls. */
  migraAi: MigraAiClient;
  output?: vscode.OutputChannel;
}

export interface CommandRoute {
  requestId: string;
  decision: CapabilityDecision;
}

/** Resolve the backend (using the existing resolution) and evaluate the
 * command's capability requirement. Does not re-route per command. */
export async function routeCommand(
  router: BackendRouter,
  req: CommandCapabilityRequirement,
): Promise<CommandRoute> {
  const backend = router.current() ?? (await router.resolve());
  return { requestId: newRequestId(), decision: evaluateCapability(backend, req) };
}

/** Surface a PilotError (or unknown error) as a user-safe, correlated message.
 * Cancellation is silent. Never leaks tokens or raw backend bodies. */
export async function surfacePilotError(
  output: vscode.OutputChannel | undefined,
  err: unknown,
  requestId: string,
): Promise<void> {
  const code = isPilotError(err) ? err.code : 'NETWORK';
  if (code === 'CANCELLED') {
    return;
  }
  output?.appendLine(`[${new Date().toISOString()}] command error ${code} [${requestId}]`);
  // Fire-and-forget: the command must not block on toast dismissal.
  void vscode.window.showErrorMessage(`${toUserMessage(code)} (request ${requestId})`);
}

/** Run remote work under a cancellable progress notification, bridging the VS
 * Code CancellationToken to an AbortSignal so cancellation reaches fetch/SSE. */
export async function withCancellableProgress<T>(
  title: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      if (token.isCancellationRequested) {
        controller.abort();
      } else {
        token.onCancellationRequested(() => controller.abort());
      }
      return fn(controller.signal);
    },
  );
}
