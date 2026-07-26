// MigraPilot Shell — document skeleton.
//
// Static structure only: the header, tab strip, three regions, composer and
// status row. All dynamic content is filled in by `shellScript.ts` from state the
// extension host posts, so this file contains no runtime data and therefore no
// path for backend material to be baked into the HTML.

import { icon } from './icons.js';
import { COMPOSER_PLACEHOLDER, ROUTING_OPTIONS, SOURCE_MODE_OPTIONS } from './composerModel.js';
import { HEADER_ACTIONS, SHELL_SUBTITLE, SHELL_TITLE, WELCOME_ACTIONS, WELCOME_SUBTITLE } from './welcomeModel.js';
import { SHELL_TABS, type ShellTabId } from './navigationModel.js';
import { shellStyles } from './shellStyles.js';

export interface ShellHtmlOptions {
  nonce: string;
  /** Content-Security-Policy header value built by the host. */
  csp: string;
  /** `asWebviewUri` of the bundled brand mark, or undefined when unavailable. */
  logoUri?: string;
  /** Tab selected on first paint. */
  initialTab: ShellTabId;
  /** The exact script to inline (already nonce-guarded by the caller). */
  script: string;
  /** Compact mode hint for a narrow host (sidebar) — CSS still decides layout. */
  compact: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ACCEPTED_FILES =
  'image/*,.txt,.md,.json,.jsonc,.csv,.tsv,.yaml,.yml,.toml,.ini,.env,.log,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.sh,.sql,.diff,.patch,.pdf';

function brandMark(logoUri: string | undefined, size: 'sm' | 'lg'): string {
  if (logoUri) {
    return `<img src="${escapeHtml(logoUri)}" alt="" width="${size === 'lg' ? 26 : 20}" height="${size === 'lg' ? 26 : 20}" />`;
  }
  // No bundled asset available — fall back to the rocket glyph rather than a
  // broken image, keeping the header intact.
  return icon('rocket');
}

function tabStrip(initialTab: ShellTabId): string {
  return SHELL_TABS.map(
    (tab) => `<button class="tab" role="tab" id="tabbtn-${tab.id}" data-tab="${tab.id}"
        aria-selected="${tab.id === initialTab ? 'true' : 'false'}"
        aria-controls="panel-${tab.id}" tabindex="${tab.id === initialTab ? '0' : '-1'}">
        ${icon(tab.icon)}<span class="tablabel">${escapeHtml(tab.label)}</span>
      </button>`,
  ).join('');
}

function headerActions(): string {
  return HEADER_ACTIONS.map(
    (action) => `<button class="hbtn a-${action.accent}" data-header-action="${action.id}" title="${escapeHtml(action.label)}">
        ${icon(action.icon)}<span class="hlabel">${escapeHtml(action.label)}</span>
      </button>`,
  ).join('');
}

function welcomeCards(): string {
  return WELCOME_ACTIONS.map(
    (action) => `<button class="wcard a-${action.accent}" data-welcome="${action.id}">
        <span class="wicon">${icon(action.icon)}</span>
        <span class="wtext">
          <span class="wtitle">${escapeHtml(action.title)}</span>
          <span class="wsub">${escapeHtml(action.subtitle)}</span>
        </span>
      </button>`,
  ).join('');
}

function routingOptions(): string {
  return ROUTING_OPTIONS.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('');
}

/** Evidence-source selector — the visible half of the approved-only boundary.
 * Without it the mode is reachable only via `/approved`, which is discoverable
 * but not obvious, and an operator cannot SEE which source the next turn is
 * held to. */
function sourceModeOptions(): string {
  return SOURCE_MODE_OPTIONS.map(
    (option) => `<option value="${option.value}" title="${escapeHtml(option.hint)}">${escapeHtml(option.label)}</option>`,
  ).join('');
}

export function shellHtml(options: ShellHtmlOptions): string {
  const { nonce, csp, logoUri, initialTab, script, compact } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(SHELL_TITLE)}</title>
<style>${shellStyles()}</style>
</head>
<body class="${compact ? 'compact' : 'roomy'}">
<div id="shell" data-initial-tab="${initialTab}">

  <header id="hdr">
    <button class="iconbtn" id="nav-toggle" aria-expanded="false" aria-controls="nav-drawer" title="Navigation">${icon('menu')}</button>
    <span class="brand">
      ${brandMark(logoUri, 'sm')}
      <span class="name">${escapeHtml(SHELL_TITLE)}</span>
      <span class="subtitle">${escapeHtml(SHELL_SUBTITLE)}</span>
    </span>
    <span id="brain-badge" class="badge b-muted" role="status" aria-live="polite"><span class="dot"></span><span id="brain-badge-text">Checking…</span></span>
    <span class="spacer"></span>
    <span id="hdr-actions">${headerActions()}</span>
    <button class="iconbtn" id="ctx-toggle" aria-pressed="true" aria-controls="context" title="Toggle context panel">${icon('layout-sidebar-right')}</button>
  </header>

  <div id="tabs" role="tablist" aria-label="MigraPilot surfaces">${tabStrip(initialTab)}</div>

  <div class="body" id="body">

    <aside id="nav-drawer" aria-label="MigraPilot navigation">
      <button class="newchat" data-shell-action="newChat">${icon('add')}<span>New Chat</span></button>
      <section class="navsec"><h3><span>Conversations</span></h3><div id="nav-conversations"></div></section>
      <section class="navsec"><h3><span>Agent Mode</span><span id="nav-agent-status" class="badge b-muted">OFF</span></h3><div id="nav-agent"></div></section>
      <section class="navsec"><h3><span>Workspace</span></h3><div id="nav-workspace"></div></section>
      <section class="navsec"><h3><span>Tools &amp; Services</span></h3><div id="nav-tools"></div></section>
    </aside>

    <main id="main">

      <section class="tabpanel" id="panel-chat" role="tabpanel" aria-labelledby="tabbtn-chat" tabindex="0">
        <div id="welcome">
          <div class="welcome-head">
            <div class="wlogo">${brandMark(logoUri, 'lg')}<h2>${escapeHtml(SHELL_TITLE)}</h2></div>
            <p>${escapeHtml(WELCOME_SUBTITLE)}</p>
          </div>
          <div class="wcards">${welcomeCards()}</div>
        </div>
        <div id="thread" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></div>
        <div id="chat-agent"></div>
      </section>

      <section class="tabpanel" id="panel-agent" role="tabpanel" aria-labelledby="tabbtn-agent" tabindex="0">
        <div id="agent-workspace"></div>
      </section>

      <section class="tabpanel" id="panel-diff" role="tabpanel" aria-labelledby="tabbtn-diff" tabindex="0">
        <div id="run-diff"></div>
      </section>

      <section class="tabpanel" id="panel-audit" role="tabpanel" aria-labelledby="tabbtn-audit" tabindex="0">
        <div id="audit-trail"></div>
      </section>

      <section class="tabpanel" id="panel-workspace" role="tabpanel" aria-labelledby="tabbtn-workspace" tabindex="0">
        <div id="workspace-tab"></div>
      </section>

    </main>

    <aside id="context" aria-label="Workspace and run context">
      <div id="ctx-workspace" class="panel"></div>
      <div id="ctx-brain" class="panel"></div>
      <div id="ctx-agent" class="panel"></div>
      <div id="ctx-run" class="panel"></div>
      <div id="ctx-files" class="panel"></div>
      <div id="ctx-activity" class="panel"></div>
    </aside>

  </div>

  <div id="composer">
    <div id="chips" aria-label="Staged attachments"></div>
    <div id="cbox">
      <div id="palette" role="listbox" aria-label="Slash commands"><div class="phead">Commands</div><div id="palette-items"></div></div>
      <label class="sr-only" for="cinput">Message MigraPilot</label>
      <textarea id="cinput" rows="1" placeholder="${escapeHtml(COMPOSER_PLACEHOLDER)}"
        aria-describedby="chint" aria-multiline="true"></textarea>
      <div id="ctools">
        <button class="ctool" id="cattach" title="Attach files">${icon('paperclip')}<span>Attach</span></button>
        <button class="ctool" id="ccontext" title="Add workspace files to context">${icon('mention')}<span>Context</span></button>
        <button class="ctool" id="cmic" title="Voice input">${icon('mic')}<span>Voice</span></button>
        <button class="ctool" id="ccmd" title="Slash commands">${icon('terminal-cmd')}<span>Commands</span></button>
        <span class="spacer"></span>
        <label class="sr-only" for="csource">Evidence source</label>
        <select id="csource" title="Where answers may draw evidence from">${sourceModeOptions()}</select>
        <label class="sr-only" for="croute">Model routing</label>
        <select id="croute" title="Model routing for the next message">${routingOptions()}</select>
        <button id="csend" title="Send (Enter)" aria-label="Send message">${icon('send')}</button>
        <button id="cstop" title="Stop generating" aria-label="Stop generating">${icon('stop')}</button>
      </div>
    </div>
    <div id="chint" role="status" aria-live="polite"></div>
    <input type="file" id="cfile" multiple accept="${ACCEPTED_FILES}" tabindex="-1" aria-hidden="true" />
  </div>

  <div id="statusrow" role="status" aria-live="off"></div>

</div>
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
