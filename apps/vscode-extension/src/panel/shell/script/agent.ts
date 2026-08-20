// MigraPilot Shell — webview script: Agent Workspace, proposal card, run diff
// and audit trail (§7, §8, §9).
//
// SECURITY: every control here posts a bare intent (`approve`, `reject`, …). No
// fingerprint, approval id, activation capability, snapshot id or digest is ever
// present in this fragment's DOM, because the host never sends one.
//
// History rows render from `controls` produced by `historyControlAvailability()`,
// which is all-false, so the audit trail cannot grow an execution affordance.

export function agentScript(): string {
  return String.raw`
function progressHtml(stages) {
  if (!stages || !stages.length) return '';
  let html = '<div class="progress" role="list" aria-label="Agent task progress">';
  for (const stage of stages) {
    const mark = stage.status === 'complete' ? svg('check')
      : stage.status === 'failed' ? svg('x')
      : stage.status === 'active' ? '<span class="spinner"></span>'
      : stage.status === 'skipped' ? svg('dash')
      : svg('circle');
    html += '<div class="stage s-' + esc(stage.status) + '" role="listitem">'
      + '<span class="smark">' + mark + '</span><span>' + esc(stage.label) + '</span>'
      + (stage.detail ? '<span class="sdetail">' + esc(stage.detail) + '</span>' : '')
      + '<span class="sr-only"> — ' + esc(stage.status) + '</span></div>';
  }
  return html + '</div>';
}

function proposalHtml(card) {
  if (!card) return '';
  let html = '<article class="pcard" aria-label="Agent Mode proposal">';

  html += '<div class="pcard-head">'
    + '<span class="ptitle">' + esc(card.heading) + '</span>'
    + '<span class="pid" title="Run identifier">' + esc(card.runIdShort) + '</span>'
    + badgeHtml(card.risk) + badgeHtml(card.governance)
    + '<span class="pspacer"></span>'
    + badgeHtml(card.state) + badgeHtml(card.approval)
    + (card.expiresInLabel ? '<span class="badge b-warn">' + esc(card.expiresInLabel) + '</span>' : '')
    + '</div>';

  html += '<div class="pcard-sec"><h4>Task</h4><div class="pcard-task">' + esc(card.task) + '</div></div>';

  html += '<div class="pcard-sec"><h4>Changes</h4>';
  html += rowsHtml([
    { label: 'Files', value: card.changes.fileCount === undefined ? '—' : String(card.changes.fileCount), tone: card.changes.fileCount === undefined ? 'muted' : 'neutral' },
    { label: 'Additions', value: card.changes.additions === undefined ? '—' : '+' + card.changes.additions, tone: card.changes.additions === undefined ? 'muted' : 'ok' },
    { label: 'Deletions', value: card.changes.deletions === undefined ? '—' : '-' + card.changes.deletions, tone: card.changes.deletions === undefined ? 'muted' : 'error' }
  ]);
  for (const file of card.changes.files) {
    html += '<div class="effect"><span class="ebullet">' + esc(file.operation) + '</span><span>' + esc(file.path) + '</span></div>';
  }
  for (const effect of card.changes.expectedEffects) {
    html += '<div class="effect"><span class="ebullet">&bull;</span><span>' + esc(effect) + '</span></div>';
  }
  html += '<div class="pnote">' + esc(card.changes.note) + '</div></div>';

  html += '<div class="pcard-sec"><h4>Validation preview</h4>';
  if (card.validation.state === 'not-run') {
    html += '<div class="vnot-run">' + svg('warning') + '<span>Not run yet</span></div>';
  } else {
    for (const check of card.validation.checks) {
      html += '<div class="vcheck o-' + esc(check.outcome) + '">'
        + (check.outcome === 'passed' ? svg('check') : check.outcome === 'failed' ? svg('x') : svg('circle'))
        + '<span>' + esc(check.name) + (check.detail ? ': ' + esc(check.detail) : '') + '</span></div>';
    }
  }
  html += '<div class="pnote">' + esc(card.validation.note) + '</div></div>';

  html += '<div class="pcard-sec"><h4>Policy &amp; execution</h4>' + rowsHtml(card.policy) + '</div>';

  if (card.environmentKeys.length) {
    html += '<div class="pcard-sec"><h4>Environment (keys only)</h4>' + rowsHtml(card.environmentKeys) + '</div>';
  }

  if (card.warnings.length) {
    html += '<div class="pcard-sec"><h4>Warnings</h4>';
    for (const warning of card.warnings) {
      html += '<div class="warnrow">' + svg('warning') + '<span>' + esc(warning) + '</span></div>';
    }
    html += '</div>';
  }

  html += actionsHtml(card.actions, 'agent-intent');
  return html + '</article>';
}

/* ── Agent Workspace tab ────────────────────────────────────────────────── */

function renderAgentWorkspace(agent) {
  if (!agent) return;
  let html = '';

  html += '<div class="panel"><h3><span>Agent Mode</span>'
    + badgeHtml({ text: agent.modeActive ? 'GOVERNED' : 'OFF', tone: agent.modeActive ? 'governed' : 'muted' })
    + '</h3>';

  if (agent.blocked) {
    html += placeholderHtml(agent.blocked);
  } else {
    html += '<div class="pnote">Server-owned recipes only. Every proposal requires explicit one-time approval; the extension never executes a command itself.</div>';
    html += '<div class="pcard-actions">';
    for (const recipe of agent.recipes) {
      html += '<button class="abtn k-primary" data-propose-recipe="' + esc(recipe.id) + '">' + esc(recipe.label) + '</button>';
    }
    html += '<button class="abtn" data-agent-intent="reconcile">Reconcile authoritative state</button>';
    html += '</div>';
    if (!agent.recipes.length) {
      html += placeholderHtml({ state: 'empty', message: 'The activation reported no allowed recipes.' });
    }
  }
  html += '</div>';

  if (agent.progress && agent.progress.length) {
    html += '<div class="panel"><h3><span>Task progress</span></h3>' + progressHtml(agent.progress) + '</div>';
  }

  if (agent.note) {
    html += '<div class="evidence-note">' + svg('warning') + '<span>' + esc(agent.note) + '</span></div>';
  }

  if (agent.proposal) {
    html += proposalHtml(agent.proposal);
    const controls = agent.proposal.controls;
    html += '<div class="pcard-actions">'
      + '<button class="abtn" data-agent-intent="cancel"' + (controls.cancel ? '' : ' disabled title="Only a live run can be cancelled."') + '>Cancel run</button>'
      + '<button class="abtn" data-agent-intent="repropose"' + (controls.freshProposal ? '' : ' disabled title="The engine did not mark this run eligible for a fresh proposal."') + '>Create fresh proposal</button>'
      + '<button class="abtn" data-agent-intent="inspectEvidence">Inspect evidence</button>'
      + '<button class="abtn" data-agent-intent="exportEvidence">Export evidence</button>'
      + '</div>';
  } else if (!agent.blocked) {
    html += placeholderHtml({ state: 'empty', message: 'No proposal in this session. Choose a server-owned recipe to create one.' });
  }

  setHtml('agent-workspace', html);

  renderInlineProposal();
}

/**
 * Mirror the live proposal inline in the conversation so governance is visible
 * without leaving chat (§21: no hidden accordions).
 *
 * Only once a conversation exists: the welcome state is the quick-action surface
 * (§5) and must not be pushed off-screen by a governance card. The Agent
 * Workspace tab always shows the proposal regardless. Called again whenever the
 * transcript changes, because state and transcript arrive independently.
 */
function renderInlineProposal() {
  const agent = SHELL && SHELL.agent;
  const show = agent && agent.proposal && messages.length > 0;
  setHtml('chat-agent', show ? progressHtml(agent.progress) + proposalHtml(agent.proposal) : '');
}

/* ── Run Diff tab ───────────────────────────────────────────────────────── */

function renderRunDiff(diff) {
  if (!diff) return;
  let html = '<div class="panel"><h3><span>Working tree changes</span></h3>';
  if (diff.state === 'ready') {
    html += rowsHtml(diff.rows);
    html += '<div class="rows">';
    for (const change of diff.changes) {
      html += '<div class="row"><span class="k">'
        + '<span class="badge b-' + (change.staged ? 'ok' : 'muted') + '">' + esc(change.status) + '</span> '
        + esc(change.path) + '</span>'
        + '<span class="v mono">' + (change.binary ? 'binary' : '+' + change.added + ' / -' + change.removed) + '</span></div>';
    }
    html += '</div>';
  } else {
    html += placeholderHtml({ state: diff.state, message: diff.message || 'Working-tree changes unavailable.' });
  }
  html += '</div>';

  /* Only shown when something IS waiting. An always-present panel reading
     "No active proposal — nothing is pending execution" put Agent Mode's
     vocabulary on a product surface and told the reader nothing. */
  if (diff.expectedEffects.length) {
    html += '<div class="panel"><h3><span>Waiting for your approval</span></h3>';
    for (const effect of diff.expectedEffects) {
      html += '<div class="effect"><span class="ebullet">&bull;</span><span>' + esc(effect) + '</span></div>';
    }
    html += '</div>';
  }

  setHtml('run-diff', html);
}

/* ── Audit Trail tab (evidence only) ───────────────────────────────────── */

function renderAuditTrail(history, detail) {
  let html = '<div class="evidence-note">' + svg('info')
    + '<span>Run history is evidence only. It cannot approve, resume, execute, or cancel a run.</span></div>';

  html += '<div class="panel"><h3><span>Run history</span>'
    + '<button class="hbtn" data-shell-action="refreshHistory">Refresh</button></h3>';

  if (history && history.state === 'ready') {
    for (const row of history.rows) {
      html += '<button class="hrow" data-history-run="' + esc(row.runId) + '"'
        + (detail && detail.runId === row.runId ? ' aria-current="true"' : '') + '>'
        + '<span class="htop"><span class="hrecipe">' + esc(row.recipe) + '</span>'
        + '<span class="hage">' + esc(row.age) + '</span></span>'
        + '<span class="hbadges">' + badgeHtml(row.state) + badgeHtml(row.approval)
        + badgeHtml(row.recovery) + badgeHtml(row.integrity) + '</span>'
        + '<span class="pid">' + esc(row.runIdShort) + '</span></button>';
    }
    if (history.retentionNote) html += '<div class="pnote">' + esc(history.retentionNote) + '</div>';
    if (history.hasMore) html += '<div class="pnote">More records exist — narrow the query in the engine to page further.</div>';
  } else if (history) {
    html += placeholderHtml({
      state: history.state,
      message: history.message || 'Run history unavailable.',
      retryCommand: history.state === 'activation-required' ? 'pairAgentMode' : 'refreshHistory',
      retryLabel: history.state === 'activation-required' ? 'Pair Agent Mode' : 'Retry'
    });
    if (history.retentionNote) html += '<div class="pnote">' + esc(history.retentionNote) + '</div>';
  }
  html += '</div>';

  if (detail && detail.state === 'ready') {
    html += '<div class="panel"><h3><span>Run detail</span><span class="pid">' + esc(detail.runIdShort) + '</span></h3>';
    html += '<div class="hbadges" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">';
    for (const badge of detail.badges) html += badgeHtml(badge);
    html += '</div>';
    html += '<div class="evidence-note">' + svg('info') + '<span>' + esc(detail.evidenceNote) + '</span></div>';
    for (const section of detail.sections) {
      html += '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;opacity:.7;margin:10px 0 4px">'
        + esc(section.title) + '</h4>' + rowsHtml(section.rows);
    }
    if (detail.timeline.length) {
      html += '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;opacity:.7;margin:10px 0 4px">Timeline</h4>';
      html += '<div class="timeline">';
      for (const event of detail.timeline) {
        html += '<div class="tline"><span class="tseq">#' + esc(event.seq) + '</span>'
          + '<span class="ttrans">' + esc(event.transition) + (event.reason ? ' — ' + esc(event.reason) : '') + '</span>'
          + '<span class="tsrc">' + esc(event.source) + ' · ' + esc(event.at) + '</span></div>';
      }
      html += '</div>';
    }
    /* Evidence reads only — the model's action list contains no execution ids. */
    html += '<div class="pcard-actions">';
    for (const action of detail.actions) {
      html += '<button class="abtn k-' + esc(action.kind) + '" data-evidence="' + esc(action.id) + '"'
        + ' data-run-id="' + esc(detail.runId) + '">' + esc(action.label) + '</button>';
    }
    html += '</div></div>';
  } else {
    html += '<div class="panel"><h3><span>Run detail</span></h3>'
      + placeholderHtml({ state: 'empty', message: 'Select a run to inspect its durable evidence.' }) + '</div>';
  }

  setHtml('audit-trail', html);
}

/* Recipe proposal dispatch — the reason is bounded and operator-visible. */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-propose-recipe]');
  if (!button) return;
  vscode.postMessage({ type: 'proposeRecipe', recipe: button.dataset.proposeRecipe });
});
`;
}
