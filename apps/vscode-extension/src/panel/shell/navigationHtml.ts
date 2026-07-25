// MigraPilot Shell — the sidebar NAVIGATION surface (§3, left region).
//
// In the approved mockup the left column is the VS Code sidebar, not a column
// inside the editor panel. This file renders exactly that region, driven by the
// SAME authoritative `ShellState` the Studio panel receives, so the two surfaces
// can never disagree.
//
// It reuses the core + regions script fragments, so the navigation renderer is
// literally the same code in both surfaces.

import { icon } from './icons.js';
import { coreScript } from './script/core.js';
import { regionsScript } from './script/regions.js';
import { injectStaticData } from './shellScript.js';
import { shellStyles } from './shellStyles.js';
import { navListActions, navPrimaryAction } from './navigationModel.js';
import { SHELL_TITLE } from './welcomeModel.js';

export interface NavigationHtmlOptions {
  nonce: string;
  csp: string;
  logoUri?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Composed navigation client: core helpers + the shared region renderers. */
export function navigationScript(): string {
  return injectStaticData([
    '(function () {',
    "'use strict';",
    coreScript(),
    regionsScript(),
    String.raw`
initDelegates();
initKeyboard();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'state') return;
  SHELL = message.state;
  /* renderNavigation first (it owns the shared sections), then the launcher
   * counts, so the launcher's richer badge state wins.
   *
   * NOTE: the context-panel renderer is intentionally NOT part of this bundle —
   * see script/contextPanels.ts. The launcher only needs the header badge. */
  renderNavigation(SHELL.nav);
  renderLauncherCounts(SHELL.nav.agentMode);
  renderBrainBadge(SHELL.context);
  const identity = SHELL.nav.identity;
  setText('nav-identity', identity.workspaceName ? identity.product + ' · ' + identity.workspaceName : identity.product);
});

/* Launcher rows dispatch by id; the HOST decides whether that means revealing a
 * Command Center tab or running an existing command. The sidebar therefore never
 * renders a composer, an approval control, or a history execution path itself. */
document.addEventListener('click', (event) => {
  const row = event.target.closest('[data-nav-action]');
  if (row) vscode.postMessage({ type: 'navAction', action: row.dataset.navAction });
});

vscode.postMessage({ type: 'ready' });
`,
    '})();',
  ].join('\n'));
}

/**
 * One section of launcher rows, rendered statically: the target commands are
 * always registered and the Command Center tabs always exist, so availability
 * needs no backend state. Counts are filled in from live state at runtime.
 */
function actionRows(group: 'agent' | 'service'): string {
  return navListActions(group)
    .map(
      (action) => `<button class="navbtn" data-nav-action="${escapeHtml(action.id)}" title="${escapeHtml(action.label)}">
        ${icon(action.icon)}<span>${escapeHtml(action.label)}</span>
        ${action.counter ? `<span class="count" data-counter="${escapeHtml(action.counter)}" hidden></span>` : ''}
      </button>`,
    )
    .join('');
}

/** The single prominent entry point into the canonical interface (§7). */
function primaryAction(): string {
  const action = navPrimaryAction();
  return `<button class="newchat" data-nav-action="${escapeHtml(action.id)}">
      ${icon(action.icon)}<span>${escapeHtml(action.label)}</span>
    </button>`;
}

export function navigationHtml(options: NavigationHtmlOptions): string {
  const { nonce, csp, logoUri } = options;
  const brand = logoUri
    ? `<img src="${escapeHtml(logoUri)}" alt="" width="18" height="18" />`
    : icon('rocket');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${shellStyles()}
/* Sidebar-specific: the navigation is the whole document here. */
html, body { overflow: auto; height: auto; }
body { padding: 8px 10px 12px; background: var(--mp-rail); }
#navhdr { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
#navhdr .name { font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
#navhdr .spacer { flex: 1 1 auto; }
#navfoot { margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--mp-border); display: flex; align-items: center; gap: 8px; }
#navfoot #nav-identity { font-size: 10.5px; color: var(--mp-fg-dim); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The status summary (§12) belongs to the Studio panel and to VS Code's own
 * status bar. Repeating it here would duplicate what the sections above already
 * show, so the navigation surface omits it. */
</style>
</head>
<body>
  <div id="navhdr">
    ${brand}
    <span class="name">${escapeHtml(SHELL_TITLE)}</span>
    <span class="spacer"></span>
    <span id="brain-badge" class="badge b-muted" role="status" aria-live="polite"><span class="dot"></span><span id="brain-badge-text">Checking…</span></span>
    <button class="iconbtn" data-shell-action="refreshContext" title="Refresh">${icon('sync')}</button>
  </div>

  ${primaryAction()}

  <section class="navsec">
    <h3><span>Agent Mode</span><span id="nav-agent-status" class="badge b-muted">OFF</span></h3>
    <div id="nav-agent-actions">${actionRows('agent')}</div>
  </section>
  <section class="navsec"><h3><span>Workspace</span></h3><div id="nav-workspace"></div></section>
  <section class="navsec"><h3><span>Tools &amp; Services</span></h3><div id="nav-tools"></div></section>
  <section class="navsec">
    <h3><span>Service</span></h3>
    <div id="nav-service-actions">${actionRows('service')}</div>
  </section>

  <div id="navfoot">
    <span id="nav-identity">MigraTeck · MigraPilot</span>
    <button class="iconbtn" data-shell-action="settings" title="MigraPilot settings">${icon('gear')}</button>
  </div>

<script nonce="${nonce}">${navigationScript()}</script>
</body>
</html>`;
}
