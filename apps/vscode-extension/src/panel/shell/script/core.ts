// MigraPilot Shell — webview script: core runtime.
//
// Bootstrap, the state store, generic renderers for the shared display
// vocabulary (rows / badges / panels / actions / placeholders), tab + drawer
// behaviour, and the global keyboard map.
//
// Written with String.raw and plain string concatenation (never a nested
// template literal) so the fragment survives being embedded in a TypeScript
// template without escape ambiguity, exactly like `agentModeWebviewScript`.

export function coreScript(): string {
  return String.raw`
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

/* Authoritative shell state, replaced wholesale by the host. Never mutated
 * locally to imply a backend fact. */
let SHELL = null;
/* Chat transcript is webview-owned presentation state (the engine owns history). */
let messages = [];
let activeTab = ($('shell') && $('shell').dataset.initialTab) || 'chat';
let streaming = false;
let dispatching = false;

/* The SAME icon map the host-rendered HTML uses, injected as data by
 * shellScript. Sharing it means a model can reference any icon id and get the
 * real glyph, in either surface, with no duplicated table to drift. */
const ICONS = ICON_PATHS_JSON;

function svg(name) {
  return '<span class="icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false">' + (ICONS[name] || ICONS.circle) + '</svg></span>';
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Generic renderers over the shared display vocabulary ───────────────── */

function badgeHtml(badge) {
  if (!badge) return '';
  const title = badge.title ? ' title="' + esc(badge.title) + '"' : '';
  return '<span class="badge b-' + esc(badge.tone) + '"' + title + '>' + esc(badge.text) + '</span>';
}

function rowsHtml(rows) {
  if (!rows || !rows.length) return '';
  let html = '<div class="rows">';
  for (const row of rows) {
    html += '<div class="row"><span class="k">' + esc(row.label) + '</span>'
      + '<span class="v ' + (row.mono ? 'mono ' : '') + 't-' + esc(row.tone || 'neutral') + '">' + esc(row.value) + '</span></div>';
  }
  return html + '</div>';
}

function actionsHtml(actions, scope) {
  if (!actions || !actions.length) return '';
  let html = '<div class="pcard-actions">';
  for (const action of actions) {
    const reason = action.disabled && action.disabledReason ? ' title="' + esc(action.disabledReason) + '"' : '';
    const describedBy = action.disabled && action.disabledReason ? ' aria-description="' + esc(action.disabledReason) + '"' : '';
    html += '<button class="abtn k-' + esc(action.kind) + '" data-' + esc(scope) + '="' + esc(action.id) + '"'
      + (action.disabled ? ' disabled' : '') + reason + describedBy + '>'
      + (action.icon ? svg(action.icon) : '') + '<span>' + esc(action.label) + '</span></button>';
  }
  return html + '</div>';
}

function placeholderHtml(placeholder) {
  if (!placeholder) return '';
  let html = '<div class="placeholder s-' + esc(placeholder.state) + '" role="note">' + esc(placeholder.message);
  if (placeholder.retryCommand) {
    html += '<div class="ph-actions"><button class="abtn" data-shell-action="' + esc(placeholder.retryCommand) + '">'
      + esc(placeholder.retryLabel || 'Retry') + '</button></div>';
  }
  return html + '</div>';
}

/** A panel renders EITHER its rows or its placeholder — never a half state. */
function panelHtml(panel) {
  if (!panel) return '';
  let html = '<h3><span>' + esc(panel.title) + '</span></h3>';
  html += panel.state === 'ready' ? rowsHtml(panel.rows) : placeholderHtml(panel.placeholder);
  if (panel.state === 'ready' && panel.rows && panel.rows.length === 0) html += placeholderHtml({ state: 'empty', message: 'No data.' });
  if (panel.actions && panel.actions.length) html += actionsHtml(panel.actions, 'shell-action');
  return html;
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

function selectTab(tab, opts) {
  const tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  if (!tabs.some((t) => t.dataset.tab === tab)) return;
  activeTab = tab;
  for (const button of tabs) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    if (selected && opts && opts.focus) button.focus();
  }
  for (const panel of document.querySelectorAll('.tabpanel')) {
    panel.classList.toggle('active', panel.id === 'panel-' + tab);
  }
  /* The composer only belongs to the conversational surface. */
  const composer = $('composer');
  if (composer) composer.style.display = tab === 'chat' ? '' : 'none';
  if (!opts || !opts.silent) vscode.postMessage({ type: 'tabChanged', tab: tab });
}

function initTabs() {
  const strip = $('tabs');
  if (!strip) return;
  strip.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (button) selectTab(button.dataset.tab);
  });
  /* Roving tabindex: Left/Right move between tabs, Home/End jump to the ends. */
  strip.addEventListener('keydown', (event) => {
    const tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    const index = tabs.findIndex((t) => t.dataset.tab === activeTab);
    if (index < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      selectTab(tabs[next].dataset.tab, { focus: true });
    }
  });
}

/* ── Drawers (responsive) ───────────────────────────────────────────────── */

function initDrawers() {
  const navToggle = $('nav-toggle');
  const drawer = $('nav-drawer');
  if (navToggle && drawer) {
    navToggle.addEventListener('click', () => {
      const open = drawer.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  const ctxToggle = $('ctx-toggle');
  const body = $('body');
  if (ctxToggle && body) {
    ctxToggle.addEventListener('click', () => {
      /* Wide: the panel is a column that can be collapsed. Narrow: it is a
       * drawer that can be opened. One button drives both via CSS. */
      const wide = window.matchMedia('(min-width: 1001px)').matches;
      if (wide) {
        const collapsed = body.classList.toggle('ctx-collapsed');
        body.classList.remove('ctx-open');
        ctxToggle.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
      } else {
        const open = body.classList.toggle('ctx-open');
        body.classList.remove('ctx-collapsed');
        ctxToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      }
    });
  }
}

/* ── Delegated actions ──────────────────────────────────────────────────── */

function initDelegates() {
  document.addEventListener('click', (event) => {
    const header = event.target.closest('[data-header-action]');
    if (header) return void vscode.postMessage({ type: 'headerAction', action: header.dataset.headerAction });

    const shellAction = event.target.closest('[data-shell-action]');
    if (shellAction) return void vscode.postMessage({ type: 'shellAction', action: shellAction.dataset.shellAction });

    const welcome = event.target.closest('[data-welcome]');
    if (welcome) return void vscode.postMessage({ type: 'welcomeAction', action: welcome.dataset.welcome });

    /* Agent intents carry ONLY the intent name. The host binds the decision to
     * the fingerprint it already holds — the webview never sees or sends it. */
    const intent = event.target.closest('[data-agent-intent]');
    if (intent) return void vscode.postMessage({ type: 'agentIntent', intent: intent.dataset.agentIntent });

    const conversation = event.target.closest('[data-conversation]');
    if (conversation) return void vscode.postMessage({ type: 'selectConversation', id: conversation.dataset.conversation });

    const historyRun = event.target.closest('[data-history-run]');
    if (historyRun) return void vscode.postMessage({ type: 'selectHistoryRun', runId: historyRun.dataset.historyRun });

    const evidence = event.target.closest('[data-evidence]');
    if (evidence) {
      return void vscode.postMessage({
        type: 'evidenceAction',
        action: evidence.dataset.evidence,
        runId: evidence.dataset.runId || undefined
      });
    }

    const command = event.target.closest('[data-command]');
    if (command) return void vscode.postMessage({ type: 'command', command: command.dataset.command });

    const tabJump = event.target.closest('[data-tab-jump]');
    if (tabJump) {
      /* The navigation surface has no tab strip of its own — it asks the host to
       * reveal the Studio panel on the requested tab instead. */
      if (document.querySelector('.tab')) return selectTab(tabJump.dataset.tabJump);
      return void vscode.postMessage({ type: 'openTab', tab: tabJump.dataset.tabJump });
    }
  });
}

/* ── Global keyboard map ────────────────────────────────────────────────── */

function initKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      /* The composer fragment is absent on the navigation surface. */
      if (typeof closePalette === 'function' && closePalette()) return;
      if (streaming) {
        vscode.postMessage({ type: 'stop' });
        return;
      }
      const drawer = $('nav-drawer');
      if (drawer && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        const toggle = $('nav-toggle');
        if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
      event.preventDefault();
      vscode.postMessage({ type: 'shellAction', action: 'newChat' });
    }
  });
}

/* ── Bounded notices ───────────────────────────────────────────────────── */

function showHint(text, level) {
  const hint = $('chint');
  if (!hint) return;
  hint.textContent = text || '';
  hint.classList.toggle('warn', level === 'warn' || level === 'error');
}
`;
}
