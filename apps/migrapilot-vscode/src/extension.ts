import * as vscode from "vscode";
import * as path from "path";
import { ContextCollector } from "./contextCollector";
import { ChatPanelViewProvider } from "./chatPanelView";
import { PilotClient } from "./pilotClient";
import type { WorkspaceContext } from "./types";

type AttachKind = "file" | "selection" | "image" | "symbol";
interface Attachment { id: string; label: string; kind: AttachKind; content?: string; dataUri?: string; }

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);

export function activate(context: vscode.ExtensionContext): void {
  const collector = new ContextCollector();
  const client = new PilotClient();
  let captured: WorkspaceContext = collector.collectContext(vscode.window.activeTextEditor);
  let selectedModel: string | undefined;
  let attachments: Attachment[] = [];
  let attachSeq = 0;
  let history: { role: "user" | "assistant"; text: string }[] = [];

  const chat = new ChatPanelViewProvider(context.extensionUri, {
    onUserMessage: (text) => handleUserMessage(text),
    onSetModel: (model) => { selectedModel = model && model !== "auto" ? model : undefined; },
    onMention: () => addContextViaPicker(),
    onAttach: () => attachFiles(),
    onSettings: () => vscode.commands.executeCommand("workbench.action.openSettings", "migrapilot"),
    onRemoveChip: (id) => { attachments = attachments.filter((a) => a.id !== id); },
    onPasteImage: (dataUri) => addAttachment({ kind: "image", label: "pasted image", dataUri }),
    onUploadFile: (name, kind, content, dataUri) => {
      if (kind === "image") addAttachment({ kind: "image", label: name, dataUri });
      else if (kind === "binary") addAttachment({ kind: "file", label: `${name} (binary — text not extracted)`, content: undefined });
      else addAttachment({ kind: "file", label: name, content });
    },
    onVoiceCapture: () => startBrowserVoiceCapture(),
  });

  /* ── voice capture (external browser — VS Code webviews can't use the mic) ── */
  let voicePolling = false;
  async function startBrowserVoiceCapture(): Promise<void> {
    const session = `vc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const url = client.voicePageUrl(session);
    if (!url) { chat.voiceStatus("error", "Set migrapilot.apiUrl to enable voice."); return; }
    voicePolling = false; // cancel any prior capture loop
    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch {
      chat.voiceStatus("error", "Couldn't open the browser recorder.");
      return;
    }
    chat.voiceStatus("recording");
    voicePolling = true;
    const deadline = Date.now() + 95000;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (voicePolling && Date.now() < deadline) {
      await sleep(1200);
      const r = await client.pollVoiceInbox(session);
      if (r.ready) {
        voicePolling = false;
        if (r.text) chat.insertTranscript(r.text);
        else chat.voiceStatus("error", "No speech detected — try again.");
        return;
      }
    }
    if (voicePolling) { voicePolling = false; chat.voiceStatus("error", "Voice timed out — record and stop in the browser tab."); }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelViewProvider.viewType, chat, { webviewOptions: { retainContextWhenHidden: true } })
  );
  client.listModels().then((list) => chat.setModels(list, selectedModel ?? "auto")).catch(() => { /* offline */ });

  const refreshContext = () => { captured = collector.collectContext(vscode.window.activeTextEditor); };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshContext()),
    vscode.window.onDidChangeTextEditorSelection(() => refreshContext()),
    collector
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(comment-discussion) MigraPilot";
  status.tooltip = "Open MigraPilot chat";
  status.command = "migrapilot.openChat";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openChat", () => chat.focus()),
    vscode.commands.registerCommand("migrapilot.explainCurrentFile", () => { addCurrentFile(); handleUserMessage("Explain the current file."); }),
    vscode.commands.registerCommand("migrapilot.reviewSelection", () => { addCurrentSelection(); handleUserMessage("Review the selected code."); }),
    vscode.commands.registerCommand("migrapilot.newChat", () => { attachments = []; history = []; chat.clearChips(); chat.reset(); chat.focus(); }),
    vscode.commands.registerCommand("migrapilot.attachFile", () => attachFiles())
  );

  /* ── attachment engine ── */

  function addAttachment(a: Omit<Attachment, "id">): void {
    const id = `att${++attachSeq}`;
    attachments.push({ id, ...a });
    chat.addChip(id, a.label, a.kind);
  }
  function addCurrentFile(): void {
    const ed = vscode.window.activeTextEditor;
    if (ed) addAttachment({ kind: "file", label: vscode.workspace.asRelativePath(ed.document.uri), content: ed.document.getText() });
  }
  function addCurrentSelection(): void {
    const ed = vscode.window.activeTextEditor;
    if (ed && !ed.selection.isEmpty) addAttachment({ kind: "selection", label: "selection", content: ed.document.getText(ed.selection) });
  }

  async function addContextViaPicker(): Promise<void> {
    type Item = vscode.QuickPickItem & { action: "sel" | "file" | "pick"; uri?: vscode.Uri };
    const ed = vscode.window.activeTextEditor;
    const items: Item[] = [];
    if (ed && !ed.selection.isEmpty) items.push({ label: "$(selection) Current selection", description: vscode.workspace.asRelativePath(ed.document.uri), action: "sel" });
    if (ed) items.push({ label: "$(file-code) Current file", description: vscode.workspace.asRelativePath(ed.document.uri), action: "file", uri: ed.document.uri });
    const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,out,dist}/**", 400);
    for (const f of files) items.push({ label: "$(file) " + vscode.workspace.asRelativePath(f), action: "pick", uri: f });

    const chosen = await vscode.window.showQuickPick(items, { placeHolder: "Add context — a file, or the current selection", matchOnDescription: true });
    if (!chosen) return;
    if (chosen.action === "sel" && ed) { addCurrentSelection(); return; }
    if (chosen.uri) {
      const doc = await vscode.workspace.openTextDocument(chosen.uri);
      addAttachment({ kind: "file", label: vscode.workspace.asRelativePath(chosen.uri), content: doc.getText() });
    }
  }

  async function attachFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Attach to MigraPilot" });
    if (!uris) return;
    for (const uri of uris) {
      const ext = path.extname(uri.fsPath).toLowerCase();
      const base = path.basename(uri.fsPath);
      if (IMAGE_EXT.has(ext)) {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
        addAttachment({ kind: "image", label: base, dataUri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` });
      } else {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          addAttachment({ kind: "file", label: vscode.workspace.asRelativePath(uri), content: doc.getText() });
        } catch {
          addAttachment({ kind: "file", label: `${base} (binary — text extraction not available)`, content: undefined });
        }
      }
    }
  }

  /* ── send ── */

  async function handleUserMessage(text: string): Promise<void> {
    if (text === "__new_chat__") { attachments = []; history = []; chat.clearChips(); chat.reset(); return; }
    chat.focus();
    chat.appendUser(attachments.length ? `${text}  ·  ${attachments.length} attachment(s)` : text);
    const id = chat.beginAssistant();
    // Vision: analyze image attachments locally so the model can actually "see" them (any backend).
    const imageAtts = attachments.filter((a) => a.kind === "image" && a.dataUri && !a.content);
    if (imageAtts.length) {
      chat.stepAssistant(id, `Analyzing ${imageAtts.length} image(s) with vision model…`);
      for (const a of imageAtts) {
        try { a.content = await client.analyzeImage(a.dataUri!, text); }
        catch { /* leave without analysis; buildBackendMessage notes it */ }
      }
    }
    const backendMessage = buildBackendMessage(text, captured, attachments);
    // attachments consumed by this turn
    attachments = [];
    chat.clearChips();
    const priorHistory = history.slice(-18); // prior turns only; current message sent separately
    await client.streamChat(backendMessage, toContext(captured), {
      onStep: (title) => chat.stepAssistant(id, title),
      // Execution plan + phased progress (pilot-api C.6.1). The plan arrives BEFORE any
      // tool runs and is rendered from the structured event, so it survives the run.
      onPlan: (plan) => chat.planAssistant(id, plan),
      onPhase: (update) => chat.phaseAssistant(id, update),
      onDelta: (d) => chat.streamDelta(id, d),
      onDone: (full) => {
        chat.completeAssistant(id, full);
        // Record the turn for multi-turn context (store raw user text, not the context-augmented message).
        history.push({ role: "user", text }, { role: "assistant", text: full });
        if (history.length > 20) history = history.slice(-20);
      },
      onError: (m) => chat.completeAssistant(id, "⚠️ " + m),
    }, selectedModel, priorHistory);
  }
}

export function deactivate(): void { /* no teardown required */ }

/* ── context + attachment message building ── */

function toContext(c: WorkspaceContext) {
  return { file: c.relativeFilePath || c.activeFilePath || undefined, languageId: c.languageId || undefined, selection: c.hasSelection ? c.selectedTextPreview : undefined };
}
function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "\n… (truncated)" : s; }

function buildBackendMessage(text: string, c: WorkspaceContext, attachments: Attachment[]): string {
  let msg = text;
  const file = c.relativeFilePath || c.activeFilePath;
  if (file && !attachments.some((a) => a.kind === "file" || a.kind === "selection")) {
    msg += `\n\n--- Editor context ---\nFile: ${file}${c.languageId ? ` (${c.languageId})` : ""}`;
    if (c.hasSelection && c.selectedTextPreview) msg += `\nSelected code:\n\`\`\`${c.languageId || ""}\n${truncate(c.selectedTextPreview, 2000)}\n\`\`\``;
    else if (c.filePreview) msg += `\nFile (truncated):\n\`\`\`${c.languageId || ""}\n${truncate(c.filePreview, 1800)}\n\`\`\``;
  }
  for (const a of attachments) {
    if (a.kind === "image") {
      if (a.content) msg += `\n\n[Image "${a.label}" — visual analysis]\n\`\`\`\n${truncate(a.content, 3000)}\n\`\`\``;
      else msg += `\n\n[Attached image: ${a.label}] — vision analysis unavailable (is a vision model installed?).`;
    }
    else if (a.content != null) msg += `\n\n--- Attached: ${a.label} ---\n\`\`\`\n${truncate(a.content, 6000)}\n\`\`\``;
    else msg += `\n\n[Attached (binary): ${a.label}]`;
  }
  return msg;
}
