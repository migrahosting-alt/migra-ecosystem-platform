import assert from 'node:assert/strict';
import test from 'node:test';

import { shellScript } from '../../panel/shell/shellScript.js';
import { shellHtml } from '../../panel/shell/shellHtml.js';
import { shellStyles } from '../../panel/shell/shellStyles.js';
import { navigationHtml, navigationScript } from '../../panel/shell/navigationHtml.js';
import { icon, knownIcons } from '../../panel/shell/icons.js';
import { NAV_ACTIONS, SHELL_TABS, findNavAction, navActionsFor, navPrimaryAction, shellTabs } from '../../panel/shell/navigationModel.js';
import { classify, isProductSurface } from '../../panel/shell/surfaceClassification.js';
import { SLASH_COMMANDS, slashCommandsFor } from '../../panel/shell/composerModel.js';

const NONCE = 'test-nonce-abcdefgh';
const CSP = "default-src 'none'; script-src 'nonce-test-nonce-abcdefgh'";

/** The document a NORMAL install renders. Developer mode is off, as it ships. */
function html(): string {
  return shellHtml({ nonce: NONCE, csp: CSP, logoUri: 'https://file%2B.vscode-resource/logo.svg', initialTab: 'chat', script: shellScript(), compact: false });
}

/** The same document with engineering surfaces revealed. */
function devHtml(initialTab: 'chat' | 'diff' | 'agent' | 'audit' | 'workspace' = 'chat'): string {
  return shellHtml({ nonce: NONCE, csp: CSP, logoUri: 'https://file%2B.vscode-resource/logo.svg', initialTab, script: shellScript(true), compact: false, developerMode: true });
}

/**
 * Strip block comments and whole-line `//` comments so a security assertion
 * inspects EXECUTABLE code rather than documentation. Mid-line `//` is left
 * alone on purpose — the script contains regex literals such as `/^\//`, and
 * mangling them could hide a real occurrence.
 */
function executableOnly(script: string): string {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

// ── Script validity ──────────────────────────────────────────────────────────

test('the composed shell webview script is valid JavaScript', () => {
  const script = shellScript();
  assert.doesNotThrow(() => new Function(script), 'the exact packaged shell script must compile');
});

test('the composed navigation webview script is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(navigationScript()), 'the exact packaged navigation script must compile');
});

test('no script fragment contains a raw backtick', () => {
  // The fragments are String.raw template literals, so a stray backtick — even
  // inside a comment — terminates the template and produces a TypeScript syntax
  // error at build time. Fragments use \x60 for a literal backtick instead.
  for (const [name, script] of [['shell', shellScript()], ['navigation', navigationScript()]] as const) {
    assert.doesNotMatch(script, /`/, `${name}: a raw backtick would break the enclosing template literal`);
  }
});

test('the shell script runs in strict mode inside an IIFE (no globals leaked)', () => {
  const script = shellScript();
  assert.match(script, /^\(function \(\) \{/);
  assert.match(script, /'use strict';/);
  assert.match(script, /\}\)\(\);$/);
});

test('the slash catalogue is injected PER MODE, with no placeholder token left', () => {
  const product = shellScript();
  assert.doesNotMatch(product, /SLASH_COMMANDS_JSON/, 'the token must be replaced');
  for (const command of slashCommandsFor(false)) {
    assert.ok(product.includes(`"${command.name}"`), `${command.name} must reach the webview`);
  }
  // Engineering entries are not shipped and then hidden — they are not shipped.
  for (const command of ['/agent', '/noevidence', '/policy', '/health', '/diagnostics']) {
    assert.ok(!product.includes(`"name":"${command}"`), `${command} must not be in the product catalogue`);
  }
  const developer = shellScript(true);
  for (const command of SLASH_COMMANDS) {
    assert.ok(developer.includes(`"${command.name}"`), `developer mode keeps ${command.name}`);
  }
});

test('the webview receives the SAME icon set as the host-rendered HTML', () => {
  for (const [name, script] of [['shell', shellScript()], ['navigation', navigationScript()]] as const) {
    assert.doesNotMatch(script, /ICON_PATHS_JSON/, `${name}: the icon token must be replaced`);
    // Every icon a model can reference must be resolvable inside the webview,
    // otherwise action buttons silently degrade to the fallback glyph.
    for (const id of knownIcons()) {
      assert.ok(script.includes(JSON.stringify(id).slice(1, -1)), `${name}: icon "${id}" must reach the webview`);
    }
  }
  // Icons actually used by action buttons the webview builds at runtime.
  const script = shellScript();
  for (const id of ['diff', 'circle-slash', 'shield', 'search', 'desktop-download', 'add']) {
    assert.ok(knownIcons().includes(id), `${id} must exist in the icon set`);
    assert.ok(script.includes('"' + id + '"'), `${id} must be resolvable in the webview`);
  }
});

// ── Security: nothing authority-bearing crosses into the webview ─────────────

test('the webview posts only bare agent intents — never a fingerprint', () => {
  const script = shellScript();
  assert.match(script, /type: 'agentIntent', intent: intent\.dataset\.agentIntent/);
  // The webview has no CODE that could read or forward approval material.
  const code = executableOnly(script);
  assert.doesNotMatch(code, /fingerprint/i);
  assert.doesNotMatch(code, /activationCapability/i);
  assert.doesNotMatch(code, /snapshotId/i);
  assert.doesNotMatch(code, /workspaceMaterialFingerprint/i);
  assert.doesNotMatch(code, /bootstrapSecret/i);
  // Same guarantee on the navigation surface.
  assert.doesNotMatch(executableOnly(navigationScript()), /fingerprint|activationCapability|snapshotId|bootstrapSecret/i);
});

test('the webview never constructs a network request of its own', () => {
  const script = shellScript();
  assert.doesNotMatch(script, /\bfetch\s*\(/, 'audio and data always travel through the extension host');
  assert.doesNotMatch(script, /XMLHttpRequest/);
  assert.doesNotMatch(script, /new WebSocket/);
  assert.doesNotMatch(script, /eval\s*\(/);
});

test('history rendering offers evidence reads only — no execution controls', () => {
  const script = shellScript();
  // Rows carry `data-history-run` (selection) and `data-evidence` (reads).
  assert.match(script, /data-history-run=/);
  assert.match(script, /data-evidence=/);
  // The audit renderer must not emit an approve/cancel/repropose control.
  const auditSection = script.slice(script.indexOf('function renderAuditTrail'), script.indexOf('/* Recipe proposal dispatch'));
  assert.ok(auditSection.length > 200, 'the audit renderer was located');
  assert.doesNotMatch(auditSection, /data-agent-intent="(approve|reject|cancel|repropose)"/);
  assert.match(auditSection, /evidence only/i);
});

// ── CSP + document integrity ─────────────────────────────────────────────────

test('the shell document carries the host CSP and a nonce-guarded script only', () => {
  const document = html();
  assert.ok(document.includes(`content="${CSP}"`), 'the host CSP is applied verbatim');
  assert.ok(document.includes(`<script nonce="${NONCE}">`));
  // Exactly one script element, and no unguarded one.
  assert.equal(document.split('<script').length - 1, 1);
  assert.doesNotMatch(document, /<script(?![^>]*nonce=)/);
});

test('the document loads no remote resource', () => {
  for (const document of [html(), navigationHtml({ nonce: NONCE, csp: CSP })]) {
    assert.doesNotMatch(document, /src="https?:\/\/(?!file)/);
    assert.doesNotMatch(document, /<link[^>]+href="https?:/);
    assert.doesNotMatch(document, /@import\s+url\(/);
    assert.doesNotMatch(document, /cdn\./);
  }
});

test('inline event handler attributes are never emitted', () => {
  const document = html();
  assert.doesNotMatch(document, /\son(click|load|error|change|input|submit)=/i);
});

// ── Layout contract ──────────────────────────────────────────────────────────

test('the document declares the three regions and every tab of the CURRENT mode', () => {
  const document = html();
  for (const id of ['nav-drawer', 'main', 'context', 'composer', 'statusrow', 'tabs', 'hdr']) {
    assert.ok(document.includes(`id="${id}"`), `region #${id} must exist`);
  }
  for (const tab of shellTabs(false).map((entry) => entry.id)) {
    assert.ok(document.includes(`id="panel-${tab}"`), `panel-${tab} must exist`);
    assert.ok(document.includes(`id="tabbtn-${tab}"`), `tabbtn-${tab} must exist`);
  }
  const developer = devHtml();
  for (const tab of SHELL_TABS.map((entry) => entry.id)) {
    assert.ok(developer.includes(`id="panel-${tab}"`), `developer mode keeps panel-${tab}`);
  }
});

test('PRODUCT MODE SHOWS ONLY THE PANELS A USER NEEDS', () => {
  const document = html();
  for (const panel of ['ctx-workspace', 'ctx-run', 'ctx-files', 'ctx-activity']) {
    assert.ok(document.includes(`id="${panel}"`), `#${panel} is product state and must exist`);
  }
  for (const panel of ['ctx-brain', 'ctx-agent']) {
    assert.ok(!document.includes(`id="${panel}"`), `#${panel} is engineering and must not render`);
    assert.ok(devHtml().includes(`id="${panel}"`), `#${panel} must still exist in developer mode`);
  }
});

test('NO ENGINEERING SURFACE LEAKS INTO THE PRODUCT DOCUMENT', () => {
  // Scoped to the MARKUP: the inlined script carries source comments such as
  // "Agent Workspace tab", which are code, not a surface. What matters is what
  // the document renders and what the client can be told to open.
  const document = html();
  const markup = document.slice(0, document.indexOf('<script nonce='));
  for (const leak of [
    'Tools &amp; Services',
    'Agent Workspace',
    'Audit Trail',
    'Model routing',
    'Evidence source',
    'id="nav-tools"',
    'id="nav-agent"',
    'id="croute"',
    'id="csource"',
    'id="panel-agent"',
    'id="panel-audit"',
    'id="panel-workspace"',
  ]) {
    assert.ok(!markup.includes(leak), `product mode must not render "${leak}"`);
  }
  // …and the same document in developer mode still has them all. Nothing deleted.
  const developer = devHtml();
  for (const kept of ['id="nav-tools"', 'id="croute"', 'id="csource"', 'Agent Workspace', 'id="panel-audit"']) {
    assert.ok(developer.includes(kept), `developer mode must keep "${kept}"`);
  }
});

test('the welcome state renders the six OUTCOME cards, so the centre is never empty', () => {
  const document = html();
  const cards = document.match(/data-welcome="/g) ?? [];
  assert.equal(cards.length, 6);
  for (const title of ['Explain code', 'Fix code', 'Plan a task', 'Review changes', 'Run tests', 'Debug a failure']) {
    assert.ok(document.includes(title), `the "${title}" card must be offered`);
  }
  assert.ok(document.includes('Ask a question, or pick where you want to start.'));
  assert.ok(!document.includes('governed AI engineering and infrastructure copilot'));
});

test('the initial tab is reflected in aria-selected and the roving tabindex', () => {
  const document = shellHtml({ nonce: NONCE, csp: CSP, initialTab: 'audit', script: 'void 0;', compact: false, developerMode: true });
  assert.match(document, /id="tabbtn-audit" data-tab="audit"\s*\n?\s*aria-selected="true"/);
  assert.ok(document.includes('data-initial-tab="audit"'));
  // Scope the counts to the tab strip markup — the stylesheet also contains
  // `[aria-selected="true"]` selectors.
  const strip = document.slice(document.indexOf('<div id="tabs"'), document.indexOf('<div class="body"'));
  assert.equal((strip.match(/aria-selected="true"/g) ?? []).length, 1, 'exactly one tab is selected');
  assert.equal((strip.match(/aria-selected="false"/g) ?? []).length, SHELL_TABS.length - 1);
  // The roving tabindex puts exactly one tab button in the tab order.
  const tabButtons = strip.match(/role="tab"[\s\S]*?tabindex="(-?\d)"/g) ?? [];
  assert.equal(tabButtons.length, SHELL_TABS.length);
  assert.equal(tabButtons.filter((button) => button.endsWith('tabindex="0"')).length, 1);
});

// ── Accessibility ────────────────────────────────────────────────────────────

test('the tab strip, thread, composer and status row expose the right roles', () => {
  const document = html();
  const productTabs = shellTabs(false).length;
  assert.ok(document.includes('role="tablist"'));
  assert.equal((document.match(/role="tab"/g) ?? []).length, productTabs);
  assert.equal((document.match(/role="tabpanel"/g) ?? []).length, productTabs);
  assert.ok(document.includes('id="thread" role="log"'));
  assert.ok(document.includes('aria-live="polite"'));
  assert.ok(document.includes('role="complementary"') || document.includes('<aside id="context"'));
  assert.ok(document.includes('aria-label="Workspace and run context"'));
});

test('every interactive control has an accessible name', () => {
  const document = html();
  // The composer's textarea and select are labelled; the icon buttons have titles.
  assert.ok(document.includes('<label class="sr-only" for="cinput">'));
  assert.ok(document.includes('<label class="sr-only" for="clive">'));
  // The routing selector is engineering; when it IS rendered it stays labelled.
  assert.ok(devHtml().includes('<label class="sr-only" for="croute">'));
  assert.ok(document.includes('aria-label="Send message"'));
  assert.ok(document.includes('aria-label="Stop generating"'));
  assert.ok(document.includes('id="nav-toggle" aria-expanded="false" aria-controls="nav-drawer"'));
  assert.ok(document.includes('id="ctx-toggle" aria-pressed="true" aria-controls="context"'));
  // The hidden file input must never be a keyboard trap.
  assert.ok(document.includes('id="cfile" multiple accept'));
  assert.ok(document.includes('tabindex="-1" aria-hidden="true"'));
});

test('icons are decorative and never the only accessible name', () => {
  const rendered = icon('shield');
  assert.match(rendered, /aria-hidden="true"/);
  assert.match(rendered, /focusable="false"/);
  // An unknown id degrades to a neutral glyph instead of breaking the layout.
  assert.ok(icon('definitely-not-an-icon').includes('<svg'));
  assert.ok(knownIcons().length > 20);
});

// ── Styling contract ─────────────────────────────────────────────────────────

test('the stylesheet drives colour from VS Code theme tokens', () => {
  const css = shellStyles();
  for (const token of [
    '--vscode-editor-background',
    '--vscode-editor-foreground',
    '--vscode-sideBar-background',
    '--vscode-input-background',
    '--vscode-input-border',
    '--vscode-button-background',
    '--vscode-button-foreground',
    '--vscode-focusBorder',
    '--vscode-descriptionForeground',
    '--vscode-panel-border',
    '--vscode-badge-background',
    '--vscode-statusBar-background',
  ]) {
    assert.ok(css.includes(token), `the stylesheet must consume ${token}`);
  }
});

test('the palette contract binds each tone to exactly one accent variable', () => {
  const css = shellStyles();
  assert.match(css, /--mp-accent: var\(--vscode-charts-blue/);
  assert.match(css, /--mp-governed: var\(--vscode-charts-orange/);
  assert.match(css, /--mp-ok: var\(--vscode-testing-iconPassed/);
  assert.match(css, /--mp-warn: var\(--vscode-editorWarning-foreground/);
  assert.match(css, /--mp-error: var\(--vscode-testing-iconFailed/);
  assert.match(css, /\.t-governed\s*\{\s*color: var\(--mp-governed\);/);
  assert.match(css, /\.t-ok\s*\{\s*color: var\(--mp-ok\);/);
  assert.match(css, /\.t-error\s*\{\s*color: var\(--mp-error\);/);
  // Governance is orange and completion is green — the two must never share a var.
  assert.doesNotMatch(css, /\.t-governed\s*\{\s*color: var\(--mp-ok\)/);
});

test('the layout is responsive at medium, narrow and sidebar widths', () => {
  const css = shellStyles();
  assert.match(css, /@media \(max-width: 1000px\)/, 'medium: context panel becomes a drawer');
  assert.match(css, /@media \(max-width: 640px\)/, 'narrow: nav drawer + stacked actions');
  assert.match(css, /@media \(max-width: 420px\)/, 'sidebar width still usable');
  assert.match(css, /#nav-toggle \{ display: inline-flex; \}/);
  assert.match(css, /\.pcard-actions \{ flex-direction: column; \}/);
});

test('the page body can never scroll horizontally', () => {
  const css = shellStyles();
  assert.match(css, /html, body \{\s*height: 100%;\s*overflow: hidden;/);
  assert.match(css, /#main \{[^}]*overflow-x: hidden;/s);
  assert.match(css, /#context \{[^}]*overflow-x: hidden;/s);
  // Wide content scrolls inside its own container instead.
  assert.match(css, /\.msg-body pre \{[^}]*overflow-x: auto;/s);
  assert.match(css, /\.msg-body table \{[^}]*overflow-x: auto;/s);
});

test('reduced motion and forced colors are honoured', () => {
  const css = shellStyles();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /:focus-visible \{\s*outline: 2px solid var\(--vscode-focusBorder\)/);
});

// ── Navigation surface ───────────────────────────────────────────────────────

test('THE PRODUCT SIDEBAR IS FOUR THINGS: start, resume, where, and four outcomes', () => {
  const document = navigationHtml({ nonce: NONCE, csp: CSP, logoUri: 'https://file%2B.vscode-resource/logo.svg' });
  for (const section of ['Recent', 'Workspace', 'Quick Actions']) {
    assert.ok(document.includes(`<span>${section}</span>`), `${section} must be a sidebar section`);
  }
  for (const id of ['nav-conversations', 'nav-workspace', 'nav-quick-actions', 'nav-approvals', 'nav-identity', 'brain-badge']) {
    assert.ok(document.includes(`id="${id}"`), `#${id} must exist on the sidebar`);
  }
  assert.equal(document.split('<script').length - 1, 1);
  assert.ok(!document.includes('id="statusrow"'), 'the status summary belongs to the Studio panel');
});

test('NO ENGINEERING CONSOLE REMAINS IN THE PRODUCT SIDEBAR', () => {
  // This surface shipped the console intact through an entire "pivot": it is
  // rendered by navigationHtml, not shellHtml, and nothing asserted on it.
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  // Visible LABELS are checked against the markup only: the inlined script
  // carries source comments ("…canonical Agent Mode counts") which are code, not
  // a surface. Element ids and dispatch attributes are checked against the whole
  // document, because those are what the client could actually act on.
  const markup = document.slice(0, document.indexOf('<script nonce='));
  for (const label of ['Agent Mode', 'Tools &amp; Services', 'Brain Status', 'Repair Connection', 'Open Command Center', 'Service']) {
    assert.ok(!markup.includes(label), `the product sidebar must not render "${label}"`);
  }
  for (const leak of [
    'id="nav-agent-actions"',
    'id="nav-tools"',
    'id="nav-service-actions"',
    'id="nav-agent-status"',
    'data-nav-action="brainStatus"',
    'data-nav-action="repairConnection"',
    'data-nav-action="logs"',
    'data-nav-action="runHistory"',
    'data-nav-action="activeRuns"',
    'data-nav-action="submitTask"',
  ]) {
    assert.ok(!document.includes(leak), `the product sidebar must not render "${leak}"`);
  }
});

test('developer mode restores every engineering section, unchanged', () => {
  const developer = navigationHtml({ nonce: NONCE, csp: CSP, developerMode: true });
  for (const kept of [
    'Agent Mode',
    'Tools &amp; Services',
    'Brain Status',
    'Repair Connection',
    'id="nav-agent-actions"',
    'id="nav-tools"',
    'id="nav-service-actions"',
  ]) {
    assert.ok(developer.includes(kept), `developer mode must keep "${kept}"`);
  }
  // …and it still shows the product sections. Developer mode ADDS; it never swaps.
  for (const product of ['id="nav-quick-actions"', 'id="nav-conversations"', 'id="nav-workspace"']) {
    assert.ok(developer.includes(product), `developer mode must keep "${product}"`);
  }
});

test('every tab panel is actually rendered by the state handler', () => {
  // A tab whose renderer is never invoked paints an empty panel — the contract
  // is that each region has both a renderer AND a call from the state handler.
  const script = shellScript();
  const handler = script.slice(script.indexOf("case 'state':"), script.indexOf("case 'tab':"));
  assert.ok(handler.length > 100, 'the state handler was located');
  for (const call of [
    'renderNavigation(SHELL.nav)',
    'renderContext(SHELL.context)',
    'renderAgentWorkspace(SHELL.agent)',
    'renderRunDiff(SHELL.diff)',
    'renderAuditTrail(SHELL.history, SHELL.detail)',
    'renderWorkspaceTab(SHELL.workspace)',
    'renderStatus(SHELL.status)',
  ]) {
    assert.ok(handler.includes(call), `the state handler must call ${call}`);
  }
  // And every renderer it calls must exist.
  for (const fn of ['renderNavigation', 'renderContext', 'renderAgentWorkspace', 'renderRunDiff', 'renderAuditTrail', 'renderWorkspaceTab', 'renderStatus']) {
    assert.ok(script.includes(`function ${fn}(`), `${fn} must be defined`);
  }
});

test('the launcher bundle excludes the context-panel renderer entirely', () => {
  // Structural guarantee: the Active Run Summary's "Open Run Detail" affordance
  // lives in the Command Center bundle only, so the launcher cannot grow a
  // second history path even by accident.
  const nav = navigationScript();
  assert.ok(!nav.includes('function renderContext'), 'renderContext must not be bundled into the launcher');
  assert.ok(nav.includes('function renderBrainBadge'), 'the launcher still needs the header badge');
  // The Command Center DOES have it.
  assert.ok(shellScript().includes('function renderContext'));
});

test('the primary action STARTS A TASK, which is what a person came to do', () => {
  const primary = navPrimaryAction();
  assert.equal(primary.id, 'newTask');
  assert.equal(primary.label, 'New Task');
  assert.equal(primary.kind, 'studio');
  assert.equal(primary.target, 'chat');
  assert.equal(NAV_ACTIONS.filter((action) => action.primary).length, 1, 'exactly one primary');
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  assert.match(document, /<button class="newchat" data-nav-action="newTask">/);
});

test('QUICK ACTIONS ARE FOUR OUTCOMES, each reaching a real product surface', () => {
  assert.deepEqual(
    navActionsFor('quick', false).map((action) => action.label),
    ['Explain Code', 'Fix Code', 'Review Changes', 'Run Tests'],
  );
  for (const action of navActionsFor('quick', false)) {
    assert.equal(isProductSurface('nav-action', action.id), true, `${action.id} must be product`);
    if (action.kind === 'command') {
      assert.equal(isProductSurface('command', action.target), true, `${action.id} -> ${action.target}`);
    }
    if (action.kind === 'studio') {
      assert.equal(isProductSurface('tab', action.target), true, `${action.id} opens the ${action.target} tab`);
    }
  }
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  for (const action of navActionsFor('quick', false)) {
    assert.ok(document.includes(`data-nav-action="${action.id}"`), `${action.label} is not rendered`);
  }
});

test('EVERY sidebar row is classified, and only product rows render by default', () => {
  const available = new Set(knownIcons());
  for (const action of NAV_ACTIONS) {
    assert.ok(classify('nav-action', action.id), `${action.id} must be classified`);
    assert.ok(available.has(action.icon), `missing icon ${action.icon}`);
  }
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  const rendered = [...document.matchAll(/data-nav-action="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((id): id is string => typeof id === 'string');
  assert.ok(rendered.length > 0, 'the sidebar must render rows');
  for (const id of rendered) {
    assert.equal(isProductSurface('nav-action', id), true, `${id} rendered but is not product`);
  }
});

test('the approval prompt is NOT a permanent section', () => {
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  // The container exists but is empty; the renderer fills it only when a
  // decision is actually waiting, and CSS hides an empty container.
  assert.match(document, /<div id="nav-approvals"[^>]*><\/div>/, 'must ship empty');
  assert.match(document, /#nav-approvals:empty \{ display: none; \}/, 'and stay invisible while empty');
  // The renderer emits it only for a non-zero count.
  assert.match(navigationScript(), /setHtml\('nav-approvals', waiting > 0/);
});

test('counts render blank when unknown, never as a reassuring zero', () => {
  // The engineering counters live in developer mode now; the rule they encode —
  // unknown renders blank, never 0 — is unchanged.
  const developer = navigationHtml({ nonce: NONCE, csp: CSP, developerMode: true });
  for (const counter of ['activeRuns', 'runHistory']) {
    assert.match(developer, new RegExp(`data-counter="${counter}" hidden`), `${counter} badge must start hidden`);
  }
  assert.match(navigationScript(), /badge\.hidden = true;/);
});

test('the navigation surface has no composer, no agent approval controls, and no history execution path', () => {
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  // No composer.
  assert.ok(!document.includes('id="cinput"'));
  assert.ok(!document.includes('id="csend"'));
  assert.ok(!document.includes('id="composer"'));
  // No Agent Mode approval or proposal controls.
  assert.doesNotMatch(document, /data-agent-intent=/);
  assert.doesNotMatch(document, /data-propose-recipe=/);
  // No history execution or evidence-mutation path.
  assert.doesNotMatch(document, /data-evidence=/);
  assert.doesNotMatch(document, /data-history-run=/);
  // The Recent list IS present now — resuming a task is product, and it only
  // reveals conversations, never a second composer or execution path.
  assert.ok(document.includes('id="nav-conversations"'));
});
