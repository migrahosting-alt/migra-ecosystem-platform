// MigraPilot Shell — webview script: the Workspace tab (MigraAI Workspace).
//
// Renders the engine's workspace product object and its lifecycle controls.
//
// SECURITY: every control posts a BARE intent (`sync`, `approve`, `delete`, …).
// The workspace id and the index version never reach this fragment — the host
// binds an index approval to the exact version it observed, the same way it
// binds an Agent Mode decision to the fingerprint it holds.

export function workspaceScript(): string {
  return String.raw`
function renderWorkspaceTab(workspace) {
  if (!workspace) return;
  let html = '';

  html += '<div class="panel"><h3><span>MigraAI Workspace</span>'
    + badgeHtml(workspace.status) + '</h3>';
  html += '<div class="pnote">' + esc(workspace.note) + '</div>';

  if (workspace.state !== 'ready') {
    html += placeholderHtml({
      state: workspace.state === 'loading' ? 'loading' : workspace.state,
      message: workspace.message || 'No MigraAI workspace is open in this window.'
    });
    html += actionsHtml(workspace.actions, 'workspace-intent');
    html += '</div>';
    setHtml('workspace-tab', html);
    return;
  }

  html += rowsHtml([{ label: 'Workspace', value: workspace.name }]);
  html += '</div>';

  /* Index promotion is its own governed approval — never folded into the Agent
   * Mode command approval, because it decides what content backs retrieval. */
  const approval = workspace.approval;
  html += '<article class="pcard' + (approval.state === 'required' ? '' : ' pcard-quiet') + '" aria-label="Semantic index approval">';
  html += '<div class="pcard-head">'
    + '<span class="ptitle">' + esc(approval.heading) + '</span>'
    + badgeHtml(approval.badge)
    + '<span class="pspacer"></span>'
    + '</div>';
  html += '<div class="pcard-sec">' + rowsHtml(approval.rows)
    + '<div class="pnote">' + esc(approval.note) + '</div></div>';
  if (approval.actions.length) html += actionsHtml(approval.actions, 'workspace-intent');
  html += '</article>';

  for (const panel of workspace.panels) {
    html += '<div class="panel">' + panelHtml(panel) + '</div>';
  }

  html += '<div class="panel"><h3><span>Lifecycle</span></h3>'
    + actionsHtml(workspace.actions, 'workspace-intent') + '</div>';

  setHtml('workspace-tab', html);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-intent]');
  if (button && !button.disabled) {
    vscode.postMessage({ type: 'workspaceIntent', intent: button.dataset.workspaceIntent });
  }
});
`;
}
