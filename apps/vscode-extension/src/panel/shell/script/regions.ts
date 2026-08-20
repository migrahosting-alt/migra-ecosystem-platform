// MigraPilot Shell — webview script: navigation, right context panel and status
// row renderers (§3, §10, §12).
//
// Each region reads only from the authoritative `SHELL` state object, so a panel
// that the host marked `disconnected` / `activation-required` renders its
// placeholder instead of stale or invented values.

export function regionsScript(): string {
  return String.raw`
/* ── Compact launcher counts (sidebar) ──────────────────────────────────── */

/**
 * Fill the launcher rows' canonical Agent Mode counts.
 *
 * A count the extension could not read stays HIDDEN rather than rendering 0 —
 * "no pending approvals" and "pending approvals unknown" are different facts.
 */
function renderLauncherCounts(agent) {
  if (!agent) return;
  for (const badge of document.querySelectorAll('[data-counter]')) {
    const value = agent[badge.dataset.counter];
    if (value === undefined || value === null) {
      badge.hidden = true;
      badge.textContent = '';
      continue;
    }
    badge.hidden = false;
    badge.textContent = String(value);
    /* Pending approvals are governance-critical, so a non-zero count is orange. */
    badge.classList.toggle('governed', badge.dataset.counter === 'pendingApprovals' && value > 0);
  }
  const status = $('nav-agent-status');
  if (status) {
    status.textContent = agent.statusText;
    status.className = 'badge b-' + agent.statusTone;
    if (agent.countsNote) status.title = agent.countsNote;
  }
}

/* ── Left navigation (also the narrow-width drawer) ─────────────────────── */

function renderNavigation(nav) {
  if (!nav) return;

  const conversations = nav.conversations;
  if (conversations.state === 'ready') {
    let html = '';
    for (const row of conversations.rows) {
      html += '<button class="crow" data-conversation="' + esc(row.id) + '"'
        + (row.active ? ' aria-current="true"' : '') + '>'
        + '<span class="ctitle">' + esc(row.title) + '</span>'
        + (row.durable ? '<span class="badge b-muted" title="Durable memory">D</span>' : '')
        + '<span class="cage">' + esc(row.age) + '</span></button>';
    }
    setHtml('nav-conversations', html);
  } else {
    setHtml('nav-conversations', placeholderHtml({
      state: conversations.state === 'loading' ? 'loading' : conversations.state,
      message: conversations.message || 'Conversations unavailable.'
    }));
  }

  const agent = nav.agentMode;
  const statusEl = $('nav-agent-status');
  if (statusEl) {
    statusEl.textContent = agent.statusText;
    statusEl.className = 'badge b-' + agent.statusTone;
  }
  /* THE APPROVAL PROMPT IS NOT A SECTION. A permanent "Pending Approvals: 0" row
   * asks the user to monitor a mechanism; this appears only when a decision is
   * actually waiting, and disappears the moment it is not. An unreadable count
   * (undefined) renders nothing rather than a reassuring zero. */
  const waiting = agent.pendingApprovals;
  setHtml('nav-approvals', waiting > 0
    ? '<button class="navbtn" data-nav-action="pendingApprovals">'
      + '<span>Needs your approval</span>'
      + '<span class="count governed">' + esc(waiting) + '</span></button>'
    : '');

  /* Engineering rows. setHtml is a no-op when the element is absent, so the
   * product sidebar simply has nowhere for these to land. */
  setHtml('nav-agent',
    navRow('Submit Task', 'tab-jump', 'agent', undefined, agent.active)
    + navRow('Active Runs', 'tab-jump', 'agent', agent.activeRuns, false)
    + navRow('Run History', 'tab-jump', 'audit', agent.runHistory, false)
    + (agent.countsNote ? '<div class="placeholder s-degraded">' + esc(agent.countsNote) + '</div>' : ''));

  const workspace = nav.workspace;
  if (workspace.state === 'ready') {
    /* Compact: "repo · branch" then the change count. Three labelled rows spent
     * a third of the sidebar restating what one line says. */
    const where = workspace.name + (workspace.branch ? ' · ' + workspace.branch : '');
    setHtml('nav-workspace',
      '<div class="row"><span class="v mono" title="' + esc(where) + '">' + esc(where) + '</span></div>'
      + '<div class="row"><span class="v t-' + esc(workspace.cleanTone || 'muted') + '">'
      + esc(workspace.cleanLabel || '—') + '</span></div>');
  } else {
    setHtml('nav-workspace', placeholderHtml({
      state: workspace.state === 'empty' ? 'empty' : 'disconnected',
      message: workspace.message || 'Workspace state unavailable.'
    }));
  }

  let tools = '';
  for (const tool of nav.tools) {
    /* A status row without an associated command is INFORMATION, not a disabled
     * control: rendering it as a disabled button would dim a perfectly valid
     * reading and read as broken. */
    const body = '<span class="dot t-' + esc(tool.tone) + '"></span>'
      + '<span>' + esc(tool.label) + '</span>'
      + '<span class="count t-' + esc(tool.tone) + '" style="background:transparent">' + esc(tool.value) + '</span>';
    tools += tool.command
      ? '<button class="navbtn" data-shell-action="' + esc(tool.command) + '">' + body + '</button>'
      : '<div class="navbtn navstatic">' + body + '</div>';
  }
  setHtml('nav-tools', tools);
}

function navRow(label, kind, target, count, highlight) {
  const badge = count === undefined || count === null
    ? ''
    : '<span class="count' + (highlight ? ' governed' : '') + '">' + esc(count) + '</span>';
  return '<button class="navbtn" data-' + esc(kind) + '="' + esc(target) + '"><span>' + esc(label) + '</span>' + badge + '</button>';
}

/* ── Header brain badge (shared by both surfaces) ───────────────────────── */

function renderBrainBadge(context) {
  const badge = context && context.brain && context.brain.badge;
  if (!badge) return;
  const holder = $('brain-badge');
  if (holder) {
    holder.className = 'badge b-' + badge.tone;
    if (badge.title) holder.title = badge.title;
  }
  setText('brain-badge-text', badge.text);
}

/* ── Bottom status row ─────────────────────────────────────────────────── */

function renderStatus(status) {
  if (!status) return;
  let html = '';
  for (const item of status.items) {
    html += '<span class="sitem"><span class="sk">' + esc(item.label) + ':</span>'
      + '<span class="t-' + esc(item.tone || 'neutral') + '">' + esc(item.value) + '</span></span>';
  }
  setHtml('statusrow', html);
}
`;
}
