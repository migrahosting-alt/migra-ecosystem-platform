// MigraPilot Shell — stylesheet.
//
// The ONLY place a tone becomes a colour, so the palette contract from §2 is
// enforced centrally:
//
//   info      electric blue  → active navigation, primary inspection
//   governed  orange         → Agent Mode, governance, proposals, approval-required
//   ok        green          → verified health, successful validation, trusted, completed
//   warn      amber          → expired / degraded / stale
//   error     red            → failure, rejection, blocked, destructive
//
// Surfaces are steel-gray / charcoal derived from the ACTIVE VS Code theme
// tokens, so the shell reads as part of the editor in any theme and honours the
// user's light/dark choice instead of hard-coding a dark canvas.

/** Palette accents. Each falls back to a VS Code chart/testing token first, so a
 * themed workbench drives the hue and the literal is only a last resort. */
const PALETTE = `
  --mp-accent: var(--vscode-charts-blue, #3794ff);
  --mp-accent-soft: color-mix(in srgb, var(--mp-accent) 14%, transparent);
  --mp-governed: var(--vscode-charts-orange, #e8912d);
  --mp-governed-soft: color-mix(in srgb, var(--mp-governed) 16%, transparent);
  --mp-ok: var(--vscode-testing-iconPassed, #3fb950);
  --mp-ok-soft: color-mix(in srgb, var(--mp-ok) 14%, transparent);
  --mp-warn: var(--vscode-editorWarning-foreground, #d7ba7d);
  --mp-warn-soft: color-mix(in srgb, var(--mp-warn) 16%, transparent);
  --mp-error: var(--vscode-testing-iconFailed, #f85149);
  --mp-error-soft: color-mix(in srgb, var(--mp-error) 14%, transparent);

  /* Steel / charcoal surfaces, all theme-derived. */
  --mp-canvas: var(--vscode-editor-background);
  --mp-panel: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  --mp-rail: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
  --mp-elevated: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background));
  --mp-border: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(128,128,128,0.28)));
  --mp-border-soft: var(--vscode-editorWidget-border, rgba(128,128,128,0.16));
  --mp-fg: var(--vscode-editor-foreground, var(--vscode-foreground));
  --mp-fg-dim: var(--vscode-descriptionForeground);
  --mp-radius: 6px;
  --mp-radius-lg: 8px;
  --mp-gap: 10px;
`;

export function shellStyles(): string {
  return `
:root {${PALETTE}}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--mp-fg);
  background: var(--mp-canvas);
  line-height: 1.45;
}

/* Never allow the page itself to scroll sideways (§15).
 *
 * The explicit single column below is required, not cosmetic: an implicit auto
 * column sizes to the children's max-content width, which — combined with
 * overflow hidden — would CLIP the regions at narrow widths instead of shrinking
 * them. minmax(0, 1fr) lets the column go below min-content, so every region
 * tracks the viewport exactly. */
#shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  height: 100vh;
  max-width: 100%;
  overflow: hidden;
}

/* ── Tone utilities ─────────────────────────────────────────────────────── */
.t-neutral { color: var(--mp-fg); }
.t-muted   { color: var(--mp-fg-dim); }
.t-info    { color: var(--mp-accent); }
.t-governed{ color: var(--mp-governed); }
.t-ok      { color: var(--mp-ok); }
.t-warn    { color: var(--mp-warn); }
.t-error   { color: var(--mp-error); }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid currentColor;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge.b-neutral { color: var(--mp-fg); border-color: var(--mp-border); }
.badge.b-muted   { color: var(--mp-fg-dim); border-color: var(--mp-border-soft); }
.badge.b-info    { color: var(--mp-accent);   background: var(--mp-accent-soft); }
.badge.b-governed{ color: var(--mp-governed); background: var(--mp-governed-soft); }
.badge.b-ok      { color: var(--mp-ok);       background: var(--mp-ok-soft); }
.badge.b-warn    { color: var(--mp-warn);     background: var(--mp-warn-soft); }
.badge.b-error   { color: var(--mp-error);    background: var(--mp-error-soft); }

.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }

.icon { width: 14px; height: 14px; flex: 0 0 auto; }
.icon svg { width: 100%; height: 100%; display: block; }

/* ── Header (§4) ────────────────────────────────────────────────────────── */
#hdr {
  display: flex;
  align-items: center;
  gap: var(--mp-gap);
  padding: 7px 10px;
  background: var(--mp-panel);
  border-bottom: 1px solid var(--mp-border);
  min-height: 38px;
}
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.brand img { width: 20px; height: 20px; border-radius: 4px; }
.brand .name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: .02em;
  background: linear-gradient(92deg, var(--mp-accent), var(--vscode-charts-purple, #b180d7));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  white-space: nowrap;
  /* Must be able to ellipsize: at sidebar width the header has to shrink rather
   * than clip the brand out of its box. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brand .subtitle {
  font-size: 11px;
  color: var(--mp-fg-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#hdr .spacer { flex: 1 1 auto; min-width: 0; }
#hdr-actions { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
}
button:disabled { cursor: default; opacity: .45; }

.hbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: var(--mp-radius);
  border: 1px solid var(--mp-border);
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--mp-fg);
  font-size: 11px;
  white-space: nowrap;
}
.hbtn:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.hbtn.a-governed { color: var(--mp-governed); border-color: color-mix(in srgb, var(--mp-governed) 55%, transparent); background: var(--mp-governed-soft); }
.hbtn.a-governed:hover:not(:disabled) { background: color-mix(in srgb, var(--mp-governed) 26%, transparent); }
.hbtn.a-info { color: var(--mp-accent); border-color: color-mix(in srgb, var(--mp-accent) 55%, transparent); background: var(--mp-accent-soft); }
.iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--mp-radius);
  color: var(--mp-fg-dim);
}
.iconbtn:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--mp-fg); }
.iconbtn[aria-pressed="true"] { color: var(--mp-accent); background: var(--mp-accent-soft); }

/* ── Tabs (§4) ──────────────────────────────────────────────────────────── */
#tabs {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: var(--mp-panel);
  border-bottom: 1px solid var(--mp-border);
  overflow-x: auto;
  scrollbar-width: none;
}
#tabs::-webkit-scrollbar { display: none; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  color: var(--mp-fg-dim);
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.tab:hover { color: var(--mp-fg); background: var(--vscode-list-hoverBackground); }
.tab[aria-selected="true"] {
  color: var(--mp-accent);
  border-bottom-color: var(--mp-accent);
  background: var(--mp-accent-soft);
  font-weight: 600;
}

/* ── Body grid: [nav drawer] main [context] ─────────────────────────────── */
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 288px;
  min-height: 0;
  overflow: hidden;
}
.body.ctx-collapsed { grid-template-columns: minmax(0, 1fr); }

#main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  background: var(--mp-canvas);
}

#context {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  border-left: 1px solid var(--mp-border);
  background: var(--mp-rail);
  padding: 10px 12px 16px;
}
.body.ctx-collapsed #context { display: none; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }

.tabpanel { display: none; }
.tabpanel.active { display: block; }

/* ── Panels & rows ──────────────────────────────────────────────────────── */
.panel { margin-bottom: 14px; }
.panel > h3 {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--mp-fg-dim);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rows { display: flex; flex-direction: column; }
.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 3px 0;
  font-size: 11.5px;
  border-bottom: 1px solid var(--mp-border-soft);
}
.row:last-child { border-bottom: none; }
/* The label must stay readable: the VALUE shrinks and wraps first. Without
 * min-width:0 on the value, its longest unbreakable token sets a min-content
 * floor that squeezes the label into an ellipsis. */
.row .k { flex: 0 0 auto; max-width: 55%; color: var(--mp-fg-dim); overflow-wrap: anywhere; }
.row .v { flex: 1 1 auto; min-width: 0; text-align: right; overflow-wrap: anywhere; font-weight: 500; }
.row .v.mono { font-family: var(--vscode-editor-font-family); font-size: 11px; }

.placeholder {
  font-size: 11.5px;
  color: var(--mp-fg-dim);
  padding: 9px 10px;
  border: 1px dashed var(--mp-border);
  border-radius: var(--mp-radius);
  background: var(--mp-elevated);
}
.placeholder .ph-actions { margin-top: 7px; }
.placeholder.s-disconnected, .placeholder.s-error { border-color: color-mix(in srgb, var(--mp-error) 45%, transparent); color: var(--mp-error); }
.placeholder.s-activation-required, .placeholder.s-unauthorized { border-color: color-mix(in srgb, var(--mp-governed) 50%, transparent); color: var(--mp-governed); }
.placeholder.s-degraded { border-color: color-mix(in srgb, var(--mp-warn) 50%, transparent); color: var(--mp-warn); }

.abtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: var(--mp-radius);
  border: 1px solid var(--mp-border);
  font-size: 11.5px;
  font-weight: 600;
  background: var(--vscode-button-secondaryBackground, transparent);
}
.abtn:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
.abtn.k-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.abtn.k-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.abtn.k-governed { background: var(--mp-governed); color: var(--vscode-editor-background); border-color: transparent; }
.abtn.k-governed:hover:not(:disabled) { filter: brightness(1.1); }
.abtn.k-danger { color: var(--mp-error); border-color: color-mix(in srgb, var(--mp-error) 45%, transparent); }
.abtn.k-danger:hover:not(:disabled) { background: var(--mp-error-soft); }

/* ── Welcome (§5) ───────────────────────────────────────────────────────── */
#welcome { padding: 10px 0 4px; }
.welcome-head { text-align: center; margin-bottom: 16px; }
.welcome-head .wlogo { display: flex; align-items: center; justify-content: center; gap: 9px; margin-bottom: 6px; }
.welcome-head .wlogo img { width: 26px; height: 26px; }
.welcome-head h2 { font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
.welcome-head p { font-size: 12.5px; color: var(--mp-fg-dim); }
.wcards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(196px, 1fr));
  gap: 9px;
  max-width: 780px;
  margin: 0 auto;
}
.wcard {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 11px 12px;
  border-radius: var(--mp-radius-lg);
  border: 1px solid var(--mp-border);
  background: var(--mp-panel);
  transition: border-color .12s, background .12s, transform .12s;
}
.wcard:hover { border-color: var(--mp-accent); background: var(--mp-elevated); transform: translateY(-1px); }
.wcard .wicon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--mp-radius);
  background: var(--mp-accent-soft);
  color: var(--mp-accent);
  flex: 0 0 auto;
}
.wcard.a-governed .wicon { background: var(--mp-governed-soft); color: var(--mp-governed); }
.wcard.a-governed:hover { border-color: var(--mp-governed); }
.wcard.a-neutral .wicon { background: var(--vscode-list-hoverBackground); color: var(--mp-fg-dim); }
.wcard .wtext { min-width: 0; display: flex; flex-direction: column; }
/* block, not inline: the subtitle must sit UNDER the title on every card,
 * regardless of how short the title happens to be. */
.wcard .wtitle { display: block; font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wcard .wsub { display: block; font-size: 11px; color: var(--mp-fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Message thread (§6) ────────────────────────────────────────────────── */
#thread { display: none; flex-direction: column; gap: 14px; }
#thread.active { display: flex; }
.msg { position: relative; max-width: 100%; }
.msg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.msg-head .av {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 4px; flex: 0 0 auto;
  /* Compact glyph: the accessible name is the adjacent sender label, so the
   * avatar is decorative and must never spill out of its box. */
  font-size: 9px; letter-spacing: 0; overflow: hidden;
}
.msg-head .ts { margin-left: auto; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--mp-fg-dim); }
.msg.user .av { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.msg.user .msg-head { color: var(--mp-fg-dim); }
.msg.assistant .av { background: var(--mp-accent-soft); color: var(--mp-accent); }
.msg.assistant .msg-head { color: var(--mp-accent); }
.msg-body {
  padding: 8px 12px;
  border-radius: var(--mp-radius);
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 12.5px;
}
.msg.user .msg-body {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--mp-border));
  white-space: pre-wrap;
}
.msg.assistant .msg-body {
  background: var(--mp-panel);
  border-left: 2px solid var(--mp-accent);
}
.msg-body p { margin: 5px 0; }
.msg-body p:first-child { margin-top: 0; }
.msg-body p:last-child { margin-bottom: 0; }
.msg-body ul, .msg-body ol { margin: 5px 0; padding-left: 20px; }
.msg-body h1 { font-size: 15px; margin: 9px 0 4px; }
.msg-body h2 { font-size: 13.5px; margin: 9px 0 4px; }
.msg-body h3 { font-size: 12.5px; margin: 8px 0 3px; }
.msg-body code {
  font-family: var(--vscode-editor-font-family);
  font-size: 11.5px;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.16));
  padding: 1px 5px;
  border-radius: 3px;
}
.msg-body pre {
  position: relative;
  margin: 7px 0;
  padding: 10px 12px;
  border-radius: var(--mp-radius);
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.14));
  border: 1px solid var(--mp-border-soft);
  overflow-x: auto;
  font-family: var(--vscode-editor-font-family);
  font-size: 11.5px;
}
.msg-body pre code { background: none; padding: 0; }
.msg-body blockquote { border-left: 2px solid var(--mp-accent); padding-left: 9px; margin: 5px 0; color: var(--mp-fg-dim); }
.msg-body table { border-collapse: collapse; margin: 7px 0; font-size: 11.5px; display: block; overflow-x: auto; max-width: 100%; }
.msg-body th, .msg-body td { border: 1px solid var(--mp-border); padding: 4px 8px; text-align: left; }
.msg-body a { color: var(--vscode-textLink-foreground); }
.msg-body hr { border: none; border-top: 1px solid var(--mp-border); margin: 9px 0; }
.copybtn {
  position: absolute; top: 4px; right: 4px;
  padding: 2px 6px; font-size: 10px;
  border-radius: 3px; border: 1px solid var(--mp-border);
  background: var(--mp-elevated); color: var(--mp-fg-dim);
  opacity: 0; transition: opacity .12s;
}
pre:hover .copybtn, .copybtn:focus-visible { opacity: 1; }

.fileref {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 7px; margin: 2px 3px 2px 0;
  border-radius: 4px; border: 1px solid var(--mp-border-soft);
  background: var(--mp-elevated); color: var(--mp-accent);
  font-family: var(--vscode-editor-font-family); font-size: 11px;
}

/* Tool activity */
.tool {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 10px; margin: 6px 0;
  font-size: 11px; color: var(--mp-fg-dim);
  border-radius: var(--mp-radius);
  background: var(--mp-elevated);
  border: 1px solid var(--mp-border-soft);
}
.tool .tname { font-family: var(--vscode-editor-font-family); font-weight: 700; color: var(--mp-accent); }
.tool .tstate { margin-left: auto; font-size: 10px; }
.spinner {
  width: 11px; height: 11px; flex: 0 0 auto;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: mp-spin .8s linear infinite;
}
@keyframes mp-spin { to { transform: rotate(360deg); } }
.cursor {
  display: inline-block; width: 6px; height: 13px;
  background: var(--mp-accent); margin-left: 2px; vertical-align: text-bottom;
  animation: mp-blink 1s step-end infinite;
}
@keyframes mp-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

.errbox {
  margin-top: 5px; padding: 6px 10px; font-size: 11.5px;
  color: var(--mp-error);
  border: 1px solid color-mix(in srgb, var(--mp-error) 45%, transparent);
  border-radius: var(--mp-radius);
  background: var(--mp-error-soft);
}

details.raw { margin-top: 6px; font-size: 11px; }
details.raw > summary { cursor: pointer; color: var(--mp-fg-dim); }
details.raw pre { max-height: 240px; overflow: auto; }

/* ── Agent progress (§7) ────────────────────────────────────────────────── */
.progress { margin: 8px 0; display: flex; flex-direction: column; gap: 3px; }
.stage { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
.stage .smark { width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.stage.s-complete { color: var(--mp-ok); }
.stage.s-active { color: var(--mp-accent); }
.stage.s-pending { color: var(--mp-fg-dim); }
.stage.s-skipped { color: var(--mp-fg-dim); opacity: .6; }
.stage.s-failed { color: var(--mp-error); }
/* The canonical event reason reads as part of the stage, not as a detached
 * right-hand column. */
.stage .sdetail { color: var(--mp-fg-dim); font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage .sdetail::before { content: '— '; }

/* ── Proposal card (§8) ─────────────────────────────────────────────────── */
.pcard {
  border: 1px solid color-mix(in srgb, var(--mp-governed) 45%, transparent);
  border-left-width: 3px;
  border-radius: var(--mp-radius-lg);
  background: var(--mp-panel);
  overflow: hidden;
  margin: 10px 0;
}
/* A non-governed card: same structure, neutral accent — used when the semantic
 * index needs no approval, so orange stays reserved for governance. */
.pcard-quiet { border-color: var(--mp-border); }
.pcard-quiet .pcard-head { background: var(--mp-elevated); }
.pcard-quiet .pcard-head .ptitle { color: var(--mp-fg-dim); }

.pcard-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 9px 12px;
  background: var(--mp-governed-soft);
  border-bottom: 1px solid var(--mp-border);
}
.pcard-head .ptitle { font-size: 11.5px; font-weight: 800; letter-spacing: .05em; color: var(--mp-governed); }
.pcard-head .pid { font-family: var(--vscode-editor-font-family); font-size: 10.5px; color: var(--mp-fg-dim); }
.pcard-head .pspacer { flex: 1 1 auto; }
.pcard-sec { padding: 9px 12px; border-bottom: 1px solid var(--mp-border-soft); }
.pcard-sec:last-child { border-bottom: none; }
.pcard-sec > h4 {
  font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
  color: var(--mp-fg-dim); margin-bottom: 5px;
}
.pcard-task { font-size: 12.5px; }
.pnote { font-size: 11.5px; color: var(--mp-fg-dim); }
.effect { display: flex; gap: 7px; font-size: 11.5px; padding: 2px 0; }
.effect .ebullet { color: var(--mp-accent); }
.vcheck { display: flex; align-items: center; gap: 7px; font-size: 11.5px; padding: 1px 0; }
.vcheck.o-passed { color: var(--mp-ok); }
.vcheck.o-failed { color: var(--mp-error); }
.vcheck.o-planned { color: var(--mp-fg-dim); }
.vnot-run {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--mp-warn);
}
.warnrow { display: flex; gap: 7px; font-size: 11.5px; color: var(--mp-warn); padding: 2px 0; }
.pcard-actions { display: flex; gap: 7px; flex-wrap: wrap; padding: 10px 12px; background: var(--mp-elevated); }
.pcard-actions .abtn { flex: 1 1 auto; justify-content: center; min-width: 118px; }
.evidence-note {
  display: flex; align-items: flex-start; gap: 7px;
  font-size: 11px; color: var(--mp-fg-dim);
  padding: 7px 10px; margin: 8px 0;
  border-left: 2px solid var(--mp-border);
  background: var(--mp-elevated);
  border-radius: 0 var(--mp-radius) var(--mp-radius) 0;
}

/* ── History list ───────────────────────────────────────────────────────── */
.hrow {
  display: flex; flex-direction: column; gap: 5px;
  padding: 9px 11px; margin-bottom: 7px;
  border: 1px solid var(--mp-border);
  border-radius: var(--mp-radius);
  background: var(--mp-panel);
  width: 100%;
  text-align: left;
}
.hrow:hover { border-color: var(--mp-accent); }
.hrow[aria-current="true"] { border-color: var(--mp-accent); background: var(--mp-accent-soft); }
.hrow .htop { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hrow .hrecipe { font-family: var(--vscode-editor-font-family); font-size: 11.5px; font-weight: 700; }
.hrow .hage { margin-left: auto; font-size: 10.5px; color: var(--mp-fg-dim); }
.hrow .hbadges { display: flex; gap: 5px; flex-wrap: wrap; }
.timeline { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.tline {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 8px;
  font-size: 11px;
  padding: 3px 0;
  border-bottom: 1px solid var(--mp-border-soft);
}
.tline .tseq { color: var(--mp-fg-dim); font-family: var(--vscode-editor-font-family); }
.tline .ttrans { font-family: var(--vscode-editor-font-family); }
.tline .tsrc { color: var(--mp-fg-dim); }

/* ── Conversation list (nav drawer) ─────────────────────────────────────── */
.crow {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  padding: 6px 9px; border-radius: var(--mp-radius);
  font-size: 12px; color: var(--mp-fg);
  border: 1px solid transparent;
}
.crow:hover { background: var(--vscode-list-hoverBackground); }
.crow[aria-current="true"] {
  background: var(--mp-accent-soft);
  border-color: color-mix(in srgb, var(--mp-accent) 45%, transparent);
  color: var(--mp-accent);
  font-weight: 600;
}
.crow .ctitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crow .cage { font-size: 10px; color: var(--mp-fg-dim); }

/* ── Composer (§11) ─────────────────────────────────────────────────────── */
#composer {
  padding: 8px 12px 10px;
  background: var(--mp-panel);
  border-top: 1px solid var(--mp-border);
}
#chips { display: none; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
#chips.has { display: flex; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 6px 2px 5px; border-radius: 4px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-size: 10.5px; max-width: 190px;
}
.chip .cname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip img { width: 15px; height: 15px; border-radius: 2px; object-fit: cover; }
.chip button { color: inherit; opacity: .7; line-height: 1; padding: 0 2px; }
.chip button:hover { opacity: 1; }

#cbox {
  position: relative;
  border: 1px solid var(--vscode-input-border, var(--mp-border));
  border-radius: var(--mp-radius-lg);
  background: var(--vscode-input-background);
  padding: 7px 9px 5px;
}
#cbox:focus-within { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
#cinput {
  display: block;
  width: 100%;
  min-height: 22px;
  max-height: 40vh;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-font-family);
  font-size: 12.5px;
  line-height: 1.5;
  overflow-y: auto;
}
#cinput::placeholder { color: var(--vscode-input-placeholderForeground); }
#ctools { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
#ctools .spacer { flex: 1 1 auto; }
.ctool {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px; border-radius: var(--mp-radius);
  font-size: 11px; color: var(--mp-fg-dim);
}
.ctool:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--mp-fg); }
.ctool.recording { color: var(--mp-error); animation: mp-pulse 1s ease-in-out infinite; }
@keyframes mp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
/* Every composer select, not one by id: styling a single id left the evidence
   selector as a NATIVE WHITE control against the dark shell. Selector-per-id is
   how that happened, so this rule is deliberately shared. */
#croute, #csource {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
  border: 1px solid var(--vscode-dropdown-border, var(--mp-border));
  border-radius: var(--mp-radius);
  font-family: var(--vscode-font-family);
  font-size: 11px;
  padding: 3px 6px;
  max-width: 190px;
  /* Suppress the platform chrome that made it read as a foreign widget. */
  appearance: none;
  -webkit-appearance: none;
}
/* A GOVERNANCE mode reads as one rather than as an ordinary model preference.
   workspace and none are governance states too (none withholds repository access
   entirely), so they get the same deliberate treatment as approved rather than the
   neutral look of a routing tweak. */
#csource[data-mode="approved"],
#csource[data-mode="workspace"],
#csource[data-mode="none"] {
  border-color: var(--mp-accent, var(--vscode-focusBorder));
  color: var(--vscode-textLink-foreground, var(--vscode-dropdown-foreground));
  font-weight: 600;
}
/* none is the most restrictive state, so it is visually the loudest. */
#csource[data-mode="none"] {
  border-color: var(--mp-warn, var(--vscode-editorWarning-foreground, var(--vscode-focusBorder)));
  color: var(--mp-warn, var(--vscode-editorWarning-foreground, var(--vscode-textLink-foreground)));
}
#croute:focus-visible, #csource:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
#csend {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 26px; border-radius: var(--mp-radius);
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
#csend:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
#cstop {
  display: none; align-items: center; justify-content: center;
  width: 28px; height: 26px; border-radius: var(--mp-radius);
  background: var(--mp-error); color: var(--vscode-editor-background);
}
#cstop.show { display: inline-flex; }
#chint { font-size: 10.5px; color: var(--mp-fg-dim); margin-top: 5px; min-height: 13px; }
#chint.warn { color: var(--mp-warn); }
#cfile { display: none; }

#palette {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0; right: 0;
  max-height: 244px; overflow-y: auto;
  background: var(--mp-elevated);
  border: 1px solid var(--mp-border);
  border-radius: var(--mp-radius);
  box-shadow: 0 6px 20px rgba(0,0,0,.32);
  z-index: 40;
  padding: 4px 0;
}
#palette.open { display: block; }
#palette .phead { padding: 4px 10px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--mp-fg-dim); }
.pitem { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 5px 10px; font-size: 11.5px; }
.pitem:hover, .pitem[aria-selected="true"] { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); }
.pitem .pname { font-family: var(--vscode-editor-font-family); font-weight: 700; color: var(--mp-accent); }
.pitem .pargs { color: var(--mp-fg-dim); font-size: 10.5px; }
.pitem .pdesc { margin-left: auto; color: var(--mp-fg-dim); font-size: 10.5px; }

/* ── Status row (§12) ───────────────────────────────────────────────────── */
#statusrow {
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
  padding: 4px 12px;
  font-size: 10.5px;
  background: var(--vscode-statusBar-background, var(--mp-rail));
  color: var(--vscode-statusBar-foreground, var(--mp-fg-dim));
  border-top: 1px solid var(--mp-border);
}
#statusrow .sitem { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#statusrow .sitem .sk { opacity: .75; }

/* ── Navigation drawer (narrow only) ────────────────────────────────────── */
#nav-toggle, #nav-drawer { display: none; }
#nav-drawer {
  padding: 10px 12px;
  background: var(--mp-rail);
  border-bottom: 1px solid var(--mp-border);
  max-height: 42vh;
  overflow-y: auto;
}
#nav-drawer.open { display: block; }
.navsec { margin-bottom: 12px; }
.navsec > h3 {
  font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--mp-fg-dim); margin-bottom: 5px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.navbtn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; text-align: left;
  padding: 5px 9px; border-radius: var(--mp-radius);
  font-size: 12px;
}
.navbtn:hover { background: var(--vscode-list-hoverBackground); }
/* An information row is not a control: no hover affordance, no dimming. */
.navstatic { cursor: default; }
.navstatic:hover { background: transparent; }
.navbtn .count {
  margin-left: auto; min-width: 18px; text-align: center;
  padding: 0 5px; border-radius: 9px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-size: 10px; font-weight: 700;
}
.navbtn .count.governed { background: var(--mp-governed); color: var(--vscode-editor-background); }
.newchat {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 7px; margin-bottom: 10px;
  border-radius: var(--mp-radius);
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  font-size: 12px; font-weight: 700;
}
.newchat:hover { background: var(--vscode-button-hoverBackground); }

/* ── Focus ring: always visible, never removed (§15) ────────────────────── */
:focus-visible {
  outline: 2px solid var(--vscode-focusBorder);
  outline-offset: 1px;
  border-radius: 3px;
}

.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* ── Responsive (§16) ───────────────────────────────────────────────────── */

/* Medium: right context panel becomes a toggleable drawer below the header. */
@media (max-width: 1000px) {
  .body { grid-template-columns: minmax(0, 1fr); }
  #context {
    display: none;
    border-left: none;
    border-bottom: 1px solid var(--mp-border);
  }
  .body.ctx-open #context {
    display: block;
    grid-row: 1;
    max-height: 46vh;
  }
  .body.ctx-open #main { grid-row: 2; }
  .body { grid-template-rows: auto minmax(0, 1fr); }
}

/* Narrow: chat is the primary content; navigation and context are drawers,
 * proposal actions stack, and the header compacts. */
@media (max-width: 640px) {
  #shell { grid-template-rows: auto auto auto minmax(0, 1fr) auto auto; }
  #nav-toggle { display: inline-flex; }
  .brand .subtitle { display: none; }
  #hdr { gap: 6px; padding: 6px 8px; }
  #hdr-actions .hbtn .hlabel { display: none; }
  #hdr-actions .hbtn { padding: 4px 7px; }
  #main { padding: 10px; }
  .tab { padding: 6px 10px; font-size: 11.5px; }
  .tab .tablabel { font-size: 11.5px; }
  .pcard-actions { flex-direction: column; }
  .pcard-actions .abtn { width: 100%; }
  .wcards { grid-template-columns: 1fr; }
  #statusrow { gap: 8px; font-size: 10px; }
}

/* Very narrow (standard VS Code sidebar width): drop non-essential chrome but
 * keep every control reachable. */
@media (max-width: 420px) {
  .brand .name { font-size: 12.5px; }
  .tab .tablabel { display: none; }
  .tab { padding: 6px 12px; }
  #statusrow .sitem .sk { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  .cursor { animation: none; opacity: 1; }
}

@media (forced-colors: active) {
  .badge, .wcard, .pcard, .hrow, .abtn, .hbtn { border: 1px solid CanvasText; }
  .tab[aria-selected="true"] { border-bottom-color: Highlight; }
}
`;
}
