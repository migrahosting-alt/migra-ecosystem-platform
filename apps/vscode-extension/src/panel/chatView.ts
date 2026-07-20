import * as vscode from 'vscode';
import type { ChatAttachment } from '@migrapilot/shared-types';
import { BrainClient } from '../services/brainClient.js';
import { type BackendRouter } from '../services/backendRouter.js';
import { MigraAiClient } from '../services/migraAiClient.js';
import { EngineDiagnostics } from '../services/engineDiagnostics.js';
import {
  type ChatSink,
  type SelectableProfile,
  runChatTurn,
  summarizeTurns,
} from '../chat/chatEngine.js';

/** Cap total attachment payload forwarded to the backend (base64 inflates ~33%).
 * Keeps a single turn well under typical local-model context + request limits. */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

/** Normalize raw webview file descriptors into backend {@link ChatAttachment}s,
 * stripping any `data:<mime>;base64,` prefix and enforcing a total-size cap. */
function toAttachments(
  files: ReadonlyArray<{ name?: string; type?: string; dataUrl?: string; dataBase64?: string }> | undefined,
): ChatAttachment[] {
  if (!files?.length) {
    return [];
  }
  const out: ChatAttachment[] = [];
  let total = 0;
  for (const f of files) {
    const base64 = f.dataBase64 ?? (f.dataUrl ? f.dataUrl.slice(f.dataUrl.indexOf(',') + 1) : '');
    if (!base64) {
      continue;
    }
    const sizeBytes = Math.floor((base64.length * 3) / 4);
    if (total + sizeBytes > MAX_ATTACHMENT_BYTES) {
      break;
    }
    total += sizeBytes;
    out.push({
      name: f.name ?? 'attachment',
      mimeType: f.type || 'application/octet-stream',
      dataBase64: base64,
      sizeBytes,
    });
  }
  return out;
}

const SELECTABLE_PROFILES: readonly SelectableProfile[] = ['cheap', 'default', 'premium'];

/** Map the webview model-picker value to a backend profile. 'auto' (or anything
 * unrecognized) returns undefined → the router policy chooses. */
function toProfile(value: string | undefined): SelectableProfile | undefined {
  return SELECTABLE_PROFILES.includes(value as SelectableProfile)
    ? (value as SelectableProfile)
    : undefined;
}

export interface ChatViewDeps {
  brainClient: BrainClient;
  router: BackendRouter;
  migraAiClient: MigraAiClient;
  engineDiagnostics?: EngineDiagnostics;
  /** Current server-side memory mode (from settings). */
  memoryMode: () => 'off' | 'session' | 'durable';
  /** Slice 5: the active execution-policy preference (server-authoritative). */
  executionPolicy?: () => string;
  /** Workspace-scoped store for the active conversation id (survives reloads). */
  conversationMemento: vscode.Memento;
  output: vscode.OutputChannel;
}

const CONVERSATION_KEY = 'migrapilot.activeConversationId';

interface ChatMsg {
  role: string;
  text: string;
}

/** A dedicated, first-class MigraPilot chat panel (like Claude Code / Copilot):
 * its own webview in the activity-bar container, addressed directly — no
 * `@migrapilot` mention in the shared chat required. It reuses the exact backend
 * pipeline as the native participant via {@link runChatTurn}, so local
 * brain-service and remote pilot-api behave identically across both surfaces.
 *
 * The webview front-end (thread rendering, markdown, streaming, overlays) is a
 * self-contained HTML/CSS/JS document; this class owns only the message
 * protocol and the backend turn. File attachment is hidden (the canonical
 * backend can't consume attachments yet); the model picker IS wired. */
export class MigraPilotChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'migrapilot.chatView';
  private view?: vscode.WebviewView;
  private inFlight = false;
  private cts?: vscode.CancellationTokenSource;
  private savedMessages: ChatMsg[] = [];
  private webviewReady = false;
  private pendingInjections: string[] = [];
  /** Active server-side conversation id (engine owns the history). */
  private conversationId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: ChatViewDeps,
  ) {
    this.conversationId = deps.conversationMemento.get<string>(CONVERSATION_KEY);
  }

  /** Ensure a server-side conversation exists (engine owns history). Returns the
   * id, or undefined when memory is off or the engine is unavailable. On failure
   * we run the turn statelessly — we NEVER reconstruct history locally. */
  private async ensureConversation(mode: 'session' | 'durable'): Promise<string | undefined> {
    if (this.conversationId) return this.conversationId;
    try {
      const conv = await this.deps.migraAiClient.createConversation({ memoryMode: mode });
      this.conversationId = conv.id;
      await this.deps.conversationMemento.update(CONVERSATION_KEY, conv.id);
      return conv.id;
    } catch (error) {
      this.deps.output.appendLine(`[memory] createConversation failed: ${error instanceof Error ? error.message : String(error)}`);
      void this.view?.webview.postMessage({ type: 'statusUpdate', text: 'Memory unavailable — this turn is stateless.' });
      return undefined;
    }
  }

  /** Load authoritative history from the engine and restore it into the webview
   * (used on reconnect). Never falls back to locally reconstructed history. */
  private async reloadAuthoritativeHistory(): Promise<void> {
    if (!this.conversationId) return;
    try {
      const { messages } = await this.deps.migraAiClient.getConversationMessages(this.conversationId);
      const restored: ChatMsg[] = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, text: m.content }));
      this.savedMessages = restored;
      void this.view?.webview.postMessage({ type: 'restore', messages: restored });
    } catch (error) {
      this.deps.output.appendLine(`[memory] reload history failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      const msg = message as {
        type?: string;
        text?: string;
        history?: ChatMsg[];
        messages?: ChatMsg[];
        provider?: string;
        modelId?: string;
        format?: string;
        data?: string;
        messageIdx?: number;
        sentiment?: string;
        files?: Array<{ name?: string; type?: string; dataUrl?: string; dataBase64?: string }>;
        audio?: string;
        mime?: string;
      };
      switch (msg?.type) {
        case 'ready':
          this.webviewReady = true;
          // Prefer authoritative engine history on (re)connect; fall back to the
          // in-process cache only when there is no server conversation.
          if (this.conversationId && this.deps.memoryMode() !== 'off') {
            void this.reloadAuthoritativeHistory();
          } else if (this.savedMessages.length) {
            void this.view?.webview.postMessage({ type: 'restore', messages: this.savedMessages });
          }
          for (const text of this.pendingInjections.splice(0)) {
            void this.view?.webview.postMessage({ type: 'injectMessage', text });
          }
          // Populate the model picker from the live engine catalog (real Ollama
          // models), so the user isn't limited to the abstract Auto/tier options.
          void this.postModelCatalog();
          return;
        case 'saveState':
          this.savedMessages = msg.messages ?? [];
          return;
        case 'newChat':
          this.cts?.cancel();
          this.savedMessages = [];
          // Start a fresh server-side conversation on the next turn.
          this.conversationId = undefined;
          void this.deps.conversationMemento.update(CONVERSATION_KEY, undefined);
          return;
        case 'stop':
          this.cts?.cancel();
          return;
        case 'info':
          if (msg.text) {
            void vscode.window.showInformationMessage(msg.text);
          }
          return;
        case 'enterpriseExport':
          await this.exportConversation(msg.format, msg.data);
          return;
        case 'enterpriseFeedback':
          this.deps.output.appendLine(
            `[chat feedback] msg=${msg.messageIdx} sentiment=${msg.sentiment} text=${msg.text ?? ''}`,
          );
          void vscode.window.showInformationMessage(`Feedback recorded: ${msg.sentiment ?? 'neutral'}`);
          return;
        case 'transcribe':
          await this.handleTranscribe(msg.audio, msg.mime);
          return;
        case 'chat':
          await this.handleChat(
            msg.text ?? '',
            msg.history ?? [],
            toProfile(msg.provider),
            toAttachments(msg.files),
            typeof msg.modelId === 'string' && msg.modelId ? msg.modelId : undefined,
          );
          return;
        default:
          return;
      }
    });
  }

  /** Fetch the live model catalog from the engine and hand it to the webview so
   * the picker lists the real installed models (Ollama), grouped by qualification.
   * Best-effort: a fetch failure leaves the static Auto/tier options in place. */
  private async postModelCatalog(): Promise<void> {
    if (!this.view) return;
    try {
      const { models } = await this.deps.migraAiClient.getModels();
      const slim = models
        // Only chat-capable models are pinnable here — embedding-only models can't
        // answer a chat turn (pinning one would silently fall back to auto-select).
        .filter((m) => m.capabilities?.chat !== false)
        .map((m) => ({
          id: m.id,
          tier: m.tier,
          paramCount: m.paramCount,
          state: m.qualification?.state,
          vision: Boolean(m.capabilities?.vision),
        }));
      void this.view.webview.postMessage({ type: 'models', models: slim });
    } catch (err) {
      this.deps.output.appendLine(`[chat] model catalog unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Reveal the chat panel (used by the "Open MigraPilot Chat" command/button). */
  public reveal(): void {
    this.view?.show?.(true);
  }

  /** Programmatically inject a prompt and send it (used by quick-action commands
   * that route into chat). Queues until the webview signals ready. */
  public sendToChat(text: string): void {
    if (this.view && this.webviewReady) {
      void this.view.webview.postMessage({ type: 'injectMessage', text });
      return;
    }
    this.pendingInjections.push(text);
  }

  private async handleChat(
    rawText: string,
    history: ChatMsg[],
    modelProfile: SelectableProfile | undefined,
    attachments: ChatAttachment[] = [],
    modelId?: string,
  ): Promise<void> {
    const text = rawText.trim();
    // A turn is valid if there's text OR at least one attachment to analyze.
    if ((!text && attachments.length === 0) || !this.view) {
      return;
    }
    // Hard guard against duplicate concurrent turns from double-dispatch.
    if (this.inFlight) {
      this.deps.output.appendLine('[chat] ignored duplicate request while a turn is active');
      return;
    }
    this.inFlight = true;
    this.cts = new vscode.CancellationTokenSource();
    const webview = this.view.webview;
    void webview.postMessage({ type: 'streamStart' });

    const sink: ChatSink = {
      progress: (t) => void webview.postMessage({ type: 'statusUpdate', text: t }),
      markdown: (t) => void webview.postMessage({ type: 'token', text: t }),
    };

    // Server-side memory: for session/durable the engine owns history and, when
    // present, its own retrieved context wins. But `session` memory is in-memory
    // on the brain — a brain restart wipes it while the client keeps a now-stale
    // conversationId, which would silently degrade to amnesia. So we ALWAYS carry
    // a client-side history summary as a fallback: the engine uses it only when it
    // has no memory of its own, making a restart non-fatal (client-authoritative
    // history, the way Copilot/Claude behave).
    const mode = this.deps.memoryMode();
    const conversationId = mode === 'off' ? undefined : await this.ensureConversation(mode);

    try {
      await runChatTurn(
        {
          brainClient: this.deps.brainClient,
          router: this.deps.router,
          migraAiClient: this.deps.migraAiClient,
          engineDiagnostics: this.deps.engineDiagnostics,
        },
        sink,
        text || 'Analyze the attached file(s).',
        // Always a real fallback: the engine prefers its own memory when it has
        // any, and falls back to this only when its memory is empty/stale.
        summarizeTurns(history),
        this.cts.token,
        {
          modelProfile,
          ...(modelId ? { modelId } : {}),
          attachments,
          ...(this.deps.executionPolicy ? { policy: this.deps.executionPolicy() } : {}),
          ...(conversationId ? { conversationId, memoryPolicy: { mode, retrieve: true, store: true } } : {}),
        },
      );
      void webview.postMessage({ type: 'streamEnd' });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.deps.output.appendLine(`[chat error] ${messageText}`);
      void webview.postMessage({ type: 'error', text: messageText });
      void webview.postMessage({ type: 'streamEnd' });
    } finally {
      this.inFlight = false;
      this.cts?.dispose();
      this.cts = undefined;
    }
  }

  /** Transcribe a recorded audio clip via the local speech-to-text endpoint and
   * post the text back to the webview. The webview cannot fetch a backend
   * directly (CSP `default-src 'none'`), so audio is relayed through the host. */
  private async handleTranscribe(audioBase64: string | undefined, mime: string | undefined): Promise<void> {
    if (!audioBase64 || !this.view) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration('migrapilot');
    const url = String(cfg.get('transcribeUrl', 'http://127.0.0.1:3399/api/pilot/transcribe'));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, mime: mime ?? 'audio/webm' }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!response.ok) {
        throw new Error(`transcribe HTTP ${response.status}`);
      }
      const body = (await response.json()) as { text?: string; transcript?: string };
      const text = (body.text ?? body.transcript ?? '').trim();
      void this.view.webview.postMessage({ type: 'transcribeResult', text });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.deps.output.appendLine(`[transcribe error] ${messageText}`);
      void this.view.webview.postMessage({
        type: 'transcribeError',
        text: 'Voice transcription unavailable. Ensure the local speech service is running.',
      });
    }
  }

  private async exportConversation(format: string | undefined, data: string | undefined): Promise<void> {
    if (!data) {
      return;
    }
    const ext = format === 'json' ? 'json' : 'md';
    const uri = await vscode.window.showSaveDialog({
      filters: ext === 'json' ? { JSON: ['json'] } : { Markdown: ['md'] },
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf-8'));
      void vscode.window.showInformationMessage(`Exported conversation → ${uri.fsPath}`);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      'img-src data: blob:',
    ].join('; ');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      /* ── Message thread ─────────────────────── */
      #thread {
        flex: 1;
        overflow-y: auto;
        padding: 12px 12px 8px;
      }
      #thread::-webkit-scrollbar { width: 6px; }
      #thread::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
      }

      .message {
        margin-bottom: 16px;
        animation: fadeIn 0.15s ease;
      }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

      .message-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .message-header .icon {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        flex-shrink: 0;
      }
      .user-msg .icon {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .assistant-msg .icon {
        background: var(--vscode-terminal-ansiGreen);
        color: var(--vscode-editor-background);
      }
      .user-msg .message-header { color: var(--vscode-descriptionForeground); }
      .assistant-msg .message-header { color: var(--vscode-terminal-ansiGreen); }

      .message-body {
        padding: 8px 12px;
        border-radius: 6px;
        line-height: 1.55;
        word-break: break-word;
        font-size: 13px;
      }
      .user-msg .message-body {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        white-space: pre-wrap;
      }
      .assistant-msg .message-body {
        background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04));
        border-left: 3px solid var(--vscode-terminal-ansiGreen);
        padding-left: 12px;
      }

      /* ── Markdown in assistant messages ─── */
      .assistant-msg .message-body code {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
        padding: 1px 5px;
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
      }
      .assistant-msg .message-body pre {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
        padding: 10px 12px;
        border-radius: 6px;
        margin: 8px 0;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.45;
        position: relative;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .assistant-msg .message-body pre code {
        background: none;
        padding: 0;
        font-size: 12px;
      }
      .assistant-msg .message-body p { margin: 6px 0; }
      .assistant-msg .message-body p:first-child { margin-top: 0; }
      .assistant-msg .message-body p:last-child { margin-bottom: 0; }
      .assistant-msg .message-body ul, .assistant-msg .message-body ol { margin: 6px 0; padding-left: 20px; }
      .assistant-msg .message-body li { margin-bottom: 2px; }
      .assistant-msg .message-body h1, .assistant-msg .message-body h2, .assistant-msg .message-body h3 {
        margin: 10px 0 4px; font-weight: 700; color: var(--vscode-foreground);
      }
      .assistant-msg .message-body h1 { font-size: 16px; }
      .assistant-msg .message-body h2 { font-size: 14px; }
      .assistant-msg .message-body h3 { font-size: 13px; }
      .assistant-msg .message-body blockquote {
        border-left: 3px solid var(--vscode-textLink-foreground);
        padding-left: 10px; margin: 6px 0;
        color: var(--vscode-descriptionForeground);
      }
      .assistant-msg .message-body table {
        border-collapse: collapse; margin: 8px 0; font-size: 12px; width: 100%;
      }
      .assistant-msg .message-body th, .assistant-msg .message-body td {
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        padding: 4px 8px; text-align: left;
      }
      .assistant-msg .message-body th {
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
        font-weight: 600;
      }
      .assistant-msg .message-body a {
        color: var(--vscode-textLink-foreground); text-decoration: underline;
      }
      .assistant-msg .message-body strong { font-weight: 700; color: var(--vscode-foreground); }
      .assistant-msg .message-body hr {
        border: none; border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        margin: 10px 0;
      }
      .copy-code-btn {
        position: absolute; top: 4px; right: 4px;
        background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.1));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        border: none; border-radius: 3px; padding: 2px 6px;
        font-size: 10px; cursor: pointer; opacity: 0;
        transition: opacity 0.15s;
      }
      pre:hover .copy-code-btn { opacity: 1; }
      .copy-code-btn:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

      /* Tool call indicator */
      .tool-call {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        margin: 6px 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        border-radius: 4px;
        background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.06));
      }
      .tool-call .spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid var(--vscode-descriptionForeground);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .tool-call .tool-name {
        font-family: var(--vscode-editor-font-family);
        font-weight: 600;
        color: var(--vscode-terminal-ansiCyan, var(--vscode-textLink-foreground));
      }
      .tool-call .tool-status {
        margin-left: auto;
        font-size: 10px;
      }

      .error-text {
        color: var(--vscode-errorForeground);
        font-size: 12px;
        padding: 6px 10px;
        background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
        border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        border-radius: 4px;
        margin-top: 4px;
      }

      /* ── Typing indicator ───────────────────── */
      .typing-indicator {
        display: none;
        align-items: center;
        gap: 4px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .typing-indicator.active { display: flex; }
      .typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vscode-terminal-ansiGreen);
        animation: bounce 1.4s infinite ease-in-out both;
      }
      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes bounce {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }

      @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      .streaming-cursor {
        display: inline-block; width: 7px; height: 14px;
        background: var(--vscode-terminalCursor-foreground, var(--vscode-terminal-ansiGreen));
        margin-left: 2px; vertical-align: text-bottom;
        animation: blink 1s step-end infinite;
      }

      /* ── Welcome ────────────────────────────── */
      #welcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: var(--vscode-descriptionForeground);
        text-align: center;
        padding: 24px;
        gap: 10px;
      }
      #welcome .logo { font-size: 32px; margin-bottom: 4px; }
      #welcome h3 {
        color: var(--vscode-foreground);
        font-size: 15px;
        font-weight: 600;
      }
      #welcome p { font-size: 12px; line-height: 1.5; max-width: 260px; }
      .quick-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 6px; }
      .quick-action-btn {
        background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
        border-radius: 6px; padding: 6px 10px; font-size: 11px;
        cursor: pointer; transition: all 0.15s;
      }
      .quick-action-btn:hover {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
      }

      /* ── File chips ─────────────────────────── */
      #file-chips {
        display: none;
        flex-wrap: wrap;
        gap: 4px;
        padding: 6px 8px 0;
      }
      #file-chips.has-files { display: flex; }
      .file-chip {
        display: flex; align-items: center; gap: 4px;
        padding: 2px 6px 2px 4px; border-radius: 4px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 10px; max-width: 160px;
      }
      .file-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .file-chip-close {
        background: none; border: none; cursor: pointer;
        color: var(--vscode-badge-foreground); font-size: 12px;
        padding: 0 2px; line-height: 1; opacity: 0.7;
      }
      .file-chip-close:hover { opacity: 1; }
      .file-chip-preview {
        width: 16px; height: 16px; border-radius: 2px; object-fit: cover;
      }

      /* ── Drag overlay ──────────────────────── */
      #drag-overlay {
        display: none;
        position: fixed; inset: 0; z-index: 100;
        background: rgba(0, 120, 212, 0.15);
        border: 2px dashed var(--vscode-focusBorder);
        align-items: center; justify-content: center;
        font-size: 13px; font-weight: 600;
        color: var(--vscode-focusBorder);
        pointer-events: none;
      }
      #drag-overlay.active { display: flex; }

      /* ── Input area ─────────────────────────── */
      #input-area {
        border-top: 1px solid var(--vscode-panel-border, var(--vscode-sideBar-border, rgba(255,255,255,0.1)));
        padding: 8px 10px 10px;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        flex-shrink: 0;
      }
      #input-wrapper {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-focusBorder));
        border-radius: 6px;
        padding: 4px 6px;
        transition: border-color 0.15s;
      }
      #input-wrapper:focus-within {
        border-color: var(--vscode-focusBorder);
      }
      #mic-btn {
        background: none;
        border: none;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        padding: 4px 6px;
        display: flex;
        align-items: center;
        border-radius: 4px;
        flex-shrink: 0;
      }
      #mic-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
      #mic-btn.recording { color: #f44336; animation: mic-pulse 1s ease-in-out infinite; }
      #mic-btn svg { width: 14px; height: 14px; }
      @keyframes mic-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      #attach-btn {
        background: none; border: none; cursor: pointer;
        color: var(--vscode-descriptionForeground);
        width: 26px; height: 26px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 4px; flex-shrink: 0;
        transition: color 0.15s, background 0.15s;
      }
      #attach-btn:hover {
        color: var(--vscode-foreground);
        background: rgba(255,255,255,0.06);
      }
      #attach-btn svg { width: 14px; height: 14px; }
      #input {
        flex: 1;
        width: 100%;
        border: none;
        outline: none;
        background: transparent;
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        resize: none;
        /* Grow generously on paste so long pasted text stays readable
         * (Copilot-style), capped so the thread never fully disappears. */
        max-height: 45vh;
        min-height: 22px;
        line-height: 1.45;
        padding: 3px 0;
        overflow-y: auto;
      }
      #input::-webkit-scrollbar { width: 6px; }
      #input::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
      }
      #input::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }
      #send-btn {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        width: 26px;
        height: 26px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.15s;
      }
      #send-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }
      #send-btn:disabled {
        opacity: 0.4;
        cursor: default;
      }
      #send-btn svg { width: 14px; height: 14px; }
      #stop-btn {
        background: var(--vscode-errorForeground, #f44);
        color: #fff;
        border: none;
        border-radius: 4px;
        width: 26px;
        height: 26px;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      #stop-btn svg { width: 12px; height: 12px; }
      .status-bar {
        display: flex;
        justify-content: space-between;
        padding: 4px 2px 0;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      #new-chat-btn {
        background: none;
        border: none;
        color: var(--vscode-textLink-foreground);
        font-size: 10px;
        cursor: pointer;
        padding: 0;
      }
      #new-chat-btn:hover { text-decoration: underline; }
      #file-input { display: none; }

      /* ── Enterprise: Message Actions bar ── */
      .msg-actions {
        display: none;
        position: absolute;
        top: -6px;
        right: 8px;
        z-index: 10;
        gap: 1px;
        padding: 2px 3px;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .message:hover .msg-actions { display: flex; }
      .msg-actions button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        padding: 3px 5px;
        border-radius: 3px;
        color: var(--vscode-descriptionForeground);
        transition: background 0.1s;
        line-height: 1;
      }
      .msg-actions button:hover {
        background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.08));
        color: var(--vscode-foreground);
      }

      /* ── Enterprise: Reaction bar ── */
      .reaction-bar {
        display: flex;
        gap: 3px;
        flex-wrap: wrap;
        margin-top: 4px;
        padding-left: 12px;
      }
      .reaction-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 7px;
        border-radius: 10px;
        font-size: 11px;
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        background: rgba(255,255,255,0.04);
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        transition: all 0.15s;
      }
      .reaction-pill.user-reacted {
        border-color: var(--vscode-focusBorder);
        background: rgba(0,120,212,0.12);
      }
      .reaction-pill:hover { background: rgba(255,255,255,0.08); }

      /* ── Enterprise: Quick-react picker ── */
      .react-picker {
        display: none;
        position: absolute;
        bottom: 100%;
        right: 0;
        padding: 4px;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        gap: 2px;
        flex-wrap: wrap;
        width: 150px;
        z-index: 20;
      }
      .react-picker.open { display: flex; }
      .react-picker button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 16px;
        padding: 3px;
        border-radius: 3px;
        transition: transform 0.1s;
      }
      .react-picker button:hover { transform: scale(1.2); }

      /* ── Enterprise: Cost badge ── */
      .cost-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 1px 7px;
        font-size: 10px;
        border-radius: 4px;
        background: rgba(0,120,212,0.08);
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        margin-top: 3px;
        margin-left: 12px;
      }
      .cost-badge .cost-usd { color: var(--vscode-terminal-ansiGreen); }

      /* ── Model picker ── */
      #model-picker {
        background: var(--vscode-dropdown-background, var(--vscode-input-background));
        color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, rgba(255,255,255,0.15)));
        border-radius: 3px;
        font-size: 10px;
        padding: 1px 4px;
        cursor: pointer;
        font-family: var(--vscode-font-family);
        outline: none;
      }
      #model-picker:focus { border-color: var(--vscode-focusBorder); }

      /* ── Enterprise: Pin / Edited badges ── */
      .pin-badge, .edited-badge {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-left: 4px;
      }
      .edited-badge { font-style: italic; }

      /* ── Enterprise: Feedback thumbs ── */
      .feedback-btns {
        display: inline-flex;
        gap: 2px;
        margin-left: 6px;
      }
      .feedback-btns button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 11px;
        padding: 0 2px;
        color: var(--vscode-descriptionForeground);
        opacity: 0;
        transition: opacity 0.15s;
      }
      .message:hover .feedback-btns button { opacity: 0.7; }
      .feedback-btns button:hover { opacity: 1 !important; }

      /* ── Enterprise: Thinking timer ── */
      .thinking-timer {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        padding: 4px 0;
      }
      .thinking-timer .elapsed {
        color: var(--vscode-terminal-ansiCyan);
        font-weight: 600;
      }
      @keyframes gear-spin { to { transform: rotate(360deg); } }
      .thinking-timer .gear {
        display: inline-block;
        animation: gear-spin 1s linear infinite;
      }

      /* ── Enterprise: Slash command palette ── */
      #slash-palette {
        display: none;
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        max-height: 240px;
        overflow-y: auto;
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        border-radius: 6px 6px 0 0;
        box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
        z-index: 50;
        padding: 4px 0;
      }
      #slash-palette.open { display: block; }
      #slash-palette .sp-header {
        padding: 4px 10px;
        font-size: 9px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.8px;
      }
      .sp-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .sp-item:hover, .sp-item.selected {
        background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
      }
      .sp-item .sp-name {
        font-family: var(--vscode-editor-font-family);
        font-weight: 600;
        font-size: 12px;
        color: var(--vscode-textLink-foreground);
      }
      .sp-item .sp-args {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.6;
      }
      .sp-item .sp-desc {
        margin-left: auto;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .sp-dot {
        width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
      }

      /* ── Enterprise: Overlay panels (export, feedback, shortcuts, search) ── */
      .overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 100;
        align-items: center;
        justify-content: center;
      }
      .overlay.open { display: flex; }
      .overlay-card {
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        border-radius: 8px;
        padding: 16px 20px;
        width: 320px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      .overlay-card h3 {
        margin: 0 0 12px;
        font-size: 14px;
        color: var(--vscode-foreground);
      }
      .overlay-card .btn-row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      .overlay-card .btn-primary {
        flex: 1;
        padding: 8px;
        border-radius: 4px;
        border: none;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .overlay-card .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
      .overlay-card .btn-ghost {
        flex: 1;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        background: transparent;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 12px;
      }

      /* ── Enterprise: Sentiment selector ── */
      .sentiment-row {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
      }
      .sentiment-btn {
        flex: 1;
        padding: 10px;
        border-radius: 6px;
        border: 2px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        background: transparent;
        cursor: pointer;
        font-size: 18px;
        text-align: center;
      }
      .sentiment-btn.active {
        border-color: var(--vscode-focusBorder);
        background: rgba(0,120,212,0.1);
      }
      .sentiment-label {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-top: 3px;
      }
      .feedback-textarea {
        width: 100%;
        min-height: 60px;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border, var(--vscode-focusBorder));
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-font-family);
        font-size: 12px;
        resize: vertical;
        outline: none;
      }

      /* ── Enterprise: Shortcut list ── */
      .shortcut-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
      }
      .shortcut-row kbd {
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
        font-size: 10px;
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-textLink-foreground);
      }
      .shortcut-row span {
        font-size: 12px;
        color: var(--vscode-foreground);
      }

      /* ── Enterprise: Header bar ── */
      #header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
        background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        flex-shrink: 0;
        min-height: 28px;
      }
      #header-bar .hdr-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--vscode-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        cursor: default;
      }
      #header-bar .hdr-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 4px;
        border-radius: 3px;
        color: var(--vscode-descriptionForeground);
        transition: color 0.1s;
      }
      #header-bar .hdr-btn:hover { color: var(--vscode-foreground); }

      .message { position: relative; }
    </style>
  </head>
  <body>
    <!-- Enterprise: Header bar -->
    <div id="header-bar">
      <span class="hdr-title" id="conv-title">MigraPilot</span>
      <button class="hdr-btn" id="hdr-search" title="Search (Ctrl+Shift+F)">&#x1F50D;</button>
      <button class="hdr-btn" id="hdr-export" title="Export (Ctrl+Shift+E)">&#x1F4E5;</button>
      <button class="hdr-btn" id="hdr-usage" title="Token usage">&#x1F4CA;</button>
      <button class="hdr-btn" id="hdr-shortcuts" title="Keyboard shortcuts (Ctrl+/)">&#x2328;&#xFE0F;</button>
    </div>

    <!-- Enterprise: Overlays -->
    <div class="overlay" id="export-overlay">
      <div class="overlay-card">
        <h3>&#x1F4E5; Export Conversation</h3>
        <div class="btn-row">
          <button class="btn-primary" id="export-json">&#x1F4C4; JSON</button>
          <button class="btn-primary" id="export-md" style="background:var(--vscode-terminal-ansiGreen)">&#x1F4DD; Markdown</button>
        </div>
        <div class="btn-row"><button class="btn-ghost" id="export-cancel" style="flex:1">Cancel</button></div>
      </div>
    </div>

    <div class="overlay" id="feedback-overlay">
      <div class="overlay-card">
        <h3>Rate this response</h3>
        <div class="sentiment-row">
          <button class="sentiment-btn" data-sentiment="positive">&#x1F44D;<div class="sentiment-label">Good</div></button>
          <button class="sentiment-btn" data-sentiment="neutral">&#x1F937;<div class="sentiment-label">Okay</div></button>
          <button class="sentiment-btn" data-sentiment="negative">&#x1F44E;<div class="sentiment-label">Bad</div></button>
        </div>
        <textarea class="feedback-textarea" id="feedback-text" placeholder="What could be improved? (optional)"></textarea>
        <div class="btn-row">
          <button class="btn-ghost" id="feedback-cancel">Cancel</button>
          <button class="btn-primary" id="feedback-submit">Submit</button>
        </div>
      </div>
    </div>

    <div class="overlay" id="shortcuts-overlay">
      <div class="overlay-card">
        <h3>&#x2328;&#xFE0F; Keyboard Shortcuts</h3>
        <div id="shortcuts-list"></div>
        <div class="btn-row"><button class="btn-ghost" id="shortcuts-close" style="flex:1">Close (Esc)</button></div>
      </div>
    </div>

    <div class="overlay" id="usage-overlay">
      <div class="overlay-card">
        <h3>&#x1F4CA; Session Usage</h3>
        <div id="usage-content" style="font-family:var(--vscode-editor-font-family);font-size:12px;">Loading...</div>
        <div class="btn-row"><button class="btn-ghost" id="usage-close" style="flex:1">Close</button></div>
      </div>
    </div>

    <div id="welcome">
      <div class="logo">&#x2728;</div>
      <h3>MigraPilot</h3>
      <p>Your AI infrastructure copilot. Ask about servers, deployments, configuration, or anything in your workspace.</p>
      <div class="quick-actions">
        <button class="quick-action-btn" data-prompt="Show system inventory">&#x1F4E6; Inventory</button>
        <button class="quick-action-btn" data-prompt="Check system health">&#x1F49A; Health</button>
        <button class="quick-action-btn" data-prompt="Show repo status">&#x1F4CB; Repo Status</button>
        <button class="quick-action-btn" data-prompt="Detect drift across infra">&#x1F4CA; Drift</button>
      </div>
    </div>

    <div id="thread" style="display:none"></div>
    <div id="drag-overlay">Drop files to attach</div>

    <div class="typing-indicator" id="typing">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <span>MigraPilot is thinking…</span>
    </div>

    <div id="input-area">
      <div id="file-chips"></div>
      <div id="input-wrapper">
        <button id="mic-btn" title="Voice input (click to start/stop)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z"/><path d="M4 6a.5.5 0 0 0-1 0v1a5 5 0 0 0 4.5 4.975V14H5.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1H8.5v-2.025A5 5 0 0 0 13 7V6a.5.5 0 0 0-1 0v1a4 4 0 0 1-8 0V6z"/></svg>
        </button>
        <button id="attach-btn" title="Attach files (images, PDF, JSON, CSV)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 7.5l-5.7 5.7a3.2 3.2 0 01-4.5-4.5l5.7-5.7a2.1 2.1 0 013 3L6.3 11.7a1.1 1.1 0 01-1.5-1.5L10 5"/>
          </svg>
        </button>
        <!-- Enterprise: Slash command palette -->
        <div id="slash-palette">
          <div class="sp-header">Commands</div>
          <div id="slash-items"></div>
        </div>
        <textarea id="input" rows="1" placeholder="Ask MigraPilot…  (/ for commands)"></textarea>
        <button id="send-btn" title="Send (Enter)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1.91L7.2 8 1 14.09 1.91 15 9.82 8 1.91 1 1 1.91z"/><path d="M6 1.91L12.2 8 6 14.09 6.91 15 14.82 8 6.91 1 6 1.91z"/></svg>
        </button>
        <button id="stop-btn" title="Stop generation">
          <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
        </button>
      </div>
      <div class="status-bar">
        <span id="status-text">Ready</span>
        <select id="model-picker" title="Model for next message">
          <option value="auto" selected>Auto</option>
          <option value="cheap">⚡ Fast</option>
          <option value="default">⚖️ Balanced</option>
          <option value="premium">💎 Deep</option>
        </select>
        <button id="new-chat-btn">New chat</button>
      </div>
      <input type="file" id="file-input" multiple accept="image/*,.txt,.md,.json,.jsonc,.csv,.tsv,.yaml,.yml,.toml,.ini,.env,.log,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.sql,.diff,.patch,.pdf" />
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const thread = document.getElementById('thread');
      const welcome = document.getElementById('welcome');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send-btn');
      const modelPicker = document.getElementById('model-picker');
      const stopBtn = document.getElementById('stop-btn');
      const typing = document.getElementById('typing');
      const statusText = document.getElementById('status-text');
      const newChatBtn = document.getElementById('new-chat-btn');
      const attachBtn = document.getElementById('attach-btn');
      const micBtn = document.getElementById('mic-btn');
      const fileInput = document.getElementById('file-input');
      const fileChips = document.getElementById('file-chips');
      const dragOverlay = document.getElementById('drag-overlay');

      let streaming = false;
      let currentAssistantBody = null;
      let currentStreamingRaw = '';  // raw text accumulated during streaming
      let messages = [];
      let pendingFiles = [];  // { file, name, size, type, dataUrl? }
      let currentMessageIdx = -1; // index of current assistant message

      // ── Enterprise state ─────────────────
      const convTitle = document.getElementById('conv-title');
      const hdrSearch = document.getElementById('hdr-search');
      const hdrExport = document.getElementById('hdr-export');
      const hdrUsage = document.getElementById('hdr-usage');
      const hdrShortcuts = document.getElementById('hdr-shortcuts');
      const slashPalette = document.getElementById('slash-palette');
      const slashItems = document.getElementById('slash-items');
      const exportOverlay = document.getElementById('export-overlay');
      const feedbackOverlay = document.getElementById('feedback-overlay');
      const shortcutsOverlay = document.getElementById('shortcuts-overlay');
      const usageOverlay = document.getElementById('usage-overlay');

      let currentConversationId = null;
      let thinkingInterval = null;
      let thinkingStart = 0;
      let feedbackTargetIdx = -1;
      let slashPaletteOpen = false;
      let slashSelectedIdx = 0;
      let sessionTokens = { prompt: 0, completion: 0, cost: 0 };

      const REACTIONS = ['\\u{1F44D}','\\u{1F44E}','\\u{2764}\\u{FE0F}','\\u{1F389}','\\u{1F914}','\\u{1F440}','\\u{1F680}','\\u{1F4AF}'];
      const SLASH_COMMANDS = [
        { name: '/explain', args: '<code>', desc: 'Explain selected code', color: '#4fc3f7' },
        { name: '/fix', args: '<issue>', desc: 'Fix a bug or error', color: '#f44336' },
        { name: '/refactor', args: '<code>', desc: 'Refactor code', color: '#ab47bc' },
        { name: '/test', args: '<file>', desc: 'Generate tests', color: '#66bb6a' },
        { name: '/review', args: '<pr>', desc: 'Code review', color: '#ffa726' },
        { name: '/docs', args: '<code>', desc: 'Generate documentation', color: '#26c6da' },
        { name: '/deploy', args: '<target>', desc: 'Deploy to environment', color: '#ef5350' },
        { name: '/status', args: '', desc: 'System status check', color: '#78909c' },
        { name: '/logs', args: '<service>', desc: 'Tail service logs', color: '#8d6e63' },
        { name: '/clear', args: '', desc: 'Clear the chat', color: '#bdbdbd' },
        { name: '/export', args: '<format>', desc: 'Export conversation', color: '#5c6bc0' },
        { name: '/help', args: '', desc: 'Show all commands', color: '#29b6f6' },
      ];
      const KEYBOARD_SHORTCUTS = [
        { keys: 'Ctrl+Shift+E', action: 'Export conversation' },
        { keys: 'Ctrl+Shift+F', action: 'Search messages' },
        { keys: 'Ctrl+/', action: 'Keyboard shortcuts' },
        { keys: 'Ctrl+L', action: 'New chat' },
        { keys: 'Enter', action: 'Send message' },
        { keys: 'Shift+Enter', action: 'New line' },
        { keys: 'Escape', action: 'Close panel / stop' },
      ];

      // ── Enterprise helpers ───────────────
      function formatElapsed(ms) {
        const s = Math.floor(ms / 1000);
        if (s < 60) return s + 's';
        return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
      }
      function startThinkingTimer() {
        thinkingStart = Date.now();
        if (thinkingInterval) clearInterval(thinkingInterval);
        const timerEl = document.getElementById('thinking-timer');
        if (timerEl) timerEl.style.display = 'flex';
        thinkingInterval = setInterval(() => {
          const el = document.getElementById('thinking-elapsed');
          if (el) el.textContent = formatElapsed(Date.now() - thinkingStart);
        }, 250);
      }
      function stopThinkingTimer() {
        if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
        const timerEl = document.getElementById('thinking-timer');
        if (timerEl) timerEl.style.display = 'none';
      }

      function openOverlay(el) { el.classList.add('open'); }
      function closeOverlay(el) { el.classList.remove('open'); }
      function closeAllOverlays() {
        [exportOverlay, feedbackOverlay, shortcutsOverlay, usageOverlay].forEach(o => o.classList.remove('open'));
      }

      function buildMsgActionsHtml(idx, role) {
        const copyBtn = '<button title="Copy" onclick="copyMsg(' + idx + ')">\\u{1F4CB}</button>';
        const reactBtn = role === 'assistant' ? '<button title="React" onclick="toggleReactPicker(' + idx + ')">\\u{1F600}</button>' : '';
        const pinBtn = '<button title="Pin" onclick="togglePinMsg(' + idx + ')">\\u{1F4CC}</button>';
        const bookmarkBtn = '<button title="Bookmark" onclick="toggleBookmark(' + idx + ')">\\u{1F516}</button>';
        const feedbackBtn = role === 'assistant' ? '<button title="Feedback" onclick="openFeedback(' + idx + ')">\\u{2B50}</button>' : '';
        const retryBtn = role === 'user' ? '<button title="Retry" onclick="retryMsg(' + idx + ')">\\u{1F504}</button>' : '';
        return '<div class="msg-actions">' + copyBtn + reactBtn + pinBtn + bookmarkBtn + feedbackBtn + retryBtn + '</div>';
      }

      function buildReactionBarHtml(idx) {
        return '<div class="reaction-bar" id="reaction-bar-' + idx + '"></div>';
      }

      // ── Helpers ──────────────────────────

      function escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      /**
       * Full markdown parser — handles code blocks, inline code, headings,
       * bold, italic, links, lists, blockquotes, tables, horizontal rules.
       * Rendered as HTML string.
       */
      function renderMarkdown(text) {
        // Step 1: Extract code blocks to protect them from other parsing
        const codeBlocks = [];
        let processed = text.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
          const idx = codeBlocks.length;
          codeBlocks.push('<pre><code>' + escapeHtml(code) + '</code><button class="copy-code-btn" onclick="copyCode(this)">Copy</button></pre>');
          return '%%CODEBLOCK_' + idx + '%%';
        });

        // Step 2: Parse tables
        processed = processed.replace(/(^|\\n)(\\|.+\\|\\n)(\\|[-:|\\s]+\\|\\n)((?:\\|.+\\|\\n?)*)/gm, (m, pre, headerLine, sepLine, bodyLines) => {
          const headers = headerLine.trim().split('|').filter(c => c.trim());
          let html = '<table><thead><tr>' + headers.map(h => '<th>' + escapeHtml(h.trim()) + '</th>').join('') + '</tr></thead><tbody>';
          const rows = bodyLines.trim().split('\\n').filter(Boolean);
          rows.forEach(row => {
            const cells = row.split('|').filter(c => c.trim());
            html += '<tr>' + cells.map(c => '<td>' + escapeHtml(c.trim()) + '</td>').join('') + '</tr>';
          });
          html += '</tbody></table>';
          return pre + html;
        });

        // Split into lines for block-level parsing
        const lines = processed.split('\\n');
        let html = '';
        let inList = false;
        let listType = '';

        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];

          // Code block placeholders
          const cbMatch = line.match(/^%%CODEBLOCK_(\\d+)%%$/);
          if (cbMatch) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += codeBlocks[parseInt(cbMatch[1])];
            continue;
          }

          // Headings
          if (/^###\\s/.test(line)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += '<h3>' + inlineMarkdown(line.slice(4)) + '</h3>';
            continue;
          }
          if (/^##\\s/.test(line)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += '<h2>' + inlineMarkdown(line.slice(3)) + '</h2>';
            continue;
          }
          if (/^#\\s/.test(line)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += '<h1>' + inlineMarkdown(line.slice(2)) + '</h1>';
            continue;
          }

          // Horizontal rule
          if (/^(---+|\\*\\*\\*+|___+)$/.test(line.trim())) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += '<hr>';
            continue;
          }

          // Blockquote
          if (/^>\\s?/.test(line)) {
            if (inList) { html += '</' + listType + '>'; inList = false; }
            html += '<blockquote>' + inlineMarkdown(line.replace(/^>\\s?/, '')) + '</blockquote>';
            continue;
          }

          // Unordered list
          if (/^\\s*[-*+]\\s/.test(line)) {
            if (!inList || listType !== 'ul') {
              if (inList) html += '</' + listType + '>';
              html += '<ul>';
              inList = true;
              listType = 'ul';
            }
            html += '<li>' + inlineMarkdown(line.replace(/^\\s*[-*+]\\s/, '')) + '</li>';
            continue;
          }

          // Ordered list
          if (/^\\s*\\d+\\.\\s/.test(line)) {
            if (!inList || listType !== 'ol') {
              if (inList) html += '</' + listType + '>';
              html += '<ol>';
              inList = true;
              listType = 'ol';
            }
            html += '<li>' + inlineMarkdown(line.replace(/^\\s*\\d+\\.\\s/, '')) + '</li>';
            continue;
          }

          // Close list if we hit non-list content
          if (inList) {
            html += '</' + listType + '>';
            inList = false;
          }

          // Empty line → break
          if (line.trim() === '') {
            continue;
          }

          // Paragraph
          html += '<p>' + inlineMarkdown(line) + '</p>';
        }

        if (inList) html += '</' + listType + '>';
        return html;
      }

      /** Inline markdown: bold, italic, inline code, links, strikethrough */
      function inlineMarkdown(text) {
        // If text contains HTML tags, pass them through instead of escaping
        let html = /<[a-z][\s\S]*>/i.test(text) ? text : escapeHtml(text);
        // Inline code
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        // Bold+italic
        html = html.replace(/\\*\\*\\*([^*]+)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        // Bold
        html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
        // Strikethrough
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        // Links
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" title="$2">$1</a>');
        return html;
      }

      /** Resilient clipboard write. In a VS Code webview the async Clipboard API
       * frequently REJECTS (the iframe lacks clipboard-write permission / transient
       * activation), and the old code had no catch, so copy silently did nothing.
       * Try the async API, then fall back to a hidden-textarea execCommand copy.
       * Returns a Promise<boolean> for success. */
      function copyToClipboard(text) {
        text = text == null ? '' : String(text);
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
          } catch (e) {
            return false;
          }
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true, () => fallback());
          }
        } catch (e) { /* fall through */ }
        return Promise.resolve(fallback());
      }

      /** Copy code block content */
      window.copyCode = function(btn) {
        const pre = btn.parentElement;
        const code = pre.querySelector('code');
        if (!code) return;
        copyToClipboard(code.textContent).then((ok) => {
          btn.textContent = ok ? 'Copied!' : 'Copy failed';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      };

      // ── Enterprise: Message action callbacks ──
      window.copyMsg = function(idx) {
        if (!messages[idx]) return;
        copyToClipboard(messages[idx].text).then((ok) => {
          vscode.postMessage({ type: 'info', text: ok ? 'Message copied to clipboard' : 'Copy failed — clipboard unavailable' });
        });
      };
      window.toggleReactPicker = function(idx) {
        const existing = document.getElementById('react-picker-' + idx);
        if (existing) { existing.classList.toggle('open'); return; }
        const bar = document.getElementById('reaction-bar-' + idx);
        if (!bar) return;
        const picker = document.createElement('div');
        picker.className = 'react-picker open';
        picker.id = 'react-picker-' + idx;
        picker.style.position = 'relative'; picker.style.display = 'flex'; picker.style.bottom = 'auto';
        REACTIONS.forEach(emoji => {
          const b = document.createElement('button');
          b.textContent = emoji;
          b.addEventListener('click', () => { addReaction(idx, emoji); picker.classList.remove('open'); });
          picker.appendChild(b);
        });
        bar.parentElement.insertBefore(picker, bar);
      };
      window.togglePinMsg = function(idx) {
        if (!messages[idx]) return;
        messages[idx].pinned = !messages[idx].pinned;
        saveState();
        vscode.postMessage({ type: 'info', text: messages[idx].pinned ? 'Message pinned' : 'Message unpinned' });
      };
      window.toggleBookmark = function(idx) {
        if (!messages[idx]) return;
        messages[idx].bookmarked = !messages[idx].bookmarked;
        saveState();
        vscode.postMessage({ type: 'info', text: messages[idx].bookmarked ? 'Bookmarked' : 'Bookmark removed' });
      };
      window.openFeedback = function(idx) {
        feedbackTargetIdx = idx;
        document.querySelectorAll('.sentiment-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('feedback-text').value = '';
        openOverlay(feedbackOverlay);
      };
      window.retryMsg = function(idx) {
        if (!messages[idx] || messages[idx].role !== 'user') return;
        const text = messages[idx].text;
        // Remove everything after this user message
        messages = messages.slice(0, idx);
        // Re-render thread
        thread.innerHTML = '';
        messages.forEach((m, i) => {
          if (m.role === 'user') addUserMessage(m.text, true);
          else {
            const body = startAssistantMessage();
            body.innerHTML = renderMarkdown(m.text);
          }
        });
        // Re-send
        currentAssistantBody = null;
        setStreaming(true);
        addUserMessage(text);
        vscode.postMessage({ type: 'chat', text });
      };

      function addReaction(idx, emoji) {
        if (!messages[idx]) return;
        if (!messages[idx].reactions) messages[idx].reactions = {};
        if (messages[idx].reactions[emoji]) {
          delete messages[idx].reactions[emoji];
        } else {
          messages[idx].reactions[emoji] = true;
        }
        renderReactions(idx);
        saveState();
      }

      function renderReactions(idx) {
        const bar = document.getElementById('reaction-bar-' + idx);
        if (!bar) return;
        bar.innerHTML = '';
        const rxns = messages[idx]?.reactions || {};
        Object.keys(rxns).forEach(emoji => {
          const pill = document.createElement('span');
          pill.className = 'reaction-pill user-reacted';
          pill.textContent = emoji;
          pill.addEventListener('click', () => addReaction(idx, emoji));
          bar.appendChild(pill);
        });
      }

      function saveState() {
        vscode.postMessage({ type: 'saveState', messages });
        vscode.setState({ messages });
      }

      function normalizeAssistantText(t) {
        return (t || '').replace(/\\s+/g, ' ').trim();
      }

      function addUserMessage(text, skipSave) {
        welcome.style.display = 'none';
        thread.style.display = 'block';

        const idx = skipSave ? messages.findIndex(m => m.text === text && m.role === 'user') : messages.length;
        const safeIdx = idx >= 0 ? idx : messages.length;

        const msg = document.createElement('div');
        msg.className = 'message user-msg';
        msg.innerHTML =
          buildMsgActionsHtml(safeIdx, 'user') +
          '<div class="message-header"><div class="icon">U</div><span>You</span></div>' +
          '<div class="message-body">' + escapeHtml(text) + '</div>' +
          buildReactionBarHtml(safeIdx);
        thread.appendChild(msg);
        scrollToBottom();
        if (!skipSave) {
          messages.push({ role: 'user', text });
          currentMessageIdx = messages.length - 1;
          saveState();
        }
      }

      function startAssistantMessage() {
        const idx = messages.length; // will be pushed on streamEnd

        const msg = document.createElement('div');
        msg.className = 'message assistant-msg';
        msg.innerHTML =
          buildMsgActionsHtml(idx, 'assistant') +
          '<div class="message-header"><div class="icon">M</div><span>MigraPilot</span>' +
          '<span class="feedback-btns">' +
            '<button title="Good" onclick="openFeedback(' + idx + ')">\\u{1F44D}</button>' +
            '<button title="Bad" onclick="openFeedback(' + idx + ')">\\u{1F44E}</button>' +
          '</span></div>' +
          '<div class="message-body"></div>' +
          '<div class="thinking-timer" id="thinking-timer" style="display:none;margin-left:12px;">' +
            '<span class="gear">\\u{2699}\\u{FE0F}</span> Thinking\\u{2026} <span class="elapsed" id="thinking-elapsed">0s</span>' +
          '</div>' +
          buildReactionBarHtml(idx);
        thread.appendChild(msg);
        currentAssistantBody = msg.querySelector('.message-body');
        currentStreamingRaw = '';
        currentMessageIdx = idx;
        scrollToBottom();
        return currentAssistantBody;
      }

      function addToolCall(data) {
        if (!currentAssistantBody) startAssistantMessage();
        const el = document.createElement('div');
        el.className = 'tool-call';
        const status = data.status || 'running';
        const icon = status === 'running' ? '<div class="spinner"></div>' : '&#x2705;';
        const name = data.toolName || data.name || 'tool';
        el.innerHTML = icon + ' <span class="tool-name">' + escapeHtml(name) + '</span><span class="tool-status">' + status + '</span>';
        currentAssistantBody.appendChild(el);
        scrollToBottom();
      }

      function addError(text) {
        const el = document.createElement('div');
        el.className = 'error-text';
        el.textContent = text;
        if (currentAssistantBody) {
          currentAssistantBody.appendChild(el);
        } else {
          const body = startAssistantMessage();
          body.appendChild(el);
        }
        scrollToBottom();
      }

      function scrollToBottom() {
        requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
      }

      function setStreaming(val) {
        streaming = val;
        sendBtn.style.display = val ? 'none' : 'flex';
        stopBtn.style.display = val ? 'flex' : 'none';
        sendBtn.disabled = val;
        typing.classList.toggle('active', val);
        statusText.textContent = val ? 'Thinking…' : 'Ready';
        if (val) { startThinkingTimer(); } else { stopThinkingTimer(); }
      }

      // ── File handling ──────────────────
      const MAX_FILE_SIZE = 8 * 1024 * 1024;
      const MAX_FILES = 6;
      // Text-like docs are read as text and inlined into the prompt so ANY model
      // can analyze them. Extension-based so unusual MIME types still classify.
      const TEXT_EXT = /\\.(txt|md|markdown|json|jsonc|csv|tsv|ya?ml|toml|ini|env|log|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|sql|graphql|gql|svg|conf|dockerfile|makefile|diff|patch)$/i;
      function classify(f) {
        if ((f.type || '').startsWith('image/')) return 'image';
        if (TEXT_EXT.test(f.name) || (f.type || '').startsWith('text/') || /json|xml|yaml|csv|javascript|typescript/.test(f.type || '')) return 'text';
        return 'binary';
      }

      function addFiles(fileList) {
        for (const f of fileList) {
          if (pendingFiles.length >= MAX_FILES) break;
          if (f.size > MAX_FILE_SIZE) {
            vscode.postMessage({ type: 'info', text: '"' + f.name + '" is too large (max 8 MB).' });
            continue;
          }
          const kind = classify(f);
          const reader = new FileReader();
          reader.onload = () => {
            const entry = { name: f.name, size: f.size, type: f.type, kind };
            if (kind === 'text') {
              entry.text = String(reader.result || '');
            } else {
              entry.dataUrl = reader.result; // data:<mime>;base64,...
            }
            pendingFiles.push(entry);
            renderFileChips();
          };
          if (kind === 'text') reader.readAsText(f);
          else reader.readAsDataURL(f);
        }
      }

      function removeFile(idx) {
        pendingFiles.splice(idx, 1);
        renderFileChips();
      }

      function renderFileChips() {
        fileChips.innerHTML = '';
        if (pendingFiles.length === 0) {
          fileChips.classList.remove('has-files');
          return;
        }
        fileChips.classList.add('has-files');
        pendingFiles.forEach((f, i) => {
          const chip = document.createElement('div');
          chip.className = 'file-chip';
          const isImg = f.type && f.type.startsWith('image/');
          let inner = '';
          if (isImg && f.dataUrl) {
            inner += '<img class="file-chip-preview" src="' + f.dataUrl + '" />';
          } else {
            inner += '&#x1F4C4; ';
          }
          inner += '<span class="file-chip-name">' + escapeHtml(f.name) + '</span>';
          inner += '<button class="file-chip-close" data-idx="' + i + '">&times;</button>';
          chip.innerHTML = inner;
          chip.querySelector('.file-chip-close').addEventListener('click', () => removeFile(i));
          fileChips.appendChild(chip);
        });
      }

      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files) addFiles(fileInput.files);
        fileInput.value = '';
      });

      // ── Voice Input (record → local transcription) ──────────
      // The webview can't reach a backend directly (CSP default-src 'none'), so we
      // record audio here and relay it to the extension host, which POSTs it to the
      // local speech-to-text service and returns the text. This is reliable in the
      // Electron webview where the Web Speech API has no speech server.
      let mediaRecorder = null;
      let mediaStream = null;
      let recordedChunks = [];
      let isRecording = false;
      const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

      function setMicState(state) {
        // state: 'idle' | 'recording' | 'transcribing'
        micBtn.classList.toggle('recording', state === 'recording');
        micBtn.disabled = state === 'transcribing';
        micBtn.title =
          state === 'recording' ? 'Recording… click to stop' :
          state === 'transcribing' ? 'Transcribing…' :
          'Voice input (click to record)';
        if (state === 'transcribing') statusText.textContent = 'Transcribing…';
      }

      async function startRecording() {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
          vscode.postMessage({ type: 'info', text: 'Microphone access denied or unavailable.' });
          return;
        }
        recordedChunks = [];
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
        try {
          mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
        } catch (err) {
          mediaRecorder = new MediaRecorder(mediaStream);
        }
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          (mediaStream.getTracks() || []).forEach(t => t.stop());
          mediaStream = null;
          if (recordedChunks.length === 0) { setMicState('idle'); return; }
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          setMicState('transcribing');
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            vscode.postMessage({ type: 'transcribe', audio: base64, mime: blob.type });
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        isRecording = true;
        setMicState('recording');
      }

      function stopRecording() {
        isRecording = false;
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          try { mediaRecorder.stop(); } catch {}
        }
      }

      if (canRecord) {
        micBtn.addEventListener('click', () => {
          if (isRecording) stopRecording();
          else startRecording();
        });
      } else {
        micBtn.style.display = 'none';
      }

      // Drag and drop
      document.addEventListener('dragover', (e) => { e.preventDefault(); dragOverlay.classList.add('active'); });
      document.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || !document.body.contains(e.relatedTarget)) {
          dragOverlay.classList.remove('active');
        }
      });
      document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragOverlay.classList.remove('active');
        if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
      });

      // Paste: attach pasted images/files; for pasted text, expand the box so a
      // long paste stays readable (Copilot-style).
      input.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (items) {
          const files = [];
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
              const f = items[i].getAsFile();
              if (f) files.push(f);
            }
          }
          if (files.length > 0) { e.preventDefault(); addFiles(files); return; }
        }
        // Text paste: let it land, then grow to fit.
        requestAnimationFrame(autoResizeInput);
      });

      // ── Enterprise: Slash command palette ──
      function renderSlashPalette(filter) {
        const q = filter.toLowerCase().slice(1); // strip leading /
        const matches = SLASH_COMMANDS.filter(c => c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
        slashItems.innerHTML = '';
        if (matches.length === 0) { slashPalette.classList.remove('open'); slashPaletteOpen = false; return; }
        slashSelectedIdx = 0;
        matches.forEach((cmd, i) => {
          const el = document.createElement('div');
          el.className = 'sp-item' + (i === 0 ? ' selected' : '');
          el.innerHTML =
            '<div class="sp-dot" style="background:' + cmd.color + '"></div>' +
            '<span class="sp-name">' + escapeHtml(cmd.name) + '</span>' +
            (cmd.args ? '<span class="sp-args">' + escapeHtml(cmd.args) + '</span>' : '') +
            '<span class="sp-desc">' + escapeHtml(cmd.desc) + '</span>';
          el.addEventListener('click', () => selectSlashCommand(cmd));
          slashItems.appendChild(el);
        });
        slashPalette.classList.add('open');
        slashPaletteOpen = true;
      }

      function selectSlashCommand(cmd) {
        if (cmd.name === '/clear') {
          newChatBtn.click();
          input.value = '';
        } else if (cmd.name === '/export') {
          openOverlay(exportOverlay);
          input.value = '';
        } else if (cmd.name === '/help') {
          input.value = '';
          const helpText = SLASH_COMMANDS.map(c => c.name + ' ' + c.args + ' – ' + c.desc).join('\\n');
          addUserMessage('/help');
          const body = startAssistantMessage();
          currentStreamingRaw = '**Available Commands:**\\n\\n' + SLASH_COMMANDS.map(c => '- **' + c.name + '** ' + c.args + ' \\u2014 ' + c.desc).join('\\n');
          body.innerHTML = renderMarkdown(currentStreamingRaw);
          messages.push({ role: 'assistant', text: currentStreamingRaw });
          saveState();
          setStreaming(false);
        } else {
          input.value = cmd.name + ' ';
          input.focus();
        }
        slashPalette.classList.remove('open');
        slashPaletteOpen = false;
      }

      // Monitor input for slash commands
      input.addEventListener('input', function slashCheck() {
        const val = input.value;
        if (val.startsWith('/') && !val.includes(' ')) {
          renderSlashPalette(val);
        } else {
          slashPalette.classList.remove('open');
          slashPaletteOpen = false;
        }
      });

      // Slash palette keyboard nav (up/down/enter/escape)
      input.addEventListener('keydown', function slashNav(e) {
        if (!slashPaletteOpen) return;
        const items = slashItems.querySelectorAll('.sp-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items[slashSelectedIdx]?.classList.remove('selected');
          slashSelectedIdx = (slashSelectedIdx + 1) % items.length;
          items[slashSelectedIdx]?.classList.add('selected');
          items[slashSelectedIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          items[slashSelectedIdx]?.classList.remove('selected');
          slashSelectedIdx = (slashSelectedIdx - 1 + items.length) % items.length;
          items[slashSelectedIdx]?.classList.add('selected');
          items[slashSelectedIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const selected = items[slashSelectedIdx];
          if (selected) selected.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          slashPalette.classList.remove('open');
          slashPaletteOpen = false;
        }
      });

      // ── Enterprise: Overlay handlers ──
      // Export
      hdrExport.addEventListener('click', () => openOverlay(exportOverlay));
      document.getElementById('export-cancel').addEventListener('click', () => closeOverlay(exportOverlay));
      document.getElementById('export-json').addEventListener('click', () => {
        const data = JSON.stringify({ conversation: currentConversationId, messages, exportedAt: new Date().toISOString() }, null, 2);
        vscode.postMessage({ type: 'enterpriseExport', format: 'json', data });
        closeOverlay(exportOverlay);
      });
      document.getElementById('export-md').addEventListener('click', () => {
        let md = '# MigraPilot Conversation\\n\\n';
        md += 'Exported: ' + new Date().toISOString() + '\\n\\n---\\n\\n';
        messages.forEach(m => {
          md += '## ' + (m.role === 'user' ? 'You' : 'MigraPilot') + '\\n\\n' + m.text + '\\n\\n---\\n\\n';
        });
        vscode.postMessage({ type: 'enterpriseExport', format: 'markdown', data: md });
        closeOverlay(exportOverlay);
      });

      // Feedback
      document.querySelectorAll('.sentiment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.sentiment-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      document.getElementById('feedback-cancel').addEventListener('click', () => closeOverlay(feedbackOverlay));
      document.getElementById('feedback-submit').addEventListener('click', () => {
        const sentiment = document.querySelector('.sentiment-btn.active')?.dataset?.sentiment || 'neutral';
        const text = document.getElementById('feedback-text').value.trim();
        if (feedbackTargetIdx >= 0) {
          messages[feedbackTargetIdx] = messages[feedbackTargetIdx] || {};
          messages[feedbackTargetIdx].feedback = { sentiment, text, at: Date.now() };
          saveState();
        }
        vscode.postMessage({
          type: 'enterpriseFeedback',
          messageIdx: feedbackTargetIdx,
          sentiment,
          text
        });
        closeOverlay(feedbackOverlay);
      });

      // Shortcuts
      hdrShortcuts.addEventListener('click', () => {
        const list = document.getElementById('shortcuts-list');
        list.innerHTML = '';
        KEYBOARD_SHORTCUTS.forEach(s => {
          const row = document.createElement('div');
          row.className = 'shortcut-row';
          row.innerHTML = '<span>' + escapeHtml(s.action) + '</span><kbd>' + escapeHtml(s.keys) + '</kbd>';
          list.appendChild(row);
        });
        openOverlay(shortcutsOverlay);
      });
      document.getElementById('shortcuts-close').addEventListener('click', () => closeOverlay(shortcutsOverlay));

      // Usage
      hdrUsage.addEventListener('click', () => {
        const el = document.getElementById('usage-content');
        el.innerHTML =
          '<div style="margin-bottom:8px;"><strong>Session Usage</strong></div>' +
          '<div>Messages: ' + messages.length + '</div>' +
          '<div>Prompt tokens: ~' + sessionTokens.prompt.toLocaleString() + '</div>' +
          '<div>Completion tokens: ~' + sessionTokens.completion.toLocaleString() + '</div>' +
          '<div>Est. cost: <span style="color:var(--vscode-terminal-ansiGreen)">$' + sessionTokens.cost.toFixed(4) + '</span></div>' +
          '<div style="margin-top:8px;color:var(--vscode-descriptionForeground);">Conversation: ' + (currentConversationId || 'local') + '</div>';
        openOverlay(usageOverlay);
      });
      document.getElementById('usage-close').addEventListener('click', () => closeOverlay(usageOverlay));

      // Search (inline in header)
      hdrSearch.addEventListener('click', () => {
        const q = prompt('Search messages:');
        if (!q) return;
        const lq = q.toLowerCase();
        const results = messages.map((m, i) => ({ ...m, idx: i })).filter(m => m.text.toLowerCase().includes(lq));
        if (results.length === 0) {
          vscode.postMessage({ type: 'info', text: 'No matches for "' + q + '"' });
          return;
        }
        // Scroll to first match and highlight
        const threadMsgs = thread.querySelectorAll('.message');
        results.forEach(r => {
          if (threadMsgs[r.idx]) {
            threadMsgs[r.idx].style.outline = '2px solid var(--vscode-focusBorder)';
            setTimeout(() => { threadMsgs[r.idx].style.outline = 'none'; }, 3000);
          }
        });
        if (threadMsgs[results[0].idx]) threadMsgs[results[0].idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        vscode.postMessage({ type: 'info', text: results.length + ' match(es) found' });
      });

      // Close overlays on clicking backdrop
      [exportOverlay, feedbackOverlay, shortcutsOverlay, usageOverlay].forEach(ov => {
        ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov); });
      });

      // ── Enterprise: Keyboard shortcuts ──
      document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+E: Export
        if (e.ctrlKey && e.shiftKey && e.key === 'E') { e.preventDefault(); openOverlay(exportOverlay); return; }
        // Ctrl+Shift+F: Search
        if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); hdrSearch.click(); return; }
        // Ctrl+/: Shortcuts
        if (e.ctrlKey && e.key === '/') { e.preventDefault(); hdrShortcuts.click(); return; }
        // Ctrl+L: New chat
        if (e.ctrlKey && e.key === 'l') { e.preventDefault(); newChatBtn.click(); return; }
        // Escape: close overlays or stop streaming
        if (e.key === 'Escape') {
          if (exportOverlay.classList.contains('open') || feedbackOverlay.classList.contains('open') ||
              shortcutsOverlay.classList.contains('open') || usageOverlay.classList.contains('open')) {
            closeAllOverlays();
            return;
          }
          if (slashPaletteOpen) { slashPalette.classList.remove('open'); slashPaletteOpen = false; return; }
          if (streaming) { vscode.postMessage({ type: 'stop' }); }
        }
      });

      // ── Auto-resize textarea ───────────
      // Grow with content up to ~45% of the panel height so long pasted text
      // stays reviewable (Copilot-style), then scroll inside the box.
      function autoResizeInput() {
        const maxH = Math.max(120, Math.floor(window.innerHeight * 0.45));
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, maxH) + 'px';
      }
      input.addEventListener('input', autoResizeInput);
      window.addEventListener('resize', autoResizeInput);

      // ── Quick actions ──────────────────
      document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const prompt = btn.getAttribute('data-prompt');
          if (prompt) { input.value = prompt; send(); }
        });
      });

      // ── Send ───────────────────────────
      // Cap inlined text-doc content so a huge file can't blow the model context.
      const MAX_INLINE_CHARS = 60000;

      function send() {
        const text = input.value.trim();
        if (streaming) return;
        if (!text && pendingFiles.length === 0) return;

        const imageFiles = pendingFiles.filter(f => f.kind === 'image');
        const textDocs = pendingFiles.filter(f => f.kind === 'text');
        const binaryDocs = pendingFiles.filter(f => f.kind === 'binary');

        // Inline text-document contents into the prompt so any model can analyze
        // them — no backend/vision dependency for documents.
        let promptForBackend = text;
        for (const doc of textDocs) {
          let body = doc.text || '';
          if (body.length > MAX_INLINE_CHARS) {
            body = body.slice(0, MAX_INLINE_CHARS) + '\\n… [truncated]';
          }
          promptForBackend += '\\n\\n--- Attached file: ' + doc.name + ' ---\\n\`\`\`\\n' + body + '\\n\`\`\`';
        }
        // Images are analyzed by the vision model; binaries can't be read locally.
        for (const b of binaryDocs) {
          promptForBackend += '\\n\\n[Attached (not readable as text): ' + b.name + ']';
        }
        if (!text && imageFiles.length > 0) {
          promptForBackend = 'Analyze the attached image(s).' + promptForBackend;
        }

        // Build the visible user bubble: text plus attachment chips summary.
        const attachSummary = pendingFiles.length
          ? pendingFiles.map(f => (f.kind === 'image' ? '🖼️ ' : '📄 ') + f.name).join('  ')
          : '';
        const visibleText = [text, attachSummary].filter(Boolean).join('\\n');
        addUserMessage(visibleText || attachSummary || text);

        currentAssistantBody = null;
        setStreaming(true);

        // Only images travel as binary attachments (base64 data URLs).
        const fileData = imageFiles.map(f => ({ name: f.name, type: f.type, dataUrl: f.dataUrl }));
        // Picker value is either 'auto', a tier ('cheap'|'default'|'premium'), or a
        // pinned model id ('model:<id>'). A pinned model travels as modelId; a tier
        // travels as provider; auto sends neither (engine decides).
        const pickerValue = modelPicker ? modelPicker.value : 'auto';
        const pinnedModelId = pickerValue.indexOf('model:') === 0 ? pickerValue.slice('model:'.length) : undefined;
        const selectedProvider = pinnedModelId ? 'auto' : pickerValue;
        const history = messages
          .slice(Math.max(0, messages.length - 12), Math.max(0, messages.length - 1))
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
          .map(m => ({ role: m.role, text: m.text }));
        vscode.postMessage({
          type: 'chat',
          text: promptForBackend,
          files: fileData.length > 0 ? fileData : undefined,
          provider: selectedProvider !== 'auto' ? selectedProvider : undefined,
          modelId: pinnedModelId,
          history,
        });
        input.value = '';
        input.style.height = 'auto';
        pendingFiles = [];
        renderFileChips();
      }

      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });

      stopBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'stop' });
      });

      newChatBtn.addEventListener('click', () => {
        thread.innerHTML = '';
        thread.style.display = 'none';
        welcome.style.display = 'flex';
        currentAssistantBody = null;
        currentStreamingRaw = '';
        messages = [];
        pendingFiles = [];
        currentMessageIdx = -1;
        currentConversationId = null;
        sessionTokens = { prompt: 0, completion: 0, cost: 0 };
        convTitle.textContent = 'MigraPilot';
        stopThinkingTimer();
        renderFileChips();
        vscode.setState({ messages: [] });
        vscode.postMessage({ type: 'newChat' });
        statusText.textContent = 'Ready';
      });

      // ── Receive ────────────────────────
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;

        switch (msg.type) {
          case 'models': {
            // Rebuild the model picker from the live engine catalog (real installed
            // models, e.g. Ollama). Keep 'Auto' + size-tier shortcuts, then list the
            // concrete models (approved first) so the user can pin a specific one.
            if (!modelPicker || !Array.isArray(msg.models)) break;
            const prev = modelPicker.value;
            const tierEmoji = { fast: '⚡', balanced: '⚖️', deep: '💎' };
            let html = '<option value="auto">Auto</option>';
            html += '<optgroup label="Auto by size">';
            html += '<option value="cheap">⚡ Fast</option>';
            html += '<option value="default">⚖️ Balanced</option>';
            html += '<option value="premium">💎 Deep</option>';
            html += '</optgroup>';
            const models = msg.models.slice().sort((a, b) => {
              const ap = a.state === 'approved' ? 0 : 1, bp = b.state === 'approved' ? 0 : 1;
              return ap - bp || (b.paramCount || 0) - (a.paramCount || 0);
            });
            if (models.length) {
              html += '<optgroup label="Local models">';
              models.forEach((m) => {
                const emoji = tierEmoji[m.tier] || '•';
                const size = m.paramCount ? ' · ' + m.paramCount + 'B' : '';
                const vis = m.vision ? ' 👁' : '';
                const badge = m.state && m.state !== 'approved' ? ' (' + m.state + ')' : '';
                html += '<option value="model:' + escapeHtml(m.id) + '">' + emoji + ' ' + escapeHtml(m.id) + size + vis + badge + '</option>';
              });
              html += '</optgroup>';
            }
            modelPicker.innerHTML = html;
            const keep = Array.prototype.some.call(modelPicker.options, (o) => o.value === prev);
            modelPicker.value = keep ? prev : 'auto';
            break;
          }
          case 'statusUpdate':
            if (typeof msg.text === 'string' && msg.text.trim()) {
              statusText.textContent = msg.text;
            }
            break;
          case 'streamStart':
            startAssistantMessage();
            statusText.textContent = 'Thinking…';
            if (msg.conversationId) currentConversationId = msg.conversationId;
            break;
          case 'token':
            if (!currentAssistantBody) startAssistantMessage();
            currentStreamingRaw += msg.text;
            // Render markdown progressively + cursor
            currentAssistantBody.innerHTML = renderMarkdown(currentStreamingRaw) + '<span class="streaming-cursor"></span>';
            scrollToBottom();
            // Hide thinking timer once tokens start flowing
            statusText.textContent = 'Streaming…';
            stopThinkingTimer();
            break;
          case 'tool':
            if (msg.data?.toolName) {
              statusText.textContent = 'Running ' + msg.data.toolName + '…';
            }
            addToolCall(msg.data || {});
            break;
          case 'error':
            addError(msg.text || 'Unknown error');
            // Don't call setStreaming(false) — stream may continue after provider escalation
            // setStreaming(false) will be called by 'streamEnd' event
            break;
          case 'streamEnd':
            setStreaming(false);
            if (msg.stopped && currentAssistantBody) {
              currentStreamingRaw += ' [stopped]';
            }
            const finalText = currentStreamingRaw;
            // Final render without cursor
            if (currentAssistantBody && finalText) {
              const last = messages[messages.length - 1];
              const isDuplicateAssistant =
                last &&
                last.role === 'assistant' &&
                normalizeAssistantText(last.text) === normalizeAssistantText(finalText);

              if (isDuplicateAssistant) {
                // Drop duplicate UI bubble if backend/frontend accidentally delivers
                // the same assistant response twice in one turn.
                currentAssistantBody.parentElement?.remove();
              } else {
                currentAssistantBody.innerHTML = renderMarkdown(finalText);
                messages.push({ role: 'assistant', text: finalText });
                saveState();
                // Use real usage data from server if available, otherwise estimate
                if (msg.usage) {
                  sessionTokens.prompt += msg.usage.inputTokens || 0;
                  sessionTokens.completion += msg.usage.outputTokens || 0;
                  sessionTokens.cost = msg.usage.costEstimate || 0;
                  // Show per-message cost badge
                  const badge = document.createElement('div');
                  badge.className = 'cost-badge';
                  const provider = msg.usage.provider || 'local';
                  const costStr = msg.usage.costEstimate > 0 ? '$' + msg.usage.costEstimate.toFixed(6) : 'free';
                  const providerColors = { local: '#4ec9b0', haiku: '#569cd6', sonnet: '#ce9178', opus: '#c586c0' };
                  const providerColor = providerColors[provider] || '#888';
                  badge.innerHTML = '<span style="color:' + providerColor + '">' + provider + '</span> · <span class="cost-usd">' + costStr + '</span> · ' + (msg.usage.inputTokens + msg.usage.outputTokens) + ' tok';
                  currentAssistantBody.parentElement?.appendChild(badge);
                } else {
                  // Fallback: estimate
                  const promptChars = messages.filter(m => m.role === 'user').reduce((s, m) => s + m.text.length, 0);
                  const completionChars = finalText.length;
                  sessionTokens.prompt += Math.ceil(promptChars / 4);
                  sessionTokens.completion += Math.ceil(completionChars / 4);
                  sessionTokens.cost = (sessionTokens.prompt * 0.000003) + (sessionTokens.completion * 0.000015);
                }
              }
            }
            // Guard against duplicate streamEnd events for the same response.
            currentStreamingRaw = '';
            // Auto-title: after first assistant response, set conversation title
            if (messages.length <= 3 && messages.length >= 2) {
              const firstUser = messages.find(m => m.role === 'user');
              if (firstUser) {
                const title = firstUser.text.length > 50 ? firstUser.text.slice(0, 50) + '…' : firstUser.text;
                convTitle.textContent = title;
              }
            }
            break;
          case 'restore': {
            messages = msg.messages || [];
            if (msg.conversationId) currentConversationId = msg.conversationId;
            if (messages.length > 0) {
              welcome.style.display = 'none';
              thread.style.display = 'block';
              thread.innerHTML = '';
              messages.forEach((m, i) => {
                if (m.role === 'user') {
                  addUserMessage(m.text, true);
                } else if (m.role === 'assistant') {
                  const body = startAssistantMessage();
                  body.innerHTML = renderMarkdown(m.text);
                }
                // Restore reactions
                if (m.reactions) renderReactions(i);
              });
              scrollToBottom();
              // Restore title
              const firstUser = messages.find(m => m.role === 'user');
              if (firstUser) {
                const title = firstUser.text.length > 50 ? firstUser.text.slice(0, 50) + '…' : firstUser.text;
                convTitle.textContent = title;
              }
            }
            break;
          }
          case 'enterpriseResult': {
            // Generic enterprise action result handler
            if (msg.action === 'exported') {
              vscode.postMessage({ type: 'info', text: 'Conversation exported' });
            }
            break;
          }
          case 'transcribeResult': {
            setMicState('idle');
            statusText.textContent = 'Ready';
            const t = (msg.text || '').trim();
            if (t) {
              input.value = input.value ? (input.value.replace(/\\s*$/, '') + ' ' + t) : t;
              autoResizeInput();
              input.focus();
            } else {
              vscode.postMessage({ type: 'info', text: 'No speech detected.' });
            }
            break;
          }
          case 'transcribeError': {
            setMicState('idle');
            statusText.textContent = 'Ready';
            vscode.postMessage({ type: 'info', text: msg.text || 'Transcription failed.' });
            break;
          }
          case 'injectMessage': {
            // Injected from extension commands (e.g. sendTerminalToChat, @workspace)
            if (msg.text) {
              input.value = msg.text;
              send();
            }
            break;
          }
        }
      });

      // On load: restore state
      const savedState = vscode.getState();
      if (savedState?.messages?.length) {
        messages = savedState.messages;
        welcome.style.display = 'none';
        thread.style.display = 'block';
        messages.forEach(m => {
          if (m.role === 'user') {
            addUserMessage(m.text, true);
          } else if (m.role === 'assistant') {
            const body = startAssistantMessage();
            body.innerHTML = renderMarkdown(m.text);
          }
        });
        scrollToBottom();
      }
      vscode.postMessage({ type: 'ready' });
      input.focus();
    </script>
  </body>
</html>`;

    // Attachments are fully wired end-to-end (images → vision model, text docs →
    // inlined into the prompt) and the model picker maps to backend profiles, so
    // the whole input toolbar is live.
    return html;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 24; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
