import * as vscode from "vscode";
import type { ExecutionPlan, PhaseUpdate } from "./pilotClient";

const SUGGESTIONS: Array<{ ic: string; label: string }> = [
  { ic: "📄", label: "Explain this file" },
  { ic: "🔍", label: "Find &amp; fix issues" },
  { ic: "✚", label: "Add tests" },
  { ic: "♻", label: "Refactor this code" },
  { ic: "👁", label: "Review my changes" },
  { ic: "🔌", label: "Create an API endpoint" },
];

export interface ChatHandlers {
  onUserMessage: (text: string) => void;
  onSetModel: (model: string) => void;
  onMention: () => void;
  onAttach: () => void;
  onSettings: () => void;
  onRemoveChip: (id: string) => void;
  onPasteImage: (dataUri: string, mime: string) => void;
  onUploadFile: (name: string, kind: string, content?: string, dataUri?: string) => void;
  onVoiceCapture: () => void;
}

/**
 * MigraPilot chat — a focused conversational assistant (Copilot/Claude style):
 * greeting, suggested actions, streaming-style "thinking → answer" turns with
 * markdown/code rendering, and a text/voice composer.
 */
export class ChatPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "migrapilot.chat";

  private view?: vscode.WebviewView;
  private ready = false;
  private seq = 0;
  private readonly pending: Array<Record<string, unknown>> = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly h: ChatHandlers
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.onDidDispose(() => { this.view = undefined; this.ready = false; });

    view.webview.onDidReceiveMessage((msg: { command: string; text?: string }) => {
      const m = msg as any;
      switch (m.command) {
        case "ready": this.ready = true; this.flush(); return;
        case "send": case "suggest": if (m.text) this.h.onUserMessage(m.text); return;
        case "setModel": if (m.text) this.h.onSetModel(m.text); return;
        case "mention": this.h.onMention(); return;
        case "attach": this.h.onAttach(); return;
        case "settings": this.h.onSettings(); return;
        case "removeChip": if (m.id) this.h.onRemoveChip(String(m.id)); return;
        case "pasteImage": if (m.dataUri) this.h.onPasteImage(String(m.dataUri), String(m.mime ?? "image/png")); return;
        case "uploadFile": this.h.onUploadFile(String(m.name ?? "file"), String(m.kind ?? "file"), m.content, m.dataUri); return;
        case "voiceCapture": this.h.onVoiceCapture(); return;
      }
    });
  }

  public focus(): void { this.view?.show?.(true); }
  public appendUser(text: string): void { this.post({ command: "appendUser", text }); }
  public reset(): void { this.post({ command: "reset" }); }
  public setModels(list: string[], current: string): void { this.post({ command: "models", list, current }); }
  public addChip(id: string, label: string, kind: string): void { this.post({ command: "addChip", id, label, kind }); }
  public clearChips(): void { this.post({ command: "clearChips" }); }

  /** show a pending assistant bubble; returns an id to complete later */
  public beginAssistant(): string {
    const id = `a${++this.seq}`;
    this.post({ command: "beginAssistant", id });
    return id;
  }
  public stepAssistant(id: string, title: string): void { this.post({ command: "step", id, title }); }
  /** Render the structured execution plan (pilot-api C.6.1) above the assistant's reply. */
  public planAssistant(id: string, plan: ExecutionPlan): void { this.post({ command: "plan", id, plan }); }
  /** Phase transition, or a per-step ✓ within the execution phase. */
  public phaseAssistant(id: string, update: PhaseUpdate): void { this.post({ command: "phase", id, update }); }
  public streamDelta(id: string, delta: string): void { this.post({ command: "streamDelta", id, delta }); }
  public completeAssistant(id: string, markdown: string): void {
    this.post({ command: "completeAssistant", id, text: markdown });
  }
  /** Drop a finished voice transcript into the composer for the user to review/edit. */
  public insertTranscript(text: string): void { this.post({ command: "transcript", text }); }
  /** Reflect voice state in the composer: "transcribing" | "idle" | "error". */
  public voiceStatus(state: string, message?: string): void { this.post({ command: "voiceStatus", state, message }); }

  private post(message: Record<string, unknown>): void {
    if (this.view && this.ready) { this.view.webview.postMessage(message); return; }
    this.pending.push(message);
  }
  private flush(): void {
    if (!this.view || !this.ready) return;
    for (const m of this.pending.splice(0)) this.view.webview.postMessage(m);
  }

  private html(webview: vscode.Webview): string {
    const nonce = nonce32();
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "cockpit.css"));
    const chips = SUGGESTIONS.map((s) => `<button class="chip" data-q="${s.label.replace(/&amp;/g, "&")}"><span class="ic">${s.ic}</span>${s.label}</button>`).join("");

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${css}" rel="stylesheet" />
<title>MigraPilot Chat</title>
</head><body class="chatbody">
  <div class="chat-head">
    <div class="logo" style="width:32px;height:32px;font-size:16px;">🤖</div>
    <div>
      <div class="title">MigraPilot <span class="badge">BETA</span></div>
      <div class="sub">Your AI engineering partner</div>
    </div>
    <div style="margin-left:auto; display:flex; gap:6px;">
      <button class="iconbtn" id="newChat" title="New chat">＋</button>
      <button class="iconbtn" id="settings" title="MigraPilot settings">⚙</button>
    </div>
  </div>

  <div class="modelbar">
    <span class="ic">✦</span>
    <select id="modelPicker" title="Model"><option value="">Auto (router picks)</option></select>
  </div>

  <div id="welcome">
    <div class="greet">👋 Ask me to write, refactor, debug, test, or explain code — I read your active file and selection for context.</div>
    <div class="section-label">Suggested</div>
    <div class="suggest">${chips}</div>
  </div>

  <div class="transcript" id="transcript"></div>

  <div class="composer">
    <div class="chips" id="chips"></div>
    <div class="row">
      <button class="iconbtn" id="mention" title="Add context (@ file / selection / symbol)">＠</button>
      <button class="iconbtn" id="attach" title="Attach a file, image, PDF, or script">📎</button>
      <input id="input" type="text" placeholder="Ask MigraPilot anything…" />
      <button class="iconbtn" id="mic" title="Voice">🎙</button>
      <button class="iconbtn send" id="send" title="Send">➤</button>
    </div>
    <div class="wave" id="wave" hidden></div>
  </div>
  <div class="foot">Powered by <b>MigraPilot</b></div>

  <input type="file" id="fileInput" multiple style="display:none" />

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const transcript = document.getElementById("transcript");
    const input = document.getElementById("input");
    const welcome = document.getElementById("welcome");

    function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

    /* Render the execution plan card from the structured plan object.
     * Glyphs are honest: ☐ pending, ▶ running, ✓ done, ✗ failed. A ✓ appears only when
     * the backend reports that step actually completed. */
    function planGlyph(status){
      if (status === "done") return "\\u2713";
      if (status === "running") return "\\u25b6";
      if (status === "failed") return "\\u2717";
      if (status === "skipped") return "\\u2013";
      return "\\u2610";
    }
    function renderPlan(card, plan){
      let h = "";
      if (plan.resolution) h += '<div class="plan-res">' + esc(plan.resolution).replace(/\\n/g,"<br>") + '</div>';
      h += '<div class="plan-title">' + esc(plan.title || "Execution Plan") + '</div>';
      h += '<ul class="plan-steps">';
      for (const s of (plan.steps || [])){
        h += '<li class="plan-step ' + esc(s.status) + '"><span class="g">' + planGlyph(s.status) + '</span> ' + esc(s.text) + '</li>';
      }
      h += '</ul>';
      if (plan.status === "dry_run"){
        h += '<div class="plan-foot"><span class="plan-badge">Dry Run</span> ' + esc(plan.note || "") + '</div>';
      }
      card.innerHTML = h;
    }

    // Minimal markdown: fenced code blocks + inline code + line breaks.
    function renderMarkdown(md){
      const parts = String(md||"").split(/\`\`\`/);
      let html = "";
      for (let i=0;i<parts.length;i++){
        if (i % 2 === 1){
          const body = parts[i].replace(/^[a-zA-Z0-9]*\\n/, "");
          html += '<div class="code-card"><pre>' + esc(body.replace(/\\n$/,"")) + '</pre></div>';
        } else {
          const inline = esc(parts[i]).replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\n/g, "<br>");
          if (inline.trim()) html += '<div class="text">' + inline + '</div>';
        }
      }
      return html || '<div class="text"></div>';
    }
    function hideWelcome(){ if (welcome) welcome.style.display = "none"; }
    function bubble(role, id){
      const wrap = document.createElement("div");
      wrap.className = "msg " + role; if (id) wrap.dataset.id = id;
      wrap.innerHTML = '<div class="av">' + (role==="user"?"You":"🤖") + '</div>' +
        '<div class="body"><div class="who">' + (role==="user"?"You":"MigraPilot") + '</div>' +
        '<div class="content"></div></div>';
      transcript.appendChild(wrap); transcript.scrollTop = transcript.scrollHeight;
      return wrap.querySelector(".content");
    }
    function send(){ const v = input.value.trim(); if (!v) return; input.value=""; vscode.postMessage({ command:"send", text:v }); }

    document.getElementById("send").addEventListener("click", send);
    input.addEventListener("keydown", (e)=>{ if (e.key==="Enter") send(); });
    document.getElementById("newChat").addEventListener("click", ()=> vscode.postMessage({ command:"send", text:"__new_chat__" }) );
    const picker = document.getElementById("modelPicker");
    picker.addEventListener("change", ()=> vscode.postMessage({ command:"setModel", text: picker.value || "auto" }));
    document.querySelectorAll(".chip").forEach((c)=> c.addEventListener("click", ()=> vscode.postMessage({ command:"suggest", text:c.dataset.q })) );

    // ── Voice input ──
    // VS Code webviews cannot use the microphone (platform permissions-policy limitation:
    // github.com/microsoft/vscode issues #250568, #113916). So the mic button opens an
    // external-browser recorder (where the mic works); it transcribes on the local
    // whisper backend and the transcript returns here via the extension's mailbox poll.
    const micBtn = document.getElementById("mic");
    const DEFAULT_PH = "Ask MigraPilot anything…";
    let voiceBusy = false;
    micBtn.addEventListener("click", ()=>{
      if (voiceBusy) return;
      voiceBusy = true; micBtn.classList.add("rec");
      vscode.postMessage({ command:"voiceCapture" });
    });
    function endVoice(){ voiceBusy = false; micBtn.classList.remove("rec"); }

    // ── context tags + attachments ──
    const chipsEl = document.getElementById("chips");
    document.getElementById("mention").addEventListener("click", ()=> vscode.postMessage({ command:"mention" }));
    document.getElementById("settings").addEventListener("click", ()=> vscode.postMessage({ command:"settings" }));

    // 📎 uploads from YOUR computer (client-side dialog, works through WSL/remote).
    const fileInput = document.getElementById("fileInput");
    document.getElementById("attach").addEventListener("click", ()=> fileInput.click());
    const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|markdown|txt|text|css|scss|less|html|htm|xml|svg|yml|yaml|toml|ini|env|sh|bash|zsh|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sql|csv|tsv|log|vue|svelte|astro|dockerfile|makefile|gradle|properties)$/i;
    function readAndUpload(file){
      const reader = new FileReader();
      if (file.type.indexOf("image/") === 0){
        reader.onload = ()=> vscode.postMessage({ command:"uploadFile", name:file.name, kind:"image", dataUri:String(reader.result) });
        reader.readAsDataURL(file);
      } else if (CODE_RE.test(file.name) || file.type.indexOf("text/") === 0 || file.type === "application/json" || file.type === ""){
        reader.onload = ()=> vscode.postMessage({ command:"uploadFile", name:file.name, kind:"file", content:String(reader.result) });
        reader.readAsText(file);
      } else {
        reader.onload = ()=> vscode.postMessage({ command:"uploadFile", name:file.name, kind:"binary", dataUri:String(reader.result) });
        reader.readAsDataURL(file);
      }
    }
    fileInput.addEventListener("change", (e)=>{
      const files = e.target.files || [];
      for (const f of files) readAndUpload(f);
      e.target.value = "";
    });
    function addChip(id, label, kind){
      const c = document.createElement("span"); c.className="attach-chip"; c.dataset.id=id;
      const icon = kind==="image" ? "🖼" : kind==="selection" ? "✂" : kind==="symbol" ? "❮❯" : "📄";
      c.innerHTML = '<span class="ck">'+icon+'</span><span class="cl">'+esc(label)+'</span><span class="rm" title="Remove">×</span>';
      c.querySelector(".rm").addEventListener("click", ()=>{ c.remove(); vscode.postMessage({ command:"removeChip", id: id }); });
      chipsEl.appendChild(c);
    }
    // paste an image from the clipboard → attach it (text paste stays native)
    input.addEventListener("paste", (e)=>{
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items){
        if (it.type && it.type.indexOf("image/") === 0){
          const file = it.getAsFile(); if (!file) continue;
          const reader = new FileReader();
          reader.onload = ()=> vscode.postMessage({ command:"pasteImage", dataUri: String(reader.result), mime: it.type });
          reader.readAsDataURL(file);
          e.preventDefault();
        }
      }
    });

    window.addEventListener("message", (e)=>{
      const m = e.data;
      if (m.command === "addChip"){ addChip(m.id, m.label, m.kind); return; }
      if (m.command === "clearChips"){ chipsEl.innerHTML = ""; return; }
      if (m.command === "transcript"){
        endVoice(); input.placeholder = DEFAULT_PH;
        const t = String(m.text||"").trim();
        if (t){ input.value = (input.value.trim() ? input.value.replace(/\\s*$/,"") + " " : "") + t; input.focus(); }
        return;
      }
      if (m.command === "voiceStatus"){
        if (m.state === "error"){ endVoice(); input.placeholder = "🎙 " + (m.message || "Voice failed"); setTimeout(()=>{ input.placeholder = DEFAULT_PH; }, 4500); }
        else if (m.state === "recording"){ input.placeholder = "🎙 Speak in the browser tab, click its mic when done…"; }
        else if (m.state === "transcribing"){ input.placeholder = "Transcribing…"; }
        else { endVoice(); input.placeholder = DEFAULT_PH; }
        return;
      }
      if (m.command === "models"){
        const opts = ['<option value="">Auto (router picks)</option>'].concat((m.list||[]).map(function(n){ return '<option value="'+esc(n)+'">'+esc(n)+'</option>'; }));
        picker.innerHTML = opts.join("");
        picker.value = (m.current && m.current !== "auto") ? m.current : "";
        return;
      }
      if (m.command === "reset"){ transcript.innerHTML=""; if(welcome) welcome.style.display=""; return; }
      if (m.command === "appendUser"){ hideWelcome(); bubble("user").innerHTML = renderMarkdown(m.text); }
      if (m.command === "beginAssistant"){ hideWelcome(); const c = bubble("assistant", m.id); c.dataset.raw=""; c.innerHTML = '<div class="step-line"></div><div class="plan-card" hidden></div><div class="text typing"><i></i><i></i><i></i></div>'; }
      if (m.command === "step"){
        const sl = transcript.querySelector('.msg[data-id="'+m.id+'"] .content .step-line');
        if (sl) sl.textContent = "· " + m.title;
      }
      /* ── Execution plan (pilot-api C.6.1) ──────────────────────────────────────
       * Rendered from the STRUCTURED plan event, not scraped from the prose, so the
       * steps are exact and each one can be ticked independently as it completes. */
      if (m.command === "plan"){
        const card = transcript.querySelector('.msg[data-id="'+m.id+'"] .content .plan-card');
        if (card && m.plan){ card.dataset.plan = JSON.stringify(m.plan); card.hidden = false; renderPlan(card, m.plan); }
      }
      if (m.command === "phase"){
        const el = transcript.querySelector('.msg[data-id="'+m.id+'"] .content');
        if (!el) return;
        const sl = el.querySelector(".step-line");
        const u = m.update || {};
        if (sl && u.label && !u.step) sl.textContent = "· " + u.label + (u.phase === "completion" ? "" : "…");
        const card = el.querySelector(".plan-card");
        if (card && card.dataset.plan && u.step){
          const plan = JSON.parse(card.dataset.plan);
          const step = (plan.steps || []).find(function(s){ return s.index === u.step; });
          // Only a real progress report may tick a step — never a guess.
          if (step && u.status){ step.status = u.status; card.dataset.plan = JSON.stringify(plan); renderPlan(card, plan); }
        }
      }
      if (m.command === "streamDelta"){
        const el = transcript.querySelector('.msg[data-id="'+m.id+'"] .content');
        if (el){
          el.dataset.raw = (el.dataset.raw||"") + m.delta;
          const sl = el.querySelector(".step-line"); const slHtml = sl ? sl.outerHTML : "";
          const pc = el.querySelector(".plan-card"); const pcHtml = pc ? pc.outerHTML : "";
          el.innerHTML = slHtml + pcHtml + '<div class="text">' + esc(el.dataset.raw).replace(/\\n/g,"<br>") + '</div>';
          transcript.scrollTop = transcript.scrollHeight;
        }
      }
      if (m.command === "completeAssistant"){
        const el = transcript.querySelector('.msg[data-id="'+m.id+'"] .content');
        if (el){
          // Keep the plan card — the final summary must not erase the plan the user approved against.
          const pc = el.querySelector(".plan-card"); const pcHtml = pc && !pc.hidden ? pc.outerHTML : "";
          el.innerHTML = pcHtml + renderMarkdown(m.text);
        } else { bubble("assistant").innerHTML = renderMarkdown(m.text); }
        transcript.scrollTop = transcript.scrollHeight;
      }
    });
    vscode.postMessage({ command:"ready" });
  </script>
</body></html>`;
  }
}

function nonce32(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let t = "";
  for (let i = 0; i < 32; i += 1) t += chars.charAt(Math.floor(Math.random() * chars.length));
  return t;
}
