import * as vscode from "vscode";
import type { DraftPatchPlan, WebviewMessage } from "./types";

export class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "migrapilot.chatView";

  private webviewView?: vscode.WebviewView;
  private webviewReady = false;
  private readonly pendingMessages: Array<WebviewMessage | Record<string, unknown>> = [];

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.webviewView = undefined;
      this.webviewReady = false;
    });

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      // The webview signals readiness once its message listener is attached.
      // Anything queued before this point would otherwise be dropped.
      if (message.command === "ready") {
        this.webviewReady = true;
        this.flushPendingMessages();
        return;
      }

      if (message.command === "localPrompt" && message.prompt) {
        const patchPlan = message.prompt.toLowerCase().includes("patch plan")
          ? undefined
          : undefined;

        this.postMessage({
          command: "appendMessage",
          prompt: message.prompt,
          patchPlan,
        });
      }
    });
  }

  public async showView(): Promise<void> {
    await vscode.commands.executeCommand("migrapilot.chatView.focus");
  }

  public postCapturedContext(context: import("./types").WorkspaceContext): void {
    this.postMessage({
      command: "contextUpdate",
      context,
    });
  }

  public postMessage(message: WebviewMessage | Record<string, unknown>): void {
    if (this.webviewView && this.webviewReady) {
      this.webviewView.webview.postMessage(message);
      return;
    }

    this.pendingMessages.push(message);
  }

  private flushPendingMessages(): void {
    if (!this.webviewView || !this.webviewReady) {
      return;
    }

    for (const message of this.pendingMessages.splice(0)) {
      this.webviewView.webview.postMessage(message);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "main.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>MigraPilot AI Engineer</title>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">MigraPilot</p>
        <h1>AI Engineer</h1>
        <p class="subtitle">Local read-only context and draft patch planning for the MigraTeck ecosystem.</p>
      </div>
      <span class="badge">Read-only MVP</span>
    </header>

    <section class="warning">
      Read-only MVP — no file writes, no commands, no deploys, no backend calls. Patch planning is draft-only.
    </section>

    <section class="mode-grid">
      <button class="mode active" data-mode="ask">Ask</button>
      <button class="mode" data-mode="agent">Agent</button>
      <button class="mode" data-mode="voice">Voice</button>
      <button class="mode" data-mode="command">Command</button>
    </section>

    <section class="card">
      <h2>Status</h2>
      <div class="kv"><span>MigraPilot</span><strong>Read-only</strong></div>
      <div class="kv"><span>Action level</span><strong>Level 0</strong></div>
      <div class="kv"><span>Agent mode</span><strong>Draft patch planning only in Phase 3</strong></div>
      <div class="kv"><span>Apply patch</span><strong>Locked until a future approved phase</strong></div>
      <div class="kv"><span>Command Center</span><strong>Operations are locked in Phase 3</strong></div>
    </section>

    <section class="card">
      <h2>Workspace Context</h2>
      <div class="kv"><span>Workspace</span><strong id="workspaceName">Unknown</strong></div>
      <div class="kv"><span>Active file</span><strong id="activeFilePath">No active file</strong></div>
      <div class="kv"><span>Relative path</span><strong id="relativeFilePath">No active file</strong></div>
      <div class="kv"><span>Language</span><strong id="languageId">Unknown</strong></div>
      <div class="kv"><span>File size</span><strong id="fileSize">0 bytes</strong></div>
      <div class="kv"><span>File lines</span><strong id="fileLines">0</strong></div>
      <div class="kv"><span>Selection</span><strong id="selectionStatus">No selection</strong></div>
      <div class="kv"><span>Context warning</span><strong id="contextWarning">None</strong></div>
    </section>

    <section class="card">
      <h2>Draft Patch Plan</h2>
      <div id="patchPlan" class="patch-plan empty">
        No patch plan yet. Click “Draft patch plan” or run “MigraPilot: Start Agent Task”.
      </div>
      <button class="locked" disabled>Apply patch locked</button>
    </section>

    <section class="card">
      <h2>Local File Preview</h2>
      <pre id="filePreview" class="preview">Open a file to show local read-only preview.</pre>
    </section>

    <section class="card">
      <h2>Selected Text Preview</h2>
      <pre id="selectionPreview" class="preview">Select text to show local read-only preview.</pre>
    </section>

    <section class="card">
      <h2>Suggested Actions</h2>
      <div class="actions">
        <button data-prompt="Explain this file using the local read-only file preview.">Explain this file</button>
        <button data-prompt="Review the selected code using the local read-only selection preview.">Review selected code</button>
        <button data-prompt="Find possible issues from local context. Draft only.">Find possible issues</button>
        <button data-prompt="Draft tests for this area. Do not write files.">Draft tests</button>
        <button data-prompt="Draft patch plan from local context. Do not edit files.">Draft patch plan</button>
        <button data-prompt="Prepare a deployment plan for review. Do not deploy.">Prepare deployment plan</button>
        <button data-prompt="Search project context placeholder. No backend calls in Phase 3.">Search project context</button>
        <button data-prompt="Summarize terminal error placeholder. User must paste errors manually.">Summarize terminal error</button>
      </div>
    </section>

    <section class="card chat">
      <h2>Chat Transcript</h2>
      <div id="transcript" class="transcript">
        <div class="message assistant">MigraPilot is online in read-only draft patch planning mode.</div>
      </div>
      <div class="composer">
        <input id="promptInput" type="text" placeholder="Ask MigraPilot..." />
        <button id="sendButton">Send</button>
      </div>
      <div class="voice">🎙 Voice input placeholder — disabled in Phase 3.</div>
    </section>

    <footer>Powered by MigraPilot on MigraHosting Support</footer>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentContext = null;

    function appendMessage(role, text) {
      const transcript = document.getElementById("transcript");
      const node = document.createElement("div");
      node.className = "message " + role;
      node.textContent = text;
      transcript.appendChild(node);
      transcript.scrollTop = transcript.scrollHeight;
    }

    function formatBytes(bytes) {
      if (!bytes) return "0 bytes";
      if (bytes < 1024) return bytes + " bytes";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function updateContext(context) {
      if (!context) return;
      currentContext = context;
      document.getElementById("workspaceName").textContent = context.workspaceName || "Unknown";
      document.getElementById("activeFilePath").textContent = context.activeFilePath || "No active file";
      document.getElementById("relativeFilePath").textContent = context.relativeFilePath || "No active file";
      document.getElementById("languageId").textContent = context.languageId || "Unknown";
      document.getElementById("fileSize").textContent = formatBytes(context.fileSizeBytes || 0);
      document.getElementById("fileLines").textContent = String(context.fileLineCount || 0);
      document.getElementById("selectionStatus").textContent = context.hasSelection
        ? "Selected lines: " + context.selectionLineCount + " / chars: " + context.selectedTextLength
        : "No selection";
      document.getElementById("contextWarning").textContent = context.warning || "None";
      document.getElementById("filePreview").textContent = context.filePreview || "Open a file to show local read-only preview.";
      document.getElementById("selectionPreview").textContent = context.selectedTextPreview || "Select text to show local read-only preview.";
    }

    function renderPatchPlan(plan) {
      const container = document.getElementById("patchPlan");
      if (!plan) return;
      container.className = "patch-plan";
      container.innerHTML = [
        "<h3>" + escapeHtml(plan.title) + "</h3>",
        "<p><strong>Problem summary:</strong> " + escapeHtml(plan.problemSummary) + "</p>",
        "<p><strong>Target scope:</strong> " + escapeHtml(plan.targetScope) + "</p>",
        "<p><strong>Risk level:</strong> " + escapeHtml(plan.riskLevel) + "</p>",
        listBlock("Files likely involved", plan.filesLikelyInvolved),
        listBlock("Proposed changes", plan.proposedChanges),
        listBlock("Manual verification commands", plan.manualVerificationCommands),
        listBlock("Rollback notes", plan.rollbackNotes),
        "<p><strong>Safety boundary:</strong> " + escapeHtml(plan.safetyBoundary) + "</p>"
      ].join("");
    }

    function listBlock(title, items) {
      return "<div><strong>" + escapeHtml(title) + ":</strong><ul>" +
        (items || []).map((item) => "<li>" + escapeHtml(item) + "</li>").join("") +
        "</ul></div>";
    }

    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function makeLocalPlan(prompt) {
      const path = currentContext?.relativeFilePath || currentContext?.activeFilePath || "No active file";
      return {
        title: "Draft Patch Plan",
        problemSummary: prompt + " Target file: " + path + ".",
        targetScope: (currentContext?.hasSelection ? "selected code in " : "current file ") + path,
        filesLikelyInvolved: [path],
        proposedChanges: [
          "Inspect the local context shown in MigraPilot.",
          "Identify the smallest safe change.",
          "List verification steps for the operator.",
          "Do not apply edits automatically."
        ],
        riskLevel: path.includes("route.ts") ? "high" : "low",
        manualVerificationCommands: ["npm run compile", "run project-specific tests manually"],
        rollbackNotes: ["No automatic changes were made.", "Use git diff/revert if a future manual patch is applied."],
        safetyBoundary: "Draft only. No file writes, no command execution, no shell access, no backend calls, no deploys."
      };
    }

    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.prompt;
        appendMessage("user", prompt);
        if (prompt.toLowerCase().includes("patch plan")) {
          renderPatchPlan(makeLocalPlan(prompt));
        }
      });
    });

    document.getElementById("sendButton").addEventListener("click", () => {
      const input = document.getElementById("promptInput");
      const value = input.value.trim();
      if (!value) return;
      appendMessage("user", value);
      if (value.toLowerCase().includes("patch")) {
        renderPatchPlan(makeLocalPlan(value));
      }
      input.value = "";
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.command === "showCurrentContext" || message.command === "contextUpdate") {
        updateContext(message.context);
      }
      if (message.command === "appendPrompt" && message.prompt) {
        appendMessage("user", message.prompt);
        updateContext(message.context);
        if (message.patchPlan) {
          renderPatchPlan(message.patchPlan);
        }
      }
      if (message.command === "appendMessage" && message.prompt) {
        appendMessage("assistant", message.prompt);
        if (message.patchPlan) {
          renderPatchPlan(message.patchPlan);
        }
      }
    });

    vscode.postMessage({ command: "ready" });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
