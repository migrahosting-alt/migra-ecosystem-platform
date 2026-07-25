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
  setHtml('nav-agent',
    navRow('Submit Task', 'tab-jump', 'agent', undefined, agent.active)
    + navRow('Pending Approvals', 'tab-jump', 'agent', agent.pendingApprovals, agent.pendingApprovals > 0)
    + navRow('Active Runs', 'tab-jump', 'agent', agent.activeRuns, false)
    + navRow('Run History', 'tab-jump', 'audit', agent.runHistory, false)
    + (agent.countsNote ? '<div class="placeholder s-degraded">' + esc(agent.countsNote) + '</div>' : ''));

  const workspace = nav.workspace;
  if (workspace.state === 'ready') {
    setHtml('nav-workspace', rowsHtml([
      { label: 'Workspace', value: workspace.name },
      { label: 'Branch', value: workspace.branch || '—', tone: workspace.branch ? 'info' : 'muted', mono: true },
      { label: 'Status', value: workspace.cleanLabel || '—', tone: workspace.cleanTone || 'muted' }
    ]));
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
