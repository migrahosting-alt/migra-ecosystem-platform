import * as vscode from "vscode";
import * as path from "path";
import { ContextCollector, sliceAtLineBoundary, resolveScope } from "./contextCollector";
import { classifyContextScope } from "./contextScope";
import { ChatPanelViewProvider, type ProposalAction } from "./chatPanelView";
import { PilotClient } from "./pilotClient";
import { registerProposedEdits } from "./proposedEdits/register";
import type { WorkspaceContext } from "./types";
import { applyPhaseToPlan, type ExecutionPlan } from "./planStream";
import { ConversationsProvider } from "./conversationsView";

export type AttachKind = "file" | "selection" | "image" | "symbol";
export interface Attachment { id: string; label: string; kind: AttachKind; content?: string; dataUri?: string; }

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]);

/** Extension-side attachment validation used by the attach flow and tested
 *  directly. Mirrors the constraints the composer enforces before an
 *  attachment is allowed to reach pilot-api. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
export type AttachmentVerdict = { ok: true; kind: "image" | "text" } | { ok: false; reason: string };

/** Decide whether a picked file may become an attachment. Rejects unsupported
 *  binary types, oversized files, and path-traversal escapes from the workspace. */
export function classifyAttachment(opts: { fileName: string; ext: string; byteLength: number; relativePath: string }): AttachmentVerdict {
  const { ext, byteLength, relativePath } = opts;
  if (relativePath.startsWith("..") || relativePath.includes("/../") || relativePath.includes("\\..\\")) {
    return { ok: false, reason: "path escapes the workspace" };
  }
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: "file exceeds the 5 MB attachment limit" };
  }
  if (IMAGE_EXT.has(ext)) return { ok: true, kind: "image" };
  const BINARY_EXT = new Set([".exe", ".dll", ".so", ".bin", ".zip", ".gz", ".tar", ".pdf", ".mp4", ".mov", ".wasm", ".class"]);
  if (BINARY_EXT.has(ext)) return { ok: false, reason: `unsupported binary type ${ext}` };
  return { ok: true, kind: "text" };
}

/** Map a proposal card button to its registered Phase C command. Exported for tests. */
export function proposalCommandFor(action: ProposalAction): string | undefined {
  return {
    review: "migrapilot.reviewProposedEdit",
    approve: "migrapilot.approveProposedEdit",
    reject: "migrapilot.rejectProposedEdit",
    apply: "migrapilot.applyProposedEdit",
    rollback: "migrapilot.rollbackProposedEdit",
  }[action];
}

/** What `activate()` returns. Test-only surface: it exposes state, it does not add behaviour. */
export interface MigraPilotApi {
  /** The thread the extension believes is active right now. */
  getConversationId(): string | undefined;
  /** What is actually PERSISTED — the value a reload would read back. */
  getPersistedConversationId(): string | undefined;
  /** Resolves once the pending workspaceState write has landed. */
  whenPersisted(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): MigraPilotApi {
  const collector = new ContextCollector();
  const client = new PilotClient();
  let captured: WorkspaceContext = collector.collectContext(vscode.window.activeTextEditor);
  let selectedModel: string | undefined;
  let attachments: Attachment[] = [];
  let attachSeq = 0;
  let history: { role: "user" | "assistant"; text: string }[] = [];
  /* D.1 — the active thread, remembered ACROSS RELOADS.
   *
   * pilot-api has always persisted conversations (PilotConversation/PilotMessage) and has
   * always sent back a conversationId. The extension never listened and never sent one
   * back, so every turn opened a NEW thread — and because it also sends dryRun:true, the
   * server minted an ephemeral `dryrun-...` id, created no row, and silently dropped every
   * message on a foreign-key failure. Nothing you ever said in this editor was saved.
   *
   * workspaceState (not globalState): a conversation belongs to the project it was about. */
  const CONVO_KEY = "migrapilot.activeConversationId";
  /** Forward reference: the tree is constructed after setConversation is defined. */
  let conversationsRef: ConversationsProvider | undefined;
  /* Degrade, never crash. VS Code always supplies workspaceState, but an extension that
   * FAILS TO ACTIVATE is far worse than one that forgets: losing history is an
   * inconvenience, losing the assistant is an outage. */
  /* THE BUG THE GUI FOUND (I3): `workspaceState` only persists when a FOLDER is open.
   * VS Code keys workspace storage to a folder; with an empty workspace it is
   * window-scoped and thrown away. The operator's dev host had the panel open but no
   * folder, so the conversation had nowhere to live — the id was written, the window
   * reloaded, and it was simply gone. Verified on disk: 37 workspace databases exist and
   * hold other MigraPilot keys, and `migrapilot.activeConversationId` is in NONE of them.
   *
   * Every test missed it: the unit test used a fake memento, and the integration harness
   * runs VS Code with in-memory storage. Only a human with no folder open could see it.
   *
   * So: use workspaceState when there IS a folder (a thread belongs to its project), and
   * fall back to globalState when there is not — forgetting is not an acceptable default. */
  const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const memento: vscode.Memento | undefined = hasFolder
    ? (context.workspaceState as vscode.Memento | undefined)
    : (context.globalState as vscode.Memento | undefined);
  let conversationId: string | undefined = memento?.get<string>(CONVO_KEY);
  /** Pending persistence, so a caller (and a test) can await the write actually landing. */
  let convoWrite: Thenable<void> | undefined;
  const setConversation = async (id: string | undefined): Promise<void> => {
    conversationId = id;
    conversationsRef?.setActive(id);
    if (!memento) return;
    convoWrite = memento.update(CONVO_KEY, id);
    try {
      await convoWrite;
    } catch (err) {
      // Do NOT swallow this. A silently-dropped write is exactly how the conversation was
      // being lost across reloads while every in-session test passed.
      console.error("[migrapilot] failed to persist active conversation:", err);
      vscode.window.showWarningMessage(
        `MigraPilot could not save this conversation: ${(err as Error)?.message ?? err}`,
      );
    }
  };
  /** The plan for the current turn; phase events fold into it. */
  let livePlan: ExecutionPlan | undefined;
  let activeAbort: AbortController | undefined;

  /* D.2 — where this conversation is happening. Sent with every turn so the history list
   * can be grouped by project, which is how an engineer actually scans it. The git branch
   * is read from VS Code's own git extension when it is available; we never shell out. */
  client.provenance = () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    let branch: string | undefined;
    try {
      const git = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI?.(1);
      const repo = git?.repositories?.find((r: any) => folder.uri.fsPath.startsWith(r.rootUri.fsPath));
      branch = repo?.state?.HEAD?.name;
    } catch { /* the git extension is optional — a missing branch is not an error */ }
    return {
      workspace: vscode.workspace.name ?? folder.name,
      repository: folder.name,
      branch,
    };
  };

  const conversations = new ConversationsProvider(client);
  conversationsRef = conversations;
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("migrapilot.conversations", conversations),
  );
  void conversations.refresh();

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
    // Proposal card buttons run the EXISTING Phase C commands — approval-before-apply,
    // fail-closed preflight, and single-use nonce are all preserved.
    onProposalAction: (action, id) => {
      const cmd = proposalCommandFor(action);
      if (cmd) vscode.commands.executeCommand(cmd, id);
    },
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

  /* D.1 — announce a restored thread. The bug the operator hit (asked "what is my test
   * color?" after a reload and got "I'm not sure what you're referring to") was impossible
   * to diagnose from the UI, because a resumed conversation and a brand-new one looked
   * IDENTICAL. Say which one this is. */
  if (conversationId) {
    chat.stepAssistant(chat.beginAssistant(), `↻ Continuing your previous conversation (${conversationId.slice(0, 10)}…)`);
  }
  /* No folder open is not a small thing: MigraPilot cannot read your files, cannot run your
   * tests, and (before this fix) could not even remember the conversation. It used to look
   * like a perfectly healthy chat panel. Say it out loud. */
  if (!hasFolder) {
    chat.stepAssistant(
      chat.beginAssistant(),
      "⚠️ No folder is open. MigraPilot can't read your files or run your tests until you open one (File → Open Folder). Your conversation will still be remembered.",
    );
  }

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
    vscode.commands.registerCommand("migrapilot.newChat", () => { activeAbort?.abort(); attachments = []; history = []; void setConversation(undefined); chat.clearChips(); chat.reset(); chat.focus(); }),
    vscode.commands.registerCommand("migrapilot.history", () => openHistory()),

    /* ── D.2 — Conversations panel ─────────────────────────────────────────── */
    vscode.commands.registerCommand("migrapilot.conversations.refresh", () => conversations.refresh()),
    vscode.commands.registerCommand("migrapilot.resumeConversation", (id: string) => resumeConversation(id)),
    vscode.commands.registerCommand("migrapilot.conversations.search", async () => {
      const q = await vscode.window.showInputBox({
        prompt: "Search conversations",
        placeHolder: "title, message, workspace, branch, model or tag",
        value: conversations.currentFilter,
      });
      if (q !== undefined) conversations.setFilter(q);
    }),
    vscode.commands.registerCommand("migrapilot.conversations.clearSearch", () => conversations.setFilter("")),
    vscode.commands.registerCommand("migrapilot.conversations.pin", (node: any) =>
      mutate(node, { pinned: true }, "Pinned")),
    vscode.commands.registerCommand("migrapilot.conversations.unpin", (node: any) =>
      mutate(node, { pinned: false }, "Unpinned")),
    vscode.commands.registerCommand("migrapilot.conversations.rename", async (node: any) => {
      const c = node?.item;
      if (!c) return;
      const title = await vscode.window.showInputBox({ prompt: "Rename conversation", value: c.title });
      if (title?.trim()) await mutate(node, { title: title.trim() }, "Renamed");
    }),
    vscode.commands.registerCommand("migrapilot.conversations.delete", async (node: any) => {
      const c = node?.item;
      if (!c) return;
      const DELETE = "Delete";
      const pick = await vscode.window.showWarningMessage(
        `Delete "${c.title}"? This cannot be undone.`, { modal: true }, DELETE,
      );
      if (pick !== DELETE) return;
      try {
        await client.deleteConversation(c.id);
        if (c.id === conversationId) await setConversation(undefined);
        await conversations.refresh();
      } catch (err) {
        vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand("migrapilot.conversationState", async () => {
      const persisted = memento?.get<string>(CONVO_KEY);
      const msg = [
        `active (in memory): ${conversationId ?? "— none —"}`,
        `persisted (workspaceState): ${persisted ?? "— none —"}`,
        `store: ${hasFolder ? "workspaceState (folder open)" : "globalState (NO FOLDER OPEN)"}`,
        `folder open: ${hasFolder ? "yes" : "NO — MigraPilot cannot read files or run tests"}`,
        `these must MATCH, and must survive a window reload.`,
      ].join("\n");
      const COPY = "Copy";
      const pick = await vscode.window.showInformationMessage("MigraPilot conversation state", { modal: true, detail: msg }, COPY);
      if (pick === COPY) await vscode.env.clipboard.writeText(msg);
    }),
    vscode.commands.registerCommand("migrapilot.attachFile", () => attachFiles()),
    vscode.commands.registerCommand("migrapilot.cancelResponse", () => { activeAbort?.abort(); })
  );

  /* ── proposed-edit review/apply/rollback (Phase C + C.5) ──
   * The model generates strictly-typed proposals from chat; they surface as
   * first-class cards, are reviewed as native diffs, and never write to disk
   * without explicit approval + a fail-closed apply gate. Card status reflects
   * the Phase C state machine. */
  const edits = registerProposedEdits(context, {
    onStatus: (id, status, detail) => chat.proposalStatus(id, status, detail),
    onBlocked: (id, reasons) => chat.proposalStatus(id, "blocked", reasons.join(", ")),
  });

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
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      let byteLength = 0;
      try { byteLength = (await vscode.workspace.fs.stat(uri)).size; } catch { /* size unknown */ }
      const verdict = classifyAttachment({ fileName: base, ext, byteLength, relativePath });
      if (!verdict.ok) { vscode.window.showWarningMessage(`MigraPilot: cannot attach ${base} — ${verdict.reason}.`); continue; }
      if (verdict.kind === "image") {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
        addAttachment({ kind: "image", label: base, dataUri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` });
      } else {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          addAttachment({ kind: "file", label: relativePath, content: doc.getText() });
        } catch {
          addAttachment({ kind: "file", label: `${base} (binary — text extraction not available)`, content: undefined });
        }
      }
    }
  }

  /* ── send ── */

  async function handleUserMessage(text: string): Promise<void> {
    if (text === "__new_chat__") { attachments = []; history = []; livePlan = undefined; void setConversation(undefined); chat.clearChips(); chat.reset(); return; }
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
    // Phase C.7: resolve the region from what the operator ASKED, not from where their
    // cursor happens to sit. "Explain this file" overrides a stray selection.
    const backendMessage = await buildScopedBackendMessage(text, attachments);
    // attachments consumed by this turn
    attachments = [];
    chat.clearChips();
    const priorHistory = history.slice(-18); // prior turns only; current message sent separately
    activeAbort?.abort();               // cancel any still-running prior turn
    const abort = new AbortController();
    activeAbort = abort;
    await client.streamChat(backendMessage, toContext(captured), {
      onStep: (title) => chat.stepAssistant(id, title),
      onDelta: (d) => chat.streamDelta(id, d),
      // A model-generated proposal → first-class review card in the transcript.
      onPlan: (plan) => { livePlan = plan; chat.planCard(plan); },
      onPhase: (update) => {
        if (!livePlan) return;
        livePlan = applyPhaseToPlan(livePlan, update);
        chat.planPhase(livePlan);
      },
      onProposal: (card) => chat.proposalCard({
        proposalId: card.proposalId, title: card.title, model: card.model,
        filesAffected: card.filesAffected, linesAdded: card.linesAdded, linesRemoved: card.linesRemoved,
        risk: card.risk, summary: card.summary, expiresAt: card.expiresAt,
        destructive: card.destructive, sensitive: card.sensitive,
      }),
      onDone: (full) => {
        void conversations.refresh(); // title, preview and recency all change on every turn
        chat.completeAssistant(id, full);
        // Record the turn for multi-turn context (store raw user text, not the context-augmented message).
        history.push({ role: "user", text }, { role: "assistant", text: full });
        if (history.length > 20) history = history.slice(-20);
      },
      onError: (m) => chat.completeAssistant(id, "⚠️ " + m),
      // Cancelled turns render as stopped and are NOT recorded to history — no
      // false completion is appended when the user aborts an in-flight response.
      onAborted: () => chat.completeAssistant(id, "⏹️ Response cancelled."),
      onConversation: (cid) => { if (cid !== conversationId) void setConversation(cid); },
    }, selectedModel, priorHistory, abort.signal, edits.workspaceId, conversationId);
  }

  /** Apply a change to a conversation, then re-read the list. Never mutate the tree locally:
   *  the server is the source of truth, and a locally-faked state is how UIs start lying. */
  async function mutate(node: any, patch: Record<string, unknown>, verb: string): Promise<void> {
    const c = node?.item;
    if (!c) return;
    try {
      await client.updateConversation(c.id, patch as any);
      await conversations.refresh();
      chat.stepAssistant(chat.beginAssistant(), `${verb} "${c.title}".`);
    } catch (err) {
      vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
    }
  }

  /** Open a stored conversation in the chat panel and continue THAT thread. */
  async function resumeConversation(id: string): Promise<void> {
    let turns;
    try {
      turns = await client.getConversation(id);
    } catch (err) {
      vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
      return;
    }
    activeAbort?.abort();
    attachments = [];
    livePlan = undefined;
    chat.clearChips();
    chat.reset();
    history = turns.slice(-20);
    await setConversation(id);
    chat.focus();
    for (const t of turns) {
      if (t.role === "user") chat.appendUser(t.text);
      else { const mid = chat.beginAssistant(); chat.completeAssistant(mid, t.text); }
    }
  }

  /** D.1 — browse and resume past conversations. */
  async function openHistory(): Promise<void> {
    let items;
    try {
      items = await client.listConversations();
    } catch (err) {
      vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
      return;
    }
    if (!items.length) {
      vscode.window.showInformationMessage("MigraPilot: no saved conversations yet.");
      return;
    }

    const DELETE = "$(trash) Delete";
    const picks = items.map((c) => ({
      label: c.title,
      description: `${c.messageCount} message${c.messageCount === 1 ? "" : "s"}`,
      detail: new Date(c.createdAt).toLocaleString(),
      id: c.id,
      buttons: [{ iconPath: new vscode.ThemeIcon("trash"), tooltip: DELETE }],
    }));

    const qp = vscode.window.createQuickPick<(typeof picks)[number]>();
    qp.items = picks;
    qp.placeholder = "Resume a conversation (or delete one)";
    qp.matchOnDescription = true;

    const chosen = await new Promise<(typeof picks)[number] | undefined>((resolve) => {
      qp.onDidTriggerItemButton(async (e) => {
        try {
          await client.deleteConversation(e.item.id);
          qp.items = qp.items.filter((i) => i.id !== e.item.id);
          if (e.item.id === conversationId) await setConversation(undefined);
          if (!qp.items.length) { qp.hide(); resolve(undefined); }
        } catch (err) {
          vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
        }
      });
      qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.hide(); });
      qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
      qp.show();
    });
    if (!chosen) return;

    let turns;
    try {
      turns = await client.getConversation(chosen.id);
    } catch (err) {
      vscode.window.showWarningMessage(`MigraPilot: ${(err as Error).message}`);
      return;
    }

    activeAbort?.abort();
    attachments = [];
    livePlan = undefined;
    chat.clearChips();
    chat.reset();
    history = turns.slice(-20);
    await setConversation(chosen.id);
    chat.focus();
    // Replay the transcript so the operator sees what they are resuming, not an empty box.
    for (const t of turns) {
      if (t.role === "user") chat.appendUser(t.text);
      else { const id = chat.beginAssistant(); chat.completeAssistant(id, t.text); }
    }
  }

  /** Build the outgoing message with an intent-resolved editor context (Phase C.7). */
  async function buildScopedBackendMessage(text: string, atts: Attachment[]): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    const explicit = atts.some((a) => a.kind === "file" || a.kind === "selection");
    if (!editor || explicit) return buildBackendMessage(text, captured, atts);

    const file = vscode.workspace.asRelativePath(editor.document.uri, false) || editor.document.fileName;
    // A secret-like file is still withheld — resolveScope must never see its bytes.
    if (!captured.filePreview && captured.warning.startsWith("Secret-like")) {
      return buildBackendMessage(text, captured, atts);
    }

    const decision = classifyContextScope(text, !editor.selection.isEmpty);
    try {
      const resolved = await resolveScope(editor, decision);
      let msg = text + renderScopedContext(file, editor.document.languageId, resolved);
      msg = appendAttachments(msg, atts);
      return msg;
    } catch {
      return buildBackendMessage(text, captured, atts); // never fail a turn over context
    }
  }

  return {
    getConversationId: () => conversationId,
    getPersistedConversationId: () => memento?.get<string>(CONVO_KEY),
    whenPersisted: async () => { await convoWrite; },
  };
}

export function deactivate(): void { /* no teardown required */ }

/* ── context + attachment message building ── */

export function toContext(c: WorkspaceContext) {
  return { file: c.relativeFilePath || c.activeFilePath || undefined, languageId: c.languageId || undefined, selection: c.hasSelection ? c.selectedTextPreview : undefined };
}
export function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "\n… (truncated)" : s; }

/**
 * Hard ceiling on the code we put in one message. Matches ContextCollector's
 * MAX_PREVIEW_CHARS so the buffer is cut EXACTLY ONCE, by the collector, which is
 * the only layer that knows the original size. Cutting a second time here (the old
 * code re-sliced an already-truncated 12,000-char preview down to 1,800) destroyed
 * that knowledge and made honest reporting impossible.
 */
const MAX_CONTEXT_CHARS = 12000;

const num = (n: number) => n.toLocaleString("en-US");

/**
 * Render a scope-resolved region (Phase C.7).
 *
 * Two things the old renderer got wrong, both fixed here:
 *  - it ALWAYS preferred the selection, so "Explain this file in detail" with a stray
 *    `for` loop highlighted returned a review of that one loop. `Scope:` now states what
 *    was resolved and WHY, and the region actually matches the request.
 *  - "the excerpt ends mid-file" read as if the FILE were incomplete. The declaration is
 *    now arithmetic: transmitted vs not transmitted, in characters.
 *
 * Deliberately reuses the existing three fence labels — no new wire vocabulary — so it
 * cannot strand an older pilot-api the way introducing `File (complete)` did.
 */
export function renderScopedContext(
  file: string,
  languageId: string,
  s: {
    scope: string; reason: string; label: string; code: string; truncated: boolean;
    totalChars: number; totalLines: number; diagnostics: string[];
  },
): string {
  const lang = languageId || "";
  let out = `\n\n--- Editor context ---\nFile: ${file}${languageId ? ` (${languageId})` : ""}`;
  out += `\nScope: ${s.label} — ${s.reason}.`;

  const shown = s.code.length;
  out += s.truncated
    ? `\nContent: TRUNCATED — you were sent the first ${num(shown)} of ${num(s.totalChars)} characters. ` +
      `The remaining ${num(s.totalChars - shown)} characters were NOT transmitted, so your findings apply ONLY to the transmitted portion. ` +
      `The transmission was cut at a LINE BOUNDARY, so every line you can see is whole. The file itself is intact — it is NOT incomplete.`
    : `\nContent: COMPLETE — all ${num(s.totalChars)} characters (${num(s.totalLines)} lines) were transmitted. Nothing was omitted.`;

  if (s.diagnostics.length) {
    out += `\nReported problems (${s.diagnostics.length}):\n${s.diagnostics.map((d) => `  - ${d}`).join("\n")}`;
  }

  const label = s.scope === "file" ? (s.truncated ? "File (truncated)" : "File (complete)") : "Selected code";
  out += `\n${label}:\n\`\`\`${lang}\n${s.code}\n\`\`\``;
  return out;
}

/**
 * Render the editor context with an explicit, honest `Content:` line.
 *
 * E-CTX-01: the model must never have to GUESS whether it is holding a whole file
 * or a fragment. A clean mid-file cut looks exactly like corruption — that is how a
 * perfectly valid 287 KB package-lock.json got reported as malformed JSON. State the
 * excerpt's true extent, and the model can reason correctly about what it cannot see.
 *
 * Exported for tests; the fence LABELS (`Selected code`, `File (truncated)`,
 * `File (complete)`) are a wire contract with pilot-api's parseEditorContext.
 */
export function renderEditorContext(c: WorkspaceContext): string {
  const file = c.relativeFilePath || c.activeFilePath;
  if (!file) return "";
  const lang = c.languageId || "";
  let out = `\n\n--- Editor context ---\nFile: ${file}${c.languageId ? ` (${c.languageId})` : ""}`;

  if (c.hasSelection && c.selectedTextPreview) {
    const code = sliceAtLineBoundary(c.selectedTextPreview, MAX_CONTEXT_CHARS);
    const cut = c.selectionTruncated || c.selectedTextPreview.length > MAX_CONTEXT_CHARS;
    const total = c.selectedTextLength || c.selectedTextPreview.length;
    out += cut
      ? `\nContent: TRUNCATED SELECTION — the first ${num(Math.min(c.selectedTextPreview.length, MAX_CONTEXT_CHARS))} of ${num(total)} selected characters. The rest of the selection was NOT sent.`
      : `\nContent: the operator's complete selection (${num(c.selectionLineCount)} line(s), ${num(total)} characters). This is the region they pointed at.`;
    out += `\nSelected code:\n\`\`\`${lang}\n${code}\n\`\`\``;
    return out;
  }

  if (c.filePreview) {
    const code = sliceAtLineBoundary(c.filePreview, MAX_CONTEXT_CHARS);
    const cut = c.filePreviewTruncated || c.filePreview.length > MAX_CONTEXT_CHARS;
    const shown = Math.min(c.filePreview.length, MAX_CONTEXT_CHARS);
    const total = c.fileCharCount || c.filePreview.length;
    if (cut) {
      const shownLines = code.split("\n").length;
      out +=
        `\nContent: TRUNCATED EXCERPT — the first ${num(shown)} of ${num(total)} characters` +
        `${c.fileLineCount ? ` (roughly lines 1-${num(shownLines)} of ${num(c.fileLineCount)})` : ""}.` +
        ` The rest of the file was NOT sent and this excerpt ends MID-FILE.` +
        ` It was cut at a LINE BOUNDARY, so every line shown is whole — but the file's structure is not closed.` +
        ` Unclosed brackets, braces or quotes at the end are an artifact of the cut, NOT a defect in the file.`;
      out += `\nFile (truncated):\n\`\`\`${lang}\n${code}\n\`\`\``;
    } else {
      out +=
        `\nContent: the COMPLETE file (${num(c.fileLineCount || code.split("\n").length)} lines, ` +
        `${num(total)} characters). Nothing was omitted.`;
      out += `\nFile (complete):\n\`\`\`${lang}\n${code}\n\`\`\``;
    }
  }
  return out;
}

/** Attachment rendering, shared by the legacy and the scope-resolved message paths. */
export function appendAttachments(msg: string, attachments: Attachment[]): string {
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

export function buildBackendMessage(text: string, c: WorkspaceContext, attachments: Attachment[]): string {
  let msg = text;
  const file = c.relativeFilePath || c.activeFilePath;
  if (file && !attachments.some((a) => a.kind === "file" || a.kind === "selection")) {
    msg += renderEditorContext(c);
  }
  return appendAttachments(msg, attachments);
}
