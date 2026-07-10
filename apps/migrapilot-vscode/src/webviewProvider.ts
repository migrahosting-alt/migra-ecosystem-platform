import * as vscode from "vscode";
import type { WebviewMessage } from "./types";

export class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "migrapilot.chatView";

  private webviewView?: vscode.WebviewView;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.command === "localPrompt" && message.prompt) {
        this.postMessage({
          command: "appendMessage",
          prompt: message.prompt,
        });
      }
    });
  }

  public showView(): void {
    vscode.commands.executeCommand("migrapilot.chatView.focus");
  }

  public postMessage(message: WebviewMessage | Record<string, unknown>): void {
    this.webviewView?.webview.postMessage(message);
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
        <p class="subtitle">Your autonomous coding, debugging, deployment, and infrastructure co-pilot for the MigraTeck ecosystem.</p>
      </div>
      <span class="badge">Read-only MVP</span>
    </header>

    <section class="warning">
      Read-only MVP — no file writes, no commands, no deploys.
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
      <div class="kv"><span>Agent mode</span><strong>Planning only in Phase 1</strong></div>
      <div class="kv"><span>Voice</span><strong>Transcript review will be required before future execution</strong></div>
      <div class="kv"><span>Command Center</span><strong>Operations are locked in Phase 1</strong></div>
    </section>

    <section class="card">
      <h2>Workspace Context</h2>
      <div class="kv"><span>Workspace</span><strong id="workspaceName">Unknown</strong></div>
      <div class="kv"><span>Active file</span><strong id="activeFilePath">No active file</strong></div>
      <div class="kv"><span>Language</span><strong id="languageId">Unknown</strong></div>
      <div class="kv"><span>Selection</span><strong id="selectionStatus">No selection</strong></div>
    </section>

    <section class="card">
      <h2>Project Health</h2>
      <p class="muted">Placeholder only. No scans, commands, network calls, or production checks run in Phase 1.</p>
    </section>

    <section class="card">
      <h2>Agent Capabilities</h2>
      <ul>
        <li>Explain code and architecture</li>
        <li>Draft test plans</li>
        <li>Draft patch plans</li>
        <li>Prepare deployment plans for review</li>
        <li>Summarize local context</li>
      </ul>
    </section>

    <section class="card">
      <h2>Suggested Actions</h2>
      <div class="actions">
        <button data-prompt="Explain this file using only local editor metadata.">Explain this file</button>
        <button data-prompt="Review the selected code using metadata only. Do not execute anything.">Review selected code</button>
        <button data-prompt="Find possible issues from the current context. Draft only.">Find possible issues</button>
        <button data-prompt="Draft tests for this area. Do not write files.">Draft tests</button>
        <button data-prompt="Draft a patch plan. Do not edit files.">Draft patch plan</button>
        <button data-prompt="Prepare a deployment plan for review. Do not deploy.">Prepare deployment plan</button>
        <button data-prompt="Search project context placeholder. No backend calls in Phase 1.">Search project context</button>
        <button data-prompt="Summarize terminal error placeholder. User must paste errors manually.">Summarize terminal error</button>
      </div>
    </section>

    <section class="card chat">
      <h2>Chat Transcript</h2>
      <div id="transcript" class="transcript">
        <div class="message assistant">MigraPilot is online in read-only MVP mode.</div>
      </div>
      <div class="composer">
        <input id="promptInput" type="text" placeholder="Ask MigraPilot..." />
        <button id="sendButton">Send</button>
      </div>
      <div class="voice">🎙 Voice input placeholder — disabled in Phase 1.</div>
    </section>

    <footer>Powered by MigraPilot on MigraHosting Support</footer>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function appendMessage(role, text) {
      const transcript = document.getElementById("transcript");
      const node = document.createElement("div");
      node.className = "message " + role;
      node.textContent = text;
      transcript.appendChild(node);
      transcript.scrollTop = transcript.scrollHeight;
    }

    function updateContext(context) {
      if (!context) return;
      document.getElementById("workspaceName").textContent = context.workspaceName || "Unknown";
      document.getElementById("activeFilePath").textContent = context.activeFilePath || "No active file";
      document.getElementById("languageId").textContent = context.languageId || "Unknown";
      document.getElementById("selectionStatus").textContent = context.hasSelection
        ? "Selected lines: " + context.selectionLineCount
        : "No selection";
    }

    document.querySelectorAll("[data-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        appendMessage("user", button.dataset.prompt);
      });
    });

    document.getElementById("sendButton").addEventListener("click", () => {
      const input = document.getElementById("promptInput");
      const value = input.value.trim();
      if (!value) return;
      appendMessage("user", value);
      input.value = "";
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.command === "showCurrentContext" || message.command === "contextUpdate") {
        updateContext(message.context);
      }
      if (message.command === "appendPrompt" && message.prompt) {
        appendMessage("user", message.prompt);
      }
      if (message.command === "appendMessage" && message.prompt) {
        appendMessage("assistant", message.prompt);
      }
    });
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
