import * as vscode from "vscode";

import {
  BrainClient,
  getAuthorizationHeader,
  getBrainClientConfig,
  isBrainConnectionError,
  isLocalBrainUrl,
  probeBrainHealth,
} from "./brainClient.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "migrapilot.chatView";
  private view?: vscode.WebviewView;
  private conversationId: string | undefined;
  private abortController: AbortController | undefined;
  private _chatInFlight = false;
  private _savedMessages: Array<{role: string; text: string}> = [];
  private _savedConversationId: string | undefined;

  constructor(private readonly extensionUri: vscode.Uri, private readonly output: vscode.OutputChannel) {
    this.extensionUri = extensionUri;
  }

  private async localWorkspaceSearch(query: string, maxResults = 20): Promise<any[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return [];
    }

    const cp = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFile = promisify(cp.execFile);

    try {
      const { stdout } = await execFile(
        "rg",
        [
          "-uu",
          "--line-number",
          "--with-filename",
          "--color",
          "never",
          "--max-count",
          String(maxResults),
          query,
          ".",
        ],
        {
          cwd: workspaceRoot,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        }
      );

      return stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, maxResults)
        .map((line) => {
          const match = line.match(/^(.*?):(\d+):(.*)$/);
          if (!match) {
            return undefined;
          }

          const [, file, lineNumber, text] = match;
          return {
            file,
            path: file,
            line: Number(lineNumber),
            text: text.trim(),
            content: text.trim(),
          };
        })
        .filter((item): item is { file: string; path: string; line: number; text: string; content: string } => Boolean(item));
    } catch (error: any) {
      if (error?.code === 1 || error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async localWorkspacePathSearch(query: string, maxResults = 20): Promise<any[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return [];
    }

    const cp = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFile = promisify(cp.execFile);

    try {
      const { stdout } = await execFile(
        "rg",
        ["--files", "-uu", "."],
        {
          cwd: workspaceRoot,
          timeout: 10_000,
          maxBuffer: 4 * 1024 * 1024,
        }
      );

      const variants = this.deriveWorkspaceQueries(query).map((item) => item.toLowerCase());
      const tokens = variants
        .flatMap((item) => item.split(/[^a-z0-9_-]+/))
        .filter((item) => item.length >= 3);

      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(/^\.\//, ""))
        .filter((path) => {
          const lower = path.toLowerCase();
          return variants.some((variant) => lower.includes(variant)) || tokens.some((token) => lower.includes(token));
        })
        .slice(0, maxResults)
        .map((path) => ({
          file: path,
          path,
          line: undefined,
          text: "[path match]",
          content: "[path match]",
        }));
    } catch (error: any) {
      if (error?.code === 1 || error?.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async postAssistantMessage(webviewView: vscode.WebviewView, text: string): Promise<void> {
    webviewView.webview.postMessage({ type: "streamStart", conversationId: this.conversationId || undefined });
    for (let i = 0; i < text.length; i += 280) {
      webviewView.webview.postMessage({ type: "token", text: text.slice(i, i + 280) });
    }
    webviewView.webview.postMessage({ type: "streamEnd", degraded: true });
  }

  private async buildLocalFallbackResponse(userMessage: string): Promise<string> {
    const config = getBrainClientConfig();
    const health = await probeBrainHealth(config, 2500);
    const diagnostics = vscode.languages.getDiagnostics();
    const errorCount = diagnostics.reduce((count, [, items]) => count + items.filter((item) => item.severity === vscode.DiagnosticSeverity.Error).length, 0);
    const warningCount = diagnostics.reduce((count, [, items]) => count + items.filter((item) => item.severity === vscode.DiagnosticSeverity.Warning).length, 0);
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name);
    const lower = userMessage.toLowerCase();

    if (/\b(check|system)\s+health\b|\bhealth\b|\bstatus\b/.test(lower)) {
      return [
        "MigraPilot is in degraded mode because the local backend is unavailable.",
        "",
        `Backend: ${health.url || config.baseUrl}`,
        `State: ${health.state}`,
        `Detail: ${health.detail}`,
        `Workspace roots: ${workspaceRoots.join(", ") || "none"}`,
        `Open diagnostics: ${errorCount} errors, ${warningCount} warnings`,
        `Active file: ${activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri, false) : "none"}`,
        "",
        "Available while offline:",
        "- local workspace search through @workspace",
        "- diagnostics summary from the Problems panel",
        "- file/path grounding from the current workspace",
        "",
        "Run MigraPilot: Repair Connection to start or reconnect pilot-api.",
      ].join("\n");
    }

    if (/what.*missing|missing|why.*offline|why.*down/.test(lower)) {
      return [
        "What MigraPilot is missing right now is the reachable local brain service.",
        "",
        `Expected backend: ${health.url || config.baseUrl}`,
        `Current state: ${health.state}`,
        `Detail: ${health.detail}`,
        "",
        "To restore full copilot behavior:",
        "- start the workspace task Start Pilot API, or",
        "- run MigraPilot: Repair Connection, or",
        "- update migrapilot.brainUrl if this workspace should target a different service.",
      ].join("\n");
    }

    return [
      "MigraPilot is in degraded mode because pilot-api is unreachable.",
      "",
      health.detail,
      "",
      "I can still help with local workspace search and diagnostics, but full chat, tool orchestration, and remote reasoning need the backend connection restored.",
      "Run MigraPilot: Repair Connection or update migrapilot.brainUrl.",
    ].join("\n");
  }

  private isLikelyWorkspaceLookup(text: string): boolean {
    const raw = text.trim();
    const q = text.trim().toLowerCase();
    if (!q || q.startsWith("@workspace") || q.startsWith("/")) return false;

    const properNameStopWords = new Set(["about", "again", "all", "any", "app", "are", "assess", "at", "audit", "build", "can", "check", "community", "deep", "did", "do", "due", "explore", "find", "folder", "fucking", "inspect", "open", "project", "repo", "repository", "review", "service", "show", "software", "something", "system", "target", "tell", "there", "what", "work", "you"]);

    const locationIntent = /\b(where|find|locate|which|path|file|folder|directory|show me)\b/.test(q);
    const codeTarget = /\b(marketing|website|web|frontend|backend|api|panel|migrapanel|landing|service|app|repo|codebase|project|folder|software|system)\b/.test(q);
    const projectContinuationIntent = /\b(access|continue|build|building|review|assess|audit|explore|inspect|check|see|work on|what needs? to be done)\b/.test(q);
    const properNameTarget = /\b(?:[A-Z][a-z][A-Za-z0-9_-]{2,}|(?=.*[A-Z])(?=.*[a-z])[A-Za-z][A-Za-z0-9_-]{3,})\b/.test(raw)
      || [...raw.matchAll(/\b[A-Z][A-Z0-9_-]{3,}\b/g)].some((match) => !properNameStopWords.has(match[0].toLowerCase()));
    const shortNaturalQuery = q.length <= 140 && !/[{}<>]/.test(q);

    return shortNaturalQuery && (locationIntent || codeTarget || (projectContinuationIntent && properNameTarget));
  }

  private isContextualWorkspaceContinuationMessage(text: string): boolean {
    const q = text.trim().toLowerCase();
    if (!q) return false;
    return /\b(access|open|continue|software|system|folder|codebase|repo|repository|project|app|service|module|path|directory|location)\b/.test(q);
  }

  private isWorkspaceExecutionFollowUpMessage(text: string): boolean {
    const q = text.trim().toLowerCase();
    if (!q) return false;

    const explicitTargetStopWords = new Set(["about", "again", "all", "any", "app", "are", "assess", "at", "audit", "build", "can", "check", "community", "deep", "did", "do", "due", "explore", "find", "folder", "fucking", "inspect", "module", "open", "project", "repo", "repository", "review", "service", "show", "software", "something", "system", "target", "tell", "there", "what", "work", "you"]);
    const executionIntent = /(\bbuild\b|\bbuilding\b|\bfix\b|\bimplement\b|\bupgrade\b|\bimprove\b|\bharden\b|\bscaffold\b|\bcreate\b|\bmake\b|\bfinish\b|\bcomplete\b|\bship\b|\bdevelop\b|\bcode\b|\bpatch\b|\brefactor\b|\baudit\b|\breview\b|\bassess\b|\binspect\b|\bexplore\b|\bcheck\b|\bwork on\b|\bwhat\s+needs?\s+to\s+be\s+done\b)/.test(q);
    const explicitTarget = /\b(?:[A-Z][a-z][A-Za-z0-9_-]{2,}|(?=.*[A-Z])(?=.*[a-z])[A-Za-z][A-Za-z0-9_-]{3,})\b/.test(text)
      || [...text.matchAll(/\b[A-Z][A-Z0-9_-]{3,}\b/g)].some((match) => !explicitTargetStopWords.has(match[0].toLowerCase()))
      || /\b(?:access|open|folder|software|system|project|repo|repository|app|service|module|for|build(?:ing)?|continue(?:\s+building)?|check|review|assess|audit|explore|inspect)\s+([A-Za-z][A-Za-z0-9_-]{3,})\b/i.test(text);

    return executionIntent && !explicitTarget;
  }

  private isRetryLikeWorkspaceMessage(text: string): boolean {
    const q = text.trim().toLowerCase();
    if (!q) return false;
    return /^(try again|again|retry|recheck|check again|check for it|look again|search again|look for it|do it again|try it again)$/i.test(q);
  }

  private deriveRetryWorkspaceQuery(
    text: string,
    history?: Array<{ role: "user" | "assistant"; text: string }>,
  ): string | undefined {
    if (
      !history?.length
      || (
        !this.isRetryLikeWorkspaceMessage(text)
        && !this.isContextualWorkspaceContinuationMessage(text)
        && !this.isWorkspaceExecutionFollowUpMessage(text)
      )
    ) {
      return undefined;
    }

    const stop = new Set(["what", "workspace", "search", "results", "active", "directory", "current", "project", "path", "repository", "location", "should", "does", "files", "folder"]);
    const recent = [...history].reverse().slice(0, 10);

    for (const item of recent) {
      const quoted = [...item.text.matchAll(/"([^"]{3,})"/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
      for (const candidate of quoted) {
        const queries = this.deriveWorkspaceQueries(candidate).filter((part) => !stop.has(part.toLowerCase()));
        if (queries.length > 0) return queries[0];
      }

      const direct = this.deriveWorkspaceQueries(item.text).filter((part) => !stop.has(part.toLowerCase()));
      if (direct.length > 0) return direct[0];
    }

    return undefined;
  }

  private formatWorkspaceMatches(matches: any[]): string {
    return matches.slice(0, 12).map((m: any, i: number) => {
      const file = m.file || m.path || "unknown";
      const line = m.line || m.lineNumber || "";
      const content = m.text || m.content || "";
      return `[${i + 1}] ${file}${line ? `:${line}` : ""}\n${content}`;
    }).join("\n\n");
  }

  private inferWorkspaceRootPaths(matches: any[], query: string, limit = 3): string[] {
    const variants = this.deriveWorkspaceQueries(query).map((item) => item.toLowerCase()).filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      const rawPath = String(match?.file || match?.path || "").replace(/^\.\//, "");
      if (!rawPath) continue;
      const segments = rawPath.split("/").filter(Boolean);
      if (segments.length === 0) continue;

      let matchedIndex = -1;
      for (let i = 0; i < segments.length; i += 1) {
        const lower = segments[i].toLowerCase();
        if (variants.some((variant) => lower.includes(variant))) {
          matchedIndex = i;
          break;
        }
      }

      const root = matchedIndex >= 0
        ? segments.slice(0, matchedIndex + 1).join("/")
        : segments.length >= 2
          ? segments.slice(0, 2).join("/")
          : segments[0];

      if (!root || seen.has(root)) continue;
      seen.add(root);
      out.push(root);
      if (out.length >= limit) break;
    }

    return out;
  }

  private buildDeterministicFoundReply(query: string, matches: any[]): string {
    const roots = this.inferWorkspaceRootPaths(matches, query, 3);
    if (roots.length === 0) {
      return `I found verified matches for ${query}, but I could not reduce them to a single project root yet.`;
    }
    return roots.length === 1
      ? `I found the likely project path: ${roots[0]}`
      : `I found likely project paths:\n${roots.join("\n")}`;
  }

  private scoreWorkspaceMatch(match: any, query: string): number {
    const file = String(match?.file || match?.path || "").toLowerCase();
    const content = String(match?.text || match?.content || "").toLowerCase();
    const q = query.toLowerCase();
    const tokens = q.split(/[^a-z0-9_-]+/).filter((t) => t.length >= 3);

    let score = 0;

    if (/\b(apps|services|src\/app|src\/pages|web|frontend|landing)\b/.test(file)) score += 30;
    if (/\b(next\.config|vite\.config|nuxt\.config|astro\.config|package\.json)\b/.test(file)) score += 14;
    if (/\.(tsx|jsx|ts|js|html|css|scss|md)$/.test(file)) score += 12;
    if (/\b(page|layout|index|home|landing)\b/.test(file)) score += 10;

    if (q && file.includes(q)) score += 24;
    if (q && content.includes(q)) score += 12;

    for (const token of tokens) {
      if (file.includes(token)) score += 7;
      if (content.includes(token)) score += 3;
    }

    if (/\b(node_modules|dist|build|\.next|coverage|tmp|temp)\b/.test(file)) score -= 20;

    return score;
  }

  private prioritizeWorkspaceMatches(matches: any[], query: string): any[] {
    return [...matches]
      .map((m, idx) => ({ m, idx, score: this.scoreWorkspaceMatch(m, query) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.idx - b.idx;
      })
      .map(({ m }) => m);
  }

  private deriveWorkspaceQueries(rawQuery: string): string[] {
    const query = rawQuery.trim().replace(/\s+/g, " ");
    if (!query) return [];

    const out: string[] = [query];
    const seen = new Set<string>([query.toLowerCase()]);
    const extractedTargetStopWords = new Set([
      "the",
      "a",
      "an",
      "app",
      "project",
      "repo",
      "repository",
      "component",
      "feature",
      "workspace",
      "build",
      "building",
      "can",
      "continue",
      "check",
      "deep",
      "did",
      "do",
      "due",
      "review",
      "assess",
      "audit",
      "explore",
      "inspect",
      "software",
      "system",
      "folder",
      "access",
      "open",
      "again",
      "all",
      "any",
      "at",
      "community",
      "find",
      "fucking",
      "this",
      "that",
      "there",
      "tell",
      "with",
      "way",
      "done",
      "need",
      "needs",
      "now",
      "one",
      "please",
      "show",
      "something",
      "target",
      "what",
      "work",
      "you",
    ]);
    const push = (candidate: string): void => {
      const normalized = candidate.trim().replace(/\s+/g, " ");
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(normalized);
    };
    const pushNamedTarget = (candidate: string): void => {
      if (!candidate) return;
      if (extractedTargetStopWords.has(candidate.trim().toLowerCase())) return;
      push(candidate);
    };

    const noArticle = query.replace(/\b(the|a|an)\b/gi, "").replace(/\s+/g, " ").trim();
    push(noArticle);

    const buildTargetMatch = query.match(/\b(?:continue(?:\s+building)?|build(?:ing)?|check|review|assess|audit|explore|inspect|for|app|project|repo|repository|component|feature)\s+([A-Za-z][A-Za-z0-9_-]{3,})\b/i);
    if (buildTargetMatch) {
      pushNamedTarget(buildTargetMatch[1]);
    }

    const accessTargetMatch = query.match(/\b(?:access|open|folder|software|system)\s+([A-Za-z][A-Za-z0-9_-]{3,})\b/i);
    if (accessTargetMatch) {
      pushNamedTarget(accessTargetMatch[1]);
    }

    for (const match of query.matchAll(/\b[A-Z][a-z][A-Za-z0-9_-]{2,}\b/g)) {
      pushNamedTarget(match[0]);
    }

    for (const match of query.matchAll(/\b[A-Z][A-Z0-9_-]{3,}\b/g)) {
      pushNamedTarget(match[0]);
    }

    for (const match of query.matchAll(/\b(?=.*[A-Z])(?=.*[a-z])[A-Za-z][A-Za-z0-9_-]{3,}\b/g)) {
      pushNamedTarget(match[0]);
    }

    const websiteMatch = query.match(/(.+?)\s+(website|site|app)\b/i);
    if (websiteMatch) {
      const base = websiteMatch[1].trim();
      push(base);
      push(`${base} landing`);
      push(`${base} frontend`);
    }

    const allowLooseTokenSearch = /\b(where|find|locate|path|file|folder|directory|repo|repository|project|codebase|software|system|workspace|access|open)\b/i.test(query);
    const stop = new Set(["the", "a", "an", "is", "and", "or", "of", "to", "in", "for", "on", "website", "site", "app", "build", "building", "continue", "review", "assess", "audit", "explore", "inspect", "what", "needs", "need", "done", "software", "system", "folder", "access", "open", "all", "this", "that", "with", "way", "work"]);
    if (allowLooseTokenSearch) {
      for (const token of query.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean)) {
        if (token.length < 3 || stop.has(token)) continue;
        push(token);
      }
    }

    return out.slice(0, 6);
  }

  private buildNoMatchWorkspacePrompt(query: string, attemptedQueries?: string[]): string {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.name);
    const rootList = roots.length ? roots.join(", ") : "(no workspace folder detected)";
    const attempted = attemptedQueries && attemptedQueries.length
      ? `Search terms tried: ${attemptedQueries.join(", ")}`
      : "";
    return [
      `Workspace lookup for \"${query}\" found no direct matches.`,
      "Use only verified paths from tool/search results. Do NOT guess file paths or folder names.",
      "Do NOT include hypothetical or example paths in your reply.",
      attempted,
      `Workspace roots: ${rootList}`,
      "Respond with one concise clarifying question and 2-4 concrete search terms to run next."
    ].filter(Boolean).join("\n");
  }

  private buildDeterministicNoMatchReply(query: string, attemptedQueries?: string[]): string {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.name);
    const rootList = roots.length ? roots.join(", ") : "no workspace folder detected";
    const attempts = attemptedQueries?.length ? `Search terms tried: ${attemptedQueries.join(", ")}.` : "";
    return [
      `I searched this workspace for ${query} and found no verified files or folders.`,
      attempts,
      `Workspace roots: ${rootList}.`,
      "If it exists elsewhere, send the path. Otherwise say 'scaffold it here' and I’ll continue from scratch.",
    ].filter(Boolean).join(" ");
  }

  /** Programmatically open the chat and inject a message from another command. */
  public sendToChat(text: string): void {
    if (this.view) {
      this.view.webview.postMessage({ type: "injectMessage", text });
    }
  }

  /** Reveal the chat panel. */
  public reveal(): void {
    if (this.view) {
      this.view.show?.(true);
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

    // Keep webview alive when the panel is hidden (switching tabs)
    (webviewView as any).webview.options.retainContextWhenHidden = true;
    try { (webviewView as any).options = { retainContextWhenHidden: true }; } catch { /* best-effort */ }

    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "stop") {
        this.abortController?.abort();
        return;
      }
      if (message?.type === "newChat") {
        this.conversationId = undefined;
        return;
      }
      if (message?.type === "saveState") {
        // Extension host keeps the conversation state backup
        this._savedMessages = message.messages ?? [];
        this._savedConversationId = this.conversationId;
        return;
      }
      if (message?.type === "ready") {
        // Webview just loaded — restore state if we have it
        if (this._savedMessages?.length) {
          webviewView.webview.postMessage({
            type: "restore",
            messages: this._savedMessages,
            conversationId: this._savedConversationId
          });
        }
        return;
      }
      // Enterprise: Export conversation to file
      if (message?.type === "enterpriseExport") {
        const ext = message.format === "json" ? "json" : "md";
        const fileName = `migrapilot-export-${Date.now()}.${ext}`;
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(fileName),
          filters: ext === "json" ? { "JSON": ["json"] } : { "Markdown": ["md"] }
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(message.data, "utf-8"));
          vscode.window.showInformationMessage(`Exported conversation → ${uri.fsPath}`);
        }
        return;
      }
      // Enterprise: RLHF feedback
      if (message?.type === "enterpriseFeedback") {
        this.output.appendLine(`[Feedback] msg=${message.messageIdx} sentiment=${message.sentiment} text=${message.text || ""}`);
        vscode.window.showInformationMessage(`Feedback recorded: ${message.sentiment}`);
        return;
      }
      // Enterprise: Info toast
      if (message?.type === "info") {
        vscode.window.showInformationMessage(message.text || "");
        return;
      }
      if (message?.type !== "chat" || typeof message?.text !== "string" || !message.text.trim()) {
        return;
      }

      // Hard guard: prevent duplicate concurrent stream requests from extension-side
      // listeners or accidental double-dispatch.
      if (this._chatInFlight) {
        this.output.appendLine("[chat] Ignored duplicate chat request while stream is active");
        return;
      }

      let text = message.text.trim();

      // ── Workspace-aware enrichment: explicit @workspace + location-style queries ──
      const wsMatch = text.match(/^@workspace\s+(.+)/i);
      const contextualLookupQuery = !wsMatch ? this.deriveRetryWorkspaceQuery(text, message.history) : undefined;
      const autoLookup = this.isLikelyWorkspaceLookup(text);
      if (wsMatch || autoLookup || contextualLookupQuery) {
        const query = (wsMatch ? wsMatch[1] : contextualLookupQuery ?? text).trim();
        try {
          webviewView.webview.postMessage({ type: "statusUpdate", text: "Searching workspace…" });
          const client = new BrainClient(getBrainClientConfig());
          const candidateQueries = this.deriveWorkspaceQueries(query);
          let matches: any[] = [];
          let matchedQuery = query;
          let searchMode: "remote" | "local" | "local-path" = "remote";

          try {
            for (const candidate of candidateQueries) {
              const result = await client.repoSearch(candidate, undefined, 20);
              const candidateMatches = result?.data?.matches ?? result?.matches ?? [];
              if (candidateMatches.length > 0) {
                matches = candidateMatches;
                matchedQuery = candidate;
                break;
              }
            }

            if (matches.length === 0) {
              for (const candidate of candidateQueries) {
                const candidateMatches = await this.localWorkspacePathSearch(candidate, 20);
                if (candidateMatches.length > 0) {
                  matches = candidateMatches;
                  matchedQuery = candidate;
                  searchMode = "local-path";
                  break;
                }
              }
            }
          } catch (error) {
            if (!isBrainConnectionError(error)) {
              throw error;
            }

            searchMode = "local";
            for (const candidate of candidateQueries) {
              const candidateMatches = await this.localWorkspaceSearch(candidate, 20);
              if (candidateMatches.length > 0) {
                matches = candidateMatches;
                matchedQuery = candidate;
                break;
              }
            }

            if (matches.length === 0) {
              for (const candidate of candidateQueries) {
                const candidateMatches = await this.localWorkspacePathSearch(candidate, 20);
                if (candidateMatches.length > 0) {
                  matches = candidateMatches;
                  matchedQuery = candidate;
                  searchMode = "local-path";
                  break;
                }
              }
            }
          }

          if (matches.length > 0) {
            const rankedMatches = this.prioritizeWorkspaceMatches(matches, query);
            const formatted = this.formatWorkspaceMatches(rankedMatches);
            const deterministicMatchReply = this.buildDeterministicFoundReply(query, rankedMatches);
            const queryNote = matchedQuery.toLowerCase() === query.toLowerCase()
              ? ""
              : `Resolved with query variant: \"${matchedQuery}\".`;
            if (searchMode === "local") {
              await this.postAssistantMessage(
                webviewView,
                [
                  "MigraPilot is in degraded mode, so this answer is from local workspace search instead of pilot-api.",
                  "",
                  `Verified matches for "${query}" (${matches.length} results via local workspace search):`,
                  "```",
                  formatted,
                  "```",
                  queryNote,
                  "Run MigraPilot: Repair Connection to restore full agent chat and tool orchestration.",
                ].filter(Boolean).join("\n\n")
              );
              return;
            }
            if (this.isRetryLikeWorkspaceMessage(text) || this.isContextualWorkspaceContinuationMessage(text)) {
              await this.postAssistantMessage(webviewView, deterministicMatchReply);
              return;
            }
            text = [
              `Workspace search results for "${query}" (${matches.length} matches${searchMode === "local-path" ? " via local path scan" : ""}):`,
              queryNote,
              "```",
              formatted,
              "```",
              "Use only these verified file paths/results when answering.",
              "If more precision is needed, ask one focused clarifying question."
            ].filter(Boolean).join("\n\n");
          } else {
            await this.postAssistantMessage(webviewView, this.buildDeterministicNoMatchReply(query, candidateQueries));
            return;
          }
        } catch (err: any) {
          this.output.appendLine(`[workspace-search] Error: ${err.message}`);
          text = [
            `Workspace search for \"${query}\" failed: ${err.message}`,
            "Do not guess or invent paths. Ask one concise clarifying question."
          ].join("\n");
        }
      }

      this._chatInFlight = true;
      try {
        await this.streamChat(webviewView, text, message.files, message.provider, message.history);
      } finally {
        this._chatInFlight = false;
      }
    });
  }

  private async streamChat(
    webviewView: vscode.WebviewView,
    userMessage: string,
    files?: Array<{name: string; type: string; dataUrl: string}>,
    provider?: string,
    history?: Array<{ role: "user" | "assistant"; text: string }>,
    retryOnConnectionFailure = true,
  ): Promise<void> {
    const cfg = getBrainClientConfig();
    const baseUrl = cfg.baseUrl.replace(/\/$/, "");

    this.abortController = new AbortController();

    // If files are attached, use FormData (multipart); otherwise JSON
    let body: any;
    const headers: Record<string, string> = {};
    const authorization = getAuthorizationHeader(cfg);
    if (authorization) {
      headers["authorization"] = authorization;
    }

    if (files && files.length > 0) {
      // Build FormData with files — Node 18+ (VS Code 1.90+) has native FormData + Blob
      const formData = new FormData();
      formData.append("message", userMessage);
      if (this.conversationId) formData.append("conversationId", this.conversationId);
      if (provider) formData.append("provider", provider);
      if (history?.length) formData.append("history", JSON.stringify(history));
      formData.append("dryRun", "false");

      for (const f of files) {
        // dataUrl is "data:<mime>;base64,<data>"
        const commaIdx = f.dataUrl.indexOf(",");
        const b64Data = f.dataUrl.slice(commaIdx + 1);
        const buf = Buffer.from(b64Data, "base64");
        const blob = new Blob([buf], { type: f.type });
        formData.append("files", blob, f.name);
      }
      body = formData;
      // Don't set content-type — fetch will set the multipart boundary
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify({
        message: userMessage,
        conversationId: this.conversationId,
        provider: provider || undefined,
        history: history?.length ? history : undefined,
        dryRun: false
      });
    }

    try {
      const response = await fetch(`${baseUrl}/api/pilot/chat/stream`, {
        method: "POST",
        headers,
        body,
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body (streaming not supported)");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamEnded = false;

      webviewView.webview.postMessage({ type: "streamStart", conversationId: this.conversationId || undefined });

      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              if (eventType === "conversation" && data.conversationId) {
                this.conversationId = data.conversationId;
                webviewView.webview.postMessage({ type: "conversationId", conversationId: data.conversationId });
              } else if (eventType === "token" && data.text) {
                webviewView.webview.postMessage({ type: "token", text: data.text });
              } else if (eventType === "tool") {
                webviewView.webview.postMessage({ type: "tool", data });
              } else if (eventType === "error") {
                let errMsg = data.message || "Unknown error";
                if (errMsg.includes("Connection error")) {
                  errMsg = "LLM backend unavailable — start Ollama or set CLAUDE_API_KEY";
                }
                webviewView.webview.postMessage({ type: "error", text: errMsg });
              } else if (eventType === "warning") {
                // Transient provider warning — don't stop streaming
                this.output.appendLine(`[chat warning] ${data.message || "provider escalation"}`);
              } else if (eventType === "usage") {
                webviewView.webview.postMessage({ type: "usage", data });
              } else if (eventType === "provider") {
                webviewView.webview.postMessage({ type: "provider", data });
              } else if (eventType === "done") {
                if (!streamEnded) {
                  webviewView.webview.postMessage({ type: "streamEnd", usage: data.usage || null });
                  streamEnded = true;
                }
              }
            } catch {
              // skip invalid JSON
            }
          } else if (line === "") {
            eventType = "";
          }
        }
      }

      if (!streamEnded) {
        webviewView.webview.postMessage({ type: "streamEnd" });
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        webviewView.webview.postMessage({ type: "streamEnd", stopped: true });
        return;
      }
      let msg = error?.message ?? "Connection failed";
      if (isBrainConnectionError(error)) {
        if (retryOnConnectionFailure && isLocalBrainUrl(cfg.baseUrl)) {
          const latestHealth = await probeBrainHealth(cfg, 1500);
          if (latestHealth.ok) {
            this.output.appendLine(`[chat] Initial stream connection failed but ${latestHealth.url} is healthy; retrying once.`);
            return this.streamChat(webviewView, userMessage, files, provider, history, false);
          }
        }

        msg = `MigraPilot could not reach ${baseUrl}. Start pilot-api or update migrapilot.brainUrl.`;
        await this.postAssistantMessage(webviewView, await this.buildLocalFallbackResponse(userMessage));
        const action = await vscode.window.showErrorMessage(
          msg,
          "Repair Connection",
          "Show Logs",
          "Open Settings"
        );
        if (action === "Repair Connection") {
          await vscode.commands.executeCommand("migrapilot.repairConnection");
        }
        if (action === "Show Logs") {
          this.output.show(true);
        }
        if (action === "Open Settings") {
          await vscode.commands.executeCommand("workbench.action.openSettings", "migrapilot.brainUrl");
        }
        this.output.appendLine(`[chat error] ${msg}`);
        return;
      }
      webviewView.webview.postMessage({ type: "error", text: msg });
      this.output.appendLine(`[chat error] ${msg}`);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = Date.now().toString(36);
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://127.0.0.1:* http://localhost:*; img-src data: blob:;`;

    return /* html */ `<!doctype html>
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
        border: none;
        outline: none;
        background: transparent;
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        resize: none;
        max-height: 120px;
        min-height: 20px;
        line-height: 1.4;
        padding: 3px 0;
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
        <textarea id="input" rows="1" placeholder="Ask MigraPilot… / for commands, paste images, drag files"></textarea>
        <button id="send-btn" title="Send (Enter)">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1.91L7.2 8 1 14.09 1.91 15 9.82 8 1.91 1 1 1.91z"/><path d="M6 1.91L12.2 8 6 14.09 6.91 15 14.82 8 6.91 1 6 1.91z"/></svg>
        </button>
        <button id="stop-btn" title="Stop generation">
          <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
        </button>
      </div>
      <div class="status-bar">
        <span id="status-text">Ready</span>
        <select id="model-picker" title="LLM provider for next message">
          <option value="auto" selected>Auto (local→cloud)</option>
          <option value="local">🖥️ Local (Ollama)</option>
          <option value="haiku">⚡ Haiku ($0.80/M)</option>
          <option value="sonnet">🎵 Sonnet ($3/M)</option>
          <option value="opus">💎 Opus ($15/M)</option>
        </select>
        <button id="new-chat-btn">New chat</button>
      </div>
      <input type="file" id="file-input" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.json,.csv,.yaml,.yml" />
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

      /** Copy code block content */
      window.copyCode = function(btn) {
        const pre = btn.parentElement;
        const code = pre.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        }
      };

      // ── Enterprise: Message action callbacks ──
      window.copyMsg = function(idx) {
        if (messages[idx]) {
          navigator.clipboard.writeText(messages[idx].text).then(() => {
            vscode.postMessage({ type: 'info', text: 'Message copied to clipboard' });
          });
        }
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
      const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','application/pdf','application/json','text/csv','text/yaml','application/x-yaml'];
      const MAX_FILE_SIZE = 5 * 1024 * 1024;
      const MAX_FILES = 6;

      function addFiles(fileList) {
        for (const f of fileList) {
          if (pendingFiles.length >= MAX_FILES) break;
          if (f.size > MAX_FILE_SIZE) continue;
          // Read as data URL for sending
          const reader = new FileReader();
          reader.onload = () => {
            pendingFiles.push({ name: f.name, size: f.size, type: f.type, dataUrl: reader.result });
            renderFileChips();
          };
          reader.readAsDataURL(f);
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

      // ── Voice Input (Web Speech API) ──────────
      let recognition = null;
      let isRecording = false;
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          // Replace the input value with accumulated transcript
          const existing = input.dataset.preVoice || '';
          input.value = existing + transcript;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        };

        recognition.onend = () => {
          if (isRecording) {
            // Restart if user hasn't explicitly stopped
            try { recognition.start(); } catch {}
          }
        };

        recognition.onerror = (event) => {
          if (event.error !== 'aborted' && event.error !== 'no-speech') {
            console.warn('Speech recognition error:', event.error);
          }
          isRecording = false;
          micBtn.classList.remove('recording');
          micBtn.title = 'Voice input (click to start)';
        };

        micBtn.addEventListener('click', () => {
          if (isRecording) {
            isRecording = false;
            recognition.stop();
            micBtn.classList.remove('recording');
            micBtn.title = 'Voice input (click to start)';
            // Clear the pre-voice marker
            delete input.dataset.preVoice;
          } else {
            isRecording = true;
            input.dataset.preVoice = input.value;
            recognition.start();
            micBtn.classList.add('recording');
            micBtn.title = 'Recording… click to stop';
          }
        });
      } else {
        // Speech API not available — hide button
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

      // Paste images
      input.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            const f = items[i].getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length > 0) { e.preventDefault(); addFiles(files); }
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
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });

      // ── Quick actions ──────────────────
      document.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const prompt = btn.getAttribute('data-prompt');
          if (prompt) { input.value = prompt; send(); }
        });
      });

      // ── Send ───────────────────────────
      function send() {
        const text = input.value.trim();
        if (!text || streaming) return;
        addUserMessage(text);
        currentAssistantBody = null;
        setStreaming(true);
        // Send with file info if any
        const fileData = pendingFiles.map(f => ({ name: f.name, type: f.type, dataUrl: f.dataUrl }));
        const selectedProvider = modelPicker ? modelPicker.value : 'auto';
        const history = messages
          .slice(Math.max(0, messages.length - 12), Math.max(0, messages.length - 1))
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
          .map(m => ({ role: m.role, text: m.text }));
        vscode.postMessage({
          type: 'chat',
          text,
          files: fileData.length > 0 ? fileData : undefined,
          provider: selectedProvider !== 'auto' ? selectedProvider : undefined,
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
  }
}
