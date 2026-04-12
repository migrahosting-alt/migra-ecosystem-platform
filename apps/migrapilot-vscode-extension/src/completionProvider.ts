import * as vscode from "vscode";
import { BrainClient, getBrainClientConfig } from "./brainClient.js";
import { packCompletionContext } from "./contextPacker.js";
import { CompletionCache } from "./completionCache.js";

export type CompletionStatus = "idle" | "loading" | "error";

export class MigraCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new CompletionCache();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private abortController: AbortController | undefined;

  /** Fires whenever the status changes so the status bar can update. */
  readonly onStatusChange: vscode.EventEmitter<CompletionStatus> =
    new vscode.EventEmitter<CompletionStatus>();

  private getConfig() {
    const cfg = vscode.workspace.getConfiguration("migrapilot");
    return {
      debounceMs: cfg.get<number>("completions.debounceMs", 250),
      maxTokens: cfg.get<number>("completions.maxTokens", 128),
    };
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | null> {
    const enabled = vscode.workspace
      .getConfiguration("migrapilot")
      .get<boolean>("completions.enabled", true);
    if (!enabled) return null;

    // Cache key: uri + character offset
    const offset = document.offsetAt(position);
    const cacheKey = `${document.uri.toString()}:${offset}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return this.makeList(cached, position);
    }

    // For Automatic triggers debounce; for Invoke respond immediately
    const isAutomatic =
      context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
    const { debounceMs, maxTokens } = this.getConfig();

    if (isAutomatic) {
      await new Promise<void>((resolve) => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(resolve, debounceMs);
      });
    }

    if (token.isCancellationRequested) return null;

    // Cancel any in-flight request
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const ctx = packCompletionContext(document, position);
    const brainConfig = getBrainClientConfig();
    const client = new BrainClient(brainConfig);

    this.onStatusChange.fire("loading");
    try {
      const completion = await client.complete({ ...ctx, maxTokens }, signal);
      if (!completion || token.isCancellationRequested || signal.aborted) {
        this.onStatusChange.fire("idle");
        return null;
      }
      this.cache.set(cacheKey, completion);
      this.onStatusChange.fire("idle");
      return this.makeList(completion, position);
    } catch (err) {
      if (!token.isCancellationRequested && !signal.aborted) {
        this.onStatusChange.fire("error");
      } else {
        this.onStatusChange.fire("idle");
      }
      return null;
    }
  }

  private makeList(
    insertText: string,
    position: vscode.Position
  ): vscode.InlineCompletionList {
    return new vscode.InlineCompletionList([
      new vscode.InlineCompletionItem(
        insertText,
        new vscode.Range(position, position)
      ),
    ]);
  }

  dispose(): void {
    this.abortController?.abort();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.onStatusChange.dispose();
    this.cache.clear();
  }
}
