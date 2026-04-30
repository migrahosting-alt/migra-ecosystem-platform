import * as vscode from "vscode";

import { getAuthorizationHeader, getBrainClientConfig, isBrainConnectionError } from "./brainClient.js";

type ChatHistoryItem = { role: "user" | "assistant"; text: string };
type NativeChatProvider = "auto" | "local" | "haiku" | "sonnet" | "opus";
type VsCodeToolBridgeResult = {
  transcript: string;
  toolCallCount: number;
  usedToolNames: string[];
};

function getMarkdownText(part: vscode.ChatResponseMarkdownPart): string {
  return part.value.value;
}

function getNativeChatHistory(context: vscode.ChatContext): ChatHistoryItem[] {
  return context.history
    .flatMap((turn): ChatHistoryItem[] => {
      if (turn instanceof vscode.ChatRequestTurn) {
        return [{ role: "user", text: turn.prompt }];
      }

      if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
          .map(getMarkdownText)
          .join("");
        return text.trim() ? [{ role: "assistant", text }] : [];
      }

      return [];
    })
    .filter((item) => item.text.trim().length > 0)
    .slice(-20);
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function formatDiagnostics(limit = 20): string {
  const rows = vscode.languages.getDiagnostics()
    .flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => ({
      file: vscode.workspace.asRelativePath(uri, false),
      line: diagnostic.range.start.line + 1,
      severity: vscode.DiagnosticSeverity[diagnostic.severity],
      message: diagnostic.message,
      source: diagnostic.source,
    })))
    .slice(0, limit);

  if (rows.length === 0) return "none";
  return rows.map((item) =>
    `${item.file}:${item.line} ${item.severity}${item.source ? ` (${item.source})` : ""}: ${item.message}`
  ).join("\n");
}

function buildNativePrompt(request: vscode.ChatRequest): string {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.name)
    .join(", ") || "none";
  const activeEditor = vscode.window.activeTextEditor;
  const activeFile = activeEditor
    ? vscode.workspace.asRelativePath(activeEditor.document.uri, false)
    : "none";
  const selection = activeEditor && !activeEditor.selection.isEmpty
    ? activeEditor.document.getText(activeEditor.selection)
    : "";
  const visibleFiles = vscode.window.visibleTextEditors
    .map((editor) => vscode.workspace.asRelativePath(editor.document.uri, false))
    .join(", ") || "none";
  const referencedTools = request.toolReferences.map((tool) => tool.name).join(", ") || "none";

  return [
    "Original operator request:",
    request.prompt,
    "",
    "VS Code context:",
    `Workspace roots: ${workspaceRoots}`,
    `Active file: ${activeFile}`,
    `Visible files: ${visibleFiles}`,
    `Attached VS Code tools: ${referencedTools}`,
    "",
    "Current diagnostics:",
    formatDiagnostics(),
    selection
      ? [
        "",
        "Active selection:",
        "```",
        truncate(selection, 20_000),
        "```",
      ].join("\n")
      : "",
    "",
    "Act like a coding agent inside VS Code: inspect files when needed, make edits through available repo tools for implementation requests, run verification when practical, and report completed work concisely.",
  ].filter(Boolean).join("\n");
}

function getNativeChatProvider(): Exclude<NativeChatProvider, "auto"> | undefined {
  const configured = vscode.workspace
    .getConfiguration("migrapilot")
    .get<NativeChatProvider>("nativeChat.provider", "auto");
  return configured && configured !== "auto" ? configured : undefined;
}

function isVsCodeToolBridgeEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("migrapilot")
    .get<boolean>("nativeChat.vscodeToolBridge.enabled", true);
}

function getVsCodeToolBridgeMaxRounds(): number {
  const configured = vscode.workspace
    .getConfiguration("migrapilot")
    .get<number>("nativeChat.vscodeToolBridge.maxRounds", 4);
  return Math.min(Math.max(Math.trunc(configured), 1), 8);
}

function getVsCodeToolBridgeMaxTools(): number {
  const configured = vscode.workspace
    .getConfiguration("migrapilot")
    .get<number>("nativeChat.vscodeToolBridge.maxTools", 128);
  return Math.min(Math.max(Math.trunc(configured), 1), 256);
}

function toolResultToText(result: vscode.LanguageModelToolResult): string {
  return result.content.map((part: any) => {
    if (part instanceof vscode.LanguageModelTextPart) return part.value;
    if (part instanceof vscode.LanguageModelDataPart) {
      try {
        return new TextDecoder().decode(part.data);
      } catch {
        return `[data:${part.mimeType}]`;
      }
    }
    if (part && typeof part === "object" && "value" in part) {
      return typeof part.value === "string" ? part.value : JSON.stringify(part.value);
    }
    return typeof part === "string" ? part : JSON.stringify(part);
  }).join("\n");
}

function selectVsCodeTools(request: vscode.ChatRequest): vscode.LanguageModelChatTool[] {
  const available = vscode.lm?.tools ?? [];
  const maxTools = getVsCodeToolBridgeMaxTools();
  const referenced = new Set(request.toolReferences.map((tool) => tool.name));
  const preferred = new Set([
    ...referenced,
    "migrapilot_activeContext",
    "migrapilot_websiteTask",
    "migrapilot_searchWorkspace",
    "migrapilot_readFile",
    "migrapilot_diagnostics",
    "migrapilot_gitDiff",
    "migrapilot_runCommand",
    "migrapilot_batchWriteFiles",
    "migrapilot_scaffoldWebsite",
    "migrapilot_startDevServer",
    "migrapilot_browserAudit",
  ]);

  const ranked = [...available].sort((left, right) => {
    const leftPreferred = preferred.has(left.name) ? 0 : 1;
    const rightPreferred = preferred.has(right.name) ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    return left.name.localeCompare(right.name);
  });

  return ranked.slice(0, maxTools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

async function runVsCodeToolBridge(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<VsCodeToolBridgeResult | null> {
  if (!isVsCodeToolBridgeEnabled()) return null;
  if (!vscode.lm?.tools?.length || !vscode.lm.invokeTool) return null;

  const tools = selectVsCodeTools(request);
  if (tools.length === 0) return null;

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User([
      "You are MigraPilot's VS Code tool bridge.",
      "Use the available VS Code and MCP tools to gather context or perform clearly requested local actions before MigraPilot's backend synthesizes the final answer.",
      "Prefer read/search/diagnostic/browser tools first. Use edit/run/write tools only when the user explicitly asks to implement, build, fix, scaffold, test, or execute.",
      "If no tool is needed, answer TOOL_BRIDGE_NOOP.",
      "",
      buildNativePrompt(request),
    ].join("\n")),
  ];

  const usedToolNames: string[] = [];
  const transcript: string[] = [
    `VS Code tool bridge available tools: ${tools.map((tool) => tool.name).join(", ")}`,
  ];
  let toolCallCount = 0;

  for (let round = 0; round < getVsCodeToolBridgeMaxRounds(); round += 1) {
    const response = await request.model.sendRequest(messages, {
      justification: "MigraPilot uses selected VS Code tools to execute workspace tasks.",
      tools,
      toolMode: vscode.LanguageModelChatToolMode.Auto,
    }, token);

    const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart | vscode.LanguageModelDataPart> = [];
    const pendingToolCalls: vscode.LanguageModelToolCallPart[] = [];
    let assistantText = "";

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        assistantParts.push(part);
        assistantText += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        assistantParts.push(part);
        pendingToolCalls.push(part);
      } else if (part instanceof vscode.LanguageModelDataPart) {
        assistantParts.push(part);
      }
    }

    if (assistantText.trim() && assistantText.trim() !== "TOOL_BRIDGE_NOOP") {
      transcript.push(`Bridge model note:\n${truncate(assistantText.trim(), 4000)}`);
    }

    if (pendingToolCalls.length === 0) break;

    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

    const toolResultParts: vscode.LanguageModelToolResultPart[] = [];
    for (const call of pendingToolCalls) {
      toolCallCount += 1;
      usedToolNames.push(call.name);
      stream.progress(`VS Code tool: ${call.name}`);

      try {
        const result = await vscode.lm.invokeTool(call.name, {
          input: call.input,
          toolInvocationToken: request.toolInvocationToken,
        }, token);
        const resultText = truncate(toolResultToText(result), 12_000);
        transcript.push(`Tool ${call.name} input:\n${JSON.stringify(call.input, null, 2)}\nTool ${call.name} result:\n${resultText}`);
        toolResultParts.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
      } catch (error: any) {
        const message = error?.message ?? String(error);
        transcript.push(`Tool ${call.name} failed:\n${message}`);
        toolResultParts.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(`Tool failed: ${message}`)]));
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));
  }

  if (toolCallCount === 0) return null;
  return {
    transcript: transcript.join("\n\n---\n\n"),
    toolCallCount,
    usedToolNames: [...new Set(usedToolNames)],
  };
}

export function registerNativeChatParticipant(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  const createParticipant = vscode.chat?.createChatParticipant;
  if (!createParticipant) {
    output.appendLine("[native-chat] VS Code Chat Participant API is unavailable in this VS Code build.");
    return;
  }

  const participant = createParticipant("migrateck.migrapilot", async (request, chatContext, stream, token) => {
    const cfg = getBrainClientConfig();
    const baseUrl = cfg.baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = { "content-type": "application/json" };
    const authorization = getAuthorizationHeader(cfg);
    if (authorization) {
      headers.authorization = authorization;
    }

    const abortController = new AbortController();
    const cancellation = token.onCancellationRequested(() => abortController.abort());
    const history = getNativeChatHistory(chatContext);
    const provider = getNativeChatProvider();

    try {
      const bridgeResult = await runVsCodeToolBridge(request, stream, token).catch((error: any) => {
        output.appendLine(`[native-chat:vscode-tool-bridge] ${error?.message ?? String(error)}`);
        return null;
      });
      stream.progress("Connecting to MigraPilot");
      const message = bridgeResult
        ? [
          buildNativePrompt(request),
          "",
          "Verified VS Code tool results from this turn:",
          "```",
          truncate(bridgeResult.transcript, 60_000),
          "```",
          "",
          `VS Code tools used: ${bridgeResult.usedToolNames.join(", ")}.`,
          "Use these results as grounded context. Do not re-ask for work already completed by the VS Code tools.",
        ].join("\n")
        : buildNativePrompt(request);
      const response = await fetch(`${baseUrl}/api/pilot/chat/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          history: history.length ? history : undefined,
          provider,
          dryRun: false,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`);
      }
      if (!response.body) {
        throw new Error("No response body (streaming not supported)");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) {
            if (line === "") eventType = "";
            continue;
          }

          let data: any;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (eventType === "token" && typeof data.text === "string") {
            stream.markdown(data.text);
          } else if (eventType === "tool") {
            const toolName = data.toolName ?? "tool";
            const status = data.status ?? "running";
            stream.progress(`${toolName}: ${status}`);
          } else if (eventType === "error") {
            const message = data.message ?? "MigraPilot chat stream failed";
            stream.markdown(`\n\n$(warning) ${message}`);
          }
        }
      }

      return { metadata: { source: "migrapilot" } };
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return { metadata: { stopped: true } };
      }

      const message = isBrainConnectionError(error)
        ? `MigraPilot could not reach ${baseUrl}. Run "MigraPilot: Repair Connection" or update migrapilot.brainUrl.`
        : error?.message ?? String(error);
      output.appendLine(`[native-chat] ${message}`);
      stream.markdown(message);
      return { metadata: { error: true } };
    } finally {
      cancellation.dispose();
    }
  });

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "activitybar-icon.svg");
  context.subscriptions.push(participant);
}
