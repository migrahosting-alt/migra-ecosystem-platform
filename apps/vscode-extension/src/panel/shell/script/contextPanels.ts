// MigraPilot Shell — webview script: the right-hand context panel (§10).
//
// Deliberately a SEPARATE fragment from `regions.ts`, and composed only into the
// Command Center document. The Active Run Summary offers an "Open Run Detail"
// affordance (`data-history-run`), so keeping it out of the sidebar bundle makes
// the "no duplicate history path in the launcher" guarantee STRUCTURAL rather
// than a matter of which element ids happen to exist — asserted by a unit test.

export function contextPanelsScript(): string {
  return String.raw`
function renderContext(context) {
  if (!context) return;
  setHtml('ctx-workspace', panelHtml(context.workspace));
  setHtml('ctx-brain', panelHtml(context.brain));
  setHtml('ctx-agent', panelHtml(context.agent));
  setHtml('ctx-files', panelHtml(context.files));
  setHtml('ctx-activity', panelHtml(context.activity));

  const run = context.run;
  if (!run || run.state !== 'ready') {
    setHtml('ctx-run', '<h3><span>Active Run Summary</span></h3>'
      + placeholderHtml({ state: 'empty', message: 'No Agent Mode run in this session.' }));
  } else {
    let html = '<h3><span>Active Run Summary</span></h3>' + rowsHtml(run.rows);
    if (run.openDetail) {
      html += '<div class="pcard-actions"><button class="abtn" data-history-run="' + esc(run.runId) + '">Open Run Detail</button></div>';
    }
    setHtml('ctx-run', html);
  }

  renderBrainBadge(context);
}
`;
}
