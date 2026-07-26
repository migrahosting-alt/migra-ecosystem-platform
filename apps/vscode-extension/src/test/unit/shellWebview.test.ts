import assert from 'node:assert/strict';
import test from 'node:test';

import { shellScript } from '../../panel/shell/shellScript.js';
import { shellHtml } from '../../panel/shell/shellHtml.js';
import { shellStyles } from '../../panel/shell/shellStyles.js';
import { navigationHtml, navigationScript } from '../../panel/shell/navigationHtml.js';
import { icon, knownIcons } from '../../panel/shell/icons.js';
import { NAV_ACTIONS, SHELL_TABS, findNavAction, navListActions, navPrimaryAction } from '../../panel/shell/navigationModel.js';
import { SLASH_COMMANDS } from '../../panel/shell/composerModel.js';

const NONCE = 'test-nonce-abcdefgh';
const CSP = "default-src 'none'; script-src 'nonce-test-nonce-abcdefgh'";

function html(): string {
  return shellHtml({ nonce: NONCE, csp: CSP, logoUri: 'https://file%2B.vscode-resource/logo.svg', initialTab: 'chat', script: shellScript(), compact: false });
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

test('the slash catalogue is injected as data, with no placeholder token left', () => {
  const script = shellScript();
  assert.doesNotMatch(script, /SLASH_COMMANDS_JSON/, 'the token must be replaced');
  for (const command of SLASH_COMMANDS) {
    assert.ok(script.includes(command.name), `${command.name} must reach the webview`);
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

test('the document declares the three regions, every tab and six context panels', () => {
  const document = html();
  for (const id of ['nav-drawer', 'main', 'context', 'composer', 'statusrow', 'tabs', 'hdr']) {
    assert.ok(document.includes(`id="${id}"`), `region #${id} must exist`);
  }
  for (const tab of SHELL_TABS.map((entry) => entry.id)) {
    assert.ok(document.includes(`id="panel-${tab}"`), `panel-${tab} must exist`);
    assert.ok(document.includes(`id="tabbtn-${tab}"`), `tabbtn-${tab} must exist`);
  }
  for (const panel of ['ctx-workspace', 'ctx-brain', 'ctx-agent', 'ctx-run', 'ctx-files', 'ctx-activity']) {
    assert.ok(document.includes(`id="${panel}"`), `context panel #${panel} must exist`);
  }
});

test('the welcome state renders six action cards, so the centre is never empty', () => {
  const document = html();
  const cards = document.match(/data-welcome="/g) ?? [];
  assert.equal(cards.length, 6);
  assert.ok(document.includes('Build or Fix Code'));
  assert.ok(document.includes('Run Agent Task'));
  assert.ok(document.includes('Your governed AI engineering and infrastructure copilot.'));
});

test('the initial tab is reflected in aria-selected and the roving tabindex', () => {
  const document = shellHtml({ nonce: NONCE, csp: CSP, initialTab: 'audit', script: 'void 0;', compact: false });
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
  assert.ok(document.includes('role="tablist"'));
  assert.equal((document.match(/role="tab"/g) ?? []).length, SHELL_TABS.length);
  assert.equal((document.match(/role="tabpanel"/g) ?? []).length, SHELL_TABS.length);
  assert.ok(document.includes('id="thread" role="log"'));
  assert.ok(document.includes('aria-live="polite"'));
  assert.ok(document.includes('role="complementary"') || document.includes('<aside id="context"'));
  assert.ok(document.includes('aria-label="Workspace and run context"'));
});

test('every interactive control has an accessible name', () => {
  const document = html();
  // The composer's textarea and select are labelled; the icon buttons have titles.
  assert.ok(document.includes('<label class="sr-only" for="cinput">'));
  assert.ok(document.includes('<label class="sr-only" for="croute">'));
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

test('the navigation surface renders the launcher sections and a footer identity', () => {
  const document = navigationHtml({ nonce: NONCE, csp: CSP, logoUri: 'https://file%2B.vscode-resource/logo.svg' });
  for (const section of ['Agent Mode', 'Workspace', 'Tools &amp; Services', 'Service']) {
    assert.ok(document.includes(section), `${section} must be a navigation section`);
  }
  for (const id of ['nav-agent-actions', 'nav-service-actions', 'nav-workspace', 'nav-tools', 'nav-identity', 'brain-badge']) {
    assert.ok(document.includes(`id="${id}"`), `#${id} must exist on the navigation surface`);
  }
  assert.equal(document.split('<script').length - 1, 1);
  // The status summary belongs to the Studio panel — not duplicated in the rail.
  assert.ok(!document.includes('id="statusrow"'));
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

test('the sidebar is a launcher: Open Command Center is the prominent primary action', () => {
  const primary = navPrimaryAction();
  assert.equal(primary.id, 'openCommandCenter');
  assert.equal(primary.label, 'Open Command Center');
  assert.equal(primary.kind, 'studio');
  assert.equal(primary.target, 'chat');
  // Exactly one primary, and it is rendered with the prominent button style.
  assert.equal(NAV_ACTIONS.filter((action) => action.primary).length, 1);
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  assert.match(document, /<button class="newchat" data-nav-action="openCommandCenter">/);
});

test('the sidebar exposes exactly the approved visible action set', () => {
  // The approved list, in order. Anything else must NOT be a sidebar action.
  const approved = [
    'Open Command Center',
    'New Task',
    'Pending Approvals',
    'Active Runs',
    'Run History',
    'Brain Status',
    'Repair Connection',
    'Logs',
    'Settings',
  ];
  assert.deepEqual(NAV_ACTIONS.map((action) => action.label), approved);

  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  for (const action of NAV_ACTIONS) {
    assert.ok(document.includes(`data-nav-action="${action.id}"`), `${action.label} is not rendered`);
  }
  // Every rendered launcher row corresponds to an approved action — no extras.
  const rendered = [...document.matchAll(/data-nav-action="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rendered.sort(), NAV_ACTIONS.map((action) => action.id).sort());
  // Icons resolve.
  const available = new Set(knownIcons());
  for (const action of NAV_ACTIONS) assert.ok(available.has(action.icon), `missing icon ${action.icon}`);
});

test('launcher rows route governed work to the Command Center, never inline', () => {
  // Everything that touches a composer, an approval, or a history record must be
  // a `studio` reveal so the sidebar never renders a second surface (§8).
  for (const id of ['openCommandCenter', 'newTask', 'pendingApprovals', 'activeRuns', 'runHistory']) {
    const action = findNavAction(id);
    assert.equal(action?.kind, 'studio', `${id} must open the Command Center`);
    assert.ok(['chat', 'agent', 'audit'].includes(action?.target ?? ''), `${id} targets a real tab`);
  }
  // Service rows run already-registered commands (allow-list enforced on the host).
  assert.deepEqual(
    navListActions('service').map((action) => [action.kind, action.target]),
    [
      ['command', 'health'],
      ['command', 'repairConnection'],
      ['command', 'showLogs'],
      ['shell', 'settings'],
    ],
  );
});

test('counts render blank when unknown, never as a reassuring zero', () => {
  const document = navigationHtml({ nonce: NONCE, csp: CSP });
  // Count badges start hidden; live state reveals them only when a real count
  // arrives (the renderer keeps them hidden for undefined).
  for (const counter of ['pendingApprovals', 'activeRuns', 'runHistory']) {
    assert.match(document, new RegExp(`data-counter="${counter}" hidden`), `${counter} badge must start hidden`);
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
  // And no conversation list — a second chat entry point belongs to the
  // Command Center, not the launcher.
  assert.ok(!document.includes('id="nav-conversations"'));
});
